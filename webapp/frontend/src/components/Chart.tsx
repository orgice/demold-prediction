// 그래프 공통 부품. 모든 그래프는 ECharts 라이브러리로 그리고, 여기서 색·축·툴팁 모양을 맞춘다.
import ReactECharts from "echarts-for-react";

// 센서 색은 항상 같은 MAC에 같은 색 (순위가 아니라 대상에 따라)
// 밝은 업무용 팔레트: 흰 바탕에서 구분되는 중간 채도
const PALETTE = ["#1D5BD6", "#E07A00", "#0E9384", "#C23B7A", "#6941C6", "#6E8B1E", "#0B8BC7", "#B42318"];
// 특정 센서에 색을 고정하고 싶으면 여기에 적는다. 예: "9288": "#2a78d6"
const FIXED: Record<string, string> = {

};
/** 센서 색: 고정 색이 있으면 그것, 없으면 목록 순서(i)로 팔레트에서 고른다 */
export function sensorColor(mac: string, i = 0): string {
  return FIXED[mac] ?? PALETTE[(i + 4) % PALETTE.length];
}

/** 그래프 공통 색 (앱은 밝은 테마 하나만 쓴다) */
export function useChartTheme() {
  return {
    text: "#546070",
    strong: "#18202C",
    grid: "#E6E9EE",
    surface: "#FFFFFF",
    accent: "#1D5BD6",
    muted: "#8892A0", // 비교용 기준선 (최초 예상)
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
    // 툴팁: 흰 면 · 1px 테두리 · 작은 그림자
    tooltip: { trigger: "axis", backgroundColor: th.surface, borderWidth: 1, borderColor: "#E1E5EB", padding: [8, 12],
      extraCssText: "border-radius:6px;box-shadow:0 6px 20px rgba(16,24,40,.12);",
      textStyle: { color: th.strong, fontSize: 13 },
      ...(option.tooltip as object) },
    legend: { textStyle: { color: th.text }, top: 0, type: "scroll", inactiveColor: th.grid,
      ...(option.legend as object) },
    // 확대 막대는 색만 맞춘다 (범위·크기·동작은 화면별 설정 그대로)
    dataZoom: Array.isArray(option.dataZoom) ? option.dataZoom.map((zoom) => ({
      backgroundColor: "#F6F7F9", borderColor: th.grid, fillerColor: "rgba(29,91,214,.10)",
      textStyle: { color: th.text },
      dataBackground: { lineStyle: { color: th.text }, areaStyle: { color: th.grid } },
      selectedDataBackground: { lineStyle: { color: th.accent }, areaStyle: { color: th.accent } },
      handleStyle: { color: "#FFFFFF", borderColor: "#C9D0D9" },
      moveHandleStyle: { color: "#C9D0D9" },
      ...zoom,
    })) : option.dataZoom,
    xAxis: merge(option.xAxis),
    yAxis: merge(option.yAxis),
  };
  return <ReactECharts option={base} style={{ height, width: "100%" }} notMerge lazyUpdate />;
}
