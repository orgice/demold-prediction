// FormCast 로고 (3안 A 정제형).
// 심볼: 거푸집 패널 세 장으로 짠 F + 파란 타설 블록. 64 그리드, 여백 12, 패널 간격 4.
// 워드마크: Archivo Black 계열을 가로로 넓힌 대문자 FORMCAST (index.html 에서 글꼴을 불러온다).
// 색은 로고 고유색이라 화면 테마 변수와 따로 둔다: Navy #0A2A5E, Pour Blue #1D6FD8.

/** 심볼만 (정사각형). size 는 픽셀. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" fill="#0A2A5E" />
      <rect x="12" y="12" width="12" height="40" fill="#FFFFFF" />
      <rect x="28" y="12" width="24" height="12" fill="#FFFFFF" />
      <rect x="28" y="28" width="16" height="10" fill="#FFFFFF" />
      <rect x="40" y="42" width="12" height="10" fill="#1D6FD8" />
    </svg>
  );
}

/** 상단 막대용 가로형: 심볼 + FORMCAST + 국문 설명 */
export default function BrandLogo() {
  return (
    <span className="brand-logo">
      <BrandMark />
      <span className="brand-word" aria-label="FormCast">FORMCAST</span>
      <span className="brand-sub">거푸집 탈형 시점 예측</span>
    </span>
  );
}
