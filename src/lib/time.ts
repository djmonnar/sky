/* 날짜·시간 유틸 (도메인 독립) */

export const TODAY = new Date("2026-06-12T10:30:00"); // 데모 기준일 (금요일)
export const DOW_KO = ["월", "화", "수", "목", "금", "토", "일"];

export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function dowIndex(d: Date): number {
  return (d.getDay() + 6) % 7; // 월=0
}

export function weekDates(base: Date): Date[] {
  const start = new Date(base);
  start.setDate(start.getDate() - dowIndex(base));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export const TODAY_STR = fmtDate(TODAY);
export const TODAY_DOW = dowIndex(TODAY);

export function minutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function toTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function durationH(start: string, end: string, breakMin: number): number {
  return Math.max(0, (minutes(end) - minutes(start) - breakMin) / 60);
}

/** 4.5 → "4시간 30분" */
export function fmtH(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 0 ? `${hh}시간` : `${hh}시간 ${mm}분`;
}

export function won(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}
