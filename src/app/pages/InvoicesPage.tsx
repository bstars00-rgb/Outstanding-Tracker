import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatMoney } from '@core/money';
import { AGING_BUCKET_LABEL_I18N } from '@core/i18n';
import { AGING_BUCKETS, type CalculatedInvoice } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { useI18n } from '@app/i18n/useI18n';
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
  const { lang, t, te } = useI18n();
  const ccy = model.reporting_currency;
  const bucketLabel = AGING_BUCKET_LABEL_I18N[lang];
  const unassigned = t('common.unassigned');
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
  const owners = distinct(all, (i) => i.account_owner_name || i.owner || unassigned);
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
      if (f.owner && (i.account_owner_name || i.owner || unassigned) !== f.owner) return false;
      if (f.country && i.country !== f.country) return false;
      if (f.status && i.invoice_status !== f.status) return false;
      if (f.currency && i.invoice_currency !== f.currency) return false;
      if (q && !i.invoice_number.toLowerCase().includes(q) && !i.customer_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, f.customer, f.bucket, f.owner, f.country, f.status, f.currency, f.q, unassigned]);

  const totalOut = rows.reduce((s, i) => s + i.outstanding_reporting, 0);

  const columns: Column<CalculatedInvoice>[] = [
    { key: 'no', header: t('col.invoiceNo'), sortValue: (i) => i.invoice_number, render: (i) => <strong className="tnum">{i.invoice_number}</strong> },
    {
      key: 'customer',
      header: t('col.customer'),
      sortValue: (i) => i.customer_name,
      render: (i) => (
        <>
          <Link to={customerLink(i.customer_id)}>{i.customer_name}</Link>
          <span className="cell-sub">{i.country}</span>
        </>
      ),
    },
    { key: 'owner', header: t('col.owner'), sortValue: (i) => i.account_owner_name || i.owner, render: (i) => i.account_owner_name || i.owner || <span className="muted">{unassigned}</span> },
    { key: 'invdate', header: t('col.invoiceDate'), sortValue: (i) => i.invoice_date, render: (i) => <span className="tnum">{i.invoice_date}</span> },
    {
      key: 'due',
      header: t('col.dueDate'),
      sortValue: (i) => i.due_date,
      render: (i) =>
        i.due_date ? (
          <span className="tnum">{i.due_date}</span>
        ) : (
          <span className="muted" title={t('invoices.missingDue')}>
            {t('common.missing')}
          </span>
        ),
    },
    { key: 'aging', header: t('col.agingDays'), align: 'right', sortValue: (i) => i.aging_days, render: (i) => (i.aging_days === null ? <span className="muted">{t('common.na')}</span> : i.aging_days) },
    {
      key: 'bucket',
      header: t('col.bucket'),
      sortValue: (i) => (i.aging_bucket === 'UNKNOWN' ? 99 : AGING_BUCKETS.indexOf(i.aging_bucket)),
      render: (i) => (i.aging_bucket === 'UNKNOWN' ? <span className="muted">{t('common.unknown')}</span> : <span data-bucket={i.aging_bucket}>{bucketLabel[i.aging_bucket]}</span>),
    },
    { key: 'orig', header: t('col.originalAmount'), align: 'right', sortValue: (i) => i.original_amount, render: (i) => <span className="tnum">{formatMoney(i.original_amount, i.invoice_currency)}</span> },
    { key: 'outorig', header: t('col.outstandingOrig'), align: 'right', sortValue: (i) => i.outstanding_amount, render: (i) => <span className="tnum">{formatMoney(i.outstanding_amount, i.invoice_currency)}</span> },
    { key: 'outrep', header: t('col.outstandingRep', { ccy }), align: 'right', sortValue: (i) => i.outstanding_reporting, render: (i) => <Money amount={i.outstanding_reporting} currency={ccy} /> },
    { key: 'ccy', header: t('col.invoiceCurrency'), sortValue: (i) => i.invoice_currency, render: (i) => i.invoice_currency },
    {
      key: 'fx',
      header: t('col.fxRate'),
      align: 'right',
      title: t('col.fxRateTitle'),
      sortValue: (i) => i.exchange_rate,
      render: (i) =>
        i.exchange_rate === null ? (
          <span className="muted" title={t('common.noFx')}>
            {t('common.na')}
          </span>
        ) : (
          <span className="tnum" title={t('invoices.rateDate', { date: i.exchange_rate_date ?? t('common.unknown'), source: model.fx.rates.find((r) => r.currency === i.invoice_currency)?.source ?? t('common.identity') })}>
            {i.exchange_rate === 1 ? '1.0000' : i.exchange_rate.toPrecision(4)}
            <span className="cell-sub">{i.exchange_rate_date ?? ''}</span>
          </span>
        ),
    },
    {
      key: 'status',
      header: t('col.status'),
      sortValue: (i) => i.invoice_status,
      render: (i) => (
        <StatusPill tone={invoiceStatusTone(i.invoice_status)} icon={false} title={i.invoice_status}>
          {te('invoiceStatus', i.invoice_status)}
        </StatusPill>
      ),
    },
    {
      key: 'dispute',
      header: t('col.dispute'),
      sortValue: (i) => i.disputed_amount,
      render: (i) =>
        i.dispute_status === 'NONE' ? (
          <span className="muted">—</span>
        ) : (
          <>
            <StatusPill tone={i.dispute_status === 'RESOLVED' || i.dispute_status === 'REJECTED' ? 'neutral' : 'critical'} icon={false} title={i.dispute_status}>
              {te('disputeStatus', i.dispute_status)}
            </StatusPill>
            <span className="cell-sub">
              {i.disputed_amount ? formatMoney(i.disputed_amount, i.invoice_currency) : ''}
              {i.dispute_reason ? ` · ${i.dispute_reason}` : ''}
            </span>
          </>
        ),
    },
    { key: 'cn', header: t('col.creditNote'), align: 'right', sortValue: (i) => i.credit_note_amount, render: (i) => (i.credit_note_amount ? <span className="tnum">{formatMoney(i.credit_note_amount, i.invoice_currency)}</span> : <span className="muted">—</span>) },
    { key: 'promise', header: t('col.promiseDate'), sortValue: (i) => i.promised_payment_date, render: (i) => <span className="tnum">{fmtDate(i.promised_payment_date)}</span> },
    {
      key: 'next',
      header: t('col.nextAction'),
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
    { key: 'src', header: t('col.dataSource'), sortValue: (i) => i.data_source, render: (i) => <span className="small muted">{i.data_source}</span> },
  ];

  const activeFilters = PARAMS.filter((k) => f[k]).map((k) => `${k}=${k === 'customer' ? customers.find((c) => c.value === f[k])?.label ?? f[k] : k === 'bucket' ? bucketLabel[f[k]] ?? f[k] : f[k]}`);

  return (
    <div>
      <PageHeader title={t('invoices.title')} subtitle={t('invoices.subtitle')} />

      <FilterBar
        onReset={reset}
        summary={
          <span data-testid="invoices-count">
            {t('invoices.summary', { shown: rows.length, total: all.length, amount: formatMoney(totalOut, ccy) })}
            {activeFilters.length > 0 && (
              <>
                {' '}
                · {t('invoices.filters')}: {activeFilters.join(', ')}
              </>
            )}
          </span>
        }
      >
        <TextFilter id="i-q" label={t('filter.invoiceSearch')} value={f.q} onChange={setParam('q')} testId="invoices-search" />
        <SelectFilter id="i-customer" label={t('filter.customer')} value={f.customer} onChange={setParam('customer')} options={customers} testId="invoices-customer-filter" />
        <SelectFilter id="i-bucket" label={t('filter.agingBucket')} value={f.bucket} onChange={setParam('bucket')} options={AGING_BUCKETS.map((b) => ({ value: b, label: bucketLabel[b] }))} testId="invoices-bucket-filter" />
        <SelectFilter id="i-owner" label={t('filter.owner')} value={f.owner} onChange={setParam('owner')} options={owners} testId="invoices-owner-filter" />
        <SelectFilter id="i-country" label={t('filter.country')} value={f.country} onChange={setParam('country')} options={countries} testId="invoices-country-filter" />
        <SelectFilter id="i-status" label={t('filter.status')} value={f.status} onChange={setParam('status')} options={statuses.map((s) => ({ value: s, label: te('invoiceStatus', s) }))} />
        <SelectFilter id="i-currency" label={t('filter.invoiceCurrency')} value={f.currency} onChange={setParam('currency')} options={currencies} />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(i) => i.invoice_id}
        defaultSort={{ key: 'aging', dir: 'desc' }}
        testId="invoices-table"
        caption={t('invoices.caption')}
        emptyMessage={t('invoices.empty')}
        renderExpanded={(i) => <InvoiceExpansion inv={i} ccy={ccy} />}
      />
    </div>
  );
}

function InvoiceExpansion({ inv, ccy }: { inv: CalculatedInvoice; ccy: string }) {
  const { t, te } = useI18n();
  return (
    <div className="expand-panel">
      <div>
        <h4>{t('invoices.payments', { n: inv.payments.length })}</h4>
        {inv.payments.length === 0 ? (
          <p className="muted small">{t('invoices.noPayments')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data compact">
              <thead>
                <tr>
                  <th scope="col">{t('col.date')}</th>
                  <th scope="col" className="num">
                    {t('col.amount')}
                  </th>
                  <th scope="col" className="num">
                    {t('col.applied')}
                  </th>
                  <th scope="col">{t('col.method')}</th>
                  <th scope="col">{t('col.reference')}</th>
                  <th scope="col">{t('col.reconciliation')}</th>
                </tr>
              </thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.payment_id}>
                    <td className="tnum">{p.payment_date}</td>
                    <td className="num">{formatMoney(p.payment_amount, p.payment_currency)}</td>
                    <td className="num">{formatMoney(p.applied_amount, p.payment_currency)}</td>
                    <td>{te('paymentMethod', p.payment_method)}</td>
                    <td>{p.payment_reference ?? <span className="muted">—</span>}</td>
                    <td>
                      <StatusPill tone={p.reconciliation_status === 'APPLIED' ? 'good' : p.reconciliation_status === 'UNAPPLIED' ? 'warning' : 'neutral'} icon={false} title={p.reconciliation_status}>
                        {te('reconStatus', p.reconciliation_status)}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 6 }}>
          {t('invoices.paidSoFar', {
            paid: formatMoney(inv.paid_amount, inv.invoice_currency),
            cn: formatMoney(inv.credit_note_amount, inv.invoice_currency),
            date: fmtDate(inv.last_payment_date),
            last: inv.last_payment_amount !== null ? ` (${formatMoney(inv.last_payment_amount, inv.invoice_currency)})` : '',
            booking: inv.booking_id ?? '—',
            service: fmtDate(inv.service_date),
            out: formatMoney(inv.outstanding_reporting, ccy),
          })}
        </p>
      </div>
      <div>
        <h4>{t('invoices.activities', { n: inv.activities.length })}</h4>
        {inv.activities.length === 0 ? (
          <p className="muted small">{t('invoices.noActivities')}</p>
        ) : (
          <ol className="timeline">
            {[...inv.activities]
              .sort((a, b) => b.activity_date.localeCompare(a.activity_date))
              .map((a) => (
                <li key={a.activity_id}>
                  <span className="t-date">{a.activity_date}</span>
                  <div className="t-body">
                    <div className="badges">
                      <StatusPill tone="neutral" icon={false} title={a.activity_type}>
                        {te('activityType', a.activity_type)}
                      </StatusPill>
                      <span className="t-meta">
                        {a.owner}
                        {a.contact_channel ? ` · ${a.contact_channel}` : ''}
                      </span>
                    </div>
                    <p>{a.note}</p>
                    {(a.promised_payment_date || a.next_action) && (
                      <p className="t-meta">
                        {a.promised_payment_date
                          ? `${t('invoices.promised', { date: a.promised_payment_date })}${a.promised_payment_amount !== null ? ` · ${formatMoney(a.promised_payment_amount, a.promised_currency ?? inv.invoice_currency)}` : ''}`
                          : ''}
                        {a.promised_payment_date && a.next_action ? ' · ' : ''}
                        {a.next_action ? `${t('invoices.next', { action: a.next_action })}${a.next_action_date ? ` (${a.next_action_date})` : ''}` : ''}
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
