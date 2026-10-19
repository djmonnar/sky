/**
 * 예약 화면의 네이버 예약 표시 점검 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:naver
 *
 * src/lib/naverReservations.ts 를 esbuild 로 변환해 불러온 뒤, 「중복 확인 필요」가 어느
 * 예약에 붙는지, 「다른 예약입니다」가 남는지, 전화·이름 열쇠가 동기화
 * (functions/naverReservationSync.js)와 같은 규칙인지 확인합니다.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/lib/naverReservations.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "ts", format: "esm", target: "es2020" });
const dir = mkdtempSync(join(tmpdir(), "naver-reservations-"));
const file = join(dir, "naverReservations.mjs");
writeFileSync(file, code);
const lib = await import(pathToFileURL(file).href);
const sync = createRequire(import.meta.url)("../functions/naverReservationSync.js");

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

const DAY = "2026-10-20";
const naver = (id, change = {}) => ({
  id, date: DAY, time: "18:00", name: "김하늘", phone: "010-0000-1111", people: 4, seat: "", status: "예약확정",
  writer: "네이버예약", createdAt: "2026-10-18 10:00", source: "naver",
  naver: { bookingId: String(id).slice(-10), businessId: "1012304", status: "confirmed" },
  ...change,
});
const manual = (id, change = {}) => ({
  id, date: DAY, time: "18:30", name: "김하늘님", phone: "01000001111", people: 2, seat: "룸2", status: "예약확정",
  writer: "사장님", createdAt: "2026-10-17 20:11", ...change,
});
const ids = (rows) => (rows ?? []).map((r) => r.id).sort((a, b) => a - b);

check("전화·이름 열쇠는 동기화와 같은 규칙이다", () => {
  const phones = [
    "010-0000-1111", "01000001111", "+82 10-0000-1111", "82-10-0000-1111", "0000-1111", "10-0000-1111",
    "055-123-4567", "02-123-4567", "", "없음", "123", "112", null, undefined, "010 0000 1111 내선 2",
  ];
  for (const raw of phones) assert.equal(lib.phoneKey(raw), sync.phoneKey(raw), String(raw));
  for (const raw of [" 김 하늘님 ", "김하늘", "님", "", null]) assert.equal(lib.nameKey(raw), sync.nameKey(raw), String(raw));
});

check("네이버 예약인지는 출처와 네이버 번호가 둘 다 있어야 한다", () => {
  assert.equal(lib.isNaverReservation(naver(9000001104567890)), true);
  assert.equal(lib.isNaverReservation({ source: "naver" }), false, "손으로 «네이버»라고만 적은 예약");
  assert.equal(lib.isNaverReservation({ naver: { bookingId: "1" } }), false);
  assert.equal(lib.isNaverReservation(manual(1)), false);
});

check("동기화가 가리킨 손 예약에 둘 다 「중복 확인 필요」가 붙는다", () => {
  const n = naver(9000001104567890, { phone: "010-7777-1111", naver: { ...naver(1).naver, duplicateOf: [11], duplicateReason: "same-name" } });
  const m = manual(11, { name: "다른이름", phone: "010-2222-3333" }); // 지금은 이름·전화가 달라도 동기화가 가리켰다
  const flags = lib.naverDuplicateFlags([n, m]);
  assert.deepEqual(ids(flags.byNaver.get(n.id)), [11]);
  assert.deepEqual(ids(flags.byManual.get(11)), [n.id]);
});

check("동기화 뒤에 직원이 같은 손님을 또 적어도 가리킨다 (같은 전화, 같은 이름)", () => {
  const n = naver(9000001104567890);
  const samePhone = manual(11, { name: "단골" });
  const sameName = manual(12, { phone: "" });
  const other = manual(13, { name: "박땅", phone: "010-5555-6666" });
  const flags = lib.naverDuplicateFlags([n, samePhone, sameName, other]);
  assert.deepEqual(ids(flags.byNaver.get(n.id)), [11, 12]);
  assert.equal(flags.byManual.has(13), false);
});

check("다른 날·취소된 예약, 네이버 예약끼리는 가리키지 않는다", () => {
  const n = naver(9000001104567890, { naver: { ...naver(1).naver, duplicateOf: [11, 12] } });
  const otherDay = manual(11, { date: "2026-10-21" });
  const cancelled = manual(12, { status: "취소" });
  const sibling = naver(9000001104567870, { time: "12:00" }); // 같은 손님의 점심 네이버 예약
  const flags = lib.naverDuplicateFlags([n, otherDay, cancelled, sibling]);
  assert.equal(flags.byNaver.size, 0);
  assert.equal(flags.byManual.size, 0);
});

check("가리킨 손 예약을 지우면 표시가 사라진다", () => {
  const n = naver(9000001104567890, { naver: { ...naver(1).naver, duplicateOf: [11] } });
  assert.equal(lib.naverDuplicateFlags([n]).byNaver.size, 0);
});

check("「다른 예약입니다」는 네이버 예약에 남고, 그 짝만 다시 안 가리킨다", () => {
  const n = naver(9000001104567890, { naver: { ...naver(1).naver, duplicateOf: [11] } });
  const m = manual(11);
  const later = manual(14, { time: "20:00" }); // 그 뒤에 또 적은 같은 손님 — 이것은 다시 가리킨다
  const dismissed = lib.markNotDuplicate(n, [11]);
  assert.deepEqual(dismissed.naver.notDuplicateOf, [11]);
  assert.deepEqual(dismissed.naver.duplicateOf, [11], "동기화가 남긴 표시는 그대로 둔다");
  assert.equal(dismissed.naver.bookingId, n.naver.bookingId);
  assert.equal(n.naver.notDuplicateOf, undefined, "원본은 안 바꾼다");
  assert.equal(lib.naverDuplicateFlags([dismissed, m]).byNaver.size, 0);
  assert.deepEqual(ids(lib.naverDuplicateFlags([dismissed, m, later]).byNaver.get(n.id)), [14]);
  assert.deepEqual(lib.markNotDuplicate(dismissed, [14, 11]).naver.notDuplicateOf, [11, 14], "겹치지 않게 모은다");
  assert.equal(lib.markNotDuplicate(m, [1]), m, "손 예약에는 적지 않는다");
});

check("입양한 예약(손 예약에 네이버 번호를 붙인 것)은 네이버 예약으로 친다 — 스스로를 가리키지 않는다", () => {
  const adopted = manual(11, {
    source: "naver",
    time: "18:00",
    naver: { bookingId: "1104567890", adopted: true, adoptedFrom: { source: null, writer: "사장님" } },
  });
  const flags = lib.naverDuplicateFlags([adopted]);
  assert.equal(flags.byNaver.size + flags.byManual.size, 0);
});

check("합치지 않은 까닭을 사람 말로 적는다", () => {
  for (const reason of ["same-name", "same-name-no-phone", "same-phone-multiple", "same-phone-multiple-naver"]) {
    assert.ok(lib.duplicateReasonText(reason), reason);
  }
  assert.equal(lib.duplicateReasonText(undefined), null);
});

console.log(results.join("\n"));
console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
