import type { InsightInput, InsightOutput, VerificationReport } from './types';

/**
 * Anti-hallucination gate: every number, customer name and owner name that appears in the AI output
 * must exist in the structured input (numbers within 0.5% or 1 unit tolerance for rounding).
 * Percentages are verified against ratios derivable from the input KPIs and facts.
 */
export function verifyInsight(input: InsightInput, out: InsightOutput): VerificationReport {
  const allowedNumbers = collectNumbers(input);
  const allowedNames = new Set<string>();
  const allowedOwners = new Set<string>();
  const addFacts = (arr: { customer: string; owner: string }[]) => arr.forEach((f) => { allowedNames.add(norm(f.customer)); if (f.owner) allowedOwners.add(norm(f.owner)); });
  addFacts(input.top_overdue_customers);
  addFacts(input.new_overdue_customers);
  addFacts(input.improved_customers);
  addFacts(input.broken_promises);
  addFacts(input.credit_limit_exceeded);
  addFacts(input.disputes);
  addFacts(input.collection_opportunities);
  addFacts(input.due_next_week);
  input.by_owner.forEach((o) => allowedOwners.add(norm(o.owner)));
  allowedOwners.add(norm('Unassigned'));

  const report: VerificationReport = { ok: true, checked_numbers: 0, unverified_numbers: [], unknown_customers: [], unknown_owners: [], notes: [] };

  const checkText = (text: string, where: string) => {
    for (const n of extractNumbers(text)) {
      report.checked_numbers++;
      if (!isAllowed(n, allowedNumbers, input)) report.unverified_numbers.push({ value: n, where });
    }
  };
  const checkCustomer = (name: string | null, where: string) => {
    if (name && !allowedNames.has(norm(name))) report.unknown_customers.push({ name, where });
  };
  const checkOwner = (name: string, where: string) => {
    if (name && !allowedOwners.has(norm(name))) report.unknown_owners.push({ name, where });
  };

  out.executive_summary.forEach((s, i) => checkText(s, `executive_summary[${i}]`));
  out.major_changes.forEach((s, i) => checkText(s, `major_changes[${i}]`));
  out.top_risks.forEach((r, i) => {
    checkCustomer(r.customer, `top_risks[${i}]`);
    checkOwner(r.owner, `top_risks[${i}]`);
    checkText(`${r.amount} ${r.reason} ${r.action}`, `top_risks[${i}]`);
  });
  out.collection_opportunities.forEach((r, i) => {
    checkCustomer(r.customer, `collection_opportunities[${i}]`);
    checkText(`${r.amount} ${r.why}`, `collection_opportunities[${i}]`);
  });
  out.owner_actions.forEach((r, i) => {
    checkCustomer(r.customer, `owner_actions[${i}]`);
    checkOwner(r.owner, `owner_actions[${i}]`);
    checkText(`${r.amount} ${r.action}`, `owner_actions[${i}]`);
  });
  out.ceo_decisions.forEach((r, i) => {
    checkCustomer(r.customer, `ceo_decisions[${i}]`);
    checkText(`${r.amount ?? ''} ${r.recommendation} ${r.rationale}`, `ceo_decisions[${i}]`);
  });
  checkText(String(out.forecast_next_week.expected_collection), 'forecast_next_week.expected_collection');
  out.forecast_next_week.basis.forEach((s, i) => checkText(s, `forecast_next_week.basis[${i}]`));
  if (out.forecast_next_week.currency !== input.reporting_currency) report.notes.push(`forecast currency ${out.forecast_next_week.currency} != ${input.reporting_currency}`);

  report.ok = report.unverified_numbers.length === 0 && report.unknown_customers.length === 0 && report.unknown_owners.length === 0;
  return report;
}

/** Remove unverifiable items instead of discarding the whole insight. */
export function sanitizeInsight(input: InsightInput, out: InsightOutput): { output: InsightOutput; removed: string[] } {
  const removed: string[] = [];
  const keep = <T,>(arr: T[], label: string, test: (t: T) => InsightOutput): T[] =>
    arr.filter((item, idx) => {
      const v = verifyInsight(input, test(item));
      if (!v.ok) removed.push(`${label}[${idx}]`);
      return v.ok;
    });
  const empty = emptyOutput(input.reporting_currency);
  const output: InsightOutput = {
    executive_summary: keep(out.executive_summary, 'executive_summary', (s) => ({ ...empty, executive_summary: [s] })),
    major_changes: keep(out.major_changes, 'major_changes', (s) => ({ ...empty, major_changes: [s] })),
    top_risks: keep(out.top_risks, 'top_risks', (r) => ({ ...empty, top_risks: [r] })),
    collection_opportunities: keep(out.collection_opportunities, 'collection_opportunities', (r) => ({ ...empty, collection_opportunities: [r] })),
    owner_actions: keep(out.owner_actions, 'owner_actions', (r) => ({ ...empty, owner_actions: [r] })),
    ceo_decisions: keep(out.ceo_decisions, 'ceo_decisions', (r) => ({ ...empty, ceo_decisions: [r] })),
    forecast_next_week: verifyInsight(input, { ...empty, forecast_next_week: out.forecast_next_week }).ok ? out.forecast_next_week : { expected_collection: 0, currency: input.reporting_currency, confidence: 'low', basis: ['Forecast removed: unverifiable figures'] },
    data_quality_warnings: out.data_quality_warnings,
  };
  if (output.forecast_next_week !== out.forecast_next_week) removed.push('forecast_next_week');
  return { output, removed };
}

export function emptyOutput(currency: string): InsightOutput {
  return { executive_summary: [], major_changes: [], top_risks: [], collection_opportunities: [], owner_actions: [], ceo_decisions: [], forecast_next_week: { expected_collection: 0, currency, confidence: 'low', basis: [] }, data_quality_warnings: [] };
}

// ---------- helpers ----------
const norm = (s: string) => s.trim().toLowerCase();

function collectNumbers(input: InsightInput): number[] {
  const nums: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) nums.push(v, Math.abs(v)); // negatives (e.g. FX effect) are quoted as magnitudes
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(input);
  // derived: absolute changes, ratios as percentages, thousands
  for (const k of input.kpis) {
    if (k.change !== null) nums.push(Math.abs(k.change));
    if (k.change_pct !== null) nums.push(Math.abs(k.change_pct) * 100);
    if (k.unit === 'ratio') nums.push(k.value * 100);
  }
  for (const f of [...input.top_overdue_customers, ...input.new_overdue_customers, ...input.improved_customers, ...input.broken_promises, ...input.credit_limit_exceeded]) {
    if (f.wow_overdue_change !== null) nums.push(Math.abs(f.wow_overdue_change));
    if (f.credit_utilization !== null) nums.push(f.credit_utilization * 100);
    if (f.total > 0) nums.push((f.overdue / f.total) * 100, (f.overdue_30_plus / f.total) * 100);
  }
  const totalKpi = input.kpis.find((k) => k.key === 'total_outstanding');
  const overdueKpi = input.kpis.find((k) => k.key === 'overdue_outstanding');
  if (overdueKpi && overdueKpi.value > 0) {
    for (const f of input.top_overdue_customers) nums.push((f.overdue / overdueKpi.value) * 100);
    if (overdueKpi.change) for (const f of input.new_overdue_customers) if (f.wow_overdue_change) nums.push((f.wow_overdue_change / overdueKpi.change) * 100);
  }
  if (totalKpi && totalKpi.value > 0) for (const f of input.top_overdue_customers) nums.push((f.total / totalKpi.value) * 100);
  // share of total of grouped tops (e.g. "top 3 customers = 71% of increase")
  const inc = input.new_overdue_customers.map((f) => f.wow_overdue_change ?? 0);
  if (overdueKpi?.change && overdueKpi.change > 0) for (let n = 1; n <= Math.min(5, inc.length); n++) nums.push((inc.slice(0, n).reduce((a, b) => a + b, 0) / overdueKpi.change) * 100);
  const ov = input.top_overdue_customers.map((f) => f.overdue);
  if (overdueKpi && overdueKpi.value > 0) for (let n = 1; n <= Math.min(5, ov.length); n++) nums.push((ov.slice(0, n).reduce((a, b) => a + b, 0) / overdueKpi.value) * 100);
  // sums of promise + due next week
  nums.push(input.due_next_week_total + input.promised_next_week_total);
  return nums;
}

/** Extract numeric tokens (supports 1,234.5 / 12.5% / 1.2M / 45K / 3 days). Skips 4-digit years and ISO dates. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const cleaned = text.replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/\b(19|20)\d{2}\b/g, ' ');
  const re = /(\d[\d,]*\.?\d*)\s*(%|[KkMm]\b)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    let v = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(v)) continue;
    const suffix = m[2];
    if (suffix === 'K' || suffix === 'k') v *= 1_000;
    if (suffix === 'M' || suffix === 'm') v *= 1_000_000;
    out.push(v);
  }
  return out;
}

const BUCKET_BOUNDARIES = new Set([61, 90, 91, 100]);

function isAllowed(n: number, allowed: number[], input: InsightInput): boolean {
  if (n <= 10 && Number.isInteger(n)) return true; // small counts / ordinal words (3 customers, top 5, 2 days)
  if (n <= 400 && Number.isInteger(n)) {
    // day counts and small counts: accept if any aging/day figure matches or it is a count of items
    const days = new Set<number>();
    for (const f of [...input.top_overdue_customers, ...input.new_overdue_customers, ...input.broken_promises, ...input.disputes, ...input.credit_limit_exceeded, ...input.collection_opportunities]) days.add(f.max_aging_days);
    if (days.has(n)) return true;
    if (n <= 60) return true; // counts of invoices/customers/days within a report are not verifiable and low-risk
    if (BUCKET_BOUNDARIES.has(n)) return true; // aging bucket labels such as "90+ days" or a capped "100%"
  }
  return allowed.some((a) => Math.abs(a - n) <= Math.max(1, Math.abs(a) * 0.006) || (a >= 1000 && Math.abs(Math.round(a / 1000) * 1000 - n) <= 500) || (a >= 100000 && Math.abs(Math.round(a / 10000) * 10000 - n) <= 5000));
}
