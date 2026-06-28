# 하늘땅 카카오 챗봇 시나리오 초안

## 구조

- 카카오 챗봇 관리자센터 스킬 URL → Firebase Functions `kakaoSkill`
- Function → Firestore `stores/haneulttang/*`
- 챗봇 권한 → `stores/haneulttang/chatbotUsers/{botUserKey}`

## 챗봇 사용자 등록

카카오 요청은 Firebase Auth 로그인 상태가 아니므로, 챗봇 사용자는 별도 등록이 필요합니다.

Firestore에 아래 문서를 만듭니다.

경로:

```text
stores/haneulttang/chatbotUsers/{카카오가 알려준 키}
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

역할:

- `admin`: 전체 조회/변경, 급여 요약 가능
- `manager`: 예약, 근무표, 직원 목록, 공지/전달 관리 가능
- `staff`: 예약 조회/등록/상태 변경, 본인 근무표, 전달사항 가능

## 스킬 서버 보안

스킬 URL에는 비밀값을 붙이거나 헤더를 설정합니다.

```text
https://{region}-{project}.cloudfunctions.net/kakaoSkill?secret={KAKAO_SKILL_SECRET}
```

Functions 환경변수 `KAKAO_SKILL_SECRET`가 설정되어 있으면, 값이 맞는 요청만 처리합니다.

## 공통 파라미터

챗봇 관리자센터 블록에서 아래 파라미터를 재사용합니다.

| 파라미터 | 용도 |
| --- | --- |
| `action` | 수행 작업. 예: `예약등록`, `오늘현황` |
| `date` | 날짜. 예: `오늘`, `내일`, `2026-06-28`, `6/28` |
| `period` | `오전` 또는 `오후` |
| `time` | 수기 시간. 예: `7:30`, `730` |
| `name` | 예약자/직원 이름 |
| `phone` | 예약 연락처 |
| `people` | 예약 인원 |
| `seat` | 좌석 수기 입력 |
| `status` | 예약 상태. 예: `방문완료`, `취소` |
| `id` | 예약번호 |
| `text` | 공지/전달사항 내용 |
| `password` | 급여 요약 비밀번호 |

## 1차 시나리오

### 오늘 현황

발화 예시:

- 오늘 현황
- 대시보드
- 요약

응답:

- 오늘 예약 건수
- 오늘 근무 배치 건수
- 직원 수
- 확인 필요한 근무기록 수

### 예약 조회

발화 예시:

- 오늘 예약
- 내일 예약
- 6/28 오후 예약

필요 파라미터:

- `date`
- `period` 선택
- `status` 선택

### 예약 등록

발화 예시:

- 예약 등록
- 오늘 오후 7시 30분 홍길동 4명 창가 예약

필수 파라미터:

- `name`
- `phone`
- `period`
- `time`

선택 파라미터:

- `date`
- `people`
- `seat`
- `request`

저장 위치:

```text
stores/haneulttang/reservations/{id}
```

### 예약 상태 변경

발화 예시:

- 예약 1780000000000 방문완료
- 예약 1780000000000 취소

필수 파라미터:

- `id`
- `status`

### 근무표 조회

발화 예시:

- 오늘 근무표
- 내일 근무표

관리자/매니저는 전체 근무표를 보고, 실무자는 본인 `employeeId`와 일치하는 근무표만 봅니다.

### 직원 목록

발화 예시:

- 직원 목록
- 직원

권한:

- 관리자/매니저

### 공지/전달사항

발화 예시:

- 공지
- 공지 등록
- 전달사항
- 전달사항 등록

권한:

- 공지 등록: 관리자/매니저
- 전달사항 등록: 전체 등록 사용자

### 급여 요약

발화 예시:

- 급여 요약

권한:

- 관리자

필수 파라미터:

- `password`

비밀번호는 앱의 급여관리 비밀번호 문서 `stores/haneulttang/meta/payrollPassword` 값을 사용합니다.

## 챗봇 관리자센터 작업 순서

1. 카카오톡 채널 챗봇 생성
2. 스킬 생성 후 Firebase Functions URL 등록
3. 스킬 테스트에서 `action` 값을 넣고 응답 확인
4. 블록 생성
5. 발화 패턴과 파라미터 연결
6. 각 블록에 같은 스킬을 연결하고 `action` 값만 다르게 전달
7. 실제 카카오톡에서 첫 호출
8. 챗봇이 알려주는 `botUserKey`를 Firestore `chatbotUsers`에 등록

## 다음 단계 후보

- 관리자 화면에서 챗봇 사용자 등록 UI 추가
- 예약 등록 슬롯필링 질문 문구 정리
- 근무표 배치/삭제 챗봇 액션 추가
- 직원 등록/수정/삭제 챗봇 액션 추가
- 버튼형 quickReplies를 블록 연결 방식으로 세분화
