import { Link } from "react-router-dom";
import { useStore } from "../store";
import { Card, StatusBadge, Badge } from "../components/ui";
import {
  CURRENT_STAFF_ID, EMPLOYEES, TODAY, TODAY_DOW, DOW_KO,
  weekDates, durationH,
} from "../data";

export default function StaffDashboard() {
  const {
    reservations, shifts, notices, handovers,
    punchedIn, punchedOut, punchIn, punchOut, showToast,
  } = useStore();

  const me = EMPLOYEES.find((e) => e.id === CURRENT_STAFF_ID)!;
  const myShifts = shifts.filter((s) => s.empId === me.id);
  const todayShift = myShifts.find((s) => s.day === TODAY_DOW);
  const week = weekDates(TODAY);
  const todayResv = reservations
    .filter((r) => r.status !== "취소" && r.status !== "노쇼")
    .slice(0, 4);

  const workH = todayShift && !todayShift.off
    ? durationH(todayShift.start!, todayShift.end!, todayShift.breakMin)
    : 0;

  return (
    <>
      <div className="grid grid-main-side">
        <div className="stack">
          {/* 오늘 근무 */}
          <Card>
            <div className="spread">
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="muted small bold">오늘 근무</span>
                  <Badge tone="green">
                    {TODAY.getMonth() + 1}.{TODAY.getDate()} ({DOW_KO[TODAY_DOW]})
                  </Badge>
                  {punchedIn && !punchedOut && <Badge tone="solid">출근 전</Badge>}
                </div>
                {todayShift && !todayShift.off ? (
                  <>
                    <div className="hero-time" style={{ marginTop: 6 }}>
                      {todayShift.start} ~ {todayShift.end}
                    </div>
                    <div className="muted small" style={{ marginTop: 2 }}>
                      휴게 {todayShift.breakMin}분 · 총 {workH}시간 근무 예정
                    </div>
                  </>
                ) : (
                  <div className="hero-time" style={{ marginTop: 6 }}>오늘은 휴무</div>
                )}
              </div>
            </div>
            {todayShift && !todayShift.off && (
              <div className="punch-row">
                <button
                  className="btn btn-primary btn-lg"
                  disabled={punchedIn}
                  onClick={punchIn}
                >
                  ⏱ {punchedIn ? "출근 완료" : "출근하기"}
                </button>
                <button
                  className="btn btn-outline btn-lg"
                  disabled={!punchedIn || punchedOut}
                  onClick={punchOut}
                >
                  {punchedOut ? "퇴근 완료" : "퇴근하기"}
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
        </div>

        {/* 우측: 이번 주 근무표 + 빠른 기록 */}
        <div className="stack side-panel">
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
