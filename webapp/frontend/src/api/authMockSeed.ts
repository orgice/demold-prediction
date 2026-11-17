// ⚠ 백엔드 미연동 목업용 예시 계정.
// 브라우저 저장소(localStorage)가 비어 있을 때 한 번만 넣는다. 실제 서비스 계정이 아니다.
// 실제 API 연동 시 이 파일과 authMock.ts는 지운다.
import type { Role } from "./auth";

export interface SeedUser { id: string; name: string; role: Role; password: string; active: boolean }

export const SEED_USERS: SeedUser[] = [
  { id: "admin", name: "관리자(예시)", role: "admin", password: "admin1234", active: true },
  { id: "editor", name: "편집 담당(예시)", role: "editor", password: "editor1234", active: true },
  { id: "viewer", name: "현장 조회(예시)", role: "viewer", password: "viewer1234", active: true },
  { id: "paused", name: "사용 중지 계정(예시)", role: "viewer", password: "paused1234", active: false },
];
