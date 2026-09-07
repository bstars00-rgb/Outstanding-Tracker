import { describe, expect, it } from 'vitest';
import { appliedRatesToFxTable, ellisPaymentsToPayments, parsePaymentTermsDays, sellerInvoicesToInvoices, tradersToCustomers, type EllisPayment, type EllisSellerInvoice, type EllisTrader } from '@adapters/ellis/ellis-entities';
import { buildTrackerModel } from '@core/calc';
import { validateDataset } from '@core/validate';
import type { ReceivablesDataset } from '@core/types';

const inv = (over: Partial<EllisSellerInvoice> = {}): EllisSellerInvoice => ({
  invoiceSeq: 10001,
  paymentStatus: 'Unpaid',
  controlCompName: 'OhMyHotel Japan',
  sellerCompCode: 'S0001',
  sellerCompName: 'Fictional Seller A',
  sellerOperationName: null,
  billingCurrencyCode: 'USD',
  billingSumAmount: 1000,
  paidSumAmount: 0,
  balanceAmount: 1000,
  issuedDate: '2026-08-20',
  dueDate: '2026-09-03',
  remark: null,
  bookings: [
    { bookingItemCode: 'S26081810811H01', bookingStatusName: 'Confirmed', clientPaymentStatusName: 'Not Paid', sellerBookingCode: null, hotelCountryName: 'Japan', hotelName: 'Test Hotel', checkInDate: '2026-08-15', checkOutDate: '2026-08-17', nights: 2, billingCurrencyCode: 'USD', billingSumAmount: 1000, paidSumAmount: 0, balanceAmount: 1000, revenue: 60, disputeYn: 'N', disputeRemark: null },
  ],
  ...over,
});

describe('ELLIS Playbook entity mapping', () => {
  it('maps seller invoices (Unpaid / Paid / Over Paid / disputed line) to tracker invoices', () => {
    const rows = [
      inv(),
      inv({ invoiceSeq: 10002, paymentStatus: 'Paid', paidSumAmount: 1000, balanceAmount: 0 }),
      inv({ invoiceSeq: 10003, paymentStatus: 'Over Paid', paidSumAmount: 1200, balanceAmount: -200 }),
      inv({ invoiceSeq: 10004, paidSumAmount: 400, balanceAmount: 600, bookings: [{ ...inv().bookings![0], balanceAmount: 600, paidSumAmount: 400, disputeYn: 'Y', disputeRemark: 'rate mismatch' }] }),
    ];
    const out = sellerInvoicesToInvoices(rows);
    expect(out.map((i) => [i.invoice_id, i.invoice_status, i.outstanding_amount])).toEqual([
      ['inv:10001', 'OPEN', 1000],
      ['inv:10002', 'PAID', 0],
      ['inv:10003', 'PAID', 0],
      ['inv:10004', 'DISPUTED', 600],
    ]);
    expect(out[3].disputed_amount).toBe(600);
    expect(out[3].dispute_reason).toBe('rate mismatch');
    expect(out[0].customer_id).toBe('seller:S0001');
    expect(out[0].service_date).toBe('2026-08-17');
    expect(out[2].paid_amount - out[2].original_amount).toBe(200); // over-payment surfaces as unapplied cash in the engine
  });

  it('maps Payment In/Out rows: sales deposits applied/unapplied, refunds, vendor rows ignored, unattributable dropped', () => {
    const pm = (o: Partial<EllisPayment>): EllisPayment => ({ paymentSeq: 1, salesOrVendor: 'S', bookingItemCode: null, depositWithdrawTypeCode: 'Deposit', paidDate: '2026-09-01', currencyCode: 'USD', firstDepositAmount: 500, depositAmount: 500, depositTypeName: 'Bank Transfer', traderCompCode: 'S0001', traderCompName: 'Fictional Seller A', invoiceSeq: 10001, sellerDisputeYn: 'N', paymentConfirmDate: '2026-09-01', ...o });
    const { payments, dropped } = ellisPaymentsToPayments([
      pm({}),
      pm({ paymentSeq: 2, invoiceSeq: null, depositTypeName: 'Card' }),
      pm({ paymentSeq: 3, depositWithdrawTypeCode: 'Withdraw', paymentDetailTypeName: 'Refund' }),
      pm({ paymentSeq: 4, salesOrVendor: 'V' }),
      pm({ paymentSeq: 5, traderCompCode: null }),
    ]);
    expect(payments.map((p) => [p.payment_id, p.applied_amount, p.unapplied_amount, p.reconciliation_status, p.payment_method])).toEqual([
      ['pm:1', 500, 0, 'APPLIED', 'BANK_TRANSFER'],
      ['pm:2', 0, 500, 'UNAPPLIED', 'CARD'],
      ['pm:3', 0, 0, 'REFUNDED', 'BANK_TRANSFER'],
    ]);
    expect(payments[2].payment_amount).toBe(-500);
    expect(dropped.map((d) => d.paymentSeq)).toEqual([5]);
  });

  it('maps traders (Seller tab) to customers with credit limit, terms and status', () => {
    const tr = (o: Partial<EllisTrader>): EllisTrader => ({ companyCode: 'S0001', companyName: 'Fictional Seller A', country: 'JP', status: 'Active', seller: { isSeller: true, sellerType: 'Regular Seller', creditLimit: 50000, paymentTerms: 'NET 30', currency: 'USD' }, ...o });
    const out = tradersToCustomers([tr({}), tr({ companyCode: 'V0001', seller: null }), tr({ companyCode: 'S0002', status: 'Suspended', seller: { isSeller: true, sellerType: 'API Seller', creditLimit: null, paymentTerms: 14, currency: 'KRW' } })]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ customer_id: 'seller:S0001', payment_terms_days: 30, credit_limit: 50000, contract_currency: 'USD', credit_status: 'ACTIVE', account_owner_id: '' });
    expect(out[1]).toMatchObject({ customer_id: 'seller:S0002', payment_terms_days: 14, credit_status: 'SUSPENDED', customer_status: 'INACTIVE' });
    expect(parsePaymentTermsDays('Prepaid')).toBe(0);
    expect(parsePaymentTermsDays('30 days')).toBe(30);
    expect(parsePaymentTermsDays(null)).toBeNull();
  });

  it('builds a JPY FX table from applied rates and the whole mapped dataset validates and calculates', () => {
    const fx = appliedRatesToFxTable(
      [
        { originCurrencyCode: 'USD', targetCurrencyCode: 'JPY', appliedRate: 147.2, announcedDatetime: '2026-09-05T09:00:00+09:00' },
        { originCurrencyCode: 'KRW', targetCurrencyCode: 'JPY', appliedRate: 0.106 },
        { originCurrencyCode: 'JPY', targetCurrencyCode: 'USD', appliedRate: 0.0068 },
      ],
      'JPY',
      '2026-09-05',
    );
    expect(fx.rates.map((r) => r.currency)).toEqual(['USD', 'KRW']);
    expect(fx.rates[0].rate_date).toBe('2026-09-05');

    const invoices = sellerInvoicesToInvoices([inv(), inv({ invoiceSeq: 10003, paymentStatus: 'Over Paid', paidSumAmount: 1200, balanceAmount: -200 })]);
    const customers = tradersToCustomers([{ companyCode: 'S0001', companyName: 'Fictional Seller A', country: 'JP', status: 'Active', seller: { isSeller: true, sellerType: 'Regular Seller', creditLimit: 5000, paymentTerms: 14, currency: 'USD' } }]);
    const { payments } = ellisPaymentsToPayments([{ paymentSeq: 9, salesOrVendor: 'S', bookingItemCode: null, depositWithdrawTypeCode: 'Deposit', paidDate: '2026-09-02', currencyCode: 'USD', firstDepositAmount: 1200, depositAmount: 1200, depositTypeName: 'Bank Transfer', traderCompCode: 'S0001', traderCompName: 'Fictional Seller A', invoiceSeq: 10003, sellerDisputeYn: 'N', paymentConfirmDate: '2026-09-02' }]);
    const ds: ReceivablesDataset = {
      as_of: '2026-09-05T02:00:00.000Z',
      source: 'ellis-mcp',
      reporting_currency: 'JPY',
      fx,
      customers,
      invoices,
      payments,
      activities: [],
      bookings: [],
      completeness: { customers: 'full', invoices: 'full', payments: 'full', activities: 'missing', fx: 'full', notes: [] },
    };
    const v = validateDataset(ds);
    expect(v.ok).toBe(true);
    const m = buildTrackerModel(ds, { referenceDate: '2026-09-05', previousSnapshot: null });
    expect(m.snapshot.totals.total_outstanding).toBe(147200); // 1,000 USD open invoice
    expect(m.snapshot.totals.overdue_outstanding).toBe(147200); // due 2026-09-03 < reference
    expect(m.snapshot.totals.unapplied_cash).toBe(29440); // 200 USD over-payment
    expect(m.snapshot.totals.collected_during_week).toBe(176640); // 1,200 USD applied on 2026-09-02
    expect(m.customers[0].credit_utilization).toBeCloseTo(147200 / (5000 * 147.2), 4);
  });
});
