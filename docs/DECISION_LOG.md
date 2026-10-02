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
| D3 | ~~Reporting currency default USD (per PRD)~~ **Superseded by D27: default is JPY** (company default currency, management 2026-09-07), configurable via `REPORTING_CURRENCY`. Ellis base currency remains KRW (cross-rate). | PRD said USD; management confirmed JPY. |
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

| D27 | **Company default currency = JPY.** `REPORTING_CURRENCY` default changed to JPY everywhere (env, workflow, mock FX table now cross-rated via USD, risk amount thresholds defined in USD and scaled to the reporting currency with the FX table). Customer screens show original-currency balances (`CustomerRisk.totals_by_currency`) next to the JPY equivalent. | User instruction 2026-09-07: "회사 디폴트 화폐는 엔화". |
| D28 | **Bilingual engine text (en/ko)**: `buildTrackerModel({lang})`, `computeRiskScore(.., lang)`, `buildActions(.., lang)`, `generateRuleBasedInsight(input, lang)`, Teams card headings/footer, `REPORT_LANGUAGE` (default `ko`). Numbers never change with language. UI language toggle + dark mode delivered in the frontend. | User request 2026-09-07 ("한국어와 다크모드"). |
| D29 | Developer-facing spec for the receivables MCP tools written: `docs/ELLIS_MCP_RECEIVABLES_SPEC_FOR_DEV.md` (5 read-only tools, common contract, currency rules, acceptance tests). | User request 2026-09-07. |

| D30 | **ELLIS Playbook read (2026-09-07)**: Seller Invoice / Payment In/Out / Traders / Applied Exchange Rate identified as the receivables sources; entity types + mapping (`ellis-entities.ts`) and capability discovery in the live adapter added; developer spec rewritten with the Playbook field names; Credit Note modelled as "no entity, Compensation adjusts principal"; overdue derived from Due Date. | User request: derive fields/types from the Playbook. Playbook is a UI guide, so MCP/API names remain Required. |

| D31 | **CEO feedback (2026-09-07)**: (a) receivables split by managing entity — `Customer.control_company` (ELLIS Seller Invoice "Control"), `aging_by_control_company`, entity lines in the Teams card, "법인 미지정" bucket for migration gaps; (b) **ELLIS reflection chain** record → verify → reconcile with configurable owners/SLAs (`REFLECTION_CHAIN`, default Rina (Josh) → Sangho → Jackie): `Payment.confirmed_at` (PM CNFM) / `reconciled_at`, `reflection_queue`, action group `ELLIS_REFLECTION`, KPI totals `unverified_*` / `unreconciled_*`, card line "ELLIS reflection pending". ELLIS dev priority raised: `paymentConfirmDate` + `traderCompCode` on payments and `controlComp*` on invoices are P0. | Management request; separation of duties (recorder ≠ verifier ≠ reconciler). |

| D32 | **Daniel (ELLIS dev) confirmed feasibility (2026-09-22)**: tools delivered through a dedicated MCP layer (`stg-mcp.ohmytrip.com` / `mcp.ohmytrip.com`, Entra ID SSO, department access). Mapping decisions: `control_company` ← `list_channels.ownerCompCode/Name`; credit limit ← Deposit Type "Credit by company" + Deposit Amount (Finance to confirm); account owner ← CRM Trader PIC AM (GSM to confirm); Tier stays tracker config. **New risk R-E: unattended batch authentication** (SSO-only) — requested service-principal / token / export alternative. | Keep the weekly automation unattended; do not store personal SSO sessions in CI. |

| D33 | **Operating mode = manual run by Global Ops (2026-09-22)**: no unattended batch authentication will be requested from ELLIS. Added `DATA_SOURCE=file` (`FileReceivablesSource`: raw ELLIS tool export or tracker dataset JSON) and `docs/RUNBOOK_MANUAL_RUN.md`; the Saturday GitHub Actions schedule remains optional. R-E closed. | User decision ("무인 자동보고는 고려하지 않아도 돼. 내가 할거니까."). |

| D34 | **OMH SOP encoded in the engine (2026-09-28)**: `src/core/sop.ts` classifies every overdue invoice into L1–L4 (L1 = Tier 1 ≥ ¥1M → CEO within 24h; L4 < ¥100K monthly), routes approval by the ¥500K rule (CEO vs Local Director) and computes the Tier collection deadline (due date + 6/4/3 months, as the OP workbook computes it — the SOP text says "invoice month"). Bands the SOP leaves undefined (Tier 1 ¥500K–¥1M, Tier 2 > ¥500K) are treated as L2 and marked "assumed" in `rule`. L1 items create critical ESCALATE actions, CEO decisions in the insight and a "SOP urgency" line in the Teams card. Customer `tier` is optional master data (from the Tier sheet / tracker config). | First real weekly workbook (2026-09-28) showed the report would otherwise say "no CEO decision" while Tier-1 items ≥ ¥1M were overdue. |
| D35 | **Weekly OP workbook → tracker converter** (`automation/tools/excel_to_dataset.py`): the Outstanding / Tier / information sheets map to invoices, customers (PIC = owner, Tier), FX and payments parsed from the ELLIS remark notes. The workbook carries neither PM CNFM nor bank sign-off, so the reflection chain is not measurable from it: payments are marked verified and reconciled on their ELLIS record date ("not tracked", noted in completeness) rather than flooding the action board with 35 unverifiable reconcile tasks. Managing entity is not in the workbook. | Lets Global Ops run the pipeline from the workbook until the ELLIS MCP tools exist. |

| D36 | **Mock data removed from the product (2026-09-28)**: no mock mode in the app (single published-data path, `?mode=` ignored), no `DATA_SOURCE=mock` in the pipeline (default `file`), no invented FX fallback, `samples/` and the sample/mock scripts deleted, Saturday cron disabled (manual operation). The deterministic fictional dataset survives only as a test fixture under `tests/fixtures/` (unit/integration) and is published into `dist/data/` by Playwright's global setup for E2E. The deployed site shows a "No data published yet" state until real data is published (open question: encrypted publish vs. local-only). | User instruction ("목데이터는 삭제해줘. 이제 실제 데이터를 넣었으니까"). |

| D37 | **Encrypted publish (2026-09-28)**: real weekly output is deployed to GitHub Pages only as `public/data/bundle.enc.json` (AES-256-GCM; key derived from the gate password with a domain-separated PBKDF2 salt). The browser derives the key at unlock and stores only the derived key. Plaintext JSON never leaves the machine. Trade-off: security equals the password's guess-resistance (hash and ciphertext are public); a long passphrase is recommended. | User chose option 2 ("2번") over local-only preview and a paid private-Pages plan. |

| D38 | **Internal accounts excluded (2026-09-28)**: "Business Trip in Japan/KR/Vietnam" (employee travel, 출장) and "Unsold room (JP)" (hard-block unsold inventory) are internal ledgers, not customer receivables. The workbook converter drops them and records their balances in `completeness.notes` so the CEO report shows customer receivables only (this week: JPY 6.77M removed). "Meituan Japan" stays in (untiered, treatment unconfirmed). | Global Ops confirmation ("이건 내부용이야"). |

| D39 | **Reflection chain stage 0 "RECEIVED" (2026-10-02)**: `Payment.recorded_at = null` means the money is confirmed at the bank but ELLIS is not updated. Source: the OP workbook "Noted" column ("Payment received, waiting for AC update on ELLIS" / "... reopen for rate changing"). Such invoices count as collected in the tracker (real exposure), and the receipt sits in the reflection queue owned by the record owner; every RECEIVED item raises an ELLIS_REFLECTION action, the Teams card shows "입금 확인·ELLIS 미기록 N건", and a CEO decision is raised when any item is past the record SLA. The ELLIS-ledger total is kept in the data notes and the review workbook reconciles ledger = open + pending. Receipt dates are not in the note: this-week receipts use the report date, reopened invoices the earlier ELLIS record date, others the due date (flagged as assumed). | Week of 2026-10-02: ELLIS showed JPY 482.3M outstanding while JPY 481.6M (21 invoices) was already received — reporting the ledger figure would have escalated paid invoices to the CEO. |
| D40 | **ELLIS MCP `list_channels` is the source for managing entity and country (2026-10-02)**: `ownerCompCode` 110000/120000/130000/160000 → OMH Korea/Japan/Vietnam/Singapore, `countryName` → customer country, joined by seller code from `automation/input/ellis-channels.json` (refreshed by the operator each week, git-ignored). The manual channel mapping (D-entity, 2026-09-28) remains the fallback and matched ELLIS for every channel in this week's report. | First settlement-side MCP tools became available (list_channels, get_channel, get_settlement); invoice/payment-level tools are still pending. |
| D41 | **Confirmed PIC assignments override the workbook Tier sheet (2026-10-02)**: `automation/config/pic-overrides.json` holds the owners confirmed by Global Ops on 2026-09-28. The 10-02 workbook's Tier sheet had reverted to the earlier PICs (old template); the tracker keeps the confirmed owners and lists the differences in the data notes. | Avoid silently undoing a user-confirmed change; delete an entry to follow the workbook again. |

| D42 | **Teams posting through Microsoft Graph (2026-10-02)**: the weekly card is posted to a Teams group chat with the delegated Graph API (`Chat.ReadWrite`, already admin-consented) instead of a Workflows webhook, reusing the Azure app registration and MSAL token cache shared with the REPORT / CRM tooling on the operator's PC (`automation/teams-graph/post-weekly.cjs`, mirrors the CRM `post-teams.js`). Targets are chat names in a git-ignored JSON; IDs are resolved at run time and masked in output. Safety: dry-run by default, one post per report date and target, test target before any prod target, stale-report guard, `--resend` for corrections. `npm run weekly -- … --push-teams` posts at the end of the run. The webhook sender stays available but is no longer the primary path. Channel posting is implemented as a branch that needs extra consent (ChannelMessage.Send, Channel.ReadBasic.All). | No webhook could be created without admin work, while Graph chat posting was already consented and proven in the CRM project. |

| D43 | **Teams target = group chat "Outstanding" only (2026-10-02)**: by operator decision the weekly card goes only to that chat (no test chat), so the test-first gate is waived through an explicit `requireTestFirst: false` in the local targets file (default stays `true`). First post: report 2026-10-02, verified by reading the message back through Graph; the duplicate guard then refused a second send. | User instruction ("Outstanding 채널에만 게시"). |

| D44 | **Standing weekly order (2026-10-02)**: "미수금 주간보고" / "주간보고" triggers the whole flow without confirmation — newest workbook in Downloads (`npm run weekly -- --latest <date> --push --push-teams`), site bundle push, one card to the "Outstanding" chat, verification, recap. Scope is limited to that; failures, layout changes, implausible totals, duplicates and interactive logins still stop for the operator. Procedure: `.claude/skills/weekly-outstanding/SKILL.md`. The publish password lives in the git-ignored `.env`. | User instruction ("다음주부터는 … 자동으로 업데이트 하고 게시"). |

| D45 | **Access password shown in the Teams card (2026-10-02)**: so the members of the "Outstanding" chat can open the tracker, the card carries the site password (`sharePassword: true` in the local targets file; value read from `DATA_PUBLISH_PASSWORD`, never logged, masked in dry-run previews; the script refuses to post if the option is on but the password is missing). Off by default in the example config. Consequence: everyone in that chat can decrypt the published bundle — rotate the gate password (and re-publish) when chat membership changes. The 10-02 card was re-posted with `--resend`. | User instruction ("비밀번호를 넣어서 게시"; confirmed: include it in the Teams post and re-post the corrected card). |

Results and remaining risks: `docs/QA_REPORT.md`.
