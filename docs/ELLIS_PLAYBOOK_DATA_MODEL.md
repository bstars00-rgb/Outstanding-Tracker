# ELLIS Playbook 데이터 모델 카탈로그 (정산·미수채권 관점)

Status: v0.1 · 2026-09-07 · 출처: https://ellis-playbook.ohmyhotel.com (Admin 사용자 가이드) · 조사자: Outstanding Tracker 프로젝트

목적: ELLIS Admin에 **실제로 존재하는** 정산·결제·고객사·환율 데이터의 화면 필드, 타입, 코드값을 그대로 옮겨 적고, 트래커 스키마와의 대응·공백을 명시한다. 플레이북은 **화면 가이드**이므로 여기서 확인된 것은 "UI에 존재하는 데이터"이며, MCP 도구·API 파라미터명은 별도 확인이 필요하다.

상태 범례: **P-Confirmed** = 플레이북에 필드명(camelCase)까지 기재 · **P-Label** = 화면 컬럼 라벨만 기재(API 필드명 미확인) · **MCP-Confirmed** = 운영 중인 MCP `get_hotel_bookings`에서 실제 관측 · **Gap** = ELLIS에 없음

---

## 0. 핵심 결론

| # | 결론 | 영향 |
|---|------|------|
| 1 | **Seller Invoice(고객사 인보이스)가 미수채권 원장이다.** 예약 확정 시 자동 생성되며 Invoice No.(=`invoiceSeq`), B.Cur, B.Sum Amt, Paid Amt, Balance, Issued Date, Due Date, I.Status(Unpaid/Paid/Over Paid)를 가진다. | 트래커 `Invoice` 엔티티와 1:1 대응 가능. 만기일·통화·잔액이 모두 있음 |
| 2 | **Payment In/Out이 입금 원장이다.** `paymentSeq`, `paidDate`, `currencyCode`, `depositAmount`, `invoiceSeq`(매핑), `depositWithdrawTypeCode`(Deposit/Withdraw), `sellerDisputeYn` 등 camelCase 필드명이 문서화되어 있다. | 트래커 `Payment`와 대응. 환불은 Withdraw, 미매핑 입금은 미적용 현금 |
| 3 | **Traders(Seller 탭)에 신용한도·결제조건·기본통화·상태가 있다.** Company Code가 불변 ID. | 트래커 `Customer` 대응. 단, **영업 담당자(account owner)는 없음** → BKG PIC 또는 CRM(HubSpot) 필요 |
| 4 | **환율은 Applied Exchange Rate(origin→target)로 제공되며 JPY·KRW·USD·VND 등 15개 통화 지원.** FX Gain/Loss 예시는 Book Currency=JPY 기준. | 회사 기본통화 JPY 환산은 ELLIS 환율로 가능 |
| 5 | **Credit Note 엔티티는 없다.** 대신 인보이스의 예약 라인에 Compensation(A=가산, D=차감) 조정이 B.Sum Amt를 직접 변경한다. | 트래커 `credit_note_amount`는 0으로 두고 조정은 원금 변동으로 처리(감사 이력은 Settlement History의 Action Type으로 추적) |
| 6 | **연체(Overdue) 상태값은 Seller Invoice에 없다**(Vendor Billing에는 BS04 Overdue 존재). 연체는 Due Date < 기준일로 트래커가 계산한다. | 트래커 계산 방식과 일치 |
| 7 | 분쟁은 인보이스의 **예약 라인 단위** `Dispute`/`Dispute Remark`(Y/N + 텍스트), 결제 단위 `sellerDisputeYn`. | 분쟁 금액 = 분쟁 라인의 B.Balance 합계로 산출 |
| 8 | ELLIS Admin은 REST API 위에서 동작한다(API Management 메뉴, 예: `/admin/basis/file-download/list-file-download` POST). | MCP 도구는 기존 Admin API를 래핑하면 되므로 개발 부담이 낮음 |

---

## 1. Settlement > Seller Invoice (`Settlement > Settlement > Seller Invoice`)

### 1.1 검색 조건
| 필터 | 타입 | 값/비고 | 상태 |
|------|------|---------|------|
| Date Type | dropdown (필수) | `Issue Date` \| `Due Date` | P-Label |
| Date Range | date range (필수) | YYYY-MM-DD | P-Label |
| Currency | dropdown (필수) | 청구 통화 (KRW, VND, USD …) | P-Label |
| Control Company | optional | 해당 Seller를 관리하는 법인 | P-Label |
| Invoice No. | text | 인보이스 번호 | P-Label |
| Payment Status | dropdown | `Unpaid` \| `Paid` \| `Over Paid` | P-Label |
| Seller Code | text | 고객사 코드 | P-Label |
| Balance | dropdown | over / under zero | P-Label |

### 1.2 Invoice List 컬럼
| 컬럼 | 추정 필드명 | 타입 | 의미 | 상태 |
|------|-------------|------|------|------|
| Invoice No. | `invoiceSeq` | number | 고유 식별자. Payment In/Out·FX 보고서에서 `invoiceSeq`로 참조됨 | P-Confirmed(타 화면) |
| I.Status | `paymentStatus` | enum | `Unpaid` / `Paid` / `Over Paid` | P-Label |
| Control | `controlCompName` | string | 관리 법인 | P-Label |
| Seller Code | `sellerCompCode` | string | 고객사 코드 (FX 보고서 필드명) | P-Confirmed(타 화면) |
| Seller Name | `sellerCompName` | string | | P-Confirmed(타 화면) |
| Seller Name - Operation | — | string | 운영 명칭 | P-Label |
| B.Cur | `billingCurrencyCode` | string(ISO 4217) | 청구 통화 (FX 보고서 필드명) | P-Confirmed(타 화면) |
| B.Sum Amt | `billingSumAmount` | number | 인보이스 총액 (FX 보고서 필드명) | P-Confirmed(타 화면) |
| Paid Amt | `paidSumAmount` | number | 입금 누계 (Vendor Billing 필드명 유추) | P-Label |
| Balance | `balanceAmount` | number | **= B.Sum Amt − Paid Amt**, 음수 = Over Paid | P-Label |
| Issued Date | `issuedDate` | date | 인보이스 생성일 | P-Label |
| Due Date | `dueDate` | date | 지급 기한(생성 시 설정) | P-Label |
| Invoice View | — | link | 인보이스 문서 | P-Label |
| Remark | `remark` | string(≤500) | 메모(지급 약속 등 기록 권장) | P-Label |
| First Insert User/Time, Last Insert User, Last Update Time | `firstInsertName`, `firstInsertDatetime`, `lastUpdateDatetime` | string/datetime | 감사 필드 | P-Label |

### 1.3 Booking Details(인보이스 하단 예약 라인) 컬럼
| 컬럼 | 추정 필드명 | 타입 | 비고 |
|------|-------------|------|------|
| Booking Item Code | `bookingItemCode` | string | 예약↔인보이스 연결 키 (1 인보이스 : N 예약) |
| Booking Status | `bookingStatusName` | enum | Pending / Confirmed / Cancelled / Unavailable / Cancel Request |
| C.Payment Status | `clientPaymentStatusName` | enum | Not Paid / Partially Paid / Fully Paid / Refunded / Partially Refunded |
| Seller BKG Code | `sellerBookingCode` | string | 고객사 예약번호 |
| Hotel Country / Hotel Name | `hotelCountryName` / `hotelName` | string | |
| Traveler | — | string | **PII — 트래커는 저장하지 않음** |
| C/I, C/O, Nts | `checkInDate`, `checkOutDate`, `nights` | date, date, number | |
| B.Cur, B.Sum Amt, Paid Amt, B.Balance | 위와 동일 | | 라인 단위 금액 |
| Revenue | `revenue` | number | 예약 수익 |
| Dispute, Dispute Remark | `disputeYn`, `disputeRemark` | Y/N, string | 라인 단위 분쟁 |

### 1.4 액션과 의미
Collected(입금 기록: Invoice No., Balance, Currency, Paid Date, Paid Amount, Memo) · Remark · Send Mail · **Compensation**(Booking Item Code, Booking Type, Add/Subtract `A`/`D`, Amount, Remark — 예약 라인 금액 조정) · Excel.
FAQ: "인보이스는 예약 확정 시 자동 생성", "취소는 별도 권한", "Over Paid 크레딧은 다음 인보이스에 적용하거나 Payment In/Out에서 환불".

---

## 2. Settlement > Payment > Payment In/Out (`/account/payments`)

### 2.1 검색 조건
Date Type `PDS01` Payment Date / `PDS02` Booking Date / `PDS03` Service Date · 코드 검색(BKG Item Code, PM SEQ, Approval No., PG/VCC TID, Purchase Request ID, Invoice/Billing No., S./V. BKG Code, CNFM No.) · Station(B2C, B2B, Control, OpenApi) · S/V(Sales, Vendor) · A/C(Deposit, Withdraw) · Item Category · Payment Detail(Charge, Fee, Markup, Cancel Fee…) · Payment Type(Card, Bank Transfer, Virtual Credit Card, Cash) · PG/VCC(Nicepay, eXimbay, Onepay / Hana, Citi, Connex) · Traders(자동완성) · Dispute · PM CNFM.

### 2.2 그리드 컬럼 (P-Confirmed — 플레이북에 필드명 기재)
| 컬럼 | 필드 | 타입 | 의미 |
|------|------|------|------|
| PM SEQ | `paymentSeq` | number | 결제 고유번호 |
| S / V | `salesOrVendor` | `S`/`V` | 고객사(Sales) / 공급사(Vendor) |
| Station | `stationTypeName` | string | |
| Item Category | `itemCategoryName` | string | Flight/Hotel/… |
| PM Detail Type | `paymentDetailTypeName` | string | Charge, Fee, Markup, Cancel Fee… |
| Booking Item Code | `bookingItemCode` | string | |
| Traveler | `travelerName` | string | **PII** |
| A/C | `depositWithdrawTypeCode` | Deposit/Withdraw | 입금/출금 |
| Date | `paidDate` | date | 결제일(실입금일) |
| Curr | `currencyCode` | string | |
| First Amount | `firstDepositAmount` | number | 조정 전 원금액 |
| Amount | `depositAmount` | number | 현재 금액 |
| PM Deposit Type | `depositTypeName` | string | Card, Bank, VCC… |
| Bank/Card Name | `depositDetailTypeName` | string | |
| PG / VCC | `pgVccCompName` | string | |
| PG/VCC Status | `cardPaymentStatusName` | string | |
| Approval No. | `cardApprovalNo` | string | |
| TID | `pgTransactionId` | string | |
| Traders Name | `traderCompName` | string | 고객사명 (**코드 컬럼은 화면에 없음** → API에 `traderCompCode` 필요) |
| Invoice/Billing No. | `invoiceSeq` | number | 매핑된 인보이스(S) 또는 빌링(V) |
| S.Dispute / S. Dispute Remark | `sellerDisputeYn` / `sellerDisputeRemark` | Y/N, string | |
| V.Dispute / Remark | `vendorDisputeYn` / `vendorDisputeRemark` | | |
| PM CNFM Date / User | `paymentConfirmDate` / `paymentConfirmName` | date, string | 확인 |
| Payment Remark / Control Remark | `paymentRemark` / `controlRemark` | string | |
| PM Register User | `firstInsertName` | string | |
| PG Response Message | `pgResponseMessage` | string | |

### 2.3 규칙
- 매핑(Mapping) 시 **통화가 일치해야 함**, Balance Amount만큼 매핑. Release로 해제.
- 환불(RFND)은 Withdraw로 기록. 수동 입금(Deposit) 폼은 Currency·Amount·Paid Date 필수.
- 요약 패널: Sales/Vendor × Approval/Cancel × 통화별 합계.

---

## 3. Users > Customer > Traders (고객사/공급사 마스터)

| 탭 | 필드 | 타입 | 의미 | 상태 |
|----|------|------|------|------|
| 검색 | Country, Company Type, **Company Code**, Company Name, Business No, Status | | Company Code = 고유 ID | P-Label |
| Basic | Company Name(필수), Country(필수), Representative, Business No, Phone, Email, Address, Status | string | Status: `Active` / `Inactive` / `Pending` / `Suspended` | P-Label |
| Seller | Seller(Yes/No), Seller Type(`API Seller`/`Regular Seller`), **Credit Limit**("Maximum unpaid balance allowed"), **Payment Terms**("When payment is due"), **Currency**("Default transaction currency"), Commission | | 결제조건의 형식(일수 vs 규칙 텍스트) 미확인 | P-Label |
| Vendor | Vendor Type(Hotel/Chain/DMC/CMS·PMS), Payment Terms, Currency | | 공급사 측 | P-Label |
| Bank Account | Bank Name, Account Number, Account Holder, Currency | | 트래커 미사용 | P-Label |
| PIC | Name, Position, Email, Phone, Department | | 고객사 측 담당자(PII 최소화: 이름·직책만) | P-Label |
| Biz Member | 로그인 사용자·권한 | | 미사용 | P-Label |

Company Type 값: API Seller, Regular Seller, Hotel Vendor, Chain Vendor, DMC, CMS/PMS, Payment Gateway, VCC Provider. 삭제 불가(Inactive 처리).
**Gap**: 오마이호텔 측 영업 담당자(account owner)·수금 담당자 필드 없음. 후보: Bookings `BKG PIC`(예약 단위 담당자), Users > Admin `Booking PIC`, CRM(HubSpot) Trader owner.

---

## 4. System Control > Common > Exchange Rate (`/basis/exchange-rate`, 읽기 전용, 외부 피드 자동 갱신)

| 패널 | 필드 | 타입 | 의미 |
|------|------|------|------|
| Announced | `originCurrencyCode`, `basisRate`, `cashBuyRate`, `cashSellRate`, `remitSendRate`, `remitReceiveRate`, `exchangeCommRate`, `usdCompareRate`, `announcedDatetime` | string/number/datetime | 고시 환율(금융기관), 하루 여러 번 고시 |
| Applied | `originCurrencyCode`, `targetCurrencyCode`, `appliedRate` | | **1 origin = appliedRate target** (예: CNY→KRW 210.96). 역방향도 제공. 정산·청구에 사용 |

지원 통화: AED, CNY, EUR, HKD, IDR, JPY, KRW, MMK, MOP, MYR, SGD, THB, TWD, USD, VND. 과거 일자 조회 가능.

---

## 5. Settlement > FX Gain/Loss (`/settlement/fx-gain-loss`) — 필드명 P-Confirmed

`bookingDate`, `bookingItemCode`, `hotelCode`, `hotelCountryName`, `hotelNameEn`, `vendorCompCode`, `vendorCompName`, `vendorCurrencyCode`, **`sellerCompCode`, `sellerCompName`, `sellerCountryName`, `billingCurrencyCode`, `billingSumAmount`**, `invoiceSeq`, `billingStatusCodeName`, **`collectedDate`**, `convertRateValue`(예약일 환율), `bookingSumAmount`, `collectedAppliedRate`(회수일 환율), `collectedSumAmount`, **`bookCurrencyCode`(내부 회계통화)**, `fxAmount`, `fxGainLoss`, `slipStatusYn`, `slipStatusDate`.
공식: `FX Amount = 회수일 환율 금액 − 예약일 환율 금액`. 예시가 USD/JPY 130→135, Book Amount ¥ 로 표기되어 **Book Currency = JPY**로 추정(운영 MCP 예약 레코드의 `baseCurrencyCode=KRW`와 상충 → 법인/Control Company별 기준통화 여부 확인 필요).
이 화면은 **고객사 국가(`sellerCountryName`)와 인보이스 회수일(`collectedDate`)** 을 제공하므로 트래커의 국가별 분석·회수 이력에 유용.

---

## 6. Settlement History (`/settlement/history`) — 감사 이력
필터: Date Type(Last Update Date), Date Range(최대 3개월), Code Selector(Payment SEQ / Invoice-Billing No. / BKG Item Code), Action Type(다중), User.
컬럼: Audit Log SEQ, Payment SEQ, Booking Item Code, Action Type, Original, New Amount, Invoice/Billing No., Last Update User, Last Update Time, Remark.
Action Type 코드: Invoice SAT01–09/34(상태·금액·입금·잔액 수정, 예약/입금 제거, 매핑, 회수, 발행, 이메일), Billing SAT10–23, Booking SAT24–30/39–41(취소, 보상, 조정), Payment SAT31–38(매핑, 삭제, 삽입, 해제).
→ **증분 조회 대안**: `updatedSince`가 없더라도 Settlement History로 변경분을 식별할 수 있다.

---

## 7. Vendor Billing (참고: 공급사 측 미지급) — 필드명 P-Confirmed
`invoiceSeq`, `issueCompName`, `traderCompCode`, `traderCompName`, `appliedFromDate`, `appliedToDate`, `currencyCode`, `invoiceAmount`, `paidSumAmount`, `balanceAmount`, `issueDate`, `depositDueDate`, `paidDate`, `billingStatusName`, `vendorDisputeYn`, `controlRemark`, `lastUpdateDatetime`.
Billing Status: `BS01` Pending, `BS02` Partial, `BS03` Paid, **`BS04` Overdue**, `BS05` Disputed. Payment Type `VPT01`~`VPT05`(Wire, Card, VCC, Prepaid, Net Settlement). Contract Type `CT01`~`CT04`.
→ Seller Invoice API가 같은 구조(`invoiceAmount`/`paidSumAmount`/`balanceAmount`/`depositDueDate`)를 쓸 가능성이 높음. 개발팀 확인 항목.

---

## 8. Hotel Bookings / MCP `get_hotel_bookings` (MCP-Confirmed)
검색: Date Type(Booking/Cancel/Check In/Check Out/Cancel Deadline/Stay), Station, BKG Status, Seller, **C. Payment Status**(Not Paid/Partially Paid/Fully Paid/Refunded/Partially Refunded), V. Payment Status, Contract(Exclusive/Shared/Dynamic), BKG PIC …
MCP 레코드 31개 필드(`bookingItemCode`, `sellerName`, `billing`, `revenue`, `currency`, `baseCurrencyCode=KRW`, `fxRate`, `paymentMethod`, `bookingStatus`, `cancelDate` …)는 `ELLIS_MCP_MAPPING.md` §1 참조. System Code: `BK001` Booking Status(`BKS01` New, `BKS02` Confirmed, `BKS03` Canceled …), `BK002` Payment Status, `PM039` Invoice Booking Type, `PM040` Settlement Action Type, `PM041` Settlement Date Type.

---

## 9. 트래커 스키마 대응표

| 트래커 필드 | ELLIS 출처 | 변환 규칙 | 상태 |
|-------------|-----------|-----------|------|
| `Customer.customer_id` | Traders `Company Code` | `seller:<code>` | P-Label |
| `Customer.country` | Traders Basic `Country` (또는 FX `sellerCountryName`) | 그대로 | P-Label |
| `Customer.contract_currency` | Traders Seller `Currency` | | P-Label |
| `Customer.payment_terms_days` | Traders Seller `Payment Terms` | 숫자/`NET 30`/`Prepaid` 파싱 | P-Label (형식 미확인) |
| `Customer.credit_limit` | Traders Seller `Credit Limit` | 통화 = Seller Currency | P-Label |
| `Customer.credit_status` | Traders `Status` | Suspended→SUSPENDED, Inactive/Pending→ON_HOLD | P-Label |
| `Customer.account_owner_*` | **없음** | BKG PIC / CRM owner 필요 | Gap |
| `Invoice.invoice_id` | Seller Invoice `invoiceSeq` | `inv:<seq>` | P-Confirmed |
| `Invoice.invoice_date` / `due_date` | `Issued Date` / `Due Date` | | P-Label |
| `Invoice.original_amount` / `paid_amount` | `B.Sum Amt` / `Paid Amt` | 원통화 | P-Label |
| `Invoice.outstanding_amount` | `Balance` (=Sum−Paid) | 음수는 미적용 현금으로 | P-Label |
| `Invoice.invoice_currency` | `B.Cur` | | P-Label |
| `Invoice.invoice_status` | `I.Status` | Unpaid→OPEN/PARTIALLY_PAID, Paid·Over Paid→PAID | P-Label |
| `Invoice.disputed_amount` | 예약 라인 `Dispute=Y`의 `B.Balance` 합 | | P-Label |
| `Invoice.credit_note_amount` | 없음(Compensation이 원금 변경) | 0 | Gap(설계상) |
| `Invoice.booking_id` | 라인 `bookingItemCode` | 1:N이면 null + 라인 보관 | P-Label |
| `Payment.*` | Payment In/Out (S/V=S) | `paymentSeq`, `paidDate`, `currencyCode`, `depositAmount`, `invoiceSeq`→applied, 없으면 unapplied, Withdraw→REFUNDED | P-Confirmed |
| `Payment.customer_id` | `traderCompName`→코드 조회 | **`traderCompCode` API 제공 요청** | Gap |
| `CollectionActivity` | 없음(인보이스 Remark만) | 트래커 자체 저장 | Gap |
| `FxTable` | Applied Exchange Rate | origin→JPY `appliedRate` | P-Confirmed |
| 스냅샷 재현 | Settlement History + Exchange Rate 과거 조회 | 트래커 주간 스냅샷으로 대체 | 부분 |

구현: `src/adapters/ellis/ellis-entities.ts`(타입·매핑 함수), `src/adapters/ellis/live-adapter.ts`(`discoverCapabilities` → 정산 도구가 노출되면 전체 데이터셋, 아니면 예약 기반 근사), 테스트 `tests/integration/ellis-entities.test.ts`, `adapters.test.ts`.
