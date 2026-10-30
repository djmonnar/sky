/**
 * 매입 단가 변동 → 레시피 원가율 경고 점검 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:pricewatch
 *
 * src/lib/priceWatch.ts 를 esbuild 로 묶어 불러온 뒤, 최근 매입 단가를 어떻게 고르는지(취소·임시 빼고 가장 늦은 것),
 * 이름이 같은 재료만 견주는지, 못 바꾸는 단위(kg↔ea)는 견주지 않는지, 3% 미만 끝수는 안 울리는지, 반영하면
 * 그 재료 단가만 바뀌는지 본다.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "price-watch-"));
const outfile = join(dir, "priceWatch.mjs");
buildSync({
  entryPoints: [fileURLToPath(new URL("../src/lib/priceWatch.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile,
  logLevel: "silent",
});
const pw = await import(pathToFileURL(outfile).href);

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

const order = (id, status, date, items, vendorName = "하늘식자재") => ({
  id, vendorId: 1, vendorName, status, items, totalAmount: 0, createdAt: `${date}T01:00:00.000Z`, receivedAt: status === "received" ? `${date}T05:00:00.000Z` : undefined,
});
const item = (name, unitPrice, unit = "kg") => ({ inventoryItemId: 0, name, qty: 1, unit, unitPrice, totalPrice: unitPrice });
const ing = (id, name, quantity, unit, unitCost) => ({ id, name, quantity, unit, unitCost });
const recipe = (id, name, ingredients, extra = {}) => ({ id, name, category: "", kind: "menu", servings: 1, salePrice: 10_000, ingredients, ...extra });

const orders = [
  order(1, "received", "2026-10-01", [item("설탕", 2_000), item("간장", 5_000, "L")]),
  order(2, "received", "2026-10-24", [item("설 탕", 2_300), item("양파", 1_500, "ea")]), // 띄어쓰기만 다른 같은 재료, 가장 늦음
  order(3, "canceled", "2026-10-28", [item("설탕", 9_999)]), // 취소는 안 본다
  order(4, "draft", "2026-10-29", [item("간장", 9_999, "L")]), // 임시 저장도 안 본다
  order(5, "ordered", "2026-10-20", [item("깻잎", 12, "g")]),
];

const recipes = [
  recipe(1, "깻잎소스", [ing("a", "설탕", 5, "kg", 2_000), ing("b", "간장", 1, "L", 5_000)]),
  recipe(2, "제육", [ing("c", "설탕", 100, "g", 2.0), ing("d", "양파", 2, "kg", 1_000), ing("e", "돼지고기", 1, "kg", 14_000)]),
  recipe(3, "깻잎절임", [ing("f", "깻잎", 0.5, "kg", 12_300)]), // 12원/g = 12,000원/kg — 2.4% 차이라 안 울린다
  recipe(4, "된장찌개", [{ ...ing("g", "된장육수", 300, "ml", 6), subRecipeId: 9 }]), // 하위 레시피 줄은 안 센다
];

check("최근 매입 단가 — 취소·임시 저장 빼고 가장 늦은 것, 이름은 띄어쓰기 무시", () => {
  const latest = pw.latestPurchasePrices(orders);
  assert.equal(latest.get("설탕").unitPrice, 2_300);
  assert.equal(latest.get("설탕").date, "2026-10-24");
  assert.equal(latest.get("간장").unitPrice, 5_000, "임시 저장 9,999 는 안 본다");
  assert.equal(pw.ingredientKey(" 설 탕 "), "설탕");
});

check("바뀐 재료 — 같은 이름, 같은 계열 단위(kg↔g)만 견주고, 3% 미만은 안 울린다", () => {
  const watch = pw.findPriceChanges(recipes, orders);
  assert.equal(watch.changes.length, 1, JSON.stringify(watch.changes.map((c) => c.name)));
  const sugar = watch.changes[0];
  assert.equal(sugar.key, "설탕");
  assert.ok(Math.abs(sugar.change - 0.15) < 1e-9, `${sugar.change}`);
  assert.equal(sugar.oldPriceInPurchaseUnit, 2_000);
  assert.deepEqual(sugar.uses.map((u) => [u.recipeName, u.unit, u.oldUnitCost, Number(u.newUnitCost.toFixed(4))]), [
    ["깻잎소스", "kg", 2_000, 2_300],
    ["제육", "g", 2, 2.3],
  ]);
  // 설탕×2·간장·양파·깻잎 = 매입 품목과 이름이 맞는 5개 / 하위 레시피 줄 뺀 6개(돼지고기는 매입 없음), 양파는 ea↔kg 라 못 견줌
  assert.deepEqual([watch.matched, watch.total, watch.unitMismatch], [5, 6, 1]);
});

check("단위를 못 바꾸면 견주지 않는다 — kg 단가와 ea 단가를 비교해 엉뚱한 «올랐다»를 만들지 않는다", () => {
  assert.equal(pw.comparableUnits("kg", "g"), true);
  assert.equal(pw.comparableUnits("L", "ml"), true);
  assert.equal(pw.comparableUnits("ea", "ea"), true);
  assert.equal(pw.comparableUnits("kg", "ea"), false);
  assert.equal(pw.comparableUnits("kg", "ml"), false);
});

check("내린 재료도 알린다(많이 오른 것부터) — 반영하면 그 재료 단가만 바뀐다", () => {
  const cheaper = [order(10, "received", "2026-10-25", [item("간장", 4_000, "L")])];
  const watch = pw.findPriceChanges(recipes, [...orders, ...cheaper]);
  assert.deepEqual(watch.changes.map((c) => [c.name, Math.round(c.change * 100)]), [["설 탕", 15], ["간장", -20]]);
  const updated = pw.applyPriceChange(recipes, watch.changes[0]);
  assert.deepEqual(updated.map((r) => r.name), ["깻잎소스", "제육"]);
  assert.equal(updated[0].ingredients.find((i) => i.id === "a").unitCost, 2_300);
  assert.equal(updated[0].ingredients.find((i) => i.id === "b").unitCost, 5_000, "간장은 그대로");
  assert.equal(updated[1].ingredients.find((i) => i.id === "c").unitCost, 2.3);
  assert.equal(pw.PRICE_CHANGE_THRESHOLD, 0.03);
});

console.log(results.join("\n"));
console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
