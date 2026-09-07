# Open Questions and Actions

**Purpose.** This document consolidates every unresolved question and pending action that blocks or degrades the Outstanding Receivables Tracker, grouped by the party that must answer: the Ellis team (source system), Finance, IT (Teams admin), and the GitHub admin, plus internal engineering follow-ups. Each item names an owner, explains why it matters and states the impact if it remains unanswered. Items reference the detailed documents (`ELLIS_MCP_MAPPING.md`, `ARCHITECTURE.md`, `SECURITY.md`, `TEAMS_MESSAGE_SPEC.md`, `AI_INSIGHT_SPEC.md`).

**Status:** Draft v0.1 — 2026-09-07

> **요약 (Korean summary).** 가장 큰 미결 사항은 Ellis 측 데이터입니다: 청구/미수 원장, 입금, 크레딧노트, 고객 마스터(ID·국가·여신한도·결제조건·담당자) 도구가 없으면 트래커는 "예약 기반 추정치"만 제공할 수 있고, 연체·수금 지표는 신뢰할 수 없습니다. 그 외 재무팀의 정의 확정(후불 결제 정의, 결제조건, 리스크 임계값, 보고 통화/환율 출처), IT의 Teams Webhook 3개 생성 및 채널 멤버 지정, GitHub 관리자의 시크릿 등록·비공개 저장소·워크플로 승인이 필요합니다.

### Priority legend

| Priority | Meaning |
| --- | --- |
| **P0** | Blocks any production use of live data or any send to leadership |
| **P1** | Live report would be misleading or incomplete without it |
| **P2** | Quality / operability improvement |

---

## 1. Ellis team (OhMyHotel Admin / MCP)

| # | Question / request | Why it matters | Impact if unanswered | Priority |
| --- | --- | --- | --- | --- |
| E1 | Provide (or confirm the name of) an **invoice / receivable ledger tool** — invoice id, number, customer id, invoice date, due date, amount, currency, status | Receivables must be reported from the ledger, not inferred from bookings | Live mode stays `ellis-bookings-derived`; invoice and due dates are assumptions (checkout, checkout + 14 d) | P0 |
| E2 | Provide a **payments / collections tool** — payment id, allocation to invoice, customer, date, amount, currency, method, applied/unapplied, reference | "Collected This Week", Overdue, New/Resolved Overdue, Broken Promise, forecast confidence all depend on payments | Every derived invoice appears open forever; overdue is overstated; forecast confidence stays `low`; `completeness.payments = missing` banner permanently on | P0 |
| E3 | Provide **credit notes** (invoice, amount, date) | Outstanding = original − paid − credit note | Credit-noted balances appear as overdue | P1 |
| E4 | Provide a **customer (seller) master**: stable seller **ID**, seller **country/region**, **credit limit** + currency, **payment terms**, **account owner**, credit status | Customer key, aging by country, risk factor "credit limit", due-date calculation, action routing | Customers keyed by name (spelling variants split a customer), country "Unknown", owner "Unassigned", credit factor always 0, terms guessed | P0 |
| E5 | Provide **dispute** data (disputed amount, reason, status) or confirm it lives elsewhere | Risk factor 8, `DISPUTE` action group, At-Risk Amount | Disputes invisible in the tracker | P1 |
| E6 | Confirm semantics of `paymentMethod`: is **"Cash" = post-paid on account**? Are **VCC / Card** fully settled at booking? | Core filter of the receivable population | Receivable population may be wrong in either direction | P0 |
| E7 | Confirm which `bookingStatus` values are **billable** and whether `Cancel Request` should be treated as cancelled (current regex treats it as cancelled) | Filters in `bookingsToDataset()` | Cancel-requested stays excluded prematurely or cancelled stays counted | P1 |
| E8 | Confirm accepted `dateBasis` values (`CHECK_OUT_DATE`?) | Pulling by checkout date would make the 120-day lookback exact | Bookings made > 120 days before a recent stay are missed | P1 |
| E9 | Provide **endpoint URL, transport (Streamable HTTP / SSE / REST), auth scheme, error response format** of the MCP server, and whether an `initialize` handshake is required | `HttpMcpClient` implements Streamable HTTP JSON-RPC `tools/list` + `tools/call` only | Live mode cannot run outside the claude.ai connector | P0 |
| E10 | Explain how **large results returned as files** are delivered | 500-row pages may arrive as a file reference instead of inline `list` | Pagination loop may fail on the first large page | P0 |
| E11 | **Rate limits** and **data refresh cadence** (when does Saturday 09:00 see Friday's bookings/payments?) | Scheduling, retry back-off, freshness statement in the footer | Throttling failures or reporting on stale data | P1 |
| E12 | Provide **historical snapshots or a changed-since (incremental) query** | WoW comparison and re-creation of a missed Saturday | Tracker must keep its own snapshots from day 1; no back-fill | P2 |
| E13 | Issue a **read-only service account** for the tracker; confirm whether `guestName` can be omitted server-side | Least privilege and PII minimisation | Shared personal credentials; guest PII transits unnecessarily | P0 |
| E14 | Confirm whether reporting should be in **KRW** (so `fxRate` local → KRW can be used) or provide FX rates to the reporting currency | Multi-currency totals and FX effect | Illustrative FX table in production | P0 |

## 2. Finance

| # | Question / decision | Why it matters | Impact if unanswered | Priority |
| --- | --- | --- | --- | --- |
| F1 | Confirm the **reporting currency** (default now `JPY`, per management 2026-09-07) and the **FX rate source** (treasury / ECB / Ellis KRW rates) | All `*_reporting` figures and the FX effect | Figures cannot be shown to leadership | P0 |
| F2 | Confirm **standard payment terms** per customer / default (currently assumed **14 days** after checkout) | Due date, aging, every overdue KPI | Overdue is mis-stated for customers on 7/30/45-day terms | P0 |
| F3 | Validate the **Risk Score** weights (25/20/15/10/10/10/5/5), amount thresholds (2 k / 10 k / 25 k / 75 k), materiality (100) and grade thresholds (30/50/70/85) | Drives ESCALATE actions and CEO decisions | Escalations may be too aggressive or too lenient | P1 |
| F4 | Confirm **action deadlines** (Monday 12:00 for urgent, +4 days otherwise) and the recommended-action wording | Owner accountability | Deadlines ignored | P2 |
| F5 | Define the **collection activity capture** process: who logs calls/promises/disputes, where (tracker-owned store vs CRM), and the required fields | Risk factors 5, 7, 8 and the Action Board need activities | Broken-promise and no-activity signals are permanently empty in live mode | P1 |
| F6 | Confirm treatment of **unapplied cash / overpayments** (currently reported separately, never netted against other invoices) and **write-offs** | Totals interpretation | Misread of "unapplied cash" line | P2 |
| F7 | Decide whether **disputed amounts** stay in Overdue (current) or are excluded | KPI interpretation | Disagreement on overdue totals | P2 |
| F8 | Nominate the **reviewer** for the first supervised test-channel report and the go-live approver | Go-live gate | No formal sign-off | P0 |
| F9 | Confirm **customer master ownership** for fields Ellis cannot provide (credit limit, owner, terms, credit status) — Finance-maintained file vs Ellis enhancement | Data governance | Duplicate or stale master data | P1 |

## 3. IT — Microsoft Teams admin

| # | Action | Why it matters | Impact if unanswered | Priority |
| --- | --- | --- | --- | --- |
| T1 | Create the **three Workflows webhooks** ("Post to a channel when a webhook request is received") for Test, Leaders and Admin channels using a **team-owned account**; hand URLs to the GitHub admin for Secrets | Delivery channel for the report and alerts | No sends possible (`TEAMS_SENDER=live` cannot be enabled) | P0 |
| T2 | Confirm channel **membership**: Leaders channel = CEO, Finance Leader, GSM Leader, Sales Leaders, Collection Leader (per `RECIPIENT_CONFIG.roles`) | Confidential balances reach only intended readers | Over-exposure of receivables | P0 |
| T3 | Confirm that Adaptive Card v1.4 with `msteams.width = Full` renders in the tenant (desktop + mobile) | Card layout | Fallback to Markdown only | P1 |
| T4 | Webhook **rotation procedure** and owner on staff change | Leak response | Stale, uncontrolled URLs | P1 |
| T5 | (Future) Assess **Graph API** app registration with `ChannelMessage.Send` / `Chat.ReadWrite` for per-user delivery | Role-specific messages | Not needed for v1 | P2 |

## 4. GitHub admin

| # | Action | Why it matters | Impact if unanswered | Priority |
| --- | --- | --- | --- | --- |
| G1 | Create the repository (**private**) under the organisation, or confirm use of `bstars00-rgb`'s account (pushes already work from this machine via credential manager; `gh` CLI is not installed) | Hosting for code, Actions and state | No CI / scheduler | P0 |
| G2 | Register **GitHub Secrets**: `ELLIS_MCP_ENDPOINT`, `ELLIS_MCP_AUTH`, `TEAMS_WEBHOOK_URL`, `TEAMS_TEST_WEBHOOK_URL`, `TEAMS_ADMIN_WEBHOOK_URL`, `AI_API_KEY` | Pipeline configuration | Live components cannot start (`loadEnv()` guard rails) | P0 |
| G3 | Decide the **GitHub Pages** setup: private repo with access-restricted Pages (Enterprise) **or** public Pages with mock data only + protected `VITE_LIVE_DATA_URL` endpoint | Confidentiality of customer balances | Real balances could be published publicly | P0 |
| G4 | Enable **branch protection** on `main` and required review for `.github/workflows/**` | Prevent secret exfiltration via workflow edits | Security gap | P1 |
| G5 | Confirm the implemented **state persistence**: orphan branch `tracker-state` force-pushed by the workflow (aggregates + receipts, no PII) and 30-day artifact retention; the branch inherits repository visibility | WoW comparisons and idempotency require persisted snapshots/receipts | If the branch is deleted or the repo is public, history is lost or exposed | P1 |
| G6 | Confirm GitHub-hosted runners can reach the Ellis MCP endpoint (or provide a self-hosted runner) | Deployment option 1 vs 2/3 | Fallback to Cloudflare Workers or on-prem | P0 |
| G7 | Enable **Dependabot** security updates | Supply-chain hygiene | Unpatched dependencies | P2 |

## 5. Engineering follow-ups (internal)

| # | Item | Reference | Status / priority |
| --- | --- | --- | --- |
| X1 | `.github/workflows/weekly-report.yml` (cron `0 2 * * 6`, dispatch inputs, retry after 2 min, `tracker-state` persistence, artifact upload) and `deploy-pages.yml` | `ARCHITECTURE.md` §3.1 | **Done** — first run on GitHub still pending (P0) |
| X2 | `.env.example` with all variables and placeholders | `SECURITY.md` §2 | **Done** |
| X3 | Frontend (`src/app`): 6 screens, mode toggle, reference-date selector, skeleton/empty/error/partial states, chart/table toggles, Action Board `localStorage` | `PRODUCT_REQUIREMENTS.md` §4, §8 | **Done** — QA report (`docs/QA_REPORT.md`, referenced by README) not yet present (P1) |
| X4 | Unit / integration / e2e tests | `vitest.workspace.ts`, `playwright.config.ts` | **Done** — ~65 unit, ~15 integration, 15 e2e tests; keep adding cases for live-mode error paths (P2) |
| X5 | Replace the illustrative FX table in `buildDeps()` with the approved feed (F1 / E14) | `ELLIS_MCP_MAPPING.md` §2.2 | P0 |
| X6 | Add per-page retry on `McpTransportError.retryable` inside `fetchBookings()` and handle file-returned results (E10) | `ELLIS_MCP_MAPPING.md` §4 | P1 |
| X7 | Whitelist bucket labels in `isAllowed()` | `AI_INSIGHT_SPEC.md` §5.6 | **Done** (`BUCKET_BOUNDARIES`) |
| X8 | Keep Markdown within 3 500 chars without mid-sentence cuts | `TEAMS_MESSAGE_SPEC.md` §3 | **Done** (priority-based trimming) |
| X9 | Run the live Claude provider once in dry run and archive the verification report and cost | `AI_INSIGHT_SPEC.md` §9 | P1 |
| X10 | Add an explicit `healthCheck` step before the fetch so a missing `get_hotel_bookings` tool fails fast with a clear reason | `live-adapter.ts` | P2 |
| X11 | Extend the Pages bundle guard with the Ellis endpoint host pattern once known | `deploy-pages.yml` | P2 |

---

## 6. Decision log

Decisions are recorded in `docs/DECISION_LOG.md` (phases 1–5). Items in this document that are answered should be moved there with date and decider.
