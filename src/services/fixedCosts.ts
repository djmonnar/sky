/* ============================================================
   손익 고정비 Firestore

   stores/{STORE_ID}/fixedCosts/{YYYY-MM}  — 그달 고정비 항목(관리자만 읽고 쓴다)
   ============================================================ */

import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { requireDb, STORE_ID } from "../lib/firebase";
import type { FixedCostItem, FixedCostMonth } from "../data/types";
import { cleanFixedCostItems } from "../lib/fixedCosts";

type ErrCb = (error: Error) => void;

function monthDoc(month: string) {
  return doc(requireDb(), "stores", STORE_ID, "fixedCosts", month);
}

function toMonth(month: string, data: Record<string, unknown> | undefined): FixedCostMonth | null {
  if (!data) return null;
  const updatedAt = data.updatedAt as { toDate?: () => Date } | undefined;
  return {
    month,
    items: cleanFixedCostItems(Array.isArray(data.items) ? data.items as FixedCostItem[] : []),
    updatedAt: updatedAt && typeof updatedAt.toDate === "function" ? updatedAt.toDate().toISOString() : undefined,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : undefined,
  };
}

/** 그달 고정비. 아직 안 적은 달은 null — 0원이 아니라 «미입력» */
export function subscribeFixedCosts(month: string, cb: (v: FixedCostMonth | null) => void, onError: ErrCb): () => void {
  return onSnapshot(
    monthDoc(month),
    (snap) => cb(snap.exists() ? toMonth(month, snap.data()) : null),
    (e) => onError(new Error(`fixedCosts: ${e.message}`)),
  );
}

/** «지난달 그대로 가져오기» 에서 한 번 읽는다 */
export async function fsGetFixedCosts(month: string): Promise<FixedCostMonth | null> {
  const snap = await getDoc(monthDoc(month));
  return snap.exists() ? toMonth(month, snap.data()) : null;
}

export async function fsSaveFixedCosts(month: string, items: FixedCostItem[], by: string): Promise<void> {
  await setDoc(monthDoc(month), {
    month,
    items: cleanFixedCostItems(items),
    updatedAt: serverTimestamp(),
    updatedBy: by,
  });
}
