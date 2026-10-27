/**
 * 하늘땅에서 넣은 확정 예약에 「예약 확정 안내」 알림톡 — 보내는 것은 오너비스타다.
 *
 * 네이버 예약은 오너비스타 자동알림이 이미 확정 안내를 보낸다. 전화로 받아 직원이 적은 예약,
 * 카톡 빠른 예약, AI 비서가 넣은 예약에는 아무것도 안 갔다. 같은 손님이 어느 길로 예약했든
 * **같은 문구**를 받게, 확정이 되는 순간 예약 한 건을 오너비스타
 * `POST /api/partners/booking-alimtalk` 에 넘긴다(jit-pro `partner-alimtalk-core.ts`).
 * 오너비스타는 네이버 자동알림의 「확정」 문구로 채워 보낸다.
 *
 * 사장님 결정(2026-10-27)
 *   - **확정 예약 전부**(예약확정·단체, 휴대폰 번호가 있는 것). 끄는 칸은 없다.
 *     켜고 끄기는 오너비스타 포털의 「저쪽에서 넣은 확정 예약에도 예약 확정 알림톡 보내기」.
 *   - **처음 한 번만.** 고치거나 취소해도 다시 안 보낸다.
 *
 * 언제 «확정이 되는 순간»인가
 *   - 확정 상태로 새로 넣었을 때, 또는 예약대기·확인전화필요에서 확정으로 바뀌었을 때.
 *   - 이미 확정이던 예약을 고친 것은 아니다 — 그래서 이 기능을 켜기 전에 넣은 확정 예약은
 *     메모 한 줄 고쳤다고 뒤늦게 안내가 가지 않는다.
 *   - 네이버 예약(`source: "naver"`, 입양한 손 예약 포함)은 오너비스타가 따로 보낸다 — 건드리지 않는다.
 *
 * 한 번만: 함수 전용 `reservationAlimtalks/{예약번호}` 를 만들면서(이미 있으면 실패) 차지한다.
 * 스케줄러·재시도·두 번 저장이 겹쳐도 한 번이다. 오너비스타도 같은 예약번호는 한 번만 받는다.
 *
 * 이 파일은 저장소·네트워크를 모른다 — 바깥에서 넣는다(검사: scripts/check-reservation-alimtalk.js).
 */

const CONFIRMED_STATUSES = new Set(["예약확정", "단체"]);
const NAVER_SOURCE = "naver";
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 오너비스타가 받는 이름 길이 */
const NAME_MAX = 40;
const PEOPLE_MAX = 999;
/** 오너비스타가 대답하지 않으면 한 번 더 — 같은 예약번호라 두 번 나가지 않는다. */
const ATTEMPTS = 2;
const RETRY_WAIT_MS = 3_000;

const KST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function kstNow(date) {
  const parts = Object.fromEntries(KST_PARTS.formatToParts(date).map((part) => [part.type, part.value]));
  return { today: `${parts.year}-${parts.month}-${parts.day}`, nowTime: `${parts.hour}:${parts.minute}` };
}

/**
 * 휴대폰 번호만 숫자로(`01012345678`). 알림톡은 집 전화·매장 번호로 못 간다.
 * 뒤 8자리만 적은 번호는 010 을 붙인다 — 카톡 빠른 예약(`quickReservation.normalizePhone`)과 같다.
 */
function mobileDigits(raw) {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("82") && digits.length >= 11 && digits.length <= 12) digits = `0${digits.slice(2)}`;
  if (digits.length === 8) digits = `010${digits}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return /^010\d{8}$/.test(digits) || /^01[16789]\d{7,8}$/.test(digits) ? digits : null;
}

const ignore = (reason) => ({ action: "ignore", reason });
const skip = (reason, message) => ({ action: "skip", reason, message });

/**
 * 이 쓰기에서 알림톡을 보낼지 정한다. **저장하지 않는다.**
 *
 * @returns
 *   ignore — 아무것도 안 남긴다(지운 예약·네이버 예약·확정 아님·이미 확정이던 예약)
 *   skip   — 확정이 됐는데 보낼 수 없다. 까닭을 예약에 적는다(휴대폰 번호 없음·지난 예약 등)
 *   send   — `payload` 를 오너비스타에 넘긴다
 */
function planReservationAlimtalk({ id, before, after, today, nowTime }) {
  if (!after) return ignore("deleted");
  if (after.source === NAVER_SOURCE) return ignore("naver");
  if (!CONFIRMED_STATUSES.has(after.status)) return ignore("not-confirmed");
  if (before && CONFIRMED_STATUSES.has(before.status)) return ignore("already-confirmed");

  const phone = mobileDigits(after.phone);
  if (!phone) return skip("no-mobile", "휴대폰 번호가 없어 확정 알림톡을 보내지 않았습니다.");
  const date = String(after.date ?? "");
  const time = String(after.time ?? "");
  if (!DATE.test(date) || !TIME.test(time)) {
    return skip("bad-time", "예약 날짜·시간을 읽지 못해 확정 알림톡을 보내지 않았습니다.");
  }
  if (date < today || (date === today && time < nowTime)) {
    return skip("past", "이미 지난 예약이라 확정 알림톡을 보내지 않았습니다.");
  }
  const people = Math.round(Number(after.people));
  if (!(people >= 1)) return skip("no-people", "인원이 없어 확정 알림톡을 보내지 않았습니다.");

  const name = String(after.name ?? "").trim().slice(0, NAME_MAX);
  return {
    action: "send",
    payload: {
      reservationId: String(id),
      date,
      time,
      people: Math.min(people, PEOPLE_MAX),
      name: name || null,
      phone,
    },
  };
}

/**
 * 오너비스타의 답을 예약에 적을 모양으로. `post` 는 `{ status, body }` 를 돌려준다(던지면 못 닿은 것).
 * 보낸 것은 «보냈다»가 아니라 «오너비스타가 보내기로 넣었다»이다 — 실제 발송은 오너비스타 워커가 한다.
 */
async function sendWithRetry(post, payload, sleep) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    let response = null;
    try {
      response = await post(payload);
    } catch {
      response = null;
    }
    if (response && response.status === 200 && response.body && response.body.ok === true) {
      return response.body.sent === true
        ? { status: "sent", reason: String(response.body.reason ?? "queued"), message: null }
        : {
          status: "skipped",
          reason: String(response.body.reason ?? "not_sent"),
          message: String(response.body.message ?? "오너비스타가 알림톡을 보내지 않았습니다."),
        };
    }
    if (response && response.status === 401) {
      return {
        status: "failed",
        reason: "unauthorized",
        message: "오너비스타가 연결 키를 못 알아봐 확정 알림톡을 보내지 못했습니다(예약 넘기기 키와 같은 키).",
      };
    }
    if (response && response.status === 400) {
      return {
        status: "failed",
        reason: "invalid",
        message: "오너비스타가 예약 내용을 받지 않아 확정 알림톡을 보내지 못했습니다.",
      };
    }
    // 못 닿았거나(던짐) 5xx·429 — 한 번 더. 그 밖의 4xx 는 다시 해도 같다.
    const retryable = !response || response.status >= 500 || response.status === 429;
    if (!retryable) break;
    if (attempt < ATTEMPTS) await sleep(RETRY_WAIT_MS);
  }
  return {
    status: "failed",
    reason: "unreachable",
    message: "오너비스타에 닿지 못해 확정 알림톡을 보내지 못했습니다.",
  };
}

/**
 * @param {object} deps
 * @param {(id: string) => Promise<boolean>} deps.claim 함수 전용 표에 이 예약을 차지한다. 이미 있으면 false
 * @param {(id: string, result: {status: string, reason: string, message: string|null}) => Promise<void>} deps.record
 *   결과를 예약 문서(`alimtalk`)와 표에 적는다
 * @param {(payload: object) => Promise<{status: number, body: any}>} deps.post 오너비스타에 넘긴다
 * @param {() => Date} [deps.now]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 */
function createReservationAlimtalk(deps) {
  const now = deps.now || (() => new Date());
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  return async function handle({ id, before, after }) {
    const plan = planReservationAlimtalk({ id, before, after, ...kstNow(now()) });
    if (plan.action === "ignore") return plan;
    if (plan.action === "skip") {
      /*
        못 보낸 까닭만 적고 **차지하지 않는다.** 번호를 채워 다시 확정으로 바꾸면(대기 → 확정)
        그때 보낼 수 있어야 한다. 이미 확정이던 예약을 고친 것은 위에서 걸러지므로 같은 까닭이
        저장할 때마다 다시 적히지는 않는다.
      */
      await deps.record(String(id), { status: "skipped", reason: plan.reason, message: plan.message }, { claimed: false });
      return plan;
    }
    if (!await deps.claim(String(id))) return ignore("claimed");
    const result = await sendWithRetry(deps.post, plan.payload, sleep);
    await deps.record(String(id), result, { claimed: true });
    return { action: "send", result };
  };
}

module.exports = {
  CONFIRMED_STATUSES,
  mobileDigits,
  planReservationAlimtalk,
  sendWithRetry,
  createReservationAlimtalk,
  kstNow,
};
