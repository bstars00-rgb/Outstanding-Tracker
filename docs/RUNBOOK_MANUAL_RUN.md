# RUNBOOK — 주간 미수 보고 수동 실행 (Global Ops)

Status: v1.0 · 2026-09-22 · 운영 방식 결정: **무인 배치 대신 Global Ops가 매주 토요일 AI Agent(Entra ID SSO)로 직접 실행**한다. GitHub Actions 스케줄 워크플로는 남겨 두되 사용하지 않는다(`DATA_SOURCE=mock` 상태로 두거나 비활성화).

## 흐름 (약 10분)

| 단계 | 하는 일 | 도구 |
|------|---------|------|
| 1 | AI Agent 세션에서 ELLIS 커넥터 연결(운영: "ELLIS PRODUCTION", 테스트: "ELLIS STAGING") | Claude + ELLIS MCP 커넥터 |
| 2 | 프롬프트로 4개 도구를 호출해 결과를 파일로 저장: `get_seller_invoices`(Issue Date 최근 120일, 전체 통화, includeBookings), `get_payments`(PDS01, 최근 120일, S), `list_channels`/`get_channel`(Seller), `get_applied_exchange_rates`(→JPY). 페이지(500)를 모두 이어 붙여 `automation/input/ellis-export.json`으로 저장 | AI Agent가 파일 작성 |
| 3 | 파이프라인 실행: `DATA_SOURCE=file REPORT_LANGUAGE=ko DRY_RUN=true npx tsx automation/weekly-report.ts` → `automation/out/teams-message.json`·`.md`·`tracker-model.json` 확인 | 터미널 |
| 4 | 수치 점검: 총 미수·연체가 ELLIS Seller Invoice 화면 합계와 일치하는지, 법인별(서울/싱가포르) 줄과 "ELLIS 반영 대기" 줄 확인 | `automation/out/teams-message.md`, `tracker-model.json` |
| 5 | 발송: `TEAMS_SENDER=live DRY_RUN=false TARGET_CHANNEL=test`(검증) → `leaders`(정식). Webhook URL은 셸 환경변수로만 전달 | 터미널 |
| 6 | 스냅샷 보관: `automation/state/`가 자동 저장되므로 다음 주 전주 대비가 계산됨. 커넥터 사용 후 STAGING 커넥터는 제거 | — |

## AI Agent 프롬프트 예시
```
Use ELLIS PRODUCTION. Call get_seller_invoices (dateType ISSUE_DATE, fromDate <오늘-120일>, toDate <오늘>, includeBookings true),
get_payments (dateType PDS01, same range, salesOrVendor S), list_channels + get_channel for every seller, and get_applied_exchange_rates (target JPY).
Page through with limit 500 / offset until totalCount. Save everything as one JSON file automation/input/ellis-export.json with keys
sellerInvoices, payments, traders, appliedRates, asOf (ISO), reportingCurrency "JPY". Do not include traveler names.
```

## 파일 형식
- `sellerInvoices[]`, `payments[]`, `traders[]`, `appliedRates[]`: 각 도구의 `list` 항목을 모든 페이지에 걸쳐 이어 붙인 배열(필드명은 `handoff/ellis-dev-team/01_…Spec_v0.2.md` §3 / `samples/ellis-entities.types.ts`).
- `traders[]`에 `controlCompName`(=`ownerCompName`)을 넣으면 법인별 현황에 반영된다. `seller.creditLimit`는 Deposit Type "Credit by company"의 금액.
- 대안: 트래커 스키마(`ReceivablesDataset`) JSON을 그대로 넣어도 된다.

## 실패 시
- `DATA_FILE must be …` → 파일 키 이름 확인. `validation failed` → 로그 `[4/13]`의 첫 오류(고아 인보이스·중복 등) 확인 후 export 재생성.
- 수치 불일치 → 페이지 누락(totalCount 대비 행 수) 또는 통화 필터 확인.
- Teams 미발송 → `DRY_RUN`, `TARGET_CHANNEL`, Webhook 환경변수 확인. 실패 시 "Data refresh failed" 카드가 대신 발송되며 오래된 수치는 절대 보내지 않는다.

## 매주 체크리스트
- [ ] ELLIS 반영 대기(미검증·미대사) 0건인지, 아니면 경영지원에 사유 확인
- [ ] 법인 미지정 고객사 0건
- [ ] 발송 카드 모바일 확인(1분 내 읽힘)
