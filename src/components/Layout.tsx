import { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useStore } from "../store";

interface NavDef { to: string; icon: string; label: string; title: string; mobile?: boolean; mobileLabel?: string }

const STAFF_NAV: NavDef[] = [
  { to: "/", icon: "🏠", label: "대시보드", title: "실무자 대시보드", mobile: true },
  { to: "/reservations", icon: "📋", label: "오늘 예약", title: "오늘 예약", mobile: true },
  { to: "/schedule", icon: "🗓️", label: "근무표", title: "근무표", mobile: true },
  { to: "/worklog", icon: "✍️", label: "근무기록", title: "근무기록 작성", mobile: true },
  { to: "/notices", icon: "📢", label: "공지사항", title: "공지사항", mobile: true },
];

const ADMIN_NAV: NavDef[] = [
  { to: "/", icon: "🏠", label: "대시보드", title: "관리자 대시보드", mobile: true, mobileLabel: "홈" },
  { to: "/reservations", icon: "📋", label: "예약 관리", title: "예약 관리", mobile: true, mobileLabel: "예약" },
  { to: "/schedule-manage", icon: "🗓️", label: "근무표 관리", title: "근무표 관리", mobile: true, mobileLabel: "근무표" },
  { to: "/employees", icon: "👥", label: "직원 관리", title: "직원 관리", mobile: true, mobileLabel: "직원" },
  { to: "/payroll", icon: "💰", label: "급여 관리", title: "급여 관리", mobile: true, mobileLabel: "급여" },
  { to: "/vendors", icon: "🏢", label: "거래처 관리", title: "거래처 관리", mobile: true, mobileLabel: "거래처" },
  { to: "/recipes", icon: "🥘", label: "레시피 원가", title: "레시피 원가계산", mobile: true, mobileLabel: "레시피" },
  { to: "/notices", icon: "📢", label: "공지사항", title: "공지사항", mobile: true, mobileLabel: "공지" },
  { to: "/guide", icon: "📖", label: "가이드북", title: "사용 가이드북", mobile: false },
];

const MANAGER_NAV: NavDef[] = [
  { to: "/", icon: "🏠", label: "대시보드", title: "매니저 대시보드", mobile: true },
  { to: "/reservations", icon: "📋", label: "예약 관리", title: "예약 관리", mobile: true },
  { to: "/schedule-manage", icon: "🗓️", label: "근무표 관리", title: "근무표 관리", mobile: true, mobileLabel: "근무표" },
  { to: "/notices", icon: "📢", label: "공지사항", title: "공지사항", mobile: true },
  { to: "/guide", icon: "📖", label: "가이드북", title: "사용 가이드북", mobile: false },
];

export default function Layout({ children }: { children: ReactNode }) {
  const {
    mode, demoReason, role, setRole, toast, loading, error,
    profile, authUser, logout, currentEmployee,
  } = useStore();
  const loc = useLocation();
  const nav = role === "admin" ? ADMIN_NAV : role === "manager" ? MANAGER_NAV : STAFF_NAV;
  const current = nav.find((n) => n.to === loc.pathname);
  const title = current?.title ?? (loc.pathname === "/profile" ? "내 정보 수정" : "하늘땅 매장관리");

  const userName =
    mode === "live"
      ? profile?.name ?? authUser?.email ?? "사용자"
      : role === "admin" ? "김지현" : role === "manager" ? "매니저" : currentEmployee?.name ?? "직원";
  const userRole =
    mode === "live"
      ? role === "admin" ? "매장 관리자" : role === "manager" ? "매니저" : currentEmployee?.role ?? "직원"
      : role === "admin" ? "매장 관리자" : role === "manager" ? "매니저" : currentEmployee?.role ?? "직원";

  const switchRole = () => setRole(role === "admin" ? "staff" : "admin");
  const handleLogout = () => {
    if (window.confirm("로그아웃 하시겠어요?")) void logout();
  };

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
          {mode === "demo" ? (
            <button className="role-switch" onClick={switchRole}>
              <span>🔄</span>
              {role === "admin" ? "실무자 화면으로" : "관리자 화면으로"}
            </button>
          ) : (
            <button className="role-switch" onClick={handleLogout}>
              <span>🚪</span> 로그아웃
            </button>
          )}
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
            {mode === "demo" ? (
              <button className="avatar" onClick={switchRole} title="역할 전환">
                {userName[0]}
              </button>
            ) : (
              <Link className="avatar" to="/profile" title="내 정보 수정">
                {userName[0]}
              </Link>
            )}
          </div>
        </header>

        {/* 데모 모드 배너 */}
        {demoReason && (
          <div className="demo-banner">🔌 {demoReason}</div>
        )}
        {error && (
          <div className="demo-banner danger">⚠️ {error}</div>
        )}

        {/* 데스크톱 톱바 */}
        <div className="topbar">
          <h1>{title}{loading && <span className="muted small" style={{ marginLeft: 10, fontWeight: 500 }}>불러오는 중...</span>}</h1>
          <div className="topbar-right hide-mobile">
            <button className="icon-btn" aria-label="알림">🔔<span className="dot" /></button>
            <Link className="user-chip" to="/profile" style={{ textDecoration: "none", color: "inherit" }}>
              <span className="avatar">{userName[0]}</span>
              {userName}
              <span className="role-tag">{userRole}</span>
            </Link>
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
            <span className="bnav-label">{n.mobileLabel ?? n.label}</span>
          </NavLink>
        ))}
      </nav>

      {toast && <div className="toast">✓ {toast}</div>}
    </div>
  );
}
