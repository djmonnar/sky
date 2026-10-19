/* ============================================================
   레시피 원가 — 하위 레시피까지 풀어서 계산한다

   된장찌개 = 된장육수 + 두부 + 고기. 된장육수도 레시피라서, 된장찌개의 그 줄은
   단가를 손으로 적지 않고 **된장육수의 원가에서 매번 다시 계산한다.** 육수 재료값이
   오르면 찌개 원가도 같이 오른다 — 숫자를 두 군데 고칠 일이 없다.

   「얼마 들어가나」는 두 가지로 적는다.
   - ml·g 같은 계량 단위: 된장육수에 「한 번 만들면 2L」(산출량)를 적어 두면
     300ml 는 2L 중 300ml, 곧 육수 원가 × 300/2000 이다.
   - 회분: 한 번 만든 양 전체가 1회분이다. 산출량을 아직 안 적은 레시피도 이걸로는
     넣을 수 있다 — 막히지 않게 하려는 것.

   못 푸는 줄(지워진 레시피, 서로를 품은 레시피, 단위가 안 맞는 줄)은 0원으로 두고
   «확인 필요»로 센다. 원가를 지어내지 않는다 — 빠졌으면 빠졌다고 보여 준다.

   이 파일은 타입 말고는 아무것도 import 하지 않는다. esbuild 로 이 파일 하나만 떼어
   node 로 검사하기 위해서다(scripts/check-recipe-cost.mjs). 그래서 단위 환산도
   data/units.ts 를 부르지 않고 여기 따로 둔다.
   ============================================================ */

import type { Recipe, RecipeIngredient } from "../data/types";

/** 하위 레시피 줄에서만 쓰는 단위. 한 번 만든 양 전체가 1회분이다. */
export const BATCH_UNIT = "회분";

/** 레시피 안에 레시피가 이보다 깊게 들어가면 데이터가 꼬인 것으로 본다. */
const MAX_DEPTH = 8;

type Family = "mass" | "volume" | "ea" | "box";

const MEASURE: Record<string, { family: Family; base: number }> = {
  g: { family: "mass", base: 1 },
  kg: { family: "mass", base: 1000 },
  ml: { family: "volume", base: 1 },
  L: { family: "volume", base: 1000 },
  ea: { family: "ea", base: 1 },
  박스: { family: "box", base: 1 },
};

const FAMILY_UNITS: Record<Family, string[]> = {
  mass: ["g", "kg"],
  volume: ["ml", "L"],
  ea: ["ea"],
  box: ["박스"],
};

export type RecipeIssueKind = "unpicked" | "missing" | "cycle" | "no-yield" | "unit-mismatch" | "sub-incomplete";

export interface RecipeIssue {
  ingredientId: string;
  kind: RecipeIssueKind;
  message: string;
}

export interface IngredientCost {
  /** 이 줄 단위 1개당 원가. 하위 레시피 줄이면 계산값이다. */
  unitCost: number;
  subtotal: number;
  /** 수량·단가가 비었거나, 하위 레시피를 못 풀었거나, 하위 레시피가 덜 된 줄 */
  incomplete: boolean;
  issue?: RecipeIssue;
}

export interface RecipeCost {
  totalCost: number;
  perServingCost: number;
  salePrice: number;
  /** 판매가 대비 재료비 %. 판매가가 없으면 null — 0% 가 아니다. */
  costRate: number | null;
  /** 수량·단가가 비었거나 하위 레시피를 못 푼 줄 수. 있으면 원가는 «아직 덜 된 것»이다. */
  incomplete: number;
  issues: RecipeIssue[];
}

export function isSubRecipeRow(ingredient: RecipeIngredient): boolean {
  return ingredient.subRecipeId !== undefined && ingredient.subRecipeId !== null;
}

/** 산출량을 적어 둔 레시피만 ml·g 로 넣을 수 있다. */
export function hasYield(recipe: Pick<Recipe, "yieldQuantity" | "yieldUnit">): boolean {
  return Number(recipe.yieldQuantity) > 0 && Boolean(MEASURE[String(recipe.yieldUnit ?? "")]);
}

/** "2L", "500g" */
export function yieldText(recipe: Pick<Recipe, "yieldQuantity" | "yieldUnit">): string {
  if (!hasYield(recipe)) return "";
  const quantity = Number(recipe.yieldQuantity);
  return `${Number(quantity.toFixed(3))}${recipe.yieldUnit}`;
}

/**
 * 하위 레시피 줄에서 고를 수 있는 단위. 산출량과 같은 계열(2L 면 ml·L)에 회분.
 * 산출량이 없으면 회분뿐이다.
 */
export function unitsForSubRecipe(sub: Pick<Recipe, "yieldQuantity" | "yieldUnit"> | undefined): string[] {
  if (!sub || !hasYield(sub)) return [BATCH_UNIT];
  return [...FAMILY_UNITS[MEASURE[String(sub.yieldUnit)].family], BATCH_UNIT];
}

/** 같은 계열 단위끼리 수량을 옮긴다(0.3L → 300ml). 계열이 다르거나 회분이면 숫자 그대로. */
export function convertSubQuantity(quantity: number, from: string, to: string): number {
  const a = MEASURE[from];
  const b = MEASURE[to];
  if (!a || !b || a.family !== b.family) return quantity;
  return (quantity * a.base) / b.base;
}

/** 레시피 id → 그 레시피가 재료로 직접 넣은 레시피 id 들 */
function childIds(recipe: Recipe): number[] {
  return recipe.ingredients
    .filter(isSubRecipeRow)
    .map((ingredient) => Number(ingredient.subRecipeId))
    .filter((id) => id > 0);
}

/** `fromId` 레시피를 따라 내려가면 `targetId` 가 나오는가 (자기 자신 포함) */
export function containsRecipe(recipes: Recipe[], fromId: number, targetId: number): boolean {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const seen = new Set<number>();
  const stack = [fromId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const recipe = byId.get(id);
    if (recipe) stack.push(...childIds(recipe));
  }
  return false;
}

/**
 * 이 레시피에 재료로 넣을 수 있는 레시피들. 자기 자신과, 자기를 이미 품고 있는
 * 레시피는 뺀다 — 넣으면 된장찌개 안에 된장찌개가 들어가 원가가 끝없이 돈다.
 * 새 레시피(id 0)는 아직 아무도 품을 수 없으니 전부 고를 수 있다.
 */
export function usableSubRecipes(recipes: Recipe[], ownerId: number): Recipe[] {
  return recipes.filter((candidate) => {
    if (ownerId > 0 && candidate.id === ownerId) return false;
    if (ownerId > 0 && containsRecipe(recipes, candidate.id, ownerId)) return false;
    return true;
  });
}

/** 이 레시피를 재료로 직접 넣은 레시피들 — 지우기 전에, 고치기 전에 알아야 한다. */
export function recipesUsing(recipes: Recipe[], id: number): Recipe[] {
  return recipes.filter((recipe) => recipe.id !== id && childIds(recipe).includes(id));
}

/**
 * 원가 계산기. 하위 레시피를 찾으려면 레시피 목록 전체가 있어야 해서 목록을 받아 만든다.
 *
 * 편집 중인 초안은 `recipe(draft)` 로 넣는다 — 초안의 id 가 맨 위 경로에 들어가므로,
 * 저장된 다른 레시피가 이 레시피를 품고 있어도 그 고리를 «순환»으로 잡는다.
 */
export function createRecipeCoster(recipes: Recipe[]) {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));

  function ingredientCost(ingredient: RecipeIngredient, path: number[]): IngredientCost {
    const quantity = Number(ingredient.quantity) || 0;

    if (!isSubRecipeRow(ingredient)) {
      const unitCost = Number(ingredient.unitCost) || 0;
      return { unitCost, subtotal: quantity * unitCost, incomplete: !(quantity > 0) || !(unitCost > 0) };
    }

    const broken = (kind: RecipeIssueKind, message: string): IngredientCost => ({
      unitCost: 0,
      subtotal: 0,
      incomplete: true,
      issue: { ingredientId: ingredient.id, kind, message },
    });

    const subId = Number(ingredient.subRecipeId);
    if (!(subId > 0)) return broken("unpicked", "넣을 레시피를 골라 주세요.");
    const sub = byId.get(subId);
    if (!sub) {
      return broken("missing", "지워진 레시피입니다 — 다른 레시피를 고르거나 이 줄을 빼 주세요.");
    }
    if (path.includes(subId) || path.length > MAX_DEPTH) {
      return broken("cycle", `「${sub.name}」 안에 이 레시피가 다시 들어 있어 계산할 수 없습니다.`);
    }

    const subCost = costOf(sub, [...path, subId]);
    const unit = String(ingredient.unit ?? "");
    let unitCost: number;
    if (unit === BATCH_UNIT) {
      unitCost = subCost.totalCost;
    } else if (!hasYield(sub)) {
      return broken(
        "no-yield",
        `「${sub.name}」에 산출량(한 번 만들면 얼마)을 적어야 ${unit} 단위로 넣을 수 있습니다. 지금은 회분으로만 됩니다.`
      );
    } else {
      const from = MEASURE[unit];
      const to = MEASURE[String(sub.yieldUnit)];
      if (!from || from.family !== to.family) {
        const options = FAMILY_UNITS[to.family].join("·");
        return broken(
          "unit-mismatch",
          `단위가 맞지 않습니다 — 「${sub.name}」 산출량은 ${yieldText(sub)}입니다. ${options} 중에서 고르거나 회분으로 넣어 주세요.`
        );
      }
      unitCost = (subCost.totalCost * from.base) / (Number(sub.yieldQuantity) * to.base);
    }

    const subtotal = quantity * unitCost;
    if (subCost.incomplete > 0) {
      return {
        unitCost,
        subtotal,
        incomplete: true,
        issue: {
          ingredientId: ingredient.id,
          kind: "sub-incomplete",
          message: `「${sub.name}」에 아직 덜 된 재료가 있어 이 줄 원가가 실제보다 작습니다.`,
        },
      };
    }
    return { unitCost, subtotal, incomplete: !(quantity > 0) || !(unitCost > 0) };
  }

  function costOf(recipe: Recipe, path: number[]): RecipeCost {
    let totalCost = 0;
    let incomplete = 0;
    const issues: RecipeIssue[] = [];
    for (const ingredient of recipe.ingredients) {
      const cost = ingredientCost(ingredient, path);
      totalCost += cost.subtotal;
      if (cost.incomplete) incomplete += 1;
      if (cost.issue) issues.push(cost.issue);
    }
    const salePrice = recipe.kind === "side" ? 0 : Number(recipe.salePrice) || 0;
    const servings = Math.max(1, Number(recipe.servings) || 1);
    const perServingCost = totalCost / servings;
    return {
      totalCost,
      perServingCost,
      salePrice,
      costRate: salePrice > 0 ? (perServingCost / salePrice) * 100 : null,
      incomplete,
      issues,
    };
  }

  const rootPath = (owner: Recipe) => (owner.id > 0 ? [owner.id] : []);

  return {
    /** 저장된 레시피든 편집 중인 초안이든 */
    recipe: (recipe: Recipe): RecipeCost => costOf(recipe, rootPath(recipe)),
    /** 편집 화면의 한 줄. `owner` 는 그 줄이 들어 있는 레시피(초안) */
    ingredient: (ingredient: RecipeIngredient, owner: Recipe): IngredientCost =>
      ingredientCost(ingredient, rootPath(owner)),
  };
}

export type RecipeCoster = ReturnType<typeof createRecipeCoster>;
