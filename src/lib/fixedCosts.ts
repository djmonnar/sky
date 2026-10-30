import type { FixedCostItem } from "../data/types";

/* ============================================================
   손익의 고정비 (2026-10-30 사장님 요청)

   그랜터(카드·계좌 연동)를 보류한 뒤로 손익에서 임대료·관리비·공과금이 통째로 빠져 있었다
   — 계좌 출금을 분류해 세던 값이라 셀 길이 없었다. 이제 사장님이 달마다 적는다.

   - 한 달에 한 장(fixedCosts/{YYYY-MM}). 임대료처럼 매달 같은 것은 «지난달 그대로 가져오기»로
     옮긴 뒤 바뀐 것(전기·가스 고지서)만 고친다.
   - **아직 안 적은 달은 0원이 아니라 «미입력»** — 0 으로 빼면 이익이 그만큼 부풀어 보인다.
     적은 달만 손익에서 뺀다.

   이 파일은 타입 말고는 아무것도 import 하지 않는다(scripts/check-fixed-costs.mjs).
   ============================================================ */

/** 빠르게 넣는 이름. 순서는 금액이 큰 것부터. */
export const FIXED_COST_PRESETS = [
  "임대료", "관리비", "전기", "가스", "수도", "통신·인터넷", "보험", "세무·기장", "렌탈·리스", "기타",
];

/** 한 달에 이보다 많이 적을 일은 없다(규칙도 같은 상한) */
export const FIXED_COST_MAX_ITEMS = 50;
const NAME_MAX = 40;

export function makeFixedCostId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 저장할 모양 — 이름 다듬기, 이름 없는 줄 빼기, 금액은 0 이상 정수 */
export function cleanFixedCostItems(items: FixedCostItem[]): FixedCostItem[] {
  return items
    .map((item) => ({
      id: String(item.id || makeFixedCostId()),
      name: String(item.name ?? "").trim().slice(0, NAME_MAX),
      amount: Math.max(0, Math.round(Number(item.amount) || 0)),
    }))
    .filter((item) => item.name)
    .slice(0, FIXED_COST_MAX_ITEMS);
}

export function sumFixedCosts(items: FixedCostItem[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0);
}

/** "2026-11" → "2026-10", "2026-01" → "2025-12" */
export function previousMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, "0")}`;
}

/** 지난달 항목을 이번 달로 — 새 id, 이름·금액은 그대로 */
export function copyFixedCosts(items: FixedCostItem[]): FixedCostItem[] {
  return cleanFixedCostItems(items).map((item) => ({ ...item, id: makeFixedCostId() }));
}
