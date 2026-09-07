import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatMoney } from '@core/money';
import { AGING_BUCKET_LABEL, AGING_BUCKETS, type CalculatedInvoice } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { PageHeader } from '@app/components/PageHeader';
import { DataTable, type Column } from '@app/components/DataTable';
import { FilterBar, SelectFilter, TextFilter, distinct } from '@app/components/FilterBar';
import { Money } from '@app/components/Money';
import { StatusPill, invoiceStatusTone } from '@app/components/StatusPill';
import { customerLink } from '@app/lib/links';
import { fmtDate } from '@app/lib/format';

const PARAMS = ['customer', 'bucket', 'owner', 'country', 'status', 'currency', 'q'] as const;
type Param = (typeof PARAMS)[number];

export function InvoicesPage() {
  const { model } = useReadyTracker();
  const ccy = model.reporting_currency;
  const [sp, setSp] = useSearchParams();
  const get = (k: Param) => sp.get(k) ?? '';
  const setParam = (k: Param) => (v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };
  const reset = () => {
    const next = new URLSearchParams(sp);
    PARAMS.forEach((k) => next.delete(k));
    setSp(next, { replace: true });
  };

  const all = model.invoices;
  const owners = distinct(all, (i) => i.account_owner_name || i.owner || 'Unassigned');
  const countries = distinct(all, (i) => i.country);
  const statuses = distinct(all, (i) => i.invoice_status);
  const currencies = distinct(all, (i) => i.invoice_currency);
  const customers = useMemo(() => [...new Map(all.map((i) => [i.customer_id, i.customer_name])).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)), [all]);

  const f = { customer: get('customer'), bucket: get('bucket'), owner: get('owner'), country: get('country'), status: get('status'), currency: get('currency'), q: get('q') };
  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return all.filter((i) => {
      if (f.customer && i.customer_id !== f.customer) return false;
      if (f.bucket && i.aging_bucket !== f.bucket) return false;
      if (f.owner && (i.account_owner_name || i.owner || 'Unassigned') !== f.owner) return false;
      if (f.country && i.country !== f.country) return false;
      if (f.status && i.invoice_status !== f.status) return false;
      if (f.currency && i.invoice_currency !== f.currency) return false;
      if (q && !i.invoice_number.toLowerCase().includes(q) && !i.customer_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, f.customer, f.bucket, f.owner, f.country, f.status, f.currency, f.q]);

  const totalOut = rows.reduce((s, i) => s + i.outstanding_reporting, 0);

  const columns: Column<CalculatedInvoice>[] = [
    { key: 'no', header: 'Invoice #', sortValue: (i) => i.invoice_number, render: (i) => <strong className="tnum">{i.invoice_number}</strong> },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (i) => i.customer_name,
      render: (i) => (
        <>
          <Link to={customerLink(i.customer_id)}>{i.customer_name}</Link>
          <span className="cell-sub">{i.country}</span>
        </>
      ),
    },
    { key: 'owner', header: 'Owner', sortValue: (i) => i.account_owner_name || i.owner, render: (i) => i.account_owner_name || i.owner || <span className="muted">Unassigned</span> },
    { key: 'invdate', header: 'Invoice date', sortValue: (i) => i.invoice_date, render: (i) => <span className="tnum">{i.invoice_date}</span> },
    { key: 'due', header: 'Due date', sortValue: (i) => i.due_date, render: (i) => (i.due_date ? <span className="tnum">{i.due_date}</span> : <span className="muted" title="Missing due date (data-quality issue)">missing</span>) },
    { key: 'aging', header: 'Aging days', align: 'right', sortValue: (i) => i.aging_days, render: (i) => (i.aging_days === null ? <span className="muted">n/a</span> : i.aging_days) },
    { key: 'bucket', header: 'Bucket', sortValue: (i) => (i.aging_bucket === 'UNKNOWN' ? 99 : AGING_BUCKETS.indexOf(i.aging_bucket)), render: (i) => (i.aging_bucket === 'UNKNOWN' ? <span className="muted">Unknown</span> : <span data-bucket={i.aging_bucket}>{AGING_BUCKET_LABEL[i.aging_bucket]}</span>) },
    { key: 'orig', header: 'Original amount (orig ccy)', align: 'right', sortValue: (i) => i.original_amount, render: (i) => <span className="tnum">{formatMoney(i.original_amount, i.invoice_currency)}</span> },
    { key: 'outorig', header: 'Outstanding (orig ccy)', align: 'right', sortValue: (i) => i.outstanding_amount, render: (i) => <span className="tnum">{formatMoney(i.outstanding_amount, i.invoice_currency)}</span> },
    { key: 'outrep', header: `Outstanding (${ccy})`, align: 'right', sortValue: (i) => i.outstanding_reporting, render: (i) => <Money amount={i.outstanding_reporting} currency={ccy} /> },
    { key: 'ccy', header: 'Currency', sortValue: (i) => i.invoice_currency, render: (i) => i.invoice_currency },
    {
      key: 'fx',
      header: 'FX rate',
      align: 'right',
      title: 'Reporting-currency units per 1 unit of invoice currency; hover for rate date',
      sortValue: (i) => i.exchange_rate,
      render: (i) =>
        i.exchange_rate === null ? (
          <span className="muted" title="No FX rate available">
            n/a
          </span>
        ) : (
          <span className="tnum" title={`Rate date ${i.exchange_rate_date ?? 'unknown'} (${model.fx.rates.find((r) => r.currency === i.invoice_currency)?.source ?? 'identity'})`}>
            {i.exchange_rate === 1 ? '1.0000' : i.exchange_rate.toPrecision(4)}
            <span className="cell-sub">{i.exchange_rate_date ?? ''}</span>
          </span>
        ),
    },
    { key: 'status', header: 'Status', sortValue: (i) => i.invoice_status, render: (i) => <StatusPill tone={invoiceStatusTone(i.invoice_status)} icon={false}>{i.invoice_status.replace('_', ' ')}</StatusPill> },
    {
      key: 'dispute',
      header: 'Dispute',
      sortValue: (i) => i.disputed_amount,
      render: (i) =>
        i.dispute_status === 'NONE' ? (
          <span className="muted">—</span>
        ) : (
          <>
            <StatusPill tone={i.dispute_status === 'RESOLVED' || i.dispute_status === 'REJECTED' ? 'neutral' : 'critical'} icon={false}>
              {i.dispute_status.replace('_', ' ')}
            </StatusPill>
            <span className="cell-sub">
              {i.disputed_amount ? formatMoney(i.disputed_amount, i.invoice_currency) : ''}
              {i.dispute_reason ? ` · ${i.dispute_reason}` : ''}
            </span>
          </>
        ),
    },
    { key: 'cn', header: 'Credit note', align: 'right', sortValue: (i) => i.credit_note_amount, render: (i) => (i.credit_note_amount ? <span className="tnum">{formatMoney(i.credit_note_amount, i.invoice_currency)}</span> : <span className="muted">—</span>) },
    { key: 'promise', header: 'Promise date', sortValue: (i) => i.promised_payment_date, render: (i) => <span className="tnum">{fmtDate(i.promised_payment_date)}</span> },
    {
      key: 'next',
      header: 'Next action',
      sortValue: (i) => i.next_action_date,
      render: (i) =>
        i.next_action ? (
          <span style={{ display: 'inline-block', minWidth: 160, whiteSpace: 'normal' }}>
            {i.next_action}
            <span className="cell-sub">{fmtDate(i.next_action_date)}</span>
          </span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    { key: 'src', header: 'Data source', sortValue: (i) => i.data_source, render: (i) => <span className="small muted">{i.data_source}</span> },
  ];

  const activeFilters = PARAMS.filter((k) => f[k]).map((k) => `${k}=${k === 'customer' ? customers.find((c) => c.value === f[k])?.label ?? f[k] : k === 'bucket' ? AGING_BUCKET_LABEL[f[k] as keyof typeof AGING_BUCKET_LABEL] ?? f[k] : f[k]}`);

  return (
    <div>
      <PageHeader title="Invoice Detail" subtitle="Every invoice with its original-currency amount, reporting-currency equivalent and the FX rate used. Expand a row for payment history and collection activities." />

      <FilterBar
        onReset={reset}
        summary={
          <span data-testid="invoices-count">
            Showing {rows.length} of {all.length} invoices · outstanding {formatMoney(totalOut, ccy)}
            {activeFilters.length > 0 && <> · filters: {activeFilters.join(', ')}</>}
          </span>
        }
      >
        <TextFilter id="i-q" label="Invoice # / customer" value={f.q} onChange={setParam('q')} placeholder="Search…" testId="invoices-search" />
        <SelectFilter id="i-customer" label="Customer" value={f.customer} onChange={setParam('customer')} options={customers} testId="invoices-customer-filter" />
        <SelectFilter id="i-bucket" label="Aging bucket" value={f.bucket} onChange={setParam('bucket')} options={AGING_BUCKETS.map((b) => ({ value: b, label: AGING_BUCKET_LABEL[b] }))} testId="invoices-bucket-filter" />
        <SelectFilter id="i-owner" label="Owner" value={f.owner} onChange={setParam('owner')} options={owners} testId="invoices-owner-filter" />
        <SelectFilter id="i-country" label="Country" value={f.country} onChange={setParam('country')} options={countries} testId="invoices-country-filter" />
        <SelectFilter id="i-status" label="Status" value={f.status} onChange={setParam('status')} options={statuses} />
        <SelectFilter id="i-currency" label="Currency" value={f.currency} onChange={setParam('currency')} options={currencies} />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(i) => i.invoice_id}
        defaultSort={{ key: 'aging', dir: 'desc' }}
        testId="invoices-table"
        caption="Invoice detail"
        emptyMessage="No invoices match the current filters."
        renderExpanded={(i) => <InvoiceExpansion inv={i} ccy={ccy} />}
      />
    </div>
  );
}

function InvoiceExpansion({ inv, ccy }: { inv: CalculatedInvoice; ccy: string }) {
  return (
    <div className="expand-panel">
      <div>
        <h4>Payment history ({inv.payments.length})</h4>
        {inv.payments.length === 0 ? (
          <p className="muted small">No payments applied to this invoice.</p>
        ) : (
          <div className="table-scroll">
            <table className="data compact">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col" className="num">
                    Applied
                  </th>
                  <th scope="col">Method</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Reconciliation</th>
                </tr>
              </thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.payment_id}>
                    <td className="tnum">{p.payment_date}</td>
                    <td className="num">{formatMoney(p.payment_amount, p.payment_currency)}</td>
                    <td className="num">{formatMoney(p.applied_amount, p.payment_currency)}</td>
                    <td>{p.payment_method.replace('_', ' ')}</td>
                    <td>{p.payment_reference ?? <span className="muted">—</span>}</td>
                    <td>
                      <StatusPill tone={p.reconciliation_status === 'APPLIED' ? 'good' : p.reconciliation_status === 'UNAPPLIED' ? 'warning' : 'neutral'} icon={false}>
                        {p.reconciliation_status.replace('_', ' ')}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 6 }}>
          Paid so far {formatMoney(inv.paid_amount, inv.invoice_currency)} · credit notes {formatMoney(inv.credit_note_amount, inv.invoice_currency)} · last payment {fmtDate(inv.last_payment_date)}
          {inv.last_payment_amount !== null ? ` (${formatMoney(inv.last_payment_amount, inv.invoice_currency)})` : ''} · booking {inv.booking_id ?? '—'} · service date {fmtDate(inv.service_date)} · outstanding {formatMoney(inv.outstanding_reporting, ccy)}
        </p>
      </div>
      <div>
        <h4>Collection activities ({inv.activities.length})</h4>
        {inv.activities.length === 0 ? (
          <p className="muted small">No collection activity linked to this invoice.</p>
        ) : (
          <ol className="timeline">
            {[...inv.activities]
              .sort((a, b) => b.activity_date.localeCompare(a.activity_date))
              .map((a) => (
                <li key={a.activity_id}>
                  <span className="t-date">{a.activity_date}</span>
                  <div className="t-body">
                    <div className="badges">
                      <StatusPill tone="neutral" icon={false}>
                        {a.activity_type}
                      </StatusPill>
                      <span className="t-meta">
                        {a.owner}
                        {a.contact_channel ? ` · ${a.contact_channel}` : ''}
                      </span>
                    </div>
                    <p>{a.note}</p>
                    {(a.promised_payment_date || a.next_action) && (
                      <p className="t-meta">
                        {a.promised_payment_date ? `Promised ${a.promised_payment_date}${a.promised_payment_amount !== null ? ` · ${formatMoney(a.promised_payment_amount, a.promised_currency ?? inv.invoice_currency)}` : ''}` : ''}
                        {a.promised_payment_date && a.next_action ? ' · ' : ''}
                        {a.next_action ? `Next: ${a.next_action}${a.next_action_date ? ` (${a.next_action_date})` : ''}` : ''}
                      </p>
                    )}
                  </div>
                </li>
              ))}
          </ol>
        )}
      </div>
    </div>
  );
}
