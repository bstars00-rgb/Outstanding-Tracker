import { useState } from 'react';
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
  return (
    <article className={`card kpi status-${kpi.status}`} data-testid={`kpi-card-${kpi.key}`} title={definition} aria-labelledby={`kpi-label-${kpi.key}`}>
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
          onClick={() => setShowDef((s) => !s)}
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
