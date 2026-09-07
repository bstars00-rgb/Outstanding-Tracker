# Outstanding Receivables Tracker — Product Requirements (PRD)

**Purpose.** This document defines what the Outstanding Receivables Tracker prototype must do for OhMyHotel (B2B hotel-distribution platform): who uses it, which screens exist, how every KPI, risk score and action item is calculated, and which non-functional requirements and acceptance criteria apply. All calculation rules below are taken from the implemented engine in `src/core/` (`kpis.ts`, `risk.ts`, `actions.ts`, `calc.ts`, `aging.ts`); screen definitions are taken from the implemented frontend in `src/app/` (`App.tsx`, `pages/*`, `components/*`, `data/*`).

**Status:** Draft v0.1 — 2026-09-07

> **요약 (Korean summary).** 이 문서는 미수금(Outstanding Receivables) 트래커의 제품 요구사항입니다. 대상 사용자(CEO, GSM 총괄, 재무 총괄, 국가/지역 영업 리더, 고객 담당자, 수금 담당자), 6개 화면, 10개 KPI 정의, 리스크 점수(0–100, 8개 요인) 산식, 액션 보드 그룹, 비기능 요구사항과 인수 조건을 정의합니다. 모든 계산식은 실제 구현 코드(`src/core/`)에서 도출했습니다. Ellis(OhMyHotel Admin)에는 현재 예약 조회 도구만 확인되어 있어, 실데이터 모드에서는 "예약 기반 추정치"로 표시됩니다.

### Status legend

| Status | Meaning |
| --- | --- |
| **Confirmed** | Implemented in the code base and/or confirmed against the Ellis MCP connector |
| **Assumed** | Implemented on the basis of an explicit assumption (visible in code comments); must be validated |
| **Required** | Not implemented / not available yet; needed before production use |

---

## 1. Goals

| # | Goal | Success measure |
| --- | --- | --- |
| G1 | Give leadership one weekly, trustworthy view of outstanding receivables, overdue exposure and week-over-week (WoW) movement | Weekly Teams report delivered every Saturday 09:00 (Asia/Ho_Chi_Minh) with zero unverifiable numbers |
| G2 | Make collection work actionable: every overdue or soon-due balance is assigned to an owner with a concrete next step and deadline | Action Board covers 100 % of open invoices with aging > 0 or due within 7 days |
| G3 | Explain risk, not just report it: a deterministic 0–100 Customer Risk Score with visible evidence per factor | Every risk grade on the customer detail screen shows all 8 factors with evidence text |
| G4 | Separate real balance movement from FX movement in multi-currency portfolios | `fx_effect_reporting` shown next to WoW change of Total Outstanding |
| G5 | Never present stale or fabricated data as current | Pipeline sends a "Data refresh failed" message instead of figures when fetch/validation fails; AI text passes a numeric verification gate |
| G6 | Be honest about data completeness | Every screen and report shows `completeness` per entity and the data-source label (`mock`, `ellis-bookings-derived`, …) |

### Non-goals (prototype phase)

- Replacing the finance ledger or performing accounting entries.
- Writing anything back into Ellis.
- Per-user (DM) delivery in Teams (documented as a future option in `TEAMS_MESSAGE_SPEC.md`).
- Persisting Action Board status server-side (prototype uses `localStorage` only).

---

## 2. Personas

| Persona | Primary questions | Key screens | Cadence |
| --- | --- | --- | --- |
| **CEO** | How much is outstanding and overdue? What changed this week? Which decisions need me (credit hold, limit change, legal path)? | Executive Overview, Insights, Teams report §4 "CEO Decision Required" | Weekly (Saturday report), ad hoc |
| **GSM head** (Global Sales & Marketing) | Which markets/owners are deteriorating? Who is not following up? | Executive Overview, Aging (by country / owner), Customers | Weekly |
| **Finance head** | Overdue ratio, 30+/90+ exposure, disputes, credit notes, unapplied cash, FX effect; approval of exceptions | Executive Overview, Aging, Invoices, Customer detail, Insights | Weekly + month-end |
| **Country / regional Sales leaders** | Which of my accounts are at risk? What did my team promise and miss? | Aging (by country), Customers filtered by country/owner, Action Board (ESCALATE) | Weekly |
| **Customer account owners** | What do I need to do today for my accounts? Which invoices fall due this week? | Action Board (filtered by owner), Customer detail, Invoices | Daily |
| **Collection staff** | Which invoices to chase, in which order, with which message? Which disputes block payment? | Action Board, Invoices, Customer detail (activities, promises) | Daily |

---

## 3. User flows per persona

### 3.1 CEO — Saturday morning (mobile)

1. Opens the Teams message (Adaptive Card): §1 Executive Summary (6 facts + up to 3 sentences), §2 AI Insights, §3 Required Actions, §4 CEO Decision Required.
2. Taps **Open Tracker** → `#/` Executive Overview; reads KPI cards with WoW change and status colour.
3. Taps **Customer Risk** → `#/customers` sorted by risk score; opens one customer to see the evidence behind the grade.
4. Decides on items in §4 and replies in Teams (outside the tool).

### 3.2 Finance head — weekly review

1. `#/` → checks Overdue Ratio, 30+ / 90+ KPIs, At-Risk Amount, FX effect.
2. `#/aging` → aging matrix by bucket × country / owner / currency; toggles chart ↔ table.
3. `#/invoices` → filters `status=DISPUTED` / `status=PARTIALLY_PAID` / `status=CREDITED`, sorts by the credit-note or disputed column; opens the customer behind each line.
4. `#/insights` → reads `data_quality_warnings` and completeness; raises data issues with the Ellis team (see `OPEN_QUESTIONS.md`).

### 3.3 Sales leader — market review

1. `#/aging` filtered to own country → identifies customers with rising `previous_overdue → overdue`.
2. `#/customers?country=…` → "Sort by: WoW deterioration" (`wow_overdue_change_reporting`).
3. `#/actions` group **ESCALATE** and **CREDIT_LIMIT** → confirms owner and deadline; discusses with account owner.

### 3.4 Account owner / Collection staff — daily

1. `#/actions` → selects own name in the **Owner** filter and works groups top-down by severity: CONTACT_TODAY, PROMISE_OVERDUE, OVERDUE_30, OVERDUE_90, DISPUTE, DUE_3_DAYS, DUE_7_DAYS.
2. Marks items `in_progress` / `done` (persisted in `localStorage` in the prototype).
3. Opens `#/customers/:id` → sees invoices, payments, activities, open promise, next action; uses `recommended_action` text as the call script.

---

## 4. Screens

All routes use `HashRouter` (`#/…`) so the app can be served as a static site (GitHub Pages); unknown routes redirect to `#/`. Status: **Confirmed** — implemented in `src/app/` (`App.tsx`, `pages/*.tsx`, `components/*.tsx`, `data/*.ts`).

**Global layout (`components/Layout.tsx`):** left navigation (Executive Overview, Aging Analysis, Customer Risk, Invoice Detail, Collection Action Board, Weekly AI Insight); top bar with the **mode badge** (`MOCK DATA` amber / `LIVE` green, with tooltip), the **reference-date selector** (the 12 weekly Saturday dates in mock mode; disabled in live mode, which always shows the latest published week), reporting currency, `Data as of` (formatted in `Asia/Ho_Chi_Minh`), data-source label (`Mock generator (fictional data)`, `Ellis MCP`, `Ellis bookings (derived)`, `File import`), a **Switch to live / mock** button and **Refresh**; footer with source, last refresh, currency and compared-with snapshot.

**Data mode resolution (`data/mode.ts`):** `?mode=mock` or `?mode=live` in the URL (persisted) → `localStorage` key `ot.mode` → build-time `VITE_DATA_MODE` (default `mock`). Live mode fetches `tracker-model.json` and `insight.json` from `VITE_LIVE_DATA_URL` or `<base>/data/` and fails with "Live data not published yet. Run the weekly pipeline with PUBLISH_DATA=true or switch to mock mode" when absent. QA helpers: `?simulate=error`, `?simulate=empty`, `?simulate=slow`.

**Page states (`components/States.tsx`, `DataGate`):** route-specific skeleton while loading (overview / table / board / detail variants); error state ("Data could not be loaded") with **Retry** and, outside mock mode, **Switch to mock data**; empty state ("No invoices in this dataset") with Refresh; **partial** banner (any completeness ≠ `full`, data-quality `error`s, `completeness.notes`) shown above the page without blocking it.

### 4.1 `#/` — Executive Overview (`OverviewPage.tsx`)

| Element | Content (from `TrackerModel`) |
| --- | --- |
| Header | reporting week `week.start`–`week.end`, compared-with `previous_snapshot_date`, customer and invoice counts |
| KPI cards (10) | `KpiCard`: `label`, `value` (formatted by `unit`), WoW change with up/down/flat icon (`change`, `change_pct`), status pill (colour **and** text label), `interpretation`, `definition` as `title` tooltip and an "i" toggle that expands the definition inline |
| FX effect | banner when `fx_effect_reporting !== null`: amount attributable to exchange-rate changes, "rates as of `fx.as_of`" |
| Aging chart | `aging_by_bucket` this week vs last week (second series only when a previous snapshot exists), with table alternative (bucket, amount, share, previous) |
| Top risk | top 5 `customers[]` by `risk.score` then `overdue_reporting` |
| Deteriorated / improved | customers with `wow_overdue_change_reporting > 0` (largest first) / `< 0` (most improved first) |
| Insight excerpt | provider, model, verification status ("AI interprets computed data only") |

Filters: none (portfolio view). Sort: fixed.

### 4.2 `#/aging` — Aging Analysis (`AgingPage.tsx`)

| Element | Content |
| --- | --- |
| Header | open balance and reference date; hint that any bucket amount drills into the invoices behind it |
| Bucket view | `aging_by_bucket` rows with "Last week" series when `previous_snapshot_date` exists |
| Dimension switch | `aging_by_country`, `aging_by_owner`, `aging_by_customer` (top 15 by `total`), `aging_by_currency` |
| Matrix | rows = dimension `label`; columns = 7 buckets + `total` + `overdue` + `previous_overdue`; each bucket amount links to `#/invoices?bucket=…&country|owner|customer|currency=…` (`invoicesLink`) |
| Chart | stacked bar per row; table alternative via "Show as table" |

Filters: dimension. Sort: engine order (`overdue` desc then `total` desc; currency by `total` desc); customer dimension limited to top 15 by total.

### 4.3 `#/customers` — Customer Risk list (`CustomersPage.tsx`)

| Column | Field |
| --- | --- |
| Customer (+ region) | `customer_name`, `region` (link to detail; row click also navigates) |
| Country / Owner | `country`, `account_owner_name` ("Unassigned" when empty) |
| Total outstanding / Overdue / 30+ overdue / Disputed | `total_outstanding_reporting`, `overdue_reporting`, `overdue_30_plus_reporting`, `disputed_reporting` |
| Max aging days | `max_aging_days` |
| Credit utilization % | `credit_utilization` (n/a when no limit; highlighted when `credit_limit_exceeded`) |
| WoW change (overdue) | `wow_overdue_change_reporting` (signed, toned) |
| Last payment / Next promise | `last_payment_date`; `next_promise_date` + `next_promise_amount_reporting` |
| Promise broken | `promise_broken` pill (tooltip shows `broken_promise_amount_reporting`) |
| Risk score / Risk grade | `risk.score`, `risk.grade` badge |
| Recommended action | `recommended_action` |

Filters (URL parameters `country`, `region`, `owner`, `currency`, `q`, `bucket`, `grade` pre-fill the form): customer name / id search, country, region, owner, contract currency, aging bucket (customer has a balance in that bucket), risk grade, dispute yes/no, promise broken yes/no; Reset. Sort: "Sort by" selector — Risk score (default, desc), Overdue, Max aging days, WoW deterioration, Credit utilization — plus sortable column headers (`DataTable`). Summary line: "Showing N of M customers · sorted by …".

### 4.4 `#/customers/:id` — Customer detail (`CustomerDetailPage.tsx`)

| Section | Content |
| --- | --- |
| Header | name, country/region, owner, `contract_currency`, `credit_status`, `collection_status`, `recommended_action` |
| Risk panel | `risk.score`, `risk.grade` and **all 8 `risk.factors[]`** with `label`, `points` / `max_points`, `evidence` (0-point factors included) |
| Balance panel | totals and `bucket_totals` (7 buckets) |
| Invoices | all `invoices[]` of the customer sorted by `aging_days` desc: `invoice_number`, `invoice_date`, `service_date`, `due_date`, `aging_days`, `aging_bucket`, `original_amount` + `invoice_currency`, `paid_amount`, `credit_note_amount`, `disputed_amount`, `outstanding_amount`, `outstanding_reporting`, `exchange_rate` + `exchange_rate_date`, `invoice_status`, `dispute_status`, `cancellation_status` |
| Payments | `invoices[].payments[]`: `payment_date`, `payment_amount`, `applied_amount`, `unapplied_amount`, `payment_method`, `reconciliation_status` (`payment_reference` is `null` in published data) |
| Activities | de-duplicated `invoices[].activities[]`, newest first: `activity_date`, `activity_type`, `owner`, `contact_channel`, `note` (redacted in published data), `promised_payment_date`, `promised_payment_amount`, `next_action`, `next_action_date`, `escalation_level`, `completed` |
| Data quality | `data_quality[]` for this customer |

### 4.5 `#/invoices` — Invoice Detail (`InvoicesPage.tsx`)

Columns: Invoice #, Customer (+ country, link), owner, dates (`invoice_date`, `service_date`, `due_date`), `aging_days` / `aging_bucket`, original / paid / credit note / disputed / outstanding in `invoice_currency`, `outstanding_reporting` with a tooltip showing `exchange_rate_date` and the FX `source`, `invoice_status` pill, `dispute_status`, `promised_payment_date`, `next_action` / `next_action_date`, activities (newest first).

Filters are **URL parameters** so other screens can deep-link (`invoicesLink`): `customer`, `bucket`, `owner`, `country`, `status` (`invoice_status`), `currency`, `q` (invoice number or customer name); **Reset** clears them; the header lists active filters and the Σ outstanding of the filtered rows. Sort: sortable column headers, default `aging_days` desc.

### 4.6 `#/actions` — Collection Action Board (`ActionsPage.tsx`)

| Element | Content |
| --- | --- |
| Header | "N open actions worth X across 9 groups, generated from the tracker rules for `reference_date`" |
| Banner | "Status changes are stored in this browser only (prototype). They are not written back to Ellis and are not shared with other users." |
| Groups | `ACTION_GROUP_LABEL` order: Contact today, Due within 3 days, Due within 7 days, Promise date passed, 30+ days overdue, 90+ days overdue, Dispute to resolve, Credit limit exceeded, Leader escalation — each with open count |
| Item | `customer_name` (link), `invoice_id` (link to `#/invoices?customer=…&q=<invoice_number>`; absent for customer-level items), `owner`, `due_date`, `amount_reporting`, `recommended_action`, `severity` pill |
| Status | select Open / In progress / Done; persisted in `localStorage` key `ot.actions.<action id>` (ids are stable: `<GROUP>:<invoice_id|customer_id>`) |

Filters: Owner; "Done items: Show / Hide". Sort within a group: `due_date` asc, then `amount_reporting` desc.

### 4.7 `#/insights` — Weekly AI Insight (`InsightsPage.tsx`)

Renders `InsightResult`: header (week ending, compared with, provider), `executive_summary`, `major_changes`, `top_risks` (linked to customers), `collection_opportunities`, `owner_actions` grouped by owner (largest amount first), `ceo_decisions`, `forecast_next_week`, `data_quality_warnings`, country anomalies (overdue up > 10 % vs previous snapshot), aging by owner table, and provenance (`provider`, `model` or "n/a (deterministic rules)", `generated_at`, verification counts, `fallback_used`).

---

## 5. KPI list

Values come from `SnapshotTotals` via `buildKpis()` (`src/core/kpis.ts`). `definition` strings are copied verbatim from the code. Reporting currency is `REPORTING_CURRENCY` (default `USD`).

| Key | Label | Unit | Definition (verbatim) | Status rule |
| --- | --- | --- | --- | --- |
| `total_outstanding` | Total Outstanding | currency | Sum of outstanding_amount of all unsettled invoices (excluding cancelled and written-off), converted to reporting currency. | always `neutral` |
| `overdue_outstanding` | Overdue Outstanding | currency | Outstanding where due_date < reference date and outstanding_amount > 0. | `worseIfUp` with share thresholds warn 20 % / crit 35 % of total |
| `overdue_ratio` | Overdue Ratio | ratio | Overdue Outstanding / Total Outstanding. | ≥ 0.35 `critical`; ≥ 0.20 `warning`; = 0 `good`; else `neutral` |
| `due_within_7_days` | Due Within 7 Days | currency | Outstanding of invoices not yet overdue whose due_date is within the next 7 days. | always `neutral` |
| `collected_this_week` | Collected This Week | currency | Sum of applied_amount of payments dated inside the report week (unapplied cash excluded). | > 0 `good`; else `warning` |
| `new_overdue_this_week` | New Overdue This Week | currency | Outstanding of invoices that were not overdue in the previous snapshot and are overdue now. | 0 `good`; > 10 % of total `critical`; else `warning` |
| `overdue_30_plus` | 30+ Days Overdue | currency | Outstanding with aging_days > 30. | `worseIfUp` warn 10 % / crit 20 % |
| `overdue_90_plus` | 90+ Days Overdue | currency | Outstanding with aging_days > 90. | 0 `good`; else `worseIfUp` warn 3 % / crit 8 % |
| `broken_promises` | Broken Promises | currency | Promised amount not received by the promised_payment_date (uncompleted promise activities). | count 0 `good`; ≥ 3 customers `critical`; else `warning` |
| `at_risk_amount` | At-Risk Amount | currency | Union of: 30+ days overdue, disputed invoices, and all open invoices of customers with a broken promise or an exceeded credit limit. | `worseIfUp` warn 15 % / crit 30 % |

**`worseIfUp(cur, prev, shareWarn, shareCrit)`** (Confirmed): `share = cur / total_outstanding`; `critical` if `share ≥ shareCrit` or (`change_pct > 25 %` and `share ≥ shareWarn`); `warning` if `share ≥ shareWarn` or `change_pct > 10 %`; `good` if `cur = 0` or `change_pct < 0`; else `neutral`.

**WoW change** (Confirmed): `change = round2(cur − prev)`; `change_pct = change / |prev|` (4 decimals) when `prev ≠ 0`; `null` when `prev = 0` and `cur ≠ 0`; `0` when both are 0; both `null` when there is no previous snapshot. Each card also carries an `interpretation` sentence (e.g. "119 open invoices across 34 customers. +USD 368.5K (+30.4%) vs last week").

> **요약.** KPI 10개는 모두 `SnapshotTotals`에서 계산되며, 정의 문구는 코드와 동일합니다. 상태 색상은 절대 비율(연체율) 또는 "총 미수금 대비 비중 + 주간 증감"(`worseIfUp`)으로 판정합니다.

---

## 6. Customer Risk Score specification

Source: `src/core/risk.ts` (`computeRiskScore`, `DEFAULT_RISK_CONFIG`, `gradeFor`). Score = sum of factor points, clamped to 0–100. Deterministic; every factor returns `points`, `max_points`, `evidence`.

**Configuration (`DEFAULT_RISK_CONFIG`):** `amount_thresholds = [2 000, 10 000, 25 000, 75 000]` (reporting currency), `materiality_amount = 100`. "Material overdue" = `overdue_reporting ≥ 100`.

| # | Key | Label | Max | Points rule |
| --- | --- | --- | --- | --- |
| 1 | `aging` | Days overdue | 25 | Only when material overdue and `max_aging_days > 0`: ≤ 7 d → 5; ≤ 14 → 9; ≤ 30 → 13; ≤ 60 → 18; ≤ 90 → 22; > 90 → 25 |
| 2 | `overdue_amount` | Overdue amount | 20 | 0 if not material; `< 2 000` → 4; `< 10 000` → 8; `< 25 000` → 12; `< 75 000` → 16; else 20 |
| 3 | `over30_ratio` | 30+ days share of balance | 15 | `ratio = overdue_30_plus / total_outstanding` (0 when total = 0); `points = round(min(1, ratio / 0.5) × 15)` — i.e. 50 % share already gives full points |
| 4 | `wow_increase` | Week-over-week overdue growth | 10 | No previous snapshot → 0 ("No prior snapshot to compare"). `prev ≤ 0` and `cur ≥ 100` → 8 ("New overdue this week"). `prev > 0`: `growth = (cur − prev) / prev`; ≤ 0 → 0; < 10 % → 3; < 25 % → 6; < 50 % → 8; else 10 |
| 5 | `promise_broken` | Broken payment promise | 10 | `broken_promise_amount > 0` → 10 |
| 6 | `credit_limit` | Credit limit / credit status | 10 | `utilization > 1` → 10; `> 0.9` → 5; else 0; no limit on file → 0 ("No credit limit on file"). `credit_status = SUSPENDED` → at least 10; `ON_HOLD` → at least 5 |
| 7 | `no_activity` | No recent collection activity | 5 | Only when material overdue: no activity ever → 5; last activity > 14 d ago → 5; > 7 d → 2; else 0 |
| 8 | `dispute` | Unresolved dispute | 5 | `disputed_reporting > 0` → 5 |

Weights 25/20/15/10/10/10/5/5 = 100.

**Grade thresholds (`gradeFor`):** score ≥ 85 → **Critical**; ≥ 70 → **High**; ≥ 50 → **Medium**; ≥ 30 → **Watch**; else **Low**.

**Inputs to the score (from `calc.ts`)**: `overdue_reporting`, `total_outstanding_reporting`, `overdue_30_plus_reporting`, `max_aging_days`, `previous_overdue_reporting` (previous snapshot customer row; `0` if the customer was absent from the snapshot; `null` if no snapshot), `broken_promise_amount_reporting`, `credit_utilization`, `days_since_last_activity`, `disputed_reporting`, `credit_status`.

**Recommended action per customer (`recommendAction`, first match wins):** 90+ overdue → "Escalate to Finance leader; evaluate credit hold and legal/collection agency path"; promise broken → "Re-confirm payment date with customer today; escalate to Sales leader if no confirmation within 2 business days"; credit exceeded → "Credit limit exceeded: hold new bookings until balance is below limit or Finance approves exception"; 30+ overdue → "Send formal overdue notice and call decision maker this week; request payment plan"; disputed → "Resolve dispute with Operations/Finance; agree undisputed portion to be paid now"; any overdue → "Send payment reminder and confirm remittance date"; balance but no overdue → "No action required; monitor upcoming due dates"; else "No open balance".

> **요약.** 리스크 점수는 8개 요인(연체일수 25, 연체금액 20, 30일+ 비중 15, 주간 연체 증가 10, 약속 불이행 10, 여신한도/여신상태 10, 최근 수금활동 부재 5, 분쟁 5)의 합계이며, 85점 이상 Critical, 70 High, 50 Medium, 30 Watch, 그 미만 Low입니다. 모든 요인은 근거 문구(evidence)와 함께 화면에 표시됩니다.

---

## 7. Collection Action Board groups

Source: `src/core/actions.ts` (`buildActions`). Invoice-level items are evaluated **in priority order; an invoice appears in its highest-priority group only**. Customer-level items are added separately. `ref` = reference date.

| Priority | Group | Trigger (open invoice, `outstanding_amount > 0`) | `due_date` | Severity | Recommended action (template) |
| --- | --- | --- | --- | --- | --- |
| 1 | `DISPUTE` | `disputed_reporting > 0` and `dispute_status ∈ {OPEN, UNDER_REVIEW}` | ref + 5 | high | "Resolve dispute (<reason or 'reason not recorded'>); collect undisputed portion now" |
| 2 | `OVERDUE_90` | `aging_days > 90` | ref | critical | "Final notice; propose credit hold and agency/legal path to Finance leader" |
| 3 | `OVERDUE_30` | `aging_days > 30` | ref + 2 | high | "Formal overdue notice + call decision maker; agree payment plan" |
| 4 | `PROMISE_OVERDUE` | open `promised_payment_date < ref` | ref + 1 | high | "Promise <date> missed; re-confirm remittance date by Monday 12:00" |
| 5 | `CONTACT_TODAY` | `aging_days > 0` | ref | high if aging > 14, else medium | "Overdue <n> day(s); send reminder and confirm payment date" |
| 6 | `DUE_3_DAYS` | 0 ≤ days until due ≤ 3 | invoice `due_date` | medium | "Pre-due courtesy reminder with remittance details" |
| 7 | `DUE_7_DAYS` | 3 < days until due ≤ 7 | invoice `due_date` | low | "Confirm invoice received and approved for payment" |
| 8 | `CONTACT_TODAY` (id prefix `NEXT_ACTION:`) | `next_action_date ≤ ref` and `next_action` set | `next_action_date` | medium | the recorded `next_action` |

Customer-level items:

| Group | Trigger | `due_date` | Severity | Amount | Recommended action |
| --- | --- | --- | --- | --- | --- |
| `CREDIT_LIMIT` | `credit_limit_exceeded` | ref | high | `total_outstanding_reporting` | "Utilization <n>%: hold new bookings or obtain Finance exception approval" |
| `ESCALATE` | `risk.grade = Critical`, or (`High` and `promise_broken`), or `overdue_90_plus_reporting > 0` | ref + 2 | critical | `overdue_reporting` | "Risk <grade> (<score>/100): leader review of credit terms and collection strategy" |

Item `id` format: `<GROUP>:<invoice_id>` or `<GROUP>:<customer_id>` (stable across runs → usable as the `localStorage` key). Owner = customer `account_owner_name`, falling back to invoice `owner`. Output sorted by severity (critical → high → medium → low) then `amount_reporting` desc.

---

## 8. Non-functional requirements

| Area | Requirement | Status |
| --- | --- | --- |
| **States** | `DataGate` renders skeleton (route-specific), error (Retry / Switch to mock data), empty ("No invoices in this dataset") and **partial** banner (completeness ≠ full, data-quality errors, notes) for every page; `?simulate=error|empty|slow` for QA | Confirmed (`components/States.tsx`) |
| **Mock / live** | `?mode=mock` uses the deterministic generator in the browser (`MockReceivablesSource`, seed `20260905`, 34 customers / 182 invoices, 12 weekly snapshots); `?mode=live` loads `tracker-model.json` + `insight.json` from `VITE_LIVE_DATA_URL` or `<base>/data/`; choice persisted in `localStorage` (`ot.mode`), default from `VITE_DATA_MODE` | Confirmed |
| **Reference date** | Selector across the 12 Saturday snapshots (`weeklyDates`) in mock mode; recomputation client-side via `buildTrackerModel` (`data/mock-model.ts`); disabled in live mode | Confirmed |
| **Charts** | Each chart (Recharts) is wrapped in `ChartWithTable`: `role="img"` + label, and a `<details>` "Show as table" with the same rows | Confirmed |
| **Accessibility** | Keyboard navigable (`NavLink`, native `<select>`/`<details>`), status pills carry colour **and** text/icon, KPI cards expose `aria-labelledby`, definition button with `aria-expanded`/`aria-controls`, error state `role="alert"`, tables with captions; WCAG AA contrast to be verified by axe (see AC-14) | Confirmed (structure) / Required (audit) |
| **Responsive** | Usable at 375 px width (Playwright project `mobile-chromium`, Pixel 5, `tests/e2e/mobile.spec.ts`) and desktop (`desktop-chromium`) | Confirmed |
| **Formatting** | `formatMoney`: `CCY 1,234.56`; zero-decimal currencies (`JPY KRW VND IDR TWD`) without decimals; compact `1.23M` / `12.3K`; signed `+`/`−`. `formatPct`: 1 decimal, `n/a` when null. Dates ISO `YYYY-MM-DD`; timestamps in `REPORT_TIMEZONE` via `formatInTimeZone` | Confirmed (`src/core/money.ts`, `dates.ts`) |
| **Multi-currency** | Original amount and currency always shown next to reporting amount; `exchange_rate` and `exchange_rate_date` visible on hover/table; invoices without an FX rate excluded from totals with a `MISSING_FX_RATE` warning | Confirmed (engine) |
| **Performance** | Mock model (34 customers / 182 invoices) computes in well under 1 s in the browser; live dataset expected ≤ 10 k invoice lines per run | Assumed |
| **Determinism** | Same dataset + reference date + previous snapshot → identical model (no randomness in engine) | Confirmed |
| **Privacy** | No guest names anywhere (`guestName` dropped on fetch); published model redacts activity notes and payment references (`publicModel`) | Confirmed |
| **Hosting** | Static build (`vite build`, `base = VITE_BASE_PATH`) deployable to GitHub Pages; no server required for the UI | Confirmed |
| **Testing** | `vitest.workspace.ts` projects `unit` (jsdom; calc, risk, insight, mock data, Teams message, infra, `KpiCard`, `CustomersPage`) and `integration` (node; adapters, pipeline); Playwright e2e (overview, customers, invoices, actions, states, mobile) against `vite preview` on `127.0.0.1:4173`; `deploy-pages.yml` runs typecheck + unit/integration before every deployment | Confirmed |

---

## 9. Acceptance criteria

| ID | Criterion |
| --- | --- |
| AC-1 | With `?mode=mock` and reference date `2026-09-05`, Total Outstanding shows `USD 1.58M` and Overdue `USD 462.9K` (`+29.8 %` WoW) — matching `samples/teams-message.sample.md` |
| AC-2 | Every KPI card shows value, WoW change and %, status colour + text, `interpretation`, and the `definition` tooltip verbatim from `kpis.ts` |
| AC-3 | `#/customers/:id` lists all 8 risk factors with points/max and evidence, and the sum equals `risk.score` |
| AC-4 | Customer with 90+ overdue (mock: "Mekong Holidays JSC", max aging 111 d) appears in `ESCALATE` and `OVERDUE_90`; customer over credit limit (mock: "Nusantara Trips PT", utilization 136.8 %) appears in `CREDIT_LIMIT` |
| AC-5 | An invoice with `due_date = null` (mock scenario `MISSING_DATA`) is shown with bucket `UNKNOWN`, excluded from overdue, and listed under data quality `MISSING_DUE_DATE` |
| AC-6 | Cancelled invoices show `outstanding = 0` and are excluded from all totals; overpayment (mock `REFUND_UNAPPLIED`) appears as `unapplied_cash`, never as negative receivable |
| AC-7 | Switching the reference date one week back changes KPI values and `previous_snapshot_date` consistently; FX effect is displayed when a previous snapshot exists |
| AC-8 | Every chart has a "Table" toggle rendering identical figures |
| AC-9 | Action Board status survives page reload (`localStorage` `ot.actions.<id>`) and the page shows the banner "Status changes are stored in this browser only (prototype)…" |
| AC-10 | With `completeness.payments = 'missing'` (live bookings-derived mode) the UI shows a persistent banner that collected/overdue figures are not reliable, using `completeness.notes` |
| AC-11 | `npm run report:weekly:dry` produces `automation/out/teams-message.json` whose card has ≤ 5 top risks, ≤ 6 owner actions, ≤ 4 CEO decisions, and `insight.verification.ok = true` (mock sample: 37 body blocks, 96 numbers checked, no notes) |
| AC-12 | Pipeline with an unreachable source writes a failure card titled "… — Data refresh failed" and posts an admin alert; no KPI figures are sent |
| AC-13 | Mobile viewport (375 px): no horizontal page scroll; tables scroll inside their container (`tests/e2e/mobile.spec.ts`) |
| AC-15 | `?simulate=error` shows the error state with Retry; `?simulate=empty` shows the empty state; `?mode=live` without published data shows "Live data not published yet…" and offers Switch to mock data (`tests/e2e/states.spec.ts`) |
| AC-14 | Lighthouse/axe: no critical accessibility violations on the 6 screens |

---

## 10. Out of scope (this phase)

- Real receivable ledger integration — no Ellis tool for invoices, payments, credit notes, customer master or collection activities is confirmed (see `ELLIS_MCP_MAPPING.md` "Required"). Live mode is **bookings-derived** and labelled as such.
- Treasury FX feed — live mode currently uses the illustrative FX table flagged `ILLUSTRATIVE - replace with treasury/ECB feed`.
- Write-back (marking invoices paid, logging activities into Ellis).
- Multi-tenant / role-based access control in the UI (public static site; confidentiality handled by hosting choice — see `SECURITY.md`).
- Per-user Teams delivery via Graph API (future design in `TEAMS_MESSAGE_SPEC.md`).
- Localisation of the UI (English only; Korean summaries are documentation-only).
