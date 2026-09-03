/* ============================================================
   POS 매출 집계 유틸 (순수 함수 — 화면·환경에 의존하지 않음)

   네이버 플레이스플러스는 **일 합계 하나만** 준다. 그래서 여기서 다루는
   최소 단위는 날짜이고, 주·월은 그 날짜들을 묶은 것이다.
   모든 날짜는 "YYYY-MM-DD" 문자열, 주는 월요일 시작.
   ============================================================ */

import type { SalesDailySummary } from "../data/types";

export type PosView = "day" | "week" | "month";

export interface DateRange {
  start: string;
  end: string;
}

/* ---------- 날짜 산술 ---------- */

export function toDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(key: string, days: number): string {
  const date = toDate(key);
  date.setDate(date.getDate() + days);
  return toKey(date);
}

/** 월=0 … 일=6 */
export function dowMon(key: string): number {
  return (toDate(key).getDay() + 6) % 7;
}

export function startOfWeek(key: string): string {
  return addDays(key, -dowMon(key));
}

export function endOfWeek(key: string): string {
  return addDays(startOfWeek(key), 6);
}

export function monthKey(key: string): string {
  return key.slice(0, 7);
}

export function startOfMonth(key: string): string {
  return `${monthKey(key)}-01`;
}

export function endOfMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return toKey(new Date(y, m, 0));
}

/** "2026-09" 에 n개월 더한 "YYYY-MM" */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const date = new Date(y, m - 1 + n, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** 양 끝 포함 일수 */
export function daysBetween(start: string, end: string): number {
  const ms = toDate(end).getTime() - toDate(start).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** 두 날짜를 앞뒤 순서 맞춰 범위로 */
export function clampRange(a: string, b: string): DateRange {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

export function eachDay(range: DateRange): string[] {
  const count = Math.max(0, daysBetween(range.start, range.end));
  return Array.from({ length: count }, (_, i) => addDays(range.start, i));
}

/* ---------- 금액 표기 ---------- */

/** 4,289,200 → "429만", 128,000,000 → "1.3억", 8,500 → "8,500" */
export function compactWon(value: number): string {
  const n = Math.round(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 100_000_000) {
    const eok = abs / 100_000_000;
    const text = eok >= 10 ? Math.round(eok).toString() : eok.toFixed(1).replace(/\.0$/, "");
    return `${sign}${text}억`;
  }
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString("ko-KR")}만`;
  return `${sign}${abs.toLocaleString("ko-KR")}`;
}

export function fullWon(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

/**
 * 축 눈금용 — 값보다 크거나 같은 "깔끔한" 수.
 * 단계를 촘촘히 두어(1·1.2·1.5·2·2.5·3·4·5·6·8·10 × 10^k) 막대가 차트의 절반만 채우고 끝나지 않게 한다.
 */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

/* ---------- 집계 ---------- */

export type DailyIndex = Map<string, SalesDailySummary>;

export function indexByDate(rows: SalesDailySummary[]): DailyIndex {
  const index: DailyIndex = new Map();
  rows.forEach((row) => {
    if (row.businessDate) index.set(row.businessDate, row);
  });
  return index;
}

export interface RangeStats {
  total: number;
  /** 데이터가 있는 날 수 */
  dataDays: number;
  /** 오늘까지 지난 일수 — 아직 오지 않은 날은 세지 않는다 */
  totalDays: number;
  /** 범위 안에서 아직 오지 않은 날 수 */
  futureDays: number;
  /** 데이터 있는 날 기준 평균 */
  average: number;
  best: { date: string; amount: number } | null;
  /** 지난 일수와 같은 길이의 직전 기간 (이번 달 12일째면 지난달 마지막 12일과 비교) */
  previous: { start: string; end: string; total: number; dataDays: number };
}

function sumRange(index: DailyIndex, range: DateRange) {
  let total = 0;
  let dataDays = 0;
  let best: RangeStats["best"] = null;
  eachDay(range).forEach((date) => {
    const row = index.get(date);
    if (!row) return;
    total += row.netAmount;
    dataDays += 1;
    if (!best || row.netAmount > best.amount) best = { date, amount: row.netAmount };
  });
  return { total, dataDays, best };
}

export function rangeStats(index: DailyIndex, range: DateRange, today: string): RangeStats {
  const spanDays = Math.max(0, daysBetween(range.start, range.end));
  // "이번 달"을 12일에 보면 12일치만 지났다 — 한 달 전체와 비교하면 무조건 떨어져 보인다.
  const elapsedEnd = range.end < today ? range.end : today;
  const totalDays = elapsedEnd < range.start ? 0 : daysBetween(range.start, elapsedEnd);
  const futureDays = spanDays - totalDays;
  const current = sumRange(index, range);
  const prevEnd = addDays(range.start, -1);
  const prevStart = addDays(prevEnd, -(Math.max(1, totalDays) - 1));
  const prev = totalDays > 0
    ? sumRange(index, { start: prevStart, end: prevEnd })
    : { total: 0, dataDays: 0 };
  return {
    total: current.total,
    dataDays: current.dataDays,
    totalDays,
    futureDays,
    average: current.dataDays ? Math.round(current.total / current.dataDays) : 0,
    best: current.best,
    previous: { start: prevStart, end: prevEnd, total: prev.total, dataDays: prev.dataDays },
  };
}

export interface Bucket {
  key: string;
  label: string;
  start: string;
  end: string;
  total: number;
  dataDays: number;
}

/** anchor 가 속한 주까지, 오래된 순으로 count 개 */
export function weeklyBuckets(index: DailyIndex, anchor: string, count = 12): Bucket[] {
  const lastStart = startOfWeek(anchor);
  return Array.from({ length: count }, (_, i) => {
    const start = addDays(lastStart, -(count - 1 - i) * 7);
    const end = addDays(start, 6);
    const sum = sumRange(index, { start, end });
    const [, m, d] = start.split("-").map(Number);
    return { key: start, label: `${m}.${d}`, start, end, total: sum.total, dataDays: sum.dataDays };
  });
}

/** anchor 가 속한 달까지, 오래된 순으로 count 개 */
export function monthlyBuckets(index: DailyIndex, anchor: string, count = 12): Bucket[] {
  const last = monthKey(anchor);
  return Array.from({ length: count }, (_, i) => {
    const ym = shiftMonth(last, -(count - 1 - i));
    const start = `${ym}-01`;
    const end = endOfMonth(start);
    const sum = sumRange(index, { start, end });
    const [, m] = ym.split("-").map(Number);
    return { key: ym, label: `${m}월`, start, end, total: sum.total, dataDays: sum.dataDays };
  });
}

/* ---------- 달력 ---------- */

export interface CalendarCell {
  date: string;
  day: number;
  inMonth: boolean;
}

/** 월요일 시작, 앞뒤 달 날짜로 채운 7×N 격자 */
export function calendarCells(ym: string): CalendarCell[] {
  const first = `${ym}-01`;
  const last = endOfMonth(first);
  const lead = dowMon(first);
  const daysInMonth = Number(last.slice(8, 10));
  const rows = Math.ceil((lead + daysInMonth) / 7);
  const gridStart = addDays(first, -lead);
  return Array.from({ length: rows * 7 }, (_, i) => {
    const date = addDays(gridStart, i);
    return { date, day: Number(date.slice(8, 10)), inMonth: monthKey(date) === ym };
  });
}

/**
 * 셀 농도 0(데이터 없음) ~ 5(그 달 최대). 한 색을 연하게→진하게 (단일 색 순차 램프).
 * 0원이 아니라 **그 달의 최소~최대** 사이를 다섯 단계로 나눈다 — 식당 매출은 0 근처로
 * 내려가는 일이 없어서, 0 기준으로 하면 모든 날이 비슷하게 어둡게만 보인다.
 */
export function intensityLevel(amount: number | null | undefined, min: number, max: number): number {
  if (amount === null || amount === undefined) return 0;
  if (!(max > min)) return 3;
  const ratio = (amount - min) / (max - min);
  return Math.min(5, Math.max(1, 1 + Math.floor(ratio * 5)));
}

/* ---------- 기간 프리셋 ---------- */

export type PresetKey =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "last7"
  | "last30";

export const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "today", label: "오늘" },
  { key: "yesterday", label: "어제" },
  { key: "thisWeek", label: "이번 주" },
  { key: "lastWeek", label: "지난 주" },
  { key: "thisMonth", label: "이번 달" },
  { key: "lastMonth", label: "지난 달" },
  { key: "last7", label: "최근 7일" },
  { key: "last30", label: "최근 30일" },
];

export function presetRange(key: PresetKey, today: string): DateRange {
  switch (key) {
    case "today": return { start: today, end: today };
    case "yesterday": { const d = addDays(today, -1); return { start: d, end: d }; }
    case "thisWeek": return { start: startOfWeek(today), end: endOfWeek(today) };
    case "lastWeek": { const end = addDays(startOfWeek(today), -1); return { start: addDays(end, -6), end }; }
    case "thisMonth": return { start: startOfMonth(today), end: endOfMonth(today) };
    case "lastMonth": { const end = addDays(startOfMonth(today), -1); return { start: startOfMonth(end), end }; }
    case "last7": return { start: addDays(today, -6), end: today };
    case "last30": return { start: addDays(today, -29), end: today };
  }
}

/** 지금 선택된 범위가 어느 프리셋과 같은지 (칩 강조용) */
export function matchPreset(range: DateRange, today: string): PresetKey | null {
  return PRESETS.find(({ key }) => {
    const preset = presetRange(key, today);
    return preset.start === range.start && preset.end === range.end;
  })?.key ?? null;
}

/* ---------- 라벨 ---------- */

const DOW = ["월", "화", "수", "목", "금", "토", "일"];

/** "2026-09-03" → "9월 3일 (목)" */
export function dateLabel(key: string, withDow = true): string {
  const [, m, d] = key.split("-").map(Number);
  return withDow ? `${m}월 ${d}일 (${DOW[dowMon(key)]})` : `${m}월 ${d}일`;
}

/** 범위를 사람이 읽는 말로 */
export function rangeLabel(range: DateRange): string {
  if (range.start === range.end) return dateLabel(range.start);
  if (range.start === startOfMonth(range.start) && range.end === endOfMonth(range.start)) {
    const [y, m] = range.start.split("-").map(Number);
    return `${y}년 ${m}월`;
  }
  const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4);
  const startText = sameYear ? dateLabel(range.start, false) : range.start;
  const endText = sameYear ? dateLabel(range.end, false) : range.end;
  return `${startText} ~ ${endText}`;
}

export function monthTitle(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}년 ${m}월`;
}
