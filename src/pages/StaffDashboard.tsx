import { useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { Card, StatusBadge, Badge, TimeQuick } from "../components/ui";
import {
  CURRENT_STAFF_ID, EMPLOYEES, TODAY, TODAY_DOW, TODAY_STR, DOW_KO,
  weekDates, durationH, fmtH, minutes, toTime,
} from "../data";

export default function StaffDashboard() {
  const {
    reservations, shifts, notices, handovers, addRecord,
    punchStatus, punchInAt, punchOutAt, punchIn, punchOut, showToast,
  } = useStore();

  const me = EMPLOYEES.find((e) => e.id === CURRENT_STAFF_ID)!;
  const myShifts = shifts.filter((s) => s.empId === me.id);
  const todayShift = myShifts.find((s) => s.day === TODAY_DOW);
  const hasWork = !!todayShift && !todayShift.off;
  const week = weekDates(TODAY);
  const todayResv = reservations
    .filter((r) => r.status !== "취소" && r.status !== "노쇼")
    .slice(0, 4);

  const workH = hasWork
    ? durationH(todayShift!.start!, todayShift!.end!, todayShift!.breakMin)
    : 0;

  // 모바일 빠른 근무기록
  const planStart = hasWork ? todayShift!.start! : "10:00";
  const [quickStart, setQuickStart] = useState(planStart);
  const [quickSaved, setQuickSaved] = useState(false);
  const quickPresets = [-30, 0, 30, 60].map((d) => toTime(minutes(planStart) + d));

  const saveQuick = () => {
    addRecord({
      id: Date.now(), empId: me.id, date: TODAY_STR,
      planStart, planEnd: hasWork ? todayShift!.end! : "15:00",
      actualStart: quickStart, actualEnd: hasWork ? todayShift!.end! : "15:00",
      breakMin: todayShift?.breakMin ?? 30, status: "미작성",
    });
    setQuickSaved(true);
    showToast("근무기록이 임시 저장되었습니다");
  };

  const punchBadge =
    punchStatus === "before" ? <Badge tone="gray">출근 전</Badge>
    : punchStatus === "working" ? <Badge tone="solid">근무중</Badge>
    : <Badge tone="green">퇴근 완료</Badge>;

  return (
    <>
      <p className="greeting hide-desktop">
        {me.name}님, 오늘도 좋은 하루 보내세요! 🌿
      </p>

      <div className="grid grid-main-side">
        <div className="stack">
          {/* 오늘 근무 */}
          <Card>
            <div className="spread">
              <div style={{ width: "100%" }}>
                <div className="spread">
                  <div className="row" style={{ gap: 8 }}>
                    <span className="muted small bold">오늘 근무</span>
                    <Badge tone="green">
                      {TODAY.getMonth() + 1}.{TODAY.getDate()} ({DOW_KO[TODAY_DOW]})
                    </Badge>
                  </div>
                  {hasWork && punchBadge}
                </div>
                {hasWork ? (
                  <>
                    <div className="hero-time" style={{ marginTop: 6 }}>
                      {todayShift!.start} ~ {todayShift!.end}
                    </div>
                    <div className="muted small" style={{ marginTop: 2 }}>
                      휴게 {todayShift!.breakMin}분 · 총 {fmtH(workH)} 근무 예정
                      {punchInAt && ` · 출근 ${punchInAt}`}
                      {punchOutAt && ` · 퇴근 ${punchOutAt}`}
                    </div>
                  </>
                ) : (
                  <div className="hero-time" style={{ marginTop: 6 }}>오늘은 휴무</div>
                )}
              </div>
            </div>
            {hasWork && (
              <div className="punch-row">
                <button
                  className="btn btn-primary btn-lg"
                  disabled={punchStatus !== "before"}
                  onClick={punchIn}
                >
                  ⏱ {punchStatus === "before" ? "출근하기" : `출근 완료 ${punchInAt ?? ""}`}
                </button>
                <button
                  className="btn btn-outline btn-lg"
                  disabled={punchStatus !== "working"}
                  onClick={punchOut}
                >
                  {punchStatus === "done" ? `퇴근 완료 ${punchOutAt ?? ""}` : "퇴근하기"}
                </button>
              </div>
            )}
          </Card>

          {/* 오늘 예약 */}
          <Card
            title="오늘 예약"
            icon="📋"
            action={<Link to="/reservations" className="card-link">전체 보기 ›</Link>}
          >
            {todayResv.map((r) => (
              <div className="list-row" key={r.id}>
                <span className="list-time">{r.time}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="bold">{r.name} <span className="muted small">· {r.people}명</span></div>
                  <div className="muted small">{r.seat}{r.request ? ` · ${r.request}` : ""}</div>
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </Card>

          {/* 모바일 전용: 빠른 근무기록 */}
          {hasWork && (
            <Card title="빠른 근무기록" icon="⚡" className="hide-desktop"
              action={<Link to="/worklog" className="card-link">상세 작성 ›</Link>}
            >
              <TimeQuick
                label="실제 출근 시간"
                value={quickStart}
                onChange={setQuickStart}
                presets={quickPresets}
              />
              <button
                className="btn btn-primary btn-block btn-lg"
                style={{ marginTop: 14 }}
                disabled={quickSaved}
                onClick={saveQuick}
              >
                {quickSaved ? "✓ 저장됨" : "기록 저장"}
              </button>
            </Card>
          )}

          <div className="grid grid-2">
            {/* 전달사항 */}
            <Card title="오늘 전달사항" icon="💬">
              {handovers.slice(0, 4).map((h) => (
                <div className="notice-item" key={h.id}>
                  <span className="notice-bullet">•</span>
                  <span>{h.text}</span>
                  <span className="date">{h.date}</span>
                </div>
              ))}
            </Card>
            {/* 공지사항 */}
            <Card
              title="공지사항"
              icon="📢"
              action={<Link to="/notices" className="card-link">전체 ›</Link>}
            >
              {notices.slice(0, 4).map((n) => (
                <div className="notice-item" key={n.id}>
                  <span className="notice-bullet">{n.pinned ? "📌" : "•"}</span>
                  <span>{n.text}</span>
                  <span className="date">{n.date}</span>
                </div>
              ))}
            </Card>
          </div>

          {/* 모바일 전용: 근무표 바로가기 */}
          <Link to="/schedule" className="btn btn-outline btn-lg btn-block hide-desktop">
            🗓️ 이번 주 근무표 보기
          </Link>
        </div>

        {/* 우측: 이번 주 근무표 + 빠른 기록 (데스크톱) */}
        <div className="stack side-panel hide-mobile">
          <Card
            title="이번 주 근무표"
            icon="🗓️"
            action={<Link to="/schedule" className="card-link">상세 ›</Link>}
          >
            <div className="week-strip">
              {week.map((d, i) => {
                const s = myShifts.find((x) => x.day === i);
                return (
                  <div className={`week-day ${i === TODAY_DOW ? "today" : ""}`} key={i}>
                    <span className="dow">{DOW_KO[i]}</span>
                    <span className="dt">{d.getMonth() + 1}/{d.getDate()}</span>
                    {s && !s.off ? (
                      <span className="tm">{s.start}–{s.end}</span>
                    ) : (
                      <span className="tm off">휴무</span>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="근무기록 빠르게 작성" icon="✍️">
            <p className="muted small" style={{ margin: "0 0 12px" }}>
              오늘 근무가 끝나면 실제 출퇴근 시간을 기록해주세요.
              버튼 한두 번이면 끝나요.
            </p>
            <Link to="/worklog" className="btn btn-primary btn-block">
              ✍️ 기록 작성하러 가기
            </Link>
            <button
              className="btn btn-soft btn-block"
              style={{ marginTop: 8 }}
              onClick={() => showToast("예정대로 근무한 것으로 임시 저장했습니다")}
            >
              ⚡ 예정대로 근무했어요 (원클릭 기록)
            </button>
          </Card>
        </div>
      </div>
    </>
  );
}
