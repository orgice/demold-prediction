// 로그인·사용자 관리 API (화면은 이 파일의 authApi 만 부른다).
//
// ⚠ 현재는 백엔드 미연동 목업이다. 실제 동작은 authMock.ts 가 브라우저 저장소(localStorage)로 흉내 낸다.
//   - 비밀번호가 브라우저에 그대로 저장되므로 보안이 전혀 없다. 화면 확인용으로만 쓴다.
//   - 백엔드에 인증 API가 생기면 아래 authApi 의 각 함수를 client.ts 처럼 fetch 호출로 바꾸면 된다.
//     (함수 이름·인자·반환 모양을 유지하면 화면 코드는 고치지 않아도 된다.)
//   - 역할 3단계와 각 역할의 권한 범위는 고객 협의 전 초안이다.
import { mockAuth } from "./authMock";

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

export const authApi = {
  /** 로그인. 실패하면 사유가 담긴 Error 를 던진다 */
  login: (id: string, password: string): Promise<User> => mockAuth.login(id, password),
  logout: (): Promise<void> => mockAuth.logout(),
  /** 지금 로그인한 사용자 (없으면 null) */
  me: (): Promise<User | null> => mockAuth.me(),

  // ---- 사용자 관리 (관리자 전용) ----
  users: (q?: string): Promise<User[]> => mockAuth.users(q),
  createUser: (u: NewUser): Promise<User> => mockAuth.createUser(u),
  updateUser: (id: string, patch: UserPatch): Promise<User> => mockAuth.updateUser(id, patch),
  setActive: (id: string, active: boolean): Promise<User> => mockAuth.setActive(id, active),
  deleteUser: (id: string): Promise<void> => mockAuth.deleteUser(id),
};

/** 지금 쓰는 인증 계층이 목업인지 (화면 안내 띠 표시용). 실제 API로 바꾸면 false */
export const AUTH_IS_MOCK = true;
