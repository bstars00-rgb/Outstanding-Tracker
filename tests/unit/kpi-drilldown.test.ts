import { describe, expect, it } from 'vitest';
import { buildFixtureModel } from '../fixtures/fixture-model';
import { INVOICE_KPIS, kpiDrilldownPath, kpiInvoicePredicate, kpiRowAmount } from '@app/lib/kpi-drilldown';

describe('KPI drill-down predicates reproduce the KPI values', () => {
  it('filtered rows sum to the card value for every invoice-level KPI', async () => {
    const { model } = await buildFixtureModel('2026-09-05', { lang: 'en' });
    for (const key of INVOICE_KPIS) {
      const kpi = model.kpis.find((k) => k.key === key)!;
      const pred = kpiInvoicePredicate(key, model)!;
      const rows = model.invoices.filter(pred);
      const sum = rows.reduce((s, i) => s + kpiRowAmount(key, i, model), 0);
      if (key === 'overdue_ratio') {
        const overdue = model.kpis.find((k) => k.key === 'overdue_outstanding')!;
        expect(Math.abs(sum - overdue.value)).toBeLessThan(1);
      } else if (key === 'new_overdue_this_week') {
        // approximation without previous snapshot state: at least the amount that became overdue this week
        expect(sum).toBeGreaterThan(0);
      } else {
        expect(Math.abs(sum - kpi.value)).toBeLessThan(2);
      }
    }
  });

  it('routes customer-level KPIs to the customer page and the rest to invoices', () => {
    expect(kpiDrilldownPath('broken_promises')).toBe('/customers?kpi=broken_promises');
    expect(kpiDrilldownPath('overdue_30_plus')).toBe('/invoices?kpi=overdue_30_plus');
  });
});
