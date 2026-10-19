import { useEffect, useState } from "react";
import { useStore } from "../store";
import { fsSyncNaverReservations, subscribeNaverReservationSync } from "../services/firestore";
import type { NaverReservationSyncState } from "../data/types";

/* ============================================================
   네이버 예약 동기화 한 줄 (예약 화면 맨 위)

   네이버 예약은 오너비스타가 5분마다 모으고, 하늘땅 함수가 5분마다 받아 온다.
   그래서 이 화면의 네이버 예약은 「지금」이 아니라 「마지막으로 확인했을 때」다 —
   그 시각을 말하는 줄이다. 못 받았으면 왜 못 받았는지를 그대로 보여 준다.

   **어느 네이버 매장 예약인지도 말한다.** 한 계정에 매장이 여럿일 수 있고(하늘땅:
   본점 둘·진해점 하나), 잘못 잡히면 수집은 「성공」인데 늘 0건이다 — 2026-10-19 까지
   진해점이 잡혀 한 달 가까이 아무도 몰랐다. 같은 이름의 본점이 둘이라 번호까지 적는다.

   한 번도 안 돌았거나(연결 키 없음) 규칙을 아직 안 올려 못 읽으면 줄을 안 그린다.
   예약 화면 전체를 오류로 만들 일은 아니다.
   ============================================================ */

/** 동기화 상태 한 장. 라이브 모드에서만 구독한다. 못 읽으면 null. */
export function useNaverReservationSync(): NaverReservationSyncState | null {
  const { mode } = useStore();
  const live = mode === "live";
  const [state, setState] = useState<NaverReservationSyncState | null>(null);

  useEffect(() => {
    if (!live) return;
    return subscribeNaverReservationSync(setState, () => setState(null));
  }, [live]);

  return live ? state : null;
}

function clock(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(date);
}

export default function NaverSyncStatus({ state }: { state: NaverReservationSyncState | null }) {
  const { role, showToast } = useStore();
  const [busy, setBusy] = useState(false);

  if (!state) return null;

  const received = state.status === "success" || state.status === "partial";
  const checkedAt = clock(state.lastRunAt);
  const lastSuccessAt = clock(state.lastSuccessAt);
  const collectedAt = clock(state.ownervistaSyncedAt);
  const store = state.businessId
    ? `${state.businessName ?? "네이버 매장"} (${state.businessId})`
    : null;

  const runNow = async () => {
    setBusy(true);
    try {
      const result = await fsSyncNaverReservations();
      showToast(result.message);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "네이버 예약을 받아 오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`naver-sync ${received ? "" : "warn"}`} role="status">
      <span className="badge naver">네이버</span>
      <span className="naver-sync-text">
        {/* 시각 덩어리(「10. 19. 16:50」)는 중간에서 줄이 끊기면 날짜와 시각이 떨어져 읽힌다. */}
        <span className="naver-sync-head">
          {received ? (
            <>
              <span className="nowrap">{checkedAt ?? "-"} 확인</span>
              {collectedAt && <> · <span className="nowrap">오너비스타 수집 {collectedAt}</span></>}
            </>
          ) : (
            <>
              네이버 예약을 못 받았습니다
              {lastSuccessAt && <> · <span className="nowrap">마지막 성공 {lastSuccessAt}</span></>}
            </>
          )}
        </span>
        {store && <span className="naver-sync-message">가져오는 매장: {store}</span>}
        {state.message && <span className="naver-sync-message">{state.message}</span>}
        {received && state.ownervistaSyncFailed && (
          <span className="naver-sync-message">
            오너비스타의 네이버 수집이 실패하고 있어, 그 뒤에 들어온 예약은 아직 모릅니다.
          </span>
        )}
      </span>
      {role === "admin" && (
        <button className="btn btn-outline btn-sm" onClick={runNow} disabled={busy}>
          {busy ? "받는 중…" : "지금 받기"}
        </button>
      )}
    </div>
  );
}
