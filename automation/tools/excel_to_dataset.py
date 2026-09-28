"""
Convert the weekly OP "Outstanding_Report_<date>.xlsx" workbook into a tracker ReceivablesDataset JSON
so it can be run through the pipeline with DATA_SOURCE=file (manual run mode).

Usage:
  python automation/tools/excel_to_dataset.py <workbook.xlsx> <as_of YYYY-MM-DD> [out.json]

Mapping (see docs/RUNBOOK_MANUAL_RUN.md):
  Outstanding sheet   -> invoices (+ payments/activities parsed from "Remark Detail (Ellis)")
  Tier sheet          -> customers (PIC(OMH) = account owner, Tier = customer_group)
  information sheet   -> FX table (Rate to JPY)
Nothing is invented: fields the workbook does not carry are null / 'Unknown' and listed in completeness.notes.
"""
import json
import re
import statistics
import sys
from collections import defaultdict
from datetime import datetime, date

import openpyxl

# Internal accounts (confirmed by Global Ops 2026-09-28): not customer receivables, so they are EXCLUDED from the
# tracker dataset and listed with their balances in completeness.notes instead.
#   "Business Trip in ..."  = employee business trips (출장)
#   "Unsold room (JP)"      = hard-block unsold inventory (하드블럭 미판매분)
INTERNAL_HINTS = ("business trip", "unsold room")

# Managing entity (control company) per channel, confirmed by Global Ops 2026-09-28:
#   Ctrip Vietnam -> OMH Vietnam; Ctrip Korea, Agoda, Kakao -> OMH Korea; everything else -> OMH Singapore (HQ).
CONTROL_COMPANY_DEFAULT = "OMH Singapore"
CONTROL_COMPANY_BY_CHANNEL = {
    "ctrip vietnam": "OMH Vietnam",
    "ctrip korea": "OMH Korea",
    "agoda": "OMH Korea",
    "kakao": "OMH Korea",
}

def control_company_for(name):
    return CONTROL_COMPANY_BY_CHANNEL.get(name.strip().lower(), CONTROL_COMPANY_DEFAULT)
NOTE_HDR = re.compile(r"^\[(\d{4}-\d{2}-\d{2})\]\s*(.+?)\s*\|\s*([\d,\.]+)\s*$")


def iso(v):
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return None


def num(s):
    return float(str(s).replace(",", ""))


def main(path, as_of, out):
    wb = openpyxl.load_workbook(path, data_only=True)
    notes = [f"Manual run: converted from OP workbook {path.split('/')[-1].split(chr(92))[-1]} (as of {as_of})."]

    # ---- FX (information sheet) ----
    rates = []
    for r in wb["information"].iter_rows(values_only=True):
        if r and isinstance(r[0], str) and r[0].strip().upper() in ("USD", "KRW", "VND", "TWD", "THB", "SGD", "CNY", "HKD", "EUR") and isinstance(r[1], (int, float)):
            rates.append({"currency": r[0].strip().upper(), "rate_to_reporting": float(r[1]), "rate_date": as_of, "source": "OP workbook 'information' sheet (approx. rate to JPY)"})
    fx = {"reporting_currency": "JPY", "as_of": as_of, "rates": rates}
    notes.append("FX: approximate rates from the workbook 'information' sheet, not ELLIS applied rates.")

    # ---- Customers (Tier sheet) ----
    tier_by_name = {}
    for r in wb["Tier"].iter_rows(min_row=3, values_only=True):
        if r and r[3]:
            tier_by_name[str(r[3]).strip().lower()] = {"status": r[1], "type": r[2], "channel": str(r[3]).strip(), "company": r[4], "pic": r[5], "tier": r[6]}

    # ---- Invoices (Outstanding sheet) ----
    ws = wb["Outstanding"]
    hdr = [str(c.value).strip() if c.value is not None else "" for c in ws[1]]
    col = {h: i for i, h in enumerate(hdr)}
    inv_rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if r[0] is not None]

    customers = {}
    invoices, payments, activities = [], [], []
    internal_rows = []  # (name, invoice, ccy, balance, balance_jpy)
    terms = defaultdict(list)
    ccy_count = defaultdict(lambda: defaultdict(int))
    unmatched_tier = set()

    for r in inv_rows:
        inv_no = str(r[col["Invocie No"]]).strip()
        code = str(r[col["Seller code"]]).strip()
        name = str(r[col["Seller name"]]).strip()
        cid = f"seller:{code}"
        ccy = str(r[col["B.Cur"]]).strip().upper()
        total = float(r[col["B.Sum amount"]] or 0)
        paid = float(r[col["Paid amount"]] or 0)
        bal = float(r[col["Balance"]] or 0)
        issue = iso(r[col["Issue date"]])
        due = iso(r[col["Due date"]])
        tier_cell = r[col["Tier"]]
        remark = r[col["Remark Detail (Ellis)"]] if "Remark Detail (Ellis)" in col else None
        vnop = r[col["VNOP action"]] if "VNOP action" in col else None
        ccy_count[cid][ccy] += 1
        if issue and due:
            terms[cid].append((datetime.fromisoformat(due) - datetime.fromisoformat(issue)).days)

        t = tier_by_name.get(name.lower())
        internal = any(h in name.lower() for h in INTERNAL_HINTS)
        if internal:
            rate = next((r["rate_to_reporting"] for r in rates if r["currency"] == ccy), 1.0 if ccy == "JPY" else None)
            internal_rows.append((name, inv_no, ccy, bal, round(bal * rate) if rate else None))
            continue
        if cid not in customers:
            if t is None and not internal:
                unmatched_tier.add(name)
            customers[cid] = {
                "customer_id": cid, "customer_name": name,
                "customer_group": (t["tier"] if t else (str(tier_cell) if tier_cell not in (None, "#N/A") else "Untiered")),
                "country": "Unknown", "region": (t["type"] if t else ""),
                "account_owner_id": (str(t["pic"]).lower() if t and t["pic"] else ""), "account_owner_name": (str(t["pic"]) if t and t["pic"] else ""),
                "finance_owner": None, "contract_currency": ccy, "payment_terms_days": None, "credit_limit": None,
                "credit_status": "ACTIVE", "customer_status": "ACTIVE", "collection_status": "NORMAL", "risk_grade_manual": None,
                "preferred_contact_channel": None, "control_company": control_company_for(name),
                "tier": (int(str(t["tier"]).replace("Tier", "").strip()) if t and t.get("tier") and str(t["tier"]).startswith("Tier") else None),
                "data_source": "op-workbook:Tier" if t else "op-workbook:Outstanding (not in Tier sheet)",
            }

        disputed = 0.0
        dispute_status, dispute_reason = "NONE", None
        last_pay_date, last_pay_amt = None, None
        if isinstance(remark, str):
            for line in remark.splitlines():
                m = NOTE_HDR.match(line.strip())
                if m:
                    d, who, amt = m.group(1), m.group(2).strip(), num(m.group(3))
                    pid = f"{inv_no}:{d}:{len(payments)}"
                    payments.append({
                        "payment_id": pid, "invoice_id": inv_no, "customer_id": cid, "payment_date": d,
                        "payment_amount": amt, "payment_currency": ccy, "applied_amount": amt, "unapplied_amount": 0,
                        "payment_method": "BANK_TRANSFER", "payment_reference": f"ELLIS remark by {who}",
                        "reconciliation_status": "APPLIED",
                        # The workbook only shows the ELLIS record (Paid amount). PM CNFM and bank reconciliation dates are not in it,
                        # so the reflection chain is NOT measurable from this source: both are set to the record date (= "not tracked").
                        "confirmed_at": d, "reconciled_at": d,
                        "data_source": "op-workbook:Remark Detail (Ellis)",
                    })
                    if last_pay_date is None or d > last_pay_date:
                        last_pay_date, last_pay_amt = d, amt
                if "disput" in line.lower():
                    dispute_status = "OPEN"
                    dispute_reason = line.strip()
                    m2 = re.search(r"[￥$]\s*([\d,]+(?:\.\d+)?)", line)
                    disputed += num(m2.group(1)) if m2 else 0.0
            activities.append({
                "activity_id": f"note:{inv_no}", "customer_id": cid, "invoice_id": inv_no, "owner": "Rina (Josh)",
                "activity_type": "NOTE", "activity_date": last_pay_date or as_of, "contact_channel": None,
                "note": remark.strip()[:2000], "promised_payment_date": None, "promised_payment_amount": None, "promised_currency": None,
                "next_action": None, "next_action_date": None, "escalation_level": 0, "completed": True,
            })
        if isinstance(vnop, str) and vnop.strip():
            activities.append({
                "activity_id": f"vnop:{inv_no}", "customer_id": cid, "invoice_id": inv_no, "owner": "VN OP",
                "activity_type": "NOTE", "activity_date": as_of, "contact_channel": None, "note": vnop.strip(),
                "promised_payment_date": None, "promised_payment_amount": None, "promised_currency": None,
                "next_action": vnop.strip(), "next_action_date": None, "escalation_level": 0, "completed": False,
            })
        status = "DISPUTED" if dispute_status == "OPEN" and abs(disputed - bal) < 0.005 else ("PARTIALLY_PAID" if paid > 0 else "OPEN")
        invoices.append({
            "invoice_id": inv_no, "invoice_number": inv_no, "booking_id": None, "customer_id": cid,
            "invoice_date": issue, "service_date": None, "due_date": due,
            "original_amount": round(total, 2), "paid_amount": round(paid, 2), "credit_note_amount": 0,
            "disputed_amount": round(min(disputed, bal), 2), "outstanding_amount": round(bal, 2),
            "invoice_currency": ccy, "invoice_status": status, "dispute_status": dispute_status, "dispute_reason": dispute_reason,
            "cancellation_status": "NONE", "last_payment_date": last_pay_date, "last_payment_amount": last_pay_amt,
            "data_source": "op-workbook:Outstanding",
        })

    for cid, c in customers.items():
        c["contract_currency"] = max(ccy_count[cid].items(), key=lambda kv: kv[1])[0]
        if terms[cid]:
            c["payment_terms_days"] = int(statistics.median(terms[cid]))
    if internal_rows:
        by_name = {}
        for name, _, ccy, bal, jpy in internal_rows:
            e = by_name.setdefault(name, {"n": 0, "jpy": 0})
            e["n"] += 1
            e["jpy"] += jpy or 0
        total_jpy = sum(e["jpy"] for e in by_name.values())
        notes.append("Internal accounts excluded (not customer receivables; 출장/하드블럭 미판매분): " + ", ".join(f"{n} {e['n']} inv. JPY {e['jpy']:,.0f}" for n, e in by_name.items()) + f" — total JPY {total_jpy:,.0f}.")
    if unmatched_tier:
        notes.append("Sellers not found in the Tier sheet (no PIC / tier): " + ", ".join(sorted(unmatched_tier)) + ".")
    notes.append("Managing entity is not in the workbook; assigned from the tracker mapping (Ctrip Vietnam -> OMH Vietnam; Ctrip Korea, Agoda, Kakao -> OMH Korea; others -> OMH Singapore HQ) until ELLIS ownerCompName is available.")
    notes.append("Payments come from the ELLIS remark notes on each invoice (record stage). PM CNFM and bank reconciliation are NOT tracked in the workbook, so the ELLIS reflection chain shows 0 pending by construction until the MCP tools deliver paymentConfirmDate.")
    notes.append("Credit limits, countries and booking context are not in the workbook.")

    ds = {
        "as_of": f"{as_of}T00:00:00+07:00", "source": "file", "reporting_currency": "JPY", "fx": fx,
        "customers": list(customers.values()), "invoices": invoices, "payments": payments, "activities": activities, "bookings": [],
        "completeness": {"customers": "partial", "invoices": "full", "payments": "partial", "activities": "partial", "fx": "partial", "notes": notes},
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(ds, f, ensure_ascii=False, indent=1)
    print(json.dumps({"customers": len(customers), "invoices": len(invoices), "payments": len(payments), "activities": len(activities), "fx": [r["currency"] for r in rates], "notes": notes}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "automation/input/ellis-export.json")
