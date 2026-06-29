import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Card, StatCard, Badge } from "../components/ui";
import { won } from "../data";
import type { Employee, OwnerSchedule, OwnerScheduleCategory, PayrollRow } from "../data/types";
import { countSlots } from "../lib/shifts";
import { TODAY_STR } from "../lib/time";
import { basePay, finalPay, isMonthlyEmployee, isSlotPaidEmployee } from "../lib/payroll";

type AdminTab = "schedule" | "payroll";
type PayFilter = "all" | "fullTime" | "partTime";

interface PayrollViewRow {
  emp: Employee;
  pay: PayrollRow;
}

const PAY_PENDING = "승인대기" as PayrollRow["status"];
const PAY_REVIEW = "검토중" as PayrollRow["status"];
const PAY_APPROVED = "승인완료" as PayrollRow["status"];

const CATEGORY_LABEL: Record<OwnerScheduleCategory, string> = {
  personal: "개인",
  store: "매장",
  meeting: "미팅",
  finance: "정산",
  other: "기타",
};

const CATEGORY_TONE: Record<OwnerScheduleCategory, string> = {
  personal: "green",
  store: "blue",
  meeting: "amber",
  finance: "red",
  other: "gray",
};

function blankSchedule(date = TODAY_STR): OwnerSchedule {
  return {
    id: Date.now(),
    date,
    startTime: "10:00",
    endTime: "",
    title: "",
    category: "personal",
    location: "",
    memo: "",
    important: false,
    done: false,
  };
}

function defaultPayroll(emp: Employee, counts: ReturnType<typeof countSlots>): PayrollRow {
  const hours = emp.salaryType === "hourly" ? counts.slotCount * 5 : 0;
  return {
    empId: emp.id,
    morningCount: counts.morningCount,
    afternoonCount: counts.afternoonCount,
    slotCount: counts.slotCount,
    slotRate: emp.slotRate,
    manualAdjust: 0,
    payMode: emp.salaryType,
    hours,
    base: isMonthlyEmployee(emp)
      ? emp.monthlySalary ?? 0
      : isSlotPaidEmployee(emp)
        ? counts.slotCount * (emp.slotRate ?? 0)
        : hours * emp.hourly,
    extra: 0,
    deduct: 0,
    status: PAY_PENDING,
    normalH: hours,
    overH: 0,
    holidayH: 0,
    nightH: 0,
    editedRecords: 0,
  };
}

function hydratePayroll(emp: Employee, pay: PayrollRow | undefined, counts: ReturnType<typeof countSlots>): PayrollRow {
  const base = defaultPayroll(emp, counts);
  return {
    ...base,
    ...(pay ?? {}),
    morningCount: counts.morningCount,
    afternoonCount: counts.afternoonCount,
    slotCount: counts.slotCount,
    slotRate: pay?.slotRate ?? emp.slotRate,
    payMode: pay?.payMode ?? emp.salaryType,
    hours: emp.salaryType === "hourly" ? pay?.hours ?? counts.slotCount * 5 : 0,
  };
}

function employmentText(emp: Employee): string {
  return isMonthlyEmployee(emp) ? "정직원" : "아르바이트";
}

function salaryText(emp: Employee): string {
  if (isMonthlyEmployee(emp)) return `월급 ${(emp.monthlySalary ?? 0).toLocaleString()}원`;
  if (isSlotPaidEmployee(emp)) return `칸당 ${(emp.slotRate ?? 0).toLocaleString()}원`;
  return `시급 ${emp.hourly.toLocaleString()}원`;
}

function statusText(status: PayrollRow["status"]): string {
  const raw = String(status);
  if (raw.includes("완료")) return "승인완료";
  if (raw.includes("검")) return "검토중";
  return "승인대기";
}

function statusTone(status: PayrollRow["status"]): string {
  const label = statusText(status);
  if (label === "승인완료") return "green";
  if (label === "검토중") return "blue";
  return "amber";
}

function nextDate(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

export default function Payroll() {
  const {
    payroll, records, shifts, updatePayroll, approveRecord, showToast, employees,
    getPayrollPassword, setPayrollPassword, ownerSchedules, upsertOwnerSchedule, deleteOwnerSchedule,
  } = useStore();

  const [activeTab, setActiveTab] = useState<AdminTab>("schedule");
  const [scheduleDate, setScheduleDate] = useState(TODAY_STR);
  const [scheduleForm, setScheduleForm] = useState<OwnerSchedule>(() => blankSchedule(TODAY_STR));

  const [filter, setFilter] = useState<PayFilter>("all");
  const [selId, setSelId] = useState<number | null>(null);
  const [extraInput, setExtraInput] = useState("");
  const [deductInput, setDeductInput] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(TODAY_STR.slice(0, 7));
  const [unlocked, setUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const monthShifts = useMemo(
    () => shifts.filter((s) => s.date?.startsWith(selectedMonth)),
    [shifts, selectedMonth]
  );

  const rows = useMemo<PayrollViewRow[]>(() => {
    const byEmp = new Map(payroll.map((p) => [p.empId, p]));
    return employees.map((emp) => {
      const counts = countSlots(monthShifts, emp.id);
      return {
        emp,
        pay: hydratePayroll(emp, byEmp.get(emp.id), counts),
      };
    });
  }, [employees, payroll, monthShifts]);

  const filteredRows = rows.filter(({ emp }) => {
    if (filter === "fullTime") return isMonthlyEmployee(emp);
    if (filter === "partTime") return !isMonthlyEmployee(emp);
    return true;
  });

  const sel =
    filteredRows.find(({ emp }) => emp.id === selId)
    ?? rows.find(({ emp }) => emp.id === selId)
    ?? filteredRows[0]
    ?? rows[0]
    ?? null;

  const daySchedules = ownerSchedules.filter((item) => item.date === scheduleDate);
  const monthScheduleCount = ownerSchedules.filter((item) => item.date.startsWith(scheduleDate.slice(0, 7))).length;
  const upcomingSchedules = ownerSchedules
    .filter((item) => item.date >= TODAY_STR && !item.done)
    .slice(0, 8);
  const importantCount = ownerSchedules.filter((item) => item.important && !item.done).length;

  const totalPay = rows.reduce((a, { emp, pay }) => a + finalPay(pay, emp), 0);
  const monthlyCount = rows.filter(({ emp }) => isMonthlyEmployee(emp)).length;
  const partTimeCount = rows.length - monthlyCount;
  const totalSlots = rows.reduce((a, { pay }) => a + (pay.slotCount ?? 0), 0);
  const pendingRecords = records.filter(
    (r) => !String(r.status).includes("완료") && r.date?.startsWith(selectedMonth)
  );

  const updateScheduleField = <K extends keyof OwnerSchedule>(key: K, value: OwnerSchedule[K]) => {
    setScheduleForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetScheduleForm = (date = scheduleDate) => {
    setScheduleForm(blankSchedule(date));
  };

  const saveSchedule = () => {
    const title = scheduleForm.title.trim();
    if (!title) {
      showToast("일정 제목을 입력해주세요");
      return;
    }
    if (!scheduleForm.date || !scheduleForm.startTime) {
      showToast("날짜와 시작 시간을 확인해주세요");
      return;
    }
    upsertOwnerSchedule({ ...scheduleForm, title });
    setScheduleDate(scheduleForm.date);
    resetScheduleForm(scheduleForm.date);
    showToast("대표 일정을 저장했습니다");
  };

  const editSchedule = (item: OwnerSchedule) => {
    setScheduleDate(item.date);
    setScheduleForm({ ...item });
  };

  const toggleScheduleDone = (item: OwnerSchedule) => {
    upsertOwnerSchedule({ ...item, done: !item.done });
    showToast(!item.done ? "일정을 완료 처리했습니다" : "일정을 다시 진행 중으로 바꿨습니다");
  };

  const persistPayroll = (emp: Employee, pay: PayrollRow, patch: Partial<PayrollRow>) => {
    const next = { ...pay, ...patch };
    updatePayroll(emp.id, {
      ...next,
      base: basePay(next, emp),
    });
  };

  const approve = () => {
    if (!sel) return;
    persistPayroll(sel.emp, sel.pay, { status: PAY_APPROVED });
    showToast(`${sel.emp.name} 급여가 확정되었습니다`);
  };

  const addExtra = () => {
    const n = parseInt(extraInput.replace(/[^0-9]/g, ""), 10);
    if (!sel || !n) return;
    persistPayroll(sel.emp, sel.pay, { extra: sel.pay.extra + n });
    setExtraInput("");
    showToast(`추가수당 ${won(n)} 반영`);
  };

  const addDeduct = () => {
    const n = parseInt(deductInput.replace(/[^0-9]/g, ""), 10);
    if (!sel || !n) return;
    persistPayroll(sel.emp, sel.pay, { deduct: sel.pay.deduct + n });
    setDeductInput("");
    showToast(`차감 ${won(n)} 반영`);
  };

  const unlockPayroll = async () => {
    const savedPassword = await getPayrollPassword();
    if (passwordInput === savedPassword) {
      setUnlocked(true);
      setPasswordError(null);
      setPasswordInput("");
      showToast("급여 관리 잠금을 해제했습니다");
      return;
    }
    setPasswordError("비밀번호가 맞지 않습니다");
  };

  const changePassword = async () => {
    const next = newPassword.trim();
    if (next.length < 4) {
      showToast("비밀번호는 4자리 이상으로 입력해주세요");
      return;
    }
    await setPayrollPassword(next);
    setNewPassword("");
    showToast("급여 관리 비밀번호를 변경했습니다");
  };

  const renderScheduleItem = (item: OwnerSchedule) => (
    <div key={item.id} className={`owner-schedule-item ${item.done ? "done" : ""}`}>
      <button className="checkbox" onClick={() => toggleScheduleDone(item)} aria-label="완료">
        {item.done ? "✓" : ""}
      </button>
      <div className="owner-schedule-main">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <strong>{item.title}</strong>
          <Badge tone={CATEGORY_TONE[item.category]}>{CATEGORY_LABEL[item.category]}</Badge>
          {item.important && <Badge tone="red">중요</Badge>}
        </div>
        <div className="muted small">
          {item.date} · {item.startTime}{item.endTime ? `-${item.endTime}` : ""}
          {item.location ? ` · ${item.location}` : ""}
        </div>
        {item.memo && <div className="owner-schedule-memo">{item.memo}</div>}
      </div>
      <div className="owner-schedule-actions">
        <button className="btn btn-outline btn-sm" onClick={() => editSchedule(item)}>수정</button>
        <button
          className="btn btn-danger btn-sm"
          onClick={() => {
            if (window.confirm("이 일정을 삭제할까요?")) {
              deleteOwnerSchedule(item.id);
              if (scheduleForm.id === item.id) resetScheduleForm(item.date);
              showToast("일정을 삭제했습니다");
            }
          }}
        >
          삭제
        </button>
      </div>
    </div>
  );

  const renderSchedulePanel = () => (
    <div className="stack">
      <div className="grid grid-4">
        <StatCard label="오늘 대표 일정" value={ownerSchedules.filter((item) => item.date === TODAY_STR).length} unit="건" trend="오늘 기준" trendUp icon="🗓️" />
        <StatCard label="선택일 일정" value={daySchedules.length} unit="건" trend={scheduleDate} trendUp icon="📌" tone="blue" />
        <StatCard label="이번달 일정" value={monthScheduleCount} unit="건" trend={scheduleDate.slice(0, 7)} trendUp icon="📆" tone="amber" />
        <StatCard label="중요 미완료" value={importantCount} unit="건" trend="확인 필요" trendUp={importantCount === 0} icon="⭐" tone="red" />
      </div>

      <div className="admin-owner-grid">
        <Card title="대표 일정 등록" icon="✍️">
          <div className="owner-schedule-form">
            <label className="field-label">일정 제목</label>
            <input
              className="input"
              value={scheduleForm.title}
              onChange={(e) => updateScheduleField("title", e.target.value)}
              placeholder="예: 세무사 미팅, 거래처 방문, 개인 일정"
            />

            <div className="owner-schedule-form-grid">
              <div>
                <label className="field-label">날짜</label>
                <input
                  className="input"
                  type="date"
                  value={scheduleForm.date}
                  onChange={(e) => updateScheduleField("date", e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">시작</label>
                <input
                  className="input"
                  type="time"
                  value={scheduleForm.startTime}
                  onChange={(e) => updateScheduleField("startTime", e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">종료</label>
                <input
                  className="input"
                  type="time"
                  value={scheduleForm.endTime ?? ""}
                  onChange={(e) => updateScheduleField("endTime", e.target.value)}
                />
              </div>
            </div>

            <div className="owner-schedule-form-grid two">
              <div>
                <label className="field-label">구분</label>
                <select
                  className="select"
                  value={scheduleForm.category}
                  onChange={(e) => updateScheduleField("category", e.target.value as OwnerScheduleCategory)}
                >
                  {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">장소</label>
                <input
                  className="input"
                  value={scheduleForm.location ?? ""}
                  onChange={(e) => updateScheduleField("location", e.target.value)}
                  placeholder="장소 또는 업체명"
                />
              </div>
            </div>

            <label className="field-label">메모</label>
            <textarea
              className="textarea"
              value={scheduleForm.memo ?? ""}
              onChange={(e) => updateScheduleField("memo", e.target.value)}
              placeholder="준비물, 연락처, 처리할 일"
            />

            <div className="owner-schedule-options">
              <label className="check-item">
                <span className={`checkbox ${scheduleForm.important ? "checked" : ""}`}>{scheduleForm.important ? "✓" : ""}</span>
                <input
                  type="checkbox"
                  checked={scheduleForm.important ?? false}
                  onChange={(e) => updateScheduleField("important", e.target.checked)}
                />
                중요 일정
              </label>
              <label className="check-item">
                <span className={`checkbox ${scheduleForm.done ? "checked" : ""}`}>{scheduleForm.done ? "✓" : ""}</span>
                <input
                  type="checkbox"
                  checked={scheduleForm.done ?? false}
                  onChange={(e) => updateScheduleField("done", e.target.checked)}
                />
                완료 처리
              </label>
            </div>

            <div className="row" style={{ justifyContent: "flex-end", marginTop: 4 }}>
              <button className="btn btn-outline" onClick={() => resetScheduleForm()}>
                새로 입력
              </button>
              <button className="btn btn-primary" onClick={saveSchedule}>
                {ownerSchedules.some((item) => item.id === scheduleForm.id) ? "수정 저장" : "일정 등록"}
              </button>
            </div>
          </div>
        </Card>

        <div className="stack">
          <Card title="날짜별 일정" icon="🗓️">
            <div className="owner-date-control">
              <button className="btn btn-outline btn-sm" onClick={() => setScheduleDate(nextDate(scheduleDate, -1))}>‹</button>
              <input
                className="input"
                type="date"
                value={scheduleDate}
                onChange={(e) => {
                  setScheduleDate(e.target.value);
                  setScheduleForm((prev) => ({ ...prev, date: e.target.value }));
                }}
              />
              <button className="btn btn-outline btn-sm" onClick={() => setScheduleDate(nextDate(scheduleDate, 1))}>›</button>
            </div>
            <div className="owner-quick-row">
              <button className="chip" onClick={() => { setScheduleDate(TODAY_STR); setScheduleForm((prev) => ({ ...prev, date: TODAY_STR })); }}>오늘</button>
              <button className="chip" onClick={() => { const d = nextDate(TODAY_STR, 1); setScheduleDate(d); setScheduleForm((prev) => ({ ...prev, date: d })); }}>내일</button>
              <button className="chip" onClick={() => resetScheduleForm(scheduleDate)}>선택일에 등록</button>
            </div>
            <div className="owner-schedule-list">
              {daySchedules.length > 0 ? daySchedules.map(renderScheduleItem) : (
                <div className="empty-state">선택한 날짜에 등록된 대표 일정이 없습니다.</div>
              )}
            </div>
          </Card>

          <Card title="다가오는 일정" icon="🔔">
            <div className="owner-schedule-list compact">
              {upcomingSchedules.length > 0 ? upcomingSchedules.map(renderScheduleItem) : (
                <div className="empty-state">다가오는 미완료 일정이 없습니다.</div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );

  const renderPayrollLock = () => (
    <div className="payroll-lock-wrap">
      <Card title="급여 관리 잠금" icon="🔐">
        <p className="muted small" style={{ marginTop: 0 }}>
          급여 정보는 비밀번호 확인 후 볼 수 있습니다.
        </p>
        <label className="field-label">비밀번호</label>
        <input
          className="input"
          type="password"
          value={passwordInput}
          onChange={(e) => setPasswordInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void unlockPayroll();
          }}
          placeholder="비밀번호 입력"
        />
        {passwordError && (
          <div className="alert-item danger" style={{ marginTop: 12 }}>
            <span>!</span>
            <div>{passwordError}</div>
          </div>
        )}
        <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={() => void unlockPayroll()}>
          확인
        </button>
      </Card>
    </div>
  );

  const renderPayrollPanel = () => {
    if (!unlocked) return renderPayrollLock();
    return (
      <>
        <div className="row" style={{ marginBottom: 16, alignItems: "center", gap: 10 }}>
          <label className="field-label" style={{ margin: 0, whiteSpace: "nowrap" }}>급여 기준 월</label>
          <input
            type="month"
            className="input"
            style={{ width: "auto" }}
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          />
        </div>

        <Card title="급여 관리 비밀번호 설정" icon="🔑">
          <div className="row" style={{ alignItems: "stretch", flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ maxWidth: 260 }}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="새 비밀번호"
            />
            <button className="btn btn-outline" onClick={() => void changePassword()}>
              비밀번호 변경
            </button>
            <button className="btn btn-soft" onClick={() => setUnlocked(false)}>
              다시 잠그기
            </button>
          </div>
        </Card>

        <div className="grid grid-4">
          <StatCard label={`${selectedMonth} 총 급여 예상`} value={Math.round(totalPay / 10000).toLocaleString()} unit="만원" trend="월급+시급+칸수당" trendUp icon="💰" />
          <StatCard label="총 근무 칸" value={totalSlots} unit="칸" trend="오전/오후 합산" trendUp icon="📅" tone="blue" />
          <StatCard label="정직원" value={monthlyCount} unit="명" trend="월급 고정" trendUp icon="🧑‍💼" tone="blue" />
          <StatCard label="아르바이트" value={partTimeCount} unit="명" trend="시급/칸수당" trendUp icon="👥" tone="amber" />
        </div>

        <div className="grid grid-main-side">
          <div className="stack">
            <Card title="직원별 급여" icon="💰">
              <div className="chip-row" style={{ marginBottom: 14 }}>
                {[
                  ["all", "전체"],
                  ["fullTime", "정직원"],
                  ["partTime", "아르바이트"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={`chip ${filter === value ? "on" : ""}`}
                    onClick={() => setFilter(value as PayFilter)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="table-wrap">
                <table className="table payroll-table">
                  <thead>
                    <tr>
                      <th>직원</th>
                      <th>고용</th>
                      <th>역할</th>
                      <th>급여기준</th>
                      <th>오전</th>
                      <th>오후</th>
                      <th>칸</th>
                      <th>기본급</th>
                      <th>추가</th>
                      <th>차감</th>
                      <th>지급액</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map(({ emp, pay }) => (
                      <tr
                        key={emp.id}
                        className={sel?.emp.id === emp.id ? "sel" : ""}
                        onClick={() => setSelId(emp.id)}
                      >
                        <td className="bold">
                          {emp.name}
                          {emp.roleLabel && <span className="muted small"> ({emp.roleLabel})</span>}
                        </td>
                        <td><Badge tone={isMonthlyEmployee(emp) ? "blue" : "amber"}>{employmentText(emp)}</Badge></td>
                        <td className="muted">{emp.role}</td>
                        <td className="num">{salaryText(emp)}</td>
                        <td className="num">{pay.morningCount ?? 0}</td>
                        <td className="num">{pay.afternoonCount ?? 0}</td>
                        <td className="num bold">{pay.slotCount ?? 0}</td>
                        <td className="num">{basePay(pay, emp).toLocaleString()}</td>
                        <td className="num" style={{ color: "var(--green-700)" }}>+{pay.extra.toLocaleString()}</td>
                        <td className="num" style={{ color: pay.deduct ? "var(--red-tx)" : undefined }}>
                          {pay.deduct ? `-${pay.deduct.toLocaleString()}` : "-"}
                        </td>
                        <td className="num bold">{finalPay(pay, emp).toLocaleString()}</td>
                        <td><Badge tone={statusTone(pay.status)}>{statusText(pay.status)}</Badge></td>
                      </tr>
                    ))}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={12} className="muted" style={{ textAlign: "center", padding: 24 }}>
                          표시할 직원이 없습니다
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="근무기록 승인 대기" icon="📂" action={<span className="muted small">{pendingRecords.length}건</span>}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>날짜</th><th>직원</th><th>근무</th><th>실제</th><th>메모</th><th></th></tr>
                  </thead>
                  <tbody>
                    {pendingRecords.map((r) => {
                      const e = employees.find((x) => x.id === r.empId);
                      if (!e) return null;
                      return (
                        <tr key={r.id} style={{ cursor: "default" }}>
                          <td className="num">{r.date.slice(5).replace("-", "/")}</td>
                          <td className="bold">{e.name}</td>
                          <td className="muted">{r.slotSummary ?? `${r.planStart}-${r.planEnd}`}</td>
                          <td className="num bold">{r.actualStart ?? "-"}-{r.actualEnd ?? "-"}</td>
                          <td className="muted small">{r.note ?? "-"}</td>
                          <td>
                            <button className="btn btn-soft btn-sm" onClick={() => { approveRecord(r.id); showToast("근무기록을 승인했습니다"); }}>
                              승인
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {pendingRecords.length === 0 && (
                      <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>승인 대기 중인 근무기록이 없습니다</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="side-panel">
            {sel ? (
              <Card
                title={
                  <span className="row" style={{ gap: 8 }}>
                    <span className="avatar">{sel.emp.name[0]}</span>
                    {sel.emp.name}
                  </span>
                }
                action={<Badge tone={statusTone(sel.pay.status)}>{statusText(sel.pay.status)}</Badge>}
              >
                <div className="muted small" style={{ marginBottom: 10 }}>
                  {employmentText(sel.emp)} · {sel.emp.role} · {salaryText(sel.emp)}
                </div>
                <div className="pay-line"><span className="k">오전 근무</span><span className="v">{sel.pay.morningCount ?? 0}칸</span></div>
                <div className="pay-line"><span className="k">오후 근무</span><span className="v">{sel.pay.afternoonCount ?? 0}칸</span></div>
                <div className="pay-line"><span className="k">총 칸</span><span className="v">{sel.pay.slotCount ?? 0}칸</span></div>
                <div className="pay-line" style={{ marginTop: 8 }}>
                  <span className="k">기본급</span>
                  <span className="v">{basePay(sel.pay, sel.emp).toLocaleString()}원</span>
                </div>
                <div className="pay-line"><span className="k">추가수당</span><span className="v" style={{ color: "var(--green-700)" }}>+{sel.pay.extra.toLocaleString()}원</span></div>
                <div className="pay-line minus"><span className="k">차감</span><span className="v">{sel.pay.deduct ? `-${sel.pay.deduct.toLocaleString()}원` : "0원"}</span></div>
                <div className="pay-line total"><span className="k">최종 지급액</span><span className="v">{finalPay(sel.pay, sel.emp).toLocaleString()}원</span></div>

                <label className="field-label" style={{ marginTop: 16 }}>추가수당 입력</label>
                <div className="row">
                  <input className="input" placeholder="금액" value={extraInput} onChange={(e) => setExtraInput(e.target.value)} inputMode="numeric" />
                  <button className="btn btn-soft" onClick={addExtra}>추가</button>
                </div>

                <label className="field-label" style={{ marginTop: 12 }}>차감 입력</label>
                <div className="row">
                  <input className="input" placeholder="금액" value={deductInput} onChange={(e) => setDeductInput(e.target.value)} inputMode="numeric" />
                  <button className="btn btn-danger" onClick={addDeduct}>차감</button>
                </div>

                <div className="row" style={{ marginTop: 14 }}>
                  <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => { persistPayroll(sel.emp, sel.pay, { status: PAY_REVIEW }); showToast("검토중으로 변경했습니다"); }}>
                    검토중
                  </button>
                  <button className="btn btn-primary" style={{ flex: 1 }} disabled={statusText(sel.pay.status) === "승인완료"} onClick={approve}>
                    확정
                  </button>
                </div>
              </Card>
            ) : (
              <Card>
                <div className="muted" style={{ textAlign: "center", padding: "40px 0" }}>
                  직원을 선택하면 급여 상세가 표시됩니다
                </div>
              </Card>
            )}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="stack">
      <div className="admin-mode-head">
        <div>
          <h2>관리자 모드</h2>
          <p>대표 개인 일정과 급여 관리처럼 민감한 관리자 업무를 한곳에서 처리합니다.</p>
        </div>
        <div className="admin-mode-tabs" role="tablist" aria-label="관리자 모드">
          <button className={activeTab === "schedule" ? "on" : ""} onClick={() => setActiveTab("schedule")}>
            🗓️ 대표 일정표
          </button>
          <button className={activeTab === "payroll" ? "on" : ""} onClick={() => setActiveTab("payroll")}>
            💰 급여 관리
          </button>
        </div>
      </div>
      {activeTab === "schedule" ? renderSchedulePanel() : renderPayrollPanel()}
    </div>
  );
}
