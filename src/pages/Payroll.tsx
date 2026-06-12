import { useState } from "react";
import { useStore } from "../store";
import { Card, StatCard, Badge } from "../components/ui";
import { EMPLOYEES, won } from "../data";

const PAY_BADGE: Record<string, string> = {
  승인대기: "amber", 검토중: "blue", 승인완료: "green",
};

export default function Payroll() {
  const { payroll, records, updatePayroll, approveRecord, showToast } = useStore();
  const [selId, setSelId] = useState<number | null>(payroll[0]?.empId ?? null);
  const [extraInput, setExtraInput] = useState("");
  const [deductInput, setDeductInput] = useState("");

  const sel = payroll.find((p) => p.empId === selId) ?? null;
  const selEmp = sel ? EMPLOYEES.find((e) => e.id === sel.empId)! : null;

  const totalPay = payroll.reduce((a, p) => a + p.base + p.extra - p.deduct, 0);
  const totalExtra = payroll.reduce((a, p) => a + p.extra, 0);
  const totalDeduct = payroll.reduce((a, p) => a + p.deduct, 0);
  const pendingRecords = records.filter((r) => r.status === "승인대기" || r.status === "제출");

  const final = (p: { base: number; extra: number; deduct: number }) =>
    p.base + p.extra - p.deduct;

  const approve = () => {
    if (!sel) return;
    updatePayroll(sel.empId, { status: "승인완료" });
    showToast(`${selEmp!.name} 급여가 확정되었습니다`);
  };

  const addExtra = () => {
    const n = parseInt(extraInput.replace(/[^0-9]/g, ""), 10);
    if (!sel || !n) return;
    updatePayroll(sel.empId, { extra: sel.extra + n });
    setExtraInput("");
    showToast(`추가수당 ${won(n)} 반영`);
  };
  const addDeduct = () => {
    const n = parseInt(deductInput.replace(/[^0-9]/g, ""), 10);
    if (!sel || !n) return;
    updatePayroll(sel.empId, { deduct: sel.deduct + n });
    setDeductInput("");
    showToast(`차감 ${won(n)} 반영`);
  };

  return (
    <>
      {/* KPI */}
      <div className="grid grid-4">
        <StatCard label="이번달 총 급여 예상" value={Math.round(totalPay / 10000).toLocaleString()} unit="만원" trend="전월 대비 8.2%" trendUp icon="💰" />
        <StatCard label="승인대기 근무기록" value={pendingRecords.length} unit="건" trend="급여 마감 전 승인 필요" trendUp={false} icon="🗂️" tone="amber" />
        <StatCard label="추가수당 합계" value={Math.round(totalExtra / 10000).toLocaleString()} unit="만원" icon="➕" tone="blue" />
        <StatCard label="차감 합계" value={Math.round(totalDeduct / 10000).toLocaleString()} unit="만원" icon="➖" tone="red" />
      </div>

      <div className="grid grid-main-side">
        <div className="stack">
          {/* 직원별 급여표 */}
          <Card title="직원별 급여" icon="💰" action={
            <button className="btn btn-outline btn-sm" onClick={() => showToast("급여 명세를 다운로드했습니다 (데모)")}>
              ⬇ 명세 다운로드
            </button>
          }>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>직원</th><th>역할</th><th>근무시간</th><th>기본급</th>
                    <th>추가수당</th><th>차감</th><th>최종지급액</th><th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {payroll.map((p) => {
                    const e = EMPLOYEES.find((x) => x.id === p.empId)!;
                    return (
                      <tr key={p.empId} className={selId === p.empId ? "sel" : ""} onClick={() => setSelId(p.empId)}>
                        <td className="bold">{e.name}</td>
                        <td className="muted">{e.role}</td>
                        <td className="num">{p.hours}시간</td>
                        <td className="num">{p.base.toLocaleString()}</td>
                        <td className="num" style={{ color: "var(--green-700)" }}>+{p.extra.toLocaleString()}</td>
                        <td className="num" style={{ color: p.deduct ? "var(--red-tx)" : undefined }}>
                          {p.deduct ? `−${p.deduct.toLocaleString()}` : "—"}
                        </td>
                        <td className="num bold">{final(p).toLocaleString()}</td>
                        <td><Badge tone={PAY_BADGE[p.status]}>{p.status}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* 승인 대기 근무기록 */}
          <Card title="근무기록 승인 대기" icon="🗂️" action={
            <span className="muted small">{pendingRecords.length}건</span>
          }>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>날짜</th><th>직원</th><th>예정</th><th>실제</th><th>메모</th><th></th></tr>
                </thead>
                <tbody>
                  {pendingRecords.map((r) => {
                    const e = EMPLOYEES.find((x) => x.id === r.empId)!;
                    return (
                      <tr key={r.id} style={{ cursor: "default" }}>
                        <td className="num">{r.date.slice(5).replace("-", "/")}</td>
                        <td className="bold">{e.name}</td>
                        <td className="muted num">{r.planStart}–{r.planEnd}</td>
                        <td className="num bold">{r.actualStart}–{r.actualEnd}</td>
                        <td className="muted small">{r.note ?? "—"}</td>
                        <td>
                          <button className="btn btn-soft btn-sm" onClick={() => { approveRecord(r.id); showToast("근무기록을 승인했습니다"); }}>
                            ✓ 승인
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {pendingRecords.length === 0 && (
                    <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>승인 대기 중인 근무기록이 없습니다 🎉</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* 우측 상세 패널 */}
        <div className="side-panel">
          {sel && selEmp ? (
            <Card
              title={
                <span className="row" style={{ gap: 8 }}>
                  <span className="avatar">{selEmp.name[0]}</span>
                  {selEmp.name}
                </span>
              }
              action={<Badge tone={PAY_BADGE[sel.status]}>{sel.status}</Badge>}
            >
              <div className="muted small" style={{ marginBottom: 10 }}>
                {selEmp.role} · 시급 {selEmp.hourly.toLocaleString()}원
              </div>

              <div className="pay-line"><span className="k">정상근무</span><span className="v">{sel.normalH}시간</span></div>
              <div className="pay-line"><span className="k">연장근무</span><span className="v">{sel.overH}시간</span></div>
              <div className="pay-line"><span className="k">휴일근무</span><span className="v">{sel.holidayH}시간</span></div>
              <div className="pay-line"><span className="k">야간근무</span><span className="v">{sel.nightH}시간</span></div>
              <div className="pay-line"><span className="k">수정된 근무기록</span><span className="v">{sel.editedRecords}건</span></div>

              <div className="pay-line" style={{ marginTop: 8 }}><span className="k">기본급</span><span className="v">{sel.base.toLocaleString()}원</span></div>
              <div className="pay-line"><span className="k">추가수당</span><span className="v" style={{ color: "var(--green-700)" }}>+{sel.extra.toLocaleString()}원</span></div>
              <div className="pay-line minus"><span className="k">차감</span><span className="v">−{sel.deduct.toLocaleString()}원</span></div>
              <div className="pay-line total"><span className="k">최종 지급액</span><span className="v">{final(sel).toLocaleString()}원</span></div>

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
                <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => { updatePayroll(sel.empId, { status: "검토중" }); showToast("수정사항이 반영되었습니다"); }}>
                  수정반영
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={sel.status === "승인완료"} onClick={approve}>
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
