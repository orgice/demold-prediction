// [화면] 내 계정 (/account, 로그인한 모든 사용자)
// 본인이 ID·이름·비밀번호를 바꾼다. 맨 아래 '그래프 색 설정'(접힘)에서 그래프 선 색을 고른다. 권한·사용 상태는 읽기 전용 (관리자가 사용자 관리에서 바꾼다).
// ID·비밀번호를 바꿀 때는 현재 비밀번호를 확인한다.
// ⚠ 백엔드 미연동 목업: api/auth.ts → authMock.ts. 실제 서비스에서 ID 변경을 허용할지는 고객·백엔드 협의가 필요하다.
import { useState } from "react";
import { AUTH_IS_MOCK, authApi } from "../api/auth";
import { useAuth } from "../auth/AuthContext";
import { ROLE_INFO } from "../auth/roles";
import GraphColorSettings from "../components/GraphColorSettings";

const ID_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export default function MyAccount() {
  const { user, refresh } = useAuth();
  const [id, setId] = useState(user?.id ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [cur, setCur] = useState("");
  const [touched, setTouched] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;   // RequireAuth 가 로그인 화면으로 보낸다

  const idChanged = id.trim() !== user.id;
  const nameChanged = name.trim() !== user.name;
  const pwChanged = pw.length > 0;
  const needCur = idChanged || pwChanged;
  const dirty = idChanged || nameChanged || pwChanged;

  const problems = {
    id: !ID_RE.test(id.trim()) ? "영문·숫자·. _ - 로 3~32자여야 해요." : null,
    name: !name.trim() ? "이름을 입력해 주세요." : null,
    pw: pwChanged && pw.length < 8 ? "8자 이상 입력해 주세요." : null,
    pw2: pwChanged && pw !== pw2 ? "새 비밀번호가 서로 달라요." : null,
    cur: needCur && !cur ? "ID나 비밀번호를 바꾸려면 현재 비밀번호를 입력해 주세요." : null,
  };
  const show = (k: keyof typeof problems) => (touched ? problems[k] : null);

  const save = async () => {
    setTouched(true); setMsg(null); setErr(null);
    if (Object.values(problems).some(Boolean)) return;
    setBusy(true);
    try {
      const u = await authApi.updateMe({
        current_password: needCur ? cur : undefined,
        new_id: idChanged ? id.trim() : undefined,
        name: nameChanged ? name : undefined,
        new_password: pwChanged ? pw : undefined,
      });
      await refresh();
      setId(u.id); setName(u.name); setPw(""); setPw2(""); setCur(""); setTouched(false);
      const parts = [idChanged && "ID", nameChanged && "이름", pwChanged && "비밀번호"].filter(Boolean).join("·");
      setMsg(`${parts} 변경을 저장했어요.${idChanged ? ` 다음 로그인부터 새 ID(${u.id})를 쓰세요.` : ""}`);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <main className="page account-page">
      <div className="page-head">
        <div>
          <h1>내 계정</h1>
          <div className="muted small">로그인 ID·이름·비밀번호를 바꿀 수 있어요. 권한은 관리자에게 요청해 주세요.</div>
        </div>
      </div>

      {AUTH_IS_MOCK && (
        <div className="alert info small">
          <b>백엔드 미연동 목업</b> · 변경 내용은 이 브라우저에만 저장돼요.
          실제 서비스에서 ID 변경을 허용할지는 고객·백엔드와 협의 후 정해요.
        </div>
      )}

      <section className="card stack">
        <h2>권한·상태</h2>
        <div className="account-ro">
          <div><span className="ts-label">권한</span>
            <div className="row"><span className={`badge role-${user.role}`}>{ROLE_INFO[user.role].label}</span>
              <span className="small muted">{ROLE_INFO[user.role].summary}</span></div></div>
          <div><span className="ts-label">상태</span>
            <div><span className={`badge ${user.active ? "good" : "neutral"}`}>{user.active ? "사용 중" : "사용 중지"}</span></div></div>
        </div>
        <span className="tiny">권한과 사용 상태는 관리자만 바꿀 수 있어요.</span>
      </section>

      <section className="card stack">
        <h2>계정 정보</h2>
        <div className="form-row top">
          <label className="field">ID
            <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" disabled={busy} aria-invalid={!!show("id")} />
            {show("id") ? <span className="tiny text-warn">{show("id")}</span>
              : <span className="tiny">영문·숫자·. _ - 3~32자. 바꾸면 다음 로그인부터 새 ID를 써요.</span>}
          </label>
          <label className="field">이름
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} aria-invalid={!!show("name")} />
            {show("name") && <span className="tiny text-warn">{show("name")}</span>}
          </label>
        </div>

        <h3 className="mt-2">비밀번호 변경</h3>
        <div className="form-row top">
          <label className="field">새 비밀번호
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="바꾸지 않으려면 비워 두세요"
              autoComplete="new-password" disabled={busy} aria-invalid={!!show("pw")} />
            {show("pw") ? <span className="tiny text-warn">{show("pw")}</span> : <span className="tiny">8자 이상</span>}
          </label>
          <label className="field">새 비밀번호 확인
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="한 번 더 입력"
              autoComplete="new-password" disabled={busy || !pwChanged} aria-invalid={!!show("pw2")} />
            {show("pw2") && <span className="tiny text-warn">{show("pw2")}</span>}
          </label>
        </div>

        {needCur && (
          <label className="field account-cur">현재 비밀번호
            <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password"
              disabled={busy} aria-invalid={!!show("cur")} />
            {show("cur") ? <span className="tiny text-warn">{show("cur")}</span>
              : <span className="tiny">ID나 비밀번호를 바꾸려면 본인 확인이 필요해요.</span>}
          </label>
        )}

        {msg && <div className="alert success" role="status">{msg}</div>}
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="actions">
          <button className="btn" disabled={busy || !dirty}
            onClick={() => { setId(user.id); setName(user.name); setPw(""); setPw2(""); setCur(""); setTouched(false); setErr(null); }}>되돌리기</button>
          <button className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </section>

      <GraphColorSettings />
    </main>
  );
}
