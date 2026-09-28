import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { kpiDrilldownPath } from '@app/lib/kpi-drilldown';
import { KPI_STATUS_LABEL_I18N } from '@core/i18n';
import { KPI_TEXT_I18N } from '@core/kpis';
import type { KpiValue } from '@core/types';
import { kpiChangeText, kpiValueText } from '@app/lib/format';
import { useI18n } from '@app/i18n/useI18n';
import { StatusPill } from './StatusPill';
import { IconDown, IconMinus, IconUp } from './Icons';

/**
 * KPI card: value, WoW change, status (colour + icon + text label so it never relies on colour alone),
 * short interpretation and the metric definition (title tooltip + toggle button).
 */
export function KpiCard({ kpi, currency }: { kpi: KpiValue; currency: string }) {
  const { lang, t } = useI18n();
  const [showDef, setShowDef] = useState(false);
  // Label and definition follow the UI language; the interpretation sentence stays in the published model's language.
  const label = KPI_TEXT_I18N[lang]?.label[kpi.key] ?? kpi.label;
  const definition = KPI_TEXT_I18N[lang]?.definition[kpi.key] ?? kpi.definition;
  const value = kpiValueText(kpi, currency);
  const change = kpiChangeText(kpi, currency);
  const ChangeIcon = kpi.change === null || kpi.change === 0 ? IconMinus : kpi.change > 0 ? IconUp : IconDown;
  const defId = `kpi-def-${kpi.key}`;
  const navigate = useNavigate();
  const href = kpiDrilldownPath(kpi.key);
  const open = () => navigate(href);
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };
  const toggleDef = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setShowDef((s) => !s);
  };
  return (
    <article
      className={`card kpi clickable status-${kpi.status}`}
      data-testid={`kpi-card-${kpi.key}`}
      title={`${definition} — ${t('kpi.open')}`}
      aria-labelledby={`kpi-label-${kpi.key}`}
      role="link"
      tabIndex={0}
      data-href={href}
      onClick={open}
      onKeyDown={onKey}
    >
      <div className="kpi-head">
        <span className="kpi-label" id={`kpi-label-${kpi.key}`}>
          {label}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('kpi.definitionOf', { label })}
          aria-expanded={showDef}
          aria-controls={defId}
          title={definition}
          onClick={toggleDef}
        >
          <span aria-hidden="true">i</span>
        </button>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-change">
        {change === null ? (
          <span>{t('kpi.noPrior')}</span>
        ) : (
          <span>
            <ChangeIcon width={12} height={12} style={{ verticalAlign: '-1px' }} /> {t('kpi.wow')} {change}
          </span>
        )}
      </div>
      <div>
        <StatusPill tone={kpi.status} title={kpi.status}>
          {KPI_STATUS_LABEL_I18N[lang][kpi.status] ?? kpi.status}
        </StatusPill>
      </div>
      <p className="kpi-interp">{kpi.interpretation}</p>
      <p className="kpi-def" id={defId} hidden={!showDef}>
        <strong>{t('kpi.definition')}</strong> {definition}
      </p>
    </article>
  );
}
