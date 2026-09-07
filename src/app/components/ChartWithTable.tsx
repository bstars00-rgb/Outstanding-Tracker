import type { ReactNode } from 'react';

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
  const numeric = new Set(numericColumns ?? columns.map((_, i) => i).filter((i) => i > 0));
  return (
    <figure className="chart-box" style={{ margin: 0 }} data-testid={testId}>
      <figcaption className="sr-only">{title}</figcaption>
      {description && <p className="chart-desc">{description}</p>}
      <div style={{ width: '100%', height }} role="img" aria-label={`${title}. Use "Show as table" for the values.`}>
        {children}
      </div>
      <details>
        <summary>Show as table</summary>
        <div className="table-scroll" style={{ marginTop: 8 }}>
          <table className="data compact">
            <caption className="sr-only">{title} (table view)</caption>
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

/** Aging bucket colours: cool for not-due, progressively warmer for older debt. */
export const BUCKET_COLORS: Record<string, string> = {
  CURRENT: '#93c5fd',
  D1_7: '#60a5fa',
  D8_14: '#fcd34d',
  D15_30: '#f59e0b',
  D31_60: '#f97316',
  D61_90: '#ef4444',
  D90_PLUS: '#991b1b',
  UNKNOWN: '#9ca3af',
};

export const CHART_ACCENT = '#1d4ed8';
export const CHART_MUTED = '#94a3b8';
