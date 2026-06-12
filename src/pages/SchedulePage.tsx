import { useState } from "react";
import { useStore } from "../store";
import { Card, Badge } from "../components/ui";
import { TODAY, TODAY_DOW, DOW_KO, weekDates } from "../data";
import {
  DEPARTMENT_LABEL,
  PERIOD_LABEL,
  PERIODS,
  countSlots,
  planTimesForShifts,
  shiftDateForDay,
  shiftsForEmployeeDay,
  slotLongSummary,
  slotSummary,
} from "../lib/shifts";
import { employmentLabel, isMonthlyEmployee, payBasisLabel } from "../lib/payroll";

export default function SchedulePage() {
  const { shifts, handovers, showToast, currentEmployee, loading } = useStore();
  const me = currentEmployee;
  const week = weekDates(TODAY);
  const [selDay, setSelDay] = useState(TODAY_DOW);

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

  const weekSlots = week.map((_, dayIndex) => {
    const date = shiftDateForDay(week, dayIndex);
    return shiftsForEmployeeDay(shifts, me.id, date, dayIndex);
  });
  const selSlots = weekSlots[selDay];
  const plan = planTimesForShifts(selSlots);
  const counts = countSlots(weekSlots.flat());
  const fixedSalary = isMonthlyEmployee(me);

  return (
    <>
      <Card>
        <div className="spread" style={{ marginBottom: 12 }}>
          <button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="이전 주">‹</button>
          <span className="bold">
            {week[0].getFullYear()}년 {week[0].getMonth() + 1}월 {week[0].getDate()}일 ~ {week[6].getMonth() + 1}월 {week[6].getDate()}일
          </span>
          <button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="다음 주">›</button>
        </div>
        <div className="day-tabs compact">
          {week.map((d, i) => (
            <button
              key={i}
              className={`day-tab ${selDay === i ? "on" : ""}`}
              onClick={() => setSelDay(i)}
            >
              <span>{DOW_KO[i]}</span>
              <strong>{d.getDate()}</strong>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <div className="spread" style={{ flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="row" style={{ gap: 7 }}>
              <span className="muted small bold">
                {week[selDay].getMonth() + 1}월 {week[selDay].getDate()}일 ({DOW_KO[selDay]})
              </span>
              {selDay === TODAY_DOW && <Badge tone="green">오늘</Badge>}
            </div>
            {selSlots.length > 0 ? (
              <>
                <div className="hero-time slot-hero" style={{ marginTop: 4 }}>
                  {slotSummary(selSlots)}
                </div>
                <div className="muted small">
                  {slotLongSummary(selSlots)} · 예정 {plan.start}~{plan.end}
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
        <Card
          title="선택일 근무"
          icon="🗓️"
          action={<span className="bold">{selSlots.length > 0 ? `${selSlots.length}슬롯` : "휴무"}</span>}
        >
          {selSlots.length > 0 ? (
            <div className="staff-slot-list">
              {PERIODS.map((period) => {
                const periodSlots = selSlots.filter((s) => s.period === period);
                if (periodSlots.length === 0) return null;
                return (
                  <div className="staff-slot-item" key={period}>
                    <div>
                      <div className="bold">{PERIOD_LABEL[period]} 근무</div>
                      <div className="muted small">
                        {periodSlots.map((s) => DEPARTMENT_LABEL[s.department]).join(", ")}
                      </div>
                    </div>
                    <Badge tone={period === "morning" ? "blue" : "amber"}>
                      {periodSlots.length}칸
                    </Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="muted" style={{ textAlign: "center", padding: "24px 0" }}>
              선택한 날짜에는 배정된 근무가 없습니다
            </div>
          )}
        </Card>

        <div className="stack side-panel">
          <Card title="주간 요약" icon="📊">
            <div className="pay-line"><span className="k">고용형태</span><span className="v">{employmentLabel(me)}</span></div>
            <div className="pay-line"><span className="k">오전 근무</span><span className="v">{counts.morningCount}회</span></div>
            <div className="pay-line"><span className="k">오후 근무</span><span className="v">{counts.afternoonCount}회</span></div>
            <div className="pay-line"><span className="k">근무 일수</span><span className="v">{weekSlots.filter((day) => day.length > 0).length}일</span></div>
            {fixedSalary ? (
              <div className="pay-line total"><span className="k">급여기준</span><span className="v">{payBasisLabel(me)}</span></div>
            ) : (
              <div className="pay-line total"><span className="k">총 슬롯</span><span className="v">{counts.slotCount}회</span></div>
            )}
          </Card>

          <Card title="이번 주 한눈에 보기" icon="👀">
            <div className="week-strip">
              {week.map((d, i) => {
                const daySlots = weekSlots[i];
                return (
                  <button
                    className={`week-day ${i === selDay ? "today" : ""}`}
                    key={i}
                    onClick={() => setSelDay(i)}
                  >
                    <span className="dow">{DOW_KO[i]}</span>
                    <span className="dt">{d.getMonth() + 1}/{d.getDate()}</span>
                    <span className={`tm ${daySlots.length === 0 ? "off" : ""}`}>
                      {daySlots.length > 0 ? slotSummary(daySlots) : "휴무"}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

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
