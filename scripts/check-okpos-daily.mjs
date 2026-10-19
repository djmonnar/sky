/**
 * OK포스 「일자별 (일별종합)」 엑셀 읽기 점검 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:okpos
 *
 * src/lib/okposDaily.ts 를 esbuild 로 변환해 불러온 뒤, OK포스 엑셀과 **같은 칸 구조**
 * (묶음 줄 + 이름 줄 + 엑셀 날짜 일련번호 + 합계 줄)에 지어낸 숫자를 넣어 읽힌다.
 * 매장의 실제 매출은 저장소에 넣지 않는다.
 *
 * 검사하는 것: 칸을 이름(묶음+이름)으로 찾는지, 「식권」처럼 묶음마다 겹치는 이름을
 * 섞지 않는지, 결제수단 칸 합이 모자란 만큼을 «칸 없는 결제»로 두는지, 날짜·요일이
 * 어긋나면 아무것도 반영하지 않는지, 그리고 OK포스가 있는 날 매출이 OK포스 숫자로
 * 바뀌되 네이버 숫자는 남는지.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/lib/okposDaily.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "ts", format: "esm", target: "es2020" });
const dir = mkdtempSync(join(tmpdir(), "okpos-daily-"));
const file = join(dir, "okposDaily.mjs");
writeFileSync(file, code);
const ok = await import(pathToFileURL(file).href);

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

/* ── OK포스 엑셀과 같은 칸 구조 (2026-10 실제 파일의 머리글을 옮김) ── */

const HEAD = [
  ["일자", "일자"], ["요일", "요일"],
  ["매출현황", "총매출"], ["매출현황", "총할인"], ["매출현황", "실매출"], ["매출현황", "가액"], ["매출현황", "부가세"], ["매출현황", "영수건수"], ["매출현황", "영수단가"],
  ["고객", "고객수"], ["고객", "객단가"], ["고객", "남"], ["고객", "여"],
  ["테이블", "테이블수"], ["테이블", "단가"], ["테이블", "회전율"],
  ["봉사료", "봉사료"], ["에누리", "에누리"],
  ["결제수단", "결제합계"], ["결제수단", "단순현금"], ["결제수단", "현금영수"], ["결제수단", "신용카드"], ["결제수단", "외상"],
  ["결제수단", "상품권"], ["결제수단", "식권"], ["결제수단", "회원포인트"], ["결제수단", "제휴카드"], ["결제수단", "사원카드"],
  ["결제수단", "모바일쿠폰"], ["결제수단", "캐시비"], ["결제수단", "전자상품권"], ["결제수단", "온라인결제"], ["결제수단", "기타결제"],
  ["포장/배달현황", "일반"], ["포장/배달현황", "점유율(%)"], ["포장/배달현황", "포장"], ["포장/배달현황", "점유율(%)"], ["포장/배달현황", "배달"], ["포장/배달현황", "점유율(%)"],
  ["할인내역", "일반"], ["할인내역", "서비스"], ["할인내역", "제휴"], ["할인내역", "쿠폰"], ["할인내역", "회원"], ["할인내역", "식권"], ["할인내역", "포장"], ["할인내역", "YAP"],
  ["Tax Refund", "사후환급액"], ["Tax Refund", "즉시환급액"], ["Tax Refund", "환급수수료"],
];

/** 하루치 줄. values 는 "묶음|이름" → 값. 안 적은 칸은 0. */
function dayRow(head, first, dow, values) {
  return head.map(([group, name]) => {
    if (group === "일자") return first;
    if (group === "요일") return dow;
    return values[`${group}|${name}`] ?? 0;
  });
}

// 지어낸 사흘치 — 엑셀처럼 최신 날짜가 위
const DAYS = [
  [46313, "일", { // 2026-10-18 · 칸 있는 수단 1,800,000 → 칸 없는 결제 200,000
    "매출현황|총매출": 2_000_000, "매출현황|실매출": 2_000_000, "매출현황|영수건수": 20, "고객|고객수": 22,
    "결제수단|결제합계": 2_000_000, "결제수단|현금영수": 100_000, "결제수단|신용카드": 1_700_000,
  }],
  [46312, "토", { // 2026-10-17 · 딱 맞음
    "매출현황|총매출": 1_500_000, "매출현황|실매출": 1_500_000, "매출현황|영수건수": 15, "고객|고객수": 16,
    "결제수단|결제합계": 1_500_000, "결제수단|단순현금": 100_000, "결제수단|신용카드": 1_400_000,
  }],
  [46311, "금", { // 2026-10-16 · 「식권」이 결제수단(10,000)과 할인내역(3,000) 양쪽에 있다
    "매출현황|총매출": 1_003_000, "매출현황|총할인": 23_000, "매출현황|실매출": 980_000,
    "매출현황|가액": 890_909, "매출현황|부가세": 89_091, "매출현황|영수건수": 10, "고객|고객수": 12,
    "결제수단|결제합계": 980_000, "결제수단|단순현금": 30_000, "결제수단|현금영수": 50_000,
    "결제수단|신용카드": 800_000, "결제수단|상품권": 40_000, "결제수단|식권": 10_000,
    "할인내역|일반": 5_000, "할인내역|서비스": 15_000, "할인내역|식권": 3_000,
  }],
];

function sheet({ head = HEAD, days = DAYS, total = 4_480_000, groupRow = true, period = "2026-10-16 ~ 2026-10-18" } = {}) {
  const width = head.length;
  const blank = () => Array(width).fill("");
  const title = blank(); title[0] = "일자별 (일별종합)";
  const query = blank(); query[0] = `조회일자 : ${period}`;
  const space = blank(); space[0] = " ";
  const totalRow = blank(); totalRow[0] = "합계";
  totalRow[head.findIndex(([g, n]) => g === "매출현황" && n === "실매출")] = total;
  return [
    title, blank(), query, blank(), space,
    ...(groupRow ? [head.map(([group]) => group)] : []),
    head.map(([, name]) => name),
    ...days.map(([first, dow, values]) => dayRow(head, first, dow, values)),
    totalRow,
  ];
}

const TODAY = "2026-10-19";

/* ── 읽기 ─────────────────────────────────────────────── */

check("OK포스 엑셀 모양을 읽는다 — 사흘, 오래된 순, 조회기간·합계", () => {
  const result = ok.parseOkposDaily(sheet(), TODAY, "일자별 (일별종합).xls");
  assert.deepEqual(result.days.map((d) => d.businessDate), ["2026-10-16", "2026-10-17", "2026-10-18"]);
  assert.equal(result.title, "일자별 (일별종합)");
  assert.deepEqual(result.period, { start: "2026-10-16", end: "2026-10-18" });
  assert.equal(result.sheetTotal, 4_480_000);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.days[0].fileName, "일자별 (일별종합).xls");
});

check("매출현황·고객 칸을 제 이름으로 읽는다", () => {
  const day = ok.parseOkposDaily(sheet(), TODAY).days[0]; // 10-16
  assert.equal(day.grossAmount, 1_003_000);
  assert.equal(day.discountAmount, 23_000);
  assert.equal(day.netAmount, 980_000);
  assert.equal(day.supplyAmount, 890_909);
  assert.equal(day.vatAmount, 89_091);
  assert.equal(day.receiptCount, 10);
  assert.equal(day.customerCount, 12);
  assert.equal(day.paymentTotal, 980_000);
});

check("「식권」은 결제수단 칸과 할인내역 칸을 섞지 않는다", () => {
  const day = ok.parseOkposDaily(sheet(), TODAY).days[0];
  assert.equal(day.payments.mealTicket, 10_000, "결제수단의 식권");
  assert.deepEqual(day.discounts, [
    { name: "일반", amount: 5_000 },
    { name: "서비스", amount: 15_000 },
    { name: "식권", amount: 3_000 },
  ], "할인내역의 식권 — 0 인 할인은 안 싣는다");
});

check("결제수단 칸 합이 모자란 만큼은 «엑셀에 칸 없는 결제»로 둔다", () => {
  const [d16, d17, d18] = ok.parseOkposDaily(sheet(), TODAY).days;
  assert.equal(d16.unlistedPayment, 50_000, "980,000 − (30,000+50,000+800,000+40,000+10,000)");
  assert.equal(d17.unlistedPayment, 0, "딱 맞는 날");
  assert.equal(d18.unlistedPayment, 200_000);
});

check("결제수단 묶음: 카드·현금·상품권·그 외·칸 없음", () => {
  const groups = ok.okposPaymentGroups(ok.parseOkposDaily(sheet(), TODAY).days[0]);
  assert.deepEqual(groups, { card: 800_000, cash: 80_000, voucher: 50_000, other: 0, unlisted: 50_000 });
  const sum = Object.values(groups).reduce((a, b) => a + b, 0);
  assert.equal(sum, 980_000, "묶음을 다 더하면 결제합계");
});

check("칸 순서가 바뀌어도 이름으로 찾는다", () => {
  const shuffled = [...HEAD];
  const a = shuffled.findIndex(([g, n]) => g === "결제수단" && n === "신용카드");
  const b = shuffled.findIndex(([g, n]) => g === "매출현황" && n === "총매출");
  [shuffled[a], shuffled[b]] = [shuffled[b], shuffled[a]];
  const day = ok.parseOkposDaily(sheet({ head: shuffled }), TODAY).days[0];
  assert.equal(day.payments.card, 800_000);
  assert.equal(day.grossAmount, 1_003_000);
});

check("처음 보는 결제수단 칸은 기타결제에 더하고 알린다", () => {
  const head = [...HEAD];
  head.splice(head.findIndex(([, n]) => n === "기타결제") + 1, 0, ["결제수단", "지역화폐"]);
  const days = DAYS.map(([first, dow, values]) => [first, dow, first === 46311 ? { ...values, "결제수단|지역화폐": 50_000 } : values]);
  const result = ok.parseOkposDaily(sheet({ head, days }), TODAY);
  const d16 = result.days[0];
  assert.equal(d16.payments.otherPay, 50_000);
  assert.equal(d16.unlistedPayment, 0, "이제 칸이 있으니 모자라지 않는다");
  assert.ok(result.warnings.some((w) => w.includes("지역화폐")));
});

check("엑셀 날짜 일련번호와 글자 날짜를 읽는다", () => {
  assert.equal(ok.excelSerialToKey(46313), "2026-10-18");
  assert.equal(ok.parseDateCell(46296), "2026-10-01");
  assert.equal(ok.parseDateCell("2026-10-18"), "2026-10-18");
  assert.equal(ok.parseDateCell("2026.10.8"), "2026-10-08");
  assert.equal(ok.parseDateCell("2026/10/18 (일)"), "2026-10-18");
  assert.equal(ok.parseDateCell("20261018"), "2026-10-18");
  assert.equal(ok.parseDateCell("합계"), null);
  assert.equal(ok.parseDateCell(7_503_100), null, "금액을 날짜로 읽지 않는다");
  assert.equal(ok.parseDateCell("2026-02-30"), null, "없는 날");
});

/* ── 멈추는 경우 — 반쯤 맞는 숫자를 넣느니 아무것도 안 넣는다 ── */

check("요일이 날짜와 안 맞으면 아무것도 반영하지 않는다", () => {
  const days = DAYS.map(([first, dow, values]) => [first, first === 46313 ? "월" : dow, values]);
  assert.throws(() => ok.parseOkposDaily(sheet({ days }), TODAY), (error) => {
    assert.equal(error.name, "OkposParseError");
    assert.match(error.message, /10\/18은 일요일인데 엑셀에는 월요일/);
    return true;
  });
});

check("다른 엑셀(제목 줄 없음)이면 멈춘다", () => {
  assert.throws(() => ok.parseOkposDaily([["메뉴별 매출"], ["메뉴", "수량", "금액"], ["돼지갈비", 3, 48000]], TODAY), /제목 줄을 찾지 못했습니다/);
});

check("날짜 줄이 하나도 없으면 멈춘다", () => {
  assert.throws(() => ok.parseOkposDaily(sheet({ days: [], total: 0 }), TODAY), /날짜가 적힌 줄이 없습니다/);
});

/* ── 반영은 하되 알리는 경우 ───────────────────────────── */

check("오늘 뒤 날짜는 빼고, 오늘 줄은 마감 전일 수 있다고 알린다", () => {
  const result = ok.parseOkposDaily(sheet(), "2026-10-17");
  assert.deepEqual(result.days.map((d) => d.businessDate), ["2026-10-16", "2026-10-17"]);
  assert.ok(result.warnings.some((w) => w.includes("오늘 뒤 날짜는 뺐습니다") && w.includes("10/18")));
  assert.ok(result.warnings.some((w) => w.includes("오늘(10/17)")));
});

check("실매출 0원인 날은 빼고 알린다 (그날은 네이버 숫자가 남는다)", () => {
  const days = [...DAYS, [46310, "목", {}]]; // 2026-10-15 전부 0
  const result = ok.parseOkposDaily(sheet({ days, period: "2026-10-15 ~ 2026-10-18" }), TODAY);
  assert.equal(result.days.length, 3);
  assert.ok(result.warnings.some((w) => w.includes("0원") && w.includes("10/15")));
});

check("엑셀 합계 줄과 날짜별 합이 다르면 알린다", () => {
  const result = ok.parseOkposDaily(sheet({ total: 4_000_000 }), TODAY);
  assert.ok(result.warnings.some((w) => w.includes("합계 줄") && w.includes("4,480,000")));
});

check("조회 기간 안인데 줄이 없는 날을 알린다", () => {
  const result = ok.parseOkposDaily(sheet({ period: "2026-10-14 ~ 2026-10-18" }), TODAY);
  assert.ok(result.warnings.some((w) => w.includes("줄이 없는 날") && w.includes("10/14") && w.includes("10/15")));
});

check("묶음 줄이 없으면 겹치는 이름(식권)은 안 읽고 알린다, 겹치지 않는 칸은 읽는다", () => {
  const result = ok.parseOkposDaily(sheet({ groupRow: false }), TODAY);
  const d16 = result.days[0];
  assert.equal(d16.payments.card, 800_000);
  assert.equal(d16.payments.mealTicket, 0);
  assert.ok(result.warnings.some((w) => w.includes("겹치는 칸")));
});

/* ── 화면이 쓸 모양 — OK포스가 있으면 그날 매출은 OK포스 ── */

const [r16, r17] = ok.parseOkposDaily(sheet(), TODAY).days;

check("OK포스가 있는 날: 매출·건수·결제수단이 OK포스 숫자, 네이버 숫자는 남는다", () => {
  const naverRow = {
    id: "2026-10-16", businessDate: "2026-10-16", orderCount: 0, canceledCount: 0,
    grossAmount: 900_000, discountAmount: 0, refundAmount: 0, netAmount: 900_000, averageOrderAmount: 0,
    paymentTotals: [], hasOrderCount: false, source: "ownervista", sourceLabel: "NAVER-PLACEPLUS", okpos: r16,
  };
  const row = ok.withOkpos(naverRow);
  assert.equal(row.netAmount, 980_000);
  assert.equal(row.grossAmount, 1_003_000);
  assert.equal(row.orderCount, 10);
  assert.equal(row.hasOrderCount, true);
  assert.equal(row.averageOrderAmount, 98_000);
  assert.equal(row.source, "okpos");
  assert.equal(row.naverNetAmount, 900_000, "네이버가 준 숫자");
  assert.deepEqual(row.paymentTotals, [
    { method: "card", amount: 800_000 },
    { method: "cash", amount: 80_000 },
    { method: "voucher", amount: 50_000 },
    { method: "other", amount: 50_000 },
  ]);
});

check("OK포스가 없는 날은 그대로, 네이버 숫자를 naverNetAmount 로도 남긴다", () => {
  const naverOnly = { id: "d", businessDate: "2026-10-18", netAmount: 1_234_000, source: "ownervista", paymentTotals: [] };
  const row = ok.withOkpos(naverOnly);
  assert.equal(row.netAmount, 1_234_000);
  assert.equal(row.naverNetAmount, 1_234_000);
  assert.equal(row.okpos, null);
});

check("OK포스만 있는 날(네이버 없음)은 naverNetAmount 가 null — 0 이 아니다", () => {
  const row = ok.withOkpos({ id: "d", businessDate: "2026-10-17", netAmount: 0, source: null, paymentTotals: [], okpos: r17 });
  assert.equal(row.netAmount, 1_500_000);
  assert.equal(row.naverNetAmount, null);
});

check("기간 합계: OK포스 날만 묶고, 네이버와는 둘 다 있는 날끼리 견준다", () => {
  const rows = [
    ok.withOkpos({ id: "a", businessDate: "2026-10-16", netAmount: 900_000, source: "ownervista", paymentTotals: [], okpos: r16 }),
    ok.withOkpos({ id: "b", businessDate: "2026-10-17", netAmount: 0, source: null, paymentTotals: [], okpos: r17 }),
    ok.withOkpos({ id: "c", businessDate: "2026-10-18", netAmount: 1_234_000, source: "ownervista", paymentTotals: [] }),
    ok.withOkpos({ id: "z", businessDate: "2026-09-30", netAmount: 1, source: null, paymentTotals: [], okpos: r16 }), // 기간 밖
  ];
  const summary = ok.okposRangeSummary(rows, "2026-10-01", "2026-10-31");
  assert.equal(summary.days, 2);
  assert.equal(summary.netAmount, 2_480_000);
  assert.equal(summary.receiptCount, 25);
  assert.equal(summary.groups.card, 2_200_000);
  assert.equal(summary.groups.cash, 180_000);
  assert.deepEqual(summary.compared, { days: 1, naver: 900_000, okpos: 980_000 });
});

console.log(results.join("\n"));
console.log(
  process.exitCode
    ? "\n검사에 실패한 항목이 있습니다."
    : "\n모든 검사를 통과했습니다."
);
