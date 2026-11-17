// [화면] 사용자 관리 (/admin/users, 관리자 전용)
// 목록·검색, 추가, 수정(이름·권한·비밀번호 재설정), 삭제, 사용 중지/재개.
// ⚠ 백엔드 미연동 목업: api/auth.ts → authMock.ts 가 브라우저 저장소로 흉내 낸다.
import { useEffect, useState } from "react";
import { AUTH_IS_MOCK, authApi, User } from "../api/auth";
import { resetMockUsers } from "../api/authMock";
import { useAuth } from "../auth/AuthContext";
import { ROLE_INFO, ROLE_ORDER } from "../auth/roles";
import { ErrorBox, Loading, useAsync } from "../components/common";
import { DeleteUserModal, UserFormModal } from "../components/UserModals";
import { fmtDateTime } from "../format";

type Dialog = { kind: "add" } | { kind: "edit"; user: User } | { kind: "delete"; user: User } | null;

export default function AdminUsers() {
  const { user: me, requireLogin, setRequireLogin, refresh } = useAuth();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const users = useAsync(() => authApi.users(query), [query]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 검색어는 입력이 멈추고 0.25초 뒤에 반영
  useEffect(() => { const t = setTimeout(() => setQuery(q), 250); return () => clearTimeout(t); }, [q]);

  const done = (m: string) => { setDialog(null); setMsg(m); setRowErr(null); users.reload(); refresh(); };

  const toggleActive = async (u: User) => {
    setBusyId(u.id); setRowErr(null); setMsg(null);
    try {
      await authApi.setActive(u.id, !u.active);
      setMsg(`${u.name}(${u.id}) 계정을 ${u.active ? "사용 중지" : "다시 사용"}하도록 바꿨어요.`);
      users.reload();
    } catch (e) { setRowErr((e as Error).message); }
    setBusyId(null);
  };

  const list = users.data ?? [];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>사용자 관리</h1>
          <div className="muted small">계정을 추가하고 권한(보기·편집·관리자)을 정해요.</div>
        </div>
        <button className="btn primary" onClick={() => { setMsg(null); setDialog({ kind: "add" }); }}>+ 사용자 추가</button>
      </div>

      {AUTH_IS_MOCK && (
        <div className="alert info alert-inline">
          <div>
            <b>백엔드 미연동 목업</b> · 계정은 이 브라우저(localStorage)에만 저장돼요. 권한 3단계와 범위는 고객 협의 전 초안이며,
            지금은 ‘사용자 관리’ 메뉴만 권한으로 막아요. 다른 화면의 편집 제한은 백엔드 연동 때 적용해요.
          </div>
          <div className="row">
            <label className="row small check-line">
              <input type="checkbox" checked={requireLogin} onChange={(e) => setRequireLogin(e.target.checked)} />
              로그인 필수
            </label>
            <button className="btn sm" onClick={() => { resetMockUsers(); done("예시 계정으로 초기화했어요."); }}>예시 데이터로 초기화</button>
          </div>
        </div>
      )}

      <section className="card stack">
        <div className="card-head">
          <h2>사용자 <span className="muted small">{users.data ? `${list.length}명` : ""}</span></h2>
          <div className="list-filters">
            <input type="search" placeholder="ID·이름 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ID·이름 검색" />
          </div>
        </div>
        {msg && <div className="alert success" role="status">{msg}</div>}
        <ErrorBox error={rowErr} />
        {users.error && (
          <div className="alert error alert-inline">
            <span>사용자 목록을 불러오지 못했어요. {users.error}</span>
            <button className="btn sm" onClick={users.reload}>다시 시도</button>
          </div>
        )}
        {users.loading && !users.data ? <Loading /> : (
          <div className="table-wrap">
            <table className="user-table">
              <thead>
                <tr><th>ID</th><th>이름</th><th>권한</th><th>상태</th><th>추가한 날</th><th className="right">관리</th></tr>
              </thead>
              <tbody>
                {list.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id} className={u.active ? "" : "row-inactive"}>
                      <td className="nowrap uc-id"><b>{u.id}</b>{self && <span className="badge info badge-gap">나</span>}</td>
                      <td className="uc-name">{u.name}</td>
                      <td className="nowrap uc-role"><span className={`badge role-${u.role}`}>{ROLE_INFO[u.role].label}</span></td>
                      <td className="nowrap uc-state">{u.active ? <span className="badge good">사용 중</span> : <span className="badge neutral">사용 중지</span>}</td>
                      <td className="nowrap small muted uc-date">{fmtDateTime(u.created_at)}</td>
                      <td className="right uc-actions">
                        <div className="row nowrap user-actions">
                          <button className="btn sm" disabled={busyId === u.id} onClick={() => { setMsg(null); setDialog({ kind: "edit", user: u }); }}>수정</button>
                          <button className="btn sm" disabled={busyId === u.id || self} title={self ? "내 계정은 사용 중지할 수 없어요" : undefined}
                            onClick={() => toggleActive(u)}>{busyId === u.id ? "바꾸는 중…" : u.active ? "사용 중지" : "다시 사용"}</button>
                          <button className="btn sm danger" disabled={busyId === u.id || self} title={self ? "내 계정은 삭제할 수 없어요" : undefined}
                            onClick={() => { setMsg(null); setDialog({ kind: "delete", user: u }); }}>삭제</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {users.data && list.length === 0 && (
                  <tr><td colSpan={6} className="table-empty muted">{query ? `‘${query}’와 맞는 사용자가 없어요.` : "사용자가 없어요."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>권한별로 할 수 있는 일 <span className="badge neutral badge-gap">초안</span></h2>
        <div className="role-guide">
          {ROLE_ORDER.map((r) => (
            <div key={r} className="role-guide-item">
              <div className="role-title"><span className={`badge role-${r}`}>{ROLE_INFO[r].label}</span> {ROLE_INFO[r].summary}</div>
              <ul className="role-can">{ROLE_INFO[r].can.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      {dialog?.kind === "add" && <UserFormModal onClose={() => setDialog(null)} onDone={(_, m) => done(m)} />}
      {dialog?.kind === "edit" && <UserFormModal user={dialog.user} meId={me?.id} onClose={() => setDialog(null)} onDone={(_, m) => done(m)} />}
      {dialog?.kind === "delete" && <DeleteUserModal user={dialog.user} onClose={() => setDialog(null)} onDone={done} />}
    </main>
  );
}
