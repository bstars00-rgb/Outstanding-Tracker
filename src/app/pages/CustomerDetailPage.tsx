import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatMoney } from '@core/money';
import { AGING_BUCKET_LABEL_I18N, RISK_GRADE_LABEL_I18N } from '@core/i18n';
import { AGING_BUCKETS, type CalculatedInvoice, type CollectionActivity } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { useI18n } from '@app/i18n/useI18n';
import { PageHeader } from '@app/components/PageHeader';
import { DataTable, type Column } from '@app/components/DataTable';
import { Money } from '@app/components/Money';
import { RiskBadge } from '@app/components/RiskBadge';
import { StatusPill, invoiceStatusTone } from '@app/components/StatusPill';
import { Banner } from '@app/components/Banner';
import { invoicesLink } from '@app/lib/links';
import { fmtDate, fmtRatio } from '@app/lib/format';

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { model } = useReadyTracker();
  const { lang, t, te } = useI18n();
  const ccy = model.reporting_currency;
  const bucketLabel = AGING_BUCKET_LABEL_I18N[lang];
  const customer = model.customers.find((c) => c.customer_id === id);

  const invoices = useMemo(() => model.invoices.filter((i) => i.customer_id === id).sort((a, b) => (b.aging_days ?? -999) - (a.aging_days ?? -999)), [model.invoices, id]);
  const activities = useMemo(() => {
    const seen = new Map<string, CollectionActivity>();
    for (const inv of invoices) for (const a of inv.activities) seen.set(a.activity_id, a);
    return [...seen.values()].sort((a, b) => b.activity_date.localeCompare(a.activity_date));
  }, [invoices]);

  if (!customer) {
    return (
      <div>
        <PageHeader title={t('detail.notFound')} />
        <div className="state">
          <p>{t('detail.notFoundBody', { id })}</p>
          <div className="actions">
            <Link className="btn" to="/customers">
              {t('detail.backToCustomers')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const invColumns: Column<CalculatedInvoice>[] = [
    { key: 'no', header: t('col.invoiceNo'), sortValue: (i) => i.invoice_number, render: (i) => <Link to={invoicesLink({ customer: i.customer_id, q: i.invoice_number })}>{i.invoice_number}</Link> },
    { key: 'inv', header: t('col.invoiceDate'), sortValue: (i) => i.invoice_date, render: (i) => <span className="tnum">{i.invoice_date}</span> },
    { key: 'due', header: t('col.dueDate'), sortValue: (i) => i.due_date, render: (i) => <span className="tnum">{fmtDate(i.due_date)}</span> },
    { key: 'aging', header: t('col.agingDays'), align: 'right', sortValue: (i) => i.aging_days, render: (i) => (i.aging_days === null ? <span className="muted">{t('common.na')}</span> : i.aging_days) },
    { key: 'bucket', header: t('col.bucket'), sortValue: (i) => i.aging_bucket, render: (i) => (i.aging_bucket === 'UNKNOWN' ? <span className="muted">{t('detail.unknownBucket')}</span> : bucketLabel[i.aging_bucket]) },
    {
      key: 'out',
      header: t('col.outstandingRep', { ccy }),
      align: 'right',
      sortValue: (i) => i.outstanding_reporting,
      render: (i) => <Money amount={i.outstanding_reporting} currency={ccy} original={{ amount: i.outstanding_amount, currency: i.invoice_currency }} />,
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
      render: (i) => (i.dispute_status === 'NONE' ? <span className="muted">—</span> : `${te('disputeStatus', i.dispute_status)}${i.disputed_amount ? ` · ${formatMoney(i.disputed_amount, i.invoice_currency)}` : ''}`),
    },
    { key: 'promise', header: t('col.promiseDate'), sortValue: (i) => i.promised_payment_date, render: (i) => <span className="tnum">{fmtDate(i.promised_payment_date)}</span> },
    {
      key: 'next',
      header: t('col.nextAction'),
      render: (i) =>
        i.next_action ? (
          <>
            {i.next_action} <span className="cell-sub">{fmtDate(i.next_action_date)}</span>
          </>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ];

  const factors = customer.risk.factors;
  const maxPoints = factors.reduce((s, f) => s + f.max_points, 0);
  const gradeLabel = RISK_GRADE_LABEL_I18N[lang][customer.risk.grade] ?? customer.risk.grade;

  return (
    <div>
      <PageHeader
        title={customer.customer_name}
        subtitle={
          <span className="badges">
            <RiskBadge risk={customer.risk} />
            <StatusPill tone="neutral" icon={false}>
              {customer.country} · {customer.region}
            </StatusPill>
            <StatusPill tone="neutral" icon={false} testId="detail-entity">
              {t('detail.entity', { entity: customer.control_company ?? t('common.unassignedEntity') })}
            </StatusPill>
            <StatusPill tone="neutral" icon={false}>
              {t('detail.ownerLabel', { owner: customer.account_owner_name || t('common.unassigned') })}
            </StatusPill>
            <StatusPill tone="neutral" icon={false} testId="detail-contract-currency">
              {t('detail.contract', { ccy: customer.contract_currency })}
            </StatusPill>
            <StatusPill tone={customer.credit_status === 'ACTIVE' ? 'good' : 'warning'} icon={false} title={customer.credit_status}>
              {t('detail.credit', { status: te('creditStatus', customer.credit_status) })}
            </StatusPill>
            <StatusPill tone={customer.collection_status === 'NORMAL' ? 'neutral' : customer.collection_status === 'REMINDER' ? 'info' : 'critical'} icon={false} title={customer.collection_status}>
              {t('detail.collection', { status: te('collectionStatus', customer.collection_status) })}
            </StatusPill>
          </span>
        }
        actions={
          <>
            <Link className="btn" to={invoicesLink({ customer: customer.customer_id })}>
              {t('detail.allInvoices')}
            </Link>
            <Link className="btn" to="/customers">
              {t('detail.backLink')}
            </Link>
          </>
        }
      />

      <section className="card section" aria-label={t('detail.balancesAria')}>
        <div className="stat-row">
          <Stat label={t('stat.total')} value={formatMoney(customer.total_outstanding_reporting, ccy)} />
          <Stat label={t('stat.overdue')} value={formatMoney(customer.overdue_reporting, ccy)} />
          <Stat label={t('stat.notDue')} value={formatMoney(customer.not_due_reporting, ccy)} />
          <Stat label={t('stat.over30')} value={formatMoney(customer.overdue_30_plus_reporting, ccy)} />
          <Stat label={t('stat.over90')} value={formatMoney(customer.overdue_90_plus_reporting, ccy)} />
          <Stat label={t('stat.disputed')} value={formatMoney(customer.disputed_reporting, ccy)} />
          <Stat label={t('stat.maxAging')} value={t('common.days', { n: customer.max_aging_days })} />
          <Stat label={t('stat.invoicesOverdue')} value={`${customer.invoice_count} (${customer.overdue_invoice_count})`} />
          <Stat
            label={t('stat.creditLimit')}
            value={
              customer.credit_limit_reporting === null
                ? t('common.na')
                : `${formatMoney(customer.credit_limit_reporting, ccy)} · ${fmtRatio(customer.credit_utilization, 0)}${customer.credit_limit_exceeded ? ` (${t('common.exceeded')})` : ''}`
            }
          />
          <Stat label={t('stat.wowOverdue')} value={customer.wow_overdue_change_reporting === null ? t('common.na') : formatMoney(customer.wow_overdue_change_reporting, ccy, { signed: true })} />
          <Stat label={t('stat.lastPayment')} value={fmtDate(customer.last_payment_date)} />
          <Stat label={t('stat.lastActivity')} value={fmtDate(customer.last_activity_date)} />
          <Stat label={t('stat.nextPromise')} value={customer.next_promise_date ? `${customer.next_promise_date}${customer.next_promise_amount_reporting !== null ? ` · ${formatMoney(customer.next_promise_amount_reporting, ccy)}` : ''}` : '—'} />
          <Stat label={t('stat.promiseBroken')} value={`${customer.promise_broken ? t('common.yes') : t('common.no')}${customer.promise_broken ? ` · ${formatMoney(customer.broken_promise_amount_reporting, ccy)}` : ''}`} />
        </div>
        <p style={{ marginTop: 12 }}>
          <strong>{t('detail.recommended')}</strong> {customer.recommended_action}
        </p>
      </section>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="ccy-h" data-testid="detail-currency-breakdown">
          <h2 className="card-title" id="ccy-h">
            {t('detail.byCurrency')}
          </h2>
          <p className="chart-desc">{t('detail.byCurrencyDesc', { ccy })}</p>
          <div className="table-scroll">
            <table className="data compact">
              <thead>
                <tr>
                  <th scope="col">{t('col.currency')}</th>
                  <th scope="col" className="num">
                    {t('col.totalOutstanding')}
                  </th>
                  <th scope="col" className="num">
                    {t('col.overdue')}
                  </th>
                  <th scope="col" className="num">
                    {t('col.invoiceCount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {customer.totals_by_currency.map((x) => (
                  <tr key={x.currency}>
                    <td className="tnum">
                      {x.currency}
                      {x.currency === customer.contract_currency && <span className="cell-sub">{t('col.contractCurrency')}</span>}
                    </td>
                    <td className="num">{formatMoney(x.total, x.currency)}</td>
                    <td className="num">{x.overdue > 0 ? formatMoney(x.overdue, x.currency) : <span className="muted">—</span>}</td>
                    <td className="num">{x.invoice_count}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>{ccy}</strong>
                    <span className="cell-sub">{t('footer.reportingCurrency')}</span>
                  </td>
                  <td className="num">
                    <strong>{formatMoney(customer.total_outstanding_reporting, ccy)}</strong>
                  </td>
                  <td className="num">
                    <strong>{formatMoney(customer.overdue_reporting, ccy)}</strong>
                  </td>
                  <td className="num">
                    <strong>{customer.invoice_count}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" aria-labelledby="buckets-h">
          <h2 className="card-title" id="buckets-h">
            {t('detail.agingBuckets')}
          </h2>
          <div className="table-scroll">
            <table className="data compact">
              <thead>
                <tr>
                  <th scope="col">{t('col.bucket')}</th>
                  <th scope="col" className="num">
                    {t('col.amountCcy', { ccy })}
                  </th>
                  <th scope="col" className="num">
                    {t('col.share')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {AGING_BUCKETS.map((b) => {
                  const amt = customer.bucket_totals[b];
                  const share = customer.total_outstanding_reporting > 0 ? amt / customer.total_outstanding_reporting : 0;
                  return (
                    <tr key={b}>
                      <td>{amt > 0 ? <Link to={invoicesLink({ customer: customer.customer_id, bucket: b })}>{bucketLabel[b]}</Link> : bucketLabel[b]}</td>
                      <td className="num">{amt > 0 ? formatMoney(amt, ccy) : <span className="muted">—</span>}</td>
                      <td className="num">{amt > 0 ? fmtRatio(share) : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {customer.data_quality.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <Banner kind="warning" title={t('detail.dqTitle')}>
                <ul>
                  {customer.data_quality.map((d, i) => (
                    <li key={i}>
                      [{d.severity}] {d.code}
                      {d.entity_id ? ` (${d.entity} ${d.entity_id})` : ''}: {d.message}
                    </li>
                  ))}
                </ul>
              </Banner>
            </div>
          )}
        </section>
      </div>

      <section className="card section" aria-labelledby="risk-h">
        <h2 className="card-title" id="risk-h">
          {t('detail.whyScore', { score: customer.risk.score, grade: gradeLabel })}
          <span className="muted small">{t('detail.factorsMax', { n: factors.length, max: maxPoints })}</span>
        </h2>
        <div className="factor-list" role="list">
          {factors.map((f) => {
            const pct = f.max_points > 0 ? (f.points / f.max_points) * 100 : 0;
            return (
              <div className="factor-row" role="listitem" key={f.key} data-testid="risk-factor-row">
                <div>
                  <span className="factor-label">{f.label}</span>
                  <span className="factor-evidence">{f.evidence}</span>
                </div>
                <div className={`factor-bar ${pct >= 75 ? 'high' : pct >= 40 ? 'mid' : ''}`} role="img" aria-label={t('detail.factorAria', { label: f.label, points: f.points, max: f.max_points })}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="factor-points">
                  {f.points}/{f.max_points}
                </div>
              </div>
            );
          })}
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          {t('detail.scoreNote')}
        </p>
      </section>

      <section className="card section" aria-labelledby="inv-h">
        <h2 className="card-title" id="inv-h">
          {t('detail.invoices', { n: invoices.length })}
          <Link className="small" to={invoicesLink({ customer: customer.customer_id })}>
            {t('detail.openInInvoices')}
          </Link>
        </h2>
        <DataTable columns={invColumns} rows={invoices} rowKey={(i) => i.invoice_id} compact caption={t('detail.invoicesCaption', { name: customer.customer_name })} emptyMessage={t('detail.noInvoices')} />
      </section>

      <section className="card section" aria-labelledby="act-h">
        <h2 className="card-title" id="act-h">
          {t('detail.timeline', { n: activities.length })}
        </h2>
        {activities.length === 0 ? (
          <p className="muted">{t('detail.noActivities')}</p>
        ) : (
          <ol className="timeline">
            {activities.map((a) => (
              <li key={a.activity_id}>
                <span className="t-date">{a.activity_date}</span>
                <div className="t-body">
                  <div className="badges">
                    <StatusPill tone={a.activity_type === 'ESCALATION' || a.activity_type === 'DISPUTE' ? 'critical' : a.activity_type === 'PROMISE' ? 'info' : 'neutral'} icon={false} title={a.activity_type}>
                      {te('activityType', a.activity_type)}
                    </StatusPill>
                    <span className="t-meta">
                      {a.owner}
                      {a.contact_channel ? ` · ${a.contact_channel}` : ''}
                      {a.invoice_id ? ` · ${t('detail.invoiceRef', { no: invoices.find((i) => i.invoice_id === a.invoice_id)?.invoice_number ?? a.invoice_id })}` : ''}
                      {a.escalation_level > 0 ? ` · ${t('detail.escalation', { n: a.escalation_level })}` : ''}
                      {a.completed ? ` · ${t('detail.completed')}` : ''}
                    </span>
                  </div>
                  <p>{a.note}</p>
                  {(a.promised_payment_date || a.promised_payment_amount !== null) && (
                    <p className="t-meta">
                      {t('detail.promised')} {fmtDate(a.promised_payment_date)}
                      {a.promised_payment_amount !== null ? ` · ${formatMoney(a.promised_payment_amount, a.promised_currency ?? ccy)}` : ''}
                    </p>
                  )}
                  {a.next_action && (
                    <p className="t-meta">
                      {t('detail.nextAction')} {a.next_action}
                      {a.next_action_date ? ` (${a.next_action_date})` : ''}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="l">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}
