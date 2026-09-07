# AI Insight Specification

**Purpose.** This document specifies the weekly "AI Insight" component: the structured input handed to the model (`InsightInput`, built by `src/adapters/ai/insight-input.ts`), the exact output JSON contract (`InsightOutput`, `src/adapters/ai/types.ts`), the system prompt and model configuration of the live provider (`src/adapters/ai/live-provider.ts`), the anti-hallucination verification and sanitisation algorithm (`src/adapters/ai/verify.ts`), the deterministic rule-based provider (`src/adapters/ai/mock-provider.ts`), the orchestration and failure handling (`src/adapters/ai/insight-service.ts`), and illustrative example outputs generated from mock data.

**Status:** Draft v0.1 — 2026-09-07. No AI API key is configured in the build environment, so the live provider has not been executed here; all examples come from the rule-based provider on mock data.

> **요약 (Korean summary).** AI는 **숫자를 계산하지 않고 해석만** 합니다. 입력은 트래커가 계산한 수치·고객명·담당자명만 담은 JSON이며, 출력은 고정된 JSON 스키마(경영 요약, 주요 변화, 상위 리스크, 수금 기회, 담당자 액션, CEO 의사결정, 다음 주 수금 예측, 데이터 품질 경고)로 강제됩니다. 출력의 모든 숫자·고객명·담당자명은 입력값과 대조 검증되며, 검증 실패 항목은 제거되고, 요약이 비면 규칙 기반 생성기로 대체됩니다. 모델 장애 시에도 보고서는 항상 생성됩니다.

### Status legend

| Status | Meaning |
| --- | --- |
| **Confirmed** | Implemented in code (and, for the rule-based path, exercised via `npm run report:sample`) |
| **Assumed** | Behaviour expected but not yet exercised (live model path) |
| **Required** | Missing prerequisite |

---

## 1. Design principles (from the system prompt and code comments)

1. The model **interprets** figures; it never computes or invents amounts, percentages, names or dates.
2. Every output number, customer name and owner name must be traceable to the input — enforced mechanically by `verifyInsight()`.
3. The weekly report **never depends on the model being available**: `generateInsight()` always returns an `InsightResult` (rule-based fallback).
4. No PII and no invoice-level detail reach the model.

---

## 2. Input contract — `InsightInput` (Confirmed)

Built by `buildInsightInput(model: TrackerModel)`. All amounts are in `reporting_currency`. "withBalance" = customers with `total_outstanding_reporting > 0`.

| Field | Type | Construction |
| --- | --- | --- |
| `report_date` | ISODate | `model.reference_date` |
| `previous_snapshot_date` | ISODate \| null | |
| `reporting_currency` | string | |
| `is_mock` | boolean | |
| `kpis[]` | `{ key, label, value, previous, change, change_pct, unit }` | the 10 KPIs without status/interpretation/definition |
| `fx_effect_reporting` | number \| null | |
| `top_overdue_customers[]` | `CustomerFact` | withBalance, `overdue > 0`, sorted by overdue desc, top 8 |
| `new_overdue_customers[]` | `CustomerFact` | `wow_overdue_change > 0`, sorted desc, top 8 |
| `improved_customers[]` | `CustomerFact` | `wow_overdue_change < 0`, most improved first, top 5 |
| `broken_promises[]` | `CustomerFact` | `promise_broken` |
| `credit_limit_exceeded[]` | `CustomerFact` | `credit_limit_exceeded` |
| `disputes[]` | `CustomerFact` | `disputed_reporting > 0` |
| `collection_opportunities[]` | `CustomerFact` | overdue > 0, `max_aging_days ≤ 30`, no broken promise, no dispute, and (has last payment **or** an upcoming promise); top 5 by overdue |
| `by_owner[]` | `{ owner, total, overdue, previous_overdue, customers_overdue, broken_promises }` | aggregated over withBalance by `account_owner_name`; `previous_overdue` from `aging_by_owner` |
| `by_country[]` | `{ country, total, overdue, previous_overdue }` | from `aging_by_country` |
| `due_next_week[]` | `{ customer, owner, amount, due_date }` | open, not overdue, `reference < due_date ≤ reference + 7`, sorted by amount desc, top 10 |
| `due_next_week_total` | number | sum over **all** due-next-week invoices (not only top 10) |
| `promised_next_week_total` | number | Σ `next_promise_amount_reporting` where `next_promise_date ≤ reference + 7` |
| `recent_activity_count` | number | activities with `activity_date ≥ week.start` (linked to invoices) |
| `data_quality[]` | `{ code, count, sample }` | grouped by issue code |
| `completeness` | `DatasetCompleteness` | |

`CustomerFact`: `customer`, `country`, `owner`, `total`, `overdue`, `overdue_30_plus`, `max_aging_days`, `wow_overdue_change`, `risk_score`, `risk_grade`, `risk_reasons` (top 3 factor `evidence` strings with points > 0, by points desc), `promise_date` (next promise), `broken_promise_amount`, `credit_utilization`, `disputed`, `last_payment_date`, `recommended_action`.

A full sample: `samples/insight-input.sample.json` (mock, 2026-09-05).

---

## 3. Output contract — `InsightOutput` (Confirmed)

Exact shape (also enforced as `InsightOutputSchema` with Zod for structured output):

```ts
interface InsightOutput {
  executive_summary: string[];
  major_changes: string[];
  top_risks: { customer: string; owner: string; amount: number; reason: string; action: string; due: string }[];
  collection_opportunities: { customer: string; owner: string; amount: number; why: string }[];
  owner_actions: { owner: string; customer: string; amount: number; action: string; deadline: string }[];
  ceo_decisions: { topic: string; customer: string | null; amount: number | null; recommendation: string; rationale: string }[];
  forecast_next_week: { expected_collection: number; currency: string; confidence: 'low' | 'medium' | 'high'; basis: string[] };
  data_quality_warnings: string[];
}
```

Wrapper returned by the service:

```ts
interface InsightResult {
  output: InsightOutput;
  provider: string;          // 'claude' | 'rule-based'
  model: string | null;      // e.g. 'claude-opus-5' or null for rule-based
  generated_at: string;      // ISO datetime
  verification: VerificationReport;
  fallback_used: boolean;
  error?: string;
}
interface VerificationReport {
  ok: boolean;
  checked_numbers: number;
  unverified_numbers: { value: number; where: string }[];
  unknown_customers: { name: string; where: string }[];
  unknown_owners: { name: string; where: string }[];
  notes: string[];
}
```

Mapping to the Teams card: `executive_summary` (≤ 3) → §1; `major_changes` (≤ 3), `top_risks` (≤ 5), `collection_opportunities` (≤ 3), `forecast_next_week` → §2; `owner_actions` (≤ 6) → §3; `ceo_decisions` (≤ 4) → §4; `data_quality_warnings` (≤ 3) → "Data quality" block.

---

## 4. Live provider — `ClaudeInsightProvider` (Confirmed code, Assumed behaviour)

| Setting | Value |
| --- | --- |
| SDK | `@anthropic-ai/sdk` `client.messages.parse(...)` |
| Model | `claude-opus-5` (constructor `cfg.model` override) |
| Thinking | `thinking: { type: 'adaptive' }` |
| Output | `output_config: { effort: 'medium', format: zodOutputFormat(InsightOutputSchema) }` — schema-validated structured output |
| `max_tokens` | 8 000 (override `cfg.maxTokens`) |
| Timeout / retries | SDK `timeout` 120 000 ms, `maxRetries: 2` |
| System prompt | cached with `cache_control: { type: 'ephemeral' }` |
| User message | `"Weekly receivables figures (JSON). Produce the insight JSON.\n\n" + JSON.stringify(input)` |
| Errors | `stop_reason === 'refusal'` → throws `Model refused: …`; missing `parsed_output` → throws `Structured output could not be parsed (stop_reason=…)`; both are caught by the service → fallback |
| Key | `AI_API_KEY` (fallback `ANTHROPIC_API_KEY`) via `loadEnv()`; `AI_PROVIDER=claude` refuses to start without it |

### System prompt rules (verbatim intent)

> You are the receivables analyst for a B2B hotel-distribution company. You write the weekly executive insight for the CEO and leaders.
>
> Rules (strict):
> - Interpret ONLY the structured figures in the input. Never compute or invent new amounts, percentages, customer names, owner names or dates. Copy figures exactly as given (you may round to whole units).
> - Every claim must be traceable to an input field. Separate facts from inferences; mark inferences with "likely" and state the basis.
> - If a section has no supporting data, return an empty array or write "insufficient data". Do not exaggerate flat weeks.
> - Be specific: customer, owner, amount, deadline. No generic advice.
> - Only include CEO decisions that genuinely need an executive (credit hold, limit change, terms change, legal/escalation, exception approval).
> - Never mention personal data or invoice-level detail; the report is read on mobile in under a minute.
> - Deadlines: use the report date plus 2 days (Monday) for urgent items, plus 4 days for others, in YYYY-MM-DD.
> - Amounts are in the reporting currency given in the input.

---

## 5. Verification algorithm — `verifyInsight(input, output)` (Confirmed)

### 5.1 Allowed values

| Set | Contents |
| --- | --- |
| **Allowed numbers** | every finite number anywhere in `InsightInput` (deep walk) **plus derived numbers**: for each KPI `|change|`, `|change_pct| × 100`, ratio KPIs `value × 100`; for each `CustomerFact` in top-overdue / new / improved / broken / credit-exceeded lists: `|wow_overdue_change|`, `credit_utilization × 100`, `overdue / total × 100`, `overdue_30_plus / total × 100`; share of portfolio overdue `overdue / overdueKpi.value × 100`, share of overdue increase `wow / overdueKpi.change × 100`, share of total `total / totalKpi.value × 100`; cumulative shares of the top 1..5 new-overdue customers of the overdue increase and of the top 1..5 overdue customers of total overdue; `due_next_week_total + promised_next_week_total` |
| **Allowed customers** | normalised (`trim().toLowerCase()`) names from all `CustomerFact` lists and `due_next_week` |
| **Allowed owners** | owners from the same lists, all `by_owner[].owner`, plus `Unassigned` |

### 5.2 Number extraction (`extractNumbers`)

Text is scanned after removing ISO dates (`YYYY-MM-DD`) and 4-digit years (`19xx`/`20xx`). Tokens matching `(\d[\d,]*\.?\d*)\s*(%|[KkMm]\b)?` are parsed; `K`/`k` × 1 000, `M`/`m` × 1 000 000; `%` values are compared as percentages.

### 5.3 Tolerance (`isAllowed(n)`)

1. Integers ≤ 10 → always allowed (counts, ordinals, "2 days").
2. Integers ≤ 400: allowed if equal to any `max_aging_days` in the fact lists, or if ≤ 60 (small counts / day figures are low-risk), or if in `BUCKET_BOUNDARIES = {61, 90, 91, 100}` (aging bucket labels such as "90+ days", a capped "100%").
3. Otherwise allowed if some allowed value `a` satisfies `|a − n| ≤ max(1, 0.6 % × |a|)`, or (`a ≥ 1 000` and `n` equals `a` rounded to the nearest 1 000 within ±500), or (`a ≥ 100 000` and `n` equals `a` rounded to the nearest 10 000 within ±5 000).

### 5.4 What is checked where

| Output section | Checks |
| --- | --- |
| `executive_summary[i]`, `major_changes[i]` | numbers in text |
| `top_risks[i]` | customer ∈ allowed, owner ∈ allowed, numbers in `amount reason action` |
| `collection_opportunities[i]` | customer, numbers in `amount why` |
| `owner_actions[i]` | customer, owner, numbers in `amount action` |
| `ceo_decisions[i]` | customer (nullable), numbers in `amount recommendation rationale` |
| `forecast_next_week` | `expected_collection` number, numbers in each `basis[i]`; currency mismatch → note only |
| `data_quality_warnings` | **not verified** (free-text warnings) |

`ok = no unverified numbers ∧ no unknown customers ∧ no unknown owners`.

### 5.5 Sanitisation — `sanitizeInsight(input, output)`

Each array item is re-verified **in isolation** (wrapped in an otherwise empty output); failing items are dropped and listed in `removed[]` (e.g. `executive_summary[2]`). A failing `forecast_next_week` is replaced by `{ expected_collection: 0, currency, confidence: 'low', basis: ['Forecast removed: unverifiable figures'] }`. `data_quality_warnings` pass through untouched.

### 5.6 Orchestration — `generateInsight(model, { provider, fallbackToRules = true, log })`

```
input = buildInsightInput(model)
try:
  out = provider.generate(input)
  v = verifyInsight(input, out)
  if v.ok → return { out, provider.name, model, verification: v, fallback_used: false }
  cleaned, removed = sanitizeInsight(input, out); v2 = verifyInsight(input, cleaned); v2.notes += "Removed unverifiable items: …"
  if cleaned.executive_summary is empty and fallback → rule-based output, provider 'rule-based', fallback_used: true, error 'model output failed verification'
  else → return cleaned (provider unchanged, fallback_used: false)
catch e:
  if !fallback → rethrow
  → rule-based output, provider 'rule-based', fallback_used: true, error: e.message
```

Observed on the sample run (Confirmed, `npm run report:sample`, 2026-09-05): the rule-based output verifies cleanly — `checked_numbers: 96`, no unverified numbers, no unknown names, `notes: []`. An earlier build of `isAllowed()` (before `BUCKET_BOUNDARIES` was added) flagged the literal `90` in the sentence "30+ days: …; 90+ days: …" and sanitisation removed that summary line; the whitelist fixes this false positive while keeping every other integer above 60 subject to verification.

---

## 6. Rule-based provider — `generateRuleBasedInsight(input)` (Confirmed)

Deterministic templates; used as `AI_PROVIDER=mock` and as the fallback. `M(n)` = `formatMoney(n, ccy)`; `nextMonday = report_date + 2`, `nextWed = report_date + 4`.

| Section | Rule |
| --- | --- |
| `executive_summary` | (1) total + WoW delta, overdue + ratio + WoW delta; (2) if overdue increased and there are new-overdue customers: "N customer(s) account for X% of the overdue increase: …" (top 3) — or, when the top-3 increase exceeds the net increase (share ≥ 100 %), "N customer(s) drove the overdue increase (their combined increase exceeds the net increase because other customers improved): …"; (3) collected / new overdue / 30+ / 90+; (4) FX line when `|fx_effect| ≥ 1` |
| `major_changes` | top 3 new-overdue customers: "<customer> (<owner>): overdue +<delta> to <overdue>; oldest item <n> days; risk <grade> (<score>/100). <first risk reason that is not the plain 'Overdue <CCY> …' amount>"; then top 2 improved customers "… overdue reduced by <x> to <y> (improvement)."; else "No material customer-level change versus last week." or "First snapshot: week-over-week comparison not available yet." |
| `top_risks` | top-overdue customers sorted by `risk_score` desc, top 5; `reason = "Risk <grade> (<score>/100): <2 reasons>"`, `action = recommended_action`, `due = nextMonday 12:00` if broken promise or max aging > 30 else `nextWed` |
| `collection_opportunities` | first 5 `collection_opportunities`; `why` = promise date + oldest item, or short overdue + last payment |
| `owner_actions` | broken promises (deadline Monday 12:00) → credit-limit exceeded (Monday) → disputes (Wednesday) → up to 3 risky customers with 30+ balance (Wednesday); de-duplicated by owner+customer, max 8 |
| `ceo_decisions` | 90+ overdue → "Credit hold / legal escalation"; credit exceeded → "Credit limit exception"; broken promise with score ≥ 70 → "Payment terms review" (move to prepayment); **one decision per customer** — the first (highest-priority) topic wins |
| `forecast_next_week` | `expected_collection = due_next_week_total + promised_next_week_total`; confidence `low` if `completeness.payments ≠ full`, else `medium` with a previous snapshot, else `low`; basis = due next week, promised next week, collected this week |
| `data_quality_warnings` | `MOCK DATA…` when `is_mock`; each data-quality code (except `MISSING_CREDIT_LIMIT`, `MISSING_TERMS`) as `CODE xN: sample`; each non-full completeness entity; all `completeness.notes` |

---

## 7. Failure handling summary

| Failure | Result |
| --- | --- |
| No API key / `AI_PROVIDER=mock` | rule-based provider, `provider: 'rule-based'`, `fallback_used: false` |
| Model timeout, network error, refusal, unparsable structured output | caught → rule-based, `fallback_used: true`, `error` set; footer shows `Insight: rule-based (fallback)` |
| Output verifies | returned unchanged |
| Output partially verifies | unverifiable items removed; `verification.notes` lists them; provider stays `claude` |
| Executive summary fully removed | rule-based fallback with `error: 'model output failed verification'` |
| `fallbackToRules: false` (tests) | error propagates |

The pipeline logs `[8/13] insight provider=… model=… fallback=…` and `[9/13] verification ok=… numbers_checked=… unverified=… notes=…`.

---

## 8. Example outputs — *illustrative; produced from mock data* (rule-based provider, reference date 2026-09-05, `samples/insight.sample.json`)

### Example 1 — Executive summary and major changes

```json
"executive_summary": [
  "Total outstanding is USD 1,581,798.06, up USD 368,493.87 (+30.4%) vs last week. Overdue is USD 462,900.59 (29.3% of total), up USD 106,217.00 (+29.8%) vs last week.",
  "3 customer(s) drove the overdue increase (their combined increase exceeds the net increase because other customers improved): Fuji Peak Travel Inc. (+USD 99,499.64), Nusantara Trips PT (+USD 13,000.00), Bali Breeze Tours (+USD 12,000.00).",
  "Collected this week: USD 64,500.23. New overdue this week: USD 166,399.63. 30+ days: USD 87,600.28; 90+ days: USD 23,000.00.",
  "FX movement explains USD 155.20 of the week-over-week change in total outstanding (rest is real balance movement)."
],
"major_changes": [
  "Fuji Peak Travel Inc. (Kenta Sato): overdue +USD 99,499.64 to USD 99,499.64; oldest item 5 days; risk Watch (38/100). New overdue this week: USD 99,500",
  "Nusantara Trips PT (Aisha Rahman): overdue +USD 13,000.00 to USD 13,000.00; oldest item 6 days; risk Watch (40/100). Credit utilization 137%",
  "Kimchi & Go Travel: overdue reduced by USD 44,589.03 to USD 0.00 (improvement)."
]
```

### Example 2 — Top risk, owner action and CEO decision (same customer)

```json
"top_risks": [{
  "customer": "Mekong Holidays JSC", "owner": "Linh Nguyen", "amount": 27100,
  "reason": "Risk High (81/100): Oldest overdue invoice: 111 days; Overdue USD 27,100",
  "action": "Escalate to Finance leader; evaluate credit hold and legal/collection agency path",
  "due": "2026-09-07 12:00"
}],
"owner_actions": [{
  "owner": "Linh Nguyen", "customer": "Mekong Holidays JSC", "amount": 15800,
  "action": "Promise of USD 15,800.00 missed (no new date); re-confirm remittance date",
  "deadline": "2026-09-07 12:00"
}],
"ceo_decisions": [{
  "topic": "Credit hold / legal escalation", "customer": "Mekong Holidays JSC", "amount": 27100,
  "recommendation": "Approve credit hold and collection-agency/legal path for Mekong Holidays JSC",
  "rationale": "USD 27,100.00 overdue, oldest 111 days, risk High"
}]
```

### Example 3 — Collection opportunity, forecast and data-quality warnings

```json
"collection_opportunities": [{
  "customer": "Lion City Journeys Pte.", "owner": "Aisha Rahman", "amount": 17500.01,
  "why": "Payment promised for 2026-09-09; oldest item 14 days"
}],
"forecast_next_week": {
  "expected_collection": 286197.58, "currency": "USD", "confidence": "medium",
  "basis": [
    "Invoices due next week: USD 274,197.58",
    "Payments promised for next week: USD 12,000.00",
    "Collected this week: USD 64,500.23 (reference for run-rate)"
  ]
},
"data_quality_warnings": [
  "MOCK DATA: figures are fictional and for prototype demonstration only.",
  "MISSING_DUE_DATE x1: Missing due_date; aging cannot be computed",
  "MISSING_OWNER x1: No account owner assigned",
  "invoices data is partial"
]
```

Provenance block of the same sample: `"provider": "rule-based", "model": null, "verification": { "ok": true, "checked_numbers": 96, "unverified_numbers": [], "unknown_customers": [], "unknown_owners": [], "notes": [] }, "fallback_used": false`. The sample's `ceo_decisions` contains two items (Mekong Holidays JSC — credit hold; Nusantara Trips PT — credit limit exception) because decisions are de-duplicated per customer.

---

## 9. Open items

| # | Item | Status |
| --- | --- | --- |
| A1 | Run the live provider once with a real key in dry-run mode and archive the `VerificationReport` | Required (no key in environment) |
| A2 | Bucket labels ("90+") whitelisted via `BUCKET_BOUNDARIES` — resolved; keep an eye on other label-like integers (e.g. "365 days") | Resolved |
| A3 | Prompt/schema versioning: record `SYSTEM_PROMPT` hash in `InsightResult` for auditability | Assumed improvement |
| A4 | Cost/latency budget for `claude-opus-5` with adaptive thinking on a ~30 KB input | Required (measure in A1) |
