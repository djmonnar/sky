import { useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { Card, StatCard, StatusBadge, Badge } from "../components/ui";
import { TODAY_DOW, TODAY_STR } from "../data";
import { seedFirestore, resetFirestore } from "../dev/seedFirestore";
import { finalPay, isMonthlyEmployee } from "../lib/payroll";
import { planTimesForShifts, shiftsForDay, slotSummary } from "../lib/shifts";

export default function AdminDashboard() {
  const {
    reservations, shifts, records, payroll, employees, mode, loading, showToast,
  } = useStore();
  const [seeding, setSeeding] = useState(false);

  const runSeed = async () => {
    setSeeding(true);
    try {
      showToast(await seedFirestore());
    } catch (e) {
      showToast(`seed 실패: ${(e as Error).message}`);
    } finally {
      setSeeding(false);
    }
  };

  const runReset = async () => {
    if (!window.confirm("기존 근무표·직원·예약·급여 데이터를 모두 지우고 슬롯 모델 샘플 데이터로 다시 채웁니다.\n(로그인 계정은 유지됩니다)\n계속할까요?")) return;
    setSeeding(true);
    try {
      showToast(await resetFirestore());
    } catch (e) {
      showToast(`재설정 실패: ${(e as Error).message}`);
    } finally {
      setSeeding(false);
    }
  };

  const activeResv = reservations.filter((r) => r.status !== "취소" && r.status !== "노쇼");
  const todayShifts = shiftsForDay(shifts, TODAY_STR, TODAY_DOW);
  const todayWorkers = Array.from(new Set(todayShifts.map((s) => s.employeeId)))
    .map((employeeId) => ({
      employeeId,
      shifts: todayShifts.filter((s) => s.employeeId === employeeId),
    }));
  const pendingRecords = records.filter((r) => {
    if (!(r.status === "승인대기" || r.status === "제출")) return false;
    const emp = employees.find((e) => e.id === r.empId);
    return !emp || !isMonthlyEmployee(emp);
  });
  const totalPay = payroll.reduce((a, p) => {
    const emp = employees.find((e) => e.id === p.empId);
    return a + finalPay(p, emp);
  }, 0);
  const warnResv = reservations.filter((r) => r.status === "확인전화필요");
  const groupResv = reservations.filter((r) => r.status === "단체");

  return (
    <>
      <p className="greeting hide-desktop">정하늘 관리자님, 오늘도 파이팅! 💪</p>

      {/* 라이브 모드 + 빈 DB: 초기 seed 안내 */}
      {mode === "live" && !loading && employees.length === 0 && (
        <Card title="초기 데이터 설정" icon="🌱">
          <p className="muted small" style={{ margin: "0 0 12px" }}>
            Firestore에 아직 매장 데이터가 없습니다. 데모 데이터를 넣어 시작하거나,
            Firebase 콘솔에서 직접 직원/근무표를 등록할 수 있습니다.
          </p>
          <button className="btn btn-primary" disabled={seeding} onClick={runSeed}>
            {seeding ? "넣는 중..." : "🌱 데모 데이터로 시작하기"}
          </button>
        </Card>
      )}

      {/* 라이브 모드: 슬롯 모델 데이터 재설정 (관리자 도구) */}
      {mode === "live" && !loading && employees.length > 0 && (
        <details className="reset-tool">
          <summary>🛠️ 관리자 데이터 도구</summary>
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn btn-outline btn-sm" disabled={seeding} onClick={runReset}>
              {seeding ? "처리 중..." : "♻️ 슬롯 모델 샘플로 재설정"}
            </button>
            <span className="muted small">기존 근무표가 옛 형식이거나 비어 있을 때 사용</span>
          </div>
        </details>
      )}

      {/* KPI */}
      <div className="grid grid-4">
        <StatCard label="오늘 예약" value={activeResv.length} unit="건" trend="전일 대비 4건" trendUp icon="📋" />
        <StatCard label="오늘 근무 직원" value={todayWorkers.length} unit="명" trend="슬롯 배치 기준" trendUp icon="👥" tone="blue" />
        <StatCard label="미확인 근무기록" value={pendingRecords.length} unit="건" trend="승인 대기 중" trendUp={false} icon="🗂️" tone="amber" />
        <StatCard label="이번달 급여 예상" value={Math.round(totalPay / 10000).toLocaleString()} unit="만원" trend="전월 대비 8.2%" trendUp icon="💰" />
      </div>

      <div className="grid grid-main-side">
        <div className="stack">
          {/* 오늘 예약 현황 */}
          <Card
            title="오늘 예약 현황"
            icon="📋"
            action={<Link to="/reservations" className="card-link">전체 예약 보기 ›</Link>}
          >
            {activeResv.slice(0, 6).map((r) => (
              <div className="list-row" key={r.id}>
                <span className="list-time">{r.time}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="bold">{r.name} <span className="muted small">· {r.people}명 · {r.seat}</span></div>
                  {r.request && <div className="muted small">{r.request}</div>}
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </Card>

          {/* 직원 출근 현황 */}
          <Card title="직원 출근 현황" icon="👥" action={<Link to="/schedule-manage" className="card-link">근무표 ›</Link>}>
            <div className="grid grid-3" style={{ gap: 10 }}>
              {todayWorkers.map(({ employeeId, shifts: workerShifts }) => {
                const emp = employees.find((e) => e.id === employeeId);
                if (!emp) return null;
                const plan = planTimesForShifts(workerShifts);
                const started = plan.start <= "10:30";
                return (
                  <div key={employeeId} className="row" style={{
                    background: "var(--card-alt)", borderRadius: 11, padding: "10px 12px",
                  }}>
                    <span className="avatar">{emp.name[0]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="bold small">{emp.name}</div>
                      <div className="muted small">{slotSummary(workerShifts)} · {plan.start}–{plan.end}</div>
                    </div>
                    <Badge tone={started ? "green" : "gray"}>{started ? "근무중" : "출근전"}</Badge>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="stack side-panel">
          {/* 중요 알림 */}
          <Card title="예약·근무 중요 알림" icon="🔔">
            {groupResv.map((r) => (
              <div className="alert-item warn" key={r.id}>
                <span>👥</span>
                <div>
                  {r.time} 단체예약 {r.people}명 ({r.name})
                  <div className="desc">{r.seat} · 사전 세팅 필요</div>
                </div>
              </div>
            ))}
            {warnResv.map((r) => (
              <div className="alert-item danger" key={r.id}>
                <span>📞</span>
                <div>
                  {r.time} {r.name} 확인전화 필요
                  <div className="desc">{r.phone}</div>
                </div>
              </div>
            ))}
            <div className="alert-item info">
              <span>🗂️</span>
              <div>
                미승인 근무기록 {pendingRecords.length}건
                <div className="desc">급여 마감 전 승인이 필요합니다</div>
              </div>
            </div>
          </Card>

          {/* 빠른 작업 */}
          <Card title="빠른 작업" icon="⚡">
            <div className="quick-actions">
              <Link to="/reservations" className="quick-action"><span className="qa-ic">📞</span>예약 등록</Link>
              <Link to="/schedule-manage" className="quick-action"><span className="qa-ic">🗓️</span>근무표 작성</Link>
              <Link to="/payroll" className="quick-action"><span className="qa-ic">💰</span>급여 확인</Link>
              <Link to="/notices" className="quick-action"><span className="qa-ic">📢</span>공지 등록</Link>
            </div>
          </Card>

          {/* 승인 대기 */}
          <Card title="근무기록 승인 대기" icon="🗂️" action={<Link to="/payroll" className="card-link">급여 관리 ›</Link>}>
            {pendingRecords.slice(0, 4).map((r) => {
              const emp = employees.find((e) => e.id === r.empId);
              if (!emp) return null;
              return (
                <div className="list-row" key={r.id}>
                  <span className="avatar">{emp.name[0]}</span>
                  <div style={{ flex: 1 }}>
                    <div className="bold small">{emp.name} <span className="muted">· {r.date.slice(5).replace("-", "/")}</span></div>
                    <div className="muted small num">{r.actualStart}–{r.actualEnd}{r.note ? ` · ${r.note}` : ""}</div>
                  </div>
                  <Badge tone="amber">대기</Badge>
                </div>
              );
            })}
          </Card>
        </div>
      </div>
    </>
  );
}
