# ELLIS MCP 정산(미수채권) 연동 필요스펙 — 개발팀 전달용

Status: **v0.2 (ELLIS Playbook 반영)** · 2026-09-07 · 작성: Global Ops (Outstanding Tracker 프로젝트) · 수신: ELLIS 개발팀 / Finance / IT
관련 문서: [ELLIS_PLAYBOOK_DATA_MODEL.md](ELLIS_PLAYBOOK_DATA_MODEL.md)(플레이북에서 확인한 실제 필드·코드), [ELLIS_MCP_MAPPING.md](ELLIS_MCP_MAPPING.md), [DATA_DICTIONARY.md](DATA_DICTIONARY.md), [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)

---

## 0. 한 페이지 요약

Outstanding Tracker(미수금 트래커)는 매주 토요일 09:00(베트남 시각) ELLIS 데이터를 읽어 **총 미수금·연체·Aging·고객사 Risk·회수 액션**을 계산하고 Teams로 경영 보고를 보냅니다.

ELLIS Playbook을 확인한 결과, 필요한 데이터는 **ELLIS Admin에 이미 존재**합니다(Settlement > Seller Invoice, Payment In/Out, Users > Traders, Common > Exchange Rate). 현재 MCP로 노출된 도구는 `get_hotel_bookings` 하나뿐이므로, 아래 **4개 조회 전용 도구**를 기존 Admin API 위에 래핑해 주시면 됩니다.

| # | 필요 도구(제안명) | 원천 화면 (Playbook) | 우선순위 |
|---|------------------|----------------------|----------|
| T1 | `get_seller_invoices` | Settlement > Settlement > **Seller Invoice** (Invoice List + Booking Details) | **P0** |
| T2 | `get_payments` | Settlement > Payment > **Payment In/Out** (`/account/payments`, S/V = S) | **P0** |
| T3 | `get_traders` | Users > Customer > **Traders** (Basic + Seller 탭) | **P0** |
| T4 | `get_applied_exchange_rates` | System Control > Common > **Exchange Rate** (`/basis/exchange-rate`, Applied 패널) | P1 |
| (선택) | `get_settlement_history` | Settlement > **Settlement History** (`/settlement/history`) — 증분 변경 감지용 | P2 |

트래커의 라이브 어댑터는 `tools/list`로 위 도구 존재를 자동 감지하며(`discoverCapabilities`), T1–T3가 모두 있으면 전체 미수채권 데이터셋을, 없으면 예약 기반 근사 모드를 사용합니다. 도구 이름은 환경설정으로 바꿀 수 있으므로 **제안명과 다르게 명명하셔도 됩니다.**

> 통화 원칙: 고객사마다 청구 통화(B.Cur)가 다릅니다. 모든 금액은 **원통화 그대로** 주시고 환산은 트래커가 합니다. 회사 기본(보고) 통화는 **JPY**이며, ELLIS의 Applied Exchange Rate(origin→JPY)를 그대로 쓰겠습니다.

---

## 1. 확인된 사실 (Playbook 기준)

| 항목 | 확인 내용 |
|------|-----------|
| 미수채권 원장 | **Seller Invoice**. 예약 확정 시 자동 생성. `Invoice No.`(=`invoiceSeq`), `I.Status` = `Unpaid` / `Paid` / `Over Paid`, `B.Cur`, `B.Sum Amt`, `Paid Amt`, `Balance`(= Sum − Paid, 음수 = Over Paid), `Issued Date`, `Due Date`, `Control`(관리 법인), `Seller Code/Name`, `Remark` |
| 인보이스↔예약 | 1 인보이스 : N 예약 라인(`Booking Item Code`, C.Payment Status, C/I, C/O, Nts, B.Sum Amt, Paid Amt, B.Balance, Revenue, Dispute Y/N + Remark) |
| 입금 원장 | **Payment In/Out**. `paymentSeq`, `salesOrVendor`(S/V), `depositWithdrawTypeCode`(Deposit/Withdraw), `paidDate`, `currencyCode`, `firstDepositAmount`, `depositAmount`, `depositTypeName`(Card/Bank Transfer/VCC/Cash), `invoiceSeq`(매핑), `traderCompName`, `sellerDisputeYn`, `paymentConfirmDate` |
| 고객사 마스터 | **Traders**. `Company Code`(불변), Company Name, Country, Status(Active/Inactive/Pending/Suspended), Seller 탭: Seller Type(API/Regular), **Credit Limit**, **Payment Terms**, **Currency**, Commission; PIC 탭(고객사 측 담당자) |
| 환율 | **Applied Exchange Rate**: `originCurrencyCode` → `targetCurrencyCode`, `appliedRate`(1 origin = rate target), 고시 시각. 15개 통화(JPY, KRW, USD, VND, TWD, THB, HKD, SGD, MYR, IDR, CNY, EUR, AED, MOP, MMK) |
| Credit Note | 별도 엔티티 없음. 인보이스 예약 라인의 **Compensation**(Add `A` / Subtract `D`)이 B.Sum Amt를 직접 조정. 이력은 Settlement History(Action Type SAT01–41) |
| 연체 상태 | Seller Invoice에는 Overdue 상태값 없음(Vendor Billing에만 `BS04 Overdue`). **연체 = Due Date < 기준일**로 트래커가 계산 |
| 감사·변경 이력 | Settlement History: Date Type Last Update Date(최대 3개월), Payment SEQ / Invoice No. / BKG Item Code, Action Type, Original, New Amount |
| API 기반 | Admin은 REST API 위에서 동작(예: `POST /admin/basis/file-download/list-file-download`). MCP 도구는 해당 API 래핑으로 구현 가능 |

없는 것(**Gap**): 오마이호텔 측 **영업 담당자(account owner)**, 회수 활동(통화 기록·지급 약속일), Payment In/Out 그리드의 **trader 코드**(이름만 표시).

---

## 2. 공통 규약 (모든 도구)

| 항목 | 요구사항 |
|------|----------|
| 프로토콜 | MCP `tools/list`, `tools/call`(Streamable HTTP JSON-RPC 2.0 권장). 인증은 `Authorization` 헤더. 엔드포인트 URL·인증 방식 회신 요청 |
| 결과 형식 | `{ "list": [...], "totalCount": number, "asOf": "ISO datetime" }` (`records` 대신 `list`로 통일) |
| 페이지네이션 | `limit`(최대 500), `offset`. `totalCount`는 필터 조건 전체 건수 |
| 증분 조회 | `updatedSince`(ISO datetime). 불가 시 Settlement History로 대체 가능 |
| 날짜·시각 | 날짜 `YYYY-MM-DD`, 시각 ISO 8601 with offset. 응답에 `asOf` 포함 |
| 금액 | 숫자(문자열 금지). 원통화 유지. JPY/KRW/VND는 정수 |
| 통화 | ISO 4217 대문자 |
| 식별자 | `invoiceSeq`, `paymentSeq`(number), `companyCode`/`sellerCompCode`(string) — 화면과 동일한 값 |
| 오류 | `{ "error": { "code", "message", "retryable", "trace_id" } }`; `INVALID_QUERY`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`(+`retry_after_seconds`), `TIMEOUT`, `INTERNAL_ERROR` |
| PII | `travelerName`, Booker, PIC 이메일·전화, 은행계좌·카드번호는 **응답에서 제외** |
| 갱신주기·가용성 | 데이터 반영 지연, 토요일 08:30–10:00(베트남) 점검 여부 회신 |

---

## 3. 도구별 스펙

### T1. `get_seller_invoices` — Seller Invoice [P0]

**입력**

```json
{
  "dateType": "ISSUE_DATE | DUE_DATE | UPDATED_AT",
  "fromDate": "YYYY-MM-DD",
  "toDate": "YYYY-MM-DD",
  "currencyCode": "optional (화면은 필수지만 API는 전체 통화 허용 요청)",
  "controlCompCode": "optional",
  "sellerCompCode": "optional",
  "paymentStatus": ["Unpaid","Paid","Over Paid"],
  "balance": "ALL | OVER | UNDER | ZERO",
  "includeBookings": true,
  "updatedSince": "optional",
  "limit": 500,
  "offset": 0
}
```

**출력 레코드** (★ 필수) — Playbook Invoice List 컬럼 그대로

| 필드 | 타입 | Playbook 컬럼 | 비고 |
|------|------|---------------|------|
| ★ `invoiceSeq` | number | Invoice No. | Payment In/Out `invoiceSeq`와 동일 키 |
| ★ `paymentStatus` | enum | I.Status | `Unpaid` / `Paid` / `Over Paid` |
| `controlCompCode`, `controlCompName` | string | Control | 관리 법인 코드·명 |
| ★ `sellerCompCode` | string | Seller Code | Traders `Company Code`와 동일 |
| ★ `sellerCompName` | string | Seller Name | |
| `sellerOperationName` | string | Seller Name - Operation | |
| ★ `billingCurrencyCode` | string | B.Cur | 원통화 |
| ★ `billingSumAmount` | number | B.Sum Amt | Compensation 반영 후 총액 |
| ★ `paidSumAmount` | number | Paid Amt | |
| ★ `balanceAmount` | number | Balance | = billingSumAmount − paidSumAmount |
| ★ `issuedDate` | date | Issued Date | |
| ★ `dueDate` | date \| null | Due Date | |
| `remark` | string | Remark | 지급 약속 메모가 여기 기록됨(≤500자) |
| `firstInsertDatetime`, `lastUpdateDatetime` | datetime | First Insert Time / Last Update Time | `lastUpdateDatetime`는 증분 기준 |
| `bookings[]` | array | Booking Details | 아래 라인 구조 |

**`bookings[]` 라인**: `bookingItemCode`★, `bookingStatusName`, `clientPaymentStatusName`(Not Paid/Partially Paid/Fully Paid/Refunded/Partially Refunded), `sellerBookingCode`, `hotelCountryName`, `hotelName`, `checkInDate`, `checkOutDate`, `nights`, `billingCurrencyCode`, `billingSumAmount`, `paidSumAmount`, `balanceAmount`, `revenue`, `disputeYn`★, `disputeRemark`. (`Traveler`는 제외)

**규칙**: 취소된 인보이스는 삭제 대신 상태값으로 반환. `balanceAmount < 0`(Over Paid)은 트래커가 미적용 현금으로 처리.

### T2. `get_payments` — Payment In/Out [P0]

**입력**: `dateType`(`PDS01` Payment Date / `PDS02` Booking Date / `PDS03` Service Date), `fromDate`, `toDate`, `salesOrVendor`(`S`), `traderCompCode?`, `invoiceSeq?`, `bookingItemCode?`, `depositWithdrawTypeCode?`, `updatedSince?`, `limit`, `offset`

**출력 레코드** — Playbook 그리드 필드명 그대로(모두 P-Confirmed)

| 필드 | 타입 | 비고 |
|------|------|------|
| ★ `paymentSeq` | number | PM SEQ |
| ★ `salesOrVendor` | `S`/`V` | 트래커는 S만 사용 |
| `stationTypeName`, `itemCategoryName`, `paymentDetailTypeName` | string | Charge / Fee / Markup / Cancel Fee … |
| `bookingItemCode` | string \| null | |
| ★ `depositWithdrawTypeCode` | Deposit / Withdraw | 환불(RFND)은 Withdraw |
| ★ `paidDate` | date | **실입금 확인일** |
| ★ `currencyCode` | string | |
| `firstDepositAmount` | number | 조정 전 |
| ★ `depositAmount` | number | 현재 금액 |
| ★ `depositTypeName` | string | Card / Bank Transfer / Virtual Credit Card / Cash |
| `depositDetailTypeName`, `pgVccCompName`, `cardPaymentStatusName` | string | |
| ★ **`traderCompCode`** | string | **신규 요청**(화면에는 `traderCompName`만 있음) |
| `traderCompName` | string | |
| ★ `invoiceSeq` | number \| null | 매핑된 인보이스. null = 미매핑(미적용 현금) |
| ★ `sellerDisputeYn`, `sellerDisputeRemark` | Y/N, string | |
| `paymentConfirmDate`, `paymentConfirmName` | date, string | PM CNFM |
| `paymentRemark`, `controlRemark` | string | |
| `cardApprovalNo`, `pgTransactionId` | string | 참조번호(카드번호·계좌번호 제외) |
| `lastUpdateDatetime` | datetime | |

**규칙**: 한 입금이 여러 인보이스에 분할 매핑되면 `applications[{invoiceSeq, appliedAmount}]` 배열로 제공 요청(현재 UI는 1건 매핑).

### T3. `get_traders` — Traders (Seller) [P0]

**입력**: `companyType`(`Seller` 등), `country?`, `companyCode?`, `status?`(Active/Inactive/Pending/Suspended), `updatedSince?`, `limit`, `offset`

| 필드 | 타입 | Playbook 탭·필드 | 비고 |
|------|------|------------------|------|
| ★ `companyCode` | string | 검색 Company Code | 불변 ID(= sellerCompCode) |
| ★ `companyName` | string | Basic Company Name | |
| ★ `country` | string(ISO 3166-1 alpha-2 권장) | Basic Country | **고객사 국가** |
| ★ `status` | enum | Basic Status | Active / Inactive / Pending / Suspended |
| `businessNo`, `representative` | string | Basic | |
| ★ `seller.isSeller` | boolean | Seller 탭 Seller=Yes | |
| `seller.sellerType` | enum | API Seller / Regular Seller | |
| ★ `seller.creditLimit` | number \| null | Credit Limit | 통화 = `seller.currency` |
| ★ `seller.paymentTerms` | number(일) 또는 string | Payment Terms | **형식 확인 요청**(일수 vs 규칙) |
| ★ `seller.currency` | string | Currency | 계약(청구) 통화 |
| `seller.commission` | number | Commission | |
| `controlCompCode` | string | (Seller Invoice의 Control) | 관리 법인 |
| `pic[{name, position, department}]` | array | PIC 탭 | 이메일·전화 제외 |
| **`accountOwner`** | `{id, name}` | **없음 — 요청** | BKG PIC 또는 CRM owner로 제공 검토 |
| `lastUpdateDatetime` | datetime | | |

### T4. `get_applied_exchange_rates` — Applied Exchange Rate [P1]

**입력**: `date`(YYYY-MM-DD, 기본 최신), `originCurrencyCode?`, `targetCurrencyCode?`(예: `JPY`)
**출력**: `originCurrencyCode`, `targetCurrencyCode`, `appliedRate`(1 origin = rate target), `announcedDatetime`, (선택) Announced 패널의 `basisRate`, `usdCompareRate`.
과거 일자 조회가 되므로 스냅샷별 환율 보존이 가능합니다. 각 Control Company의 **Book Currency(내부 회계통화)** 가 무엇인지(JPY? KRW?)도 회신 부탁드립니다.

### (선택) `get_settlement_history` [P2]
`dateType`=Last Update Date, `fromDate`/`toDate`(≤3개월), `actionTypes[]`(SAT01–41), `codeType`(Payment SEQ / Invoice No. / BKG Item Code) → `auditLogSeq`, `paymentSeq`, `bookingItemCode`, `actionType`, `originalValue`, `newAmount`, `invoiceSeq`, `lastUpdateUser`, `lastUpdateDatetime`, `remark`. 증분 조회 대체 및 회수 활동(Collection 액션) 추적용.

---

## 4. 통화 처리 요구사항

1. 모든 금액은 **원통화(`billingCurrencyCode` / `currencyCode`)** 그대로. 서버 환산값만 주지 않기.
2. 회사 기본 통화 **JPY**: 트래커가 Applied Exchange Rate(origin→JPY)로 환산하고 환율 기준일을 표시.
3. 고객사별 청구 통화가 다르므로 고객 화면은 JPY 환산액 + 원통화 금액을 병기(이미 구현).
4. Payment 매핑 시 통화 일치 규칙(Playbook)을 API에서도 보장.

---

## 5. 트래커가 계산하는 것 (ELLIS 계산 불필요)
총 미수금, 연체(Due Date < 기준일), 미도래, Aging Bucket, 주간 회수액(`paidDate` 기준 applied 합계), 신규/해소 연체, 약속 불이행(트래커 기록), 신용한도 사용률(Credit Limit ÷ 환산), 전주 대비 증감, 환율 효과 분리, Risk Score, 회수 액션, AI Insight.

---

## 6. 비기능 요구사항
500건 페이지 ≤ 8초 · 주 1회 배치(120일 범위 인보이스 + 입금 + 고객사 전체) · 토요일 08:30–10:00 점검 회피 · 조회 전용 계정 + 감사 로그 · 스테이징 환경과 마스킹 데이터.

---

## 7. 인수 기준 (Contract Test — 저장소에 이미 구현)
`tests/integration/adapters.test.ts`, `tests/integration/ellis-entities.test.ts`가 가짜 MCP로 아래를 검증하며, 실엔드포인트에서 동일하게 통과해야 합니다.
1. `tools/list`에 T1–T3 노출 → 어댑터가 자동으로 전체 모드 전환.
2. `limit/offset` 페이지네이션이 `totalCount`까지 누락·중복 없음.
3. 모든 인보이스에서 `balanceAmount = billingSumAmount − paidSumAmount` (±0.01).
4. `invoiceSeq`가 있는 입금은 applied, 없는 입금은 unapplied, Withdraw는 REFUNDED로 매핑.
5. 모든 인보이스의 `sellerCompCode`가 Traders `companyCode`에 존재(고아 0건).
6. 응답에 투숙객·계좌·카드번호 없음.
7. Applied rate로 만든 환율표에 JPY 대상 통화가 모두 존재.
8. 동일 파라미터 재호출 결과 동일.

---

## 8. 단계별 제안
| 단계 | 산출물 | 트래커 측 |
|------|--------|-----------|
| 1 (2주) | T3 `get_traders` + T1 `get_seller_invoices` 스테이징 | 계약 테스트 실행, 고객사·인보이스 화면 실데이터 확인 |
| 2 (2주) | T2 `get_payments`(+`traderCompCode`) | 회수액·해소 연체 활성화, 근사 모드 제거 |
| 3 | T4 환율, `updatedSince` 또는 Settlement History | 환율 효과 검증, 주간 배치 전환, 리더 채널 발송 |
| 4 | account owner 필드, 회수 활동 저장(선택) | 담당자별 병목·액션 보드 동기화 |

---

## 9. 개발팀 회신 요청 (상세는 OPEN_QUESTIONS.md E15–E21)
1. Seller Invoice / Payment In/Out / Traders / Exchange Rate를 조회하는 **기존 Admin API 경로**와 파라미터명(우리가 그대로 래핑 대상으로 삼겠습니다).
2. Payment In/Out 응답에 **`traderCompCode`** 추가 가능 여부.
3. Traders **Payment Terms**의 저장 형식(일수/텍스트)과 Seller Invoice **Due Date 산출 규칙**.
4. Control Company별 **Book Currency**(JPY/KRW) 및 Applied Rate 조회 API.
5. 오마이호텔 측 **account owner**를 어디서 얻을지(BKG PIC / CRM owner / Control Company).
6. `updatedSince` 지원 여부, MCP 엔드포인트 URL·인증·호출 한도·갱신 시각, 스테이징 계정.

부록 A. 트래커 내부 스키마: `src/core/types.ts`. 플레이북 엔티티 타입과 매핑: `src/adapters/ellis/ellis-entities.ts`.
