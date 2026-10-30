import type { Reservation } from "../data/types";
import { phoneKey } from "./naverReservations";

/* ============================================================
   손님 이력 — 같은 전화번호의 지난 예약으로 단골·노쇼를 알려 준다 (2026-10-30 사장님 요청)

   예약을 넣거나 볼 때 「방문 7번 · 노쇼 1번 · 마지막 방문 9/14」. 새로 모으는 데이터는 없다 —
   예약 목록에 이미 다 있다. 네이버 예약도 동기화로 들어오니 손님 한 명의 기록이 한곳에 모인다.

   - 같은 손님 = 전화 열쇠가 같다(네이버 중복 확인과 같은 `phoneKey` — 숫자만, 010 으로 맞춤).
     이름은 안 본다. 동명이인을 한 사람으로 합치면 남의 노쇼가 붙는다.
   - 다녀감 = 「방문완료」, 또는 **지난 날짜**의 예약확정·단체(마감 때 방문완료를 안 누른 날이 많다).
     오늘·앞날 예약은 아직 안 다녀간 것이고, 취소·노쇼·대기·확인전화필요는 다녀간 것이 아니다.
   - 단골 = 다녀감 3번 이상.
   - 지금 보고 있는 예약은 빼고 센다 — 자기 자신이 이력이 되지 않게.

   이 파일은 타입과 phoneKey 말고는 아무것도 import 하지 않는다(scripts/check-customer-history.mjs 가 묶어 검사).
   ============================================================ */

export const REGULAR_VISITS = 3;

const VISITED_IF_PAST = new Set(["예약확정", "단체"]);

export interface CustomerHistory {
  /** 이 번호로 들어온 다른 예약 수 */
  total: number;
  visits: number;
  noShows: number;
  cancels: number;
  /** 마지막으로 다녀간 날 YYYY-MM-DD */
  lastVisit: string | null;
  /** 오늘 이후 다른 예약 */
  upcoming: number;
  regular: boolean;
}

/** 전화 열쇠 → 그 번호의 예약들. 예약 화면이 한 번 만들어 두고 줄마다 묻는다. */
export function buildCustomerIndex(reservations: Reservation[]): Map<string, Reservation[]> {
  const index = new Map<string, Reservation[]>();
  for (const reservation of reservations) {
    const key = phoneKey(reservation.phone);
    if (!key) continue;
    const list = index.get(key);
    if (list) list.push(reservation);
    else index.set(key, [reservation]);
  }
  return index;
}

function isVisit(reservation: Reservation, today: string): boolean {
  if (reservation.status === "방문완료") return true;
  return reservation.date < today && VISITED_IF_PAST.has(reservation.status);
}

/**
 * 이 번호의 이력. 번호를 못 읽거나 다른 예약이 하나도 없으면 null(「처음 오시는 손님」).
 * `excludeId` 는 지금 보고 있는(고치는) 예약 — 자기 자신은 안 센다.
 */
export function customerHistory(
  index: Map<string, Reservation[]>,
  phone: string | null | undefined,
  today: string,
  excludeId?: number,
): CustomerHistory | null {
  const key = phoneKey(phone);
  if (!key) return null;
  const others = (index.get(key) ?? []).filter((reservation) => reservation.id !== excludeId);
  if (others.length === 0) return null;

  let visits = 0;
  let noShows = 0;
  let cancels = 0;
  let upcoming = 0;
  let lastVisit: string | null = null;
  for (const reservation of others) {
    if (isVisit(reservation, today)) {
      visits += 1;
      if (!lastVisit || reservation.date > lastVisit) lastVisit = reservation.date;
    } else if (reservation.status === "노쇼") {
      noShows += 1;
    } else if (reservation.status === "취소") {
      cancels += 1;
    } else if (reservation.date >= today) {
      upcoming += 1;
    }
  }
  return { total: others.length, visits, noShows, cancels, lastVisit, upcoming, regular: visits >= REGULAR_VISITS };
}

/** "10/14" — 올해가 아니면 "2025/10/14" */
function shortDate(date: string, today: string): string {
  const [year, month, day] = date.split("-");
  const md = `${Number(month)}/${Number(day)}`;
  return year === today.slice(0, 4) ? md : `${year}/${md}`;
}

/** 「방문 7번 · 노쇼 1번 · 취소 2번 · 마지막 방문 9/14 · 다른 예약 1건」 — 0 인 칸은 안 적는다 */
export function historySummary(history: CustomerHistory, today: string): string {
  const parts: string[] = [];
  parts.push(history.visits > 0 ? `방문 ${history.visits}번` : "다녀간 기록 없음");
  if (history.noShows > 0) parts.push(`노쇼 ${history.noShows}번`);
  if (history.cancels > 0) parts.push(`취소 ${history.cancels}번`);
  if (history.lastVisit) parts.push(`마지막 방문 ${shortDate(history.lastVisit, today)}`);
  if (history.upcoming > 0) parts.push(`다른 예약 ${history.upcoming}건`);
  return parts.join(" · ");
}
