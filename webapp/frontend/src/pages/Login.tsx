// [화면] 로그인 (/login)
// 서버 API: api/auth.ts → 백엔드 routers/auth.py (세션 쿠키)
import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
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
