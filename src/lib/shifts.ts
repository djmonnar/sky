import type { Department, Shift, ShiftPeriod } from "../data/types";
import { DOW_KO, fmtDate } from "./time";

export const PERIODS: ShiftPeriod[] = ["morning", "afternoon"];
export const DEPARTMENTS: Department[] = ["hall", "kitchen"];

export const PERIOD_LABEL: Record<ShiftPeriod, string> = {
  morning: "오전",
  afternoon: "오후",
};

export const DEPARTMENT_LABEL: Record<Department, string> = {
  hall: "홀",
  kitchen: "주방",
};

export const PERIOD_TIME: Record<ShiftPeriod, { start: string; end: string; breakMin: number }> = {
  morning: { start: "10:00", end: "15:00", breakMin: 30 },
  afternoon: { start: "17:00", end: "22:00", breakMin: 30 },
};

export function shiftDateForDay(week: Date[], dayIndex: number): string {
  return fmtDate(week[dayIndex]);
}

export function shiftKey(s: Pick<Shift, "id" | "date" | "period" | "department" | "employeeId" | "order">): string {
  return s.id || `${s.date}_${s.period}_${s.department}_${s.employeeId}_${s.order}`;
}

export function sortShifts(a: Shift, b: Shift): number {
  return (
    a.date.localeCompare(b.date)
    || a.dayIndex - b.dayIndex
    || PERIODS.indexOf(a.period) - PERIODS.indexOf(b.period)
    || DEPARTMENTS.indexOf(a.department) - DEPARTMENTS.indexOf(b.department)
    || a.order - b.order
    || a.employeeId - b.employeeId
  );
}

export function shiftsForDay(shifts: Shift[], date: string, dayIndex: number): Shift[] {
  return shifts
    .filter((s) =>
      !s.off &&
      // date 필드가 있는 최신 슬롯 문서는 date를 우선 비교, 없는 옛 문서만 dayIndex fallback
      (s.date ? s.date === date : (s.day === dayIndex || s.dayIndex === dayIndex))
    )
    .sort(sortShifts);
}

export function shiftsForEmployeeDay(
  shifts: Shift[],
  employeeId: number | undefined,
  date: string,
  dayIndex: number
): Shift[] {
  if (employeeId === undefined) return [];
  return shiftsForDay(shifts, date, dayIndex)
    .filter((s) => s.employeeId === employeeId || s.empId === employeeId);
}

export function slotSummary(shifts: Shift[]): string {
  if (shifts.length === 0) return "휴무";
  const periods = Array.from(new Set(shifts.map((s) => s.period)))
    .sort((a, b) => PERIODS.indexOf(a) - PERIODS.indexOf(b))
    .map((p) => PERIOD_LABEL[p])
    .join("+");
  const departments = Array.from(new Set(shifts.map((s) => s.department)))
    .sort((a, b) => DEPARTMENTS.indexOf(a) - DEPARTMENTS.indexOf(b))
    .map((d) => DEPARTMENT_LABEL[d])
    .join("/");
  return `${periods} · ${departments}`;
}

export function slotLongSummary(shifts: Shift[]): string {
  if (shifts.length === 0) return "휴무";
  return shifts
    .map((s) => `${PERIOD_LABEL[s.period]} ${DEPARTMENT_LABEL[s.department]}`)
    .join(", ");
}

export function planTimesForShifts(shifts: Shift[]): { start: string; end: string; breakMin: number } {
  if (shifts.length === 0) return PERIOD_TIME.morning;
  const starts = shifts.map((s) => s.start ?? PERIOD_TIME[s.period].start).sort();
  const ends = shifts.map((s) => s.end ?? PERIOD_TIME[s.period].end).sort();
  const breakMin = shifts.reduce((sum, s) => sum + (s.breakMin ?? PERIOD_TIME[s.period].breakMin), 0);
  return { start: starts[0], end: ends[ends.length - 1], breakMin };
}

export function countSlots(shifts: Shift[], employeeId?: number): {
  morningCount: number;
  afternoonCount: number;
  slotCount: number;
} {
  const target = employeeId === undefined
    ? shifts
    : shifts.filter((s) => s.employeeId === employeeId || s.empId === employeeId);
  const active = target.filter((s) => !s.off);
  const morningCount = active.filter((s) => s.period === "morning").length;
  const afternoonCount = active.filter((s) => s.period === "afternoon").length;
  return { morningCount, afternoonCount, slotCount: morningCount + afternoonCount };
}

export function dayTitle(date: Date, dayIndex: number): string {
  return `${DOW_KO[dayIndex]} ${date.getMonth() + 1}/${date.getDate()}`;
}
