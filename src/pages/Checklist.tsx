import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "../store";
import { TODAY_STR } from "../lib/time";
import type {
  ChecklistSection, ChecklistTemplateItem, KakaoMemoReportType, KakaoMemoSchedule, KakaoMemoScheduleEntry,
} from "../data/types";
import {
  DOW_SHORT, SECTIONS, SECTION_LABEL, cleanTemplate, dayRows, daysLabel, exampleTemplate, progressOf, weekdayOf,
  type ChecklistRow,
} from "../lib/checklist";
import { useChecklist, type ChecklistInvite, type ChecklistSendResult } from "../hooks/useChecklist";
import NoticeBoard from "../components/NoticeBoard";

/*
  체크리스트 — 오픈·마감.

  사장님이 항목을 정하고(매일 / 매주 정한 요일), 직원이 칸마다 체크하고 특이사항을 적는다.
  사장님이 확인하고 「나챗방으로 보내기」 — 카톡 「나와의 채팅」에 요약과 이 화면 링크가 간다.
  **보내기는 사장님(관리자)만**이다(2026-10-19 결정) — 매니저·직원 화면에는 그 칸이 없고 함수도 막는다.
  링크는 날짜를 달고 가서(?date=) 누르면 그날 체크리스트가 열린다.
*/

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function shiftDate(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function dateTitle(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${m}월 ${d}일 (${DOW_SHORT[weekdayOf(key)]})`;
}

/** "2026-10-19 21:40" → "10/19 21:40" — 오늘이면 시각만 */
function shortTime(text?: string | null): string {
  if (!text) return "";
  const [date, time] = text.split(" ");
  if (date === TODAY_STR) return time ?? "";
  const [, m, d] = (date ?? "").split("-").map(Number);
  return m && d ? `${m}/${d} ${time ?? ""}`.trim() : text;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ============================================================
   한 칸
   ============================================================ */

function CheckRow({ row, disabled, onToggle }: { row: ChecklistRow; disabled: boolean; onToggle: (row: ChecklistRow) => void }) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={row.checked}
        className={`cl-row ${row.checked ? "done" : ""} ${row.removed ? "removed" : ""}`}
        disabled={disabled || row.removed}
        onClick={() => onToggle(row)}
      >
        <span className="cl-mark" aria-hidden="true">{row.checked ? "✓" : ""}</span>
        <span className="cl-text">
          <span className="cl-label">{row.text}</span>
          <span className="cl-meta">
            {row.schedule && <em className="cl-tag">{row.schedule}</em>}
            {row.removed && <em className="cl-tag muted">지운 항목</em>}
            {row.checked && row.by && <span>{row.by}{row.at ? ` · ${shortTime(row.at)}` : ""}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

/* ============================================================
   항목 편집 (사장님)
   ============================================================ */

function TemplateEditor({
  initial, onSave, onClose,
}: {
  initial: ChecklistTemplateItem[];
  onSave: (items: ChecklistTemplateItem[]) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ChecklistTemplateItem[]>(() => initial.map((item) => ({ ...item, days: [...item.days] })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [onClose, saving]);

  const update = (id: string, patch: Partial<ChecklistTemplateItem>) =>
    setDraft((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const toggleDay = (id: string, dayIndex: number) =>
    setDraft((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const days = item.days.includes(dayIndex) ? item.days.filter((d) => d !== dayIndex) : [...item.days, dayIndex];
      return { ...item, days: days.sort((a, b) => a - b) };
    }));
  const move = (id: string, direction: -1 | 1) =>
    setDraft((prev) => {
      const item = prev.find((x) => x.id === id);
      if (!item) return prev;
      const same = prev.filter((x) => x.section === item.section);
      const index = same.findIndex((x) => x.id === id);
      const swapWith = same[index + direction];
      if (!swapWith) return prev;
      const next = [...prev];
      const a = next.findIndex((x) => x.id === id);
      const b = next.findIndex((x) => x.id === swapWith.id);
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  const add = (section: ChecklistSection) => setDraft((prev) => [...prev, { id: newId(), section, text: "", days: [] }]);
  const remove = (id: string) => setDraft((prev) => prev.filter((item) => item.id !== id));

  const save = async () => {
    const items = cleanTemplate(draft);
    setSaving(true);
    setError(null);
    try {
      await onSave(items);
      onClose();
    } catch (e) {
      setError((e as Error).message || "저장하지 못했습니다.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="modal-panel cl-editor" role="dialog" aria-modal="true" aria-labelledby="cl-editor-title">
        <div className="modal-head">
          <div>
            <h2 id="cl-editor-title">체크리스트 항목</h2>
            <p>요일을 안 고르면 매일, 고르면 매주 그 요일에만 나옵니다.</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} disabled={saving} aria-label="닫기">×</button>
        </div>
        <div className="modal-body cl-editor-body">
          {draft.length === 0 && (
            <div className="cl-empty">
              아직 항목이 없습니다.
              <button className="btn btn-outline btn-sm" type="button" onClick={() => setDraft(exampleTemplate(newId))}>예시로 채우기</button>
            </div>
          )}
          {SECTIONS.map((section) => {
            const items = draft.filter((item) => item.section === section);
            return (
              <div className="cl-editor-section" key={section}>
                <div className="spread">
                  <div className="modal-section-title" style={{ margin: 0 }}>{SECTION_LABEL[section]} {items.length > 0 ? `${items.length}개` : ""}</div>
                  <button className="btn btn-soft btn-sm" type="button" onClick={() => add(section)}>+ {SECTION_LABEL[section]} 항목</button>
                </div>
                <ul className="cl-editor-list">
                  {items.map((item, index) => (
                    <li key={item.id} className="cl-editor-item">
                      <div className="cl-editor-row">
                        <input
                          className="input"
                          value={item.text}
                          onChange={(e) => update(item.id, { text: e.target.value })}
                          placeholder={section === "open" ? "예: 냉장고 온도 확인" : "예: 가스 밸브 잠금"}
                          maxLength={80}
                          aria-label={`${SECTION_LABEL[section]} 항목 ${index + 1}`}
                          autoFocus={!item.text && index === items.length - 1}
                        />
                        <button className="icon-btn" type="button" onClick={() => move(item.id, -1)} disabled={index === 0} aria-label="위로">↑</button>
                        <button className="icon-btn" type="button" onClick={() => move(item.id, 1)} disabled={index === items.length - 1} aria-label="아래로">↓</button>
                        <button className="icon-btn" type="button" onClick={() => remove(item.id)} aria-label="항목 삭제">×</button>
                      </div>
                      <div className="cl-days" role="group" aria-label="요일">
                        {DOW_SHORT.map((label, dayIndex) => (
                          <button
                            key={label}
                            type="button"
                            className={`chip chip-sm ${item.days.includes(dayIndex) ? "on" : ""}`}
                            aria-pressed={item.days.includes(dayIndex)}
                            onClick={() => toggleDay(item.id, dayIndex)}
                          >
                            {label}
                          </button>
                        ))}
                        <span className="muted small">{daysLabel(item.days)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {error && <p className="cl-error" role="alert">{error}</p>}
        </div>
        <div className="cl-foot">
          <button className="btn btn-outline" type="button" onClick={onClose} disabled={saving}>취소</button>
          <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? "저장하는 중..." : "저장"}</button>
        </div>
      </section>
    </div>
  );
}

/* ============================================================
   나챗방 받는 곳 (사장님)
   ============================================================ */

const DAILY_REPORTS: Array<{ type: KakaoMemoReportType; time: string; label: string; what: string }> = [
  { type: "reservations", time: "오전 11:00", label: "오늘 예약", what: "시간·이름·인원 (취소·노쇼 빼고)" },
  { type: "settlement", time: "오후 10:30", label: "일일 정산", what: "22시 마감까지의 매출·이번 달 누적·매입·인건비율·예약·체크리스트" },
  { type: "weekly", time: "월요일 오전 9:00", label: "주간 보고", what: "지난주 매출·전주 대비, 매입·인건비율, 고정비 뺀 이익 추정, 예약·노쇼율·재방문" },
];

/** "10/19 22:00 · 자동 · 2곳" */
function scheduleText(entry: KakaoMemoScheduleEntry | undefined): string {
  if (!entry) return "아직 보낸 적 없음";
  const how = entry.trigger === "scheduled" ? "자동" : `시험${entry.by ? `(${entry.by})` : ""}`;
  const result = entry.status === "no_links" ? "받는 곳 없음" : `${entry.delivered}곳${entry.failed ? ` · 실패 ${entry.failed}` : ""}`;
  return `마지막 ${shortTime(entry.at) || entry.date} · ${how} · ${result}`;
}

function MemoTargets({
  links, schedule, onInvite, onUnlink, onSendReport,
}: {
  links: ReturnType<typeof useChecklist>["links"];
  schedule: KakaoMemoSchedule;
  onInvite: (label: string) => Promise<ChecklistInvite>;
  onUnlink: (id: string) => Promise<void>;
  onSendReport: (type: KakaoMemoReportType) => Promise<ChecklistSendResult>;
}) {
  const { showToast } = useStore();
  const [label, setLabel] = useState("사장님");
  const [invite, setInvite] = useState<ChecklistInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<KakaoMemoReportType | null>(null);
  const [testResult, setTestResult] = useState<{ type: KakaoMemoReportType; result: ChecklistSendResult } | null>(null);

  const sendTest = async (type: KakaoMemoReportType) => {
    setTesting(type);
    setError(null);
    setTestResult(null);
    try {
      setTestResult({ type, result: await onSendReport(type) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(null);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setInvite(await onInvite(label));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("연결 링크를 복사했습니다");
    } catch {
      window.prompt("이 링크를 복사해 보내 주세요", text);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`「${name}」 나챗방 연결을 끊을까요? 이제 그 방으로는 안 갑니다.`)) return;
    try {
      await onUnlink(id);
      showToast("연결을 끊었습니다");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="card cl-targets">
      <div className="card-head">
        <div className="card-title">나챗방 받는 곳</div>
        <span className="muted small">카카오톡 「나와의 채팅」</span>
      </div>
      {links.length === 0 ? (
        <p className="muted small cl-targets-empty">아직 연결된 곳이 없습니다. 아래에서 연결 링크를 만들어 받을 사람이 누르게 하세요.</p>
      ) : (
        <ul className="cl-target-list">
          {links.map((link) => (
            <li key={link.id} className={link.active ? "" : "inactive"}>
              <div>
                <strong>{link.label}</strong>
                {link.nickname && <span className="muted small"> · 카카오 {link.nickname}</span>}
                <div className="muted small">
                  {link.active ? `연결 ${shortTime(link.linkedAt)}` : "연결 끊김 — 새 링크로 다시 연결해 주세요"}
                  {link.lastSentAt ? ` · 마지막 전송 ${shortTime(link.lastSentAt)}` : ""}
                </div>
                {link.lastError && <div className="cl-error small">{link.lastError}</div>}
              </div>
              <button className="text-button" type="button" onClick={() => void remove(link.id, link.label)}>끊기</button>
            </li>
          ))}
        </ul>
      )}

      {/* 정한 시각에 위 받는 곳 모두에 간다. 시험으로 보내도 그날 자동 발송은 따로 나간다. */}
      <div className="cl-daily">
        <div className="field-label">자동으로 보내는 것</div>
        <ul className="cl-daily-list">
          {DAILY_REPORTS.map((report) => (
            <li key={report.type}>
              <div className="cl-daily-info">
                <strong><span className="cl-daily-time">{report.time}</span> {report.label}</strong>
                <span className="muted small">{report.what}</span>
                <span className="muted small">{scheduleText(schedule[report.type])}</span>
              </div>
              <button
                className="btn btn-outline btn-sm"
                type="button"
                disabled={testing !== null || links.length === 0}
                onClick={() => void sendTest(report.type)}
              >
                {testing === report.type ? "보내는 중..." : "시험으로 보내기"}
              </button>
            </li>
          ))}
        </ul>
        {links.length === 0 && <p className="muted small cl-daily-note">받는 곳을 먼저 연결해야 보냅니다.</p>}
        {testResult && (
          <div className="cl-send-result" role="status">
            {testResult.result.delivered.length > 0
              ? <p><b>{testResult.result.delivered.join(" · ")}</b>에게 시험으로 보냈습니다.</p>
              : <p className="cl-error small">받은 곳이 없습니다.</p>}
            {testResult.result.failed.map((fail) => <p key={fail.label} className="cl-error small">{fail.label}: {fail.message}</p>)}
            {testResult.result.text && <pre className="cl-send-text">{testResult.result.text}</pre>}
          </div>
        )}
        <p className="muted small cl-daily-note">
          일일 정산의 매출은 보내기 직전에 오너비스타에서 다시 받아 온 네이버 숫자입니다. 22시까지 들어가려면 오너비스타의
          하늘땅 매출 수집 시각에 22시가 있어야 합니다. 22시 수집이 아직 안 들어왔으면 글에 「22시 수집 전 숫자」와
          마지막 수집 시각을 적습니다. OK포스 엑셀을 올린 날은 OK포스 숫자를 씁니다.
        </p>
      </div>

      <div className="cl-invite">
        <label className="field-label" htmlFor="cl-invite-label">누구의 나챗방인가요</label>
        <div className="cl-invite-row">
          <input id="cl-invite-label" className="input" value={label} maxLength={20} onChange={(e) => setLabel(e.target.value)} placeholder="예: 사장님" />
          <button className="btn btn-outline" type="button" disabled={busy || !label.trim()} onClick={() => void create()}>
            {busy ? "만드는 중..." : "연결 링크 만들기"}
          </button>
        </div>
        {invite && (
          <div className="cl-invite-result">
            <p className="small">
              「{invite.label}」 연결 링크입니다. <b>받을 사람이 자기 휴대폰에서</b> 누르고 카카오 동의를 마치면 그 사람의
              「나와의 채팅」으로 등록됩니다. 한 번만 쓸 수 있고 24시간 뒤 사라집니다.
            </p>
            <div className="cl-invite-url"><code>{invite.url}</code></div>
            <div className="cl-invite-actions">
              <button className="btn btn-primary btn-sm" type="button" onClick={() => void copy(invite.url)}>링크 복사</button>
              <a className="btn btn-outline btn-sm" href={invite.url} target="_blank" rel="noreferrer">내 카카오로 연결</a>
            </div>
          </div>
        )}
        {error && <p className="cl-error small" role="alert">{error}</p>}
      </div>
    </div>
  );
}

/* ============================================================
   페이지
   ============================================================ */

export default function Checklist() {
  const { showToast } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("date") ?? "";
  const date = DAY_RE.test(requested) ? requested : TODAY_STR;
  const isFuture = date > TODAY_STR;

  const checklist = useChecklist(date);
  const { template, day, links, isAdmin } = checklist;
  const rows = useMemo(() => dayRows(template, day, date), [template, day, date]);

  const [editing, setEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<ChecklistSendResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const savedNote = day?.note ?? "";
  const noteDirty = noteDraft !== savedNote;
  // 날짜를 바꾸거나 다른 사람이 저장하면 따라간다 — 내가 고치는 중이면 덮지 않는다
  useEffect(() => { setNoteDraft(savedNote); setSendResult(null); setSendError(null); }, [date]);
  useEffect(() => { if (!noteDirty) setNoteDraft(savedNote); }, [savedNote]);

  const closeEditor = useCallback(() => setEditing(false), []);
  const goto = (next: string) => setSearchParams(next === TODAY_STR ? {} : { date: next }, { replace: true });

  const toggle = (row: ChecklistRow) => {
    checklist.setChecked(row, !row.checked).catch((e: Error) => showToast(e.message || "체크를 저장하지 못했습니다"));
  };

  const saveNote = async () => {
    setNoteSaving(true);
    try {
      await checklist.saveNote(noteDraft.trim());
      showToast("특이사항을 저장했습니다");
    } catch (e) {
      showToast((e as Error).message || "특이사항을 저장하지 못했습니다");
    } finally {
      setNoteSaving(false);
    }
  };

  const send = async () => {
    setSending(true);
    setSendError(null);
    setSendResult(null);
    try {
      // 적어 두고 저장 안 한 특이사항도 같이 간다
      if (noteDirty) await checklist.saveNote(noteDraft.trim());
      setSendResult(await checklist.send());
    } catch (e) {
      setSendError((e as Error).message || "보내지 못했습니다");
    } finally {
      setSending(false);
    }
  };

  const hasItems = (template?.items.length ?? 0) > 0;

  return (
    <div className="stack cl-page">
      <div className="cl-head">
        <div className="cl-date">
          <button className="icon-btn-sm" type="button" aria-label="전날" onClick={() => goto(shiftDate(date, -1))}>‹</button>
          <strong>{dateTitle(date)}</strong>
          <button className="icon-btn-sm" type="button" aria-label="다음날" onClick={() => goto(shiftDate(date, 1))}>›</button>
          {date !== TODAY_STR && <button className="btn btn-outline btn-sm" type="button" onClick={() => goto(TODAY_STR)}>오늘</button>}
        </div>
        {isAdmin && (
          <button className="btn btn-outline btn-sm" type="button" onClick={() => setEditing(true)}>항목 편집</button>
        )}
      </div>

      {checklist.error && <div className="cl-error" role="alert">{checklist.error}</div>}
      {isFuture && <p className="muted small cl-future">미리 보기입니다 — 그날이 되면 체크할 수 있습니다.</p>}

      {!checklist.loading && !hasItems && rows.length === 0 ? (
        <div className="card cl-empty">
          {isAdmin ? (
            <>
              <strong>아직 체크리스트 항목이 없습니다.</strong>
              <p className="muted small">오픈·마감 때 할 일을 적어 두면 직원이 칸마다 체크합니다. 매주 정한 요일에만 하는 일도 넣을 수 있습니다.</p>
              <div className="cl-empty-actions">
                <button className="btn btn-primary" type="button" onClick={() => setEditing(true)}>항목 만들기</button>
                <button className="btn btn-outline" type="button" onClick={() => void checklist.saveTemplate(exampleTemplate(newId)).catch((e: Error) => showToast(e.message))}>예시로 시작하기</button>
              </div>
            </>
          ) : (
            <p className="muted">사장님이 아직 체크리스트를 만들지 않았습니다.</p>
          )}
        </div>
      ) : (
        <div className="cl-grid">
          {SECTIONS.map((section) => {
            const sectionRows = rows.filter((row) => row.section === section);
            const progress = progressOf(rows, section);
            const complete = progress.total > 0 && progress.done === progress.total;
            return (
              <section key={section} className={`card cl-section cl-${section} ${complete ? "complete" : ""}`} aria-label={SECTION_LABEL[section]}>
                <div className="cl-section-head">
                  <h2>{SECTION_LABEL[section]}</h2>
                  <span className={`cl-progress ${complete ? "done" : ""}`}>{complete ? "✓ " : ""}{progress.done}/{progress.total}</span>
                </div>
                <div className="cl-bar" aria-hidden="true">
                  <i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                </div>
                {sectionRows.length === 0 ? (
                  <p className="muted small">이날 {SECTION_LABEL[section]} 항목이 없습니다.</p>
                ) : (
                  <ul className="cl-list">
                    {sectionRows.map((row) => <CheckRow key={row.id} row={row} disabled={isFuture} onToggle={toggle} />)}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <section className="card cl-note" aria-labelledby="cl-note-title">
        <div className="cl-section-head">
          <h2 id="cl-note-title">특이사항</h2>
          {day?.noteBy && !noteDirty && <span className="muted small">{day.noteBy} · {shortTime(day.noteAt)}</span>}
          {noteDirty && <span className="cl-dirty small">저장 안 됨</span>}
        </div>
        <textarea
          className="textarea"
          rows={3}
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="예: 2번 테이블 의자 흔들림, 쌈장 재고 부족"
          maxLength={1000}
        />
        <div className="cl-note-actions">
          <button className="btn btn-outline btn-sm" type="button" disabled={!noteDirty || noteSaving} onClick={() => void saveNote()}>
            {noteSaving ? "저장하는 중..." : "저장"}
          </button>
        </div>
      </section>

      {/* 공지사항 — 따로 있던 메뉴를 없애고 여기로 옮겼다(2026-10-19). 체크하러 온 김에 본다. */}
      <NoticeBoard />

      {isAdmin && <section className="card cl-send">
        <div>
          <button className="btn btn-primary cl-send-btn" type="button" disabled={sending || (!hasItems && rows.length === 0)} onClick={() => void send()}>
            {sending ? "보내는 중..." : "나챗방으로 보내기"}
          </button>
          <p className="muted small cl-send-hint">오픈·마감 진행과 특이사항을 요약해 카카오톡 「나와의 채팅」으로 보냅니다. 전체는 함께 가는 링크로 봅니다.</p>
        </div>
        {day?.sent && (
          <p className="small cl-sent">
            마지막 전송 {shortTime(day.sent.at)} · {day.sent.by} · {day.sent.delivered}곳{day.sent.failed ? ` (실패 ${day.sent.failed}곳)` : ""}
          </p>
        )}
        {sendResult && (
          <div className="cl-send-result" role="status">
            {sendResult.delivered.length > 0 && <p><b>{sendResult.delivered.join(" · ")}</b>에게 보냈습니다.</p>}
            {sendResult.failed.map((fail) => <p key={fail.label} className="cl-error small">{fail.label}: {fail.message}</p>)}
            {sendResult.text && <pre className="cl-send-text">{sendResult.text}</pre>}
          </div>
        )}
        {sendError && <p className="cl-error small" role="alert">{sendError}</p>}
      </section>}

      {isAdmin && (
        <MemoTargets
          links={links}
          schedule={checklist.schedule}
          onInvite={checklist.createInvite}
          onUnlink={checklist.unlink}
          onSendReport={checklist.sendReport}
        />
      )}

      {editing && (
        <TemplateEditor
          initial={template?.items ?? []}
          onSave={checklist.saveTemplate}
          onClose={closeEditor}
        />
      )}
    </div>
  );
}
