import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatPct } from '@core/money';
import { AGING_BUCKET_LABEL_I18N } from '@core/i18n';
import { AGING_BUCKETS, type AgingBucket, type DimensionAging } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { useI18n } from '@app/i18n/useI18n';
import type { StringKey } from '@app/i18n/strings';
import { PageHeader } from '@app/components/PageHeader';
import { DataTable, type Column } from '@app/components/DataTable';
import { Money } from '@app/components/Money';
import { ChartWithTable } from '@app/components/ChartWithTable';
import { chartProps, useChartColors } from '@app/components/chart-theme';
import { invoicesLink, type InvoiceFilterParams } from '@app/lib/links';
import { relChange } from '@app/lib/format';

type DimKey = 'country' | 'owner' | 'customer' | 'currency';
const DIMS: { key: DimKey; label: StringKey; header: StringKey; param: keyof InvoiceFilterParams; useKey: boolean }[] = [
  { key: 'country', label: 'aging.dim.country', header: 'col.country', param: 'country', useKey: false },
  { key: 'owner', label: 'aging.dim.owner', header: 'col.accountOwner', param: 'owner', useKey: false },
  { key: 'customer', label: 'aging.dim.customer', header: 'col.customer', param: 'customer', useKey: true },
  { key: 'currency', label: 'aging.dim.currency', header: 'col.invoiceCurrency', param: 'currency', useKey: true },
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

function fmtRate(r: number): string {
  return r === 1 ? '1' : Number(r.toPrecision(6)).toString();
}

export function AgingPage() {
  const { model } = useReadyTracker();
  const { lang, t } = useI18n();
  const colors = useChartColors();
  const cp = chartProps(colors);
  const ccy = model.reporting_currency;
  const bucketLabel = AGING_BUCKET_LABEL_I18N[lang];
  const shortBucket = (b: AgingBucket) => (b === 'CURRENT' ? t('bucket.short.CURRENT') : SHORT_BUCKET[b]);
  const [dim, setDim] = useState<DimKey>('country');

  const bucketRows = model.aging_by_bucket;
  const totalOpen = model.snapshot.totals.total_outstanding;
  const unknownDue = model.unknown_due_reporting;
  const thisWeek = t('col.thisWeek');
  const lastWeek = t('col.lastWeek');

  type BucketRow = (typeof bucketRows)[number];
  const bucketColumns: Column<BucketRow>[] = [
    { key: 'bucket', header: t('col.bucket'), render: (r) => <Link to={invoicesLink({ bucket: r.bucket })}>{bucketLabel[r.bucket]}</Link> },
    { key: 'amount', header: t('col.amount'), align: 'right', sortValue: (r) => r.amount, render: (r) => <Money amount={r.amount} currency={ccy} /> },
    { key: 'share', header: t('col.share'), align: 'right', sortValue: (r) => r.share, render: (r) => formatPct(r.share) },
    { key: 'prev', header: t('col.prevWeek'), align: 'right', sortValue: (r) => r.previous, render: (r) => <Money amount={r.previous} currency={ccy} /> },
    {
      key: 'change',
      header: t('col.change'),
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

  const bucketChart = bucketRows.map((b) => ({ name: shortBucket(b.bucket), full: bucketLabel[b.bucket], [thisWeek]: b.amount, [lastWeek]: b.previous ?? 0, bucket: b.bucket }));

  const dimMeta = DIMS.find((d) => d.key === dim)!;
  const dimLabel = t(dimMeta.label);
  const dimRows: DimensionAging[] = useMemo(() => {
    const src = dim === 'country' ? model.aging_by_country : dim === 'owner' ? model.aging_by_owner : dim === 'customer' ? model.aging_by_customer : model.aging_by_currency;
    return dim === 'customer' ? [...src].sort((a, b) => b.total - a.total).slice(0, 15) : src;
  }, [dim, model]);

  const linkFor = (row: DimensionAging, bucket?: AgingBucket) => invoicesLink({ [dimMeta.param]: dimMeta.useKey ? row.key : row.label, bucket: bucket ?? null });

  const dimColumns: Column<DimensionAging>[] = [
    {
      key: 'label',
      header: t(dimMeta.header),
      sortValue: (r) => r.label,
      render: (r) => (dim === 'customer' ? <Link to={`/customers/${encodeURIComponent(r.key)}`}>{r.label}</Link> : <Link to={linkFor(r)}>{r.label}</Link>),
    },
    { key: 'total', header: t('col.totalOutstanding'), align: 'right', sortValue: (r) => r.total, render: (r) => <Money amount={r.total} currency={ccy} /> },
    { key: 'overdue', header: t('col.overdue'), align: 'right', sortValue: (r) => r.overdue, render: (r) => <Money amount={r.overdue} currency={ccy} /> },
    { key: 'prev', header: t('col.prevOverdue'), align: 'right', sortValue: (r) => r.previous_overdue, render: (r) => <Money amount={r.previous_overdue} currency={ccy} /> },
    {
      key: 'change',
      header: t('col.change'),
      align: 'right',
      sortValue: (r) => (r.previous_overdue === null ? null : r.overdue - r.previous_overdue),
      render: (r) => (r.previous_overdue === null ? <span className="muted">—</span> : <Money amount={r.overdue - r.previous_overdue} currency={ccy} signed tone />),
    },
    ...AGING_BUCKETS.map<Column<DimensionAging>>((b) => ({
      key: b,
      header: <abbr title={bucketLabel[b]}>{shortBucket(b)}</abbr>,
      align: 'right',
      sortValue: (r) => r.buckets[b],
      className: 'link-cell',
      render: (r) =>
        r.buckets[b] > 0 ? (
          <Link to={linkFor(r, b)} title={t('aging.openInvoices', { label: r.label, bucket: bucketLabel[b] })}>
            {formatMoney(r.buckets[b], ccy, { compact: true })}
          </Link>
        ) : (
          <span className="muted">—</span>
        ),
    })),
  ];

  const dimChart = dimRows.map((r) => ({ name: r.label, ...r.buckets }));
  const dimTable = dimRows.map((r) => [r.label, ...AGING_BUCKETS.map((b) => formatMoney(r.buckets[b], ccy)), formatMoney(r.total, ccy)]);
  const fxRates = [...model.fx.rates].sort((a, b) => a.currency.localeCompare(b.currency));

  return (
    <div>
      <PageHeader
        title={t('aging.title')}
        subtitle={
          <>
            {t('aging.subtitle', { amount: formatMoney(totalOpen, ccy), ccy, date: model.reference_date })}
            {unknownDue > 0 && (
              <>
                {' '}
                <span data-testid="aging-unknown-due">
                  {t('aging.unknownDue', { amount: formatMoney(unknownDue, ccy) })} <Link to={invoicesLink({ bucket: 'UNKNOWN' })}>{t('aging.unknownDueLink')}</Link>.
                </span>
              </>
            )}
          </>
        }
      />

      <div className="grid-2 section">
        <section className="card" aria-labelledby="bucket-h">
          <h2 className="card-title" id="bucket-h">
            {t('aging.buckets')}
          </h2>
          <DataTable columns={bucketColumns} rows={bucketRows} rowKey={(r) => r.bucket} compact caption={t('aging.bucketsCaption')} />
        </section>
        <section className="card" aria-labelledby="bucket-chart-h">
          <h2 className="card-title" id="bucket-chart-h">
            {t('aging.thisVsLast')}
          </h2>
          <ChartWithTable
            title={t('aging.chartTitle')}
            columns={[t('col.bucket'), thisWeek, lastWeek]}
            rows={bucketRows.map((b) => [bucketLabel[b.bucket], formatMoney(b.amount, ccy), b.previous === null ? '—' : formatMoney(b.previous, ccy)])}
            height={260}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bucketChart} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} {...cp.grid} />
                <XAxis dataKey="name" fontSize={11} {...cp.axis} />
                <YAxis tickFormatter={(v) => formatMoney(Number(v), ccy, { compact: true })} fontSize={11} width={70} {...cp.axis} />
                <Tooltip formatter={(v) => formatMoney(Number(v), ccy)} labelFormatter={(_, p) => (p && p[0] ? String((p[0].payload as { full: string }).full) : '')} {...cp.tooltip} />
                <Legend {...cp.legend} />
                <Bar dataKey={thisWeek} fill={colors.accent} />
                {model.previous_snapshot_date && <Bar dataKey={lastWeek} fill={colors.muted} />}
              </BarChart>
            </ResponsiveContainer>
          </ChartWithTable>
        </section>
      </div>

      <section className="card section" aria-labelledby="dim-h">
        <h2 className="card-title" id="dim-h">
          {t('aging.byDimension')}
        </h2>
        <div className="tabs" role="tablist" aria-label={t('aging.dimAria')}>
          {DIMS.map((d) => (
            <button key={d.key} role="tab" type="button" className="tab" aria-selected={dim === d.key} id={`tab-${d.key}`} aria-controls={`panel-${d.key}`} onClick={() => setDim(d.key)} data-testid={`aging-tab-${d.key}`}>
              {t(d.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${dim}`} aria-labelledby={`tab-${dim}`}>
          {dim === 'currency' && <p className="chart-desc">{t('aging.currencyNote', { ccy })}</p>}
          <DataTable columns={dimColumns} rows={dimRows} rowKey={(r) => r.key} defaultSort={{ key: 'overdue', dir: 'desc' }} compact caption={t('aging.dimCaption', { dim: dimLabel })} testId={`aging-table-${dim}`} />
          {dim === 'currency' && (
            <div style={{ marginTop: 16 }} data-testid="aging-fx-table">
              <h3 className="card-title" style={{ fontSize: 13 }}>
                {t('aging.fxTitle')}
              </h3>
              <p className="chart-desc">{t('aging.fxDesc', { ccy, date: model.fx.as_of })}</p>
              {fxRates.length === 0 ? (
                <p className="muted small">{t('aging.fxNone')}</p>
              ) : (
                <div className="table-scroll" style={{ maxWidth: 560 }}>
                  <table className="data compact">
                    <caption className="sr-only">{t('aging.fxTitle')}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t('col.currency')}</th>
                        <th scope="col" className="num">
                          {t('col.rateToReporting', { ccy })}
                        </th>
                        <th scope="col">{t('col.rateDate')}</th>
                        <th scope="col">{t('col.source')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fxRates.map((r) => (
                        <tr key={r.currency}>
                          <td className="tnum">{r.currency}</td>
                          <td className="num">{fmtRate(r.rate_to_reporting)}</td>
                          <td className="tnum">{r.rate_date}</td>
                          <td className="small muted">{r.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <ChartWithTable
              title={t('aging.compositionTitle', { dim: dimLabel })}
              columns={[t(dimMeta.header), ...AGING_BUCKETS.map((b) => bucketLabel[b]), t('col.total')]}
              rows={dimTable}
              height={Math.max(160, 28 * dimRows.length + 60)}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dimChart} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} {...cp.grid} />
                  <XAxis type="number" tickFormatter={(v) => formatMoney(Number(v), ccy, { compact: true })} fontSize={11} {...cp.axis} />
                  <YAxis type="category" dataKey="name" width={140} fontSize={11} interval={0} {...cp.axis} />
                  <Tooltip formatter={(v, name) => [formatMoney(Number(v), ccy), bucketLabel[String(name)] ?? String(name)]} {...cp.tooltip} />
                  <Legend formatter={(v) => bucketLabel[String(v)] ?? v} {...cp.legend} />
                  {AGING_BUCKETS.map((b) => (
                    <Bar key={b} dataKey={b} stackId="a" fill={colors.buckets[b]} />
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
