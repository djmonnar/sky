import { useCallback, useEffect, useState } from "react";
import { APP_MODE, useStore } from "../store";
import type { FixedCostItem, FixedCostMonth } from "../data/types";
import { cleanFixedCostItems } from "../lib/fixedCosts";
import { fsGetFixedCosts, fsSaveFixedCosts, subscribeFixedCosts } from "../services/fixedCosts";

/*
  손익 화면의 고정비 한 달치. 운영은 Firestore, 데모는 메모리(데모 6월에는 예시가 들어 있다).
  전역 store 에 넣지 않았다 — 손익 탭에서만 쓰고, 고른 달 한 장만 구독하면 된다.
*/

const demoMonths = new Map<string, FixedCostMonth>([
  ["2026-05", {
    month: "2026-05",
    items: [
      { id: "demo-rent", name: "임대료", amount: 3_300_000 },
      { id: "demo-mgmt", name: "관리비", amount: 450_000 },
      { id: "demo-power", name: "전기", amount: 1_280_000 },
      { id: "demo-gas", name: "가스", amount: 620_000 },
      { id: "demo-net", name: "통신·인터넷", amount: 88_000 },
    ],
  }],
]);
const demoListeners = new Set<() => void>();

/** `enabled` 가 거짓이면 안 읽는다 — 고정비는 관리자만 읽을 수 있다(규칙). 매니저가 매출·매입 화면을 열어도 조용히. */
export function useFixedCosts(month: string, enabled = true) {
  const { profile, authUser, showToast } = useStore();
  const [current, setCurrent] = useState<FixedCostMonth | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoaded(false);
    setError(null);
    setCurrent(null);
    if (!enabled) return;
    if (APP_MODE !== "live") {
      const sync = () => { setCurrent(demoMonths.get(month) ?? null); setLoaded(true); };
      sync();
      demoListeners.add(sync);
      return () => { demoListeners.delete(sync); };
    }
    return subscribeFixedCosts(
      month,
      (value) => { setCurrent(value); setLoaded(true); },
      (e) => { setError(e.message); setLoaded(true); },
    );
  }, [month, enabled]);

  const save = useCallback(async (items: FixedCostItem[]) => {
    const clean = cleanFixedCostItems(items);
    if (APP_MODE === "live") {
      await fsSaveFixedCosts(month, clean, profile?.name ?? authUser?.email ?? "관리자");
    } else {
      demoMonths.set(month, { month, items: clean, updatedAt: new Date().toISOString(), updatedBy: "김지현" });
      demoListeners.forEach((fn) => fn());
    }
    showToast(`${month} 고정비를 저장했습니다`);
  }, [authUser?.email, month, profile?.name, showToast]);

  /** 다른 달 한 장 — «지난달 그대로 가져오기» */
  const load = useCallback(async (other: string): Promise<FixedCostMonth | null> => {
    if (APP_MODE !== "live") return demoMonths.get(other) ?? null;
    return fsGetFixedCosts(other);
  }, []);

  return { current, loaded, error, save, load };
}
