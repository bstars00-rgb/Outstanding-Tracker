import { describe, expect, it } from 'vitest';
import { computeRiskScore, gradeFor, type RiskInput } from '@core/risk';

const base: RiskInput = {
  overdue_reporting: 0,
  total_outstanding_reporting: 500_000,
  overdue_30_plus_reporting: 0,
  max_aging_days: 0,
  previous_overdue_reporting: 0,
  broken_promise_amount_reporting: 0,
  credit_utilization: 0.6,
  days_since_last_activity: 3,
  disputed_reporting: 0,
  reporting_currency: 'USD',
};

describe('risk score', () => {
  it('large but not overdue customer scores Low', () => {
    const r = computeRiskScore(base);
    expect(r.score).toBe(0);
    expect(r.grade).toBe('Low');
  });
  it('weights sum to 100', () => {
    const r = computeRiskScore(base);
    expect(r.factors.reduce((s, f) => s + f.max_points, 0)).toBe(100);
    expect(r.factors.map((f) => f.max_points)).toEqual([25, 20, 15, 10, 10, 10, 5, 5]);
  });
  it('maximal distress scores Critical', () => {
    const r = computeRiskScore({ ...base, overdue_reporting: 120_000, total_outstanding_reporting: 120_000, overdue_30_plus_reporting: 120_000, max_aging_days: 120, previous_overdue_reporting: 50_000, broken_promise_amount_reporting: 20_000, credit_utilization: 1.4, days_since_last_activity: null, disputed_reporting: 5_000 });
    expect(r.score).toBe(100);
    expect(r.grade).toBe('Critical');
  });
  it('grade thresholds', () => {
    expect(gradeFor(29)).toBe('Low');
    expect(gradeFor(30)).toBe('Watch');
    expect(gradeFor(49)).toBe('Watch');
    expect(gradeFor(50)).toBe('Medium');
    expect(gradeFor(69)).toBe('Medium');
    expect(gradeFor(70)).toBe('High');
    expect(gradeFor(84)).toBe('High');
    expect(gradeFor(85)).toBe('Critical');
  });
  it('aging points follow the documented table', () => {
    const pts = (d: number) => computeRiskScore({ ...base, overdue_reporting: 1000, max_aging_days: d }).factors[0].points;
    expect([pts(3), pts(10), pts(20), pts(45), pts(75), pts(100)]).toEqual([5, 9, 13, 18, 22, 25]);
  });
  it('immaterial overdue does not award aging or amount points', () => {
    const r = computeRiskScore({ ...base, overdue_reporting: 50, max_aging_days: 200 });
    expect(r.factors[0].points).toBe(0);
    expect(r.factors[1].points).toBe(0);
  });
  it('new overdue vs zero last week awards 8, no snapshot awards 0 with explanation', () => {
    expect(computeRiskScore({ ...base, overdue_reporting: 5000, previous_overdue_reporting: 0 }).factors[3].points).toBe(8);
    const none = computeRiskScore({ ...base, overdue_reporting: 5000, previous_overdue_reporting: null }).factors[3];
    expect(none.points).toBe(0);
    expect(none.evidence).toMatch(/No prior snapshot/);
  });
  it('credit status ON_HOLD adds points even below limit', () => {
    const r = computeRiskScore({ ...base, credit_status: 'ON_HOLD' });
    expect(r.factors[5].points).toBe(5);
    expect(r.factors[5].evidence).toMatch(/ON_HOLD/);
  });
  it('every factor carries human readable evidence', () => {
    const r = computeRiskScore({ ...base, overdue_reporting: 12_000, max_aging_days: 20, disputed_reporting: 500 });
    for (const f of r.factors) expect(f.evidence.length).toBeGreaterThan(5);
  });
});
