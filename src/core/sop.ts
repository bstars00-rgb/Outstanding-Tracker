import { addMonths } from './dates';
import type { ISODate, SopAssessment, SopLevel, SopRoute } from './types';

/**
 * OMH Outstanding Handling SOP (v2026.04) — urgency levels, approval routing and Tier collection periods,
 * as captured on the "information" sheet of the OP outstanding workbook:
 *
 *   Tier 1: invoice + 6 months · Tier 2: + 4 months · Tier 3: + 3 months   (collection period)
 *   L1 (Urgent)   Tier 1 and ≥ ¥1M      → OP → Director → Finance → CEO within 24 hours
 *   L2 (Critical) Tier 1–2 and ≤ ¥500K  → within 3 business days
 *   L3 (General)  Tier 2–3 and ≤ ¥500K  → weekly outstanding meeting
 *   L4 (Monitor)  small regular-payment items (< ¥100K) → monthly review
 *   ≤ ¥500K → Local Director finalizes · > ¥500K → CEO approval
 *
 * The SOP text leaves two bands undefined (Tier 1 between ¥500K and ¥1M; Tier 2 above ¥500K). This module
 * treats both as L2 (the next level down from L1) and records the rule applied in `rule` so the reader can see
 * the assumption. Thresholds are expressed in JPY; the engine converts reporting-currency amounts to JPY first.
 */
export interface SopConfig {
  l1_min_jpy: number;
  ceo_approval_over_jpy: number;
  l4_below_jpy: number;
  tier_months: Record<1 | 2 | 3, number>;
}

export const DEFAULT_SOP_CONFIG: SopConfig = {
  l1_min_jpy: 1_000_000,
  ceo_approval_over_jpy: 500_000,
  l4_below_jpy: 100_000,
  tier_months: { 1: 6, 2: 4, 3: 3 },
};

export const SOP_LEVELS: SopLevel[] = ['L1', 'L2', 'L3', 'L4'];

export interface SopInput {
  tier: 1 | 2 | 3 | null;
  /** Open balance converted to JPY (null when no JPY rate is available). */
  amount_jpy: number | null;
  is_overdue: boolean;
  due_date: ISODate | null;
  referenceDate: ISODate;
}

export function assessSop(x: SopInput, cfg: SopConfig = DEFAULT_SOP_CONFIG): SopAssessment {
  const tierDeadline = x.tier && x.due_date ? addMonths(x.due_date, cfg.tier_months[x.tier]) : null;
  const pastDeadline = tierDeadline !== null && x.is_overdue && tierDeadline < x.referenceDate;
  const base = { tier: x.tier, amount_jpy: x.amount_jpy, tier_deadline: tierDeadline, past_tier_deadline: pastDeadline };
  if (!x.is_overdue || x.amount_jpy === null || x.amount_jpy <= 0) {
    return { ...base, level: null, route: null, rule: x.amount_jpy === null ? 'no JPY rate' : 'not overdue' };
  }
  const amt = x.amount_jpy;
  const route: SopRoute = amt > cfg.ceo_approval_over_jpy ? 'CEO' : 'LOCAL_DIRECTOR';
  let level: SopLevel;
  let rule: string;
  if (x.tier === 1 && amt >= cfg.l1_min_jpy) {
    level = 'L1';
    rule = 'Tier 1 and >= ¥1M';
  } else if (amt < cfg.l4_below_jpy) {
    level = 'L4';
    rule = '< ¥100K (monthly review)';
  } else if (x.tier === 1) {
    level = 'L2';
    rule = amt > cfg.ceo_approval_over_jpy ? 'Tier 1 ¥500K–¥1M (assumed L2; band not defined in SOP)' : 'Tier 1 <= ¥500K';
  } else if (x.tier === 2 && amt > cfg.ceo_approval_over_jpy) {
    level = 'L2';
    rule = 'Tier 2 > ¥500K (assumed L2; band not defined in SOP)';
  } else if (x.tier === 2) {
    level = 'L3';
    rule = 'Tier 2 <= ¥500K';
  } else if (x.tier === 3) {
    level = 'L3';
    rule = 'Tier 3';
  } else {
    level = 'L3';
    rule = 'untiered (treated as Tier 3)';
  }
  return { ...base, level, route, rule };
}
