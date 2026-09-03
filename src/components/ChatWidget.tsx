import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
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

export default function ChatWidget() {
  const { mode, authUser, role, showToast } = useStore();
  const [open, setOpen] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = role === "staff" ? SUGGESTIONS_STAFF : SUGGESTIONS_OPS;

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
        setBubbles((prev) => [
          ...prev,
          {
            id: newId(),
            role: "model",
            text: reply.reply,
            blocks: reply.blocks,
            pendingAction: reply.pendingAction,
          },
        ]);
      } catch (error) {
        setBubbles((prev) => [
          ...prev,
          { id: newId(), role: "model", text: `⚠️ ${(error as Error).message}` },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [bubbles, busy]
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

          <div className="chat-list" ref={listRef}>
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
          <div className="chat-foot">등록·수정은 확인 버튼을 눌러야 저장됩니다.</div>
        </div>
      )}
    </>
  );
}
