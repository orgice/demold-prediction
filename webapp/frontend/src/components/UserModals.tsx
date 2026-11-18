// [창] 사용자 추가·수정, 삭제 확인 (사용자 관리 화면에서 열림)
// 권한 선택(RolePicker)은 각 역할이 할 수 있는 일을 함께 보여 준다.
import { useEffect, useState } from "react";
import { authApi, Role, User } from "../api/auth";
import { ROLE_INFO, ROLE_ORDER } from "../auth/roles";
import { ErrorBox, Modal } from "./common";

/** Esc 키로 창 닫기 (작업 중이면 무시 — 취소 버튼과 같은 조건) */
function useEscClose(onClose: () => void, busy: boolean) {
  useEffect(() => {
    if (busy) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, busy]);
}

/** 역할 선택: 라디오 + 역할별 설명 */
export function RolePicker({ value, onChange, disabled, name = "role" }: {
  value: Role; onChange: (r: Role) => void; disabled?: boolean; name?: string;
}) {
  return (
    <div className="role-picker" role="radiogroup" aria-label="권한">
      {ROLE_ORDER.map((r) => {
        const info = ROLE_INFO[r];
        return (
          <label key={r} className={`role-option ${value === r ? "on" : ""} ${disabled ? "disabled" : ""}`}>
            <input type="radio" name={name} aria-label={`${info.label} (${info.summary})`} checked={value === r} disabled={disabled} onChange={() => onChange(r)} />
            <span className="role-body">
              <span className="role-title">{info.label}<span className="tiny"> · {info.summary}</span></span>
              <ul className="role-can">{info.can.map((c) => <li key={c}>{c}</li>)}</ul>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** 사용자 추가(user 없음) 또는 수정(user 있음) */
export function UserFormModal({ user, meId, onClose, onDone }: {
  user?: User; meId?: string; onClose: () => void; onDone: (u: User, msg: string) => void;
}) {
  const editing = !!user;
  const self = editing && user!.id === meId;
  const [id, setId] = useState(user?.id ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "viewer");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [resetPw, setResetPw] = useState(!editing);
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problems = {
    id: !editing && !id.trim() ? "ID를 입력해 주세요." : null,
    name: !name.trim() ? "이름을 입력해 주세요." : null,
    pw: resetPw && pw.length < 8 ? "8자 이상 입력해 주세요." : null,
    pw2: resetPw && pw !== pw2 ? "비밀번호가 서로 달라요." : null,
  };
  useEscClose(onClose, busy);
  const show = (k: keyof typeof problems) => (touched ? problems[k] : null);

  const submit = async () => {
    setTouched(true);
    setErr(null);
    if (Object.values(problems).some(Boolean)) return;
    setBusy(true);
    try {
      const u = editing
        ? await authApi.updateUser(user!.id, { name, role, password: resetPw ? pw : undefined })
        : await authApi.createUser({ id, name, role, password: pw });
      onDone(u, editing ? `${u.name}(${u.id}) 정보를 저장했어요.` : `${u.name}(${u.id}) 계정을 추가했어요.`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? "사용자 수정" : "사용자 추가"} onClose={busy ? () => {} : onClose}>
      <div className="form-row top">
        <label className="field">ID
          {editing
            ? <input value={id} disabled aria-describedby="uid-help" />
            : <input value={id} onChange={(e) => setId(e.target.value)} placeholder="예: kim.site" autoFocus
                disabled={busy} aria-invalid={!!show("id")} aria-describedby="uid-help" />}
          {show("id")
            ? <span className="tiny text-warn">{show("id")}</span>
            : <span className="tiny" id="uid-help">{editing ? "ID는 바꿀 수 없어요." : "영문·숫자·. _ - 3~32자"}</span>}
        </label>
        <label className="field">이름
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 김현장" disabled={busy} aria-invalid={!!show("name")} />
          {show("name") && <span className="tiny text-warn">{show("name")}</span>}
        </label>
      </div>

      <div className="field">
        <span>권한</span>
        <RolePicker value={role} onChange={setRole} disabled={busy || self} />
        {self && <span className="tiny">내 계정의 권한은 직접 바꿀 수 없어요.</span>}
      </div>

      <div className="field">
        <span>{editing ? "비밀번호 재설정" : "초기 비밀번호"}</span>
        {editing && (
          <label className="row small check-line">
            <input type="checkbox" checked={resetPw} disabled={busy} onChange={(e) => setResetPw(e.target.checked)} />
            새 비밀번호로 재설정
          </label>
        )}
        {resetPw && (
          <div className="form-row top">
            <label className="field">
              <span className="sr-only">{editing ? "새 비밀번호" : "초기 비밀번호"}</span>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="8자 이상"
                autoComplete="new-password" disabled={busy} aria-invalid={!!show("pw")} />
              {show("pw") && <span className="tiny text-warn">{show("pw")}</span>}
            </label>
            <label className="field">
              <span className="sr-only">비밀번호 확인</span>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="한 번 더 입력"
                autoComplete="new-password" disabled={busy} aria-invalid={!!show("pw2")} />
              {show("pw2") && <span className="tiny text-warn">{show("pw2")}</span>}
            </label>
          </div>
        )}
        {resetPw && <span className="tiny">사용자에게 따로 전달해 주세요. 재설정하면 그 사용자의 기존 로그인은 끊겨요.</span>}
      </div>

      <ErrorBox error={err} />
      <div className="actions">
        <button className="btn" onClick={onClose} disabled={busy}>취소</button>
        <button className="btn primary" onClick={submit} disabled={busy}>{busy ? "저장 중…" : editing ? "저장" : "추가"}</button>
      </div>
    </Modal>
  );
}

/** 삭제 확인 창 */
export function DeleteUserModal({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: (msg: string) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscClose(onClose, busy);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await authApi.deleteUser(user.id);
      onDone(`${user.name}(${user.id}) 계정을 삭제했어요.`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title="사용자 삭제" onClose={busy ? () => {} : onClose}>
      <div>
        <b>{user.name}</b> <span className="muted">({user.id})</span> 계정을 삭제할까요?
        <div className="muted small mt-2">삭제하면 되돌릴 수 없어요. 잠시 막아 두려면 ‘사용 중지’를 쓰세요.</div>
      </div>
      <ErrorBox error={err} />
      <div className="actions">
        <button className="btn" onClick={onClose} disabled={busy}>취소</button>
        <button className="btn danger-fill" onClick={run} disabled={busy}>{busy ? "삭제 중…" : "삭제"}</button>
      </div>
    </Modal>
  );
}
