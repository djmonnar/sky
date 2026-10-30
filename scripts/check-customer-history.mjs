/**
 * 손님 이력(단골·노쇼) 점검 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:history
 *
 * src/lib/customerHistory.ts 를 esbuild 로 묶어 불러온 뒤, 같은 번호의 지난 예약을 어떻게 세는지 본다 —
 * 번호 모양이 달라도 같은 손님, 이름만 같으면 다른 손님, 지난 날짜 확정은 다녀간 것, 자기 자신은 안 센다.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "customer-history-"));
const outfile = join(dir, "customerHistory.mjs");
buildSync({
  entryPoints: [fileURLToPath(new URL("../src/lib/customerHistory.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile,
  logLevel: "silent",
});
const ch = await import(pathToFileURL(outfile).href);

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

const TODAY = "2026-10-30";
let seq = 0;
const resv = (date, status, phone = "010-1234-5678", extra = {}) => ({
  id: ++seq, date, time: "18:00", name: "김하늘", phone, people: 2, seat: "", status, writer: "직원", createdAt: "", ...extra,
});

const history = [
  resv("2026-08-02", "방문완료"),
  resv("2026-09-14", "예약확정"), // 지난 날짜 확정 = 다녀감(방문완료를 안 누른 날)
  resv("2026-09-20", "단체"),
  resv("2026-10-01", "노쇼"),
  resv("2026-10-05", "취소"),
  resv("2026-10-10", "예약대기"), // 지난 대기는 다녀간 것이 아니다
  resv("2026-11-03", "예약확정", "01012345678"), // 앞날 예약 — 번호 모양이 달라도 같은 손님
  resv("2026-10-12", "방문완료", "010-9999-0000", { name: "김하늘" }), // 이름만 같은 다른 손님
];
const index = ch.buildCustomerIndex(history);
const current = resv(TODAY, "예약확정", "+82 10-1234-5678");

check("같은 번호의 지난 예약을 센다 — 다녀감(방문완료 + 지난 날짜 확정·단체)·노쇼·취소·앞날 예약", () => {
  const h = ch.customerHistory(index, current.phone, TODAY, current.id);
  assert.deepEqual(h, { total: 7, visits: 3, noShows: 1, cancels: 1, lastVisit: "2026-09-20", upcoming: 1, regular: true });
});

check("요약 글 — 0 인 칸은 안 적고, 올해는 월/일만", () => {
  const h = ch.customerHistory(index, current.phone, TODAY, current.id);
  assert.equal(ch.historySummary(h, TODAY), "방문 3번 · 노쇼 1번 · 취소 1번 · 마지막 방문 9/20 · 다른 예약 1건");
  assert.equal(
    ch.historySummary({ total: 1, visits: 1, noShows: 0, cancels: 0, lastVisit: "2025-12-24", upcoming: 0, regular: false }, TODAY),
    "방문 1번 · 마지막 방문 2025/12/24",
  );
  assert.equal(
    ch.historySummary({ total: 1, visits: 0, noShows: 1, cancels: 0, lastVisit: null, upcoming: 0, regular: false }, TODAY),
    "다녀간 기록 없음 · 노쇼 1번",
  );
});

check("이름만 같은 다른 번호는 합치지 않는다 — 남의 노쇼가 붙지 않게", () => {
  const other = ch.customerHistory(index, "010-9999-0000", TODAY);
  assert.equal(other.total, 1);
  assert.equal(other.noShows, 0);
  assert.equal(other.regular, false);
});

check("자기 자신은 안 센다 — 이 번호의 예약이 이것 하나면 «처음 오시는 손님»(null)", () => {
  const only = resv(TODAY, "예약확정", "010-5555-6666");
  const idx = ch.buildCustomerIndex([...history, only]);
  assert.equal(ch.customerHistory(idx, only.phone, TODAY, only.id), null);
  assert.equal(ch.customerHistory(idx, "", TODAY), null, "번호가 없으면 이력도 없다");
  assert.equal(ch.customerHistory(idx, "모름", TODAY), null);
});

check("단골은 다녀감 3번부터, 오늘 예약은 아직 다녀간 것이 아니다", () => {
  const two = [resv("2026-09-01", "방문완료", "010-7777-8888"), resv("2026-09-08", "방문완료", "010-7777-8888"), resv(TODAY, "예약확정", "010-7777-8888")];
  const h = ch.customerHistory(ch.buildCustomerIndex(two), "010-7777-8888", TODAY);
  assert.equal(h.visits, 2);
  assert.equal(h.upcoming, 1, "오늘 확정은 앞날 예약으로 센다");
  assert.equal(h.regular, false);
  assert.equal(ch.REGULAR_VISITS, 3);
});

console.log(results.join("\n"));
console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
