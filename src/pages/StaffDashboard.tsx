import { useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { Card, StatusBadge, Badge } from "../components/ui";
import { TODAY, TODAY_DOW, TODAY_STR, DOW_KO, weekDates } from "../data";
import {
  countSlots,
  planTimesForShifts,
  shiftDateForDay,
  shiftsForEmployeeDay,
  slotLongSummary,
  slotSummary,
} from "../lib/shifts";
import { isMonthlyEmployee, payBasisLabel } from "../lib/payroll";

export default function StaffDashboard() {
  const {
    reservations, shifts, notices, handovers, addRecord, currentEmployee,
    punchStatus, punchInAt, punchOutAt, punchIn, punchOut, showToast, loading,
  } = useStore();

  const me = currentEmployee;
  const week = weekDates(TODAY);
  const todaySlots = shiftsForEmployeeDay(shifts, me?.id, TODAY_STR, TODAY_DOW);
  const hasWork = todaySlots.length > 0;
  const fixedSalary = !!me && isMonthlyEmployee(me);
  const plan = planTimesForShifts(todaySlots);
  const [quickSaved, setQuickSaved] = useState(false);

  const myWeekSlots = week.map((_, dayIndex) => {
    const date = shiftDateForDay(week, dayIndex);
    return shiftsForEmployeeDay(shifts, me?.id, date, dayIndex);
  });
  const weekCounts = countSlots(myWeekSlots.flat());

  const todayResv = reservations
    .filter((r) => r.status !== "취소" && r.status !== "노쇼")
    .slice(0, 4);

  const saveQuick = () => {
    if (!me) return;
    addRecord({
      id: Date.now(),
      empId: me.id,
      date: TODAY_STR,
      periods: Array.from(new Set(todaySlots.map((s) => s.period))),
      departments: Array.from(new Set(todaySlots.map((s) => s.department))),
      slotSummary: slotSummary(todaySlots),
      workType: "slot",
      planStart: plan.start,
      planEnd: plan.end,
      actualStart: plan.start,
      actualEnd: plan.end,
      breakMin: plan.breakMin,
      status: "승인대기",
    });
    setQuickSaved(true);
    showToast("오늘 슬롯 완료로 근무기록을 저장했습니다");
  };

  if (!me) {
    return (
      <Card>
        <div className="muted" style={{ textAlign: "center", padding: "30px 0" }}>
          {loading
            ? "직원 정보를 불러오는 중..."
            : "직원번호에 연결된 직원 정보가 없습니다. 관리자에게 employeeId를 확인해주세요."}
        </div>
      </Card>
    );
  }

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
                    <div className="hero-time slot-hero" style={{ marginTop: 6 }}>
                      {slotSummary(todaySlots)}
                    </div>
                    <div className="muted small" style={{ marginTop: 2 }}>
                      {slotLongSummary(todaySlots)} · 예정 {plan.start}~{plan.end}
                      {fixedSalary && ` · ${payBasisLabel(me)}`}
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

          {hasWork && (
            <Card
              title="빠른 근무기록"
              icon="⚡"
              className="hide-desktop"
              action={<Link to="/worklog" className="card-link">상세 작성 ›</Link>}
            >
              <div className="alert-item info">
                <span>✅</span>
                <div>
                  {slotSummary(todaySlots)} 완료로 저장
                  <div className="desc">세부 메모가 있으면 상세 작성에서 남길 수 있습니다</div>
                </div>
              </div>
              <button
                className="btn btn-primary btn-block btn-lg"
                disabled={quickSaved}
                onClick={saveQuick}
              >
                {quickSaved ? "저장됨" : "오늘 슬롯 완료 저장"}
              </button>
            </Card>
          )}

          <div className="grid grid-2">
            <Card title="오늘 전달사항" icon="💬">
              {handovers.slice(0, 4).map((h) => (
                <div className="notice-item" key={h.id}>
                  <span className="notice-bullet">•</span>
                  <span>{h.text}</span>
                  <span className="date">{h.date}</span>
                </div>
              ))}
            </Card>

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

          <Link to="/schedule" className="btn btn-outline btn-lg btn-block hide-desktop">
            🗓️ 이번 주 근무표 보기
          </Link>
        </div>

        <div className="stack side-panel hide-mobile">
          <Card
            title="이번 주 근무표"
            icon="🗓️"
            action={<Link to="/schedule" className="card-link">상세 ›</Link>}
          >
            <div className="week-strip">
              {week.map((d, i) => {
                const daySlots = myWeekSlots[i];
                return (
                  <div className={`week-day ${i === TODAY_DOW ? "today" : ""}`} key={i}>
                    <span className="dow">{DOW_KO[i]}</span>
                    <span className="dt">{d.getMonth() + 1}/{d.getDate()}</span>
                    {daySlots.length > 0 ? (
                      <span className="tm">{slotSummary(daySlots)}</span>
                    ) : (
                      <span className="tm off">휴무</span>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="주간 슬롯 요약" icon="📊">
            <div className="pay-line"><span className="k">오전 근무</span><span className="v">{weekCounts.morningCount}회</span></div>
            <div className="pay-line"><span className="k">오후 근무</span><span className="v">{weekCounts.afternoonCount}회</span></div>
            <div className="pay-line total"><span className="k">총 슬롯</span><span className="v">{weekCounts.slotCount}회</span></div>
            <Link to="/worklog" className="btn btn-primary btn-block" style={{ marginTop: 12 }}>
              근무기록 작성
            </Link>
            {hasWork && (
              <button
                className="btn btn-soft btn-block"
                style={{ marginTop: 8 }}
                disabled={quickSaved}
                onClick={saveQuick}
              >
                오늘 슬롯 완료 저장
              </button>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
