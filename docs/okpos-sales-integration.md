# OK포스 매출 연동 메모

## 1차 구현 상태

- 앱에는 `매출 관리` 탭과 대시보드 매출 카드가 추가되어 있습니다.
- Firestore에는 분석용 주문원장만 저장합니다.
- 고객명, 전화번호, 카드번호, 승인번호 원문 같은 민감정보는 저장 대상이 아닙니다.
- Firebase Function `syncOkposSales`가 수동 동기화 요청을 받고, `syncOkposSalesScheduled`가 10분마다 자동 동기화를 시도합니다.

## Firebase Functions 환경변수

OK포스 대리점에서 표준 API 문서를 받으면 다음 값을 Functions 환경변수 또는 Secret으로 설정합니다.

```text
OKPOS_BASE_URL=
OKPOS_STORE_CODE=
OKPOS_ORDERS_PATH=
OKPOS_API_KEY=
```

현재 어댑터는 `OKPOS_ORDERS_PATH`에 `storeCode`, `from`, `to` 쿼리를 붙여 주문원장을 조회하도록 만들어져 있습니다. 실제 문서의 파라미터명이 다르면 `functions/index.js`의 `fetchOkposOrders`만 조정하면 됩니다.

## 저장 컬렉션

- `stores/haneulttang/salesOrders/{okposOrderId}`
- `stores/haneulttang/salesDailySummaries/{YYYY-MM-DD}`
- `stores/haneulttang/salesSyncRuns/{runId}`

## 앱 확인

- 관리자만 `/sales` 접근 가능
- `지금 동기화` 버튼은 Firebase Auth ID 토큰으로 관리자 권한을 확인합니다.
- API 설정이 없으면 동기화 로그에 `config_required`가 남습니다.
