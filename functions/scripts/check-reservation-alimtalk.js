"use strict";

/**
 * 하늘땅에서 넣은 확정 예약 → 오너비스타 「예약 확정 안내」 알림톡 점검 — 배포·네트워크 없이
 *
 *   npm run test:alimtalk
 *
 * 손님에게 문자가 나가는 길이라 지키는 것은 넷 — **확정이 되는 순간 한 번만**, **네이버 예약은 안 건드린다**
 * (오너비스타가 따로 보낸다), **휴대폰 번호·앞날 예약에만**, **못 보낸 까닭은 예약에 남긴다.**
 */

const assert = require("node:assert");
const {
  mobileDigits, planReservationAlimtalk, sendWithRetry, createReservationAlimtalk, kstNow,
} = require("../reservationAlimtalk");

const results = [];
async function check(label, fn) {
  try {
    await fn();
    results.push(`✅ ${label}`);
  } catch (error) {
    results.push(`❌ ${label}\n   ${error.message}`);
    process.exitCode = 1;
  }
}

// 2026-10-27 14:00 KST
const NOW = new Date("2026-10-27T05:00:00.000Z");
const TODAY = { today: "2026-10-27", nowTime: "14:00" };

const resv = (extra = {}) => ({
  id: 1761540000000, date: "2026-10-28", time: "18:30", name: "김하늘", phone: "010-1234-5678", people: 4,
  seat: "룸2", status: "예약확정", writer: "사장님", createdAt: "2026-10-27 13:58", ...extra,
});

/** 가짜 저장소·오너비스타. 차지 표는 create 처럼 한 번만 된다. */
function harness({ responses = [{ status: 200, body: { ok: true, sent: true, reason: "queued", message: null } }] } = {}) {
  const claims = new Set();
  const records = [];
  const posts = [];
  const waits = [];
  const queue = [...responses];
  const handle = createReservationAlimtalk({
    claim: async (id) => {
      if (claims.has(id)) return false;
      claims.add(id);
      return true;
    },
    record: async (id, result, meta) => { records.push({ id, result, meta }); },
    post: async (payload) => {
      posts.push(payload);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    },
    now: () => NOW,
    sleep: async (ms) => { waits.push(ms); },
  });
  return { handle, claims, records, posts, waits };
}

(async () => {
  await check("한국 시각으로 오늘·지금을 잰다 (UTC 05:00 = KST 14:00)", () => {
    assert.deepStrictEqual(kstNow(NOW), TODAY);
  });

  await check("확정으로 새로 넣은 예약은 정해진 칸만 넘긴다 — 번호는 숫자만", async () => {
    const h = harness();
    const outcome = await h.handle({ id: "1761540000000", before: null, after: resv() });
    assert.strictEqual(outcome.action, "send");
    assert.deepStrictEqual(h.posts, [{
      reservationId: "1761540000000", date: "2026-10-28", time: "18:30", people: 4, name: "김하늘", phone: "01012345678",
    }]);
    assert.deepStrictEqual(h.records, [{
      id: "1761540000000",
      result: { status: "sent", reason: "queued", message: null },
      meta: { claimed: true },
    }]);
  });

  await check("단체(8명 이상 확정)도 보내고, 대기·확인전화필요에서 확정으로 바뀔 때 보낸다", async () => {
    const group = harness();
    assert.strictEqual((await group.handle({ id: "1", before: null, after: resv({ status: "단체", people: 12 }) })).action, "send");
    for (const from of ["예약대기", "확인전화필요"]) {
      const h = harness();
      const outcome = await h.handle({ id: "2", before: resv({ status: from }), after: resv() });
      assert.strictEqual(outcome.action, "send", from);
    }
  });

  await check("이미 확정이던 예약을 고친 것·확정 아닌 예약·지운 예약에는 아무것도 안 한다 (변경·취소는 다시 안 보낸다)", async () => {
    const cases = [
      { before: resv(), after: resv({ memo: "창가", time: "19:00" }), reason: "already-confirmed" },
      { before: resv(), after: resv({ status: "취소" }), reason: "not-confirmed" },
      { before: null, after: resv({ status: "예약대기" }), reason: "not-confirmed" },
      { before: null, after: resv({ status: "확인전화필요" }), reason: "not-confirmed" },
      { before: resv(), after: null, reason: "deleted" },
      { before: resv({ status: "단체" }), after: resv(), reason: "already-confirmed" },
    ];
    for (const { before, after, reason } of cases) {
      const h = harness();
      const outcome = await h.handle({ id: "3", before, after });
      assert.deepStrictEqual(outcome, { action: "ignore", reason }, reason);
      assert.strictEqual(h.posts.length + h.records.length + h.claims.size, 0, reason);
    }
  });

  await check("네이버 예약(동기화가 만든 것·입양한 손 예약)은 오너비스타가 따로 보내므로 건드리지 않는다", async () => {
    const h = harness();
    const created = await h.handle({ id: "9000001104567890", before: null, after: resv({ source: "naver" }) });
    assert.deepStrictEqual(created, { action: "ignore", reason: "naver" });
    const adopted = await h.handle({ id: "4", before: resv({ status: "예약대기" }), after: resv({ source: "naver" }) });
    assert.deepStrictEqual(adopted, { action: "ignore", reason: "naver" });
    assert.strictEqual(h.posts.length, 0);
  });

  await check("휴대폰 번호가 아니면 안 보내고 까닭을 예약에 남긴다 — 차지하지 않아 번호를 채워 다시 확정하면 보낸다", async () => {
    for (const phone of ["", "055-123-4567", "0507-1391-5252"]) {
      const h = harness();
      const outcome = await h.handle({ id: "5", before: null, after: resv({ phone }) });
      assert.strictEqual(outcome.action, "skip", phone);
      assert.strictEqual(outcome.reason, "no-mobile");
      assert.strictEqual(h.posts.length, 0);
      assert.strictEqual(h.claims.size, 0, "차지하지 않는다");
      assert.deepStrictEqual(h.records[0].meta, { claimed: false });
      assert.match(h.records[0].result.message, /휴대폰 번호가 없어/);
    }
    const h = harness();
    await h.handle({ id: "5", before: null, after: resv({ phone: "" }) });
    const later = await h.handle({ id: "5", before: resv({ phone: "", status: "예약대기" }), after: resv() });
    assert.strictEqual(later.action, "send", "번호를 채워 다시 확정");
  });

  await check("지난 예약은 안 보낸다 — 어제, 오늘 지난 시각. 오늘 이후 시각은 보낸다", async () => {
    for (const extra of [{ date: "2026-10-26" }, { date: "2026-10-27", time: "13:30" }]) {
      const h = harness();
      const outcome = await h.handle({ id: "6", before: null, after: resv(extra) });
      assert.strictEqual(outcome.reason, "past", JSON.stringify(extra));
      assert.strictEqual(h.posts.length, 0);
    }
    const h = harness();
    assert.strictEqual((await h.handle({ id: "6", before: null, after: resv({ date: "2026-10-27", time: "14:00" }) })).action, "send");
  });

  await check("날짜·시간을 못 읽거나 인원이 없으면 안 보낸다", async () => {
    for (const [extra, reason] of [
      [{ date: "10/28" }, "bad-time"], [{ time: "6:30" }, "bad-time"], [{ people: 0 }, "no-people"], [{ people: "" }, "no-people"],
    ]) {
      const h = harness();
      assert.strictEqual((await h.handle({ id: "7", before: null, after: resv(extra) })).reason, reason, JSON.stringify(extra));
    }
  });

  await check("같은 예약은 한 번만 — 앞선 부름이 차지했으면 넘기지 않는다", async () => {
    const h = harness();
    await h.handle({ id: "8", before: null, after: resv() });
    const again = await h.handle({ id: "8", before: resv({ status: "예약대기" }), after: resv() });
    assert.deepStrictEqual(again, { action: "ignore", reason: "claimed" });
    assert.strictEqual(h.posts.length, 1);
  });

  await check("오너비스타가 «꺼짐»·«문구 없음»이라고 하면 보내지 않은 것으로 그 까닭을 적는다", async () => {
    const h = harness({ responses: [{ status: 200, body: { ok: true, sent: false, reason: "disabled", message: "오너비스타에서 … 꺼져 있어 보내지 않았습니다." } }] });
    const outcome = await h.handle({ id: "9", before: null, after: resv() });
    assert.deepStrictEqual(outcome.result, { status: "skipped", reason: "disabled", message: "오너비스타에서 … 꺼져 있어 보내지 않았습니다." });
  });

  await check("못 닿거나 5xx 면 한 번 더 (같은 예약번호라 두 번 나가지 않는다), 그래도 안 되면 실패로 적는다", async () => {
    const recovered = harness({ responses: [new Error("ECONNRESET"), { status: 200, body: { ok: true, sent: true, reason: "queued" } }] });
    assert.strictEqual((await recovered.handle({ id: "10", before: null, after: resv() })).result.status, "sent");
    assert.strictEqual(recovered.posts.length, 2);
    assert.deepStrictEqual(recovered.waits, [3000]);

    const down = harness({ responses: [{ status: 503, body: { ok: false } }] });
    const outcome = await down.handle({ id: "11", before: null, after: resv() });
    assert.strictEqual(outcome.result.status, "failed");
    assert.strictEqual(outcome.result.reason, "unreachable");
    assert.strictEqual(down.posts.length, 2);
  });

  await check("401(키)·400(내용)은 다시 해도 같으니 한 번만 부르고 실패 까닭을 적는다", async () => {
    for (const [status, reason] of [[401, "unauthorized"], [400, "invalid"], [404, "unreachable"]]) {
      const h = harness({ responses: [{ status, body: { ok: false } }] });
      const outcome = await h.handle({ id: "12", before: null, after: resv() });
      assert.strictEqual(outcome.result.status, "failed", String(status));
      assert.strictEqual(outcome.result.reason, reason, String(status));
      assert.strictEqual(h.posts.length, 1, `${status} 은 다시 안 부른다`);
    }
  });

  await check("휴대폰 번호 열쇠 — 010·011·016~019, +82, 뒤 8자리(010)", () => {
    assert.strictEqual(mobileDigits("010-1234-5678"), "01012345678");
    assert.strictEqual(mobileDigits("+82 10-1234-5678"), "01012345678");
    assert.strictEqual(mobileDigits("1234-5678"), "01012345678");
    assert.strictEqual(mobileDigits("011-123-4567"), "0111234567");
    assert.strictEqual(mobileDigits("02-123-4567"), null);
    assert.strictEqual(mobileDigits(undefined), null);
  });

  await check("이름은 40자까지, 없으면 null · 인원은 999명까지", () => {
    const plan = planReservationAlimtalk({ id: 13, before: null, after: resv({ name: "가".repeat(50), people: 1200 }), ...TODAY });
    assert.strictEqual(plan.payload.name.length, 40);
    assert.strictEqual(plan.payload.people, 999);
    assert.strictEqual(planReservationAlimtalk({ id: 13, before: null, after: resv({ name: " " }), ...TODAY }).payload.name, null);
  });

  await check("sendWithRetry 는 오너비스타 답을 예약에 적을 모양으로만 바꾼다", async () => {
    const result = await sendWithRetry(async () => ({ status: 200, body: { ok: true, sent: true } }), {}, async () => {});
    assert.deepStrictEqual(result, { status: "sent", reason: "queued", message: null });
  });

  console.log(results.join("\n"));
  console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
})();
