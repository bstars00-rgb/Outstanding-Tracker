import { addDays } from '@core/dates';
import { round2 } from '@core/money';
import type { BookingContext, Customer, DatasetCompleteness, FxTable, Invoice, ISODate, ReceivablesDataset } from '@core/types';
import { type McpToolClient, type ReceivablesSource, ToolNotConfirmedError } from './types';

/**
 * ===== CONFIRMED Ellis MCP surface (observed in production use, 2026-08/09) =====
 * Tool:   get_hotel_bookings
 * Args:   dateBasis ("BOOKING_DATE" confirmed; others unconfirmed), fromDate, toDate (YYYY-MM-DD),
 *         countryCode (country name string, e.g. "Japan"), limit (500 recommended; larger => upstream timeout), offset
 * Result: { list: EllisBookingRecord[], totalCount: number }   (some builds return `records` instead of `list`)
 * Record: see EllisBookingRecord below. baseCurrencyCode is always "KRW"; fxRate = local -> KRW.
 *
 * ===== NOT CONFIRMED (Required from Ellis team) =====
 * Invoice / receivable ledger, payments, credit notes, customer master (IDs, credit limits, payment terms, owners),
 * collection activities. Until those tools exist the adapter can only run in "bookings-derived" mode, which
 * approximates receivables from post-paid ("Cash") bookings and is clearly labelled as such.
 */
export interface EllisBookingRecord {
  bookingItemCode: string;
  bookingDate: string; // "YYYY-MM-DD HH:mm:ss"
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string; // YYYY-MM-DD
  sellerName: string;
  hotelName: string;
  hotelCode: number | null;
  hotelLegacyCode: string | null;
  hotelCountry: string;
  hotelCity: string;
  hotelChainName: string | null;
  roomTypeCode: string | null;
  roomTypeName: string;
  ratePlanName: string;
  roomPlanCode: string | null;
  promotionName: string | null;
  promotionCode: string | null;
  roomNights: number;
  roomCount: number;
  paxCount: number;
  contractType: string | null; // Dynamic Rate | Shared Rate | Exclusive Rate
  cmsName: string;
  sellerBookingCode: string | null;
  paymentMethod: 'Cash' | 'Card' | 'VCC' | null;
  billing: number; // amount in `currency`
  revenue: number;
  currency: string; // USD | KRW | JPY | VND ...
  baseCurrencyCode: string; // KRW
  fxRate: number; // currency -> KRW
  bookingStatus: string; // Confirmed | Reserved | Cancelled | Cancelled(Replied) | Pending | Unavailable | Cancel Request
  cancelDate: string | null;
  guestName?: string; // PII: must be dropped immediately, never stored
}

export interface GetHotelBookingsArgs {
  dateBasis: 'BOOKING_DATE' | 'CHECK_IN_DATE' | 'CHECK_OUT_DATE';
  fromDate: ISODate;
  toDate: ISODate;
  countryCode?: string;
  limit: number;
  offset: number;
}

export interface EllisLiveConfig {
  reportingCurrency: string;
  /** Reporting-currency FX table (rates to reporting currency); Ellis only supplies local->KRW rates. */
  fx: FxTable;
  /** Countries to iterate (Ellis times out on all-country pulls). */
  countries: string[];
  /** Lookback window in days for CHECK_OUT/BOOKING date pulls. */
  lookbackDays: number;
  /** Assumed payment terms when the customer master is unavailable. */
  assumedPaymentTermsDays: number;
  pageSize: number;
  /** Assumed: post-paid bookings that create a receivable. */
  receivablePaymentMethods: string[];
  /** Assumed: statuses that represent a delivered/billable service. */
  billableStatuses: string[];
}

export const DEFAULT_LIVE_CONFIG: Omit<EllisLiveConfig, 'fx' | 'reportingCurrency'> = {
  countries: ['Japan', 'Korea', 'Vietnam', 'Taiwan', 'Thailand', 'Hong Kong', 'Macao', 'Malaysia', 'Singapore', 'Indonesia', 'China', 'Philippines'],
  lookbackDays: 120,
  assumedPaymentTermsDays: 14,
  pageSize: 500,
  receivablePaymentMethods: ['Cash'],
  billableStatuses: ['Confirmed'],
};

export class EllisMcpReceivablesSource implements ReceivablesSource {
  readonly name = 'ellis-mcp';
  readonly kind = 'ellis-bookings-derived' as const;
  private readonly cfg: EllisLiveConfig;

  constructor(private readonly client: McpToolClient, cfg: Partial<EllisLiveConfig> & Pick<EllisLiveConfig, 'fx' | 'reportingCurrency'>) {
    this.cfg = { ...DEFAULT_LIVE_CONFIG, ...cfg };
  }

  async healthCheck() {
    try {
      const tools = await this.client.listTools();
      const has = tools.some((t) => t.name === 'get_hotel_bookings');
      return { ok: has, detail: has ? `tools/list ok (${tools.length} tools; get_hotel_bookings present)` : `get_hotel_bookings not exposed; tools: ${tools.map((t) => t.name).join(', ')}` };
    } catch (e) {
      return { ok: false, detail: `tools/list failed: ${(e as Error).message}` };
    }
  }

  /** Confirmed tool, paginated per country. Strips guestName (PII) before returning. */
  async fetchBookings(fromDate: ISODate, toDate: ISODate, dateBasis: GetHotelBookingsArgs['dateBasis'] = 'BOOKING_DATE'): Promise<EllisBookingRecord[]> {
    const out = new Map<string, EllisBookingRecord>();
    for (const country of this.cfg.countries) {
      let offset = 0;
      let total = Infinity;
      let pulled = 0;
      while (pulled < total) {
        const args: GetHotelBookingsArgs = { dateBasis, fromDate, toDate, countryCode: country, limit: this.cfg.pageSize, offset };
        const res = await this.client.callTool<{ list?: EllisBookingRecord[]; records?: EllisBookingRecord[]; totalCount?: number }>('get_hotel_bookings', args as unknown as Record<string, unknown>);
        const list = res.list ?? res.records ?? [];
        total = typeof res.totalCount === 'number' ? res.totalCount : list.length;
        for (const r of list) {
          const { guestName: _pii, ...safe } = r; // never keep guest names
          void _pii;
          if (safe.bookingItemCode) out.set(String(safe.bookingItemCode), safe as EllisBookingRecord); // last write wins (cancellations)
        }
        pulled += list.length;
        offset += this.cfg.pageSize;
        if (list.length === 0) break;
      }
    }
    return [...out.values()];
  }

  // ---- Not-confirmed capabilities: fail loudly instead of inventing data ----
  async fetchInvoices(): Promise<never> {
    throw new ToolNotConfirmedError('invoices / receivable ledger', 'e.g. get_receivables | get_invoices (name to be confirmed)');
  }
  async fetchPayments(): Promise<never> {
    throw new ToolNotConfirmedError('payments / collections', 'e.g. get_payments | get_collections (name to be confirmed)');
  }
  async fetchCustomers(): Promise<never> {
    throw new ToolNotConfirmedError('customer master (ID, credit limit, terms, owner)', 'e.g. get_sellers | get_customers (name to be confirmed)');
  }
  async fetchActivities(): Promise<never> {
    throw new ToolNotConfirmedError('collection activities', 'no Ellis tool expected; tracker-owned store (see ARCHITECTURE.md)');
  }

  /**
   * Bookings-derived dataset (ASSUMED model, clearly labelled): every billable post-paid booking becomes one
   * invoice line; due date = checkout + assumed terms; no payments are known => everything is treated as open.
   * This is only good enough to exercise the pipeline end-to-end against the real connector; it must NOT be
   * presented as actual receivables until the ledger tools are confirmed.
   */
  async fetchDataset(referenceDate: ISODate): Promise<ReceivablesDataset> {
    const from = addDays(referenceDate, -this.cfg.lookbackDays);
    const bookings = await this.fetchBookings(from, referenceDate, 'BOOKING_DATE');
    return bookingsToDataset(bookings, referenceDate, this.cfg);
  }
}

/** Pure mapping so it can be unit-tested without a client. */
export function bookingsToDataset(records: EllisBookingRecord[], referenceDate: ISODate, cfg: EllisLiveConfig): ReceivablesDataset {
  const customers = new Map<string, Customer>();
  const invoices: Invoice[] = [];
  const bookings: BookingContext[] = [];
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  for (const r of records) {
    if (!cfg.receivablePaymentMethods.includes(r.paymentMethod ?? '')) continue;
    if (!r.sellerName) continue;
    const customerId = `seller:${slug(r.sellerName)}`; // ASSUMED: no seller ID exposed; name used as key
    if (!customers.has(customerId)) {
      customers.set(customerId, {
        customer_id: customerId,
        customer_name: r.sellerName,
        customer_group: null,
        country: 'Unknown', // seller country is NOT in the booking record (hotelCountry is the destination)
        region: 'Unknown',
        account_owner_id: '',
        account_owner_name: '',
        finance_owner: null,
        contract_currency: r.currency,
        payment_terms_days: cfg.assumedPaymentTermsDays,
        credit_limit: null,
        credit_status: 'ACTIVE',
        customer_status: 'ACTIVE',
        collection_status: 'NORMAL',
        risk_grade_manual: null,
        preferred_contact_channel: null,
        data_source: 'ellis-mcp:get_hotel_bookings (derived)',
      });
    }
    const cancelled = /cancel/i.test(r.bookingStatus);
    const billable = cfg.billableStatuses.includes(r.bookingStatus) && r.checkOutDate <= referenceDate;
    if (!billable && !cancelled) continue; // Reserved / Pending / future stays are not receivables yet
    const amount = round2(Number(r.billing) || 0);
    bookings.push({
      booking_id: r.bookingItemCode,
      check_in: r.checkInDate,
      check_out: r.checkOutDate,
      hotel_name: r.hotelName,
      destination: `${r.hotelCity}, ${r.hotelCountry}`,
      booking_amount: amount,
      booking_currency: r.currency,
      booking_status: r.bookingStatus,
      cancellation_penalty: null,
      supplier_payment_status: null,
      net_revenue: Number(r.revenue) || null,
    });
    invoices.push({
      invoice_id: `bk:${r.bookingItemCode}`,
      invoice_number: r.bookingItemCode,
      booking_id: r.bookingItemCode,
      customer_id: customerId,
      invoice_date: r.checkOutDate,
      service_date: r.checkOutDate,
      due_date: addDays(r.checkOutDate, cfg.assumedPaymentTermsDays),
      original_amount: cancelled ? 0 : amount,
      paid_amount: 0,
      credit_note_amount: 0,
      disputed_amount: 0,
      outstanding_amount: cancelled ? 0 : amount,
      invoice_currency: r.currency,
      invoice_status: cancelled ? 'CANCELLED' : 'OPEN',
      dispute_status: 'NONE',
      dispute_reason: null,
      cancellation_status: cancelled ? 'CANCELLED' : 'NONE',
      last_payment_date: null,
      last_payment_amount: null,
      data_source: 'ellis-mcp:get_hotel_bookings (derived)',
    });
  }
  const completeness: DatasetCompleteness = {
    customers: 'partial',
    invoices: 'partial',
    payments: 'missing',
    activities: 'missing',
    fx: cfg.fx.rates.length ? 'full' : 'missing',
    notes: [
      'DERIVED FROM BOOKINGS: invoices approximated from post-paid (Cash) confirmed bookings with checkout <= reference date.',
      `Due date assumed = checkout + ${cfg.assumedPaymentTermsDays} days (customer master not available).`,
      'Payments are unknown: all derived invoices appear open. Collected/overdue figures are NOT reliable in this mode.',
      'Seller country, credit limit, account owner are not present in get_hotel_bookings.',
    ],
  };
  return {
    as_of: new Date().toISOString(),
    source: 'ellis-bookings-derived',
    reporting_currency: cfg.reportingCurrency,
    fx: cfg.fx,
    customers: [...customers.values()],
    invoices,
    payments: [],
    activities: [],
    bookings,
    completeness,
  };
}
