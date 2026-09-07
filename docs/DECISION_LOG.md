# DECISION_LOG.md — Outstanding Receivables Tracker

Status: living document · Started 2026-09-07 · Owner: Global Ops (Global_OPs@ohmyhotel.com)

Each phase records: decisions taken, evidence, and the risks that remain open at the end of the phase.

---

## Phase 1 — Discovery (2026-09-07)

### Findings

| # | Finding | Evidence | Classification |
|---|---------|----------|----------------|
| F1 | An Ellis MCP connector exists but is **not attached to the build session** (no `mcp__c849f32a…` tools in this session; not in the MCP registry). Live calls cannot be executed here. | ToolSearch, `list_connectors`, project MCP config | Blocked |
| F2 | The only Ellis MCP tool with production evidence is **`get_hotel_bookings`** (`dateBasis`, `fromDate`, `toDate`, `countryCode`, `limit`, `offset` → `{list|records, totalCount}`), pulled per country with `limit=500` to avoid upstream timeouts. | Existing daily automation in the REPORT project (`merge-ellis-pages.js`, `omh-daily-trend` skill) and 26,255 stored records | Confirmed |
| F3 | Booking record schema confirmed (31 fields). `baseCurrencyCode` is always **KRW**; `fxRate` is local→KRW. `paymentMethod` ∈ {Cash 84%, VCC 15%, Card 1%}. `bookingStatus` ∈ {Confirmed, Reserved, Cancelled, Cancelled(Replied), Pending, Unavailable, Cancel Request}. `guestName` is PII. **No seller ID, no seller country, no invoice/payment fields.** | Field profile of stored records (values masked) | Confirmed |
| F4 | No tool for invoices, payments, credit notes, customer master (credit limit, terms, owner), collection activities, snapshots or incremental queries could be confirmed. | Search of all local Ellis references | Required |
| F5 | The B2B System `ellis-mcp` design (10 rate-search tools) is a *proposal* that was later withdrawn; it is not a receivables source. | `docs/handoff/v3/README.md` in B2B System | Not applicable |
| F6 | GitHub push works for account `bstars00-rgb`; `gh` CLI is not installed; no Teams webhook and no AI API key exist in the environment. | `git ls-remote`, `where gh`, env | Environment |

### Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Build on a **pluggable `ReceivablesSource`**: `MockReceivablesSource` (deterministic) and `EllisMcpReceivablesSource` (live). The live adapter implements only the confirmed tool and throws `ToolNotConfirmedError` for everything else. | Honest boundary: no fabricated tools; swap-in without UI changes. |
| D2 | Provide a **bookings-derived mode** (`source: 'ellis-bookings-derived'`) that approximates receivables from post-paid Confirmed bookings, clearly labelled and with `completeness.payments = 'missing'`. | Lets the pipeline be exercised end-to-end against the real connector before ledger tools exist, without presenting it as actual AR. |
| D3 | Reporting currency default **USD** (per PRD), configurable via `REPORTING_CURRENCY`. Flag to Finance that Ellis base currency is KRW. | PRD requirement; KRW confirmed as Ellis base → open question Q-FIN-1. |
| D4 | Stack: React 18 + TypeScript + Vite 6, HashRouter, plain CSS; automation in TypeScript (`tsx`) on GitHub Actions; tests with Vitest + Playwright. | GitHub Pages compatible; single toolchain; no runtime secrets in frontend. |
| D5 | Frontend, data collection, AI analysis and Teams delivery are **separate layers**; GitHub Pages only serves static assets and (optionally) an aggregated, PII-free `tracker-model.json`. | PRD §2; GitHub Pages cannot call MCP or hold secrets. |
| D6 | Snapshot history is persisted to an orphan git branch `tracker-state` by the workflow (aggregates only). | Zero extra infrastructure; reproducible WoW comparisons. |

### Remaining risks after Phase 1
- R1 Live receivables data path depends on Ellis providing ledger/payment/customer tools (Required).
- R2 Transport/auth of the Ellis MCP endpoint is unknown; `HttpMcpClient` (Streamable HTTP JSON-RPC) may need replacing.
- R3 Seller identity is by name only in bookings; risk of duplicate customers across spellings.

---

## Phase 2 — Planning (2026-09-07)

### Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| D7 | Aging buckets: Current / 1–7 / 8–14 / 15–30 / 31–60 / 61–90 / 90+ with `aging_days = reference − due_date`; missing due date → `UNKNOWN` bucket + data-quality warning, never counted as overdue. | PRD §5; avoids silently inflating overdue. |
| D8 | Outstanding is **recomputed from components** (`original − paid − credit_note`), cancelled/written-off forced to 0, overpayment → unapplied cash, disputed capped at outstanding and kept inside total but tracked separately. | Prevents credit notes, cancellations and overpayments from distorting totals. |
| D9 | **Report week** = day after previous snapshot → reference date (7 days when the cadence holds). Collected = applied payments in the week; New/Resolved overdue computed against the previous snapshot's per-invoice state. | Exact, auditable WoW without relying on the source for history. |
| D10 | Risk Score weights exactly as PRD (25/20/15/10/10/10/5/5); amount thresholds `[2k,10k,25k,75k]` in reporting currency; **materiality** floor 100; credit status ON_HOLD/SUSPENDED adds points; every factor returns evidence text shown in the UI. | Explainability requirement; keeps large-but-current customers Low. |
| D11 | At-Risk Amount = union of 30+ overdue, disputed, and all open invoices of customers with broken promise or exceeded limit (no double counting). | PRD lists KPI without formula; defined explicitly and documented. |
| D12 | AI receives a **number-only structured input** (`InsightInput`) and must return the PRD JSON. Every number/name is verified against the input; unverifiable items are removed; rule-based generator is the fallback and the mock provider. | PRD §8 anti-hallucination rules. |
| D13 | Teams: Adaptive Card 1.4 via Workflows webhook + Markdown fallback (≤3,500 chars, budget-aware trimming). Idempotency key `weekly-outstanding:<date>:<channel>`. DRY_RUN defaults to **true**; leaders channel requires explicit `TARGET_CHANNEL=leaders` and `DRY_RUN=false`. | PRD §9–10 safety. |
| D14 | Schedule: cron `0 2 * * 6` (Saturday 02:00 UTC = 09:00 Asia/Ho_Chi_Minh, no DST). Retry once after 2 minutes; then fail the job and alert admin. | PRD §2D. |

### Remaining risks after Phase 2
- R4 Weight calibration is a first proposal; Finance should review grades against known accounts.
- R5 Adaptive Card rendering in Teams mobile not yet visually verified (needs a webhook).

---

## Phase 3 — Prototype (2026-09-07)

### Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| D15 | Mock dataset: 34 fictional customers / 182 invoices / 65 payments / 12 activities, 12 weekly snapshots derived by `datasetAsOf()` (rewinding payments/activities) with deterministic FX drift. All 15 required scenarios are named customers. | Deterministic tests; visible FX effect; no PII. |
| D16 | Mock mode computes everything in the browser (no network); live mode loads the pipeline's published `tracker-model.json` + `insight.json`. | Static hosting constraint. |
| D17 | Action Board completion status stored in `localStorage` (prototype only), clearly labelled. | No backend in prototype; documented as future backend requirement. |

### Remaining risks after Phase 3
- R6 Frontend E2E coverage and mobile checks pending Phase 5.

---

## Phase 4 — Integration (2026-09-07)

### Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| D18 | Live AI provider: Anthropic SDK, model `claude-opus-5`, adaptive thinking, structured output (`zodOutputFormat`), effort medium, timeout 120 s. Only used when `AI_PROVIDER=claude` and `AI_API_KEY` is set. | Skill guidance for current API; schema-validated JSON. |
| D19 | Live FX for the bookings-derived mode uses the illustrative table until a treasury/ECB feed is wired (flagged in `completeness.notes`). | Required item Q-FIN-2; avoids silent wrong conversions by labelling. |
| D20 | Published frontend data is stripped by `publicModel()` (activity notes redacted, payment references removed). | Data minimisation. |

### Remaining risks after Phase 4
- R7 Live Ellis, Teams and Claude paths are covered by contract tests with fakes only (Blocked externally).

---

## Phase 5 — Verification (2026-09-07)

| ID | Decision | Rationale |
|----|----------|-----------|
| D21 | Upgraded to vitest 3.2 (`test.projects`) instead of keeping a type cast; installed the Playwright Chromium build matching `@playwright/test` 1.63. | Reproducible `npm run typecheck` / `npm run test:e2e` on a clean machine. |
| D22 | Added `unknown_due_reporting` to the model and surfaced it on the Aging screen so Σ buckets + unknown = Total Outstanding. | Reconciliation defect found in visual QA (D-01). |
| D23 | Verification whitelist extended with aging-bucket boundary numbers only; amounts/names remain strictly checked. | Prevented a false positive without weakening anti-hallucination. |
| D24 | Scores reported twice (mock/contract 97, live 86 Blocked) rather than inflating live readiness. | PRD §15 rule on external dependencies. |
| D25 | Snapshot state is git-ignored in `main` and lives only on the `tracker-state` branch written by the workflow. | Keeps the code branch free of data artefacts. |

| D26 | Landing page made private with a **client-side password gate** (PBKDF2-SHA256, 150k iterations, salted; only the hash is embedded via `VITE_GATE_HASH`; sessions in session/local storage; Lock button; rotation invalidates sessions). Documented as an access deterrent, not authentication. | User request (2026-09-07). GitHub Pages has no server-side auth on the free plan; true protection of real data still requires a private origin (`SECURITY.md` addendum). |

Results and remaining risks: `docs/QA_REPORT.md`.
