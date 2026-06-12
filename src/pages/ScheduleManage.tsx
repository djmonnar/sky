import { useState } from "react";
import { useStore } from "../store";
import { Card, ChipSelect, Badge } from "../components/ui";
import {
  EMPLOYEES, TODAY, DOW_KO, weekDates, durationH, minutes,
} from "../data";

const PRESETS = [
  { label: "오픈 (10–15)", start: "10:00", end: "15:00", breakMin: 30 },
  { label: "미들 (12–21)", start: "12:00", end: "21:00", breakMin: 60 },
  { label: "마감 (17–22)", start: "17:00", end: "22:00", breakMin: 30 },
  { label: "주방 (09–15)", start: "09:00", end: "15:00", breakMin: 60 },
  { label: "풀타임 (09:30–18)", start: "09:30", end: "18:00", breakMin: 60 },
];

const TIME_OPTIONS = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "12:00",
  "14:00", "15:00", "17:00", "18:00", "21:00", "22:00",
];

export default function ScheduleManage() {
  const { shifts, setShift, showToast } = useStore();
  const week = weekDates(TODAY);
  const [sel, setSel] = useState<{ empId: number; day: number } | null>(null);

  const selShift = sel
    ? shifts.find((s) => s.empId === sel.empId && s.day === sel.day)
    : null;
  const selEmp = sel ? EMPLOYEES.find((e) => e.id === sel.empId) : null;

  const empHours = (empId: number) =>
    shifts
      .filter((s) => s.empId === empId && !s.off)
      .reduce((a, s) => a + durationH(s.start!, s.end!, s.breakMin), 0);

  // 인원 부족 경고: 점심(11-14) 시간대에 2명 미만인 요일
  const lunchShort = Array.from({ length: 7 }, (_, day) => {
    const n = shifts.filter(
      (s) => s.day === day && !s.off &&
        minutes(s.start!) <= 11 * 60 && minutes(s.end!) >= 14 * 60
    ).length;
    return { day, n };
  }).filter((x) => x.n < 2);

  const patch = (p: Partial<{ start: string; end: string; breakMin: number; off: boolean }>) => {
    if (!sel) return;
    const cur = selShift ?? { empId: sel.empId, day: sel.day, breakMin: 30 };
    setShift({
      empId: sel.empId, day: sel.day,
      start: cur.off ? "10:00" : cur.start,
      end: cur.off ? "15:00" : cur.end,
      breakMin: cur.breakMin,
      off: cur.off,
      ...p,
    });
  };

  return (
    <>
      {/* 툴바 */}
      <div className="spread" style={{ flexWrap: "wrap", gap: 10 }}>
        <div className="row">
          <button className="icon-btn" style={{ width: 32, height: 32 }}>‹</button>
          <span className="bold">
            {week[0].getFullYear()}년 {week[0].getMonth() + 1}월 {week[0].getDate()}일 ~ {week[6].getMonth() + 1}월 {week[6].getDate()}일
          </span>
          <button className="icon-btn" style={{ width: 32, height: 32 }}>›</button>
        </div>
        <div className="row">
          <button className="btn btn-outline btn-sm" onClick={() => showToast("지난주 근무표를 복사했습니다")}>
            📄 지난주 복사
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => showToast("반복 근무 패턴을 적용했습니다")}>
            🔁 반복 근무 적용
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => showToast("직원 추가 기능 (데모)")}>
            ＋ 직원 추가
          </button>
        </div>
      </div>

      <div className="grid grid-main-side">
        <div className="stack">
          {/* 주간 그리드 */}
          <Card>
            <div className="sched-wrap">
              <div className="sched-grid">
                <div className="head" />
                {week.map((d, i) => (
                  <div className="head" key={i}>{DOW_KO[i]}<br /><span style={{ fontWeight: 500 }}>{d.getMonth() + 1}/{d.getDate()}</span></div>
                ))}
                {EMPLOYEES.map((emp) => (
                  <FragmentRow
                    key={emp.id}
                    emp={emp}
                    hours={empHours(emp.id)}
                    shifts={shifts}
                    sel={sel}
                    onSel={(day) => setSel({ empId: emp.id, day })}
                  />
                ))}
              </div>
            </div>
          </Card>

          {/* 충돌/경고 */}
          <Card title="충돌 / 경고" icon="⚠️">
            {lunchShort.length === 0 && (
              <div className="alert-item info"><span>✅</span><div>이번 주 인원 배치에 문제가 없습니다</div></div>
            )}
            {lunchShort.map(({ day, n }) => (
              <div className="alert-item warn" key={day}>
                <span>👥</span>
                <div>
                  {DOW_KO[day]}요일 점심 시간대 인원 부족
                  <div className="desc">11–14시 배치 인원 {n}명 — 최소 2명 권장</div>
                </div>
              </div>
            ))}
            <div className="alert-item danger">
              <span>⏰</span>
              <div>
                김도현 — 주 {empHours(5)}시간 근무
                <div className="desc">주 40시간 초과 여부를 확인해주세요</div>
              </div>
            </div>
          </Card>

          {/* 직원 합계 */}
          <Card title="직원별 주간 합계" icon="📊">
            <div className="grid grid-3" style={{ gap: 10 }}>
              {EMPLOYEES.map((e) => (
                <div key={e.id} className="spread" style={{ background: "var(--card-alt)", borderRadius: 10, padding: "9px 13px" }}>
                  <span className="bold small">{e.name} <span className="muted">({e.role})</span></span>
                  <span className="bold num">{empHours(e.id)}h</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* 우측 편집 패널 */}
        <div className="side-panel">
          {sel && selEmp ? (
            <Card
              title={`${selEmp.name} · ${DOW_KO[sel.day]}요일`}
              action={<Badge tone="gray">{selEmp.role}</Badge>}
            >
              {selShift?.off ? (
                <div className="alert-item warn" style={{ marginBottom: 14 }}>
                  <span>🌙</span><div>휴무로 지정된 날입니다</div>
                </div>
              ) : (
                <div className="muted small" style={{ marginBottom: 14 }}>
                  현재: <b>{selShift?.start ?? "—"} ~ {selShift?.end ?? "—"}</b> · 휴게 {selShift?.breakMin ?? 0}분
                </div>
              )}

              <label className="field-label">근무 프리셋</label>
              <div className="chip-row" style={{ marginBottom: 16 }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className="chip"
                    style={{ fontSize: 12.5 }}
                    onClick={() => { patch({ ...p, off: false }); showToast(`${p.label} 프리셋 적용`); }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <label className="field-label">시작 시간</label>
              <select
                className="select" style={{ marginBottom: 12 }}
                value={selShift?.start ?? "10:00"}
                onChange={(e) => patch({ start: e.target.value, off: false })}
              >
                {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
              </select>

              <label className="field-label">종료 시간</label>
              <select
                className="select" style={{ marginBottom: 12 }}
                value={selShift?.end ?? "15:00"}
                onChange={(e) => patch({ end: e.target.value, off: false })}
              >
                {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
              </select>

              <label className="field-label">휴게시간</label>
              <ChipSelect
                options={[0, 30, 60, 90]}
                value={selShift?.breakMin ?? 30}
                onChange={(m) => patch({ breakMin: m })}
                format={(m) => (m === 0 ? "없음" : `${m}분`)}
              />

              <div className="row" style={{ marginTop: 18 }}>
                <button
                  className="btn btn-outline" style={{ flex: 1 }}
                  onClick={() => { patch({ off: !(selShift?.off ?? false) }); showToast(selShift?.off ? "근무로 변경" : "휴무로 변경"); }}
                >
                  {selShift?.off ? "근무로 변경" : "휴무 지정"}
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => showToast("근무표가 저장되었습니다")}>
                  ✓ 적용
                </button>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="muted" style={{ textAlign: "center", padding: "40px 0" }}>
                근무표에서 칸을 선택하면<br />여기서 바로 편집할 수 있습니다
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function FragmentRow({
  emp, hours, shifts, sel, onSel,
}: {
  emp: { id: number; name: string; role: string };
  hours: number;
  shifts: { empId: number; day: number; start?: string; end?: string; breakMin: number; off?: boolean }[];
  sel: { empId: number; day: number } | null;
  onSel: (day: number) => void;
}) {
  return (
    <>
      <div className="emp">
        {emp.name}
        <span className="hours">{emp.role} · {hours}h</span>
      </div>
      {Array.from({ length: 7 }, (_, day) => {
        const s = shifts.find((x) => x.empId === emp.id && x.day === day);
        const isSel = sel?.empId === emp.id && sel?.day === day;
        return (
          <button
            key={day}
            className={`sched-cell ${s?.off || !s ? "off" : ""} ${isSel ? "sel" : ""}`}
            onClick={() => onSel(day)}
          >
            {s && !s.off ? (
              <>
                {s.start}–{s.end}
                <span className="brk">휴게 {s.breakMin}분</span>
              </>
            ) : (
              "휴무"
            )}
          </button>
        );
      })}
    </>
  );
}
