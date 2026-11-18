// 로그인·사용자 관리 API (화면은 이 파일의 authApi 만 부른다).
//
// 백엔드: routers/auth.py (로그인·로그아웃·내 정보), routers/users.py (사용자 관리, 관리자 전용)
// 로그인 상태는 서버가 주는 HttpOnly 쿠키로 유지된다. 화면과 API가 같은 주소(nginx·vite 프록시)라
// 브라우저가 쿠키를 자동으로 붙여 보내므로, 다른 API 호출 코드는 따로 할 일이 없다.
// 역할 3단계와 각 역할의 권한 범위는 고객 협의 전 초안이다.
import { json, request } from "./client";

/** 역할 3단계 (초안): 보기 < 편집 < 관리자 */
export type Role = "viewer" | "editor" | "admin";

/** 사용자 한 명. id 는 로그인 ID */
export interface User {
  id: string;
  name: string;
  role: Role;
  active: boolean;     // false 면 사용 중지 (로그인 불가)
  created_at: string;  // 현지 시각 "YYYY-MM-DDTHH:MM:SS"
}

export interface NewUser { id: string; name: string; role: Role; password: string }
export interface UserPatch { name?: string; role?: Role; password?: string }
/**
 * 내 계정 수정 (로그인한 본인). 권한·사용 상태는 바꿀 수 없다.
 * ID·비밀번호를 바꿀 때는 current_password(현재 비밀번호) 확인이 필요하다.
 * ⚠ 실제 서비스에서 ID 변경을 허용할지는 고객·백엔드 협의가 필요하다 (이력·감사 기록과 연결되므로).
 */
export interface MyAccountPatch { current_password?: string; new_id?: string; name?: string; new_password?: string }

const enc = encodeURIComponent;

export const authApi = {
  /** 로그인. 실패하면 사유가 담긴 Error 를 던진다 */
  login: (id: string, password: string) => request<User>("/api/auth/login", json("POST", { id, password })),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  /** 지금 로그인한 사용자 (없으면 null) */
  me: () => request<User | null>("/api/auth/me"),
  /** 내 계정 수정 (모든 역할). ID를 바꾸면 로그인 상태는 새 ID로 이어진다 */
  updateMe: (patch: MyAccountPatch) => request<User>("/api/auth/me", json("PATCH", patch)),

  // ---- 사용자 관리 (관리자 전용) ----
  users: (q?: string) => request<User[]>(`/api/users${q?.trim() ? `?q=${enc(q.trim())}` : ""}`),
  createUser: (u: NewUser) => request<User>("/api/users", json("POST", u)),
  updateUser: (id: string, patch: UserPatch) => request<User>(`/api/users/${enc(id)}`, json("PATCH", patch)),
  setActive: (id: string, active: boolean) => request<User>(`/api/users/${enc(id)}/active`, json("PATCH", { active })),
  deleteUser: (id: string) => request<void>(`/api/users/${enc(id)}`, { method: "DELETE" }),
};
