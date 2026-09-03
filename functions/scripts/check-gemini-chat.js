"use strict";

/**
 * geminiChat 도구 레이어 점검 (배포/네트워크 없이 실행).
 *
 *   npm run test:chat
 *
 * Firestore와 Gemini API를 메모리 스텁으로 대체해서
 * 권한 게이트, 확인 카드 검증, functionCall/functionResponse 짝 맞추기,
 * 확정 저장까지 확인합니다.
 */

const assert = require("node:assert");
const { createGeminiChat } = require("../geminiChat");

/* ── Firestore 스텁 ──────────────────────────────────────────────────────── */

const TODAY = "2026-09-03";
const data = {
  reservations: {
    "1001": { id: 1001, date: TODAY, time: "18:00", name: "김하늘", phone: "010-1234-5678", people: 4, seat: "창가", status: "예약확정" },
    "1002": { id: 1002, date: TODAY, time: "19:30", name: "박땅", phone: "01098765432", people: 2, seat: "", status: "예약대기" },
  },
  employees: {
    "1": { id: 1, name: "김현지", roleLabel: "홀", employmentType: "정규직", active: true },
    "2": { id: 2, name: "이바다", roleLabel: "주방", employmentType: "아르바이트", active: true },
    "3": { id: 3, name: "퇴사자", roleLabel: "홀", active: false },
  },
  shifts: {
    a: { date: TODAY, employeeId: 1, employeeName: "김현지", period: "morning", department: "hall" },
    b: { date: TODAY, employeeId: 2, employeeName: "이바다", period: "afternoon", department: "kitchen" },
  },
  workRecords: {
    w1: { empId: 1, date: TODAY, status: "제출", planStart: "10:20", planEnd: "15:00", breakMin: 30 },
  },
  salesOrders: {
    o1: {
      businessDate: TODAY, status: "paid", totalAmount: 50000, discountAmount: 0,
      paidAmount: 50000, refundAmount: 0,
      paymentMethods: [{ method: "card", amount: 50000 }],
      items: [{ name: "삼겹살", quantity: 2, totalAmount: 36000 }],
    },
    o2: {
      businessDate: TODAY, status: "paid", totalAmount: 30000, discountAmount: 2000,
      paidAmount: 28000, refundAmount: 0,
      paymentMethods: [{ method: "현금", amount: 28000 }],
      items: [{ name: "된장찌개", quantity: 3, totalAmount: 24000 }],
    },
    o3: { businessDate: TODAY, status: "canceled", totalAmount: 10000, discountAmount: 0, paidAmount: 0, refundAmount: 0 },
  },
  notices: { "900": { id: 900, text: "단체 예약 세팅 확인", date: TODAY } },
  handovers: {},
};

const writes = [];

function snapOf(collection) {
  const rows = Object.entries(data[collection] ?? {});
  return {
    size: rows.length,
    docs: rows.map(([id, value]) => ({ id, data: () => value })),
  };
}

function query(collection, filters = []) {
  return {
    where: (field, op, value) => query(collection, [...filters, { field, op, value }]),
    get: async () => {
      const snap = snapOf(collection);
      const docs = snap.docs.filter((doc) =>
        filters.every(({ field, op, value }) => {
          const actual = doc.data()[field];
          if (op === "==") return actual === value;
          if (op === ">=") return String(actual) >= String(value);
          if (op === "<=") return String(actual) <= String(value);
          return true;
        })
      );
      return { docs, size: docs.length };
    },
  };
}

const deps = {
  admin: { firestore: { FieldValue: { serverTimestamp: () => "__ts__" } } },
  storeCol: (name) => query(name),
  storeDoc: (collection, id) => ({
    get: async () => {
      const value = data[collection]?.[id];
      return { exists: Boolean(value), data: () => value };
    },
    set: async (value, options) => {
      writes.push({ collection, id, value, options });
      data[collection] = data[collection] ?? {};
      data[collection][id] = { ...(data[collection][id] ?? {}), ...value };
    },
  }),
  formatDate: () => TODAY,
  resolveDate: (raw) => {
    const text = String(raw ?? "").trim();
    if (!text || /오늘/.test(text)) return TODAY;
    if (/내일/.test(text)) return "2026-09-04";
    const match = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[0] : TODAY;
  },
  normalizeStatus: (raw) => {
    const text = String(raw ?? "");
    if (/취소/.test(text)) return "취소";
    if (/방문|완료/.test(text)) return "방문완료";
    if (/노쇼/.test(text)) return "노쇼";
    if (/단체/.test(text)) return "단체";
    if (/확정|예약/.test(text)) return "예약확정";
    return "";
  },
  normalizePaymentMethod: (raw) => {
    const text = String(raw || "").toLowerCase();
    if (/card|카드/.test(text)) return "card";
    if (/cash|현금/.test(text)) return "cash";
    return "other";
  },
  parseTime: (period, time) => {
    const raw = String(time ?? "").trim();
    const match = raw.match(/^(\d{1,2}):?(\d{2})?$/);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? "00");
    if (/오후|pm/i.test(String(period)) && hour < 12) hour += 12;
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  },
  dayIndexOf: () => 3,
  canManageOps: (user) => user.role === "admin" || user.role === "manager",
};

const chat = createGeminiChat(deps);

const ADMIN = { uid: "u1", name: "김지현", role: "admin", roleLabel: "관리자", employeeId: 0 };
const STAFF = { uid: "u2", name: "김현지", role: "staff", roleLabel: "실무자", employeeId: 1 };

/* ── Gemini 스텁 ─────────────────────────────────────────────────────────── */

let scripted = [];
let requests = [];

function stubGemini(turns) {
  scripted = [...turns];
  requests = [];
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const turn = scripted.shift() ?? { text: "끝" };
    const parts = turn.calls
      ? turn.calls.map((call) => ({ functionCall: call }))
      : [{ text: turn.text }];
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts }, finishReason: "STOP" }] }),
    };
  };
}

/* ── 검사 ───────────────────────────────────────────────────────────────── */

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

(async () => {
  await check("조회: 오늘 현황 집계", async () => {
    stubGemini([{ calls: [{ name: "get_today_overview", args: {} }] }, { text: "오늘 예약 2건입니다." }]);
    const result = await chat.runConversation({ apiKey: "k", model: "m", actor: ADMIN, messages: [{ role: "user", text: "오늘 현황" }] });
    assert.match(result.reply, /예약 2건/);
    const toolTurn = requests[1].contents.find((entry) => entry.parts.some((part) => part.functionResponse));
    const payload = toolTurn.parts[0].functionResponse.response;
    assert.strictEqual(payload.reservationCount, 2, "취소 아닌 예약 2건");
    assert.strictEqual(payload.expectedGuestCount, 6, "예상 손님 6명");
    assert.strictEqual(payload.activeEmployeeCount, 2, "퇴사자 제외 2명");
  });

  await check("조회: 예약 목록의 전화번호가 마스킹됨", async () => {
    stubGemini([{ calls: [{ name: "list_reservations", args: { date: "오늘" } }] }, { text: "2건" }]);
    await chat.runConversation({ apiKey: "k", model: "m", actor: ADMIN, messages: [{ role: "user", text: "오늘 예약" }] });
    // 검사 대상은 Firestore에서 읽어 모델로 되돌려주는 도구 응답입니다.
    // (요청 전체를 훑으면 툴 스키마의 예시 번호까지 걸립니다.)
    const toolTurn = requests[1].contents.find((entry) => entry.parts.some((part) => part.functionResponse));
    const payload = JSON.stringify(toolTurn.parts[0].functionResponse.response);
    assert.ok(!payload.includes("1234-5678"), "원본 번호가 모델로 나가면 안 됨");
    assert.ok(!payload.includes("01098765432"), "원본 번호가 모델로 나가면 안 됨");
    assert.ok(payload.includes("010-****-5678"), "마스킹된 번호가 전달되어야 함");
    assert.ok(payload.includes("010-****-5432"), "구분자 없는 번호도 마스킹되어야 함");
  });

  await check("권한: 실무자는 매출 도구가 노출되지 않음", async () => {
    stubGemini([{ text: "권한이 없습니다." }]);
    await chat.runConversation({ apiKey: "k", model: "m", actor: STAFF, messages: [{ role: "user", text: "매출 알려줘" }] });
    const names = requests[0].tools[0].functionDeclarations.map((tool) => tool.name);
    assert.ok(!names.includes("sales_report"), "sales_report가 실무자에게 보이면 안 됨");
    assert.ok(!names.includes("list_employees"), "list_employees가 실무자에게 보이면 안 됨");
    assert.ok(names.includes("list_reservations"), "예약 조회는 가능해야 함");
  });

  await check("권한: 실무자가 매출 도구를 억지로 불러도 거부됨", async () => {
    stubGemini([{ calls: [{ name: "sales_report", args: { startDate: TODAY, endDate: TODAY } }] }, { text: "권한 없음" }]);
    await chat.runConversation({ apiKey: "k", model: "m", actor: STAFF, messages: [{ role: "user", text: "매출" }] });
    const toolTurn = requests[1].contents.find((entry) => entry.parts.some((part) => part.functionResponse));
    assert.match(toolTurn.parts[0].functionResponse.response.error, /권한/);
  });

  await check("권한: 실무자 근무표는 본인 것만", async () => {
    stubGemini([{ calls: [{ name: "list_shifts", args: {} }] }, { text: "ok" }]);
    await chat.runConversation({ apiKey: "k", model: "m", actor: STAFF, messages: [{ role: "user", text: "내 근무" }] });
    const toolTurn = requests[1].contents.find((entry) => entry.parts.some((part) => part.functionResponse));
    const payload = toolTurn.parts[0].functionResponse.response;
    assert.strictEqual(payload.total, 1, "본인(employeeId=1) 근무 1건만");
    assert.strictEqual(payload.shifts[0].employeeName, "김현지");
  });

  await check("매출: 취소 주문 제외하고 순매출 집계", async () => {
    stubGemini([{ calls: [{ name: "sales_report", args: { startDate: TODAY, endDate: TODAY } }] }, { text: "ok" }]);
    const result = await chat.runConversation({ apiKey: "k", model: "m", actor: ADMIN, messages: [{ role: "user", text: "오늘 매출" }] });
    const toolTurn = requests[1].contents.find((entry) => entry.parts.some((part) => part.functionResponse));
    const payload = toolTurn.parts[0].functionResponse.response;
    assert.strictEqual(payload.orderCount, 2, "유효 주문 2건");
    assert.strictEqual(payload.canceledCount, 1, "취소 1건");
    assert.strictEqual(payload.netAmount, 78000, "순매출 78,000원");
    assert.strictEqual(payload.averageOrderAmount, 39000, "객단가 39,000원");
    assert.deepStrictEqual(
      payload.paymentTotals.map((row) => [row.method, row.amount]),
      [["card", 50000], ["cash", 28000]],
      "한글 '현금'도 cash로 정규화"
    );
    assert.ok(result.blocks.some((block) => block.type === "salesReport"), "UI 카드 블록이 실려야 함");
  });

  await check("쓰기: 필수 항목이 빠지면 확인 카드를 만들지 않음", async () => {
    stubGemini([{ calls: [{ name: "create_reservation", args: { date: "내일", name: "홍길동" } }] }, { text: "연락처를 알려주세요." }]);
    const result = await chat.runConversation({ apiKey: "k", model: "m", actor: ADMIN, messages: [{ role: "user", text: "내일 홍길동 예약" }] });
    assert.strictEqual(result.pendingAction, undefined, "확인 카드가 뜨면 안 됨");
    const toolTurn = requests[1].contents.find((entry) => entry.parts.some((part) => part.functionResponse));
    assert.match(toolTurn.parts[0].functionResponse.response.error, /연락처/);
  });

  await check("쓰기: 확인 카드만 만들고 저장하지 않음", async () => {
    writes.length = 0;
    stubGemini([
      { calls: [{ name: "create_reservation", args: { date: "내일", time: "7:00", period: "오후", name: "홍길동", phone: "010-1111-2222", people: 4, seat: "창가" } }] },
      { text: "아래 내용으로 등록할까요?" },
    ]);
    const result = await chat.runConversation({ apiKey: "k", model: "m", actor: ADMIN, messages: [{ role: "user", text: "내일 저녁 7시 홍길동 4명" }] });
    assert.ok(result.pendingAction, "확인 카드가 있어야 함");
    assert.strictEqual(result.pendingAction.args.date, "2026-09-04");
    assert.strictEqual(result.pendingAction.args.time, "19:00", "오후 7시 → 19:00");
    assert.strictEqual(writes.length, 0, "확인 전에는 Firestore에 쓰지 않아야 함");
    assert.strictEqual(result.pendingAction.args.phone, "010-1111-2222", "확인 카드에는 원본 번호를 보여줌");
    // 모델에 되돌려주는 응답에는 마스킹된 번호만 담깁니다.
    // (모델이 직접 만든 functionCall 인자에 원본이 남는 것은 사용자가 그렇게 입력했기 때문입니다.)
    const toolTurn = requests[1].contents.find((entry) => entry.parts.some((part) => part.functionResponse));
    const payload = JSON.stringify(toolTurn.parts[0].functionResponse.response);
    assert.ok(!payload.includes("010-1111-2222"), "도구 응답으로 원본 번호를 되돌려주지 않음");
    assert.ok(payload.includes("010-****-2222"), "마스킹된 번호로 요약해야 함");
  });

  await check("쓰기: 확인을 누르면 저장됨", async () => {
    writes.length = 0;
    const pending = {
      tool: "create_reservation",
      args: { date: "2026-09-04", time: "19:00", name: "홍길동", phone: "010-1111-2222", people: 4, seat: "창가", request: "", status: "예약확정" },
    };
    const result = await chat.commitAction(pending, ADMIN);
    assert.ok(result.ok, result.reply);
    assert.strictEqual(writes.length, 1, "예약 1건 저장");
    assert.strictEqual(writes[0].collection, "reservations");
    assert.strictEqual(writes[0].value.phone, "010-1111-2222", "저장은 원본 번호로");
    assert.strictEqual(writes[0].value.writer, "김지현", "작성자는 토큰의 사용자");
  });

  await check("쓰기: 권한 없는 계정의 확정 요청은 거부됨", async () => {
    writes.length = 0;
    const result = await chat.commitAction(
      { tool: "create_reservation", args: { date: TODAY, time: "19:00", name: "x", phone: "010-0000-0000", people: 2 } },
      STAFF
    );
    assert.strictEqual(result.ok, false, "실무자는 예약 등록 확정 불가");
    assert.strictEqual(writes.length, 0);
  });

  await check("쓰기: 공지는 관리자만, 전달사항은 실무자도 가능", async () => {
    writes.length = 0;
    const denied = await chat.commitAction({ tool: "create_notice", args: { kind: "notice", text: "공지" } }, STAFF);
    assert.strictEqual(denied.ok, false, "실무자 공지 등록 불가");
    const allowed = await chat.commitAction({ tool: "create_notice", args: { kind: "handover", text: "주방 재료 입고" } }, STAFF);
    assert.ok(allowed.ok, "실무자 전달사항 등록 가능");
    assert.strictEqual(writes[0].collection, "handovers");
  });

  await check("쓰기: 예약 수정은 존재하는 예약만", async () => {
    stubGemini([{ calls: [{ name: "update_reservation", args: { reservationId: "9999", status: "취소" } }] }, { text: "없음" }]);
    const result = await chat.runConversation({ apiKey: "k", model: "m", actor: ADMIN, messages: [{ role: "user", text: "9999 취소" }] });
    assert.strictEqual(result.pendingAction, undefined);
    const toolTurn = requests[1].contents.find((entry) => entry.parts.some((part) => part.functionResponse));
    assert.match(toolTurn.parts[0].functionResponse.response.error, /찾지 못했습니다/);
  });

  await check("프로토콜: 조회+쓰기 동시 호출도 응답 짝이 맞음", async () => {
    stubGemini([
      { calls: [
        { name: "list_reservations", args: { date: "오늘" } },
        { name: "create_notice", args: { kind: "handover", text: "홀 청소" } },
      ] },
      { text: "확인해주세요." },
    ]);
    const result = await chat.runConversation({ apiKey: "k", model: "m", actor: ADMIN, messages: [{ role: "user", text: "예약 보고 전달사항 남겨줘" }] });
    assert.ok(result.pendingAction, "확인 카드가 있어야 함");
    const followUp = requests[1];
    const modelTurn = followUp.contents.find((entry) => entry.role === "model" && entry.parts.some((part) => part.functionCall));
    const respTurn = followUp.contents.find((entry) => entry.parts.some((part) => part.functionResponse));
    assert.strictEqual(
      modelTurn.parts.length,
      respTurn.parts.length,
      "functionCall 개수와 functionResponse 개수가 같아야 Gemini가 400을 내지 않음"
    );
  });

  await check("프로토콜: 도구 호출이 끝없이 반복되면 중단됨", async () => {
    stubGemini(Array.from({ length: 10 }, () => ({ calls: [{ name: "get_today_overview", args: {} }] })));
    const result = await chat.runConversation({ apiKey: "k", model: "m", actor: ADMIN, messages: [{ role: "user", text: "무한" }] });
    assert.match(result.reply, /단계가 너무 많아졌습니다/);
  });

  console.log(results.join("\n"));
  console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
})();
