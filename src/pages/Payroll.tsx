import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Card, StatCard, Badge } from "../components/ui";
import { won } from "../data";
import type {
  Employee,
  ManagerPermissionKey,
  OwnerSchedule,
  OwnerScheduleCategory,
  PayrollAdjustment,
  PayrollAdjustmentType,
  PayrollRow,
} from "../data/types";
import { countSlots } from "../lib/shifts";
import { TODAY_STR } from "../lib/time";
import {
  basePay,
  finalPay,
  isMonthlyEmployee,
  isSlotPaidEmployee,
  socialInsuranceBreakdown,
  socialInsuranceDeduction,
} from "../lib/payroll";
import {
  DEFAULT_MANAGER_PERMISSIONS,
  MANAGER_PERMISSION_OPTIONS,
  normalizeManagerPermissions,
} from "../config/managerPermissions";

type AdminTab = "schedule" | "payroll" | "permissions";
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

function payrollAdjustments(pay: PayrollRow | undefined): PayrollAdjustment[] {
  if (!pay) return [];
  if (Array.isArray(pay.adjustments)) {
    return pay.adjustments.filter((item) => item.amount > 0);
  }

  const entries: PayrollAdjustment[] = [];
  if (pay.extra > 0) {
    entries.push({
      id: "legacy-extra",
      type: "extra",
      amount: pay.extra,
      memo: "기존 추가수당",
    });
  }
  if (pay.deduct > 0) {
    entries.push({
      id: "legacy-deduct",
      type: "deduct",
      amount: pay.deduct,
      memo: "기존 차감",
    });
  }
  return entries;
}

function adjustmentTotals(adjustments: PayrollAdjustment[]) {
  return adjustments.reduce(
    (sum, item) => {
      if (item.type === "extra") return { ...sum, extra: sum.extra + item.amount };
      return { ...sum, deduct: sum.deduct + item.amount };
    },
    { extra: 0, deduct: 0 }
  );
}

function hydratePayroll(emp: Employee, pay: PayrollRow | undefined, counts: ReturnType<typeof countSlots>): PayrollRow {
  const base = defaultPayroll(emp, counts);
  const adjustments = payrollAdjustments(pay);
  const totals = adjustmentTotals(adjustments);
  return {
    ...base,
    ...(pay ?? {}),
    adjustments,
    extra: totals.extra,
    deduct: totals.deduct,
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
    managerPermissions, updateManagerPermissions,
  } = useStore();

  const [activeTab, setActiveTab] = useState<AdminTab>("schedule");
  const [scheduleDate, setScheduleDate] = useState(TODAY_STR);
  const [scheduleForm, setScheduleForm] = useState<OwnerSchedule>(() => blankSchedule(TODAY_STR));

  const [filter, setFilter] = useState<PayFilter>("all");
  const [selId, setSelId] = useState<number | null>(null);
  const [adjustType, setAdjustType] = useState<PayrollAdjustmentType>("extra");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustMemo, setAdjustMemo] = useState("");
  const [payNoteInput, setPayNoteInput] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(TODAY_STR.slice(0, 7));
  const [unlocked, setUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [permissionDraft, setPermissionDraft] = useState(() => normalizeManagerPermissions(managerPermissions));

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

  useEffect(() => {
    setPayNoteInput(sel?.pay.note ?? "");
  }, [sel?.emp.id, sel?.pay.note]);

  useEffect(() => {
    setPermissionDraft(normalizeManagerPermissions(managerPermissions));
  }, [managerPermissions]);

  const daySchedules = ownerSchedules.filter((item) => item.date === scheduleDate);
  const monthScheduleCount = ownerSchedules.filter((item) => item.date.startsWith(scheduleDate.slice(0, 7))).length;
  const upcomingSchedules = ownerSchedules
    .filter((item) => item.date >= TODAY_STR && !item.done)
    .slice(0, 8);
  const importantCount = ownerSchedules.filter((item) => item.important && !item.done).length;

  const totalPay = rows.reduce((a, { emp, pay }) => a + finalPay(pay, emp), 0);
  const insuranceCount = rows.filter(({ emp }) => emp.socialInsurance).length;
  const totalInsuranceDeduct = rows.reduce((a, { emp, pay }) => a + socialInsuranceDeduction(pay, emp), 0);
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

  const persistAdjustments = (emp: Employee, pay: PayrollRow, adjustments: PayrollAdjustment[]) => {
    const totals = adjustmentTotals(adjustments);
    persistPayroll(emp, pay, {
      adjustments,
      extra: totals.extra,
      deduct: totals.deduct,
    });
  };

  const approve = () => {
    if (!sel) return;
    persistPayroll(sel.emp, sel.pay, { status: PAY_APPROVED });
    showToast(`${sel.emp.name} 급여가 확정되었습니다`);
  };

  const addAdjustment = () => {
    const amount = parseInt(adjustAmount.replace(/[^0-9]/g, ""), 10);
    if (!sel) return;
    if (!amount) {
      showToast("금액을 입력해주세요");
      return;
    }
    const next: PayrollAdjustment[] = [
      ...(sel.pay.adjustments ?? []),
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: adjustType,
        amount,
        memo: adjustMemo.trim(),
        createdAt: new Date().toISOString(),
      },
    ];
    persistAdjustments(sel.emp, sel.pay, next);
    setAdjustAmount("");
    setAdjustMemo("");
    showToast(`${adjustType === "extra" ? "추가수당" : "차감"} ${won(amount)} 반영`);
  };

  const removeAdjustment = (id: string) => {
    if (!sel) return;
    const next = (sel.pay.adjustments ?? []).filter((item) => item.id !== id);
    persistAdjustments(sel.emp, sel.pay, next);
    showToast("급여 조정 항목을 삭제했습니다");
  };

  const savePayrollNote = () => {
    if (!sel) return;
    persistPayroll(sel.emp, sel.pay, { note: payNoteInput.trim() });
    showToast("비고를 저장했습니다");
  };

  const renderInsuranceDeduction = (pay: PayrollRow, emp: Employee) => {
    if (!emp.socialInsurance) {
      return <div className="pay-line"><span className="k">4대보험</span><span className="v muted">미적용</span></div>;
    }
    const insurance = socialInsuranceBreakdown(pay, emp);
    return (
      <>
        <div className="pay-line insurance">
          <span className="k">4대보험 공제</span>
          <span className="v">-{insurance.total.toLocaleString()}원</span>
        </div>
        <div className="insurance-breakdown">
          <div className="pay-line"><span className="k">국민연금</span><span className="v">-{insurance.nationalPension.toLocaleString()}원</span></div>
          <div className="pay-line"><span className="k">건강보험</span><span className="v">-{insurance.healthInsurance.toLocaleString()}원</span></div>
          <div className="pay-line"><span className="k">장기요양</span><span className="v">-{insurance.longTermCare.toLocaleString()}원</span></div>
          <div className="pay-line"><span className="k">고용보험</span><span className="v">-{insurance.employmentInsurance.toLocaleString()}원</span></div>
        </div>
      </>
    );
  };

  const unlockPayroll = async () => {
    const savedPassword = await getPayrollPassword();
    if (passwordInput === savedPassword) {
      setUnlocked(true);
      setPasswordError(null);
      setPasswordInput("");
      showToast("관리자 모드 잠금을 해제했습니다");
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
    showToast("관리자 모드 비밀번호를 변경했습니다");
  };

  const toggleManagerPermission = (key: ManagerPermissionKey) => {
    const option = MANAGER_PERMISSION_OPTIONS.find((item) => item.key === key);
    if (option?.locked) return;
    setPermissionDraft((prev) => normalizeManagerPermissions({ ...prev, [key]: !prev[key] }));
  };

  const saveManagerPermissions = async () => {
    try {
      await updateManagerPermissions(permissionDraft);
    } catch (e) {
      console.error(e);
      showToast("매니저 권한 저장에 실패했습니다");
    }
  };

  const resetManagerPermissions = () => {
    setPermissionDraft(normalizeManagerPermissions(DEFAULT_MANAGER_PERMISSIONS));
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
      <Card title="관리자 모드 잠금" icon="🔐">
        <p className="muted small" style={{ marginTop: 0 }}>
          대표 일정표와 급여 관리는 비밀번호 확인 후 볼 수 있습니다.
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
          관리자 모드 열기
        </button>
      </Card>
    </div>
  );

  const renderPayrollPanel = () => {
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

        <Card title="관리자 모드 비밀번호 설정" icon="🔑">
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
              관리자 모드 잠그기
            </button>
          </div>
        </Card>

        <div className="grid grid-4">
          <StatCard label={`${selectedMonth} 총 급여 예상`} value={Math.round(totalPay / 10000).toLocaleString()} unit="만원" trend="월급+시급+칸수당" trendUp icon="💰" />
          <StatCard label="4대보험 공제 예상" value={Math.round(totalInsuranceDeduct / 10000).toLocaleString()} unit="만원" trend={`${insuranceCount}명 적용`} trendUp={insuranceCount === 0} icon="🧾" tone="red" />
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
                      <th>4대보험</th>
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
                        <td className="num" style={{ color: emp.socialInsurance ? "var(--amber-tx)" : undefined }}>
                          {emp.socialInsurance ? `-${socialInsuranceDeduction(pay, emp).toLocaleString()}` : "-"}
                        </td>
                        <td className="num bold">{finalPay(pay, emp).toLocaleString()}</td>
                        <td><Badge tone={statusTone(pay.status)}>{statusText(pay.status)}</Badge></td>
                      </tr>
                    ))}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={13} className="muted" style={{ textAlign: "center", padding: 24 }}>
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
                {renderInsuranceDeduction(sel.pay, sel.emp)}
                <div className="pay-line total"><span className="k">최종 지급액</span><span className="v">{finalPay(sel.pay, sel.emp).toLocaleString()}원</span></div>

                <div className="pay-adjust-box">
                  <label className="field-label">추가/차감 입력</label>
                  <div className="segmented fill pay-adjust-type">
                    <button className={adjustType === "extra" ? "on" : ""} onClick={() => setAdjustType("extra")}>
                      추가
                    </button>
                    <button className={adjustType === "deduct" ? "on danger" : ""} onClick={() => setAdjustType("deduct")}>
                      차감
                    </button>
                  </div>
                  <div className="pay-adjust-form">
                    <input
                      className="input"
                      placeholder="금액"
                      value={adjustAmount}
                      onChange={(e) => setAdjustAmount(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addAdjustment();
                      }}
                      inputMode="numeric"
                    />
                    <input
                      className="input"
                      placeholder="사유"
                      value={adjustMemo}
                      onChange={(e) => setAdjustMemo(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addAdjustment();
                      }}
                    />
                    <button className={adjustType === "extra" ? "btn btn-soft" : "btn btn-danger"} onClick={addAdjustment}>
                      추가
                    </button>
                  </div>

                  <div className="pay-adjust-list">
                    {(sel.pay.adjustments ?? []).length > 0 ? (
                      (sel.pay.adjustments ?? []).map((item) => (
                        <div className={`pay-adjust-item ${item.type}`} key={item.id}>
                          <div>
                            <strong>{item.type === "extra" ? "+" : "-"}{item.amount.toLocaleString()}원</strong>
                            <span>{item.memo || "사유 없음"}</span>
                          </div>
                          <button className="btn btn-outline btn-sm" onClick={() => removeAdjustment(item.id)}>
                            삭제
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="empty-state small">등록된 추가/차감 내역이 없습니다.</div>
                    )}
                  </div>
                </div>

                <label className="field-label" style={{ marginTop: 12 }}>비고</label>
                <textarea
                  className="textarea"
                  value={payNoteInput}
                  onChange={(e) => setPayNoteInput(e.target.value)}
                  placeholder="급여 정산 메모를 한 칸에 남겨주세요"
                />
                <button className="btn btn-outline btn-block" style={{ marginTop: 8 }} onClick={savePayrollNote}>
                  비고 저장
                </button>

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

  const renderPermissionsPanel = () => (
    <div className="stack">
      <Card title="매니저 권한 설정" icon="🛡️">
        <p className="muted small" style={{ marginTop: 0 }}>
          체크한 화면만 매니저 계정의 사이드바/모바일 플로팅 메뉴에 표시되고, 직접 주소로 들어가도 같은 기준으로 접근합니다.
        </p>
        <div className="manager-permission-grid">
          {MANAGER_PERMISSION_OPTIONS.map((option) => {
            const checked = permissionDraft[option.key];
            return (
              <label key={option.key} className={`manager-permission-card ${checked ? "on" : ""} ${option.locked ? "locked" : ""}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={option.locked}
                  onChange={() => toggleManagerPermission(option.key)}
                />
                <span className={`checkbox ${checked ? "checked" : ""}`}>{checked ? "✓" : ""}</span>
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            );
          })}
        </div>
        <div className="manager-permission-actions">
          <button className="btn btn-outline" onClick={resetManagerPermissions}>
            기본값으로
          </button>
          <button className="btn btn-primary" onClick={() => void saveManagerPermissions()}>
            권한 저장
          </button>
        </div>
      </Card>

      <Card title="현재 적용 중인 권한" icon="👀">
        <div className="chip-row">
          {MANAGER_PERMISSION_OPTIONS.filter((option) => managerPermissions[option.key]).map((option) => (
            <span className="chip on" key={option.key}>{option.label}</span>
          ))}
        </div>
      </Card>
    </div>
  );

  if (!unlocked) return renderPayrollLock();

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
          <button className={activeTab === "permissions" ? "on" : ""} onClick={() => setActiveTab("permissions")}>
            🛡️ 매니저 권한
          </button>
        </div>
        <button className="btn btn-outline" onClick={() => setUnlocked(false)}>
          🔒 잠그기
        </button>
      </div>
      {activeTab === "schedule"
        ? renderSchedulePanel()
        : activeTab === "permissions"
          ? renderPermissionsPanel()
          : renderPayrollPanel()}
    </div>
  );
}
