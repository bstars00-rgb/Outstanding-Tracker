# Ellis MCP Mapping — Source Contract and Field Mapping

**Purpose.** This document records what is known about the Ellis MCP connector (Ellis = OhMyHotel Admin, `adm.ohmyhotel.com`), how the confirmed `get_hotel_bookings` tool is mapped onto the tracker's receivables model by `bookingsToDataset()` in `src/adapters/ellis/live-adapter.ts`, which PRD fields cannot be sourced today, what to ask the Ellis team, and the exact procedure for switching the pipeline from mock to live data. Everything in the **Confirmed** section was observed in production use of the connector; everything in **Assumed** is an explicit assumption visible in code comments; **Required** items do not exist yet.

**Status:** Draft v0.1 — 2026-09-07. Live calls could **not** be executed in this build session: the Ellis MCP connector (claude.ai connector, server id prefix `mcp__c849f32a…`) is not attached here (status: **Blocked**).

> **요약 (Korean summary).** Ellis MCP에서 확인된 도구는 `get_hotel_bookings`(예약 조회) 하나입니다. 청구서/미수 원장, 입금, 크레딧노트, 고객 마스터(고객 ID, 여신한도, 결제조건, 담당자, 고객 국가), 수금 활동 도구는 확인되지 않았습니다. 따라서 현재 실데이터 모드는 "Cash(후불) 결제 + Confirmed + 체크아웃 완료" 예약을 청구서로 간주하고, 만기 = 체크아웃 + 14일(가정), 입금 정보 없음(모두 미수로 표시)이라는 가정 위에서 동작하는 **예약 기반 추정치**입니다. 정확한 미수금 보고를 위해서는 아래 "Required" 항목을 Ellis 팀에서 제공해야 합니다.

### Status legend

| Status | Meaning |
| --- | --- |
| **Confirmed** | Observed on the live connector (26,255 records) or implemented and unit-testable in code |
| **Assumed** | Implemented on an explicit assumption; must be validated with Ellis / Finance before production |
| **Required** | Not available; blocks a PRD capability until provided |

---

## 1. Confirmed

### 1.1 Connector

| Item | Value |
| --- | --- |
| Connector type | claude.ai MCP connector, server id prefix `mcp__c849f32a…` |
| Attached to this build session | **No** (Blocked) — no live call was possible; all live-mode code paths are exercised only through the `McpToolClient` test double |
| Transport / endpoint / auth scheme | **Hidden by the connector** — not confirmed (see §5) |

### 1.2 Tool contract: `get_hotel_bookings`

| Argument | Type | Confirmed values / notes |
| --- | --- | --- |
| `dateBasis` | string | `"BOOKING_DATE"` confirmed in production use. `"CHECK_IN_DATE"`, `"CHECK_OUT_DATE"` appear in the TypeScript type `GetHotelBookingsArgs` but are **unconfirmed** |
| `fromDate` | `YYYY-MM-DD` | inclusive start |
| `toDate` | `YYYY-MM-DD` | inclusive end |
| `countryCode` | string | **Country name**, not ISO code: "Japan", "Korea", "Vietnam", "Taiwan", "Thailand", "Hong Kong", "Macao", "Malaysia", "Singapore", "Indonesia", "China", "Philippines" |
| `limit` | number | 500 used in production. Pulling all countries with a large limit causes **upstream timeouts** |
| `offset` | number | pagination offset; `offset += 500` until rows pulled ≥ `totalCount` |

**Result shape:** JSON object `{ list: EllisBookingRecord[], totalCount: number }`. Some builds return `records` instead of `list`; the adapter reads `res.list ?? res.records ?? []`. `totalCount` is the page total count for pagination. Large results are returned **as files** by the connector (see §5, Required: the `HttpMcpClient` has no file-result handling).

### 1.3 Record fields (`EllisBookingRecord`, observed on 26,255 records)

| Field | Type | Notes |
| --- | --- | --- |
| `bookingItemCode` | string | e.g. `S26081810811H01`; **unique key**; last write wins (reflects cancellations) |
| `bookingDate` | `YYYY-MM-DD HH:mm:ss` | |
| `checkInDate`, `checkOutDate` | `YYYY-MM-DD` | |
| `sellerName` | string | customer / agency name — the **only** customer identifier; no seller ID, no seller country |
| `hotelName`, `hotelCode`, `hotelLegacyCode`, `hotelCountry`, `hotelCity`, `hotelChainName` | | hotel = destination, **not** the customer's country |
| `roomTypeCode`, `roomTypeName`, `ratePlanName`, `roomPlanCode`, `promotionName`, `promotionCode` | | product detail (not used by the tracker) |
| `roomNights`, `roomCount`, `paxCount` | number | not used |
| `contractType` | `"Dynamic Rate" \| "Shared Rate" \| "Exclusive Rate"` | not used |
| `cmsName` | string | not used |
| `sellerBookingCode` | string | masked, e.g. `****3698` |
| `paymentMethod` | `"Cash"` 84 % · `"VCC"` 15 % · `"Card"` 1 % · `null` | drives the receivable filter |
| `billing` | number | amount in `currency` |
| `revenue` | number | net revenue |
| `currency` | string | observed `USD`, `KRW`, `JPY`, `VND` |
| `baseCurrencyCode` | string | always `"KRW"` (company base currency in Ellis) |
| `fxRate` | number | local currency → KRW |
| `bookingStatus` | string | `Confirmed`, `Reserved`, `Cancelled`, `Cancelled(Replied)`, `Pending`, `Unavailable`, `Cancel Request` |
| `cancelDate` | datetime or null | cancelled bookings have `billing = 0` |
| `guestName` | string | **PII — dropped immediately in `fetchBookings`, never stored** |
| `billingCompanyCurrency`, `revenueCompanyCurrency` | | rare; appear on a handful of records; ignored by the adapter |

### 1.4 Adapter behaviour (Confirmed in code)

| Behaviour | Implementation |
| --- | --- |
| Health check | `healthCheck()` calls `tools/list` and reports `ok` only if `get_hotel_bookings` is present |
| Pagination | per country in `cfg.countries` (default: the 12 names above), `offset += pageSize (500)` while `pulled < totalCount`; stops on an empty page |
| De-duplication | `Map<bookingItemCode, record>` — **last write wins** so a later "Cancelled" row supersedes the earlier "Confirmed" row |
| PII | `const { guestName: _pii, ...safe } = r` — guest name never leaves `fetchBookings` |
| Window | `fetchDataset(ref)` pulls `dateBasis = BOOKING_DATE`, `fromDate = ref − lookbackDays (120)`, `toDate = ref` |
| Not-confirmed capabilities | `fetchInvoices()`, `fetchPayments()`, `fetchCustomers()`, `fetchActivities()` throw `ToolNotConfirmedError` — the adapter fails loudly instead of inventing data |
| Dataset label | `source = 'ellis-bookings-derived'`; `completeness = { customers: partial, invoices: partial, payments: missing, activities: missing, fx: full|missing }` with four explanatory `notes` |

---

## 2. Assumed — the bookings-derived model

`bookingsToDataset(records, referenceDate, cfg)` is a pure function (unit-testable without a client). `DEFAULT_LIVE_CONFIG`:

| Config key | Default | Assumption |
| --- | --- | --- |
| `receivablePaymentMethods` | `['Cash']` | **Cash = post-paid** booking that creates a receivable from the seller. `VCC` and `Card` are treated as prepaid/settled and skipped |
| `billableStatuses` | `['Confirmed']` | Only `Confirmed` bookings represent a delivered service |
| `assumedPaymentTermsDays` | `14` | Payment terms unknown (no customer master) → due = checkout + 14 days |
| `lookbackDays` | `120` | Bookings **booked** more than 120 days before the reference date are not pulled, even if the stay is recent |
| `countries` | 12 names | Iterated one by one to avoid upstream timeouts |
| `pageSize` | `500` | |

### 2.1 Filters applied per record (in order)

1. `paymentMethod ∉ receivablePaymentMethods` → skip.
2. empty `sellerName` → skip.
3. A `Customer` is created (or reused) for the seller **before** the billable check — sellers whose bookings are all future/Reserved therefore appear as customers with zero invoices (observation).
4. `cancelled = /cancel/i.test(bookingStatus)` → matches `Cancelled`, `Cancelled(Replied)` **and `Cancel Request`** (Assumed: a cancel request is treated as cancelled).
5. `billable = bookingStatus ∈ billableStatuses && checkOutDate ≤ referenceDate`.
6. If neither billable nor cancelled (Reserved / Pending / Unavailable / future stays) → skip.

### 2.2 Field-by-field mapping

**Customer** (one per distinct `sellerName`)

| Tracker field | Source | Status |
| --- | --- | --- |
| `customer_id` | `` `seller:${slug(sellerName)}` `` — lower-cased, non-alphanumerics → `-` | **Assumed** (no seller ID exposed; name spelling variants will create duplicate customers) |
| `customer_name` | `sellerName` | Confirmed |
| `customer_group` | `null` | Required |
| `country` | `'Unknown'` — `hotelCountry` is the destination, **not** the seller country | Required |
| `region` | `'Unknown'` | Required |
| `account_owner_id` / `account_owner_name` | `''` (engine displays "Unassigned"; `MISSING_OWNER` warning) | Required |
| `finance_owner` | `null` | Required |
| `contract_currency` | `currency` of the **first** booking encountered for that seller | Assumed |
| `payment_terms_days` | `cfg.assumedPaymentTermsDays` (14) | Assumed |
| `credit_limit` | `null` (→ risk factor 6 = 0, `MISSING_CREDIT_LIMIT` info) | Required |
| `credit_status` / `customer_status` / `collection_status` | `ACTIVE` / `ACTIVE` / `NORMAL` | Assumed |
| `risk_grade_manual`, `preferred_contact_channel` | `null` | Required |
| `data_source` | `'ellis-mcp:get_hotel_bookings (derived)'` | Confirmed |

**Invoice** (one per billable or cancelled Cash booking)

| Tracker field | Source | Status |
| --- | --- | --- |
| `invoice_id` | `` `bk:${bookingItemCode}` `` | Assumed (no invoice entity in Ellis) |
| `invoice_number` | `bookingItemCode` | Assumed |
| `booking_id` | `bookingItemCode` | Confirmed |
| `customer_id` | seller key above | Assumed |
| `invoice_date` | `checkOutDate` | Assumed (billing is assumed to occur at checkout) |
| `service_date` | `checkOutDate` | Confirmed |
| `due_date` | `addDays(checkOutDate, 14)` | **Assumed** |
| `original_amount` | `round2(Number(billing) \|\| 0)`; `0` if cancelled | Confirmed value / Assumed semantics |
| `paid_amount` | `0` — **payments unknown** | Required |
| `credit_note_amount` | `0` | Required |
| `disputed_amount` | `0` | Required |
| `outstanding_amount` | `= original_amount` (or 0 if cancelled) → **everything appears open** | Required (payments) |
| `invoice_currency` | `currency` | Confirmed |
| `invoice_status` | `CANCELLED` if cancelled, else `OPEN` | Assumed |
| `dispute_status` / `dispute_reason` | `NONE` / `null` | Required |
| `cancellation_status` | `CANCELLED` or `NONE` | Confirmed (from `bookingStatus`) |
| `last_payment_date` / `last_payment_amount` | `null` | Required |

**BookingContext** (one per included booking)

| Tracker field | Source |
| --- | --- |
| `booking_id` | `bookingItemCode` |
| `check_in` / `check_out` | `checkInDate` / `checkOutDate` |
| `hotel_name` | `hotelName` |
| `destination` | `` `${hotelCity}, ${hotelCountry}` `` |
| `booking_amount` / `booking_currency` | `billing` / `currency` |
| `booking_status` | `bookingStatus` |
| `cancellation_penalty` | `null` (Required) |
| `supplier_payment_status` | `null` (Required) |
| `net_revenue` | `Number(revenue) \|\| null` |

**Dataset-level**

| Field | Value | Status |
| --- | --- | --- |
| `as_of` | `new Date().toISOString()` at mapping time | Confirmed |
| `source` | `'ellis-bookings-derived'` | Confirmed |
| `reporting_currency` | `cfg.reportingCurrency` (`REPORTING_CURRENCY`, default `USD`) | Confirmed |
| `fx` | `cfg.fx` — in `buildDeps()` this is `mockFxTable()` re-labelled `source: 'ILLUSTRATIVE - replace with treasury/ECB feed'`. The Ellis `fxRate` (local → KRW) is **not used** because the reporting currency is not KRW | **Required** (FX feed) |
| `payments`, `activities` | `[]` | Required |

### 2.3 Consequences visible in the tracker (live mode)

- **Collected This Week = 0**, Overdue = every derived invoice older than checkout + 14 d, Overdue Ratio and aging buckets are **not reliable** — `completeness.notes` says so and the UI/report must show it.
- Risk factors 4–8 (WoW growth, promise, credit limit, activity, dispute) carry little or no signal; the score is driven by aging and amount.
- Multi-currency: amounts stay in `USD/KRW/JPY/VND`; conversion uses the illustrative table until a real feed is wired.

---

## 3. PRD field inventory with source status

| Entity | Field | Source status |
| --- | --- | --- |
| **Customer master** | `customer_id` | Required (Ellis seller ID) — currently name slug |
| | `customer_name` | Confirmed (`sellerName`) |
| | `country`, `region` | Required |
| | `account_owner_id/name`, `finance_owner` | Required |
| | `contract_currency` | Assumed (first booking currency) |
| | `payment_terms_days` | Required — assumed 14 |
| | `credit_limit`, `credit_status` | Required |
| | `customer_status`, `collection_status`, `risk_grade_manual`, `preferred_contact_channel` | Required (Finance / CRM) |
| **Invoice** | `invoice_id`, `invoice_number`, `invoice_date` | Required — derived from booking |
| | `booking_id`, `service_date`, `invoice_currency`, `original_amount` | Confirmed (booking fields) |
| | `due_date` | Required — assumed checkout + 14 |
| | `paid_amount`, `credit_note_amount`, `disputed_amount`, `outstanding_amount`, `last_payment_*` | Required (ledger / payments / credit notes) |
| | `invoice_status`, `dispute_status`, `dispute_reason` | Required |
| | `cancellation_status` | Confirmed (`bookingStatus`) |
| **Payment** | all fields | Required (no payments / collections tool) |
| **Collection activity** | all fields | Required — expected to be **tracker-owned** (no Ellis tool expected; see `ARCHITECTURE.md`) |
| **Snapshot** | all fields | Tracker-computed and stored by `SnapshotStore` (Ellis has no historical snapshots) |
| **Booking context** | `booking_id`, `check_in`, `check_out`, `hotel_name`, `destination`, `booking_amount`, `booking_currency`, `booking_status`, `net_revenue` | Confirmed |
| | `cancellation_penalty`, `supplier_payment_status` | Required |
| **FX** | reporting-currency rates | Required (treasury/ECB feed); Ellis only gives local → KRW `fxRate` |

---

## 4. Pagination, rate-limit and timeout guidance

| Topic | Guidance | Status |
| --- | --- | --- |
| Page size | `limit = 500` per call; do not raise | Confirmed (production) |
| Country iteration | One country per query loop; **never** an all-country pull with a large limit (upstream timeout) | Confirmed |
| Termination | `while (pulled < totalCount)`; break on empty page | Confirmed (code) |
| Client timeout | `HttpMcpClient` aborts each JSON-RPC call after 30 000 ms | Confirmed (code) |
| Retry | The adapter does **not** retry per page; the pipeline wraps `fetchDataset()` in `withRetry(…, 2 attempts, 3 000 ms)` — a mid-pull failure restarts the whole pull. Per-page retry on `McpTransportError.retryable` (HTTP ≥ 500, 429, 408) is a recommended improvement | Assumed |
| Rate limits | Unknown | Required |
| Refresh cadence of Ellis data | Unknown | Required |
| Volume estimate | 26,255 records observed over the production window; 120-day lookback × 12 countries ≈ dozens of pages per run | Assumed |
| Expected run duration | Unknown until first live run; the GitHub Actions job should allow ≥ 20 min | Assumed |

---

## 5. Required — questions for the Ellis team

Each item: **why it matters** and **what breaks without it**.

| # | Question / request | Why it matters | Without it |
| --- | --- | --- | --- |
| R1 | **Invoice / receivable ledger tool** (e.g. `get_receivables` / `get_invoices`; name to be confirmed) with invoice id/number, customer id, invoice date, due date, original amount, currency, status | Receivables must come from the ledger, not from bookings | Live mode stays "bookings-derived"; invoice dates and due dates are assumptions |
| R2 | **Payments / collections tool** (e.g. `get_payments`) with payment id, invoice id (or allocation), customer id, date, amount, currency, method, applied/unapplied split, reference | Collected This Week, Overdue, Aging, New/Resolved Overdue, Broken Promise all depend on payments | Every derived invoice appears open forever; overdue is massively overstated; forecast confidence is `low` |
| R3 | **Credit notes** (amount, invoice, date) | Outstanding = original − paid − credit note | Credit notes appear as overdue balance; `AMOUNT_MISMATCH` cannot be detected |
| R4 | **Customer (seller) master**: stable seller **ID**, seller **country/region**, **credit limit** + currency, **payment terms** (days), **account owner**, credit status | Customer key, Aging by country, Risk factor 6, due-date calculation, Action Board owner routing | Customers keyed by name (duplicates on spelling variants), country = "Unknown", owner = "Unassigned", credit factor = 0, terms = 14 d guess |
| R5 | **Dispute** information (disputed amount, reason, status) | Risk factor 8, `DISPUTE` action group, At-Risk Amount | Disputes invisible |
| R6 | **Historical snapshots or changed-since (incremental) query** | WoW comparison, re-creating a missed Saturday snapshot | Tracker must keep its own snapshots from day 1 (`SnapshotStore`); no back-fill possible |
| R7 | Confirm semantics: does `paymentMethod = "Cash"` mean **post-paid on account**? Are `VCC`/`Card` fully settled at booking? | Core assumption of the receivable filter | Receivable population could be wrong in either direction |
| R8 | Confirm which `bookingStatus` values are **billable** and whether `Cancel Request` should count as cancelled | Filters 4–5 in §2.1 | Cancel-requested stays may be excluded prematurely or cancelled stays counted |
| R9 | Confirm `dateBasis` accepted values (`CHECK_OUT_DATE`?) | Pulling by checkout date would make the 120-day lookback exact | Bookings made > 120 days before a recent stay are missed |
| R10 | **Endpoint URL, transport (Streamable HTTP / SSE / REST), auth scheme, error format** of the MCP server | `HttpMcpClient` implements Streamable HTTP JSON-RPC `tools/list` + `tools/call` only; no `initialize` handshake, no SSE parsing, no file-result download | Live mode cannot be wired outside claude.ai |
| R11 | How **file-returned large results** are delivered (URL? resource? inline base64?) | 500-row pages may exceed inline limits | Pull loop may receive a file reference instead of `list` and fall over |
| R12 | **Rate limits** and **data refresh cadence** (when does Saturday 09:00 see Friday's data?) | Scheduling, retry policy | Risk of throttling or reporting on stale data |
| R13 | **FX rates to reporting currency** (or confirm reporting in KRW so `fxRate` can be used) | Multi-currency totals and FX effect | Illustrative rates in production — not acceptable |
| R14 | Service account with **read-only** scope for the tracker | Least privilege | Shared personal credentials |

---

## 6. Switching the adapter from mock to live — procedure

### 6.1 Wiring (as implemented in `automation/weekly-report.ts` → `buildDeps()`)

```text
DATA_SOURCE=ellis
  └─ new EllisMcpReceivablesSource(
        new HttpMcpClient(ELLIS_MCP_ENDPOINT, ELLIS_MCP_AUTH),   // 30 s timeout per call
        { reportingCurrency: REPORTING_CURRENCY, fx: <illustrative table> })
```

| Environment variable | Purpose | Notes |
| --- | --- | --- |
| `DATA_SOURCE=ellis` | selects the live adapter (default `mock`) | `loadEnv()` throws if `ELLIS_MCP_ENDPOINT` is missing |
| `ELLIS_MCP_ENDPOINT` | full URL of the MCP server (secret; redacted in logs) | Required — unknown today |
| `ELLIS_MCP_AUTH` | complete `Authorization` header value, e.g. `Bearer <token>` (secret) | optional; sent verbatim |
| `REPORTING_CURRENCY` | ISO 4217, default `USD` | |
| `DRY_RUN=true` | keep true for the first live runs | default `true` |

### 6.2 Step-by-step

1. Obtain R10/R14 (endpoint, transport, auth, read-only account). Store `ELLIS_MCP_ENDPOINT` and `ELLIS_MCP_AUTH` as **GitHub Secrets** (never in `.env` committed files; `.gitignore` excludes `.env*` except `.env.example`).
2. Run a health check locally: `DATA_SOURCE=ellis DRY_RUN=true TEAMS_SENDER=mock AI_PROVIDER=mock npm run report:weekly` — step `[3/13]` logs `fetched from ellis-mcp: N customers, M invoices, 0 payments, 0 activities`. `healthCheck()` can be invoked from a small script to verify `tools/list` contains `get_hotel_bookings`.
   In GitHub, the same run is available as `workflow_dispatch` on `weekly-report.yml` with `data_source=ellis`, `dry_run=true`, `target_channel=test`.
3. Inspect `automation/out/tracker-model.json`: `source = ellis-bookings-derived`, `completeness.payments = missing`, `completeness.notes[0]` starts with `DERIVED FROM BOOKINGS`.
4. Adjust `EllisLiveConfig` if Ellis confirms different semantics (R7–R9): `receivablePaymentMethods`, `billableStatuses`, `assumedPaymentTermsDays`, `countries`, `lookbackDays`.
5. Replace the FX table in `buildDeps()` with a real feed (R13) before any figure is shown to leadership.
6. Keep `TARGET_CHANNEL=test` and `DRY_RUN=false` for a supervised send to the test channel; only then `TARGET_CHANNEL=leaders`.
7. When R1–R5 tools exist: implement `fetchInvoices/fetchPayments/fetchCustomers` (currently throwing `ToolNotConfirmedError`), build the dataset from the ledger, set `source = 'ellis-mcp'` and `completeness` accordingly; `bookingsToDataset` becomes the fallback/cross-check.

### 6.3 Transport caveat

`HttpMcpClient` (`src/adapters/ellis/mcp-client.ts`) speaks **Streamable HTTP JSON-RPC 2.0**: `POST { jsonrpc, id, method: 'tools/list' | 'tools/call', params }` with headers `content-type: application/json`, `accept: application/json, text/event-stream`, optional `authorization`, and it echoes back an `mcp-session-id` header if the server returns one. It parses `result.structuredContent`, else the first `content[].text` as JSON, else raw text. It does **not** send an MCP `initialize` request, does not parse SSE streams, and does not download file results.

Because the real transport is **unconfirmed** (the claude.ai connector hides it), `McpToolClient` (`listTools()` / `callTool()`) is deliberately a two-method interface so a different implementation (SSE, stdio, REST façade, or a thin proxy in front of the claude.ai connector) can be injected into `EllisMcpReceivablesSource` without touching the mapping logic.

---

## 7. PII handling

| Rule | Where enforced |
| --- | --- |
| `guestName` is removed from every record **before** it is stored in the de-dup map | `EllisMcpReceivablesSource.fetchBookings()` |
| No guest field exists in `Customer`, `Invoice`, `BookingContext` or any snapshot type | `src/core/types.ts` |
| `sellerBookingCode` arrives masked from Ellis and is not mapped | `bookingsToDataset()` ignores it |
| Published model (`public/data/tracker-model.json`) additionally redacts activity notes and payment references | `publicModel()` in `automation/weekly-report.ts` |
| Logs never contain endpoint/auth values | `RedactingLogger.protect(...)` in `buildDeps()` |
