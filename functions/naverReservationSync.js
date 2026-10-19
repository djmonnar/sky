"use strict";

/**
 * 네이버 예약 → 하늘땅 예약.
 *
 * 오너비스타가 이 매장의 네이버 예약을 5분마다 수집한다. 여기서는 오너비스타의
 * 「예약 넘기기」 창구(`/api/partners/naver-bookings`)가 내준 목록을 받아
 * `stores/haneulttang/reservations` 에 하늘땅 모양으로 옮긴다.
 *
 * **이 파일은 Firebase 를 모른다.** 무엇을 할지는 순수 함수(`planBooking`)가 정하고,
 * 저장은 실행기가 주입받은 저장소(`store`)에 맡긴다. 그래서 운영 예약을 지우는
 * 판단을 Firebase 없이 node 로 검사할 수 있다(`npm run test:naver`).
 *
 * ── 지키는 것 ────────────────────────────────────────────────────────────
 *
 * 1. **네이버에서 온 예약만 건드린다.** 동기화가 만든 문서에는 `source: "naver"` 와
 *    네이버 예약번호(`naver.bookingId`)가 있고, 문서 번호부터 직원이 만드는 예약
 *    (`Date.now()`)과 겹치지 않는 범위다(`naverReservationId`). 열쇠는 예약번호
 *    하나다 — **이름·시각으로 짝을 찾지 않는다.** 같은 손님의 다른 예약까지 지운다.
 *
 * 2. **지우는 것은 네이버가 그 번호에 «취소»를 돌려줬을 때뿐이다.** 목록에서 안
 *    보인다는 것은 아무 뜻도 없다 — 빈 응답·잘린 쪽·수집 실패·연동 해제가 전부
 *    «없음»처럼 보인다(2026-09-06 유려한). 오너비스타도 그 번호를 네이버에 다시
 *    물어 얻은 상태만 저장한다.
 *
 * 3. **네이버 «변경»은 새 번호 생성 + 이전 번호 변경취소(RC06)로 온다.** 둘은 서로
 *    다른 열쇠라 이전 것은 지워지고 새 것은 만들어진다. 겹쳐 남지 않는다.
 *
 * 4. **직원이 정한 운영 값은 되돌리지 않는다.** 칸마다 주인이 있다.
 *
 *    | 칸                                   | 주인    | 동기화가 하는 일                                   |
 *    |--------------------------------------|---------|----------------------------------------------------|
 *    | date · time · people                 | 네이버  | 네이버 값이 **지난번에 옮긴 값과 달라졌을 때만** 덮어쓴다 |
 *    | name · phone · request               | 네이버  | 위와 같다. 오너비스타가 못 읽었으면(봉투) 안 건드린다 |
 *    | status                               | 하늘땅  | 처음 값만 네이버에서 정한다. 그 뒤엔 직원이 안 건드린 경우에만 네이버를 따라간다 |
 *    | seat · memo · writer · createdAt     | 하늘땅  | 쓰지 않는다 (처음 만들 때 빈칸·네이버예약·접수시각) |
 *
 *    직원이 손으로 고친 시각은 네이버가 그 칸을 **다시 바꿀 때까지** 남는다.
 *    네이버가 바꾸면 네이버가 이긴다 — 손님에게 안내되는 것은 네이버 쪽이기 때문이다.
 *
 * 5. **직원이 지운 네이버 예약은 되살리지 않는다.** 네이버에는 여전히 있으니 그냥
 *    두면 다음 동기화가 다시 만든다 — 사장님은 「지웠는데 왜 또 있지」를 겪는다.
 *    그래서 번호마다 묘비(`naverReservationLinks/{예약번호}`)를 남긴다.
 *
 * 6. **푸시 폭탄을 만들지 않는다.** 첫 동기화는 하나도 알리지 않고, 한 번에
 *    여러 건이 새로 들어오면 한 통으로 묶는다. 시각이 이미 지난 예약은 알리지 않는다.
 *
 * 7. **지난 날짜 예약은 새로 만들지 않는다.** 예약 화면은 오늘과 앞날을 보는 곳이고,
 *    지난 예약은 이미 손으로 적어 둔 것과 겹친다. 이미 옮긴 예약이 지난 뒤 취소·노쇼로
 *    바뀌는 것은 따라간다.
 */

const crypto = require("node:crypto");

const NAVER_SOURCE = "naver";
const NAVER_WRITER = "네이버예약";

/**
 * 동기화가 만드는 예약 번호의 바닥.
 *
 * 하늘땅 예약 `id` 는 숫자이고 문서 ID 는 `String(id)` 다. 직원·카톡·AI 비서는
 * `Date.now()`(13자리, 1.7e12 안팎)를 쓴다. 네이버 예약번호에 9천조를 더하면
 * 16자리가 되어 **그 범위와 영영 안 겹친다** — `Date.now()` 가 9e15 에 닿으려면
 * 28만 년이 걸린다.
 *
 * 번호를 따로 매기지 않고 예약번호에서 **계산**하는 이유: 묘비가 없어져도 같은
 * 예약은 같은 문서로 간다. 두 동기화가 겹쳐 돌아도 문서가 둘 생기지 않는다.
 *
 * 12자리 이상이라 카카오 「예약 삭제 9000001234567890」처럼 번호만 적어도 읽힌다
 * (`explicitReservationId` 의 `\d{12,}`).
 */
const NAVER_ID_BASE = 9_000_000_000_000_000;
/** 더해도 안전한 정수(2^53-1) 안에 드는 예약번호 상한. 이보다 크면 만들지 않는다. */
const NAVER_ID_SPAN = 7_000_000_000_000;

/**
 * 오너비스타에 한 번에 달라고 하는 범위.
 *
 * 뒤로 7일은 오너비스타의 평소 재수집 범위와 같다 — 이미 지난 예약이 취소·노쇼로
 * 바뀌는 것을 따라가려면 그만큼은 봐야 한다. 앞으로는 오너비스타가 21일을 모으므로
 * 넉넉히 31일을 묻는다(그 밖은 비어 올 뿐이다).
 */
const FEED_PAST_DAYS = 7;
const FEED_FUTURE_DAYS = 31;

/** 한 번에 이만큼까지는 한 건씩 알린다. 넘으면 한 통으로 묶는다. */
const PUSH_BURST_LIMIT = 3;

/**
 * 손 예약을 입양하려면 시간 차이가 이 안(분)이어야 한다. 같은 손님이 같은 날 점심은 전화로,
 * 저녁은 네이버로 잡을 수 있다 — 시간을 안 보면 저녁 네이버 예약이 점심 손 예약을 가져가
 * 그 시간을 저녁으로 바꾼다(점심 예약이 사라진다). 「같은 고객의 다른 시각 예약을 합치지
 * 않는다」(오너비스타 작업 점검표). 넘으면 만들고 「중복 확인 필요」로 표시만 한다.
 */
const ADOPT_WITHIN_MINUTES = 120;

const NAVER_STATUSES = new Set([
  "requested", "confirmed", "cancelled", "noshowed", "cancelled_by_change", "completed", "unknown",
]);
/** 네이버가 «이 번호는 끝났다»고 말한 상태. 이것만 지울 이유가 된다. */
const CANCELLED_STATUSES = new Set(["cancelled", "cancelled_by_change"]);
/**
 * 직원이 손님을 맞고 나서 적는 결과. 네이버가 나중에 취소로 바꿔도 이 기록은
 * 지우지 않는다 — 다녀간 손님·안 온 손님의 이력이 사라진다.
 */
const FINALIZED_SKY_STATUSES = new Set(["방문완료", "노쇼"]);
/** 네이버가 주인인 칸. 순서는 화면·검사에서 읽기 쉽게. */
const NAVER_OWNED_FIELDS = ["date", "time", "people", "name", "phone", "request"];

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ── 작은 도구 ─────────────────────────────────────────────────────────── */

const KST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

/** 한국 시각의 날짜(`YYYY-MM-DD`)와 시각(`HH:mm`). */
function kstParts(date) {
  const parts = Object.fromEntries(KST_PARTS.formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** 하늘땅 `createdAt` 모양(`YYYY-MM-DD HH:mm`, 한국 시각). 카톡 등록과 같다. */
function kstStamp(date) {
  const { date: day, time } = kstParts(date);
  return `${day} ${time}`;
}

function shiftDate(day, days) {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function text(value, limit) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

function wholeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

/**
 * 네이버 예약번호 → 하늘땅 예약 번호. 범위를 벗어나면 `null` (만들지 않는다).
 */
function naverReservationId(bookingId) {
  if (typeof bookingId !== "string" || !/^\d{1,13}$/.test(bookingId)) return null;
  const number = Number(bookingId);
  if (!Number.isSafeInteger(number) || number <= 0 || number >= NAVER_ID_SPAN) return null;
  const id = NAVER_ID_BASE + number;
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * 오너비스타는 번호를 숫자만(`01012345678`) 준다. 하늘땅은 `010-1234-5678` 로 적는다
 * (카톡 등록의 `normalizePhone` 과 같은 모양). 모르는 모양은 그대로 둔다 — 고치려다
 * 틀린 번호를 만드는 것보다 낫다.
 */
function formatKoreanPhone(raw) {
  const value = text(raw, 40);
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (/^01[016789]\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (/^01[016789]\d{7}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (/^02\d{7}$/.test(digits)) return `02-${digits.slice(2, 5)}-${digits.slice(5)}`;
  if (/^02\d{8}$/.test(digits)) return `02-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (/^0\d{2}\d{7}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (/^0\d{2}\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return value;
}

/**
 * 네이버 상태 → 하늘땅 상태. 처음 만들 때와 «직원이 안 건드린» 상태를 따라갈 때 쓴다.
 *
 * - 신청(확정 대기) → 예약대기
 * - 확정 → 예약확정, 8명 이상이면 단체 (카톡·AI 비서·예약 화면과 같은 규칙)
 * - 이용완료 → 방문완료, 노쇼 → 노쇼
 * - 취소·변경취소·모름 → `null` (상태로 옮기지 않는다. 취소는 지우는 쪽에서 다룬다)
 */
function skyStatusFor(naverStatus, people) {
  if (naverStatus === "requested") return "예약대기";
  if (naverStatus === "confirmed") return Number(people) >= 8 ? "단체" : "예약확정";
  if (naverStatus === "completed") return "방문완료";
  if (naverStatus === "noshowed") return "노쇼";
  return null;
}

function menuSummary(menuItems) {
  return menuItems.map((item) => `${item.name} ${item.count}`).join(" · ");
}

/* ── 피드 읽기 ─────────────────────────────────────────────────────────── */

/**
 * 피드의 예약 한 건을 검사해 우리 모양으로 둔다. 이상하면 `null` — **그 예약은 아무것도
 * 안 한다**(만들지도 지우지도 않는다). 한 건 때문에 나머지를 버리지는 않는다.
 *
 * `customer` 가 `null` 이면 오너비스타가 봉투를 못 푼 것이다. 이름·번호가 «없는»
 * 것과 다르다 — 빈칸으로 덮어쓰면 멀쩡한 이름이 지워진다.
 */
function normalizeFeedBooking(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const bookingId = typeof raw.bookingId === "string" && /^\d{1,20}$/.test(raw.bookingId) ? raw.bookingId : null;
  const status = typeof raw.status === "string" && NAVER_STATUSES.has(raw.status) ? raw.status : null;
  const useDate = typeof raw.useDate === "string" && DAY.test(raw.useDate) ? raw.useDate : null;
  if (!bookingId || !status || !useDate) return null;
  if (raw.useTime !== null && raw.useTime !== undefined && (typeof raw.useTime !== "string" || !TIME.test(raw.useTime))) {
    return null;
  }

  let customer = null;
  if (raw.customer && typeof raw.customer === "object" && !Array.isArray(raw.customer)) {
    customer = {
      name: text(raw.customer.name, 80),
      phone: text(raw.customer.phone, 40),
      requestMessage: text(raw.customer.requestMessage, 1_000),
    };
  }

  const menuItems = Array.isArray(raw.menuItems)
    ? raw.menuItems
      .map((item) => (item && typeof item === "object"
        ? { name: text(item.name, 120), count: wholeNumber(item.count) }
        : null))
      .filter((item) => item && item.name && item.count > 0)
      .slice(0, 20)
    : [];

  return {
    bookingId,
    status,
    statusCode: text(raw.statusCode, 20) ?? "",
    useDate,
    useTime: raw.useTime ?? null,
    headcount: wholeNumber(raw.headcount),
    childCount: wholeNumber(raw.childCount),
    /*
      일행 수. 오너비스타가 옵션 가운데 사람 종류(성인·아동…) 줄을 더한 값이고, 그런 줄이
      없으면 null 이다. 하늘땅은 예약 수량이 늘 1이고 「성인 4」가 따로 와서, 수량만 쓰면
      넷이 오는 예약이 1명이 된다.
    */
    partySize: Number.isInteger(raw.partySize) && raw.partySize > 0 ? raw.partySize : null,
    itemName: text(raw.itemName, 200) ?? "",
    menuItems,
    bookedAt: typeof raw.bookedAt === "string" && Number.isFinite(Date.parse(raw.bookedAt)) ? raw.bookedAt : null,
    customer,
  };
}

/**
 * 피드 응답 전체를 검사한다.
 *
 * **«다 읽었다»는 표시(`complete: true`)가 없으면 아무것도 안 한다.** 잘린 목록으로
 * 움직이면 안 보이는 예약에 대해 틀린 판단을 하게 된다 — 이 동기화는 «안 보임»을
 * 근거로 아무것도 안 하지만, 그래도 반쪽 응답은 반쪽이라고 기록에 남겨야 한다.
 */
function parseFeed(body) {
  if (!body || typeof body !== "object" || body.ok !== true) {
    return { ok: false, message: "오너비스타 예약 응답이 올바르지 않습니다." };
  }
  if (body.version !== 1) {
    return { ok: false, message: `오너비스타 예약 응답 버전(${String(body.version)})을 모릅니다.` };
  }
  if (body.complete !== true || !Array.isArray(body.bookings)) {
    return { ok: false, message: "오너비스타가 예약 목록을 끝까지 주지 않았습니다. 다음 동기화 때 다시 받습니다." };
  }
  const bookings = [];
  const seen = new Set();
  let invalid = 0;
  let duplicated = 0;
  for (const raw of body.bookings) {
    const booking = normalizeFeedBooking(raw);
    if (!booking) {
      invalid += 1;
      continue;
    }
    // 같은 번호가 두 번 오면 어느 쪽이 맞는지 모른다. 먼저 온 것만 쓰고 센다.
    if (seen.has(booking.bookingId)) {
      duplicated += 1;
      continue;
    }
    seen.add(booking.bookingId);
    bookings.push(booking);
  }
  const collection = body.collection && typeof body.collection === "object" ? body.collection : {};
  const lastSuccessfulSyncAt = typeof collection.lastSuccessfulSyncAt === "string" ? collection.lastSuccessfulSyncAt : null;
  return {
    ok: true,
    bookings,
    invalid,
    duplicated,
    ownervista: {
      /*
        어느 네이버 매장 예약인가. 한 계정에 매장이 여럿일 수 있고(하늘땅: 본점 둘·진해점 하나),
        잘못 잡히면 「성공·0건」으로 굳는다. 같은 이름의 본점이 둘이라 번호를 같이 둔다.
      */
      businessId: typeof collection.businessId === "string" && /^\d{1,20}$/.test(collection.businessId)
        ? collection.businessId
        : null,
      businessName: text(collection.businessName, 100),
      lastSuccessfulSyncAt,
      syncFailed: collection.syncFailed === true,
      /*
        **지금 매장을 한 번이라도 모았는가.** 매장을 바꾼 직후에는 마지막 성공 시각이 예전 매장
        것으로 남고 모은 범위만 비어 있다. 그때의 빈 목록은 「예약 없음」이 아니라 「아직 안 모음」이다.
      */
      collected: Boolean(lastSuccessfulSyncAt && collection.lastSyncedRange),
    },
  };
}

/**
 * 네이버가 주인인 값. **모르는 칸은 넣지 않는다** — 시각이 없는 예약, 봉투를 못 푼
 * 손님 정보가 그렇다. 넣지 않은 칸은 동기화가 건드리지 않는다.
 */
function naverOwnedValues(booking) {
  const values = {
    date: booking.useDate,
    // 일행 수가 있으면 그것, 없을 때만 예약 수량(네이버 bookingCount).
    people: booking.partySize ?? booking.headcount + booking.childCount,
  };
  if (booking.useTime) values.time = booking.useTime;
  if (booking.customer) {
    values.name = booking.customer.name ?? "";
    values.phone = formatKoreanPhone(booking.customer.phone);
    values.request = booking.customer.requestMessage ?? "";
  }
  return values;
}

/**
 * 이 예약이 지난번과 같은지 가르는 지문.
 *
 * 묘비에는 **이 지문만** 남긴다. 이름·번호를 묘비에 또 적으면 개인정보 사본이 하나 더
 * 생긴다. 같으면 예약 문서를 읽지도 않는다 — 5분마다 도는데 매번 다 읽을 이유가 없다.
 */
function feedDigest(booking) {
  const material = JSON.stringify([
    booking.status, booking.statusCode, booking.useDate, booking.useTime,
    booking.headcount, booking.childCount, booking.partySize, booking.itemName, menuSummary(booking.menuItems),
    booking.customer
      ? [booking.customer.name, booking.customer.phone, booking.customer.requestMessage]
      : "unreadable",
  ]);
  return crypto.createHash("sha256").update(material).digest("hex");
}

/* ── 한 건 판단 ────────────────────────────────────────────────────────── */

function isOwnNaverReservation(reservation, bookingId) {
  return Boolean(reservation)
    && reservation.source === NAVER_SOURCE
    && reservation.naver
    && String(reservation.naver.bookingId) === bookingId;
}

/** 이미 어떤 네이버 예약과 이어진 하늘땅 예약인가. 이어진 것은 입양·중복 후보가 아니다. */
function isNaverLinked(reservation) {
  return Boolean(reservation)
    && reservation.source === NAVER_SOURCE
    && Boolean(reservation.naver && reservation.naver.bookingId);
}

/**
 * 전화번호를 견주는 열쇠. **숫자만 남기고 010 으로 맞춘다.** 모르는 모양이면 `null` — 견주지 않는다.
 *
 * - `010-1234-5678`·`01012345678`·`+82 10-1234-5678` → `01012345678`
 * - 뒤 8자리만 적은 번호(`1234-5678`) → `010` 을 붙인다. 카톡 빠른 등록이 그렇게 받는다
 *   (`quickReservation.normalizePhone`).
 */
function phoneKey(raw) {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("82") && digits.length >= 10 && digits.length <= 12) digits = `0${digits.slice(2)}`;
  if (digits.length === 8) digits = `010${digits}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return /^0\d{8,10}$/.test(digits) ? digits : null;
}

/** 이름을 견주는 열쇠. 띄어쓰기와 끝의 「님」만 뺀다 — 비슷한 이름을 같다고 우기지 않는다. */
function nameKey(raw) {
  return String(raw ?? "").replace(/\s+/g, "").replace(/님$/, "");
}

/** `HH:mm` 을 자정부터의 분으로. 모르는 모양이면 `null` — 시간이 가깝다고 치지 않는다. */
function minutesOfDay(raw) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(raw ?? "").trim());
  if (!match || Number(match[1]) > 23) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * 네이버 예약을 새로 만들기 전에, 같은 날 손으로 넣어 둔 예약과 견준다.
 *
 * 연동 전에는 사장님이 네이버 예약을 하늘땅에 손으로 옮겨 적었다. 동기화가 켜지면 같은 손님
 * 예약이 둘이 되면 안 된다. 그래서 (사용자와 정한 규칙)
 *   - 같은 날, 네이버와 안 이어진 예약 가운데 **전화가 같은 것이 정확히 한 건**이고 시간 차이가
 *     `ADOPT_WITHIN_MINUTES`(2시간) 안이면 새로 만들지 않고 그 예약에 네이버 번호를 붙인다(입양).
 *   - 그 한 건이 시간이 멀거나(점심 전화·저녁 네이버) 시간을 모르면 합치지 않는다 — 만들고 표시만.
 *   - 전화가 같은 것이 둘 이상이면 고르지 않는다 — 만들고 「중복 확인 필요」로 표시만 한다.
 *   - 거꾸로, 이번 판에 **새로 들어온 네이버 예약 가운데 같은 날 같은 전화가 둘 이상**이면(점심·저녁을
 *     따로 잡은 손님) 손 예약 하나가 어느 쪽 것인지 모른다 — 역시 고르지 않고 표시만 한다.
 *   - 전화가 없거나 이름만 같으면 합치지 않는다 — 만들고 표시만 한다. 지우는 것은 사람이 한다.
 * 취소된 예약(상태 「취소」)은 후보가 아니다.
 *
 * @param {object} values `naverOwnedValues` 의 결과
 * @param {{id: string, data: object}[]} sameDay 같은 날 하늘땅 예약들
 * @param {{ phoneSiblings?: number }} [options] 이번 판의 새 네이버 예약 가운데 같은 날·같은 전화인
 *   것의 수(자기 포함)
 * @returns {{ adopt: {id, data} | null, suspects: {id, data}[], reason: string | null }}
 */
function matchManualReservations(values, sameDay, { phoneSiblings = 1 } = {}) {
  const candidates = (sameDay || []).filter(({ data }) =>
    data && data.date === values.date && !isNaverLinked(data) && data.status !== "취소");
  const key = phoneKey(values.phone);
  const phoneMatches = key ? candidates.filter(({ data }) => phoneKey(data.phone) === key) : [];
  if (phoneMatches.length > 1) return { adopt: null, suspects: phoneMatches, reason: "same-phone-multiple" };
  if (phoneMatches.length === 1 && phoneSiblings > 1) {
    return { adopt: null, suspects: phoneMatches, reason: "same-phone-multiple-naver" };
  }
  if (phoneMatches.length === 1) {
    const naverAt = minutesOfDay(values.time);
    const manualAt = minutesOfDay(phoneMatches[0].data.time);
    if (naverAt === null || manualAt === null || Math.abs(naverAt - manualAt) > ADOPT_WITHIN_MINUTES) {
      return { adopt: null, suspects: phoneMatches, reason: "same-phone-other-time" };
    }
    return { adopt: phoneMatches[0], suspects: [], reason: null };
  }
  const name = nameKey(values.name);
  const nameMatches = name ? candidates.filter(({ data }) => nameKey(data.name) === name) : [];
  if (nameMatches.length > 0) {
    return { adopt: null, suspects: nameMatches, reason: key ? "same-name" : "same-name-no-phone" };
  }
  return { adopt: null, suspects: [], reason: null };
}

/**
 * 예약 문서의 `naver` 칸. `businessId` 는 어느 네이버 매장에서 온 예약인지 — 오너비스타에서
 * 매장을 바꾸면 예전 매장 예약은 피드에서 사라질 뿐 여기서는 지워지지 않으므로(사라짐은
 * 지울 이유가 아니다), 화면이 그것을 「예전 매장」으로 가려 보일 수 있게 적어 둔다.
 */
function naverMeta(booking, synced, businessId) {
  return {
    bookingId: booking.bookingId,
    businessId: businessId ?? null,
    status: booking.status,
    statusCode: booking.statusCode,
    itemName: booking.itemName,
    menu: menuSummary(booking.menuItems),
    synced,
  };
}

/** 네이버 표시를 견줄 때 쓰는 모양. 판마다 바뀌는 저장 시각(`syncedAt`)은 뺀다. */
function naverMetaKey(meta) {
  if (!meta || typeof meta !== "object") return "";
  const synced = meta.synced && typeof meta.synced === "object" ? meta.synced : {};
  return JSON.stringify([
    String(meta.bookingId ?? ""),
    meta.businessId ?? null,
    meta.status ?? null,
    meta.statusCode ?? null,
    meta.itemName ?? null,
    meta.menu ?? null,
    [...NAVER_OWNED_FIELDS, "status"].map((field) => (synced[field] === undefined ? null : synced[field])),
  ]);
}

/**
 * 예약 한 건을 어떻게 할지 정한다. **저장하지 않는다** — 무엇을 쓸지만 돌려준다.
 *
 * @param {object} input
 * @param {object} input.booking      `normalizeFeedBooking` 이 돌려준 것
 * @param {object|null} input.link    묘비 `naverReservationLinks/{예약번호}` (없으면 null)
 * @param {object|null} input.reservation 지금 하늘땅 예약 문서 (없으면 null)
 * @param {string} input.today        한국 날짜 `YYYY-MM-DD`
 * @param {string} input.nowTime      한국 시각 `HH:mm`
 * @param {string} input.nowStamp     접수시각을 모를 때 쓸 `YYYY-MM-DD HH:mm`
 * @param {boolean} input.quiet       이번 판은 새 예약을 하나씩 알리지 않는다
 * @param {string|null} [input.businessId] 피드가 밝힌 네이버 매장 번호 (예약에 적어 둔다)
 * @param {number} [input.reservationId] `reservation` 을 읽은 문서 번호. 입양한 예약은 손으로
 *   넣을 때의 번호 그대로라 계산한 번호와 다르다(묘비의 `reservationId`). 없으면 계산한 번호
 * @param {{id: string, data: object}[]} [input.sameDay] 같은 날 예약들. 새로 만들 때만 견준다
 * @param {number} [input.phoneSiblings] 이번 판의 새 네이버 예약 가운데 같은 날·같은 전화인 것의
 *   수(자기 포함). 둘 이상이면 손 예약을 입양하지 않는다
 *
 * 돌려주는 `action`:
 *   create  새로 만든다 (`reservation` 전체). 같은 날 겹쳐 보이는 손 예약이 있으면 `naver.duplicateOf`
 *   adopt   같은 날 전화가 같은 손 예약 한 건에 네이버 번호를 붙인다 (`reservationId` 가 그 예약)
 *   update  네이버가 바꾼 칸만 고친다 (`patch`). `changedFields` 가 비면 네이버 표시만 새로 적는다
 *   delete  네이버가 취소했다. 지운다
 *   keep    네이버는 취소했지만 직원이 방문완료·노쇼로 마감한 기록이라 남긴다 (네이버 표시만)
 *   forget  우리가 만든 예약을 직원이 지웠다. 묘비만 남기고 되살리지 않는다
 *   touch   예약은 그대로고 묘비의 지문만 새로 적는다
 *   skip    아무것도 안 쓴다 (`reason` 에 까닭. `unchanged` 는 바뀐 것이 없다는 뜻)
 */
function planBooking(input) {
  const {
    booking, link = null, reservation = null, today, nowTime, nowStamp, quiet, businessId = null, sameDay = [],
    phoneSiblings = 1,
  } = input;
  const bookingId = booking.bookingId;
  const computedId = naverReservationId(bookingId);
  // 이미 이어진 예약은 묘비가 가리키는 문서(입양한 예약이면 손으로 넣을 때의 번호)다.
  const reservationId = computedId === null ? null : (input.reservationId ?? computedId);
  const digest = feedDigest(booking);
  const result = (action, reason, extra = {}) => ({
    bookingId,
    reservationId,
    action,
    reason,
    reservation: null,
    patch: null,
    link: null,
    changedFields: [],
    notifyCandidate: false,
    notify: false,
    ...extra,
  });
  const linkWrite = (extra = {}) => ({
    bookingId,
    reservationId,
    digest,
    naverStatus: booking.status,
    ...extra,
  });

  if (reservationId === null) return result("skip", "id-out-of-range");

  // 그 번호 자리에 우리 것이 아닌 문서가 있다. 무엇이든 손대지 않는다.
  if (reservation && !isOwnNaverReservation(reservation, bookingId)) return result("skip", "conflict");

  // 직원이 지웠거나 네이버 취소로 지운 예약. 다시 만들지 않는다.
  if (link && link.state === "removed") return result("skip", "removed");

  const known = (link && link.state === "active") || Boolean(reservation);

  /* ── 처음 보는 예약: 만들지 말지 ── */
  if (!known) {
    if (CANCELLED_STATUSES.has(booking.status)) return result("skip", "cancelled-unseen");
    if (booking.status === "unknown") return result("skip", "unknown-status");
    if (booking.useDate < today) return result("skip", "past");
    if (!booking.useTime) return result("skip", "no-time");
    if (!booking.customer) return result("skip", "unreadable");

    const values = naverOwnedValues(booking);
    const status = skyStatusFor(booking.status, values.people);
    if (!status) return result("skip", "unknown-status");

    /* ── 연동 전에 손으로 넣어 둔 같은 예약이 있는가 ── */
    const match = matchManualReservations(values, sameDay, { phoneSiblings });
    if (match.adopt) {
      /*
        **입양.** 새로 만들지 않고 그 예약에 네이버 번호를 붙인다. 그 뒤로는 네이버 예약이라
        네이버가 바꾸면 따라가고, 네이버가 취소하면 지워진다(같은 예약이니까).

        - 네이버가 주인인 칸(시간·인원·이름·연락처·요청)은 네이버 값으로 맞춘다. 단, 네이버가
          비워 보낸 칸(이름·연락처·요청)은 손으로 적어 둔 값을 지우지 않는다.
        - 하늘땅이 주인인 칸(상태·좌석·메모·작성자·접수일시)은 그대로 둔다. 상태도 직원이 정한
          값을 남긴다 — 그 뒤 네이버를 따라갈지는 평소 규칙(직원이 안 건드렸을 때만)대로다.
        - 새 예약이 아니라서 «새 예약» 푸시도 없다.
      */
      const target = match.adopt;
      const current = target.data;
      const patch = {};
      const changedFields = [];
      for (const field of NAVER_OWNED_FIELDS) {
        if (!(field in values)) continue;
        const value = values[field];
        if ((field === "name" || field === "phone" || field === "request") && !value) continue;
        if (current[field] !== value) {
          patch[field] = value;
          changedFields.push(field);
        }
      }
      patch.source = NAVER_SOURCE;
      patch.naver = {
        ...naverMeta(booking, { ...values, status }, businessId),
        adopted: true,
        adoptedFrom: { source: current.source ?? null, writer: current.writer ?? null },
      };
      const adoptedId = Number(target.id);
      return result("adopt", "same-phone", {
        reservationId: adoptedId,
        patch,
        changedFields,
        link: { ...linkWrite({ state: "active", adopted: true }), reservationId: adoptedId },
      });
    }
    const duplicateOf = match.suspects.map(({ id }) => Number(id)).filter((id) => Number.isSafeInteger(id));

    const startsLater = values.date > today || (values.date === today && values.time >= nowTime);
    // 이미 다녀갔거나(이용완료) 안 온(노쇼) 예약은 «새 예약» 알림을 받을 일이 아니다.
    const notifyCandidate = (booking.status === "requested" || booking.status === "confirmed") && startsLater;
    const notify = notifyCandidate && !quiet;
    const createdAt = booking.bookedAt ? kstStamp(new Date(booking.bookedAt)) : nowStamp;
    return result("create", duplicateOf.length > 0 ? "new-duplicate-suspect" : "new", {
      reservation: {
        id: reservationId,
        date: values.date,
        time: values.time,
        name: values.name,
        phone: values.phone,
        people: values.people,
        seat: "",
        request: values.request,
        status,
        memo: "",
        writer: NAVER_WRITER,
        createdAt,
        source: NAVER_SOURCE,
        /*
          `onReservationCreatedPush` 가 이 표시를 본다. false 면 «새 예약» 푸시를 안 보낸다.
          표시가 없는 문서(직원·카톡·AI 비서가 만든 예약)는 예전처럼 알린다.
        */
        notifyOnCreate: notify,
        naver: {
          ...naverMeta(booking, { ...values, status }, businessId),
          /*
            「중복 확인 필요」. 같은 날 손으로 넣은 예약 가운데 이름만 같거나(전화가 없거나 다르다),
            전화가 같은 것이 둘 이상이라 하나를 고를 수 없었다. **합치지도 지우지도 않는다** — 예약
            화면이 이 번호들을 보여 주고, 같은 예약이면 사람이 손 예약 쪽을 지운다.
          */
          ...(duplicateOf.length > 0 ? { duplicateOf, duplicateReason: match.reason } : {}),
        },
      },
      link: linkWrite({ state: "active" }),
      notifyCandidate,
      notify,
    });
  }

  /* ── 우리가 만든 예약인데 지금 없다: 직원이 지웠다 ── */
  if (!reservation) {
    return result("forget", "staff-deleted", {
      link: linkWrite({ state: "removed", removedReason: "sky-deleted" }),
    });
  }

  const lastSynced = (reservation.naver && reservation.naver.synced) || {};

  /*
    **바뀐 것이 없으면 아무것도 쓰지 않는다.** 한 시간에 한 번은 지문이 같아도 다시
    대조하는데(`fullCheck`), 그때마다 모든 예약에 쓰면 쓰기만 늘고 직원 화면이 깜빡인다.
    묘비 지문만 낡았으면 묘비만 고친다.
  */
  const nothingToWrite = (nextMeta) => {
    if (naverMetaKey(reservation.naver) !== naverMetaKey(nextMeta)) return null;
    if (link && link.state === "active" && link.digest === digest) return result("skip", "unchanged");
    return result("touch", "relinked", { link: linkWrite({ state: "active" }) });
  };

  /* ── 네이버가 이 번호를 취소했다 ── */
  if (CANCELLED_STATUSES.has(booking.status)) {
    if (FINALIZED_SKY_STATUSES.has(reservation.status)) {
      const nextMeta = naverMeta(booking, { ...lastSynced }, businessId);
      return nothingToWrite(nextMeta) || result("keep", "finalized", {
        patch: { naver: nextMeta },
        link: linkWrite({ state: "active" }),
      });
    }
    return result("delete", booking.status === "cancelled_by_change" ? "naver-changed" : "naver-cancelled", {
      link: linkWrite({ state: "removed", removedReason: booking.status }),
    });
  }

  /* ── 그대로 있는 예약: 네이버가 바꾼 칸만 따라간다 ── */
  const incoming = naverOwnedValues(booking);
  const nextSynced = { ...lastSynced };
  const patch = {};
  const changedFields = [];
  for (const field of NAVER_OWNED_FIELDS) {
    if (!(field in incoming)) continue; // 모르는 칸 — 건드리지 않는다
    const value = incoming[field];
    const naverChanged = lastSynced[field] === undefined || lastSynced[field] !== value;
    if (!naverChanged) continue; // 네이버가 안 바꿨다. 직원이 고쳤으면 그대로 둔다
    nextSynced[field] = value;
    if (reservation[field] !== value) {
      patch[field] = value;
      changedFields.push(field);
    }
  }

  /*
    상태는 하늘땅 것이다. 네이버 상태가 바뀌었고(신청→확정, 확정→이용완료·노쇼) **직원이
    지난번 옮긴 상태를 그대로 두었을 때만** 따라간다. 직원이 방문완료·노쇼·확인전화필요로
    바꿨다면 그 값이 이긴다.
  */
  const incomingStatus = booking.status === "unknown" ? null : skyStatusFor(booking.status, incoming.people);
  if (incomingStatus && incomingStatus !== lastSynced.status) {
    const staffUntouched = lastSynced.status !== undefined && reservation.status === lastSynced.status;
    nextSynced.status = incomingStatus;
    if (staffUntouched && reservation.status !== incomingStatus) {
      patch.status = incomingStatus;
      changedFields.push("status");
    }
  }

  patch.naver = naverMeta(booking, nextSynced, businessId);
  if (changedFields.length === 0) {
    const same = nothingToWrite(patch.naver);
    if (same) return same;
  }
  return result("update", changedFields.length > 0 ? "naver-changed" : "refreshed", {
    patch,
    changedFields,
    link: linkWrite({ state: "active" }),
  });
}

/**
 * 계획을 **저장 연산 목록**으로 옮긴다. 운영 저장소(Firestore 트랜잭션)와 검사용
 * 메모리 저장소가 둘 다 이 목록을 그대로 실행한다 — 무엇을 쓸지는 여기 한 곳에서만
 * 정한다. 검사가 쓰기를 따로 흉내 내면 계약 검사가 아니라 그림 검사가 된다.
 *
 * - `create`: 문서가 없을 때만 만든다(있으면 트랜잭션이 실패한다)
 * - `merge`: 적은 칸만 고친다(`set(..., { merge: true })`). 직원 칸은 목록에 없으니 안 바뀐다
 * - `delete`: 지운다. **`delete` 계획에서만 나온다**
 *
 * 예약 쪽 연산에는 `docId` 가 붙는다 — 입양한 예약은 손으로 넣을 때의 번호 그대로라,
 * 예약번호에서 계산한 번호가 아니다.
 *
 * @param {object} plan `planBooking` 의 결과
 * @param {{ timestamp: unknown }} options 서버 시각(운영은 serverTimestamp)
 */
function planWrites(plan, { timestamp }) {
  const linkData = plan.link ? { ...plan.link, updatedAt: timestamp } : null;
  const docId = plan.reservationId === null || plan.reservationId === undefined ? null : String(plan.reservationId);
  switch (plan.action) {
    case "create":
      return [
        {
          target: "reservation",
          docId,
          kind: "create",
          data: { ...plan.reservation, updatedAt: timestamp, naver: { ...plan.reservation.naver, syncedAt: timestamp } },
        },
        { target: "link", kind: "merge", data: { ...linkData, createdAt: timestamp } },
      ];
    case "adopt":
      return [
        {
          target: "reservation",
          docId,
          kind: "merge",
          data: {
            ...plan.patch,
            naver: { ...plan.patch.naver, syncedAt: timestamp, adoptedAt: timestamp },
            updatedAt: timestamp,
            updatedBy: NAVER_WRITER,
          },
        },
        { target: "link", kind: "merge", data: { ...linkData, createdAt: timestamp } },
      ];
    case "update":
    case "keep": {
      const changed = plan.changedFields.length > 0;
      return [
        {
          target: "reservation",
          docId,
          kind: "merge",
          data: {
            ...plan.patch,
            naver: { ...plan.patch.naver, syncedAt: timestamp },
            // 직원 화면에서 «누가 마지막에 고쳤나»가 보이게. 네이버 표시만 새로 적을 때는 안 남긴다.
            ...(changed ? { updatedAt: timestamp, updatedBy: NAVER_WRITER } : {}),
          },
        },
        { target: "link", kind: "merge", data: linkData },
      ];
    }
    case "delete":
      return [
        { target: "reservation", docId, kind: "delete" },
        { target: "link", kind: "merge", data: { ...linkData, removedAt: timestamp } },
      ];
    case "forget":
      return [{ target: "link", kind: "merge", data: { ...linkData, removedAt: timestamp } }];
    case "touch":
      return [{ target: "link", kind: "merge", data: linkData }];
    default:
      return [];
  }
}

/**
 * 이번 판에 새 예약을 하나씩 알릴지.
 *
 * - **첫 동기화**: 지난 몇 주치가 한꺼번에 들어온다. 하나도 안 알린다. 예약 화면의
 *   동기화 줄에 몇 건을 가져왔는지 남는다.
 * - **한꺼번에 여러 건**(오너비스타가 멈췄다 살아났을 때 등): 하나씩 울리면 폭탄이다.
 *   한 통으로 묶는다.
 */
function decideQuiet({ bootstrap, notifiableCount, limit = PUSH_BURST_LIMIT }) {
  if (bootstrap) return { quiet: true, reason: "bootstrap", summary: false };
  if (notifiableCount > limit) return { quiet: true, reason: "burst", summary: true };
  return { quiet: false, reason: null, summary: false };
}

/* ── 실행기 ────────────────────────────────────────────────────────────── */

function emptyCounts() {
  return {
    received: 0,
    created: 0,
    adopted: 0,
    flagged: 0,
    updated: 0,
    refreshed: 0,
    deleted: 0,
    kept: 0,
    forgotten: 0,
    unchanged: 0,
    failed: 0,
    skipped: {},
  };
}

function tally(counts, plan) {
  if (plan.action === "create") {
    counts.created += 1;
    if (plan.reservation && plan.reservation.naver && plan.reservation.naver.duplicateOf) counts.flagged += 1;
  } else if (plan.action === "adopt") counts.adopted += 1;
  else if (plan.action === "update") counts[plan.changedFields.length > 0 ? "updated" : "refreshed"] += 1;
  else if (plan.action === "touch") counts.refreshed += 1;
  else if (plan.action === "delete") counts.deleted += 1;
  else if (plan.action === "keep") counts.kept += 1;
  else if (plan.action === "forget") counts.forgotten += 1;
  else if (plan.reason === "unchanged") counts.unchanged += 1;
  else counts.skipped[plan.reason] = (counts.skipped[plan.reason] || 0) + 1;
}

/** 동기화 줄에 쓸 한 문장. 0 인 것은 안 적는다. */
function describeRun(counts, { bootstrap }) {
  const parts = [];
  if (counts.created) parts.push(`새 예약 ${counts.created}건`);
  if (counts.adopted) parts.push(`손으로 적어 둔 예약과 이은 예약 ${counts.adopted}건`);
  if (counts.flagged) parts.push(`손 예약과 겹쳐 보여 「중복 확인 필요」를 단 예약 ${counts.flagged}건`);
  if (counts.updated) parts.push(`바뀐 예약 ${counts.updated}건`);
  if (counts.deleted) parts.push(`취소로 지운 예약 ${counts.deleted}건`);
  if (counts.kept) parts.push(`취소됐지만 방문완료·노쇼라 남긴 예약 ${counts.kept}건`);
  if (counts.forgotten) parts.push(`직원이 지운 예약 ${counts.forgotten}건(다시 만들지 않음)`);
  const skipped = counts.skipped;
  if (skipped.unreadable) parts.push(`손님 정보를 못 읽어 미룬 예약 ${skipped.unreadable}건`);
  if (skipped["no-time"]) parts.push(`시각이 없어 안 가져온 예약 ${skipped["no-time"]}건`);
  if (skipped["unknown-status"]) parts.push(`상태를 모르는 예약 ${skipped["unknown-status"]}건`);
  if (skipped.conflict) parts.push(`번호가 겹쳐 손대지 않은 예약 ${skipped.conflict}건`);
  if (counts.failed) parts.push(`저장하지 못한 예약 ${counts.failed}건(다음에 다시)`);
  const head = bootstrap ? "처음으로 네이버 예약을 가져왔습니다" : "네이버 예약을 확인했습니다";
  return parts.length > 0 ? `${head}: ${parts.join(", ")}.` : `${head}. 바뀐 것이 없습니다.`;
}

/**
 * 동기화 한 판.
 *
 * @param {object} deps
 * @param {(range: {since: string, until: string}) => Promise<object>} deps.fetchFeed
 *   `{ status: "ok", body }` 또는 `{ status: "config_required" | "disabled" | "failed", message }`
 * @param {object} deps.store  저장소 (아래 메서드)
 *   - loadMeta() → 동기화 상태 문서 (없으면 {})
 *   - saveMeta(patch)
 *   - loadLinks(bookingIds) → Map<예약번호, 묘비>
 *   - applyBooking({ bookingId, reservationId, useDate }, decide) → plan
 *       **트랜잭션 안에서** 묘비를 읽고, 묘비가 가리키는 예약 문서(없으면 계산한 번호)를 읽고,
 *       둘 다 없으면 같은 날 예약들을 읽어 `decide({ link, reservation, reservationId, sameDay })`
 *       로 계획을 받고 `planWrites` 그대로 쓴다. 직원이 막 바꾼 값을 옛 값으로 덮지 않고, 같은 날
 *       손 예약을 두 판이 동시에 입양하지 않으려는 것이다.
 * @param {(count: number, runId: string) => Promise<void>} [deps.notifySummary]
 * @param {() => Date} [deps.now]
 */
function createNaverReservationSync(deps) {
  const { fetchFeed, store, notifySummary = async () => {}, now = () => new Date() } = deps;

  /**
   * @param {object} [options]
   * @param {"scheduled" | "manual"} [options.mode]
   * @param {boolean} [options.fullCheck] 지문이 같아도 예약 문서를 다시 대조한다. 예약 화면은
   *   문서를 통째로 다시 쓰므로, 오래 오프라인이던 휴대폰이 옛 시각을 되써 넣을 수 있다 —
   *   지문만 보면 네이버가 또 바꿀 때까지 그 옛 값이 남는다. 바뀐 것이 없으면 아무것도 안 쓴다.
   *   「지금 받기」는 늘 다시 대조한다.
   */
  async function run({ mode = "scheduled", fullCheck = mode === "manual" } = {}) {
    const startedAt = now();
    const { date: today, time: nowTime } = kstParts(startedAt);
    const nowStamp = kstStamp(startedAt);
    const range = { since: shiftDate(today, -FEED_PAST_DAYS), until: shiftDate(today, FEED_FUTURE_DAYS) };
    const runId = `${startedAt.getTime()}-naver-${mode}`;
    const meta = (await store.loadMeta()) || {};
    const bootstrap = !meta.bootstrappedAt;

    const failed = async (status, message) => {
      await store.saveMeta({ status, message, mode, lastRunAt: startedAt.toISOString(), range });
      return { ok: false, status, message, runId };
    };

    let fetched;
    try {
      fetched = await fetchFeed(range);
    } catch {
      return failed("failed", "오너비스타에 연결하지 못했습니다. 다음 동기화 때 다시 받습니다.");
    }
    if (!fetched || fetched.status !== "ok") {
      return failed(fetched?.status || "failed", fetched?.message || "오너비스타 예약을 받지 못했습니다.");
    }
    const parsed = parseFeed(fetched.body);
    if (!parsed.ok) return failed("failed", parsed.message);

    const counts = emptyCounts();
    counts.received = parsed.bookings.length;
    if (parsed.invalid) counts.skipped.invalid = parsed.invalid;
    if (parsed.duplicated) counts.skipped.duplicated = parsed.duplicated;

    const links = await store.loadLinks(parsed.bookings.map((booking) => booking.bookingId));

    /*
      **읽을 것만 읽는다.** 5분마다 도는데 예약 문서를 매번 다 열 이유가 없다.
      - 묘비가 「지움」이면 끝난 번호다.
      - 묘비의 지문이 같으면 네이버 쪽에 바뀐 것이 없다.
      - 처음 보는 번호는 미리 판단해 본다. 지난 날짜·취소·시각 없음처럼 **만들 일이 없는
        것은 트랜잭션을 열지 않는다.** 그런 번호는 지울 문서도 없다 — 우리가 만든 적이
        없으니까(만들 때는 묘비와 예약을 한 번에 쓴다).
    */
    const base = { today, nowTime, nowStamp, businessId: parsed.ownervista.businessId };
    const work = [];
    let notifiableCount = 0;
    /** 새로 만들 네이버 예약의 「날짜|전화」별 수. 같은 손님이 같은 날 둘을 잡았으면 입양하지 않는다. */
    const newPhoneDays = new Map();
    const phoneDayOf = (booking) => {
      const key = booking.customer ? phoneKey(booking.customer.phone) : null;
      return key ? `${booking.useDate}|${key}` : null;
    };
    for (const booking of parsed.bookings) {
      const link = links.get(booking.bookingId) || null;
      if (link && link.state === "removed") {
        tally(counts, { action: "skip", reason: "removed" });
        continue;
      }
      if (!fullCheck && link && link.state === "active" && link.digest === feedDigest(booking)) {
        counts.unchanged += 1;
        continue;
      }
      if (!link) {
        const preview = planBooking({ ...base, booking, quiet: false });
        if (preview.action !== "create") {
          tally(counts, preview);
          continue;
        }
        // 입양으로 끝날 수도 있어 조금 넉넉히 센다 — 넘치면 하나씩 대신 한 통으로 묶일 뿐이다.
        if (preview.notifyCandidate) notifiableCount += 1;
        const phoneDay = phoneDayOf(booking);
        if (phoneDay) newPhoneDays.set(phoneDay, (newPhoneDays.get(phoneDay) || 0) + 1);
      }
      work.push({ booking, link });
    }

    const quiet = decideQuiet({ bootstrap, notifiableCount });

    let notifiedCreations = 0;
    let quietCreations = 0;
    for (const { booking } of work) {
      const reservationId = naverReservationId(booking.bookingId);
      if (reservationId === null) {
        tally(counts, { action: "skip", reason: "id-out-of-range" });
        continue;
      }
      try {
        const plan = await store.applyBooking(
          { bookingId: booking.bookingId, reservationId, useDate: booking.useDate },
          (current) => planBooking({
            ...base,
            booking,
            link: current.link,
            reservation: current.reservation,
            reservationId: current.reservationId,
            sameDay: current.sameDay,
            phoneSiblings: newPhoneDays.get(phoneDayOf(booking)) || 1,
            quiet: quiet.quiet,
          }),
        );
        tally(counts, plan);
        if (plan.action === "create" && plan.notifyCandidate) {
          if (plan.notify) notifiedCreations += 1;
          else quietCreations += 1;
        }
      } catch {
        // 한 건이 실패해도 나머지는 간다. 묘비가 안 바뀌었으니 다음 판에 다시 본다.
        counts.failed += 1;
      }
    }

    if (quiet.summary && quietCreations > 0) {
      try {
        await notifySummary(quietCreations, runId);
      } catch {
        // 묶음 알림이 실패했다고 동기화를 실패로 만들지 않는다. 예약은 이미 들어갔다.
      }
    }

    const message = describeRun(counts, { bootstrap });
    const finishedAt = now();
    /*
      **첫 동기화가 끝났다고 적는 조건.** 오너비스타가 지금 매장을 한 번이라도 수집했고
      (빈 목록이 «아직 안 모았다»일 수 있다 — 매장을 바꾼 직후가 그렇다), 이번 판에 저장
      실패가 없을 때만이다. 실패한 예약은 다음 판에 다시 만들어지는데, 그때 «새 예약»으로
      울리면 안 된다.
    */
    const bootstrapDone = bootstrap && counts.failed === 0 && parsed.ownervista.collected;
    await store.saveMeta({
      status: counts.failed > 0 ? "partial" : "success",
      message,
      mode,
      range,
      lastRunAt: startedAt.toISOString(),
      lastSuccessAt: finishedAt.toISOString(),
      ...(bootstrapDone ? { bootstrappedAt: finishedAt.toISOString() } : {}),
      counts,
      fullCheck,
      quiet: quiet.reason,
      notified: notifiedCreations,
      ownervista: parsed.ownervista,
    });
    return { ok: true, status: counts.failed > 0 ? "partial" : "success", message, runId, counts, bootstrap, quiet: quiet.reason };
  }

  return { run };
}

module.exports = {
  NAVER_SOURCE,
  NAVER_WRITER,
  NAVER_ID_BASE,
  NAVER_ID_SPAN,
  FEED_PAST_DAYS,
  FEED_FUTURE_DAYS,
  PUSH_BURST_LIMIT,
  ADOPT_WITHIN_MINUTES,
  NAVER_OWNED_FIELDS,
  kstParts,
  kstStamp,
  shiftDate,
  naverReservationId,
  formatKoreanPhone,
  skyStatusFor,
  normalizeFeedBooking,
  parseFeed,
  naverOwnedValues,
  feedDigest,
  phoneKey,
  nameKey,
  matchManualReservations,
  planBooking,
  planWrites,
  decideQuiet,
  describeRun,
  createNaverReservationSync,
};
