import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import { useStore } from "./store";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import CompleteProfile from "./pages/CompleteProfile";
import StaffDashboard from "./pages/StaffDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import Reservations from "./pages/Reservations";
import WorkLog from "./pages/WorkLog";
import SchedulePage from "./pages/SchedulePage";
import ScheduleManage from "./pages/ScheduleManage";
import Payroll from "./pages/Payroll";
import Notices from "./pages/Notices";
import EmployeeList from "./pages/EmployeeList";
import Guide from "./pages/Guide";
import Vendors from "./pages/Vendors";
import Inventory from "./pages/Inventory";
import Recipes from "./pages/Recipes";
import Sales from "./pages/Sales";
import Settlements from "./pages/Settlements";
import MyProfile from "./pages/MyProfile";
import type { ManagerPermissionKey } from "./data/types";

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
  const { mode, role, authLoading, authUser, profile, managerPermissions } = useStore();
  const location = useLocation();
  const canManager = (key: ManagerPermissionKey) => role === "manager" && managerPermissions[key];
  const canAdminOrManager = (key: ManagerPermissionKey) => role === "admin" || canManager(key);
  const canUseManagerDashboard = role === "admin" || role === "manager";
  const canUseReservations = role === "admin" || role === "staff" || canManager("reservations");
  const canUseNotices = role === "admin" || role === "staff" || canManager("notices");

  // 라이브 모드: 인증 게이트
  if (mode === "live") {
    if (authLoading) return <Splash text="로그인 상태를 확인하는 중..." />;
    // 비로그인: /signup은 회원가입, 그 외는 로그인
    if (!authUser) {
      return location.pathname === "/signup" ? <Signup /> : <Login />;
    }
    // 로그인됐지만 프로필이 없으면 (가입 트랜잭션 실패 등) 프로필 완성 화면으로 복구
    if (!profile) return <CompleteProfile />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={canUseManagerDashboard ? <AdminDashboard /> : <StaffDashboard />} />
        <Route path="/reservations" element={canUseReservations ? <Reservations /> : <Navigate to="/" replace />} />
        <Route path="/worklog" element={role === "staff" ? <WorkLog /> : <Navigate to="/" replace />} />
        <Route path="/schedule" element={role === "staff" ? <SchedulePage /> : <Navigate to={canAdminOrManager("scheduleManage") ? "/schedule-manage" : "/"} replace />} />
        <Route path="/schedule-manage" element={canAdminOrManager("scheduleManage") ? <ScheduleManage /> : <Navigate to="/" replace />} />
        <Route path="/payroll" element={role === "admin" ? <Payroll /> : <Navigate to="/" replace />} />
        <Route path="/employees" element={canAdminOrManager("employees") ? <EmployeeList /> : <Navigate to="/" replace />} />
        <Route path="/sales" element={canAdminOrManager("sales") ? <Sales /> : <Navigate to="/" replace />} />
        <Route path="/vendors" element={canAdminOrManager("vendors") ? <Vendors /> : <Navigate to="/" replace />} />
        <Route path="/inventory" element={canAdminOrManager("inventory") ? <Inventory /> : <Navigate to="/" replace />} />
        <Route path="/settlements" element={canAdminOrManager("settlements") ? <Settlements /> : <Navigate to="/" replace />} />
        <Route path="/recipes" element={canAdminOrManager("recipes") ? <Recipes /> : <Navigate to="/" replace />} />
        <Route path="/profile" element={<MyProfile />} />
        <Route path="/guide" element={canAdminOrManager("guide") ? <Guide /> : <Navigate to="/" replace />} />
        <Route path="/notices" element={canUseNotices ? <Notices /> : <Navigate to="/" replace />} />
        {/* 로그인 상태(또는 데모 모드)에서 /signup 접근 시 홈으로 */}
        <Route path="/signup" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
