"use strict";

/**
 * 매일 정한 시각에 나챗방(카카오톡 「나와의 채팅」) 등록된 곳 모두에 보내는 것.
 *
 *   오전 11:00  오늘 예약 — 시간순 «11:50 최미선 3명»
 *   오후 10:30  일일 정산 — 매출·이번 달 누적·매입·예약·체크리스트
 *              (매장이 22시에 마친다 — 오너비스타의 22시 매출 수집을 30분 기다린 뒤 보낸다)
 *
 * (2026-10-19 사장님 요청.) 화면의 「시험으로 보내기」도 같은 글을 같은 곳에 보낸다 — 다만 시험은
 * 그날 자동 발송을 막지 않는다(밤 9시 50분에 시험해도 10시 정산은 나간다).
 *
 * **매출은 보내기 직전에 오너비스타에서 다시 받아 온다.** 평소 받아 오는 것은 새벽 6시 5분 한 번이라,
 * 그냥 보내면 그날 매출이 비어 있다. 오너비스타의 네이버 매출 수집은 매장 설정 시각(기본 12·17·21시)이라
 * 밤 10시 정산에는 마지막 수집 이후 결제가 빠질 수 있다 — 그래서 출처를 글에 같이 적는다.
 * OK포스 엑셀을 올린 날은 OK포스 숫자가 먼저다(화면·AI 비서와 같은 규칙).
 *
 * **같은 날 두 번 나가지 않게.** 자동 발송은 kakaoMemoReports/{날짜}_{종류} 에 남기고, 이미
 * 보냈으면 건너뛴다(스케줄러가 다시 불러도).
 *
 * 글은 카카오 텍스트 한도 200자 안. 넘치면 예약은 «외 N팀»으로 줄인다.
 */

const { checklistRows, MEMO_TEXT_LIMIT } = require("./kakaoMemo");

const DOW = ["월", "화", "수", "목", "금", "토", "일"];

const REPORTS = {
  reservations: { label: "오늘 예약", time: "11:00", buttonTitle: "예약 보기", path: "/reservations" },
  settlement: { label: "일일 정산", time: "22:30", buttonTitle: "정산 보기", path: "/finance?tab=close" },
};

function weekdayOf(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function md(date) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${DOW[weekdayOf(date)]})`;
}

function won(value) {
  return `${Math.round(Number(value) || 0).toLocaleString("ko-KR")}원`;
}

function isInactive(status) {
  return /취소|노쇼|cancel/i.test(String(status || ""));
}

/** 하루치 매출 문서 → 그날 매출. OK포스가 먼저, 다음이 네이버. 숫자가 없으면 null — 0원이 아니다. */
function effectiveSales(doc) {
  if (!doc) return null;
  if (doc.okpos && typeof doc.okpos.netAmount === "number") return { amount: doc.okpos.netAmount, source: "okpos" };
  if (typeof doc.netAmount === "number") return { amount: doc.netAmount, source: doc.source === "ownervista" ? "naver" : "other" };
  return null;
}

const SOURCE_LABEL = { okpos: "OK포스", naver: "네이버", other: "POS" };

/* ── 글 ─────────────────────────────────────────────────── */

/**
 * 오늘 예약. 취소·노쇼는 빼고 시간순. 200자를 넘기면 뒤쪽을 «외 N팀»으로 줄인다.
 * 전화번호는 넣지 않는다 — 필요하면 링크로 예약 화면을 연다.
 */
function buildReservationsMemo({ date, reservations }) {
  const active = reservations
    .filter((r) => !isInactive(r.status))
    .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  if (active.length === 0) return `[하늘땅] ${md(date)} 오늘 예약 없음`;
  const people = active.reduce((sum, r) => sum + (Number(r.people) || 0), 0);
  const head = `[하늘땅] ${md(date)} 오늘 예약 ${active.length}팀 · ${people}명`;
  const lines = active.map((r) => `${r.time || "시간 미정"} ${r.name || "이름 없음"} ${Number(r.people) || 0}명${r.seat ? ` ${r.seat}` : ""}`);
  let text = head;
  for (let i = 0; i < lines.length; i += 1) {
    const rest = lines.length - (i + 1);
    const tail = rest > 0 ? `\n외 ${rest}팀` : "";
    const next = `${text}\n${lines[i]}`;
    // 이 줄을 넣고도 «외 N팀»이 들어갈 자리가 남아야 넣는다
    if (`${next}${tail}`.length > MEMO_TEXT_LIMIT) {
      return `${text}\n외 ${lines.length - i}팀`.slice(0, MEMO_TEXT_LIMIT);
    }
    text = next;
  }
  return text;
}

/** 일일 정산. 모르는 칸은 «아직 안 들어옴»·«없음»으로 적는다 — 0원으로 채우지 않는다. */
function buildSettlementMemo({ date, sales, month, purchases, manualSales, reservations, checklist }) {
  const lines = [`[하늘땅] ${md(date)} 일일 정산`];
  lines.push(sales ? `매출 ${won(sales.amount)} (${SOURCE_LABEL[sales.source] || "POS"})` : "매출 아직 안 들어옴");
  if (month && month.days > 0) lines.push(`이번 달 ${won(month.total)} · ${month.days}일`);
  lines.push(purchases && purchases.count > 0 ? `매입 ${won(purchases.total)} · ${purchases.count}건` : "매입 없음");
  if (manualSales > 0) lines.push(`직접 입력 매출 ${won(manualSales)}`);
  const noShow = reservations.noShow ? ` · 노쇼 ${reservations.noShow}` : "";
  lines.push(reservations.teams > 0 ? `예약 ${reservations.teams}팀 ${reservations.people}명${noShow}` : `예약 없음${noShow}`);
  if (checklist) lines.push(`체크리스트 ${checklist}`);
  return lines.join("\n").slice(0, MEMO_TEXT_LIMIT);
}

/** "오픈 4/4 · 마감 3/4" — 항목이 없으면 null */
function checklistSummary(rows) {
  const parts = ["open", "close"]
    .map((section) => {
      const inSection = rows.filter((row) => row.section === section && !row.removed);
      if (inSection.length === 0) return null;
      const done = inSection.filter((row) => row.checked).length;
      return `${section === "open" ? "오픈" : "마감"} ${done}/${inSection.length}`;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** 발주서의 기준 날짜 — 매출·매입 화면(orderBaseDate)과 같은 규칙 */
function orderBaseDate(order) {
  return String(order.receivedAt || order.orderedAt || order.createdAt || "").slice(0, 10);
}

/* ── 모으기·보내기 ──────────────────────────────────────── */

function createDailyReports(deps) {
  const {
    admin, storeCol, storeDoc, formatDate,
    kakaoMemo,
    /** 일일 정산 직전에 오너비스타 매출을 다시 받아 온다. 실패해도 정산은 나간다. */
    syncSales = async () => undefined,
    appBaseUrl,
    now = () => Date.now(),
  } = deps;

  const serverTime = () => admin.firestore.FieldValue.serverTimestamp();
  const urlOf = (path) => new URL(path, appBaseUrl).toString();

  async function reservationsOf(date) {
    const snap = await storeCol("reservations").where("date", "==", date).get();
    return snap.docs.map((doc) => doc.data());
  }

  async function gatherSettlement(date) {
    const monthStart = `${date.slice(0, 7)}-01`;
    const [salesSnap, monthSnap, ordersSnap, closeSnap, reservations, templateSnap, daySnap] = await Promise.all([
      storeDoc("salesDailySummaries", date).get(),
      storeCol("salesDailySummaries").where("businessDate", ">=", monthStart).where("businessDate", "<=", date).get(),
      storeCol("purchaseOrders").get(),
      storeDoc("financeDailyCloses", date).get(),
      reservationsOf(date),
      storeDoc("meta", "checklistTemplate").get(),
      storeDoc("checklistDays", date).get(),
    ]);
    const month = monthSnap.docs
      .map((doc) => effectiveSales(doc.data()))
      .filter(Boolean)
      .reduce((acc, sales) => ({ total: acc.total + sales.amount, days: acc.days + 1 }), { total: 0, days: 0 });
    const todayOrders = ordersSnap.docs
      .map((doc) => doc.data())
      .filter((order) => order.status !== "canceled" && orderBaseDate(order) === date);
    const close = closeSnap.exists ? closeSnap.data() : null;
    const active = reservations.filter((r) => !isInactive(r.status));
    return {
      date,
      sales: effectiveSales(salesSnap.exists ? salesSnap.data() : null),
      month,
      purchases: { total: todayOrders.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0), count: todayOrders.length },
      manualSales: close ? (Number(close.cashSales) || 0) + (Number(close.transferSales) || 0) + (Number(close.otherSales) || 0) : 0,
      reservations: {
        teams: active.length,
        people: active.reduce((sum, r) => sum + (Number(r.people) || 0), 0),
        noShow: reservations.filter((r) => /노쇼/.test(String(r.status || ""))).length,
      },
      checklist: checklistSummary(checklistRows(templateSnap.exists ? templateSnap.data() : null, daySnap.exists ? daySnap.data() : null, date)),
    };
  }

  /**
   * 한 종류를 지금 보낸다. trigger: "scheduled"(정한 시각) | "test"(화면의 시험으로 보내기).
   * @returns {{ status: "sent"|"failed"|"no_links", text: string, delivered: string[], failed: object[] }}
   */
  async function send(type, { date = formatDate(), trigger = "test", by = "" } = {}) {
    const report = REPORTS[type];
    if (!report) throw new Error(`모르는 보고: ${type}`);
    kakaoMemo.keys();

    let text;
    if (type === "settlement") {
      try {
        await syncSales();
      } catch (error) {
        // 받아 오지 못해도 정산은 나간다 — 있는 숫자로, 없으면 «아직 안 들어옴»
        console.warn("DAILY_SETTLEMENT_SYNC_FAILED", error.message);
      }
      text = buildSettlementMemo(await gatherSettlement(date));
    } else {
      text = buildReservationsMemo({ date, reservations: await reservationsOf(date) });
    }

    const { linkCount, delivered, failed } = await kakaoMemo.broadcast({ text, link: urlOf(report.path), buttonTitle: report.buttonTitle });
    const status = linkCount === 0 ? "no_links" : delivered.length > 0 ? "sent" : "failed";
    // 화면의 「매일 자동으로 보내는 것」이 마지막 발송을 보여 준다
    await storeDoc("meta", "kakaoMemoSchedule").set({
      [type]: { date, status, trigger, by, delivered: delivered.length, failed: failed.length, at: serverTime(), atMs: now() },
    }, { merge: true });
    return { status, text, delivered, failed };
  }

  /** 정한 시각에 부른다. 그날 이미 보냈으면 건너뛴다. */
  async function runScheduled(type) {
    const date = formatDate();
    const ref = storeDoc("kakaoMemoReports", `${date}_${type}`);
    const snap = await ref.get();
    if (snap.exists && snap.data().status === "sent") return { status: "skipped" };
    const result = await send(type, { date, trigger: "scheduled", by: "자동" });
    await ref.set({ type, date, status: result.status, delivered: result.delivered.length, failed: result.failed.length, text: result.text, at: serverTime() });
    return result;
  }

  return { send, runScheduled, gatherSettlement };
}

module.exports = {
  createDailyReports,
  buildReservationsMemo,
  buildSettlementMemo,
  checklistSummary,
  effectiveSales,
  REPORTS,
};
