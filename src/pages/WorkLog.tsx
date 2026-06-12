import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Card, ChipSelect, Badge } from "../components/ui";
import { TODAY_DOW, TODAY_STR, CHECKLIST_TEMPLATE } from "../data";
import type { ShiftPeriod } from "../data/types";
import {
  PERIOD_LABEL,
  PERIODS,
  planTimesForShifts,
  shiftsForEmployeeDay,
  slotLongSummary,
  slotSummary,
} from "../lib/shifts";
import { isMonthlyEmployee, payBasisLabel } from "../lib/payroll";

export default function WorkLog() {
  const { shifts, records, addRecord, showToast, currentEmployee, loading } = useStore();
  const me = currentEmployee;
  const planSlots = shiftsForEmployeeDay(shifts, me?.id, TODAY_STR, TODAY_DOW);
  const plan = planTimesForShifts(planSlots);
  const plannedPeriods = Array.from(new Set(planSlots.map((s) => s.period)));
  const plannedPeriodsKey = plannedPeriods.join("|");

  const [completedPeriods, setCompletedPeriods] = useState<ShiftPeriod[]>(plannedPeriods);
  const [off, setOff] = useState(planSlots.length === 0);
  const [start, setStart] = useState(plan.start);
  const [end, setEnd] = useState(plan.end);
  const [breakMin, setBreakMin] = useState(plan.breakMin);
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState("");
  const [handover, setHandover] = useState("");
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST_TEMPLATE.map(() => false));
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!touched) {
      setCompletedPeriods(plannedPeriods);
      setOff(planSlots.length === 0);
      setStart(plan.start);
      setEnd(plan.end);
      setBreakMin(plan.breakMin);
    }
  }, [plan.start, plan.end, plan.breakMin, planSlots.length, plannedPeriodsKey, touched]);

  const togglePeriod = (period: ShiftPeriod) => {
    setTouched(true);
    setOff(false);
    setCompletedPeriods((prev) =>
      prev.includes(period)
        ? prev.filter((p) => p !== period)
        : [...prev, period].sort((a, b) => PERIODS.indexOf(a) - PERIODS.indexOf(b))
    );
  };

  const setTodayOff = () => {
    setTouched(true);
    setOff(true);
    setCompletedPeriods([]);
  };

  const myRecent = records
    .filter((r) => r.empId === me?.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);

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

  const submit = (asDraft: boolean) => {
    const selectedSlots = off
      ? []
      : planSlots.filter((s) => completedPeriods.includes(s.period));
    const selectedSummary = off
      ? "휴무"
      : selectedSlots.length > 0
        ? slotSummary(selectedSlots)
        : completedPeriods.map((p) => PERIOD_LABEL[p]).join("+");

    addRecord({
      id: Date.now(),
      empId: me.id,
      date: TODAY_STR,
      periods: off ? [] : completedPeriods,
      departments: off ? [] : Array.from(new Set(selectedSlots.map((s) => s.department))),
      slotSummary: selectedSummary,
      workType: "slot",
      planStart: plan.start,
      planEnd: plan.end,
      actualStart: off ? undefined : start,
      actualEnd: off ? undefined : end,
      breakMin: off ? 0 : breakMin,
      note,
      handover,
      checklist: checks,
      status: asDraft ? "미작성" : "승인대기",
    });
    if (!asDraft) setSubmitted(true);
    showToast(asDraft ? "임시 저장되었습니다" : "근무기록이 제출되었습니다");
  };

  return (
    <>
      <Card>
        <div className="spread" style={{ flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="muted small bold">오늘의 예정 근무</div>
            <div className="time-display slot-record-title" style={{ marginTop: 2 }}>
              {slotSummary(planSlots)}
            </div>
            <div className="muted small">
              {planSlots.length > 0 ? `${slotLongSummary(planSlots)} · 예정 ${plan.start}~${plan.end}` : "배정된 슬롯 없음"}
            </div>
          </div>
          <div className="row">
            {submitted
              ? <Badge tone="green">제출 완료</Badge>
              : <Badge tone="amber">작성 전</Badge>}
          </div>
        </div>
      </Card>

      {isMonthlyEmployee(me) && (
        <div className="alert-item info">
          <span>💼</span>
          <div>
            정직원은 월급 기준이라 근무시간을 급여에 자동 반영하지 않습니다
            <div className="desc">{payBasisLabel(me)} · 지각/조퇴/결근 같은 예외만 남겨도 됩니다</div>
          </div>
        </div>
      )}

      <div className="grid grid-main-side">
        <div className="stack">
          <Card title="슬롯 완료 확인" icon="✅">
            <div className="slot-checks">
              {PERIODS.map((period) => {
                const planned = plannedPeriods.includes(period);
                const checked = completedPeriods.includes(period) && !off;
                return (
                  <button
                    key={period}
                    className={`slot-check ${checked ? "done" : ""}`}
                    disabled={!planned}
                    onClick={() => togglePeriod(period)}
                  >
                    <span className="checkbox">{checked ? "✓" : ""}</span>
                    <span>
                      {PERIOD_LABEL[period]} 근무 완료
                      <em>{planned ? "배정됨" : "배정 없음"}</em>
                    </span>
                  </button>
                );
              })}
              <button className={`slot-check off ${off ? "done" : ""}`} onClick={setTodayOff}>
                <span className="checkbox">{off ? "✓" : ""}</span>
                <span>
                  오늘 휴무
                  <em>배정이 없거나 결근/휴무 처리</em>
                </span>
              </button>
            </div>
          </Card>

          <Card title="오늘 업무 체크리스트" icon="✅" action={
            <span className="muted small">{checks.filter(Boolean).length}/{checks.length} 완료</span>
          }>
            {CHECKLIST_TEMPLATE.map((c, i) => (
              <div
                key={i}
                className={`check-item ${checks[i] ? "done" : ""}`}
                onClick={() => setChecks((p) => p.map((v, j) => (j === i ? !v : v)))}
              >
                <span className="checkbox">{checks[i] ? "✓" : ""}</span>
                {c}
              </div>
            ))}
          </Card>

          <Card title="고급 시간 옵션" icon="⏱️">
            <details className="advanced-time">
              <summary>실제 출퇴근 시간이 예정과 다를 때만 열어 수정</summary>
              <div className="grid grid-2" style={{ marginTop: 14 }}>
                <label>
                  <span className="field-label">실제 출근</span>
                  <input
                    className="input"
                    type="time"
                    value={start}
                    onChange={(e) => {
                      setTouched(true);
                      setStart(e.target.value);
                    }}
                  />
                </label>
                <label>
                  <span className="field-label">실제 퇴근</span>
                  <input
                    className="input"
                    type="time"
                    value={end}
                    onChange={(e) => {
                      setTouched(true);
                      setEnd(e.target.value);
                    }}
                  />
                </label>
              </div>
              <div style={{ marginTop: 14 }}>
                <span className="field-label">휴게시간</span>
                <ChipSelect
                  options={[0, 30, 60, 90]}
                  value={breakMin}
                  onChange={(m) => {
                    setTouched(true);
                    setBreakMin(m);
                  }}
                  format={(m) => (m === 0 ? "없음" : `${m}분`)}
                />
              </div>
            </details>
          </Card>
        </div>

        <div className="stack side-panel">
          <Card title="업무 메모" icon="📝">
            <label className="field-label">특이사항</label>
            <textarea
              className="textarea"
              placeholder="특이사항을 입력해주세요. (선택)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={100}
            />
            <div className="muted small" style={{ textAlign: "right" }}>{note.length}/100</div>

            <label className="field-label" style={{ marginTop: 8 }}>전달사항</label>
            <textarea
              className="textarea"
              placeholder="다음 근무자에게 전달할 내용을 입력해주세요. (선택)"
              value={handover}
              onChange={(e) => setHandover(e.target.value)}
              maxLength={100}
            />
            <div className="muted small" style={{ textAlign: "right" }}>{handover.length}/100</div>
          </Card>

          <Card title="최근 근무기록" icon="🗂️">
            {myRecent.map((r) => (
              <div className="list-row" key={r.id}>
                <div style={{ flex: 1 }}>
                  <div className="bold small">{r.date.slice(5).replace("-", "/")}</div>
                  <div className="muted small num">
                    {r.slotSummary ?? `${r.actualStart ?? "-"}-${r.actualEnd ?? "-"} · 휴게 ${r.breakMin}분`}
                  </div>
                </div>
                <Badge tone={r.status === "승인완료" ? "green" : r.status === "승인대기" ? "amber" : "gray"}>
                  {r.status}
                </Badge>
              </div>
            ))}
            {myRecent.length === 0 && (
              <div className="muted small" style={{ textAlign: "center", padding: "12px 0" }}>
                아직 근무기록이 없습니다
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-outline btn-lg" onClick={() => submit(true)}>임시 저장</button>
        <button className="btn btn-primary btn-lg" disabled={submitted} onClick={() => submit(false)}>
          근무기록 저장 및 제출
        </button>
      </div>
    </>
  );
}
