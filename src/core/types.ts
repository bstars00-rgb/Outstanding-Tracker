/**
 * Core domain types for the Outstanding Receivables Tracker.
 * These types are the contract shared by the frontend, the automation pipeline,
 * the adapters (Ellis MCP / Teams / AI) and the tests.
 *
 * Money convention: every amount is stored in its ORIGINAL currency, and the
 * calculation engine adds a *_reporting field converted with an explicit FX rate.
 */

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // ISO 8601 with offset, e.g. 2026-09-05T02:00:00Z
export type CurrencyCode = string; // ISO 4217

export type AgingBucket = 'CURRENT' | 'D1_7' | 'D8_14' | 'D15_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';
export const AGING_BUCKETS: AgingBucket[] = ['CURRENT', 'D1_7', 'D8_14', 'D15_30', 'D31_60', 'D61_90', 'D90_PLUS'];
export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = {
  CURRENT: 'Current (not yet due)',
  D1_7: '1-7 days',
  D8_14: '8-14 days',
  D15_30: '15-30 days',
  D31_60: '31-60 days',
  D61_90: '61-90 days',
  D90_PLUS: '90+ days',
};

export type RiskGrade = 'Low' | 'Watch' | 'Medium' | 'High' | 'Critical';
export type CreditStatus = 'ACTIVE' | 'ON_HOLD' | 'SUSPENDED';
export type CustomerStatus = 'ACTIVE' | 'INACTIVE' | 'CHURNED';
export type CollectionStatus = 'NORMAL' | 'REMINDER' | 'ESCALATED' | 'LEGAL';
export type InvoiceStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'DISPUTED' | 'CANCELLED' | 'CREDITED' | 'WRITTEN_OFF';
export type DisputeStatus = 'NONE' | 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED';
export type CancellationStatus = 'NONE' | 'REQUESTED' | 'CANCELLED';
export type ReconciliationStatus = 'APPLIED' | 'PARTIALLY_APPLIED' | 'UNAPPLIED' | 'REFUNDED';
export type PaymentMethod = 'BANK_TRANSFER' | 'CARD' | 'VCC' | 'OFFSET' | 'OTHER';
export type ActivityType = 'CALL' | 'EMAIL' | 'MEETING' | 'REMINDER' | 'PROMISE' | 'DISPUTE' | 'ESCALATION' | 'NOTE';
export type ContactChannel = 'EMAIL' | 'PHONE' | 'TEAMS' | 'WHATSAPP' | 'KAKAO' | 'LINE' | 'ZALO' | 'IN_PERSON';

export interface Customer {
  customer_id: string;
  customer_name: string;
  customer_group: string | null;
  country: string;
  region: string; // market / region
  account_owner_id: string;
  account_owner_name: string;
  finance_owner: string | null;
  contract_currency: CurrencyCode;
  payment_terms_days: number | null;
  credit_limit: number | null; // in contract_currency
  credit_status: CreditStatus;
  customer_status: CustomerStatus;
  collection_status: CollectionStatus;
  risk_grade_manual: RiskGrade | null; // finance override from master data, distinct from calculated grade
  preferred_contact_channel: ContactChannel | null;
  data_source: string;
}

export interface Invoice {
  invoice_id: string;
  invoice_number: string;
  booking_id: string | null;
  customer_id: string;
  invoice_date: ISODate;
  service_date: ISODate | null; // checkout date
  due_date: ISODate | null; // null => data quality issue
  original_amount: number;
  paid_amount: number;
  credit_note_amount: number;
  disputed_amount: number;
  outstanding_amount: number; // original - paid - credit_note (>= 0)
  invoice_currency: CurrencyCode;
  invoice_status: InvoiceStatus;
  dispute_status: DisputeStatus;
  dispute_reason: string | null;
  cancellation_status: CancellationStatus;
  last_payment_date: ISODate | null;
  last_payment_amount: number | null;
  data_source: string;
}

export interface Payment {
  payment_id: string;
  invoice_id: string | null; // null => unapplied cash
  customer_id: string;
  payment_date: ISODate;
  payment_amount: number;
  payment_currency: CurrencyCode;
  applied_amount: number;
  unapplied_amount: number;
  payment_method: PaymentMethod;
  payment_reference: string | null;
  reconciliation_status: ReconciliationStatus;
  data_source: string;
}

export interface CollectionActivity {
  activity_id: string;
  customer_id: string;
  invoice_id: string | null;
  owner: string;
  activity_type: ActivityType;
  activity_date: ISODate;
  contact_channel: ContactChannel | null;
  note: string;
  promised_payment_date: ISODate | null;
  promised_payment_amount: number | null;
  promised_currency: CurrencyCode | null;
  next_action: string | null;
  next_action_date: ISODate | null;
  escalation_level: 0 | 1 | 2 | 3;
  completed: boolean;
}

export interface BookingContext {
  booking_id: string;
  check_in: ISODate;
  check_out: ISODate;
  hotel_name: string;
  destination: string;
  booking_amount: number;
  booking_currency: CurrencyCode;
  booking_status: string;
  cancellation_penalty: number | null;
  supplier_payment_status: string | null;
  net_revenue: number | null;
}

/** rate_to_reporting = reporting-currency units per 1 unit of `currency` (e.g. KRW->USD = 0.00072). */
export interface FxRate {
  currency: CurrencyCode;
  rate_to_reporting: number;
  rate_date: ISODate;
  source: string;
}
export interface FxTable {
  reporting_currency: CurrencyCode;
  as_of: ISODate;
  rates: FxRate[];
}

export interface DataQualityIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  entity: 'customer' | 'invoice' | 'payment' | 'activity' | 'fx' | 'dataset';
  entity_id: string | null;
  message: string;
}

export type DataSourceKind = 'mock' | 'ellis-mcp' | 'ellis-bookings-derived' | 'file';

export interface DatasetCompleteness {
  customers: 'full' | 'partial' | 'missing';
  invoices: 'full' | 'partial' | 'missing';
  payments: 'full' | 'partial' | 'missing';
  activities: 'full' | 'partial' | 'missing';
  fx: 'full' | 'partial' | 'missing';
  notes: string[];
}

/** Raw dataset as returned by an adapter, before calculation. */
export interface ReceivablesDataset {
  as_of: ISODateTime; // data reference timestamp
  source: DataSourceKind;
  reporting_currency: CurrencyCode;
  fx: FxTable;
  customers: Customer[];
  invoices: Invoice[];
  payments: Payment[];
  activities: CollectionActivity[];
  bookings: BookingContext[];
  completeness: DatasetCompleteness;
}

// ---------- Calculated model ----------

export interface CalculatedInvoice extends Invoice {
  aging_days: number | null; // reference_date - due_date (negative = not due yet), null when due_date missing
  aging_bucket: AgingBucket | 'UNKNOWN';
  is_overdue: boolean;
  outstanding_reporting: number;
  disputed_reporting: number;
  exchange_rate: number | null;
  exchange_rate_date: ISODate | null;
  customer_name: string;
  account_owner_name: string;
  country: string;
  promised_payment_date: ISODate | null;
  next_action: string | null;
  next_action_date: ISODate | null;
  owner: string;
  payments: Payment[];
  activities: CollectionActivity[];
}

export interface RiskFactor {
  key: string;
  label: string;
  points: number;
  max_points: number;
  evidence: string; // human-readable basis, e.g. "max aging 47 days"
}

export interface RiskScore {
  score: number; // 0-100
  grade: RiskGrade;
  factors: RiskFactor[];
}

export interface CustomerRisk {
  customer_id: string;
  customer_name: string;
  country: string;
  region: string;
  account_owner_id: string;
  account_owner_name: string;
  contract_currency: CurrencyCode;
  total_outstanding_reporting: number;
  overdue_reporting: number;
  not_due_reporting: number;
  overdue_30_plus_reporting: number;
  overdue_90_plus_reporting: number;
  disputed_reporting: number;
  max_aging_days: number;
  invoice_count: number;
  overdue_invoice_count: number;
  credit_limit_reporting: number | null;
  credit_utilization: number | null; // total_outstanding / credit_limit
  credit_limit_exceeded: boolean;
  last_payment_date: ISODate | null;
  last_activity_date: ISODate | null;
  next_promise_date: ISODate | null;
  next_promise_amount_reporting: number | null;
  promise_broken: boolean;
  broken_promise_amount_reporting: number;
  wow_overdue_change_reporting: number | null; // vs previous snapshot
  wow_total_change_reporting: number | null;
  risk: RiskScore;
  recommended_action: string;
  bucket_totals: Record<AgingBucket, number>;
  data_quality: DataQualityIssue[];
  credit_status: CreditStatus;
  collection_status: CollectionStatus;
  /** Open balance in ORIGINAL currencies (a customer may be invoiced in several). */
  totals_by_currency: { currency: CurrencyCode; total: number; overdue: number; invoice_count: number }[];
}

export type KpiKey =
  | 'total_outstanding'
  | 'overdue_outstanding'
  | 'overdue_ratio'
  | 'due_within_7_days'
  | 'collected_this_week'
  | 'new_overdue_this_week'
  | 'overdue_30_plus'
  | 'overdue_90_plus'
  | 'broken_promises'
  | 'at_risk_amount';

export interface KpiValue {
  key: KpiKey;
  label: string;
  value: number;
  unit: 'currency' | 'ratio' | 'count';
  previous: number | null;
  change: number | null;
  change_pct: number | null;
  status: 'good' | 'neutral' | 'warning' | 'critical';
  interpretation: string;
  definition: string;
}

export interface DimensionAging {
  key: string;
  label: string;
  total: number;
  overdue: number;
  buckets: Record<AgingBucket, number>;
  previous_overdue: number | null;
}

export type ActionGroup =
  | 'CONTACT_TODAY'
  | 'DUE_3_DAYS'
  | 'DUE_7_DAYS'
  | 'PROMISE_OVERDUE'
  | 'OVERDUE_30'
  | 'OVERDUE_90'
  | 'DISPUTE'
  | 'CREDIT_LIMIT'
  | 'ESCALATE';

export const ACTION_GROUP_LABEL: Record<ActionGroup, string> = {
  CONTACT_TODAY: 'Contact today',
  DUE_3_DAYS: 'Due within 3 days',
  DUE_7_DAYS: 'Due within 7 days',
  PROMISE_OVERDUE: 'Promise date passed',
  OVERDUE_30: '30+ days overdue',
  OVERDUE_90: '90+ days overdue',
  DISPUTE: 'Dispute to resolve',
  CREDIT_LIMIT: 'Credit limit exceeded',
  ESCALATE: 'Leader escalation',
};

export interface ActionItem {
  id: string;
  group: ActionGroup;
  customer_id: string;
  customer_name: string;
  invoice_id: string | null;
  owner: string;
  due_date: ISODate | null;
  amount_reporting: number;
  recommended_action: string;
  status: 'open' | 'in_progress' | 'done';
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/** Weekly snapshot: the persisted, comparable state of a given reference date. */
export interface Snapshot {
  snapshot_id: string; // e.g. 2026-09-05
  snapshot_date: ISODate;
  as_of: ISODateTime;
  reporting_currency: CurrencyCode;
  fx: FxTable;
  source: DataSourceKind;
  totals: SnapshotTotals;
  bucket_totals: Record<AgingBucket, number>;
  customers: SnapshotCustomerRow[];
  owners: SnapshotDimensionRow[];
  countries: SnapshotDimensionRow[];
  currencies: SnapshotDimensionRow[];
  invoice_state: SnapshotInvoiceState[]; // minimal per-invoice state for new/resolved overdue calc
}

export interface SnapshotTotals {
  total_outstanding: number;
  overdue_outstanding: number;
  not_yet_due: number;
  overdue_30_plus: number;
  overdue_90_plus: number;
  disputed: number;
  unapplied_cash: number;
  credit_notes_applied: number;
  collected_during_week: number;
  new_overdue_during_week: number;
  resolved_overdue_during_week: number;
  due_within_7_days: number;
  broken_promise_amount: number;
  broken_promise_count: number;
  at_risk_amount: number;
  invoice_count: number;
  customer_count: number;
}

export interface SnapshotCustomerRow {
  customer_id: string;
  customer_name: string;
  total_outstanding: number;
  overdue: number;
  overdue_30_plus: number;
  max_aging_days: number;
  risk_score: number;
  risk_grade: RiskGrade;
}
export interface SnapshotDimensionRow {
  key: string;
  label: string;
  total_outstanding: number;
  overdue: number;
}
export interface SnapshotInvoiceState {
  invoice_id: string;
  customer_id: string;
  outstanding_reporting: number;
  outstanding_original: number;
  invoice_currency: CurrencyCode;
  is_overdue: boolean;
}

/** Full calculation result for one reference date. */
export interface TrackerModel {
  as_of: ISODateTime;
  reference_date: ISODate;
  previous_snapshot_date: ISODate | null;
  reporting_currency: CurrencyCode;
  source: DataSourceKind;
  is_mock: boolean;
  kpis: KpiValue[];
  invoices: CalculatedInvoice[];
  customers: CustomerRisk[];
  aging_by_bucket: { bucket: AgingBucket; amount: number; share: number; previous: number | null }[];
  aging_by_country: DimensionAging[];
  aging_by_owner: DimensionAging[];
  aging_by_customer: DimensionAging[];
  aging_by_currency: DimensionAging[];
  actions: ActionItem[];
  snapshot: Snapshot;
  data_quality: DataQualityIssue[];
  completeness: DatasetCompleteness;
  fx: FxTable;
  week: { start: ISODate; end: ISODate };
  fx_effect_reporting: number | null; // portion of WoW total change attributable to FX rate movement
  /** Open balance whose due date is missing: included in Total Outstanding, excluded from every aging bucket. */
  unknown_due_reporting: number;
  /** Language of the engine-generated wording in this model ('en' | 'ko'). */
  lang: 'en' | 'ko';
}
