import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import { useStore } from "./store";
import StaffDashboard from "./pages/StaffDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import Reservations from "./pages/Reservations";
import WorkLog from "./pages/WorkLog";
import SchedulePage from "./pages/SchedulePage";
import ScheduleManage from "./pages/ScheduleManage";
import Payroll from "./pages/Payroll";
import Notices from "./pages/Notices";

export default function App() {
  const { role } = useStore();
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
