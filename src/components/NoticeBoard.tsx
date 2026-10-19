import { useMemo, useState } from "react";
import { useStore } from "../store";
import { TODAY_STR } from "../lib/time";
import type { Notice } from "../data/types";

/*
  공지사항 — 체크리스트 화면, 특이사항 아래 (2026-10-19 사장님 결정으로 「공지사항」 메뉴를 없애고 옮겼다).

  직원은 체크하러 들어온 김에 공지를 본다. 따로 메뉴를 열 일이 없다.
  올리기·고치기·상단 고정·지우기는 사장님과 「공지사항」 권한을 받은 매니저만 — Firestore 규칙
  (canManageNotices)과 같은 기준이다. 상단 고정한 공지가 맨 위, 나머지는 최신순.
*/

const SHOW_FIRST = 5;

function keyOf(notice: Notice): string {
  return notice.docId ?? String(notice.id);
}

export default function NoticeBoard() {
  const { notices, upsertNotice, deleteNotice, role, managerPermissions, showToast } = useStore();
  const canManage = role === "admin" || (role === "manager" && managerPermissions.notices);
  const [draft, setDraft] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(
    () => [...notices].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.id - a.id),
    [notices],
  );
  const visible = showAll ? sorted : sorted.slice(0, SHOW_FIRST);

  const post = () => {
    const text = draft.trim();
    if (!text) return;
    const id = Date.now();
    upsertNotice({ id, docId: String(id), text, date: TODAY_STR.slice(5), pinned: false });
    setDraft("");
    showToast("공지를 올렸습니다");
  };

  const startEdit = (notice: Notice) => {
    setEditingKey(keyOf(notice));
    setEditText(notice.text);
  };

  const saveEdit = (notice: Notice) => {
    const text = editText.trim();
    if (!text) { showToast("내용을 적어 주세요"); return; }
    upsertNotice({ ...notice, text });
    setEditingKey(null);
    showToast("공지를 고쳤습니다");
  };

  const togglePin = (notice: Notice) => {
    upsertNotice({ ...notice, pinned: !notice.pinned });
  };

  const remove = (notice: Notice) => {
    if (!window.confirm("이 공지를 지울까요?")) return;
    deleteNotice(keyOf(notice));
    showToast("공지를 지웠습니다");
  };

  return (
    <section className="card cl-notices" aria-labelledby="cl-notices-title">
      <div className="cl-section-head">
        <h2 id="cl-notices-title">공지사항</h2>
        {sorted.length > 0 && <span className="muted small">{sorted.length}건</span>}
      </div>

      {canManage && (
        <div className="cl-notice-compose">
          <textarea
            className="textarea"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="직원에게 알릴 내용 (예: 이번 주 토요일 단체 예약 — 세팅 30분 일찍)"
            maxLength={500}
            aria-label="새 공지"
          />
          <button className="btn btn-outline btn-sm" type="button" disabled={!draft.trim()} onClick={post}>공지 올리기</button>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="muted small cl-notice-empty">공지사항이 없습니다.</p>
      ) : (
        <ul className="cl-notice-list">
          {visible.map((notice) => {
            const key = keyOf(notice);
            const editing = editingKey === key;
            return (
              <li key={key} className={`cl-notice ${notice.pinned ? "pinned" : ""}`}>
                {editing ? (
                  <div className="cl-notice-edit">
                    <textarea className="textarea" rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={500} aria-label="공지 고치기" />
                    <div className="cl-notice-actions">
                      <button className="btn btn-outline btn-sm" type="button" onClick={() => setEditingKey(null)}>취소</button>
                      <button className="btn btn-primary btn-sm" type="button" onClick={() => saveEdit(notice)}>저장</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="cl-notice-body">
                      {notice.pinned && <span className="cl-notice-pin" aria-label="상단 고정">📌</span>}
                      <span className="cl-notice-text">{notice.text}</span>
                      <span className="cl-notice-date muted small">{notice.date}</span>
                    </div>
                    {canManage && (
                      <div className="cl-notice-actions">
                        <button className="text-button" type="button" onClick={() => togglePin(notice)}>{notice.pinned ? "고정 해제" : "상단 고정"}</button>
                        <button className="text-button" type="button" onClick={() => startEdit(notice)}>고치기</button>
                        <button className="text-button" type="button" onClick={() => remove(notice)}>지우기</button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {sorted.length > SHOW_FIRST && (
        <button className="text-button cl-notice-more" type="button" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "접기" : `지난 공지 ${sorted.length - SHOW_FIRST}건 더 보기`}
        </button>
      )}
    </section>
  );
}
