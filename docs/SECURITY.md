# Security and Privacy — Outstanding Receivables Tracker

**Purpose.** This document states the threat model of the prototype, how secrets and personal data are handled in the code as it exists today (`automation/lib/env.ts`, `automation/lib/logger.ts`, `automation/weekly-report.ts`, `src/adapters/**`), the data-minimisation rules applied at every boundary, the operational safeguards (`DRY_RUN`, channel separation, idempotency), and the checklist that must be completed before the first report is sent to leadership or real balances are published.

**Status:** Draft v0.1 — 2026-09-07

> **요약 (Korean summary).** 비밀값(Ellis 엔드포인트/인증, Teams Webhook URL, AI API 키)은 GitHub Secrets에만 저장하고, 로그에서는 `RedactingLogger`가 자동으로 마스킹하며, 프런트엔드 번들에는 절대 포함하지 않습니다. 투숙객 이름(`guestName`)은 Ellis 응답을 받는 즉시 제거되어 어디에도 저장되지 않습니다. 게시용 모델은 수금 활동 메모와 입금 참조번호를 제거합니다. 기본값 `DRY_RUN=true`, 테스트/리더 채널 분리, 중복 전송 방지(영수증)로 오발송을 막습니다. 다만 게시 모델에는 **고객명과 잔액**이 남아 있으므로 공개 GitHub Pages에 실데이터를 올리면 안 됩니다.

### Status legend

| Status | Meaning |
| --- | --- |
| **Confirmed** | Implemented in code |
| **Assumed** | Relies on operator behaviour / configuration |
| **Required** | Must be done before go-live |

---

## 1. Threat model

| # | Asset | Threat | Impact | Control (status) |
| --- | --- | --- | --- | --- |
| T1 | Ellis MCP credentials (`ELLIS_MCP_AUTH`, endpoint) | Leak via logs, repo, or frontend bundle | Unauthorised read access to all bookings incl. guest PII | GitHub Secrets only; `RedactingLogger.protect()`; never imported by `src/app` (Confirmed); `.env*` git-ignored (Confirmed) |
| T2 | Teams webhook URLs | Leak → anyone can post arbitrary cards into the leaders channel (phishing, false figures) | Reputational / decision risk | Secrets only; regex redaction of `logic.azure.com` / `webhook.office.com` / `powerautomate` URLs in logs (Confirmed); rotate on suspicion (Required procedure) |
| T3 | Guest PII (`guestName`) | Stored in snapshots, artefacts or published JSON | Privacy law exposure (PIPA/APPI/PDPA) | Dropped at fetch time (Confirmed); no PII field in any domain type (Confirmed) |
| T4 | Customer receivable balances (B2B confidential) | Public exposure via GitHub Pages / public repo | Commercial damage, contractual breach | `PUBLISH_DATA` unset by default; private repo / protected endpoint (Required) |
| T5 | Wrong or stale figures sent to leadership | Bad decisions (credit hold on the wrong customer) | Business | Validation gate (`error` ⇒ no report), failure card instead of stale data, AI numeric verification gate, `is_mock` labelling (Confirmed) |
| T6 | Duplicate / accidental sends | Confusion, loss of trust | Business | Idempotency receipts, `DRY_RUN=true` default, channel separation (Confirmed) |
| T7 | Prompt injection through data (customer names, notes) into the AI provider | Manipulated insight text | Business | AI input is numbers + names only (no notes), output is schema-constrained and every number/name is verified against input (Confirmed) |
| T8 | Supply chain (npm dependencies) | Malicious package in CI | Secret exfiltration | `package-lock.json` committed; `npm ci` in CI (Assumed); Dependabot / audit (Required) |
| T9 | Repository write access | Malicious workflow change reads secrets; `weekly-report.yml` runs with `permissions: contents: write` and force-pushes the `tracker-state` branch / commits `public/data` | Secret exfiltration, tampered snapshots | Branch protection + required review on `.github/workflows/**`; protect `tracker-state` from manual edits (Required) |
| T10 | MCP server compromise / hostile tool output | Malformed or oversized responses | DoS of the job, wrong data | 30 s per-call timeout, Zod schema validation of the mapped dataset, run fails closed (Confirmed) |

---

## 2. Secrets handling

| Rule | Implementation | Status |
| --- | --- | --- |
| Single entry point | `loadEnv()` reads `process.env` once, validates, and returns a typed `PipelineEnv`; secrets live under `env.secrets` | Confirmed |
| Storage | GitHub Actions **Secrets** (`ELLIS_MCP_ENDPOINT`, `ELLIS_MCP_AUTH`, `TEAMS_WEBHOOK_URL`, `TEAMS_TEST_WEBHOOK_URL`, `TEAMS_ADMIN_WEBHOOK_URL`, `AI_API_KEY`) injected only into the two pipeline run steps of `weekly-report.yml`; locally in an untracked `.env` | Confirmed (workflow) / Required (secrets not yet registered) |
| Repository hygiene | `.gitignore` excludes `.env`, `.env.*` (except `.env.example`), `automation/state/*.json`, `automation/out/`, `*.log` | Confirmed |
| `.env.example` | Lists every variable with placeholders, marks the six `[SECRET]` values, contains no real secrets; states that dotenv is not auto-loaded | Confirmed |
| Log redaction | `RedactingLogger.protect(...)` is called in `buildDeps()` with all six secret values (values shorter than 6 chars are ignored); `redact()` also masks webhook-looking URLs, `sk-ant-…` keys and `Bearer …` tokens | Confirmed |
| Config echo | `describe(env)` logs only `set` / `missing` for each secret | Confirmed |
| Frontend bundle | `src/app` imports only `@core`, the mock adapter and the AI rule-based provider/types; Vite exposes only `VITE_*` variables. `deploy-pages.yml` step "Guard - no secrets in the bundle" fails the build if `dist/` contains `sk-ant-`, `webhook.office.com`, `logic.azure.com` or `ELLIS_MCP_AUTH=` | Confirmed (guard does not cover an Ellis endpoint URL pattern — extend when the host is known) |
| Transport | `HttpMcpClient` sends `ELLIS_MCP_AUTH` verbatim as the `authorization` header over HTTPS only (endpoint must be `https://`) | Assumed |
| Anthropic key | `ClaudeInsightProvider` receives the key via constructor; SDK handles transport; never logged | Confirmed |
| Rotation | Rotate Teams webhooks (delete + recreate the Workflow) and API keys on personnel change or suspected leak | Required (procedure) |

---

## 3. PII policy

| Rule | Where | Status |
| --- | --- | --- |
| **Guest names are never stored.** `guestName` is destructured out of every Ellis record inside `fetchBookings()` before the record is placed in the de-dup map | `src/adapters/ellis/live-adapter.ts` | Confirmed |
| No guest-level field exists in `Customer`, `Invoice`, `Payment`, `CollectionActivity`, `BookingContext`, `Snapshot`, `TrackerModel` | `src/core/types.ts` | Confirmed |
| `sellerBookingCode` (masked by Ellis) is not mapped; hotel/room/rate detail is not mapped | `bookingsToDataset()` | Confirmed |
| Mock data contains only fictional companies, owners and hotels; no personal data generated | `mock-data.ts` header | Confirmed |
| Published model (`public/data/tracker-model.json`) = `publicModel(model)`: activity `note` → `"[redacted in published data]"` (empty stays empty), `payment_reference → null` | `automation/weekly-report.ts` | Confirmed |
| AI input contains **no notes, no invoice detail, no references** — only computed figures, customer names and owner names | `buildInsightInput()` | Confirmed |
| Teams card contains customer names, owner names and amounts (business data), never guest data or notes | `message-builder.ts` | Confirmed |
| Snapshots contain aggregates + invoice ids/amounts, no free text | `Snapshot` type | Confirmed |
| Account-owner names are employee personal data; treat Teams channel membership and published data as internal-only | policy | Assumed |

---

## 4. Data minimisation by boundary

| Boundary | Data passing | Removed / not present |
| --- | --- | --- |
| Ellis → adapter | booking rows | `guestName` (immediately) |
| Adapter → dataset | Customer / Invoice / BookingContext | room/rate/promo/pax detail, `sellerBookingCode`, `cmsName`, `contractType` |
| Dataset → model | computed fields | nothing added beyond derivations |
| Model → `automation/out/tracker-model.json` | `publicModel()` | activity notes, payment references |
| Model → AI provider | `InsightInput` (numbers, names, dates, codes) | invoices, payments, activities, notes |
| Model → Teams | KPI facts, ≤ 5 risks, ≤ 3 opportunities, ≤ 6 actions, ≤ 4 decisions, ≤ 3 warnings, footer | everything else; Markdown capped near 3 500 chars |
| Model → Snapshot | totals, customer rows, dimension rows, invoice state | names of owners only as labels; no notes |
| Logs | counts, statuses, redacted config | secrets, URLs, keys |

---

## 5. Operational safeguards

| Safeguard | Behaviour | Status |
| --- | --- | --- |
| `DRY_RUN` default `true` | Nothing is posted unless `DRY_RUN=false` is set explicitly; dry runs still write previews and snapshots | Confirmed |
| Channel separation | `TARGET_CHANNEL=test` (default) → `TEAMS_TEST_WEBHOOK_URL`; `leaders` → `TEAMS_WEBHOOK_URL`; `loadEnv()` refuses a live non-dry send when the matching webhook is missing | Confirmed |
| Admin alerts | `TEAMS_ADMIN_WEBHOOK_URL` (falls back to the test webhook) receives failure alerts — never the leaders channel | Confirmed |
| Idempotency | one successful live send per `weekly-outstanding:<date>:<channel>`; `FORCE_RESEND=true` is the only override | Confirmed |
| Fail closed | schema `error` or fetch failure ⇒ failure card ("Data refresh failed") + alert; **no figures** | Confirmed |
| Mock labelling | title suffix `(MOCK DATA)`, card subtitle "Prototype run on fictional mock data", insight warning `MOCK DATA…` | Confirmed |
| Manual runs | `workflow_dispatch` inputs default to `target_channel=test`, `dry_run=true`, `data_source=mock`, `ai_provider=mock`, `force_resend=false`; scheduled runs read repository variables with the same safe defaults (`TEAMS_SENDER` defaults to `live`, harmless while `DRY_RUN=true`) | Confirmed (`weekly-report.yml`) |
| Webhook payload | Adaptive Card JSON only; no `Action.Submit`/`Action.Execute`, only `Action.OpenUrl` to `TRACKER_BASE_URL` | Confirmed |

---

## 6. Webhook URL protection

1. Create the Workflows webhooks with an account owned by the team (not a personal account that may leave).
2. Store only in GitHub Secrets; never paste into issues, chat, or `samples/`.
3. The `RedactingLogger` masks any URL on `logic.azure.com`, `webhook.office.com` or containing `powerautomate` even if not registered with `protect()`.
4. Use a **separate** webhook per channel (test / leaders / admin) so a leaked test URL cannot reach leadership.
5. On leak: delete the Flow in Teams Workflows, create a new one, update the secret, re-run in dry mode.

---

## 7. Least privilege for the MCP account

| Requirement | Rationale | Status |
| --- | --- | --- |
| Dedicated **read-only** service identity for the tracker (no booking modification rights) | The tracker only calls `tools/list` and `tools/call get_hotel_bookings` | Required (R14 in `ELLIS_MCP_MAPPING.md`) |
| Scope limited to the fields needed; if Ellis can omit `guestName` server-side, request it | Minimise PII in transit | Required |
| Separate credentials for local development and CI | Revocability | Required |
| Token expiry / rotation policy agreed with Ellis team | | Required |

---

## 8. Log hygiene

- All pipeline output goes through `RedactingLogger.log()` (timestamped, redacted); the sink is `console.log` → GitHub Actions job log.
- Logged: step tags, counts, statuses, idempotency keys, provider names, verification counts, error **messages**. Error messages from the MCP server or fetch are logged verbatim — if the server echoes the auth header in an error, the `Bearer …` regex masks it; other token formats would not be masked (Assumed risk → prefer `Bearer` scheme).
- Not logged: webhook URLs, endpoint URL, API key, card contents, customer notes.
- GitHub Actions additionally masks registered secrets in job logs.
- Artefacts uploaded from `automation/out/` (JSON, Markdown and `run-1.log` / `run-2.log`) contain business data (customer names, balances) → retention is set to 30 days (Confirmed); repository visibility must be private (Required).

---

## 9. Dependency notes

| Package | Use | Note |
| --- | --- | --- |
| `@anthropic-ai/sdk ^0.124.0` | live insight provider (`messages.parse`, `zodOutputFormat`) | only loaded in the automation process |
| `zod ^4.5.4` | dataset schema + AI output schema | validation is the primary defence against malformed source data |
| `react`, `react-dom`, `react-router-dom`, `recharts` | frontend | no network access needed at runtime except loading published JSON |
| `vite`, `vitest`, `@playwright/test`, `tsx`, `typescript`, `cross-env`, `jsdom`, testing-library | dev/test only | Playwright browsers installed locally |
| Lockfile | `package-lock.json` committed | use `npm ci` in CI; enable Dependabot security updates (Required) |

---

## 10. Go-live review checklist

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 1 | `.github/workflows/weekly-report.yml` created with `DRY_RUN` default `true` and `target_channel` default `test` | Engineering | Confirmed |
| 2 | All six secrets stored as GitHub Secrets; none present in repo history (`git log -p | grep -i webhook`) | GitHub admin | Required |
| 3 | `.env.example` committed with placeholders only | Engineering | Confirmed |
| 4 | Frontend bundle inspected: automated guard in `deploy-pages.yml` (`sk-ant-`, `webhook.office.com`, `logic.azure.com`, `ELLIS_MCP_AUTH=`); extend with the Ellis endpoint host once known | Engineering | Confirmed / Required (extension) |
| 5 | Live data endpoint decision: private repo + restricted Pages **or** protected `VITE_LIVE_DATA_URL`; `PUBLISH_DATA` unset until decided | IT / Engineering | Required |
| 6 | Ellis read-only service account issued; `guestName` confirmed dropped in a live dry run (grep artefacts for guest fields) | Ellis team / Engineering | Required |
| 7 | Three separate Teams webhooks (test / leaders / admin) created by a team-owned account and stored | Teams admin | Required |
| 8 | Supervised live send to **test** channel reviewed by Finance head | Finance | Required |
| 9 | Data-quality warnings in the test report reviewed; `completeness.payments` must be `full` before figures are called "overdue" to leadership | Finance | Required |
| 10 | Branch protection on `main` and review requirement for workflow changes | GitHub admin | Required |
| 11 | Dependabot alerts enabled; `npm audit` clean or triaged | Engineering | Required |
| 12 | Artifact retention for `automation/out` set to 30 days (Confirmed); repository (and therefore the `tracker-state` branch) private | GitHub admin | Required (repo visibility) |
| 13 | Incident procedure documented: webhook rotation, key rotation, how to re-send with `FORCE_RESEND` | Engineering | Required |
