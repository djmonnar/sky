# 하늘땅 카카오 챗봇 연결 가이드

## 스킬 URL

카카오 챗봇 관리자센터 스킬 URL:

```text
https://asia-northeast3-skyearth-84a78.cloudfunctions.net/kakaoSkill
```

배포 상태:

- Firebase Functions `kakaoSkill` 배포 완료
- 위치: `asia-northeast3`
- 런타임: Node.js 20
- Artifact Registry 이미지 정리 정책: 7일 보관

비밀값을 사용할 경우 URL 뒤에 secret을 붙입니다.

```text
https://asia-northeast3-skyearth-84a78.cloudfunctions.net/kakaoSkill?secret={KAKAO_SKILL_SECRET}
```

`KAKAO_SKILL_SECRET` 환경변수가 설정되어 있으면 같은 secret이 들어온 요청만 처리합니다.

## 챗봇 사용자 등록

카카오 요청은 Firebase Auth 로그인 상태가 아니므로 챗봇 사용자는 별도 등록이 필요합니다.
처음 챗봇을 호출하면 응답으로 `botUserKey`가 표시됩니다.

Firestore에 아래 문서를 만듭니다.

```text
stores/haneulttang/chatbotUsers/{botUserKey}
```

예시:

```json
{
  "name": "정하늘",
  "role": "admin",
  "employeeId": 1,
  "active": true
}
```

권한:

- `admin`: 전체 기능
- `manager`: 예약, 근무표, 직원 목록, 공지/전달 관리
- `staff`: 예약 조회/등록/상태 변경, 본인 근무표 조회, 전달사항 등록

## 추천 구성

가장 빠른 방식은 카카오 챗봇에 "자유 명령" 블록 하나를 만들고 모든 발화를 스킬로 보내는 것입니다.
더 안정적인 운영을 위해 아래 표처럼 주요 업무별 블록을 만들고 `action` 파라미터를 고정값으로 넘기면 됩니다.

모든 블록의 스킬 URL은 같은 URL을 사용합니다.

```text
https://asia-northeast3-skyearth-84a78.cloudfunctions.net/kakaoSkill
```

## 공통 파라미터

| 파라미터 | 용도 |
| --- | --- |
| `action` | 수행 작업 코드 |
| `date` | 오늘, 내일, 2026-06-28, 6/28 |
| `period` | 오전 또는 오후 |
| `time` | 7:30, 730 |
| `id` | 문서/예약/직원/거래처/레시피 번호 |
| `name` | 이름, 예약자, 직원명, 거래처명, 레시피명 |
| `phone` | 연락처 |
| `people` | 예약 인원 |
| `seat` | 좌석 |
| `status` | 예약확정, 방문완료, 취소, 노쇼, 단체, 확인전화필요, 예약대기 |
| `department` | 홀 또는 주방 |
| `text` | 공지/전달사항 내용 |
| `password` | 급여 요약 비밀번호 |

## 카카오 블록 시나리오

| 블록명 | 발화 예시 | 고정 action | 추가 파라미터 |
| --- | --- | --- | --- |
| 시작/도움말 | 시작, 도움말, 메뉴 | `help` | 없음 |
| 오늘 현황 | 오늘 현황, 대시보드 | `dashboard` | 없음 |
| 예약 목록 | 오늘 예약, 내일 예약 | `reservation.list` | `date`, `period`, `status` 선택 |
| 예약 등록 | 예약 등록, 예약 잡아줘 | `reservation.create` | `name`, `phone`, `period`, `time`, `people`, `seat` |
| 예약 수정 | 예약 수정 | `reservation.update` | `id`, 변경할 `period`, `time`, `people`, `seat`, `status` |
| 예약 상태 변경 | 방문완료, 예약 취소 | `reservation.status` | `id`, `status` |
| 예약 삭제 | 예약 삭제 | `reservation.delete` | `id` |
| 근무표 보기 | 오늘 근무표, 내일 근무 | `schedule.list` | `date` |
| 근무표 추가 | 근무표 추가 | `schedule.add` | `date`, `period`, `department`, `name` |
| 근무표 삭제 | 근무표 삭제 | `schedule.delete` | `date`, `period`, `department`, `name` 또는 `id` |
| 직원 목록 | 직원 목록 | `employee.list` | 없음 |
| 직원 등록 | 직원 등록 | `employee.create` | `name`, `role`, `hourly` |
| 직원 수정 | 직원 수정 | `employee.update` | `id` 또는 `name`, 변경할 `phone`, `bank`, `account`, `role` |
| 직원 삭제 | 직원 삭제 | `employee.delete` | `id` 또는 `name` |
| 공지 목록 | 공지, 공지사항 | `notice.list` | 없음 |
| 공지 등록 | 공지 등록 | `notice.create` | `text` |
| 공지 수정 | 공지 수정 | `notice.update` | `id`, `text` |
| 공지 삭제 | 공지 삭제 | `notice.delete` | `id` |
| 전달사항 목록 | 전달사항 | `handover.list` | 없음 |
| 전달사항 등록 | 전달사항 등록 | `handover.create` | `text` |
| 전달사항 수정 | 전달사항 수정 | `handover.update` | `id`, `text` |
| 전달사항 삭제 | 전달사항 삭제 | `handover.delete` | `id` |
| 급여 요약 | 급여 요약 | `payroll.summary` | `password` |
| 거래처 목록 | 거래처 목록 | `vendor.list` | 없음 |
| 거래처 등록 | 거래처 등록 | `vendor.create` | `name`, `businessNumber`, `address`, `phone` |
| 거래처 수정 | 거래처 수정 | `vendor.update` | `id`, 변경할 `address`, `phone`, `businessNumber` |
| 거래처 삭제 | 거래처 삭제 | `vendor.delete` | `id` |
| 레시피 목록 | 레시피 목록, 원가 목록 | `recipe.list` | 없음 |
| 레시피 등록 | 레시피 등록, 원가 등록 | `recipe.create` | `name`, `salePrice`, `laborCost`, `overheadCost`, `ingredients` |
| 레시피 수정 | 레시피 수정 | `recipe.update` | `id`, 변경할 값 |
| 레시피 삭제 | 레시피 삭제 | `recipe.delete` | `id` |

## 자연어 명령 예시

파라미터 블록을 많이 만들기 전에는 아래처럼 자연어를 그대로 보내도 됩니다.

```text
오늘 현황
오늘 예약
예약 등록 / 홍길동 / 010-1234-5678 / 오후 / 7:30 / 4명 / 창가
예약 1780000000000 방문완료
예약 삭제 / 1780000000000

오늘 근무표
근무표 추가 / 내일 / 오전 / 홀 / 홍길동
근무표 삭제 / 내일 / 오전 / 홀 / 홍길동

직원 목록
직원 등록 / 홍길동 / 홀 / 시급 10000
직원 수정 / 홍길동 / 연락처 010-0000-0000
직원 삭제 / 홍길동

공지 등록 / 오늘 단체 예약 많으니 세팅 확인
전달사항 등록 / 주방 재료 입고 확인 필요
급여 요약 / 비밀번호 {급여관리 비밀번호}

거래처 등록 / 하늘식자재 / 사업자번호 123-45-67890 / 주소 광주 북구 / 연락처 062-000-0000
레시피 등록 / 김치찌개 / 판매가 32000 / 인건비 3000 / 운영비 2000 / 재료 돼지고기 0.6 12000, 김치 1 4500
```

## 관리자센터 작업 순서

1. 카카오 챗봇 관리자센터에서 스킬을 생성합니다.
2. 스킬 URL에 `kakaoSkill` URL을 등록합니다.
3. "자유 명령" 블록 또는 위 표의 업무별 블록을 만듭니다.
4. 챗봇에서 첫 메시지를 보냅니다.
5. 응답에 표시되는 `botUserKey`를 확인합니다.
6. Firestore `stores/haneulttang/chatbotUsers/{botUserKey}` 문서를 생성합니다.
7. 역할을 `admin`, `manager`, `staff` 중 하나로 넣고 `active: true`로 저장합니다.
8. 다시 챗봇을 호출해 권한별 기능을 테스트합니다.
