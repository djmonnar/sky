/* ============================================================
   출퇴근·휴게 계산 (순수 함수)

   화면 상태는 기억해 두지 않고 언제나 기록(attendanceLogs)에서 다시 센다.
   그래야 새로고침하거나 다른 기기에서 열어도 같은 값이 나온다.

   기록은 고칠 수 없으므로(Rules), 잘못 누른 것은 지우지 못한다. 대신 여기서
   말이 안 되는 짝(휴게 시작 없이 종료, 퇴근 뒤의 기록 등)을 무시한다.
   ============================================================ */

import type { AttendanceDay, AttendanceLog, AttendanceType, PunchStatus } from "../data/types";

/**
 * "HH:mm" → 분. lib/time.ts 에 같은 함수가 있지만 그 파일은 import.meta.env 를 읽어
 * 브라우저 밖에서 못 돈다. 이 파일은 타입 말고는 아무것도 안 들여와야 node 로 검사할 수
 * 있어서(scripts/check-attendance.mjs) 여기에 둔다.
 */
function minutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** 자정을 넘긴 퇴근(예: 01:30)을 다음 날로 본다. 매장은 새벽까지 열 수 있다. */
function elapsed(from: string, to: string): number {
  const diff = minutes(to) - minutes(from);
  return diff < 0 ? diff + 1440 : diff;
}

/**
 * 하루치 기록을 상태로 접는다.
 *
 * @param logs 그 날짜의 기록. 순서는 상관없다 (여기서 시간순으로 정렬한다).
 * @param nowHHMM 지금 시각. 퇴근 전이면 여기까지를 근무로 친다.
 */
export function foldAttendanceDay(
  logs: AttendanceLog[],
  date: string,
  empId: number,
  nowHHMM: string
): AttendanceDay {
  // 저장 순서가 먼저다. 시각으로만 줄 세우면 자정을 넘긴 퇴근이 출근 앞으로 온다.
  const sorted = [...logs]
    .filter((row) => row.date === date)
    .sort((a, b) => {
      if (a.createdAt !== undefined && b.createdAt !== undefined) {
        return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
      }
      return a.time.localeCompare(b.time) || a.id.localeCompare(b.id);
    });

  let inAt: string | null = null;
  let outAt: string | null = null;
  const breaks: { start: string; end: string | null }[] = [];

  for (const log of sorted) {
    if (log.type === "in") {
      // 첫 출근만 센다. 두 번 눌러도 시각이 밀리지 않게.
      if (!inAt) inAt = log.time;
      continue;
    }
    if (outAt) continue; // 퇴근한 뒤의 기록은 무시한다.
    if (log.type === "out") {
      if (inAt) outAt = log.time;
      continue;
    }
    if (!inAt) continue; // 출근 전의 휴게는 무시한다.
    const open = breaks.find((b) => b.end === null);
    if (log.type === "breakStart") {
      if (!open) breaks.push({ start: log.time, end: null });
    } else if (log.type === "breakEnd" && open) {
      open.end = log.time;
    }
  }

  // 퇴근했는데 휴게가 열려 있으면 퇴근 시각에 닫힌 것으로 본다.
  const openBreak = breaks.find((b) => b.end === null);
  if (outAt && openBreak) openBreak.end = outAt;

  const breakMinutes = breaks.reduce(
    (sum, b) => sum + (b.end ? elapsed(b.start, b.end) : 0),
    0
  );

  const status: PunchStatus = !inAt
    ? "before"
    : outAt
      ? "done"
      : breaks.some((b) => b.end === null)
        ? "onBreak"
        : "working";

  const until = outAt ?? nowHHMM;
  const gross = inAt ? elapsed(inAt, until) : 0;
  // 진행 중인 휴게도 지금까지는 빼 준다 — 휴게 중에 근무 시간이 늘면 이상하다.
  const runningBreak = breaks.find((b) => b.end === null);
  const runningBreakMin = runningBreak && !outAt ? elapsed(runningBreak.start, nowHHMM) : 0;
  const workedMinutes = Math.max(0, gross - breakMinutes - runningBreakMin);

  return { date, empId, status, inAt, outAt, breaks, breakMinutes, workedMinutes };
}

/** 한 달치 기록을 날짜별로 접는다. 기록이 있는 날만 돌려준다. */
export function foldAttendanceMonth(
  logs: AttendanceLog[],
  empId: number,
  nowHHMM: string
): AttendanceDay[] {
  const dates = Array.from(new Set(logs.map((row) => row.date))).sort();
  return dates.map((date) => foldAttendanceDay(logs, date, empId, nowHHMM));
}

export interface MonthTotals {
  workedDays: number;
  totalMinutes: number;
  breakMinutes: number;
}

/** 월 합계. 출근만 하고 퇴근을 안 누른 날도 근무일로 센다. */
export function monthTotals(days: AttendanceDay[]): MonthTotals {
  const worked = days.filter((d) => d.inAt);
  return {
    workedDays: worked.length,
    totalMinutes: worked.reduce((sum, d) => sum + d.workedMinutes, 0),
    breakMinutes: worked.reduce((sum, d) => sum + d.breakMinutes, 0),
  };
}

/** 분을 «7시간 30분» 으로. 0분이면 «0분». */
export function fmtMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}분`;
  return mm === 0 ? `${h}시간` : `${h}시간 ${mm}분`;
}

/** 이 상태에서 누를 수 있는 버튼. 화면과 저장 양쪽에서 같은 규칙을 쓴다. */
export function canPunch(status: PunchStatus, type: AttendanceType): boolean {
  switch (type) {
    case "in": return status === "before";
    case "out": return status === "working" || status === "onBreak";
    case "breakStart": return status === "working";
    case "breakEnd": return status === "onBreak";
    default: return false;
  }
}
