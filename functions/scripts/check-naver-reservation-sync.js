"use strict";

/**
 * 네이버 예약 → 하늘땅 예약 동기화 점검 (Firebase·네트워크 없이 실행).
 *
 *   npm run test:naver
 *
 * 운영 예약을 **지우는** 기능이다. 그래서 이 파일이 지키는 것은 «무엇을 지우고 무엇을
 * 절대 안 지우는가»와 «직원이 정한 값을 되돌리지 않는가»다.
 *
 * 피드 응답은 오너비스타 쪽 검사(jit-pro `tests/naver-booking-partner-feed.test.mjs`)가
 * 실제 피드 함수로 만들어 대조하는 것과 **같은 픽스처**를 쓴다
 * (`fixtures/ownervista-naver-bookings.json` — 두 저장소의 파일이 같아야 한다).
 * 쓰기는 운영 어댑터와 같은 `planWrites` 목록을 Firestore 의 merge 규칙대로 실행한다.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const fixture = require("./fixtures/ownervista-naver-bookings.json");
const sync = require("../naverReservationSync");

const results = [];
async function check(label, fn) {
  try {
    await fn();
    results.push(`✅ ${label}`);
  } catch (error) {
    results.push(`❌ ${label}\n   ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

/** 한국 시각 2026-10-19(월) 12:00. */
const NOW = new Date("2026-10-19T03:00:00.000Z");
const BASE = { today: "2026-10-19", nowTime: "12:00", nowStamp: "2026-10-19 12:00" };

const clone = (value) => JSON.parse(JSON.stringify(value));
const rawBooking = (bookingId) => {
  const found = fixture.bookings.find((booking) => booking.bookingId === bookingId);
  if (!found) throw new Error(`픽스처에 ${bookingId} 가 없다`);
  return clone(found);
};
/** 픽스처 예약 한 건을 바꿔 가며 쓴다. 바꾸지 않은 칸은 픽스처 그대로다. */
const booking = (bookingId, change = {}) => {
  const raw = rawBooking(bookingId);
  const next = { ...raw, ...change };
  if (change.customer && raw.customer) next.customer = { ...raw.customer, ...change.customer };
  if (change.customer === null) next.customer = null;
  const normalized = sync.normalizeFeedBooking(next);
  if (!normalized) throw new Error(`정상 예약이어야 한다: ${bookingId}`);
  return normalized;
};
const plan = (feedBooking, extra = {}) => sync.planBooking({ ...BASE, booking: feedBooking, quiet: false, ...extra });
/** 처음 만든 예약 문서(동기화가 만든 그대로). */
const createdReservation = (feedBooking) => {
  const created = plan(feedBooking);
  assert.strictEqual(created.action, "create", `${feedBooking.bookingId} 는 만들어져야 한다`);
  return clone(created.reservation);
};
const activeLink = (feedBooking) => ({
  bookingId: feedBooking.bookingId,
  reservationId: sync.naverReservationId(feedBooking.bookingId),
  state: "active",
  digest: sync.feedDigest(feedBooking),
});

/* ── 메모리 저장소 ──────────────────────────────────────────────────────── */

/** Firestore `set(..., { merge: true })` 처럼 맵은 칸끼리 합치고 나머지는 덮는다. */
function mergeDeep(target, source) {
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const current = out[key];
    if (value && typeof value === "object" && !Array.isArray(value)
      && current && typeof current === "object" && !Array.isArray(current)) {
      out[key] = mergeDeep(current, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function memoryStore({ reservations = [], links = {}, meta = {} } = {}) {
  const state = {
    reservations: new Map(reservations.map((row) => [String(row.id), clone(row)])),
    links: new Map(Object.entries(clone(links))),
    meta: clone(meta),
    ops: [],
  };
  return {
    state,
    async loadMeta() {
      return clone(state.meta);
    },
    // 운영은 `mergeFields`(윗칸 통째 교체)로 쓴다. 지난 판의 숫자가 섞여 남지 않게.
    async saveMeta(patch) {
      state.meta = { ...state.meta, ...clone(patch) };
    },
    async loadLinks(bookingIds) {
      const found = new Map();
      for (const id of bookingIds) if (state.links.has(id)) found.set(id, clone(state.links.get(id)));
      return found;
    },
    async applyBooking(bookingId, reservationId, decide) {
      const key = String(reservationId);
      const decided = decide({
        link: state.links.has(bookingId) ? clone(state.links.get(bookingId)) : null,
        reservation: state.reservations.has(key) ? clone(state.reservations.get(key)) : null,
      });
      for (const op of sync.planWrites(decided, { timestamp: "__ts__" })) {
        state.ops.push({ ...op, bookingId, reservationId });
        const map = op.target === "link" ? state.links : state.reservations;
        const docId = op.target === "link" ? bookingId : key;
        if (op.kind === "create") {
          if (map.has(docId)) throw new Error("ALREADY_EXISTS");
          map.set(docId, clone(op.data));
        } else if (op.kind === "merge") {
          map.set(docId, mergeDeep(map.get(docId) || {}, clone(op.data)));
        } else if (op.kind === "delete") {
          map.delete(docId);
        } else {
          throw new Error(`모르는 쓰기: ${op.kind}`);
        }
      }
      return decided;
    },
  };
}

const feedBody = (bookings, extra = {}) => ({ ...clone(fixture), bookings: clone(bookings), ...extra });
const okFeed = (bookings, extra) => async () => ({ status: "ok", body: feedBody(bookings, extra) });
const BOOTSTRAPPED = { bootstrappedAt: "2026-10-01T00:00:00.000Z" };

function runner(store, fetchFeed, notifySummary = async () => {}) {
  return sync.createNaverReservationSync({ store, fetchFeed, notifySummary, now: () => NOW });
}

/** 동기화가 만든 문서 ID. */
const docIdOf = (bookingId) => String(sync.naverReservationId(bookingId));

/** 직원·카톡·AI 비서가 만든 예약 — 출처 표시도, 네이버 번호도 없다. */
const MANUAL = [
  { id: 1760836000000, date: "2026-10-20", time: "18:00", name: "김하늘", phone: "010-0000-1111", people: 4, seat: "창가", status: "예약확정", writer: "직원", createdAt: "2026-10-18 10:00" },
  { id: 1760836000001, date: "2026-10-22", time: "19:00", name: "취소손님", phone: "010-0000-3333", people: 3, seat: "", status: "예약확정", writer: "카카오", createdAt: "2026-10-18 10:01" },
  { id: 1760836000002, date: "2026-10-23", time: "18:00", name: "변경손님", phone: "", people: 2, seat: "", status: "예약확정", writer: "AI", source: "gemini-chat", createdAt: "2026-10-18 10:02" },
];

(async () => {
  await check("피드 픽스처가 오너비스타 검사의 것과 같다 (계약)", () => {
    /*
      jit-pro `tests/naver-booking-partner-feed.test.mjs` 가 실제 피드 함수로 이 응답을 만들어
      같은 지문을 확인한다. 한쪽 픽스처만 고치면 둘 중 하나가 빨개진다.
    */
    const digest = require("node:crypto").createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
    assert.strictEqual(digest, "60c184602cdf468960c61ed5e91bb7d417dc709c5cfc046f47d942a74a3637d8");
  });

  /* ── 1. 변환 ───────────────────────────────────────────────────────────── */

  await check("네이버 예약 한 건이 하늘땅 예약 모양으로 바뀐다", () => {
    const created = plan(booking("1104567890"));
    assert.strictEqual(created.action, "create");
    const r = created.reservation;
    assert.strictEqual(r.id, 9_000_001_104_567_890);
    assert.strictEqual(r.date, "2026-10-20", "날짜 YYYY-MM-DD");
    assert.strictEqual(r.time, "18:00", "시간 HH:mm (오너비스타가 이미 한국 시각으로 옮겨 준다)");
    assert.strictEqual(r.people, 4);
    assert.strictEqual(r.name, "김하늘");
    assert.strictEqual(r.phone, "010-0000-1111", "하늘땅 번호 모양");
    assert.strictEqual(r.request, "아기의자 1개 부탁드려요");
    assert.strictEqual(r.status, "예약확정");
    assert.strictEqual(r.seat, "", "좌석은 하늘땅 것 — 빈칸으로 시작");
    assert.strictEqual(r.memo, "", "메모는 하늘땅 것 — 빈칸으로 시작");
    assert.strictEqual(r.writer, "네이버예약");
    assert.strictEqual(r.createdAt, "2026-10-18 21:03", "접수일시는 손님이 예약한 때(한국 시각)");
    assert.strictEqual(r.source, "naver");
    assert.strictEqual(r.naver.bookingId, "1104567890");
    assert.strictEqual(r.naver.menu, "돼지갈비 4 · 물냉면 2");
    assert.deepStrictEqual(
      Object.keys(r).sort(),
      ["createdAt", "date", "id", "memo", "name", "naver", "notifyOnCreate", "people", "phone", "request", "seat", "source", "status", "time", "writer"],
      "결제금액·이메일·질문 답 같은 칸은 하늘땅에 들어오지 않는다",
    );
  });

  await check("신청은 예약대기, 8명 이상 확정은 단체 — 카톡·AI 비서·예약 화면과 같은 규칙", () => {
    assert.strictEqual(plan(booking("1104567891")).reservation.status, "예약대기");
    assert.strictEqual(plan(booking("1104567894")).reservation.status, "단체");
    assert.strictEqual(sync.skyStatusFor("completed", 2), "방문완료");
    assert.strictEqual(sync.skyStatusFor("noshowed", 2), "노쇼");
    assert.strictEqual(sync.skyStatusFor("cancelled", 2), null, "취소는 상태로 옮기지 않는다 — 지우는 쪽에서 다룬다");
    assert.strictEqual(sync.skyStatusFor("unknown", 2), null);
  });

  await check("전화번호는 하늘땅 모양으로, 모르는 모양은 그대로", () => {
    assert.strictEqual(sync.formatKoreanPhone("01000001111"), "010-0000-1111");
    assert.strictEqual(sync.formatKoreanPhone("0551234567"), "055-123-4567");
    assert.strictEqual(sync.formatKoreanPhone("0212345678"), "02-1234-5678");
    assert.strictEqual(sync.formatKoreanPhone("021234567"), "02-123-4567");
    assert.strictEqual(sync.formatKoreanPhone("+1 555 0100"), "+1 555 0100");
    assert.strictEqual(sync.formatKoreanPhone(null), "");
  });

  await check("예약 번호는 직원이 만드는 번호(Date.now)와 안 겹치고, 너무 크면 만들지 않는다", () => {
    const id = sync.naverReservationId("1104567890");
    assert.ok(Number.isSafeInteger(id));
    assert.ok(id > Date.now() * 1000, "Date.now() 범위보다 한참 위");
    assert.strictEqual(sync.naverReservationId("6999999999999"), 9_006_999_999_999_999);
    assert.strictEqual(sync.naverReservationId("7000000000000"), null);
    assert.strictEqual(sync.naverReservationId("12345678901234567890"), null);
    assert.strictEqual(sync.naverReservationId("0"), null);
    const huge = booking("1104567890", { bookingId: "7000000000001" });
    assert.strictEqual(plan(huge).action, "skip");
    assert.strictEqual(plan(huge).reason, "id-out-of-range");
  });

  await check("동기화 예약 번호는 카카오 「예약 삭제 번호」로 그대로 읽힌다", () => {
    const id = sync.naverReservationId("1104567890");
    // functions/index.js `explicitReservationId` 의 마지막 규칙과 같은 식. 바뀌면 아래 소스 검사가 잡는다.
    const longId = `예약 삭제 ${id}`.match(/\b(\d{12,})\b/);
    assert.ok(longId, "번호만 적어도 잡혀야 한다");
    assert.strictEqual(Number(longId[1]), id);
    const index = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    assert.match(index, /const longId = text\.match\(\/\\b\(\\d\{12,\}\)\\b\/\);/);
  });

  await check("네이버가 주인인 칸은 날짜·시간·인원·이름·전화·요청사항뿐이다", () => {
    assert.deepStrictEqual(sync.NAVER_OWNED_FIELDS, ["date", "time", "people", "name", "phone", "request"]);
  });

  /* ── 2. 만들지 않는 것 ────────────────────────────────────────────────── */

  await check("처음 본 취소·변경취소 예약은 만들지 않는다", () => {
    assert.deepStrictEqual([plan(booking("1104567892")).action, plan(booking("1104567892")).reason], ["skip", "cancelled-unseen"]);
    assert.deepStrictEqual([plan(booking("1104567895")).action, plan(booking("1104567895")).reason], ["skip", "cancelled-unseen"]);
  });

  await check("지난 날짜 예약은 새로 만들지 않는다", () => {
    const result = plan(booking("1104567893"));
    assert.deepStrictEqual([result.action, result.reason], ["skip", "past"]);
  });

  await check("오너비스타가 손님 정보를 못 풀었으면 빈 이름으로 만들지 않는다", () => {
    const result = plan(booking("1104567897"));
    assert.deepStrictEqual([result.action, result.reason], ["skip", "unreadable"]);
  });

  await check("시각이 없거나 상태를 모르는 예약은 만들지 않는다", () => {
    assert.strictEqual(plan(booking("1104567890", { useTime: null })).reason, "no-time");
    assert.strictEqual(plan(booking("1104567890", { status: "unknown", statusCode: "RC99" })).reason, "unknown-status");
    assert.strictEqual(sync.normalizeFeedBooking({ ...rawBooking("1104567890"), useTime: "25:00" }), null, "이상한 시각은 그 예약 자체를 버린다");
    assert.strictEqual(sync.normalizeFeedBooking({ ...rawBooking("1104567890"), status: "deleted" }), null, "모르는 상태 이름도 버린다");
  });

  /* ── 3. 수정 ──────────────────────────────────────────────────────────── */

  await check("네이버에서 시간·인원이 바뀌면 그 칸만 고친다", () => {
    const reservation = { ...createdReservation(booking("1104567890")), seat: "룸2", memo: "생일 케이크" };
    const changed = plan(booking("1104567890", { useTime: "19:00", headcount: 6 }), { link: activeLink(booking("1104567890")), reservation });
    assert.strictEqual(changed.action, "update");
    assert.deepStrictEqual(changed.changedFields, ["time", "people"]);
    assert.strictEqual(changed.patch.time, "19:00");
    assert.strictEqual(changed.patch.people, 6);
    for (const field of ["seat", "memo", "status", "writer", "createdAt", "name", "phone", "request", "date"]) {
      assert.ok(!(field in changed.patch), `${field} 는 건드리지 않는다`);
    }
    assert.strictEqual(changed.patch.naver.synced.time, "19:00", "다음 비교를 위해 옮긴 값을 적어 둔다");
  });

  await check("직원이 고친 시각은 네이버가 그 칸을 다시 바꿀 때까지 남는다", () => {
    const first = booking("1104567890");
    const reservation = { ...createdReservation(first), time: "18:30" }; // 손님이 전화로 30분 늦춘다고 했다
    const requestOnly = plan(booking("1104567890", { customer: { requestMessage: "아기의자 2개" } }), { link: activeLink(first), reservation });
    assert.deepStrictEqual(requestOnly.changedFields, ["request"]);
    assert.ok(!("time" in requestOnly.patch), "네이버가 시각을 안 바꿨으니 직원 값 18:30 이 남는다");

    const naverMoved = plan(booking("1104567890", { useTime: "19:30" }), { link: activeLink(first), reservation });
    assert.strictEqual(naverMoved.patch.time, "19:30", "네이버가 바꾸면 네이버가 이긴다");
  });

  await check("직원이 바꾼 방문완료·노쇼는 예약확정으로 되돌리지 않는다", () => {
    const first = booking("1104567890");
    for (const staffStatus of ["방문완료", "노쇼"]) {
      const reservation = { ...createdReservation(first), status: staffStatus };
      const later = plan(booking("1104567890", { useTime: "18:10" }), { link: activeLink(first), reservation });
      assert.strictEqual(later.action, "update");
      assert.ok(!("status" in later.patch), `${staffStatus} 가 남아야 한다`);
      const completed = plan(booking("1104567890", { status: "completed", statusCode: "RC08" }), { link: activeLink(first), reservation });
      assert.ok(!("status" in completed.patch), `네이버가 이용완료로 바꿔도 직원의 ${staffStatus} 가 이긴다`);
    }
  });

  await check("직원이 안 건드린 상태는 네이버를 따라간다 (신청 → 확정)", () => {
    const first = booking("1104567891");
    const reservation = createdReservation(first);
    assert.strictEqual(reservation.status, "예약대기");
    const confirmed = plan(booking("1104567891", { status: "confirmed", statusCode: "RC03" }), { link: activeLink(first), reservation });
    assert.deepStrictEqual(confirmed.changedFields, ["status"]);
    assert.strictEqual(confirmed.patch.status, "예약확정");
  });

  await check("직원이 정한 상태는 네이버가 확정해도 그대로 둔다", () => {
    const first = booking("1104567891");
    const reservation = { ...createdReservation(first), status: "확인전화필요" };
    const confirmed = plan(booking("1104567891", { status: "confirmed", statusCode: "RC03" }), { link: activeLink(first), reservation });
    assert.ok(!("status" in confirmed.patch));
    assert.strictEqual(confirmed.patch.naver.synced.status, "예약확정", "다음 비교 기준은 네이버 쪽으로 옮겨 둔다");
    assert.strictEqual(confirmed.reason, "refreshed");
  });

  await check("손님 정보를 못 읽은 판에는 이름·번호·요청사항을 비우지 않는다", () => {
    const first = booking("1104567890");
    const reservation = createdReservation(first);
    const unreadable = plan(booking("1104567890", { customer: null, useTime: "20:00" }), { link: activeLink(first), reservation });
    assert.deepStrictEqual(unreadable.changedFields, ["time"]);
    for (const field of ["name", "phone", "request"]) assert.ok(!(field in unreadable.patch), `${field} 를 비우면 안 된다`);
    assert.strictEqual(unreadable.patch.naver.synced.name, "김하늘", "옮긴 이름 기록도 그대로");
  });

  await check("상태를 모르는 판에도 지우거나 상태를 바꾸지 않는다", () => {
    const first = booking("1104567890");
    const reservation = createdReservation(first);
    const unknown = plan(booking("1104567890", { status: "unknown", statusCode: "RC99" }), { link: activeLink(first), reservation });
    assert.strictEqual(unknown.action, "update");
    assert.ok(!("status" in unknown.patch));
  });

  /* ── 4. 지우는 것 ─────────────────────────────────────────────────────── */

  await check("네이버가 그 번호에 «취소»를 돌려주면 지운다", () => {
    const first = booking("1104567890");
    const cancelled = plan(booking("1104567890", { status: "cancelled", statusCode: "RC04" }), { link: activeLink(first), reservation: createdReservation(first) });
    assert.strictEqual(cancelled.action, "delete");
    assert.strictEqual(cancelled.link.state, "removed");
    assert.strictEqual(cancelled.link.removedReason, "cancelled");
    const ops = sync.planWrites(cancelled, { timestamp: "t" });
    assert.deepStrictEqual(ops.map((op) => `${op.target}:${op.kind}`), ["reservation:delete", "link:merge"]);
  });

  await check("취소됐어도 직원이 방문완료·노쇼로 마감한 기록은 남긴다", () => {
    const first = booking("1104567890");
    for (const staffStatus of ["방문완료", "노쇼"]) {
      const reservation = { ...createdReservation(first), status: staffStatus };
      const kept = plan(booking("1104567890", { status: "cancelled", statusCode: "RC04" }), { link: activeLink(first), reservation });
      assert.strictEqual(kept.action, "keep");
      assert.deepStrictEqual(Object.keys(kept.patch), ["naver"], "네이버 표시만 새로 적는다");
      assert.strictEqual(kept.patch.naver.status, "cancelled");
      assert.ok(!sync.planWrites(kept, { timestamp: "t" }).some((op) => op.kind === "delete"));
    }
  });

  await check("지우는 쓰기는 «취소» 계획에서만 나온다", () => {
    const first = booking("1104567890");
    const reservation = createdReservation(first);
    const plans = [
      plan(first),
      plan(booking("1104567890", { useTime: "19:00" }), { link: activeLink(first), reservation }),
      plan(first, { link: activeLink(first), reservation: null }),
      plan(booking("1104567893")),
      plan(booking("1104567890", { status: "cancelled" }), { link: activeLink(first), reservation: { ...reservation, status: "노쇼" } }),
    ];
    for (const item of plans) {
      assert.ok(!sync.planWrites(item, { timestamp: "t" }).some((op) => op.kind === "delete"), `${item.action}/${item.reason}`);
    }
  });

  await check("피드에서 사라졌을 뿐이면 지우지 않는다", async () => {
    const first = booking("1104567890");
    const store = memoryStore({
      reservations: [createdReservation(first)],
      links: { [first.bookingId]: activeLink(first) },
      meta: BOOTSTRAPPED,
    });
    const other = rawBooking("1104567891");
    const result = await runner(store, okFeed([other])).run();
    assert.strictEqual(result.ok, true);
    assert.ok(store.state.reservations.has(docIdOf("1104567890")), "안 보인다고 지우면 안 된다");
    assert.strictEqual(store.state.links.get("1104567890").state, "active");
    assert.ok(!store.state.ops.some((op) => op.kind === "delete"));
  });

  await check("빈 목록·실패·반쪽 응답·이상한 응답이면 아무것도 쓰지 않는다", async () => {
    const first = booking("1104567890");
    /*
      받아들였다면 무언가를 쓰게 되는 내용을 싣는다 — 있던 예약의 취소와 새 예약. 그래야
      «반쪽이라 안 받았다»와 «받았는데 바뀐 게 없었다»가 갈린다.
    */
    const harmful = [{ ...rawBooking("1104567890"), status: "cancelled", statusCode: "RC04" }, rawBooking("1104567891")];
    const feeds = [
      ["정상인데 빈 목록", okFeed([]), "success"],
      ["끝까지 못 읽은 목록", okFeed(harmful, { complete: false }), "failed"],
      ["ok 가 아닌 응답", okFeed(harmful, { ok: false }), "failed"],
      ["모르는 응답 버전", okFeed(harmful, { version: 2 }), "failed"],
      ["HTTP 실패", async () => ({ status: "failed", message: "HTTP 503" }), "failed"],
      ["키 없음", async () => ({ status: "config_required", message: "키 없음" }), "config_required"],
      ["연동 꺼짐", async () => ({ status: "disabled", message: "꺼짐" }), "disabled"],
      ["연결 실패", async () => { throw new Error("network down"); }, "failed"],
    ];
    for (const [label, fetchFeed, status] of feeds) {
      const store = memoryStore({
        reservations: [createdReservation(first), ...MANUAL],
        links: { [first.bookingId]: activeLink(first) },
        meta: BOOTSTRAPPED,
      });
      const before = clone([...store.state.reservations.entries()]);
      await runner(store, fetchFeed).run();
      assert.deepStrictEqual(clone([...store.state.reservations.entries()]), before, label);
      assert.strictEqual(store.state.ops.length, 0, label);
      assert.strictEqual(store.state.meta.status, status, label);
    }
  });

  await check("실패한 판은 왜 못 받았는지 남기고, 마지막 성공 시각은 지우지 않는다", async () => {
    const store = memoryStore({ meta: { ...BOOTSTRAPPED, lastSuccessAt: "2026-10-19T02:50:00.000Z" } });
    const result = await runner(store, async () => ({ status: "failed", message: "오너비스타 예약을 받지 못했습니다 (HTTP 503)." })).run();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(store.state.meta.status, "failed");
    assert.match(store.state.meta.message, /HTTP 503/);
    assert.strictEqual(store.state.meta.lastSuccessAt, "2026-10-19T02:50:00.000Z");
  });

  /* ── 5. 네이버 «변경» ─────────────────────────────────────────────────── */

  await check("네이버 변경(새 번호 + 이전 번호 변경취소)은 이전 것을 지우고 새 것을 만든다 — 겹치지 않는다", async () => {
    const oldOne = booking("1104567890", { bookingId: "1104567800" });
    const store = memoryStore({
      reservations: [{ ...createdReservation(oldOne), seat: "룸2" }],
      links: { "1104567800": activeLink(oldOne) },
      meta: BOOTSTRAPPED,
    });
    const feed = [
      { ...rawBooking("1104567890"), bookingId: "1104567800", status: "cancelled_by_change", statusCode: "RC06" },
      { ...rawBooking("1104567890"), bookingId: "1104567801", useTime: "19:00", bookedAt: "2026-10-19T02:30:00.000Z" },
    ];
    const first = await runner(store, okFeed(feed)).run();
    assert.strictEqual(first.counts.deleted, 1);
    assert.strictEqual(first.counts.created, 1);
    assert.ok(!store.state.reservations.has(docIdOf("1104567800")), "이전 번호는 지워진다");
    const fresh = store.state.reservations.get(docIdOf("1104567801"));
    assert.strictEqual(fresh.time, "19:00");
    const sameCustomer = [...store.state.reservations.values()].filter((row) => row.name === "김하늘");
    assert.strictEqual(sameCustomer.length, 1, "같은 손님 예약이 둘로 남지 않는다");
    assert.strictEqual(store.state.links.get("1104567800").removedReason, "cancelled_by_change");

    const again = await runner(store, okFeed(feed)).run();
    assert.strictEqual(again.counts.created + again.counts.deleted + again.counts.updated, 0, "같은 피드를 다시 받아도 아무것도 안 바뀐다");
  });

  await check("변경취소가 새 번호보다 늦게 와도 잠깐 둘이 보였다가 정리된다", async () => {
    const store = memoryStore({ meta: BOOTSTRAPPED });
    const oldRaw = { ...rawBooking("1104567890"), bookingId: "1104567800" };
    const newRaw = { ...rawBooking("1104567890"), bookingId: "1104567801", useTime: "19:00" };
    await runner(store, okFeed([oldRaw])).run();
    await runner(store, okFeed([oldRaw, newRaw])).run();
    assert.strictEqual(store.state.reservations.size, 2, "오너비스타가 이전 번호를 다시 묻기 전에는 둘 다 있다");
    await runner(store, okFeed([{ ...oldRaw, status: "cancelled_by_change", statusCode: "RC06" }, newRaw])).run();
    assert.deepStrictEqual([...store.state.reservations.keys()], [docIdOf("1104567801")]);
  });

  /* ── 6. 손으로 넣은 예약 ──────────────────────────────────────────────── */

  await check("손으로·카톡으로·AI 비서로 넣은 예약은 어떤 경우에도 안 건드린다", async () => {
    const store = memoryStore({ reservations: MANUAL, meta: BOOTSTRAPPED });
    // 같은 이름·날짜·시각의 네이버 예약, 그 손님 이름의 취소·변경취소까지 다 온다.
    await runner(store, okFeed(fixture.bookings)).run();
    await runner(store, okFeed(fixture.bookings.map((row) => ({ ...row, status: "cancelled", statusCode: "RC04" })))).run();
    for (const manual of MANUAL) {
      assert.deepStrictEqual(store.state.reservations.get(String(manual.id)), manual, `${manual.name} 이 바뀌면 안 된다`);
    }
    const touched = new Set(store.state.ops.filter((op) => op.target === "reservation").map((op) => String(op.reservationId)));
    for (const manual of MANUAL) assert.ok(!touched.has(String(manual.id)));
  });

  await check("번호 자리에 동기화가 만들지 않은 문서가 있으면 손대지 않는다", async () => {
    const first = booking("1104567890");
    const stranger = { id: sync.naverReservationId("1104567890"), date: "2026-10-20", time: "18:00", name: "누군가", phone: "", people: 2, seat: "", status: "예약확정", writer: "직원", createdAt: "" };
    assert.strictEqual(plan(first, { reservation: stranger }).reason, "conflict");
    assert.strictEqual(plan(booking("1104567890", { status: "cancelled" }), { link: activeLink(first), reservation: stranger }).reason, "conflict");
    const store = memoryStore({ reservations: [stranger], links: { "1104567890": { ...activeLink(first), digest: "old" } }, meta: BOOTSTRAPPED });
    await runner(store, okFeed([{ ...rawBooking("1104567890"), status: "cancelled", statusCode: "RC04" }])).run();
    assert.deepStrictEqual(store.state.reservations.get(String(stranger.id)), stranger);
  });

  /* ── 7. 직원이 지운 예약 ──────────────────────────────────────────────── */

  await check("직원이 지운 네이버 예약은 다시 만들지 않는다", async () => {
    const store = memoryStore({ meta: BOOTSTRAPPED });
    await runner(store, okFeed([rawBooking("1104567890")])).run();
    assert.ok(store.state.reservations.has(docIdOf("1104567890")));
    store.state.reservations.delete(docIdOf("1104567890")); // 예약 화면에서 «삭제»

    await runner(store, okFeed([rawBooking("1104567890")])).run();
    assert.ok(!store.state.reservations.has(docIdOf("1104567890")), "네이버가 그대로면 아무 일도 없다");

    const changed = { ...rawBooking("1104567890"), useTime: "19:00" };
    const result = await runner(store, okFeed([changed])).run();
    assert.strictEqual(result.counts.forgotten, 1);
    assert.ok(!store.state.reservations.has(docIdOf("1104567890")), "네이버가 바꿔도 되살리지 않는다");
    assert.strictEqual(store.state.links.get("1104567890").removedReason, "sky-deleted");

    await runner(store, okFeed([{ ...changed, useTime: "20:00" }])).run();
    assert.ok(!store.state.reservations.has(docIdOf("1104567890")));
  });

  await check("트랜잭션 안에서 다시 읽은 묘비가 «지움»이면 그 자리에서 멈춘다 (실행기 앞단과 따로)", () => {
    // 앞단은 판이 시작할 때 읽은 묘비로 거른다. 그 사이 다른 판이 묘비를 «지움»으로 바꿨을 수 있다.
    const first = booking("1104567890");
    for (const removedReason of ["sky-deleted", "cancelled", "cancelled_by_change"]) {
      const removed = { ...activeLink(first), state: "removed", removedReason };
      const result = plan(first, { link: removed, reservation: null });
      assert.deepStrictEqual([result.action, result.reason], ["skip", "removed"], removedReason);
      assert.deepStrictEqual(sync.planWrites(result, { timestamp: "t" }), []);
    }
  });

  /* ── 8. 푸시 ──────────────────────────────────────────────────────────── */

  await check("첫 동기화는 하나도 알리지 않는다", async () => {
    const summaries = [];
    const store = memoryStore();
    const result = await runner(store, okFeed(fixture.bookings), async (count) => summaries.push(count)).run();
    assert.strictEqual(result.bootstrap, true);
    assert.ok(result.counts.created > 0);
    for (const row of store.state.reservations.values()) assert.strictEqual(row.notifyOnCreate, false, row.name);
    assert.deepStrictEqual(summaries, [], "묶음 알림도 안 보낸다");
    assert.ok(store.state.meta.bootstrappedAt, "첫 동기화가 끝났다고 적는다");
    assert.match(store.state.meta.message, /처음으로 네이버 예약을 가져왔습니다/);
  });

  await check("오너비스타가 아직 한 번도 안 모았으면 첫 동기화가 끝난 것으로 치지 않는다", async () => {
    const store = memoryStore();
    await runner(store, okFeed([], { collection: { lastSuccessfulSyncAt: null, syncFailed: false } })).run();
    assert.strictEqual(store.state.meta.bootstrappedAt, undefined);
  });

  await check("오너비스타에서 매장을 바꾼 직후(새 매장 첫 수집 전)의 빈 목록도 첫 동기화로 치지 않는다", async () => {
    /*
      매장을 바꾸면 오너비스타는 마지막 성공 시각을 예전 매장 것으로 두고 모은 범위만 비운다.
      그 빈 목록으로 «첫 동기화 끝»을 적으면, 곧 들어올 새 매장 예약 수십 건이 «새 예약»이 된다.
    */
    const store = memoryStore();
    const switched = { ...fixture.collection, businessId: "1753712", lastSyncedRange: null };
    await runner(store, okFeed([], { collection: switched })).run();
    assert.strictEqual(store.state.meta.bootstrappedAt, undefined);
    assert.strictEqual(store.state.meta.ownervista.collected, false);
  });

  await check("어느 네이버 매장에서 온 예약인지 예약과 상태 문서에 적는다", async () => {
    const store = memoryStore({ meta: BOOTSTRAPPED });
    await runner(store, okFeed([rawBooking("1104567890")])).run();
    assert.strictEqual(store.state.reservations.get(docIdOf("1104567890")).naver.businessId, fixture.collection.businessId);
    assert.strictEqual(store.state.meta.ownervista.businessId, fixture.collection.businessId);
    assert.strictEqual(store.state.meta.ownervista.businessName, fixture.collection.businessName);
  });

  await check("매장을 바꿔 예전 매장 예약이 피드에서 사라져도 지우지 않는다 (화면이 «예전 매장»으로 가린다)", async () => {
    const first = booking("1104567890");
    const fromOldStore = { ...createdReservation(first), naver: { ...createdReservation(first).naver, businessId: "7770001" } };
    const store = memoryStore({ reservations: [fromOldStore], links: { [first.bookingId]: activeLink(first) }, meta: BOOTSTRAPPED });
    await runner(store, okFeed([rawBooking("1104567891")])).run({ mode: "manual" });
    assert.deepStrictEqual(store.state.reservations.get(docIdOf("1104567890")), fromOldStore);
  });

  await check("첫 동기화 뒤 새로 들어온 예약은 하나씩 알린다", async () => {
    const summaries = [];
    const store = memoryStore({ meta: BOOTSTRAPPED });
    await runner(store, okFeed([rawBooking("1104567890")]), async (count) => summaries.push(count)).run();
    assert.strictEqual(store.state.reservations.get(docIdOf("1104567890")).notifyOnCreate, true);
    assert.deepStrictEqual(summaries, []);
  });

  await check("한꺼번에 여러 건이 새로 들어오면 한 통으로 묶는다", async () => {
    const summaries = [];
    const store = memoryStore({ meta: BOOTSTRAPPED });
    const many = Array.from({ length: sync.PUSH_BURST_LIMIT + 2 }, (_, index) => ({
      ...rawBooking("1104567890"),
      bookingId: String(1104568000 + index),
    }));
    await runner(store, okFeed(many), async (count) => summaries.push(count)).run();
    assert.strictEqual(store.state.reservations.size, many.length);
    for (const row of store.state.reservations.values()) assert.strictEqual(row.notifyOnCreate, false);
    assert.deepStrictEqual(summaries, [many.length]);
  });

  await check("시각이 지난 오늘 예약·이용완료·노쇼는 «새 예약»으로 알리지 않는다", () => {
    const morning = plan(booking("1104567896"));
    assert.strictEqual(morning.action, "create", "오늘 예약이라 만든다");
    assert.strictEqual(morning.notify, false, "11:00 은 이미 지났다");
    const completed = plan(booking("1104567890", { status: "completed", statusCode: "RC08" }));
    assert.strictEqual(completed.reservation.status, "방문완료");
    assert.strictEqual(completed.notify, false);
    const noshow = plan(booking("1104567890", { status: "noshowed", statusCode: "RC05" }));
    assert.strictEqual(noshow.reservation.status, "노쇼");
    assert.strictEqual(noshow.notify, false);
  });

  await check("푸시 함수는 동기화가 단 «알리지 말라» 표시만 본다 — 다른 예약은 예전처럼", () => {
    const index = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    const body = index.slice(index.indexOf("async function sendReservationCreatedPush"), index.indexOf("async function sendReservationReminders"));
    assert.match(body, /reservation\.notifyOnCreate === false\) return;/);
    assert.doesNotMatch(body, /notifyOnCreate !== true/, "표시가 없는 예약(직원·카톡·AI)은 알려야 한다");
  });

  /* ── 9. 한 판 전체 ────────────────────────────────────────────────────── */

  await check("픽스처 한 판: 무엇을 만들고 무엇을 건너뛰는가", async () => {
    const store = memoryStore({ meta: BOOTSTRAPPED });
    const result = await runner(store, okFeed(fixture.bookings)).run();
    assert.strictEqual(result.counts.received, fixture.bookings.length);
    assert.strictEqual(result.counts.created, 4, "내일·모레 확정/신청, 단체, 오늘 지난 시각");
    assert.deepStrictEqual(result.counts.skipped, { past: 1, unreadable: 1, "cancelled-unseen": 2 });
    assert.deepStrictEqual(
      [...store.state.reservations.values()].map((row) => `${row.date} ${row.time} ${row.name} ${row.people}명 ${row.status} ${row.notifyOnCreate ? "알림" : "조용"}`).sort(),
      [
        "2026-10-19 11:00 오전손님 3명 예약확정 조용",
        "2026-10-20 18:00 김하늘 4명 예약확정 알림",
        "2026-10-21 12:30 박땅 2명 예약대기 알림",
        "2026-10-25 17:00 가상단체 10명 단체 알림",
      ],
    );
    assert.match(store.state.meta.message, /새 예약 4건/);
    assert.match(store.state.meta.message, /손님 정보를 못 읽어 미룬 예약 1건/);
    assert.strictEqual(store.state.meta.ownervista.lastSuccessfulSyncAt, fixture.collection.lastSuccessfulSyncAt);

    const again = await runner(store, okFeed(fixture.bookings)).run();
    assert.strictEqual(again.counts.unchanged, 4, "지난번과 같으면 예약 문서를 읽지도 않는다");
    assert.strictEqual(again.counts.created + again.counts.updated + again.counts.deleted, 0);
  });

  await check("오너비스타가 나중에 손님 정보를 풀면 그때 만든다", async () => {
    const store = memoryStore({ meta: BOOTSTRAPPED });
    await runner(store, okFeed([rawBooking("1104567897")])).run();
    assert.strictEqual(store.state.reservations.size, 0);
    const readable = { ...rawBooking("1104567897"), customer: { name: "저녁손님", phone: "01000007777", requestMessage: null } };
    await runner(store, okFeed([readable])).run();
    assert.strictEqual(store.state.reservations.get(docIdOf("1104567897")).name, "저녁손님");
  });

  await check("직원이 적은 좌석·메모·상태는 몇 번을 돌아도 그대로다", async () => {
    const store = memoryStore({ meta: BOOTSTRAPPED });
    await runner(store, okFeed([rawBooking("1104567890")])).run();
    const key = docIdOf("1104567890");
    // 예약 화면은 문서 전체를 다시 써 넣는다(fsUpsertReservation). 그 모양 그대로 흉내 낸다.
    store.state.reservations.set(key, { ...store.state.reservations.get(key), seat: "룸2", memo: "생일 케이크", status: "방문완료" });
    await runner(store, okFeed([{ ...rawBooking("1104567890"), headcount: 5 }])).run();
    await runner(store, okFeed([{ ...rawBooking("1104567890"), headcount: 5, status: "completed", statusCode: "RC08" }])).run();
    const row = store.state.reservations.get(key);
    assert.deepStrictEqual([row.seat, row.memo, row.status, row.people], ["룸2", "생일 케이크", "방문완료", 5]);
  });

  await check("다시 대조하면(매시·지금 받기) 오프라인 휴대폰이 되써 넣은 옛 값을 바로잡는다", async () => {
    const store = memoryStore({ meta: BOOTSTRAPPED });
    await runner(store, okFeed([rawBooking("1104567890")])).run();
    const moved = { ...rawBooking("1104567890"), useTime: "19:00" };
    await runner(store, okFeed([moved])).run();
    const key = docIdOf("1104567890");
    assert.strictEqual(store.state.reservations.get(key).time, "19:00");
    // 18:00 을 들고 있던 휴대폰이 다시 붙으며 문서를 통째로(네이버 표시까지) 되써 넣는다.
    const stale = store.state.reservations.get(key);
    store.state.reservations.set(key, { ...stale, time: "18:00", status: "방문완료", naver: { ...stale.naver, synced: { ...stale.naver.synced, time: "18:00" } } });

    await runner(store, okFeed([moved])).run();
    assert.strictEqual(store.state.reservations.get(key).time, "18:00", "평소 판은 지문이 같아 읽지 않는다");
    await runner(store, okFeed([moved])).run({ mode: "scheduled", fullCheck: true });
    assert.strictEqual(store.state.reservations.get(key).time, "19:00", "다시 대조하면 네이버 값으로 돌아온다");
    assert.strictEqual(store.state.reservations.get(key).status, "방문완료", "직원이 그때 누른 방문완료는 남는다");
  });

  await check("다시 대조해도 바뀐 것이 없으면 아무것도 쓰지 않는다", async () => {
    const store = memoryStore({ meta: BOOTSTRAPPED });
    await runner(store, okFeed(fixture.bookings)).run();
    const before = store.state.ops.length;
    const result = await runner(store, okFeed(fixture.bookings)).run({ mode: "manual" });
    assert.strictEqual(store.state.ops.length, before, "쓰기가 하나도 없어야 한다");
    assert.strictEqual(result.counts.unchanged, 4);
  });

  await check("다시 대조해도 직원이 고친 시각·좌석은 그대로다", async () => {
    const store = memoryStore({ meta: BOOTSTRAPPED });
    await runner(store, okFeed([rawBooking("1104567890")])).run();
    const key = docIdOf("1104567890");
    // 예약 화면에서 고친 그대로 — 네이버 표시(naver.synced)는 손대지 않고 함께 되써 넣는다.
    store.state.reservations.set(key, { ...store.state.reservations.get(key), time: "18:30", seat: "룸2" });
    await runner(store, okFeed([rawBooking("1104567890")])).run({ mode: "manual" });
    const row = store.state.reservations.get(key);
    assert.deepStrictEqual([row.time, row.seat], ["18:30", "룸2"]);
  });

  await check("한 건 저장이 실패해도 나머지는 들어가고, 첫 동기화는 끝난 것으로 치지 않는다", async () => {
    const store = memoryStore();
    const original = store.applyBooking;
    store.applyBooking = async (bookingId, ...rest) => {
      if (bookingId === "1104567891") throw new Error("aborted");
      return original(bookingId, ...rest);
    };
    const result = await runner(store, okFeed(fixture.bookings)).run();
    assert.strictEqual(result.status, "partial");
    assert.strictEqual(result.counts.failed, 1);
    assert.ok(store.state.reservations.has(docIdOf("1104567890")));
    assert.strictEqual(store.state.meta.bootstrappedAt, undefined, "다음 판에 만들어질 예약이 «새 예약»으로 울리면 안 된다");
  });

  await check("운영 어댑터는 planWrites 목록만 실행한다 (지우기는 그 목록에서만)", () => {
    const index = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    const adapter = index.slice(index.indexOf("function firestoreNaverReservationStore"), index.indexOf("const naverReservationSync ="));
    assert.ok(adapter.length > 0, "어댑터를 찾지 못했다");
    assert.match(adapter, /naverSync\.planWrites\(plan,/);
    assert.match(adapter, /runTransaction/);
    assert.strictEqual((adapter.match(/\.delete\(/g) || []).length, 1, "지우는 자리는 하나뿐");
    assert.match(adapter, /op\.kind === "delete"\) transaction\.delete\(ref\)/);
    assert.match(adapter, /mergeFields: Object\.keys\(data\)/, "동기화 상태 문서는 윗칸 통째로 바꾼다");
  });

  console.log(results.join("\n"));
  console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
})();
