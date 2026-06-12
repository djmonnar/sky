import { useState } from "react";
import { useStore } from "../store";
import { Card, Badge } from "../components/ui";
import {
  CURRENT_STAFF_ID, EMPLOYEES, TODAY, TODAY_DOW, DOW_KO,
  weekDates, durationH,
} from "../data";

export default function SchedulePage() {
  const { shifts, handovers, showToast } = useStore();
  const me = EMPLOYEES.find((e) => e.id === CURRENT_STAFF_ID)!;
  const myShifts = shifts.filter((s) => s.empId === me.id);
  const week = weekDates(TODAY);
  const [selDay, setSelDay] = useState(TODAY_DOW);

  const selShift = myShifts.find((s) => s.day === selDay);
  const totalH = myShifts.reduce(
    (a, s) => a + (s.off ? 0 : durationH(s.start!, s.end!, s.breakMin)), 0
  );

  return (
    <>
      {/* 주간 날짜 칩 */}
      <Card>
        <div className="spread" style={{ marginBottom: 12 }}>
          <button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="이전 주">‹</button>
          <span className="bold">
            {week[0].getFullYear()}년 {week[0].getMonth() + 1}월 {week[0].getDate()}일 ~ {week[6].getMonth() + 1}월 {week[6].getDate()}일
          </span>
          <button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="다음 주">›</button>
        </div>
        <div className="row" style={{ justifyContent: "space-between", gap: 5 }}>
          {week.map((d, i) => (
            <button
              key={i}
              onClick={() => setSelDay(i)}
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                gap: 3, padding: "9px 2px", borderRadius: 11,
                background: selDay === i ? "var(--green-700)" : "transparent",
                color: selDay === i ? "#fff" : i === TODAY_DOW ? "var(--green-700)" : "var(--text-sub)",
                fontWeight: 700,
              }}
            >
              <span style={{ fontSize: 12 }}>{DOW_KO[i]}</span>
              <span style={{ fontSize: 14 }}>{d.getDate()}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* 선택일 근무 요약 */}
      <Card>
        <div className="spread" style={{ flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="row" style={{ gap: 7 }}>
              <span className="muted small bold">
                {week[selDay].getMonth() + 1}월 {week[selDay].getDate()}일 ({DOW_KO[selDay]})
              </span>
              {selDay === TODAY_DOW && <Badge tone="green">오늘</Badge>}
            </div>
            {selShift && !selShift.off ? (
              <>
                <div className="hero-time" style={{ marginTop: 4 }}>
                  {selShift.start} ~ {selShift.end}
                </div>
                <div className="muted small">
                  휴게 {selShift.breakMin}분 · 총 {durationH(selShift.start!, selShift.end!, selShift.breakMin)}시간
                </div>
              </>
            ) : (
              <div className="hero-time" style={{ marginTop: 4, color: "var(--orange-tx)" }}>휴무</div>
            )}
          </div>
          <button className="btn btn-outline" onClick={() => showToast("근무 변경 신청이 접수되었습니다")}>
            근무 변경 신청
          </button>
        </div>
      </Card>

      <div className="grid grid-main-side">
        {/* 이번 주 리스트 */}
        <Card title="이번 주 근무" icon="🗓️" action={<span className="bold">총 {totalH}시간</span>}>
          <div className="week-strip">
            {week.map((d, i) => {
              const s = myShifts.find((x) => x.day === i);
              const h = s && !s.off ? durationH(s.start!, s.end!, s.breakMin) : 0;
              return (
                <div className={`week-day ${i === TODAY_DOW ? "today" : ""}`} key={i} style={{ padding: "11px 14px" }}>
                  <span className="dow">{DOW_KO[i]}</span>
                  <span className="dt">{d.getMonth() + 1}/{d.getDate()}</span>
                  {s && !s.off ? (
                    <>
                      <span className="tm">{s.start} – {s.end}</span>
                      <span className="muted small" style={{ width: 52, textAlign: "right" }}>{h}시간</span>
                    </>
                  ) : (
                    <span className="tm off">휴무</span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <div className="stack side-panel">
          {/* 주간 요약 */}
          <Card title="주간 요약" icon="📊">
            <div className="pay-line"><span className="k">근무 일수</span><span className="v">{myShifts.filter((s) => !s.off).length}일</span></div>
            <div className="pay-line"><span className="k">총 근무시간</span><span className="v">{totalH}시간</span></div>
            <div className="pay-line"><span className="k">예상 주급</span><span className="v">{(totalH * me.hourly).toLocaleString()}원</span></div>
            <div className="pay-line total"><span className="k">시급</span><span className="v">{me.hourly.toLocaleString()}원</span></div>
          </Card>

          {/* 전달사항 */}
          <Card title="전달사항" icon="💬">
            {handovers.slice(0, 3).map((h) => (
              <div className="notice-item" key={h.id}>
                <span className="notice-bullet">•</span>
                <span>{h.text}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
