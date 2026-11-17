// [화면] 로그인 (/login)
// ⚠ 백엔드 미연동 목업: api/auth.ts → authMock.ts 가 브라우저 저장소로 흉내 낸다.
import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AUTH_IS_MOCK } from "../api/auth";
import { useAuth } from "../auth/AuthContext";

export default function Login() {
  const { user, ready, login } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (ready && user && !busy) return <Navigate to={from} replace />;

  const idEmpty = !id.trim();
  const pwEmpty = !pw;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setErr(null);
    if (idEmpty || pwEmpty) return;
    setBusy(true);
    try {
      await login(id, pw);
      nav(from, { replace: true });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="page login-page">
      <form className="card stack login-card" onSubmit={submit} noValidate>
        <div>
          <h1>로그인</h1>
          <div className="muted small mt-2">계정 ID와 비밀번호를 입력해 주세요.</div>
        </div>
        {AUTH_IS_MOCK && (
          <div className="alert info small">
            <b>백엔드 미연동 목업</b> · 화면 확인용이에요. 계정은 이 브라우저에만 저장되고 보안 기능이 없어요.
            예시 계정은 코드의 <code>api/authMockSeed.ts</code>에 있어요.
          </div>
        )}
        <label className="field">ID
          <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" autoFocus
            disabled={busy} aria-invalid={touched && idEmpty} />
          {touched && idEmpty && <span className="tiny text-warn">ID를 입력해 주세요.</span>}
        </label>
        <label className="field">비밀번호
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password"
            disabled={busy} aria-invalid={touched && pwEmpty} />
          {touched && pwEmpty && <span className="tiny text-warn">비밀번호를 입력해 주세요.</span>}
        </label>
        {err && <div className="alert error" role="alert">{err}</div>}
        <button type="submit" className="btn primary login-submit" disabled={busy}>
          {busy ? "로그인 중…" : "로그인"}
        </button>
        <div className="tiny">비밀번호를 잊었다면 관리자에게 재설정을 요청해 주세요.</div>
      </form>
    </main>
  );
}
