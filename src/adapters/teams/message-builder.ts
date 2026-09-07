import { formatInTimeZone } from '@core/dates';
import { pick, type Lang } from '@core/i18n';
import { formatMoney, formatPct } from '@core/money';
import type { TrackerModel } from '@core/types';
import type { InsightResult } from '@adapters/ai/types';
import type { AdaptiveCard, TeamsMessage } from './types';

export interface MessageContext {
  trackerBaseUrl: string; // e.g. https://org.github.io/outstanding-tracker/
  timeZone: string; // e.g. Asia/Ho_Chi_Minh
  sentAt: string; // ISO datetime
  channelLabel: 'test' | 'leaders';
  /** Wording language of headings/footer (numbers unaffected). Defaults to the model's language. */
  lang?: Lang;
}

const MAX_MARKDOWN_CHARS = 3500; // ~1 minute mobile read

export function buildTeamsMessage(m: TrackerModel, insight: InsightResult, ctx: MessageContext): TeamsMessage {
  const lang: Lang = ctx.lang ?? m.lang ?? 'en';
  const p = (en: string, ko: string) => pick(lang, en, ko);
  const ccy = m.reporting_currency;
  const M = (n: number) => formatMoney(n, ccy, { compact: true });
  const kpi = (k: string) => m.kpis.find((x) => x.key === k)!;
  const delta = (k: ReturnType<typeof kpi>) => (k.change === null ? 'n/a' : `${formatMoney(k.change, ccy, { signed: true, compact: true })} (${formatPct(k.change_pct, { signed: true })})`);
  const title = `${p('[Weekly Outstanding Report]', '[주간 미수금 보고]')} ${m.reference_date}${m.is_mock ? p(' (MOCK DATA)', ' (MOCK 데이터)') : ''}`;
  const links = {
    tracker: `${ctx.trackerBaseUrl}#/?lang=${lang}`,
    risk: `${ctx.trackerBaseUrl}#/customers?lang=${lang}`,
    actions: `${ctx.trackerBaseUrl}#/actions?lang=${lang}`,
    insight: `${ctx.trackerBaseUrl}#/insights?lang=${lang}`,
  };
  const out = insight.output;
  const total = kpi('total_outstanding');
  const overdue = kpi('overdue_outstanding');
  const collected = kpi('collected_this_week');
  const o30 = kpi('overdue_30_plus');
  const o90 = kpi('overdue_90_plus');
  const due7 = kpi('due_within_7_days');
  const completeness = Object.entries(m.completeness)
    .filter(([k]) => k !== 'notes')
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  const footer = p(
    `Data as of ${formatInTimeZone(m.as_of, ctx.timeZone)} · Sent ${formatInTimeZone(ctx.sentAt, ctx.timeZone)} · Reporting currency ${ccy} · Compared with ${m.previous_snapshot_date ?? 'n/a'} · Data ${completeness} · Insight: ${insight.provider}${insight.fallback_used ? ' (fallback)' : ''} · Automated report`,
    `데이터 기준시각 ${formatInTimeZone(m.as_of, ctx.timeZone)} · 발송 ${formatInTimeZone(ctx.sentAt, ctx.timeZone)} · 보고 통화 ${ccy} · 비교 기준일 ${m.previous_snapshot_date ?? '없음'} · 데이터 완전성 ${completeness} · 인사이트: ${insight.provider}${insight.fallback_used ? ' (대체)' : ''} · 자동 생성 보고서`,
  );

  const H = {
    reflection: p('ELLIS reflection pending', 'ELLIS 반영 대기'),
    entity: p('By managing entity', '법인별'),
    exec: p('1. Executive Summary', '1. 경영 요약'),
    ai: p('2. AI Insights', '2. AI 인사이트'),
    actions: p('3. Required Actions', '3. 필수 조치'),
    ceo: p('4. CEO Decision Required', '4. CEO 의사결정 필요'),
    links: p('5. Links', '5. 링크'),
    changes: p('Key changes', '핵심 변화'),
    risks: p('Top risks', '위험 고객사'),
    opps: p('Collection opportunities', '회수 가능성 높은 고객사'),
    dq: p('Data quality', '데이터 품질'),
    noChange: p('No material change vs last week', '전주 대비 유의미한 변화 없음'),
    noRisk: p('No high-risk customers this week', '이번 주 고위험 고객사 없음'),
    noData: p('Insufficient data', '데이터 부족'),
    noActions: p('No owner actions required', '담당자 조치 사항 없음'),
    noDecisions: p('None this week', '이번 주 해당 없음'),
    total: p('Total outstanding', '총 미수금'),
    overdue: p('Overdue', '연체 미수금'),
    collected: p('Collected this week', '이번 주 회수액'),
    o30: p('30+ days overdue', '30일 이상 연체'),
    o90: p('90+ days overdue', '90일 이상 연체'),
    due7: p('Due next 7 days', '다음 주 만기 예정'),
    forecast: p('Forecast next week', '다음 주 예상 회수액'),
    confidence: p('confidence', '신뢰도'),
    by: p('by', '기한'),
    openTracker: p('Open Tracker', '트래커 열기'),
    customerRisk: p('Customer Risk', '고객사 Risk'),
    actionBoard: p('Action Board', '액션 보드'),
    mockNote: p('⚠️ Prototype run on fictional mock data', '⚠️ 가상 Mock 데이터로 생성된 프로토타입 보고서'),
    channel: p('Channel', '채널'),
    risk: p('Risk', '위험'),
    opp: p('Opportunity', '기회'),
    fullDetail: p('full detail', '전체 내용'),
  };

  // Managing-entity split (Seoul / Singapore ...) and ELLIS reflection-chain status for the CEO.
  const entityFacts = m.aging_by_control_company.map((d) => ({ title: `${H.entity}: ${d.label}`, value: `${M(d.total)} · ${p('overdue', '연체')} ${M(d.overdue)}` }));
  const t = m.snapshot.totals;
  const reflectionValue = p(
    `${t.unverified_payment_count} unverified (${M(t.unverified_payment_amount)}) · ${t.unreconciled_payment_count} unreconciled (${M(t.unreconciled_payment_amount)})`,
    `미검증 ${t.unverified_payment_count}건(${M(t.unverified_payment_amount)}) · 미대사 ${t.unreconciled_payment_count}건(${M(t.unreconciled_payment_amount)})`,
  );

  // ---------- Adaptive Card ----------
  const factSet = (facts: { title: string; value: string }[]) => ({ type: 'FactSet', facts });
  const text = (t: string, opts: Record<string, unknown> = {}) => ({ type: 'TextBlock', text: t, wrap: true, ...opts });
  const bullets = (items: string[]) => items.map((s) => text(`• ${s}`, { spacing: 'Small' }));
  const risks = out.top_risks.slice(0, 5).map((r) => `**${r.customer}** (${r.owner}) — ${formatMoney(r.amount, ccy)}: ${r.reason}`);
  const opps = out.collection_opportunities.slice(0, 3).map((r) => `**${r.customer}** — ${formatMoney(r.amount, ccy)}: ${r.why}`);
  const actions = out.owner_actions.slice(0, 6).map((a) => `**${a.owner}** → ${a.customer} · ${formatMoney(a.amount, ccy)} · ${a.action} · ${H.by} ${a.deadline}`);
  const decisions = out.ceo_decisions.slice(0, 4).map((d) => `**${d.topic}**${d.customer ? ` — ${d.customer}` : ''}${d.amount !== null ? ` (${formatMoney(d.amount, ccy)})` : ''}: ${d.recommendation}. _${d.rationale}_`);
  const changes = out.major_changes.slice(0, 3);
  const warnings = out.data_quality_warnings.slice(0, 3);
  const confidenceLabel = lang === 'ko' ? ({ low: '낮음', medium: '중간', high: '높음' } as Record<string, string>)[out.forecast_next_week.confidence] ?? out.forecast_next_week.confidence : out.forecast_next_week.confidence;
  const forecastLine = `${H.forecast}: ${formatMoney(out.forecast_next_week.expected_collection, ccy)} (${H.confidence} ${confidenceLabel})`;

  const card: AdaptiveCard = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    msteams: { width: 'Full' },
    body: [
      text(title, { size: 'Large', weight: 'Bolder' }),
      text(m.is_mock ? H.mockNote : `${H.channel}: ${ctx.channelLabel}`, { isSubtle: true, spacing: 'None' }),
      text(H.exec, { weight: 'Bolder', size: 'Medium', spacing: 'Medium' }),
      factSet([
        { title: H.total, value: `${M(total.value)} (${delta(total)})` },
        { title: H.overdue, value: `${M(overdue.value)} (${delta(overdue)})` },
        { title: H.collected, value: M(collected.value) },
        { title: H.o30, value: `${M(o30.value)} (${delta(o30)})` },
        { title: H.o90, value: `${M(o90.value)} (${delta(o90)})` },
        { title: H.due7, value: M(due7.value) },
        ...entityFacts,
        { title: H.reflection, value: reflectionValue },
      ]),
      ...bullets(out.executive_summary.slice(0, 3)),
      text(H.ai, { weight: 'Bolder', size: 'Medium', spacing: 'Medium' }),
      text(H.changes, { weight: 'Bolder', spacing: 'Small' }),
      ...bullets(changes.length ? changes : [H.noChange]),
      text(H.risks, { weight: 'Bolder', spacing: 'Small' }),
      ...bullets(risks.length ? risks : [H.noRisk]),
      text(H.opps, { weight: 'Bolder', spacing: 'Small' }),
      ...bullets(opps.length ? opps : [H.noData]),
      text(`${forecastLine} — ${out.forecast_next_week.basis.slice(0, 2).join('; ')}`, { spacing: 'Small' }),
      text(H.actions, { weight: 'Bolder', size: 'Medium', spacing: 'Medium' }),
      ...bullets(actions.length ? actions : [H.noActions]),
      text(H.ceo, { weight: 'Bolder', size: 'Medium', spacing: 'Medium' }),
      ...bullets(decisions.length ? decisions : [H.noDecisions]),
      ...(warnings.length ? [text(H.dq, { weight: 'Bolder', spacing: 'Medium' }), ...bullets(warnings)] : []),
      text(footer, { isSubtle: true, size: 'Small', spacing: 'Medium' }),
    ],
    actions: [
      { type: 'Action.OpenUrl', title: H.openTracker, url: links.tracker },
      { type: 'Action.OpenUrl', title: H.customerRisk, url: links.risk },
      { type: 'Action.OpenUrl', title: H.actionBoard, url: links.actions },
    ],
  };

  // ---------- Markdown fallback ----------
  // Sections carry a priority; when the budget is exceeded, bullets are dropped from the lowest-priority
  // section first (never the KPI lines, links or footer), so the message always ends cleanly.
  type Section = { heading: string; bullets: string[]; priority: number; min: number };
  const sections: Section[] = [
    {
      heading: `**${H.exec}**`,
      priority: 10,
      min: 4 + entityFacts.length + 1,
      bullets: [
        `${H.total}: ${M(total.value)} (${delta(total)})`,
        `${H.overdue}: ${M(overdue.value)} (${delta(overdue)})`,
        `${H.collected}: ${M(collected.value)}`,
        `${H.o30}: ${M(o30.value)} · ${H.o90}: ${M(o90.value)} · ${H.due7}: ${M(due7.value)}`,
        ...entityFacts.map((f) => `${f.title}: ${f.value}`),
        `${H.reflection}: ${reflectionValue}`,
        ...out.executive_summary.slice(1, 3), // first sentence repeats the KPI lines
      ],
    },
    {
      heading: `**${H.ai}**`,
      priority: 4,
      min: 2,
      bullets: [...(changes.length ? changes.slice(0, 2) : [H.noChange]), ...(risks.length ? risks.slice(0, 3) : [H.noRisk]).map((s) => `${H.risk}: ${s}`), ...opps.slice(0, 2).map((s) => `${H.opp}: ${s}`), forecastLine],
    },
    { heading: `**${H.actions}**`, priority: 6, min: 2, bullets: actions.length ? actions.slice(0, 5) : [H.noActions] },
    { heading: `**${H.ceo}**`, priority: 8, min: 1, bullets: decisions.length ? decisions.slice(0, 3) : [H.noDecisions] },
  ];
  const linksLine = `**${H.links}** [${H.openTracker}](${links.tracker}) · [${H.customerRisk}](${links.risk}) · [${H.actionBoard}](${links.actions})`;
  const render = () => [`**${title}**`, '', ...sections.flatMap((s) => [s.heading, ...s.bullets.map((b) => `- ${b}`), '']), linksLine, '', `_${footer}_`].join('\n');
  let markdown = render();
  while (markdown.length > MAX_MARKDOWN_CHARS) {
    const candidates = sections.filter((s) => s.bullets.length > s.min).sort((a, b) => a.priority - b.priority);
    if (!candidates.length) break;
    candidates[0].bullets.pop();
    markdown = render();
  }
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    const suffix = `\n… ${H.fullDetail}: ${links.tracker}`;
    markdown = markdown.slice(0, MAX_MARKDOWN_CHARS - suffix.length) + suffix;
  }

  return {
    idempotency_key: `weekly-outstanding:${m.reference_date}:${ctx.channelLabel}`,
    title,
    card,
    markdown,
    markdown_length: markdown.length,
  };
}

/** Failure message used when data refresh or validation fails: never sends stale figures as if current. */
export function buildFailureMessage(reportDate: string, reason: string, ctx: MessageContext): TeamsMessage {
  const lang: Lang = ctx.lang ?? 'en';
  const p = (en: string, ko: string) => pick(lang, en, ko);
  const title = `${p('[Weekly Outstanding Report]', '[주간 미수금 보고]')} ${reportDate} — ${p('Data refresh failed', '데이터 갱신 실패 (Data refresh failed)')}`;
  const body = p(
    `The weekly receivables report could not be produced.\n\nReason: ${reason}\n\nNo figures are shown because stale data must not be presented as current. The tracker shows the last successful snapshot. Ops has been alerted.`,
    `이번 주 미수금 보고서를 생성할 수 없었습니다.\n\n원인: ${reason}\n\n오래된 데이터를 최신 데이터처럼 보여줄 수 없어 수치를 표시하지 않습니다. 트래커에는 마지막으로 성공한 스냅샷이 표시됩니다. 운영팀에 알림을 보냈습니다.`,
  );
  const card: AdaptiveCard = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: `⚠️ ${title}`, size: 'Large', weight: 'Bolder', wrap: true, color: 'Attention' },
      { type: 'TextBlock', text: body, wrap: true },
      { type: 'TextBlock', text: `${p('Attempted', '시도 시각')} ${formatInTimeZone(ctx.sentAt, ctx.timeZone)} · ${p('Automated message', '자동 생성 메시지')}`, isSubtle: true, size: 'Small', wrap: true },
    ],
    actions: [{ type: 'Action.OpenUrl', title: p('Open Tracker', '트래커 열기'), url: `${ctx.trackerBaseUrl}#/` }],
  };
  const markdown = `**${title}**\n\n${body}`;
  return { idempotency_key: `weekly-outstanding:${reportDate}:${ctx.channelLabel}:failure`, title, card, markdown, markdown_length: markdown.length };
}
