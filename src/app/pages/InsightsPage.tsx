import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, formatPct } from '@core/money';
import type { DimensionAging } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { PageHeader } from '@app/components/PageHeader';
import { DataTable, type Column } from '@app/components/DataTable';
import { Money } from '@app/components/Money';
import { StatusPill } from '@app/components/StatusPill';
import { Banner } from '@app/components/Banner';
import { relChange } from '@app/lib/format';

export function InsightsPage() {
  const { model, insight } = useReadyTracker();
  const ccy = model.reporting_currency;
  const out = insight.output;

  const ownerGroups = useMemo(() => {
    const m = new Map<string, typeof out.owner_actions>();
    for (const a of out.owner_actions) m.set(a.owner, [...(m.get(a.owner) ?? []), a]);
    return [...m.entries()].sort((a, b) => b[1].reduce((s, x) => s + x.amount, 0) - a[1].reduce((s, x) => s + x.amount, 0));
  }, [out.owner_actions]);

  const countryAnomalies = useMemo(() => model.aging_by_country.filter((c) => c.previous_overdue !== null && c.previous_overdue > 0 && (c.overdue - c.previous_overdue) / c.previous_overdue > 0.1), [model.aging_by_country]);

  const ownerColumns: Column<DimensionAging>[] = [
    { key: 'owner', header: 'Owner', sortValue: (r) => r.label, render: (r) => r.label },
    { key: 'total', header: 'Total outstanding', align: 'right', sortValue: (r) => r.total, render: (r) => <Money amount={r.total} currency={ccy} /> },
    { key: 'overdue', header: 'Overdue', align: 'right', sortValue: (r) => r.overdue, render: (r) => <Money amount={r.overdue} currency={ccy} /> },
    { key: 'ratio', header: 'Overdue ratio', align: 'right', sortValue: (r) => (r.total ? r.overdue / r.total : 0), render: (r) => formatPct(r.total ? r.overdue / r.total : 0) },
    { key: 'prev', header: 'Prev. overdue', align: 'right', sortValue: (r) => r.previous_overdue, render: (r) => <Money amount={r.previous_overdue} currency={ccy} /> },
    {
      key: 'change',
      header: 'WoW change',
      align: 'right',
      sortValue: (r) => (r.previous_overdue === null ? null : r.overdue - r.previous_overdue),
      render: (r) =>
        r.previous_overdue === null ? (
          <span className="muted">—</span>
        ) : (
          <>
            <Money amount={r.overdue - r.previous_overdue} currency={ccy} signed tone />
            <span className="cell-sub">{formatPct(relChange(r.overdue, r.previous_overdue), { signed: true })}</span>
          </>
        ),
    },
    { key: 'over30', header: '30+ days', align: 'right', sortValue: (r) => r.buckets.D31_60 + r.buckets.D61_90 + r.buckets.D90_PLUS, render: (r) => <Money amount={r.buckets.D31_60 + r.buckets.D61_90 + r.buckets.D90_PLUS} currency={ccy} /> },
  ];

  const conf = out.forecast_next_week.confidence;

  return (
    <div>
      <PageHeader
        title="Weekly AI Insight"
        subtitle={
          <>
            Week ending {model.reference_date} · compared with {model.previous_snapshot_date ?? 'no prior snapshot'} · provider {insight.provider}
            {insight.fallback_used ? ' (fallback)' : ''}
          </>
        }
      />

      {insight.fallback_used && <Banner kind="warning" title="Fallback insight.">{insight.error ?? 'The primary provider failed verification; the rule-based provider produced this insight.'}</Banner>}

      <div className="grid-2 section">
        <section className="card" aria-labelledby="ins-exec">
          <h2 className="card-title" id="ins-exec">
            Executive summary
          </h2>
          <ul className="bullets">
            {out.executive_summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="ins-changes">
          <h2 className="card-title" id="ins-changes">
            Key changes this week
          </h2>
          {out.major_changes.length === 0 ? (
            <p className="muted">No material changes vs last week.</p>
          ) : (
            <ul className="bullets">
              {out.major_changes.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card section" aria-labelledby="ins-risks">
        <h2 className="card-title" id="ins-risks">
          Top risks
        </h2>
        <div className="table-scroll">
          <table className="data compact">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Owner</th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">Reason</th>
                <th scope="col">Action</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {out.top_risks.length === 0 && (
                <tr>
                  <td className="empty" colSpan={6}>
                    No top risks flagged.
                  </td>
                </tr>
              )}
              {out.top_risks.map((r, i) => {
                const c = model.customers.find((x) => x.customer_name === r.customer);
                return (
                  <tr key={i}>
                    <td>{c ? <Link to={`/customers/${encodeURIComponent(c.customer_id)}`}>{r.customer}</Link> : r.customer}</td>
                    <td>{r.owner}</td>
                    <td className="num">{formatMoney(r.amount, ccy)}</td>
                    <td style={{ minWidth: 220 }}>{r.reason}</td>
                    <td style={{ minWidth: 220 }}>{r.action}</td>
                    <td className="tnum nowrap">{r.due}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="ins-opp">
          <h2 className="card-title" id="ins-opp">
            Collection opportunities
          </h2>
          {out.collection_opportunities.length === 0 ? (
            <p className="muted">No quick-win opportunities identified.</p>
          ) : (
            <div className="table-scroll">
              <table className="data compact">
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Owner</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {out.collection_opportunities.map((o, i) => (
                    <tr key={i}>
                      <td>{o.customer}</td>
                      <td>{o.owner}</td>
                      <td className="num">{formatMoney(o.amount, ccy)}</td>
                      <td>{o.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="ins-forecast">
          <h2 className="card-title" id="ins-forecast">
            Forecast next week
            <StatusPill tone={conf === 'high' ? 'good' : conf === 'medium' ? 'info' : 'warning'}>confidence {conf}</StatusPill>
          </h2>
          <p className="kpi-value">{formatMoney(out.forecast_next_week.expected_collection, out.forecast_next_week.currency)}</p>
          <p className="small muted" style={{ marginBottom: 8 }}>
            Expected collection
          </p>
          <ul className="bullets small">
            {out.forecast_next_week.basis.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card section" aria-labelledby="ins-owner">
        <h2 className="card-title" id="ins-owner">
          Bottlenecks by owner — required actions
        </h2>
        {ownerGroups.length === 0 ? (
          <p className="muted">No owner actions.</p>
        ) : (
          <div className="table-scroll">
            <table className="data compact">
              <thead>
                <tr>
                  <th scope="col">Owner</th>
                  <th scope="col">Customer</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col">Action</th>
                  <th scope="col">Deadline</th>
                </tr>
              </thead>
              <tbody>
                {ownerGroups.map(([owner, rows]) =>
                  rows.map((r, i) => (
                    <tr key={`${owner}-${i}`}>
                      <td>
                        {i === 0 ? (
                          <strong>
                            {owner} <span className="cell-sub">{rows.length} action(s) · {formatMoney(rows.reduce((s, x) => s + x.amount, 0), ccy)}</span>
                          </strong>
                        ) : (
                          ''
                        )}
                      </td>
                      <td>{r.customer}</td>
                      <td className="num">{formatMoney(r.amount, ccy)}</td>
                      <td style={{ minWidth: 220 }}>{r.action}</td>
                      <td className="tnum nowrap">{r.deadline}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card section" aria-labelledby="ins-ceo">
        <h2 className="card-title" id="ins-ceo">
          Decisions for leadership
        </h2>
        {out.ceo_decisions.length === 0 ? (
          <p className="muted">No leadership decisions required this week.</p>
        ) : (
          <div className="table-scroll">
            <table className="data compact">
              <thead>
                <tr>
                  <th scope="col">Topic</th>
                  <th scope="col">Customer</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col">Recommendation</th>
                  <th scope="col">Rationale</th>
                </tr>
              </thead>
              <tbody>
                {out.ceo_decisions.map((d, i) => (
                  <tr key={i}>
                    <td>{d.topic}</td>
                    <td>{d.customer ?? <span className="muted">—</span>}</td>
                    <td className="num">{d.amount === null ? '—' : formatMoney(d.amount, ccy)}</td>
                    <td style={{ minWidth: 200 }}>{d.recommendation}</td>
                    <td style={{ minWidth: 200 }}>{d.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="ins-byowner">
          <h2 className="card-title" id="ins-byowner">
            By owner
          </h2>
          <DataTable columns={ownerColumns} rows={model.aging_by_owner} rowKey={(r) => r.key} defaultSort={{ key: 'overdue', dir: 'desc' }} compact caption="Aging by account owner" />
        </section>
        <section className="card" aria-labelledby="ins-country">
          <h2 className="card-title" id="ins-country">
            By country anomalies <span className="muted small">overdue up &gt;10% WoW</span>
          </h2>
          {countryAnomalies.length === 0 ? (
            <p className="muted">No country increased overdue by more than 10% vs last week.</p>
          ) : (
            <div className="table-scroll">
              <table className="data compact">
                <thead>
                  <tr>
                    <th scope="col">Country</th>
                    <th scope="col" className="num">
                      Overdue
                    </th>
                    <th scope="col" className="num">
                      Previous
                    </th>
                    <th scope="col" className="num">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {countryAnomalies.map((c) => (
                    <tr key={c.key}>
                      <td>{c.label}</td>
                      <td className="num">{formatMoney(c.overdue, ccy)}</td>
                      <td className="num">{formatMoney(c.previous_overdue ?? 0, ccy)}</td>
                      <td className="num">
                        <Money amount={c.overdue - (c.previous_overdue ?? 0)} currency={ccy} signed tone />
                        <span className="cell-sub">{formatPct(relChange(c.overdue, c.previous_overdue), { signed: true })}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {out.data_quality_warnings.length > 0 && (
        <section className="section">
          <Banner kind="warning" title="Data-quality warnings.">
            <ul>
              {out.data_quality_warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Banner>
        </section>
      )}

      <footer className="card provenance" aria-label="Insight provenance">
        <div>
          <strong>Provider:</strong> {insight.provider} · <strong>Model:</strong> {insight.model ?? 'n/a (deterministic rules)'} · <strong>Generated at:</strong> {insight.generated_at}
        </div>
        <div>
          <strong>Verification:</strong> {insight.verification.ok ? 'OK' : 'issues found'} · {insight.verification.checked_numbers} numbers checked · {insight.verification.unverified_numbers.length} unverified · {insight.verification.unknown_customers.length} unknown customers ·{' '}
          {insight.verification.unknown_owners.length} unknown owners
        </div>
        {insight.verification.notes.length > 0 && (
          <ul>
            {insight.verification.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        <div>AI interprets computed data only; all figures are traceable to the tracker.</div>
      </footer>
    </div>
  );
}
