import type { Reservation } from "../data/types";

/* ============================================================
   네이버 예약을 예약 화면에 보일 때 쓰는 계산 (브라우저·Firebase 없이 돈다)

   동기화(functions/naverReservationSync.js)는 네이버 예약을 새로 만들 때 같은 날 손으로
   넣어 둔 예약과 견준다. 전화가 같은 것이 딱 하나면 그 예약에 네이버 번호를 붙이고(입양),
   이름만 같거나 하나를 고를 수 없으면 만들되 `naver.duplicateOf` 로 그 예약들을 가리킨다.
   **합치지도 지우지도 않는다** — 이 화면이 「중복 확인 필요」로 보이고, 사람이 정한다.

   동기화 뒤에 직원이 같은 손님을 또 손으로 적는 일도 있다. 그래서 화면은 동기화가 남긴
   표시에 더해, 같은 날 전화·이름이 같은 손 예약도 같이 가리킨다(동기화와 같은 규칙).
   직원이 「다른 예약입니다」를 누르면 `naver.notDuplicateOf` 에 남아 다시 안 가리킨다.
   ============================================================ */

/** 네이버 예약 동기화가 만들었거나 이어 붙인 예약인가. */
export function isNaverReservation(r: Pick<Reservation, "source" | "naver">): boolean {
  return r.source === "naver" && Boolean(r.naver?.bookingId);
}

/**
 * 전화번호를 견주는 열쇠. 동기화의 `phoneKey` 와 같은 규칙 — 숫자만 남기고 010 으로 맞춘다.
 * 모르는 모양이면 `null`(견주지 않는다).
 */
export function phoneKey(raw: string | null | undefined): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("82") && digits.length >= 10 && digits.length <= 12) digits = `0${digits.slice(2)}`;
  if (digits.length === 8) digits = `010${digits}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return /^0\d{8,10}$/.test(digits) ? digits : null;
}

/** 이름 열쇠. 띄어쓰기와 끝의 「님」만 뺀다. */
export function nameKey(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\s+/g, "").replace(/님$/, "");
}

export interface NaverDuplicateFlags {
  /** 네이버 예약 id → 같은 예약일지 모르는 손 예약들 */
  byNaver: Map<number, Reservation[]>;
  /** 손 예약 id → 그것과 겹쳐 보이는 네이버 예약들 */
  byManual: Map<number, Reservation[]>;
}

/**
 * 하루치 예약(취소 뺀 것)에서 「중복 확인 필요」를 단다.
 *
 * 네이버 예약 n 과 손 예약 m 이 겹쳐 보이는 것은
 *   - 동기화가 n 을 만들 때 m 을 가리켰거나(`n.naver.duplicateOf`),
 *   - 전화 열쇠가 같거나, 이름 열쇠가 같을 때다.
 * 직원이 「다른 예약입니다」라고 한 짝(`n.naver.notDuplicateOf`)은 빼고, 다른 날·취소된 예약은
 * 처음부터 견주지 않는다(넘겨받은 목록 안에서만).
 */
export function naverDuplicateFlags(dayReservations: Reservation[]): NaverDuplicateFlags {
  const active = dayReservations.filter((r) => r.status !== "취소");
  const manual = active.filter((r) => !isNaverReservation(r));
  const byNaver = new Map<number, Reservation[]>();
  const byManual = new Map<number, Reservation[]>();

  for (const n of active.filter(isNaverReservation)) {
    const marked = new Set(n.naver?.duplicateOf ?? []);
    const dismissed = new Set(n.naver?.notDuplicateOf ?? []);
    const phone = phoneKey(n.phone);
    const name = nameKey(n.name);
    const suspects = manual.filter((m) => {
      if (m.date !== n.date || dismissed.has(m.id)) return false;
      if (marked.has(m.id)) return true;
      if (phone && phoneKey(m.phone) === phone) return true;
      return Boolean(name) && nameKey(m.name) === name;
    });
    if (suspects.length === 0) continue;
    byNaver.set(n.id, suspects);
    for (const m of suspects) byManual.set(m.id, [...(byManual.get(m.id) ?? []), n]);
  }
  return { byNaver, byManual };
}

/**
 * 「다른 예약입니다」. 네이버 예약에 «이 손 예약들과는 다른 예약»이라고 적은 새 모양을 돌려준다.
 * 동기화는 이 칸을 읽지도 고치지도 않는다(네이버 표시를 고칠 때 `naver` 의 다른 칸은 그대로 둔다).
 */
export function markNotDuplicate(n: Reservation, manualIds: number[]): Reservation {
  if (!n.naver) return n;
  const next = new Set([...(n.naver.notDuplicateOf ?? []), ...manualIds]);
  return { ...n, naver: { ...n.naver, notDuplicateOf: [...next].sort((a, b) => a - b) } };
}

/** 동기화가 왜 합치지 않았는지 — 화면에 그대로 적을 말. */
export function duplicateReasonText(reason: string | null | undefined): string | null {
  switch (reason) {
    case "same-name":
      return "이름은 같은데 연락처가 달라 합치지 않았습니다.";
    case "same-name-no-phone":
      return "이름은 같은데 연락처가 없어 합치지 않았습니다.";
    case "same-phone-multiple":
      return "같은 날 같은 연락처의 예약이 여럿이라 어느 것인지 몰라 합치지 않았습니다.";
    case "same-phone-multiple-naver":
      return "같은 손님의 네이버 예약이 같은 날 여럿이라 어느 것인지 몰라 합치지 않았습니다.";
    default:
      return null;
  }
}
