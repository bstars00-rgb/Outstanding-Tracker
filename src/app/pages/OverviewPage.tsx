import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatPct } from '@core/money';
import { AGING_BUCKET_LABEL, AGING_BUCKETS, type CustomerRisk } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { KpiCard } from '@app/components/KpiCard';
import { PageHeader } from '@app/components/PageHeader';
import { DataTable, type Column } from '@app/components/DataTable';
import { RiskBadge } from '@app/components/RiskBadge';
import { Money } from '@app/components/Money';
import { BUCKET_COLORS, ChartWithTable } from '@app/components/ChartWithTable';
import { customerLink } from '@app/lib/links';

export function OverviewPage() {
  const { model, insight } = useReadyTracker();
  const ccy = model.reporting_currency;

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
    { key: 'name', header: 'Customer', render: (c) => <Link to={customerLink(c.customer_id)}>{c.customer_name}</Link> },
    { key: 'country', header: 'Country', render: (c) => c.country },
    { key: 'owner', header: 'Owner', render: (c) => c.account_owner_name || 'Unassigned' },
    { key: 'overdue', header: 'Overdue', align: 'right', render: (c) => <Money amount={c.overdue_reporting} currency={ccy} /> },
    { key: 'risk', header: 'Risk', render: (c) => <RiskBadge risk={c.risk} /> },
  ];
  const moverColumns: Column<CustomerRisk>[] = [
    { key: 'name', header: 'Customer', render: (c) => <Link to={customerLink(c.customer_id)}>{c.customer_name}</Link> },
    { key: 'owner', header: 'Owner', render: (c) => c.account_owner_name || 'Unassigned' },
    { key: 'change', header: 'WoW overdue change', align: 'right', render: (c) => <Money amount={c.wow_overdue_change_reporting} currency={ccy} signed tone /> },
    { key: 'overdue', header: 'Overdue now', align: 'right', render: (c) => <Money amount={c.overdue_reporting} currency={ccy} /> },
  ];

  const stackData = useMemo(() => {
    const cur: Record<string, number | string> = { name: `This week (${model.reference_date})` };
    const prev: Record<string, number | string> = { name: `Last week (${model.previous_snapshot_date ?? 'n/a'})` };
    for (const b of model.aging_by_bucket) {
      cur[b.bucket] = b.amount;
      prev[b.bucket] = b.previous ?? 0;
    }
    return model.previous_snapshot_date ? [cur, prev] : [cur];
  }, [model]);

  const stackRows = model.aging_by_bucket.map((b) => [AGING_BUCKET_LABEL[b.bucket], formatMoney(b.amount, ccy), formatPct(b.share), b.previous === null ? '—' : formatMoney(b.previous, ccy)]);

  return (
    <div>
      <PageHeader
        title="Executive Overview"
        subtitle={
          <>
            Reporting week {model.week.start} to {model.week.end} · compared with {model.previous_snapshot_date ?? 'no prior snapshot'} · {model.customers.length} customers, {model.invoices.length} invoices
          </>
        }
      />

      <section className="section" aria-label="Key performance indicators">
        <div className="kpi-grid">
          {model.kpis.map((k) => (
            <KpiCard key={k.key} kpi={k} currency={ccy} />
          ))}
        </div>
        {model.fx_effect_reporting !== null && (
          <p className="small muted" style={{ marginTop: 10 }}>
            FX effect on WoW total change: {formatMoney(model.fx_effect_reporting, ccy, { signed: true })} of the week-over-week movement in total outstanding is attributable to exchange-rate changes
            (rates as of {model.fx.as_of}).
          </p>
        )}
      </section>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="top-risk-h">
          <h2 className="card-title" id="top-risk-h">
            Top 5 risk customers
            <Link to="/customers" className="small">
              All customers →
            </Link>
          </h2>
          <DataTable columns={riskColumns} rows={topRisk} rowKey={(c) => c.customer_id} compact emptyMessage="No customers." />
        </section>

        <section className="card" aria-labelledby="exec-h">
          <h2 className="card-title" id="exec-h">
            Executive summary
            <Link to="/insights" className="small">
              Full weekly insight →
            </Link>
          </h2>
          <ul className="bullets">
            {insight.output.executive_summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <p className="small muted" style={{ marginTop: 10 }}>
            Generated by {insight.provider}
            {insight.model ? ` (${insight.model})` : ''} · verified {insight.verification.ok ? 'OK' : 'with notes'} · AI interprets computed data only.
          </p>
        </section>
      </div>

      <div className="grid-2 section">
        <section className="card" aria-labelledby="movers-up-h">
          <h2 className="card-title" id="movers-up-h">
            WoW movers — overdue increased
          </h2>
          <DataTable columns={moverColumns} rows={moversUp} rowKey={(c) => c.customer_id} compact emptyMessage="No customer's overdue increased this week." />
        </section>
        <section className="card" aria-labelledby="movers-down-h">
          <h2 className="card-title" id="movers-down-h">
            WoW movers — overdue decreased
          </h2>
          <DataTable columns={moverColumns} rows={moversDown} rowKey={(c) => c.customer_id} compact emptyMessage="No customer's overdue decreased this week." />
        </section>
      </div>

      <section className="card section" aria-labelledby="aging-h">
        <h2 className="card-title" id="aging-h">
          Aging profile
          <Link to="/aging" className="small">
            Aging analysis →
          </Link>
        </h2>
        <ChartWithTable title="Outstanding by aging bucket, this week vs last week" columns={['Bucket', 'Amount', 'Share', 'Previous week']} rows={stackRows} height={stackData.length > 1 ? 180 : 120}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stackData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => formatMoney(Number(v), ccy, { compact: true })} fontSize={11} />
              <YAxis type="category" dataKey="name" width={150} fontSize={11} />
              <Tooltip formatter={(v, name) => [formatMoney(Number(v), ccy), AGING_BUCKET_LABEL[name as keyof typeof AGING_BUCKET_LABEL] ?? String(name)]} />
              <Legend formatter={(v) => AGING_BUCKET_LABEL[v as keyof typeof AGING_BUCKET_LABEL] ?? v} wrapperStyle={{ fontSize: 11 }} />
              {AGING_BUCKETS.map((b) => (
                <Bar key={b} dataKey={b} stackId="a" fill={BUCKET_COLORS[b]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartWithTable>
      </section>
    </div>
  );
}
