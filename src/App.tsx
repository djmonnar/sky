import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import { useStore } from "./store";
import Login from "./pages/Login";
import StaffDashboard from "./pages/StaffDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import Reservations from "./pages/Reservations";
import WorkLog from "./pages/WorkLog";
import SchedulePage from "./pages/SchedulePage";
import ScheduleManage from "./pages/ScheduleManage";
import Payroll from "./pages/Payroll";
import Notices from "./pages/Notices";

function Splash({ text }: { text: string }) {
  return (
    <div className="login-wrap">
      <div style={{ textAlign: "center" }}>
        <div className="brand-logo" style={{ width: 52, height: 52, fontSize: 26, margin: "0 auto" }}>🌿</div>
        <p className="muted" style={{ marginTop: 14 }}>{text}</p>
      </div>
    </div>
  );
}

export default function App() {
  const { mode, role, authLoading, authUser, error, profile } = useStore();

  // 라이브 모드: 인증 게이트
  if (mode === "live") {
    if (authLoading) return <Splash text="로그인 상태를 확인하는 중..." />;
    if (!authUser) return <Login />;
    if (!profile && error) {
      return (
        <div className="login-wrap">
          <div className="card login-card">
            <div className="alert-item danger"><span>⚠️</span><div>{error}</div></div>
            <p className="muted small" style={{ marginTop: 12 }}>
              Firebase 콘솔 → Firestore → <b>users</b> 컬렉션에서 이 계정의
              프로필 문서(name, role, storeId, employeeId, active)를 확인해주세요.
            </p>
          </div>
        </div>
      );
    }
    if (!profile) return <Splash text="사용자 정보를 불러오는 중..." />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={role === "admin" ? <AdminDashboard /> : <StaffDashboard />} />
        <Route path="/reservations" element={<Reservations />} />
        <Route path="/worklog" element={<WorkLog />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/schedule-manage" element={role === "admin" ? <ScheduleManage /> : <Navigate to="/schedule" replace />} />
        <Route path="/payroll" element={role === "admin" ? <Payroll /> : <Navigate to="/" replace />} />
        <Route path="/notices" element={<Notices />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
