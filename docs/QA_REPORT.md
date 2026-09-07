# QA_REPORT.md — Planning Review & QA Review

Status: Final for prototype v0.1 · 2026-09-07 · Evaluator: build session (self-assessment, evidence-based)

Scores are given twice where external dependencies block real verification:
- **Mock / contract scope** — what was actually executed in this environment (mock data, fakes for MCP / webhook / model).
- **Live scope** — what would be needed for production; items that could not be executed are marked **Blocked** and are *not* counted as passed.

Pass criteria (PRD §15): Planning ≥ 96, QA ≥ 96, 0 Critical/High open defects, 0 open defects in automation / calculation / credential handling, main flows E2E-passed, nothing marked passed without verification.

---

## Evidence base (final run, 2026-09-07)

| Check | Command | Result |
|-------|---------|--------|
| Type check (app + automation) | `npm run typecheck` | pass |
| Unit + integration | `npx vitest run` | **80 passed / 0 failed** (10 files: calc, risk, mock-data, insight, teams-message, infra, KpiCard, CustomersPage, pipeline, adapters) |
| Production build | `npm run build` | pass (777 KB `dist/`, recharts chunk warning only) |
| Secret scan of bundle | grep for `sk-ant-`, `webhook.office.com`, `logic.azure.com`, env names | clean |
| E2E desktop + mobile (Pixel 5) | `npx playwright test` | **28 passed, 2 skipped (mobile-only specs on desktop project), 0 failed** |
| Pipeline CLI dry run (mock) | `npm run report:weekly:dry` | 13 steps logged, 12 snapshots persisted, card + markdown + insight written, exit 0 |
| Workflow YAML | parsed with PyYAML | both workflows valid (jobs `report`; `build`,`deploy`) |
| GitHub Pages deploy | push to `bstars00-rgb/Outstanding-Tracker`, run 34077262767 | **success**; https://bstars00-rgb.github.io/Outstanding-Tracker/ returns HTTP 200; mock overview and customer detail verified in browser. Weekly report workflow not yet executed on Actions (needs a manual `dry_run=true` run) |
| Visual review | Browser pane 1440×900 and 375×812 | Overview, Aging, Customer detail, Insights, Actions, Invoices reviewed; two defects found and fixed (see Iteration 2) |

---

## Iteration 1 — first full evaluation (after prototype assembly)

Planning Score: 94 · QA Score (mock/contract): 90 · QA Score (live): 85

Failed Criteria:
- P-4 Ellis mapping (−2): assumption list existed but no numbered question list for the Ellis team.
- Q-1 Functionality (−2): Aging page header total (bucket sum) did not reconcile with Total Outstanding when an invoice lacks a due date (USD 6,800 gap in mock).
- Q-5 AI verification (−2): rule-based sentence "90+ days" was flagged as an unverified number (false positive) → sanitisation would have removed a correct sentence.
- Q-4 Teams (−1): Markdown fallback exceeded 3,500 chars and was cut mid-footer (data timestamp lost).
- Q-7 UI (−1): partial-data banner consumed most of the mobile viewport.
- Q-9 Deploy reproducibility (−2): `npm run typecheck` failed on `vitest.config.ts` (vitest 2 bundled vite 5 types vs vite 6); Playwright browser build for the installed version missing.

Root Cause:
- Bucket totals exclude `UNKNOWN`; the page summed buckets instead of using the snapshot total.
- Number extractor treated bucket labels as amounts.
- Markdown assembled without a budget-aware trimmer.
- vitest 2.x depends on vite 5; `@playwright/test` resolved to 1.63 while browsers on disk were 1.34-era builds.

Changes Made:
- `TrackerModel.unknown_due_reporting` added; Aging page uses snapshot total and shows the unknown-due note with a drill-down link.
- `verify.ts`: bucket boundary numbers (61/90/91/100) whitelisted; still rejects any fabricated amount / name.
- `message-builder.ts`: priority-based trimming (KPI lines, links, footer never dropped); CEO decisions deduped per customer; attribution sentence handles >100% share.
- vitest upgraded to 3.2 (`test.projects`), type cast removed; `npx playwright install chromium`.
- `ELLIS_MCP_MAPPING.md` §5: 14 numbered questions; `OPEN_QUESTIONS.md` consolidated.

Tests Added: `calc.test.ts` reconciliation assertion (Σ buckets + unknown = total); `insight.test.ts` hallucination/sanitisation cases; `teams-message.test.ts` length + footer + no-invoice-number checks; E2E states/mobile specs.

Regression Results: 80/80 unit+integration, 28/28 E2E, build + typecheck pass.

Remaining Risks: live Ellis / Teams / Claude paths unexecuted (external), no axe accessibility audit.

Next Iteration Priority: re-score after fixes; confirm visual fixes in browser.

---

## Iteration 2 — final evaluation

### Planning Score: **96 / 100**

| Criterion | Max | Score | Basis / deductions |
|-----------|-----|-------|--------------------|
| Business goal coverage | 15 | 15 | All PRD purposes mapped to screens + report (PRD §1); CEO summary needs no drill-down |
| User roles & workflows | 10 | 10 | 6 personas with flows in `PRODUCT_REQUIREMENTS.md` §2–3 |
| Metric & calculation definitions | 15 | 15 | Every formula in `DATA_DICTIONARY.md` §5 and covered by unit tests |
| Ellis MCP data mapping | 15 | 13 | Confirmed/Assumed/Required complete; **−2**: invoice/payment/customer fields remain assumptions until Ellis answers Q1–Q14 |
| Automated delivery design | 10 | 10 | Schedule, DRY_RUN, channel split, idempotency, retry, alert, state branch |
| AI insight effectiveness | 10 | 9 | Number-only input, JSON contract, verification/fallback; **−1**: rule-based prose is templated; live-model quality unmeasured |
| Security & permissions | 10 | 9 | Secrets, redaction, PII drop, data minimisation, go-live checklist; **−1**: no viewer authentication on the static site (documented mitigation only) |
| Exception design | 10 | 10 | Data-refresh failure card, validation gate, AI fallback, send retry, duplicate protection, partial/empty/error states |
| Documentation completeness | 5 | 5 | 10 documents + samples + README |

### QA Score

| Criterion | Max | Mock / contract scope | Live scope | Basis |
|-----------|-----|-----------------------|-----------|-------|
| Functional behaviour | 20 | 19 | 19 | All 6 screens + detail work in E2E; **−1**: no dedicated per-invoice route (filter link used) |
| Calculation accuracy | 20 | 20 | 20 | 24 calc/risk assertions incl. boundaries, credit notes, cancellations, overpayment, FX effect, new/resolved overdue, promises, reconciliation |
| MCP / mock adapter | 10 | 10 | 6 | Mock fully verified; live adapter contract-tested with a fake MCP (pagination, dedupe, PII drop, JSON-RPC, error) — **Blocked**: no live endpoint/tool list |
| Teams automation | 10 | 10 | 6 | DRY_RUN, idempotency, failure card, admin alert, retry/backoff verified with fakes; payload matches Workflows template — **Blocked**: no webhook, card rendering on Teams mobile unverified |
| AI number verification / anti-hallucination | 10 | 10 | 8 | Fabricated amounts, unknown customers/owners detected; sanitisation and fallback tested — **Blocked**: live model not invoked (no key) |
| Security check | 10 | 10 | 10 | Bundle scan clean, redaction tests, env guards refuse live sends without secrets, no PII fields in model, `.env.example` only |
| UI / responsive / accessibility | 10 | 9 | 9 | Desktop + mobile E2E (no horizontal overflow), table alternative for every chart, status text + icon, focus styles; **−1**: no automated axe audit |
| Error / empty / partial handling | 5 | 5 | 5 | E2E for error, empty, loading, partial, live-not-published |
| Deployment reproducibility | 5 | 5 | 4 | Pages workflow executed on GitHub Actions (typecheck + tests + build + bundle guard + deploy: success); **−1 live**: weekly report workflow not yet run on Actions |
| **Total** | **100** | **98** | **87** |

### Defects

| ID | Severity | Status | Description |
|----|----------|--------|-------------|
| D-01 | Medium | Fixed | Aging total ≠ Total Outstanding when due date missing |
| D-02 | Medium | Fixed | "90+ days" false positive in AI number verification |
| D-03 | Low | Fixed | Markdown fallback truncated footer |
| D-04 | Low | Fixed | Partial banner too tall on mobile |
| D-05 | Low | Fixed | vitest/vite type mismatch broke `npm run typecheck` |
| D-06 | Low | Open (documented) | No per-invoice detail route; invoice detail via filtered list + expandable row |
| — | Critical / High | **0 open** | |

### Pass / fail against PRD §15

| Condition | Result |
|-----------|--------|
| Planning ≥ 96 | **Pass (96)** |
| QA ≥ 96 | **Pass in mock/contract scope (98)** · **Not met in live scope (87) — Blocked, not failed**: Ellis MCP access, Teams webhook, AI key, GitHub repository are user-provided prerequisites (PRD §15 explicitly allows Blocked marking) |
| 0 Critical/High defects | Pass |
| 0 open defects in automation / calculation / credentials | Pass |
| Main user flows E2E | Pass (overview → each page, customer filter → detail → risk factors, aging → invoice drill-down, action status persistence, states, mobile) |
| Nothing unverified marked as passed | Pass — live items are marked Blocked |

### Blocked items and the exact unblock procedure

| Item | Needs | Command / step once available |
|------|-------|-------------------------------|
| Ellis MCP live | endpoint + auth, tool list confirmation | `DATA_SOURCE=ellis DRY_RUN=true ELLIS_MCP_ENDPOINT=… ELLIS_MCP_AUTH=… npx tsx automation/weekly-report.ts` → check `[3/13]` counts and `completeness` notes |
| Teams webhook | Workflows webhook URL for test channel | `TEAMS_SENDER=live DRY_RUN=false TARGET_CHANNEL=test TEAMS_TEST_WEBHOOK_URL=… npx tsx automation/weekly-report.ts`; verify card on desktop + mobile Teams |
| AI live | `AI_API_KEY` | `AI_PROVIDER=claude AI_API_KEY=… DRY_RUN=true npx tsx automation/weekly-report.ts` → check `[9/13] verification ok=true` and `fallback=false` |
| GitHub deploy | done 2026-09-07 | Deployed: https://bstars00-rgb.github.io/Outstanding-Tracker/#/?mode=mock |
| Saturday schedule | manual run on Actions | Actions → *Weekly Outstanding Report (Teams)* → Run workflow (`dry_run=true`, `data_source=mock`) → artefacts contain `teams-message.json`; creates branch `tracker-state` |

### Remaining risks
- R-A Risk weights/thresholds are a first calibration; Finance review recommended before leaders channel go-live.
- R-B Live FX table is illustrative until a treasury/ECB feed is wired (flagged in report footer).
- R-C Bookings-derived live mode cannot show payments; overdue figures in that mode must not be used for decisions (labelled in UI and report).
- R-D Public Pages must stay on mock or behind access control (`SECURITY.md` §7).
