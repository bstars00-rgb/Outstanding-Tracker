import { readFile } from 'node:fs/promises';
import type { ISODate, ReceivablesDataset } from '@core/types';
import { validateDataset } from '@core/validate';
import { appliedRatesToFxTable, ellisPaymentsToPayments, sellerInvoicesToInvoices, tradersToCustomers, type EllisAppliedRate, type EllisPayment, type EllisSellerInvoice, type EllisTrader } from './ellis-entities';
import type { ReceivablesSource } from './types';

/**
 * File source for the MANUAL operating mode: a person (Global Ops) pulls the data from the ELLIS MCP tools
 * through the AI Agent (SSO session), saves the raw tool results, and runs the pipeline with DATA_SOURCE=file.
 *
 * Two accepted layouts:
 *  A. `ReceivablesDataset` JSON (already in tracker schema) — used as-is.
 *  B. Raw ELLIS tool results: { sellerInvoices: [...], payments: [...], traders: [...], appliedRates?: [...], asOf?, reportingCurrency? }
 *     — mapped with the same functions the live adapter uses.
 */
export interface RawEllisExport {
  asOf?: string;
  reportingCurrency?: string;
  sellerInvoices: EllisSellerInvoice[];
  payments: EllisPayment[];
  traders: EllisTrader[];
  appliedRates?: EllisAppliedRate[];
  notes?: string[];
}

export class FileReceivablesSource implements ReceivablesSource {
  readonly name = 'file';
  readonly kind = 'file' as const;
  constructor(
    private readonly path: string,
    private readonly reportingCurrency: string,
    private readonly fallbackFx: ReceivablesDataset['fx'],
  ) {}

  async healthCheck() {
    try {
      await readFile(this.path, 'utf8');
      return { ok: true, detail: `file readable: ${this.path}` };
    } catch (e) {
      return { ok: false, detail: `cannot read ${this.path}: ${(e as Error).message}` };
    }
  }

  async fetchDataset(referenceDate: ISODate): Promise<ReceivablesDataset> {
    const raw = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
    if (isDataset(raw)) return raw;
    const x = raw as RawEllisExport;
    if (!Array.isArray(x.sellerInvoices) || !Array.isArray(x.payments) || !Array.isArray(x.traders)) {
      throw new Error('DATA_FILE must be a ReceivablesDataset or a raw ELLIS export with sellerInvoices[], payments[], traders[]');
    }
    const reporting = (x.reportingCurrency ?? this.reportingCurrency).toUpperCase();
    const rates = x.appliedRates ? appliedRatesToFxTable(x.appliedRates, reporting, referenceDate) : null;
    const fx = rates && rates.rates.length ? rates : { ...this.fallbackFx, reporting_currency: reporting };
    const customers = tradersToCustomers(x.traders);
    const known = new Set(customers.map((c) => c.customer_id));
    const invoices = sellerInvoicesToInvoices(x.sellerInvoices);
    for (const i of invoices) {
      if (!known.has(i.customer_id)) {
        const src = x.sellerInvoices.find((r) => `seller:${r.sellerCompCode.trim()}` === i.customer_id)!;
        customers.push({ customer_id: i.customer_id, customer_name: src.sellerCompName, customer_group: null, country: 'Unknown', region: '', account_owner_id: '', account_owner_name: '', finance_owner: null, contract_currency: src.billingCurrencyCode, payment_terms_days: null, credit_limit: null, credit_status: 'ACTIVE', customer_status: 'ACTIVE', collection_status: 'NORMAL', risk_grade_manual: null, preferred_contact_channel: null, control_company: src.controlCompName, data_source: 'ellis:seller-invoice (stub customer)' });
        known.add(i.customer_id);
      }
    }
    const byName = new Map(x.traders.map((t) => [t.companyName.trim().toLowerCase(), t.companyCode]));
    const { payments, dropped } = ellisPaymentsToPayments(x.payments, (r) => (r.traderCompName ? (byName.get(r.traderCompName.trim().toLowerCase()) ?? null) : null));
    const notes = [`Manual run: data loaded from ${this.path}`, rates && rates.rates.length ? 'FX: ELLIS applied exchange rates from the export.' : 'FX: fallback table (no appliedRates in export).', ...(x.notes ?? [])];
    if (dropped.length) notes.push(`${dropped.length} sales payment(s) without trader code were excluded.`);
    return {
      as_of: x.asOf ?? new Date().toISOString(),
      source: 'file',
      reporting_currency: reporting,
      fx,
      customers,
      invoices,
      payments,
      activities: [],
      bookings: [],
      completeness: { customers: 'full', invoices: 'full', payments: dropped.length ? 'partial' : 'full', activities: 'missing', fx: rates && rates.rates.length ? 'full' : 'partial', notes },
    };
  }
}

function isDataset(v: unknown): v is ReceivablesDataset {
  return !!v && typeof v === 'object' && 'invoices' in (v as object) && 'customers' in (v as object) && 'fx' in (v as object) && validateDataset(v).ok;
}
