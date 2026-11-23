// 그래프 공통 부품. 모든 그래프는 ECharts 라이브러리로 그리고, 여기서 색·축·툴팁 모양을 맞춘다.
import ReactECharts from "echarts-for-react";
import type { ECharts } from "echarts";
import { useCallback, useEffect, useRef, useState } from "react";

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

/** 좁은 화면(휴대폰) 여부: 그래프 여백·범례 배치를 바꾸는 데 쓴다. 화면 크기가 바뀌면 다시 그린다 */
const NARROW_QUERY = "(max-width: 600px)";
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** 좁은 화면 범례: 스크롤 대신 여러 줄로 감싸고 글자·표식을 줄인다 (그래프 위쪽 여백은 화면별로 늘린다) */
export const NARROW_LEGEND = { type: "plain", itemWidth: 16, itemHeight: 8, itemGap: 8, textStyle: { fontSize: 11 } };

/** 좁은 화면 y축: 숫자는 그래프 밖 왼쪽 좁은 띠에 두되 왼쪽 끝에 맞춘다 (선과 겹치지 않게).
 *  숫자 왼쪽 끝(4px)과 그래프 오른쪽 끝(4px)이 카드에서 같은 거리라 좌우 균형이 맞는다 */
export const NARROW_SIDE = { left: 22, right: 4 };
export const NARROW_Y_AXIS = {
  nameGap: 10, nameTextStyle: { align: "left", padding: [0, 0, 0, -18] },
  axisLabel: { inside: false, align: "left", margin: 18, fontSize: 10 },
};

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

type Series = Record<string, unknown>;
/** 커서 위치 점을 켤 수 있는 선 (점 없이 그린 선) */
const isDotLine = (s: Series) => s.type === "line" && s.symbol === "none";
const DOT_SIZE = 9;
/** 선을 누르면 그 선에만 커서 위치 점이 생긴다 (평소 점은 숨김, 크기 0) */
function withHoverDot(s: Series, surface: string): Series {
  if (!isDotLine(s)) return s;
  return { ...s, symbol: "circle", showSymbol: false, symbolSize: 0, 
    itemStyle: { ...(s.itemStyle as object), borderColor: surface, borderWidth: 2 },
    emphasis: { scale: 1.2, ...(s.emphasis as object) } };
}

/** 십자선 축 라벨: 숫자 값 축이면 fmt 로 (화면별 axisPointer 설정이 있으면 그것을 쓴다) */
function withPointerLabel(a: unknown, fmt: (v: number) => string): unknown {
  const one = (x: Series) => (x.type !== "value" && x.type !== undefined) || x.axisPointer ? x
    : { ...x, axisPointer: { label: { formatter: ({ value }: { value: number }) => fmt(value) } } };
  return Array.isArray(a) ? a.map(one) : a ? one(a as Series) : a;
}

/** 공통 축/툴팁 스타일을 입힌 ECharts */
export function Chart({ option, height = 320 }: { option: Record<string, unknown>; height?: number }) {
  const th = useChartTheme();
  const ref = useRef<ReactECharts>(null);
  // 점을 켠 선 이름 (같은 이름의 선은 함께: 비교 그래프의 한 회차 실측·예측 선). 다시 누르면 끈다
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const srcSeries = Array.isArray(option.series) ? (option.series as Series[]) : [];
  const seriesRef = useRef(srcSeries);
  seriesRef.current = srcSeries;
  const axis = {
    axisLine: { lineStyle: { color: th.grid } },
    axisLabel: { color: th.text },
    splitLine: { lineStyle: { color: th.grid, type: "dashed" } },
    nameTextStyle: { color: th.text },
  };
  // 화면마다 준 x축·y축 설정에 공통 축 색을 덧입힌다 (축이 여러 개면 각각)
  const one = (x: Series) => ({ ...axis, ...x, nameTextStyle: { ...axis.nameTextStyle, ...(x.nameTextStyle as object) } });
  const merge = (a: unknown) => (Array.isArray(a) ? a.map(one) : a ? one(a as Series) : a);
  const base = {
    backgroundColor: "transparent",
    textStyle: { fontFamily: "\"Pretendard Variable\", Pretendard, \"Apple SD Gothic Neo\", \"Malgun Gothic\", sans-serif", color: th.text },
    grid: { left: 52, right: 20, top: 36, bottom: 56 },
    ...option,
    // 툴팁: 흰 면 · 1px 테두리 · 작은 그림자
    // 커서 위치 표시 (십자선): 세로 실선 + 가로 점선, 축 끝에 커서 위치 값 라벨
    tooltip: { trigger: "axis", backgroundColor: th.surface, borderWidth: 1, borderColor: "#E1E5EB", padding: [8, 12],
      extraCssText: "border-radius:6px;box-shadow:0 6px 20px rgba(16,24,40,.12);",
      textStyle: { color: th.strong, fontSize: 13 },
      axisPointer: { type: "cross",
        lineStyle: { color: th.text, width: 1, type: "solid" },
        crossStyle: { color: th.text, width: 1, type: "dashed" },
        label: { backgroundColor: th.strong, color: "#FFFFFF", fontSize: 11, padding: [3, 6], borderRadius: 3 } },
      ...(option.tooltip as object) },
    legend: { type: "scroll", top: 0, inactiveColor: th.grid,
      ...(option.legend as object),
      textStyle: { color: th.text, ...((option.legend as { textStyle?: object } | undefined)?.textStyle) } },
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
    yAxis: withPointerLabel(merge(option.yAxis), (v) => v.toFixed(1)),
    series: Array.isArray(option.series) ? (option.series as Series[]).map((x) => withHoverDot(x, th.surface)) : option.series,
  };
  // 점 크기만 바꿔 덧입힌다 (전체 옵션을 다시 넣으면 확대 상태가 풀리므로)
  useEffect(() => {
    const chart = ref.current?.getEchartsInstance();
    if (!chart) return;
    chart.setOption({ series: srcSeries.map((x) => (isDotLine(x) ? { symbolSize: pinned.has(String(x.name)) ? DOT_SIZE : 0 } : {})) });
  });
  // 선 근처(12px)를 누르면 가장 가까운 선의 점을 켜고 끈다. 얇은 선을 정확히 누르지 않아도 되게 화면 좌표로 찾는다
  const onChartReady = useCallback((chart: ECharts) => {
    chart.getZr().on("click", (e: { offsetX: number; offsetY: number }) => {
      let best: { name: string; d: number } | null = null;
      seriesRef.current.forEach((x, i) => {
        if (!isDotLine(x) || !Array.isArray(x.data)) return;
        let near: number[] | null = null;
        for (const d of x.data as unknown[]) {
          const pt = chart.convertToPixel({ seriesIndex: i }, d as number[]) as number[] | undefined;
          if (!pt || pt.some((v) => !Number.isFinite(v))) continue;
          if (!near || Math.abs(pt[0] - e.offsetX) < Math.abs(near[0] - e.offsetX)) near = pt;
        }
        if (!near || Math.abs(near[0] - e.offsetX) > 12) return;
        const dist = Math.abs(near[1] - e.offsetY);
        if (dist <= 12 && (!best || dist < best.d)) best = { name: String(x.name), d: dist };
      });
      const hit = best as { name: string; d: number } | null;
      if (!hit) return;
      setPinned((cur) => {
        const next = new Set(cur);
        if (next.has(hit.name)) next.delete(hit.name); else next.add(hit.name);
        return next;
      });
    });
  }, []);
  return <ReactECharts ref={ref} option={base} style={{ height, width: "100%" }} notMerge lazyUpdate onChartReady={onChartReady} />;
}
