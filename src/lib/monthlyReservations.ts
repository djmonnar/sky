import type { Reservation } from "../data/types";
import { isNaverReservation, naverDuplicateFlags } from "./naverReservations";
import { MORNING_CUTOFF } from "./scheduleLoad";

/* ============================================================
   한 달 예약 집계 — 월마감 때 「10월 예약 몇 건, 몇 명」을 직접 뽑게 (2026-11-02 사장님 요청)

   - **예약일 기준**이다(언제 등록했는지가 아니라 언제 오는 예약인지). 월마감은 그 달 손님을 센다.
   - 「취소」 상태로 남은 예약은 숫자에 넣지 않고 따로 적는다. 네이버가 취소한 예약과 직원이 지운 예약은
     문서가 없어서 셀 수 없다 — 화면에 그렇게 적는다.
   - 노쇼는 등록된 예약이라 합계에 넣고, 따로도 보인다.
   - 점심·저녁은 15:00 로 가른다 — 근무표 오전 칸이 15:00 에 끝나는 것과 같은 경계(scheduleLoad.ts).
   - 네이버 예약과 손으로 적은 예약이 같은 손님일 수 있으면(예약 화면 「중복 확인 필요」와 같은 규칙)
     그 수를 따로 알린다. 확인하면 합계가 줄 수 있다.
   - 내보내는 표에는 이름·전화번호를 넣지 않는다 — 날짜별 숫자만.
   ============================================================ */

export interface Tally {
  teams: number;
  people: number;
}

export interface MonthDay {
  date: string;
  total: Tally;
  lunch: Tally;
  dinner: Tally;
  naver: Tally;
  manual: Tally;
  noShow: Tally;
}

export interface MonthlyReservationSummary {
  /** YYYY-MM */
  month: string;
  /** 취소를 뺀 등록 예약 전부(노쇼 포함) */
  total: Tally;
  /** 「취소」 상태로 남은 예약 — total 에 안 넣었다 */
  canceled: Tally;
  noShow: Tally;
  lunch: Tally;
  dinner: Tally;
  naver: Tally;
  manual: Tally;
  /** 상태별(취소 빼고), 많은 순 */
  byStatus: Array<{ status: string; tally: Tally }>;
  /** 같은 손님일지 모르는 네이버 예약(그 네이버 예약 쪽 숫자) */
  duplicateSuspects: Tally;
  /** 그 달 모든 날(예약 없는 날도 0) */
  days: MonthDay[];
  /** 인원이 가장 많았던 날. 예약이 하나도 없으면 null */
  busiest: MonthDay | null;
}

const zero = (): Tally => ({ teams: 0, people: 0 });

function add(t: Tally, people: number) {
  t.teams += 1;
  t.people += people;
}

function peopleOf(r: Reservation): number {
  return Math.max(0, Number(r.people) || 0);
}

/** 그 달의 날짜 YYYY-MM-DD 전부 */
export function datesOfMonth(month: string): string[] {
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon) return [];
  const last = new Date(year, mon, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** «2026-10» 에서 앞뒤 달 */
export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const d = new Date(year, mon - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 달 초(10일까지)에 열면 지난달 — 월마감은 지난달을 센다. 그 뒤엔 이번 달. */
export function defaultSummaryMonth(today: string): string {
  const month = today.slice(0, 7);
  return Number(today.slice(8, 10)) <= 10 ? shiftMonth(month, -1) : month;
}

export function monthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return `${year}년 ${mon}월`;
}

export function summarizeMonth(reservations: Reservation[], month: string): MonthlyReservationSummary {
  const dates = datesOfMonth(month);
  const days = new Map<string, MonthDay>(dates.map((date) => [date, {
    date, total: zero(), lunch: zero(), dinner: zero(), naver: zero(), manual: zero(), noShow: zero(),
  }]));
  const summary: MonthlyReservationSummary = {
    month,
    total: zero(), canceled: zero(), noShow: zero(), lunch: zero(), dinner: zero(), naver: zero(), manual: zero(),
    byStatus: [], duplicateSuspects: zero(), days: [], busiest: null,
  };
  const statuses = new Map<string, Tally>();
  const byDate = new Map<string, Reservation[]>();

  for (const r of reservations) {
    const day = days.get(r.date);
    if (!day) continue;
    const people = peopleOf(r);
    if (r.status === "취소") {
      add(summary.canceled, people);
      continue;
    }
    byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
    const lunch = String(r.time ?? "") < MORNING_CUTOFF;
    const naver = isNaverReservation(r);
    for (const t of [summary.total, day.total]) add(t, people);
    for (const t of lunch ? [summary.lunch, day.lunch] : [summary.dinner, day.dinner]) add(t, people);
    for (const t of naver ? [summary.naver, day.naver] : [summary.manual, day.manual]) add(t, people);
    if (r.status === "노쇼") for (const t of [summary.noShow, day.noShow]) add(t, people);
    const status = r.status || "상태 없음";
    if (!statuses.has(status)) statuses.set(status, zero());
    add(statuses.get(status)!, people);
  }

  for (const dayReservations of byDate.values()) {
    const flags = naverDuplicateFlags(dayReservations);
    for (const r of dayReservations) if (flags.byNaver.has(r.id)) add(summary.duplicateSuspects, peopleOf(r));
  }

  summary.byStatus = [...statuses.entries()]
    .map(([status, tally]) => ({ status, tally }))
    .sort((a, b) => b.tally.teams - a.tally.teams || b.tally.people - a.tally.people);
  summary.days = [...days.values()];
  summary.busiest = summary.days.reduce<MonthDay | null>(
    (best, day) => (day.total.people > 0 && (!best || day.total.people > best.total.people) ? day : best),
    null,
  );
  return summary;
}

const num = new Intl.NumberFormat("ko-KR");

export function tallyText(t: Tally): string {
  return `${num.format(t.teams)}건 ${num.format(t.people)}명`;
}

/** 카톡에 붙여 넣을 몇 줄 */
export function monthSummaryText(s: MonthlyReservationSummary): string {
  const lines = [
    `[하늘땅] ${monthLabel(s.month)} 예약 (예약일 기준)`,
    `전체 ${tallyText(s.total)}`,
    `· 네이버 ${tallyText(s.naver)} / 직접 입력 ${tallyText(s.manual)}`,
    `· 점심(15시 전) ${tallyText(s.lunch)} / 저녁 ${tallyText(s.dinner)}`,
  ];
  if (s.noShow.teams > 0) lines.push(`· 노쇼 ${tallyText(s.noShow)} (전체에 들어 있음)`);
  if (s.canceled.teams > 0) lines.push(`· 취소 ${tallyText(s.canceled)}은 뺐습니다`);
  if (s.duplicateSuspects.teams > 0) lines.push(`※ 네이버·직접 입력 중복 의심 ${tallyText(s.duplicateSuspects)} — 확인하면 줄 수 있습니다`);
  return lines.join("\n");
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

export function dowOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DOW[new Date(y, m - 1, d).getDay()];
}

/** 엑셀 「요약」 시트 */
export function summarySheetRows(s: MonthlyReservationSummary): (string | number)[][] {
  const rows: (string | number)[][] = [
    [`하늘땅 ${monthLabel(s.month)} 예약 집계 (예약일 기준)`],
    [],
    ["구분", "건수", "인원"],
    ["전체(취소 제외)", s.total.teams, s.total.people],
    ["네이버", s.naver.teams, s.naver.people],
    ["직접 입력", s.manual.teams, s.manual.people],
    ["점심(15시 전)", s.lunch.teams, s.lunch.people],
    ["저녁(15시 이후)", s.dinner.teams, s.dinner.people],
    [],
    ["상태별", "건수", "인원"],
    ...s.byStatus.map(({ status, tally }) => [status, tally.teams, tally.people]),
    [],
    ["취소(위 숫자에 안 넣음)", s.canceled.teams, s.canceled.people],
  ];
  if (s.duplicateSuspects.teams > 0) {
    rows.push(["네이버·직접 입력 중복 의심", s.duplicateSuspects.teams, s.duplicateSuspects.people]);
  }
  rows.push([], ["※ 네이버에서 취소된 예약과 화면에서 지운 예약은 남아 있지 않아 세지 못합니다."]);
  return rows;
}

/** 엑셀 「날짜별」 시트 — 이름·전화번호 없이 숫자만 */
export function daySheetRows(s: MonthlyReservationSummary): (string | number)[][] {
  return [
    ["날짜", "요일", "건수", "인원", "점심 건수", "점심 인원", "저녁 건수", "저녁 인원", "네이버 건수", "직접 입력 건수", "노쇼 건수"],
    ...s.days.map((d) => [
      d.date, dowOf(d.date), d.total.teams, d.total.people, d.lunch.teams, d.lunch.people,
      d.dinner.teams, d.dinner.people, d.naver.teams, d.manual.teams, d.noShow.teams,
    ]),
    ["합계", "", s.total.teams, s.total.people, s.lunch.teams, s.lunch.people,
      s.dinner.teams, s.dinner.people, s.naver.teams, s.manual.teams, s.noShow.teams],
  ];
}
