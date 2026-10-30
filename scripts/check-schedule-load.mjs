/**
 * 근무표의 예약 인원 점검 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:scheduleload
 *
 * src/lib/scheduleLoad.ts 를 esbuild 로 변환해 불러온 뒤, 날짜·오전/오후별 예약 팀·인원을 어떻게 세는지 본다.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/lib/scheduleLoad.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "ts", format: "esm", target: "es2020" });
const dir = mkdtempSync(join(tmpdir(), "schedule-load-"));
const file = join(dir, "scheduleLoad.mjs");
writeFileSync(file, code);
const sl = await import(pathToFileURL(file).href);

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

const resv = (date, time, people, status = "예약확정") => ({ id: Math.random(), date, time, people, status, name: "", phone: "", seat: "", writer: "", createdAt: "" });

check("날짜별 팀·인원, 오전(15:00 전)·오후로 가른다 — 취소·노쇼는 안 센다", () => {
  const loads = sl.reservationLoadByDate([
    resv("2026-10-20", "11:30", 4),
    resv("2026-10-20", "14:59", 2, "단체"),
    resv("2026-10-20", "15:00", 6),
    resv("2026-10-20", "18:30", 3, "방문완료"),
    resv("2026-10-20", "12:00", 9, "취소"),
    resv("2026-10-20", "19:00", 5, "노쇼"),
    resv("2026-10-21", "12:00", 2, "예약대기"),
    resv("2026-10-30", "12:00", 7), // 고른 날짜 밖
  ], ["2026-10-20", "2026-10-21", "2026-10-22"]);
  assert.deepEqual(loads.get("2026-10-20"), {
    teams: 4, people: 15, morning: { teams: 2, people: 6 }, afternoon: { teams: 2, people: 9 },
  });
  assert.deepEqual(loads.get("2026-10-21"), { teams: 1, people: 2, morning: { teams: 1, people: 2 }, afternoon: { teams: 0, people: 0 } });
  assert.deepEqual(loads.get("2026-10-22"), { teams: 0, people: 0, morning: { teams: 0, people: 0 }, afternoon: { teams: 0, people: 0 } }, "예약 없는 날도 0 으로");
  assert.equal(loads.has("2026-10-30"), false);
});

check("글 — 「예약 12팀 48명」, 없으면 「예약 없음」", () => {
  assert.equal(sl.loadText({ teams: 12, people: 48 }), "예약 12팀 48명");
  assert.equal(sl.loadText({ teams: 0, people: 0 }), "예약 없음");
  assert.equal(sl.loadText(undefined), "예약 없음");
  assert.equal(sl.MORNING_CUTOFF, "15:00");
});

console.log(results.join("\n"));
console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
