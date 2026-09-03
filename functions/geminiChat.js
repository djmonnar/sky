"use strict";

/**
 * 대시보드 내장 Gemini 챗봇.
 *
 * 브라우저는 Firebase ID 토큰과 대화 내용만 보내고, Gemini API 키는 이 함수
 * 안에서만 쓰입니다(Secret Manager). 조회 도구는 즉시 실행하고, 등록/수정
 * 도구는 저장하지 않고 확인 카드(pendingAction)로 돌려준 뒤 사용자가 확인을
 * 누르면 그때 저장합니다.
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.0-flash";
const MAX_TOOL_ROUNDS = 4;
const MAX_HISTORY = 12;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_ROWS = 40;
const MAX_REPORT_DAYS = 92;

const PAYMENT_LABEL = {
  card: "카드",
  cash: "현금",
  simplePay: "간편결제",
  voucher: "상품권",
  other: "기타",
};

const PERIOD_LABEL = { morning: "오전", afternoon: "오후" };
const DEPARTMENT_LABEL = { hall: "홀", kitchen: "주방" };
const DOW_LABEL = ["월", "화", "수", "목", "금", "토", "일"];

function maskPhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length < 7) return "***";
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

function money(value) {
  return Math.round(Number(value) || 0).toLocaleString("ko-KR");
}

function clampText(value, limit = MAX_MESSAGE_LENGTH) {
  const text = String(value ?? "").trim();
  return text.length > limit ? text.slice(0, limit) : text;
}

function daysBetween(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

function createGeminiChat(deps) {
  const {
    admin,
    storeCol,
    storeDoc,
    formatDate,
    resolveDate,
    normalizeStatus,
    normalizePaymentMethod,
    parseTime,
    dayIndexOf,
    canManageOps,
  } = deps;

  const isOps = (actor) => canManageOps({ role: actor.role });

  // ── 조회 도구 ────────────────────────────────────────────────────────────

  async function toolTodayOverview(_args, actor) {
    const today = formatDate();
    const [reservations, employees, shifts, workRecords] = await Promise.all([
      storeCol("reservations").where("date", "==", today).get(),
      storeCol("employees").get(),
      storeCol("shifts").where("date", "==", today).get(),
      storeCol("workRecords").where("date", "==", today).get(),
    ]);
    const activeReservations = reservations.docs
      .map((doc) => doc.data())
      .filter((row) => !["취소", "노쇼"].includes(String(row.status || "")));
    const activeEmployees = employees.docs.filter((doc) => doc.data().active !== false);
    const pendingRecords = workRecords.docs
      .map((doc) => doc.data())
      .filter((row) => ["미작성", "제출", "승인대기"].includes(String(row.status || "")));
    const guestCount = activeReservations.reduce((sum, row) => sum + (Number(row.people) || 0), 0);

    return {
      date: today,
      dayOfWeek: `${DOW_LABEL[dayIndexOf(today)]}요일`,
      reservationCount: activeReservations.length,
      expectedGuestCount: guestCount,
      shiftAssignmentCount: shifts.size,
      activeEmployeeCount: activeEmployees.length,
      pendingWorkRecordCount: pendingRecords.length,
      viewerRole: actor.role,
    };
  }

  async function toolListReservations(args, actor) {
    const date = resolveDate(args.date || "오늘");
    const status = args.status ? normalizeStatus(args.status) : "";
    let rows = (await storeCol("reservations").where("date", "==", date).get()).docs
      .map((doc) => doc.data())
      .sort((a, b) => String(a.time ?? "").localeCompare(String(b.time ?? "")));
    if (status) rows = rows.filter((row) => row.status === status);

    return {
      date,
      total: rows.length,
      // 전화번호는 가운데 자리를 가려서 모델에 전달합니다(원본은 Firestore에만).
      reservations: rows.slice(0, MAX_ROWS).map((row) => ({
        reservationId: String(row.id ?? ""),
        time: row.time ?? "",
        name: row.name ?? "",
        people: Number(row.people) || 0,
        seat: row.seat || "",
        status: row.status || "",
        request: row.request || "",
        phoneMasked: maskPhone(row.phone),
      })),
      note: actor.role === "staff" ? "실무자 계정에서는 예약 열람만 가능합니다." : undefined,
    };
  }

  async function toolSalesReport(args) {
    const endDate = resolveDate(args.endDate || args.startDate || "오늘");
    const startDate = resolveDate(args.startDate || args.endDate || "오늘");
    const [rangeStart, rangeEnd] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];

    const span = daysBetween(rangeStart, rangeEnd);
    if (span === null) return { error: "날짜를 해석하지 못했습니다. YYYY-MM-DD 형식으로 지정해주세요." };
    if (span > MAX_REPORT_DAYS) {
      return { error: `한 번에 조회할 수 있는 기간은 최대 ${MAX_REPORT_DAYS}일입니다. 기간을 나눠서 요청해주세요.` };
    }

    const snap = await storeCol("salesOrders")
      .where("businessDate", ">=", rangeStart)
      .where("businessDate", "<=", rangeEnd)
      .get();
    const orders = snap.docs.map((doc) => doc.data());
    const active = orders.filter((order) => order.status === "paid" || order.status === "partialRefund");

    const netAmount = active.reduce(
      (sum, order) => sum + Math.max(0, Number(order.paidAmount || 0) - Number(order.refundAmount || 0)),
      0
    );
    const paymentMap = new Map();
    active.forEach((order) => {
      (order.paymentMethods || []).forEach((payment) => {
        const method = normalizePaymentMethod(payment.method);
        paymentMap.set(method, (paymentMap.get(method) || 0) + (Number(payment.amount) || 0));
      });
    });

    const dailyMap = new Map();
    active.forEach((order) => {
      const key = order.businessDate;
      const current = dailyMap.get(key) || { businessDate: key, orderCount: 0, netAmount: 0 };
      current.orderCount += 1;
      current.netAmount += Math.max(0, Number(order.paidAmount || 0) - Number(order.refundAmount || 0));
      dailyMap.set(key, current);
    });

    const itemMap = new Map();
    active.forEach((order) => {
      (order.items || []).forEach((item) => {
        const name = String(item.name || "").trim();
        if (!name) return;
        const current = itemMap.get(name) || { name, quantity: 0, totalAmount: 0 };
        current.quantity += Number(item.quantity) || 0;
        current.totalAmount += Number(item.totalAmount) || 0;
        itemMap.set(name, current);
      });
    });

    return {
      rangeStart,
      rangeEnd,
      dayCount: span,
      orderCount: active.length,
      canceledCount: orders.length - active.length,
      grossAmount: orders.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0),
      discountAmount: orders.reduce((sum, order) => sum + (Number(order.discountAmount) || 0), 0),
      refundAmount: orders.reduce((sum, order) => sum + (Number(order.refundAmount) || 0), 0),
      netAmount,
      averageOrderAmount: active.length ? Math.round(netAmount / active.length) : 0,
      paymentTotals: [...paymentMap.entries()]
        .map(([method, amount]) => ({ method, label: PAYMENT_LABEL[method] || method, amount }))
        .sort((a, b) => b.amount - a.amount),
      daily: [...dailyMap.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate)),
      topItems: [...itemMap.values()].sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 10),
      dataNote: orders.length === 0
        ? "해당 기간에 동기화된 매출 데이터가 없습니다. OK포스 동기화 여부를 확인하세요."
        : undefined,
    };
  }

  async function toolListShifts(args, actor) {
    const date = resolveDate(args.date || "오늘");
    let rows = (await storeCol("shifts").where("date", "==", date).get()).docs.map((doc) => doc.data());
    if (actor.role === "staff") {
      rows = rows.filter((row) => Number(row.employeeId ?? row.empId) === actor.employeeId);
    }
    const name = String(args.employeeName || "").trim();
    if (name) {
      rows = rows.filter((row) => String(row.employeeName || "").includes(name));
    }

    return {
      date,
      dayOfWeek: `${DOW_LABEL[dayIndexOf(date)]}요일`,
      total: rows.length,
      scopedToSelf: actor.role === "staff",
      shifts: rows.slice(0, MAX_ROWS).map((row) => ({
        employeeName: row.employeeName || `직원${row.employeeId ?? row.empId ?? ""}`,
        period: PERIOD_LABEL[row.period] || row.period || "",
        department: DEPARTMENT_LABEL[row.department] || row.department || "",
        roleLabel: row.roleLabel || "",
        start: row.start || "",
        end: row.end || "",
      })),
    };
  }

  async function toolListWorkRecords(args, actor) {
    const date = resolveDate(args.date || "오늘");
    let rows = (await storeCol("workRecords").where("date", "==", date).get()).docs.map((doc) => doc.data());
    if (actor.role === "staff") {
      rows = rows.filter((row) => Number(row.empId) === actor.employeeId);
    }

    const employees = (await storeCol("employees").get()).docs.map((doc) => doc.data());
    const nameOf = (empId) => employees.find((e) => Number(e.id) === Number(empId))?.name || `직원${empId}`;

    const name = String(args.employeeName || "").trim();
    if (name) rows = rows.filter((row) => nameOf(row.empId).includes(name));

    return {
      date,
      total: rows.length,
      scopedToSelf: actor.role === "staff",
      workRecords: rows.slice(0, MAX_ROWS).map((row) => ({
        employeeName: nameOf(row.empId),
        slotSummary: row.slotSummary || "",
        planStart: row.planStart || "",
        planEnd: row.planEnd || "",
        actualStart: row.actualStart || "",
        actualEnd: row.actualEnd || "",
        breakMin: Number(row.breakMin) || 0,
        status: row.status || "",
        note: row.note || "",
      })),
    };
  }

  async function toolListNotices(args) {
    const kind = String(args.kind || "notice") === "handover" ? "handover" : "notice";
    const collectionName = kind === "handover" ? "handovers" : "notices";
    const rows = (await storeCol(collectionName).get()).docs
      .map((doc) => ({ docId: doc.id, ...doc.data() }))
      .sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))
      .slice(0, 15);

    return {
      kind,
      label: kind === "handover" ? "전달사항" : "공지",
      total: rows.length,
      items: rows.map((row) => ({
        docId: row.docId,
        text: row.text || "",
        date: row.date || "",
        pinned: row.pinned === true,
        createdBy: row.createdBy || "",
      })),
    };
  }

  async function toolListEmployees() {
    const rows = (await storeCol("employees").get()).docs
      .map((doc) => doc.data())
      .filter((row) => row.active !== false)
      .sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));

    return {
      total: rows.length,
      employees: rows.slice(0, MAX_ROWS).map((row) => ({
        employeeId: Number(row.id) || 0,
        name: row.name || "",
        roleLabel: row.roleLabel || row.role || "",
        employmentType: row.employmentType || "",
      })),
    };
  }

  // ── 쓰기 도구: 준비(확인 카드) + 확정(저장) ──────────────────────────────

  function prepareCreateReservation(args, actor) {
    const missing = [];
    const name = String(args.name || "").trim();
    const phone = String(args.phone || "").trim();
    if (!args.date) missing.push("날짜");
    if (!name) missing.push("예약자 이름");
    if (!phone) missing.push("연락처");
    if (!args.time) missing.push("시간");
    if (missing.length > 0) {
      return { error: `예약 등록에는 다음 항목이 더 필요합니다: ${missing.join(", ")}. 사용자에게 물어보세요.` };
    }

    const date = resolveDate(args.date);
    const time = parseTime(args.period || "", args.time);
    if (!time) return { error: "시간을 해석하지 못했습니다. '오후 7시 30분'이나 '19:30' 형태로 다시 확인해주세요." };
    if (!/^\d[\d-]{7,}$/.test(phone.replace(/\s/g, ""))) {
      return { error: "연락처 형식을 확인해주세요. 예: 010-1234-5678" };
    }

    const people = Math.max(1, Number(args.people) || 2);
    const seat = String(args.seat || "").trim();
    const request = String(args.request || "").trim();
    const status = normalizeStatus(args.status) || (people >= 8 ? "단체" : "예약확정");

    return {
      pending: {
        tool: "create_reservation",
        title: "예약 등록",
        confirmLabel: "이 내용으로 등록",
        args: { date, time, name, phone, people, seat, request, status },
        fields: [
          { label: "날짜", value: `${date} (${DOW_LABEL[dayIndexOf(date)]})` },
          { label: "시간", value: time },
          { label: "예약자", value: name },
          { label: "연락처", value: phone },
          { label: "인원", value: `${people}명` },
          ...(seat ? [{ label: "좌석", value: seat }] : []),
          ...(request ? [{ label: "요청사항", value: request }] : []),
          { label: "상태", value: status },
        ],
      },
      // 모델에는 마스킹된 번호만 되돌려줍니다.
      modelSummary: `${date} ${time} ${name} ${people}명 (${maskPhone(phone)}) 확인 카드를 사용자에게 보여주었습니다.`,
      actorName: actor.name,
    };
  }

  async function commitCreateReservation(args, actor) {
    const id = Date.now();
    const reservation = {
      id,
      date: args.date,
      time: args.time,
      name: args.name,
      phone: args.phone,
      people: Number(args.people) || 2,
      seat: args.seat || "",
      request: args.request || "",
      status: args.status || "예약확정",
      writer: actor.name,
      source: "gemini-chat",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await storeDoc("reservations", String(id)).set(reservation, { merge: true });
    return {
      ok: true,
      reply: `예약을 등록했습니다.\n예약번호 ${id} · ${args.date} ${args.time} · ${args.name} ${reservation.people}명`,
    };
  }

  async function prepareUpdateReservation(args) {
    const reservationId = String(args.reservationId || "").trim();
    if (!reservationId) {
      return { error: "예약번호가 필요합니다. 먼저 list_reservations로 해당 날짜의 예약번호를 확인하세요." };
    }
    const snap = await storeDoc("reservations", reservationId).get();
    if (!snap.exists) return { error: `예약번호 ${reservationId} 예약을 찾지 못했습니다.` };
    const current = snap.data() || {};

    const patch = {};
    const fields = [];
    if (args.status) {
      const status = normalizeStatus(args.status);
      if (!status) return { error: "예약 상태를 해석하지 못했습니다. 예: 예약확정, 방문완료, 취소, 노쇼" };
      patch.status = status;
      fields.push({ label: "상태", value: `${current.status || "-"} → ${status}` });
    }
    if (args.date) {
      const date = resolveDate(args.date);
      patch.date = date;
      fields.push({ label: "날짜", value: `${current.date || "-"} → ${date}` });
    }
    if (args.time) {
      const time = parseTime(args.period || "", args.time);
      if (!time) return { error: "시간을 해석하지 못했습니다. 예: 19:30" };
      patch.time = time;
      fields.push({ label: "시간", value: `${current.time || "-"} → ${time}` });
    }
    if (args.people !== undefined && args.people !== null && String(args.people) !== "") {
      const people = Math.max(1, Number(args.people) || 0);
      patch.people = people;
      fields.push({ label: "인원", value: `${current.people ?? "-"}명 → ${people}명` });
    }
    if (args.seat !== undefined) {
      patch.seat = String(args.seat || "").trim();
      fields.push({ label: "좌석", value: `${current.seat || "-"} → ${patch.seat || "-"}` });
    }
    if (args.memo !== undefined) {
      patch.memo = String(args.memo || "").trim();
      fields.push({ label: "메모", value: patch.memo || "-" });
    }
    if (fields.length === 0) return { error: "변경할 항목이 없습니다. 무엇을 바꿀지 사용자에게 물어보세요." };

    return {
      pending: {
        tool: "update_reservation",
        title: "예약 수정",
        confirmLabel: "이 내용으로 수정",
        args: { reservationId, patch },
        fields: [
          { label: "대상", value: `${reservationId} · ${current.name || ""} ${current.date || ""} ${current.time || ""}`.trim() },
          ...fields,
        ],
      },
      modelSummary: `예약 ${reservationId} 수정 확인 카드를 사용자에게 보여주었습니다.`,
    };
  }

  async function commitUpdateReservation(args, actor) {
    const reservationId = String(args.reservationId || "").trim();
    const patch = args.patch && typeof args.patch === "object" ? args.patch : {};
    if (!reservationId) return { ok: false, reply: "예약번호가 없습니다." };
    const ref = storeDoc("reservations", reservationId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, reply: `예약번호 ${reservationId} 예약을 찾지 못했습니다.` };

    // 확인 카드에서 만든 항목만 반영합니다(클라이언트 전달값 재검증).
    const allowed = {};
    if (patch.status !== undefined) allowed.status = normalizeStatus(patch.status) || String(patch.status);
    if (patch.date !== undefined) allowed.date = resolveDate(patch.date);
    if (patch.time !== undefined) allowed.time = parseTime("", patch.time) || String(patch.time);
    if (patch.people !== undefined) allowed.people = Math.max(1, Number(patch.people) || 1);
    if (patch.seat !== undefined) allowed.seat = String(patch.seat || "").trim();
    if (patch.memo !== undefined) allowed.memo = String(patch.memo || "").trim();
    if (Object.keys(allowed).length === 0) return { ok: false, reply: "변경할 항목이 없습니다." };

    await ref.set(
      { ...allowed, updatedBy: actor.name, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { ok: true, reply: `예약번호 ${reservationId} 예약을 수정했습니다.` };
  }

  function prepareCreateNotice(args, actor) {
    const kind = String(args.kind || "notice") === "handover" ? "handover" : "notice";
    const label = kind === "handover" ? "전달사항" : "공지";
    const text = String(args.text || "").trim();
    if (!text) return { error: `${label} 내용이 비어 있습니다. 어떤 내용을 올릴지 사용자에게 물어보세요.` };
    if (kind === "notice" && !isOps(actor)) {
      return { error: "공지 등록은 관리자/매니저만 할 수 있습니다. 전달사항으로 올릴지 사용자에게 물어보세요." };
    }

    return {
      pending: {
        tool: "create_notice",
        title: `${label} 등록`,
        confirmLabel: `${label} 등록`,
        args: { kind, text: clampText(text, 800), pinned: args.pinned === true },
        fields: [
          { label: "구분", value: label },
          { label: "내용", value: clampText(text, 800) },
          ...(kind === "notice" && args.pinned === true ? [{ label: "고정", value: "상단 고정" }] : []),
        ],
      },
      modelSummary: `${label} 등록 확인 카드를 사용자에게 보여주었습니다.`,
    };
  }

  async function commitCreateNotice(args, actor) {
    const kind = String(args.kind || "notice") === "handover" ? "handover" : "notice";
    const label = kind === "handover" ? "전달사항" : "공지";
    if (kind === "notice" && !isOps(actor)) {
      return { ok: false, reply: "공지 등록은 관리자/매니저만 할 수 있습니다." };
    }
    const text = clampText(args.text, 800);
    if (!text) return { ok: false, reply: `${label} 내용이 비어 있습니다.` };

    const id = Date.now();
    await storeDoc(kind === "handover" ? "handovers" : "notices", String(id)).set(
      {
        id,
        text,
        date: formatDate(),
        ...(kind === "notice" ? { pinned: args.pinned === true } : {}),
        createdBy: actor.name,
        source: "gemini-chat",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true, reply: `${label}을 등록했습니다. (번호 ${id})` };
  }

  // ── 도구 목록 ────────────────────────────────────────────────────────────

  const TOOLS = {
    get_today_overview: {
      access: "all",
      run: toolTodayOverview,
      declaration: {
        name: "get_today_overview",
        description:
          "오늘 매장 현황 요약을 가져온다. 예약 건수, 예상 손님 수, 근무 배치 건수, 활성 직원 수, 확인이 필요한 근무기록 건수를 반환한다.",
      },
    },
    list_reservations: {
      access: "all",
      run: toolListReservations,
      declaration: {
        name: "list_reservations",
        description:
          "특정 날짜의 예약 목록을 조회한다. 예약 수정/취소를 하려면 먼저 이 도구로 예약번호(reservationId)를 확인해야 한다.",
        parameters: {
          type: "OBJECT",
          properties: {
            date: { type: "STRING", description: "조회할 날짜. YYYY-MM-DD 또는 '오늘', '내일', '어제'. 생략하면 오늘." },
            status: { type: "STRING", description: "상태로 거를 때만 사용. 예: 예약확정, 방문완료, 취소, 노쇼, 단체" },
          },
        },
      },
    },
    sales_report: {
      access: "ops",
      run: toolSalesReport,
      declaration: {
        name: "sales_report",
        description:
          "기간별 매출을 집계한다. 총 매출, 순매출, 주문 수, 객단가, 결제수단별 금액, 일자별 매출, 많이 팔린 메뉴를 반환한다. 하루치만 필요하면 startDate와 endDate를 같게 준다.",
        parameters: {
          type: "OBJECT",
          properties: {
            startDate: { type: "STRING", description: "시작일. YYYY-MM-DD 또는 '오늘', '어제'." },
            endDate: { type: "STRING", description: "종료일. YYYY-MM-DD 또는 '오늘'." },
          },
          required: ["startDate", "endDate"],
        },
      },
    },
    list_shifts: {
      access: "all",
      run: toolListShifts,
      declaration: {
        name: "list_shifts",
        description: "특정 날짜의 근무표(누가 오전/오후, 홀/주방에 배치됐는지)를 조회한다. 실무자 계정은 본인 근무만 조회된다.",
        parameters: {
          type: "OBJECT",
          properties: {
            date: { type: "STRING", description: "조회할 날짜. YYYY-MM-DD 또는 '오늘', '내일'. 생략하면 오늘." },
            employeeName: { type: "STRING", description: "특정 직원만 볼 때 이름." },
          },
        },
      },
    },
    list_work_records: {
      access: "all",
      run: toolListWorkRecords,
      declaration: {
        name: "list_work_records",
        description: "특정 날짜의 근무기록(계획/실제 출퇴근 시간, 작성 상태)을 조회한다. 실무자 계정은 본인 기록만 조회된다.",
        parameters: {
          type: "OBJECT",
          properties: {
            date: { type: "STRING", description: "조회할 날짜. YYYY-MM-DD 또는 '오늘', '어제'. 생략하면 오늘." },
            employeeName: { type: "STRING", description: "특정 직원만 볼 때 이름." },
          },
        },
      },
    },
    list_notices: {
      access: "all",
      run: toolListNotices,
      declaration: {
        name: "list_notices",
        description: "공지사항 또는 전달사항 목록을 최신순으로 조회한다.",
        parameters: {
          type: "OBJECT",
          properties: {
            kind: { type: "STRING", enum: ["notice", "handover"], description: "notice=공지사항, handover=전달사항" },
          },
        },
      },
    },
    list_employees: {
      access: "ops",
      run: toolListEmployees,
      declaration: {
        name: "list_employees",
        description: "재직 중인 직원 목록과 직무를 조회한다.",
      },
    },
    create_reservation: {
      access: "ops",
      write: true,
      prepare: prepareCreateReservation,
      commit: commitCreateReservation,
      declaration: {
        name: "create_reservation",
        description:
          "새 예약을 등록한다. 곧바로 저장되지 않고 사용자 확인 카드로 표시된다. 날짜/시간/이름/연락처가 모두 있어야 하며, 없으면 먼저 사용자에게 물어봐야 한다.",
        parameters: {
          type: "OBJECT",
          properties: {
            date: { type: "STRING", description: "예약 날짜. YYYY-MM-DD 또는 '오늘', '내일'." },
            time: { type: "STRING", description: "예약 시간. 24시간제 HH:MM 권장. 예: 19:30" },
            period: { type: "STRING", description: "12시간제로 말했을 때만 사용. '오전' 또는 '오후'." },
            name: { type: "STRING", description: "예약자 이름" },
            phone: { type: "STRING", description: "연락처. 예: 010-1234-5678" },
            people: { type: "NUMBER", description: "인원 수" },
            seat: { type: "STRING", description: "좌석/룸. 예: 창가, 룸1" },
            request: { type: "STRING", description: "요청사항" },
            status: { type: "STRING", description: "상태를 명시할 때만. 예: 예약확정, 예약대기, 단체" },
          },
          required: ["date", "time", "name", "phone"],
        },
      },
    },
    update_reservation: {
      access: "ops",
      write: true,
      prepare: prepareUpdateReservation,
      commit: commitUpdateReservation,
      declaration: {
        name: "update_reservation",
        description:
          "기존 예약의 상태/날짜/시간/인원/좌석/메모를 수정한다. 취소 처리도 status='취소'로 한다. 곧바로 저장되지 않고 확인 카드로 표시된다. 반드시 list_reservations로 예약번호를 먼저 확인할 것.",
        parameters: {
          type: "OBJECT",
          properties: {
            reservationId: { type: "STRING", description: "list_reservations가 돌려준 예약번호" },
            status: { type: "STRING", description: "예: 예약확정, 방문완료, 취소, 노쇼, 확인전화필요" },
            date: { type: "STRING", description: "바꿀 날짜" },
            time: { type: "STRING", description: "바꿀 시간. HH:MM" },
            period: { type: "STRING", description: "12시간제로 말했을 때만. '오전' 또는 '오후'." },
            people: { type: "NUMBER", description: "바꿀 인원 수" },
            seat: { type: "STRING", description: "바꿀 좌석" },
            memo: { type: "STRING", description: "메모" },
          },
          required: ["reservationId"],
        },
      },
    },
    create_notice: {
      access: "all",
      write: true,
      prepare: prepareCreateNotice,
      commit: commitCreateNotice,
      declaration: {
        name: "create_notice",
        description:
          "공지사항 또는 전달사항을 등록한다. 곧바로 저장되지 않고 확인 카드로 표시된다. 공지(notice)는 관리자/매니저만 등록할 수 있고, 전달사항(handover)은 모두 등록할 수 있다.",
        parameters: {
          type: "OBJECT",
          properties: {
            kind: { type: "STRING", enum: ["notice", "handover"], description: "notice=공지사항, handover=전달사항" },
            text: { type: "STRING", description: "등록할 내용" },
            pinned: { type: "BOOLEAN", description: "공지를 상단 고정할지 여부" },
          },
          required: ["kind", "text"],
        },
      },
    },
  };

  function toolsFor(actor) {
    return Object.entries(TOOLS).filter(([, spec]) => spec.access !== "ops" || isOps(actor));
  }

  function systemInstruction(actor) {
    const today = formatDate();
    return [
      '당신은 진해 식당 "하늘땅"의 매장관리 시스템에 내장된 업무 비서입니다.',
      `오늘은 ${today} ${DOW_LABEL[dayIndexOf(today)]}요일이고, 시간대는 Asia/Seoul입니다.`,
      `지금 대화 중인 사람: ${actor.name} (${actor.roleLabel}).`,
      "",
      "규칙:",
      "- 항상 한국어로, 바쁜 매장 직원이 훑어보기 좋게 짧고 명확하게 답하세요.",
      "- 데이터가 필요하면 반드시 도구를 호출해 확인하세요. 기억이나 추측으로 숫자를 말하지 마세요.",
      "- 조회 결과가 비어 있으면 없다고 사실대로 답하세요. 없는 예약이나 매출을 지어내지 마세요.",
      "- 등록/수정 도구는 즉시 저장되지 않고 사용자 확인 카드로 표시됩니다. 도구를 부른 뒤에는 '확인 카드를 띄웠으니 확인해달라'는 취지로 짧게 안내하세요.",
      "- 등록에 필요한 항목이 빠졌으면 도구를 부르지 말고 먼저 사용자에게 되물으세요.",
      "- 금액은 원 단위로 천 단위 쉼표를 넣어 표기하세요. (예: 1,250,000원)",
      "- 전화번호는 개인정보 보호를 위해 가운데 자리가 가려진 채로 전달됩니다. 가려진 숫자를 임의로 채우지 마세요.",
      "- 목록이 길면 표 대신 핵심만 간추리고, 필요하면 더 볼지 물어보세요.",
      actor.role === "staff"
        ? "- 이 사용자는 실무자라 매출/직원 관리 도구를 쓸 수 없습니다. 요청받으면 관리자에게 문의하라고 안내하세요."
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function callGemini({ apiKey, model, contents, tools, instruction }) {
    const payload = {
      systemInstruction: { parts: [{ text: instruction }] },
      contents,
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
    };
    if (tools.length > 0) {
      payload.tools = [{ functionDeclarations: tools }];
    }

    const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = String(json?.error?.message || "").slice(0, 300);
      const error = new Error(detail || `Gemini 요청이 실패했습니다. (HTTP ${res.status})`);
      error.status = res.status;
      throw error;
    }
    return json;
  }

  function buildContents(messages) {
    return messages
      .slice(-MAX_HISTORY)
      .map((message) => ({
        role: message.role === "model" ? "model" : "user",
        parts: [{ text: clampText(message.text) }],
      }))
      .filter((entry) => entry.parts[0].text.length > 0);
  }

  function partsOf(response) {
    return response?.candidates?.[0]?.content?.parts ?? [];
  }

  async function runConversation({ apiKey, model, actor, messages }) {
    const allowed = toolsFor(actor);
    const declarations = allowed.map(([, spec]) => spec.declaration);
    const instruction = systemInstruction(actor);
    const contents = buildContents(messages);
    if (contents.length === 0) return { reply: "무엇을 도와드릴까요?" };

    const blocks = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await callGemini({ apiKey, model, contents, tools: declarations, instruction });
      const parts = partsOf(response);
      const calls = parts.filter((part) => part.functionCall).map((part) => part.functionCall);

      if (calls.length === 0) {
        const text = parts.map((part) => part.text || "").join("").trim();
        const finishReason = response?.candidates?.[0]?.finishReason;
        if (!text && finishReason === "SAFETY") {
          return { reply: "이 요청에는 답변할 수 없습니다. 다른 방식으로 물어봐 주세요.", blocks };
        }
        return { reply: text || "답변을 만들지 못했습니다. 다시 한번 말씀해 주세요.", blocks };
      }

      contents.push({ role: "model", parts: calls.map((call) => ({ functionCall: call })) });

      // Gemini는 functionCall 하나당 functionResponse 하나를 요구합니다.
      // 쓰기 도구를 만나도 즉시 반환하지 말고, 모든 호출에 응답을 채운 뒤 정리합니다.
      const responses = [];
      let proposal = null;

      for (const call of calls) {
        const spec = TOOLS[call.name];
        const args = call.args && typeof call.args === "object" ? call.args : {};

        if (!spec) {
          responses.push({ name: call.name, response: { error: "알 수 없는 기능입니다." } });
          continue;
        }
        if (spec.access === "ops" && !isOps(actor)) {
          responses.push({
            name: call.name,
            response: { error: "이 사용자는 권한이 없습니다. 관리자에게 문의하라고 안내하세요." },
          });
          continue;
        }

        if (spec.write) {
          if (proposal) {
            responses.push({
              name: call.name,
              response: { error: "확인 카드는 한 번에 하나만 띄울 수 있습니다. 앞의 작업을 마친 뒤 다시 요청하세요." },
            });
            continue;
          }
          const prepared = await spec.prepare(args, actor);
          if (prepared.error) {
            responses.push({ name: call.name, response: { error: prepared.error } });
            continue;
          }
          proposal = prepared.pending;
          responses.push({ name: call.name, response: { status: prepared.modelSummary } });
          continue;
        }

        try {
          const result = await spec.run(args, actor);
          if (call.name === "sales_report" && !result.error) {
            blocks.push({ type: "salesReport", payload: result });
          }
          responses.push({ name: call.name, response: result });
        } catch (error) {
          console.error("GEMINI_TOOL_FAILED", call.name, error);
          responses.push({ name: call.name, response: { error: "데이터를 불러오지 못했습니다." } });
        }
      }

      contents.push({
        role: "user",
        parts: responses.map((entry) => ({ functionResponse: entry })),
      });

      if (proposal) {
        // 쓰기는 여기서 멈춥니다. 도구 없이 한 번 더 불러 안내 문구만 받습니다.
        const followUp = await callGemini({ apiKey, model, contents, tools: [], instruction });
        const text = partsOf(followUp).map((part) => part.text || "").join("").trim();
        return {
          reply: text || "아래 내용으로 진행할까요? 확인을 눌러주세요.",
          blocks,
          pendingAction: proposal,
        };
      }
    }

    return { reply: "요청을 처리하는 데 단계가 너무 많아졌습니다. 조금 더 구체적으로 말씀해 주세요.", blocks };
  }

  async function commitAction(pendingAction, actor) {
    const tool = String(pendingAction?.tool || "");
    const spec = TOOLS[tool];
    if (!spec || !spec.write) return { ok: false, reply: "확인할 수 없는 작업입니다." };
    // 토큰으로 다시 확인한 권한으로 재검증합니다(클라이언트 값 신뢰 안 함).
    if (spec.access === "ops" && !isOps(actor)) {
      return { ok: false, reply: "이 작업을 실행할 권한이 없습니다." };
    }
    const args = pendingAction.args && typeof pendingAction.args === "object" ? pendingAction.args : {};
    return spec.commit(args, actor);
  }

  return { runConversation, commitAction, DEFAULT_MODEL };
}

module.exports = { createGeminiChat, DEFAULT_MODEL, maskPhone, money };
