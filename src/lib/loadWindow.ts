/* ============================================================
   처음 열 때 받아 오는 근무표 범위 (2026-11-04 — 「대시보드 로딩이 너무 길다」)

   근무표(shifts)는 달마다 600~700건씩 쌓인다(2026-11 기준 4,048건). 관리자·매니저 화면은 전부를
   실시간으로 받아 와서, 대시보드를 열 때마다 몇 달 치 근무표를 다 내려받았다.
   그래서 **지난달 1일부터**만 받는다 — 오늘·이번 주·이번 달과 지난달 급여, 지난주 복사가 다 들어간다.
   더 옛날을 보는 화면(급여 지난 달, 근무표 몇 주 전)은 store 의 `ensureShiftsFrom(날짜)`로 그만큼만 넓힌다.
   한 번 넓힌 범위는 그 세션 동안 줄이지 않는다(왔다 갔다 할 때마다 다시 받지 않게).

   이 파일은 아무것도 import 하지 않는다(scripts/check-load-window.mjs).
   ============================================================ */

const pad = (n: number) => String(n).padStart(2, "0");

/** 오늘(YYYY-MM-DD)의 지난달 1일 */
export function shiftsWindowStart(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

/** YYYY-MM-DD 에 날수를 더한다 */
export function addDaysTo(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d + days);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

/** 지금 범위와 화면이 바라는 시작 중 이른 것. 날짜 모양이 아니면 그대로 둔다. */
export function widenWindow(current: string, wanted: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wanted)) return current;
  return wanted < current ? wanted : current;
}
