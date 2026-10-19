/* ============================================================
   체크리스트 (오픈·마감) — 화면·환경에 의존하지 않는 계산

   사장님이 항목을 정해 두고(템플릿), 직원이 날마다 체크한다(하루치 기록).
   항목에는 요일을 붙일 수 있다 — 비면 매일, 「화」만 고르면 매주 화요일에만 나온다.

   **기록이 템플릿보다 앞선다.** 체크할 때 항목 글을 같이 남기므로, 나중에 사장님이
   항목을 고치거나 지워도 그날 체크한 것은 그날 모습 그대로 보인다(«지운 항목»으로).

   이 파일은 타입 말고는 아무것도 import 하지 않는다 — esbuild 로 떼어 node 로
   검사한다(scripts/check-checklist.mjs).
   ============================================================ */

import type {
  ChecklistCheck, ChecklistDay, ChecklistSection, ChecklistTemplate, ChecklistTemplateItem,
} from "../data/types";

export const SECTIONS: ChecklistSection[] = ["open", "close"];
export const SECTION_LABEL: Record<ChecklistSection, string> = { open: "오픈", close: "마감" };
export const DOW_SHORT = ["월", "화", "수", "목", "금", "토", "일"];

/** "YYYY-MM-DD" → 월=0 … 일=6. UTC 로 세서 기기 시간대와 상관없다. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** "매일" / "매주 화" / "매주 월·목" / "평일" / "주말" */
export function daysLabel(days: number[]): string {
  const set = [...new Set(days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (set.length === 0 || set.length === 7) return "매일";
  if (set.join() === "0,1,2,3,4") return "평일";
  if (set.join() === "5,6") return "주말";
  return `매주 ${set.map((d) => DOW_SHORT[d]).join("·")}`;
}

export function appliesOn(item: ChecklistTemplateItem, date: string): boolean {
  return item.days.length === 0 || item.days.includes(weekdayOf(date));
}

export interface ChecklistRow {
  id: string;
  section: ChecklistSection;
  text: string;
  checked: boolean;
  by?: string;
  at?: string;
  /** 요일이 정해진 항목이면 그 표시 ("매주 화") — 매일 하는 것은 null */
  schedule: string | null;
  /** 체크는 남아 있는데 지금 템플릿에는 없는 항목(나중에 지웠거나 그날 요일이 아님) */
  removed: boolean;
}

/**
 * 그날 보여 줄 줄들. 템플릿 중 그 요일에 하는 것 + (템플릿에서 빠졌지만) 그날 체크해 둔 것.
 * 섹션 안에서는 템플릿 순서, 빠진 것은 맨 뒤.
 */
export function dayRows(template: ChecklistTemplate | null, day: ChecklistDay | null, date: string): ChecklistRow[] {
  const checks = day?.checks ?? {};
  const rows: ChecklistRow[] = [];
  const shown = new Set<string>();
  for (const item of template?.items ?? []) {
    if (!appliesOn(item, date)) continue;
    const check = checks[item.id];
    shown.add(item.id);
    rows.push({
      id: item.id,
      section: item.section,
      text: item.text,
      checked: Boolean(check?.checked),
      by: check?.checked ? check.by : undefined,
      at: check?.checked ? check.at : undefined,
      schedule: item.days.length > 0 ? daysLabel(item.days) : null,
      removed: false,
    });
  }
  // 그날 체크해 둔 것은 템플릿에서 빠져도 사라지지 않는다 — 기록이 앞선다
  Object.entries(checks).forEach(([id, check]: [string, ChecklistCheck]) => {
    if (shown.has(id) || !check?.checked) return;
    rows.push({
      id,
      section: check.section === "close" ? "close" : "open",
      text: check.text,
      checked: true,
      by: check.by,
      at: check.at,
      schedule: null,
      removed: true,
    });
  });
  return SECTIONS.flatMap((section) => rows.filter((row) => row.section === section));
}

export interface SectionProgress {
  done: number;
  total: number;
}

export function progressOf(rows: ChecklistRow[], section: ChecklistSection): SectionProgress {
  const inSection = rows.filter((row) => row.section === section && !row.removed);
  return { done: inSection.filter((row) => row.checked).length, total: inSection.length };
}

/** 저장 전에 템플릿을 다듬는다 — 빈 줄을 버리고, 요일을 정리하고, id 가 겹치지 않게. */
export function cleanTemplate(items: ChecklistTemplateItem[]): ChecklistTemplateItem[] {
  const seen = new Set<string>();
  return items
    .map((item) => ({
      id: String(item.id || "").trim(),
      section: (item.section === "close" ? "close" : "open") as ChecklistSection,
      text: String(item.text || "").replace(/\s+/g, " ").trim().slice(0, 80),
      days: [...new Set((item.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b),
    }))
    .map((item) => (item.days.length === 7 ? { ...item, days: [] } : item))
    .filter((item) => {
      if (!item.id || !item.text || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

/**
 * 처음 쓰는 매장을 위한 예시. **사장님이 고치라고 있는 것** — 매장 사실을 적은 게 아니다.
 * 버튼을 눌러야만 들어간다.
 */
export function exampleTemplate(makeId: () => string): ChecklistTemplateItem[] {
  const open = ["매장 환기·조명 켜기", "냉장·냉동고 온도 확인", "숯·불판 준비", "반찬·소스 세팅"];
  const close = ["가스 밸브 잠금", "숯 소화 확인", "냉장고 정리·마감", "쓰레기 배출·문단속"];
  return [
    ...open.map((text) => ({ id: makeId(), section: "open" as const, text, days: [] })),
    ...close.map((text) => ({ id: makeId(), section: "close" as const, text, days: [] })),
  ];
}
