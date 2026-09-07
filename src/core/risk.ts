import type { RiskFactor, RiskGrade, RiskScore } from './types';

/**
 * Customer Risk Score (0-100, higher = riskier). Deterministic and explainable:
 * every factor returns the points awarded, its cap, and the evidence used.
 * Weights follow the product requirement (25/20/15/10/10/10/5/5 = 100).
 */
export interface RiskInput {
  overdue_reporting: number;
  total_outstanding_reporting: number;
  overdue_30_plus_reporting: number;
  max_aging_days: number;
  previous_overdue_reporting: number | null; // null => no prior snapshot
  broken_promise_amount_reporting: number;
  credit_utilization: number | null; // null => no credit limit on file
  days_since_last_activity: number | null; // null => no activity ever
  disputed_reporting: number;
  reporting_currency: string;
  /** Finance-set credit status; ON_HOLD/SUSPENDED signals a known problem even below the limit. */
  credit_status?: 'ACTIVE' | 'ON_HOLD' | 'SUSPENDED';
}

export interface RiskConfig {
  /** Overdue amount thresholds in reporting currency, ascending. */
  amount_thresholds: [number, number, number, number];
  /** Overdue below this amount is treated as immaterial for aging points (e.g. rounding residue). */
  materiality_amount: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  amount_thresholds: [2_000, 10_000, 25_000, 75_000],
  materiality_amount: 100,
};

export function gradeFor(score: number): RiskGrade {
  if (score >= 85) return 'Critical';
  if (score >= 70) return 'High';
  if (score >= 50) return 'Medium';
  if (score >= 30) return 'Watch';
  return 'Low';
}

const fmt = (n: number, ccy: string) => `${ccy} ${Math.round(n).toLocaleString('en-US')}`;

export function computeRiskScore(i: RiskInput, cfg: RiskConfig = DEFAULT_RISK_CONFIG): RiskScore {
  const factors: RiskFactor[] = [];
  const ccy = i.reporting_currency;
  const materialOverdue = i.overdue_reporting >= cfg.materiality_amount;

  // 1. Aging (25)
  {
    const d = i.max_aging_days;
    let pts = 0;
    if (materialOverdue && d > 0) pts = d <= 7 ? 5 : d <= 14 ? 9 : d <= 30 ? 13 : d <= 60 ? 18 : d <= 90 ? 22 : 25;
    factors.push({
      key: 'aging',
      label: 'Days overdue',
      points: pts,
      max_points: 25,
      evidence: materialOverdue ? `Oldest overdue invoice: ${d} days` : 'No material overdue balance',
    });
  }
  // 2. Overdue amount (20)
  {
    const a = i.overdue_reporting;
    const [t1, t2, t3, t4] = cfg.amount_thresholds;
    const pts = !materialOverdue ? 0 : a < t1 ? 4 : a < t2 ? 8 : a < t3 ? 12 : a < t4 ? 16 : 20;
    factors.push({ key: 'overdue_amount', label: 'Overdue amount', points: pts, max_points: 20, evidence: `Overdue ${fmt(a, ccy)}` });
  }
  // 3. 30+ ratio (15)
  {
    const ratio = i.total_outstanding_reporting > 0 ? i.overdue_30_plus_reporting / i.total_outstanding_reporting : 0;
    const pts = Math.round(Math.min(1, ratio / 0.5) * 15);
    factors.push({
      key: 'over30_ratio',
      label: '30+ days share of balance',
      points: pts,
      max_points: 15,
      evidence: `${(ratio * 100).toFixed(0)}% of outstanding is 30+ days overdue`,
    });
  }
  // 4. WoW overdue increase (10)
  {
    let pts = 0;
    let evidence = 'No prior snapshot to compare';
    if (i.previous_overdue_reporting !== null) {
      const prev = i.previous_overdue_reporting;
      const cur = i.overdue_reporting;
      if (prev <= 0 && cur >= cfg.materiality_amount) {
        pts = 8;
        evidence = `New overdue this week: ${fmt(cur, ccy)}`;
      } else if (prev > 0) {
        const growth = (cur - prev) / prev;
        pts = growth <= 0 ? 0 : growth < 0.1 ? 3 : growth < 0.25 ? 6 : growth < 0.5 ? 8 : 10;
        evidence = `Overdue ${growth >= 0 ? '+' : ''}${(growth * 100).toFixed(0)}% vs last week (${fmt(prev, ccy)} -> ${fmt(cur, ccy)})`;
      } else {
        evidence = 'No overdue last week or this week';
      }
    }
    factors.push({ key: 'wow_increase', label: 'Week-over-week overdue growth', points: pts, max_points: 10, evidence });
  }
  // 5. Broken promise (10)
  {
    const b = i.broken_promise_amount_reporting;
    const pts = b > 0 ? 10 : 0;
    factors.push({ key: 'promise_broken', label: 'Broken payment promise', points: pts, max_points: 10, evidence: b > 0 ? `Unfulfilled promise ${fmt(b, ccy)}` : 'No broken promise' });
  }
  // 6. Credit limit (10)
  {
    const u = i.credit_utilization;
    let pts = 0;
    let evidence = 'No credit limit on file';
    if (u !== null) {
      pts = u > 1 ? 10 : u > 0.9 ? 5 : 0;
      evidence = `Credit utilization ${(u * 100).toFixed(0)}%`;
    }
    if (i.credit_status && i.credit_status !== 'ACTIVE') {
      pts = Math.max(pts, i.credit_status === 'SUSPENDED' ? 10 : 5);
      evidence += `; credit status ${i.credit_status}`;
    }
    factors.push({ key: 'credit_limit', label: 'Credit limit / credit status', points: pts, max_points: 10, evidence });
  }
  // 7. No recent collection activity (5)
  {
    const d = i.days_since_last_activity;
    let pts = 0;
    let evidence = 'No overdue balance';
    if (materialOverdue) {
      if (d === null) {
        pts = 5;
        evidence = 'No collection activity recorded';
      } else {
        pts = d > 14 ? 5 : d > 7 ? 2 : 0;
        evidence = `Last collection activity ${d} days ago`;
      }
    }
    factors.push({ key: 'no_activity', label: 'No recent collection activity', points: pts, max_points: 5, evidence });
  }
  // 8. Dispute (5)
  {
    const d = i.disputed_reporting;
    factors.push({ key: 'dispute', label: 'Unresolved dispute', points: d > 0 ? 5 : 0, max_points: 5, evidence: d > 0 ? `Disputed ${fmt(d, ccy)}` : 'No open dispute' });
  }

  const score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));
  return { score, grade: gradeFor(score), factors };
}
