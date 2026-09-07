import { describe, expect, it } from 'vitest';
import { bookingsToDataset, DEFAULT_LIVE_CONFIG, EllisMcpReceivablesSource, type EllisBookingRecord } from '@adapters/ellis/live-adapter';
import { HttpMcpClient, McpTransportError } from '@adapters/ellis/mcp-client';
import { ToolNotConfirmedError, type McpToolClient } from '@adapters/ellis/types';
import { LiveTeamsSender } from '@adapters/teams/live-sender';
import { validateDataset } from '@core/validate';
import { buildTrackerModel } from '@core/calc';
import { mockFxTable } from '@adapters/ellis/mock-data';
import { DatasetSchema } from '@core/validate';
import { MockReceivablesSource } from '@adapters/ellis/mock-adapter';

const record = (over: Partial<EllisBookingRecord> = {}): EllisBookingRecord => ({
  bookingItemCode: 'S26081810811H01',
  bookingDate: '2026-08-18 18:39:00',
  checkInDate: '2026-08-25',
  checkOutDate: '2026-08-26',
  sellerName: 'Fictional Seller A',
  hotelName: 'Test Hotel',
  hotelCode: 1,
  hotelLegacyCode: null,
  hotelCountry: 'Korea',
  hotelCity: 'Busan',
  hotelChainName: null,
  roomTypeCode: 'r',
  roomTypeName: 'Standard',
  ratePlanName: 'BAR',
  roomPlanCode: null,
  promotionName: null,
  promotionCode: null,
  roomNights: 1,
  roomCount: 1,
  paxCount: 2,
  contractType: 'Dynamic Rate',
  cmsName: 'cms',
  sellerBookingCode: '****1234',
  paymentMethod: 'Cash',
  billing: 141.37,
  revenue: 4.52,
  currency: 'USD',
  baseCurrencyCode: 'KRW',
  fxRate: 1411.3,
  bookingStatus: 'Confirmed',
  cancelDate: null,
  guestName: 'SHOULD BE DROPPED',
  ...over,
});

/** Fake MCP client simulating the confirmed get_hotel_bookings pagination contract. */
class FakeMcp implements McpToolClient {
  calls: Record<string, unknown>[] = [];
  constructor(private readonly pages: Record<string, EllisBookingRecord[]>) {}
  async listTools() {
    return [{ name: 'get_hotel_bookings', description: 'confirmed' }];
  }
  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (name !== 'get_hotel_bookings') throw new Error('unknown tool');
    this.calls.push(args);
    const all = this.pages[String(args.countryCode)] ?? [];
    const offset = Number(args.offset);
    const limit = Number(args.limit);
    return { list: all.slice(offset, offset + limit), totalCount: all.length } as unknown as T;
  }
}

describe('Ellis live adapter (contract tests against the confirmed tool shape)', () => {
  const cfg = { ...DEFAULT_LIVE_CONFIG, reportingCurrency: 'USD', fx: mockFxTable('2026-09-05', '2026-09-05', 'USD'), countries: ['Korea', 'Japan'], pageSize: 2 };

  it('paginates per country with limit/offset until totalCount, dedupes by bookingItemCode and drops guestName', async () => {
    const kr = [record({ bookingItemCode: 'A1' }), record({ bookingItemCode: 'A2' }), record({ bookingItemCode: 'A3' }), record({ bookingItemCode: 'A1', bookingStatus: 'Cancelled', billing: 0 })];
    const fake = new FakeMcp({ Korea: kr, Japan: [] });
    const src = new EllisMcpReceivablesSource(fake, cfg);
    const rows = await src.fetchBookings('2026-06-01', '2026-09-05');
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.bookingItemCode === 'A1')!.bookingStatus).toBe('Cancelled'); // last write wins
    expect(rows.some((r) => 'guestName' in r)).toBe(false);
    expect(fake.calls.filter((c) => c.countryCode === 'Korea').map((c) => c.offset)).toEqual([0, 2]);
    expect(fake.calls.every((c) => c.dateBasis === 'BOOKING_DATE' && c.limit === 2)).toBe(true);
    expect((await src.healthCheck()).ok).toBe(true);
  });

  it('derives a labelled, partial dataset from bookings', () => {
    const recs = [
      record({ bookingItemCode: 'B1', checkOutDate: '2026-08-20' }), // billable
      record({ bookingItemCode: 'B2', checkOutDate: '2026-09-20' }), // future stay: not yet
      record({ bookingItemCode: 'B3', paymentMethod: 'VCC' }), // prepaid: not receivable
      record({ bookingItemCode: 'B4', bookingStatus: 'Cancelled', billing: 0, cancelDate: '2026-08-21 01:43:34' }),
      record({ bookingItemCode: 'B5', sellerName: 'Fictional Seller B', currency: 'KRW', billing: 200_000, checkOutDate: '2026-07-01' }),
    ];
    const ds = bookingsToDataset(recs, '2026-09-05', cfg);
    expect(ds.source).toBe('ellis-bookings-derived');
    expect(ds.completeness.payments).toBe('missing');
    expect(ds.customers.map((c) => c.customer_name).sort()).toEqual(['Fictional Seller A', 'Fictional Seller B']);
    expect(ds.invoices.map((i) => i.invoice_number).sort()).toEqual(['B1', 'B4', 'B5']);
    expect(ds.invoices.find((i) => i.invoice_number === 'B1')!.due_date).toBe('2026-09-03'); // checkout + 14
    expect(ds.invoices.find((i) => i.invoice_number === 'B4')!.invoice_status).toBe('CANCELLED');
    expect(validateDataset(ds).ok).toBe(true);
    const m = buildTrackerModel(ds, { referenceDate: '2026-09-05', previousSnapshot: null });
    expect(m.snapshot.totals.total_outstanding).toBeCloseTo(141.37 + 200_000 * 0.00072, 1);
    expect(m.completeness.notes.join(' ')).toMatch(/DERIVED FROM BOOKINGS/);
  });

  it('refuses to fabricate unconfirmed capabilities', async () => {
    const src = new EllisMcpReceivablesSource(new FakeMcp({}), cfg);
    await expect(src.fetchInvoices()).rejects.toBeInstanceOf(ToolNotConfirmedError);
    await expect(src.fetchPayments()).rejects.toThrow(/not confirmed/);
    await expect(src.fetchCustomers()).rejects.toThrow(/customer master/);
  });

  it('HttpMcpClient speaks JSON-RPC tools/call and surfaces transport errors', async () => {
    const seen: { url: string; body: unknown; auth: string | null }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push({ url, body, auth: (init.headers as Record<string, string>).authorization ?? null });
      if (body.method === 'tools/list') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'get_hotel_bookings' }] } }), { status: 200, headers: { 'mcp-session-id': 's1' } });
      if (body.params?.arguments?.countryCode === 'Boom') return new Response('err', { status: 503 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ list: [record({ bookingItemCode: 'H1' })], totalCount: 1 }) }] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new HttpMcpClient('https://mcp.example.test/mcp', 'Bearer TESTTOKEN', fetchImpl);
    expect((await client.listTools()).map((t) => t.name)).toEqual(['get_hotel_bookings']);
    const res = await client.callTool<{ list: unknown[]; totalCount: number }>('get_hotel_bookings', { countryCode: 'Korea', limit: 500, offset: 0 });
    expect(res.totalCount).toBe(1);
    expect(seen[1].auth).toBe('Bearer TESTTOKEN');
    expect(seen[1].body).toMatchObject({ method: 'tools/call', params: { name: 'get_hotel_bookings' } });
    await expect(client.callTool('get_hotel_bookings', { countryCode: 'Boom' })).rejects.toBeInstanceOf(McpTransportError);
  });
});

describe('Live Teams sender', () => {
  const msg = { idempotency_key: 'k', title: 't', card: { type: 'AdaptiveCard' as const, version: '1.4', body: [] }, markdown: 'm', markdown_length: 1 };
  it('posts the Workflows payload shape and retries on 5xx with backoff', async () => {
    let n = 0;
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      n++;
      return new Response('', { status: n < 3 ? 503 : 202 });
    }) as unknown as typeof fetch;
    const sleeps: number[] = [];
    const sender = new LiveTeamsSender({ leadersWebhookUrl: 'https://l.example/hook', testWebhookUrl: 'https://t.example/hook', adminWebhookUrl: null, maxAttempts: 3, baseDelayMs: 100, fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    const r = await sender.send(msg, 'leaders');
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(sleeps).toEqual([100, 200]);
    expect(bodies[0]).toMatchObject({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive' }] });
  });
  it('does not retry on 4xx and reports failure; refuses missing webhook', async () => {
    let n = 0;
    const fetchImpl = (async () => { n++; return new Response('', { status: 400 }); }) as unknown as typeof fetch;
    const sender = new LiveTeamsSender({ leadersWebhookUrl: null, testWebhookUrl: 'https://t.example/hook', adminWebhookUrl: null, maxAttempts: 3, baseDelayMs: 1, fetchImpl, sleep: async () => {} });
    const r = await sender.send(msg, 'test');
    expect(r.ok).toBe(false);
    expect(n).toBe(1);
    const none = await sender.send(msg, 'leaders');
    expect(none.ok).toBe(false);
    expect(none.error).toMatch(/No webhook/);
  });
});

describe('dataset contract', () => {
  it('mock dataset satisfies the shared schema used for live data', async () => {
    const ds = await new MockReceivablesSource().fetchDataset('2026-09-05');
    expect(DatasetSchema.safeParse(ds).success).toBe(true);
  });
});

describe('Ellis live adapter — capability discovery (Playbook settlement tools)', () => {
  const cfg = { ...DEFAULT_LIVE_CONFIG, reportingCurrency: 'JPY', fx: mockFxTable('2026-09-05', '2026-09-05', 'JPY'), countries: ['Korea'], pageSize: 500 };
  class SettlementMcp implements McpToolClient {
    calls: string[] = [];
    async listTools() {
      return ['get_hotel_bookings', 'get_seller_invoices', 'get_payments', 'get_traders', 'get_applied_exchange_rates'].map((name) => ({ name }));
    }
    async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
      this.calls.push(name);
      const page = (list: unknown[]) => ({ list, totalCount: list.length }) as unknown as T;
      if (name === 'get_seller_invoices') return page([{ invoiceSeq: 501, paymentStatus: 'Unpaid', controlCompName: 'OMH JP', sellerCompCode: 'S0001', sellerCompName: 'Fictional Seller A', sellerOperationName: null, billingCurrencyCode: 'USD', billingSumAmount: 1000, paidSumAmount: 0, balanceAmount: 1000, issuedDate: '2026-08-20', dueDate: '2026-09-03', remark: null }]);
      if (name === 'get_payments') return page([{ paymentSeq: 77, salesOrVendor: 'S', bookingItemCode: null, depositWithdrawTypeCode: 'Deposit', paidDate: '2026-09-04', currencyCode: 'USD', firstDepositAmount: 300, depositAmount: 300, depositTypeName: 'Bank Transfer', traderCompCode: null, traderCompName: 'Fictional Seller A', invoiceSeq: 501, sellerDisputeYn: 'N', paymentConfirmDate: '2026-09-04' }]);
      if (name === 'get_traders') return page([{ companyCode: 'S0001', companyName: 'Fictional Seller A', country: 'JP', status: 'Active', seller: { isSeller: true, sellerType: 'Regular Seller', creditLimit: 10000, paymentTerms: 14, currency: 'USD' } }]);
      if (name === 'get_applied_exchange_rates') return page([{ originCurrencyCode: 'USD', targetCurrencyCode: 'JPY', appliedRate: 150 }]);
      expect(args).toBeDefined();
      return page([]);
    }
  }
  it('uses the settlement tools when exposed and produces a full dataset (payments attributed by trader name)', async () => {
    const mcp = new SettlementMcp();
    const src = new EllisMcpReceivablesSource(mcp, cfg);
    expect(await src.discoverCapabilities()).toEqual({ bookings: true, sellerInvoices: true, payments: true, traders: true, appliedRates: true });
    const ds = await src.fetchDataset('2026-09-05');
    expect(ds.source).toBe('ellis-mcp');
    expect(mcp.calls).not.toContain('get_hotel_bookings');
    expect(ds.completeness.invoices).toBe('full');
    expect(ds.completeness.fx).toBe('full');
    expect(ds.fx.rates).toEqual([{ currency: 'USD', rate_to_reporting: 150, rate_date: '2026-09-05', source: 'ELLIS applied exchange rate' }]);
    expect(ds.payments[0].customer_id).toBe('seller:S0001');
    expect(validateDataset(ds).ok).toBe(true);
    const m = buildTrackerModel(ds, { referenceDate: '2026-09-05', previousSnapshot: null });
    expect(m.snapshot.totals.total_outstanding).toBe(150000);
    expect(m.snapshot.totals.collected_during_week).toBe(45000);
  });
});
