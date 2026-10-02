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
| 5b | 사이트 게시: `DATA_PUBLISH_PASSWORD='<게이트 비밀번호>' npm run publish:data` → `public/data/bundle.enc.json`(암호화본) 커밋·푸시 → 배포 후 사이트에서 비밀번호 재입력 1회 | 터미널 |
| 6 | 스냅샷 보관: `automation/state/`가 자동 저장되므로 다음 주 전주 대비가 계산됨. 커넥터 사용 후 STAGING 커넥터는 제거 | — |

## 대안: 주간 엑셀(Outstanding_Report_<날짜>.xlsx)로 실행
MCP 도구가 아직 없을 때는 OP 워크북을 그대로 변환해 실행한다.
```
python automation/tools/excel_to_dataset.py automation/input/Outstanding_Report_2026-09-28.xlsx 2026-09-28 automation/input/outstanding-2026-09-28.json
DATA_SOURCE=file DATA_FILE=automation/input/outstanding-2026-09-28.json REPORT_DATE=2026-09-28 REPORT_LANGUAGE=ko DRY_RUN=true npx tsx automation/weekly-report.ts
```
워크북 형식(2026-10-02~): 미수 목록은 날짜 탭(예: `02-Oct`)이며 직전 주 탭(`28-Sep`)이 함께 들어 있다. 변환기는 기준일과 같은 날짜 탭을 쓰고, 직전 탭을 입금일 추정에 참고한다.
- `Noted` 열의 "Payment received …"는 **은행 입금은 확인됐지만 ELLIS 미반영**을 뜻한다. 해당 인보이스는 트래커에서 회수로 처리되고 ELLIS 반영 체인의 "입금확인·ELLIS 미기록" 단계에 올라간다. ELLIS 원장 합계는 데이터 노트와 리뷰 워크북(Summary의 원장 대사 표, `ELLIS pending` 시트)에 남는다.
- 매주 실행 전 AI Agent에서 ELLIS MCP `list_channels`를 호출해 `automation/input/ellis-channels.json`을 갱신하면 관리 법인·국가가 ELLIS 값으로 들어간다(없으면 수동 매핑 사용).
- 담당자(PIC)는 `automation/config/pic-overrides.json`(2026-09-28 확정본)이 Tier 시트보다 우선한다.

워크북에 없는 것: 관리 법인(서울/싱가포르), PM CNFM·은행 대사 일자, 신용한도, 국가. 내부 계정("Business Trip in …" = 출장, "Unsold room (JP)" = 하드블럭 미판매분)은 고객 미수가 아니므로 변환 시 제외되고 잔액만 데이터 노트에 남는다(2026-09-28 확인). 엔진은 SOP(L1~L4, ¥500K 결재 경로, Tier 회수기한)를 자동 적용한다.

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
