/**
 * 출퇴근·휴게 계산 점검 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:attendance
 *
 * src/lib/attendance.ts 를 esbuild 로 변환해 불러온 뒤, 상태 전이와 시간 계산,
 * 그리고 «잘못 눌러 남은 기록» 을 어떻게 무시하는지 확인합니다. 기록은 Rules 상
 * 지울 수 없으므로 이 무시 규칙이 곧 데이터 정합성입니다.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/lib/attendance.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "ts", format: "esm", target: "es2020" });
const dir = mkdtempSync(join(tmpdir(), "attendance-"));
const file = join(dir, "attendance.mjs");
writeFileSync(file, code);
const att = await import(pathToFileURL(file).href);

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

const DATE = "2026-09-10";
let seq = 0;
/** 기록 한 줄. id 는 같은 시각끼리의 순서를 가르는 데만 쓴다. */
function log(type, time, date = DATE) {
  seq += 1;
  // createdAt 은 저장 순서. 실제로는 serverTimestamp 가 채운다.
  return { id: `log${String(seq).padStart(3, "0")}`, empId: 1, date, type, time, createdAt: seq };
}

const fold = (logs, now = "23:59") => att.foldAttendanceDay(logs, DATE, 1, now);

check("아무 기록도 없으면 출근 전", () => {
  const day = fold([]);
  assert.equal(day.status, "before");
  assert.equal(day.inAt, null);
  assert.equal(day.workedMinutes, 0);
});

check("출근만 하면 근무중이고, 지금까지가 근무 시간", () => {
  const day = fold([log("in", "10:00")], "12:30");
  assert.equal(day.status, "working");
  assert.equal(day.inAt, "10:00");
  assert.equal(day.workedMinutes, 150);
});

check("휴게 중에는 근무 시간이 늘지 않는다", () => {
  const logs = [log("in", "10:00"), log("breakStart", "12:00")];
  assert.equal(fold(logs, "12:00").workedMinutes, 120);
  assert.equal(fold(logs, "12:40").workedMinutes, 120, "휴게 40분이 지나도 그대로여야 한다");
  assert.equal(fold(logs, "12:40").status, "onBreak");
});

check("휴게를 마치면 다시 흐른다", () => {
  const logs = [log("in", "10:00"), log("breakStart", "12:00"), log("breakEnd", "12:30")];
  const day = fold(logs, "13:00");
  assert.equal(day.status, "working");
  assert.equal(day.breakMinutes, 30);
  assert.equal(day.workedMinutes, 150, "3시간에서 휴게 30분을 뺀 값");
});

check("퇴근하면 시각이 고정된다", () => {
  const logs = [log("in", "10:00"), log("breakStart", "12:00"), log("breakEnd", "13:00"), log("out", "18:00")];
  const day = fold(logs, "23:00");
  assert.equal(day.status, "done");
  assert.equal(day.outAt, "18:00");
  assert.equal(day.breakMinutes, 60);
  assert.equal(day.workedMinutes, 420, "8시간에서 휴게 1시간");
});

check("자정을 넘겨 퇴근해도 음수가 안 된다", () => {
  const day = fold([log("in", "18:00"), log("out", "01:30")]);
  assert.equal(day.workedMinutes, 450, "7시간 30분");
});

check("출근을 두 번 눌러도 첫 시각을 쓴다", () => {
  const day = fold([log("in", "10:00"), log("in", "10:05")], "11:00");
  assert.equal(day.inAt, "10:00");
  assert.equal(day.workedMinutes, 60);
});

check("휴게 시작 없이 종료를 누르면 무시한다", () => {
  const day = fold([log("in", "10:00"), log("breakEnd", "12:00")], "13:00");
  assert.equal(day.status, "working");
  assert.equal(day.breakMinutes, 0);
});

check("휴게 시작을 두 번 눌러도 하나로 본다", () => {
  const logs = [log("in", "10:00"), log("breakStart", "12:00"), log("breakStart", "12:10"), log("breakEnd", "12:30")];
  const day = fold(logs, "13:00");
  assert.equal(day.breaks.length, 1);
  assert.equal(day.breakMinutes, 30);
});

check("출근 전 휴게 기록은 무시한다", () => {
  const day = fold([log("breakStart", "09:00"), log("in", "10:00")], "11:00");
  assert.equal(day.status, "working");
  assert.equal(day.breaks.length, 0);
});

check("저장 순서가 없으면 시각으로 줄 세운다 (옛 기록)", () => {
  const bare = [
    { id: "a", empId: 1, date: DATE, type: "in", time: "10:00" },
    { id: "b", empId: 1, date: DATE, type: "out", time: "18:00" },
  ];
  const day = att.foldAttendanceDay(bare, DATE, 1, "23:00");
  assert.equal(day.workedMinutes, 480);
});

check("퇴근 뒤의 기록은 무시한다", () => {
  const logs = [log("in", "10:00"), log("out", "18:00"), log("breakStart", "19:00"), log("out", "20:00")];
  const day = fold(logs);
  assert.equal(day.outAt, "18:00");
  assert.equal(day.breaks.length, 0);
});

check("휴게를 안 끝내고 퇴근하면 퇴근 시각에 닫힌다", () => {
  const day = fold([log("in", "10:00"), log("breakStart", "17:00"), log("out", "18:00")]);
  assert.equal(day.breakMinutes, 60);
  assert.equal(day.workedMinutes, 420);
});

check("출근 없이 퇴근만 누르면 출근 전 그대로", () => {
  const day = fold([log("out", "18:00")]);
  assert.equal(day.status, "before");
  assert.equal(day.outAt, null);
});

check("한 달 합계는 기록이 있는 날만 센다", () => {
  const logs = [
    log("in", "10:00", "2026-09-01"), log("out", "18:00", "2026-09-01"),
    log("in", "10:00", "2026-09-02"), log("breakStart", "12:00", "2026-09-02"),
    log("breakEnd", "13:00", "2026-09-02"), log("out", "19:00", "2026-09-02"),
  ];
  const days = att.foldAttendanceMonth(logs, 1, "23:59");
  assert.equal(days.length, 2);
  const totals = att.monthTotals(days);
  assert.equal(totals.workedDays, 2);
  assert.equal(totals.totalMinutes, 480 + 480, "8시간 + (9시간 - 휴게 1시간)");
  assert.equal(totals.breakMinutes, 60);
});

check("누를 수 있는 버튼이 상태를 따른다", () => {
  assert.equal(att.canPunch("before", "in"), true);
  assert.equal(att.canPunch("before", "out"), false);
  assert.equal(att.canPunch("before", "breakStart"), false);
  assert.equal(att.canPunch("working", "in"), false);
  assert.equal(att.canPunch("working", "breakStart"), true);
  assert.equal(att.canPunch("working", "breakEnd"), false);
  assert.equal(att.canPunch("onBreak", "breakEnd"), true);
  assert.equal(att.canPunch("onBreak", "breakStart"), false);
  assert.equal(att.canPunch("onBreak", "out"), true, "휴게 중에도 퇴근은 눌러야 한다");
  assert.equal(att.canPunch("done", "in"), false);
  assert.equal(att.canPunch("done", "out"), false);
});

check("시간 표기", () => {
  assert.equal(att.fmtMinutes(0), "0분");
  assert.equal(att.fmtMinutes(45), "45분");
  assert.equal(att.fmtMinutes(60), "1시간");
  assert.equal(att.fmtMinutes(450), "7시간 30분");
  assert.equal(att.fmtMinutes(-5), "0분");
});

console.log(results.join("\n"));
console.log(
  process.exitCode
    ? "\n검사에 실패한 항목이 있습니다."
    : "\n모든 검사를 통과했습니다."
);
