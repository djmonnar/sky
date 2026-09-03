import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { Card, StatusBadge, Badge } from "../components/ui";
import { DOW_KO, dowIndex, fmtDate, minutes } from "../data";
import { seedFirestore, resetFirestore } from "../dev/seedFirestore";
import { isMonthlyEmployee } from "../lib/payroll";
import { latestSyncRun } from "../lib/sales";
import { planTimesForShifts, shiftsForDay, slotSummary } from "../lib/shifts";
import type { ManagerPermissionKey, WorkRecord } from "../data/types";

function nowHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

type AttendanceLabel = "출근전" | "근무중" | "기록필요" | "기록제출" | "퇴근완료";

function attendanceBadgeFor(workerRecords: WorkRecord[], plan: { start: string; end: string }, currentMinute: number): { label: AttendanceLabel; tone: string } {
  const activeRecords = workerRecords.filter((record) => record.status !== "미작성");
  const doneRecord = activeRecords.find((record) =>
    record.status === "승인완료" || record.status === "승인대기" || record.status === "제출"
  );
  if (doneRecord) {
    return doneRecord.actualEnd
      ? { label: "퇴근완료", tone: "green" }
      : { label: "기록제출", tone: "amber" };
  }

  const start = minutes(plan.start);
  const end = minutes(plan.end);
  if (currentMinute < start) return { label: "출근전", tone: "gray" };
  if (currentMinute <= end) return { label: "근무중", tone: "green" };
  return { label: "기록필요", tone: "amber" };
}

/** "2026-09-03" → "9/3 (수)" */
function shortDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return `${m}/${d} (${DOW_KO[dow]})`;
}

function won(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function syncedAt(iso?: string): string {
  return iso ? iso.slice(5, 16).replace("T", " ") : "아직 없음";
}

function greetingFor(hour: number): string {
  if (hour < 11) return "좋은 아침이에요";
  if (hour < 17) return "좋은 오후예요";
  return "오늘도 수고 많으셨어요";
}

/** 눌러서 들어갈 수 있으면 링크, 아니면 그냥 타일 */
function KpiTile({ to, tone, label, value, unit, sub }: {
  to?: string; tone?: string; label: string; value: ReactNode; unit?: string; sub: string;
}) {
  const body = (
    <>
      <span className="dash-kpi-label">{label}</span>
      <strong>{value}{unit && <em>{unit}</em>}</strong>
      <small>{sub}</small>
    </>
  );
  const className = `dash-kpi ${tone ?? ""}`;
  return to ? <Link to={to} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

export default function AdminDashboard() {
  const {
    reservations, shifts, records, employees, salesDailySummaries, salesSyncRuns, granterSyncRuns,
    mode, loading, showToast, role, managerPermissions, profile,
  } = useStore();
  const [seeding, setSeeding] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const isAdmin = role === "admin";
  const canAccess = (key: ManagerPermissionKey) => isAdmin || (role === "manager" && managerPermissions[key]);
  const todayStr = useMemo(() => fmtDate(now), [now]);
  const todayDow = useMemo(() => dowIndex(now), [now]);
  const currentMinute = useMemo(() => minutes(nowHHMM(now)), [now]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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

  /* ---- 오늘 ---- */
  const todayReservations = reservations.filter((r) => r.date === todayStr);
  const activeResv = todayReservations
    .filter((r) => r.status !== "취소" && r.status !== "노쇼")
    .sort((a, b) => a.time.localeCompare(b.time));
  const guestCount = activeResv.reduce((sum, r) => sum + (Number(r.people) || 0), 0);
  const warnResv = todayReservations.filter((r) => r.status === "확인전화필요");
  const groupResv = todayReservations.filter((r) => r.status === "단체");

  const todayShifts = shiftsForDay(shifts, todayStr, todayDow);
  const todayWorkers = Array.from(new Set(todayShifts.map((s) => s.employeeId)))
    .map((employeeId) => {
      const workerShifts = todayShifts.filter((s) => s.employeeId === employeeId);
      const emp = employees.find((e) => e.id === employeeId);
      const plan = planTimesForShifts(workerShifts);
      return {
        employeeId,
        name: emp?.name ?? workerShifts[0]?.employeeName ?? "직접 입력",
        meta: `${slotSummary(workerShifts)}${emp ? "" : " · 직접 입력"} · ${plan.start}–${plan.end}`,
        attendance: attendanceBadgeFor(
          records.filter((record) => record.empId === employeeId && record.date === todayStr),
          plan,
          currentMinute,
        ),
      };
    });
  // 손이 가야 하는 사람(기록필요)부터, 그다음 근무중 → 출근전 → 제출 → 퇴근 순
  const ATTENDANCE_ORDER: AttendanceLabel[] = ["기록필요", "근무중", "출근전", "기록제출", "퇴근완료"];
  todayWorkers.sort((a, b) => ATTENDANCE_ORDER.indexOf(a.attendance.label) - ATTENDANCE_ORDER.indexOf(b.attendance.label));
  const attendanceCounts = todayWorkers.reduce<Record<AttendanceLabel, number>>((acc, worker) => {
    acc[worker.attendance.label] += 1;
    return acc;
  }, { 출근전: 0, 근무중: 0, 기록필요: 0, 기록제출: 0, 퇴근완료: 0 });

  const pendingRecords = records.filter((r) => {
    if (!(r.status === "승인대기" || r.status === "제출")) return false;
    const emp = employees.find((e) => e.id === r.empId);
    return !emp || !isMonthlyEmployee(emp);
  });

  /* ---- POS 매출: 네이버 플레이스플러스 일 합계. 오늘 것은 내일 새벽에 오므로 "가장 최근 날"을 보여준다 ---- */
  const posLatest = useMemo(
    () => [...salesDailySummaries]
      .filter((row) => row.businessDate <= todayStr)
      .sort((a, b) => b.businessDate.localeCompare(a.businessDate))[0] ?? null,
    [salesDailySummaries, todayStr],
  );
  const monthKey = todayStr.slice(0, 7);
  const posMonthRows = salesDailySummaries.filter((row) => row.businessDate.startsWith(monthKey));
  const posMonthTotal = posMonthRows.reduce((sum, row) => sum + row.netAmount, 0);
  const latestSalesSync = latestSyncRun(salesSyncRuns);
  const latestGranterSync = granterSyncRuns[0];

  const userName = mode === "live"
    ? (profile?.name ?? "관리자")
    : (role === "admin" ? "김지현" : "매니저");
  const todoCount = pendingRecords.length + warnResv.length;

  return (
    <>
      {/* ── 오늘 ── */}
      <div className="dash-head">
        <div>
          <div className="dash-date">{now.getMonth() + 1}월 {now.getDate()}일 {DOW_KO[todayDow]}요일</div>
          <div className="dash-greet">{greetingFor(now.getHours())}, {userName}님</div>
        </div>
      </div>

      {/* 라이브 모드 + 빈 DB: 초기 seed 안내 */}
      {isAdmin && mode === "live" && !loading && employees.length === 0 && (
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

      {/* ── 핵심 숫자 ── */}
      <div className="dash-kpis">
        <KpiTile
          to={canAccess("reservations") ? "/reservations" : undefined}
          label="오늘 예약"
          value={activeResv.length}
          unit="건"
          sub={activeResv.length ? `${guestCount}명${groupResv.length ? ` · 단체 ${groupResv.length}건` : ""}` : "예약 없음"}
        />
        <KpiTile
          to={canAccess("scheduleManage") ? "/schedule-manage" : undefined}
          label="오늘 근무"
          value={todayWorkers.length}
          unit="명"
          sub={todayWorkers.length
            ? `근무중 ${attendanceCounts.근무중} · 출근전 ${attendanceCounts.출근전}`
            : "배치 없음"}
        />
        {canAccess("sales") && (
          <KpiTile
            to="/finance"
            label={posLatest ? `POS 매출 · ${shortDate(posLatest.businessDate)}` : "POS 매출"}
            value={posLatest ? Math.round(posLatest.netAmount).toLocaleString("ko-KR") : "—"}
            unit={posLatest ? "원" : undefined}
            sub={!posLatest
              ? "아직 받은 매출 없음"
              : posMonthRows.length
                ? `이번 달 ${won(posMonthTotal)} · ${posMonthRows.length}일치`
                : "이번 달 아직 없음"}
          />
        )}
        <KpiTile
          to={isAdmin ? "/payroll" : undefined}
          tone={todoCount > 0 ? "warn" : ""}
          label="확인할 일"
          value={todoCount}
          unit="건"
          sub={todoCount
            ? [pendingRecords.length ? `근무기록 ${pendingRecords.length}` : "", warnResv.length ? `확인전화 ${warnResv.length}` : ""].filter(Boolean).join(" · ")
            : "밀린 일 없음"}
        />
      </div>

      {/* ── 알림: 있을 때만 ── */}
      {(groupResv.length > 0 || warnResv.length > 0) && (
        <div className="dash-alerts">
          {groupResv.map((r) => (
            <Link to="/reservations" className="dash-alert warn" key={r.id}>
              <span>👥</span>
              <span>{r.time} 단체 {r.people}명 · {r.name}<span className="desc"> · {r.seat || "좌석 미정"} · 사전 세팅</span></span>
            </Link>
          ))}
          {warnResv.map((r) => (
            <Link to="/reservations" className="dash-alert danger" key={r.id}>
              <span>📞</span>
              <span>{r.time} {r.name} 확인전화 필요<span className="desc"> · {r.phone || "연락처 없음"}</span></span>
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-main-side">
        <div className="stack">
          {/* 오늘 예약 */}
          <Card
            title="오늘 예약"
            icon="📋"
            action={canAccess("reservations") ? <Link to="/reservations" className="card-link">전체 보기 ›</Link> : undefined}
          >
            {activeResv.length > 0 ? (
              activeResv.slice(0, 8).map((r) => (
                <div className="list-row" key={r.id}>
                  <span className="list-time">{r.time}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bold dash-ellipsis">{r.name} <span className="muted small">· {r.people}명{r.seat ? ` · ${r.seat}` : ""}</span></div>
                    {r.request && <div className="muted small dash-ellipsis">{r.request}</div>}
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))
            ) : (
              <div className="empty-state">오늘 예약이 없습니다.</div>
            )}
            {activeResv.length > 8 && <div className="muted small" style={{ marginTop: 8 }}>외 {activeResv.length - 8}건</div>}
          </Card>

          {/* 직원 출근 현황 */}
          <Card title="직원 출근 현황" icon="👥" action={canAccess("scheduleManage") ? <Link to="/schedule-manage" className="card-link">근무표 ›</Link> : undefined}>
            {todayWorkers.length > 0 ? (
              <>
                <div className="attend-summary">
                  {attendanceCounts.근무중 > 0 && <span className="attend-chip on">근무중<b>{attendanceCounts.근무중}</b></span>}
                  {attendanceCounts.출근전 > 0 && <span className="attend-chip">출근전<b>{attendanceCounts.출근전}</b></span>}
                  {attendanceCounts.기록필요 > 0 && <span className="attend-chip need">기록필요<b>{attendanceCounts.기록필요}</b></span>}
                  {attendanceCounts.기록제출 > 0 && <span className="attend-chip need">기록제출<b>{attendanceCounts.기록제출}</b></span>}
                  {attendanceCounts.퇴근완료 > 0 && <span className="attend-chip">퇴근완료<b>{attendanceCounts.퇴근완료}</b></span>}
                </div>
                <div className="attend-list">
                  {todayWorkers.map((worker) => (
                    <div key={worker.employeeId} className="attend-row">
                      <span className="avatar">{worker.name[0]}</span>
                      <div className="attend-body">
                        <div className="attend-name">{worker.name}</div>
                        <div className="attend-meta">{worker.meta}</div>
                      </div>
                      <Badge tone={worker.attendance.tone}>{worker.attendance.label}</Badge>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">오늘 배치된 근무가 없습니다.</div>
            )}
          </Card>
        </div>

        <div className="stack side-panel">
          {/* 근무기록 승인 대기: 있을 때만 */}
          {pendingRecords.length > 0 && (
            <Card title="근무기록 승인 대기" icon="🗂️" action={isAdmin ? <Link to="/payroll" className="card-link">승인하러 가기 ›</Link> : undefined}>
              {pendingRecords.slice(0, 4).map((r) => {
                const emp = employees.find((e) => e.id === r.empId);
                if (!emp) return null;
                return (
                  <div className="list-row" key={r.id}>
                    <span className="avatar">{emp.name[0]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="bold small">{emp.name} <span className="muted">· {r.date.slice(5).replace("-", "/")}</span></div>
                      <div className="muted small num dash-ellipsis">{r.actualStart}–{r.actualEnd}{r.note ? ` · ${r.note}` : ""}</div>
                    </div>
                    <Badge tone="amber">대기</Badge>
                  </div>
                );
              })}
              {pendingRecords.length > 4 && <div className="muted small" style={{ marginTop: 8 }}>외 {pendingRecords.length - 4}건</div>}
            </Card>
          )}

          {/* 데이터 연결 상태: 작게 */}
          {canAccess("sales") && (
            <Card title="데이터 연결" icon="🔄" action={<Link to="/finance" className="card-link">매출·매입 ›</Link>}>
              <div className="dash-sync">
                <span>POS 매출 <b>{syncedAt(latestSalesSync?.finishedAt || latestSalesSync?.startedAt)}</b>{latestSalesSync?.status && latestSalesSync.status !== "success" ? <Badge tone="amber">{latestSalesSync.status}</Badge> : null}</span>
                <span>카드·계좌 <b>{syncedAt(latestGranterSync?.finishedAt || latestGranterSync?.startedAt)}</b></span>
              </div>
            </Card>
          )}

          {/* 관리자 데이터 도구 (라이브) */}
          {isAdmin && mode === "live" && !loading && employees.length > 0 && (
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
        </div>
      </div>
    </>
  );
}
