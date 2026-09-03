/**
 * POS 매출 집계 로직 점검 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:pos
 *
 * src/lib/posSales.ts 를 esbuild 로 변환해 불러온 뒤, 주·월 묶기, 범위 합계,
 * 직전 기간 비교, 달력 격자, 프리셋, 금액 표기를 확인합니다.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/lib/posSales.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "ts", format: "esm", target: "es2020" });
const dir = mkdtempSync(join(tmpdir(), "pos-sales-"));
const file = join(dir, "posSales.mjs");
writeFileSync(file, code);
const pos = await import(pathToFileURL(file).href);

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

function row(businessDate, netAmount, extra = {}) {
  return { id: businessDate, businessDate, netAmount, orderCount: 0, canceledCount: 0, grossAmount: netAmount, discountAmount: 0, refundAmount: 0, averageOrderAmount: 0, paymentTotals: [], ...extra };
}

// 2026-09-03 은 목요일
const TODAY = "2026-09-03";

check("날짜 산술: 주 시작(월)·끝(일), 월 끝, 월 이동", () => {
  assert.equal(pos.dowMon("2026-09-03"), 3, "목요일 = 3");
  assert.equal(pos.startOfWeek("2026-09-03"), "2026-08-31");
  assert.equal(pos.endOfWeek("2026-09-03"), "2026-09-06");
  assert.equal(pos.endOfMonth("2026-02-10"), "2026-02-28");
  assert.equal(pos.endOfMonth("2028-02-10"), "2028-02-29", "윤년");
  assert.equal(pos.shiftMonth("2026-01", -1), "2025-12");
  assert.equal(pos.shiftMonth("2026-12", 1), "2027-01");
  assert.equal(pos.daysBetween("2026-09-01", "2026-09-03"), 3, "양 끝 포함");
  assert.deepEqual(pos.clampRange("2026-09-05", "2026-09-01"), { start: "2026-09-01", end: "2026-09-05" });
});

check("금액 표기: 만·억 축약, 축 눈금", () => {
  assert.equal(pos.compactWon(4_289_200), "429만");
  assert.equal(pos.compactWon(12_941_200), "1,294만");
  assert.equal(pos.compactWon(128_000_000), "1.3억");
  assert.equal(pos.compactWon(100_000_000), "1억");
  assert.equal(pos.compactWon(8_500), "8,500");
  assert.equal(pos.compactWon(0), "0");
  assert.equal(pos.fullWon(4_289_200), "4,289,200원");
  assert.equal(pos.niceMax(4_784_000), 5_000_000);
  assert.equal(pos.niceMax(12_941_200), 15_000_000);
  assert.equal(pos.niceMax(25_440_000), 30_000_000, "막대가 차트의 85% 를 채운다 (5,000만이면 절반이 빈다)");
  assert.equal(pos.niceMax(1_000_000), 1_000_000);
  assert.equal(pos.niceMax(0), 1);
});

check("범위 합계: 데이터 없는 날은 평균에서 빼고, 최고일과 직전 기간을 낸다", () => {
  const index = pos.indexByDate([
    row("2026-09-01", 3_868_000),
    row("2026-09-02", 4_784_000),
    row("2026-09-03", 4_289_200),
    row("2026-08-30", 1_000_000),
    row("2026-08-31", 2_795_000),
  ]);
  // 오늘이 9/3 인데 9/1~9/4 를 골랐다: 지난 날은 3일, 9/4 는 아직 오지 않았다
  const stats = pos.rangeStats(index, { start: "2026-09-01", end: "2026-09-04" }, TODAY);
  assert.equal(stats.total, 12_941_200);
  assert.equal(stats.totalDays, 3, "오늘까지 지난 날만 센다");
  assert.equal(stats.futureDays, 1, "9/4 는 남은 날");
  assert.equal(stats.dataDays, 3);
  assert.equal(stats.average, Math.round(12_941_200 / 3), "평균은 데이터 있는 3일로");
  assert.deepEqual(stats.best, { date: "2026-09-02", amount: 4_784_000 });
  assert.deepEqual(
    { start: stats.previous.start, end: stats.previous.end },
    { start: "2026-08-29", end: "2026-08-31" },
    "직전 기간은 지난 날수와 같은 길이(3일)로 바로 앞",
  );
  assert.equal(stats.previous.total, 3_795_000);
  assert.equal(stats.previous.dataDays, 2);

  // 이번 달(9/1~9/30)을 3일에 보면: 3일 지남, 27일 남음, 직전은 8/29~8/31
  const month = pos.rangeStats(index, { start: "2026-09-01", end: "2026-09-30" }, TODAY);
  assert.equal(month.totalDays, 3);
  assert.equal(month.futureDays, 27);
  assert.equal(month.previous.start, "2026-08-29");

  // 아예 미래 달이면 지난 날 0, 비교 없음
  const future = pos.rangeStats(index, { start: "2026-10-01", end: "2026-10-31" }, TODAY);
  assert.equal(future.totalDays, 0);
  assert.equal(future.futureDays, 31);
  assert.equal(future.previous.dataDays, 0);

  // 과거 범위는 전부 지난 날
  const past = pos.rangeStats(index, { start: "2026-08-30", end: "2026-08-31" }, TODAY);
  assert.equal(past.totalDays, 2);
  assert.equal(past.futureDays, 0);
  assert.equal(past.total, 3_795_000);
});

check("주 묶기: 월~일, 최근 12주가 오래된 순", () => {
  const index = pos.indexByDate([row("2026-08-31", 100), row("2026-09-06", 200), row("2026-09-07", 999)]);
  const weeks = pos.weeklyBuckets(index, TODAY, 12);
  assert.equal(weeks.length, 12);
  const last = weeks[11];
  assert.equal(last.start, "2026-08-31");
  assert.equal(last.end, "2026-09-06");
  assert.equal(last.total, 300, "9/7 은 다음 주라 빠진다");
  assert.equal(last.dataDays, 2);
  assert.equal(last.label, "8.31");
  assert.equal(weeks[0].start, pos.addDays("2026-08-31", -77));
  assert.ok(weeks.every((w, i) => i === 0 || w.start > weeks[i - 1].start), "오래된 순");
});

check("월 묶기: 최근 12개월, 라벨은 'N월'", () => {
  const index = pos.indexByDate([row("2026-09-01", 10), row("2026-09-30", 5), row("2026-10-01", 7)]);
  const months = pos.monthlyBuckets(index, TODAY, 12);
  assert.equal(months.length, 12);
  assert.equal(months[11].key, "2026-09");
  assert.equal(months[11].label, "9월");
  assert.equal(months[11].total, 15, "10/1 은 다음 달");
  assert.equal(months[0].key, "2025-10");
});

check("달력 격자: 월요일 시작, 앞뒤 달로 채움", () => {
  // 2026-09-01 은 화요일 → 앞에 월요일(8/31) 하나
  const cells = pos.calendarCells("2026-09");
  assert.equal(cells.length % 7, 0);
  assert.equal(cells[0].date, "2026-08-31");
  assert.equal(cells[0].inMonth, false);
  assert.equal(cells[1].date, "2026-09-01");
  assert.equal(cells[1].inMonth, true);
  assert.equal(cells.filter((c) => c.inMonth).length, 30);
  assert.equal(cells.length, 35, "9월은 5주");
  // 2026-03-01 은 일요일 → 앞에 6칸, 31일 → 6주
  assert.equal(pos.calendarCells("2026-03").length, 42);
});

check("셀 농도: 데이터 없음 0, 그 달 최소→최대를 다섯 단계로", () => {
  assert.equal(pos.intensityLevel(null, 100, 500), 0);
  assert.equal(pos.intensityLevel(undefined, 100, 500), 0);
  assert.equal(pos.intensityLevel(100, 100, 500), 1, "최소는 가장 연하게");
  assert.equal(pos.intensityLevel(300, 100, 500), 3);
  assert.equal(pos.intensityLevel(419, 100, 500), 4);
  assert.equal(pos.intensityLevel(420, 100, 500), 5);
  assert.equal(pos.intensityLevel(500, 100, 500), 5, "최대는 가장 진하게");
  assert.equal(pos.intensityLevel(250, 250, 250), 3, "하루뿐이면 중간 농도");
  // 실제 매출처럼 2,610,000~3,590,000 에 몰려도 다섯 단계가 다 쓰인다
  assert.equal(pos.intensityLevel(2_610_000, 2_610_000, 3_590_000), 1);
  assert.equal(pos.intensityLevel(3_590_000, 2_610_000, 3_590_000), 5);
});

check("프리셋: 오늘/어제/이번 주/지난 주/이번 달/지난 달/최근 7·30일", () => {
  const r = (key) => pos.presetRange(key, TODAY);
  assert.deepEqual(r("today"), { start: "2026-09-03", end: "2026-09-03" });
  assert.deepEqual(r("yesterday"), { start: "2026-09-02", end: "2026-09-02" });
  assert.deepEqual(r("thisWeek"), { start: "2026-08-31", end: "2026-09-06" });
  assert.deepEqual(r("lastWeek"), { start: "2026-08-24", end: "2026-08-30" });
  assert.deepEqual(r("thisMonth"), { start: "2026-09-01", end: "2026-09-30" });
  assert.deepEqual(r("lastMonth"), { start: "2026-08-01", end: "2026-08-31" });
  assert.deepEqual(r("last7"), { start: "2026-08-28", end: "2026-09-03" });
  assert.deepEqual(r("last30"), { start: "2026-08-05", end: "2026-09-03" });
  assert.equal(pos.matchPreset({ start: "2026-08-24", end: "2026-08-30" }, TODAY), "lastWeek");
  assert.equal(pos.matchPreset({ start: "2026-08-24", end: "2026-08-29" }, TODAY), null);
});

check("라벨: 하루·한 달·임의 범위", () => {
  assert.equal(pos.dateLabel("2026-09-03"), "9월 3일 (목)");
  assert.equal(pos.rangeLabel({ start: "2026-09-03", end: "2026-09-03" }), "9월 3일 (목)");
  assert.equal(pos.rangeLabel({ start: "2026-09-01", end: "2026-09-30" }), "2026년 9월");
  assert.equal(pos.rangeLabel({ start: "2026-09-01", end: "2026-09-03" }), "9월 1일 ~ 9월 3일");
  assert.equal(pos.rangeLabel({ start: "2025-12-30", end: "2026-01-02" }), "2025-12-30 ~ 2026-01-02");
  assert.equal(pos.monthTitle("2026-09"), "2026년 9월");
});

console.log(results.join("\n"));
console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
