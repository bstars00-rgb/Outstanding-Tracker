import { pick, type Lang } from './i18n';
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

export function computeRiskScore(i: RiskInput, cfg: RiskConfig = DEFAULT_RISK_CONFIG, lang: Lang = 'en'): RiskScore {
  const p = (en: string, ko: string) => pick(lang, en, ko);
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
      label: p('Days overdue', '연체 일수'),
      points: pts,
      max_points: 25,
      evidence: materialOverdue ? p(`Oldest overdue invoice: ${d} days`, `최장 연체 Invoice: ${d}일`) : p('No material overdue balance', '유의미한 연체 잔액 없음'),
    });
  }
  // 2. Overdue amount (20)
  {
    const a = i.overdue_reporting;
    const [t1, t2, t3, t4] = cfg.amount_thresholds;
    const pts = !materialOverdue ? 0 : a < t1 ? 4 : a < t2 ? 8 : a < t3 ? 12 : a < t4 ? 16 : 20;
    factors.push({ key: 'overdue_amount', label: p('Overdue amount', '연체 금액'), points: pts, max_points: 20, evidence: p(`Overdue ${fmt(a, ccy)}`, `연체 ${fmt(a, ccy)}`) });
  }
  // 3. 30+ ratio (15)
  {
    const ratio = i.total_outstanding_reporting > 0 ? i.overdue_30_plus_reporting / i.total_outstanding_reporting : 0;
    const pts = Math.round(Math.min(1, ratio / 0.5) * 15);
    const pctText = (ratio * 100).toFixed(0);
    factors.push({
      key: 'over30_ratio',
      label: p('30+ days share of balance', '30일 이상 연체 비중'),
      points: pts,
      max_points: 15,
      evidence: p(`${pctText}% of outstanding is 30+ days overdue`, `미수금의 ${pctText}%가 30일 이상 연체`),
    });
  }
  // 4. WoW overdue increase (10)
  {
    let pts = 0;
    let evidence = p('No prior snapshot to compare', '비교할 이전 스냅샷 없음');
    if (i.previous_overdue_reporting !== null) {
      const prev = i.previous_overdue_reporting;
      const cur = i.overdue_reporting;
      if (prev <= 0 && cur >= cfg.materiality_amount) {
        pts = 8;
        evidence = p(`New overdue this week: ${fmt(cur, ccy)}`, `이번 주 신규 연체: ${fmt(cur, ccy)}`);
      } else if (prev > 0) {
        const growth = (cur - prev) / prev;
        pts = growth <= 0 ? 0 : growth < 0.1 ? 3 : growth < 0.25 ? 6 : growth < 0.5 ? 8 : 10;
        const g = `${growth >= 0 ? '+' : ''}${(growth * 100).toFixed(0)}%`;
        evidence = p(`Overdue ${g} vs last week (${fmt(prev, ccy)} -> ${fmt(cur, ccy)})`, `연체 전주 대비 ${g} (${fmt(prev, ccy)} → ${fmt(cur, ccy)})`);
      } else {
        evidence = p('No overdue last week or this week', '지난주·이번 주 모두 연체 없음');
      }
    }
    factors.push({ key: 'wow_increase', label: p('Week-over-week overdue growth', '전주 대비 연체 증가'), points: pts, max_points: 10, evidence });
  }
  // 5. Broken promise (10)
  {
    const b = i.broken_promise_amount_reporting;
    factors.push({ key: 'promise_broken', label: p('Broken payment promise', '지급 약속 불이행'), points: b > 0 ? 10 : 0, max_points: 10, evidence: b > 0 ? p(`Unfulfilled promise ${fmt(b, ccy)}`, `미이행 약속 금액 ${fmt(b, ccy)}`) : p('No broken promise', '약속 불이행 없음') });
  }
  // 6. Credit limit (10)
  {
    const u = i.credit_utilization;
    let pts = 0;
    let evidence = p('No credit limit on file', '등록된 신용한도 없음');
    if (u !== null) {
      pts = u > 1 ? 10 : u > 0.9 ? 5 : 0;
      evidence = p(`Credit utilization ${(u * 100).toFixed(0)}%`, `신용한도 사용률 ${(u * 100).toFixed(0)}%`);
    }
    if (i.credit_status && i.credit_status !== 'ACTIVE') {
      pts = Math.max(pts, i.credit_status === 'SUSPENDED' ? 10 : 5);
      evidence += p(`; credit status ${i.credit_status}`, `; 신용 상태 ${i.credit_status}`);
    }
    factors.push({ key: 'credit_limit', label: p('Credit limit / credit status', '신용한도 / 신용 상태'), points: pts, max_points: 10, evidence });
  }
  // 7. No recent collection activity (5)
  {
    const d = i.days_since_last_activity;
    let pts = 0;
    let evidence = p('No overdue balance', '연체 잔액 없음');
    if (materialOverdue) {
      if (d === null) {
        pts = 5;
        evidence = p('No collection activity recorded', '기록된 회수 활동 없음');
      } else {
        pts = d > 14 ? 5 : d > 7 ? 2 : 0;
        evidence = p(`Last collection activity ${d} days ago`, `마지막 회수 활동 ${d}일 전`);
      }
    }
    factors.push({ key: 'no_activity', label: p('No recent collection activity', '최근 회수 활동 부재'), points: pts, max_points: 5, evidence });
  }
  // 8. Dispute (5)
  {
    const d = i.disputed_reporting;
    factors.push({ key: 'dispute', label: p('Unresolved dispute', '미해결 분쟁'), points: d > 0 ? 5 : 0, max_points: 5, evidence: d > 0 ? p(`Disputed ${fmt(d, ccy)}`, `분쟁 금액 ${fmt(d, ccy)}`) : p('No open dispute', '진행 중 분쟁 없음') });
  }

  const score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));
  return { score, grade: gradeFor(score), factors };
}
