import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Card, Badge } from "../components/ui";
import { TODAY, TODAY_DOW, DOW_KO, weekDates } from "../data";
import type { Department, Employee, Shift, ShiftPeriod } from "../data/types";
import {
  DEPARTMENT_LABEL,
  DEPARTMENTS,
  PERIOD_LABEL,
  PERIOD_TIME,
  PERIODS,
  countSlots,
  dayTitle,
  shiftDateForDay,
  shiftsForDay,
  slotSummary,
  sortShifts,
} from "../lib/shifts";
import { employmentLabel, payBasisLabel } from "../lib/payroll";

interface EditorState {
  dayIndex: number;
  period: ShiftPeriod;
  department: Department;
  employeeId: number;
  order: number;
}

const emptyEditor: EditorState = {
  dayIndex: TODAY_DOW,
  period: "morning",
  department: "hall",
  employeeId: 0,
  order: 1,
};

function weekBase(offset: number): Date {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset * 7);
  return d;
}

export default function ScheduleManage() {
  const { shifts, setShift, deleteShift, showToast, employees } = useStore();
  const [weekOffset, setWeekOffset] = useState(0);
  const week = useMemo(() => weekDates(weekBase(weekOffset)), [weekOffset]);
  const [selectedDay, setSelectedDay] = useState(TODAY_DOW);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);

  useEffect(() => {
    if (!editor.employeeId && employees[0]) {
      setEditor((prev) => ({ ...prev, employeeId: employees[0].id }));
    }
  }, [editor.employeeId, employees]);

  const selectedShift = selectedId
    ? shifts.find((s) => s.id === selectedId) ?? null
    : null;

  const weekDatesSet = new Set(week.map((d) => shiftDateForDay(week, week.indexOf(d))));
  const weekShifts = shifts
    .filter((s) => weekDatesSet.has(s.date) || (!s.date && s.dayIndex >= 0 && s.dayIndex < 7))
    .sort(sortShifts);

  const currentDayShifts = shiftsForDay(
    shifts,
    shiftDateForDay(week, editor.dayIndex),
    editor.dayIndex
  );

  const slotEmployees = currentDayShifts.filter(
    (s) => s.period === editor.period && s.department === editor.department
  );

  const weekSlotCount = countSlots(weekShifts).slotCount;
  const staffedDays = new Set(weekShifts.map((s) => `${s.date}_${s.dayIndex}`)).size;
  const missingSlots = week.flatMap((d, dayIndex) => {
    const date = shiftDateForDay(week, dayIndex);
    return PERIODS.flatMap((period) =>
      DEPARTMENTS
        .filter((department) =>
          shiftsForDay(shifts, date, dayIndex)
            .filter((s) => s.period === period && s.department === department)
            .length === 0
        )
        .map((department) => ({ dayIndex, period, department }))
    );
  });

  const setField = <K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setSelectedId(null);
    setEditor((prev) => ({ ...prev, [key]: value }));
  };

  const selectShift = (shift: Shift) => {
    setSelectedId(shift.id);
    setSelectedDay(shift.dayIndex);
    setEditor({
      dayIndex: shift.dayIndex,
      period: shift.period,
      department: shift.department,
      employeeId: shift.employeeId,
      order: shift.order + 1,
    });
  };

  const activateSlot = (dayIndex: number, period: ShiftPeriod, department: Department) => {
    setSelectedDay(dayIndex);
    setSelectedId(null);
    const date = shiftDateForDay(week, dayIndex);
    const nextOrder = shiftsForDay(shifts, date, dayIndex)
      .filter((s) => s.period === period && s.department === department)
      .reduce((max, s) => Math.max(max, s.order + 2), 1);
    setEditor((prev) => ({
      ...prev,
      dayIndex,
      period,
      department,
      order: nextOrder,
    }));
  };

  const upsert = () => {
    const employee = employees.find((e) => e.id === editor.employeeId);
    if (!employee) {
      showToast("직원을 선택해주세요");
      return;
    }
    const order = Math.max(0, editor.order - 1);
    const date = shiftDateForDay(week, editor.dayIndex);
    const time = PERIOD_TIME[editor.period];
    const id = selectedShift?.id
      ?? `${date}_${editor.period}_${editor.department}_${employee.id}_${Date.now()}`;
    const next: Shift = {
      id,
      date,
      dayIndex: editor.dayIndex,
      day: editor.dayIndex,
      period: editor.period,
      department: editor.department,
      employeeId: employee.id,
      empId: employee.id,
      employeeName: employee.name,
      roleLabel: employee.roleLabel,
      order,
      ...time,
    };
    setShift(next);
    setSelectedId(id);
    showToast(selectedShift ? "근무 배치를 수정했습니다" : "근무 배치를 추가했습니다");
  };

  const removeSelected = () => {
    if (!selectedShift) return;
    deleteShift(selectedShift.id);
    setSelectedId(null);
    showToast("근무 배치를 삭제했습니다");
  };

  const copyWeek = (direction: -1 | 1) => {
    const sourceWeek = weekDates(weekBase(weekOffset + direction));
    const sourceDates = new Set(sourceWeek.map((d, i) => shiftDateForDay(sourceWeek, i)));
    const source = shifts.filter((s) => sourceDates.has(s.date));
    if (source.length === 0) {
      showToast(direction === -1 ? "지난주에 복사할 근무표가 없습니다" : "다음주에 복사할 근무표가 없습니다");
      return;
    }
    source.forEach((s) => {
      const targetDate = shiftDateForDay(week, s.dayIndex);
      setShift({
        ...s,
        id: `${targetDate}_${s.period}_${s.department}_${s.employeeId}_${s.order}`,
        date: targetDate,
        day: s.dayIndex,
      });
    });
    showToast(direction === -1 ? "지난주 근무표를 현재 주로 복사했습니다" : "다음주 근무표를 현재 주로 복사했습니다");
  };

  const employeeForEditor = employees.find((e) => e.id === editor.employeeId);

  return (
    <>
      <div className="alert-item info hide-desktop">
        <span>🗓️</span>
        <div>
          요일 탭으로 날짜를 고르고 오전/오후 슬롯에 직원을 배치할 수 있어요
          <div className="desc">실제 엑셀 근무표처럼 홀과 주방을 분리해서 봅니다</div>
        </div>
      </div>

      <div className="spread schedule-toolbar">
        <div className="row">
          <button className="icon-btn" aria-label="이전 주" onClick={() => setWeekOffset((v) => v - 1)}>‹</button>
          <span className="bold">
            {week[0].getFullYear()}년 {week[0].getMonth() + 1}월 {week[0].getDate()}일 ~ {week[6].getMonth() + 1}월 {week[6].getDate()}일
          </span>
          <button className="icon-btn" aria-label="다음 주" onClick={() => setWeekOffset((v) => v + 1)}>›</button>
        </div>
        <div className="row schedule-actions">
          <button className="btn btn-outline btn-sm" onClick={() => copyWeek(-1)}>지난주 복사</button>
          <button className="btn btn-outline btn-sm" onClick={() => copyWeek(1)}>다음주 복사</button>
          <button className="btn btn-soft btn-sm" onClick={() => showToast("직원 추가는 Firebase employees 문서에서 먼저 등록해주세요")}>
            직원 추가
          </button>
          <button className="btn btn-primary btn-sm" onClick={upsert}>저장</button>
        </div>
      </div>

      <div className="grid grid-4">
        <Card>
          <div className="stat-label">이번 주 슬롯</div>
          <div className="stat-value">{weekSlotCount}<span className="unit">개</span></div>
          <div className="muted small">오전/오후 배치 합계</div>
        </Card>
        <Card>
          <div className="stat-label">배치된 날짜</div>
          <div className="stat-value">{staffedDays}<span className="unit">일</span></div>
          <div className="muted small">7일 중 근무가 있는 날</div>
        </Card>
        <Card>
          <div className="stat-label">직원</div>
          <div className="stat-value">{employees.length}<span className="unit">명</span></div>
          <div className="muted small">직원번호 기준 연결</div>
        </Card>
        <Card>
          <div className="stat-label">빈 슬롯</div>
          <div className="stat-value">{missingSlots.length}<span className="unit">칸</span></div>
          <div className="muted small">오전/오후 홀·주방 기준</div>
        </Card>
      </div>

      <div className="grid grid-main-side">
        <div className="stack">
          <Card>
            <div className="day-tabs">
              {week.map((d, i) => (
                <button
                  key={i}
                  className={`day-tab ${selectedDay === i ? "on" : ""}`}
                  onClick={() => {
                    setSelectedDay(i);
                    setEditor((prev) => ({ ...prev, dayIndex: i }));
                  }}
                >
                  <span>{DOW_KO[i]}</span>
                  <strong>{d.getDate()}</strong>
                </button>
              ))}
            </div>

            <div className="slot-board">
              {week.map((d, dayIndex) => {
                const date = shiftDateForDay(week, dayIndex);
                const dayShifts = shiftsForDay(shifts, date, dayIndex);
                return (
                  <section
                    className={`day-card ${selectedDay === dayIndex ? "selected" : ""}`}
                    key={date}
                    onClick={() => setSelectedDay(dayIndex)}
                  >
                    <div className="day-card-head">
                      <div>
                        <div className="bold">{dayTitle(d, dayIndex)}</div>
                        <div className="muted small">{slotSummary(dayShifts)}</div>
                      </div>
                      {dayIndex === TODAY_DOW && weekOffset === 0 && <Badge tone="green">오늘</Badge>}
                    </div>

                    {PERIODS.map((period) => (
                      <div className="period-box" key={period}>
                        <div className="period-title">{PERIOD_LABEL[period]}</div>
                        {DEPARTMENTS.map((department) => {
                          const assignments = dayShifts.filter(
                            (s) => s.period === period && s.department === department
                          );
                          return (
                            <button
                              type="button"
                              key={department}
                              className={`dept-lane ${editor.dayIndex === dayIndex && editor.period === period && editor.department === department ? "active" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                activateSlot(dayIndex, period, department);
                              }}
                            >
                              <span className="dept-label">{DEPARTMENT_LABEL[department]}</span>
                              <span className="staff-chip-list">
                                {assignments.map((assignment) => (
                                  <span
                                    key={assignment.id}
                                    className={`staff-chip ${selectedId === assignment.id ? "selected" : ""}`}
                                  >
                                    <span
                                      className="staff-chip-main"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        selectShift(assignment);
                                      }}
                                    >
                                      {assignment.employeeName || employees.find((e) => e.id === assignment.employeeId)?.name || `직원 ${assignment.employeeId}`}
                                      {(assignment.roleLabel || employees.find((e) => e.id === assignment.employeeId)?.roleLabel) && (
                                        <em>({assignment.roleLabel || employees.find((e) => e.id === assignment.employeeId)?.roleLabel})</em>
                                      )}
                                    </span>
                                    <span
                                      className="staff-chip-remove"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteShift(assignment.id);
                                        if (selectedId === assignment.id) setSelectedId(null);
                                        showToast("근무 배치를 삭제했습니다");
                                      }}
                                    >
                                      ×
                                    </span>
                                  </span>
                                ))}
                                {assignments.length === 0 && <span className="empty-slot">비어 있음</span>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </section>
                );
              })}
            </div>
          </Card>

          <Card title="직원별 주간 슬롯" icon="📊">
            <div className="slot-summary-grid">
              {employees.map((employee) => {
                const counts = countSlots(weekShifts, employee.id);
                if (counts.slotCount === 0) return null;
                return (
                  <div className="slot-summary-item" key={employee.id}>
                    <div>
                      <div className="bold small">
                        {employee.name}
                        {employee.roleLabel && <span className="muted">({employee.roleLabel})</span>}
                      </div>
                      <div className="muted small">{employee.role} · {employmentLabel(employee)}</div>
                    </div>
                    <div className="num bold">
                      오전 {counts.morningCount} · 오후 {counts.afternoonCount}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="side-panel">
          <Card
            title="근무 배치 편집"
            icon="✏️"
            action={selectedShift ? <Badge tone="blue">수정 중</Badge> : <Badge tone="green">추가</Badge>}
          >
            <label className="field-label">날짜</label>
            <select
              className="select"
              value={editor.dayIndex}
              onChange={(e) => setField("dayIndex", Number(e.target.value))}
            >
              {week.map((d, i) => (
                <option key={i} value={i}>{dayTitle(d, i)}</option>
              ))}
            </select>

            <label className="field-label" style={{ marginTop: 12 }}>근무 슬롯</label>
            <div className="segmented fill">
              {PERIODS.map((period) => (
                <button
                  key={period}
                  className={editor.period === period ? "on" : ""}
                  onClick={() => setField("period", period)}
                >
                  {PERIOD_LABEL[period]}
                </button>
              ))}
            </div>

            <label className="field-label" style={{ marginTop: 12 }}>구역</label>
            <div className="segmented fill">
              {DEPARTMENTS.map((department) => (
                <button
                  key={department}
                  className={editor.department === department ? "on" : ""}
                  onClick={() => setField("department", department)}
                >
                  {DEPARTMENT_LABEL[department]}
                </button>
              ))}
            </div>

            <label className="field-label" style={{ marginTop: 12 }}>직원</label>
            <select
              className="select"
              value={editor.employeeId}
              onChange={(e) => setField("employeeId", Number(e.target.value))}
            >
              <option value={0}>직원 선택</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.id}. {employee.name}{employee.roleLabel ? `(${employee.roleLabel})` : ""} - {employee.role}
                </option>
              ))}
            </select>
            {employeeForEditor && (
              <p className="muted small" style={{ margin: "6px 0 0" }}>
                {employmentLabel(employeeForEditor)} · {payBasisLabel(employeeForEditor)}
              </p>
            )}

            <label className="field-label" style={{ marginTop: 12 }}>표시 순서</label>
            <input
              className="input"
              type="number"
              min={1}
              value={editor.order}
              onChange={(e) => setField("order", Number(e.target.value) || 1)}
            />

            <div className="alert-item info" style={{ marginTop: 14 }}>
              <span>📌</span>
              <div>
                현재 칸: {DOW_KO[editor.dayIndex]} · {PERIOD_LABEL[editor.period]} · {DEPARTMENT_LABEL[editor.department]}
                <div className="desc">{slotEmployees.length}명 배치됨</div>
              </div>
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={upsert}>
                {selectedShift ? "적용" : "추가"}
              </button>
              <button className="btn btn-danger" style={{ flex: 1 }} disabled={!selectedShift} onClick={removeSelected}>
                삭제
              </button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
