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

채팅창에는 탭이 셋입니다.

- **대화**: 지금 나누는 대화. 우측 위 ＋ 로 새 대화를 시작합니다.
- **업체 기억** (관리자만): 챗봇이 *모든 대화*에서 참고할 사실을 적어 둡니다 — 주차,
  단체 기준, 휴무일 같은 것. `stores/{id}/chatbotMemories` 에 쌓이고, 함수가 admin SDK 로
  읽어 시스템 지시에 싣습니다. 그래서 실무자가 문서를 못 읽어도 답변에는 반영됩니다.
  예약·매출 숫자는 여기 적지 않습니다 — 그건 챗봇이 도구로 직접 확인합니다.
- **이전 대화**: 로그인 사용자별로 쌓입니다. Rules 가 본인 것만 열어 주므로 관리자도
  남의 대화는 못 봅니다. 대화가 한 번 오갈 때마다 `chatConversations` 에 덮어씁니다
  (최근 60개 메시지까지).

```
예: 오늘 현황 알려줘
예: 내일 저녁 7시 김하늘 4명 창가로 예약 등록해줘
예: 이번 주 매출 정리해줘        ← 네이버 플레이스플러스 POS 일 매출 기준
예: 요즘 뭐가 제일 잘 팔려?       ← 매출 내 메뉴 비중 (오너비스타가 넘겨 준 기간 합계)
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

## 네이버 예약 동기화 (오너비스타)

오너비스타가 이 매장의 네이버 예약을 5분마다 모은다(「예약은 5분 고정」). 하늘땅 함수 `syncNaverReservationsScheduled` 가
같은 박자로 5분마다 오너비스타의 「예약 넘기기」 창구(`GET https://ownervista.co.kr/api/partners/naver-bookings`,
`Authorization: Bearer <키>`)에서 지난 7일 ~ 앞으로 31일을 받아 `reservations` 에 옮긴다. 손님이 예약한 뒤 화면에
뜨기까지 길어야 10분 안팎이다(수집 5분 + 당기기 5분). 판단은 `functions/naverReservationSync.js`(순수 함수),
저장은 `functions/index.js` 의 어댑터가 한다. 매시 첫 판과 「지금 받기」는 바뀐 표시가 없어도 예약 문서를 다시 대조한다.

### 설정

0. **먼저 오너비스타가 맞는 매장을 모으는지 본다.** 이 매장 네이버 계정에는 예약 업체가 여럿(본점 둘·진해점 하나)이고,
   2026-10-19 까지 진해점이 잡혀 「성공·0건」이었다. 오너비스타 → 네이버 리포트 → 설정 → 「예약을 가져올 매장」에서
   본점(번호로 고른다 — 같은 이름이 둘)을 골라 두고, 예약 달력에 본점 예약이 뜨는지 확인한 뒤에 넘어간다.
1. **푸시 함수부터 올린다.** `firebase deploy --only functions:onReservationCreatedPush`
   — 동기화가 단 「알리지 말라」 표시(`notifyOnCreate: false`)를 읽는 판이 먼저 떠 있어야 한다. 동기화와 한 명령으로
   올리면 첫 판이 옛 푸시 함수에 걸려 지난 몇 주치 예약이 한 건씩 울릴 수 있다.
2. `firebase deploy --only firestore:rules` (예약 화면의 「네이버」 줄이 상태 문서를 읽는다)
3. 오너비스타 → 네이버 리포트 → 설정 → **다른 프로그램에 예약 넘기기** → 「연결 키 만들기」. 키는 그때 한 번만 보인다.
4. `firebase functions:secrets:set OWNERVISTA_BOOKING_FEED_TOKEN` 에 그 키만 넣는다. (매출 주소의 `OWNERVISTA_FEED_TOKEN` 과 **다른 키**다)
5. `firebase deploy --only functions:syncNaverReservations,functions:syncNaverReservationsScheduled`
6. 예약 화면 맨 위의 「네이버」 줄에서 마지막 확인 시각과 **가져오는 매장(이름·번호)** 을 본다. 관리자는 「지금 받기」로 바로 돌릴 수 있다.

> 이 시크릿이 없으면 `firebase deploy --only functions`(전체)가 이 두 함수에서 값을 묻거나 실패한다. 전체 배포 전에 시크릿부터 만든다.

### 칸마다 주인이 있다

| 칸 | 주인 | 동기화가 하는 일 |
|---|---|---|
| 날짜·시간·인원·이름·연락처·요청사항 | 네이버 | 네이버 값이 **지난번에 옮긴 값과 달라졌을 때만** 덮어쓴다. 직원이 고친 값은 네이버가 그 칸을 다시 바꿀 때까지 남는다 |
| 상태 | 하늘땅 | 처음엔 네이버 상태로(신청→예약대기, 확정→예약확정·8명 이상 단체, 이용완료→방문완료, 노쇼→노쇼). 그 뒤엔 직원이 안 건드렸을 때만 네이버를 따라간다 |
| 좌석·메모·작성자·접수일시 | 하늘땅 | 쓰지 않는다 |

**인원은 실제 일행 수다.** 네이버 예약 수량(`bookingCount`)이 1이고 옵션에 「성인 4」가 붙은 예약은 4명으로 들어온다.
오너비스타가 사람 종류 옵션(성인·어른·아동·어린이·유아 …, 이름이 정확히 같을 때만)을 더해 `partySize` 로 주고,
그것이 없을 때만 예약 수량(+아동 수)을 쓴다. 「유아의자」·「어린이세트」 같은 물건은 사람으로 세지 않는다.

### 연동 전에 손으로 넣어 둔 예약 (입양·중복 확인)

네이버 예약을 **새로 만들기 전에** 같은 날 «네이버와 안 이어진» 예약(직원·카톡·AI 비서, 취소 제외)과 견준다.

- **전화가 같은 예약이 딱 하나** (숫자만 비교, 010 으로 맞춤)**이고 시간 차이가 2시간 안** → 새로 만들지 않고 그 예약에 네이버 번호를 붙인다(**입양**).
  시간·인원·이름·요청사항은 네이버 값으로 맞추고(네이버가 비워 보낸 이름·연락처·요청사항은 지우지 않는다),
  상태·좌석·메모·작성자·문서 번호는 그대로 둔다. 새 예약이 아니라 푸시도 없다.
  **입양한 예약은 그 뒤 네이버 예약이다 — 네이버에서 취소되면 지워진다**(방문완료·노쇼로 마감했으면 남긴다).
- **전화는 같은데 시간이 2시간 넘게 다르면**(점심은 전화, 저녁은 네이버로 잡은 손님) 합치지 않는다 — 합치면 점심 예약 시간이 저녁으로 바뀌어 사라진다. 만들고 표시만.
- **이름만 같거나 전화가 없으면** 합치지 않는다. 네이버 예약을 만들고 `naver.duplicateOf` 로 그 예약을 가리킨다.
- **같은 날 같은 전화가 둘 이상**(손 예약 쪽이든, 이번에 들어온 네이버 예약 쪽이든 — 점심·저녁을 따로 잡은 손님) → 고르지 않고 표시만.

예약 화면은 그 둘에 「**중복 확인 필요**」를 단다(동기화 뒤에 직원이 같은 손님을 또 적은 것도 같은 규칙으로 가리킨다).
같은 예약이면 사람이 직접 적은 쪽을 지운다. 다른 손님이면 「다른 예약입니다」를 누른다(`naver.notDuplicateOf` 에 남고
동기화는 이 칸을 건드리지 않는다).

### 지우는 것과 안 지우는 것

- **지운다**: 네이버가 그 예약번호에 `취소`(RC04)·`변경취소`(RC06)를 돌려줬을 때. 단, 직원이 방문완료·노쇼로 마감한 예약은 남긴다.
- **안 지운다**: 피드에서 안 보이는 예약, 빈 목록·실패·반쪽 응답, 상태를 모르는 예약, 직원·카톡·AI 비서가 만든 예약(`source` 가 `naver` 가 아니다 — 입양한 예약은 예외, 위 참고).
- **네이버 변경**은 새 번호 + 이전 번호 변경취소로 온다. 이전 것은 지워지고 새 것이 만들어진다(새 예약에는 직원이 적은 좌석·메모가 따라가지 않는다).
- **직원이 지운 네이버 예약은 되살리지 않는다** — `naverReservationLinks/{예약번호}` 묘비가 막는다.
- **지난 날짜 예약은 새로 만들지 않는다.** 이미 옮긴 예약이 지난 뒤 취소·노쇼로 바뀌는 것은 따라간다.
- **오너비스타에서 매장을 바꾸면** 예전 매장 예약은 피드에서 사라질 뿐 여기서 지우지 않는다. 예약마다 어느 매장에서 왔는지
  (`naver.businessId`) 적어 두었다가 예약 화면에 「예전 매장」으로 표시한다 — 직원이 확인하고 지운다.

### 푸시

첫 동기화는 하나도 알리지 않는다. 그 뒤로는 새 예약 3건까지 한 건씩, 그보다 많으면 「네이버 예약 N건이 새로 들어왔습니다」 한 통.
시각이 이미 지난 예약·이용완료·노쇼는 알리지 않는다. 동기화가 만든 문서의 `notifyOnCreate: false` 를 `onReservationCreatedPush` 가 본다.
30분 전 알림은 네이버 예약에도 그대로 간다.

```bash
cd functions && npm run test:naver   # 생성·수정·취소 삭제·사라짐·변경·손 예약(입양·중복 확인)·일행 수·직원 값·푸시
npm run test:naver                   # 예약 화면의 「중복 확인 필요」·「다른 예약입니다」
```

## 확정 예약 알림톡 (하늘땅 → 오너비스타)

반대 방향이다. 네이버 예약은 오너비스타 자동알림이 「예약 확정 안내」를 보낸다. **하늘땅에서 넣은 예약**(직원 입력·카톡 빠른 예약·
AI 비서)도 같은 문구를 받게, 예약이 **확정이 되는 순간** 한 건을 오너비스타 `POST /api/partners/booking-alimtalk` 에 넘기고
오너비스타가 네이버 자동알림의 「확정」 문구로 보낸다(`functions/reservationAlimtalk.js` · `reservationAlimtalk` 함수).

- 사장님 결정(2026-10-27): **확정 예약 전부**(예약확정·단체, 휴대폰 번호 있는 것) · **처음 한 번만**(고치거나 취소해도 다시 안 보냄).
- «확정이 되는 순간» = 확정으로 새로 넣었거나, 예약대기·확인전화필요에서 확정으로 바뀌었을 때. 이미 확정이던 예약을 고친 것은
  아니다 — 이 기능 전에 넣은 확정 예약은 메모를 고쳐도 뒤늦게 안 나간다. 네이버 예약(`source: "naver"`, 입양 포함)은 건드리지 않는다.
- 지난 예약·휴대폰 번호 없음은 안 보내고 까닭만 예약에 적는다(번호를 채워 다시 확정하면 보낸다).
- 한 번만: 함수 전용 `reservationAlimtalks/{예약번호}` 를 만들면서 차지한다. 오너비스타도 같은 예약번호는 한 번만 받는다 —
  못 닿으면 한 번 더 불러도 두 번 나가지 않는다.
- 결과는 예약 문서 `alimtalk`(sent·skipped·failed + 까닭·때) — 예약 화면 상세의 「확정 알림톡」 줄.
- 연결 키는 예약 넘기기와 같다(`OWNERVISTA_BOOKING_FEED_TOKEN`). 실제로 나가려면 오너비스타 포털 「다른 프로그램에 예약 넘기기」
  카드에서 **「저쪽에서 넣은 확정 예약에도 예약 확정 알림톡 보내기」를 켜야 한다**(기본 꺼짐 — 꺼져 있으면 «안 보냄·꺼짐»).

```bash
cd functions && npm run test:alimtalk   # 언제 보내나·한 번만·네이버 제외·휴대폰·지난 예약·재시도·오너비스타 답 적기
```

## 손님 이력 · 일일 정산 인건비 · 손익 고정비 (2026-10-30)

- **손님 이력**(`src/lib/customerHistory.ts`): 같은 전화번호(네이버 중복 확인과 같은 `phoneKey`)의 다른 예약으로
  「방문 7번 · 노쇼 1번 · 마지막 방문 9/14」. 예약 등록 칸의 연락처 밑, 목록 이름 옆 꼬리표(단골 = 다녀감 3번 이상, 노쇼),
  상세의 「손님 이력」 줄. 다녀감 = 방문완료 + 지난 날짜의 예약확정·단체(방문완료를 안 누른 날이 많다). 이름은 안 본다(동명이인).
- **일일 정산 인건비**(`functions/dailyReports.js` `laborCostOf`): 22:30 나챗방 정산에 「인건비 412,000원(매출의 18%)」.
  근무표 기준 추정 — 월급은 하루 몫(월급 ÷ 그 달 날수), 건별수당은 그날 슬롯 수 × 수당, 시급은 슬롯 시간 × 시급.
  급여 정보가 없는 사람은 0원이 아니라 «N명 모름». 200자를 넘으면 직접 입력 매출 → 이번 달 누적 줄부터 뺀다.
- **손익 고정비**(`fixedCosts/{YYYY-MM}`, 관리자만): 손익 탭 「고정비」 카드에 임대료·관리비·공과금을 적는다. 비었으면
  «지난달 그대로 가져오기». **적은 달만** 손익에서 빼고, 안 적은 달은 «미입력»(0원으로 빼면 이익이 부풀어 보인다).

```bash
npm run test:history     # 손님 이력 — 번호 모양이 달라도 같은 손님, 이름만 같으면 다른 손님, 자기 자신은 안 셈
npm run test:fixedcost   # 고정비 저장 모양·합계·지난달·규칙 상한
cd functions && npm run test:daily   # 정산 글(인건비 줄 포함)·하루 한 번·시험 발송
```

## Firestore 컬렉션 구조

```
stores/{storeId}                      # 기본 storeId: haneulttang
  ├─ employees/{empId}                # name, role, roleLabel, employmentType,
  │                                   # salaryType(monthly|hourly|perSlot), hourly,
  │                                   # monthlySalary, slotRate, active
  ├─ reservations/{id}                # date, time, name, phone, people, seat,
  │                                   # request, status, memo, writer
  │                                   # 네이버 예약이면 id = 9000000000000000 + 예약번호,
  │                                   # source:"naver", naver{bookingId, status, synced…}
  │                                   # (입양한 손 예약은 원래 id 그대로, naver.adopted)
  ├─ naverReservationLinks/{예약번호}  # 네이버 예약 묘비 (함수 전용) — 지운 예약을 되살리지 않는다,
  │                                   # 예약 문서 번호(reservationId)를 가리킨다
  ├─ meta/naverReservationSync        # 네이버 예약 동기화 상태 (마지막 확인·건수·실패 사유)
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
  ├─ handovers/{auto}                 # text, date, createdBy
  ├─ recipes/{id}                     # name, category, kind(menu|side), servings, salePrice,
  │                                   # ingredients[{name, quantity, unit(g|kg|ml|L|박스|ea), unitCost, note?}]
  ├─ salesDailySummaries/{YYYY-MM-DD} # 네이버 플레이스플러스 일 매출 (오너비스타 피드) + okpos 칸(OK포스 엑셀, 있으면 이게 그날 매출)
  ├─ meta/checklistTemplate          # 체크리스트 항목 (오픈·마감, 매일/매주 요일) — 관리자만 고침
  ├─ checklistDays/{YYYY-MM-DD}      # 그날 체크(checks.{항목id})·특이사항·나챗방 보낸 기록
  ├─ kakaoMemoLinks/{카카오id}        # 나챗방 받는 곳 (관리자만 읽음, 쓰기는 함수)
  ├─ kakaoMemoTokens/{카카오id}       # 카카오 토큰 — 화면 접근 불가, 함수 전용
  ├─ kakaoMemoInvites/{토큰}          # 나챗방 연결 링크 (일회용, 24시간) — 함수 전용
  │                                   # netAmount, orderCount(아는 날만), source, syncedAt
  ├─ salesMenuReports/latest          # 매출 내 메뉴 비중 (기간 합계 한 장)
  │                                   # startDate, endDate, overallSales,
  │                                   # menus[{menuId, menuName, categoryName, sales, sharePercent}]
  └─ salesSyncRuns/{id}               # 오너비스타 동기화 기록

users/{uid}                           # name, role, storeId, employeeId, active
```

모든 문서에 `createdAt`/`updatedAt`(serverTimestamp)이 기록됩니다.

### 레시피 원가

- **단위는 여섯 개 중에서 고른다**: g · kg · ml · L · 박스 · ea. 레시피 재료와 재고 품목이 같은 표를 쓴다(`src/data/units.ts`).
  단위를 바꾸면 수량과 단가가 같이 환산돼 재료비는 그대로다(0.6kg × 12,000원 = 600g × 12원).
- **판매 메뉴와 기본 상차림을 가른다**. 김반찬·겉절이·쌈장은 판매가가 없으니 원가만 본다.
  원가율(재료비 ÷ 판매가)은 판매가가 있는 메뉴에서만 나온다. 인건비·운영비 배분은 없다.
- **1회(1인분) 원가는 횟수나 양으로 낸다**. 「제공 횟수」 옆 단위에서 회(인분)를 고르면 전체 원가 ÷ 횟수,
  g·kg·ml·L 를 고르면 한 번 담는 양으로 적어 전체 원가 × 1회 제공량 ÷ 산출량(깻잎소스 12kg 중 50g → 240번).
  산출량이 없거나 계열이 다르면(2L 에 50g) 나눌 수 없어 저장하지 않는다. 저장할 때 `servings` 에는 산출량 ÷ 1회 제공량을
  다시 적어, 이 계산을 모르는 곳도 같은 횟수를 본다(`servingUnit`·`servingAmount`, `src/lib/recipeCost.ts`).
- **엑셀에서 옮기기**: `python3 scripts/import-recipes-xlsx.py 원가재고관리.xlsx` 가 `src/data/seed/haneulttang-recipes.json` 을 만들고
  (데모 모드 샘플로도 쓰인다), `GOOGLE_APPLICATION_CREDENTIALS=… node scripts/upload-recipes.mjs` 가 Firestore 에 넣는다.
  이미 있는 이름은 건드리지 않는다. 숫자로 못 옮긴 수량은 재료의 `note` 에 원문을 남긴다.

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
  naverReservationSync.js 네이버 예약 → 하늘땅 예약 판단 (순수 함수, Firebase 모름)
  scripts/               배포 없이 도는 점검 스크립트
```

## 점검 스크립트

```bash
npm run test:pos              # POS 매출 집계 로직 (브라우저·Firebase 없이)
npm run test:attendance       # 출퇴근·휴게 계산 (상태 전이, 자정 넘김, 잘못 누른 기록)
npm run test:naver            # 예약 화면의 네이버 예약 표시 (중복 확인 필요·다른 예약입니다)

# 조회용 (읽기 전용, 서비스 계정 필요)
GOOGLE_APPLICATION_CREDENTIALS=<서비스계정.json> node scripts/check-granter-banks.mjs
#   그랜터가 받아온 계좌 거래에 어느 은행이 들어 있는지 센다. --샘플 로 원본 한 건을 본다.
cd functions && npm run test:chat   # Gemini 챗봇 도구 레이어
cd functions && npm run test:kakao  # 카카오 빠른 예약 파서 (9/5 18시 3명 박현제 45184312)
cd functions && npm run test:naver  # 네이버 예약 동기화 (무엇을 지우고 무엇을 절대 안 지우는가)
```

## 역할

- **실무자**: 오늘 오전/오후 슬롯 확인, 출/퇴근(attendanceLogs 기록), 예약 확인·상태 변경, 슬롯 기준 근무기록 작성, 전달사항
- **관리자**: 대시보드 KPI, 예약 등록/수정, 주간 슬롯 근무표 편집(요일별 오전/오후·홀/주방), 근무기록 승인, 급여 승인/확정

### 매니저·실무자 권한 (관리자 모드 → 🛡️ 권한 설정)

- **매니저 권한**(`meta/managerPermissions`)과 **실무자 권한**(`meta/staffPermissions`)을 같은 탭에서 고른다. 열쇠는 같은 이름
  (scheduleManage·employees·sales·vendors·inventory·settlements·recipes·notices·guide)이고, 메뉴·주소·데이터 구독은
  `canAccess(열쇠)`(= `src/config/staffPermissions.ts` 의 `roleCan`) 하나로, Firestore 규칙은 `granted(storeId, 열쇠)`(매니저 또는 실무자)로 본다.
- 실무자 **기본 화면**(대시보드·오늘 예약·근무표(본인)·근무기록·체크리스트)은 끌 수 없고, 실무자 권한은 그 위에 화면을 **더 연다**. 처음엔 전부 꺼짐.
- 실무자 열쇠에는 `dashboard`·`reservations` 가 없다 — 실무자가 예약을 지우게 되는 길은 없다(지우기는 관리자·예약 권한 매니저).
- 「근무표 관리」를 받은 실무자는 매니저처럼 전체 근무표를 본다(안 받으면 본인 것만). 「직원 관리」는 주민등록번호·계좌가 보이니 주의.
- 열어 준 화면은 실무자 사이드바와 ☰ 전체 메뉴에 붙는다(휴대폰 아래 탭은 기본 다섯 개 그대로).

```bash
npm run test:permissions   # 역할별로 열리는 화면, 실무자에게 예약 지우기 없음, 화면 열쇠 = 규칙 열쇠
```
