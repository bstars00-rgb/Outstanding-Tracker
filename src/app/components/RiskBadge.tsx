import type { RiskGrade, RiskScore } from '@core/types';

const GRADE_HELP: Record<RiskGrade, string> = {
  Low: 'Low risk (score < 30): paying on time, no warning signals.',
  Watch: 'Watch (score 30-49): early signals; keep in regular follow-up.',
  Medium: 'Medium (score 50-64): overdue balance or broken commitments; active collection required.',
  High: 'High (score 65-79): long overdue or repeated issues; escalation recommended.',
  Critical: 'Critical (score 80+): severe delinquency; leadership decision required.',
};

export function RiskBadge({ risk, grade, score, showScore = true }: { risk?: RiskScore; grade?: RiskGrade; score?: number; showScore?: boolean }) {
  const g = risk?.grade ?? grade ?? 'Low';
  const s = risk?.score ?? score;
  const top = risk?.factors
    .filter((f) => f.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((f) => `${f.label}: ${f.points}/${f.max_points}`)
    .join('; ');
  const title = `${GRADE_HELP[g]}${top ? ` Main drivers - ${top}.` : ''}`;
  return (
    <span className={`risk-badge risk-${g}`} title={title}>
      <span>{g}</span>
      {showScore && s !== undefined && (
        <span className="score" aria-label={`risk score ${s} out of 100`}>
          {s}/100
        </span>
      )}
    </span>
  );
}
