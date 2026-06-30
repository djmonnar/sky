const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
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
let visionClient = null;

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

function formatTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("hour")}-${get("minute")}`.replace("-", ":");
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

function parseDecimal(raw, fallback = 0) {
  const found = String(raw ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return found ? Number(found[0]) : fallback;
}

function onlyDigits(value = "") {
  return String(value ?? "").replace(/\D/g, "");
}

function compactText(value = "") {
  return String(value ?? "").replace(/\s/g, "").toLowerCase();
}

function chatbotSessionRef(chatUser) {
  return storeDoc("chatbotSessions", chatUser.id);
}

function collectStrings(value, out = []) {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out));
    return out;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, out));
  }
  return out;
}

function urlsFromText(value) {
  return String(value ?? "")
    .match(/https?:\/\/[^\s"'<>)\]]+/gi)
    ?.map((url) => url.replace(/[),.;]+$/g, ""))
    ?? [];
}

function extractImageUrl(body) {
  const direct = paramOf(body, [
    "image", "imageUrl", "image_url", "fileUrl", "file_url",
    "photo", "photoUrl", "secureimage", "secureImage", "사진", "이미지", "파일",
  ]);
  const strings = [direct, ...collectStrings(body)].filter(Boolean);
  const urls = strings.flatMap(urlsFromText);
  return urls.find((value) => /^https?:\/\/.+\.(?:png|jpe?g|webp)(?:\?|$)/i.test(value))
    ?? urls.find((value) => /^https?:\/\/.+(?:image|photo|thumbnail|kakao|daumcdn|file|kakaocdn)/i.test(value))
    ?? "";
}

function cleanOcrItemName(raw) {
  return String(raw ?? "")
    .replace(/^\d+\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/[|[\]{}]/g, "")
    .replace(/[\/\s-]+$/, "")
    .trim();
}

function inferStorageType(text) {
  if (/냉동|생동|frozen/i.test(text)) return "냉동";
  if (/실온|상온|room/i.test(text)) return "실온";
  if (/냉장|냉징|fresh/i.test(text)) return "냉장";
  return "냉장";
}

function inventoryUnitLabel(raw) {
  const value = String(raw ?? "kg").trim();
  if (/^box$/i.test(value)) return "박스";
  if (value === "㎏") return "kg";
  return value || "kg";
}

function inventoryNumberTokens(text, offset = 0) {
  return [...String(text ?? "").matchAll(/\d[\d,.]*/g)]
    .map((match) => ({
      raw: match[0],
      value: parseDecimal(match[0]),
      index: offset + (match.index ?? 0),
    }))
    .filter((token) => token.value > 0);
}

function isInventoryOcrCandidate(line) {
  if (/품목|합계|거래명세|사업자|공급|전화|주소|비고|잔액|원산지|상호|성명|팩스/i.test(line)) {
    return false;
  }
  return /(kg|㎏|개|박스|box|돈|갈비|목살|거세|우진|한우|목심|냉동|냉장|국내산|CAB|IBP)/i.test(line);
}

function inventoryRowSignature(row) {
  return [
    String(row.name || "").replace(/\s+/g, "").toLowerCase(),
    Number(row.qty || 0),
    Number(row.unitPrice || 0),
    Number(row.totalPrice || 0),
  ].join("|");
}

function parseInventoryOcrRows(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const rows = [];
  const seen = new Set();
  const pushRow = (row) => {
    if (!row.name || row.name.length < 2 || Number(row.qty) <= 0) return;
    const signature = inventoryRowSignature(row);
    if (seen.has(signature)) return;
    seen.add(signature);
    rows.push(row);
  };
  lines.forEach((line, index) => {
    if (!isInventoryOcrCandidate(line)) return;
    const unitMatch = line.match(/\b(kg|㎏|개|박스|box|BOX|병|팩|봉)\b/i);
    const unitIndex = unitMatch?.index ?? -1;
    let name = "";
    let unit = "kg";
    let qty = 0;
    let unitPrice = 0;
    let totalPrice = 0;

    if (unitMatch && unitIndex > 0) {
      unit = inventoryUnitLabel(unitMatch[1]);
      name = cleanOcrItemName(line.slice(0, unitIndex));
      const afterUnit = line.slice(unitIndex + unitMatch[0].length);
      const numbers = inventoryNumberTokens(afterUnit).map((token) => token.value);
      if (numbers.length < 1) return;
      qty = numbers[0];
      unitPrice = numbers[1] ?? 0;
      totalPrice = numbers[2] ?? Math.round(qty * unitPrice);
    } else {
      // Some Kakao/Tesseract OCR results drop the unit column, especially on meat invoices.
      // In that case read rows shaped like: item name + decimal quantity + unit price + total.
      const tokens = inventoryNumberTokens(line);
      const qtyTokenIndex = tokens.findIndex((token) =>
        token.raw.includes(".") && token.value > 0 && token.value < 10000
      );
      if (qtyTokenIndex < 0) return;
      const qtyToken = tokens[qtyTokenIndex];
      name = cleanOcrItemName(line.slice(0, qtyToken.index));
      qty = qtyToken.value;
      const moneyTokens = tokens
        .slice(qtyTokenIndex + 1)
        .filter((token) => token.value >= 1000 || token.raw.includes(","));
      unitPrice = moneyTokens[0]?.value ?? 0;
      totalPrice = moneyTokens[1]?.value ?? Math.round(qty * unitPrice);
    }

    pushRow({
      key: `${Date.now()}_${index}`,
      name,
      unit,
      qty,
      unitPrice,
      totalPrice,
      storageType: inferStorageType(name),
      memo: line,
      selected: true,
    });
  });

  lines.forEach((line, index) => {
    if (!isInventoryOcrCandidate(line)) return;
    const ownNumbers = inventoryNumberTokens(line);
    const hasOwnQty = ownNumbers.some((token) => token.raw.includes(".") && token.value > 0 && token.value < 10000);
    if (hasOwnQty) return;

    const name = cleanOcrItemName(line);
    if (!name || name.length < 2) return;
    let unit = "kg";
    const numbers = [];
    const memoLines = [line];
    for (let offset = 1; offset <= 8; offset += 1) {
      const next = lines[index + offset];
      if (!next) break;
      if (offset > 1 && isInventoryOcrCandidate(next)) break;
      memoLines.push(next);
      const unitOnly = next.match(/^(kg|㎏|개|박스|box|BOX|병|팩|봉)$/i);
      if (unitOnly) {
        unit = inventoryUnitLabel(unitOnly[1]);
        continue;
      }
      inventoryNumberTokens(next).forEach((token) => numbers.push(token));
    }
    const qtyTokenIndex = numbers.findIndex((token) =>
      token.raw.includes(".") && token.value > 0 && token.value < 10000
    );
    if (qtyTokenIndex < 0) return;
    const qty = numbers[qtyTokenIndex].value;
    const moneyTokens = numbers
      .slice(qtyTokenIndex + 1)
      .filter((token) => token.value >= 1000 || token.raw.includes(","));
    const unitPrice = moneyTokens[0]?.value ?? 0;
    const totalPrice = moneyTokens[1]?.value ?? Math.round(qty * unitPrice);
    pushRow({
      key: `${Date.now()}_${index}_block`,
      name,
      unit,
      qty,
      unitPrice,
      totalPrice,
      storageType: inferStorageType(name),
      memo: memoLines.join(" / "),
      selected: true,
    });
  });
  return rows.slice(0, 30);
}

async function listVendors() {
  return (await storeCol("vendors").get()).docs
    .map((doc) => ({ docId: doc.id, ...doc.data() }))
    .filter((vendor) => vendor.active !== false);
}

function detectVendorFromText(text, vendors) {
  const textDigits = onlyDigits(text);
  const compact = compactText(text);
  return vendors.find((vendor) => {
    const businessNumber = onlyDigits(vendor.businessNumber);
    return businessNumber.length >= 5 && textDigits.includes(businessNumber);
  }) ?? vendors.find((vendor) => {
    const name = compactText(vendor.name);
    return name.length >= 2 && compact.includes(name);
  }) ?? null;
}

async function downloadImageBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`이미지 다운로드 실패: ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/^image\//i.test(contentType)) {
      throw new Error("이미지 파일만 OCR 처리할 수 있습니다.");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 8 * 1024 * 1024) throw new Error("이미지는 8MB 이하로 올려주세요.");
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

async function recognizeInventoryImage(url) {
  const buffer = await downloadImageBuffer(url);
  return recognizeInventoryBuffer(buffer);
}

function getVisionClient() {
  if (!visionClient) {
    const vision = require("@google-cloud/vision");
    visionClient = new vision.ImageAnnotatorClient();
  }
  return visionClient;
}

async function recognizeInventoryBufferWithVision(buffer) {
  const client = getVisionClient();
  const [documentResult] = await client.documentTextDetection({
    image: { content: buffer },
  });
  const documentText = String(
    documentResult?.fullTextAnnotation?.text
    || documentResult?.textAnnotations?.[0]?.description
    || ""
  ).trim();
  if (documentText.split(/\r?\n/).filter(Boolean).length >= 10) return documentText;

  const [textResult] = await client.textDetection({
    image: { content: buffer },
  });
  const text = String(
    textResult?.fullTextAnnotation?.text
    || textResult?.textAnnotations?.[0]?.description
    || ""
  ).trim();
  return text.length > documentText.length ? text : documentText;
}

async function recognizeInventoryBufferWithTesseract(buffer) {
  const { recognize } = require("tesseract.js");
  const result = await recognize(buffer, "kor+eng");
  return String(result?.data?.text ?? "").trim();
}

async function recognizeInventoryBuffer(buffer) {
  try {
    const visionText = await recognizeInventoryBufferWithVision(buffer);
    if (visionText) return visionText;
    console.warn("Google Vision OCR returned empty text; falling back to Tesseract.");
  } catch (error) {
    console.warn("Google Vision OCR failed; falling back to Tesseract.", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return recognizeInventoryBufferWithTesseract(buffer);
}

function chatbotUploadUrl(chatUser, mode = "inventory") {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "skyearth-84a78";
  const base = `https://asia-northeast3-${projectId}.cloudfunctions.net/chatbotInventoryUpload`;
  const url = new URL(base);
  url.searchParams.set("key", chatUser.id);
  url.searchParams.set("mode", mode);
  return url.toString();
}

function htmlPage(body) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>하늘땅 재고 OCR</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4f0e5; color: #22251f; }
    main { max-width: 560px; margin: 0 auto; padding: 28px 18px; }
    .card { background: #fffdf8; border: 1px solid #ded5c3; border-radius: 18px; padding: 22px; box-shadow: 0 10px 30px rgba(31,37,24,.08); }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { color: #756e62; line-height: 1.55; }
    input, button { width: 100%; box-sizing: border-box; min-height: 50px; border-radius: 14px; font-size: 16px; }
    input { border: 1px solid #d8cfbd; background: #fff; padding: 12px; }
    button { margin-top: 14px; border: 0; background: #375334; color: white; font-weight: 800; }
    button:disabled { opacity: .55; }
    pre { white-space: pre-wrap; background: #eef5e9; border-radius: 14px; padding: 14px; overflow-wrap: anywhere; }
    .small { font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <div class="card">
      ${body}
    </div>
  </main>
</body>
</html>`;
}

function hasDateToken(raw) {
  return /오늘|내일|어제|모레|\d{4}[./-]\d{1,2}[./-]\d{1,2}|\b\d{1,2}[./-]\d{1,2}\b|\d{1,2}\s*월\s*\d{1,2}\s*일?/.test(String(raw ?? ""));
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
  const korean = value.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (korean) {
    return `${today.slice(0, 4)}-${korean[1].padStart(2, "0")}-${korean[2].padStart(2, "0")}`;
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
  const dateMatch = text.match(/오늘|내일|어제|모레|\d{4}[./-]\d{1,2}[./-]\d{1,2}|\b\d{1,2}[./-]\d{1,2}\b|\d{1,2}\s*월\s*\d{1,2}\s*일?/);
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

function explicitReservationId(body) {
  const direct = paramOf(body, ["id", "reservationId", "예약번호"]);
  if (direct) return parseNumber(direct);
  const text = utteranceOf(body);
  const labeled = text.match(/(?:예약번호|예약\s*번호|번호)\s*[:#]?\s*(\d{8,})/);
  if (labeled) return Number(labeled[1]);
  const afterReservation = text.match(/예약\s*(\d{8,})/);
  if (afterReservation) return Number(afterReservation[1]);
  const longId = text.match(/\b(\d{12,})\b/);
  return longId ? Number(longId[1]) : 0;
}

function reservationLookupFields(body) {
  const raw = utteranceOf(body);
  const text = raw.replace(/\//g, " ");
  const dateParam = paramOf(body, ["date", "날짜"]);
  const nameParam = paramOf(body, ["name", "예약자", "이름"]);
  const dateMatch = text.match(/오늘|내일|어제|모레|\d{4}[./-]\d{1,2}[./-]\d{1,2}|\b\d{1,2}[./-]\d{1,2}\b|\d{1,2}\s*월\s*\d{1,2}\s*일?/);
  const dateInput = dateParam || dateMatch?.[0] || "";
  if (nameParam) return { dateInput, name: nameParam };

  let nameSource = text;
  if (dateMatch && dateMatch.index !== undefined) {
    nameSource = text.slice(dateMatch.index + dateMatch[0].length);
  }
  const name = nameSource
    .replace(/예약\s*(취소|삭제|방문완료|방문|완료|노쇼|상태|수정|변경)?/g, " ")
    .replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, " ")
    .replace(/\b\d{1,2}(?::\d{2})?\b/g, " ")
    .replace(/\d+\s*(?:명|인)/g, " ")
    .replace(/오전|오후/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => !["취소", "삭제", "방문완료", "방문", "완료", "노쇼", "예약확정", "확정", "상태"].includes(token))
    .filter(Boolean)
    .join(" ");
  return { dateInput, name };
}

async function findReservationByDateAndName(body) {
  const { dateInput, name } = reservationLookupFields(body);
  if (!dateInput || !name) {
    return {
      error: "예약번호 또는 날짜+예약자명이 필요합니다.\n예: 예약취소 6월29일 홍길동",
    };
  }
  const date = resolveDate(dateInput);
  const targetName = name.replace(/\s+/g, "");
  const docs = (await storeCol("reservations").where("date", "==", date).get()).docs
    .map((doc) => ({ ref: doc.ref, data: doc.data() }))
    .filter(({ data }) => String(data.name ?? "").replace(/\s+/g, "") === targetName);

  if (docs.length === 0) {
    return { error: `${date} ${name} 예약을 찾지 못했습니다.` };
  }
  if (docs.length > 1) {
    const lines = docs.slice(0, 5).map(({ data }) =>
      `${data.id}. ${data.time ?? ""} ${data.name ?? ""} ${data.people ?? ""}명 ${data.seat ?? ""}`.trim()
    );
    return {
      error: `같은 이름 예약이 ${docs.length}건 있습니다. 예약번호로 다시 입력해주세요.\n${lines.join("\n")}`,
    };
  }
  return docs[0];
}

async function reservationTarget(body) {
  const id = explicitReservationId(body);
  if (id) {
    const ref = storeDoc("reservations", String(id));
    const snap = await ref.get();
    if (!snap.exists) return { error: `예약번호 ${id}를 찾지 못했습니다.` };
    return { ref, data: snap.data() };
  }
  return findReservationByDateAndName(body);
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
    "inventory.ocr.start",
    "purchase.ocr.start",
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
  if (/재고\s*(확인|입고|ocr|사진|촬영)/.test(text)) return "inventory.ocr.start";
  if (/발주\s*(확인|입고|ocr|사진|촬영)/.test(text)) return "purchase.ocr.start";
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
  const target = await reservationTarget(body);
  if (target.error) return failResponse(target.error);
  const { ref, data } = target;
  const id = data.id ?? ref.id;
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
  if (patch.status === "취소") {
    await ref.delete();
    return textResponse(`예약 ${id}번을 삭제했습니다.`, ["오늘 예약"]);
  }
  await ref.set(patch, { merge: true });
  if (patch.status === "방문완료") {
    return textResponse(`예약 ${id}번을 방문완료로 변경했습니다.`, ["오늘 예약"]);
  }
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

function stripNoticeCommand(raw, kind, mode) {
  const subject = kind === "handover"
    ? "(?:전달사항|전달|인수인계|인수)"
    : "(?:공지사항|공지)";
  const action = mode === "create"
    ? "(?:등록|작성|추가)?"
    : mode === "update"
      ? "(?:수정|변경)"
      : "(?:삭제)";
  const pattern = new RegExp(`^\\s*${subject}\\s*${action}\\s*(?:/|:|-)?\\s*`, "i");
  return String(raw ?? "").replace(pattern, "").trim();
}

function noticeIdFromUtterance(body, kind, mode) {
  const direct = paramOf(body, ["id", "docId", "문서번호"]);
  if (direct) return direct;
  const remainder = stripNoticeCommand(utteranceOf(body), kind, mode);
  return remainder.match(/\d+/)?.[0] ?? "";
}

function noticeTextFromUtterance(body, kind, mode, docId = "") {
  const direct = paramOf(body, ["text", "내용", "공지", "전달사항", "메모"]);
  if (direct) return direct;
  let remainder = stripNoticeCommand(utteranceOf(body), kind, mode);
  if (!remainder) return "";
  if (mode === "update") {
    const withoutId = docId
      ? remainder.replace(new RegExp(`^\\s*${docId}\\s*(?:/|:|-)?\\s*`), "")
      : remainder.replace(/^\s*\d+\s*(?:\/|:|-)?\s*/, "");
    return withoutId.trim();
  }
  return remainder.replace(/^(?:\/|:|-)\s*/, "").trim();
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
  const docId = noticeIdFromUtterance(body, kind, mode);
  if (mode === "delete") {
    if (!docId) return failResponse(`삭제할 문서번호가 필요합니다.\n예: ${label} 삭제 / 123`);
    await storeDoc(collectionName, docId).delete();
    return textResponse(`${label}을 삭제했습니다.`, [label]);
  }
  const text = noticeTextFromUtterance(body, kind, mode, docId);
  if (!text) {
    const example = mode === "update"
      ? `${label} 수정 / 123 / 수정할 내용`
      : `${label} 등록 / 주방 재료 입고 확인 필요`;
    return failResponse(`${label} 내용을 입력해주세요.\n예: ${example}`);
  }
  const id = mode === "update" ? docId : String(Date.now());
  if (!id) return failResponse(`수정할 문서번호가 필요합니다.\n예: ${label} 수정 / 123 / 수정할 내용`);
  await storeDoc(collectionName, id).set({
    id: Number(id) || Date.now(),
    text,
    date: formatDate(),
    createdBy: chatUser.name,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(mode === "create" ? { createdAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
  }, { merge: true });
  return textResponse(
    mode === "update" ? `${label}을 수정했습니다.` : `${label}을 등록했습니다.\n번호: ${id}`,
    [label, "오늘 현황"]
  );
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

function inventoryOcrSummary(session) {
  const rows = Array.isArray(session.rows) ? session.rows : [];
  const total = rows.reduce((sum, row) => sum + Number(row.totalPrice || 0), 0);
  const lines = rows.slice(0, 8).map((row, index) =>
    `${index + 1}. ${row.name} ${row.qty}${row.unit} / 단가 ${Number(row.unitPrice || 0).toLocaleString()}원`
  );
  if (rows.length > 8) lines.push(`외 ${rows.length - 8}개`);
  return [
    session.vendorName ? `거래처: ${session.vendorName}` : "거래처: 미확인",
    `품목: ${rows.length}개`,
    `금액: ${Math.round(total).toLocaleString()}원`,
    "",
    ...lines,
  ].join("\n");
}

function inventoryOcrRetryText({ chatUser, mode = "inventory", ocrText = "" }) {
  return [
    "사진은 받았지만 품목을 자동으로 찾지 못했습니다.",
    "카카오 보안 이미지가 작게/흐리게 전달되면 OCR이 표를 못 읽을 수 있어요.",
    "",
    "원본 사진으로 다시 처리하려면 아래 링크로 업로드해주세요.",
    chatbotUploadUrl(chatUser, mode),
    "",
    "읽은 내용 일부:",
    ocrText.slice(0, 500) || "-",
  ].join("\n");
}

function isInventoryOcrResultText(text) {
  return /^(결과|결과\s*확인|결과보기|확인|재분석|다시\s*분석|분석|ocr|OCR)$/.test(String(text ?? "").trim());
}

async function handleInventoryOcrStart(body, chatUser, mode = "inventory") {
  const denied = requireOps(chatUser);
  if (denied) return failResponse(denied);
  const imageUrl = extractImageUrl(body);
  if (imageUrl) return queueInventoryOcrImage(body, chatUser, mode);
  await chatbotSessionRef(chatUser).set({
    type: "inventoryOcr",
    mode,
    status: "awaiting_image",
    requestedBy: chatUser.name,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  const label = mode === "purchase" ? "발주확인" : "재고확인";
  return textResponse(
    `${label} 준비하겠습니다.\n카카오 채팅방에 거래명세서나 입고 사진을 보내주세요.\n\n사진 전송 후 답이 없으면 '결과'라고 입력해주세요. PC 보안 이미지가 계속 멈추면 아래 링크 업로드로 처리할 수 있어요.\n${chatbotUploadUrl(chatUser, mode)}\n\n사진에서 거래처명/사업자번호가 보이면 자동으로 거래처를 맞춥니다.`,
    ["결과", "취소"]
  );
}

async function queueInventoryOcrImage(body, chatUser, mode = "inventory") {
  const denied = requireOps(chatUser);
  if (denied) return failResponse(denied);
  const imageUrl = extractImageUrl(body);
  if (!imageUrl) {
    return textResponse("사진 URL을 찾지 못했습니다.\n이미지를 다시 올려주세요.", ["취소"]);
  }
  const jobId = `${chatUser.id}_${Date.now()}`;
  const job = {
    id: jobId,
    type: "inventoryOcr",
    mode,
    status: "queued",
    imageUrl,
    chatUserId: chatUser.id,
    chatUserName: chatUser.name,
    chatUserRole: chatUser.role,
    employeeId: Number(chatUser.employeeId || 0),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await storeDoc("chatbotOcrJobs", jobId).set(job);
  await chatbotSessionRef(chatUser).set({
    type: "inventoryOcr",
    mode,
    status: "processing",
    imageUrl,
    jobId,
    requestedBy: chatUser.name,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return textResponse(
    "사진 받았습니다.\nOCR 처리 중입니다. 보통 10~20초 정도 걸려요.\n잠시 뒤 '결과'를 눌러 확인해주세요.",
    ["결과", "취소"]
  );
}

async function handleInventoryOcrImage(body, chatUser, mode = "inventory") {
  const denied = requireOps(chatUser);
  if (denied) return failResponse(denied);
  const imageUrl = extractImageUrl(body);
  if (!imageUrl) {
    return textResponse("사진 URL을 찾지 못했습니다.\n이미지를 다시 올려주세요.", ["취소"]);
  }
  let ocrText = "";
  try {
    ocrText = await recognizeInventoryImage(imageUrl);
  } catch (error) {
    console.error("inventory OCR failed", error);
    return failResponse("사진을 읽지 못했습니다. 글자가 선명하게 보이도록 다시 촬영해주세요.");
  }
  const rows = parseInventoryOcrRows(ocrText);
  if (rows.length === 0) {
    await chatbotSessionRef(chatUser).set({
      type: "inventoryOcr",
      mode,
      status: "awaiting_image",
      imageUrl,
      lastOcrText: ocrText.slice(0, 1500),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return textResponse(
      inventoryOcrRetryText({ chatUser, mode, ocrText }),
      ["재고확인", "취소"]
    );
  }

  const vendors = await listVendors();
  const vendor = detectVendorFromText(ocrText, vendors);
  const session = {
    type: "inventoryOcr",
    mode,
    status: "awaiting_confirm",
    imageUrl,
    ocrText: ocrText.slice(0, 4000),
    rows,
    vendorId: vendor ? Number(vendor.id) : 0,
    vendorName: vendor?.name ?? "",
    requestedBy: chatUser.name,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await chatbotSessionRef(chatUser).set(session, { merge: true });
  const nextGuide = vendor
    ? "맞으면 '확인'이라고 보내주세요. 아니면 '취소'라고 보내주세요."
    : "거래처를 못 찾았습니다. '거래처 거래처명'을 먼저 보내고, 맞으면 '확인'이라고 보내주세요.";
  return textResponse(`OCR 결과입니다.\n${inventoryOcrSummary(session)}\n\n${nextGuide}`, vendor ? ["확인", "취소"] : ["거래처 목록", "취소"]);
}

async function saveInventoryOcrTextToSession({ chatUser, mode = "inventory", imageUrl = "", ocrText = "" }) {
  const rows = parseInventoryOcrRows(ocrText);
  if (rows.length === 0) {
    await chatbotSessionRef(chatUser).set({
      type: "inventoryOcr",
      mode,
      status: "awaiting_image",
      imageUrl,
      lastOcrText: ocrText.slice(0, 1500),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      ok: false,
      text: inventoryOcrRetryText({ chatUser, mode, ocrText }),
    };
  }
  const vendors = await listVendors();
  const vendor = detectVendorFromText(ocrText, vendors);
  const session = {
    type: "inventoryOcr",
    mode,
    status: "awaiting_confirm",
    imageUrl,
    ocrText: ocrText.slice(0, 4000),
    rows,
    vendorId: vendor ? Number(vendor.id) : 0,
    vendorName: vendor?.name ?? "",
    requestedBy: chatUser.name,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await chatbotSessionRef(chatUser).set(session, { merge: true });
  const nextGuide = vendor
    ? "카톡으로 돌아가 '확인'이라고 보내면 실제 재고에 반영됩니다."
    : "거래처를 못 찾았습니다. 카톡에서 '거래처 거래처명'을 보내고, 맞으면 '확인'이라고 보내주세요.";
  return {
    ok: true,
    text: `OCR 결과입니다.\n${inventoryOcrSummary(session)}\n\n${nextGuide}`,
  };
}

async function applyInventoryOcrSession(session, chatUser) {
  const rows = (Array.isArray(session.rows) ? session.rows : [])
    .filter((row) => row && row.selected !== false && row.name && Number(row.qty) > 0);
  if (rows.length === 0) return failResponse("반영할 품목이 없습니다. 사진을 다시 올려주세요.");
  const vendorId = Number(session.vendorId || 0);
  if (!vendorId) {
    return textResponse("거래처가 필요합니다.\n'거래처 거래처명'으로 먼저 거래처를 지정해주세요.", ["거래처 목록", "취소"]);
  }
  const vendorSnap = await storeDoc("vendors", String(vendorId)).get();
  if (!vendorSnap.exists) return failResponse("선택된 거래처를 찾지 못했습니다. 거래처를 다시 지정해주세요.");
  const vendor = { id: vendorId, ...vendorSnap.data() };

  const inventorySnap = await storeCol("inventoryItems").get();
  const inventory = inventorySnap.docs.map((doc) => ({ docId: doc.id, ...doc.data() }));
  let nextItemId = Math.max(0, ...inventory.map((item) => Number(item.id || item.docId || 0))) + 1;
  const orderId = Date.now();
  const nowIso = new Date().toISOString();
  const batch = db.batch();
  const purchaseItems = [];

  rows.forEach((row, index) => {
    const name = String(row.name).trim();
    const unit = String(row.unit || "개").trim();
    const qty = Number(row.qty) || 0;
    const unitPrice = Number(row.unitPrice) || 0;
    const existing = inventory.find((item) =>
      Number(item.vendorId || 0) === vendorId
      && String(item.name || "").trim() === name
      && String(item.unit || "").trim() === unit
    );
    const itemId = existing ? Number(existing.id || existing.docId) : nextItemId++;
    const beforeQty = Number(existing?.currentQty || 0);
    const afterQty = beforeQty + qty;
    const itemRef = storeDoc("inventoryItems", String(itemId));
    const itemData = existing ? {
      ...existing,
      currentQty: afterQty,
      unitPrice: unitPrice || Number(existing.unitPrice || 0),
      defaultOrderQty: Number(existing.defaultOrderQty || 0) || qty,
      memo: row.memo || existing.memo || "",
      active: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    } : {
      id: itemId,
      vendorId,
      name,
      category: "육류",
      storageType: row.storageType || "냉장",
      unit,
      currentQty: qty,
      minQty: 0,
      defaultOrderQty: qty,
      unitPrice,
      memo: row.memo || "",
      active: true,
      createdAt: nowIso,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    delete itemData.docId;
    batch.set(itemRef, itemData, { merge: true });
    const totalPrice = Number(row.totalPrice || Math.round(qty * unitPrice));
    purchaseItems.push({
      inventoryItemId: itemId,
      name,
      qty,
      unit,
      unitPrice,
      totalPrice,
    });
    const logId = `chatbot_${orderId}_${itemId}_${index}`;
    batch.set(storeDoc("stockLogs", logId), {
      id: logId,
      inventoryItemId: itemId,
      type: "in",
      qty,
      beforeQty,
      afterQty,
      memo: `챗봇 OCR 입고 / ${vendor.name}`,
      createdAt: nowIso,
      createdBy: chatUser.name,
      purchaseOrderId: orderId,
    });
  });

  const totalAmount = purchaseItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  batch.set(storeDoc("purchaseOrders", String(orderId)), {
    id: orderId,
    vendorId,
    vendorName: vendor.name || session.vendorName || "",
    status: "received",
    items: purchaseItems,
    totalAmount,
    memo: `챗봇 OCR ${session.mode === "purchase" ? "발주확인" : "재고확인"} 입고`,
    createdAt: nowIso,
    orderedAt: nowIso,
    receivedAt: nowIso,
    createdBy: chatUser.name,
    settlementStatus: "unsettled",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  await chatbotSessionRef(chatUser).delete();
  return textResponse(
    `재고에 반영했습니다.\n거래처: ${vendor.name}\n품목: ${purchaseItems.length}개\n입고금액: ${Math.round(totalAmount).toLocaleString()}원\n정산탭에 미정산 입고 건으로 잡혔습니다.`,
    ["재고확인", "발주확인", "오늘 현황"]
  );
}

async function processChatbotOcrJob(jobRef, job) {
  const chatUser = {
    id: String(job.chatUserId || "").trim(),
    name: job.chatUserName || "직원",
    role: job.chatUserRole || "staff",
    employeeId: Number(job.employeeId || 0),
  };
  const mode = job.mode === "purchase" ? "purchase" : "inventory";
  const imageUrl = String(job.imageUrl || "").trim();
  if (!chatUser.id || !imageUrl) {
    await jobRef.set({
      status: "failed",
      message: "챗봇 사용자 또는 이미지 URL이 없습니다.",
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  await jobRef.set({
    status: "processing",
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  try {
    const ocrText = await recognizeInventoryImage(imageUrl);
    const result = await saveInventoryOcrTextToSession({ chatUser, mode, imageUrl, ocrText });
    await jobRef.set({
      status: result.ok ? "completed" : "needs_retry",
      ok: result.ok,
      rowCount: parseInventoryOcrRows(ocrText).length,
      message: result.text.slice(0, 1000),
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "사진 OCR 처리에 실패했습니다.";
    console.error("chatbot OCR job failed", { jobId: job.id, message });
    await chatbotSessionRef(chatUser).set({
      type: "inventoryOcr",
      mode,
      status: "awaiting_image",
      imageUrl,
      lastError: message,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await jobRef.set({
      status: "failed",
      ok: false,
      message,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

async function handleInventoryOcrSession(body, chatUser) {
  const snap = await chatbotSessionRef(chatUser).get();
  if (!snap.exists) return null;
  const session = snap.data() || {};
  if (session.type !== "inventoryOcr") return null;
  const text = utteranceOf(body).trim();
  const isOcrStartText = /^(재고확인|발주확인)$/.test(text);
  const wantsCurrentOcr = isOcrStartText
    && session.status === "awaiting_image"
    && session.lastOcrText;
  const hasActiveOcrSession = ["processing", "awaiting_confirm"].includes(session.status) || wantsCurrentOcr;
  if (isOcrStartText && !hasActiveOcrSession) return null;
  if (/취소|중단|그만/i.test(text)) {
    await chatbotSessionRef(chatUser).delete();
    return textResponse("재고 OCR 작업을 취소했습니다.", ["오늘 현황"]);
  }
  const imageUrl = extractImageUrl(body);
  if (imageUrl) return queueInventoryOcrImage(body, chatUser, session.mode || "inventory");

  if (session.status === "processing") {
    return textResponse(
      "아직 OCR 처리 중입니다.\n잠시 뒤 '결과'를 다시 눌러주세요.",
      ["결과", "취소"]
    );
  }

  if (session.status === "awaiting_image") {
    if (session.lastError && (isInventoryOcrResultText(text) || wantsCurrentOcr)) {
      return textResponse(
        `사진을 읽지 못했습니다.\n${session.lastError}\n\n원본 사진으로 다시 처리하려면 아래 링크로 업로드해주세요.\n${chatbotUploadUrl(chatUser, session.mode || "inventory")}`,
        ["재고확인", "취소"]
      );
    }
    if (session.lastOcrText && (isInventoryOcrResultText(text) || wantsCurrentOcr)) {
      const result = await saveInventoryOcrTextToSession({
        chatUser,
        mode: session.mode || "inventory",
        imageUrl: session.imageUrl || "last-ocr",
        ocrText: session.lastOcrText,
      });
      return textResponse(result.text, result.ok ? ["확인", "거래처 목록", "취소"] : ["취소"]);
    }
    console.info("inventory OCR awaiting image without URL", {
      utterance: utteranceOf(body).slice(0, 200),
      actionName: body.action?.name ?? "",
      paramKeys: Object.keys(body.action?.params ?? {}),
      detailParamKeys: Object.keys(body.action?.detailParams ?? {}),
      requestParams: body.userRequest?.params ?? {},
    });
    return textResponse("사진을 올려주세요.\n거래명세서나 입고 내역이 보이면 됩니다.\n이미 보냈는데 답이 없으면 '결과'라고 보내주세요.", ["결과", "취소"]);
  }

  const vendorText = text.match(/^거래처\s+(.+)$/)?.[1] || paramOf(body, ["vendor", "거래처"]);
  if (/^거래처\s*목록$/.test(text)) {
    const vendors = await listVendors();
    const lines = vendors
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
      .slice(0, 12)
      .map((vendor) => `${vendor.id}. ${vendor.name} / ${vendor.businessNumber || "-"} / ${vendor.phone || "-"}`);
    return textResponse(`거래처 목록\n${lines.join("\n") || "-"}`, ["취소"]);
  }
  if (vendorText) {
    const vendor = detectVendorFromText(vendorText, await listVendors());
    if (!vendor) return textResponse("거래처를 찾지 못했습니다. 거래처명을 다시 입력해주세요.", ["거래처 목록", "취소"]);
    const next = {
      ...session,
      vendorId: Number(vendor.id),
      vendorName: vendor.name,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await chatbotSessionRef(chatUser).set(next, { merge: true });
    return textResponse(`거래처를 ${vendor.name}으로 지정했습니다.\n${inventoryOcrSummary(next)}\n\n맞으면 '확인'이라고 보내주세요.`, ["확인", "취소"]);
  }

  if (/^확인$|^저장$|^반영$/.test(text)) {
    const denied = requireOps(chatUser);
    return denied ? failResponse(denied) : applyInventoryOcrSession(session, chatUser);
  }

  return textResponse(`확인 대기 중입니다.\n${inventoryOcrSummary(session)}\n\n저장하려면 '확인', 취소하려면 '취소'라고 보내주세요.`, ["확인", "취소"]);
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

function setCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

async function adminFromRequest(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, message: "로그인이 필요합니다." };
  try {
    const token = await admin.auth().verifyIdToken(match[1]);
    const email = token.email || "";
    if (email === "iu431214@gmail.com" || email === "djmonnar4@gmail.com") {
      return { ok: true, uid: token.uid, email };
    }
    const snap = await db.doc(`users/${token.uid}`).get();
    const profile = snap.data() || {};
    if (profile.storeId === STORE_ID && profile.role === "admin" && profile.active !== false) {
      return { ok: true, uid: token.uid, email };
    }
    return { ok: false, message: "관리자 권한이 필요합니다." };
  } catch (error) {
    return { ok: false, message: "인증 토큰을 확인하지 못했습니다." };
  }
}

const NOTIFICATION_DEFAULTS = {
  reservationCreatedEnabled: true,
  reservationReminderEnabled: true,
  reservationReminderMinutes: 30,
  shiftStartEnabled: true,
  shiftStartMinutes: 30,
  shiftEndEnabled: true,
  shiftEndMinutes: 10,
};

const APP_BASE_URL = process.env.APP_BASE_URL || "https://sky-two-mu.vercel.app";
const PUSH_BATCH_SIZE = 500;
const SCHEDULE_WINDOW_MINUTES = 5;

function appUrl(path = "/") {
  return new URL(path, APP_BASE_URL).toString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function minutesOf(time) {
  const match = String(time || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function timeInWindow(time, targetMinute, windowMinutes = SCHEDULE_WINDOW_MINUTES) {
  const minute = minutesOf(time);
  if (minute === null || targetMinute === null) return false;
  const end = targetMinute + windowMinutes;
  if (end <= 24 * 60) return minute >= targetMinute && minute < end;
  return minute >= targetMinute || minute < (end % (24 * 60));
}

function pushTokenDocId(token) {
  return Buffer.from(String(token)).toString("base64url");
}

function notificationEventId(...parts) {
  return parts
    .map((part) => String(part ?? "").replace(/[^A-Za-z0-9_-]/g, "_"))
    .filter(Boolean)
    .join("_")
    .slice(0, 900);
}

function isActiveReservation(reservation) {
  const status = String(reservation.status || "");
  return !/취소|노쇼|cancel/i.test(status);
}

function isInvalidPushToken(errorCode) {
  return [
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
  ].includes(errorCode);
}

async function profileFromRequest(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, message: "로그인이 필요합니다." };
  try {
    const token = await admin.auth().verifyIdToken(match[1]);
    const snap = await db.doc(`users/${token.uid}`).get();
    const profile = snap.data() || {};
    const configuredAdmin = token.email === "iu431214@gmail.com" || token.email === "djmonnar4@gmail.com";
    if (profile.storeId === STORE_ID && profile.active !== false) {
      return {
        ok: true,
        uid: token.uid,
        email: token.email || "",
        role: profile.role || (configuredAdmin ? "admin" : "staff"),
        employeeId: Number(profile.employeeId ?? 0),
        name: profile.name || token.email || "사용자",
      };
    }
    if (configuredAdmin) {
      return {
        ok: true,
        uid: token.uid,
        email: token.email || "",
        role: "admin",
        employeeId: 0,
        name: token.email || "관리자",
      };
    }
    return { ok: false, message: "하늘땅 사용자 권한이 필요합니다." };
  } catch (error) {
    return { ok: false, message: "인증 토큰을 확인하지 못했습니다." };
  }
}

async function loadNotificationSettings() {
  const snap = await storeDoc("meta", "notificationSettings").get();
  return { ...NOTIFICATION_DEFAULTS, ...(snap.exists ? snap.data() : {}) };
}

async function enabledPushTokensFor({ targetRoles = [], targetEmployeeIds = [], targetUids = [] } = {}) {
  const snap = await storeCol("pushTokens").where("enabled", "==", true).get();
  const roleSet = new Set(targetRoles);
  const uidSet = new Set(targetUids);
  const employeeSet = new Set(targetEmployeeIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0));
  return snap.docs
    .map((doc) => ({ docId: doc.id, ...doc.data() }))
    .filter((item) => {
      if (!item.token) return false;
      if (uidSet.size > 0 && uidSet.has(item.uid)) return true;
      if (roleSet.size > 0 && roleSet.has(item.role)) return true;
      if (employeeSet.size > 0 && employeeSet.has(Number(item.employeeId))) return true;
      return uidSet.size === 0 && roleSet.size === 0 && employeeSet.size === 0;
    });
}

async function disableInvalidPushToken(token, errorCode) {
  const id = pushTokenDocId(token);
  await storeDoc("pushTokens", id).set({
    enabled: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  await storeDoc("invalidPushTokens", id).set({
    token,
    errorCode,
    lastFailureAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function sendNotificationEvent(eventId, payload) {
  const id = notificationEventId(eventId);
  const ref = storeDoc("notificationEvents", id);
  const existing = await ref.get();
  if (existing.exists && existing.data().notificationStatus === "sent") {
    return { ok: true, skipped: true, message: "already sent" };
  }

  await ref.set({
    id,
    type: payload.type || "general",
    sourceId: payload.sourceId || "",
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
    targetRoles: payload.targetRoles || [],
    targetEmployeeIds: payload.targetEmployeeIds || [],
    targetUids: payload.targetUids || [],
    notificationStatus: "sending",
    notificationAttempts: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(existing.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
  }, { merge: true });

  const tokenRows = await enabledPushTokensFor(payload);
  const tokens = [...new Set(tokenRows.map((row) => row.token).filter(Boolean))];
  if (tokens.length === 0) {
    await ref.set({
      notificationStatus: "skipped",
      sentCount: 0,
      failedCount: 0,
      message: "enabled token not found",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, skipped: true, message: "enabled token not found" };
  }

  let sentCount = 0;
  let failedCount = 0;
  const invalidTokens = [];
  for (let i = 0; i < tokens.length; i += PUSH_BATCH_SIZE) {
    const chunk = tokens.slice(i, i + PUSH_BATCH_SIZE);
    const response = await admin.messaging().sendEachForMulticast({
      tokens: chunk,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: {
        type: payload.type || "general",
        eventId: id,
        url: payload.url || "/",
      },
      webpush: {
        fcmOptions: {
          link: appUrl(payload.url || "/"),
        },
        notification: {
          tag: id,
          renotify: true,
        },
      },
    });
    sentCount += response.successCount;
    failedCount += response.failureCount;
    response.responses.forEach((result, index) => {
      const code = result.error?.code;
      if (code && isInvalidPushToken(code)) invalidTokens.push({ token: chunk[index], code });
    });
  }

  await Promise.all(invalidTokens.map((item) => disableInvalidPushToken(item.token, item.code)));
  await ref.set({
    notificationStatus: sentCount > 0 ? "sent" : "failed",
    sentCount,
    failedCount,
    invalidTokenCount: invalidTokens.length,
    notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: sentCount > 0, sentCount, failedCount, invalidTokenCount: invalidTokens.length };
}

function reservationPushBody(reservation) {
  const people = Number(reservation.people || 0);
  const seat = reservation.seat ? ` ${reservation.seat}` : "";
  return `${reservation.date || ""} ${reservation.time || ""} ${reservation.name || "예약"} ${people}명${seat}`.trim();
}

async function sendReservationCreatedPush(reservationId, reservation) {
  if (!isActiveReservation(reservation)) return;
  const settings = await loadNotificationSettings();
  if (settings.reservationCreatedEnabled === false) return;
  await sendNotificationEvent(`reservationCreated_${reservationId}`, {
    type: "reservation.created",
    sourceId: String(reservationId),
    title: "새 예약이 등록되었습니다",
    body: reservationPushBody(reservation),
    url: "/reservations",
    targetRoles: ["admin", "manager"],
  });
}

async function sendReservationReminders() {
  const settings = await loadNotificationSettings();
  if (settings.reservationReminderEnabled === false) return;
  const leadMinutes = Number(settings.reservationReminderMinutes ?? NOTIFICATION_DEFAULTS.reservationReminderMinutes);
  const target = addMinutes(new Date(), leadMinutes);
  const targetDate = formatDate(target);
  const targetMinute = minutesOf(formatTime(target));
  const snap = await storeCol("reservations").where("date", "==", targetDate).get();
  await Promise.all(snap.docs.map(async (doc) => {
    const reservation = { id: doc.id, ...doc.data() };
    if (!isActiveReservation(reservation)) return;
    if (!timeInWindow(reservation.time, targetMinute)) return;
    await sendNotificationEvent(`reservationReminder_${doc.id}_${targetDate}_${reservation.time}_${leadMinutes}`, {
      type: "reservation.reminder",
      sourceId: String(doc.id),
      title: `${leadMinutes}분 후 예약이 있습니다`,
      body: reservationPushBody(reservation),
      url: "/reservations",
      targetRoles: ["admin", "manager"],
    });
  }));
}

async function sendShiftReminder(kind, leadMinutes) {
  const target = addMinutes(new Date(), leadMinutes);
  const targetDate = formatDate(target);
  const targetMinute = minutesOf(formatTime(target));
  const field = kind === "start" ? "start" : "end";
  const snap = await storeCol("shifts").where("date", "==", targetDate).get();
  await Promise.all(snap.docs.map(async (doc) => {
    const shift = { id: doc.id, ...doc.data() };
    const employeeId = Number(shift.employeeId ?? shift.empId ?? 0);
    if (employeeId <= 0) return;
    if (!timeInWindow(shift[field], targetMinute)) return;
    const period = shift.period === "afternoon" ? "오후" : "오전";
    const dept = shift.department === "kitchen" ? "주방" : "홀";
    const title = kind === "start"
      ? `${leadMinutes}분 후 근무 시작입니다`
      : `${leadMinutes}분 후 퇴근 시간입니다`;
    const body = `${targetDate} ${period} ${dept} ${shift[field]} ${shift.employeeName || "근무자"}`;
    await sendNotificationEvent(`shift_${kind}_${doc.id}_${targetDate}_${shift[field]}_${leadMinutes}`, {
      type: kind === "start" ? "shift.start" : "shift.end",
      sourceId: String(doc.id),
      title,
      body,
      url: kind === "start" ? "/schedule" : "/worklog",
      targetEmployeeIds: [employeeId],
    });
  }));
}

async function sendShiftReminders() {
  const settings = await loadNotificationSettings();
  const tasks = [];
  if (settings.shiftStartEnabled !== false) {
    tasks.push(sendShiftReminder("start", Number(settings.shiftStartMinutes ?? NOTIFICATION_DEFAULTS.shiftStartMinutes)));
  }
  if (settings.shiftEndEnabled !== false) {
    tasks.push(sendShiftReminder("end", Number(settings.shiftEndMinutes ?? NOTIFICATION_DEFAULTS.shiftEndMinutes)));
  }
  await Promise.all(tasks);
}

function isoNow() {
  return new Date().toISOString();
}

function addHours(date, hours) {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

function dateFromTimestamp(value) {
  const raw = String(value || "");
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : formatDate();
}

function normalizePaymentMethod(raw) {
  const text = String(raw || "").toLowerCase();
  if (/card|카드|신용/.test(text)) return "card";
  if (/cash|현금/.test(text)) return "cash";
  if (/pay|페이|간편/.test(text)) return "simplePay";
  if (/voucher|상품권|쿠폰/.test(text)) return "voucher";
  return "other";
}

function normalizeOrderStatus(raw) {
  const text = String(raw || "").toLowerCase();
  if (/partial|부분/.test(text)) return "partialRefund";
  if (/refund|환불/.test(text)) return "refunded";
  if (/cancel|취소/.test(text)) return "canceled";
  if (/void|무효/.test(text)) return "voided";
  return "paid";
}

function normalizeOrderType(raw) {
  const text = String(raw || "").toLowerCase();
  if (/take|포장/.test(text)) return "takeout";
  if (/delivery|배달/.test(text)) return "delivery";
  if (/dine|hall|매장|홀/.test(text)) return "dineIn";
  return "other";
}

function numberOf(...values) {
  for (const value of values) {
    const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(n) && String(value ?? "").trim() !== "") return n;
  }
  return 0;
}

function normalizeOkposOrder(raw) {
  const orderId = String(raw.okposOrderId || raw.orderId || raw.saleNo || raw.billNo || raw.id || "").trim();
  if (!orderId) return null;
  const soldAt = String(raw.soldAt || raw.saleDateTime || raw.orderDateTime || raw.createdAt || isoNow());
  const rawItems = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.menus) ? raw.menus : [];
  const rawPayments = Array.isArray(raw.paymentMethods) ? raw.paymentMethods : Array.isArray(raw.payments) ? raw.payments : [];
  const items = rawItems.map((item, index) => ({
    id: String(item.id || item.menuId || item.code || `${orderId}-${index}`),
    name: String(item.name || item.menuName || item.itemName || "메뉴"),
    quantity: numberOf(item.quantity, item.qty, 1),
    unitPrice: numberOf(item.unitPrice, item.price),
    totalAmount: numberOf(item.totalAmount, item.amount, item.salesAmount),
    category: item.category || item.categoryName || "",
  }));
  const totalAmount = numberOf(raw.totalAmount, raw.grossAmount, raw.salesAmount);
  const discountAmount = numberOf(raw.discountAmount, raw.discount);
  const refundAmount = numberOf(raw.refundAmount, raw.cancelAmount);
  const paidAmount = numberOf(raw.paidAmount, raw.netAmount, totalAmount - discountAmount - refundAmount);
  const paymentMethods = rawPayments.length
    ? rawPayments.map((payment) => ({
        method: normalizePaymentMethod(payment.method || payment.type || payment.name),
        amount: numberOf(payment.amount, payment.paidAmount),
      }))
    : [{
        method: normalizePaymentMethod(raw.paymentMethod || raw.payMethod),
        amount: paidAmount,
      }];
  return {
    id: `okpos-${orderId}`,
    okposOrderId: orderId,
    businessDate: String(raw.businessDate || raw.saleDate || dateFromTimestamp(soldAt)).slice(0, 10),
    soldAt,
    status: normalizeOrderStatus(raw.status || raw.orderStatus || (raw.cancelYn === "Y" ? "cancel" : "")),
    totalAmount,
    discountAmount,
    paidAmount,
    refundAmount,
    paymentMethods,
    items,
    tableName: raw.tableName || raw.tableNo || raw.seatName || "",
    orderType: normalizeOrderType(raw.orderType || raw.channel || raw.serviceType),
    source: "okpos",
    syncedAt: isoNow(),
  };
}

async function fetchOkposOrders(rangeStart, rangeEnd) {
  const baseUrl = process.env.OKPOS_BASE_URL;
  const storeCode = process.env.OKPOS_STORE_CODE;
  const ordersPath = process.env.OKPOS_ORDERS_PATH;
  const apiKey = process.env.OKPOS_API_KEY;
  if (!baseUrl || !storeCode || !ordersPath) {
    return {
      status: "config_required",
      message: "OKPOS_BASE_URL, OKPOS_STORE_CODE, OKPOS_ORDERS_PATH 설정이 필요합니다.",
      orders: [],
    };
  }
  const url = new URL(ordersPath, baseUrl);
  url.searchParams.set("storeCode", storeCode);
  url.searchParams.set("from", rangeStart);
  url.searchParams.set("to", rangeEnd);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`OK포스 API 오류: ${response.status}`);
  }
  const payload = await response.json();
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.orders)
      ? payload.orders
      : Array.isArray(payload.data)
        ? payload.data
        : [];
  return {
    status: "success",
    message: `OK포스 주문 ${list.length}건을 가져왔습니다.`,
    orders: list.map(normalizeOkposOrder).filter(Boolean),
  };
}

function hasOkposConfig() {
  return !!(process.env.OKPOS_BASE_URL && process.env.OKPOS_STORE_CODE && process.env.OKPOS_ORDERS_PATH);
}

async function rebuildSalesDailySummary(businessDate) {
  const snap = await storeCol("salesOrders").where("businessDate", "==", businessDate).get();
  const orders = snap.docs.map((doc) => doc.data());
  const active = orders.filter((order) => order.status === "paid" || order.status === "partialRefund");
  const netAmount = active.reduce((sum, order) => sum + Math.max(0, Number(order.paidAmount || 0) - Number(order.refundAmount || 0)), 0);
  const paymentMap = new Map();
  active.forEach((order) => {
    (order.paymentMethods || []).forEach((payment) => {
      const method = normalizePaymentMethod(payment.method);
      paymentMap.set(method, (paymentMap.get(method) || 0) + Number(payment.amount || 0));
    });
  });
  await storeDoc("salesDailySummaries", businessDate).set({
    id: businessDate,
    businessDate,
    orderCount: active.length,
    canceledCount: orders.length - active.length,
    grossAmount: orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0),
    discountAmount: orders.reduce((sum, order) => sum + Number(order.discountAmount || 0), 0),
    refundAmount: orders.reduce((sum, order) => sum + Number(order.refundAmount || 0), 0),
    netAmount,
    averageOrderAmount: active.length ? Math.round(netAmount / active.length) : 0,
    paymentTotals: [...paymentMap.entries()].map(([method, amount]) => ({ method, amount })),
    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function syncOkposSalesCore(mode = "scheduled", requestedBy = "system") {
  const now = new Date();
  const rangeStart = addHours(now, -24).toISOString();
  const rangeEnd = now.toISOString();
  const runId = `${Date.now()}-${mode}`;
  const runRef = storeDoc("salesSyncRuns", runId);
  await runRef.set({
    id: runId,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: "skipped",
    importedCount: 0,
    updatedCount: 0,
    rangeStart,
    rangeEnd,
    requestedBy,
    mode,
  });

  try {
    const result = await fetchOkposOrders(rangeStart, rangeEnd);
    if (result.status === "config_required") {
      await runRef.set({
        status: "config_required",
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        message: result.message,
      }, { merge: true });
      return { ok: false, runId, message: result.message };
    }

    let updatedCount = 0;
    const dates = new Set();
    for (const order of result.orders) {
      const ref = storeDoc("salesOrders", order.id);
      const exists = (await ref.get()).exists;
      if (exists) updatedCount += 1;
      dates.add(order.businessDate);
      await ref.set({
        ...order,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
      }, { merge: true });
    }
    for (const businessDate of dates) {
      await rebuildSalesDailySummary(businessDate);
    }
    await runRef.set({
      status: "success",
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      importedCount: result.orders.length - updatedCount,
      updatedCount,
      message: result.message,
    }, { merge: true });
    return { ok: true, runId, message: result.message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OK포스 매출 동기화에 실패했습니다.";
    await runRef.set({
      status: "failed",
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      message,
    }, { merge: true });
    return { ok: false, runId, message };
  }
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
    case "inventory.ocr.start": return handleInventoryOcrStart(body, chatUser, "inventory");
    case "purchase.ocr.start": return handleInventoryOcrStart(body, chatUser, "purchase");
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
        "예: 공지 등록 오늘 단체 예약 세팅 확인",
        "예: 전달사항 등록 주방 재료 입고 확인",
        "급여 요약 / 비밀번호 입력",
        "재고확인 / 발주확인: 사진 OCR 후 확인하면 재고와 정산에 반영",
        "거래처 목록 / 거래처 등록 / 거래처 수정 / 거래처 삭제",
        "레시피 목록 / 레시피 등록 / 레시피 수정 / 레시피 삭제",
      ].join("\n"), ["오늘 현황", "오늘 예약", "오늘 근무표"]);
  }
}

exports.kakaoSkill = onRequest({ timeoutSeconds: 120, memory: "1GiB" }, async (req, res) => {
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

    const sessionResponse = await handleInventoryOcrSession(body, chatUser);
    if (sessionResponse) {
      res.status(200).json(sessionResponse);
      return;
    }

    const directImageUrl = extractImageUrl(body);
    if (directImageUrl) {
      const mode = /발주/i.test(fullText(body)) ? "purchase" : "inventory";
      res.status(200).json(await queueInventoryOcrImage(body, chatUser, mode));
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

exports.chatbotInventoryUpload = onRequest({ timeoutSeconds: 120, memory: "1GiB" }, async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const key = String(req.query.key || req.body?.key || "").trim();
  const mode = String(req.query.mode || req.body?.mode || "inventory").trim() === "purchase" ? "purchase" : "inventory";
  const chatUser = await getChatUser(key);
  if (!chatUser) {
    const message = "챗봇 사용 권한이 없거나 세션이 만료되었습니다. 카톡에서 재고확인을 다시 입력해주세요.";
    if (req.method === "GET") {
      res.status(403).send(htmlPage(`<h1>권한 확인 필요</h1><p>${message}</p>`));
    } else {
      res.status(403).json({ ok: false, message });
    }
    return;
  }

  if (req.method === "GET") {
    const safeKey = JSON.stringify(key);
    const safeMode = JSON.stringify(mode);
    res.status(200).send(htmlPage(`
      <h1>${mode === "purchase" ? "발주확인" : "재고확인"} 사진 업로드</h1>
      <p>거래명세서나 입고 사진을 올려주세요. 처리 후 카톡으로 돌아가 <b>확인</b>이라고 보내면 실제 재고에 반영됩니다.</p>
      <input id="file" type="file" accept="image/*" capture="environment" />
      <button id="submit">사진 OCR 읽기</button>
      <p class="small">사진은 OCR 처리용으로만 사용되며, 결과는 챗봇 확인 세션에 저장됩니다.</p>
      <pre id="result">사진을 선택해주세요.</pre>
      <script>
        const key = ${safeKey};
        const mode = ${safeMode};
        const fileInput = document.getElementById("file");
        const button = document.getElementById("submit");
        const result = document.getElementById("result");
        function readCompressed(file) {
          return new Promise((resolve, reject) => {
            const image = new Image();
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => { image.src = reader.result; };
            image.onerror = reject;
            image.onload = () => {
              const max = 1800;
              const scale = Math.min(1, max / Math.max(image.width, image.height));
              const canvas = document.createElement("canvas");
              canvas.width = Math.max(1, Math.round(image.width * scale));
              canvas.height = Math.max(1, Math.round(image.height * scale));
              canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
              canvas.toBlob((blob) => {
                const out = new FileReader();
                out.onerror = reject;
                out.onload = () => resolve(out.result);
                out.readAsDataURL(blob);
              }, "image/jpeg", 0.82);
            };
            reader.readAsDataURL(file);
          });
        }
        button.addEventListener("click", async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) {
            result.textContent = "사진을 먼저 선택해주세요.";
            return;
          }
          button.disabled = true;
          result.textContent = "사진을 읽고 있습니다. 잠시만 기다려주세요.";
          try {
            const imageData = await readCompressed(file);
            const response = await fetch(location.href, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key, mode, imageData }),
            });
            const data = await response.json();
            result.textContent = data.message || "처리했습니다. 카톡으로 돌아가 확인이라고 보내주세요.";
          } catch (error) {
            result.textContent = "처리하지 못했습니다. 사진을 더 선명하게 다시 올려주세요.";
          } finally {
            button.disabled = false;
          }
        });
      </script>
    `));
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "GET 또는 POST 요청만 사용할 수 있습니다." });
    return;
  }

  try {
    const body = req.body && typeof req.body === "object"
      ? req.body
      : JSON.parse(req.rawBody?.toString("utf8") || "{}");
    const imageData = String(body.imageData || "");
    const match = imageData.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
    if (!match) {
      res.status(400).json({ ok: false, message: "이미지 데이터를 찾지 못했습니다." });
      return;
    }
    const buffer = Buffer.from(match[1], "base64");
    if (buffer.length > 8 * 1024 * 1024) {
      res.status(413).json({ ok: false, message: "이미지는 8MB 이하로 올려주세요." });
      return;
    }
    const debugOcr = String(req.query.debugOcr || "") === "1" && chatUser.role === "admin";
    const ocrText = await recognizeInventoryBuffer(buffer);
    const result = await saveInventoryOcrTextToSession({ chatUser, mode, imageUrl: "browser-upload", ocrText });
    res.status(200).json({
      ok: result.ok,
      message: `${result.text}\n\n카톡으로 돌아가 ${result.ok ? "'확인'" : "'재고확인'"}이라고 보내주세요.`,
      ...(debugOcr ? { ocrText: ocrText.slice(0, 6000) } : {}),
    });
  } catch (error) {
    console.error("chatbotInventoryUpload failed", error);
    res.status(200).json({ ok: false, message: "사진을 읽지 못했습니다. 더 선명하게 다시 촬영해주세요." });
  }
});

exports.processChatbotOcrJob = onDocumentCreated(
  { document: "stores/{storeId}/chatbotOcrJobs/{jobId}", timeoutSeconds: 120, memory: "1GiB" },
  async (event) => {
    if (event.params.storeId !== STORE_ID || !event.data) return;
    await processChatbotOcrJob(event.data.ref, { id: event.params.jobId, ...(event.data.data() || {}) });
  }
);

exports.sendTestPush = onRequest({ timeoutSeconds: 30, memory: "256MiB" }, async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "POST 요청만 사용할 수 있습니다." });
    return;
  }
  const auth = await profileFromRequest(req);
  if (!auth.ok) {
    res.status(403).json({ ok: false, message: auth.message });
    return;
  }
  const tokens = await enabledPushTokensFor({ targetUids: [auth.uid] });
  if (tokens.length === 0) {
    res.status(404).json({ ok: false, message: "이 계정에 켜진 푸시 기기가 없습니다. 먼저 푸시 켜기를 눌러주세요." });
    return;
  }
  const result = await sendNotificationEvent(`test_${auth.uid}_${Date.now()}`, {
    type: "test",
    sourceId: auth.uid,
    title: "하늘땅 테스트 알림",
    body: `${auth.name}님, 이 기기에서 푸시 알림이 켜졌어요.`,
    url: "/",
    targetUids: [auth.uid],
  });
  res.status(result.ok ? 200 : 500).json({
    ok: result.ok,
    message: result.ok ? "테스트 푸시를 보냈습니다." : "테스트 푸시 발송에 실패했습니다.",
    ...result,
  });
});

exports.onReservationCreatedPush = onDocumentCreated(
  { document: "stores/{storeId}/reservations/{reservationId}", timeoutSeconds: 30, memory: "256MiB" },
  async (event) => {
    if (event.params.storeId !== STORE_ID || !event.data) return;
    await sendReservationCreatedPush(event.params.reservationId, event.data.data() || {});
  }
);

exports.reservationReminderPushScheduled = onSchedule(
  { schedule: "every 5 minutes", timeZone: TZ, timeoutSeconds: 60, memory: "256MiB" },
  async () => {
    await sendReservationReminders();
  }
);

exports.shiftReminderPushScheduled = onSchedule(
  { schedule: "every 5 minutes", timeZone: TZ, timeoutSeconds: 60, memory: "256MiB" },
  async () => {
    await sendShiftReminders();
  }
);

exports.syncOkposSales = onRequest({ timeoutSeconds: 60, memory: "256MiB" }, async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "POST 요청만 사용할 수 있습니다." });
    return;
  }
  const auth = await adminFromRequest(req);
  if (!auth.ok) {
    res.status(403).json({ ok: false, message: auth.message });
    return;
  }
  const result = await syncOkposSalesCore("manual", auth.uid || auth.email || "admin");
  res.status(result.ok ? 200 : 409).json(result);
});

exports.syncOkposSalesScheduled = onSchedule(
  { schedule: "every 10 minutes", timeZone: TZ, timeoutSeconds: 60, memory: "256MiB" },
  async () => {
    if (!hasOkposConfig()) return;
    await syncOkposSalesCore("scheduled", "scheduler");
  }
);
