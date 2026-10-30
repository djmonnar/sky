import type { Reservation } from "../data/types";

/* ============================================================
   근무표에 그날 예약 인원 — 사람을 몇 명 넣을지 정할 때 보이게 (2026-10-30 사장님 요청)

   근무표 관리 화면의 날짜 칸에 「예약 12팀 48명」, 오전·오후 칸에 그 시간대 인원.
   - 취소·노쇼는 안 센다 — 올 손님만.
   - 오전·오후는 근무표 칸과 같은 경계로 가른다: 오전 근무가 15:00 에 끝나므로 15:00 전 예약은 오전,
     그 뒤는 오후(src/lib/shifts.ts PERIOD_TIME).

   이 파일은 타입 말고는 아무것도 import 하지 않는다(scripts/check-schedule-load.mjs).
   ============================================================ */

export const MORNING_CUTOFF = "15:00";

const NOT_COMING = new Set(["취소", "노쇼"]);

export interface PeriodLoad {
  teams: number;
  people: number;
}

export interface ReservationLoad extends PeriodLoad {
  morning: PeriodLoad;
  afternoon: PeriodLoad;
}

const empty = (): ReservationLoad => ({ teams: 0, people: 0, morning: { teams: 0, people: 0 }, afternoon: { teams: 0, people: 0 } });

/** 날짜 → 그날 예약 인원. 고른 날짜만 센다(예약이 없는 날도 0 으로 들어 있다). */
export function reservationLoadByDate(reservations: Reservation[], dates: string[]): Map<string, ReservationLoad> {
  const loads = new Map(dates.map((date) => [date, empty()]));
  for (const reservation of reservations) {
    const load = loads.get(reservation.date);
    if (!load || NOT_COMING.has(reservation.status)) continue;
    const people = Math.max(0, Number(reservation.people) || 0);
    const period = String(reservation.time ?? "") < MORNING_CUTOFF ? load.morning : load.afternoon;
    load.teams += 1;
    load.people += people;
    period.teams += 1;
    period.people += people;
  }
  return loads;
}

/** "예약 12팀 48명" — 없으면 "예약 없음" */
export function loadText(load: PeriodLoad | undefined): string {
  return load && load.teams > 0 ? `예약 ${load.teams}팀 ${load.people}명` : "예약 없음";
}
