import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import {
  fsDeleteChatConversation,
  fsDeleteChatbotMemory,
  fsSaveChatConversation,
  fsUpsertChatbotMemory,
  subscribeChatConversations,
  subscribeChatbotMemories,
} from "../services/firestore";
import type { ChatConversation, ChatbotMemory } from "../data/types";
import {
  confirmChatAction,
  sendChatMessage,
  type ChatBlock,
  type ChatMessage,
  type PendingAction,
  type SalesReportPayload,
} from "../services/chat";

interface Bubble {
  id: string;
  role: "user" | "model";
  text: string;
  blocks?: ChatBlock[];
  pendingAction?: PendingAction;
  /** 확인 카드가 처리된 뒤 남기는 상태 */
  resolved?: "done" | "canceled";
}

const SUGGESTIONS_OPS = [
  "오늘 현황 알려줘",
  "이번 주 매출 정리해줘",
  "내일 저녁 7시 홍길동 4명 예약 등록해줘",
  "오늘 근무표 보여줘",
];

const SUGGESTIONS_STAFF = [
  "오늘 예약 보여줘",
  "오늘 내 근무 언제야?",
  "전달사항 알려줘",
];

function money(value: number): string {
  return Math.round(Number(value) || 0).toLocaleString("ko-KR");
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function SalesReportCard({ payload }: { payload: SalesReportPayload }) {
  const range = payload.rangeStart === payload.rangeEnd
    ? payload.rangeStart
    : `${payload.rangeStart} ~ ${payload.rangeEnd}`;
  const change = payload.previous?.changePercent ?? null;
  const dailyRows = payload.daily.slice(0, 31);

  return (
    <div className="chat-report">
      <div className="chat-report-head">
        📊 POS 매출 <span className="muted small">{range}</span>
      </div>
      <div className="chat-report-stats">
        <div>
          <span>합계</span>
          <strong>{money(payload.total)}원</strong>
        </div>
        <div>
          <span>일평균</span>
          <strong>{money(payload.average)}원</strong>
        </div>
        <div>
          <span>최고일</span>
          <strong>{payload.best ? `${money(payload.best.amount)}원` : "—"}</strong>
        </div>
      </div>

      {change !== null && (
        <div className={`chat-report-delta ${change >= 0 ? "up" : "down"}`}>
          {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
          <span className="muted small">직전 {payload.elapsedDays}일 대비</span>
        </div>
      )}
      <div className="muted small">
        {payload.elapsedDays}일 중 {payload.dataDays}일 데이터
        {payload.missingDays > 0 ? ` · 없는 날 ${payload.missingDays}일` : ""}
        {payload.futureDays > 0 ? ` · 남은 날 ${payload.futureDays}일` : ""}
      </div>

      {dailyRows.length > 1 && (
        <div className="chat-report-section">
          <div className="chat-report-label">일자별</div>
          {dailyRows.map((row) => (
            <div className="chat-report-row" key={row.businessDate}>
              <span>{row.businessDate.slice(5)} ({row.dow})</span>
              <span>{money(row.amount)}원</span>
            </div>
          ))}
          {payload.daily.length > dailyRows.length && (
            <div className="muted small">외 {payload.daily.length - dailyRows.length}일</div>
          )}
        </div>
      )}

      {payload.dataDays >= 7 && payload.weekdayAverages.length > 1 && (
        <div className="chat-report-section">
          <div className="chat-report-label">요일별 평균</div>
          {payload.weekdayAverages.map((row) => (
            <div className="chat-report-row" key={row.dow}>
              <span>{row.dow}요일 <span className="muted small">× {row.days}</span></span>
              <span>{money(row.average)}원</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type ChatTab = "chat" | "memory" | "history";

/** 대화 제목은 첫 질문에서 딴다. 길면 자른다. */
function titleFrom(bubbles: Bubble[]): string {
  const first = bubbles.find((b) => b.role === "user" && b.text.trim());
  const text = first?.text.trim() ?? "새 대화";
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

export default function ChatWidget() {
  const { mode, authUser, role, showToast } = useStore();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ChatTab>("chat");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* 지금 이어 가는 대화의 id. 새 대화를 시작하면 새 id 를 만든다.
     같은 id 로 계속 덮어써서 대화 하나가 문서 하나로 남는다. */
  const [conversationId, setConversationId] = useState(() => newId());
  const [memories, setMemories] = useState<ChatbotMemory[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [savingMemory, setSavingMemory] = useState(false);

  const isAdmin = role === "admin";
  const suggestions = role === "staff" ? SUGGESTIONS_STAFF : SUGGESTIONS_OPS;

  // 패널을 열었을 때만 구독한다. 닫혀 있는 동안 읽을 이유가 없다.
  useEffect(() => {
    if (!open || mode !== "live" || !isAdmin) return;
    return subscribeChatbotMemories(setMemories, (e) => console.error("[chatbotMemories]", e));
  }, [open, mode, isAdmin]);

  useEffect(() => {
    if (!open || mode !== "live") return;
    return subscribeChatConversations(
      authUser?.uid,
      setConversations,
      (e) => console.error("[chatConversations]", e)
    );
  }, [open, mode, authUser]);

  const tabs = useMemo(
    () => [
      { id: "chat" as const, label: "대화", icon: "💬" },
      ...(isAdmin ? [{ id: "memory" as const, label: "업체 기억", icon: "📝" }] : []),
      { id: "history" as const, label: "이전 대화", icon: "🕘" },
    ],
    [isAdmin]
  );

  const startNewChat = useCallback(() => {
    setBubbles([]);
    setInput("");
    setConversationId(newId());
    setTab("chat");
  }, []);

  const openConversation = useCallback((conversation: ChatConversation) => {
    setBubbles(conversation.messages.map((m) => ({ id: newId(), role: m.role, text: m.text })));
    setConversationId(conversation.id);
    setTab("chat");
  }, []);

  const saveMemory = useCallback(async () => {
    const text = memoryDraft.trim();
    if (!text) return;
    setSavingMemory(true);
    try {
      await fsUpsertChatbotMemory({ id: editingMemoryId ?? undefined, text });
      setMemoryDraft("");
      setEditingMemoryId(null);
      showToast(editingMemoryId ? "기억을 고쳤어요" : "기억에 담았어요");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSavingMemory(false);
    }
  }, [memoryDraft, editingMemoryId, showToast]);

  const removeMemory = useCallback(async (memory: ChatbotMemory) => {
    if (!window.confirm(`«${memory.text.slice(0, 30)}» 을(를) 잊게 할까요?`)) return;
    try {
      await fsDeleteChatbotMemory(memory.id);
      if (editingMemoryId === memory.id) {
        setEditingMemoryId(null);
        setMemoryDraft("");
      }
      showToast("기억에서 지웠어요");
    } catch (error) {
      showToast((error as Error).message);
    }
  }, [editingMemoryId, showToast]);

  const removeConversation = useCallback(async (conversation: ChatConversation) => {
    if (!window.confirm("이 대화를 지울까요?")) return;
    try {
      await fsDeleteChatConversation(conversation.id);
      if (conversation.id === conversationId) startNewChat();
      showToast("대화를 지웠어요");
    } catch (error) {
      showToast((error as Error).message);
    }
  }, [conversationId, startNewChat, showToast]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [bubbles, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      const userBubble: Bubble = { id: newId(), role: "user", text: trimmed };
      // 확인 카드가 떠 있는 상태에서 새 질문을 하면 그 카드는 만료 처리합니다.
      const next = [...bubbles, userBubble].map((bubble) =>
        bubble.pendingAction && !bubble.resolved ? { ...bubble, resolved: "canceled" as const } : bubble
      );
      setBubbles(next);
      setInput("");
      setBusy(true);

      try {
        const history: ChatMessage[] = next
          .filter((bubble) => bubble.text.trim().length > 0)
          .map((bubble) => ({ role: bubble.role, text: bubble.text }));
        const reply = await sendChatMessage(history);
        const answered: Bubble[] = [
          ...next,
          {
            id: newId(),
            role: "model",
            text: reply.reply,
            blocks: reply.blocks,
            pendingAction: reply.pendingAction,
          },
        ];
        setBubbles(answered);
        // 대화가 한 번 오갈 때마다 통째로 덮어쓴다. 실패해도 대화는 계속돼야 하므로 삼킨다.
        if (mode === "live") {
          void fsSaveChatConversation({
            id: conversationId,
            title: titleFrom(answered),
            messages: answered
              .filter((b) => b.text.trim())
              .map((b) => ({ role: b.role, text: b.text })),
          }).catch((error) => console.error("[chatConversations]", error));
        }
      } catch (error) {
        setBubbles((prev) => [
          ...prev,
          { id: newId(), role: "model", text: `⚠️ ${(error as Error).message}` },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [bubbles, busy, conversationId, mode]
  );

  const confirm = useCallback(
    async (bubble: Bubble) => {
      if (!bubble.pendingAction || confirming) return;
      setConfirming(true);
      try {
        const reply = await confirmChatAction(bubble.pendingAction);
        setBubbles((prev) => [
          ...prev.map((item) => (item.id === bubble.id ? { ...item, resolved: "done" as const } : item)),
          { id: newId(), role: "model", text: `✅ ${reply}` },
        ]);
        showToast("챗봇 작업을 반영했어요");
      } catch (error) {
        showToast((error as Error).message);
        setBubbles((prev) => [
          ...prev,
          { id: newId(), role: "model", text: `⚠️ ${(error as Error).message}` },
        ]);
      } finally {
        setConfirming(false);
      }
    },
    [confirming, showToast]
  );

  const cancel = useCallback((bubble: Bubble) => {
    setBubbles((prev) => [
      ...prev.map((item) => (item.id === bubble.id ? { ...item, resolved: "canceled" as const } : item)),
      { id: newId(), role: "model", text: "알겠습니다. 등록하지 않았어요. 수정할 내용을 알려주세요." },
    ]);
  }, []);

  if (mode !== "live" || !authUser) return null;

  return (
    <>
      <button
        className={`chat-fab ${open ? "is-open" : ""}`}
        aria-label={open ? "챗봇 닫기" : "챗봇 열기"}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? "✕" : "💬"}
      </button>

      {open && (
        <div className="chat-panel" role="dialog" aria-label="하늘땅 챗봇">
          <div className="chat-head">
            <div>
              <div className="chat-title">하늘땅 비서</div>
              <div className="chat-sub">예약 · 매출 · 근무표를 말로 처리하세요</div>
            </div>
            <button className="chat-close" aria-label="닫기" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="chat-tabs" role="tablist" aria-label="챗봇 보기">
            {tabs.map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? "on" : ""}
                onClick={() => setTab(item.id)}
              >
                <span aria-hidden="true">{item.icon}</span>{item.label}
              </button>
            ))}
            <button className="chat-new" aria-label="새 대화 시작" title="새 대화" onClick={startNewChat}>＋</button>
          </div>

          {tab === "memory" && (
            <div className="chat-pane">
              <p className="chat-pane-note">
                여기 적어 둔 것은 <strong>모든 대화</strong>에서 챗봇이 참고합니다. 가게가 정해 둔
                사실을 적으세요 — 주차, 단체 기준, 휴무일 같은 것. 예약이나 매출 숫자는 적지 마세요,
                그건 챗봇이 직접 확인합니다.
              </p>
              <div className="chat-memory-form">
                <textarea
                  className="textarea"
                  rows={2}
                  value={memoryDraft}
                  onChange={(event) => setMemoryDraft(event.target.value)}
                  placeholder="예: 주차는 건물 뒤 공영주차장 2시간 무료"
                  maxLength={300}
                />
                <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                  {editingMemoryId && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => { setEditingMemoryId(null); setMemoryDraft(""); }}
                    >
                      취소
                    </button>
                  )}
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={savingMemory || !memoryDraft.trim()}
                    onClick={() => void saveMemory()}
                  >
                    {savingMemory ? "저장 중…" : editingMemoryId ? "고치기" : "기억시키기"}
                  </button>
                </div>
              </div>

              {memories.length === 0 ? (
                <div className="chat-pane-empty">아직 기억시킨 것이 없습니다.</div>
              ) : (
                <ul className="chat-memory-list">
                  {memories.map((memory) => (
                    <li key={memory.id} className={editingMemoryId === memory.id ? "on" : ""}>
                      <span>{memory.text}</span>
                      <div className="chat-memory-actions">
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => { setEditingMemoryId(memory.id); setMemoryDraft(memory.text); }}
                        >
                          고치기
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => void removeMemory(memory)}>
                          잊기
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="chat-pane">
              <p className="chat-pane-note">내가 나눈 대화만 보입니다. 다른 사람은 볼 수 없습니다.</p>
              {conversations.length === 0 ? (
                <div className="chat-pane-empty">아직 저장된 대화가 없습니다.</div>
              ) : (
                <ul className="chat-history-list">
                  {conversations.map((conversation) => (
                    <li key={conversation.id} className={conversation.id === conversationId ? "on" : ""}>
                      <button className="chat-history-open" onClick={() => openConversation(conversation)}>
                        <strong>{conversation.title}</strong>
                        <small>
                          {conversation.updatedAt || ""} · {conversation.messages.length}개
                        </small>
                      </button>
                      <button
                        className="chat-history-del"
                        aria-label="대화 지우기"
                        onClick={() => void removeConversation(conversation)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="chat-list" ref={listRef} hidden={tab !== "chat"}>
            {bubbles.length === 0 && (
              <div className="chat-empty">
                <p>무엇을 도와드릴까요?</p>
                <div className="chat-chips">
                  {suggestions.map((item) => (
                    <button key={item} className="chat-chip" onClick={() => void send(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {bubbles.map((bubble) => (
              <div key={bubble.id} className={`chat-turn ${bubble.role}`}>
                {bubble.text && <div className="chat-bubble">{bubble.text}</div>}

                {bubble.blocks?.map((block, index) =>
                  block.type === "salesReport" ? (
                    <SalesReportCard key={index} payload={block.payload} />
                  ) : null
                )}

                {bubble.pendingAction && (
                  <div className={`chat-confirm ${bubble.resolved ?? ""}`}>
                    <div className="chat-confirm-title">{bubble.pendingAction.title}</div>
                    <dl className="chat-confirm-fields">
                      {bubble.pendingAction.fields.map((field) => (
                        <div key={field.label}>
                          <dt>{field.label}</dt>
                          <dd>{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {!bubble.resolved && (
                      <div className="chat-confirm-actions">
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={confirming}
                          onClick={() => void confirm(bubble)}
                        >
                          {confirming ? "저장 중…" : bubble.pendingAction.confirmLabel}
                        </button>
                        <button className="btn btn-outline btn-sm" disabled={confirming} onClick={() => cancel(bubble)}>
                          취소
                        </button>
                      </div>
                    )}
                    {bubble.resolved === "done" && <div className="chat-confirm-state">반영 완료</div>}
                    {bubble.resolved === "canceled" && <div className="chat-confirm-state">취소됨</div>}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="chat-turn model">
                <div className="chat-bubble chat-typing"><span /><span /><span /></div>
              </div>
            )}
          </div>

          <form
            className="chat-input"
            hidden={tab !== "chat"}
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              placeholder="예: 내일 저녁 7시 김하늘 4명 예약 등록"
              disabled={busy}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
            />
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !input.trim()}>
              보내기
            </button>
          </form>
          <div className="chat-foot" hidden={tab !== "chat"}>등록·수정은 확인 버튼을 눌러야 저장됩니다.</div>
        </div>
      )}
    </>
  );
}
