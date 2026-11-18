// 로그인 상태를 앱 전체에 나눠 주는 곳 + 로그인·권한이 필요한 화면 감싸개.
//
// 로그인은 항상 필수다. 로그인하지 않으면 모든 화면이 /login 으로 보내진다.
// 실제 권한 검사는 백엔드가 해야 한다. 여기서는 화면 이동만 막는다.
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { authApi, Role, User } from "../api/auth";
import { AUTH_CHANGED_EVENT } from "../api/client";
import { atLeast } from "./roles";

interface AuthState {
  user: User | null;
  ready: boolean;                 // 처음 로그인 상태 확인이 끝났는지
  login: (id: string, pw: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    setUser(await authApi.me().catch(() => null));
  }, []);
  useEffect(() => { refresh().finally(() => setReady(true)); }, [refresh]);

  // 관리자가 내 권한을 바꾸거나 계정을 중지했을 때 화면에 바로 반영되도록 내 정보를 다시 불러온다:
  //   다른 화면으로 이동할 때 · 브라우저 창으로 돌아올 때 · 서버가 권한 부족(403)이라고 할 때
  const path = useLocation().pathname;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }   // 처음 한 번은 위에서 이미 불러옴
    refresh();
  }, [path, refresh]);
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") refresh(); };
    const onChanged = () => { refresh(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener(AUTH_CHANGED_EVENT, onChanged);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener(AUTH_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  const value: AuthState = {
    user, ready, refresh,
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

/** 등록·수정·삭제를 할 수 있는지 (편집 권한 이상). 보기 계정에게는 그런 버튼·입력칸을 숨긴다.
 *  서버도 같은 검사를 하므로 숨기는 것은 화면 정리용이다. */
export function useCanEdit() {
  const { user } = useAuth();
  return !!user && atLeast(user.role, "editor");
}

/**
 * 화면 감싸개.
 * 로그인하지 않았으면 항상 /login 으로 보낸다.
 * role 을 주면 그 역할 이상만 들어올 수 있다.
 */
export function RequireAuth({ role, children }: { role?: Role; children: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
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
