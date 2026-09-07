import type { ReactNode } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectFilter({
  id,
  label,
  value,
  onChange,
  options,
  allLabel = 'All',
  testId,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: (SelectOption | string)[];
  allLabel?: string | null;
  testId?: string;
}) {
  return (
    <div className="filter-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        {allLabel !== null && <option value="">{allLabel}</option>}
        {options.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          );
        })}
      </select>
    </div>
  );
}

export function TextFilter({ id, label, value, onChange, placeholder, testId }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; testId?: string }) {
  return (
    <div className="filter-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="search" className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </div>
  );
}

export function FilterBar({ children, onReset, summary }: { children: ReactNode; onReset?: () => void; summary?: ReactNode }) {
  return (
    <div>
      <div className="filter-bar" role="group" aria-label="Filters">
        {children}
        {onReset && (
          <div className="filter-field">
            <label aria-hidden="true">&nbsp;</label>
            <button type="button" className="btn" onClick={onReset}>
              Reset filters
            </button>
          </div>
        )}
      </div>
      {summary && <p className="filter-summary">{summary}</p>}
    </div>
  );
}

/** Distinct sorted values of a field, ignoring empties. */
export function distinct<T>(rows: T[], pick: (r: T) => string | null | undefined): string[] {
  return [...new Set(rows.map(pick).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
}
