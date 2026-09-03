"use strict";

/**
 * 카카오 자유 입력 예약 파서 점검.
 *
 *   npm run test:kakao
 */

const assert = require("node:assert");
const { parseQuickReservation, normalizePhone } = require("../quickReservation");

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

const p = (text) => parseQuickReservation(text);

check("사장님이 적어 준 세 가지 형식이 전부 같은 예약으로 읽힌다", () => {
  for (const text of [
    "9-3 6시 3명 박현제 45184312",
    "9/3 18시  3명  박현제 45184312",
    "9월 3일 오후 6시 3명 박현제 45184312",
  ]) {
    const r = p(text);
    assert.ok(r.ok, `${text} → ok`);
    assert.equal(r.cancel, false, text);
    assert.match(r.dateInput, /^(9-3|9\/3|9월 3일)$/, text);
    assert.equal(r.time, "18:00", `${text} → 18:00`);
    assert.equal(r.people, 3, text);
    assert.equal(r.name, "박현제", text);
    assert.equal(r.phone, "010-4518-4312", `${text} → 010 붙여서`);
  }
});

check("전화번호: 8자리·10자리·11자리, 하이픈 유무", () => {
  assert.equal(normalizePhone("45184312"), "010-4518-4312");
  assert.equal(normalizePhone("4518-4312"), "010-4518-4312");
  assert.equal(normalizePhone("01045184312"), "010-4518-4312");
  assert.equal(normalizePhone("010-4518-4312"), "010-4518-4312");
  assert.equal(normalizePhone("1045184312"), "010-4518-4312");
  assert.equal(normalizePhone("9-3"), "", "날짜는 전화가 아니다");
  assert.equal(normalizePhone("18"), "");
  assert.equal(normalizePhone(""), "");
});

check("전화번호를 안 적으면 빈칸으로 두고 예약은 잡힌다", () => {
  const r = p("9/5 18시 3명 박현제");
  assert.ok(r.ok);
  assert.equal(r.phone, "");
  assert.equal(r.name, "박현제");
});

check("시간: 오전/오후 없이 1~9시는 저녁, 10·11·12시는 그대로", () => {
  assert.equal(p("9/5 6시 2명 김하늘").time, "18:00");
  assert.equal(p("9/5 9시 2명 김하늘").time, "21:00");
  assert.equal(p("9/5 10시 2명 김하늘").time, "10:00");
  assert.equal(p("9/5 11시 2명 김하늘").time, "11:00");
  assert.equal(p("9/5 12시 2명 김하늘").time, "12:00");
  assert.equal(p("9/5 13시 2명 김하늘").time, "13:00");
  assert.equal(p("9/5 오전 11시 2명 김하늘").time, "11:00");
  assert.equal(p("9/5 오전 9시 2명 김하늘").time, "09:00");
  assert.equal(p("9/5 오후 12시 2명 김하늘").time, "12:00");
  assert.equal(p("9/5 저녁 7시 2명 김하늘").time, "19:00");
  assert.equal(p("9/5 낮 1시 2명 김하늘").time, "13:00");
  assert.equal(p("9/5 점심 12시 2명 김하늘").time, "12:00");
});

check("시간: 반·분·콜론 표기", () => {
  assert.equal(p("9/5 6시반 2명 김하늘").time, "18:30");
  assert.equal(p("9/5 6시 반 2명 김하늘").time, "18:30");
  assert.equal(p("9/5 6시 30분 2명 김하늘").time, "18:30");
  assert.equal(p("9/5 18:30 2명 김하늘").time, "18:30");
  assert.equal(p("9/5 오후 7:30 4명 홍길동").time, "19:30");
  const r = p("9/5 18시 3명 김하늘");
  assert.equal(r.time, "18:00", "'18시 3명' 의 3 을 3분으로 읽지 않는다");
  assert.equal(r.people, 3);
});

check("날짜 표기: 오늘/내일, 2026-09-05, 6월29일", () => {
  assert.equal(p("내일 저녁 7시 4명 홍길동").dateInput, "내일");
  assert.equal(p("2026-09-05 18시 4명 홍길동").dateInput, "2026-09-05");
  assert.equal(p("6월29일 18시 4명 홍길동").dateInput, "6월29일");
});

check("자리 말은 이름이 아니라 자리로", () => {
  const r = p("내일 저녁 7시 4명 홍길동 창가");
  assert.equal(r.name, "홍길동");
  assert.equal(r.seat, "창가");
  const r2 = p("내일 저녁 7시 4명 창가 홍길동");
  assert.equal(r2.name, "홍길동", "자리가 먼저 와도 이름을 찾는다");
  assert.equal(r2.seat, "창가");
});

check("'님'·'예약'·'등록' 같은 군더더기는 이름에서 뗀다", () => {
  assert.equal(p("9/5 18시 3명 박현제님 예약 등록").name, "박현제");
  assert.equal(p("예약 등록 홍길동 010-1234-5678 내일 오후 7:30 4명 창가").name, "홍길동");
  assert.equal(p("예약 등록 홍길동 010-1234-5678 내일 오후 7:30 4명 창가").phone, "010-1234-5678");
});

check("취소: 날짜 + 이름 + 취소 만 있으면 된다", () => {
  for (const text of ["9/5 박현제 취소", "9/5 취소 박현제", "예약취소 9월 5일 박현제", "9/5 18시 3명 박현제 예약 취소"]) {
    const r = p(text);
    assert.ok(r.ok, `${text} → ok`);
    assert.ok(r.cancel, `${text} → 취소`);
    assert.equal(r.name, "박현제", text);
  }
  assert.equal(p("9/5 18시 3명 박현제 예약 취소").time, "18:00", "취소에도 시간이 있으면 같은 이름 중 고르는 데 쓴다");
});

check("예약 정보가 아닌 말은 건드리지 않는다 (기존 명령으로 흘러간다)", () => {
  for (const text of ["오늘 현황", "오늘 예약", "9/5 예약 보여줘", "내일 근무표", "취소", "공지 등록 오늘 단체 예약 세팅 확인", "내일 3명 예약", "오늘 홍길동 방문완료"]) {
    assert.equal(p(text).ok, false, `${text} → 빠른 예약 아님`);
  }
});

console.log(results.join("\n"));
console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
