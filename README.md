# 🌿 하늘땅 매장관리

진해 식당 "하늘땅"의 내부 운영용 웹앱입니다.
근무표 · 예약 · 근무기록 · 급여를 한 곳에서 관리합니다.

- **배포**: https://sky-two-mu.vercel.app
- **스택**: Vite + React 18 + TypeScript + Firebase (Firestore / Auth)

## 실행

```bash
npm install
cp .env.example .env   # Firebase 값 채우기 (아래 참고)
npm run dev
```

`.env` 없이 실행하면 자동으로 **데모 모드**(목업 데이터 + 역할 전환)로 동작합니다.

## 동작 모드

| 모드 | 조건 | 데이터 | 로그인 |
|---|---|---|---|
| **데모** | Firebase 환경변수 없음 또는 `VITE_DEMO_MODE=true` | 목업 (새로고침 시 초기화) | 없음 — 사이드바에서 역할 전환 |
| **라이브** | Firebase 환경변수 설정됨 | Firestore 실시간 구독 | Email/Password, `users/{uid}.role`로 역할 결정 |

## Firebase 설정 방법

1. **웹 앱 등록**: Firebase 콘솔 → 프로젝트 설정 → 일반 → 내 앱 → 웹 앱 추가 → SDK 구성값을 `.env`에 복사
2. **Authentication**: 빌드 → Authentication → 로그인 방법 → **이메일/비밀번호** 사용 설정
3. **Firestore**: 빌드 → Firestore Database → 데이터베이스 만들기 (프로덕션 모드)
4. **보안 규칙 배포**: 콘솔의 규칙 탭에 [firestore.rules](firestore.rules) 내용을 붙여넣거나
   ```bash
   firebase deploy --only firestore:rules
   ```
5. **회원가입/사용자 프로필**: 직원은 `/signup`에서 직접 가입할 수 있습니다. 가입 계정은 항상 `staff`로 생성되고, 관리자 승격은 Firebase 콘솔에서 `users/{uid}.role`을 `admin`으로 바꿔 처리합니다.
   ```
   name: "김현지"
   role: "staff"          // 회원가입은 staff만 생성
   storeId: "haneulttang"
   employeeId: 5          // employees 문서의 id와 연결
   active: true
   ```
6. **초기 데이터**: admin 계정으로 로그인하면 관리자 대시보드에 **"데모 데이터로 시작하기"** 버튼이 나타납니다 (개발 모드에서는 콘솔에서 `seedFirestore()` 실행도 가능). 직원 데이터가 이미 있으면 중복 생성하지 않습니다.

> ⚠️ `VITE_FIREBASE_API_KEY`는 공개되는 웹 식별자입니다. 다만 **Admin SDK 서비스 계정 키(private key)는 절대 프론트 코드/레포에 넣지 마세요.** 데이터 보호는 Security Rules가 담당합니다.

## Vercel 환경변수 등록

Vercel 대시보드 → 프로젝트(sky) → Settings → **Environment Variables**에서 아래 키를 Production/Preview에 추가한 뒤 재배포:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_STORE_ID   (선택, 기본 haneulttang)
```

CLI로도 가능: `npx vercel env add VITE_FIREBASE_API_KEY production`
(이 레포는 GitHub 연동이 되어 있어 `main` 푸시 시 자동 배포됩니다.)

또한 Firebase 콘솔 → Authentication → 설정 → **승인된 도메인**에 `sky-two-mu.vercel.app`을 추가해야 배포 환경에서 로그인이 됩니다.

## 대시보드 Gemini 챗봇

모든 화면 우하단의 💬 버튼을 누르면 채팅창이 열립니다. 말로 예약을 등록하거나
매출을 뽑아볼 수 있습니다.

```
예: 오늘 현황 알려줘
예: 내일 저녁 7시 김하늘 4명 창가로 예약 등록해줘
예: 이번 주 매출 정리해줘        ← 네이버 플레이스플러스 POS 일 매출 기준
예: 오늘 근무표 보여줘
예: 전달사항 등록해줘 — 주방 재료 입고 확인
```

### 설정

Gemini API 키는 **프론트엔드에 두지 않습니다.** Google AI Studio에서 발급받은 키를
Firebase Secret Manager에 등록하고 함수를 배포하세요.

```bash
firebase functions:secrets:set GEMINI_API_KEY
firebase deploy --only functions:geminiChat
```

### 모델

기본값은 **`gemini-3.5-flash`** 이고, `functions/.env`에 `GEMINI_MODEL`을 적으면 바꿀 수 있습니다.

```bash
echo "GEMINI_MODEL=gemini-3.5-flash-lite" >> functions/.env
firebase deploy --only functions:geminiChat
```

- **모델 ID는 고정입니다.** Google이 새 모델을 내놔도 `gemini-3.5-flash`를 지정한 이상
  그 모델이 계속 쓰입니다. 자동으로 갈아타지 않습니다.
- 언젠가 이 모델이 **은퇴**하면 API가 404를 돌려줍니다. 그때는 코드를 고칠 필요 없이
  `GEMINI_MODEL`만 새 ID로 바꿔 재배포하면 됩니다. 챗봇도 "모델을 찾을 수 없습니다,
  GEMINI_MODEL을 지정해주세요"라고 원인을 그대로 알려줍니다.
- Gemini 3.x는 함수 호출 시 응답에 실린 `thoughtSignature`를 다음 요청에 **그대로**
  돌려줘야 합니다(안 그러면 400). 이 코드는 모델 응답 파트를 원본 그대로 히스토리에
  넣어 이 요건을 지키며, `npm run test:chat`이 회귀를 막습니다.
- 무료 등급은 대략 15 RPM / 1,500 RPD 수준이라 매장 한 곳 내부용으로는 충분합니다.
  (정확한 한도는 Google AI Studio 대시보드에서 확인하세요.)

### 동작 방식

```
브라우저 ChatWidget ──(Firebase ID 토큰 + 대화 내용)──▶ geminiChat Function
                                                          │  GEMINI_API_KEY (Secret)
                                                          │  권한 확인 후 Firestore 읽기/쓰기
                    ◀──(자연어 답변 + 확인 카드 + 매출 카드)──┘
```

- **조회**는 바로 실행됩니다: 오늘 현황, 예약, 매출 보고서, 근무표, 근무기록, 공지·전달사항, 직원 목록
- **등록·수정은 곧바로 저장되지 않습니다.** 확인 카드를 띄우고 사용자가 확인 버튼을
  눌러야 Firestore에 반영됩니다. AI가 날짜나 인원을 잘못 알아들어도 데이터가 오염되지 않습니다.
- 확인 버튼을 눌렀을 때도 서버가 **ID 토큰으로 권한을 다시 검증**한 뒤 저장합니다.
  (Functions는 Admin SDK로 동작해 `firestore.rules`를 우회하므로, 권한 검사는 함수 코드가 담당합니다.)

### 권한

| 역할 | 조회 | 등록·수정 |
|---|---|---|
| 관리자 · 매니저 | 전체 | 예약 등록/수정, 공지·전달사항 등록 |
| 실무자 | 예약, 공지·전달사항, **본인** 근무표·근무기록 | 전달사항 등록만 |

실무자에게는 매출·직원 도구가 아예 선언되지 않으며, 억지로 호출해도 서버에서 거부됩니다.

### 개인정보

예약 조회 결과를 모델에 넘길 때 **전화번호는 가운데 자리를 가려서**(`010-****-5678`)
전달합니다. 원본은 Firestore에만 저장됩니다. 다만 사용자가 채팅창에 직접 입력한 번호는
그대로 전달되므로, 무료 등급 약관(입력 데이터의 모델 개선 활용 여부)을 확인하고 쓰세요.

### 점검

배포 없이 도구 레이어를 검증할 수 있습니다.

```bash
cd functions && npm run test:chat
```

## Firestore 컬렉션 구조

```
stores/{storeId}                      # 기본 storeId: haneulttang
  ├─ employees/{empId}                # name, role, roleLabel, employmentType,
  │                                   # salaryType(monthly|hourly|perSlot), hourly,
  │                                   # monthlySalary, slotRate, active
  ├─ reservations/{id}                # date, time, name, phone, people, seat,
  │                                   # request, status, memo, writer
  ├─ shifts/{date_period_department_employeeId_order}
  │                                   # date, dayIndex(0=월), period(morning|afternoon),
  │                                   # department(hall|kitchen), employeeId, employeeName,
  │                                   # roleLabel, order, optional start/end/breakMin
  ├─ workRecords/{id}                 # empId, date, periods, departments, slotSummary,
  │                                   # optional plan/actual 시간, note, handover,
  │                                   # checklist, status
  ├─ attendanceLogs/{auto}            # empId, date, type(in|out), time — 수정 불가
  ├─ payroll/{empId}                  # month, hours, base, extra, deduct, status...
  ├─ notices/{id}                     # text, date, pinned
  └─ handovers/{auto}                 # text, date, createdBy

users/{uid}                           # name, role, storeId, employeeId, active
```

모든 문서에 `createdAt`/`updatedAt`(serverTimestamp)이 기록됩니다.

## 보안 규칙 요약 ([firestore.rules](firestore.rules))

- 비로그인: 전체 차단
- `users/{uid}`: 본인만 읽기, 회원가입 직후 본인 문서 `create`만 허용
  (`role=staff`, `storeId=haneulttang`, `active=true`, `employeeId` 숫자)
- **admin**: 자기 storeId 전체 읽기/쓰기
- **staff**: 예약·공지·전달사항·직원목록 읽기 / 본인 근무표·근무기록만 읽기 /
  예약 등록·상태변경·메모, 본인 근무기록 작성, 전달사항 등록 가능
- 급여: admin 전체, staff는 본인 문서만 읽기 허용 (추후 "내 급여" 화면용 구조)
- 출퇴근 로그는 생성만 가능, 수정/삭제 불가

## 아키텍처

```
src/
  lib/firebase.ts        Firebase 초기화 (환경변수 누락 시 데모 모드 안내)
  lib/time.ts            날짜·시간 유틸
  types/firestore.ts     Firestore 문서 타입, UserProfile
  services/auth.ts       로그인/로그아웃/프로필 조회
  services/firestore.ts  실시간 구독(onSnapshot) + 쓰기 함수
  data/                  도메인 타입 + 목업 seed (데모 모드 fallback)
  dev/seedFirestore.ts   초기 데이터 seed (admin 전용, 중복 방지)
  store.tsx              전역 상태 — 데모/라이브 모드 분기, 구독 관리
  services/chat.ts       Gemini 챗봇 호출 (키 없이 토큰만 전송)
  components/ChatWidget  대시보드 플로팅 챗봇 UI + 확인 카드
  lib/posSales.ts        POS 일 매출 집계 (주·월 묶기, 기간 합계, 달력 격자) — 순수 함수
  components/PosSalesBoard  POS 매출 화면: 달력 드래그 선택, 일/주/월, 기간 상세
  pages/ components/     UI (디자인 시스템: 흰 바탕 + 검정 포인트, 상태색은 배지·추세에만)

functions/
  index.js               카카오 스킬, 푸시, OK포스·그랜터 동기화, geminiChat 엔드포인트
  geminiChat.js          Gemini 도구 레이어 (조회 즉시 실행 / 쓰기는 확인 후 저장)
  scripts/               배포 없이 도는 점검 스크립트
```

## 점검 스크립트

```bash
npm run test:pos              # POS 매출 집계 로직 (브라우저·Firebase 없이)
cd functions && npm run test:chat   # Gemini 챗봇 도구 레이어
cd functions && npm run test:kakao  # 카카오 빠른 예약 파서 (9/5 18시 3명 박현제 45184312)
```

## 역할

- **실무자**: 오늘 오전/오후 슬롯 확인, 출/퇴근(attendanceLogs 기록), 예약 확인·상태 변경, 슬롯 기준 근무기록 작성, 전달사항
- **관리자**: 대시보드 KPI, 예약 등록/수정, 주간 슬롯 근무표 편집(요일별 오전/오후·홀/주방), 근무기록 승인, 급여 승인/확정
