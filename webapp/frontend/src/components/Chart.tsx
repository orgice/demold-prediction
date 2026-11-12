// 그래프 공통 부품. 모든 그래프는 ECharts 라이브러리로 그리고, 여기서 색·축·툴팁 모양을 맞춘다.
import ReactECharts from "echarts-for-react";
import { useEffect, useState } from "react";

// 센서 색은 항상 같은 MAC에 같은 색 (순위가 아니라 대상에 따라)
// DESIGN.md 7장 (Bezier 원색 400 단계)
const PALETTE = ["#5E56F0", "#F4800B", "#0FB3A3", "#CB48AD", "#329BE7", "#A0A540", "#915CE0", "#E94E58"];
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
    text: dark ? "#A8A8A9" : "#666666",
    strong: dark ? "#D4D4D4" : "#262626",
    grid: dark ? "#464748" : "#EFEFF0",
    surface: dark ? "#313234" : "#FFFFFF",
    accent: dark ? "#6687FF" : "#5E56F0",
    muted: dark ? "#A8A8A9" : "#666666", // 비교용 기준선 (최초 예상)
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
    textStyle: { fontFamily: "inherit", color: th.text },
    grid: { left: 52, right: 20, top: 36, bottom: 56 },
    ...option,
    // 툴팁: 흰 면 · 모서리 8px · ev-3 그림자 · 테두리 없음
    tooltip: { trigger: "axis", backgroundColor: th.surface, borderWidth: 0, padding: [8, 12],
      extraCssText: "border-radius:8px;box-shadow:0 0 2px rgba(0,0,0,.05),0 4px 12px rgba(0,0,0,.15);",
      textStyle: { color: th.strong, fontSize: 13 },
      ...(option.tooltip as object) },
    legend: { textStyle: { color: th.text }, top: 0, type: "scroll", inactiveColor: th.grid,
      ...(option.legend as object) },
    xAxis: merge(option.xAxis),
    yAxis: merge(option.yAxis),
  };
  return <ReactECharts option={base} style={{ height, width: "100%" }} notMerge lazyUpdate />;
}
