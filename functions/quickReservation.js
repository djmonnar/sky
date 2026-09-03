"use strict";

/**
 * 카카오 채널에 아래처럼만 적어도 예약이 잡히게 하는 파서.
 *
 *   9-3 6시 3명 박현제 45184312
 *   9/5 18시  3명  박현제 45184312
 *   9월 5일 오후 6시 3명 박현제 45184312
 *   9/5 박현제 취소
 *
 * 규칙
 * - 날짜: 9-3 · 9/5 · 9월 5일 · 2026-09-05 · 오늘/내일/모레
 * - 시간: 6시 · 18시 · 오후 6시 · 6시반 · 6시 30분 · 18:00
 *   오전/오후가 없고 1~9시면 저녁으로 본다 — 식당에 아침 6시 예약은 없다.
 * - 인원: 3명 · 3인 · 3분
 * - 전화: 010 빼고 8자리(45184312)도 되고, 하이픈이 있어도 없어도 된다. 안 적으면 빈칸.
 * - 이름: 남는 한글 2~4글자. 창가·룸 같은 자리 말은 이름으로 보지 않는다.
 * - 취소·캔슬·삭제 가 있으면 취소
 */

const DATE_RE = /(오늘|내일|모레|어제|\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일?|\b\d{1,2}[./-]\d{1,2}\b)/;
// 분은 "반", "N분", ":MM" 로만 읽는다 — "18시 3명"의 3을 3분으로 읽지 않기 위해
const TIME_RE = /(오전|오후|저녁|아침|낮|밤|점심)?\s*(\d{1,2})\s*(?:시\s*(?:(반)|(\d{1,2})\s*분)?|:(\d{2}))/;
const PEOPLE_RE = /(\d{1,3})\s*(?:명|인|분)(?![가-힣])/;
const CANCEL_RE = /취소|캔슬|삭제/;
const STRIP_RE = /예약|등록|추가|취소|캔슬|삭제|잡아줘|잡아|잡|해주세요|해줘|부탁드려요|부탁|드려요|님|씨/g;
const SEAT_RE = /창가|룸|홀|테라스|단체|안쪽|바깥|입구|자리|석$/;
const SKIP_WORDS = new Set([
  "오전", "오후", "저녁", "아침", "낮", "밤", "점심", "시", "반", "명", "인", "분",
  "보여줘", "알려줘", "보여주세요", "알려주세요", "확인", "현황", "목록", "조회",
]);

/** "45184312" → "010-4518-4312", "010-1234-5678" → 그대로 정리. 전화가 아니면 "" */
function normalizePhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  let full = "";
  if (digits.length === 8) full = `010${digits}`;
  else if (digits.length === 10 && digits.startsWith("10")) full = `0${digits}`;
  else if (digits.length === 11 && /^01[016789]/.test(digits)) full = digits;
  if (!full) return "";
  return `${full.slice(0, 3)}-${full.slice(3, 7)}-${full.slice(7)}`;
}

function isPhoneToken(token) {
  return /^[\d\-.\s]+$/.test(token) && normalizePhone(token) !== "";
}

function inferHour(hour, periodWord) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const word = periodWord || "";
  if (/오전|아침/.test(word)) return hour === 12 ? 0 : hour;
  if (/오후|저녁|밤/.test(word)) return hour < 12 ? hour + 12 : hour;
  if (/낮|점심/.test(word)) return hour <= 5 ? hour + 12 : hour;
  // 아무 말 없이 1~9시면 저녁이다. 10·11·12시는 그대로.
  if (hour >= 1 && hour <= 9) return hour + 12;
  return hour;
}

function parseTimeToken(text) {
  const match = text.match(TIME_RE);
  if (!match) return { time: "", rest: text };
  const [, periodWord, hourRaw, half, minuteRaw, colonMinute] = match;
  const hour = inferHour(Number(hourRaw), periodWord);
  if (hour === null) return { time: "", rest: text };
  const minute = half ? 30 : Number(minuteRaw ?? colonMinute ?? 0);
  if (minute > 59) return { time: "", rest: text };
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { time, rest: text.replace(match[0], " ") };
}

function parseQuickReservation(raw) {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  const result = {
    ok: false,
    cancel: CANCEL_RE.test(text),
    dateInput: "",
    time: "",
    people: 0,
    name: "",
    phone: "",
    seat: "",
  };
  if (!text) return result;

  let rest = text;

  const dateMatch = rest.match(DATE_RE);
  if (dateMatch) {
    result.dateInput = dateMatch[0].trim();
    rest = rest.replace(dateMatch[0], " ");
  }

  const timed = parseTimeToken(rest);
  result.time = timed.time;
  rest = timed.rest;

  const peopleMatch = rest.match(PEOPLE_RE);
  if (peopleMatch) {
    result.people = Number(peopleMatch[1]);
    rest = rest.replace(peopleMatch[0], " ");
  }

  const seats = [];
  rest.split(/\s+/).filter(Boolean).forEach((token) => {
    if (!result.phone && isPhoneToken(token)) {
      result.phone = normalizePhone(token);
      return;
    }
    const word = token.replace(STRIP_RE, "").trim();
    if (!word || SKIP_WORDS.has(word)) return;
    if (SEAT_RE.test(word)) {
      seats.push(word);
      return;
    }
    if (!result.name && /^[가-힣]{2,4}$/.test(word)) {
      result.name = word;
      return;
    }
    if (/^[가-힣]{2,}$/.test(word)) seats.push(word);
  });
  result.seat = seats.join(" ");

  result.ok = Boolean(result.dateInput && result.name && (result.cancel || result.time || result.people));
  return result;
}

module.exports = { parseQuickReservation, normalizePhone, inferHour };
