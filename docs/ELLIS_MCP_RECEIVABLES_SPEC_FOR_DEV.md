# ELLIS MCP 정산(미수채권) 연동 필요스펙 — 개발팀 전달용

Status: Draft v0.1 · 2026-09-07 · 작성: Global Ops (Outstanding Tracker 프로젝트) · 수신: ELLIS 개발팀 / Finance / IT
관련 문서: [ELLIS_MCP_MAPPING.md](ELLIS_MCP_MAPPING.md)(현재 확인된 사실), [DATA_DICTIONARY.md](DATA_DICTIONARY.md)(트래커 계산 규칙), [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)

---

## 0. 한 페이지 요약

Outstanding Tracker(미수금 트래커)는 매주 토요일 09:00(베트남 시각) ELLIS 데이터를 읽어 **총 미수금·연체·Aging·고객사 Risk·회수 액션**을 계산하고 Teams로 경영 보고를 보냅니다.
현재 ELLIS MCP에서 **확인된 도구는 `get_hotel_bookings` 하나**뿐이며, 이 도구에는 **Invoice·입금·Credit Note·고객 마스터 정보가 없습니다.** 따라서 트래커가 실제 미수채권을 표시하려면 아래 **5개 조회 전용(read-only) 도구**가 필요합니다.

| # | 필요 도구(제안명) | 목적 | 우선순위 |
|---|------------------|------|----------|
| T1 | `get_receivable_invoices` | 정산 Invoice(미수채권) 원장 조회 | **P0** |
| T2 | `get_payments` | 입금·적용(Apply)·환불 내역 조회 | **P0** |
| T3 | `get_sellers` | 고객사(Seller) 마스터: ID, 국가, 계약 통화, 결제조건, 신용한도, 담당자 | **P0** |
| T4 | `get_credit_notes` | Credit Note / 조정 내역 (T1에 포함 가능) | P1 |
| T5 | `get_fx_rates` | 회사 기준 환율표(→ JPY) | P1 (재무 환율표 파일로 대체 가능) |

모든 도구는 **조회 전용**, **페이지네이션(limit/offset)**, **증분 조회(updatedSince)**, **YYYY-MM-DD 날짜**, **ISO 4217 통화**를 지원해야 합니다. 개인식별정보(투숙객 실명 등)는 응답에 포함하지 않습니다.

> 통화 원칙: **고객사마다 계약 통화가 다릅니다(USD, KRW, JPY, VND, TWD, THB …).** 모든 금액은 **원통화(invoice_currency) 그대로** 제공하고, 환산은 트래커가 수행합니다. 회사 기본(보고) 통화는 **JPY**이며, ELLIS 내부 기준통화가 KRW라면 `fx_rate_to_krw`를 같이 주시면 됩니다(트래커가 KRW→JPY 교차환산).

---

## 1. 배경과 현재 상태

### 1.1 확인된 것 (Confirmed)
- ELLIS MCP 커넥터(claude.ai 커넥터, 서버 ID 접두어 `mcp__c849f32a…`)가 존재하며 운영 자동화에서 사용 중.
- 도구 `get_hotel_bookings(dateBasis, fromDate, toDate, countryCode, limit, offset)` → `{ list|records, totalCount }`.
  - 국가별 `limit=500` 페이지네이션 필요(전국 대량 조회는 업스트림 타임아웃).
  - 레코드 31개 필드: `bookingItemCode`, `bookingDate`, `checkInDate`, `checkOutDate`, `sellerName`, `hotel*`, `roomNights`, `paxCount`, `contractType`, `paymentMethod(Cash|VCC|Card)`, `billing`, `revenue`, `currency`, `baseCurrencyCode(=KRW)`, `fxRate(원통화→KRW)`, `bookingStatus`, `cancelDate`, `guestName(PII)` 등.
- **없는 것**: seller ID, seller 국가, Invoice, 입금, Credit Note, 신용한도, 결제조건, 담당자, 회수 활동, 스냅샷, 증분 조회.

### 1.2 현재 트래커가 하는 임시 처리 (Assumed — 실데이터로 쓰면 안 됨)
`paymentMethod=Cash` + `bookingStatus=Confirmed` + 체크아웃 완료 예약을 "미수 후보"로 근사하고, 만기일을 체크아웃+14일로 **가정**합니다. 입금 정보가 없어 모든 건이 미결로 보이므로 **연체·회수 수치는 신뢰할 수 없고 화면과 보고서에 'DERIVED FROM BOOKINGS'로 표시**됩니다. 이 문서의 도구가 제공되면 이 근사 모드는 제거됩니다.

---

## 2. 공통 규약 (모든 도구)

| 항목 | 요구사항 |
|------|----------|
| 프로토콜 | MCP `tools/list`, `tools/call` (Streamable HTTP JSON-RPC 2.0 권장). 인증은 `Authorization` 헤더(Bearer 또는 API Key). 인증 방식·엔드포인트 URL 확인 필요 |
| 결과 형식 | `{ "list": [...], "totalCount": number, "asOf": "YYYY-MM-DDTHH:mm:ssZ" }` — `list`/`records` 혼용하지 않고 `list`로 고정 요청 |
| 페이지네이션 | `limit`(최대 500), `offset`. `totalCount`는 필터 조건 전체 건수 |
| 증분 조회 | `updatedSince`(ISO datetime) 파라미터로 변경분만 조회. 삭제/취소는 상태값으로 표현(물리 삭제 금지) |
| 날짜·시간 | 날짜 `YYYY-MM-DD`, 시각 ISO 8601 with offset(예 `2026-09-05T09:00:00+07:00`). 각 응답에 `asOf` 포함 |
| 금액 | 숫자(문자열 금지), 소수 2자리(JPY/KRW/VND는 0자리). 통화별 원금액 유지 |
| 통화 | ISO 4217 3자리 대문자 |
| 식별자 | 문자열. 고객사는 **불변 ID**(`seller_id`) 필수(이름은 변경될 수 있음) |
| 오류 | `{ "error": { "code": "...", "message": "...", "retryable": bool, "trace_id": "..." } }`; 표준 코드: `INVALID_QUERY`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `TIMEOUT`, `INTERNAL_ERROR` |
| Rate limit | 분당 호출 한도 명시(예: 60/min). `RATE_LIMITED` 시 `retry_after_seconds` |
| PII | 투숙객 성명·연락처·여권 등 **응답에 포함하지 않음**. 고객사 담당자 개인정보도 이름·직함 수준으로 최소화 |
| 재현성 | 기준일(`asOfDate`)을 주면 **그 시점의 잔액**을 재현할 수 있어야 함(스냅샷 재현). 불가하면 트래커가 매주 스냅샷을 저장하므로 "현재 시점 조회 + 증분"만으로도 운영 가능 |
| 데이터 갱신주기 | 배치/실시간 여부와 지연 시간 명시(예: 야간 배치 D-1) |

---

## 3. 도구별 스펙

### T1. `get_receivable_invoices` — 정산 Invoice(미수채권) 원장 [P0]

**입력**

```json
{
  "dateBasis": "INVOICE_DATE | DUE_DATE | SERVICE_DATE | UPDATED_AT",
  "fromDate": "YYYY-MM-DD",
  "toDate": "YYYY-MM-DD",
  "sellerId": "optional",
  "status": ["OPEN","PARTIALLY_PAID","PAID","DISPUTED","CANCELLED","CREDITED","WRITTEN_OFF"],
  "openOnly": true,
  "updatedSince": "optional ISO datetime",
  "asOfDate": "optional YYYY-MM-DD (그 시점 잔액 재현)",
  "limit": 500,
  "offset": 0
}
```

**출력 레코드 (필수 = ★)**

| 필드 | 타입 | 설명 |
|------|------|------|
| ★ `invoice_id` | string | 불변 식별자 |
| ★ `invoice_number` | string | 고객사에 전달되는 번호 |
| ★ `seller_id` | string | 고객사 ID (T3와 조인) |
| `seller_name` | string | 표시용 |
| `booking_item_codes` | string[] | 연결된 예약 코드(1:N 허용). 예약↔Invoice 연결 식별자 |
| ★ `invoice_date` | date | 발행일 |
| `service_date` | date | 서비스(체크아웃) 완료일 |
| ★ `due_date` | date | 만기일(결제조건 적용 결과). null이면 트래커가 '만기일 미확인'으로 분리 표시 |
| ★ `invoice_currency` | string | **원통화** |
| ★ `original_amount` | number | 원금(원통화) |
| ★ `paid_amount` | number | 적용된 입금 누계(원통화) |
| ★ `credit_note_amount` | number | 적용된 Credit Note 누계(원통화) |
| ★ `outstanding_amount` | number | 잔액 = original − paid − credit_note (원통화). 음수 불가(초과입금은 T2의 unapplied로) |
| `fx_rate_to_krw`, `fx_rate_date` | number, date | ELLIS 기준통화(KRW) 환산율과 기준일 — 있으면 제공 |
| ★ `status` | enum | 위 status 목록 |
| `dispute_status`, `disputed_amount`, `dispute_reason` | enum, number, string | 분쟁 상태(`NONE|OPEN|UNDER_REVIEW|RESOLVED|REJECTED`), 분쟁 금액(원통화), 사유(내부 메모 제외) |
| `cancellation_status` | enum | `NONE|REQUESTED|CANCELLED` |
| `last_payment_date`, `last_payment_amount` | date, number | 편의 필드(없으면 T2로 계산) |
| ★ `updated_at` | datetime | 증분 조회 기준 |

**규칙**: 취소 Invoice는 삭제하지 말고 `status=CANCELLED`, `outstanding_amount=0`으로 반환. 부분 입금은 `paid_amount` 반영. 초과입금은 Invoice 잔액을 음수로 만들지 말고 T2의 `unapplied_amount`로 표현.

### T2. `get_payments` — 입금·적용·환불 [P0]

**입력**: `fromDate`, `toDate`(입금일 기준), `sellerId?`, `invoiceId?`, `updatedSince?`, `limit`, `offset`

**출력 레코드**

| 필드 | 타입 | 설명 |
|------|------|------|
| ★ `payment_id` | string | |
| ★ `seller_id` | string | |
| `invoice_id` | string \| null | 적용 대상 Invoice. **한 입금이 여러 Invoice에 나눠 적용되면 `applications[]`로 제공** |
| `applications` | `{invoice_id, applied_amount}[]` | 분할 적용 내역(권장) |
| ★ `payment_date` | date | 입금(입금 확인)일 |
| ★ `payment_currency` | string | 입금 통화 |
| ★ `payment_amount` | number | 입금 총액 |
| ★ `applied_amount` | number | Invoice에 적용된 합계 |
| ★ `unapplied_amount` | number | 미적용 현금(선수금/초과입금) |
| ★ `payment_method` | enum | `BANK_TRANSFER|CARD|VCC|OFFSET|OTHER` |
| `payment_reference` | string | 송금 참조번호(민감정보 없음) |
| ★ `reconciliation_status` | enum | `APPLIED|PARTIALLY_APPLIED|UNAPPLIED|REFUNDED` |
| ★ `updated_at` | datetime | |

**규칙**: 환불은 `reconciliation_status=REFUNDED`, 금액은 음수 또는 별도 `refund_amount`로 명확히. 트래커의 "이번 주 회수액" = 주간 `payment_date` 범위의 `applied_amount` 합계이므로 `payment_date`는 **실제 입금 확인일**이어야 합니다(전기일 아님).

### T3. `get_sellers` — 고객사 마스터 [P0]

**입력**: `sellerId?`, `status?`, `updatedSince?`, `limit`, `offset`

| 필드 | 타입 | 설명 |
|------|------|------|
| ★ `seller_id` | string | 불변 ID |
| ★ `seller_name` | string | |
| `seller_group` | string | 그룹/모기업 |
| ★ `country` | string(ISO 3166-1 alpha-2 권장) | **고객사 소재 국가**(호텔 국가 아님) |
| `region` / `market` | string | 시장 구분 |
| ★ `account_owner_id`, `account_owner_name` | string | 영업 담당자 |
| `finance_owner` | string | 정산 담당 |
| ★ `contract_currency` | string | **계약(청구) 통화** |
| ★ `payment_terms_days` | number | 결제조건(일). 규칙이 복잡하면 `payment_terms_rule` 문자열 추가 |
| ★ `credit_limit`, `credit_limit_currency` | number, string | 신용한도와 통화 |
| ★ `credit_status` | enum | `ACTIVE|ON_HOLD|SUSPENDED` |
| `customer_status` | enum | `ACTIVE|INACTIVE|CHURNED` |
| `collection_status` | enum | `NORMAL|REMINDER|ESCALATED|LEGAL` (있으면) |
| `risk_grade_manual` | enum | Finance가 수기로 부여한 등급(있으면) |
| `preferred_contact_channel` | string | 이메일/전화/Teams 등 채널 종류만 (주소·번호 제외) |
| ★ `updated_at` | datetime | |

### T4. `get_credit_notes` — Credit Note / 조정 [P1]

T1의 `credit_note_amount`에 합산되어 있어도, 주간 "해소된 연체" 분석을 위해 **날짜가 있는 개별 내역**이 필요합니다.
필드: `credit_note_id`, `invoice_id`, `seller_id`, `issue_date`, `amount`, `currency`, `reason_code`(`CANCELLATION|RATE_ADJUSTMENT|DISPUTE_SETTLEMENT|GOODWILL|OTHER`), `status`, `updated_at`.

### T5. `get_fx_rates` — 환율 [P1]

필드: `rate_date`, `from_currency`, `to_currency`(KRW 또는 JPY), `rate`, `source`. 재무팀이 쓰는 **회사 공식 월말/주간 환율**이어야 하며, 없으면 Finance가 관리하는 환율표(CSV)로 대체합니다. 트래커는 스냅샷별 환율을 보존해 환율 변동 효과와 실제 잔액 변동을 분리 표시합니다.

---

## 4. 통화 처리 요구사항 (중요)

1. **원통화 보존**: 모든 금액 필드는 Invoice/입금의 원통화로 제공. 서버에서 임의 환산한 금액만 주지 말 것.
2. **회사 기본 통화 = JPY**: CEO 대시보드·Teams 보고는 JPY로 환산해 표시(`REPORTING_CURRENCY=JPY`). 고객사 화면에는 **JPY 환산액 + 원통화 금액을 병기**.
3. **ELLIS 기준통화 KRW**: `fx_rate_to_krw`가 제공되면 트래커가 KRW→JPY 교차환산. 직접 JPY 환율(T5)이 있으면 그것을 우선 사용.
4. **환율 기준일 명시**: 모든 환산에 `rate_date`를 붙여 화면에 표시.
5. **다중 통화 고객**: 한 고객사가 여러 통화로 청구될 수 있음(예: 부산 고객사가 USD·KRW·JPY Invoice 보유). 통화별 잔액을 따로 보여주므로 Invoice 단위 통화가 정확해야 함.

---

## 5. 트래커가 계산하는 것 (ELLIS가 계산할 필요 없음)

총 미수금, 연체(due_date < 기준일), 미도래, Aging Days/Bucket(Current, 1–7, 8–14, 15–30, 31–60, 61–90, 90+), 주간 회수액, 신규/해소 연체, 약속 불이행, 신용한도 사용률, 전주 대비 증감, 환율 효과 분리, Risk Score(0–100, 8요인), 회수 액션 그룹, AI Insight. 정의는 [DATA_DICTIONARY.md](DATA_DICTIONARY.md).

> 단, **회수 활동(Collection Activity: 통화 기록, 지급 약속일·금액, 다음 조치)** 은 ELLIS에 없다면 트래커가 자체 저장소를 둡니다. ELLIS에 CRM/메모 기능이 있다면 `get_collection_activities`(activity_id, seller_id, invoice_id, owner, type, date, promised_payment_date, promised_amount, next_action, next_action_date)를 P2로 요청합니다.

---

## 6. 비기능 요구사항

| 항목 | 요구 |
|------|------|
| 응답 시간 | 500건 페이지 ≤ 8초(현재 `get_hotel_bookings`와 동일 수준) |
| 조회량 | 주 1회 배치: 최대 120일 범위 Invoice(약 수천 건) + 입금 + 고객사 전체. 국가별 분할 없이 한 번에 조회 가능하면 좋음 |
| 가용성 | 토요일 08:30–10:00 (Asia/Ho_Chi_Minh) 점검 금지 또는 사전 공지 |
| 보안 | 조회 전용 계정 발급(별도 API 키), IP 허용목록 가능 여부, 감사 로그 |
| 테스트 환경 | 스테이징 엔드포인트와 가상 데이터(실고객 마스킹) |

---

## 7. 인수 기준 (Contract Test)

트래커 저장소 `tests/integration/adapters.test.ts`에 가짜 MCP로 이미 구현된 계약 테스트를 실엔드포인트에 대해 통과해야 합니다.

1. `tools/list`에 T1–T3가 노출된다.
2. `limit=500, offset` 페이지네이션으로 `totalCount`까지 누락·중복 없이 수집된다(ID 기준).
3. `updatedSince`로 재조회 시 변경분만 반환되고 취소 건은 상태로 나타난다.
4. Invoice `outstanding_amount = original − paid − credit_note`가 모든 건에서 성립한다(오차 ≤ 0.01).
5. `get_payments`의 `applications[]` 합계 = `applied_amount`; `applied + unapplied = payment_amount`.
6. 모든 Invoice의 `seller_id`가 `get_sellers`에 존재한다(고아 레코드 0건).
7. 응답 어디에도 투숙객 성명·연락처가 없다.
8. 동일 파라미터 재호출 시 결과가 동일하다(결정성).

---

## 8. 단계별 제안

| 단계 | 산출물 | 트래커 측 작업 |
|------|--------|----------------|
| 1 (2주) | T3 `get_sellers` + T1 `get_receivable_invoices` 스테이징 | `EllisMcpReceivablesSource.fetchCustomers/fetchInvoices` 구현, 계약 테스트 실행 |
| 2 (2주) | T2 `get_payments` (+ T4) | 회수액·해소 연체 활성화, 근사 모드 제거 |
| 3 | T5 환율 또는 Finance 환율표, 증분 조회, 스냅샷 재현 | 환율 효과 검증, 주간 배치 전환 |
| 4 | 회수 활동 도구(선택) | 액션 보드 양방향 동기화 |

---

## 9. 개발팀에 드리는 질문 (회신 요청)

1. Invoice 원장이 ELLIS 내부에 존재합니까, 아니면 별도 회계 시스템(ERP)에 있습니까? 있다면 시스템명과 소유 팀은?
2. 예약(`bookingItemCode`)과 Invoice의 관계는 1:1, N:1(월 합산 청구), 1:N 중 무엇입니까?
3. 만기일은 결제조건에서 자동 계산됩니까, 사람이 입력합니까? 결제조건은 고객사 단위인지 계약(호텔/상품) 단위인지?
4. 입금은 어디서 확인·적용됩니까(은행 연동, 수기)? 입금일과 전기일 중 어떤 날짜를 쓸 수 있습니까?
5. Credit Note·취소 위약금·환불은 어떤 상태값으로 관리됩니까?
6. 고객사 ID 체계(불변 ID)와 국가·계약 통화·신용한도 필드가 존재합니까?
7. MCP 엔드포인트 URL, 인증 방식, 분당 호출 한도, 데이터 갱신 시각을 알려 주십시오.
8. 스테이징 환경과 테스트 계정 발급이 가능합니까?
9. `asOfDate`(과거 시점 잔액 재현)가 가능합니까? 불가하면 트래커 스냅샷으로 대체합니다.
10. 응답에 포함되면 안 되는 필드(내부 메모, 원가 등)가 있습니까?

---

부록 A. 참고: 트래커 내부 스키마(TypeScript) — `src/core/types.ts`의 `Customer`, `Invoice`, `Payment`, `CollectionActivity`. 위 도구 응답은 어댑터(`src/adapters/ellis/live-adapter.ts`)에서 이 스키마로 매핑됩니다.
