/**
 * Language support for engine-generated text (KPI labels/interpretations, risk evidence,
 * recommended actions, action board, rule-based insight, Teams message).
 * Numbers are never translated; only the surrounding wording changes.
 */
export type Lang = 'en' | 'ko';

export const DEFAULT_LANG: Lang = 'en';

export function normalizeLang(v: string | null | undefined): Lang {
  return (v ?? '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

/** Tiny template helper: fill("{a} of {b}", {a: 1, b: 2}) */
export function fill(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === null || vars[k] === undefined ? '' : String(vars[k])));
}

/** Pick a bilingual string. */
export function pick<T>(lang: Lang, en: T, ko: T): T {
  return lang === 'ko' ? ko : en;
}

export const AGING_BUCKET_LABEL_I18N: Record<Lang, Record<string, string>> = {
  en: { CURRENT: 'Current (not yet due)', D1_7: '1-7 days', D8_14: '8-14 days', D15_30: '15-30 days', D31_60: '31-60 days', D61_90: '61-90 days', D90_PLUS: '90+ days', UNKNOWN: 'Unknown due date' },
  ko: { CURRENT: '미도래', D1_7: '1–7일', D8_14: '8–14일', D15_30: '15–30일', D31_60: '31–60일', D61_90: '61–90일', D90_PLUS: '90일 초과', UNKNOWN: '만기일 미확인' },
};

export const ACTION_GROUP_LABEL_I18N: Record<Lang, Record<string, string>> = {
  en: { CONTACT_TODAY: 'Contact today', DUE_3_DAYS: 'Due within 3 days', DUE_7_DAYS: 'Due within 7 days', PROMISE_OVERDUE: 'Promise date passed', OVERDUE_30: '30+ days overdue', OVERDUE_90: '90+ days overdue', DISPUTE: 'Dispute to resolve', CREDIT_LIMIT: 'Credit limit exceeded', ESCALATE: 'Leader escalation', ELLIS_REFLECTION: 'ELLIS reflection check' },
  ko: { CONTACT_TODAY: '오늘 연락 필요', DUE_3_DAYS: '3일 이내 만기', DUE_7_DAYS: '7일 이내 만기', PROMISE_OVERDUE: '약속일 경과', OVERDUE_30: '30일 이상 연체', OVERDUE_90: '90일 이상 연체', DISPUTE: '분쟁 해결 필요', CREDIT_LIMIT: '신용한도 초과', ESCALATE: '리더 에스컬레이션 필요', ELLIS_REFLECTION: 'ELLIS 반영 확인 필요' },
};

export const RISK_GRADE_LABEL_I18N: Record<Lang, Record<string, string>> = {
  en: { Low: 'Low', Watch: 'Watch', Medium: 'Medium', High: 'High', Critical: 'Critical' },
  ko: { Low: '낮음', Watch: '관찰', Medium: '중간', High: '높음', Critical: '심각' },
};

export const KPI_STATUS_LABEL_I18N: Record<Lang, Record<string, string>> = {
  en: { good: 'Good', neutral: 'Neutral', warning: 'Warning', critical: 'Critical' },
  ko: { good: '양호', neutral: '보통', warning: '주의', critical: '위험' },
};
