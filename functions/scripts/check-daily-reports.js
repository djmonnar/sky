"use strict";

/**
 * 나챗방 매일 보내기(오전 11시 오늘 예약 · 오후 10시 30분 일일 정산) 점검 — 배포·네트워크 없이
 *
 *   npm run test:daily
 *
 * Firestore 와 카카오 보내기를 가짜로 바꿔, 글 모양(200자·취소/노쇼 제외·모르는 칸은 «아직 안 들어옴»),
 * 정산 직전에 매출을 먼저 받아 오는지, 22시 수집 전 숫자에 표시가 붙는지, 하루 한 번만 나가는지,
 * 시험 발송이 자동 발송을 막지 않는지 본다.
 */

const assert = require("node:assert");
const {
  createDailyReports, buildReservationsMemo, buildSettlementMemo, salesFreshnessNote, effectiveSales, checklistSummary,
  laborCostOf, laborLine, shiftMinutes,
  buildWeeklyMemo, lastWeekOf, fixedCostShare, weekReservationStats, laborCostOfDates,
} = require("../dailyReports");
const { phoneKey } = require("../naverReservationSync");
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
/** 오너비스타가 22시 수집을 마친 때(22:08 KST) — 평소 */
const AFTER_22 = "2026-10-19T13:08:00.000Z";
let syncShouldFail;
let syncResult;
const reports = createDailyReports({
  admin, storeCol, storeDoc,
  formatDate: () => DATE,
  kakaoMemo,
  syncSales: async () => {
    events.push("sync");
    if (syncShouldFail) throw new Error("오너비스타 응답 없음");
    return syncResult;
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
  syncResult = { ok: true, runId: "r1", message: "14일치를 받았습니다.", collectedAt: AFTER_22 };
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
  // 인건비: 월급 3,100,000 ÷ 31일 = 100,000 · 건별 60,000 × 2슬롯 = 120,000 · 시급 12,000 × 오전 250분 = 50,000
  put("employees", "1", { id: 1, name: "정직원", employmentType: "fullTime", salaryType: "monthly", hourly: 0, monthlySalary: 3_100_000 });
  put("employees", "2", { id: 2, name: "건별알바", employmentType: "partTime", salaryType: "perSlot", hourly: 0, slotRate: 60_000 });
  put("employees", "3", { id: 3, name: "시급알바", employmentType: "partTime", salaryType: "hourly", hourly: 12_000 });
  put("shifts", "a", { date: DATE, period: "morning", department: "hall", employeeId: 2, employeeName: "건별알바" });
  put("shifts", "b", { date: DATE, period: "afternoon", department: "hall", employeeId: 2, employeeName: "건별알바" });
  put("shifts", "c", { date: DATE, period: "morning", department: "kitchen", employeeId: 3, employeeName: "시급알바" });
  put("shifts", "d", { date: DATE, period: "morning", department: "hall", employeeId: 3, employeeName: "시급알바" }); // 같은 칸 두 번
  put("shifts", "e", { date: DATE, period: "morning", department: "hall", employeeId: 1, employeeName: "정직원" }); // 월급은 하루 몫으로
  put("shifts", "f", { date: "2026-10-20", period: "morning", department: "hall", employeeId: 2, employeeName: "건별알바" }); // 다른 날
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

  await check("인건비: 월급은 하루 몫, 건별은 슬롯 수, 시급은 슬롯 시간 — 같은 칸 두 번·쉬는 칸·다른 날은 안 센다", async () => {
    const employees = [...db.entries()].filter(([k]) => k.startsWith("employees/")).map(([, v]) => v);
    const shifts = [...db.entries()].filter(([k]) => k.startsWith("shifts/")).map(([, v]) => v);
    assert.deepStrictEqual(laborCostOf({ date: DATE, shifts, employees }), { total: 270_000, unknown: 0 });
    // 쉬는 칸은 빼고, 근무표에만 있고 직원이 아닌 이름·시급 0 인 사람은 «모름»
    const more = [
      ...shifts,
      { date: DATE, period: "afternoon", employeeId: 3, off: true },
      { date: DATE, period: "afternoon", employeeId: 99, employeeName: "도우미" },
    ];
    const withZero = [...employees, { id: 4, name: "시급미정", salaryType: "hourly", hourly: 0 }];
    more.push({ date: DATE, period: "afternoon", employeeId: 4 });
    assert.deepStrictEqual(laborCostOf({ date: DATE, shifts: more, employees: withZero }), { total: 270_000, unknown: 2 });
    // 칸에 시각을 따로 적었으면 그것 — 17:00~22:00 휴게 0 = 300분
    assert.strictEqual(shiftMinutes({ period: "afternoon", start: "17:00", end: "22:00", breakMin: 0 }), 300);
    assert.strictEqual(shiftMinutes({ period: "afternoon" }), 270);
    // 셀 사람이 아무도 없으면 줄을 안 만든다
    assert.strictEqual(laborCostOf({ date: DATE, shifts: [], employees: [] }), null);
  });

  await check("인건비 줄: 매출을 알면 비율, 모르면 금액만, 모르는 사람은 «N명 모름»", async () => {
    assert.strictEqual(laborLine({ total: 270_000, unknown: 0 }, { amount: 5_000_000, source: "naver" }), "인건비 270,000원(매출의 5%)");
    assert.strictEqual(laborLine({ total: 270_000, unknown: 2 }, null), "인건비 270,000원 · 2명 모름");
    assert.strictEqual(laborLine(null, { amount: 1 }), null);
  });

  /* ── 주간 보고 ── */

  await check("주간: «지난주»는 다 끝난 앞 주 월~일 — 월요일에 보내면 바로 앞 주, 다른 요일 시험도 같다", async () => {
    assert.deepStrictEqual(lastWeekOf("2026-10-26"), { start: "2026-10-19", end: "2026-10-25" }, "월요일");
    assert.deepStrictEqual(lastWeekOf("2026-10-28"), { start: "2026-10-19", end: "2026-10-25" }, "수요일 시험");
    assert.deepStrictEqual(lastWeekOf("2026-10-25"), { start: "2026-10-12", end: "2026-10-18" }, "일요일은 그 주가 안 끝났다");
  });

  await check("주간: 고정비 몫 = 날마다 그달 고정비 ÷ 그달 날수, 걸친 달 하나라도 안 적었으면 «미입력»(null)", async () => {
    const oct = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
    assert.strictEqual(fixedCostShare(oct, new Map([["2026-10", 3_100_000]])), 700_000);
    const span = ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];
    assert.strictEqual(fixedCostShare(span, new Map([["2026-10", 3_100_000]])), null, "11월을 안 적었다");
    assert.strictEqual(fixedCostShare(span, new Map([["2026-10", 3_100_000], ["2026-11", 3_000_000]])), 300_000 + 400_000);
  });

  await check("주간: 예약 — 취소 빼고 팀·인원, 노쇼, 재방문(그 전에 다녀간 적 있는 번호, 번호 모양 달라도 같은 손님)", async () => {
    const reservations = [
      { date: "2026-09-01", status: "방문완료", phone: "010-1111-2222", people: 2 },
      { date: "2026-10-20", status: "예약확정", phone: "01011112222", people: 4 }, // 재방문
      { date: "2026-10-21", status: "방문완료", phone: "010-3333-4444", people: 2 }, // 처음
      { date: "2026-10-22", status: "노쇼", phone: "010-5555-6666", people: 3 },
      { date: "2026-10-23", status: "취소", phone: "010-1111-2222", people: 9 },
      { date: "2026-10-26", status: "예약확정", phone: "010-1111-2222", people: 2 }, // 다음 주
    ];
    assert.deepStrictEqual(
      weekReservationStats({ start: "2026-10-19", end: "2026-10-25", reservations, phoneKey }),
      { teams: 3, people: 9, noShow: 1, revisit: 1 },
    );
  });

  await check("주간: 글 — 매출·전주 대비, 매입·인건비(%), 고정비 → 이익 추정, 예약·노쇼율·재방문", async () => {
    const text = buildWeeklyMemo({
      start: "2026-10-19", end: "2026-10-25",
      sales: { total: 52_000_000, days: 7, prevTotal: 48_000_000, prevDays: 7 },
      purchases: { total: 3_000_000, count: 5 },
      labor: { total: 10_400_000, unknown: 0 },
      fixed: 1_400_000,
      reservations: { teams: 40, people: 150, noShow: 2, revisit: 11 },
    });
    assert.strictEqual(text, [
      "[하늘땅] 주간 보고 10/19(월)~10/25(일)",
      "매출 52,000,000원 · 전주 대비 +8%",
      "매입 3,000,000원 · 인건비 10,400,000원(매출의 20%)",
      "고정비 1,400,000원 → 이익 추정 37,200,000원",
      "예약 40팀 150명 · 노쇼 2팀(5%) · 재방문 11팀",
    ].join("\n"));
  });

  await check("주간: 모르는 칸은 0 이 아니라 — 매출 없음·고정비 미입력·예약 없음, 큰 숫자도 200자 안", async () => {
    const empty = buildWeeklyMemo({
      start: "2026-10-19", end: "2026-10-25",
      sales: { total: 0, days: 0, prevTotal: 0, prevDays: 0 },
      purchases: { total: 0, count: 0 },
      labor: null,
      fixed: null,
      reservations: { teams: 0, people: 0, noShow: 0, revisit: 0 },
    });
    assert.strictEqual(empty, [
      "[하늘땅] 주간 보고 10/19(월)~10/25(일)",
      "매출 아직 안 들어옴",
      "매입 0원",
      "고정비 미입력(손익 탭에 적으면 이익도 알려 드림)",
      "예약 없음",
    ].join("\n"));
    const big = buildWeeklyMemo({
      start: "2026-10-19", end: "2026-10-25",
      sales: { total: 152_345_678, days: 6, prevTotal: 140_000_000, prevDays: 7 },
      purchases: { total: 13_210_000, count: 40 },
      labor: { total: 29_876_000, unknown: 2 },
      fixed: 6_340_000,
      reservations: { teams: 148, people: 612, noShow: 12, revisit: 42 },
    });
    assert.ok(big.length <= MEMO_TEXT_LIMIT, `${big.length}자`);
    assert.ok(big.endsWith("재방문 42팀"), big);
    assert.match(big, /매출 152,345,678원 · 6일 · 전주 대비 \+9%/);
  });

  await check("주간: 모으기 — 그 주 매출(OK포스 우선)·전주, 그 주 매입, 인건비 7일, 고정비 몫, 예약", async () => {
    const put = (col, id, value) => db.set(`${col}/${id}`, value);
    // 보내는 날 10/26(월) → 지난주 10/19~10/25
    put("salesDailySummaries", "2026-10-20", { businessDate: "2026-10-20", netAmount: 4_000_000, source: "ownervista", okpos: { netAmount: 4_500_000 } });
    put("salesDailySummaries", "2026-10-12", { businessDate: "2026-10-12", netAmount: 9_000_000, source: "ownervista" }); // 전주
    put("purchaseOrders", "9", { status: "received", totalAmount: 70_000, receivedAt: "2026-10-24T05:00:00.000Z" });
    put("fixedCosts", "2026-10", { month: "2026-10", items: [{ id: "r", name: "임대료", amount: 3_100_000 }] });
    put("reservations", "w1", { date: "2026-10-21", time: "12:00", name: "재방문손님", people: 4, status: "방문완료", phone: "010-1111-2222" });
    const w = await reports.gatherWeekly("2026-10-26");
    assert.deepStrictEqual([w.start, w.end], ["2026-10-19", "2026-10-25"]);
    // 10/19 네이버 5,000,000 + 10/20 OK포스 4,500,000 · 전주 10/12 9,000,000(10/18 OK포스는 이번 주 아님)
    assert.deepStrictEqual(w.sales, { total: 9_500_000, days: 2, prevTotal: 9_000_000 + 7_503_100, prevDays: 2 });
    assert.deepStrictEqual(w.purchases, { total: 90_000 + 70_000, count: 2 }, "10/19 입고·10/24 입고, 취소·10/18 빠짐");
    // 월급 하루 몫 100,000 × 7 + 10/19 건별 120,000 + 시급 50,000 (10/20 건별 60,000 은 다른 날 칸도 이번 주라 더함)
    assert.deepStrictEqual(w.labor, { total: 700_000 + 120_000 + 50_000 + 60_000, unknown: 0 });
    assert.strictEqual(w.fixed, 700_000);
    // 10/19 넷(김하늘·최미선·정미자·노쇼손님, 취소 빼고) + 10/20 내일손님 + 10/21 재방문손님(10/19 김하늘과 같은 번호)
    assert.deepStrictEqual(w.reservations, { teams: 6, people: 22, noShow: 1, revisit: 1 });
    assert.deepStrictEqual(laborCostOfDates({ dates: [], shifts: [], employees: [] }), null);
  });

  await check("주간 보내기: 손익 버튼·손익 화면 링크, 매출을 새로 받아 오지 않는다, 같은 월요일엔 한 번", async () => {
    const result = await reports.send("weekly", { date: "2026-10-26", trigger: "test", by: "김지현" });
    assert.deepStrictEqual(events, ["broadcast"], "주간은 받아 오기 없이");
    assert.strictEqual(result.status, "sent");
    assert.strictEqual(sent[0].buttonTitle, "손익 보기");
    assert.strictEqual(sent[0].link, "https://sky.example.app/finance?tab=profit");
    assert.match(sent[0].text, /^\[하늘땅\] 주간 보고 10\/19\(월\)~10\/25\(일\)/);
    assert.strictEqual(db.get("meta/kakaoMemoSchedule").weekly.trigger, "test");
    await reports.runScheduled("weekly");
    await reports.runScheduled("weekly");
    assert.strictEqual(sent.length, 2, "시험 1 + 자동 1 — 자동은 같은 날 두 번 안 나간다");
    assert.strictEqual(canRun("sendWeekly", "admin"), true);
    assert.strictEqual(canRun("sendWeekly", "manager"), false);
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
      "인건비 270,000원(매출의 5%)",
      "직접 입력 매출 50,000원",
      "예약 3팀 11명 · 노쇼 1",
      "체크리스트 오픈 1/1 · 마감 1/2",
    ].join("\n"));
    const meta = db.get("meta/kakaoMemoSchedule").settlement;
    assert.strictEqual(meta.trigger, "test");
    assert.strictEqual(meta.by, "김지현");
    assert.strictEqual(meta.delivered, 2);
  });

  await check("정산 보내기: 오너비스타에서 못 받아 와도 있는 숫자로 나간다 — 못 받아 왔다고 밝히고", async () => {
    syncShouldFail = true;
    const result = await reports.send("settlement", { trigger: "test" });
    assert.strictEqual(result.status, "sent");
    assert.match(result.text, /매출 5,000,000원 \(네이버\)\n※ 오너비스타 연결 실패 · 이전에 받은 숫자\n/);
  });

  /* ── 22시 수집 전 표시 ── */

  await check("정산: 22시 수집 전 숫자면 매출 바로 밑에 «22시 수집 전 숫자 · 마지막 수집 21:11»", async () => {
    syncResult = { ok: true, collectedAt: "2026-10-19T12:11:40.000Z" }; // 21:11 KST
    const result = await reports.send("settlement", { trigger: "scheduled" });
    const lines = result.text.split("\n");
    assert.strictEqual(lines[1], "매출 5,000,000원 (네이버)");
    assert.strictEqual(lines[2], "※ 22시 수집 전 숫자 · 마지막 수집 21:11");
    assert.strictEqual(lines[3], "이번 달 12,503,100원 · 2일");
  });

  await check("정산: 22시 정각부터는 22시 수집이 들어온 것 — 아무것도 안 붙인다", async () => {
    const sales = { amount: 1, source: "naver" };
    assert.strictEqual(salesFreshnessNote({ date: DATE, sales, collection: { ok: true, collectedAt: "2026-10-19T13:00:00.000Z" } }), null);
    assert.strictEqual(
      salesFreshnessNote({ date: DATE, sales, collection: { ok: true, collectedAt: "2026-10-19T12:59:59.000Z" } }),
      "※ 22시 수집 전 숫자 · 마지막 수집 21:59",
    );
    const result = await reports.send("settlement", { trigger: "scheduled" });
    assert.ok(!result.text.includes("※"), result.text);
  });

  await check("정산: 마지막 수집이 그 전날이면 날짜까지 적는다", async () => {
    assert.strictEqual(
      salesFreshnessNote({ date: DATE, sales: { amount: 1, source: "naver" }, collection: { ok: true, collectedAt: "2026-10-18T12:10:00.000Z" } }),
      "※ 22시 수집 전 숫자 · 마지막 수집 10/18(일) 21:10",
    );
  });

  await check("정산: OK포스 숫자인 날·매출이 없는 날·받아 오기 결과를 모르는 날은 안 붙인다", async () => {
    const early = { ok: true, collectedAt: "2026-10-19T08:11:51.831Z" }; // 17:11 KST
    assert.strictEqual(salesFreshnessNote({ date: DATE, sales: { amount: 1, source: "okpos" }, collection: early }), null);
    assert.strictEqual(salesFreshnessNote({ date: DATE, sales: null, collection: early }), null);
    assert.strictEqual(salesFreshnessNote({ date: DATE, sales: { amount: 1, source: "naver" }, collection: null }), null);
    syncResult = undefined;
    const result = await reports.send("settlement", { trigger: "test" });
    assert.ok(!result.text.includes("※"), result.text);
  });

  await check("정산: 오너비스타가 거절(설정 없음 등)하면 연결 실패, 수집 시각이 없으면 «모름» — 단정하지 않는다", async () => {
    syncResult = { ok: false, runId: "r2", message: "오너비스타 매출 주소가 설정되지 않았습니다." };
    assert.match((await reports.send("settlement", { trigger: "test" })).text, /\n※ 오너비스타 연결 실패 · 이전에 받은 숫자\n/);
    syncResult = { ok: true, collectedAt: null };
    assert.match((await reports.send("settlement", { trigger: "test" })).text, /\n※ 오너비스타 수집 시각 모름\n/);
  });

  await check("정산: 표시가 붙어도 큰 숫자·긴 체크리스트까지 200자 안, 표시 줄은 잘리지 않는다", async () => {
    const text = buildSettlementMemo({
      date: DATE,
      sales: { amount: 12_345_678, source: "naver" },
      collection: { ok: true, collectedAt: "2026-10-18T12:10:00.000Z" },
      month: { total: 345_678_901, days: 31 },
      purchases: { total: 1_234_567, count: 12 },
      labor: { total: 1_234_567, unknown: 2 },
      manualSales: 1_234_567,
      reservations: { teams: 25, people: 123, noShow: 3 },
      checklist: "오픈 12/12 · 마감 15/15",
    });
    assert.ok(text.length <= MEMO_TEXT_LIMIT, `${text.length}자`);
    assert.ok(text.includes("\n※ 22시 수집 전 숫자 · 마지막 수집 10/18(일) 21:10\n"), text);
    assert.ok(text.endsWith("체크리스트 오픈 12/12 · 마감 15/15"), text);
    // 넘치면 글자를 자르지 않고 덜 중요한 줄(직접 입력 매출 → 이번 달 누적)부터 뺀다 — 인건비·예약은 남는다
    assert.ok(text.includes("\n인건비 1,234,567원(매출의 10%) · 2명 모름\n"), text);
    assert.ok(!text.includes("직접 입력 매출"), text);
    assert.ok(text.includes("예약 25팀 123명 · 노쇼 3"), text);
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
