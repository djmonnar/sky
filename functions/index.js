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

const STATUS_ALIASES = [
  ["방문완료", ["방문완료", "방문", "완료", "왔음"]],
  ["취소", ["취소", "캔슬"]],
  ["노쇼", ["노쇼", "안옴"]],
  ["단체", ["단체"]],
  ["확인전화필요", ["확인전화", "전화", "확인"]],
  ["예약대기", ["대기"]],
  ["예약확정", ["확정", "예약확정", "예약"]],
];

function storeCol(name) {
  return db.collection("stores").doc(STORE_ID).collection(name);
}

function storeDoc(collectionName, id) {
  return db.doc(`${STORE_PATH}/${collectionName}/${id}`);
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

function limitText(text) {
  const value = String(text ?? "");
  return value.length > 980 ? `${value.slice(0, 977)}...` : value;
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
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nowStamp() {
  const d = new Date();
  const date = formatDate(d);
  const time = new Intl.DateTimeFormat("ko-KR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date} ${time}`;
}

function resolveDate(raw) {
  const today = formatDate();
  const value = String(raw ?? "").trim();
  if (!value || /오늘/.test(value)) return today;
  if (/내일/.test(value)) return addDays(today, 1);
  if (/어제/.test(value)) return addDays(today, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const slash = value.match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (slash) {
    const year = today.slice(0, 4);
    return `${year}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  return today;
}

function parseTime(periodRaw, timeRaw) {
  const periodText = String(periodRaw ?? "");
  const raw = String(timeRaw ?? "").trim().replace(/[.\s]/g, ":");
  const embeddedPeriod = /오전|am/i.test(raw) ? "AM" : /오후|pm/i.test(raw) ? "PM" : "";
  const period = embeddedPeriod || (/오전|am/i.test(periodText) ? "AM" : "PM");
  const numeric = raw.replace(/오전|오후|am|pm/gi, "").trim();
  const match = numeric.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "00");
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour < 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseNumber(raw, fallback = 0) {
  const found = String(raw ?? "").match(/\d+/);
  return found ? Number(found[0]) : fallback;
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

function classify(body) {
  const explicit = paramOf(body, ["action", "작업", "command", "명령"]);
  const intent = body.intent?.name ?? body.action?.name ?? "";
  const utterance = body.userRequest?.utterance ?? "";
  const text = `${explicit} ${intent} ${utterance}`.toLowerCase();

  if (/도움|메뉴|help|시작/.test(text)) return "help";
  if (/급여/.test(text)) return "payroll.summary";
  if (/직원/.test(text)) return "employee.list";
  if (/공지.*등록|공지.*작성/.test(text)) return "notice.create";
  if (/공지/.test(text)) return "notice.list";
  if (/전달.*등록|전달.*작성|인수.*등록|인수.*작성/.test(text)) return "handover.create";
  if (/전달|인수/.test(text)) return "handover.list";
  if (/근무표|스케줄|근무/.test(text)) return "schedule.list";
  if (/예약.*(취소|방문|완료|노쇼|상태)/.test(text)) return "reservation.status";
  if (/예약.*(등록|추가|작성|넣)/.test(text)) return "reservation.create";
  if (/예약/.test(text)) return "reservation.list";
  if (/현황|대시보드|요약|오늘/.test(text)) return "dashboard";
  return "help";
}

function normalizeStatus(raw) {
  const text = String(raw ?? "").trim();
  for (const [status, aliases] of STATUS_ALIASES) {
    if (aliases.some((alias) => text.includes(alias))) return status;
  }
  return "";
}

async function handleDashboard() {
  const today = formatDate();
  const [reservations, employees, shifts, workRecords] = await Promise.all([
    storeCol("reservations").where("date", "==", today).get(),
    storeCol("employees").get(),
    storeCol("shifts").where("date", "==", today).get(),
    storeCol("workRecords").where("date", "==", today).get(),
  ]);

  const activeReservations = reservations.docs.filter((doc) => {
    const status = doc.data().status;
    return status !== "취소" && status !== "노쇼";
  });
  const activeEmployees = employees.docs.filter((doc) => doc.data().active !== false);
  const pendingRecords = workRecords.docs.filter((doc) => {
    const status = String(doc.data().status ?? "");
    return status.includes("대기") || status.includes("미작성") || status.includes("제출");
  });

  return textResponse(
    [
      "하늘땅 오늘 현황",
      `예약: ${activeReservations.length}건`,
      `근무 배치: ${shifts.size}건`,
      `직원: ${activeEmployees.length}명`,
      `확인 필요한 근무기록: ${pendingRecords.length}건`,
    ].join("\n"),
    ["오늘 예약", "오늘 근무표", "공지"]
  );
}

async function handleReservationList(body) {
  const utterance = body.userRequest?.utterance ?? "";
  const date = resolveDate(paramOf(body, ["date", "날짜"]) || utterance);
  const period = paramOf(body, ["period", "오전오후"]) || utterance;
  const status = normalizeStatus(paramOf(body, ["status", "상태"]) || utterance);
  let docs = (await storeCol("reservations").where("date", "==", date).get()).docs
    .map((doc) => doc.data())
    .sort((a, b) => String(a.time ?? "").localeCompare(String(b.time ?? "")));

  if (/오전|am/i.test(period)) docs = docs.filter((r) => String(r.time ?? "") < "12:00");
  if (/오후|pm/i.test(period)) docs = docs.filter((r) => String(r.time ?? "") >= "12:00");
  if (status) docs = docs.filter((r) => r.status === status);

  if (docs.length === 0) {
    return textResponse(`${date} 예약이 없습니다.`, ["예약 등록", "오늘 현황"]);
  }

  const lines = docs.slice(0, 12).map((r) =>
    `${r.id}. ${r.time} ${r.name} ${r.people ?? 0}명 ${r.seat || ""} ${r.status || ""}`.trim()
  );
  const suffix = docs.length > 12 ? `\n외 ${docs.length - 12}건 더 있습니다.` : "";
  return textResponse(`${date} 예약 ${docs.length}건\n${lines.join("\n")}${suffix}`, ["예약 등록", "오늘 현황"]);
}

async function handleReservationCreate(body, chatUser) {
  const name = paramOf(body, ["name", "예약자", "이름"]);
  const phone = paramOf(body, ["phone", "연락처", "전화"]);
  const time = parseTime(
    paramOf(body, ["period", "오전오후"]),
    paramOf(body, ["time", "시간"])
  );
  if (!name || !phone || !time) {
    return failResponse(
      [
        "예약 등록에 필요한 값이 부족합니다.",
        "필수: 예약자, 연락처, 오전/오후, 시간",
        "선택: 날짜, 인원, 좌석, 요청사항",
        "예: 예약 등록 / 홍길동 / 010-1234-5678 / 오후 / 7:30 / 4명 / 창가",
      ].join("\n")
    );
  }

  const people = Math.max(1, parseNumber(paramOf(body, ["people", "인원"]), 2));
  const id = Date.now();
  const reservation = {
    id,
    date: resolveDate(paramOf(body, ["date", "날짜"])),
    time,
    name,
    phone,
    people,
    seat: paramOf(body, ["seat", "좌석", "자리"]),
    request: paramOf(body, ["request", "요청사항", "메모"]),
    status: people >= 8 ? "단체" : "예약확정",
    writer: chatUser.name,
    createdAt: nowStamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await storeDoc("reservations", String(id)).set(reservation, { merge: true });
  return textResponse(
    `예약을 등록했습니다.\n번호: ${id}\n${reservation.date} ${reservation.time}\n${name} ${people}명 ${reservation.seat || ""}`,
    ["오늘 예약", "오늘 현황"]
  );
}

async function handleReservationStatus(body) {
  const utterance = body.userRequest?.utterance ?? "";
  const id = parseNumber(paramOf(body, ["id", "reservationId", "예약번호"]) || utterance);
  const status = normalizeStatus(paramOf(body, ["status", "상태"]) || utterance);
  if (!id || !status) {
    return failResponse("예약번호와 바꿀 상태가 필요합니다.\n예: 예약 상태 / 1780000000000 / 방문완료");
  }

  const ref = storeDoc("reservations", String(id));
  const snap = await ref.get();
  if (!snap.exists) return failResponse(`예약번호 ${id}를 찾지 못했습니다.`);
  await ref.set({ status, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return textResponse(`${snap.data().name ?? "예약"} 상태를 ${status}로 변경했습니다.`, ["오늘 예약"]);
}

function groupShifts(shifts) {
  const result = {
    morning: { hall: [], kitchen: [] },
    afternoon: { hall: [], kitchen: [] },
  };
  shifts.forEach((shift) => {
    const period = shift.period === "afternoon" ? "afternoon" : "morning";
    const dept = shift.department === "kitchen" ? "kitchen" : "hall";
    result[period][dept].push(shift.employeeName || `직원${shift.employeeId}`);
  });
  return result;
}

async function handleScheduleList(body, chatUser) {
  const utterance = body.userRequest?.utterance ?? "";
  const date = resolveDate(paramOf(body, ["date", "날짜"]) || utterance);
  let docs = (await storeCol("shifts").where("date", "==", date).get()).docs.map((doc) => doc.data());
  if (chatUser.role === "staff") {
    docs = docs.filter((shift) => Number(shift.employeeId ?? shift.empId) === chatUser.employeeId);
  }
  if (docs.length === 0) return textResponse(`${date} 근무표가 비어 있습니다.`, ["오늘 현황"]);

  const grouped = groupShifts(docs);
  const line = (period, dept, label) => {
    const names = grouped[period][dept];
    return `${label}: ${names.length ? names.join(", ") : "-"}`;
  };
  return textResponse(
    [
      `${date} 근무표`,
      line("morning", "hall", "오전 홀"),
      line("morning", "kitchen", "오전 주방"),
      line("afternoon", "hall", "오후 홀"),
      line("afternoon", "kitchen", "오후 주방"),
    ].join("\n"),
    ["오늘 예약", "오늘 현황"]
  );
}

async function handleEmployeeList(chatUser) {
  const denied = assertRole(chatUser, ["admin", "manager"]);
  if (denied) return failResponse(denied);
  const docs = (await storeCol("employees").get()).docs
    .map((doc) => doc.data())
    .filter((employee) => employee.active !== false)
    .sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));
  const lines = docs.slice(0, 20).map((e) => `${e.id}. ${e.name} / ${e.roleLabel || e.role || "-"} / ${e.employmentType || "-"}`);
  return textResponse(`직원 ${docs.length}명\n${lines.join("\n") || "-"}`, ["오늘 근무표", "오늘 현황"]);
}

async function handleNoticeList(kind) {
  const collectionName = kind === "handover" ? "handovers" : "notices";
  const label = kind === "handover" ? "전달사항" : "공지";
  const docs = (await storeCol(collectionName).get()).docs
    .map((doc) => ({ docId: doc.id, ...doc.data() }))
    .sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))
    .slice(0, 8);
  if (docs.length === 0) return textResponse(`${label}이 없습니다.`, ["오늘 현황"]);
  return textResponse(`${label}\n${docs.map((n) => `- ${n.text}`).join("\n")}`, ["오늘 현황"]);
}

async function handleNoticeCreate(body, chatUser, kind) {
  const canCreateNotice = kind === "handover" || !assertRole(chatUser, ["admin", "manager"]);
  if (!canCreateNotice) return failResponse("공지 작성은 관리자/매니저만 가능합니다.");
  const text = paramOf(body, ["text", "내용", "공지", "전달사항", "메모"]);
  if (!text) return failResponse(`${kind === "handover" ? "전달사항" : "공지"} 내용을 입력해주세요.`);
  const id = Date.now();
  const collectionName = kind === "handover" ? "handovers" : "notices";
  await storeDoc(collectionName, String(id)).set({
    id,
    text,
    date: formatDate(),
    createdBy: chatUser.name,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return textResponse(`${kind === "handover" ? "전달사항" : "공지"}을 등록했습니다.`, ["공지", "오늘 현황"]);
}

async function handlePayrollSummary(body, chatUser) {
  const denied = assertRole(chatUser, ["admin"]);
  if (denied) return failResponse(denied);
  const utterance = body.userRequest?.utterance ?? "";
  const password = paramOf(body, ["password", "비밀번호"]) || (utterance.match(/\d{4,}/)?.[0] ?? "");
  const passwordSnap = await storeDoc("meta", "payrollPassword").get();
  const expected = passwordSnap.exists ? String(passwordSnap.data().value ?? "0000") : "0000";
  if (password !== expected) return failResponse("급여 확인 비밀번호가 필요합니다.\n예: 급여 요약 / 비밀번호 0000");

  const docs = (await storeCol("payroll").get()).docs.map((doc) => doc.data());
  const total = docs.reduce((sum, row) => sum + Number(row.base ?? 0) + Number(row.extra ?? 0) - Number(row.deduct ?? 0), 0);
  return textResponse(`급여 요약\n대상: ${docs.length}명\n예상 지급액: ${Math.round(total / 10000)}만원`, ["오늘 현황"]);
}

async function routeAction(action, body, chatUser) {
  switch (action) {
    case "dashboard":
      return handleDashboard();
    case "reservation.list":
      return handleReservationList(body);
    case "reservation.create":
      return handleReservationCreate(body, chatUser);
    case "reservation.status":
      return handleReservationStatus(body);
    case "schedule.list":
      return handleScheduleList(body, chatUser);
    case "employee.list":
      return handleEmployeeList(chatUser);
    case "notice.list":
      return handleNoticeList("notice");
    case "notice.create":
      return handleNoticeCreate(body, chatUser, "notice");
    case "handover.list":
      return handleNoticeList("handover");
    case "handover.create":
      return handleNoticeCreate(body, chatUser, "handover");
    case "payroll.summary":
      return handlePayrollSummary(body, chatUser);
    case "help":
    default:
      return textResponse(
        [
          "하늘땅 챗봇 메뉴",
          "오늘 현황",
          "오늘 예약 / 내일 예약",
          "예약 등록",
          "예약 상태 변경",
          "오늘 근무표",
          "직원 목록",
          "공지 / 공지 등록",
          "전달사항 / 전달사항 등록",
          "급여 요약",
        ].join("\n"),
        ["오늘 현황", "오늘 예약", "오늘 근무표"]
      );
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
      res.status(200).json(textResponse(
        [
          "챗봇 사용 권한 등록이 필요합니다.",
          "관리자에게 아래 식별키를 전달해주세요.",
          `키: ${identity.botUserKey || "(식별키 없음)"}`,
          "",
          `Firebase 경로: stores/${STORE_ID}/chatbotUsers/{키}`,
          "필드 예: name, role, employeeId, active:true",
        ].join("\n")
      ));
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
