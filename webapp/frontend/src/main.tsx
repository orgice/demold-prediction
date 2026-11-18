// 화면(프론트엔드)의 시작점.
// 맨 위 메뉴 막대와, 주소(URL)에 따라 어떤 화면(pages/)을 보여 줄지 정한다.
// 메뉴는 수행계획서대로 4개: 대시보드 · 타설 이력 · 센서 데이터 · AI 상담
//   /            대시보드       pages/Dashboard.tsx   (/dashboard 도 같은 화면)
//   /pours       타설 이력      pages/PourList.tsx
//   /pours/3     회차 상세      pages/PourDetail.tsx  (3 = 회차 번호)
//   /sensors     센서 데이터    pages/Sensors.tsx     (CSV 불러오기 포함, 예전 /upload 주소는 여기로)
//   /assistant   AI 상담        pages/Assistant.tsx
//   /login       로그인         pages/Login.tsx       (⚠ 백엔드 미연동 목업)
//   /account     내 계정        pages/MyAccount.tsx   (로그인한 모든 사용자, 상단 이름을 누르면 이동, ⚠ 목업)
//   /admin/users 사용자 관리    pages/AdminUsers.tsx  (관리자만 메뉴가 보임, ⚠ 목업)
// 로그인 상태는 auth/AuthContext.tsx, 로그인 강제는 기본 켜짐, VITE_REQUIRE_LOGIN=false 로 끌 수 있다.
// 서버와 주고받는 함수는 api/client.ts 에 모여 있다.
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, RequireAuth, useAuth } from "./auth/AuthContext";
import { ROLE_INFO } from "./auth/roles";
import AdminUsers from "./pages/AdminUsers";
import Assistant from "./pages/Assistant";
import Login from "./pages/Login";
import MyAccount from "./pages/MyAccount";
import Dashboard from "./pages/Dashboard";
import PourDetail from "./pages/PourDetail";
import PourList from "./pages/PourList";
import Sensors from "./pages/Sensors";
import "./styles.css";

/** 맨 위 오른쪽: 로그인한 사용자·권한·로그아웃 (미로그인이면 로그인 링크) */
function UserBox() {
  const { user, ready, logout } = useAuth();
  const nav = useNavigate();
  const onLogin = useLocation().pathname === "/login";
  if (!ready || (!user && onLogin)) return null;
  if (!user) return <div className="topbar-user"><Link className="btn sm" to="/login">로그인</Link></div>;
  return (
    <div className="topbar-user">
      <Link className="topbar-name" to="/account" title={`내 계정 (${user.id})`}>{user.name}</Link>
      <span className={`badge role-${user.role}`}>{ROLE_INFO[user.role].label}</span>
      <button className="btn sm" onClick={async () => { await logout(); nav("/login"); }}>로그아웃</button>
    </div>
  );
}

/** 앱 전체 틀: 위쪽 메뉴 + 주소에 맞는 화면 */
function Shell() {
  const { user, requireLogin } = useAuth();
  const showNav = !requireLogin || !!user;   // 로그인 강제 중 미로그인이면 메뉴를 숨긴다
  const guard = (el: JSX.Element) => <RequireAuth>{el}</RequireAuth>;
  return (
    <>
      <header className="topbar">
        <div className="brand">거푸집 탈형 시점 예측<small>적산온도 기반</small></div>
        {showNav && (
          <nav className="nav">
            <NavLink to="/" end>대시보드</NavLink>
            <NavLink to="/pours">타설 이력</NavLink>
            <NavLink to="/sensors">센서 데이터</NavLink>
            <NavLink to="/assistant">AI 상담</NavLink>
            {user?.role === "admin" && <NavLink to="/admin/users">사용자 관리</NavLink>}
          </nav>
        )}
        <UserBox />
      </header>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={guard(<Dashboard />)} />
        <Route path="/dashboard" element={guard(<Dashboard />)} />
        <Route path="/pours" element={guard(<PourList />)} />
        <Route path="/pours/:id" element={guard(<PourDetail />)} />
        <Route path="/assistant" element={guard(<Assistant />)} />
        <Route path="/sensors" element={guard(<Sensors />)} />
        <Route path="/upload" element={<Navigate to="/sensors" replace />} />
        <Route path="/account" element={<RequireAuth role="viewer"><MyAccount /></RequireAuth>} />
        <Route path="/admin/users" element={<RequireAuth role="admin"><AdminUsers /></RequireAuth>} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  );
}

// index.html의 <div id="root"> 안에 앱을 그린다
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
