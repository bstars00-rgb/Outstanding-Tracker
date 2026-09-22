import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileReceivablesSource } from '@adapters/ellis/file-adapter';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';
import { mockFxTable } from '@adapters/ellis/mock-data';
import { InMemorySnapshotStore } from '@adapters/storage/snapshot-store';
import { MockTeamsSender } from '@adapters/teams/mock-sender';
import { RuleBasedInsightProvider } from '@adapters/ai/mock-provider';
import { runPipeline } from '../../automation/weekly-report';
import { loadEnv } from '../../automation/lib/env';
import { RedactingLogger } from '../../automation/lib/logger';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ot-file-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fx = mockFxTable('2026-09-05', '2026-09-05', 'JPY');

describe('manual run mode: DATA_SOURCE=file', () => {
  it('loads a raw ELLIS export (tool results) and maps it like the live adapter', async () => {
    const p = join(dir, 'export.json');
    await writeFile(
      p,
      JSON.stringify({
        asOf: '2026-09-05T02:00:00.000Z',
        reportingCurrency: 'JPY',
        sellerInvoices: [{ invoiceSeq: 901, paymentStatus: 'Unpaid', controlCompName: 'OMH Singapore', sellerCompCode: 'S0009', sellerCompName: 'Fictional Seller Z', sellerOperationName: null, billingCurrencyCode: 'USD', billingSumAmount: 1000, paidSumAmount: 250, balanceAmount: 750, issuedDate: '2026-08-20', dueDate: '2026-09-01', remark: null }],
        payments: [{ paymentSeq: 7, salesOrVendor: 'S', bookingItemCode: null, depositWithdrawTypeCode: 'Deposit', paidDate: '2026-09-03', currencyCode: 'USD', firstDepositAmount: 250, depositAmount: 250, depositTypeName: 'Bank Transfer', traderCompCode: 'S0009', traderCompName: 'Fictional Seller Z', invoiceSeq: 901, sellerDisputeYn: 'N', paymentConfirmDate: null }],
        traders: [{ companyCode: 'S0009', companyName: 'Fictional Seller Z', country: 'SG', status: 'Active', controlCompName: 'OMH Singapore', seller: { isSeller: true, sellerType: 'Regular Seller', creditLimit: 2000, paymentTerms: 14, currency: 'USD' } }],
        appliedRates: [{ originCurrencyCode: 'USD', targetCurrencyCode: 'JPY', appliedRate: 150 }],
      }),
    );
    const src = new FileReceivablesSource(p, 'JPY', fx);
    expect((await src.healthCheck()).ok).toBe(true);
    const ds = await src.fetchDataset('2026-09-05');
    expect(ds.source).toBe('file');
    expect(ds.fx.rates).toEqual([{ currency: 'USD', rate_to_reporting: 150, rate_date: '2026-09-05', source: 'ELLIS applied exchange rate' }]);
    expect(ds.customers[0].control_company).toBe('OMH Singapore');
    expect(ds.payments[0].confirmed_at).toBeNull(); // recorded, not yet verified => reflection queue

    const env = loadEnv({ DATA_SOURCE: 'file', DATA_FILE: p, REPORT_DATE: '2026-09-05' });
    const r = await runPipeline({ env, source: src, store: new InMemorySnapshotStore(), insightProvider: new RuleBasedInsightProvider('ko'), sender: new MockTeamsSender(), log: new RedactingLogger(() => {}), now: () => new Date('2026-09-05T02:00:00Z'), outDir: join(dir, 'out') });
    expect(r.status).toBe('dry-run');
    expect(r.model!.snapshot.totals.total_outstanding).toBe(112500); // 750 USD * 150
    expect(r.model!.snapshot.totals.overdue_outstanding).toBe(112500);
    expect(r.model!.snapshot.totals.unverified_payment_count).toBe(1);
    expect(r.model!.aging_by_control_company[0].label).toBe('OMH Singapore');
  });

  it('accepts a full ReceivablesDataset JSON too and rejects unknown layouts', async () => {
    const ds = await new MockReceivablesSource().fetchDataset('2026-09-05');
    const p = join(dir, 'dataset.json');
    await writeFile(p, JSON.stringify(ds));
    const loaded = await new FileReceivablesSource(p, 'JPY', fx).fetchDataset('2026-09-05');
    expect(loaded.invoices.length).toBe(ds.invoices.length);
    const bad = join(dir, 'bad.json');
    await writeFile(bad, JSON.stringify({ hello: 'world' }));
    await expect(new FileReceivablesSource(bad, 'JPY', fx).fetchDataset('2026-09-05')).rejects.toThrow(/DATA_FILE must be/);
  });
});
