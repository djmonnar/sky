import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Card, StatCard, Badge } from "../components/ui";
import { won } from "../data";
import type { Employee, PayrollRow } from "../data/types";
import { countSlots } from "../lib/shifts";
import { TODAY_STR } from "../lib/time";
import {
  basePay,
  employmentLabel,
  finalPay,
  isMonthlyEmployee,
  isSlotPaidEmployee,
  payBasisLabel,
  salaryTypeLabel,
  workHoursLabel,
} from "../lib/payroll";

const PAY_BADGE: Record<string, string> = {
  승인대기: "amber",
  검토중: "blue",
  승인완료: "green",
};

type PayFilter = "all" | "fullTime" | "partTime";

interface PayrollViewRow {
  emp: Employee;
  pay: PayrollRow;
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
    status: "승인대기",
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

export default function Payroll() {
  const {
    payroll, records, shifts, updatePayroll, approveRecord, showToast, employees,
    getPayrollPassword, setPayrollPassword,
  } = useStore();
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

  const totalPay = rows.reduce((a, { emp, pay }) => a + finalPay(pay, emp), 0);
  const totalExtra = rows.reduce((a, { pay }) => a + pay.extra, 0);
  const totalDeduct = rows.reduce((a, { pay }) => a + pay.deduct, 0);
  const monthlyCount = rows.filter(({ emp }) => isMonthlyEmployee(emp)).length;
  const slotPaidCount = rows.filter(({ emp }) => isSlotPaidEmployee(emp)).length;
  const partTimeCount = rows.length - monthlyCount;
  const totalSlots = rows.reduce((a, { pay }) => a + (pay.slotCount ?? 0), 0);
  const pendingRecords = records.filter(
    (r) => (r.status === "승인대기" || r.status === "제출") && r.date?.startsWith(selectedMonth)
  );

  const persistPayroll = (emp: Employee, pay: PayrollRow, patch: Partial<PayrollRow>) => {
    const next = { ...pay, ...patch };
    updatePayroll(emp.id, {
      ...next,
      base: basePay(next, emp),
    });
  };

  const approve = () => {
    if (!sel) return;
    persistPayroll(sel.emp, sel.pay, { status: "승인완료" });
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
      showToast("급여관리 잠금이 해제되었습니다");
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
    showToast("급여관리 비밀번호를 변경했습니다");
  };

  if (!unlocked) {
    return (
      <div className="payroll-lock-wrap">
        <Card title="급여관리 잠금" icon="🔒">
          <p className="muted small" style={{ marginTop: 0 }}>
            급여 정보는 비밀번호 확인 후 볼 수 있습니다. 초기 비밀번호는 0000입니다.
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
  }

  return (
    <>
      <div className="alert-item info hide-desktop">
        <span>🖥️</span>
        <div>
          급여 관리는 데스크톱 화면에 최적화되어 있어요
          <div className="desc">모바일에서는 표를 좌우로 스크롤할 수 있습니다</div>
        </div>
      </div>

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

      <Card title="급여관리 비밀번호 설정" icon="🔐">
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
        <StatCard label={`${selectedMonth} 총 급여 예상`} value={Math.round(totalPay / 10000).toLocaleString()} unit="만원" trend="월급+시급+건별수당" trendUp icon="💰" />
        <StatCard label="총 근무 슬롯" value={totalSlots} unit="개" trend="오전/오후 합산" trendUp icon="🗓️" tone="blue" />
        <StatCard label="정직원" value={monthlyCount} unit="명" trend="월급 고정" trendUp icon="🧑‍💼" tone="blue" />
        <StatCard label="알바/건별" value={`${partTimeCount}/${slotPaidCount}`} unit="명" trend="시급/건별수당" trendUp icon="👥" tone="amber" />
      </div>

      <div className="grid grid-main-side">
        <div className="stack">
          <Card
            title="직원별 급여"
            icon="💰"
            action={
              <button className="btn btn-outline btn-sm" onClick={() => showToast("급여 명세를 다운로드했습니다 (데모)")}>
                ⬇ 명세 다운로드
              </button>
            }
          >
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
                    <th>고용형태</th>
                    <th>직무</th>
                    <th>급여기준</th>
                    <th>오전 근무</th>
                    <th>오후 근무</th>
                    <th>총 슬롯</th>
                    <th>기본급</th>
                    <th>추가수당</th>
                    <th>차감</th>
                    <th>최종지급액</th>
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
                        {emp.roleLabel && <span className="muted small">({emp.roleLabel})</span>}
                      </td>
                      <td><Badge tone={isMonthlyEmployee(emp) ? "blue" : "amber"}>{employmentLabel(emp)}</Badge></td>
                      <td className="muted">{emp.role}</td>
                      <td className="num">{payBasisLabel(emp)}</td>
                      <td className="num">{pay.morningCount ?? 0}</td>
                      <td className="num">{pay.afternoonCount ?? 0}</td>
                      <td className="num bold">{pay.slotCount ?? 0}</td>
                      <td className="num">{basePay(pay, emp).toLocaleString()}</td>
                      <td className="num" style={{ color: "var(--green-700)" }}>+{pay.extra.toLocaleString()}</td>
                      <td className="num" style={{ color: pay.deduct ? "var(--red-tx)" : undefined }}>
                        {pay.deduct ? `-${pay.deduct.toLocaleString()}` : "-"}
                      </td>
                      <td className="num bold">{finalPay(pay, emp).toLocaleString()}</td>
                      <td><Badge tone={PAY_BADGE[pay.status]}>{pay.status}</Badge></td>
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

          <Card title="근무기록 승인 대기" icon="🗂️" action={<span className="muted small">{pendingRecords.length}건</span>}>
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
              action={<Badge tone={PAY_BADGE[sel.pay.status]}>{sel.pay.status}</Badge>}
            >
              <div className="muted small" style={{ marginBottom: 10 }}>
                {employmentLabel(sel.emp)} · {sel.emp.role} · {payBasisLabel(sel.emp)}
              </div>

              <div className="pay-line"><span className="k">급여 방식</span><span className="v">{salaryTypeLabel(sel.emp)}</span></div>
              <div className="pay-line"><span className="k">오전 근무</span><span className="v">{sel.pay.morningCount ?? 0}회</span></div>
              <div className="pay-line"><span className="k">오후 근무</span><span className="v">{sel.pay.afternoonCount ?? 0}회</span></div>
              <div className="pay-line"><span className="k">총 슬롯</span><span className="v">{sel.pay.slotCount ?? 0}회</span></div>

              {isMonthlyEmployee(sel.emp) ? (
                <div className="alert-item info" style={{ marginTop: 10 }}>
                  <span>🕘</span>
                  <div>
                    월급 고정 직원
                    <div className="desc">근무시간은 급여에 반영하지 않고 예외 수당/차감만 관리합니다</div>
                  </div>
                </div>
              ) : (
                <div className="pay-line"><span className="k">시간/건수 기준</span><span className="v">{workHoursLabel(sel.pay, sel.emp)}</span></div>
              )}

              <div className="pay-line" style={{ marginTop: 8 }}>
                <span className="k">{salaryTypeLabel(sel.emp)} 기준액</span>
                <span className="v">{basePay(sel.pay, sel.emp).toLocaleString()}원</span>
              </div>
              <div className="pay-line"><span className="k">추가수당</span><span className="v" style={{ color: "var(--green-700)" }}>+{sel.pay.extra.toLocaleString()}원</span></div>
              <div className="pay-line minus"><span className="k">차감</span><span className="v">{sel.pay.deduct ? `-${sel.pay.deduct.toLocaleString()}원` : "0원"}</span></div>
              <div className="pay-line total"><span className="k">최종 지급액</span><span className="v">{finalPay(sel.pay, sel.emp).toLocaleString()}원</span></div>

              <label className="field-label" style={{ marginTop: 16 }}>추가수당 입력</label>
              <div className="row">
                <input className="input" placeholder="금액 (원)" value={extraInput} onChange={(e) => setExtraInput(e.target.value)} inputMode="numeric" />
                <button className="btn btn-soft" onClick={addExtra}>추가</button>
              </div>

              <label className="field-label" style={{ marginTop: 12 }}>차감 입력</label>
              <div className="row">
                <input className="input" placeholder="금액 (원)" value={deductInput} onChange={(e) => setDeductInput(e.target.value)} inputMode="numeric" />
                <button className="btn btn-danger" onClick={addDeduct}>차감</button>
              </div>

              <label className="field-label" style={{ marginTop: 12 }}>메모</label>
              <textarea className="textarea" style={{ minHeight: 56 }} placeholder="수당/차감 사유 등" />

              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => { persistPayroll(sel.emp, sel.pay, { status: "검토중" }); showToast("수정사항이 반영되었습니다"); }}>
                  수정반영
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={sel.pay.status === "승인완료"} onClick={approve}>
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
}
