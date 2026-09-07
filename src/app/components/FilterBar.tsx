import type { ReactNode } from 'react';
import { useI18n } from '@app/i18n/useI18n';

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
  allLabel,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: (SelectOption | string)[];
  /** Label of the "no filter" option; `null` removes it. Defaults to the localised "All". */
  allLabel?: string | null;
  testId?: string;
}) {
  const { t } = useI18n();
  const all = allLabel === undefined ? t('common.all') : allLabel;
  return (
    <div className="filter-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        {all !== null && <option value="">{all}</option>}
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
  const { t } = useI18n();
  return (
    <div className="filter-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="search" className="input" value={value} placeholder={placeholder ?? t('common.search')} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </div>
  );
}

export function FilterBar({ children, onReset, summary }: { children: ReactNode; onReset?: () => void; summary?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="filter-bar" role="group" aria-label={t('common.filters')}>
        {children}
        {onReset && (
          <div className="filter-field">
            <label aria-hidden="true">&nbsp;</label>
            <button type="button" className="btn" onClick={onReset}>
              {t('common.resetFilters')}
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
