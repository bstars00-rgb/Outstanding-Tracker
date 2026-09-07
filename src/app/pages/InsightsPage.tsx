import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, formatPct } from '@core/money';
import type { DimensionAging } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { useI18n } from '@app/i18n/useI18n';
import { PageHeader } from '@app/components/PageHeader';
import { DataTable, type Column } from '@app/components/DataTable';
import { Money } from '@app/components/Money';
import { StatusPill } from '@app/components/StatusPill';
import { Banner } from '@app/components/Banner';
import { relChange } from '@app/lib/format';

export function InsightsPage() {
  const { model, insight } = useReadyTracker();
  const { t, te } = useI18n();
  const ccy = model.reporting_currency;
  const out = insight.output;

  const ownerGroups = useMemo(() => {
    const m = new Map<string, typeof out.owner_actions>();
    for (const a of out.owner_actions) m.set(a.owner, [...(m.get(a.owner) ?? []), a]);
    return [...m.entries()].sort((a, b) => b[1].reduce((s, x) => s + x.amount, 0) - a[1].reduce((s, x) => s + x.amount, 0));
  }, [out.owner_actions]);

  const countryAnomalies = useMemo(() => model.aging_by_country.filter((c) => c.previous_overdue !== null && c.previous_overdue > 0 && (c.overdue - c.previous_overdue) / c.previous_overdue > 0.1), [model.aging_by_country]);

  const ownerColumns: Column<DimensionAging>[] = [
    { key: 'owner', header: t('col.owner'), sortValue: (r) => r.label, render: (r) => r.label },
    { key: 'total', header: t('col.totalOutstanding'), align: 'right', sortValue: (r) => r.total, render: (r) => <Money amount={r.total} currency={ccy} /> },
    { key: 'overdue', header: t('col.overdue'), align: 'right', sortValue: (r) => r.overdue, render: (r) => <Money amount={r.overdue} currency={ccy} /> },
    { key: 'ratio', header: t('col.overdueRatio'), align: 'right', sortValue: (r) => (r.total ? r.overdue / r.total : 0), render: (r) => formatPct(r.total ? r.overdue / r.total : 0) },
    { key: 'prev', header: t('col.prevOverdue'), align: 'right', sortValue: (r) => r.previous_overdue, render: (r) => <Money amount={r.previous_overdue} currency={ccy} /> },
    {
      key: 'change',
      header: t('col.wowChange'),
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
    { key: 'over30', header: t('col.over30days'), align: 'right', sortValue: (r) => r.buckets.D31_60 + r.buckets.D61_90 + r.buckets.D90_PLUS, render: (r) => <Money amount={r.buckets.D31_60 + r.buckets.D61_90 + r.buckets.D90_PLUS} currency={ccy} /> },
  ];

  const conf = out.forecast_next_week.confidence;

  return (
    <div>
      <PageHeader
        title={t('insights.title')}
        subtitle={
          <>
            {t('insights.subtitle', { date: model.reference_date, prev: model.previous_snapshot_date ?? t('footer.noPrior'), provider: insight.provider })}
            {insight.fallback_used ? t('insights.fallbackSuffix') : ''}
          </>
        }
      />

      {insight.fallback_used && (
        <Banner kind="warning" title={t('insights.fallbackTitle')}>
          {insight.error ?? t('insights.fallbackBody')}
        </Banner>
      )}

      <div className="grid-2 section">
        <section className="card" aria-labelledby="ins-exec">
          <h2 className="card-title" id="ins-exec">
            {t('insights.exec')}
          </h2>
          <ul className="bullets">
            {out.executive_summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="ins-changes">
          <h2 className="card-title" id="ins-changes">
            {t('insights.changes')}
          </h2>
          {out.major_changes.length === 0 ? (
            <p className="muted">{t('insights.noChanges')}</p>
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
          {t('insights.topRisks')}
        </h2>
        <div className="table-scroll">
          <table className="data compact">
            <thead>
              <tr>
                <th scope="col">{t('col.customer')}</th>
                <th scope="col">{t('col.owner')}</th>
                <th scope="col" className="num">
                  {t('col.amount')}
                </th>
                <th scope="col">{t('col.reason')}</th>
                <th scope="col">{t('col.action')}</th>
                <th scope="col">{t('col.due')}</th>
              </tr>
            </thead>
            <tbody>
              {out.top_risks.length === 0 && (
                <tr>
                  <td className="empty" colSpan={6}>
                    {t('insights.noTopRisks')}
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
            {t('insights.opportunities')}
          </h2>
          {out.collection_opportunities.length === 0 ? (
            <p className="muted">{t('insights.noOpportunities')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data compact">
                <thead>
                  <tr>
                    <th scope="col">{t('col.customer')}</th>
                    <th scope="col">{t('col.owner')}</th>
                    <th scope="col" className="num">
                      {t('col.amount')}
                    </th>
                    <th scope="col">{t('col.why')}</th>
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
            {t('insights.forecast')}
            <StatusPill tone={conf === 'high' ? 'good' : conf === 'medium' ? 'info' : 'warning'} title={conf}>
              {t('insights.confidence', { level: te('confidence', conf) })}
            </StatusPill>
          </h2>
          <p className="kpi-value">{formatMoney(out.forecast_next_week.expected_collection, out.forecast_next_week.currency)}</p>
          <p className="small muted" style={{ marginBottom: 8 }}>
            {t('insights.expected')}
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
          {t('insights.bottlenecks')}
        </h2>
        {ownerGroups.length === 0 ? (
          <p className="muted">{t('insights.noOwnerActions')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data compact">
              <thead>
                <tr>
                  <th scope="col">{t('col.owner')}</th>
                  <th scope="col">{t('col.customer')}</th>
                  <th scope="col" className="num">
                    {t('col.amount')}
                  </th>
                  <th scope="col">{t('col.action')}</th>
                  <th scope="col">{t('col.deadline')}</th>
                </tr>
              </thead>
              <tbody>
                {ownerGroups.map(([owner, rows]) =>
                  rows.map((r, i) => (
                    <tr key={`${owner}-${i}`}>
                      <td>
                        {i === 0 ? (
                          <strong>
                            {owner} <span className="cell-sub">{t('insights.actionsCount', { n: rows.length, amount: formatMoney(rows.reduce((s, x) => s + x.amount, 0), ccy) })}</span>
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
          {t('insights.decisions')}
        </h2>
        {out.ceo_decisions.length === 0 ? (
          <p className="muted">{t('insights.noDecisions')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data compact">
              <thead>
                <tr>
                  <th scope="col">{t('col.topic')}</th>
                  <th scope="col">{t('col.customer')}</th>
                  <th scope="col" className="num">
                    {t('col.amount')}
                  </th>
                  <th scope="col">{t('col.recommendation')}</th>
                  <th scope="col">{t('col.rationale')}</th>
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
            {t('insights.byOwner')}
          </h2>
          <DataTable columns={ownerColumns} rows={model.aging_by_owner} rowKey={(r) => r.key} defaultSort={{ key: 'overdue', dir: 'desc' }} compact caption={t('insights.byOwnerCaption')} />
        </section>
        <section className="card" aria-labelledby="ins-country">
          <h2 className="card-title" id="ins-country">
            {t('insights.anomalies')} <span className="muted small">{t('insights.anomaliesHint')}</span>
          </h2>
          {countryAnomalies.length === 0 ? (
            <p className="muted">{t('insights.noAnomalies')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data compact">
                <thead>
                  <tr>
                    <th scope="col">{t('col.country')}</th>
                    <th scope="col" className="num">
                      {t('col.overdue')}
                    </th>
                    <th scope="col" className="num">
                      {t('col.previous')}
                    </th>
                    <th scope="col" className="num">
                      {t('col.change')}
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
          <Banner kind="warning" title={t('insights.dqTitle')}>
            <ul>
              {out.data_quality_warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Banner>
        </section>
      )}

      <footer className="card provenance" aria-label={t('insights.provenanceAria')}>
        <div>
          <strong>{t('insights.provider')}</strong> {insight.provider} · <strong>{t('insights.model')}</strong> {insight.model ?? t('insights.noModel')} · <strong>{t('insights.generatedAt')}</strong> {insight.generated_at}
        </div>
        <div>
          <strong>{t('insights.verification')}</strong> {insight.verification.ok ? t('insights.verOk') : t('insights.verIssues')} ·{' '}
          {t('insights.verStats', {
            checked: insight.verification.checked_numbers,
            unverified: insight.verification.unverified_numbers.length,
            customers: insight.verification.unknown_customers.length,
            owners: insight.verification.unknown_owners.length,
          })}
        </div>
        {insight.verification.notes.length > 0 && (
          <ul>
            {insight.verification.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        <div>{t('insights.aiNote')}</div>
      </footer>
    </div>
  );
}
