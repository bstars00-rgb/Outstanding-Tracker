/** Prints a profile of the mock dataset (counts + scenario coverage). Usage: npm run mock:generate [-- 2026-09-05] */
import { generateMockDataset, SCENARIOS } from '@adapters/ellis/mock-data';
import { buildTrackerModel } from '@core/calc';
import { validateDataset } from '@core/validate';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';

const ref = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : '2026-09-05';
const ds = generateMockDataset(ref);
const prev = await new MockReceivablesSource().previousSnapshot(ref);
const v = validateDataset(ds);
const m = buildTrackerModel(ds, { referenceDate: ref, previousSnapshot: prev, validationIssues: v.issues });
console.log(`reference ${ref}: customers=${ds.customers.length} invoices=${ds.invoices.length} payments=${ds.payments.length} activities=${ds.activities.length} bookings=${ds.bookings.length}`);
console.log(`validation ok=${v.ok} issues=${v.issues.length}`);
console.log('scenarios:', [...new Set(SCENARIOS.map((s) => s.scenario))].join(', '));
for (const c of m.customers.slice(0, 12)) console.log(`  ${c.customer_name.padEnd(26)} risk=${String(c.risk.score).padStart(3)} ${c.risk.grade.padEnd(8)} overdue=${c.overdue_reporting.toFixed(0).padStart(8)} total=${c.total_outstanding_reporting.toFixed(0).padStart(8)} maxAging=${c.max_aging_days} promiseBroken=${c.promise_broken} limitExceeded=${c.credit_limit_exceeded}`);
console.log('totals', JSON.stringify(m.snapshot.totals));
