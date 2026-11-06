import ReactECharts from "echarts-for-react";
import { useEffect, useState } from "react";

// 센서 색은 항상 같은 MAC에 같은 색 (순위가 아니라 대상에 따라)
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const FIXED: Record<string, string> = {

};
export function sensorColor(mac: string, i = 0): string {
  return FIXED[mac] ?? PALETTE[(i + 4) % PALETTE.length];
}

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
  const merge = (a: unknown) =>
    Array.isArray(a) ? a.map((x) => ({ ...axis, ...x })) : a ? { ...axis, ...(a as object) } : a;
  const base = {
    backgroundColor: "transparent",
    textStyle: { fontFamily: "inherit", color: th.text },
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
