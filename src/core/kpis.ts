import { fill, type Lang } from './i18n';
import { formatMoney, formatPct, round2 } from './money';
import type { KpiKey, KpiValue, SnapshotTotals } from './types';

type Status = KpiValue['status'];

function change(cur: number, prev: number | null): { change: number | null; change_pct: number | null } {
  if (prev === null) return { change: null, change_pct: null };
  const c = round2(cur - prev);
  const pct = prev !== 0 ? round2((c / Math.abs(prev)) * 10000) / 10000 : cur !== 0 ? null : 0;
  return { change: c, change_pct: pct };
}

type Texts = {
  label: Record<KpiKey, string>;
  definition: Record<KpiKey, string>;
  noPrior: string;
  vsLastWeek: string; // "{delta} ({pct}) vs last week"
  totalInterp: string; // "{invoices} open invoices across {customers} customers. {delta}"
  overdueInterp: string; // "{ratio} of total is past due. {delta}"
  ratioInterp: string; // "{dir} from {prev} last week"
  up: string;
  down: string;
  flat: string;
  due7Interp: string;
  collectedInterp: string; // "Applied cash received in the report week. {delta}"
  newOverdueInterp: string; // "Resolved overdue this week: {resolved}"
  over90Some: string;
  over90None: string;
  brokenInterp: string; // "{count} customer(s) missed a promised payment date"
  atRiskInterp: string; // "{share} of total outstanding. Disputed: {disputed}"
};

const EN: Texts = {
  label: {
    total_outstanding: 'Total Outstanding',
    overdue_outstanding: 'Overdue Outstanding',
    overdue_ratio: 'Overdue Ratio',
    due_within_7_days: 'Due Within 7 Days',
    collected_this_week: 'Collected This Week',
    new_overdue_this_week: 'New Overdue This Week',
    overdue_30_plus: '30+ Days Overdue',
    overdue_90_plus: '90+ Days Overdue',
    broken_promises: 'Broken Promises',
    at_risk_amount: 'At-Risk Amount',
  },
  definition: {
    total_outstanding: 'Sum of outstanding_amount of all unsettled invoices (excluding cancelled and written-off), converted to reporting currency.',
    overdue_outstanding: 'Outstanding where due_date < reference date and outstanding_amount > 0.',
    overdue_ratio: 'Overdue Outstanding / Total Outstanding.',
    due_within_7_days: 'Outstanding of invoices not yet overdue whose due_date is within the next 7 days.',
    collected_this_week: 'Sum of applied_amount of payments dated inside the report week (unapplied cash excluded).',
    new_overdue_this_week: 'Outstanding of invoices that were not overdue in the previous snapshot and are overdue now.',
    overdue_30_plus: 'Outstanding with aging_days > 30.',
    overdue_90_plus: 'Outstanding with aging_days > 90.',
    broken_promises: 'Promised amount not received by the promised_payment_date (uncompleted promise activities).',
    at_risk_amount: 'Union of: 30+ days overdue, disputed invoices, and all open invoices of customers with a broken promise or an exceeded credit limit.',
  },
  noPrior: 'No prior week to compare',
  vsLastWeek: '{delta} ({pct}) vs last week',
  totalInterp: '{invoices} open invoices across {customers} customers. {delta}',
  overdueInterp: '{ratio} of total is past due. {delta}',
  ratioInterp: '{dir} from {prev} last week',
  up: 'Up',
  down: 'Down',
  flat: 'Flat',
  due7Interp: 'Not yet due; must be collected next week to avoid new overdue',
  collectedInterp: 'Applied cash received in the report week. {delta}',
  newOverdueInterp: 'Resolved overdue this week: {resolved}',
  over90Some: 'Candidates for credit hold / escalation',
  over90None: 'No balance older than 90 days',
  brokenInterp: '{count} customer(s) missed a promised payment date',
  atRiskInterp: '{share} of total outstanding. Disputed: {disputed}',
};

const KO: Texts = {
  label: {
    total_outstanding: '총 미수금',
    overdue_outstanding: '연체 미수금',
    overdue_ratio: '연체 비율',
    due_within_7_days: '7일 이내 만기',
    collected_this_week: '이번 주 회수액',
    new_overdue_this_week: '이번 주 신규 연체',
    overdue_30_plus: '30일 이상 연체',
    overdue_90_plus: '90일 이상 연체',
    broken_promises: '약속 불이행',
    at_risk_amount: '위험 노출 금액',
  },
  definition: {
    total_outstanding: '취소·대손 처리를 제외한 모든 미정산 Invoice의 outstanding_amount 합계(보고 통화 환산).',
    overdue_outstanding: 'due_date가 기준일보다 이전이고 outstanding_amount > 0인 미수금.',
    overdue_ratio: '연체 미수금 ÷ 총 미수금.',
    due_within_7_days: '아직 연체되지 않았고 due_date가 향후 7일 이내인 Invoice의 미수금.',
    collected_this_week: '보고 주간에 입금·적용된 applied_amount 합계(미적용 현금 제외).',
    new_overdue_this_week: '지난 스냅샷에서는 정상이었으나 이번 스냅샷에서 연체가 된 Invoice의 미수금.',
    overdue_30_plus: 'aging_days > 30인 미수금.',
    overdue_90_plus: 'aging_days > 90인 미수금.',
    broken_promises: 'promised_payment_date까지 회수되지 않은 약속 금액(미완료 약속 활동 기준).',
    at_risk_amount: '30일 이상 연체, 분쟁 Invoice, 약속 불이행 또는 신용한도 초과 고객의 모든 미결 Invoice의 합집합.',
  },
  noPrior: '비교할 지난주 데이터 없음',
  vsLastWeek: '전주 대비 {delta} ({pct})',
  totalInterp: '고객사 {customers}곳, 미결 Invoice {invoices}건. {delta}',
  overdueInterp: '총액의 {ratio}가 연체 상태. {delta}',
  ratioInterp: '지난주 {prev} 대비 {dir}',
  up: '상승',
  down: '하락',
  flat: '변동 없음',
  due7Interp: '미도래 금액. 신규 연체를 막으려면 다음 주 안에 회수해야 함',
  collectedInterp: '보고 주간에 실제 입금·적용된 금액. {delta}',
  newOverdueInterp: '이번 주 해소된 연체: {resolved}',
  over90Some: '신용 중단·에스컬레이션 검토 대상',
  over90None: '90일 초과 잔액 없음',
  brokenInterp: '고객사 {count}곳이 약속한 지급일을 지키지 않음',
  atRiskInterp: '총 미수금의 {share}. 분쟁 금액: {disputed}',
};

/**
 * KPI status is a combination of level and direction, not raw size:
 *  - ratios use absolute thresholds
 *  - amounts are judged by their share of total outstanding and by WoW movement
 */
export function buildKpis(t: SnapshotTotals, prev: SnapshotTotals | null, ccy: string, lang: Lang = 'en'): KpiValue[] {
  const T = lang === 'ko' ? KO : EN;
  const total = t.total_outstanding || 1;
  const overdueRatio = t.total_outstanding > 0 ? t.overdue_outstanding / t.total_outstanding : 0;
  const prevRatio = prev && prev.total_outstanding > 0 ? prev.overdue_outstanding / prev.total_outstanding : null;

  const moneyDelta = (cur: number, p: number | null) => {
    const ch = change(cur, p);
    return ch.change === null ? T.noPrior : fill(T.vsLastWeek, { delta: formatMoney(ch.change, ccy, { signed: true, compact: true }), pct: formatPct(ch.change_pct, { signed: true }) });
  };

  const worseIfUp = (cur: number, p: number | null, shareWarn: number, shareCrit: number): Status => {
    const share = cur / total;
    const ch = change(cur, p).change_pct;
    if (share >= shareCrit || (ch !== null && ch > 0.25 && share >= shareWarn)) return 'critical';
    if (share >= shareWarn || (ch !== null && ch > 0.1)) return 'warning';
    if (cur === 0 || (ch !== null && ch < 0)) return 'good';
    return 'neutral';
  };

  const mk = (key: KpiKey, value: number, unit: KpiValue['unit'], previous: number | null, status: Status, interpretation: string): KpiValue => ({
    key,
    label: T.label[key],
    value,
    unit,
    previous,
    ...change(value, previous),
    status,
    interpretation,
    definition: T.definition[key],
  });

  return [
    mk('total_outstanding', t.total_outstanding, 'currency', prev?.total_outstanding ?? null, 'neutral', fill(T.totalInterp, { invoices: t.invoice_count, customers: t.customer_count, delta: moneyDelta(t.total_outstanding, prev?.total_outstanding ?? null) })),
    mk('overdue_outstanding', t.overdue_outstanding, 'currency', prev?.overdue_outstanding ?? null, worseIfUp(t.overdue_outstanding, prev?.overdue_outstanding ?? null, 0.2, 0.35), fill(T.overdueInterp, { ratio: formatPct(overdueRatio), delta: moneyDelta(t.overdue_outstanding, prev?.overdue_outstanding ?? null) })),
    mk(
      'overdue_ratio',
      round2(overdueRatio * 10000) / 10000,
      'ratio',
      prevRatio,
      overdueRatio >= 0.35 ? 'critical' : overdueRatio >= 0.2 ? 'warning' : overdueRatio === 0 ? 'good' : 'neutral',
      prevRatio === null ? T.noPrior : fill(T.ratioInterp, { dir: overdueRatio > prevRatio ? T.up : overdueRatio < prevRatio ? T.down : T.flat, prev: formatPct(prevRatio) }),
    ),
    mk('due_within_7_days', t.due_within_7_days, 'currency', prev?.due_within_7_days ?? null, 'neutral', T.due7Interp),
    mk('collected_this_week', t.collected_during_week, 'currency', prev?.collected_during_week ?? null, t.collected_during_week > 0 ? 'good' : 'warning', fill(T.collectedInterp, { delta: moneyDelta(t.collected_during_week, prev?.collected_during_week ?? null) })),
    mk('new_overdue_this_week', t.new_overdue_during_week, 'currency', prev?.new_overdue_during_week ?? null, t.new_overdue_during_week === 0 ? 'good' : t.new_overdue_during_week / total > 0.1 ? 'critical' : 'warning', fill(T.newOverdueInterp, { resolved: formatMoney(t.resolved_overdue_during_week, ccy, { compact: true }) })),
    mk('overdue_30_plus', t.overdue_30_plus, 'currency', prev?.overdue_30_plus ?? null, worseIfUp(t.overdue_30_plus, prev?.overdue_30_plus ?? null, 0.1, 0.2), moneyDelta(t.overdue_30_plus, prev?.overdue_30_plus ?? null)),
    mk('overdue_90_plus', t.overdue_90_plus, 'currency', prev?.overdue_90_plus ?? null, t.overdue_90_plus === 0 ? 'good' : worseIfUp(t.overdue_90_plus, prev?.overdue_90_plus ?? null, 0.03, 0.08), t.overdue_90_plus > 0 ? T.over90Some : T.over90None),
    mk('broken_promises', t.broken_promise_amount, 'currency', prev?.broken_promise_amount ?? null, t.broken_promise_count === 0 ? 'good' : t.broken_promise_count >= 3 ? 'critical' : 'warning', fill(T.brokenInterp, { count: t.broken_promise_count })),
    mk('at_risk_amount', t.at_risk_amount, 'currency', prev?.at_risk_amount ?? null, worseIfUp(t.at_risk_amount, prev?.at_risk_amount ?? null, 0.15, 0.3), fill(T.atRiskInterp, { share: formatPct(t.at_risk_amount / total), disputed: formatMoney(t.disputed, ccy, { compact: true }) })),
  ];
}
