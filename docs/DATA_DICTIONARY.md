# Data Dictionary — Outstanding Receivables Tracker

**Purpose.** This document lists every entity and field of the tracker's domain model (`src/core/types.ts`) with type, meaning, nullability and data source, and states the exact calculation formulas implemented in `src/core/calc.ts`, `aging.ts`, `kpis.ts`, `risk.ts`, `money.ts`, `dates.ts` and `history.ts`. It is the reference for the frontend, the automation pipeline, the Ellis mapping and the tests; nothing here is a proposal — every rule is what the code does today.

**Status:** Draft v0.1 — 2026-09-07

> **요약 (Korean summary).** 모든 금액은 **원화폐(original currency)** 로 보존되고, 계산 엔진이 명시적 환율(`FxTable.rate_to_reporting`, 환율 기준일 포함)로 보고통화 금액(`*_reporting`)을 추가합니다. 미수금 = 원금 − 입금 − 크레딧노트(0 미만이면 초과입금 → 미적용 현금으로 분류). 연체일수 = 기준일 − 만기일. 주간 비교는 이전 스냅샷과 비교하며, 스냅샷은 자체 환율표를 보관하므로 환율 변동 효과(FX effect)를 실제 잔액 변동과 분리해 보여줍니다. 실데이터(Ellis) 모드에서는 입금·크레딧노트·고객 마스터가 없어 다수 필드가 가정값입니다.

### Source legend

| Source tag | Meaning |
| --- | --- |
| **Ellis-C** | Confirmed Ellis `get_hotel_bookings` field (see `ELLIS_MCP_MAPPING.md`) |
| **Ellis-A** | Derived from Ellis data on an explicit assumption |
| **Required** | No Ellis source; must be provided by the Ellis team / Finance |
| **Computed** | Calculated by the tracker engine |
| **Config** | Environment / configuration value |
| **Tracker-owned** | Expected to be captured by the tracker itself (collection activities) |
| **Mock** | Only produced by the mock generator today |

Type aliases: `ISODate` = `YYYY-MM-DD`; `ISODateTime` = ISO 8601 with offset (e.g. `2026-09-05T02:00:00Z`); `CurrencyCode` = ISO 4217.

---

## 1. Enumerations

| Enum | Values | Notes |
| --- | --- | --- |
| `AgingBucket` | `CURRENT`, `D1_7`, `D8_14`, `D15_30`, `D31_60`, `D61_90`, `D90_PLUS` | Labels in `AGING_BUCKET_LABEL`: "Current (not yet due)", "1-7 days", "8-14 days", "15-30 days", "31-60 days", "61-90 days", "90+ days". Calculated invoices may also carry `'UNKNOWN'` (no due date) |
| `RiskGrade` | `Low`, `Watch`, `Medium`, `High`, `Critical` | thresholds 30 / 50 / 70 / 85 |
| `CreditStatus` | `ACTIVE`, `ON_HOLD`, `SUSPENDED` | affects risk factor 6 |
| `CustomerStatus` | `ACTIVE`, `INACTIVE`, `CHURNED` | informational |
| `CollectionStatus` | `NORMAL`, `REMINDER`, `ESCALATED`, `LEGAL` | informational |
| `InvoiceStatus` | `OPEN`, `PARTIALLY_PAID`, `PAID`, `DISPUTED`, `CANCELLED`, `CREDITED`, `WRITTEN_OFF` | `CANCELLED`, `WRITTEN_OFF` are "closed" (never carry outstanding) |
| `DisputeStatus` | `NONE`, `OPEN`, `UNDER_REVIEW`, `RESOLVED`, `REJECTED` | `OPEN`/`UNDER_REVIEW` trigger the `DISPUTE` action |
| `CancellationStatus` | `NONE`, `REQUESTED`, `CANCELLED` | `CANCELLED` closes the invoice |
| `ReconciliationStatus` | `APPLIED`, `PARTIALLY_APPLIED`, `UNAPPLIED`, `REFUNDED` | `REFUNDED` payments are excluded from all sums |
| `PaymentMethod` | `BANK_TRANSFER`, `CARD`, `VCC`, `OFFSET`, `OTHER` | |
| `ActivityType` | `CALL`, `EMAIL`, `MEETING`, `REMINDER`, `PROMISE`, `DISPUTE`, `ESCALATION`, `NOTE` | |
| `ContactChannel` | `EMAIL`, `PHONE`, `TEAMS`, `WHATSAPP`, `KAKAO`, `LINE`, `ZALO`, `IN_PERSON` | |
| `DataSourceKind` | `mock`, `ellis-mcp`, `ellis-bookings-derived`, `file` | `is_mock = source === 'mock'` |
| `KpiKey` | `total_outstanding`, `overdue_outstanding`, `overdue_ratio`, `due_within_7_days`, `collected_this_week`, `new_overdue_this_week`, `overdue_30_plus`, `overdue_90_plus`, `broken_promises`, `at_risk_amount` | |
| `ActionGroup` | `CONTACT_TODAY`, `DUE_3_DAYS`, `DUE_7_DAYS`, `PROMISE_OVERDUE`, `OVERDUE_30`, `OVERDUE_90`, `DISPUTE`, `CREDIT_LIMIT`, `ESCALATE` | labels in `ACTION_GROUP_LABEL` |

---

## 2. Raw dataset entities (`ReceivablesDataset`)

### 2.1 `Customer`

| Field | Type | Null | Meaning | Source (live) |
| --- | --- | --- | --- | --- |
| `customer_id` | string | no | Stable key; live: `seller:<slug(sellerName)>` | Ellis-A (Required: real seller ID) |
| `customer_name` | string | no | Display name | Ellis-C (`sellerName`) |
| `customer_group` | string | yes | Key-account group | Required |
| `country` | string | no | Customer's country (live: `'Unknown'`) | Required |
| `region` | string | no | Market/region (live: `'Unknown'`) | Required |
| `account_owner_id` | string | no (may be `''`) | Sales owner id; empty → `MISSING_OWNER` warning | Required |
| `account_owner_name` | string | no (may be `''`) | Shown as "Unassigned" when empty | Required |
| `finance_owner` | string | yes | Finance contact | Required |
| `contract_currency` | CurrencyCode | no | Currency of `credit_limit` and default promise currency | Ellis-A (first booking currency) |
| `payment_terms_days` | int ≥ 0 | yes | Days from service to due; `null` → `MISSING_TERMS` info | Required (assumed 14) |
| `credit_limit` | number ≥ 0 | yes | In `contract_currency`; `null` → `MISSING_CREDIT_LIMIT` info, utilization `null` | Required |
| `credit_status` | CreditStatus | no | Finance-set status; `ON_HOLD`/`SUSPENDED` raise risk factor 6 | Required (live: `ACTIVE`) |
| `customer_status` | CustomerStatus | no | | Required (live: `ACTIVE`) |
| `collection_status` | CollectionStatus | no | | Required (live: `NORMAL`) |
| `risk_grade_manual` | RiskGrade | yes | Finance override from master data; **not** used in the calculated grade | Required |
| `preferred_contact_channel` | ContactChannel | yes | | Required |
| `data_source` | string | no | Provenance label | Computed |

### 2.2 `Invoice`

| Field | Type | Null | Meaning | Source (live) |
| --- | --- | --- | --- | --- |
| `invoice_id` | string | no | Unique; duplicate → `DUPLICATE_INVOICE` error | Ellis-A (`bk:<bookingItemCode>`) |
| `invoice_number` | string | no | Human number | Ellis-A (`bookingItemCode`) |
| `booking_id` | string | yes | Link to `BookingContext` | Ellis-C |
| `customer_id` | string | no | Unknown customer → `ORPHAN_INVOICE` error | Ellis-A |
| `invoice_date` | ISODate | no | Used by `datasetAsOf()` to drop future invoices | Ellis-A (= checkout) |
| `service_date` | ISODate | yes | Checkout date | Ellis-C |
| `due_date` | ISODate | yes | `null` = data-quality issue (`MISSING_DUE_DATE`); aging cannot be computed | Ellis-A (checkout + 14) |
| `original_amount` | number | no | Gross invoice amount in `invoice_currency` | Ellis-C (`billing`) |
| `paid_amount` | number | no | Sum of applied payments | Required (live: 0) |
| `credit_note_amount` | number | no | Credit notes applied | Required (live: 0) |
| `disputed_amount` | number ≥ 0 | no | Disputed portion; capped at outstanding in calc | Required (live: 0) |
| `outstanding_amount` | number | no | Source value; **recomputed** by the engine (see §5.1) | Required |
| `invoice_currency` | CurrencyCode | no | Original currency | Ellis-C |
| `invoice_status` | InvoiceStatus | no | | Ellis-A (`OPEN`/`CANCELLED`) |
| `dispute_status` | DisputeStatus | no | | Required |
| `dispute_reason` | string | yes | | Required |
| `cancellation_status` | CancellationStatus | no | `CANCELLED` closes the invoice | Ellis-C |
| `last_payment_date` | ISODate | yes | | Required |
| `last_payment_amount` | number | yes | | Required |
| `data_source` | string | no | | Computed |

### 2.3 `Payment`

| Field | Type | Null | Meaning | Source |
| --- | --- | --- | --- | --- |
| `payment_id` | string | no | Unique | Required |
| `invoice_id` | string | yes | `null` = unapplied cash | Required |
| `customer_id` | string | no | Unknown → `ORPHAN_PAYMENT` error | Required |
| `payment_date` | ISODate | no | Drives "Collected This Week" | Required |
| `payment_amount` | number | no | Gross received (negative allowed for refunds) | Required |
| `payment_currency` | CurrencyCode | no | | Required |
| `applied_amount` | number | no | Applied to invoices | Required |
| `unapplied_amount` | number | no | `applied + unapplied ≠ amount` → `PAYMENT_SPLIT_MISMATCH` (unless `REFUNDED`) | Required |
| `payment_method` | PaymentMethod | no | | Required |
| `payment_reference` | string | yes | Bank reference; **set to `null` in published model** | Required |
| `reconciliation_status` | ReconciliationStatus | no | `REFUNDED` excluded from all sums | Required |
| `data_source` | string | no | | Computed |

### 2.4 `CollectionActivity`

| Field | Type | Null | Meaning | Source |
| --- | --- | --- | --- | --- |
| `activity_id` | string | no | | Tracker-owned |
| `customer_id` | string | no | Unknown → `ORPHAN_ACTIVITY` warning | Tracker-owned |
| `invoice_id` | string | yes | Customer-level activity when `null` | Tracker-owned |
| `owner` | string | no | Person who logged it | Tracker-owned |
| `activity_type` | ActivityType | no | | Tracker-owned |
| `activity_date` | ISODate | no | Drives "days since last activity" and promise evaluation window | Tracker-owned |
| `contact_channel` | ContactChannel | yes | | Tracker-owned |
| `note` | string | no | Free text; **redacted in published model** | Tracker-owned |
| `promised_payment_date` | ISODate | yes | Promise date (uncompleted → evaluated) | Tracker-owned |
| `promised_payment_amount` | number | yes | In `promised_currency` (fallback: customer `contract_currency`) | Tracker-owned |
| `promised_currency` | CurrencyCode | yes | | Tracker-owned |
| `next_action` | string | yes | Shown on invoice; feeds `CONTACT_TODAY` (`NEXT_ACTION:` items) | Tracker-owned |
| `next_action_date` | ISODate | yes | | Tracker-owned |
| `escalation_level` | 0 \| 1 \| 2 \| 3 | no | | Tracker-owned |
| `completed` | boolean | no | Completed promises/actions are ignored by the engine | Tracker-owned |

### 2.5 `BookingContext`

| Field | Type | Null | Meaning | Source |
| --- | --- | --- | --- | --- |
| `booking_id` | string | no | `bookingItemCode` | Ellis-C |
| `check_in`, `check_out` | ISODate | no | | Ellis-C |
| `hotel_name` | string | no | | Ellis-C |
| `destination` | string | no | live: `"<hotelCity>, <hotelCountry>"` | Ellis-C |
| `booking_amount` | number | no | `billing` | Ellis-C |
| `booking_currency` | CurrencyCode | no | | Ellis-C |
| `booking_status` | string | no | raw `bookingStatus` | Ellis-C |
| `cancellation_penalty` | number | yes | | Required |
| `supplier_payment_status` | string | yes | | Required |
| `net_revenue` | number | yes | `revenue` | Ellis-C |

### 2.6 `FxRate` / `FxTable`

| Field | Type | Null | Meaning |
| --- | --- | --- | --- |
| `FxRate.currency` | CurrencyCode | no | Original currency |
| `FxRate.rate_to_reporting` | number > 0 | no | **Reporting-currency units per 1 unit of `currency`** (e.g. KRW→USD = 0.00072) |
| `FxRate.rate_date` | ISODate | no | Date the rate is valid for — surfaced as `exchange_rate_date` on invoices |
| `FxRate.source` | string | no | e.g. `mock-fx (illustrative rates)`, `ILLUSTRATIVE - replace with treasury/ECB feed`, `identity` |
| `FxTable.reporting_currency` | CurrencyCode | no | Default `USD` (`REPORTING_CURRENCY`) |
| `FxTable.as_of` | ISODate | no | Table date; set to the snapshot date by `datasetAsOf()` |
| `FxTable.rates` | FxRate[] | no | One row per foreign currency |

Source: **Required** (treasury/ECB feed). Mock rates (`MOCK_FX_USD`): KRW 0.00072, JPY 0.0068, VND 0.000039, TWD 0.031, THB 0.028, HKD 0.128, SGD 0.75, MYR 0.22, IDR 0.000061, PHP 0.0175; older weeks drift deterministically (JPY −0.4 %/wk, KRW +0.2 %, VND +0.05 %, TWD −0.1 %, THB +0.1 %) so the FX effect is visible.

### 2.7 `DataQualityIssue`

| Field | Type | Meaning |
| --- | --- | --- |
| `severity` | `error` \| `warning` \| `info` | `error` ⇒ `validateDataset().ok = false` ⇒ pipeline fails (no report) |
| `code` | string | see table below |
| `entity` | `customer` \| `invoice` \| `payment` \| `activity` \| `fx` \| `dataset` | |
| `entity_id` | string \| null | |
| `message` | string | |

| Code | Severity | Raised when |
| --- | --- | --- |
| `SCHEMA_VIOLATION` | error | Zod schema failure (first 50 issues) |
| `DUPLICATE_INVOICE` | error | same `invoice_id` twice |
| `ORPHAN_INVOICE` / `ORPHAN_PAYMENT` | error | unknown `customer_id` |
| `MISSING_DUE_DATE` | warning | no `due_date` and status not `CANCELLED`/`PAID` (also per open invoice in calc) |
| `MISSING_FX_RATE` | warning | invoice currency not in FX table (validate) / open invoice excluded from totals (calc) |
| `AMOUNT_MISMATCH` | warning | `outstanding ≠ original − paid − credit_note` (engine uses recomputed value) |
| `OVERPAYMENT` | warning | negative outstanding → treated as unapplied cash |
| `DISPUTE_EXCEEDS_OUTSTANDING` | warning | disputed > outstanding (capped) |
| `PAYMENT_UNKNOWN_INVOICE` | warning | payment references unknown invoice |
| `PAYMENT_SPLIT_MISMATCH` | warning | `applied + unapplied ≠ payment_amount` (non-refund) |
| `MISSING_CREDIT_LIMIT` | info | `credit_limit = null` |
| `MISSING_OWNER` | warning | `account_owner_id = ''` |
| `MISSING_TERMS` | info | `payment_terms_days = null` |
| `ORPHAN_ACTIVITY` | warning | activity for unknown customer |

Issues are de-duplicated by `code|entity|entity_id` in the model.

### 2.8 `DatasetCompleteness` and `ReceivablesDataset`

| Field | Type | Meaning |
| --- | --- | --- |
| `completeness.customers/invoices/payments/activities/fx` | `full` \| `partial` \| `missing` | Live bookings-derived: `partial, partial, missing, missing, full|missing` |
| `completeness.notes` | string[] | Human-readable caveats; copied into `data_quality_warnings` and the Teams footer |
| `as_of` | ISODateTime | Data reference timestamp |
| `source` | DataSourceKind | |
| `reporting_currency` | CurrencyCode | |
| `fx` | FxTable | |
| `customers`, `invoices`, `payments`, `activities`, `bookings` | arrays | |

---

## 3. Calculated entities (`TrackerModel`)

### 3.1 `CalculatedInvoice` (extends `Invoice`)

| Field | Type | Null | Formula / meaning |
| --- | --- | --- | --- |
| `outstanding_amount` | number | no | **Recomputed**: `closed ? 0 : round2(original − paid − credit_note)`, floored at 0 (negative part → unapplied cash) |
| `aging_days` | number | yes | `daysBetween(due_date, reference_date)` = reference − due (negative = not yet due); `null` when no due date |
| `aging_bucket` | AgingBucket \| `UNKNOWN` | no | `bucketFor(aging)` when outstanding > 0; `UNKNOWN` if no due date; `CURRENT` for settled invoices with a due date |
| `is_overdue` | boolean | no | `outstanding > 0 && aging_days > 0` |
| `outstanding_reporting` | number | no | `convert(outstanding, invoice_currency, fx)`; **0 when no rate** (+ `MISSING_FX_RATE` warning) |
| `disputed_reporting` | number | no | `convert(min(disputed_amount, outstanding))` |
| `exchange_rate` | number | yes | rate used |
| `exchange_rate_date` | ISODate | yes | `FxRate.rate_date` used |
| `customer_name`, `account_owner_name`, `country`, `owner` | string | no | Denormalised from customer (`Unassigned`, `Unknown` fallbacks) |
| `promised_payment_date` | ISODate | yes | latest **uncompleted** activity with a promise, by `activity_date` |
| `next_action`, `next_action_date` | | yes | latest uncompleted activity with `next_action` |
| `payments` | Payment[] | no | payments linked to this invoice, sorted by date |
| `activities` | CollectionActivity[] | no | activities linked to this invoice, sorted by date |

### 3.2 `RiskFactor`, `RiskScore`

| Field | Type | Meaning |
| --- | --- | --- |
| `RiskFactor.key` | string | `aging`, `overdue_amount`, `over30_ratio`, `wow_increase`, `promise_broken`, `credit_limit`, `no_activity`, `dispute` |
| `RiskFactor.label` | string | UI label |
| `RiskFactor.points` / `max_points` | number | 25/20/15/10/10/10/5/5 caps |
| `RiskFactor.evidence` | string | e.g. "Oldest overdue invoice: 111 days" |
| `RiskScore.score` | 0–100 | sum of points, clamped |
| `RiskScore.grade` | RiskGrade | `gradeFor(score)` |
| `RiskScore.factors` | RiskFactor[] | always 8 entries |

Point tables: see `PRODUCT_REQUIREMENTS.md` §6 (identical to `src/core/risk.ts`).

### 3.3 `CustomerRisk`

| Field | Type | Null | Formula |
| --- | --- | --- | --- |
| identity fields (`customer_id`, `customer_name`, `country`, `region`, `account_owner_id`, `account_owner_name`, `contract_currency`, `credit_status`, `collection_status`) | | | copied; owner name `'Unassigned'` if empty |
| `total_outstanding_reporting` | number | no | Σ `outstanding_reporting` of open invoices (outstanding > 0) |
| `overdue_reporting` | number | no | Σ over open invoices with `is_overdue` |
| `not_due_reporting` | number | no | `total − overdue` |
| `overdue_30_plus_reporting` | number | no | Σ overdue invoices with `aging_days > 30` |
| `overdue_90_plus_reporting` | number | no | Σ overdue invoices with `aging_days > 90` |
| `disputed_reporting` | number | no | Σ `disputed_reporting` of open invoices |
| `max_aging_days` | number | no | max `aging_days` over overdue invoices (0 if none) |
| `invoice_count` / `overdue_invoice_count` | number | no | open / overdue open invoices |
| `credit_limit_reporting` | number | yes | `convert(credit_limit, contract_currency)` |
| `credit_utilization` | number | yes | `total_outstanding_reporting / credit_limit_reporting`; `null` if no limit or limit ≤ 0 |
| `credit_limit_exceeded` | boolean | no | `utilization > 1` |
| `last_payment_date` | ISODate | yes | latest non-refunded payment date for the customer |
| `last_activity_date` | ISODate | yes | latest activity date |
| `next_promise_date` / `next_promise_amount_reporting` | | yes | earliest uncompleted promise with date ≥ reference |
| `promise_broken` | boolean | no | `broken_promise_amount_reporting > 0` |
| `broken_promise_amount_reporting` | number | no | see §5.6 |
| `wow_overdue_change_reporting` | number | yes | `overdue − prev.overdue` (prev row missing → prev = 0); `null` without previous snapshot |
| `wow_total_change_reporting` | number | yes | same for total |
| `risk` | RiskScore | no | `computeRiskScore(...)` |
| `recommended_action` | string | no | `recommendAction(...)` (PRD §6) |
| `bucket_totals` | Record<AgingBucket, number> | no | Σ `outstanding_reporting` per bucket (UNKNOWN excluded) |
| `data_quality` | DataQualityIssue[] | no | `MISSING_CREDIT_LIMIT`, `MISSING_OWNER`, per-invoice `MISSING_DUE_DATE` |

Customers are returned sorted by `risk.score` desc, then `overdue_reporting` desc.

### 3.4 `KpiValue`

| Field | Type | Meaning |
| --- | --- | --- |
| `key`, `label`, `unit` (`currency` \| `ratio` \| `count`) | | |
| `value` | number | current (ratio rounded to 4 dp) |
| `previous` | number \| null | from previous `SnapshotTotals` |
| `change` | number \| null | `round2(value − previous)` |
| `change_pct` | number \| null | `change / |previous|` (4 dp); `null` if `previous = 0 ≠ value`; `0` if both 0 |
| `status` | `good` \| `neutral` \| `warning` \| `critical` | rules in PRD §5 |
| `interpretation` | string | generated sentence |
| `definition` | string | fixed definition text |

### 3.5 `DimensionAging`

| Field | Meaning |
| --- | --- |
| `key` / `label` | country name; owner id / owner name (`unassigned`/`Unassigned`); customer id / name; currency code |
| `total` / `overdue` | Σ `outstanding_reporting` (all open / overdue) — rounded per accumulation step |
| `buckets` | per-bucket totals |
| `previous_overdue` | matching row's `overdue` in the previous snapshot (0 if the key was absent); `null` if no snapshot |

Country/owner/customer dimensions are built from customers (`dimension()`), sorted by `overdue` desc then `total` desc; currency is built per invoice (`dimensionByInvoice()`), sorted by `total` desc.

### 3.6 `ActionItem`

| Field | Meaning |
| --- | --- |
| `id` | `<GROUP>:<invoice_id>` or `<GROUP>:<customer_id>`; `NEXT_ACTION:<invoice_id>` for next-action items |
| `group`, `severity` (`low`…`critical`), `status` (`open` \| `in_progress` \| `done`, always `open` from the engine) | |
| `customer_id`, `customer_name`, `invoice_id` (null for customer-level), `owner`, `due_date`, `amount_reporting`, `recommended_action` | |

Rules: PRD §7.

### 3.7 `Snapshot` and children

| Field | Meaning |
| --- | --- |
| `snapshot_id`, `snapshot_date` | = reference date |
| `as_of`, `reporting_currency`, `source` | copied from dataset |
| `fx` | **the FX table used for this snapshot** (kept so the FX effect can be computed next week) |
| `totals` | `SnapshotTotals` (below) |
| `bucket_totals` | portfolio bucket totals (rounded) |
| `customers` | `SnapshotCustomerRow[]`: `customer_id`, `customer_name`, `total_outstanding`, `overdue`, `overdue_30_plus`, `max_aging_days`, `risk_score`, `risk_grade` |
| `owners`, `countries`, `currencies` | `SnapshotDimensionRow[]`: `key`, `label`, `total_outstanding`, `overdue` |
| `invoice_state` | `SnapshotInvoiceState[]` for **open** invoices: `invoice_id`, `customer_id`, `outstanding_reporting`, `outstanding_original`, `invoice_currency`, `is_overdue` — needed for New/Resolved Overdue and FX effect |

`SnapshotTotals` fields: `total_outstanding`, `overdue_outstanding`, `not_yet_due`, `overdue_30_plus`, `overdue_90_plus`, `disputed`, `unapplied_cash`, `credit_notes_applied`, `collected_during_week`, `new_overdue_during_week`, `resolved_overdue_during_week`, `due_within_7_days`, `broken_promise_amount`, `broken_promise_count`, `at_risk_amount`, `invoice_count` (open invoices), `customer_count` (customers with balance > 0). All amounts in reporting currency, `round2`.

### 3.8 `TrackerModel`

| Field | Meaning |
| --- | --- |
| `as_of`, `reference_date`, `previous_snapshot_date`, `reporting_currency`, `source`, `is_mock` | context |
| `kpis` | 10 `KpiValue` |
| `invoices` | all `CalculatedInvoice` (including settled/closed) |
| `customers` | `CustomerRisk[]` sorted by risk |
| `aging_by_bucket` | `{ bucket, amount, share, previous }` — `share = amount / total` (4 dp; total defaults to 1 when 0) |
| `aging_by_country`, `aging_by_owner`, `aging_by_customer`, `aging_by_currency` | `DimensionAging[]` |
| `actions` | `ActionItem[]` |
| `snapshot` | this week's `Snapshot` (persisted by the pipeline) |
| `data_quality` | de-duplicated issues (validation + calc) |
| `completeness`, `fx` | copied from dataset |
| `week` | `{ start, end }` — `start = previous_snapshot_date + 1` (or `reference − 6` without snapshot), `end = reference` |
| `fx_effect_reporting` | see §5.10; `null` without previous snapshot |
| `unknown_due_reporting` | Σ `outstanding_reporting` of open invoices with `aging_bucket = 'UNKNOWN'` (missing `due_date`). Counted in Total Outstanding, in no bucket; Aging screen shows it so that Σ buckets + unknown = total |

---

## 4. Date rules (`src/core/dates.ts`)

| Function | Rule |
| --- | --- |
| `daysBetween(from, to)` | whole days `to − from` (UTC midnight) |
| `latestSaturday(d)` | most recent Saturday on or before `d` (report cadence) |
| `reportWeek(ref, prevDate)` | `{ start: prevDate + 1 (or ref − 6), end: ref }` inclusive |
| `localTimeToUTC`, `tzOffsetMinutes`, `formatInTimeZone` | IANA-timezone helpers (default `Asia/Ho_Chi_Minh`); pipeline computes "today" in `REPORT_TIMEZONE` before choosing the Saturday |

---

## 5. Calculation formulas (`src/core/calc.ts`)

Notation: `ref` = reference date; `fx` = dataset FX table; `conv(x, ccy)` = `convert()` (§6); sums use `round2`.

### 5.1 Outstanding per invoice

```
closed      = invoice_status ∈ {CANCELLED, WRITTEN_OFF} or cancellation_status = CANCELLED
outstanding = closed ? 0 : round2(original_amount − paid_amount − credit_note_amount)
if outstanding < 0:  unapplied_cash += conv(−outstanding);  outstanding = 0     # overpayment
if !closed:          credit_notes_applied += conv(credit_note_amount)
```

### 5.2 Total Outstanding, Overdue, Not Yet Due

```
open   = invoices with outstanding > 0
Total  = Σ open.outstanding_reporting
Overdue = Σ open[is_overdue].outstanding_reporting        where is_overdue = aging_days > 0
Not Yet Due = Total − Overdue
30+ = Σ overdue[aging_days > 30];  90+ = Σ overdue[aging_days > 90]
Disputed = Σ open.disputed_reporting  (each capped at the invoice's outstanding)
Due Within 7 Days = Σ open[!is_overdue && 0 ≤ daysBetween(ref, due_date) ≤ 7]
invoice_count = |open|;  customer_count = |customers with total > 0|
```

### 5.3 Aging Days and Aging Buckets (`aging.ts`)

```
aging_days = daysBetween(due_date, ref)      # ref − due; null if due_date null
bucket:  null → UNKNOWN | ≤0 → CURRENT | ≤7 → D1_7 | ≤14 → D8_14 | ≤30 → D15_30
         | ≤60 → D31_60 | ≤90 → D61_90 | else D90_PLUS
bucket_totals[b] = Σ open[bucket = b].outstanding_reporting   (UNKNOWN excluded)
```

### 5.4 Collected This Week

```
Collected = Σ conv(applied_amount) of payments with reconciliation_status ≠ REFUNDED
            and week.start ≤ payment_date ≤ week.end
```
Unapplied cash is excluded by construction (only `applied_amount` is summed).

### 5.5 New Overdue / Resolved Overdue (week flows)

With a previous snapshot (`prev.invoice_state`):
```
New Overdue      = Σ outstanding_reporting of invoices overdue now whose previous state was absent or not overdue
Resolved Overdue = Σ over prev overdue invoices of max(0, prev.outstanding_reporting − remaining)
                   where remaining = current outstanding_reporting if still overdue, else 0
```
Without a previous snapshot: `New Overdue` ≈ Σ overdue invoices whose `due_date` falls inside the report week; `Resolved Overdue = 0`.

### 5.6 Promise Broken (`evaluatePromises`)

For each **uncompleted** activity with `promised_payment_date`:
```
promised = conv(promised_payment_amount, promised_currency ?? contract_currency) (0 if amount null)
if promised_payment_date < ref:
    received = Σ conv(applied_amount) of non-refunded payments with activity_date ≤ payment_date ≤ ref
    if received + 0.01 < promised:  broken += promised − received
else: candidate for next_promise_date (earliest) / next_promise_amount
broken_promise_amount (portfolio) = Σ customers.broken_promise_amount_reporting
broken_promise_count = |customers with promise_broken|
```

### 5.7 Credit Utilization

```
credit_limit_reporting = conv(credit_limit, contract_currency)
credit_utilization     = total_outstanding_reporting / credit_limit_reporting   (null if no/zero limit)
credit_limit_exceeded  = utilization > 1
```

### 5.8 WoW change and %

```
change     = round2(cur − prev)
change_pct = prev ≠ 0 ? round4(change / |prev|) : (cur ≠ 0 ? null : 0)
```
`previous` values come from `prev.totals` (KPIs), `prev.customers` (customer WoW), `prev.owners/countries/currencies` (dimension `previous_overdue`), `prev.bucket_totals` (`aging_by_bucket.previous`).

### 5.9 At-Risk Amount

```
atRiskCustomers = customers with promise_broken or credit_limit_exceeded
At-Risk = Σ open invoices where (is_overdue && aging_days > 30) or disputed_reporting > 0
          or customer_id ∈ atRiskCustomers          # union, no double counting
```

### 5.10 FX effect

```
prevRate(ccy) = prev.fx.rates[ccy].rate_to_reporting   (prev reporting currency → 1)
for each prev.invoice_state s with a current open invoice i having exchange_rate ≠ null:
    base      = min(s.outstanding_original, i.outstanding_amount)      # balance that existed both weeks
    fx_effect += base × (i.exchange_rate − prevRate(s.invoice_currency))
fx_effect_reporting = round2(fx_effect)   (null without previous snapshot)
```
The remainder of `Total change − fx_effect` is real balance movement (new invoices, payments, credit notes).

### 5.11 Unapplied cash, credit notes, cancellations, disputes, overpayments

| Item | Rule |
| --- | --- |
| **Unapplied cash** | Σ conv(negative outstanding of overpaid invoices) + Σ conv(`unapplied_amount` > 0 of non-refunded payments) → `totals.unapplied_cash`; never reduces receivables of other invoices |
| **Credit notes** | reduce outstanding (§5.1); Σ conv(`credit_note_amount`) of non-closed invoices → `totals.credit_notes_applied` |
| **Cancellations** | `cancellation_status = CANCELLED` or status `CANCELLED`/`WRITTEN_OFF` → outstanding 0, excluded from totals, buckets, actions; a refunded payment (`REFUNDED`) is ignored everywhere |
| **Disputes** | `disputed = min(disputed_amount, outstanding)`; included in Total and Overdue (a dispute does not remove the receivable), counted in `totals.disputed`, At-Risk and risk factor 8; `DISPUTE` action when status `OPEN`/`UNDER_REVIEW` |
| **Overpayments** | negative recomputed outstanding → 0 + unapplied cash (`OVERPAYMENT` warning) |
| **Missing FX rate** | open invoice contributes 0 to reporting totals, `MISSING_FX_RATE` warning; original amount still visible |

---

## 6. Multi-currency rules (`src/core/money.ts`)

| Rule | Implementation |
| --- | --- |
| Original preserved | `Invoice.original_amount/paid_amount/credit_note_amount/outstanding_amount` stay in `invoice_currency`; the engine adds `*_reporting` fields — it never overwrites originals |
| Conversion | `convert(amount, ccy, fx)` → `round2(amount × rate_to_reporting)`; identity rate `1` (`source: 'identity'`, `rate_date = fx.as_of`) when `ccy = reporting_currency`; `null` when no rate or rate ≤ 0 |
| Rate date shown | `exchange_rate_date` on every `CalculatedInvoice` = `FxRate.rate_date` |
| Snapshots keep their own FX | `Snapshot.fx` stores the full table; WoW comparisons of reporting amounts are therefore "as reported that week", and §5.10 isolates the FX component |
| FX effect separated | `TrackerModel.fx_effect_reporting`; surfaced in insight (`fx_effect_reporting`) and rule-based summary |
| Zero-decimal display | `JPY KRW VND IDR TWD` formatted without decimals; others 2 dp |
| Compact display | ≥ 1 000 000 → `x.xxM`; ≥ 10 000 → `x.xK` |
| Live-mode FX | Ellis `fxRate` (local → KRW) is not used; reporting is `USD` by default, so a **Required** rates feed replaces the illustrative table |

---

## 7. `datasetAsOf()` — historical reconstruction (`src/core/history.ts`)

Used by the mock adapter to build a consistent 12-week snapshot chain (`buildSnapshotHistory`) and intended for the live pipeline to re-create a Saturday snapshot from dated transactions when the source has no history.

| Rule | Detail |
| --- | --- |
| Payments | keep `payment_date ≤ date` |
| Activities | keep `activity_date ≤ date`; `completed` becomes `completed && (next_action_date ?? activity_date) ≤ date` |
| Invoices | keep `invoice_date ≤ date`; recompute `paid_amount` = Σ `applied_amount` of remaining non-refunded payments linked to the invoice; `outstanding = max(0, original − paid − credit_note)`; `last_payment_date/amount` from the latest remaining payment |
| Status recompute | unless `CANCELLED`/`WRITTEN_OFF`/`CREDITED`: outstanding ≤ 0 → `PAID`; paid > 0 → `DISPUTED` (if dispute `OPEN`/`UNDER_REVIEW`) else `PARTIALLY_PAID`; else `DISPUTED` or `OPEN` |
| Timestamps | `as_of = <date>T02:00:00.000Z` (unless supplied); `fx = { …fxFor(date), as_of: date }` |

**Limitations (documented in code and confirmed by reading it):**
- **Credit notes and cancellations are not dated** in the source model → kept as-is for every historical date (a credit note issued this week appears in last week's snapshot too).
- Dispute status is likewise undated → historical `DISPUTED` status reflects today's dispute state.
- Unapplied payments are kept by date but an invoice's `paid_amount` counts only **linked** payments (`invoice_id ≠ null`).
- `buildSnapshotHistory` chains snapshots oldest → newest, each using the previous as `previousSnapshot`, and validates each derived dataset (`validateDataset`) before calculation.

---

## 8. Validation gate (`src/core/validate.ts`)

`validateDataset(ds)` runs the Zod `DatasetSchema` (ISO dates, 3-letter currency codes, enums, `as_of` datetime with offset) then semantic checks (§2.7). `ok = false` when any `error` exists → the pipeline **fails the run** and sends the "Data refresh failed" message; warnings/info are merged into `TrackerModel.data_quality` and shown in UI/report.
