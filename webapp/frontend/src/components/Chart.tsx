// 그래프 공통 부품. 모든 그래프는 ECharts 라이브러리로 그리고, 여기서 색·축·툴팁 모양을 맞춘다.
import ReactECharts from "echarts-for-react";
import { useEffect, useState } from "react";

// 센서 색은 항상 같은 MAC에 같은 색 (순위가 아니라 대상에 따라)
// Shopeers-inspired palette; sensor assignment order stays unchanged.
const PALETTE = ["#2870FA", "#F49A45", "#54BE93", "#D9709B", "#4586ED", "#9AA354", "#9673D4", "#D96589"];
// 특정 센서에 색을 고정하고 싶으면 여기에 적는다. 예: "9288": "#2a78d6"
const FIXED: Record<string, string> = {

};
/** 센서 색: 고정 색이 있으면 그것, 없으면 목록 순서(i)로 팔레트에서 고른다 */
export function sensorColor(mac: string, i = 0): string {
  return FIXED[mac] ?? PALETTE[(i + 4) % PALETTE.length];
}

/** 컴퓨터가 다크 모드인지 (바뀌면 그래프 색도 바로 바뀜) */
function useDark() {
  const q = window.matchMedia("(prefers-color-scheme: dark)");
  const [dark, setDark] = useState(q.matches);
  useEffect(() => {
    const f = (e: MediaQueryListEvent) => setDark(e.matches);
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, [q]);
  return dark;
}

/** 다크/라이트 모드에 맞는 그래프 색 모음 */
export function useChartTheme() {
  const dark = useDark();
  return {
    text: dark ? "#A8A8A9" : "#858D9C",
    strong: dark ? "#D4D4D4" : "#171C25",
    grid: dark ? "#464748" : "#ECEEF3",
    surface: dark ? "#313234" : "#FFFFFF",
    accent: dark ? "#6687FF" : "#2870FA",
    muted: dark ? "#A8A8A9" : "#858D9C", // 비교용 기준선 (최초 예상)
  };
}

/** 공통 축/툴팁 스타일을 입힌 ECharts */
export function Chart({ option, height = 320 }: { option: Record<string, unknown>; height?: number }) {
  const th = useChartTheme();
  const axis = {
    axisLine: { lineStyle: { color: th.grid } },
    axisLabel: { color: th.text },
    splitLine: { lineStyle: { color: th.grid, type: "dashed" } },
    nameTextStyle: { color: th.text },
  };
  // 화면마다 준 x축·y축 설정에 공통 축 색을 덧입힌다 (축이 여러 개면 각각)
  const merge = (a: unknown) =>
    Array.isArray(a) ? a.map((x) => ({ ...axis, ...x })) : a ? { ...axis, ...(a as object) } : a;
  const base = {
    backgroundColor: "transparent",
    textStyle: { fontFamily: "\"Pretendard Variable\", Pretendard, \"Apple SD Gothic Neo\", \"Malgun Gothic\", sans-serif", color: th.text },
    grid: { left: 52, right: 20, top: 36, bottom: 56 },
    ...option,
    // 툴팁: 흰 면 · 둥근 모서리 · 얇은 내부 테두리
    tooltip: { trigger: "axis", backgroundColor: th.surface, borderWidth: 0, padding: [8, 12],
      extraCssText: "border-radius:14px;box-shadow:inset 0 0 0 1px rgba(130,145,170,.16),0 8px 28px rgba(32,51,85,.12);",
      textStyle: { color: th.strong, fontSize: 13 },
      ...(option.tooltip as object) },
    legend: { textStyle: { color: th.text }, top: 0, type: "scroll", inactiveColor: th.grid,
      ...(option.legend as object) },
    xAxis: merge(option.xAxis),
    yAxis: merge(option.yAxis),
  };
  return <ReactECharts option={base} style={{ height, width: "100%" }} notMerge lazyUpdate />;
}
