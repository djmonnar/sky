/**
 * 손익 고정비 점검 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:fixedcost
 *
 * src/lib/fixedCosts.ts 를 esbuild 로 변환해 불러온 뒤, 저장 모양(이름 없는 줄·음수·소수), 합계, 지난달 계산,
 * 지난달 가져오기(새 id), 규칙(관리자만·50개·정해진 칸)이 화면 상한과 같은지 본다.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/lib/fixedCosts.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "ts", format: "esm", target: "es2020" });
const dir = mkdtempSync(join(tmpdir(), "fixed-costs-"));
const file = join(dir, "fixedCosts.mjs");
writeFileSync(file, code);
const fc = await import(pathToFileURL(file).href);
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

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

check("저장 모양 — 이름 다듬기, 이름 없는 줄 빼기, 금액은 0 이상 정수", () => {
  const clean = fc.cleanFixedCostItems([
    { id: "a", name: "  임대료 ", amount: 3_300_000 },
    { id: "b", name: "", amount: 50_000 },
    { id: "c", name: "전기", amount: -10 },
    { id: "d", name: "가스", amount: 620_000.6 },
    { id: "", name: "수도", amount: "88000" },
  ]);
  assert.deepEqual(clean.map(({ name, amount }) => [name, amount]), [["임대료", 3_300_000], ["전기", 0], ["가스", 620_001], ["수도", 88_000]]);
  assert.ok(clean[3].id, "id 가 없으면 만든다");
});

check("합계", () => {
  assert.equal(fc.sumFixedCosts([{ id: "a", name: "임대료", amount: 3_300_000 }, { id: "b", name: "관리비", amount: 450_000 }]), 3_750_000);
  assert.equal(fc.sumFixedCosts([]), 0);
});

check("지난달 — 1월이면 지난해 12월", () => {
  assert.equal(fc.previousMonth("2026-11"), "2026-10");
  assert.equal(fc.previousMonth("2026-01"), "2025-12");
  assert.equal(fc.previousMonth("2026-10"), "2026-09");
});

check("지난달 그대로 가져오기 — 이름·금액은 그대로, id 는 새로", () => {
  const before = [{ id: "rent", name: "임대료", amount: 3_300_000 }, { id: "x", name: " ", amount: 1 }];
  const copied = fc.copyFixedCosts(before);
  assert.deepEqual(copied.map(({ name, amount }) => [name, amount]), [["임대료", 3_300_000]]);
  assert.notEqual(copied[0].id, "rent");
});

check("상한 50개 — 화면과 규칙이 같다", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: String(i), name: `항목${i}`, amount: 1 }));
  assert.equal(fc.cleanFixedCostItems(many).length, fc.FIXED_COST_MAX_ITEMS);
  assert.equal(fc.FIXED_COST_MAX_ITEMS, 50);
  const start = rules.indexOf("match /fixedCosts/{month}");
  const block = rules.slice(start, rules.indexOf("\n      }", start));
  assert.match(block, /allow read: if isAdmin\(storeId\);/, "관리자만 읽는다");
  assert.match(block, /allow write: if isAdmin\(storeId\)/, "관리자만 쓴다");
  assert.match(block, /items\.size\(\) <= 50/);
  assert.match(block, /hasOnly\(\["month", "items", "updatedAt", "updatedBy"\]\)/);
});

console.log(results.join("\n"));
console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
