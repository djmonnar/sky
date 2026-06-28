const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();

setGlobalOptions({
  region: "asia-northeast3",
  maxInstances: 10,
});

const db = admin.firestore();
const STORE_ID = "haneulttang";
const STORE_PATH = `stores/${STORE_ID}`;
const TZ = "Asia/Seoul";

const ROLE_LABEL = {
  admin: "관리자",
  manager: "매니저",
  staff: "실무자",
};

const PERIOD_TIME = {
  morning: { start: "10:00", end: "15:00", breakMin: 30 },
  afternoon: { start: "17:00", end: "22:00", breakMin: 30 },
};

function storeCol(name) {
  return db.collection("stores").doc(STORE_ID).collection(name);
}

function storeDoc(collectionName, id) {
  return db.doc(`${STORE_PATH}/${collectionName}/${id}`);
}

function limitText(text) {
  const value = String(text ?? "");
  return value.length > 980 ? `${value.slice(0, 977)}...` : value;
}

function textResponse(text, quickReplies = []) {
  return {
    version: "2.0",
    template: {
      outputs: [{ simpleText: { text: limitText(text) } }],
      quickReplies: quickReplies.slice(0, 10).map((label) => ({
        label,
        action: "message",
        messageText: label,
      })),
    },
  };
}

function failResponse(text) {
  return textResponse(text, ["도움말", "오늘 현황", "오늘 예약"]);
}

function formatDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayIndexOf(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function nowStamp() {
  const date = formatDate();
  const time = new Intl.DateTimeFormat("ko-KR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return `${date} ${time}`;
}

function paramOf(body, names) {
  const params = body.action?.params ?? {};
  const details = body.action?.detailParams ?? {};
  for (const name of names) {
    const direct = params[name];
    const detail = details[name]?.value ?? details[name]?.origin;
    const value = direct ?? detail;
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function utteranceOf(body) {
  return String(body.userRequest?.utterance ?? "");
}

function fullText(body) {
  return `${paramOf(body, ["action", "작업", "command", "명령"])} ${body.intent?.name ?? ""} ${body.action?.name ?? ""} ${utteranceOf(body)}`.trim();
}

function parseNumber(raw, fallback = 0) {
  const found = String(raw ?? "").match(/-?\d+/);
  return found ? Number(found[0]) : fallback;
}

function hasDateToken(raw) {
  return /오늘|내일|어제|모레|\d{4}[./-]\d{1,2}[./-]\d{1,2}|\b\d{1,2}[./-]\d{1,2}\b/.test(String(raw ?? ""));
}

function resolveDate(raw) {
  const today = formatDate();
  const value = String(raw ?? "").trim();
  if (!value || /오늘/.test(value)) return today;
  if (/내일/.test(value)) return addDays(today, 1);
  if (/어제/.test(value)) return addDays(today, -1);
  if (/모레/.test(value)) return addDays(today, 2);
  const full = value.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (full) {
    return `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;
  }
  const slash = value.match(/\b(\d{1,2})[./-](\d{1,2})\b/);
  if (slash) {
    return `${today.slice(0, 4)}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  return today;
}

function normalizePeriod(raw) {
  const text = String(raw ?? "");
  if (/오전|morning|am/i.test(text)) return "morning";
  if (/오후|afternoon|pm/i.test(text)) return "afternoon";
  return "";
}

function normalizeDepartment(raw) {
  const text = String(raw ?? "");
  if (/주방|kitchen/i.test(text)) return "kitchen";
  if (/홀|hall/i.test(text)) return "hall";
  return "";
}

function parseTime(periodRaw, timeRaw) {
  const raw = String(timeRaw ?? "").trim().replace(/[.\s]/g, ":");
  const periodText = `${periodRaw ?? ""} ${raw}`;
  const period = /오전|am/i.test(periodText) ? "AM" : /오후|pm/i.test(periodText) ? "PM" : "";
  const numeric = raw.replace(/오전|오후|am|pm/gi, "").trim();
  const match = numeric.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "00");
  if (minute < 0 || minute > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === "AM" && hour === 12) hour = 0;
    if (period === "PM" && hour < 12) hour += 12;
  }
  if (hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeStatus(raw) {
  const text = String(raw ?? "").trim();
  if (/방문|완료/.test(text)) return "방문완료";
  if (/취소|캔슬/.test(text)) return "취소";
  if (/노쇼/.test(text)) return "노쇼";
  if (/단체/.test(text)) return "단체";
  if (/확인|전화/.test(text)) return "확인전화필요";
  if (/대기/.test(text)) return "예약대기";
  if (/확정|예약/.test(text)) return "예약확정";
  return "";
}

function slashArgs(body) {
  const parts = utteranceOf(body).split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return [];
  const first = parts[0].replace(/예약\s*(등록|추가|작성|잡아줘|잡아|잡)?/g, "").trim();
  return first ? [first, ...parts.slice(1)] : parts.slice(1);
}

function textReservationFields(body) {
  const raw = utteranceOf(body);
  const text = raw.replace(/\//g, " ");
  const phoneMatch = text.match(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/);
  const dateMatch = text.match(/오늘|내일|어제|모레|\d{4}[./-]\d{1,2}[./-]\d{1,2}|\b\d{1,2}[./-]\d{1,2}\b/);
  const periodMatch = text.match(/오전|오후/);
  const timeSource = periodMatch ? text.slice(periodMatch.index ?? 0) : text;
  const timeMatch = timeSource.match(/\b\d{1,2}(?::\d{2})?\b/);
  const peopleMatch = text.match(/(\d+)\s*(?:명|인)/);

  let name = "";
  if (phoneMatch) {
    name = text.slice(0, phoneMatch.index)
      .replace(/예약\s*(등록|추가|작성|잡아줘|잡아|잡)?/g, " ")
      .replace(dateMatch?.[0] ?? "", " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
  }

  let seat = "";
  if (peopleMatch && peopleMatch.index !== undefined) {
    seat = text.slice(peopleMatch.index + peopleMatch[0].length)
      .replace(/요청사항|메모/g, " ")
      .trim();
  }

  return {
    dateInput: dateMatch?.[0] ?? "",
    name,
    phone: phoneMatch?.[0] ?? "",
    period: periodMatch?.[0] ?? "",
    time: timeMatch?.[0] ?? "",
    people: peopleMatch?.[1] ?? "",
    seat,
    request: "",
  };
}

function reservationCreateFields(body) {
  const parts = slashArgs(body);
  const utterance = utteranceOf(body);
  let offset = 0;
  let dateInput = paramOf(body, ["date", "날짜"]);
  const datePartIndex = parts.findIndex((part) => hasDateToken(part));
  if (!dateInput && datePartIndex >= 0) {
    dateInput = parts[datePartIndex];
    offset = datePartIndex + 1;
  }
  if (!dateInput && hasDateToken(utterance)) {
    dateInput = utterance;
  }
  const expectedParts = parts.slice(offset);
  const positionalParts = normalizePeriod(expectedParts[0]) ? [] : expectedParts;
  const name = paramOf(body, ["name", "예약자", "이름"]) || positionalParts[0] || "";
  const phone = paramOf(body, ["phone", "연락처", "전화"]) || positionalParts[1] || "";
  const period = paramOf(body, ["period", "오전오후"]) || positionalParts[2] || "";
  const time = paramOf(body, ["time", "시간"]) || positionalParts[3] || "";
  const people = paramOf(body, ["people", "인원"]) || positionalParts[4] || "";
  const seat = paramOf(body, ["seat", "좌석", "자리"]) || positionalParts[5] || "";
  const request = paramOf(body, ["request", "요청사항", "메모"]) || positionalParts[6] || "";
  const textFields = textReservationFields(body);
  return {
    dateInput: dateInput || textFields.dateInput,
    name: name || textFields.name,
    phone: phone || textFields.phone,
    period: period || textFields.period,
    time: time || textFields.time,
    people: people || textFields.people,
    seat: seat || textFields.seat,
    request: request || textFields.request,
  };
}

function getIdentity(body) {
  const user = body.userRequest?.user ?? {};
  const props = user.properties ?? {};
  const key = user.id || props.botUserKey || props.plusfriendUserKey || props.appUserId;
  return {
    botUserKey: String(key ?? "").trim(),
    appUserId: props.appUserId ? String(props.appUserId) : "",
  };
}

async function getChatUser(botUserKey) {
  if (!botUserKey) return null;
  const safeId = botUserKey.replace(/\//g, "_");
  const snap = await storeDoc("chatbotUsers", safeId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (data.active === false) return null;
  return {
    id: safeId,
    name: data.name || "직원",
    role: data.role || "staff",
    employeeId: Number(data.employeeId ?? 0),
  };
}

function assertRole(chatUser, roles) {
  if (chatUser && roles.includes(chatUser.role)) return null;
  return `${roles.map((role) => ROLE_LABEL[role] ?? role).join("/")} 권한이 필요합니다.`;
}

function canManageOps(chatUser) {
  return chatUser && (chatUser.role === "admin" || chatUser.role === "manager");
}

function requireOps(chatUser) {
  return canManageOps(chatUser) ? null : "관리자/매니저 권한이 필요합니다.";
}

function manualEmployeeId(name) {
  let hash = 0;
  for (const char of String(name).trim().toLowerCase()) {
    hash = ((hash * 31) + char.charCodeAt(0)) | 0;
  }
  return -Math.max(1, Math.abs(hash));
}

async function findEmployee(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const id = parseNumber(value);
  if (id > 0) {
    const snap = await storeDoc("employees", String(id)).get();
    if (snap.exists) return { docId: snap.id, ...snap.data() };
  }
  const docs = (await storeCol("employees").get()).docs.map((doc) => ({ docId: doc.id, ...doc.data() }));
  return docs.find((employee) => String(employee.name ?? "").trim() === value) ?? null;
}

function shiftAssignmentId(date, period, department, employeeId) {
  return employeeId < 0
    ? `${date}_${period}_${department}_manual_${Math.abs(employeeId)}`
    : `${date}_${period}_${department}_${employeeId}`;
}

function classify(body) {
  const requestedAction = paramOf(body, ["action", "작업", "command", "명령"]).toLowerCase();
  const explicitActions = new Set([
    "dashboard",
    "reservation.list",
    "reservation.create",
    "reservation.update",
    "reservation.status",
    "reservation.delete",
    "schedule.list",
    "schedule.add",
    "schedule.delete",
    "employee.list",
    "employee.create",
    "employee.update",
    "employee.delete",
    "notice.list",
    "notice.create",
    "notice.update",
    "notice.delete",
    "handover.list",
    "handover.create",
    "handover.update",
    "handover.delete",
    "payroll.summary",
    "vendor.list",
    "vendor.create",
    "vendor.update",
    "vendor.delete",
    "recipe.list",
    "recipe.create",
    "recipe.update",
    "recipe.delete",
    "help",
  ]);
  if (explicitActions.has(requestedAction)) return requestedAction;

  const text = fullText(body).toLowerCase();
  if (/도움|메뉴|help|시작/.test(text)) return "help";
  if (/거래처/.test(text) && /등록|추가|작성/.test(text)) return "vendor.create";
  if (/거래처/.test(text) && /수정|변경/.test(text)) return "vendor.update";
  if (/거래처/.test(text) && /삭제/.test(text)) return "vendor.delete";
  if (/거래처/.test(text)) return "vendor.list";
  if (/레시피|원가/.test(text) && /등록|추가|작성/.test(text)) return "recipe.create";
  if (/레시피|원가/.test(text) && /수정|변경/.test(text)) return "recipe.update";
  if (/레시피|원가/.test(text) && /삭제/.test(text)) return "recipe.delete";
  if (/레시피|원가/.test(text)) return "recipe.list";
  if (/급여/.test(text)) return "payroll.summary";
  if (/직원/.test(text) && /등록|추가|작성/.test(text)) return "employee.create";
  if (/직원/.test(text) && /수정|변경/.test(text)) return "employee.update";
  if (/직원/.test(text) && /삭제/.test(text)) return "employee.delete";
  if (/직원/.test(text)) return "employee.list";
  if (/공지.*(등록|작성|추가)/.test(text)) return "notice.create";
  if (/공지.*(수정|변경)/.test(text)) return "notice.update";
  if (/공지.*삭제/.test(text)) return "notice.delete";
  if (/공지/.test(text)) return "notice.list";
  if (/(전달|인수).*(등록|작성|추가)/.test(text)) return "handover.create";
  if (/(전달|인수).*(수정|변경)/.test(text)) return "handover.update";
  if (/(전달|인수).*삭제/.test(text)) return "handover.delete";
  if (/전달|인수/.test(text)) return "handover.list";
  if (/근무표|근무/.test(text) && /삭제|빼/.test(text)) return "schedule.delete";
  if (/근무표|근무/.test(text) && /등록|추가|배치|넣/.test(text)) return "schedule.add";
  if (/근무표|근무/.test(text)) return "schedule.list";
  if (/예약.*삭제/.test(text)) return "reservation.delete";
  if (/예약.*(수정|변경)/.test(text)) return "reservation.update";
  if (/예약.*(취소|방문|완료|노쇼|상태)/.test(text)) return "reservation.status";
  if (/예약.*(등록|추가|작성|잡)/.test(text)) return "reservation.create";
  if (/예약/.test(text)) return "reservation.list";
  if (/현황|대시보드|요약|오늘/.test(text)) return "dashboard";
  return "help";
}

async function handleDashboard() {
  const today = formatDate();
  const [reservations, employees, shifts, workRecords] = await Promise.all([
    storeCol("reservations").where("date", "==", today).get(),
    storeCol("employees").get(),
    storeCol("shifts").where("date", "==", today).get(),
    storeCol("workRecords").where("date", "==", today).get(),
  ]);

  const activeReservations = reservations.docs.filter((doc) => !["취소", "노쇼"].includes(doc.data().status));
  const activeEmployees = employees.docs.filter((doc) => doc.data().active !== false);
  const pendingRecords = workRecords.docs.filter((doc) => ["미작성", "제출", "승인대기"].includes(doc.data().status));

  return textResponse(
    [
      "하늘땅 오늘 현황",
      `예약: ${activeReservations.length}건`,
      `근무 배치: ${shifts.size}건`,
      `직원: ${activeEmployees.length}명`,
      `확인 필요 근무기록: ${pendingRecords.length}건`,
    ].join("\n"),
    ["오늘 예약", "오늘 근무표", "공지"]
  );
}

async function handleReservationList(body) {
  const text = utteranceOf(body);
  const date = resolveDate(paramOf(body, ["date", "날짜"]) || text);
  const period = normalizePeriod(paramOf(body, ["period", "오전오후"]) || text);
  const status = normalizeStatus(paramOf(body, ["status", "상태"]) || text);
  let docs = (await storeCol("reservations").where("date", "==", date).get()).docs
    .map((doc) => doc.data())
    .sort((a, b) => String(a.time ?? "").localeCompare(String(b.time ?? "")));

  if (period === "morning") docs = docs.filter((r) => String(r.time ?? "") < "12:00");
  if (period === "afternoon") docs = docs.filter((r) => String(r.time ?? "") >= "12:00");
  if (status) docs = docs.filter((r) => r.status === status);

  if (docs.length === 0) return textResponse(`${date} 예약이 없습니다.`, ["예약 등록", "오늘 현황"]);
  const lines = docs.slice(0, 12).map((r) =>
    `${r.id}. ${r.time} ${r.name} ${r.people ?? 0}명 ${r.seat || ""} ${r.status || ""}`.trim()
  );
  return textResponse(`${date} 예약 ${docs.length}건\n${lines.join("\n")}`, ["예약 등록", "오늘 현황"]);
}

async function handleReservationCreate(body, chatUser) {
  const fields = reservationCreateFields(body);
  const time = parseTime(fields.period, fields.time);
  const missing = [];
  if (!fields.dateInput) missing.push("날짜");
  if (!fields.name) missing.push("예약자");
  if (!fields.phone) missing.push("연락처");
  if (!fields.period) missing.push("오전/오후");
  if (!time) missing.push("시간");
  if (missing.length > 0) {
    return failResponse(
      `예약 등록에는 다음 항목이 필요합니다: ${missing.join(", ")}.\n` +
      "예: 예약 등록 / 내일 / 홍길동 / 010-1234-5678 / 오후 / 7:30 / 4명 / 창가"
    );
  }
  const people = Math.max(1, parseNumber(fields.people, 2));
  const id = Date.now();
  const reservation = {
    id,
    date: resolveDate(fields.dateInput),
    time,
    name: fields.name,
    phone: fields.phone,
    people,
    seat: fields.seat,
    request: fields.request,
    status: normalizeStatus(paramOf(body, ["status", "상태"])) || (people >= 8 ? "단체" : "예약확정"),
    writer: chatUser.name,
    createdAt: nowStamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await storeDoc("reservations", String(id)).set(reservation, { merge: true });
  return textResponse(`예약을 등록했습니다.\n번호: ${id}\n${reservation.date} ${reservation.time}\n${fields.name} ${people}명 ${reservation.seat || ""}`, ["오늘 예약", "오늘 현황"]);
}

async function handleReservationUpdate(body, mode = "update") {
  const text = utteranceOf(body);
  const id = parseNumber(paramOf(body, ["id", "reservationId", "예약번호"]) || text);
  if (!id) return failResponse("예약번호가 필요합니다.");
  const ref = storeDoc("reservations", String(id));
  const snap = await ref.get();
  if (!snap.exists) return failResponse(`예약번호 ${id}를 찾지 못했습니다.`);
  if (mode === "delete") {
    await ref.delete();
    return textResponse(`예약 ${id}번을 삭제했습니다.`, ["오늘 예약"]);
  }

  const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  const status = normalizeStatus(paramOf(body, ["status", "상태"]) || text);
  const time = parseTime(paramOf(body, ["period", "오전오후"]), paramOf(body, ["time", "시간"]));
  const dateRaw = paramOf(body, ["date", "날짜"]);
  const fields = [
    ["name", ["name", "예약자", "이름"]],
    ["phone", ["phone", "연락처", "전화"]],
    ["seat", ["seat", "좌석", "자리"]],
    ["request", ["request", "요청사항", "메모"]],
  ];
  fields.forEach(([field, aliases]) => {
    const value = paramOf(body, aliases);
    if (value) patch[field] = value;
  });
  const people = parseNumber(paramOf(body, ["people", "인원"]));
  if (people > 0) patch.people = people;
  if (status) patch.status = status;
  if (time) patch.time = time;
  if (dateRaw) patch.date = resolveDate(dateRaw);
  await ref.set(patch, { merge: true });
  return textResponse(`예약 ${id}번을 수정했습니다.`, ["오늘 예약"]);
}

async function handleScheduleList(body, chatUser) {
  const date = resolveDate(paramOf(body, ["date", "날짜"]) || utteranceOf(body));
  let docs = (await storeCol("shifts").where("date", "==", date).get()).docs.map((doc) => doc.data());
  if (chatUser.role === "staff") {
    docs = docs.filter((shift) => Number(shift.employeeId ?? shift.empId) === chatUser.employeeId);
  }
  if (docs.length === 0) return textResponse(`${date} 근무표가 비어 있습니다.`, ["오늘 현황"]);
  const grouped = {
    morning: { hall: [], kitchen: [] },
    afternoon: { hall: [], kitchen: [] },
  };
  docs.forEach((shift) => {
    const period = shift.period === "afternoon" ? "afternoon" : "morning";
    const dept = shift.department === "kitchen" ? "kitchen" : "hall";
    grouped[period][dept].push(shift.employeeName || `직원${shift.employeeId}`);
  });
  const line = (period, dept, label) => `${label}: ${grouped[period][dept].join(", ") || "-"}`;
  return textResponse([
    `${date} 근무표`,
    line("morning", "hall", "오전 홀"),
    line("morning", "kitchen", "오전 주방"),
    line("afternoon", "hall", "오후 홀"),
    line("afternoon", "kitchen", "오후 주방"),
  ].join("\n"), ["예약", "오늘 현황"]);
}

async function handleScheduleAdd(body, chatUser) {
  const denied = requireOps(chatUser);
  if (denied) return failResponse(denied);
  const text = utteranceOf(body);
  const date = resolveDate(paramOf(body, ["date", "날짜"]) || text);
  const period = normalizePeriod(paramOf(body, ["period", "오전오후"]) || text);
  const department = normalizeDepartment(paramOf(body, ["department", "파트", "부서"]) || text);
  const employeeRaw = paramOf(body, ["employee", "employeeId", "직원", "이름"]);
  if (!period || !department || !employeeRaw) {
    return failResponse("근무표 추가에는 날짜, 오전/오후, 홀/주방, 직원이 필요합니다.\n예: 근무표 추가 / 내일 / 오전 / 홀 / 홍길동");
  }
  const employee = await findEmployee(employeeRaw);
  const employeeId = employee ? Number(employee.id) : manualEmployeeId(employeeRaw);
  const employeeName = employee ? employee.name : employeeRaw;
  const dayIndex = dayIndexOf(date);
  const time = PERIOD_TIME[period];
  const id = shiftAssignmentId(date, period, department, employeeId);
  await storeDoc("shifts", id).set({
    id,
    date,
    dayIndex,
    day: dayIndex,
    period,
    department,
    employeeId,
    empId: employeeId,
    employeeName,
    roleLabel: employee?.roleLabel ?? (employee ? undefined : "직접 입력"),
    order: Date.now(),
    ...time,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return textResponse(`${date} ${period === "morning" ? "오전" : "오후"} ${department === "hall" ? "홀" : "주방"}에 ${employeeName}님을 배치했습니다.`, ["오늘 근무표"]);
}

async function handleScheduleDelete(body, chatUser) {
  const denied = requireOps(chatUser);
  if (denied) return failResponse(denied);
  const text = utteranceOf(body);
  const id = paramOf(body, ["id", "shiftId", "문서번호"]);
  if (id) {
    await storeDoc("shifts", id).delete();
    return textResponse("근무 배치를 삭제했습니다.", ["오늘 근무표"]);
  }
  const date = resolveDate(paramOf(body, ["date", "날짜"]) || text);
  const period = normalizePeriod(paramOf(body, ["period", "오전오후"]) || text);
  const department = normalizeDepartment(paramOf(body, ["department", "파트", "부서"]) || text);
  const employeeRaw = paramOf(body, ["employee", "employeeId", "직원", "이름"]);
  if (!period || !department || !employeeRaw) return failResponse("삭제할 날짜, 오전/오후, 홀/주방, 직원을 알려주세요.");
  const employee = await findEmployee(employeeRaw);
  const employeeId = employee ? Number(employee.id) : manualEmployeeId(employeeRaw);
  const shiftId = shiftAssignmentId(date, period, department, employeeId);
  await storeDoc("shifts", shiftId).delete();
  return textResponse(`${date} 근무 배치를 삭제했습니다.`, ["오늘 근무표"]);
}

async function handleEmployeeList(chatUser) {
  const denied = requireOps(chatUser);
  if (denied) return failResponse(denied);
  const docs = (await storeCol("employees").get()).docs
    .map((doc) => doc.data())
    .filter((employee) => employee.active !== false)
    .sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));
  const lines = docs.slice(0, 20).map((e) => `${e.id}. ${e.name} / ${e.roleLabel || e.role || "-"} / ${e.employmentType || "-"}`);
  return textResponse(`직원 ${docs.length}명\n${lines.join("\n") || "-"}`, ["오늘 근무표", "오늘 현황"]);
}

async function handleEmployeeCreate(body, chatUser) {
  const denied = assertRole(chatUser, ["admin"]);
  if (denied) return failResponse(denied);
  const name = paramOf(body, ["name", "직원", "이름"]);
  if (!name) return failResponse("직원 이름이 필요합니다.");
  const id = parseNumber(paramOf(body, ["id", "직원번호"])) || Date.now();
  const role = paramOf(body, ["role", "직무", "파트"]) || "홀";
  const salaryType = /월급/.test(fullText(body)) ? "monthly" : /건별/.test(fullText(body)) ? "perSlot" : "hourly";
  const pay = parseNumber(paramOf(body, ["pay", "급여", "시급", "월급", "수당"]));
  await storeDoc("employees", String(id)).set({
    id,
    name,
    role,
    employmentType: salaryType === "monthly" ? "fullTime" : "partTime",
    salaryType,
    hourly: salaryType === "hourly" ? pay : 0,
    monthlySalary: salaryType === "monthly" ? pay : undefined,
    slotRate: salaryType === "perSlot" ? pay : undefined,
    phone: paramOf(body, ["phone", "연락처", "전화"]),
    address: paramOf(body, ["address", "주소"]),
    residentRegistrationNumber: paramOf(body, ["residentRegistrationNumber", "주민번호"]),
    bank: paramOf(body, ["bank", "은행"]),
    account: paramOf(body, ["account", "계좌"]),
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return textResponse(`${name} 직원을 등록했습니다.`, ["직원 목록"]);
}

async function handleEmployeeUpdate(body, chatUser, mode = "update") {
  const denied = assertRole(chatUser, ["admin"]);
  if (denied) return failResponse(denied);
  const employee = await findEmployee(paramOf(body, ["id", "employeeId", "직원", "이름"]) || utteranceOf(body));
  if (!employee) return failResponse("직원을 찾지 못했습니다.");
  if (mode === "delete") {
    await storeDoc("employees", String(employee.id)).delete();
    if (employee.uid) await db.doc(`users/${employee.uid}`).set({ active: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return textResponse(`${employee.name} 직원을 삭제했습니다.`, ["직원 목록"]);
  }
  const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  [
    ["name", ["name", "이름"]],
    ["role", ["role", "직무", "파트"]],
    ["phone", ["phone", "연락처", "전화"]],
    ["address", ["address", "주소"]],
    ["residentRegistrationNumber", ["residentRegistrationNumber", "주민번호"]],
    ["bank", ["bank", "은행"]],
    ["account", ["account", "계좌"]],
  ].forEach(([field, aliases]) => {
    const value = paramOf(body, aliases);
    if (value) patch[field] = value;
  });
  await storeDoc("employees", String(employee.id)).set(patch, { merge: true });
  if (employee.uid) await db.doc(`users/${employee.uid}`).set(patch, { merge: true });
  return textResponse(`${employee.name} 직원 정보를 수정했습니다.`, ["직원 목록"]);
}

async function handleNoticeList(kind) {
  const collectionName = kind === "handover" ? "handovers" : "notices";
  const label = kind === "handover" ? "전달사항" : "공지";
  const docs = (await storeCol(collectionName).get()).docs
    .map((doc) => ({ docId: doc.id, ...doc.data() }))
    .sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))
    .slice(0, 8);
  if (docs.length === 0) return textResponse(`${label}이 없습니다.`, ["오늘 현황"]);
  return textResponse(`${label}\n${docs.map((n) => `${n.docId}. ${n.text}`).join("\n")}`, ["오늘 현황"]);
}

async function handleNoticeWrite(body, chatUser, kind, mode = "create") {
  if (kind === "notice") {
    const denied = requireOps(chatUser);
    if (denied) return failResponse(denied);
  }
  if (mode !== "create") {
    const denied = requireOps(chatUser);
    if (denied) return failResponse(denied);
  }
  const collectionName = kind === "handover" ? "handovers" : "notices";
  const label = kind === "handover" ? "전달사항" : "공지";
  const docId = paramOf(body, ["id", "docId", "문서번호"]);
  if (mode === "delete") {
    if (!docId) return failResponse("삭제할 문서번호가 필요합니다.");
    await storeDoc(collectionName, docId).delete();
    return textResponse(`${label}을 삭제했습니다.`, [label]);
  }
  const text = paramOf(body, ["text", "내용", "공지", "전달사항", "메모"]);
  if (!text) return failResponse(`${label} 내용을 입력해주세요.`);
  const id = mode === "update" ? docId : String(Date.now());
  if (!id) return failResponse("수정할 문서번호가 필요합니다.");
  await storeDoc(collectionName, id).set({
    id: Number(id) || Date.now(),
    text,
    date: formatDate(),
    createdBy: chatUser.name,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(mode === "create" ? { createdAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
  }, { merge: true });
  return textResponse(`${label}을 ${mode === "update" ? "수정" : "등록"}했습니다.`, [label, "오늘 현황"]);
}

async function handlePayrollSummary(body, chatUser) {
  const denied = assertRole(chatUser, ["admin"]);
  if (denied) return failResponse(denied);
  const passwordFromUtterance = utteranceOf(body).match(/(?:password|비밀번호)\s+(\S+)/i)?.[1] ?? "";
  const password = paramOf(body, ["password", "비밀번호"]) || passwordFromUtterance;
  const passwordSnap = await storeDoc("meta", "payrollPassword").get();
  const expected = passwordSnap.exists ? String(passwordSnap.data().value ?? "qaz@qwer4312") : "qaz@qwer4312";
  if (password !== expected) return failResponse("급여 확인 비밀번호가 필요합니다.\n급여관리에서 설정한 비밀번호를 입력해주세요.");
  const docs = (await storeCol("payroll").get()).docs.map((doc) => doc.data());
  const total = docs.reduce((sum, row) => sum + Number(row.base ?? 0) + Number(row.extra ?? 0) - Number(row.deduct ?? 0), 0);
  return textResponse(`급여 요약\n대상: ${docs.length}명\n예상 지급액: ${Math.round(total / 10000)}만원`, ["오늘 현황"]);
}

async function handleVendorList(chatUser) {
  const denied = assertRole(chatUser, ["admin"]);
  if (denied) return failResponse(denied);
  const docs = (await storeCol("vendors").get()).docs
    .map((doc) => doc.data())
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  const lines = docs.slice(0, 15).map((v) => `${v.id}. ${v.name} / ${v.businessNumber || "-"} / ${v.phone || "-"}`);
  return textResponse(`거래처 ${docs.length}곳\n${lines.join("\n") || "-"}`, ["레시피", "오늘 현황"]);
}

async function handleVendorWrite(body, chatUser, mode) {
  const denied = assertRole(chatUser, ["admin"]);
  if (denied) return failResponse(denied);
  const id = parseNumber(paramOf(body, ["id", "거래처번호"]) || utteranceOf(body));
  if (mode === "delete") {
    if (!id) return failResponse("삭제할 거래처 번호가 필요합니다.");
    await storeDoc("vendors", String(id)).delete();
    return textResponse("거래처를 삭제했습니다.", ["거래처 목록"]);
  }
  const name = paramOf(body, ["name", "거래처", "상호"]);
  if (mode === "create" && !name) return failResponse("거래처명이 필요합니다.");
  const docId = mode === "create" ? (id || Date.now()) : id;
  if (!docId) return failResponse("수정할 거래처 번호가 필요합니다.");
  const patch = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  [
    ["name", ["name", "거래처", "상호"]],
    ["businessNumber", ["businessNumber", "사업자번호"]],
    ["address", ["address", "주소"]],
    ["contactName", ["contactName", "담당자"]],
    ["phone", ["phone", "연락처", "전화"]],
    ["email", ["email", "이메일"]],
    ["bank", ["bank", "은행"]],
    ["account", ["account", "계좌"]],
    ["memo", ["memo", "메모"]],
  ].forEach(([field, aliases]) => {
    const value = paramOf(body, aliases);
    if (value) patch[field] = value;
  });
  await storeDoc("vendors", String(docId)).set({
    id: docId,
    active: true,
    ...(mode === "create" ? { createdAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    ...patch,
  }, { merge: true });
  return textResponse(`거래처를 ${mode === "create" ? "등록" : "수정"}했습니다.`, ["거래처 목록"]);
}

function parseIngredients(raw) {
  return String(raw ?? "")
    .split(/[,;\n]/)
    .map((item, index) => {
      const parts = item.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return null;
      const name = parts[0];
      const quantity = Number(parts.find((part) => /^\d+(\.\d+)?$/.test(part)) ?? 1);
      const unitCost = Number(parts.reverse().find((part) => /^\d+(\.\d+)?$/.test(part)) ?? 0);
      return { id: `${Date.now()}_${index}`, name, quantity, unit: "개", unitCost };
    })
    .filter(Boolean);
}

function recipeCost(recipe) {
  const ingredientCost = (recipe.ingredients ?? []).reduce((sum, ingredient) =>
    sum + Number(ingredient.quantity ?? 0) * Number(ingredient.unitCost ?? 0), 0);
  const totalCost = ingredientCost + Number(recipe.laborCost ?? 0) + Number(recipe.overheadCost ?? 0);
  const salePrice = Number(recipe.salePrice ?? 0);
  const margin = salePrice - totalCost;
  const marginRate = salePrice > 0 ? (margin / salePrice) * 100 : 0;
  return { ingredientCost, totalCost, margin, marginRate };
}

async function handleRecipeList(chatUser) {
  const denied = assertRole(chatUser, ["admin"]);
  if (denied) return failResponse(denied);
  const docs = (await storeCol("recipes").get()).docs
    .map((doc) => doc.data())
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  const lines = docs.slice(0, 10).map((r) => {
    const cost = recipeCost(r);
    return `${r.id}. ${r.name} / 원가 ${Math.round(cost.totalCost).toLocaleString()}원 / 마진율 ${cost.marginRate.toFixed(1)}%`;
  });
  return textResponse(`레시피 ${docs.length}개\n${lines.join("\n") || "-"}`, ["거래처", "오늘 현황"]);
}

async function handleRecipeWrite(body, chatUser, mode) {
  const denied = assertRole(chatUser, ["admin"]);
  if (denied) return failResponse(denied);
  const id = parseNumber(paramOf(body, ["id", "레시피번호"]) || utteranceOf(body));
  if (mode === "delete") {
    if (!id) return failResponse("삭제할 레시피 번호가 필요합니다.");
    await storeDoc("recipes", String(id)).delete();
    return textResponse("레시피를 삭제했습니다.", ["레시피 목록"]);
  }
  const name = paramOf(body, ["name", "레시피", "메뉴"]);
  if (mode === "create" && !name) return failResponse("레시피명이 필요합니다.");
  const docId = mode === "create" ? (id || Date.now()) : id;
  if (!docId) return failResponse("수정할 레시피 번호가 필요합니다.");
  const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  [
    ["name", ["name", "레시피", "메뉴"]],
    ["category", ["category", "분류"]],
    ["memo", ["memo", "메모"]],
  ].forEach(([field, aliases]) => {
    const value = paramOf(body, aliases);
    if (value) patch[field] = value;
  });
  [
    ["servings", ["servings", "인분"]],
    ["laborCost", ["laborCost", "인건비"]],
    ["overheadCost", ["overheadCost", "운영비"]],
    ["salePrice", ["salePrice", "판매가"]],
  ].forEach(([field, aliases]) => {
    const value = parseNumber(paramOf(body, aliases));
    if (value > 0) patch[field] = value;
  });
  const ingredients = parseIngredients(paramOf(body, ["ingredients", "재료"]));
  if (ingredients.length > 0) patch.ingredients = ingredients;
  await storeDoc("recipes", String(docId)).set({
    id: docId,
    active: true,
    servings: 1,
    ingredients: [],
    laborCost: 0,
    overheadCost: 0,
    salePrice: 0,
    ...(mode === "create" ? { createdAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    ...patch,
  }, { merge: true });
  return textResponse(`레시피를 ${mode === "create" ? "등록" : "수정"}했습니다.`, ["레시피 목록"]);
}

async function routeAction(action, body, chatUser) {
  switch (action) {
    case "dashboard": return handleDashboard();
    case "reservation.list": return handleReservationList(body);
    case "reservation.create": return handleReservationCreate(body, chatUser);
    case "reservation.status":
    case "reservation.update": return handleReservationUpdate(body);
    case "reservation.delete": {
      const denied = requireOps(chatUser);
      return denied ? failResponse(denied) : handleReservationUpdate(body, "delete");
    }
    case "schedule.list": return handleScheduleList(body, chatUser);
    case "schedule.add": return handleScheduleAdd(body, chatUser);
    case "schedule.delete": return handleScheduleDelete(body, chatUser);
    case "employee.list": return handleEmployeeList(chatUser);
    case "employee.create": return handleEmployeeCreate(body, chatUser);
    case "employee.update": return handleEmployeeUpdate(body, chatUser);
    case "employee.delete": return handleEmployeeUpdate(body, chatUser, "delete");
    case "notice.list": return handleNoticeList("notice");
    case "notice.create": return handleNoticeWrite(body, chatUser, "notice", "create");
    case "notice.update": return handleNoticeWrite(body, chatUser, "notice", "update");
    case "notice.delete": return handleNoticeWrite(body, chatUser, "notice", "delete");
    case "handover.list": return handleNoticeList("handover");
    case "handover.create": return handleNoticeWrite(body, chatUser, "handover", "create");
    case "handover.update": return handleNoticeWrite(body, chatUser, "handover", "update");
    case "handover.delete": return handleNoticeWrite(body, chatUser, "handover", "delete");
    case "payroll.summary": return handlePayrollSummary(body, chatUser);
    case "vendor.list": return handleVendorList(chatUser);
    case "vendor.create": return handleVendorWrite(body, chatUser, "create");
    case "vendor.update": return handleVendorWrite(body, chatUser, "update");
    case "vendor.delete": return handleVendorWrite(body, chatUser, "delete");
    case "recipe.list": return handleRecipeList(chatUser);
    case "recipe.create": return handleRecipeWrite(body, chatUser, "create");
    case "recipe.update": return handleRecipeWrite(body, chatUser, "update");
    case "recipe.delete": return handleRecipeWrite(body, chatUser, "delete");
    case "help":
    default:
      return textResponse([
        "하늘땅 챗봇 메뉴",
        "오늘 현황",
        "오늘 예약 / 예약 등록 / 예약 수정 / 예약 삭제",
        "오늘 근무표 / 근무표 추가 / 근무표 삭제",
        "직원 목록 / 직원 등록 / 직원 수정 / 직원 삭제",
        "공지 / 공지 등록 / 공지 수정 / 공지 삭제",
        "전달사항 / 전달사항 등록 / 전달사항 수정 / 전달사항 삭제",
        "급여 요약 / 비밀번호 입력",
        "거래처 목록 / 거래처 등록 / 거래처 수정 / 거래처 삭제",
        "레시피 목록 / 레시피 등록 / 레시피 수정 / 레시피 삭제",
      ].join("\n"), ["오늘 현황", "오늘 예약", "오늘 근무표"]);
  }
}

exports.kakaoSkill = onRequest({ timeoutSeconds: 10, memory: "256MiB" }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json(textResponse("POST 요청만 사용할 수 있습니다."));
      return;
    }

    const configuredSecret = process.env.KAKAO_SKILL_SECRET;
    const providedSecret = req.get("x-kakao-skill-secret") || req.query.secret;
    if (configuredSecret && providedSecret !== configuredSecret) {
      res.status(403).json(textResponse("스킬 서버 인증에 실패했습니다."));
      return;
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const identity = getIdentity(body);
    const chatUser = await getChatUser(identity.botUserKey);
    if (!chatUser) {
      res.status(200).json(textResponse([
        "챗봇 사용 권한 등록이 필요합니다.",
        "관리자에게 아래 식별키를 전달해주세요.",
        `키: ${identity.botUserKey || "(식별키 없음)"}`,
        "",
        `Firebase 경로: stores/${STORE_ID}/chatbotUsers/{키}`,
        "필드 예시: name, role(admin/manager/staff), employeeId, active:true",
      ].join("\n")));
      return;
    }

    const action = classify(body);
    const response = await routeAction(action, body, chatUser);
    res.status(200).json(response);
  } catch (error) {
    console.error("kakaoSkill failed", error);
    res.status(200).json(failResponse("처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."));
  }
});
