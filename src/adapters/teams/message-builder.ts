import { formatInTimeZone } from '@core/dates';
import { formatMoney, formatPct } from '@core/money';
import type { TrackerModel } from '@core/types';
import type { InsightResult } from '@adapters/ai/types';
import type { AdaptiveCard, TeamsMessage } from './types';

export interface MessageContext {
  trackerBaseUrl: string; // e.g. https://org.github.io/outstanding-tracker/
  timeZone: string; // e.g. Asia/Ho_Chi_Minh
  sentAt: string; // ISO datetime
  channelLabel: 'test' | 'leaders';
}

const MAX_MARKDOWN_CHARS = 3500; // ~1 minute mobile read

export function buildTeamsMessage(m: TrackerModel, insight: InsightResult, ctx: MessageContext): TeamsMessage {
  const ccy = m.reporting_currency;
  const M = (n: number) => formatMoney(n, ccy, { compact: true });
  const kpi = (k: string) => m.kpis.find((x) => x.key === k)!;
  const delta = (k: ReturnType<typeof kpi>) => (k.change === null ? 'n/a' : `${formatMoney(k.change, ccy, { signed: true, compact: true })} (${formatPct(k.change_pct, { signed: true })})`);
  const title = `[Weekly Outstanding Report] ${m.reference_date}${m.is_mock ? ' (MOCK DATA)' : ''}`;
  const links = {
    tracker: `${ctx.trackerBaseUrl}#/`,
    risk: `${ctx.trackerBaseUrl}#/customers`,
    actions: `${ctx.trackerBaseUrl}#/actions`,
    insight: `${ctx.trackerBaseUrl}#/insights`,
  };
  const out = insight.output;
  const total = kpi('total_outstanding');
  const overdue = kpi('overdue_outstanding');
  const collected = kpi('collected_this_week');
  const o30 = kpi('overdue_30_plus');
  const o90 = kpi('overdue_90_plus');
  const due7 = kpi('due_within_7_days');
  const completeness = Object.entries(m.completeness).filter(([k]) => k !== 'notes').map(([k, v]) => `${k}:${v}`).join(' ');
  const footer = `Data as of ${formatInTimeZone(m.as_of, ctx.timeZone)} · Sent ${formatInTimeZone(ctx.sentAt, ctx.timeZone)} · Reporting currency ${ccy} · Compared with ${m.previous_snapshot_date ?? 'n/a'} · Data ${completeness} · Insight: ${insight.provider}${insight.fallback_used ? ' (fallback)' : ''} · Automated report`;

  // ---------- Adaptive Card ----------
  const factSet = (facts: { title: string; value: string }[]) => ({ type: 'FactSet', facts });
  const text = (t: string, opts: Record<string, unknown> = {}) => ({ type: 'TextBlock', text: t, wrap: true, ...opts });
  const bullets = (items: string[]) => items.map((s) => text(`• ${s}`, { spacing: 'Small' }));
  const risks = out.top_risks.slice(0, 5).map((r) => `**${r.customer}** (${r.owner}) — ${formatMoney(r.amount, ccy)}: ${r.reason}`);
  const opps = out.collection_opportunities.slice(0, 3).map((r) => `**${r.customer}** — ${formatMoney(r.amount, ccy)}: ${r.why}`);
  const actions = out.owner_actions.slice(0, 6).map((a) => `**${a.owner}** → ${a.customer} · ${formatMoney(a.amount, ccy)} · ${a.action} · by ${a.deadline}`);
  const decisions = out.ceo_decisions.slice(0, 4).map((d) => `**${d.topic}**${d.customer ? ` — ${d.customer}` : ''}${d.amount !== null ? ` (${formatMoney(d.amount, ccy)})` : ''}: ${d.recommendation}. _${d.rationale}_`);
  const changes = out.major_changes.slice(0, 3);
  const warnings = out.data_quality_warnings.slice(0, 3);

  const card: AdaptiveCard = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    msteams: { width: 'Full' },
    body: [
      text(title, { size: 'Large', weight: 'Bolder' }),
      text(m.is_mock ? '⚠️ Prototype run on fictional mock data' : `Channel: ${ctx.channelLabel}`, { isSubtle: true, spacing: 'None' }),
      text('1. Executive Summary', { weight: 'Bolder', size: 'Medium', spacing: 'Medium' }),
      factSet([
        { title: 'Total outstanding', value: `${M(total.value)} (${delta(total)})` },
        { title: 'Overdue', value: `${M(overdue.value)} (${delta(overdue)})` },
        { title: 'Collected this week', value: M(collected.value) },
        { title: '30+ days overdue', value: `${M(o30.value)} (${delta(o30)})` },
        { title: '90+ days overdue', value: `${M(o90.value)} (${delta(o90)})` },
        { title: 'Due next 7 days', value: M(due7.value) },
      ]),
      ...bullets(out.executive_summary.slice(0, 3)),
      text('2. AI Insights', { weight: 'Bolder', size: 'Medium', spacing: 'Medium' }),
      text('Key changes', { weight: 'Bolder', spacing: 'Small' }),
      ...bullets(changes.length ? changes : ['No material change vs last week']),
      text('Top risks', { weight: 'Bolder', spacing: 'Small' }),
      ...bullets(risks.length ? risks : ['No high-risk customers this week']),
      text('Collection opportunities', { weight: 'Bolder', spacing: 'Small' }),
      ...bullets(opps.length ? opps : ['Insufficient data']),
      text(`Forecast next week: ${formatMoney(out.forecast_next_week.expected_collection, ccy)} (confidence ${out.forecast_next_week.confidence}) — ${out.forecast_next_week.basis.slice(0, 2).join('; ')}`, { spacing: 'Small' }),
      text('3. Required Actions', { weight: 'Bolder', size: 'Medium', spacing: 'Medium' }),
      ...bullets(actions.length ? actions : ['No owner actions required']),
      text('4. CEO Decision Required', { weight: 'Bolder', size: 'Medium', spacing: 'Medium' }),
      ...bullets(decisions.length ? decisions : ['None this week']),
      ...(warnings.length ? [text('Data quality', { weight: 'Bolder', spacing: 'Medium' }), ...bullets(warnings)] : []),
      text(footer, { isSubtle: true, size: 'Small', spacing: 'Medium' }),
    ],
    actions: [
      { type: 'Action.OpenUrl', title: 'Open Tracker', url: links.tracker },
      { type: 'Action.OpenUrl', title: 'Customer Risk', url: links.risk },
      { type: 'Action.OpenUrl', title: 'Action Board', url: links.actions },
    ],
  };

  // ---------- Markdown fallback ----------
  // Sections carry a priority; when the budget is exceeded, bullets are dropped from the lowest-priority
  // section first (never the KPI lines, links or footer), so the message always ends cleanly.
  type Section = { heading: string; bullets: string[]; priority: number; min: number };
  const sections: Section[] = [
    {
      heading: '**1. Executive Summary**',
      priority: 10,
      min: 4,
      bullets: [
        `Total outstanding: ${M(total.value)} (${delta(total)})`,
        `Overdue: ${M(overdue.value)} (${delta(overdue)})`,
        `Collected this week: ${M(collected.value)}`,
        `30+ days: ${M(o30.value)} · 90+ days: ${M(o90.value)} · Due next 7 days: ${M(due7.value)}`,
        ...out.executive_summary.slice(1, 3), // first sentence repeats the KPI lines
      ],
    },
    {
      heading: '**2. AI Insights**',
      priority: 4,
      min: 2,
      bullets: [
        ...(changes.length ? changes.slice(0, 2) : ['No material change vs last week']),
        ...(risks.length ? risks.slice(0, 3) : ['No high-risk customers this week']).map((s) => `Risk: ${s}`),
        ...opps.slice(0, 2).map((s) => `Opportunity: ${s}`),
        `Forecast next week: ${formatMoney(out.forecast_next_week.expected_collection, ccy)} (confidence ${out.forecast_next_week.confidence})`,
      ],
    },
    { heading: '**3. Required Actions**', priority: 6, min: 2, bullets: actions.length ? actions.slice(0, 5) : ['No owner actions required'] },
    { heading: '**4. CEO Decision Required**', priority: 8, min: 1, bullets: decisions.length ? decisions.slice(0, 3) : ['None this week'] },
  ];
  const linksLine = `**5. Links** [Tracker](${links.tracker}) · [Customer Risk](${links.risk}) · [Action Board](${links.actions})`;
  const render = () => [`**${title}**`, '', ...sections.flatMap((s) => [s.heading, ...s.bullets.map((b) => `- ${b}`), '']), linksLine, '', `_${footer}_`].join('\n');
  let markdown = render();
  while (markdown.length > MAX_MARKDOWN_CHARS) {
    const candidates = sections.filter((s) => s.bullets.length > s.min).sort((a, b) => a.priority - b.priority);
    if (!candidates.length) break;
    candidates[0].bullets.pop();
    markdown = render();
  }
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    const suffix = `\n… full detail: ${links.tracker}`;
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
  const title = `[Weekly Outstanding Report] ${reportDate} — Data refresh failed`;
  const body = `The weekly receivables report could not be produced.\n\nReason: ${reason}\n\nNo figures are shown because stale data must not be presented as current. The tracker shows the last successful snapshot. Ops has been alerted.`;
  const card: AdaptiveCard = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: `⚠️ ${title}`, size: 'Large', weight: 'Bolder', wrap: true, color: 'Attention' },
      { type: 'TextBlock', text: body, wrap: true },
      { type: 'TextBlock', text: `Attempted ${formatInTimeZone(ctx.sentAt, ctx.timeZone)} · Automated message`, isSubtle: true, size: 'Small', wrap: true },
    ],
    actions: [{ type: 'Action.OpenUrl', title: 'Open Tracker', url: `${ctx.trackerBaseUrl}#/` }],
  };
  const markdown = `**${title}**\n\n${body}`;
  return { idempotency_key: `weekly-outstanding:${reportDate}:${ctx.channelLabel}:failure`, title, card, markdown, markdown_length: markdown.length };
}
