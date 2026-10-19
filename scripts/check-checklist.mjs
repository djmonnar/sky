/**
 * 체크리스트 계산 점검 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:checklist
 *
 * src/lib/checklist.ts 를 esbuild 로 변환해 불러온 뒤, 요일 고정 항목이 그 요일에만
 * 나오는지, 체크한 기록이 템플릿을 고쳐도 남는지, 저장 전 다듬기가 맞는지 확인합니다.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/lib/checklist.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "ts", format: "esm", target: "es2020" });
const dir = mkdtempSync(join(tmpdir(), "checklist-"));
const file = join(dir, "checklist.mjs");
writeFileSync(file, code);
const cl = await import(pathToFileURL(file).href);

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

const MON = "2026-10-19"; // 월요일
const TUE = "2026-10-20";
const SUN = "2026-10-25";

const template = {
  items: [
    { id: "o1", section: "open", text: "환기", days: [] },
    { id: "o2", section: "open", text: "기름 교체", days: [1] }, // 매주 화
    { id: "c1", section: "close", text: "가스 밸브", days: [] },
    { id: "c2", section: "close", text: "대청소", days: [5, 6] }, // 주말
  ],
};

check("요일: 2026-10-19 는 월요일(0), 10-25 는 일요일(6)", () => {
  assert.equal(cl.weekdayOf(MON), 0);
  assert.equal(cl.weekdayOf(TUE), 1);
  assert.equal(cl.weekdayOf(SUN), 6);
});

check("요일 표시: 매일·매주 화·평일·주말·여러 요일", () => {
  assert.equal(cl.daysLabel([]), "매일");
  assert.equal(cl.daysLabel([0, 1, 2, 3, 4, 5, 6]), "매일");
  assert.equal(cl.daysLabel([1]), "매주 화");
  assert.equal(cl.daysLabel([0, 1, 2, 3, 4]), "평일");
  assert.equal(cl.daysLabel([6, 5]), "주말");
  assert.equal(cl.daysLabel([3, 0, 3]), "매주 월·목");
});

check("요일 고정 항목은 그 요일에만 나온다", () => {
  const mon = cl.dayRows(template, null, MON).map((row) => row.id);
  const tue = cl.dayRows(template, null, TUE).map((row) => row.id);
  const sun = cl.dayRows(template, null, SUN).map((row) => row.id);
  assert.deepEqual(mon, ["o1", "c1"]);
  assert.deepEqual(tue, ["o1", "o2", "c1"]);
  assert.deepEqual(sun, ["o1", "c1", "c2"]);
  assert.equal(cl.dayRows(template, null, TUE)[1].schedule, "매주 화");
  assert.equal(cl.dayRows(template, null, TUE)[0].schedule, null, "매일 하는 것은 표시 없음");
});

check("체크 상태와 누가·언제를 붙인다 (해제된 칸은 누가를 안 보인다)", () => {
  const day = {
    date: MON, note: "",
    checks: {
      o1: { checked: true, text: "환기", section: "open", by: "김현지", at: "2026-10-19 10:12" },
      c1: { checked: false, text: "가스 밸브", section: "close", by: "이바다", at: "2026-10-19 21:00" },
    },
  };
  const rows = cl.dayRows(template, day, MON);
  assert.equal(rows[0].checked, true);
  assert.equal(rows[0].by, "김현지");
  assert.equal(rows[1].checked, false);
  assert.equal(rows[1].by, undefined);
});

check("오픈·마감 따로 진행률", () => {
  const day = { date: TUE, note: "", checks: { o1: { checked: true, text: "환기", section: "open" } } };
  const rows = cl.dayRows(template, day, TUE);
  assert.deepEqual(cl.progressOf(rows, "open"), { done: 1, total: 2 });
  assert.deepEqual(cl.progressOf(rows, "close"), { done: 0, total: 1 });
});

check("체크한 뒤 사장님이 항목을 지워도 그날 기록은 남는다 (지운 항목, 진행률에서는 뺀다)", () => {
  const day = { date: MON, note: "", checks: { gone: { checked: true, text: "옛 항목", section: "close", by: "김현지" } } };
  const rows = cl.dayRows(template, day, MON);
  const gone = rows.find((row) => row.id === "gone");
  assert.ok(gone, "남아야 함");
  assert.equal(gone.removed, true);
  assert.equal(gone.text, "옛 항목");
  assert.equal(rows[rows.length - 1].id, "gone", "섹션 맨 뒤");
  assert.deepEqual(cl.progressOf(rows, "close"), { done: 0, total: 1 });
});

check("체크를 풀어 둔 지운 항목은 안 보인다", () => {
  const day = { date: MON, note: "", checks: { gone: { checked: false, text: "옛 항목", section: "open" } } };
  assert.ok(!cl.dayRows(template, day, MON).some((row) => row.id === "gone"));
});

check("템플릿이 없으면 빈 목록 (기록만 있으면 그것만)", () => {
  assert.deepEqual(cl.dayRows(null, null, MON), []);
  const day = { date: MON, note: "", checks: { x: { checked: true, text: "임시", section: "open" } } };
  assert.equal(cl.dayRows(null, day, MON).length, 1);
});

check("저장 전 다듬기: 빈 글·겹치는 id 버림, 요일 정리, 7일 전부면 매일", () => {
  const cleaned = cl.cleanTemplate([
    { id: "a", section: "open", text: "  환기   하기 ", days: [2, 0, 2, 9] },
    { id: "b", section: "close", text: "   ", days: [] },
    { id: "a", section: "close", text: "중복", days: [] },
    { id: "c", section: "weird", text: "섹션 이상", days: [0, 1, 2, 3, 4, 5, 6] },
  ]);
  assert.deepEqual(cleaned, [
    { id: "a", section: "open", text: "환기 하기", days: [0, 2] },
    { id: "c", section: "open", text: "섹션 이상", days: [] },
  ]);
});

check("예시 항목은 오픈·마감에 넷씩, id 는 만들어 준 것", () => {
  let n = 0;
  const items = cl.exampleTemplate(() => `id${++n}`);
  assert.equal(items.filter((item) => item.section === "open").length, 4);
  assert.equal(items.filter((item) => item.section === "close").length, 4);
  assert.equal(new Set(items.map((item) => item.id)).size, 8);
});

console.log(results.join("\n"));
console.log(process.exitCode ? "\n검사에 실패한 항목이 있습니다." : "\n모든 검사를 통과했습니다.");
