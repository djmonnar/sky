import { Link } from "react-router-dom";
import { useStore } from "../store";
import { Card, StatCard, StatusBadge, Badge } from "../components/ui";
import { EMPLOYEES, TODAY_DOW } from "../data";

export default function AdminDashboard() {
  const { reservations, shifts, records, payroll } = useStore();

  const activeResv = reservations.filter((r) => r.status !== "취소" && r.status !== "노쇼");
  const todayWorkers = shifts.filter((s) => s.day === TODAY_DOW && !s.off);
  const pendingRecords = records.filter((r) => r.status === "승인대기" || r.status === "제출");
  const totalPay = payroll.reduce((a, p) => a + p.base + p.extra - p.deduct, 0);
  const warnResv = reservations.filter((r) => r.status === "확인전화필요");
  const groupResv = reservations.filter((r) => r.status === "단체");

  return (
    <>
      <p className="greeting hide-desktop">정하늘 관리자님, 오늘도 파이팅! 💪</p>

      {/* KPI */}
      <div className="grid grid-4">
        <StatCard label="오늘 예약" value={activeResv.length} unit="건" trend="전일 대비 4건" trendUp icon="📋" />
        <StatCard label="오늘 근무 직원" value={todayWorkers.length} unit="명" trend="근무표 기준" trendUp icon="👥" tone="blue" />
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
              {todayWorkers.map((s) => {
                const emp = EMPLOYEES.find((e) => e.id === s.empId)!;
                const started = s.start! <= "10:30";
                return (
                  <div key={s.empId} className="row" style={{
                    background: "var(--card-alt)", borderRadius: 11, padding: "10px 12px",
                  }}>
                    <span className="avatar">{emp.name[0]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="bold small">{emp.name}</div>
                      <div className="muted small num">{s.start}–{s.end}</div>
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
              const emp = EMPLOYEES.find((e) => e.id === r.empId)!;
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
