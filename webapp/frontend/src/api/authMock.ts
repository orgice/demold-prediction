// ⚠ 백엔드 미연동 목업: 로그인·사용자 관리를 브라우저 저장소(localStorage)로 흉내 낸다.
// 화면 동작 확인용이며 보안 기능이 없다 (비밀번호를 평문으로 저장, 누구나 개발자 도구로 바꿀 수 있음).
// 실제 API 연동 시 auth.ts 의 authApi 가 이 파일 대신 서버를 부르게 바꾸고 이 파일은 지운다.
import type { MyAccountPatch, NewUser, Role, User, UserPatch } from "./auth";
import { SEED_USERS } from "./authMockSeed";

const USERS_KEY = "formcast.mock.users";
const SESSION_KEY = "formcast.mock.session";
const ROLES: Role[] = ["viewer", "editor", "admin"];

interface Stored extends User { password: string }

/** 다른 화면과 같은 형식의 현지 시각 문자열 ("2026-11-17T09:30:00") */
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 19); };

const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));

function read(): Stored[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw) return JSON.parse(raw) as Stored[];
  } catch { /* 저장소를 못 쓰면 시드로 시작 */ }
  const now = nowLocal();
  const seeded = SEED_USERS.map((u) => ({ ...u, created_at: now }));
  write(seeded);
  return seeded;
}
function write(list: Stored[]) {
  try { localStorage.setItem(USERS_KEY, JSON.stringify(list)); } catch { /* 무시 */ }
}
const strip = ({ password: _pw, ...u }: Stored): User => u;

function sessionId(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}
function setSession(id: string | null) {
  try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch { /* 무시 */ }
}

/** 관리자 전용 작업 확인 (실제 서버도 같은 검사를 해야 한다) */
function requireAdmin(list: Stored[]) {
  const me = list.find((u) => u.id === sessionId());
  if (!me || !me.active || me.role !== "admin") throw new Error("관리자만 할 수 있어요.");
  return me;
}

/** 남는 활성 관리자 수 (마지막 관리자를 없애지 않도록) */
const activeAdmins = (list: Stored[]) => list.filter((u) => u.role === "admin" && u.active).length;

function checkId(id: string) {
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(id)) throw new Error("ID는 영문·숫자·. _ - 로 3~32자여야 해요.");
}

function checkPassword(pw: string) {
  if (pw.length < 8) throw new Error("비밀번호는 8자 이상으로 입력해 주세요.");
}

export const mockAuth = {
  async login(id: string, password: string): Promise<User> {
    await delay(600);
    const u = read().find((x) => x.id === id.trim());
    if (!u || u.password !== password) throw new Error("ID 또는 비밀번호가 맞지 않아요.");
    if (!u.active) throw new Error("사용 중지된 계정이에요. 관리자에게 문의해 주세요.");
    setSession(u.id);
    return strip(u);
  },

  async logout() {
    await delay(100);
    setSession(null);
  },

  async me(): Promise<User | null> {
    const id = sessionId();
    if (!id) return null;
    const u = read().find((x) => x.id === id);
    if (!u || !u.active) { setSession(null); return null; }   // 지워졌거나 중지된 계정은 로그아웃
    return strip(u);
  },

  /** 내 계정 수정. ID·비밀번호 변경은 현재 비밀번호 확인 필요. 권한·사용 상태는 손대지 않는다 */
  async updateMe(patch: MyAccountPatch): Promise<User> {
    await delay();
    const list = read();
    const me = list.find((u) => u.id === sessionId());
    if (!me || !me.active) throw new Error("로그인이 필요해요. 다시 로그인해 주세요.");
    const next: Stored = { ...me };
    const newId = patch.new_id?.trim();
    const changingId = !!newId && newId !== me.id;
    if ((changingId || patch.new_password) && patch.current_password !== me.password) {
      throw new Error("현재 비밀번호가 맞지 않아요.");
    }
    if (changingId) {
      checkId(newId!);
      if (list.some((u) => u.id !== me.id && u.id.toLowerCase() === newId!.toLowerCase())) throw new Error(`이미 있는 ID예요: ${newId}`);
      next.id = newId!;
    }
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new Error("이름을 입력해 주세요.");
      next.name = patch.name.trim();
    }
    if (patch.new_password) { checkPassword(patch.new_password); next.password = patch.new_password; }
    write(list.map((u) => (u.id === me.id ? next : u)));
    if (changingId) setSession(next.id);   // 로그인 상태를 새 ID로 이어 간다
    return strip(next);
  },

  async users(q?: string): Promise<User[]> {
    await delay();
    const list = read();
    requireAdmin(list);
    const k = (q ?? "").trim().toLowerCase();
    return list
      .filter((u) => !k || u.id.toLowerCase().includes(k) || u.name.toLowerCase().includes(k))
      .map(strip);
  },

  async createUser(nu: NewUser): Promise<User> {
    await delay();
    const list = read();
    requireAdmin(list);
    const id = nu.id.trim();
    checkId(id);
    if (list.some((u) => u.id.toLowerCase() === id.toLowerCase())) throw new Error(`이미 있는 ID예요: ${id}`);
    if (!nu.name.trim()) throw new Error("이름을 입력해 주세요.");
    if (!ROLES.includes(nu.role)) throw new Error("권한을 선택해 주세요.");
    checkPassword(nu.password);
    const u: Stored = { id, name: nu.name.trim(), role: nu.role, password: nu.password, active: true, created_at: nowLocal() };
    write([...list, u]);
    return strip(u);
  },

  async updateUser(id: string, patch: UserPatch): Promise<User> {
    await delay();
    const list = read();
    const me = requireAdmin(list);
    const u = list.find((x) => x.id === id);
    if (!u) throw new Error("사용자를 찾을 수 없어요.");
    const next: Stored = { ...u };
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new Error("이름을 입력해 주세요.");
      next.name = patch.name.trim();
    }
    if (patch.role !== undefined && patch.role !== u.role) {
      if (u.id === me.id) throw new Error("내 계정의 권한은 직접 바꿀 수 없어요. 다른 관리자에게 요청해 주세요.");
      next.role = patch.role;
    }
    if (patch.password) { checkPassword(patch.password); next.password = patch.password; }
    const after = list.map((x) => (x.id === id ? next : x));
    if (activeAdmins(after) === 0) throw new Error("활성 관리자가 최소 1명은 있어야 해요.");
    write(after);
    return strip(next);
  },

  async setActive(id: string, active: boolean): Promise<User> {
    await delay();
    const list = read();
    const me = requireAdmin(list);
    if (id === me.id && !active) throw new Error("내 계정은 사용 중지할 수 없어요.");
    const after = list.map((x) => (x.id === id ? { ...x, active } : x));
    if (activeAdmins(after) === 0) throw new Error("활성 관리자가 최소 1명은 있어야 해요.");
    write(after);
    return strip(after.find((x) => x.id === id)!);
  },

  async deleteUser(id: string): Promise<void> {
    await delay();
    const list = read();
    const me = requireAdmin(list);
    if (id === me.id) throw new Error("내 계정은 삭제할 수 없어요.");
    const after = list.filter((x) => x.id !== id);
    if (activeAdmins(after) === 0) throw new Error("활성 관리자가 최소 1명은 있어야 해요.");
    write(after);
  },
};

/** 목업 저장소를 예시 계정으로 되돌린다 (사용자 관리 화면의 '예시 데이터로 초기화') */
export function resetMockUsers() {
  try { localStorage.removeItem(USERS_KEY); } catch { /* 무시 */ }
  read();
}
