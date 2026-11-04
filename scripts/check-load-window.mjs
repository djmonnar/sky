/**
 * 처음 열 때 받아 오는 근무표 범위 점검 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:loadwindow
 *
 * src/lib/loadWindow.ts 를 esbuild 로 변환해 불러온 뒤, 지난달 1일을 고르는지(해 넘김 포함), 날짜 더하기,
 * 범위는 넓히기만 하는지 본다.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/lib/loadWindow.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "ts", format: "esm", target: "es2020" });
const dir = mkdtempSync(join(tmpdir(), "load-window-"));
const file = join(dir, "loadWindow.mjs");
writeFileSync(file, code);
const lw = await import(pathToFileURL(file).href);

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

check("지난달 1일부터 — 해 넘김·말일도", () => {
  assert.equal(lw.shiftsWindowStart("2026-11-04"), "2026-10-01");
  assert.equal(lw.shiftsWindowStart("2026-01-15"), "2025-12-01");
  assert.equal(lw.shiftsWindowStart("2026-03-31"), "2026-02-01");
});

check("날짜 더하기 — 달·해 넘김", () => {
  assert.equal(lw.addDaysTo("2026-11-02", -7), "2026-10-26");
  assert.equal(lw.addDaysTo("2026-01-03", -7), "2025-12-27");
  assert.equal(lw.addDaysTo("2028-02-28", 1), "2028-02-29");
});

check("범위는 넓히기만 — 늦은 날·모양이 다른 값은 무시", () => {
  assert.equal(lw.widenWindow("2026-10-01", "2026-08-01"), "2026-08-01");
  assert.equal(lw.widenWindow("2026-10-01", "2026-11-01"), "2026-10-01");
  assert.equal(lw.widenWindow("2026-10-01", "2026-08"), "2026-10-01");
  assert.equal(lw.widenWindow("2026-10-01", ""), "2026-10-01");
});

console.log(results.join("\n"));
