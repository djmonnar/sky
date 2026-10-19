/* ============================================================
   OK포스 「일자별 (일별종합)」 엑셀 읽기

   **왜 엑셀인가.** 이 매장 매출은 네이버 플레이스플러스(오너비스타)에서 매일 받아
   오지만, 네이버는 현금·상품권을 못 읽어 온다. OK포스는 매장에서 받은 결제 전부라
   가장 정확하다. 사장님이 OK포스에서 내려받은 엑셀을 올리면 그 날짜들은 OK포스
   숫자로 바뀐다.

   **엑셀을 해석하는 것까지만 여기서 한다.** .xls(BIFF) 를 표로 푸는 것은 화면 쪽
   (SheetJS, components/OkposUpload.tsx)이 하고, 여기는 그 표(행 배열)를 받는다.
   그래서 이 파일은 타입 말고는 아무것도 import 하지 않고, esbuild 로 떼어 node 로
   검사한다(scripts/check-okpos-daily.mjs).

   **칸 이름으로 찾는다, 위치로 찾지 않는다.** OK포스가 칸을 하나 더하거나 빼도
   엉뚱한 칸을 읽지 않게. 같은 이름이 묶음마다 또 나온다(「식권」은 결제수단에도
   할인내역에도 있다) — 그래서 윗줄의 묶음 이름(매출현황·결제수단·할인내역 …)과
   짝지어 찾는다.

   **모르는 것은 지어내지 않는다.** 결제수단 칸을 다 더해도 결제합계에 모자라는
   날이 있다 — 엑셀에 칸이 없는 수단이다. 무엇인지 모르니 «엑셀에 칸 없는 결제»로
   따로 둔다. 실매출이 0원인 날은 «안 팔린 날»인지 «안 찍힌 날»인지 모르니 빼고
   (그날은 네이버 숫자가 남는다) 그렇다고 알린다.
   ============================================================ */

import type { OkposDailyReport, OkposPayments, SalesDailySummary } from "../data/types";

export class OkposParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OkposParseError";
  }
}

export interface OkposParseResult {
  /** 엑셀 첫 줄 제목 ("일자별 (일별종합)") */
  title: string | null;
  /** 「조회일자 : 2026-10-01 ~ 2026-10-18」 */
  period: { start: string; end: string } | null;
  /** 반영할 날들, 오래된 순 */
  days: OkposDailyReport[];
  /** 엑셀 맨 아래 「합계」 줄의 실매출. 없으면 null */
  sheetTotal: number | null;
  /** 사람이 읽을 알림 — 반영은 하지만 알고 있어야 할 것 */
  warnings: string[];
}

/** 결제수단 칸 → 저장 이름. 엑셀 칸 이름 그대로다. */
const PAYMENT_COLUMNS: Array<[keyof OkposPayments, string]> = [
  ["simpleCash", "단순현금"],
  ["cashReceipt", "현금영수"],
  ["card", "신용카드"],
  ["credit", "외상"],
  ["voucher", "상품권"],
  ["mealTicket", "식권"],
  ["memberPoint", "회원포인트"],
  ["partnerCard", "제휴카드"],
  ["employeeCard", "사원카드"],
  ["mobileCoupon", "모바일쿠폰"],
  ["cashbee", "캐시비"],
  ["eVoucher", "전자상품권"],
  ["onlinePay", "온라인결제"],
  ["otherPay", "기타결제"],
];

/** 저장된 결제수단 칸 이름들 — 불러올 때 모양을 맞추는 데 쓴다 */
export const OKPOS_PAYMENT_KEYS: Array<keyof OkposPayments> = PAYMENT_COLUMNS.map(([key]) => key);

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[,\s원]/g, "");
  if (!cleaned || cleaned === "-") return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRealDay(key: string): boolean {
  if (!DAY_RE.test(key)) return false;
  const date = new Date(`${key}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === key;
}

/**
 * 엑셀 날짜 일련번호 → "YYYY-MM-DD". 1900 날짜 체계라 1899-12-30 을 0 으로 센다
 * (엑셀의 «1900-02-29» 버그 때문에 31일이 아니라 30일이다).
 */
export function excelSerialToKey(serial: number): string {
  const ms = Math.round(serial) * 86_400_000 + Date.UTC(1899, 11, 30);
  return new Date(ms).toISOString().slice(0, 10);
}

/** 날짜 칸: 엑셀 일련번호, 2026-10-18, 2026.10.18, 2026/10/18, 20261018 */
export function parseDateCell(value: unknown): string | null {
  if (typeof value === "number") {
    // 1954 ~ 2119 년 사이만 날짜로 본다 — 금액·건수를 날짜로 잘못 읽지 않게
    if (!(value > 20000 && value < 80000)) return null;
    return excelSerialToKey(value);
  }
  const raw = text(value);
  let match = raw.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (!match) match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  const key = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return isRealDay(key) ? key : null;
}

function monthDay(key: string): string {
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
}

function listDays(keys: string[], limit = 6): string {
  const shown = keys.slice(0, limit).map(monthDay).join(", ");
  return keys.length > limit ? `${shown} 외 ${keys.length - limit}일` : shown;
}

/**
 * SheetJS `sheet_to_json(sheet, { header: 1, raw: true })` 가 내준 행 배열을 읽는다.
 *
 * @param today 오늘("YYYY-MM-DD"). 이보다 뒤 날짜는 버리고, 오늘 줄은 «마감 전일 수
 *              있다»고 알린다.
 * @throws OkposParseError 엑셀 모양이 다르거나 날짜를 믿을 수 없을 때. 이때는 아무것도
 *         반영하지 않는다 — 반쯤 맞는 숫자를 넣는 것보다 낫다.
 */
export function parseOkposDaily(rows: unknown[][], today: string, fileName?: string): OkposParseResult {
  const warnings: string[] = [];

  /* ── 제목 줄 찾기: 첫 칸이 「일자」이고 「실매출」이나 「결제합계」가 있는 줄 ── */
  let nameRowIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
    const cells = (rows[i] ?? []).map(text);
    if (cells[0] === "일자" && cells.some((cell) => cell === "실매출" || cell === "결제합계")) {
      nameRowIndex = i;
      break;
    }
  }
  if (nameRowIndex < 0) {
    throw new OkposParseError(
      "「일자」·「실매출」 제목 줄을 찾지 못했습니다. OK포스에서 내려받은 「일자별 (일별종합)」 엑셀인지 확인해 주세요."
    );
  }

  const names = (rows[nameRowIndex] ?? []).map(text);
  // 바로 윗줄이 묶음 이름(매출현황·결제수단 …). 병합 칸이라 비어 있으면 왼쪽 것을 이어 쓴다.
  const groupSource = nameRowIndex > 0 && text(rows[nameRowIndex - 1]?.[0]) === "일자"
    ? (rows[nameRowIndex - 1] ?? []).map(text)
    : null;
  const groups: string[] = [];
  let currentGroup = "";
  for (let c = 0; c < names.length; c += 1) {
    if (groupSource?.[c]) currentGroup = groupSource[c];
    groups.push(groupSource ? currentGroup : "");
  }
  if (!groupSource) {
    warnings.push("칸 묶음(결제수단·할인내역) 줄이 없어, 이름이 겹치는 칸(식권·포장 등)은 읽지 않았습니다.");
  }

  const byGroupName = new Map<string, number>();
  const byName = new Map<string, number[]>();
  names.forEach((name, c) => {
    if (!name) return;
    const key = `${groups[c]}|${name}`;
    if (!byGroupName.has(key)) byGroupName.set(key, c);
    byName.set(name, [...(byName.get(name) ?? []), c]);
  });
  /** 묶음+이름으로 찾고, 묶음을 모르면 이름이 하나뿐일 때만 쓴다 */
  const col = (group: string, name: string): number => {
    const exact = byGroupName.get(`${group}|${name}`);
    if (exact !== undefined) return exact;
    if (groupSource) return -1;
    const found = byName.get(name) ?? [];
    return found.length === 1 ? found[0] : -1;
  };

  const netCol = col("매출현황", "실매출");
  const payTotalCol = col("결제수단", "결제합계");
  if (netCol < 0 && payTotalCol < 0) {
    throw new OkposParseError("「실매출」 칸을 찾지 못했습니다. 「일자별 (일별종합)」 엑셀인지 확인해 주세요.");
  }
  const dowCol = names.indexOf("요일");

  // 결제수단 묶음에 우리가 모르는 칸이 생기면 기타결제에 더한다 — 합이 어긋나지 않게
  const knownPaymentNames = new Set(["결제합계", ...PAYMENT_COLUMNS.map(([, name]) => name)]);
  const extraPaymentCols = names
    .map((name, c) => ({ name, c }))
    .filter(({ name, c }) => groups[c] === "결제수단" && name && !knownPaymentNames.has(name));
  if (extraPaymentCols.length > 0) {
    warnings.push(`처음 보는 결제수단 칸(${extraPaymentCols.map(({ name }) => `「${name}」`).join(" ")})은 기타결제에 더했습니다.`);
  }
  const discountCols = names
    .map((name, c) => ({ name, c }))
    .filter(({ name, c }) => groups[c] === "할인내역" && name);

  /* ── 제목·조회기간 ── */
  const title = text(rows[0]?.find((cell) => text(cell))) || null;
  if (title && !/일자별|일별/.test(title)) {
    warnings.push(`엑셀 제목이 「${title}」입니다. 「일자별 (일별종합)」이 맞는지 확인해 주세요.`);
  }
  let period: OkposParseResult["period"] = null;
  for (let i = 0; i < nameRowIndex && !period; i += 1) {
    for (const cell of rows[i] ?? []) {
      const match = text(cell).match(/조회\s*일자\s*[:：]?\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
      if (match) {
        period = { start: match[1], end: match[2] };
        break;
      }
    }
  }

  /* ── 날짜 줄 ── */
  const amount = (row: unknown[], c: number) => (c < 0 ? 0 : Math.round(num(row[c])));
  const parsed = new Map<string, OkposDailyReport>();
  const duplicated: string[] = [];
  let sheetTotal: number | null = null;
  let parsedSum = 0;
  let overListed = 0;

  for (let i = nameRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const first = text(row[0]);
    if (first === "합계" || first === "총합계") {
      sheetTotal = amount(row, netCol >= 0 ? netCol : payTotalCol);
      continue;
    }
    const date = parseDateCell(row[0]);
    if (!date) continue;

    // 요일이 날짜와 안 맞으면 날짜를 잘못 읽은 것이다 — 하나라도 그러면 통째로 멈춘다
    if (dowCol >= 0) {
      const written = text(row[dowCol]);
      const actual = DOW_KO[new Date(`${date}T00:00:00Z`).getUTCDay()];
      if (DOW_KO.includes(written) && written !== actual) {
        throw new OkposParseError(
          `${monthDay(date)}은 ${actual}요일인데 엑셀에는 ${written}요일로 적혀 있습니다. 날짜를 잘못 읽었을 수 있어 아무것도 반영하지 않았습니다.`
        );
      }
    }

    const payments = Object.fromEntries(
      PAYMENT_COLUMNS.map(([key, name]) => [key, amount(row, col("결제수단", name))])
    ) as unknown as OkposPayments;
    payments.otherPay += extraPaymentCols.reduce((sum, { c }) => sum + amount(row, c), 0);

    const netAmount = netCol >= 0 ? amount(row, netCol) : amount(row, payTotalCol);
    const paymentTotal = payTotalCol >= 0 ? amount(row, payTotalCol) : netAmount;
    const listed = Object.values(payments).reduce((sum, value) => sum + value, 0);
    if (listed > paymentTotal) overListed += 1;

    if (parsed.has(date)) duplicated.push(date);
    parsedSum += netAmount - (parsed.get(date)?.netAmount ?? 0);
    parsed.set(date, {
      businessDate: date,
      grossAmount: amount(row, col("매출현황", "총매출")),
      discountAmount: amount(row, col("매출현황", "총할인")),
      netAmount,
      supplyAmount: amount(row, col("매출현황", "가액")),
      vatAmount: amount(row, col("매출현황", "부가세")),
      receiptCount: amount(row, col("매출현황", "영수건수")),
      customerCount: amount(row, col("고객", "고객수")),
      paymentTotal,
      payments,
      unlistedPayment: Math.max(0, paymentTotal - listed),
      discounts: discountCols
        .map(({ name, c }) => ({ name, amount: amount(row, c) }))
        .filter((discount) => discount.amount !== 0),
      ...(fileName ? { fileName } : {}),
    });
  }

  if (parsed.size === 0) {
    throw new OkposParseError("날짜가 적힌 줄이 없습니다. 조회 기간에 매출이 있는지 확인해 주세요.");
  }
  if (duplicated.length > 0) {
    warnings.push(`같은 날짜가 두 번 나와 아래 줄을 썼습니다: ${listDays(duplicated)}.`);
  }
  if (overListed > 0) {
    warnings.push(`결제수단 합이 결제합계보다 큰 날이 ${overListed}일 있습니다. OK포스 화면과 한 번 대조해 주세요.`);
  }
  if (sheetTotal !== null && Math.abs(sheetTotal - parsedSum) > 1) {
    warnings.push(
      `엑셀 합계 줄(${sheetTotal.toLocaleString("ko-KR")}원)과 날짜별 합(${parsedSum.toLocaleString("ko-KR")}원)이 다릅니다. 빠진 줄이 있을 수 있습니다.`
    );
  }

  /* ── 반영할 날 고르기 ── */
  const future: string[] = [];
  const zero: string[] = [];
  const days: OkposDailyReport[] = [];
  [...parsed.values()]
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    .forEach((day) => {
      if (day.businessDate > today) { future.push(day.businessDate); return; }
      // 0원은 «안 팔린 날»인지 «안 찍힌 날»인지 모른다. 그날은 네이버 숫자를 남긴다.
      if (day.netAmount === 0 && day.receiptCount === 0) { zero.push(day.businessDate); return; }
      days.push(day);
    });
  if (future.length > 0) warnings.push(`오늘 뒤 날짜는 뺐습니다: ${listDays(future)}.`);
  if (zero.length > 0) warnings.push(`실매출 0원인 날은 뺐습니다(그날은 네이버 숫자가 남습니다): ${listDays(zero)}. 휴무였다면 정상입니다.`);
  if (days.some((day) => day.businessDate === today)) {
    warnings.push(`오늘(${monthDay(today)}) 줄이 들어 있습니다. 마감 전 숫자일 수 있어요 — 마감 뒤 다시 올리면 덮어씁니다.`);
  }
  if (period) {
    const missing: string[] = [];
    for (let key = period.start; key <= period.end && key <= today; key = shiftDay(key, 1)) {
      if (!parsed.has(key)) missing.push(key);
    }
    if (missing.length > 0) warnings.push(`조회 기간 안인데 엑셀에 줄이 없는 날: ${listDays(missing)}. 휴무였다면 정상입니다.`);
  }

  return { title, period, days, sheetTotal, warnings };
}

function shiftDay(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/* ============================================================
   화면에서 쓰는 묶음
   ============================================================ */

export interface OkposPaymentGroups {
  /** 신용카드 + 제휴카드 + 사원카드 */
  card: number;
  /** 단순현금 + 현금영수 */
  cash: number;
  /** 상품권 + 전자상품권 + 식권 + 모바일쿠폰 */
  voucher: number;
  /** 외상 + 회원포인트 + 캐시비 + 온라인결제 + 기타결제 */
  other: number;
  /** 결제합계 − 엑셀에 칸이 있는 수단 합 */
  unlisted: number;
}

export const PAYMENT_GROUP_LABELS: Record<keyof OkposPaymentGroups, string> = {
  card: "카드",
  cash: "현금",
  voucher: "상품권·쿠폰",
  other: "그 외 수단",
  unlisted: "엑셀에 칸 없는 결제",
};

export function okposPaymentGroups(report: Pick<OkposDailyReport, "payments" | "unlistedPayment">): OkposPaymentGroups {
  const p = report.payments;
  return {
    card: p.card + p.partnerCard + p.employeeCard,
    cash: p.simpleCash + p.cashReceipt,
    voucher: p.voucher + p.eVoucher + p.mealTicket + p.mobileCoupon,
    other: p.credit + p.memberPoint + p.cashbee + p.onlinePay + p.otherPay,
    unlisted: report.unlistedPayment,
  };
}

/**
 * 저장된 하루치를 화면이 쓸 모양으로 — **OK포스가 있으면 그날 매출은 OK포스 숫자다.**
 *
 * 네이버 숫자는 `naverNetAmount` 로 남겨 둔다(둘을 견줘 «네이버가 놓친 금액»을 본다).
 * 이 한 곳에서 바꿔 두면 POS 달력·오늘 마감·손익·대시보드가 따로 고칠 것 없이 따라온다.
 */
export function withOkpos(row: SalesDailySummary): SalesDailySummary {
  const naverNetAmount = row.source === "ownervista" ? row.netAmount : null;
  const okpos = row.okpos ?? null;
  if (!okpos) return { ...row, okpos: null, naverNetAmount };
  const groups = okposPaymentGroups(okpos);
  return {
    ...row,
    netAmount: okpos.netAmount,
    grossAmount: okpos.grossAmount,
    discountAmount: okpos.discountAmount,
    orderCount: okpos.receiptCount,
    hasOrderCount: true,
    averageOrderAmount: okpos.receiptCount > 0 ? Math.round(okpos.netAmount / okpos.receiptCount) : 0,
    paymentTotals: [
      { method: "card", amount: groups.card },
      { method: "cash", amount: groups.cash },
      { method: "voucher", amount: groups.voucher },
      { method: "other", amount: groups.other + groups.unlisted },
    ],
    source: "okpos",
    sourceLabel: "OK포스",
    naverNetAmount,
    okpos,
  };
}

export interface OkposRangeSummary {
  /** 기간 안에서 OK포스 숫자를 쓴 날 수 */
  days: number;
  netAmount: number;
  receiptCount: number;
  customerCount: number;
  discountAmount: number;
  groups: OkposPaymentGroups;
  /** 네이버 숫자도 있는 날끼리만 견준다 — «네이버가 놓친 금액» */
  compared: { days: number; naver: number; okpos: number };
}

/** 기간(양 끝 포함) 안 OK포스 날들을 합친다. `withOkpos` 를 거친 줄을 받는다. */
export function okposRangeSummary(rows: SalesDailySummary[], start: string, end: string): OkposRangeSummary {
  const summary: OkposRangeSummary = {
    days: 0,
    netAmount: 0,
    receiptCount: 0,
    customerCount: 0,
    discountAmount: 0,
    groups: { card: 0, cash: 0, voucher: 0, other: 0, unlisted: 0 },
    compared: { days: 0, naver: 0, okpos: 0 },
  };
  rows.forEach((row) => {
    const okpos = row.okpos;
    if (!okpos || row.businessDate < start || row.businessDate > end) return;
    summary.days += 1;
    summary.netAmount += okpos.netAmount;
    summary.receiptCount += okpos.receiptCount;
    summary.customerCount += okpos.customerCount;
    summary.discountAmount += okpos.discountAmount;
    const groups = okposPaymentGroups(okpos);
    (Object.keys(groups) as Array<keyof OkposPaymentGroups>).forEach((key) => { summary.groups[key] += groups[key]; });
    if (typeof row.naverNetAmount === "number") {
      summary.compared.days += 1;
      summary.compared.naver += row.naverNetAmount;
      summary.compared.okpos += okpos.netAmount;
    }
  });
  return summary;
}
