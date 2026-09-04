/* ============================================================
   재료·재고 단위

   레시피와 재고가 같은 단위표를 쓴다. 자유 입력이면 "kg" "KG" "㎏" "킬로"가
   따로 놀아서 합계도 검색도 못 믿는다 — 여섯 개 중에서 고른다.
   ============================================================ */

export const UNITS = ["g", "kg", "ml", "L", "박스", "ea"] as const;
export type Unit = (typeof UNITS)[number];

export const UNIT_LABELS: Record<Unit, string> = {
  g: "g",
  kg: "kg",
  ml: "ml",
  L: "L",
  박스: "박스",
  ea: "ea (개)",
};

/** 옛 데이터·OCR·손 입력에서 온 단위를 표의 단위로 맞춘다. 모르면 ea. */
export function normalizeUnit(raw: unknown): Unit {
  const text = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!text) return "ea";
  if (text === "g" || text === "그램" || text === "gram") return "g";
  if (text === "kg" || text === "㎏" || text === "킬로" || text === "키로") return "kg";
  if (text === "ml" || text === "㎖" || text === "밀리") return "ml";
  if (text === "l" || text === "ℓ" || text === "리터" || text === "리") return "L";
  if (text === "박스" || text === "box" || text === "상자" || text === "b") return "박스";
  return "ea";
}

/**
 * 단위를 바꿀 때 단가도 따라간다.
 * kg 당 12,000원을 g 로 바꾸면 g 당 12원 — 그래야 재료비가 그대로다.
 * 질량↔부피, 박스↔ea 는 환산할 수 없으니 그대로 둔다.
 */
export function convertUnitCost(cost: number, from: Unit, to: Unit): number {
  if (from === to) return cost;
  if (from === "kg" && to === "g") return cost / 1000;
  if (from === "g" && to === "kg") return cost * 1000;
  if (from === "L" && to === "ml") return cost / 1000;
  if (from === "ml" && to === "L") return cost * 1000;
  return cost;
}

/** 수량도 같이 환산한다 — 0.6kg 을 g 로 바꾸면 600g. */
export function convertQuantity(quantity: number, from: Unit, to: Unit): number {
  if (from === to) return quantity;
  if (from === "kg" && to === "g") return quantity * 1000;
  if (from === "g" && to === "kg") return quantity / 1000;
  if (from === "L" && to === "ml") return quantity * 1000;
  if (from === "ml" && to === "L") return quantity / 1000;
  return quantity;
}
