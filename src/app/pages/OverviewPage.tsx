import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatPct } from '@core/money';
import { AGING_BUCKET_LABEL_I18N } from '@core/i18n';
import { AGING_BUCKETS, type CustomerRisk } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { useI18n } from '@app/i18n/useI18n';
import { KpiCard } from '@app/components/KpiCard';
import { PageHeader } from '@app/components/PageHeader';
import { DataTable, type Column } from '@app/components/DataTable';
import { RiskBadge } from '@app/components/RiskBadge';
import { Money } from '@app/components/Money';
import { ChartWithTable } from '@app/components/ChartWithTable';
import { chartProps, useChartColors } from '@app/components/chart-theme';
import { customerLink } from '@app/lib/links';

export function OverviewPage() {
  const { model, insight } = useReadyTracker();
  const { lang, t } = useI18n();
  const colors = useChartColors();
  const cp = chartProps(colors);
  const ccy = model.reporting_currency;
  const bucketLabel = AGING_BUCKET_LABEL_I18N[lang];

  const topRisk = useMemo(() => [...model.customers].sort((a, b) => b.risk.score - a.risk.score || b.overdue_reporting - a.overdue_reporting).slice(0, 5), [model.customers]);
  const moversUp = useMemo(
    () =>
      model.customers
        .filter((c) => (c.wow_overdue_change_reporting ?? 0) > 0)
        .sort((a, b) => (b.wow_overdue_change_reporting ?? 0) - (a.wow_overdue_change_reporting ?? 0))
        .slice(0, 5),
    [model.customers],
  );
  const moversDown = useMemo(
    () =>
      model.customers
        .filter((c) => (c.wow_overdue_change_reporting ?? 0) < 0)
        .sort((a, b) => (a.wow_overdue_change_reporting ?? 0) - (b.wow_overdue_change_reporting ?? 0))
        .slice(0, 5),
    [model.customers],
  );

  const riskColumns: Column<CustomerRisk>[] = [
    { key: 'name', header: t('col.customer'), render: (c) => <Link to={customerLink(c.customer_id)}>{c.customer_name}</Link> },
    { key: 'country', header: t('col.country'), render: (c) => c.country },
    { key: 'owner', header: t('col.owner'), render: (c) => c.account_owner_name || t('common.unassigned') },
    { key: 'ccy', header: t('col.contractCurrency'), render: (c) => <span className="tnum">{c.contract_currency}</span> },
    {
      key: 'overdue',
      header: t('col.overdue'),
      align: 'right',
      render: (c) => <Money amount={c.overdue_reporting} currency={ccy} originals={c.totals_by_currency.map((x) => ({ amount: x.overdue, currency: x.currency }))} />,
    },
    { key: 'risk', header: t('col.risk'), render: (c) => <RiskBadge risk={c.risk} /> },
  ];
  const moverColumns: Column<CustomerRisk>[] = [
    { key: 'name', header: t('col.customer'), render: (c) => <Link to={customerLink(c.customer_id)}>{c.customer_name}</Link> },
    { key: 'owner', header: t('col.owner'), render: (c) => c.account_owner_name || t('common.unassigned') },
    { key: 'change', header: t('col.wowOverdueChange'), align: 'right', render: (c) => <Money amount={c.wow_overdue_change_reporting} currency={ccy} signed tone /> },
    { key: 'overdue', header: t('col.overdueNow'), align: 'right', render: (c) => <Money amount={c.overdue_reporting} currency={ccy} /> },
  ];

  const stackData = useMemo(() => {
    const cur: Record<string, number | string> = { name: t('overview.thisWeek', { date: model.reference_date }) };
    const prev: Record<string, number | string> = { name: t('overview.lastWeek', { date: model.previous_snapshot_date ?? t('common.na') }) };
    for (const b of model.aging_by_bucket) {
      cur[b.bucket] = b.amount;
      prev[b.bucket] = b.previous ?? 0;
    }
    return model.previous_snapshot_date ? [cur, prev] : [cur];
  }, [model, t]);

  const stackRows = model.aging_by_bucket.map((b) => [bucketLabel[b.bucket], formatMoney(b.amount, ccy), formatPct(b.share), b.previous === null ? '—' : formatMoney(b.previous, ccy)]);

  return (
    <div>
      <PageHeader
        title={t('overview.title')}
        subtitle={t('overview.subtitle', {
          start: model.week.start,
          end: model.week.end,
          prev: model.previous_snapshot_date ?? t('footer.noPrior'),
          customers: model.customers.length,
          invoices: model.invoices.length,
        })}
      />

      <section className="section" aria-label={t('overview.kpiAria')}>
        <div className="kpi-grid">
          {model.kpis.map((k) => (
            <KpiCard key={k.key} kpi={k} currency={ccy} />
          ))}
        </div>
        {model.fx_effect_reporting !== null && (
          <p className="small muted" style={{ marginTop: 10 }}>
            {t('overview.fxEffect', { amount: formatMoney(model.fx_effect_reporting, ccy, { signed: true }), date: model.fx.as_of })}
          </p>
        )}
      </section>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="top-risk-h">
          <h2 className="card-title" id="top-risk-h">
            {t('overview.topRisk')}
            <Link to="/customers" className="small">
              {t('overview.allCustomers')}
            </Link>
          </h2>
          <DataTable columns={riskColumns} rows={topRisk} rowKey={(c) => c.customer_id} compact emptyMessage={t('overview.noCustomers')} testId="top-risk-table" />
        </section>

        <section className="card" aria-labelledby="exec-h">
          <h2 className="card-title" id="exec-h">
            {t('overview.execSummary')}
            <Link to="/insights" className="small">
              {t('overview.fullInsight')}
            </Link>
          </h2>
          <ul className="bullets">
            {insight.output.executive_summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <p className="small muted" style={{ marginTop: 10 }}>
            {t('overview.generatedBy', { provider: insight.provider })}
            {insight.model ? ` (${insight.model})` : ''} · {insight.verification.ok ? t('overview.verifiedOk') : t('overview.verifiedNotes')} · {t('overview.aiNote')}
          </p>
        </section>
      </div>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="movers-up-h">
          <h2 className="card-title" id="movers-up-h">
            {t('overview.moversUp')}
          </h2>
          <DataTable columns={moverColumns} rows={moversUp} rowKey={(c) => c.customer_id} compact emptyMessage={t('overview.noMoversUp')} />
        </section>
        <section className="card" aria-labelledby="movers-down-h">
          <h2 className="card-title" id="movers-down-h">
            {t('overview.moversDown')}
          </h2>
          <DataTable columns={moverColumns} rows={moversDown} rowKey={(c) => c.customer_id} compact emptyMessage={t('overview.noMoversDown')} />
        </section>
      </div>

      <section className="card section" aria-labelledby="aging-h">
        <h2 className="card-title" id="aging-h">
          {t('overview.agingProfile')}
          <Link to="/aging" className="small">
            {t('overview.agingLink')}
          </Link>
        </h2>
        <ChartWithTable title={t('overview.agingChartTitle')} columns={[t('col.bucket'), t('col.amount'), t('col.share'), t('col.prevWeek')]} rows={stackRows} height={stackData.length > 1 ? 180 : 120}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stackData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} {...cp.grid} />
              <XAxis type="number" tickFormatter={(v) => formatMoney(Number(v), ccy, { compact: true })} fontSize={11} {...cp.axis} />
              <YAxis type="category" dataKey="name" width={150} fontSize={11} {...cp.axis} />
              <Tooltip formatter={(v, name) => [formatMoney(Number(v), ccy), bucketLabel[String(name)] ?? String(name)]} {...cp.tooltip} />
              <Legend formatter={(v) => bucketLabel[String(v)] ?? v} {...cp.legend} />
              {AGING_BUCKETS.map((b) => (
                <Bar key={b} dataKey={b} stackId="a" fill={colors.buckets[b]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartWithTable>
      </section>
    </div>
  );
}
