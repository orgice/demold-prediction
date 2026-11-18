// 로그인 상태를 앱 전체에 나눠 주는 곳 + 로그인·권한이 필요한 화면 감싸개.
//
// 로그인 강제(미로그인 시 /login 으로 보내기)는 목업 단계에서 켜고 끌 수 있다.
//   기본값: 켜짐. 빌드·개발 환경변수 VITE_REQUIRE_LOGIN=false 일 때만 꺼짐 (개발용 끄기 수단)
//   사용자 관리 화면의 '로그인 필수' 스위치로 이 브라우저에서만 바꿀 수 있다 (localStorage).
//   저장 키에 버전(v2)을 붙여, 기본값이 꺼짐이던 시절에 저장된 값은 무시한다.
// 실제 권한 검사는 백엔드가 해야 한다. 여기서는 화면 이동만 막는다.
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { authApi, Role, User } from "../api/auth";
import { atLeast } from "./roles";

const REQUIRE_KEY = "formcast.mock.requireLogin.v2";
const envDefault = import.meta.env.VITE_REQUIRE_LOGIN !== "false";

function readRequire(): boolean {
  try {
    const v = localStorage.getItem(REQUIRE_KEY);
    if (v === "true" || v === "false") return v === "true";
  } catch { /* 무시 */ }
  return envDefault;
}

interface AuthState {
  user: User | null;
  ready: boolean;                 // 처음 로그인 상태 확인이 끝났는지
  requireLogin: boolean;
  setRequireLogin: (v: boolean) => void;
  login: (id: string, pw: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [requireLogin, setReq] = useState(readRequire);

  const refresh = useCallback(async () => {
    setUser(await authApi.me().catch(() => null));
  }, []);
  useEffect(() => { refresh().finally(() => setReady(true)); }, [refresh]);

  const value: AuthState = {
    user, ready, requireLogin, refresh,
    setRequireLogin: (v) => {
      setReq(v);
      try { localStorage.setItem(REQUIRE_KEY, String(v)); } catch { /* 무시 */ }
    },
    login: async (id, pw) => { const u = await authApi.login(id, pw); setUser(u); return u; },
    logout: async () => { await authApi.logout(); setUser(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth 는 AuthProvider 안에서만 쓸 수 있어요.");
  return v;
}

/**
 * 화면 감싸개.
 * role 을 주면 그 역할 이상만 들어올 수 있다 (로그인 강제 설정과 관계없이 항상 확인).
 * role 이 없으면 로그인 강제가 켜져 있을 때만 로그인을 요구한다.
 */
export function RequireAuth({ role, children }: { role?: Role; children: ReactNode }) {
  const { user, ready, requireLogin } = useAuth();
  const loc = useLocation();
  if (!ready) return null;
  const needLogin = role != null || requireLogin;
  if (needLogin && !user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (role && user && !atLeast(user.role, role)) {
    return (
      <main className="page">
        <div className="card empty">
          <h2>접근 권한이 없어요</h2>
          <div className="muted">이 화면은 관리자만 볼 수 있어요. 권한이 필요하면 관리자에게 요청해 주세요.</div>
          <Link className="btn" to="/">대시보드로</Link>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}
