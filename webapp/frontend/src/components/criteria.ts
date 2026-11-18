// 해체 기준 미리보기 (회차 설정 탭에서 저장 전에 보여 주는 용도).
// 실제로 쓰는 기준은 서버가 계산한다 (backend/app/criteria.py). 규칙을 바꾸면 두 곳을 함께 바꾼다.
//   벽·기둥 측면  : 5 MPa, 내구성 중요 10 MPa
//   슬래브 밑면   : 단층(또는 미선택) max(14, 설계강도 × 2/3), 다층 max(14, 설계강도)
//   직접 입력     : 위 최소값(5 / 10 / 14 MPa) 이상 + 사유 필수
import type { Member, Structure } from "../api/client";

export interface CriterionPreview { strength: number; minimum: number; basis: string; warning: string | null }

export function previewCriterion(member: Member, structure: Structure | null, durable: boolean, design: number | null): CriterionPreview {
  if (member === "wall") {
    return durable
      ? { strength: 10, minimum: 10, basis: "벽·기둥 측면, 내구성 중요 구조물: 10 MPa", warning: null }
      : { strength: 5, minimum: 5, basis: "벽·기둥 측면: 5 MPa", warning: null };
  }
  if (!design) {
    return { strength: 14, minimum: 14, basis: "슬래브 밑면: 최소 14 MPa",
      warning: "설계기준강도를 입력하지 않아 최소값 14 MPa로 계산했습니다. 실제 기준은 더 높을 수 있습니다." };
  }
  if (structure === "multi") {
    return { strength: Math.max(14, design), minimum: 14, basis: `슬래브 밑면, 다층 구조: 설계기준강도 ${design} MPa 이상 (최소 14 MPa)`, warning: null };
  }
  const twoThirds = (design * 2) / 3;
  return {
    strength: Math.round(Math.max(14, twoThirds) * 10) / 10, minimum: 14,
    basis: `슬래브 밑면, 단층 구조: 설계기준강도 ${design} × 2/3 = ${twoThirds.toFixed(1)} MPa와 14 MPa 중 큰 값`,
    warning: structure === "single" ? null : "구조 형식(단층/다층)을 고르지 않아 단층 기준으로 계산했습니다. 다층이면 설계기준강도가 기준입니다.",
  };
}
