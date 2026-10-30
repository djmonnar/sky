import type { PurchaseOrder, Recipe } from "../data/types";
import { convertUnitCost, normalizeUnit } from "../data/units";

/* ============================================================
   매입 단가가 바뀐 재료 → 레시피 원가율 경고 (2026-10-30 사장님 요청)

   레시피 재료 단가는 사람이 적어 둔 값이라, 거래처 값이 올라도 그대로 남아 원가율이 실제보다 낮게 보인다.
   최근 발주·입고 단가와 견줘 「설탕 2,083원/kg → 2,300원/kg (+10%)」을 알리고, 누르면 레시피 단가에 반영한다.

   - **같은 재료 = 이름이 같은 것**(띄어쓰기·대소문자 무시). 발주 품목과 레시피 재료를 잇는 번호가 없어서다.
     이름을 다르게 적은 재료는 못 잡는다 — 화면에 «이름이 맞는 재료 N/M개»를 같이 보여 준다.
   - 최근 단가 = 취소·임시 저장이 아닌 발주서 가운데 가장 늦은 것(입고일 → 발주일 → 만든 날).
   - 단위가 같은 계열일 때만 견준다(kg↔g, L↔ml, 같은 단위). kg 와 ea 처럼 못 바꾸는 것은 견주지 않는다 —
     단위 환산 함수는 못 바꾸면 숫자를 그대로 돌려줘서, 그대로 견주면 엉뚱한 «올랐다»가 나온다.
   - 3% 넘게 다를 때만 알린다(엑셀에서 옮긴 2,083.33 같은 끝수로 울리지 않게).
   ============================================================ */

export const PRICE_CHANGE_THRESHOLD = 0.03;

export function ingredientKey(name: string | null | undefined): string {
  return String(name ?? "").replace(/\s+/g, "").toLowerCase();
}

const FAMILY: Record<string, string> = { g: "mass", kg: "mass", ml: "volume", L: "volume" };

/** 단가를 서로 바꿀 수 있는 단위인가 — 같은 단위, 또는 kg↔g·L↔ml */
export function comparableUnits(a: string, b: string): boolean {
  const x = normalizeUnit(a);
  const y = normalizeUnit(b);
  return x === y || (Boolean(FAMILY[x]) && FAMILY[x] === FAMILY[y]);
}

export interface LatestPurchase {
  name: string;
  unitPrice: number;
  unit: string;
  date: string;
  vendorName: string;
  orderId: number;
}

function orderDate(order: PurchaseOrder): string {
  return String(order.receivedAt || order.orderedAt || order.createdAt || "").slice(0, 10);
}

/** 재료 이름 → 가장 최근 매입 단가 */
export function latestPurchasePrices(orders: PurchaseOrder[]): Map<string, LatestPurchase> {
  const latest = new Map<string, LatestPurchase>();
  for (const order of orders) {
    if (order.status === "canceled" || order.status === "draft") continue;
    const date = orderDate(order);
    for (const item of order.items ?? []) {
      const key = ingredientKey(item.name);
      const unitPrice = Number(item.unitPrice) || 0;
      if (!key || !(unitPrice > 0)) continue;
      const before = latest.get(key);
      if (before && (before.date > date || (before.date === date && before.orderId > order.id))) continue;
      latest.set(key, { name: item.name, unitPrice, unit: normalizeUnit(item.unit), date, vendorName: order.vendorName, orderId: order.id });
    }
  }
  return latest;
}

export interface PriceChangeUse {
  recipeId: number;
  recipeName: string;
  ingredientId: string;
  unit: string;
  oldUnitCost: number;
  newUnitCost: number;
}

export interface PriceChange {
  key: string;
  name: string;
  latest: LatestPurchase;
  /** 매입 단위 기준으로 본 레시피의 예전 단가(첫 번째 레시피) — 「2,083원/kg → 2,300원/kg」 */
  oldPriceInPurchaseUnit: number;
  /** +0.1 = 10% 오름 */
  change: number;
  uses: PriceChangeUse[];
}

export interface PriceWatch {
  changes: PriceChange[];
  /** 매입 품목과 이름이 맞는 레시피 재료 수 / 전체(하위 레시피 줄 빼고) */
  matched: number;
  total: number;
  /** 이름은 맞는데 단위를 못 바꿔 견주지 못한 재료 */
  unitMismatch: number;
}

export function findPriceChanges(recipes: Recipe[], orders: PurchaseOrder[], threshold = PRICE_CHANGE_THRESHOLD): PriceWatch {
  const latest = latestPurchasePrices(orders);
  const changes = new Map<string, PriceChange>();
  let matched = 0;
  let total = 0;
  let unitMismatch = 0;

  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      if (ingredient.subRecipeId !== undefined && ingredient.subRecipeId !== null) continue;
      const key = ingredientKey(ingredient.name);
      if (!key) continue;
      total += 1;
      const purchase = latest.get(key);
      if (!purchase) continue;
      matched += 1;
      const unit = normalizeUnit(ingredient.unit);
      const oldUnitCost = Number(ingredient.unitCost) || 0;
      if (!comparableUnits(purchase.unit, unit)) { unitMismatch += 1; continue; }
      if (!(oldUnitCost > 0)) continue;
      const newUnitCost = convertUnitCost(purchase.unitPrice, normalizeUnit(purchase.unit), unit);
      const change = (newUnitCost - oldUnitCost) / oldUnitCost;
      if (Math.abs(change) < threshold) continue;
      const use: PriceChangeUse = {
        recipeId: recipe.id, recipeName: recipe.name, ingredientId: ingredient.id, unit, oldUnitCost, newUnitCost,
      };
      const existing = changes.get(key);
      if (existing) existing.uses.push(use);
      else {
        changes.set(key, {
          key,
          name: purchase.name,
          latest: purchase,
          oldPriceInPurchaseUnit: convertUnitCost(oldUnitCost, unit, normalizeUnit(purchase.unit)),
          change,
          uses: [use],
        });
      }
    }
  }
  // 많이 오른 것부터
  return { changes: [...changes.values()].sort((a, b) => b.change - a.change), matched, total, unitMismatch };
}

/** 단가 변동을 레시피에 반영한 새 레시피들(바뀐 것만). 화면이 저장하고, 원가율 비교에도 쓴다. */
export function applyPriceChange(recipes: Recipe[], change: PriceChange): Recipe[] {
  const byRecipe = new Map<number, PriceChangeUse[]>();
  for (const use of change.uses) byRecipe.set(use.recipeId, [...(byRecipe.get(use.recipeId) ?? []), use]);
  return recipes
    .filter((recipe) => byRecipe.has(recipe.id))
    .map((recipe) => {
      const uses = byRecipe.get(recipe.id)!;
      return {
        ...recipe,
        ingredients: recipe.ingredients.map((ingredient) => {
          const use = uses.find((u) => u.ingredientId === ingredient.id);
          return use ? { ...ingredient, unitCost: Number(use.newUnitCost.toFixed(4)) } : ingredient;
        }),
      };
    });
}
