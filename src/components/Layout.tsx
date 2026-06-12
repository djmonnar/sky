import { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useStore } from "../store";

interface NavDef { to: string; icon: string; label: string; title: string; mobile?: boolean }

const STAFF_NAV: NavDef[] = [
  { to: "/", icon: "🏠", label: "대시보드", title: "실무자 대시보드", mobile: true },
  { to: "/reservations", icon: "📋", label: "오늘 예약", title: "오늘 예약", mobile: true },
  { to: "/schedule", icon: "🗓️", label: "근무표", title: "근무표", mobile: true },
  { to: "/worklog", icon: "✍️", label: "근무기록", title: "근무기록 작성", mobile: true },
  { to: "/notices", icon: "📢", label: "공지사항", title: "공지사항", mobile: true },
];

const ADMIN_NAV: NavDef[] = [
  { to: "/", icon: "🏠", label: "대시보드", title: "관리자 대시보드", mobile: true },
  { to: "/reservations", icon: "📋", label: "예약 관리", title: "예약 관리", mobile: true },
  { to: "/schedule-manage", icon: "🗓️", label: "근무표 관리", title: "근무표 관리", mobile: true },
  { to: "/payroll", icon: "💰", label: "급여 관리", title: "급여 관리", mobile: true },
  { to: "/notices", icon: "📢", label: "공지사항", title: "공지사항", mobile: true },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { role, setRole, toast } = useStore();
  const loc = useLocation();
  const nav = role === "admin" ? ADMIN_NAV : STAFF_NAV;
  const current = nav.find((n) => n.to === loc.pathname);
  const title = current?.title ?? "하늘땅 매장관리";
  const userName = role === "admin" ? "정하늘" : "김민수";
  const userRole = role === "admin" ? "매장 관리자" : "홀 직원";

  const switchRole = () => setRole(role === "admin" ? "staff" : "admin");

  return (
    <div className="shell">
      {/* 데스크톱 사이드바 */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">🌿</div>
          <div>
            <div className="brand-name">하늘땅</div>
            <div className="brand-sub">매장관리</div>
          </div>
        </div>
        <nav className="nav">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              end={n.to === "/"}
            >
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="role-switch" onClick={switchRole}>
            <span>🔄</span>
            {role === "admin" ? "실무자 화면으로" : "관리자 화면으로"}
          </button>
        </div>
      </aside>

      <div className="main">
        {/* 모바일 헤더 */}
        <header className="mobile-head">
          <div className="mobile-brand">
            <div className="brand-logo">🌿</div>
            <div>
              <div className="brand-name" style={{ fontSize: 15 }}>하늘땅 <span className="muted small">매장관리</span></div>
            </div>
          </div>
          <div className="topbar-right">
            <button className="icon-btn" aria-label="알림">🔔<span className="dot" /></button>
            <button className="avatar" onClick={switchRole} title="역할 전환">
              {userName[0]}
            </button>
          </div>
        </header>

        {/* 데스크톱 톱바 */}
        <div className="topbar">
          <h1>{title}</h1>
          <div className="topbar-right hide-mobile">
            <button className="icon-btn" aria-label="알림">🔔<span className="dot" /></button>
            <div className="user-chip">
              <span className="avatar">{userName[0]}</span>
              {userName}
              <span className="role-tag">{userRole}</span>
            </div>
          </div>
        </div>

        <main className="page">{children}</main>
      </div>

      {/* 모바일 하단 탭 */}
      <nav className="bottom-nav">
        {nav.filter((n) => n.mobile).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `bnav-item ${isActive ? "active" : ""}`}
            end={n.to === "/"}
          >
            <span className="ic">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>

      {toast && <div className="toast">✓ {toast}</div>}
    </div>
  );
}
