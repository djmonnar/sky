# 하늘땅 카카오 챗봇 연결 가이드

## 구조

- 카카오 챗봇 관리자센터 스킬 URL: Firebase Functions `kakaoSkill`
- Firestore 접근 경로: `stores/haneulttang/*`
- 챗봇 사용자 권한: `stores/haneulttang/chatbotUsers/{botUserKey}`

## 배포 상태

Functions 배포 명령:

```bash
firebase deploy --only functions --project skyearth-84a78
```

현재 `skyearth-84a78` 프로젝트는 Blaze 요금제가 아니라서 Functions 배포가 막힙니다.
Firebase가 `artifactregistry.googleapis.com` API를 켜야 하는데, 이 API는 Blaze(pay-as-you-go) 업그레이드가 필요합니다.

업그레이드 후 같은 명령을 다시 실행하면 됩니다.

## 스킬 URL

배포 후 카카오 챗봇 관리자센터에 아래 URL을 등록합니다.

```text
https://asia-northeast3-skyearth-84a78.cloudfunctions.net/kakaoSkill
```

비밀값을 사용할 경우:

```text
https://asia-northeast3-skyearth-84a78.cloudfunctions.net/kakaoSkill?secret={KAKAO_SKILL_SECRET}
```

`KAKAO_SKILL_SECRET` 환경변수가 설정되어 있으면, 같은 secret이 들어온 요청만 처리합니다.

## 챗봇 사용자 등록

카카오 요청은 Firebase Auth 로그인 상태가 아니므로 챗봇 사용자는 별도로 등록해야 합니다.
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

## 공통 파라미터

| 파라미터 | 용도 |
| --- | --- |
| `action` | 수행 작업 |
| `date` | 오늘, 내일, 2026-06-28, 6/28 |
| `period` | 오전 또는 오후 |
| `time` | 7:30, 730 |
| `id` | 문서/예약/직원/거래처/레시피 번호 |
| `name` | 이름, 예약자, 직원명, 거래처명, 레시피명 |
| `phone` | 연락처 |
| `people` | 예약 인원 |
| `seat` | 좌석 |
| `status` | 예약확정, 방문완료, 취소, 노쇼, 단체, 확인전화필요, 예약대기 |
| `text` | 공지/전달사항 내용 |
| `password` | 급여 요약 비밀번호 |

## 지원 액션

### 현황

- 오늘 현황
- 대시보드
- 요약

### 예약

- 예약 목록
- 예약 등록
- 예약 수정
- 예약 상태 변경
- 예약 삭제

예시:

```text
예약 등록 / 홍길동 / 010-1234-5678 / 오후 / 7:30 / 4명 / 창가
예약 수정 / 1780000000000 / 오후 / 8:00 / 룸1
예약 1780000000000 방문완료
예약 삭제 / 1780000000000
```

### 근무표

- 오늘 근무표
- 근무표 추가
- 근무표 삭제

예시:

```text
근무표 추가 / 내일 / 오전 / 홀 / 홍길동
근무표 삭제 / 내일 / 오전 / 홀 / 홍길동
```

### 직원

- 직원 목록
- 직원 등록
- 직원 수정
- 직원 삭제

예시:

```text
직원 등록 / 홍길동 / 홀 / 시급 10000
직원 수정 / 홍길동 / 연락처 010-0000-0000
직원 삭제 / 홍길동
```

### 공지/전달사항

- 공지 목록
- 공지 등록/수정/삭제
- 전달사항 목록
- 전달사항 등록/수정/삭제

예시:

```text
공지 등록 / 오늘 단체 예약 많으니 세팅 확인
전달사항 등록 / 주방 재료 입고 확인 필요
공지 삭제 / 1780000000000
```

### 급여

- 급여 요약

예시:

```text
급여 요약 / 비밀번호 qaz@qwer4312
```

### 거래처

- 거래처 목록
- 거래처 등록
- 거래처 수정
- 거래처 삭제

예시:

```text
거래처 등록 / 하늘식자재 / 사업자번호 123-45-67890 / 주소 광주 북구 / 연락처 062-000-0000
거래처 수정 / 1 / 주소 광주 서구
거래처 삭제 / 1
```

### 레시피/원가

- 레시피 목록
- 레시피 등록
- 레시피 수정
- 레시피 삭제

예시:

```text
레시피 등록 / 김치찌개 / 판매가 32000 / 인건비 3000 / 운영비 2000 / 재료 돼지고기 0.6 12000, 김치 1 4500
레시피 수정 / 1 / 판매가 35000
레시피 삭제 / 1
```

## 카카오 관리자센터 작업 순서

1. Firebase 프로젝트를 Blaze 요금제로 업그레이드
2. `firebase deploy --only functions --project skyearth-84a78` 실행
3. 카카오 챗봇 관리자센터에서 스킬 생성
4. 스킬 URL에 `kakaoSkill` URL 등록
5. 챗봇에서 첫 메시지 전송
6. 응답에 표시되는 `botUserKey` 확인
7. Firestore `stores/haneulttang/chatbotUsers/{botUserKey}` 문서 생성
8. 다시 챗봇 호출 후 권한별 기능 테스트
