import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatPct } from '@core/money';
import { AGING_BUCKET_LABEL, AGING_BUCKETS, type AgingBucket, type DimensionAging } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { PageHeader } from '@app/components/PageHeader';
import { DataTable, type Column } from '@app/components/DataTable';
import { Money } from '@app/components/Money';
import { BUCKET_COLORS, CHART_ACCENT, CHART_MUTED, ChartWithTable } from '@app/components/ChartWithTable';
import { invoicesLink, type InvoiceFilterParams } from '@app/lib/links';
import { relChange } from '@app/lib/format';

type DimKey = 'country' | 'owner' | 'customer' | 'currency';
const DIMS: { key: DimKey; label: string; param: keyof InvoiceFilterParams; useKey: boolean }[] = [
  { key: 'country', label: 'By Country', param: 'country', useKey: false },
  { key: 'owner', label: 'By Account Owner', param: 'owner', useKey: false },
  { key: 'customer', label: 'By Customer (top 15)', param: 'customer', useKey: true },
  { key: 'currency', label: 'By Currency', param: 'currency', useKey: true },
];

const SHORT_BUCKET: Record<AgingBucket, string> = {
  CURRENT: 'Current',
  D1_7: '1-7d',
  D8_14: '8-14d',
  D15_30: '15-30d',
  D31_60: '31-60d',
  D61_90: '61-90d',
  D90_PLUS: '90+d',
};

export function AgingPage() {
  const { model } = useReadyTracker();
  const ccy = model.reporting_currency;
  const [dim, setDim] = useState<DimKey>('country');

  const bucketRows = model.aging_by_bucket;
  const totalOpen = model.snapshot.totals.total_outstanding;
  const unknownDue = model.unknown_due_reporting;

  type BucketRow = (typeof bucketRows)[number];
  const bucketColumns: Column<BucketRow>[] = [
    { key: 'bucket', header: 'Bucket', render: (r) => <Link to={invoicesLink({ bucket: r.bucket })}>{AGING_BUCKET_LABEL[r.bucket]}</Link> },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => r.amount, render: (r) => <Money amount={r.amount} currency={ccy} /> },
    { key: 'share', header: 'Share', align: 'right', sortValue: (r) => r.share, render: (r) => formatPct(r.share) },
    { key: 'prev', header: 'Previous week', align: 'right', sortValue: (r) => r.previous, render: (r) => <Money amount={r.previous} currency={ccy} /> },
    {
      key: 'change',
      header: 'Change',
      align: 'right',
      sortValue: (r) => (r.previous === null ? null : r.amount - r.previous),
      render: (r) =>
        r.previous === null ? (
          <span className="muted">—</span>
        ) : (
          <>
            <Money amount={r.amount - r.previous} currency={ccy} signed tone />
            <span className="cell-sub">{formatPct(relChange(r.amount, r.previous), { signed: true })}</span>
          </>
        ),
    },
  ];

  const bucketChart = bucketRows.map((b) => ({ name: SHORT_BUCKET[b.bucket], full: AGING_BUCKET_LABEL[b.bucket], 'This week': b.amount, 'Last week': b.previous ?? 0, bucket: b.bucket }));

  const dimMeta = DIMS.find((d) => d.key === dim)!;
  const dimRows: DimensionAging[] = useMemo(() => {
    const src = dim === 'country' ? model.aging_by_country : dim === 'owner' ? model.aging_by_owner : dim === 'customer' ? model.aging_by_customer : model.aging_by_currency;
    return dim === 'customer' ? [...src].sort((a, b) => b.total - a.total).slice(0, 15) : src;
  }, [dim, model]);

  const linkFor = (row: DimensionAging, bucket?: AgingBucket) => invoicesLink({ [dimMeta.param]: dimMeta.useKey ? row.key : row.label, bucket: bucket ?? null });

  const dimColumns: Column<DimensionAging>[] = [
    {
      key: 'label',
      header: dim === 'country' ? 'Country' : dim === 'owner' ? 'Account owner' : dim === 'customer' ? 'Customer' : 'Currency',
      sortValue: (r) => r.label,
      render: (r) => (dim === 'customer' ? <Link to={`/customers/${encodeURIComponent(r.key)}`}>{r.label}</Link> : <Link to={linkFor(r)}>{r.label}</Link>),
    },
    { key: 'total', header: 'Total outstanding', align: 'right', sortValue: (r) => r.total, render: (r) => <Money amount={r.total} currency={ccy} /> },
    { key: 'overdue', header: 'Overdue', align: 'right', sortValue: (r) => r.overdue, render: (r) => <Money amount={r.overdue} currency={ccy} /> },
    { key: 'prev', header: 'Prev. overdue', align: 'right', sortValue: (r) => r.previous_overdue, render: (r) => <Money amount={r.previous_overdue} currency={ccy} /> },
    {
      key: 'change',
      header: 'Change',
      align: 'right',
      sortValue: (r) => (r.previous_overdue === null ? null : r.overdue - r.previous_overdue),
      render: (r) => (r.previous_overdue === null ? <span className="muted">—</span> : <Money amount={r.overdue - r.previous_overdue} currency={ccy} signed tone />),
    },
    ...AGING_BUCKETS.map<Column<DimensionAging>>((b) => ({
      key: b,
      header: <abbr title={AGING_BUCKET_LABEL[b]}>{SHORT_BUCKET[b]}</abbr>,
      align: 'right',
      sortValue: (r) => r.buckets[b],
      className: 'link-cell',
      render: (r) =>
        r.buckets[b] > 0 ? (
          <Link to={linkFor(r, b)} title={`Open invoices: ${r.label}, ${AGING_BUCKET_LABEL[b]}`}>
            {formatMoney(r.buckets[b], ccy, { compact: true })}
          </Link>
        ) : (
          <span className="muted">—</span>
        ),
    })),
  ];

  const dimChart = dimRows.map((r) => ({ name: r.label, ...r.buckets }));
  const dimTable = dimRows.map((r) => [r.label, ...AGING_BUCKETS.map((b) => formatMoney(r.buckets[b], ccy)), formatMoney(r.total, ccy)]);

  return (
    <div>
      <PageHeader
        title="Aging Analysis"
        subtitle={
          <>
            Open balance {formatMoney(totalOpen, ccy)} in {ccy} at {model.reference_date}. Click any bucket amount to drill into the invoices behind it.
            {unknownDue > 0 && (
              <>
                {' '}
                <span data-testid="aging-unknown-due">
                  {formatMoney(unknownDue, ccy)} has no due date (data quality) and is counted in the total but in no bucket — see <Link to={invoicesLink({ bucket: 'UNKNOWN' })}>invoices without due date</Link>.
                </span>
              </>
            )}
          </>
        }
      />

      <div className="grid-2 section">
        <section className="card" aria-labelledby="bucket-h">
          <h2 className="card-title" id="bucket-h">
            Aging buckets
          </h2>
          <DataTable columns={bucketColumns} rows={bucketRows} rowKey={(r) => r.bucket} compact caption="Outstanding by aging bucket" />
        </section>
        <section className="card" aria-labelledby="bucket-chart-h">
          <h2 className="card-title" id="bucket-chart-h">
            This week vs last week
          </h2>
          <ChartWithTable
            title="Outstanding per aging bucket, this week vs last week"
            columns={['Bucket', 'This week', 'Last week']}
            rows={bucketRows.map((b) => [AGING_BUCKET_LABEL[b.bucket], formatMoney(b.amount, ccy), b.previous === null ? '—' : formatMoney(b.previous, ccy)])}
            height={260}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bucketChart} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis tickFormatter={(v) => formatMoney(Number(v), ccy, { compact: true })} fontSize={11} width={70} />
                <Tooltip formatter={(v) => formatMoney(Number(v), ccy)} labelFormatter={(_, p) => (p && p[0] ? String((p[0].payload as { full: string }).full) : '')} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="This week" fill={CHART_ACCENT} />
                {model.previous_snapshot_date && <Bar dataKey="Last week" fill={CHART_MUTED} />}
              </BarChart>
            </ResponsiveContainer>
          </ChartWithTable>
        </section>
      </div>

      <section className="card section" aria-labelledby="dim-h">
        <h2 className="card-title" id="dim-h">
          Aging by dimension
        </h2>
        <div className="tabs" role="tablist" aria-label="Aging dimension">
          {DIMS.map((d) => (
            <button key={d.key} role="tab" type="button" className="tab" aria-selected={dim === d.key} id={`tab-${d.key}`} aria-controls={`panel-${d.key}`} onClick={() => setDim(d.key)}>
              {d.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${dim}`} aria-labelledby={`tab-${dim}`}>
          <DataTable columns={dimColumns} rows={dimRows} rowKey={(r) => r.key} defaultSort={{ key: 'overdue', dir: 'desc' }} compact caption={`Aging ${dimMeta.label}`} testId={`aging-table-${dim}`} />
          <div style={{ marginTop: 16 }}>
            <ChartWithTable
              title={`Aging composition ${dimMeta.label}`}
              columns={[dimMeta.label.replace('By ', ''), ...AGING_BUCKETS.map((b) => AGING_BUCKET_LABEL[b]), 'Total']}
              rows={dimTable}
              height={Math.max(160, 28 * dimRows.length + 60)}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dimChart} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => formatMoney(Number(v), ccy, { compact: true })} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={140} fontSize={11} interval={0} />
                  <Tooltip formatter={(v, name) => [formatMoney(Number(v), ccy), AGING_BUCKET_LABEL[name as AgingBucket] ?? String(name)]} />
                  <Legend formatter={(v) => AGING_BUCKET_LABEL[v as AgingBucket] ?? v} wrapperStyle={{ fontSize: 11 }} />
                  {AGING_BUCKETS.map((b) => (
                    <Bar key={b} dataKey={b} stackId="a" fill={BUCKET_COLORS[b]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartWithTable>
          </div>
        </div>
      </section>
    </div>
  );
}
