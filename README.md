# Outstanding Receivables Tracker (미수금 트래커) — Prototype

B2B hotel-distribution receivables tracker for OhMyHotel: a static React dashboard (GitHub Pages) plus a
GitHub Actions pipeline that pulls data from the **Ellis MCP**, computes outstanding / aging / risk, generates a
verified AI insight and posts a weekly executive report to **Microsoft Teams every Saturday 09:00 (Asia/Ho_Chi_Minh)**.

> **Prototype status.** Everything runs end-to-end on deterministic **mock data**. The live Ellis MCP, the Teams
> webhook and the AI key are pluggable adapters that are wired but **blocked** until credentials / tools are provided
> (see [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) and [docs/ELLIS_MCP_MAPPING.md](docs/ELLIS_MCP_MAPPING.md)).

## Contents

| Area | Where |
|------|-------|
| Frontend (React + TS + Vite, HashRouter) | `src/app/` |
| Domain engine (types, aging, KPIs, risk score, snapshot compare, validation) | `src/core/` |
| Adapters: Ellis (mock / live MCP), AI insight (rule-based / Claude), Teams (mock / Workflows webhook), storage | `src/adapters/` |
| Weekly automation pipeline + env/log helpers | `automation/` |
| GitHub Actions (Pages deploy, Saturday report) | `.github/workflows/` |
| Documentation set | `docs/` |
| Committed samples (Adaptive Card, Markdown, insight JSON, mock dataset) | `samples/` |
| Tests: unit (`tests/unit`), integration (`tests/integration`), E2E Playwright (`tests/e2e`) | `tests/` |

Documents: [PRODUCT_REQUIREMENTS](docs/PRODUCT_REQUIREMENTS.md) · [ELLIS_MCP_MAPPING](docs/ELLIS_MCP_MAPPING.md) ·
[DATA_DICTIONARY](docs/DATA_DICTIONARY.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [SECURITY](docs/SECURITY.md) ·
[AI_INSIGHT_SPEC](docs/AI_INSIGHT_SPEC.md) · [TEAMS_MESSAGE_SPEC](docs/TEAMS_MESSAGE_SPEC.md) ·
[QA_REPORT](docs/QA_REPORT.md) · [DECISION_LOG](docs/DECISION_LOG.md) · [OPEN_QUESTIONS](docs/OPEN_QUESTIONS.md)

---

## 1. Local run

Requirements: Node.js 20+ (tested on 24), npm 10+.

```bash
npm ci
npm run dev            # http://localhost:5173  (mock mode by default)
```

Other commands:

| Command | What it does |
|---------|--------------|
| `npm run typecheck` | TypeScript for app + automation |
| `npm run test` | Vitest unit + integration (74+ tests, no network) |
| `npm run test:e2e` | Playwright (desktop + mobile) against `npm run preview` |
| `npm run build` | Production bundle to `dist/` |
| `npm run mock:generate` | Prints the mock dataset profile and scenario coverage |
| `npm run report:sample` | Regenerates `samples/*` from mock data |
| `npm run report:weekly:dry` | Full pipeline in DRY_RUN with mock data → `automation/out/` |

## 2. Mock mode

The app opens in **mock mode** (`?mode=mock`, amber "MOCK DATA" badge). The dataset is generated in the browser by
`src/adapters/ellis/mock-data.ts`: 34 fictional customers, 182 invoices, 65 payments, 12 activities and a 12-week
snapshot history (reference-date selector in the header). Every PRD scenario is a named customer, e.g.
`Mekong Holidays JSC` (90+ days, broken promise, limit exceeded), `Fuji Peak Travel Inc.` (sharp deterioration),
`Hanbit Tours Co.` (large but current), `Saigon Sky Tours` (missing due date / owner / limit).

Screens: `#/` Executive Overview · `#/aging` · `#/customers` (+ `#/customers/:id` with risk-score explanation) ·
`#/invoices` · `#/actions` · `#/insights`. Query helpers for QA: `?simulate=error`, `?simulate=empty`.

## 3. Connecting the Ellis MCP (live mode)

What is **confirmed** today: one tool, `get_hotel_bookings` (per-country pagination, `limit=500`). Invoice, payment and
customer-master tools are **not confirmed** — the adapter throws `ToolNotConfirmedError` for them and can only run in the
clearly labelled *bookings-derived* mode. Full mapping and the question list: [docs/ELLIS_MCP_MAPPING.md](docs/ELLIS_MCP_MAPPING.md).

Steps once the endpoint is available:

1. Set secrets `ELLIS_MCP_ENDPOINT` (Streamable-HTTP JSON-RPC URL) and `ELLIS_MCP_AUTH` (full `Authorization` header value).
2. Run a health check + dry run locally:
   ```bash
   DATA_SOURCE=ellis DRY_RUN=true AI_PROVIDER=mock TEAMS_SENDER=mock npx tsx automation/weekly-report.ts
   ```
   The log shows `tools/list` result, record counts and `completeness` notes. If the endpoint is not JSON-RPC over HTTP,
   implement `McpToolClient` (`src/adapters/ellis/types.ts`) for the real transport and inject it in `buildDeps()`.
3. When Ellis exposes ledger tools, implement `fetchInvoices/fetchPayments/fetchCustomers` in
   `src/adapters/ellis/live-adapter.ts` and switch `fetchDataset()` to the full dataset. The engine, UI and report need no changes.

The frontend "live" mode reads `data/tracker-model.json` + `data/insight.json` (aggregated, PII-free) published by the
pipeline (`PUBLISH_DATA=true`) or from a protected `VITE_LIVE_DATA_URL`.

## 4. GitHub Secrets and Variables

Settings → Secrets and variables → Actions.

| Secret | Purpose |
|--------|---------|
| `ELLIS_MCP_ENDPOINT`, `ELLIS_MCP_AUTH` | Ellis MCP access |
| `TEAMS_WEBHOOK_URL` | Leaders channel (Workflows webhook) |
| `TEAMS_TEST_WEBHOOK_URL` | Test channel |
| `TEAMS_ADMIN_WEBHOOK_URL` | Ops alerts (optional; falls back to test) |
| `AI_API_KEY` | Anthropic API key (only if `AI_PROVIDER=claude`) |

| Variable | Default | Purpose |
|----------|---------|---------|
| `DRY_RUN` | `true` | Scheduled runs never post until set to `false` |
| `TARGET_CHANNEL` | `test` | `test` or `leaders` |
| `DATA_SOURCE` | `mock` | `mock` or `ellis` |
| `AI_PROVIDER` | `mock` | `mock` or `claude` |
| `TEAMS_SENDER` | `live` | `live` or `mock` |
| `REPORTING_CURRENCY` | `USD` | ISO 4217 |
| `REPORT_TIMEZONE` | `Asia/Ho_Chi_Minh` | IANA zone for timestamps |
| `TRACKER_BASE_URL` | `https://<owner>.github.io/<repo>/` | Links in the card |
| `RECIPIENT_CONFIG` | see `.env.example` | Channel names / roles (no personal data) |
| `PUBLISH_DATA` | `false` | Commit aggregated model for the frontend live mode |
| `VITE_BASE_PATH`, `VITE_DATA_MODE`, `VITE_LIVE_DATA_URL` | | Frontend build options |

Secret values are never printed: `automation/lib/logger.ts` redacts protected values, webhook-like URLs and keys.

## 5. GitHub Pages deployment

1. Create the repository (private recommended) and push `main` (see §11 for the exact commands).
2. Settings → Pages → Source: **GitHub Actions**.
3. `.github/workflows/deploy-pages.yml` runs typecheck + tests, builds with `VITE_BASE_PATH=/<repo>/`, scans the
   bundle for secret-looking strings, and deploys. URL: `https://<owner>.github.io/<repo>/`.

> Real customer balances must not be published on a public Pages site. Keep the repo private with restricted Pages
> (GitHub Enterprise) or point `VITE_LIVE_DATA_URL` at an access-controlled endpoint. Mock mode is safe to publish.

## 6. Teams Workflows webhook

1. In Teams, open the target channel → **Workflows** → template *"Post to a channel when a webhook request is received"*.
2. Name it (e.g. `Outstanding Tracker - Leaders`), select team/channel, copy the HTTPS URL.
3. Store as `TEAMS_WEBHOOK_URL` (leaders) / `TEAMS_TEST_WEBHOOK_URL` (test). Create one per channel — never reuse.
4. Payload format and card structure: [docs/TEAMS_MESSAGE_SPEC.md](docs/TEAMS_MESSAGE_SPEC.md).

## 7. Saturday schedule

`.github/workflows/weekly-report.yml` — cron `0 2 * * 6` (UTC) = **Saturday 09:00 Asia/Ho_Chi_Minh** (UTC+7, no DST).
Steps: restore state branch → run pipeline → retry once after 2 min → upload preview artefacts → persist snapshots
to branch `tracker-state` → fail job (and alert admin) if both attempts failed. Idempotency key
`weekly-outstanding:<date>:<channel>` prevents double posting; `FORCE_RESEND=true` overrides.

## 8. Manual test send

Actions → *Weekly Outstanding Report (Teams)* → **Run workflow**:
`target_channel=test`, `dry_run=false`, `data_source=mock`, `ai_provider=mock`. Check the test channel and the
uploaded artefact (`teams-message.json` is the exact card posted).

Local equivalent (needs the test webhook in your shell environment):

```bash
TEAMS_SENDER=live DRY_RUN=false TARGET_CHANNEL=test TEAMS_TEST_WEBHOOK_URL=... npx tsx automation/weekly-report.ts
```

## 9. Going live (turning DRY_RUN off)

1. At least two successful `dry_run=false` posts to the **test** channel reviewed by Finance and GSM.
2. Set repository variables `TARGET_CHANNEL=leaders`, `DRY_RUN=false` (and `DATA_SOURCE=ellis`, `AI_PROVIDER=claude` when ready).
3. Run once manually with `target_channel=leaders`; confirm the card renders on mobile; then let the schedule take over.

## 10. Troubleshooting

| Symptom | Where to look |
|---------|---------------|
| Job failed | Actions run → `run-1.log` / `run-2.log` artefacts. Lines are prefixed `[n/13]`; `[!] FAILURE:` gives the cause. |
| "Data refresh failed" card received | Ellis fetch or schema validation failed. Log step `[3/13]`/`[4/13]`. Stale data is never sent. |
| Duplicate protection skipped a send | `[2/13] receipt exists` — re-run with `force_resend=true`. |
| Card not rendered / 400 from webhook | Validate `automation/out/teams-message.json` in the Adaptive Card designer; check webhook is a Workflows URL. |
| AI fallback used | `[8/13] insight provider=rule-based … fallback=true` and `[9/13]` verification notes. Report still sent. |
| Numbers differ from last week unexpectedly | Compare `automation/state/snapshots/<date>.json` (branch `tracker-state`); check `fx_effect` in `[6/13]`. |

## 11. First push & rollback

```bash
git init -b main
git add -A
git commit -m "feat: outstanding receivables tracker prototype"
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

Rollback: Pages → redeploy the previous successful run of *Deploy Tracker to GitHub Pages*, or
`git revert <sha> && git push`. For the report: set variable `DRY_RUN=true` (stops posting immediately); to undo a wrong
snapshot, delete `snapshots/<date>.json` on branch `tracker-state` and re-run with `force_resend`.

## 12. Security summary

No secret, webhook URL, MCP credential, ledger detail or personal data is in the frontend bundle or in git.
Guest names from Ellis are dropped at fetch time. Published data is aggregated and stripped (`publicModel()`).
Details: [docs/SECURITY.md](docs/SECURITY.md).
