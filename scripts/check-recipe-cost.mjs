/**
 * 레시피 원가 점검 — 하위 레시피까지 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:recipe
 *
 * src/lib/recipeCost.ts 를 esbuild 로 변환해 불러온 뒤, 된장찌개 안의 된장육수처럼
 * 레시피 안에 넣은 레시피의 원가가 산출량 비율로 들어가는지, 못 푸는 줄(지워진 레시피,
 * 서로를 품은 레시피, 단위가 안 맞는 줄)을 0원 + «확인 필요»로 세는지 확인합니다.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/lib/recipeCost.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "ts", format: "esm", target: "es2020" });
const dir = mkdtempSync(join(tmpdir(), "recipe-cost-"));
const file = join(dir, "recipeCost.mjs");
writeFileSync(file, code);
const rc = await import(pathToFileURL(file).href);

const results = [];
function check(label, fn) {
  try {
    fn();
    results.push(`✅ ${label}`);
  } catch (error) {
    results.push(`❌ ${label}\n   ${error.message}`);
    process.exitCode = 1;
  }
}

let seq = 0;
const item = (name, quantity, unit, unitCost) => ({ id: `i${++seq}`, name, quantity, unit, unitCost });
const sub = (subRecipeId, quantity, unit) => ({ id: `s${++seq}`, name: "", quantity, unit, unitCost: 0, subRecipeId });
const recipe = (id, name, ingredients, extra = {}) => ({
  id, name, category: "", kind: "side", servings: 1, salePrice: 0, ingredients, ...extra,
});
const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} ≠ ${expected}`);

/* ── 기본 재료 ───────────────────────────────────────────── */

// 된장육수: 재료 12,000원어치로 2L 가 나온다 → ml 당 6원
const stock = recipe(1, "된장육수", [
  item("된장", 1, "kg", 8000),
  item("멸치", 0.2, "kg", 20000),
], { category: "육수·소스", yieldQuantity: 2, yieldUnit: "L" });

// 된장찌개: 육수 300ml + 두부 1모 + 돼지고기 200g, 2인분, 1인분 9,000원
const stew = recipe(2, "된장찌개", [
  sub(1, 300, "ml"),
  item("두부", 1, "ea", 1800),
  item("돼지고기", 0.2, "kg", 14000),
], { kind: "menu", servings: 2, salePrice: 9000 });

check("하위 레시피 없는 레시피는 예전 계산과 똑같다", () => {
  const coster = rc.createRecipeCoster([stock]);
  const cost = coster.recipe(stock);
  near(cost.totalCost, 12000, "총원가");
  near(cost.perServingCost, 12000, "1회 원가");
  assert.equal(cost.costRate, null, "상차림은 원가율 없음");
  assert.equal(cost.incomplete, 0);
  assert.deepEqual(cost.issues, []);
});

check("레시피를 ml 로 넣으면 산출량 비율만큼 들어간다 (2L 중 300ml)", () => {
  const coster = rc.createRecipeCoster([stock, stew]);
  const line = coster.ingredient(stew.ingredients[0], stew);
  near(line.unitCost, 6, "ml 당 단가");
  near(line.subtotal, 1800, "육수 300ml");
  const cost = coster.recipe(stew);
  near(cost.totalCost, 1800 + 1800 + 2800, "찌개 총원가");
  near(cost.perServingCost, 3200, "1인분 원가");
  near(cost.costRate, (3200 / 9000) * 100, "원가율");
  assert.equal(cost.incomplete, 0);
});

check("단위가 달라도 같은 계열이면 환산된다 (L 산출 ↔ 0.3L 투입)", () => {
  const stewL = { ...stew, ingredients: [sub(1, 0.3, "L"), ...stew.ingredients.slice(1)] };
  const coster = rc.createRecipeCoster([stock, stewL]);
  near(coster.ingredient(stewL.ingredients[0], stewL).subtotal, 1800, "0.3L = 300ml");
});

check("무게도 된다 (양념 1.5kg 산출 → 300g 투입)", () => {
  const sauce = recipe(3, "갈비양념", [item("간장", 1, "L", 4500)], { yieldQuantity: 1.5, yieldUnit: "kg" });
  const galbi = recipe(4, "돼지갈비", [sub(3, 300, "g")], { kind: "menu", servings: 1, salePrice: 16000 });
  const coster = rc.createRecipeCoster([sauce, galbi]);
  near(coster.recipe(galbi).totalCost, 900, "4,500원 × 300/1500");
});

check("회분으로 넣으면 한 번 만든 양 전체 원가 × 회분", () => {
  const ssamjang = recipe(5, "쌈장", [item("된장", 0.5, "kg", 8000), item("고추장", 0.5, "kg", 10000)]); // 9,000원, 산출량 없음
  const table = recipe(6, "기본 상차림", [sub(5, 0.25, rc.BATCH_UNIT)]);
  const coster = rc.createRecipeCoster([ssamjang, table]);
  near(coster.recipe(table).totalCost, 2250, "9,000원 × 0.25회분");
  assert.equal(coster.recipe(table).incomplete, 0);
});

check("산출량이 있어도 회분으로 넣을 수 있다", () => {
  const table = recipe(7, "육수 통째로", [sub(1, 1, rc.BATCH_UNIT)]);
  const coster = rc.createRecipeCoster([stock, table]);
  near(coster.recipe(table).totalCost, 12000, "1회분 = 2L 전체");
});

/* ── 바닥 재료값이 오르면 맨 위까지 ────────────────────── */

check("2단 중첩: 다시마물 → 된장육수 → 된장찌개, 바닥 값이 오르면 찌개까지 오른다", () => {
  const dashi = recipe(10, "다시마물", [item("다시마", 0.1, "kg", 30000)], { yieldQuantity: 4, yieldUnit: "L" }); // 3,000원 / 4L
  const stock2 = recipe(11, "된장육수", [sub(10, 2, "L"), item("된장", 1, "kg", 8000)], { yieldQuantity: 2, yieldUnit: "L" }); // 1,500 + 8,000 = 9,500 / 2L
  const stew2 = recipe(12, "된장찌개", [sub(11, 400, "ml")], { kind: "menu", salePrice: 9000 }); // 9,500 × 0.2 = 1,900
  near(rc.createRecipeCoster([dashi, stock2, stew2]).recipe(stew2).totalCost, 1900, "처음");

  const pricier = { ...dashi, ingredients: [item("다시마", 0.1, "kg", 50000)] }; // 5,000원 / 4L → 육수 10,500
  near(rc.createRecipeCoster([pricier, stock2, stew2]).recipe(stew2).totalCost, 2100, "다시마값이 오른 뒤");
});

/* ── 못 푸는 줄은 0원 + 확인 필요 — 지어내지 않는다 ─────── */

check("지워진 레시피를 가리키면 0원·확인 필요·이유", () => {
  const coster = rc.createRecipeCoster([stew]); // 된장육수가 없다
  const cost = coster.recipe(stew);
  near(cost.totalCost, 1800 + 2800, "육수 줄은 0원");
  assert.equal(cost.incomplete, 1);
  assert.equal(cost.issues[0].kind, "missing");
});

check("아직 레시피를 안 고른 줄(0)은 고르라고 한다", () => {
  const draft = recipe(0, "새 찌개", [sub(0, 300, "ml")]);
  const cost = rc.createRecipeCoster([stock]).recipe(draft);
  assert.equal(cost.issues[0].kind, "unpicked");
  assert.equal(cost.incomplete, 1);
});

check("산출량 없는 레시피를 ml 로 넣으면 0원 + 산출량을 적으라고 한다", () => {
  const noYield = { ...stock, yieldQuantity: 0, yieldUnit: "" };
  const cost = rc.createRecipeCoster([noYield, stew]).recipe(stew);
  near(cost.totalCost, 1800 + 2800, "육수 줄은 0원");
  assert.equal(cost.issues[0].kind, "no-yield");
  assert.match(cost.issues[0].message, /산출량/);
});

check("계열이 다른 단위(L 산출에 g 투입)는 환산하지 않는다", () => {
  const wrong = { ...stew, ingredients: [sub(1, 300, "g")] };
  const cost = rc.createRecipeCoster([stock, wrong]).recipe(wrong);
  near(cost.totalCost, 0, "0원");
  assert.equal(cost.issues[0].kind, "unit-mismatch");
  assert.match(cost.issues[0].message, /ml·L/);
});

check("서로를 품은 레시피(A→B→A)는 끝없이 돌지 않고 순환으로 잡는다", () => {
  const a = recipe(20, "A", [sub(21, 1, rc.BATCH_UNIT), item("소금", 1, "kg", 1000)]);
  const b = recipe(21, "B", [sub(20, 1, rc.BATCH_UNIT), item("설탕", 1, "kg", 2000)]);
  const cost = rc.createRecipeCoster([a, b]).recipe(a);
  assert.ok(Number.isFinite(cost.totalCost));
  assert.ok(cost.incomplete >= 1);
  assert.ok(cost.issues.some((issue) => issue.kind === "sub-incomplete" || issue.kind === "cycle"));
});

check("자기 자신을 넣어도 순환으로 잡는다", () => {
  const self = recipe(30, "자기", [sub(30, 1, rc.BATCH_UNIT)]);
  const cost = rc.createRecipeCoster([self]).recipe(self);
  assert.equal(cost.issues[0].kind, "cycle");
});

check("하위 레시피에 덜 된 재료가 있으면 윗줄도 확인 필요 (원가가 실제보다 작다)", () => {
  const halfStock = { ...stock, ingredients: [...stock.ingredients, item("다시마", 0.1, "kg", 0)] };
  const cost = rc.createRecipeCoster([halfStock, stew]).recipe(stew);
  near(cost.totalCost, 1800 + 1800 + 2800, "아는 만큼은 계산");
  assert.equal(cost.incomplete, 1);
  assert.equal(cost.issues[0].kind, "sub-incomplete");
});

/* ── 편집 중인 초안 ─────────────────────────────────────── */

check("편집 중인 초안은 저장본이 아니라 초안 값으로 계산한다", () => {
  const coster = rc.createRecipeCoster([stock, stew]);
  const draft = { ...stew, ingredients: [sub(1, 500, "ml")] }; // 저장본은 300ml
  near(coster.recipe(draft).totalCost, 3000, "500ml × 6원");
});

check("초안에서 자기를 품은 레시피를 넣으면 순환으로 잡는다", () => {
  // 저장된 된장육수가 이미 된장찌개(2)를 품고 있는 꼬인 데이터
  const tangled = { ...stock, ingredients: [...stock.ingredients, sub(2, 1, rc.BATCH_UNIT)] };
  const coster = rc.createRecipeCoster([tangled, stew]);
  const cost = coster.recipe(stew);
  assert.ok(Number.isFinite(cost.totalCost));
  assert.ok(cost.incomplete >= 1);
});

/* ── 고를 수 있는 레시피, 들어가는 곳 ──────────────────── */

check("넣을 수 있는 레시피에서 자기 자신과 자기를 품은 레시피는 빠진다", () => {
  const all = [stock, stew];
  assert.deepEqual(rc.usableSubRecipes(all, 1).map((r) => r.id), [], "된장육수에는 된장찌개를 못 넣는다");
  assert.deepEqual(rc.usableSubRecipes(all, 2).map((r) => r.id), [1], "된장찌개에는 된장육수를 넣는다");
  assert.deepEqual(rc.usableSubRecipes(all, 0).map((r) => r.id), [1, 2], "새 레시피는 전부");
});

check("들어가는 곳: 된장육수 → 된장찌개", () => {
  assert.deepEqual(rc.recipesUsing([stock, stew], 1).map((r) => r.name), ["된장찌개"]);
  assert.deepEqual(rc.recipesUsing([stock, stew], 2), []);
});

check("단위 고르기: 2L 육수는 ml·L·회분, 산출량 없으면 회분뿐", () => {
  assert.deepEqual(rc.unitsForSubRecipe(stock), ["ml", "L", rc.BATCH_UNIT]);
  assert.deepEqual(rc.unitsForSubRecipe({ yieldQuantity: 0, yieldUnit: "" }), [rc.BATCH_UNIT]);
  assert.deepEqual(rc.unitsForSubRecipe(undefined), [rc.BATCH_UNIT]);
});

check("단위를 바꾸면 양이 따라간다 (0.3L → 300ml), 회분은 그대로", () => {
  near(rc.convertSubQuantity(0.3, "L", "ml"), 300, "L→ml");
  near(rc.convertSubQuantity(300, "g", "kg"), 0.3, "g→kg");
  near(rc.convertSubQuantity(0.5, rc.BATCH_UNIT, "ml"), 0.5, "회분은 환산 안 함");
});

/* ── 1회 제공량을 양으로 (g·kg·ml·L) ─────────────────────── */

// 깻잎소스: 재료 60,000원어치로 12kg 가 나오고, 한 번에 50g 씩 담는다 → 240번, 1회 250원
const sauce = recipe(10, "깻잎소스", [
  item("설탕", 5, "kg", 2000),
  item("간장", 10, "L", 5000),
], { category: "육수·소스", yieldQuantity: 12, yieldUnit: "kg", servingUnit: "g", servingAmount: 50 });

check("1회 제공량을 g 로 적으면 전체 원가 × 50g ÷ 산출량 12kg (240번)", () => {
  const cost = rc.createRecipeCoster([sauce]).recipe(sauce);
  near(cost.totalCost, 60000, "총원가");
  near(cost.perServingCost, 250, "1회 원가");
  near(cost.serving.count, 240, "나가는 횟수");
  assert.equal(cost.serving.amountText, "50g");
  assert.equal(cost.serving.issue, null);
});

check("kg 로 적어도 같다 (0.05kg), 부피도 된다 (2L 육수를 300ml 씩)", () => {
  const inKg = { ...sauce, servingUnit: "kg", servingAmount: 0.05 };
  near(rc.createRecipeCoster([inKg]).recipe(inKg).perServingCost, 250, "0.05kg");
  const ladle = { ...stock, servingUnit: "ml", servingAmount: 300 };
  const cost = rc.createRecipeCoster([ladle]).recipe(ladle);
  near(cost.perServingCost, 1800, "2L 중 300ml");
  near(cost.serving.count, 2000 / 300, "횟수는 소수일 수 있다");
});

check("판매 메뉴도 1인분 양으로 — 원가율이 그 양으로 나온다 (갈비 5kg 중 250g)", () => {
  const ribs = recipe(11, "돼지갈비", [item("돼지갈비", 5, "kg", 14000)], {
    kind: "menu", salePrice: 14000, yieldQuantity: 5, yieldUnit: "kg", servingUnit: "g", servingAmount: 250,
  });
  const cost = rc.createRecipeCoster([ribs]).recipe(ribs);
  near(cost.perServingCost, 3500, "1인분 원가");
  near(cost.costRate, 25, "원가율");
});

check("산출량이 없으면 1회 원가를 모른다 — 0원·0% 가 아니라 까닭을 남긴다", () => {
  const noYield = { ...sauce, kind: "menu", salePrice: 5000, yieldQuantity: 0, yieldUnit: "" };
  const cost = rc.createRecipeCoster([noYield]).recipe(noYield);
  assert.match(cost.serving.issue ?? "", /산출량/);
  assert.equal(cost.perServingCost, 0);
  assert.equal(cost.costRate, null, "원가율도 모른다");
  near(cost.totalCost, 60000, "재료 전체는 그대로 보인다");
  assert.equal(cost.incomplete, 0, "재료 줄 문제와는 따로 센다");
});

check("계열이 다르면(2L 에 50g) 나누지 않고, 양을 안 적으면 적으라고 한다", () => {
  const mismatch = { ...stock, servingUnit: "g", servingAmount: 50 };
  assert.match(rc.servingPlan(mismatch).issue ?? "", /단위가 달라/);
  const noAmount = { ...sauce, servingAmount: 0 };
  assert.match(rc.servingPlan(noAmount).issue ?? "", /1회 제공량\(g\)을 적어/);
});

check("횟수로 적은 레시피는 예전 그대로 (빈 단위·모르는 단위는 횟수)", () => {
  const four = { ...sauce, servings: 4, servingUnit: "", servingAmount: 0 };
  near(rc.createRecipeCoster([four]).recipe(four).perServingCost, 15000, "60,000 ÷ 4");
  const odd = { ...sauce, servings: 4, servingUnit: "ea", servingAmount: 50 };
  near(rc.createRecipeCoster([odd]).recipe(odd).perServingCost, 15000, "ea 는 양이 아니다");
  assert.equal(rc.servingPlan(four).amountText, "");
  assert.deepEqual(["g", "kg", "ml", "L", "", "ea", "회", undefined].map((servingUnit) => rc.servesByAmount({ servingUnit })),
    [true, true, true, true, false, false, false, false]);
});

check("양으로 적은 레시피를 다른 레시피에 넣어도 단가는 산출량 기준 그대로 (12kg 중 100g)", () => {
  const salad = recipe(12, "샐러드", [sub(10, 100, "g")]);
  const line = rc.createRecipeCoster([sauce, salad]).ingredient(salad.ingredients[0], salad);
  near(line.unitCost, 5, "g 당 단가");
  near(line.subtotal, 500, "100g");
});

console.log(results.join("\n"));
console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
