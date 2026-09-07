import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@app/i18n/useI18n';

export type SortDir = 'asc' | 'desc';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Value used for sorting; column is not sortable when omitted. */
  sortValue?: (row: T) => number | string | null | undefined;
  align?: 'left' | 'right' | 'center';
  /** Header tooltip / definition. */
  title?: string;
  className?: string;
  width?: string | number;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Controlled sort. When omitted the table manages its own sort state (starting at defaultSort). */
  sortKey?: string | null;
  sortDir?: SortDir;
  onSortChange?: (key: string, dir: SortDir) => void;
  defaultSort?: { key: string; dir: SortDir };
  onRowClick?: (row: T) => void;
  rowHref?: (row: T) => string | undefined;
  emptyMessage?: string;
  testId?: string;
  caption?: string;
  compact?: boolean;
  /** Accordion content for a row (adds an expander column). */
  renderExpanded?: (row: T) => ReactNode;
  maxRows?: number;
}

function compare(a: number | string | null | undefined, b: number | string | null | undefined): number {
  const an = a === null || a === undefined || a === '';
  const bn = b === null || b === undefined || b === '';
  if (an && bn) return 0;
  if (an) return 1; // empties last
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function sortRows<T>(rows: T[], columns: Column<T>[], key: string | null | undefined, dir: SortDir): T[] {
  if (!key) return rows;
  const col = columns.find((c) => c.key === key);
  if (!col?.sortValue) return rows;
  const sv = col.sortValue;
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const r = compare(sv(a), sv(b));
    // keep empties last regardless of direction
    const av = sv(a);
    const bv = sv(b);
    const an = av === null || av === undefined || av === '';
    const bn = bv === null || bv === undefined || bv === '';
    if (an !== bn) return an ? 1 : -1;
    return r * mult;
  });
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sortKey,
  sortDir,
  onSortChange,
  defaultSort,
  onRowClick,
  rowHref,
  emptyMessage,
  testId,
  caption,
  compact,
  renderExpanded,
  maxRows,
}: DataTableProps<T>) {
  const { t } = useI18n();
  const [internalSort, setInternalSort] = useState<{ key: string | null; dir: SortDir }>({ key: defaultSort?.key ?? null, dir: defaultSort?.dir ?? 'desc' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const controlled = sortKey !== undefined;
  const key = controlled ? sortKey : internalSort.key;
  const dir: SortDir = controlled ? (sortDir ?? 'desc') : internalSort.dir;

  const sorted = useMemo(() => sortRows(rows, columns, key, dir), [rows, columns, key, dir]);
  const shown = maxRows ? sorted.slice(0, maxRows) : sorted;

  function toggleSort(colKey: string) {
    const nextDir: SortDir = key === colKey ? (dir === 'desc' ? 'asc' : 'desc') : 'desc';
    if (onSortChange) onSortChange(colKey, nextDir);
    if (!controlled) setInternalSort({ key: colKey, dir: nextDir });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const colCount = columns.length + (renderExpanded ? 1 : 0);

  return (
    <div className="table-scroll">
      <table className={`data ${compact ? 'compact' : ''}`} data-testid={testId}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {renderExpanded && (
              <th style={{ width: 36 }}>
                <span className="sr-only">{t('common.expand')}</span>
              </th>
            )}
            {columns.map((c) => {
              const sortable = !!c.sortValue;
              const isSorted = key === c.key;
              const ariaSort = isSorted ? (dir === 'asc' ? 'ascending' : 'descending') : undefined;
              return (
                <th
                  key={c.key}
                  className={`${c.align === 'right' ? 'num' : ''} ${isSorted ? 'sorted' : ''} ${c.className ?? ''}`}
                  style={c.width ? { width: c.width, minWidth: c.width } : undefined}
                  title={c.title}
                  aria-sort={ariaSort}
                  scope="col"
                >
                  {sortable ? (
                    <button type="button" className="sort" onClick={() => toggleSort(c.key)} aria-label={typeof c.header === 'string' ? t('common.sortBy', { col: c.header }) : undefined}>
                      {c.header}
                      <span aria-hidden="true">{isSorted ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td className="empty" colSpan={colCount}>
                {emptyMessage ?? t('common.noRows')}
              </td>
            </tr>
          )}
          {shown.map((row) => {
            const id = rowKey(row);
            const isOpen = expanded.has(id);
            const clickable = !!onRowClick;
            const href = rowHref?.(row);
            return (
              <Fragment key={id}>
                <tr
                  className={clickable ? 'clickable' : undefined}
                  onClick={clickable ? () => onRowClick!(row) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick!(row);
                        }
                      : undefined
                  }
                  tabIndex={clickable && !href ? 0 : undefined}
                  data-row-id={id}
                >
                  {renderExpanded && (
                    <td>
                      <button
                        type="button"
                        className="expand-btn"
                        aria-expanded={isOpen}
                        aria-label={isOpen ? t('common.collapseRow') : t('common.expandRow')}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(id);
                        }}
                      >
                        {isOpen ? '−' : '+'}
                      </button>
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={`${c.align === 'right' ? 'num' : c.align === 'center' ? 'center' : ''} ${c.className ?? ''}`}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
                {renderExpanded && isOpen && (
                  <tr className="expanded-row">
                    <td colSpan={colCount}>{renderExpanded(row)}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
