// 그래프 공통 부품. 모든 그래프는 ECharts 라이브러리로 그리고, 여기서 색·축·툴팁 모양을 맞춘다.
import ReactECharts from "echarts-for-react";
import { useEffect, useState } from "react";

// 센서 색은 항상 같은 MAC에 같은 색 (순위가 아니라 대상에 따라)
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
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
    text: dark ? "#c3c2b7" : "#52514e",
    strong: dark ? "#f0efec" : "#0b0b0b",
    grid: dark ? "#33332f" : "#e6e5e1",
    surface: dark ? "#1a1a19" : "#fcfcfb",
    accent: dark ? "#3987e5" : "#2a78d6",
    muted: dark ? "#8b93a7" : "#6b7280", // 비교용 기준선 (최초 예상)
  };
}

/** 공통 축/툴팁 스타일을 입힌 ECharts */
export function Chart({ option, height = 320 }: { option: Record<string, unknown>; height?: number }) {
  const th = useChartTheme();
  const axis = {
    axisLine: { lineStyle: { color: th.grid } },
    axisLabel: { color: th.text },
    splitLine: { lineStyle: { color: th.grid } },
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
    tooltip: { trigger: "axis", backgroundColor: th.surface, borderColor: th.grid, textStyle: { color: th.strong },
      ...(option.tooltip as object) },
    legend: { textStyle: { color: th.text }, top: 0, type: "scroll", inactiveColor: th.grid,
      ...(option.legend as object) },
    xAxis: merge(option.xAxis),
    yAxis: merge(option.yAxis),
  };
  return <ReactECharts option={base} style={{ height, width: "100%" }} notMerge lazyUpdate />;
}
