import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Card, StatCard, Badge } from "../components/ui";
import { won } from "../data";
import type { Employee, PayrollRow } from "../data/types";
import {
  basePay,
  employmentLabel,
  finalPay,
  isMonthlyEmployee,
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

function defaultPayroll(emp: Employee): PayrollRow {
  return {
    empId: emp.id,
    hours: 0,
    base: isMonthlyEmployee(emp) ? emp.monthlySalary ?? 0 : 0,
    extra: 0,
    deduct: 0,
    status: "승인대기",
    normalH: 0,
    overH: 0,
    holidayH: 0,
    nightH: 0,
    editedRecords: 0,
  };
}

export default function Payroll() {
  const { payroll, records, updatePayroll, approveRecord, showToast, employees } = useStore();
  const [filter, setFilter] = useState<PayFilter>("all");
  const [selId, setSelId] = useState<number | null>(null);
  const [extraInput, setExtraInput] = useState("");
  const [deductInput, setDeductInput] = useState("");

  const rows = useMemo<PayrollViewRow[]>(() => {
    const byEmp = new Map(payroll.map((p) => [p.empId, p]));
    return employees.map((emp) => ({
      emp,
      pay: byEmp.get(emp.id) ?? defaultPayroll(emp),
    }));
  }, [employees, payroll]);

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
  const hourlyCount = rows.length - monthlyCount;
  const pendingRecords = records.filter((r) => {
    if (!(r.status === "승인대기" || r.status === "제출")) return false;
    const emp = employees.find((e) => e.id === r.empId);
    return !emp || !isMonthlyEmployee(emp);
  });

  const persistPayroll = (emp: Employee, pay: PayrollRow, patch: Partial<PayrollRow>) => {
    updatePayroll(emp.id, {
      ...pay,
      base: basePay(pay, emp),
      ...patch,
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

  return (
    <>
      <div className="alert-item info hide-desktop">
        <span>🖥️</span>
        <div>
          급여 관리는 데스크톱 화면에 최적화되어 있어요
          <div className="desc">모바일에서는 표를 좌우로 스크롤할 수 있습니다</div>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard label="이번달 총 급여 예상" value={Math.round(totalPay / 10000).toLocaleString()} unit="만원" trend="월급+시급 합산" trendUp icon="💰" />
        <StatCard label="정직원" value={monthlyCount} unit="명" trend="월급 고정" trendUp icon="🧑‍💼" tone="blue" />
        <StatCard label="아르바이트" value={hourlyCount} unit="명" trend="승인 근무시간 기준" trendUp icon="👥" tone="amber" />
        <StatCard label="차감/수당 합계" value={Math.round((totalExtra - totalDeduct) / 10000).toLocaleString()} unit="만원" icon="🧾" tone="green" />
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
              <table className="table">
                <thead>
                  <tr>
                    <th>직원</th>
                    <th>고용형태</th>
                    <th>직무</th>
                    <th>급여기준</th>
                    <th>근무시간</th>
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
                      <td className="bold">{emp.name}</td>
                      <td><Badge tone={isMonthlyEmployee(emp) ? "blue" : "amber"}>{employmentLabel(emp)}</Badge></td>
                      <td className="muted">{emp.role}</td>
                      <td className="num">{payBasisLabel(emp)}</td>
                      <td className="num">{workHoursLabel(pay, emp)}</td>
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
                      <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 24 }}>
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
                  <tr><th>날짜</th><th>직원</th><th>예정</th><th>실제</th><th>메모</th><th></th></tr>
                </thead>
                <tbody>
                  {pendingRecords.map((r) => {
                    const e = employees.find((x) => x.id === r.empId);
                    if (!e) return null;
                    return (
                      <tr key={r.id} style={{ cursor: "default" }}>
                        <td className="num">{r.date.slice(5).replace("-", "/")}</td>
                        <td className="bold">{e.name}</td>
                        <td className="muted num">{r.planStart}-{r.planEnd}</td>
                        <td className="num bold">{r.actualStart}-{r.actualEnd}</td>
                        <td className="muted small">{r.note ?? "-"}</td>
                        <td>
                          <button className="btn btn-soft btn-sm" onClick={() => { approveRecord(r.id); showToast("근무기록을 승인했습니다"); }}>
                            ✓ 승인
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

              {isMonthlyEmployee(sel.emp) ? (
                <>
                  <div className="alert-item info" style={{ marginBottom: 12 }}>
                    <span>🕘</span>
                    <div>
                      고정 근무 직원
                      <div className="desc">
                        근무시간은 급여에 반영하지 않고 예외 수당/차감만 관리합니다
                      </div>
                    </div>
                  </div>
                  <div className="pay-line"><span className="k">기준 근무</span><span className="v">{sel.emp.standardStart ?? "고정"}-{sel.emp.standardEnd ?? "고정"}</span></div>
                </>
              ) : (
                <>
                  <div className="pay-line"><span className="k">정상근무</span><span className="v">{sel.pay.normalH}시간</span></div>
                  <div className="pay-line"><span className="k">연장근무</span><span className="v">{sel.pay.overH}시간</span></div>
                  <div className="pay-line"><span className="k">휴일근무</span><span className="v">{sel.pay.holidayH}시간</span></div>
                  <div className="pay-line"><span className="k">야간근무</span><span className="v">{sel.pay.nightH}시간</span></div>
                  <div className="pay-line"><span className="k">수정된 근무기록</span><span className="v">{sel.pay.editedRecords}건</span></div>
                </>
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
                  ✓ 확정
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
