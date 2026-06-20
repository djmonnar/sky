import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { Card, Badge } from "../components/ui";
import { TODAY, TODAY_DOW, DOW_KO, weekDates } from "../data";
import type { Department, Shift, ShiftPeriod } from "../data/types";
import {
  DEPARTMENT_LABEL, PERIOD_LABEL, PERIOD_TIME,
  countSlots, shiftDateForDay, shiftsForDay,
} from "../lib/shifts";
import { employmentLabel } from "../lib/payroll";

/** 매트릭스 행: 오전·홀 / 오전·주방 / 오후·홀 / 오후·주방 */
const ROWS: { period: ShiftPeriod; department: Department }[] = [
  { period: "morning", department: "hall" },
  { period: "morning", department: "kitchen" },
  { period: "afternoon", department: "hall" },
  { period: "afternoon", department: "kitchen" },
];

function weekBase(offset: number): Date {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset * 7);
  return d;
}

type SelSlot = { dayIndex: number; period: ShiftPeriod; department: Department };

export default function ScheduleManage() {
  const { shifts, setShift, deleteShift, showToast, employees, role } = useStore();
  const [weekOffset, setWeekOffset] = useState(0);
  const week = useMemo(() => weekDates(weekBase(weekOffset)), [weekOffset]);
  const [sel, setSel] = useState<SelSlot | null>(null);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);

  const cellShifts = (s: SelSlot): Shift[] =>
    shiftsForDay(shifts, shiftDateForDay(week, s.dayIndex), s.dayIndex)
      .filter((x) => x.period === s.period && x.department === s.department);

  const selShifts = sel ? cellShifts(sel) : [];

  // KPI
  const weekDateSet = new Set(week.map((_, i) => shiftDateForDay(week, i)));
  const weekShifts = shifts.filter((s) => weekDateSet.has(s.date));
  const weekSlotCount = weekShifts.length;
  const staffedDays = new Set(weekShifts.map((s) => s.date)).size;
  const emptyCells = week.reduce((acc, _, dayIndex) => {
    return acc + ROWS.filter((r) => cellShifts({ ...r, dayIndex }).length === 0).length;
  }, 0);

  const availableEmployees = employees.filter(
    (e) => !selShifts.some((s) => s.employeeId === e.id)
  );

  const toggleEmployeeSelection = (employeeId: number) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(employeeId)
        ? prev.filter((id) => id !== employeeId)
        : [...prev, employeeId]
    );
  };

  const addEmployees = () => {
    if (!sel) return;
    const selectedEmployees = availableEmployees.filter((e) => selectedEmployeeIds.includes(e.id));
    if (selectedEmployees.length === 0) {
      showToast("추가할 직원을 선택해주세요");
      return;
    }
    const date = shiftDateForDay(week, sel.dayIndex);
    const time = PERIOD_TIME[sel.period];
    selectedEmployees.forEach((employee, index) => {
      const id = `${date}_${sel.period}_${sel.department}_${employee.id}`;
      setShift({
        id, date, dayIndex: sel.dayIndex, day: sel.dayIndex,
        period: sel.period, department: sel.department,
        employeeId: employee.id, empId: employee.id,
        employeeName: employee.name, roleLabel: employee.roleLabel,
        order: selShifts.length + index, ...time,
      });
    });
    setSelectedEmployeeIds([]);
    showToast(`${selectedEmployees.length}명 배치했습니다`);
  };

  const removeShift = (s: Shift) => {
    deleteShift(s.id);
    showToast("배치를 삭제했습니다");
  };

  const copyWeek = (direction: -1 | 1) => {
    const src = weekDates(weekBase(weekOffset + direction));
    const srcDates = new Set(src.map((_, i) => shiftDateForDay(src, i)));
    const source = shifts.filter((s) => srcDates.has(s.date));
    if (source.length === 0) {
      showToast(direction === -1 ? "지난주 근무표가 없습니다" : "다음주 근무표가 없습니다");
      return;
    }
    source.forEach((s) => {
      const targetDate = shiftDateForDay(week, s.dayIndex);
      setShift({ ...s, id: `${targetDate}_${s.period}_${s.department}_${s.employeeId}`, date: targetDate, day: s.dayIndex });
    });
    showToast("현재 주로 복사했습니다");
  };

  const sameSlot = (a: SelSlot | null, dayIndex: number, period: ShiftPeriod, department: Department) =>
    !!a && a.dayIndex === dayIndex && a.period === period && a.department === department;

  return (
    <>
      <div className="alert-item info hide-desktop">
        <span>🗓️</span>
        <div>
          가로로 스크롤해 요일을 보고, 칸을 눌러 직원을 배치하세요
          <div className="desc">행은 오전/오후 · 홀/주방, 열은 요일입니다</div>
        </div>
      </div>

      {/* 툴바 */}
      <div className="spread schedule-toolbar">
        <div className="row">
          <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label="이전 주" onClick={() => { setWeekOffset((v) => v - 1); setSel(null); setSelectedEmployeeIds([]); }}>‹</button>
          <span className="bold">
            {week[0].getFullYear()}년 {week[0].getMonth() + 1}월 {week[0].getDate()}일 ~ {week[6].getMonth() + 1}월 {week[6].getDate()}일
          </span>
          <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label="다음 주" onClick={() => { setWeekOffset((v) => v + 1); setSel(null); setSelectedEmployeeIds([]); }}>›</button>
        </div>
        <div className="row schedule-actions">
          <button className="btn btn-outline btn-sm" onClick={() => copyWeek(-1)}>📄 지난주 복사</button>
          {role === "admin" ? (
            <Link className="btn btn-outline btn-sm" to="/employees">＋ 직원 추가</Link>
          ) : (
            <button className="btn btn-outline btn-sm" onClick={() => showToast("신규 직원 추가는 관리자만 가능합니다")}>＋ 직원 추가</button>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-4">
        <Card><div className="stat-label">이번 주 배치</div><div className="stat-value">{weekSlotCount}<span className="unit">건</span></div><div className="muted small">오전/오후 슬롯 합계</div></Card>
        <Card><div className="stat-label">근무 있는 날</div><div className="stat-value">{staffedDays}<span className="unit">일</span></div><div className="muted small">7일 기준</div></Card>
        <Card><div className="stat-label">직원</div><div className="stat-value">{employees.length}<span className="unit">명</span></div><div className="muted small">배치 가능 인원</div></Card>
        <Card><div className="stat-label">빈 칸</div><div className="stat-value">{emptyCells}<span className="unit">칸</span></div><div className="muted small">오전/오후 · 홀/주방</div></Card>
      </div>

      <div className="grid grid-main-side">
        <div className="stack">
          {/* 슬롯 매트릭스 */}
          <Card>
            <div className="smx-wrap">
              <div className="smx">
                {/* 헤더 행 */}
                <div className="smx-corner" />
                {week.map((d, i) => (
                  <div className={`smx-dayhead ${i === TODAY_DOW && weekOffset === 0 ? "today" : ""}`} key={i}>
                    <span className="dow">{DOW_KO[i]}</span>
                    <strong>{d.getMonth() + 1}/{d.getDate()}</strong>
                  </div>
                ))}

                {/* 본문 행 */}
                {ROWS.map((row) => (
                  <RowCells
                    key={`${row.period}_${row.department}`}
                    row={row}
                    week={week}
                    cellShifts={(dayIndex) => cellShifts({ ...row, dayIndex })}
                    isSel={(dayIndex) => sameSlot(sel, dayIndex, row.period, row.department)}
                    onSelect={(dayIndex) => { setSel({ ...row, dayIndex }); setSelectedEmployeeIds([]); }}
                  />
                ))}
              </div>
            </div>
          </Card>

          {/* 직원별 주간 슬롯 */}
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
                        {employee.roleLabel && <span className="muted"> ({employee.roleLabel})</span>}
                      </div>
                      <div className="muted small">{employee.role} · {employmentLabel(employee)}</div>
                    </div>
                    <div className="num bold">오전 {counts.morningCount} · 오후 {counts.afternoonCount}</div>
                  </div>
                );
              })}
              {weekShifts.length === 0 && (
                <div className="muted small" style={{ padding: "8px 2px" }}>이번 주 배치가 없습니다.</div>
              )}
            </div>
          </Card>
        </div>

        {/* 우측 편집 패널 */}
        <div className="side-panel">
          <Card title="근무 배치" icon="✏️" action={sel ? <Badge tone="green">{selShifts.length}명</Badge> : undefined}>
            {!sel ? (
              <div className="muted" style={{ textAlign: "center", padding: "34px 0" }}>
                근무표에서 칸을 선택하면<br />여기서 직원을 배치할 수 있습니다
              </div>
            ) : (
              <>
                <div className="alert-item info" style={{ marginBottom: 14 }}>
                  <span>📌</span>
                  <div>
                    {DOW_KO[sel.dayIndex]} {week[sel.dayIndex].getMonth() + 1}/{week[sel.dayIndex].getDate()} · {PERIOD_LABEL[sel.period]} · {DEPARTMENT_LABEL[sel.department]}
                    <div className="desc">{PERIOD_TIME[sel.period].start}–{PERIOD_TIME[sel.period].end}</div>
                  </div>
                </div>

                <label className="field-label">직원 추가</label>
                <div className="employee-multi-add">
                  <div className="employee-multi-list" role="group" aria-label="추가할 직원 선택">
                    {availableEmployees.length === 0 ? (
                      <div className="employee-multi-empty">추가 가능한 직원이 없습니다.</div>
                    ) : (
                      availableEmployees.map((e) => (
                        <label className="employee-pick" key={e.id}>
                          <input
                            type="checkbox"
                            checked={selectedEmployeeIds.includes(e.id)}
                            onChange={() => toggleEmployeeSelection(e.id)}
                          />
                          <span>
                            <span className="employee-pick-name">{e.name}{e.roleLabel ? ` (${e.roleLabel})` : ""}</span>
                            <span className="employee-pick-meta">{e.role}</span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                  <button className="btn btn-primary" onClick={addEmployees} disabled={selectedEmployeeIds.length === 0}>선택 추가</button>
                </div>

                <label className="field-label" style={{ marginTop: 14 }}>배치된 직원 ({selShifts.length})</label>
                {selShifts.length === 0 ? (
                  <div className="muted small" style={{ padding: "6px 2px" }}>아직 배치된 직원이 없습니다.</div>
                ) : (
                  <div className="assign-list">
                    {selShifts.map((s) => {
                      const emp = employees.find((e) => e.id === s.employeeId);
                      return (
                        <div className="assign-row" key={s.id}>
                          <span className="avatar">{(s.employeeName ?? "?")[0]}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="bold small">{s.employeeName}{(s.roleLabel ?? emp?.roleLabel) ? ` (${s.roleLabel ?? emp?.roleLabel})` : ""}</div>
                            <div className="muted small">{emp?.role ?? "—"}</div>
                          </div>
                          <button className="btn btn-danger btn-sm" onClick={() => removeShift(s)}>삭제</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function RowCells({
  row, week, cellShifts, isSel, onSelect,
}: {
  row: { period: ShiftPeriod; department: Department };
  week: Date[];
  cellShifts: (dayIndex: number) => Shift[];
  isSel: (dayIndex: number) => boolean;
  onSelect: (dayIndex: number) => void;
}) {
  return (
    <>
      <div className={`smx-rowlabel ${row.period}`}>
        <span className="period">{PERIOD_LABEL[row.period]}</span>
        <span className="dept">{DEPARTMENT_LABEL[row.department]}</span>
      </div>
      {week.map((_, dayIndex) => {
        const cell = cellShifts(dayIndex);
        return (
          <button
            key={dayIndex}
            className={`smx-cell ${isSel(dayIndex) ? "sel" : ""} ${cell.length === 0 ? "empty" : ""}`}
            onClick={() => onSelect(dayIndex)}
          >
            {cell.length === 0 ? (
              <span className="smx-add">＋</span>
            ) : (
              cell.map((s) => (
                <span className="smx-chip" key={s.id}>{s.employeeName}</span>
              ))
            )}
          </button>
        );
      })}
    </>
  );
}
