import { RISK_GRADE_LABEL_I18N } from '@core/i18n';
import type { RiskGrade, RiskScore } from '@core/types';
import { useI18n } from '@app/i18n/useI18n';

/**
 * Risk grade badge. The visible label is localised; the `title` always starts with the English
 * grade word (Low/Watch/Medium/High/Critical) followed by the explanation and the main drivers.
 */
export function RiskBadge({ risk, grade, score, showScore = true }: { risk?: RiskScore; grade?: RiskGrade; score?: number; showScore?: boolean }) {
  const { lang, t } = useI18n();
  const g = risk?.grade ?? grade ?? 'Low';
  const s = risk?.score ?? score;
  const top = risk?.factors
    .filter((f) => f.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((f) => `${f.label}: ${f.points}/${f.max_points}`)
    .join('; ');
  const title = `${g} — ${t(`grade.help.${g}`)}${top ? ` ${t('grade.drivers')}: ${top}.` : ''}`;
  return (
    <span className={`risk-badge risk-${g}`} title={title} data-grade={g}>
      <span>{RISK_GRADE_LABEL_I18N[lang][g] ?? g}</span>
      {showScore && s !== undefined && (
        <span className="score" aria-label={t('grade.scoreAria', { score: s })}>
          {s}/100
        </span>
      )}
    </span>
  );
}
