import { useState } from "react";
import { useStore } from "../store";
import { Card, Badge } from "../components/ui";
import type { Notice } from "../data/types";
import { TODAY_STR } from "../lib/time";

type NoticeKind = "notice" | "handover";

function itemKey(item: Notice): string {
  return item.docId ?? String(item.id);
}

function shortDate(): string {
  return TODAY_STR.slice(5);
}

export default function Notices() {
  const {
    notices, handovers, addHandover, upsertNotice, deleteNotice,
    upsertHandover, deleteHandover, showToast, role,
  } = useStore();
  const canManage = role === "admin" || role === "manager";
  const [text, setText] = useState("");
  const [kind, setKind] = useState<NoticeKind>(canManage ? "notice" : "handover");
  const [selectedNotices, setSelectedNotices] = useState<string[]>([]);
  const [selectedHandovers, setSelectedHandovers] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ kind: NoticeKind; item: Notice } | null>(null);
  const [editText, setEditText] = useState("");
  const [editDate, setEditDate] = useState(shortDate());
  const [editPinned, setEditPinned] = useState(false);

  const submit = () => {
    const nextText = text.trim();
    if (!nextText) return;
    const id = Date.now();
    if (canManage && kind === "notice") {
      upsertNotice({ id, docId: String(id), text: nextText, date: shortDate(), pinned: false });
      showToast("공지가 등록되었습니다");
    } else {
      addHandover(nextText);
      showToast("전달사항이 등록되었습니다");
    }
    setText("");
  };

  const toggle = (target: string, list: string[], setter: (next: string[]) => void) => {
    setter(list.includes(target) ? list.filter((id) => id !== target) : [...list, target]);
  };

  const toggleAllNotices = () => {
    setSelectedNotices(selectedNotices.length === notices.length ? [] : notices.map(itemKey));
  };

  const toggleAllHandovers = () => {
    setSelectedHandovers(selectedHandovers.length === handovers.length ? [] : handovers.map(itemKey));
  };

  const deleteSelectedNotices = () => {
    if (!canManage || selectedNotices.length === 0) return;
    if (!window.confirm(`공지 ${selectedNotices.length}건을 삭제할까요?`)) return;
    selectedNotices.forEach(deleteNotice);
    setSelectedNotices([]);
    showToast("선택한 공지를 삭제했습니다");
  };

  const deleteSelectedHandovers = () => {
    if (!canManage || selectedHandovers.length === 0) return;
    if (!window.confirm(`전달사항 ${selectedHandovers.length}건을 삭제할까요?`)) return;
    selectedHandovers.forEach(deleteHandover);
    setSelectedHandovers([]);
    showToast("선택한 전달사항을 삭제했습니다");
  };

  const openEdit = (nextKind: NoticeKind, item: Notice) => {
    setEditing({ kind: nextKind, item });
    setEditText(item.text);
    setEditDate(item.date);
    setEditPinned(!!item.pinned);
  };

  const saveEdit = () => {
    if (!editing) return;
    const nextText = editText.trim();
    if (!nextText) {
      showToast("내용을 입력해주세요");
      return;
    }
    const next = {
      ...editing.item,
      text: nextText,
      date: editDate.trim() || shortDate(),
      pinned: editing.kind === "notice" ? editPinned : undefined,
    };
    if (editing.kind === "notice") {
      upsertNotice(next);
      showToast("공지를 수정했습니다");
    } else {
      upsertHandover(next);
      showToast("전달사항을 수정했습니다");
    }
    setEditing(null);
  };

  const renderItem = (item: Notice, itemKind: NoticeKind) => {
    const key = itemKey(item);
    const selected = itemKind === "notice"
      ? selectedNotices.includes(key)
      : selectedHandovers.includes(key);
    return (
      <div className="notice-item managed" key={key}>
        {canManage && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() =>
              itemKind === "notice"
                ? toggle(key, selectedNotices, setSelectedNotices)
                : toggle(key, selectedHandovers, setSelectedHandovers)
            }
          />
        )}
        <span className="notice-bullet">{item.pinned ? "📌" : "•"}</span>
        <span className="notice-text">{item.text}</span>
        {item.pinned && <Badge tone="amber">상단</Badge>}
        <span className="date">{item.date}</span>
        {canManage && (
          <button className="btn btn-outline btn-sm" onClick={() => openEdit(itemKind, item)}>
            수정
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <Card title={canManage ? "공지 / 전달사항 등록" : "전달사항 남기기"} icon="📣">
        {canManage && (
          <div className="segmented" style={{ marginBottom: 10 }}>
            <button className={kind === "notice" ? "on" : ""} onClick={() => setKind("notice")}>공지</button>
            <button className={kind === "handover" ? "on" : ""} onClick={() => setKind("handover")}>전달사항</button>
          </div>
        )}
        <textarea
          className="textarea"
          placeholder={canManage && kind === "notice" ? "직원에게 공지할 내용을 입력하세요" : "다음 근무자에게 전달할 내용을 입력하세요"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
          <button className="btn btn-primary" onClick={submit}>등록</button>
        </div>
      </Card>

      {editing && canManage && (
        <Card title={editing.kind === "notice" ? "공지 수정" : "전달사항 수정"} icon="✎">
          <textarea className="textarea" value={editText} onChange={(e) => setEditText(e.target.value)} />
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <label className="field-label" style={{ margin: 0 }}>날짜</label>
            <input className="input" style={{ width: 110 }} value={editDate} onChange={(e) => setEditDate(e.target.value)} placeholder="06-28" />
            {editing.kind === "notice" && (
              <label className="check-row">
                <input type="checkbox" checked={editPinned} onChange={(e) => setEditPinned(e.target.checked)} />
                <span>상단 고정</span>
              </label>
            )}
            <span style={{ flex: 1 }} />
            <button className="btn btn-outline" onClick={() => setEditing(null)}>취소</button>
            <button className="btn btn-primary" onClick={saveEdit}>저장</button>
          </div>
        </Card>
      )}

      <div className="grid grid-2">
        <Card title="공지사항" icon="📢">
          {canManage && (
            <div className="bulk-bar compact">
              <label className="check-row">
                <input type="checkbox" checked={notices.length > 0 && selectedNotices.length === notices.length} onChange={toggleAllNotices} />
                <span>전체선택</span>
              </label>
              <span className="muted small">선택 {selectedNotices.length}건</span>
              <button className="btn btn-danger btn-sm" onClick={deleteSelectedNotices} disabled={selectedNotices.length === 0}>선택삭제</button>
            </div>
          )}
          {notices.map((n) => renderItem(n, "notice"))}
          {notices.length === 0 && <div className="muted small" style={{ padding: 16, textAlign: "center" }}>공지사항이 없습니다.</div>}
        </Card>

        <Card title="전달사항" icon="📝">
          {canManage && (
            <div className="bulk-bar compact">
              <label className="check-row">
                <input type="checkbox" checked={handovers.length > 0 && selectedHandovers.length === handovers.length} onChange={toggleAllHandovers} />
                <span>전체선택</span>
              </label>
              <span className="muted small">선택 {selectedHandovers.length}건</span>
              <button className="btn btn-danger btn-sm" onClick={deleteSelectedHandovers} disabled={selectedHandovers.length === 0}>선택삭제</button>
            </div>
          )}
          {handovers.map((h) => renderItem(h, "handover"))}
          {handovers.length === 0 && <div className="muted small" style={{ padding: 16, textAlign: "center" }}>전달사항이 없습니다.</div>}
        </Card>
      </div>
    </>
  );
}
