import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatMoney } from '@core/money';
import { AGING_BUCKET_LABEL, AGING_BUCKETS, type CalculatedInvoice, type CollectionActivity } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { PageHeader } from '@app/components/PageHeader';
import { DataTable, type Column } from '@app/components/DataTable';
import { Money } from '@app/components/Money';
import { RiskBadge } from '@app/components/RiskBadge';
import { StatusPill, invoiceStatusTone } from '@app/components/StatusPill';
import { Banner } from '@app/components/Banner';
import { invoicesLink } from '@app/lib/links';
import { fmtDate, fmtRatio, yesNo } from '@app/lib/format';

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { model } = useReadyTracker();
  const ccy = model.reporting_currency;
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
        <PageHeader title="Customer not found" />
        <div className="state">
          <p>No customer with id "{id}" exists in the current dataset.</p>
          <div className="actions">
            <Link className="btn" to="/customers">
              Back to Customer Risk
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const invColumns: Column<CalculatedInvoice>[] = [
    { key: 'no', header: 'Invoice #', sortValue: (i) => i.invoice_number, render: (i) => <Link to={invoicesLink({ customer: i.customer_id, q: i.invoice_number })}>{i.invoice_number}</Link> },
    { key: 'inv', header: 'Invoice date', sortValue: (i) => i.invoice_date, render: (i) => <span className="tnum">{i.invoice_date}</span> },
    { key: 'due', header: 'Due date', sortValue: (i) => i.due_date, render: (i) => <span className="tnum">{fmtDate(i.due_date)}</span> },
    { key: 'aging', header: 'Aging days', align: 'right', sortValue: (i) => i.aging_days, render: (i) => (i.aging_days === null ? <span className="muted">n/a</span> : i.aging_days) },
    { key: 'bucket', header: 'Bucket', sortValue: (i) => i.aging_bucket, render: (i) => (i.aging_bucket === 'UNKNOWN' ? <span className="muted">Unknown (no due date)</span> : AGING_BUCKET_LABEL[i.aging_bucket]) },
    { key: 'out', header: 'Outstanding', align: 'right', sortValue: (i) => i.outstanding_reporting, render: (i) => <Money amount={i.outstanding_reporting} currency={ccy} original={{ amount: i.outstanding_amount, currency: i.invoice_currency }} /> },
    { key: 'status', header: 'Status', sortValue: (i) => i.invoice_status, render: (i) => <StatusPill tone={invoiceStatusTone(i.invoice_status)} icon={false}>{i.invoice_status.replace('_', ' ')}</StatusPill> },
    { key: 'dispute', header: 'Dispute', render: (i) => (i.dispute_status === 'NONE' ? <span className="muted">—</span> : `${i.dispute_status}${i.disputed_amount ? ` · ${formatMoney(i.disputed_amount, i.invoice_currency)}` : ''}`) },
    { key: 'promise', header: 'Promise date', sortValue: (i) => i.promised_payment_date, render: (i) => <span className="tnum">{fmtDate(i.promised_payment_date)}</span> },
    { key: 'next', header: 'Next action', render: (i) => (i.next_action ? <>{i.next_action} <span className="cell-sub">{fmtDate(i.next_action_date)}</span></> : <span className="muted">—</span>) },
  ];

  const factors = customer.risk.factors;
  const maxPoints = factors.reduce((s, f) => s + f.max_points, 0);

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
            <StatusPill tone="neutral" icon={false}>
              Owner: {customer.account_owner_name || 'Unassigned'}
            </StatusPill>
            <StatusPill tone="neutral" icon={false}>
              Contract {customer.contract_currency}
            </StatusPill>
            <StatusPill tone={customer.credit_status === 'ACTIVE' ? 'good' : 'warning'} icon={false}>
              Credit {customer.credit_status.replace('_', ' ')}
            </StatusPill>
            <StatusPill tone={customer.collection_status === 'NORMAL' ? 'neutral' : customer.collection_status === 'REMINDER' ? 'info' : 'critical'} icon={false}>
              Collection {customer.collection_status}
            </StatusPill>
          </span>
        }
        actions={
          <>
            <Link className="btn" to={invoicesLink({ customer: customer.customer_id })}>
              All invoices
            </Link>
            <Link className="btn" to="/customers">
              ← Customer Risk
            </Link>
          </>
        }
      />

      <section className="card section" aria-label="Customer balances">
        <div className="stat-row">
          <Stat label="Total outstanding" value={formatMoney(customer.total_outstanding_reporting, ccy)} />
          <Stat label="Overdue" value={formatMoney(customer.overdue_reporting, ccy)} />
          <Stat label="Not yet due" value={formatMoney(customer.not_due_reporting, ccy)} />
          <Stat label="30+ days" value={formatMoney(customer.overdue_30_plus_reporting, ccy)} />
          <Stat label="90+ days" value={formatMoney(customer.overdue_90_plus_reporting, ccy)} />
          <Stat label="Disputed" value={formatMoney(customer.disputed_reporting, ccy)} />
          <Stat label="Max aging" value={`${customer.max_aging_days} days`} />
          <Stat label="Invoices (overdue)" value={`${customer.invoice_count} (${customer.overdue_invoice_count})`} />
          <Stat
            label="Credit limit / utilization"
            value={customer.credit_limit_reporting === null ? 'n/a' : `${formatMoney(customer.credit_limit_reporting, ccy)} · ${fmtRatio(customer.credit_utilization, 0)}${customer.credit_limit_exceeded ? ' (exceeded)' : ''}`}
          />
          <Stat label="WoW overdue change" value={customer.wow_overdue_change_reporting === null ? 'n/a' : formatMoney(customer.wow_overdue_change_reporting, ccy, { signed: true })} />
          <Stat label="Last payment" value={fmtDate(customer.last_payment_date)} />
          <Stat label="Last activity" value={fmtDate(customer.last_activity_date)} />
          <Stat label="Next promise" value={customer.next_promise_date ? `${customer.next_promise_date}${customer.next_promise_amount_reporting !== null ? ` · ${formatMoney(customer.next_promise_amount_reporting, ccy)}` : ''}` : '—'} />
          <Stat label="Promise broken" value={`${yesNo(customer.promise_broken)}${customer.promise_broken ? ` · ${formatMoney(customer.broken_promise_amount_reporting, ccy)}` : ''}`} />
        </div>
        <p style={{ marginTop: 12 }}>
          <strong>Recommended action:</strong> {customer.recommended_action}
        </p>
      </section>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="risk-h">
          <h2 className="card-title" id="risk-h">
            Why this score: {customer.risk.score}/100 ({customer.risk.grade})<span className="muted small">{factors.length} factors · max {maxPoints}</span>
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
                  <div className={`factor-bar ${pct >= 75 ? 'high' : pct >= 40 ? 'mid' : ''}`} role="img" aria-label={`${f.label}: ${f.points} of ${f.max_points} points`}>
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
            Score = sum of factor points. Grades: Low &lt; 30 · Watch 30-49 · Medium 50-64 · High 65-79 · Critical 80+.
          </p>
        </section>

        <section className="card" aria-labelledby="buckets-h">
          <h2 className="card-title" id="buckets-h">
            Aging buckets
          </h2>
          <div className="table-scroll">
            <table className="data compact">
              <thead>
                <tr>
                  <th scope="col">Bucket</th>
                  <th scope="col" className="num">
                    Amount ({ccy})
                  </th>
                  <th scope="col" className="num">
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {AGING_BUCKETS.map((b) => {
                  const amt = customer.bucket_totals[b];
                  const share = customer.total_outstanding_reporting > 0 ? amt / customer.total_outstanding_reporting : 0;
                  return (
                    <tr key={b}>
                      <td>{amt > 0 ? <Link to={invoicesLink({ customer: customer.customer_id, bucket: b })}>{AGING_BUCKET_LABEL[b]}</Link> : AGING_BUCKET_LABEL[b]}</td>
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
              <Banner kind="warning" title="Data-quality notes for this customer.">
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

      <section className="card section" aria-labelledby="inv-h">
        <h2 className="card-title" id="inv-h">
          Invoices ({invoices.length})
          <Link className="small" to={invoicesLink({ customer: customer.customer_id })}>
            Open in Invoice Detail →
          </Link>
        </h2>
        <DataTable columns={invColumns} rows={invoices} rowKey={(i) => i.invoice_id} compact caption={`Invoices of ${customer.customer_name}`} emptyMessage="No invoices for this customer." />
      </section>

      <section className="card section" aria-labelledby="act-h">
        <h2 className="card-title" id="act-h">
          Collection activity timeline ({activities.length})
        </h2>
        {activities.length === 0 ? (
          <p className="muted">No collection activities recorded for this customer.</p>
        ) : (
          <ol className="timeline">
            {activities.map((a) => (
              <li key={a.activity_id}>
                <span className="t-date">{a.activity_date}</span>
                <div className="t-body">
                  <div className="badges">
                    <StatusPill tone={a.activity_type === 'ESCALATION' || a.activity_type === 'DISPUTE' ? 'critical' : a.activity_type === 'PROMISE' ? 'info' : 'neutral'} icon={false}>
                      {a.activity_type}
                    </StatusPill>
                    <span className="t-meta">
                      {a.owner}
                      {a.contact_channel ? ` · ${a.contact_channel}` : ''}
                      {a.invoice_id ? ` · invoice ${invoices.find((i) => i.invoice_id === a.invoice_id)?.invoice_number ?? a.invoice_id}` : ''}
                      {a.escalation_level > 0 ? ` · escalation L${a.escalation_level}` : ''}
                      {a.completed ? ' · completed' : ''}
                    </span>
                  </div>
                  <p>{a.note}</p>
                  {(a.promised_payment_date || a.promised_payment_amount !== null) && (
                    <p className="t-meta">
                      Promised: {fmtDate(a.promised_payment_date)}
                      {a.promised_payment_amount !== null ? ` · ${formatMoney(a.promised_payment_amount, a.promised_currency ?? ccy)}` : ''}
                    </p>
                  )}
                  {a.next_action && (
                    <p className="t-meta">
                      Next action: {a.next_action}
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
