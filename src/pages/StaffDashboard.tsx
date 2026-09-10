import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { Card, StatusBadge, Badge } from "../components/ui";
import { DOW_KO, dowIndex, fmtDate, weekDates } from "../data";
import {
  countSlots,
  planTimesForShifts,
  shiftDateForDay,
  shiftsForEmployeeDay,
  slotLongSummary,
  slotSummary,
} from "../lib/shifts";
import { isMonthlyEmployee, payBasisLabel } from "../lib/payroll";
import { fmtMinutes } from "../lib/attendance";

export default function StaffDashboard() {
  const {
    reservations, shifts, notices, handovers, addRecord, currentEmployee,
    today, punchStatus, punchIn, punchOut, breakStart, breakEnd, showToast, loading,
  } = useStore();

  const me = currentEmployee;
  const [now, setNow] = useState(() => new Date());
  const todayStr = useMemo(() => fmtDate(now), [now]);
  const todayDow = useMemo(() => dowIndex(now), [now]);
  const week = useMemo(() => weekDates(now), [now]);
  const todaySlots = shiftsForEmployeeDay(shifts, me?.id, todayStr, todayDow);
  const hasWork = todaySlots.length > 0;
  const fixedSalary = !!me && isMonthlyEmployee(me);
  const plan = planTimesForShifts(todaySlots);
  const [quickSaved, setQuickSaved] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const myWeekSlots = week.map((_, dayIndex) => {
    const date = shiftDateForDay(week, dayIndex);
    return shiftsForEmployeeDay(shifts, me?.id, date, dayIndex);
  });
  const weekCounts = countSlots(myWeekSlots.flat());

  const todayResv = reservations
    .filter((r) => r.date === todayStr && r.status !== "취소" && r.status !== "노쇼")
    .slice(0, 4);

  const saveQuick = () => {
    if (!me) return;
    addRecord({
      id: Date.now(),
      empId: me.id,
      date: todayStr,
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
        : punchStatus === "onBreak" ? <Badge tone="amber">휴게중</Badge>
          : <Badge tone="green">퇴근 완료</Badge>;

  /* 출퇴근 버튼 넷. 지금 상태에서 못 누르는 것은 비활성으로 둔다 —
     숨기면 버튼 자리가 움직여 누르려던 곳을 잘못 누른다. */
  const punchButtons: {
    key: string; label: string; icon: string; cls: string;
    enabled: boolean; onClick: () => void;
  }[] = [
    { key: "in", label: "출근", icon: "⏱", cls: "btn-primary", enabled: punchStatus === "before", onClick: punchIn },
    { key: "breakStart", label: "휴게 시작", icon: "☕", cls: "btn-outline", enabled: punchStatus === "working", onClick: breakStart },
    { key: "breakEnd", label: "휴게 종료", icon: "▶", cls: "btn-soft", enabled: punchStatus === "onBreak", onClick: breakEnd },
    { key: "out", label: "퇴근", icon: "🏠", cls: "btn-outline", enabled: punchStatus === "working" || punchStatus === "onBreak", onClick: punchOut },
  ];

  const openBreak = today.breaks.find((b) => b.end === null);

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
                      {now.getMonth() + 1}.{now.getDate()} ({DOW_KO[todayDow]})
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
                    </div>
                  </>
                ) : (
                  <div className="hero-time" style={{ marginTop: 6 }}>오늘은 휴무</div>
                )}
              </div>
            </div>

            <div className="punch-panel">
              <div className="punch-summary">
                <div className="punch-summary-main">
                  <span className="k">출근</span>
                  <strong>{today.inAt ?? "-"}</strong>
                  <span className="k">퇴근</span>
                  <strong>{today.outAt ?? "-"}</strong>
                </div>
                <div className="punch-summary-sub">
                  {today.inAt ? (
                    <>
                      근무 {fmtMinutes(today.workedMinutes)}
                      {today.breakMinutes > 0 && ` · 휴게 ${fmtMinutes(today.breakMinutes)}`}
                      {openBreak && ` · ${openBreak.start}부터 휴게중`}
                    </>
                  ) : (
                    "출근을 누르면 시간이 기록됩니다"
                  )}
                </div>
              </div>
              <div className="punch-grid">
                {punchButtons.map((b) => (
                  <button
                    key={b.key}
                    className={`btn ${b.cls} btn-lg`}
                    disabled={!b.enabled}
                    onClick={b.onClick}
                  >
                    {b.icon} {b.label}
                  </button>
                ))}
              </div>
              {!hasWork && (
                <div className="muted small" style={{ marginTop: 8 }}>
                  오늘은 배정된 근무가 없습니다. 대타로 나왔다면 그대로 눌러 기록해두세요.
                </div>
              )}
              <Link to="/worklog?tab=month" className="card-link" style={{ marginTop: 10 }}>
                이번 달 근무내역 보기 ›
              </Link>
            </div>
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
                  <div className={`week-day ${i === todayDow ? "today" : ""}`} key={i}>
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
