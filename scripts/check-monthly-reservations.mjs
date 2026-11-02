/**
 * 예약 화면 「월별 집계」 점검 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:monthresv
 *
 * src/lib/monthlyReservations.ts 를 esbuild 로 묶어 불러온 뒤, 예약일 기준으로 그 달만 세는지, 취소는 빼고 따로 적는지,
 * 노쇼는 넣는지, 점심·저녁(15:00)·네이버·직접 입력을 가르는지, 중복 의심을 세는지, 엑셀 표에 이름·전화번호가 없는지 본다.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "month-resv-"));
const outfile = join(dir, "monthlyReservations.mjs");
buildSync({
  entryPoints: [fileURLToPath(new URL("../src/lib/monthlyReservations.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile,
  logLevel: "silent",
});
const mr = await import(pathToFileURL(outfile).href);

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

let nextId = 1;
const resv = (date, time, people, extra = {}) => ({
  id: nextId++, date, time, people, status: "방문완료", name: `손님${nextId}`, phone: `010-0000-${String(1000 + nextId)}`,
  seat: "", writer: "", createdAt: "", ...extra,
});
const naver = (date, time, people, extra = {}) => resv(date, time, people, { source: "naver", naver: { bookingId: `B${nextId}` }, ...extra });

check("그 달 예약일만 센다 — 취소는 빼서 따로, 노쇼는 넣는다", () => {
  const s = mr.summarizeMonth([
    resv("2026-09-30", "12:00", 9),
    resv("2026-10-01", "11:30", 4),
    resv("2026-10-15", "18:00", 6, { status: "예약확정" }),
    resv("2026-10-20", "12:00", 3, { status: "노쇼" }),
    resv("2026-10-21", "12:00", 5, { status: "취소" }),
    resv("2026-11-01", "12:00", 7),
  ], "2026-10");
  assert.deepEqual(s.total, { teams: 3, people: 13 });
  assert.deepEqual(s.canceled, { teams: 1, people: 5 });
  assert.deepEqual(s.noShow, { teams: 1, people: 3 });
  assert.equal(s.days.length, 31);
  assert.deepEqual(s.byStatus.map((x) => x.status).sort(), ["노쇼", "방문완료", "예약확정"]);
});

check("점심(15:00 전)·저녁, 네이버·직접 입력을 가른다 · 가장 많은 날", () => {
  const s = mr.summarizeMonth([
    resv("2026-10-03", "14:59", 2),
    resv("2026-10-03", "15:00", 10),
    naver("2026-10-04", "11:30", 4),
    naver("2026-10-04", "18:30", 3),
  ], "2026-10");
  assert.deepEqual(s.lunch, { teams: 2, people: 6 });
  assert.deepEqual(s.dinner, { teams: 2, people: 13 });
  assert.deepEqual(s.naver, { teams: 2, people: 7 });
  assert.deepEqual(s.manual, { teams: 2, people: 12 });
  assert.equal(s.busiest.date, "2026-10-03");
  const day = s.days.find((d) => d.date === "2026-10-04");
  assert.deepEqual(day.lunch, { teams: 1, people: 4 });
});

check("같은 날 같은 번호의 네이버·직접 입력 예약은 중복 의심으로 센다(「다른 예약입니다」 누른 것은 빼고)", () => {
  const manual = resv("2026-10-10", "12:00", 4, { phone: "010-1111-2222" });
  const dismissed = resv("2026-10-11", "12:00", 2, { phone: "010-3333-4444" });
  const s = mr.summarizeMonth([
    manual,
    naver("2026-10-10", "12:30", 4, { phone: "01011112222" }),
    dismissed,
    naver("2026-10-11", "12:00", 2, { phone: "010-3333-4444", naver: { bookingId: "X", notDuplicateOf: [dismissed.id] } }),
    naver("2026-10-12", "12:00", 5, { phone: "010-1111-2222" }),
  ], "2026-10");
  assert.deepEqual(s.duplicateSuspects, { teams: 1, people: 4 });
  assert.deepEqual(s.total, { teams: 5, people: 17 });
});

check("복사 글과 엑셀 표 — 숫자만, 이름·전화번호 없음", () => {
  const rows = [resv("2026-10-05", "12:00", 1234, { name: "홍길동", phone: "010-9876-5432" }), resv("2026-10-05", "19:00", 2, { status: "취소" })];
  const s = mr.summarizeMonth(rows, "2026-10");
  const text = mr.monthSummaryText(s);
  assert.match(text, /2026년 10월 예약/);
  assert.match(text, /전체 1건 1,234명/);
  assert.match(text, /취소 1건 2명은 뺐습니다/);
  const sheets = JSON.stringify([mr.summarySheetRows(s), mr.daySheetRows(s)]);
  assert.ok(!sheets.includes("홍길동") && !sheets.includes("9876"), "이름·전화번호가 표에 들어갔다");
  const days = mr.daySheetRows(s);
  assert.equal(days.length, 1 + 31 + 1);
  assert.deepEqual(days.at(-1).slice(0, 4), ["합계", "", 1, 1234]);
  assert.deepEqual(days[5].slice(0, 4), ["2026-10-05", "월", 1, 1234]);
});

check("「예약 목록」 — 예약자명·연락처, 합계와 같은 예약(그 달·취소 빼고), 날짜·시간 순", () => {
  const rows = mr.reservationListRows([
    resv("2026-10-09", "18:00", 2, { name: "나중", phone: "010-2222-0000" }),
    naver("2026-10-09", "11:30", 4, { name: "먼저", phone: "01011110000", seat: "룸1", request: "아기의자" }),
    resv("2026-10-01", "12:00", 3, { name: "첫날" }),
    resv("2026-10-02", "12:00", 5, { name: "취소손님", status: "취소" }),
    resv("2026-11-01", "12:00", 7, { name: "다음달" }),
  ], "2026-10");
  assert.deepEqual(rows[0], ["날짜", "요일", "시간", "예약자명", "연락처", "인원", "상태", "출처", "좌석", "요청사항"]);
  assert.deepEqual(rows.slice(1).map((r) => r[3]), ["첫날", "먼저", "나중"]);
  assert.deepEqual(rows[2], ["2026-10-09", "금", "11:30", "먼저", "01011110000", 4, "방문완료", "네이버", "룸1", "아기의자"]);
  assert.equal(typeof rows[2][4], "string", "연락처가 숫자로 바뀌면 앞의 0이 사라진다");
  const s = mr.summarizeMonth([resv("2026-10-01", "12:00", 3), resv("2026-10-02", "12:00", 5, { status: "취소" })], "2026-10");
  assert.equal(mr.reservationListRows([resv("2026-10-01", "12:00", 3), resv("2026-10-02", "12:00", 5, { status: "취소" })], "2026-10").length - 1, s.total.teams);
});

check("달 넘기기 · 요일 · 달 초에는 지난달", () => {
  assert.equal(mr.shiftMonth("2026-01", -1), "2025-12");
  assert.equal(mr.shiftMonth("2026-12", 1), "2027-01");
  assert.equal(mr.datesOfMonth("2028-02").length, 29);
  assert.equal(mr.dowOf("2026-10-05"), "월");
  assert.equal(mr.monthLabel("2026-10"), "2026년 10월");
  assert.equal(mr.defaultSummaryMonth("2026-11-02"), "2026-10");
  assert.equal(mr.defaultSummaryMonth("2026-11-10"), "2026-10");
  assert.equal(mr.defaultSummaryMonth("2026-11-11"), "2026-11");
  assert.equal(mr.defaultSummaryMonth("2027-01-03"), "2026-12");
});

console.log(results.join("\n"));
