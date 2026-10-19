"use strict";

/**
 * 나챗방 매일 보내기(오전 11시 오늘 예약 · 오후 10시 일일 정산) 점검 — 배포·네트워크 없이
 *
 *   npm run test:daily
 *
 * Firestore 와 카카오 보내기를 가짜로 바꿔, 글 모양(200자·취소/노쇼 제외·모르는 칸은 «아직 안 들어옴»),
 * 정산 직전에 매출을 먼저 받아 오는지, 하루 한 번만 나가는지, 시험 발송이 자동 발송을 막지 않는지 본다.
 */

const assert = require("node:assert");
const {
  createDailyReports, buildReservationsMemo, buildSettlementMemo, effectiveSales, checklistSummary,
} = require("../dailyReports");
const { canRun, MEMO_TEXT_LIMIT } = require("../kakaoMemo");

/* ── 가짜 Firestore ── */

let db;
function storeDoc(col, id) {
  const k = `${col}/${id}`;
  return {
    get: async () => ({ exists: db.has(k), data: () => db.get(k) }),
    set: async (data, options) => db.set(k, { ...(options && options.merge ? db.get(k) || {} : {}), ...data }),
  };
}
function storeCol(col, filters = []) {
  return {
    where: (field, op, value) => storeCol(col, [...filters, { field, op, value }]),
    get: async () => {
      const docs = [...db.entries()]
        .filter(([k]) => k.startsWith(`${col}/`) && k.split("/").length === 2)
        .map(([k, value]) => ({ id: k.split("/")[1], data: () => value }))
        .filter((doc) => filters.every(({ field, op, value }) => {
          const actual = doc.data()[field];
          if (op === "==") return actual === value;
          if (op === ">=") return String(actual) >= String(value);
          if (op === "<=") return String(actual) <= String(value);
          return true;
        }));
      return { docs, size: docs.length };
    },
  };
}
const admin = { firestore: { FieldValue: { serverTimestamp: () => "__ts__" } } };

/* ── 가짜 카카오 ── */

let sent;
let linkCount;
let events;
const kakaoMemo = {
  keys: () => ({ restApiKey: "K", clientSecret: "" }),
  broadcast: async (payload) => {
    events.push("broadcast");
    sent.push(payload);
    return linkCount > 0
      ? { linkCount, delivered: Array.from({ length: linkCount }, (_, i) => `받는곳${i + 1}`), failed: [] }
      : { linkCount: 0, delivered: [], failed: [] };
  },
};

const DATE = "2026-10-19"; // 월
let syncShouldFail;
const reports = createDailyReports({
  admin, storeCol, storeDoc,
  formatDate: () => DATE,
  kakaoMemo,
  syncSales: async () => {
    events.push("sync");
    if (syncShouldFail) throw new Error("오너비스타 응답 없음");
  },
  appBaseUrl: "https://sky.example.app",
  now: () => 1_800_000_000_000,
});

function seed() {
  db = new Map();
  sent = [];
  events = [];
  linkCount = 2;
  syncShouldFail = false;
  const put = (col, id, value) => db.set(`${col}/${id}`, value);
  put("reservations", "1", { date: DATE, time: "18:00", name: "김하늘", people: 4, seat: "창가", status: "예약확정", phone: "010-1111-2222" });
  put("reservations", "2", { date: DATE, time: "11:50", name: "최미선", people: 3, status: "방문완료" });
  put("reservations", "3", { date: DATE, time: "12:00", name: "정미자", people: 4, status: "예약확정" });
  put("reservations", "4", { date: DATE, time: "13:00", name: "취소손님", people: 2, status: "취소" });
  put("reservations", "5", { date: DATE, time: "19:00", name: "노쇼손님", people: 5, status: "노쇼" });
  put("reservations", "6", { date: "2026-10-20", time: "12:00", name: "내일손님", people: 2, status: "예약확정" });
  put("salesDailySummaries", DATE, { businessDate: DATE, netAmount: 5_000_000, source: "ownervista" });
  put("salesDailySummaries", "2026-10-18", { businessDate: "2026-10-18", netAmount: 7_000_000, source: "ownervista", okpos: { netAmount: 7_503_100 } });
  put("salesDailySummaries", "2026-09-30", { businessDate: "2026-09-30", netAmount: 9_999_999, source: "ownervista" }); // 지난달
  put("purchaseOrders", "1", { status: "received", totalAmount: 90_000, receivedAt: `${DATE}T05:00:00.000Z` });
  put("purchaseOrders", "2", { status: "canceled", totalAmount: 500_000, createdAt: `${DATE}T01:00:00.000Z` });
  put("purchaseOrders", "3", { status: "ordered", totalAmount: 30_000, orderedAt: "2026-10-18T09:00:00.000Z" });
  put("financeDailyCloses", DATE, { cashSales: 50_000, transferSales: 0, otherSales: 0 });
  put("meta", "checklistTemplate", { items: [
    { id: "o1", section: "open", text: "환기", days: [] },
    { id: "c1", section: "close", text: "가스", days: [] },
    { id: "c2", section: "close", text: "쓰레기", days: [] },
  ] });
  put("checklistDays", DATE, { checks: { o1: { checked: true, text: "환기", section: "open" }, c1: { checked: true, text: "가스", section: "close" } } });
}

const results = [];
async function check(label, fn) {
  seed();
  try {
    await fn();
    results.push(`✅ ${label}`);
  } catch (error) {
    results.push(`❌ ${label}\n   ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  /* ── 글 ── */

  await check("오늘 예약: 취소·노쇼 빼고 시간순, 팀·인원 합, 전화번호는 넣지 않는다", async () => {
    const text = buildReservationsMemo({ date: DATE, reservations: [...db.entries()].filter(([k]) => k.startsWith("reservations/")).map(([, v]) => v).filter((r) => r.date === DATE) });
    assert.strictEqual(text, [
      "[하늘땅] 10/19(월) 오늘 예약 3팀 · 11명",
      "11:50 최미선 3명",
      "12:00 정미자 4명",
      "18:00 김하늘 4명 창가",
    ].join("\n"));
    assert.ok(!text.includes("010"), "전화번호가 나가면 안 된다");
  });

  await check("오늘 예약: 없으면 «오늘 예약 없음»", async () => {
    assert.strictEqual(buildReservationsMemo({ date: DATE, reservations: [] }), "[하늘땅] 10/19(월) 오늘 예약 없음");
  });

  await check("오늘 예약: 많으면 200자 안에서 «외 N팀»", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ time: `1${i % 10}:00`, name: `손님이름${i}`, people: 2, seat: "단체석", status: "예약확정" }));
    const text = buildReservationsMemo({ date: DATE, reservations: many });
    assert.ok(text.length <= MEMO_TEXT_LIMIT, `${text.length}자`);
    assert.ok(text.startsWith("[하늘땅] 10/19(월) 오늘 예약 30팀 · 60명"));
    const shown = text.split("\n").length - 2;
    assert.match(text, new RegExp(`외 ${30 - shown}팀$`), "보인 줄 + 외 N팀 = 30팀");
  });

  await check("일일 정산: 모르는 칸은 0원이 아니라 «아직 안 들어옴»·«없음»", async () => {
    const text = buildSettlementMemo({
      date: DATE, sales: null, month: { total: 0, days: 0 }, purchases: { total: 0, count: 0 }, manualSales: 0,
      reservations: { teams: 0, people: 0, noShow: 0 }, checklist: null,
    });
    assert.strictEqual(text, "[하늘땅] 10/19(월) 일일 정산\n매출 아직 안 들어옴\n매입 없음\n예약 없음");
  });

  await check("매출: OK포스가 먼저, 다음이 네이버, 숫자가 없으면 null", async () => {
    assert.deepStrictEqual(effectiveSales({ netAmount: 1, source: "ownervista", okpos: { netAmount: 2 } }), { amount: 2, source: "okpos" });
    assert.deepStrictEqual(effectiveSales({ netAmount: 1, source: "ownervista" }), { amount: 1, source: "naver" });
    assert.strictEqual(effectiveSales({ businessDate: DATE }), null);
    assert.strictEqual(effectiveSales(null), null);
  });

  await check("체크리스트 요약: 오픈 1/1 · 마감 1/2, 항목 없으면 null", async () => {
    assert.strictEqual(checklistSummary([
      { section: "open", checked: true }, { section: "close", checked: true }, { section: "close", checked: false },
      { section: "close", checked: true, removed: true },
    ]), "오픈 1/1 · 마감 1/2");
    assert.strictEqual(checklistSummary([]), null);
  });

  /* ── 모으기 ── */

  await check("정산 모으기: 이번 달만(OK포스 우선)·오늘 매입(취소 빼고)·직접 입력·예약·노쇼·체크리스트", async () => {
    const s = await reports.gatherSettlement(DATE);
    assert.deepStrictEqual(s.sales, { amount: 5_000_000, source: "naver" });
    assert.deepStrictEqual(s.month, { total: 5_000_000 + 7_503_100, days: 2 }, "9/30 은 빠지고 10/18 은 OK포스 숫자");
    assert.deepStrictEqual(s.purchases, { total: 90_000, count: 1 }, "취소 발주와 어제 발주는 빠진다");
    assert.strictEqual(s.manualSales, 50_000);
    assert.deepStrictEqual(s.reservations, { teams: 3, people: 11, noShow: 1 });
    assert.strictEqual(s.checklist, "오픈 1/1 · 마감 1/2");
  });

  /* ── 보내기 ── */

  await check("정산 보내기: 매출을 먼저 다시 받아 온 뒤 모아서 보낸다 — 정산 버튼과 링크", async () => {
    const result = await reports.send("settlement", { trigger: "test", by: "김지현" });
    assert.deepStrictEqual(events, ["sync", "broadcast"], "받아 오기가 먼저");
    assert.strictEqual(result.status, "sent");
    assert.strictEqual(sent[0].buttonTitle, "정산 보기");
    assert.strictEqual(sent[0].link, "https://sky.example.app/finance?tab=close");
    assert.strictEqual(sent[0].text, [
      "[하늘땅] 10/19(월) 일일 정산",
      "매출 5,000,000원 (네이버)",
      "이번 달 12,503,100원 · 2일",
      "매입 90,000원 · 1건",
      "직접 입력 매출 50,000원",
      "예약 3팀 11명 · 노쇼 1",
      "체크리스트 오픈 1/1 · 마감 1/2",
    ].join("\n"));
    const meta = db.get("meta/kakaoMemoSchedule").settlement;
    assert.strictEqual(meta.trigger, "test");
    assert.strictEqual(meta.by, "김지현");
    assert.strictEqual(meta.delivered, 2);
  });

  await check("정산 보내기: 오너비스타에서 못 받아 와도 있는 숫자로 나간다", async () => {
    syncShouldFail = true;
    const result = await reports.send("settlement", { trigger: "test" });
    assert.strictEqual(result.status, "sent");
    assert.match(result.text, /매출 5,000,000원/);
  });

  await check("예약 보내기: 예약 버튼·예약 화면 링크, 정산처럼 매출을 받아 오지는 않는다", async () => {
    await reports.send("reservations", { trigger: "test" });
    assert.deepStrictEqual(events, ["broadcast"]);
    assert.strictEqual(sent[0].buttonTitle, "예약 보기");
    assert.strictEqual(sent[0].link, "https://sky.example.app/reservations");
  });

  await check("받는 곳이 없으면 «받는 곳 없음»으로 남긴다", async () => {
    linkCount = 0;
    const result = await reports.send("reservations", { trigger: "test" });
    assert.strictEqual(result.status, "no_links");
    assert.strictEqual(db.get("meta/kakaoMemoSchedule").reservations.status, "no_links");
  });

  /* ── 하루 한 번 ── */

  await check("자동 발송은 하루 한 번 — 같은 날 다시 불려도 건너뛴다", async () => {
    const first = await reports.runScheduled("reservations");
    const second = await reports.runScheduled("reservations");
    assert.strictEqual(first.status, "sent");
    assert.strictEqual(second.status, "skipped");
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(db.get(`kakaoMemoReports/${DATE}_reservations`).status, "sent");
    assert.strictEqual(db.get("meta/kakaoMemoSchedule").reservations.trigger, "scheduled");
  });

  await check("시험으로 보내도 그날 자동 발송은 나간다", async () => {
    await reports.send("settlement", { trigger: "test" });
    const scheduled = await reports.runScheduled("settlement");
    assert.strictEqual(scheduled.status, "sent");
    assert.strictEqual(sent.length, 2);
  });

  await check("받는 곳이 없어 못 보낸 날은 다음 부름에서 다시 보낸다", async () => {
    linkCount = 0;
    assert.strictEqual((await reports.runScheduled("reservations")).status, "no_links");
    linkCount = 1;
    assert.strictEqual((await reports.runScheduled("reservations")).status, "sent");
  });

  /* ── 누가 ── */

  await check("시험으로 보내기는 사장님(관리자)만", async () => {
    for (const action of ["sendReservations", "sendSettlement"]) {
      assert.strictEqual(canRun(action, "admin"), true);
      assert.strictEqual(canRun(action, "manager"), false);
      assert.strictEqual(canRun(action, "staff"), false);
    }
  });

  console.log(results.join("\n"));
  console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
})();
