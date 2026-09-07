import type { ISODate, TrackerModel } from '@core/types';

/**
 * Structured input handed to the AI. It contains ONLY computed figures from the tracker model.
 * The AI must interpret these numbers; it must never produce new ones.
 */
export interface InsightInput {
  report_date: ISODate;
  previous_snapshot_date: ISODate | null;
  reporting_currency: string;
  is_mock: boolean;
  kpis: { key: string; label: string; value: number; previous: number | null; change: number | null; change_pct: number | null; unit: string }[];
  fx_effect_reporting: number | null;
  top_overdue_customers: CustomerFact[];
  new_overdue_customers: CustomerFact[]; // customers whose overdue increased
  improved_customers: CustomerFact[]; // customers whose overdue decreased
  broken_promises: CustomerFact[];
  credit_limit_exceeded: CustomerFact[];
  disputes: CustomerFact[];
  collection_opportunities: CustomerFact[]; // short overdue, good history, promise upcoming
  by_owner: { owner: string; total: number; overdue: number; previous_overdue: number | null; customers_overdue: number; broken_promises: number }[];
  by_country: { country: string; total: number; overdue: number; previous_overdue: number | null }[];
  due_next_week: { customer: string; owner: string; amount: number; due_date: ISODate }[];
  due_next_week_total: number;
  promised_next_week_total: number;
  recent_activity_count: number;
  data_quality: { code: string; count: number; sample: string }[];
  completeness: TrackerModel['completeness'];
}

export interface CustomerFact {
  customer: string;
  country: string;
  owner: string;
  total: number;
  overdue: number;
  overdue_30_plus: number;
  max_aging_days: number;
  wow_overdue_change: number | null;
  risk_score: number;
  risk_grade: string;
  risk_reasons: string[]; // top factor evidences
  promise_date: ISODate | null;
  broken_promise_amount: number;
  credit_utilization: number | null;
  disputed: number;
  last_payment_date: ISODate | null;
  recommended_action: string;
}

/** Output contract required by the product spec (section 8). */
export interface InsightOutput {
  executive_summary: string[];
  major_changes: string[];
  top_risks: { customer: string; owner: string; amount: number; reason: string; action: string; due: string }[];
  collection_opportunities: { customer: string; owner: string; amount: number; why: string }[];
  owner_actions: { owner: string; customer: string; amount: number; action: string; deadline: string }[];
  ceo_decisions: { topic: string; customer: string | null; amount: number | null; recommendation: string; rationale: string }[];
  forecast_next_week: { expected_collection: number; currency: string; confidence: 'low' | 'medium' | 'high'; basis: string[] };
  data_quality_warnings: string[];
}

export interface InsightResult {
  output: InsightOutput;
  provider: string;
  model: string | null;
  generated_at: string;
  verification: VerificationReport;
  fallback_used: boolean;
  error?: string;
}

export interface VerificationReport {
  ok: boolean;
  checked_numbers: number;
  unverified_numbers: { value: number; where: string }[];
  unknown_customers: { name: string; where: string }[];
  unknown_owners: { name: string; where: string }[];
  notes: string[];
}

export interface InsightProvider {
  readonly name: string;
  generate(input: InsightInput): Promise<{ output: InsightOutput; model: string | null }>;
}
