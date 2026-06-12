import { useState } from "react";
import { useStore } from "../store";
import { Card } from "../components/ui";

export default function Notices() {
  const { notices, handovers, addHandover, showToast, role } = useStore();
  const [text, setText] = useState("");

  const submit = () => {
    if (!text.trim()) return;
    addHandover(text.trim());
    setText("");
    showToast(role === "admin" ? "공지가 등록되었습니다" : "전달사항이 등록되었습니다");
  };

  return (
    <>
      <Card title={role === "admin" ? "공지 / 전달사항 등록" : "전달사항 남기기"} icon="✏️">
        <textarea
          className="textarea"
          placeholder={role === "admin" ? "전 직원에게 공지할 내용을 입력하세요" : "다음 근무자에게 전달할 내용을 입력하세요"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
          <button className="btn btn-primary" onClick={submit}>등록</button>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="공지사항" icon="📢">
          {notices.map((n) => (
            <div className="notice-item" key={n.id} style={{ padding: "11px 2px" }}>
              <span className="notice-bullet">{n.pinned ? "📌" : "•"}</span>
              <span>{n.text}</span>
              <span className="date">{n.date}</span>
            </div>
          ))}
        </Card>

        <Card title="전달사항" icon="💬">
          {handovers.map((h) => (
            <div className="notice-item" key={h.id} style={{ padding: "11px 2px" }}>
              <span className="notice-bullet">•</span>
              <span>{h.text}</span>
              <span className="date">{h.date}</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
