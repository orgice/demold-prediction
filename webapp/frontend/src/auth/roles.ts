// 역할 3단계와 화면에 보여 줄 설명.
// ⚠ 고객 협의 전 초안이다. 확정되면 이 설명과 백엔드 권한 검사를 같이 맞춘다.
import type { Role } from "../api/auth";

export const ROLE_ORDER: Role[] = ["viewer", "editor", "admin"];

export const ROLE_INFO: Record<Role, { label: string; summary: string; can: string[] }> = {
  viewer: {
    label: "보기",
    summary: "데이터 조회만",
    can: ["대시보드·타설 이력·센서 데이터 조회", "AI 상담 질문"],
  },
  editor: {
    label: "편집",
    summary: "회차 등록·설정 수정",
    can: ["보기 권한 전부", "새 타설 등록·CSV 업로드", "회차 설정·공시체 결과 입력·타설 시점 수정", "회차별 변경 기록 조회"],
  },
  admin: {
    label: "관리자",
    summary: "사용자 관리 포함",
    can: ["편집 권한 전부", "사용자 추가·수정·삭제", "계정 사용 중지·재개, 권한 부여", "전체 변경 기록 조회 (로그인·거부된 시도 포함)"],
  },
};

/** 역할 a 가 역할 b 이상인지 */
export const atLeast = (a: Role, b: Role) => ROLE_ORDER.indexOf(a) >= ROLE_ORDER.indexOf(b);
