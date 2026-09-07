/**
 * Deterministic mock dataset generator.
 * Produces >= 30 customers, >= 150 invoices and the raw material for 12 weekly snapshots.
 * Every required scenario from the PRD is represented by a named customer (see SCENARIOS).
 * All company names, people and bookings are fictional. No guest / personal data is generated.
 */
import { addDays } from '@core/dates';
import { round2 } from '@core/money';
import type { BookingContext, CollectionActivity, Customer, FxTable, Invoice, ISODate, Payment, ReceivablesDataset } from '@core/types';

// ---------- deterministic PRNG ----------
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Illustrative USD cross rates (1 unit of currency in USD). Reporting-currency rates are derived from these. */
export const MOCK_FX_USD: Record<string, number> = {
  USD: 1,
  KRW: 0.00072,
  JPY: 0.0068,
  VND: 0.000039,
  TWD: 0.031,
  THB: 0.028,
  HKD: 0.128,
  SGD: 0.75,
  MYR: 0.22,
  IDR: 0.000061,
  PHP: 0.0175,
};

/** Company default reporting currency (Finance: JPY). Override with REPORTING_CURRENCY / MockReceivablesSource(seed, ccy). */
export const DEFAULT_REPORTING_CURRENCY = 'JPY';

/**
 * FX table for a date, expressed as "reporting units per 1 unit of currency" (cross rate via USD).
 * Older weeks drift deterministically so the FX effect is visible in WoW comparisons.
 */
export function mockFxTable(date: ISODate, referenceDate: ISODate, reporting = DEFAULT_REPORTING_CURRENCY): FxTable {
  const weeksBack = Math.max(0, Math.round((Date.parse(referenceDate) - Date.parse(date)) / (7 * 86_400_000)));
  const drift: Record<string, number> = { JPY: -0.004, KRW: 0.002, VND: 0.0005, TWD: -0.001, THB: 0.001, USD: 0.001 };
  const usdOf = (ccy: string, wb: number) => (MOCK_FX_USD[ccy] ?? 1) * (1 + (drift[ccy] ?? 0) * wb);
  const reportingUsd = usdOf(reporting, weeksBack);
  return {
    reporting_currency: reporting,
    as_of: date,
    rates: Object.keys(MOCK_FX_USD)
      .filter((currency) => currency !== reporting)
      .map((currency) => ({
        currency,
        rate_to_reporting: Math.round((usdOf(currency, weeksBack) / reportingUsd) * 1e8) / 1e8,
        rate_date: date,
        source: 'mock-fx (illustrative rates)',
      })),
  };
}

type Scenario =
  | 'GOOD_LARGE_NOT_DUE'
  | 'LONG_OVERDUE'
  | 'OVER_90'
  | 'BROKEN_PROMISE'
  | 'DISPUTE'
  | 'CREDIT_NOTE'
  | 'PARTIAL_PAYMENT'
  | 'CREDIT_LIMIT_EXCEEDED'
  | 'RECENTLY_COLLECTED'
  | 'SHARP_DETERIORATION'
  | 'MISSING_DATA'
  | 'CANCELLED_BOOKING'
  | 'REFUND_UNAPPLIED'
  | 'MULTI_CURRENCY'
  | 'NORMAL_NOT_DUE'
  | 'GENERIC';

interface Seed {
  name: string;
  country: string;
  region: string;
  ccy: string;
  owner: number;
  scenario: Scenario;
  terms?: number;
  limitUsd?: number | null;
}

const OWNERS = [
  { id: 'own-01', name: 'Minji Park' },
  { id: 'own-02', name: 'Kenta Sato' },
  { id: 'own-03', name: 'Linh Nguyen' },
  { id: 'own-04', name: 'Wei Chen' },
  { id: 'own-05', name: 'Somchai Rattana' },
  { id: 'own-06', name: 'Aisha Rahman' },
];

export const SCENARIOS: Seed[] = [
  { name: 'Hanbit Tours Co.', country: 'Korea', region: 'North East Asia', ccy: 'KRW', owner: 0, scenario: 'GOOD_LARGE_NOT_DUE', terms: 30, limitUsd: 600_000 },
  { name: 'Sakura Voyage K.K.', country: 'Japan', region: 'North East Asia', ccy: 'JPY', owner: 1, scenario: 'LONG_OVERDUE', terms: 14, limitUsd: 120_000 },
  { name: 'Mekong Holidays JSC', country: 'Vietnam', region: 'South East Asia', ccy: 'VND', owner: 2, scenario: 'OVER_90', terms: 14, limitUsd: 20_000 },
  { name: 'Formosa Travel Hub', country: 'Taiwan', region: 'Greater China', ccy: 'TWD', owner: 3, scenario: 'BROKEN_PROMISE', terms: 14, limitUsd: 90_000 },
  { name: 'Siam Getaways Ltd.', country: 'Thailand', region: 'South East Asia', ccy: 'THB', owner: 4, scenario: 'DISPUTE', terms: 30, limitUsd: 80_000 },
  { name: 'Harbour Lights Travel', country: 'Hong Kong', region: 'Greater China', ccy: 'HKD', owner: 3, scenario: 'CREDIT_NOTE', terms: 14, limitUsd: 70_000 },
  { name: 'Lion City Journeys Pte.', country: 'Singapore', region: 'South East Asia', ccy: 'SGD', owner: 5, scenario: 'PARTIAL_PAYMENT', terms: 14, limitUsd: 50_000 },
  { name: 'Nusantara Trips PT', country: 'Indonesia', region: 'South East Asia', ccy: 'IDR', owner: 5, scenario: 'CREDIT_LIMIT_EXCEEDED', terms: 14, limitUsd: 25_000 },
  { name: 'Kimchi & Go Travel', country: 'Korea', region: 'North East Asia', ccy: 'KRW', owner: 0, scenario: 'RECENTLY_COLLECTED', terms: 14, limitUsd: 80_000 },
  { name: 'Fuji Peak Travel Inc.', country: 'Japan', region: 'North East Asia', ccy: 'JPY', owner: 1, scenario: 'SHARP_DETERIORATION', terms: 7, limitUsd: 150_000 },
  { name: 'Saigon Sky Tours', country: 'Vietnam', region: 'South East Asia', ccy: 'VND', owner: -1, scenario: 'MISSING_DATA', terms: undefined, limitUsd: null },
  { name: 'Manila Bay Travel Corp.', country: 'Philippines', region: 'South East Asia', ccy: 'PHP', owner: 5, scenario: 'CANCELLED_BOOKING', terms: 14, limitUsd: 40_000 },
  { name: 'Kuala Journeys Sdn Bhd', country: 'Malaysia', region: 'South East Asia', ccy: 'MYR', owner: 5, scenario: 'REFUND_UNAPPLIED', terms: 14, limitUsd: 45_000 },
  { name: 'Busan Marine Travel', country: 'Korea', region: 'North East Asia', ccy: 'USD', owner: 0, scenario: 'MULTI_CURRENCY', terms: 30, limitUsd: 100_000 },
  { name: 'Tokyo Nights Travel', country: 'Japan', region: 'North East Asia', ccy: 'JPY', owner: 1, scenario: 'NORMAL_NOT_DUE', terms: 14, limitUsd: 60_000 },
  // generic portfolio
  { name: 'Seoul Express Holidays', country: 'Korea', region: 'North East Asia', ccy: 'KRW', owner: 0, scenario: 'GENERIC' },
  { name: 'Jeju Blue Travel', country: 'Korea', region: 'North East Asia', ccy: 'KRW', owner: 0, scenario: 'GENERIC' },
  { name: 'Osaka Trip Partners', country: 'Japan', region: 'North East Asia', ccy: 'JPY', owner: 1, scenario: 'GENERIC' },
  { name: 'Kyoto Heritage Tours', country: 'Japan', region: 'North East Asia', ccy: 'JPY', owner: 1, scenario: 'GENERIC' },
  { name: 'Hokkaido Snow Travel', country: 'Japan', region: 'North East Asia', ccy: 'JPY', owner: 1, scenario: 'GENERIC' },
  { name: 'Hanoi Lotus Travel', country: 'Vietnam', region: 'South East Asia', ccy: 'VND', owner: 2, scenario: 'GENERIC' },
  { name: 'Da Nang Coastal Tours', country: 'Vietnam', region: 'South East Asia', ccy: 'VND', owner: 2, scenario: 'GENERIC' },
  { name: 'Taipei Metro Travel', country: 'Taiwan', region: 'Greater China', ccy: 'TWD', owner: 3, scenario: 'GENERIC' },
  { name: 'Kaohsiung Sun Tours', country: 'Taiwan', region: 'Greater China', ccy: 'TWD', owner: 3, scenario: 'GENERIC' },
  { name: 'Victoria Peak Holidays', country: 'Hong Kong', region: 'Greater China', ccy: 'HKD', owner: 3, scenario: 'GENERIC' },
  { name: 'Bangkok Riverside Travel', country: 'Thailand', region: 'South East Asia', ccy: 'THB', owner: 4, scenario: 'GENERIC' },
  { name: 'Chiang Mai Trails', country: 'Thailand', region: 'South East Asia', ccy: 'THB', owner: 4, scenario: 'GENERIC' },
  { name: 'Phuket Sunset Tours', country: 'Thailand', region: 'South East Asia', ccy: 'THB', owner: 4, scenario: 'GENERIC' },
  { name: 'Merlion Voyages', country: 'Singapore', region: 'South East Asia', ccy: 'SGD', owner: 5, scenario: 'GENERIC' },
  { name: 'Penang Heritage Travel', country: 'Malaysia', region: 'South East Asia', ccy: 'MYR', owner: 5, scenario: 'GENERIC' },
  { name: 'Bali Breeze Tours', country: 'Indonesia', region: 'South East Asia', ccy: 'IDR', owner: 5, scenario: 'GENERIC' },
  { name: 'Cebu Island Hoppers', country: 'Philippines', region: 'South East Asia', ccy: 'PHP', owner: 5, scenario: 'GENERIC' },
  { name: 'Incheon Gateway Travel', country: 'Korea', region: 'North East Asia', ccy: 'USD', owner: 0, scenario: 'GENERIC' },
  { name: 'Nagoya Central Tours', country: 'Japan', region: 'North East Asia', ccy: 'JPY', owner: 1, scenario: 'GENERIC' },
];

const HOTELS = ['Grand Sakura Hotel Tokyo', 'Harbor View Hotel Busan', 'Riverside Residence Saigon', 'Lotus Garden Hanoi', 'Marina Crest Singapore', 'Sukhumvit Plaza Bangkok', 'Kowloon Sky Hotel', 'Taipei Signature Inn', 'Osaka Riverside Hotel', 'Jeju Ocean Resort', 'Da Nang Beachfront Resort', 'Kyoto Machiya Stay'];
const DEST = ['Tokyo', 'Busan', 'Ho Chi Minh City', 'Hanoi', 'Singapore', 'Bangkok', 'Hong Kong', 'Taipei', 'Osaka', 'Jeju', 'Da Nang', 'Kyoto'];

export interface MockDataset extends ReceivablesDataset {
  scenario_index: Record<string, Scenario>;
}

export function generateMockDataset(referenceDate: ISODate, seed = 20260905, reporting = DEFAULT_REPORTING_CURRENCY): MockDataset {
  const rnd = mulberry32(seed);
  const fx = mockFxTable(referenceDate, referenceDate, reporting);
  const rate = (ccy: string) => MOCK_FX_USD[ccy] ?? 1;
  /** Convert a USD magnitude to a rounded local-currency amount. */
  const local = (usd: number, ccy: string) => {
    const v = usd / rate(ccy);
    const zeroDec = ['JPY', 'KRW', 'VND', 'IDR', 'TWD'].includes(ccy);
    return zeroDec ? Math.round(v / 100) * 100 : round2(v);
  };

  const customers: Customer[] = [];
  const invoices: Invoice[] = [];
  const payments: Payment[] = [];
  const activities: CollectionActivity[] = [];
  const bookings: BookingContext[] = [];
  const scenario_index: Record<string, Scenario> = {};
  let invSeq = 1000;
  let paySeq = 5000;
  let actSeq = 9000;
  let bkSeq = 1;

  const day = (n: number) => addDays(referenceDate, n);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

  function addInvoice(c: Customer, opts: { usd: number; serviceOffset: number; ccy?: string; terms?: number | null; dueOverride?: ISODate | null; status?: Invoice['invoice_status']; cancel?: boolean; dispute?: { amountUsd: number; reason: string }; creditUsd?: number }): Invoice {
    const ccy = opts.ccy ?? c.contract_currency;
    const service = day(opts.serviceOffset);
    const invoiceDate = service;
    const terms = opts.terms === undefined ? (c.payment_terms_days ?? 14) : opts.terms;
    const due = opts.dueOverride !== undefined ? opts.dueOverride : terms === null ? null : addDays(service, terms);
    const original = local(opts.usd, ccy);
    const credit = opts.creditUsd ? local(opts.creditUsd, ccy) : 0;
    const bookingId = `S26${String(bkSeq++).padStart(6, '0')}H01`;
    const hotelIdx = between(0, HOTELS.length - 1);
    const cancelled = !!opts.cancel;
    bookings.push({
      booking_id: bookingId,
      check_in: addDays(service, -between(1, 4)),
      check_out: service,
      hotel_name: HOTELS[hotelIdx],
      destination: DEST[hotelIdx],
      booking_amount: original,
      booking_currency: ccy,
      booking_status: cancelled ? 'Cancelled' : 'Confirmed',
      cancellation_penalty: cancelled ? 0 : null,
      supplier_payment_status: cancelled ? 'N/A' : rnd() > 0.5 ? 'Paid' : 'Scheduled',
      net_revenue: cancelled ? 0 : round2(original * 0.06),
    });
    const inv: Invoice = {
      invoice_id: `inv-${invSeq}`,
      invoice_number: `INV-2026-${String(invSeq++).padStart(5, '0')}`,
      booking_id: bookingId,
      customer_id: c.customer_id,
      invoice_date: invoiceDate,
      service_date: service,
      due_date: due,
      original_amount: original,
      paid_amount: 0,
      credit_note_amount: credit,
      disputed_amount: opts.dispute ? local(opts.dispute.amountUsd, ccy) : 0,
      outstanding_amount: cancelled ? 0 : round2(original - credit),
      invoice_currency: ccy,
      invoice_status: cancelled ? 'CANCELLED' : opts.dispute ? 'DISPUTED' : credit > 0 ? 'CREDITED' : (opts.status ?? 'OPEN'),
      dispute_status: opts.dispute ? 'OPEN' : 'NONE',
      dispute_reason: opts.dispute?.reason ?? null,
      cancellation_status: cancelled ? 'CANCELLED' : 'NONE',
      last_payment_date: null,
      last_payment_amount: null,
      data_source: 'mock',
    };
    if (inv.invoice_status === 'CREDITED' && inv.outstanding_amount > 0) inv.invoice_status = 'OPEN';
    invoices.push(inv);
    return inv;
  }

  function pay(inv: Invoice, c: Customer, dateOffset: number, amountLocal: number, method: Payment['payment_method'] = 'BANK_TRANSFER', opts: { unapplied?: number; status?: Payment['reconciliation_status']; confirmedAt?: string | null; reconciledAt?: string | null } = {}) {
    const unapplied = opts.unapplied ?? 0;
    const p: Payment = {
      payment_id: `pay-${paySeq++}`,
      invoice_id: inv.invoice_id,
      customer_id: c.customer_id,
      payment_date: day(dateOffset),
      payment_amount: round2(amountLocal + unapplied),
      payment_currency: inv.invoice_currency,
      applied_amount: amountLocal,
      unapplied_amount: unapplied,
      payment_method: method,
      payment_reference: `TT-${String(paySeq).padStart(6, '0')}`,
      reconciliation_status: opts.status ?? (unapplied > 0 ? 'PARTIALLY_APPLIED' : 'APPLIED'),
      // ELLIS reflection chain: most payments verified next day and reconciled weekly; some Singapore-managed payments lag on purpose (CEO scenario).
      confirmed_at: opts.confirmedAt !== undefined ? opts.confirmedAt : day(dateOffset + 1) <= referenceDate ? day(dateOffset + 1) : null,
      reconciled_at: opts.reconciledAt !== undefined ? opts.reconciledAt : dateOffset <= -8 ? day(Math.min(-1, dateOffset + 7)) : null,
      data_source: 'mock',
    };
    payments.push(p);
    inv.paid_amount = round2(inv.paid_amount + amountLocal);
    inv.outstanding_amount = Math.max(0, round2(inv.original_amount - inv.paid_amount - inv.credit_note_amount));
    inv.last_payment_date = p.payment_date;
    inv.last_payment_amount = amountLocal;
    if (inv.outstanding_amount <= 0) inv.invoice_status = 'PAID';
    else if (inv.paid_amount > 0 && inv.invoice_status === 'OPEN') inv.invoice_status = 'PARTIALLY_PAID';
    return p;
  }

  function act(c: Customer, inv: Invoice | null, dateOffset: number, type: CollectionActivity['activity_type'], note: string, extra: Partial<CollectionActivity> = {}) {
    const a: CollectionActivity = {
      activity_id: `act-${actSeq++}`,
      customer_id: c.customer_id,
      invoice_id: inv?.invoice_id ?? null,
      owner: c.account_owner_name || 'Unassigned',
      activity_type: type,
      activity_date: day(dateOffset),
      contact_channel: c.preferred_contact_channel ?? 'EMAIL',
      note,
      promised_payment_date: null,
      promised_payment_amount: null,
      promised_currency: null,
      next_action: null,
      next_action_date: null,
      escalation_level: 0,
      completed: false,
      ...extra,
    };
    activities.push(a);
    return a;
  }

  SCENARIOS.forEach((s, idx) => {
    const owner = s.owner >= 0 ? OWNERS[s.owner] : { id: '', name: '' };
    const c: Customer = {
      customer_id: `cust-${String(idx + 1).padStart(3, '0')}`,
      customer_name: s.name,
      customer_group: s.region === 'North East Asia' ? 'NEA Key Accounts' : null,
      country: s.country,
      region: s.region,
      account_owner_id: owner.id,
      account_owner_name: owner.name,
      finance_owner: 'Finance Team VN',
      contract_currency: s.ccy,
      payment_terms_days: s.terms === undefined ? (s.scenario === 'MISSING_DATA' ? null : 14) : s.terms,
      credit_limit: s.limitUsd === undefined ? local(between(60, 140) * 1000, s.ccy) : s.limitUsd === null ? null : local(s.limitUsd, s.ccy),
      credit_status: 'ACTIVE',
      customer_status: 'ACTIVE',
      collection_status: 'NORMAL',
      risk_grade_manual: null,
      preferred_contact_channel: pick(['EMAIL', 'TEAMS', 'PHONE', 'WHATSAPP', 'KAKAO', 'LINE', 'ZALO']) as Customer['preferred_contact_channel'],
      // Receivables management moved from Seoul-only to Seoul + Singapore: NEA managed in Seoul, SEA / Greater China in Singapore.
      control_company: s.scenario === 'MISSING_DATA' ? null : s.region === 'North East Asia' ? 'OMH Seoul' : 'OMH Singapore',
      data_source: 'mock',
    };
    customers.push(c);
    scenario_index[c.customer_id] = s.scenario;

    switch (s.scenario) {
      case 'GOOD_LARGE_NOT_DUE': {
        // Big balances, all inside terms, excellent payment history.
        for (let k = 0; k < 6; k++) addInvoice(c, { usd: between(60, 95) * 1000, serviceOffset: -between(2, 24) });
        for (let k = 0; k < 4; k++) {
          const inv = addInvoice(c, { usd: between(50, 80) * 1000, serviceOffset: -between(40, 70) });
          pay(inv, c, -between(8, 38), inv.original_amount);
        }
        break;
      }
      case 'LONG_OVERDUE': {
        addInvoice(c, { usd: 42_000, serviceOffset: -72 }); // due 58 days ago
        addInvoice(c, { usd: 18_500, serviceOffset: -60 }); // due 46 days ago
        addInvoice(c, { usd: 9_800, serviceOffset: -33 }); // due 19 days ago
        addInvoice(c, { usd: 12_400, serviceOffset: -9 }); // not yet due
        const old = addInvoice(c, { usd: 22_000, serviceOffset: -95 });
        pay(old, c, -70, old.original_amount);
        act(c, invoices[invoices.length - 5], -30, 'REMINDER', 'First overdue reminder sent');
        act(c, invoices[invoices.length - 5], -16, 'CALL', 'AP contact says approval pending at HQ', { next_action: 'Send statement of account and request payment plan', next_action_date: day(-2) });
        c.collection_status = 'REMINDER';
        break;
      }
      case 'OVER_90': {
        addInvoice(c, { usd: 15_800, serviceOffset: -125 }); // due 111 days ago
        addInvoice(c, { usd: 7_200, serviceOffset: -110 }); // due 96 days ago
        addInvoice(c, { usd: 4_100, serviceOffset: -50 }); // due 36 days ago
        act(c, null, -60, 'ESCALATION', 'Escalated to Sales leader; customer cites cash-flow issues', { escalation_level: 2 });
        act(c, invoices[invoices.length - 3], -45, 'PROMISE', 'Customer promised to clear the oldest invoice', { promised_payment_date: day(-30), promised_payment_amount: invoices[invoices.length - 3].original_amount, promised_currency: c.contract_currency, escalation_level: 2 });
        act(c, null, -20, 'EMAIL', 'Formal notice sent; no reply', { next_action: 'Finance leader to decide credit hold', next_action_date: day(-5), escalation_level: 2 });
        c.collection_status = 'ESCALATED';
        c.credit_status = 'ON_HOLD';
        break;
      }
      case 'BROKEN_PROMISE': {
        const a = addInvoice(c, { usd: 38_000, serviceOffset: -36 }); // due 22 days ago
        const b = addInvoice(c, { usd: 24_000, serviceOffset: -25 }); // due 11 days ago
        addInvoice(c, { usd: 15_000, serviceOffset: -6 });
        act(c, a, -12, 'PROMISE', 'Customer promised to settle both overdue invoices', { promised_payment_date: day(-3), promised_payment_amount: round2(a.original_amount + b.original_amount), promised_currency: c.contract_currency, next_action: 'Confirm remittance advice', next_action_date: day(-3) });
        c.collection_status = 'REMINDER';
        break;
      }
      case 'DISPUTE': {
        addInvoice(c, { usd: 27_500, serviceOffset: -55, dispute: { amountUsd: 9_500, reason: 'Rate discrepancy vs contract (3 room nights)' } }); // due 25 days ago
        addInvoice(c, { usd: 14_000, serviceOffset: -20 });
        addInvoice(c, { usd: 8_300, serviceOffset: -5 });
        act(c, invoices[invoices.length - 3], -22, 'DISPUTE', 'Customer disputes 3 room nights billed at wrong rate; Ops to verify', { next_action: 'Ops to send rate confirmation and issue credit note if valid', next_action_date: day(-4) });
        break;
      }
      case 'CREDIT_NOTE': {
        const inv = addInvoice(c, { usd: 19_000, serviceOffset: -30, creditUsd: 4_000 }); // due 16 days ago, outstanding 15k
        pay(inv, c, -10, local(5_000, c.contract_currency), 'BANK_TRANSFER', { confirmedAt: day(-9), reconciledAt: null }); // verified but not reconciled for 9 days
        addInvoice(c, { usd: 11_200, serviceOffset: -12 });
        addInvoice(c, { usd: 6_700, serviceOffset: -3 });
        break;
      }
      case 'PARTIAL_PAYMENT': {
        const inv = addInvoice(c, { usd: 32_000, serviceOffset: -28 }); // due 14 days ago
        pay(inv, c, -9, local(20_000, c.contract_currency), 'BANK_TRANSFER', { confirmedAt: null, reconciledAt: null }); // recorded in ELLIS, never verified (chain gap)
        const inv2 = addInvoice(c, { usd: 9_500, serviceOffset: -16 });
        pay(inv2, c, -1, local(4_000, c.contract_currency));
        addInvoice(c, { usd: 7_800, serviceOffset: -4 });
        act(c, inv, -8, 'EMAIL', 'Partial payment received; balance promised after month-end close', { promised_payment_date: day(4), promised_payment_amount: local(12_000, c.contract_currency), promised_currency: c.contract_currency });
        break;
      }
      case 'CREDIT_LIMIT_EXCEEDED': {
        // limit 25k USD, balance ~34k, mostly current with one short overdue
        addInvoice(c, { usd: 13_000, serviceOffset: -20 }); // due 6 days ago
        addInvoice(c, { usd: 12_500, serviceOffset: -8 });
        addInvoice(c, { usd: 8_700, serviceOffset: -2 });
        break;
      }
      case 'RECENTLY_COLLECTED': {
        const a = addInvoice(c, { usd: 28_000, serviceOffset: -40 });
        pay(a, c, -4, a.original_amount); // collected this week
        const b = addInvoice(c, { usd: 16_500, serviceOffset: -30 });
        pay(b, c, -2, b.original_amount); // collected this week
        addInvoice(c, { usd: 9_900, serviceOffset: -6 });
        break;
      }
      case 'SHARP_DETERIORATION': {
        // Terms 7d; three large invoices fell due inside the week and none were paid.
        addInvoice(c, { usd: 46_000, serviceOffset: -12 }); // due 5 days ago
        addInvoice(c, { usd: 31_000, serviceOffset: -10 }); // due 3 days ago
        addInvoice(c, { usd: 22_500, serviceOffset: -9 }); // due 2 days ago
        addInvoice(c, { usd: 17_000, serviceOffset: -4 }); // due in 3 days
        const old = addInvoice(c, { usd: 35_000, serviceOffset: -50 });
        pay(old, c, -41, old.original_amount);
        break;
      }
      case 'MISSING_DATA': {
        addInvoice(c, { usd: 6_800, serviceOffset: -25, terms: null }); // missing due date
        addInvoice(c, { usd: 4_200, serviceOffset: -10, dueOverride: day(4) });
        addInvoice(c, { usd: 3_100, serviceOffset: -40, dueOverride: day(-26) });
        break;
      }
      case 'CANCELLED_BOOKING': {
        addInvoice(c, { usd: 12_000, serviceOffset: -15, cancel: true });
        addInvoice(c, { usd: 9_400, serviceOffset: -18 }); // due 4 days ago
        addInvoice(c, { usd: 5_600, serviceOffset: -7 });
        break;
      }
      case 'REFUND_UNAPPLIED': {
        const inv = addInvoice(c, { usd: 14_000, serviceOffset: -35 });
        pay(inv, c, -20, inv.original_amount, 'BANK_TRANSFER', { unapplied: local(2_500, c.contract_currency) }); // overpaid: unapplied cash
        const inv2 = addInvoice(c, { usd: 7_700, serviceOffset: -22, cancel: true });
        // refund of a payment made against the cancelled booking
        payments.push({ payment_id: `pay-${paySeq++}`, invoice_id: inv2.invoice_id, customer_id: c.customer_id, payment_date: day(-15), payment_amount: -local(7_700, c.contract_currency), payment_currency: c.contract_currency, applied_amount: 0, unapplied_amount: 0, payment_method: 'BANK_TRANSFER', payment_reference: 'REFUND-0031', reconciliation_status: 'REFUNDED', confirmed_at: day(-14), reconciled_at: day(-8), data_source: 'mock' });
        addInvoice(c, { usd: 10_300, serviceOffset: -9 });
        break;
      }
      case 'MULTI_CURRENCY': {
        addInvoice(c, { usd: 21_000, serviceOffset: -20, ccy: 'USD' });
        addInvoice(c, { usd: 13_500, serviceOffset: -45, ccy: 'KRW' }); // due 15 days ago
        addInvoice(c, { usd: 9_000, serviceOffset: -10, ccy: 'USD' });
        addInvoice(c, { usd: 6_500, serviceOffset: -5, ccy: 'JPY' });
        break;
      }
      case 'NORMAL_NOT_DUE': {
        for (let k = 0; k < 4; k++) addInvoice(c, { usd: between(4, 12) * 1000, serviceOffset: -between(1, 12) });
        const old = addInvoice(c, { usd: 8_000, serviceOffset: -40 });
        pay(old, c, -25, old.original_amount);
        break;
      }
      case 'GENERIC':
      default: {
        const n = between(3, 6);
        for (let k = 0; k < n; k++) {
          const r = rnd();
          if (r < 0.55) addInvoice(c, { usd: between(2, 15) * 1000, serviceOffset: -between(1, 12) }); // current
          else if (r < 0.8) addInvoice(c, { usd: between(2, 12) * 1000, serviceOffset: -between(16, 26) }); // 2-12 days overdue
          else if (r < 0.9) addInvoice(c, { usd: between(2, 8) * 1000, serviceOffset: -between(30, 44) }); // 16-30 days overdue
          else {
            const inv = addInvoice(c, { usd: between(5, 20) * 1000, serviceOffset: -between(30, 60) });
            pay(inv, c, -between(2, 20), inv.original_amount);
          }
        }
        // historical paid invoices for realistic collection history
        for (let k = 0; k < 2; k++) {
          const inv = addInvoice(c, { usd: between(3, 14) * 1000, serviceOffset: -between(60, 84) });
          pay(inv, c, -between(30, 55), inv.original_amount);
        }
        if (rnd() < 0.4) act(c, null, -between(1, 10), 'REMINDER', 'Routine statement of account sent');
      }
    }
  });

  return {
    as_of: `${referenceDate}T02:00:00.000Z`,
    source: 'mock',
    reporting_currency: reporting,
    fx,
    customers,
    invoices,
    payments,
    activities,
    bookings,
    completeness: {
      customers: 'full',
      invoices: 'partial',
      payments: 'full',
      activities: 'partial',
      fx: 'full',
      notes: ['MOCK DATA: fictional customers, invoices and payments. One invoice intentionally lacks a due date and one customer lacks owner/credit limit (data-quality scenario).'],
    },
    scenario_index,
  };
}

/** 12 weekly Saturday snapshot dates ending at the reference date (oldest first). */
export function weeklyDates(referenceDate: ISODate, weeks = 12): ISODate[] {
  return Array.from({ length: weeks }, (_, i) => addDays(referenceDate, -7 * (weeks - 1 - i)));
}
