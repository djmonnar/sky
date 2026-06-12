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
  pages/ components/     UI (디자인 시스템: 크림 배경 + 딥그린, 버튼형 시간 입력)
```

## 역할

- **실무자**: 오늘 오전/오후 슬롯 확인, 출/퇴근(attendanceLogs 기록), 예약 확인·상태 변경, 슬롯 기준 근무기록 작성, 전달사항
- **관리자**: 대시보드 KPI, 예약 등록/수정, 주간 슬롯 근무표 편집(요일별 오전/오후·홀/주방), 근무기록 승인, 급여 승인/확정
