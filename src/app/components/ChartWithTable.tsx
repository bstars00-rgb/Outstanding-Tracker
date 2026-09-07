import type { ReactNode } from 'react';
import { useI18n } from '@app/i18n/useI18n';

export type TableCell = string | number | ReactNode;

interface ChartWithTableProps {
  title: string;
  description?: string;
  /** The recharts chart (already wrapped in a ResponsiveContainer). */
  children: ReactNode;
  /** Same data as the chart, in tabular form (accessibility alternative). */
  columns: string[];
  rows: TableCell[][];
  /** Which column indexes are numeric (right aligned). Defaults to every column except the first. */
  numericColumns?: number[];
  height?: number;
  testId?: string;
}

/** Every chart ships with a "Show as table" alternative rendering the same data. */
export function ChartWithTable({ title, description, children, columns, rows, numericColumns, height = 280, testId }: ChartWithTableProps) {
  const { t } = useI18n();
  const numeric = new Set(numericColumns ?? columns.map((_, i) => i).filter((i) => i > 0));
  return (
    <figure className="chart-box" style={{ margin: 0 }} data-testid={testId}>
      <figcaption className="sr-only">{title}</figcaption>
      {description && <p className="chart-desc">{description}</p>}
      <div style={{ width: '100%', height }} role="img" aria-label={t('common.chartAria', { title })}>
        {children}
      </div>
      <details>
        <summary>{t('common.showAsTable')}</summary>
        <div className="table-scroll" style={{ marginTop: 8 }}>
          <table className="data compact">
            <caption className="sr-only">{t('common.tableView', { title })}</caption>
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th key={i} scope="col" className={numeric.has(i) ? 'num' : undefined}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((cell, ci) => (
                    <td key={ci} className={numeric.has(ci) ? 'num' : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
