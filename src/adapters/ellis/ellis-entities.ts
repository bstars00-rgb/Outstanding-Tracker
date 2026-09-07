/**
 * ELLIS settlement entities as documented in the ELLIS Playbook (https://ellis-playbook.ohmyhotel.com, read 2026-09-07)
 * and the mapping of each entity onto the tracker schema.
 *
 * Field names follow the Playbook's grid "Field" column (camelCase) where the Playbook shows one, otherwise the
 * on-screen column label is turned into camelCase and flagged with `// label` (exact API name still to be confirmed).
 * These are UI-confirmed structures; the MCP tools that expose them are NOT confirmed yet (see ELLIS_MCP_MAPPING.md).
 */
import { round2 } from '@core/money';
import type { CreditStatus, Customer, FxTable, Invoice, ISODate, Payment, PaymentMethod } from '@core/types';

// ---------- Settlement > Seller Invoice (money IN from sellers/customers) ----------

/** I.Status on the Seller Invoice list. Playbook: Unpaid | Paid | Over Paid. */
export type EllisInvoicePaymentStatus = 'Unpaid' | 'Paid' | 'Over Paid';

export interface EllisSellerInvoice {
  invoiceSeq: number; // "Invoice No." — numeric sequence also used by Payment In/Out mapping (invoiceSeq) and FX report
  paymentStatus: EllisInvoicePaymentStatus; // label "I.Status"
  controlCompName: string | null; // label "Control" — company managing this seller
  sellerCompCode: string; // "Seller Code" (FX report field name sellerCompCode)
  sellerCompName: string; // "Seller Name"
  sellerOperationName: string | null; // label "Seller Name - Operation"
  billingCurrencyCode: string; // "B.Cur"
  billingSumAmount: number; // "B.Sum Amt" — total invoice amount in billing currency
  paidSumAmount: number; // "Paid Amt"
  balanceAmount: number; // "Balance" = billingSumAmount - paidSumAmount (negative = over paid)
  issuedDate: ISODate; // "Issued Date"
  dueDate: ISODate | null; // "Due Date" — payment deadline set at creation
  remark: string | null;
  firstInsertDatetime?: string;
  lastUpdateDatetime?: string;
  /** Booking lines shown in the bottom panel of the Seller Invoice page. */
  bookings?: EllisInvoiceBookingLine[];
}

export interface EllisInvoiceBookingLine {
  bookingItemCode: string;
  bookingStatusName: string; // Pending | Confirmed | Cancelled | Unavailable | Cancel Request
  clientPaymentStatusName: string; // "C.Payment Status": Not Paid | Partially Paid | Fully Paid | Refunded | Partially Refunded
  sellerBookingCode: string | null;
  hotelCountryName: string;
  hotelName: string;
  checkInDate: ISODate;
  checkOutDate: ISODate;
  nights: number;
  billingCurrencyCode: string;
  billingSumAmount: number;
  paidSumAmount: number;
  balanceAmount: number; // "B.Balance"
  revenue: number | null;
  disputeYn: 'Y' | 'N';
  disputeRemark: string | null;
}

// ---------- Settlement > Payment > Payment In/Out ----------

export interface EllisPayment {
  paymentSeq: number; // PM SEQ
  salesOrVendor: 'S' | 'V';
  stationTypeName?: string;
  itemCategoryName?: string;
  paymentDetailTypeName?: string; // Charge | Fee | Markup | Cancel Fee | ...
  bookingItemCode: string | null;
  depositWithdrawTypeCode: 'Deposit' | 'Withdraw' | string; // A/C
  paidDate: ISODate; // "Date"
  currencyCode: string;
  firstDepositAmount: number; // original amount before adjustments
  depositAmount: number; // current amount
  depositTypeName: string; // Card | Bank Transfer | Virtual Credit Card | Cash
  depositDetailTypeName?: string | null; // bank / card name
  traderCompCode?: string | null; // filter "Traders" exists; grid shows traderCompName — code to be confirmed
  traderCompName: string | null;
  invoiceSeq: number | null; // mapped invoice (Sales) or billing (Vendor)
  sellerDisputeYn: 'Y' | 'N';
  sellerDisputeRemark?: string | null;
  paymentConfirmDate: ISODate | null; // PM CNFM Date
  paymentRemark?: string | null;
  cardApprovalNo?: string | null;
  pgTransactionId?: string | null;
}

// ---------- Users > Customer > Traders ----------

export type EllisTraderStatus = 'Active' | 'Inactive' | 'Pending' | 'Suspended';

export interface EllisTrader {
  companyCode: string; // "Company Code" — unique company ID (= sellerCompCode / traderCompCode elsewhere)
  companyName: string;
  country: string; // company's country (Basic tab, required)
  status: EllisTraderStatus;
  businessNo?: string | null;
  seller: {
    isSeller: boolean; // Seller tab "Seller = Yes"
    sellerType: 'API Seller' | 'Regular Seller' | null;
    creditLimit: number | null; // "Maximum unpaid balance allowed" (currency: seller currency)
    paymentTerms: string | number | null; // "When payment is due" — format to be confirmed (days vs rule text)
    currency: string | null; // "Default transaction currency"
    commission?: number | null;
  } | null;
  pic?: { name: string; position?: string | null; department?: string | null }[]; // contact persons (no email/phone kept)
}

// ---------- System Control > Common > Exchange Rate ----------

export interface EllisAppliedRate {
  originCurrencyCode: string;
  targetCurrencyCode: string;
  appliedRate: number; // 1 origin = appliedRate target
  announcedDatetime?: string; // from the announced-rate row the applied rates belong to
}

// ---------- mapping helpers ----------

const sellerId = (code: string) => `seller:${code.trim()}`;

export function mapInvoiceStatus(inv: EllisSellerInvoice): Invoice['invoice_status'] {
  if (inv.paymentStatus === 'Paid' || inv.paymentStatus === 'Over Paid') return 'PAID';
  if (inv.paidSumAmount > 0) return 'PARTIALLY_PAID';
  return 'OPEN';
}

/** Seller invoices → tracker invoices. Over-payments become unapplied cash inside the engine. */
export function sellerInvoicesToInvoices(rows: EllisSellerInvoice[]): Invoice[] {
  return rows.map((r) => {
    const disputedLines = (r.bookings ?? []).filter((b) => b.disputeYn === 'Y');
    const disputed = round2(disputedLines.reduce((s, b) => s + Math.max(0, b.balanceAmount), 0));
    const outstanding = Math.max(0, round2(r.billingSumAmount - r.paidSumAmount));
    return {
      invoice_id: `inv:${r.invoiceSeq}`,
      invoice_number: String(r.invoiceSeq),
      booking_id: r.bookings?.length === 1 ? r.bookings[0].bookingItemCode : null,
      customer_id: sellerId(r.sellerCompCode),
      invoice_date: r.issuedDate,
      service_date: r.bookings?.length ? r.bookings.map((b) => b.checkOutDate).sort().slice(-1)[0] : null,
      due_date: r.dueDate,
      original_amount: r.billingSumAmount,
      paid_amount: r.paidSumAmount,
      credit_note_amount: 0, // ELLIS "Compensation" adjustments change billingSumAmount directly (A/D), no separate credit-note entity
      disputed_amount: disputed,
      outstanding_amount: outstanding,
      invoice_currency: r.billingCurrencyCode,
      invoice_status: disputed > 0 && outstanding > 0 ? 'DISPUTED' : mapInvoiceStatus(r),
      dispute_status: disputed > 0 ? 'OPEN' : 'NONE',
      dispute_reason: disputedLines.map((b) => b.disputeRemark).filter(Boolean).join('; ') || null,
      cancellation_status: 'NONE',
      last_payment_date: null, // derived from payments (Payment In/Out) by the engine
      last_payment_amount: null,
      data_source: 'ellis:seller-invoice',
    };
  });
}

// NOTE: over-paid invoices (negative balance) need no extra mapping: the engine recomputes
// outstanding = billingSumAmount - paidSumAmount and books the negative part as unapplied cash.

export function mapPaymentMethod(depositTypeName: string | null | undefined): PaymentMethod {
  const t = (depositTypeName ?? '').toLowerCase();
  if (t.includes('card') && t.includes('virtual')) return 'VCC';
  if (t === 'vcc' || t.includes('vcc')) return 'VCC';
  if (t.includes('card')) return 'CARD';
  if (t.includes('bank') || t.includes('transfer') || t.includes('wire')) return 'BANK_TRANSFER';
  return 'OTHER';
}

/**
 * Payment In/Out rows → tracker payments. Only Sales-side (S) rows are receivable-relevant.
 * Deposit + mapped invoice => applied; Deposit without invoice => unapplied cash; Withdraw (refund) => REFUNDED.
 * Rows without a trader code cannot be attributed to a customer and are dropped (reported by the caller).
 */
export function ellisPaymentsToPayments(rows: EllisPayment[], resolveTraderCode?: (row: EllisPayment) => string | null): { payments: Payment[]; dropped: EllisPayment[] } {
  const payments: Payment[] = [];
  const dropped: EllisPayment[] = [];
  for (const r of rows) {
    if (r.salesOrVendor !== 'S') continue;
    const code = r.traderCompCode ?? resolveTraderCode?.(r) ?? null;
    if (!code) {
      dropped.push(r);
      continue;
    }
    const isWithdraw = /withdraw/i.test(r.depositWithdrawTypeCode);
    const amount = round2(r.depositAmount);
    payments.push({
      payment_id: `pm:${r.paymentSeq}`,
      invoice_id: r.invoiceSeq !== null ? `inv:${r.invoiceSeq}` : null,
      customer_id: sellerId(code),
      payment_date: r.paidDate,
      payment_amount: isWithdraw ? -amount : amount,
      payment_currency: r.currencyCode,
      applied_amount: !isWithdraw && r.invoiceSeq !== null ? amount : 0,
      unapplied_amount: !isWithdraw && r.invoiceSeq === null ? amount : 0,
      payment_method: mapPaymentMethod(r.depositTypeName),
      payment_reference: r.cardApprovalNo ?? r.pgTransactionId ?? null,
      reconciliation_status: isWithdraw ? 'REFUNDED' : r.invoiceSeq !== null ? 'APPLIED' : 'UNAPPLIED',
      data_source: 'ellis:payment-in-out',
    });
  }
  return { payments, dropped };
}

export function mapCreditStatus(status: EllisTraderStatus): CreditStatus {
  if (status === 'Suspended') return 'SUSPENDED';
  if (status === 'Inactive' || status === 'Pending') return 'ON_HOLD';
  return 'ACTIVE';
}

/** "Payment Terms" may arrive as a number of days or as text such as "NET 30" / "30 days" / "Prepaid". */
export function parsePaymentTermsDays(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (/prepaid|advance|선불/i.test(v)) return 0;
  const m = v.match(/(\d{1,3})/);
  return m ? Number(m[1]) : null;
}

/** Traders (Seller = Yes) → tracker customers. Account owner is NOT in the trader master (Required item). */
export function tradersToCustomers(rows: EllisTrader[]): Customer[] {
  return rows
    .filter((t) => t.seller?.isSeller)
    .map((t) => ({
      customer_id: sellerId(t.companyCode),
      customer_name: t.companyName,
      customer_group: null,
      country: t.country,
      region: '',
      account_owner_id: '',
      account_owner_name: '',
      finance_owner: null,
      contract_currency: t.seller?.currency ?? 'USD',
      payment_terms_days: parsePaymentTermsDays(t.seller?.paymentTerms),
      credit_limit: t.seller?.creditLimit ?? null,
      credit_status: mapCreditStatus(t.status),
      customer_status: t.status === 'Active' ? 'ACTIVE' : 'INACTIVE',
      collection_status: 'NORMAL',
      risk_grade_manual: null,
      preferred_contact_channel: null,
      data_source: 'ellis:traders',
    }));
}

/** Applied exchange rates (origin → target) → tracker FX table for the reporting currency. */
export function appliedRatesToFxTable(rates: EllisAppliedRate[], reporting: string, asOf: ISODate): FxTable {
  return {
    reporting_currency: reporting,
    as_of: asOf,
    rates: rates
      .filter((r) => r.targetCurrencyCode === reporting && r.originCurrencyCode !== reporting && r.appliedRate > 0)
      .map((r) => ({ currency: r.originCurrencyCode, rate_to_reporting: r.appliedRate, rate_date: (r.announcedDatetime ?? asOf).slice(0, 10), source: 'ELLIS applied exchange rate' })),
  };
}
