# Teams Message Specification — Weekly Outstanding Report

**Purpose.** This document specifies the Microsoft Teams message produced every week: the Adaptive Card structure and Markdown fallback built by `src/adapters/teams/message-builder.ts`, the failure message, idempotency and retry rules implemented in `src/adapters/teams/live-sender.ts` and `automation/weekly-report.ts`, channel routing and webhook setup, the webhook payload format, recipient configuration, and the future Graph API design for per-user delivery.

**Status:** Draft v0.1 — 2026-09-07. No Teams webhook exists yet; the live sender has not been exercised against Teams. Card and Markdown samples were generated from mock data (`samples/adaptive-card.sample.json`, `samples/teams-message.sample.md`).

> **요약 (Korean summary).** 매주 토요일 09:00(호치민)에 Teams Workflows Webhook으로 Adaptive Card(v1.4, 전체 폭)를 전송합니다. 카드 구성: 제목 → ① 경영 요약(6개 핵심 지표 + 최대 3문장) → ② AI 인사이트(주요 변화·상위 리스크·수금 기회·다음 주 예측) → ③ 필요한 액션(담당자별, 최대 6건) → ④ CEO 의사결정(최대 4건) → 데이터 품질 → 푸터(데이터 기준시각, 전송시각, 통화, 비교 스냅샷, 데이터 완전성, 인사이트 출처) → 버튼 3개(Tracker, Customer Risk, Action Board). 데이터 수집 실패 시 수치 대신 "Data refresh failed" 카드를 보내고 관리자 채널에 알립니다. 중복 전송은 (보고일, 채널) 영수증으로 차단하고, 전송 실패 시 3회 지수 백오프 재시도합니다. 테스트/리더/관리자 채널은 각각 별도 Webhook URL을 사용합니다.

### Status legend

| Status | Meaning |
| --- | --- |
| **Confirmed** | Implemented in code and exercised with the mock sender |
| **Assumed** | Implemented but not yet exercised against Microsoft Teams |
| **Required** | Not available yet (webhooks, admin decisions) |
| **Future** | Design option, not implemented |

---

## 1. Message object — `TeamsMessage` (Confirmed)

| Field | Content |
| --- | --- |
| `idempotency_key` | `weekly-outstanding:<reference_date>:<channelLabel>` (`channelLabel` ∈ `test` \| `leaders`) |
| `title` | `[Weekly Outstanding Report] <YYYY-MM-DD>` + ` (MOCK DATA)` when `is_mock` |
| `card` | Adaptive Card JSON (§2) |
| `markdown` | Markdown fallback (§3) |
| `markdown_length` | length guard value |

`MessageContext`: `trackerBaseUrl` (from `TRACKER_BASE_URL`, trailing slash), `timeZone` (`REPORT_TIMEZONE`), `sentAt` (ISO), `channelLabel`.

Links: `tracker = <base>#/`, `risk = <base>#/customers`, `actions = <base>#/actions`, `insight = <base>#/insights` (the insight link is computed but not placed on a button).

Formatting: `M(n)` = compact money (`USD 1.58M`, `USD 462.9K`); `delta(kpi)` = `+USD 368.5K (+30.4%)` or `n/a` when no previous week.

---

## 2. Adaptive Card structure (Confirmed)

Header fields: `type: "AdaptiveCard"`, `$schema: "http://adaptivecards.io/schemas/adaptive-card.json"`, `version: "1.4"`, `msteams: { width: "Full" }`.

| Order | Block | Type | Content / limits |
| --- | --- | --- | --- |
| 1 | Title | `TextBlock` size Large, Bolder | `title` |
| 2 | Subtitle | `TextBlock` subtle | `⚠️ Prototype run on fictional mock data` if mock, else `Channel: <test|leaders>` |
| 3 | **§1 Executive Summary** | heading `TextBlock` Medium Bolder | |
| 4 | KPI facts | `FactSet` (6 facts) | Total outstanding `M (delta)`, Overdue `M (delta)`, Collected this week `M`, 30+ days overdue `M (delta)`, 90+ days overdue `M (delta)`, Due next 7 days `M` |
| 5 | Summary bullets | `TextBlock` × ≤ 3 (`• …`, spacing Small) | `insight.output.executive_summary[0..2]` |
| 6 | **§2 AI Insights** | heading | |
| 7 | Key changes | sub-heading + ≤ 3 bullets | `major_changes` or "No material change vs last week" |
| 8 | Top risks | sub-heading + ≤ 5 bullets | `**<customer>** (<owner>) — <amount>: <reason>` or "No high-risk customers this week" |
| 9 | Collection opportunities | sub-heading + ≤ 3 bullets | `**<customer>** — <amount>: <why>` or "Insufficient data" |
| 10 | Forecast | `TextBlock` | `Forecast next week: <amount> (confidence <c>) — <basis[0]>; <basis[1]>` |
| 11 | **§3 Required Actions** | heading + ≤ 6 bullets | `**<owner>** → <customer> · <amount> · <action> · by <deadline>` or "No owner actions required" |
| 12 | **§4 CEO Decision Required** | heading + ≤ 4 bullets | `**<topic>** — <customer> (<amount>): <recommendation>. _<rationale>_` or "None this week" |
| 13 | Data quality (optional) | heading + ≤ 3 bullets | `data_quality_warnings[0..2]`; omitted when empty |
| 14 | Footer | `TextBlock` subtle Small | `Data as of <as_of in tz> · Sent <sentAt in tz> · Reporting currency <ccy> · Compared with <previous_snapshot_date|n/a> · Data customers:<c> invoices:<c> payments:<c> activities:<c> fx:<c> · Insight: <provider>[ (fallback)] · Automated report` |
| — | `actions` | 3 × `Action.OpenUrl` | **Open Tracker** → `#/`, **Customer Risk** → `#/customers`, **Action Board** → `#/actions` |

Sample run (mock, 2026-09-05): 37 body blocks (the count varies with the number of risks, actions and decisions). Amounts inside bullets use full precision (`USD 27,100.00`); the FactSet uses compact format.

### 2.1 Mapping to PRD report sections

| PRD section | Card realisation | Markdown realisation |
| --- | --- | --- |
| 1 Executive Summary | FactSet + ≤ 3 sentences | `**1. Executive Summary**` — 4 KPI lines + `executive_summary[1..2]` (the first sentence is skipped because it repeats the KPI lines) |
| 2 AI Insights | Key changes (≤ 3), Top risks (≤ 5), Collection opportunities (≤ 3), Forecast | `**2. AI Insights**` — ≤ 2 changes, ≤ 3 `Risk:` bullets, ≤ 2 `Opportunity:` bullets, forecast line |
| 3 Required Actions | ≤ 6 owner actions | `**3. Required Actions**` — ≤ 5 |
| 4 CEO Decision Required | ≤ 4 decisions | `**4. CEO Decision Required**` — ≤ 3 |
| 5 Links | 3 `Action.OpenUrl` buttons | `**5. Links** [Tracker](…) · [Customer Risk](…) · [Action Board](…)` |
| 6 Footer / data provenance | Data quality block + footer TextBlock | `_footer_` (italic) — data-quality warnings are **not** included in Markdown |

---

## 3. Markdown fallback (Confirmed)

Built in parallel for channels/clients that do not render Adaptive Cards and written to `automation/out/teams-message.md` for review. Structure as in §2.1: title, sections 1–4, `**5. Links**`, italic footer.

**Length budget:** `MAX_MARKDOWN_CHARS = 3500` ("~1 minute mobile read"). Each section carries a `priority` and a minimum bullet count (`min`): Executive Summary (priority 10, min 4 — the KPI lines are never dropped), CEO Decision Required (8, min 1), Required Actions (6, min 2), AI Insights (4, min 2). While the rendered text exceeds 3 500 characters, one bullet is removed from the **lowest-priority section that is still above its minimum** (AI Insights first, then Required Actions, then CEO decisions, then the summary sentences) and the text is re-rendered, so the message always ends cleanly with links and footer. Only if every section is at its minimum and the text is still too long is it hard-truncated to exactly `3500 − len(suffix)` characters plus `
… full detail: <tracker link>`.

Sample run (mock, 2026-09-05): 3 308 characters, no trimming needed.

---

## 4. Failure message — `buildFailureMessage(reportDate, reason, ctx)` (Confirmed)

Sent **instead of** the report whenever fetch or validation fails (pipeline `fail()`), so stale figures are never presented as current.

| Field | Content |
| --- | --- |
| `idempotency_key` | `weekly-outstanding:<date>:<channel>:failure` |
| `title` | `[Weekly Outstanding Report] <date> — Data refresh failed` |
| Card body | `⚠️ <title>` (Large, Bolder, color Attention) · body text: "The weekly receivables report could not be produced.\n\nReason: <reason>\n\nNo figures are shown because stale data must not be presented as current. The tracker shows the last successful snapshot. Ops has been alerted." · `Attempted <sentAt in tz> · Automated message` |
| Actions | `Open Tracker` → `#/` |
| Markdown | `**<title>**\n\n<body>` |

Pipeline behaviour on failure: write card to `automation/out/teams-message.json`; if not `DRY_RUN` send it to the **target** channel; always call `sender.alert("Weekly Outstanding Report <date> FAILED: <reason>")`; save `<key>:failure` receipt; exit 1. Sample: `samples/adaptive-card.failure.sample.json`.

---

## 5. Idempotency (Confirmed)

| Rule | Detail |
| --- | --- |
| Key | `weekly-outstanding:<report_date>:<channel>` — one successful live send per report date and channel |
| Check | before fetching: if a receipt exists with `ok = true` and `dry_run = false`, and the current run is not `DRY_RUN` and `FORCE_RESEND` ≠ `true` → status `skipped-duplicate`, exit 0 |
| Receipt | `{ idempotency_key, report_date, channel, ok, status, attempts, sent_at, dry_run, error }` saved by `FileSnapshotStore` under `automation/state/receipts/` |
| Dry runs | save a receipt with `dry_run: true, attempts: 0` which does **not** block a later real send |
| Failure | `:failure` receipt (does not block a retry of the real report) |
| Alerts | key `alert:<ISO timestamp>` — never deduplicated |
| Note | the Workflows webhook itself has no deduplication; the receipt store must persist between runs or the retry-once workflow could double-post |

---

## 6. Retry policy — `LiveTeamsSender.post()` (Confirmed code, Assumed against Teams)

| Setting | Value |
| --- | --- |
| Attempts | `maxAttempts = 3` (from `buildDeps()`) |
| Backoff | `baseDelayMs × 2^(attempt−1)` with `baseDelayMs = 2000` → waits 2 s, then 4 s |
| Retry on | HTTP **429**, **408**, any **5xx**, and network/`fetch` exceptions |
| No retry on | other 4xx (400, 401, 403, 404 …) → loop breaks immediately, result `ok: false` |
| Success | any `2xx` (Workflows typically returns 202) → `SendResult { ok: true, status, attempts, sent_at, idempotency_key }` |
| Logging | `[teams] channel=<c> key=<k> status=<s> attempt=<n>` — URL never logged |
| Missing URL | `ok: false, attempts: 0, error: 'No webhook configured for channel "<c>"'` |
| Pipeline follow-up | on `ok: false` the pipeline saves the failed receipt, sends an admin alert and exits 1 (workflow retries once) |

`MockTeamsSender` supports `failuresBeforeSuccess` to simulate 503s in tests.

---

## 7. Channel routing (Confirmed)

| Channel | Env var | Used for | Default recipient name (`RECIPIENT_CONFIG`) |
| --- | --- | --- | --- |
| `leaders` | `TEAMS_WEBHOOK_URL` | the weekly report when `TARGET_CHANNEL=leaders` | `Leadership - Receivables` |
| `test` | `TEAMS_TEST_WEBHOOK_URL` | default target; supervised runs | `Outstanding Tracker - Test` |
| `admin` | `TEAMS_ADMIN_WEBHOOK_URL` (falls back to test URL) | `alert()` on failures | `admin_channel: null` |

Guard rails in `loadEnv()`: a live, non-dry send to `leaders` requires `TEAMS_WEBHOOK_URL`; to `test` requires `TEAMS_TEST_WEBHOOK_URL`. `TARGET_CHANNEL` defaults to `test`.

**Recipient config (`RECIPIENT_CONFIG` JSON, optional):**

```json
{
  "leaders_channel": "Leadership - Receivables",
  "test_channel": "Outstanding Tracker - Test",
  "admin_channel": null,
  "roles": ["CEO", "Finance Leader", "GSM Leader", "Sales Leaders", "Collection Leader"]
}
```

It is **descriptive** (logged via `describe()`, useful for documentation and future Graph routing); actual delivery is decided solely by which webhook URL is configured. Membership of the Teams channels is managed in Teams by the admin (Required).

---

## 8. Webhook setup in Microsoft Teams (Required — not yet created)

Incoming Webhooks (Office 365 connectors) are being retired by Microsoft; use **Workflows**:

1. In Teams, open the target channel → `…` → **Workflows** (or open the **Workflows** app).
2. Choose the template **"Post to a channel when a webhook request is received"**.
3. Sign in with a **team-owned** account, select Team and Channel, name the flow (e.g. `Outstanding Tracker – Leaders`), create.
4. Copy the generated HTTPS URL (host `*.logic.azure.com` / Power Automate) — this is the secret.
5. Store it as the GitHub Secret `TEAMS_WEBHOOK_URL` (leaders), `TEAMS_TEST_WEBHOOK_URL` (test) or `TEAMS_ADMIN_WEBHOOK_URL` (admin). Repeat per channel — **three separate flows**.
6. Test with `TEAMS_SENDER=live DRY_RUN=false TARGET_CHANNEL=test DATA_SOURCE=mock AI_PROVIDER=mock npm run report:weekly` (posts the mock card to the test channel only).

Note: the Workflows template posts the card "as Flow bot"; the author name shown will be the flow/user, not "Outstanding Tracker" (cosmetic; Future: Graph API bot identity).

---

## 9. Webhook payload format (Confirmed code, Assumed against Teams)

Report / failure message:

```json
{
  "type": "message",
  "summary": "<title>",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "contentUrl": null,
      "content": { "type": "AdaptiveCard", "version": "1.4", "...": "card body" }
    }
  ]
}
```

Admin alert (no `summary`, minimal card):

```json
{
  "type": "message",
  "attachments": [{
    "contentType": "application/vnd.microsoft.card.adaptive",
    "content": {
      "type": "AdaptiveCard", "version": "1.4",
      "body": [
        { "type": "TextBlock", "text": "⚠️ Outstanding Tracker — automation alert", "weight": "Bolder", "size": "Medium" },
        { "type": "TextBlock", "text": "<alert text>", "wrap": true }
      ]
    }
  }]
}
```

Headers: `content-type: application/json`; method `POST`. The Workflows template expects exactly this "Send each adaptive card" shape (it iterates `attachments`). Card size limit in Teams is ~28 KB; the sample card is ~9.8 KB.

---

## 10. Graph API alternative — per-user delivery (Future, not implemented)

| Aspect | Design |
| --- | --- |
| Goal | Deliver role-specific views (e.g. owner-only action lists) as chat messages or post to channels with an app identity |
| Auth | Azure AD app registration; application permissions **`ChannelMessage.Send`** (channel posts) and **`Chat.ReadWrite`** (1:1 / group chats); admin consent required |
| Recipient validation | resolve each recipient from `RECIPIENT_CONFIG` to an Azure AD object id via Graph `/users/{upn}`; reject unknown / disabled accounts before sending; log only object ids |
| Payload | `POST /teams/{team-id}/channels/{channel-id}/messages` or `/chats/{chat-id}/messages` with `attachments[].contentType = application/vnd.microsoft.card.adaptive` and `body.content` containing `<attachment id="…"></attachment>` |
| Idempotency | same receipt key scheme extended with recipient id: `weekly-outstanding:<date>:<recipient>` |
| Adapter | new `GraphTeamsSender implements TeamsSender` — no change to the pipeline or the message builder |
| Prerequisites | IT (Teams admin) approval, app registration, secret/certificate management, Graph throttling handling (retry on 429 with `Retry-After`) |

---

## 11. Acceptance checklist

| # | Check | Status |
| --- | --- | --- |
| 1 | Card renders in Teams desktop and mobile with `width: Full`; all `TextBlock`s wrap | Required (needs webhook) |
| 2 | Three buttons open the correct hash routes of `TRACKER_BASE_URL` | Required |
| 3 | Mock run shows `(MOCK DATA)` in title and the prototype subtitle | Confirmed |
| 4 | Failure card sent instead of figures when the source is unreachable; admin alert received | Confirmed (mock sender) / Required (live) |
| 5 | Second run for the same date and channel is skipped with `skipped-duplicate` | Confirmed |
| 6 | 503 from webhook → 3 attempts with 2 s / 4 s waits, then alert | Confirmed (unit-level via mock) / Assumed (live) |
| 7 | Markdown fallback ≤ 3 500 chars; bullets are trimmed by priority before any hard truncation (sample: 3 308 chars) | Confirmed |
