/* ============================================================
   체크리스트 Firestore·함수 호출

   stores/{STORE_ID}/meta/checklistTemplate   — 항목(사장님만 고친다)
   stores/{STORE_ID}/checklistDays/{날짜}       — 그날 체크·특이사항
   stores/{STORE_ID}/kakaoMemoLinks/{카카오id}  — 나챗방 받는 곳(관리자만 읽음, 쓰기는 함수)

   체크는 칸마다 필드 경로로 merge 한다(checks.{id}). 두 사람이 다른 칸을 동시에
   눌러도 서로 안 덮는다.
   ============================================================ */

import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { requireAuth, requireDb, STORE_ID } from "../lib/firebase";
import type {
  ChecklistCheck, ChecklistDay, ChecklistSection, ChecklistTemplate, ChecklistTemplateItem, KakaoMemoLink,
} from "../data/types";

type ErrCb = (error: Error) => void;

function storeDoc(...path: string[]) {
  return doc(requireDb(), "stores", STORE_ID, ...path);
}

/** Firestore 시각 → "YYYY-MM-DD HH:mm" (화면 시각) */
function timeText(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  const value = raw as { toDate?: () => Date } | null | undefined;
  if (value && typeof value.toDate === "function") {
    const d = value.toDate();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return undefined;
}

function sectionOf(raw: unknown): ChecklistSection {
  return raw === "close" ? "close" : "open";
}

export function subscribeChecklistTemplate(cb: (v: ChecklistTemplate | null) => void, onError: ErrCb): () => void {
  return onSnapshot(storeDoc("meta", "checklistTemplate"), (snap) => {
    if (!snap.exists()) { cb(null); return; }
    const d = snap.data();
    cb({
      items: Array.isArray(d.items)
        ? d.items.map((item: Record<string, unknown>): ChecklistTemplateItem => ({
          id: String(item.id ?? ""),
          section: sectionOf(item.section),
          text: String(item.text ?? ""),
          days: Array.isArray(item.days) ? item.days.map(Number).filter((n: number) => n >= 0 && n <= 6) : [],
        })).filter((item: ChecklistTemplateItem) => item.id && item.text)
        : [],
      updatedAt: timeText(d.updatedAt),
      updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : undefined,
    });
  }, (e) => onError(new Error(`checklistTemplate: ${e.message}`)));
}

export function subscribeChecklistDay(date: string, cb: (v: ChecklistDay | null) => void, onError: ErrCb): () => void {
  return onSnapshot(storeDoc("checklistDays", date), (snap) => {
    if (!snap.exists()) { cb(null); return; }
    const d = snap.data();
    const checks: Record<string, ChecklistCheck> = {};
    Object.entries((d.checks ?? {}) as Record<string, Record<string, unknown>>).forEach(([id, check]) => {
      checks[id] = {
        checked: Boolean(check?.checked),
        text: String(check?.text ?? ""),
        section: sectionOf(check?.section),
        by: typeof check?.by === "string" ? check.by : undefined,
        at: timeText(check?.at),
      };
    });
    const sent = d.sent as Record<string, unknown> | undefined;
    cb({
      date,
      checks,
      note: typeof d.note === "string" ? d.note : "",
      noteBy: typeof d.noteBy === "string" ? d.noteBy : undefined,
      noteAt: timeText(d.noteAt),
      sent: sent ? {
        at: timeText(sent.at) ?? "",
        by: String(sent.by ?? ""),
        delivered: Number(sent.delivered ?? 0),
        failed: Number(sent.failed ?? 0),
      } : null,
    });
  }, (e) => onError(new Error(`checklistDays: ${e.message}`)));
}

export function subscribeKakaoMemoLinks(cb: (v: KakaoMemoLink[]) => void, onError: ErrCb): () => void {
  return onSnapshot(collection(requireDb(), "stores", STORE_ID, "kakaoMemoLinks"), (snap) => {
    cb(snap.docs.map((item) => {
      const d = item.data();
      return {
        id: item.id,
        label: String(d.label ?? "나챗방"),
        nickname: typeof d.nickname === "string" ? d.nickname : null,
        linkedAt: timeText(d.linkedAt) ?? "",
        linkedBy: typeof d.linkedBy === "string" ? d.linkedBy : undefined,
        active: d.active !== false,
        lastError: typeof d.lastError === "string" ? d.lastError : null,
        lastSentAt: timeText(d.lastSentAt) ?? null,
      };
    }).sort((a, b) => a.linkedAt.localeCompare(b.linkedAt)));
  }, (e) => onError(new Error(`kakaoMemoLinks: ${e.message}`)));
}

export async function fsSaveChecklistTemplate(items: ChecklistTemplateItem[], updatedBy: string): Promise<void> {
  await setDoc(storeDoc("meta", "checklistTemplate"), { items, updatedBy, updatedAt: serverTimestamp() });
}

export async function fsSetChecklistCheck(
  date: string,
  item: { id: string; text: string; section: ChecklistSection },
  checked: boolean,
  by: string,
): Promise<void> {
  await setDoc(storeDoc("checklistDays", date), {
    date,
    checks: { [item.id]: { checked, text: item.text, section: item.section, by, at: serverTimestamp() } },
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function fsSaveChecklistNote(date: string, note: string, by: string): Promise<void> {
  await setDoc(storeDoc("checklistDays", date), {
    date,
    note,
    noteBy: by,
    noteAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/** 함수 checklistApi 호출 — 보내기·연결 링크·연결 끊기 */
export async function callChecklistApi<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const user = requireAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const token = await user.getIdToken();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  let res: Response;
  try {
    res = await fetch(`https://asia-northeast3-${projectId}.cloudfunctions.net/checklistApi`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    /*
      응답을 읽기도 전에 실패한 것 — 함수가 아직 배포되지 않았으면 없는 주소가 CORS 머리글 없이
      404 를 돌려줘 브라우저가 «Failed to fetch» 로 막는다. 인터넷이 끊겨도 같다. 영어 그대로 보이면
      사장님은 무엇을 해야 할지 모른다.
    */
    throw new Error("나챗방 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고, 계속되면 아직 배포 전인지 확인해 주세요.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.message || (res.status === 404 ? "나챗방 기능이 아직 배포되지 않았습니다." : "요청을 처리하지 못했습니다."));
  }
  return json as T;
}
