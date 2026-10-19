/* ============================================================
   Gemini 챗봇 클라이언트

   브라우저는 Gemini API 키를 갖지 않습니다. 로그인 토큰과 대화 내용만
   geminiChat Function으로 보내고, 실제 API 호출과 Firestore 읽기/쓰기는
   서버에서만 일어납니다.
   ============================================================ */

import { requireAuth } from "../lib/firebase";

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export interface PendingActionField {
  label: string;
  value: string;
}

/** 저장 직전 단계. 사용자가 확인을 눌러야 실제로 반영됩니다. */
export interface PendingAction {
  tool: string;
  title: string;
  confirmLabel: string;
  args: Record<string, unknown>;
  fields: PendingActionField[];
}

/**
 * POS 일 매출을 기간으로 묶은 것. OK포스 엑셀을 올린 날은 OK포스 숫자이고 결제수단도 있다.
 * 아닌 날은 네이버 플레이스플러스 — 하루에 금액 하나뿐이다.
 */
export interface SalesReportPayload {
  source: string;
  /** 기간 안에서 OK포스 숫자를 쓴 날 수 */
  okposDays?: number;
  /** 결제수단 — OK포스를 올린 날들끼리만 묶은 것. 없으면 안 온다 */
  payments?: {
    days: number;
    total: number;
    byMethod: { card: number; cash: number; voucher: number; other: number; unlisted: number };
  };
  /** 네이버 숫자도 있는 OK포스 날끼리 견준 것 */
  naverComparison?: { days: number; naver: number; okpos: number };
  rangeStart: string;
  rangeEnd: string;
  dayCount: number;
  /** 오늘까지 지난 일수 */
  elapsedDays: number;
  dataDays: number;
  missingDays: number;
  futureDays: number;
  total: number;
  average: number;
  best: { date: string; amount: number } | null;
  worst: { date: string; amount: number } | null;
  previous: { start: string; end: string; total: number; dataDays: number; changePercent: number | null };
  weekdayAverages: { dow: string; average: number; days: number }[];
  daily: { businessDate: string; dow: string; amount: number; orderCount?: number; source?: "okpos" | "naver" }[];
  /** 매출 내 메뉴 비중. 물어본 기간과 무관한 최근 기간 합계 — 있을 때만 */
  menuShare?: {
    startDate: string;
    endDate: string;
    overallSales: number;
    unlistedSales: number;
    menus: { menuName: string; categoryName: string | null; sales: number; sharePercent: number }[];
    note: string;
  };
}

export type ChatBlock = { type: "salesReport"; payload: SalesReportPayload };

export interface ChatReply {
  reply: string;
  blocks?: ChatBlock[];
  pendingAction?: PendingAction;
}

function chatFunctionUrl(): string {
  const configured = import.meta.env.VITE_GEMINI_CHAT_FUNCTION_URL as string | undefined;
  if (configured) return configured;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  return `https://asia-northeast3-${projectId}.cloudfunctions.net/geminiChat`;
}

async function postChat(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const user = requireAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const token = await user.getIdToken();

  const res = await fetch(chatFunctionUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(json.message ?? "챗봇 응답을 받지 못했습니다."));
  }
  return json;
}

/** 대화 한 턴을 보냅니다. 등록/수정이 필요하면 pendingAction이 함께 돌아옵니다. */
export async function sendChatMessage(messages: ChatMessage[]): Promise<ChatReply> {
  const json = await postChat({ messages });
  return {
    reply: String(json.reply ?? ""),
    blocks: Array.isArray(json.blocks) ? (json.blocks as ChatBlock[]) : undefined,
    pendingAction: (json.pendingAction as PendingAction | undefined) ?? undefined,
  };
}

/** 확인 카드에서 승인된 작업을 실제로 저장합니다. */
export async function confirmChatAction(action: PendingAction): Promise<string> {
  const json = await postChat({ confirm: { tool: action.tool, args: action.args } });
  return String(json.reply ?? "작업을 완료했습니다.");
}
