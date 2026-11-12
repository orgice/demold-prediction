// 강도·온도 그래프 (대시보드와 회차 상세에서 같이 쓴다). 화면설계서 1·3·4·9쪽.
//   StrengthChart        회차 하나: 최초 예측(회색 점선) · 실측 기반 추정(초록 실선) · 수정 예측(주황) · 목표 강도(보라 점선)
//   CompareStrengthChart 여러 회차를 같은 축에: 회차별 고유 색, 실측은 진한 실선, 예측은 옅은 점선
//   TempChart / CompareTempChart  콘크리트 내부온도
import type { Prediction } from "../api/client";
import { fmtAge, fmtDateTime, hoursBetween } from "../format";
import { Chart, useChartTheme } from "./Chart";

/** 그래프 의미별 색 (범례와 같은 색) */
export const LINE = {
  initial: "#666666",   // 최초 예측 (점선)
  observed: "#0FB3A3",  // 실측(관측 온도) 기반 추정 — teal
  forecast: "#F4800B",  // 가정 온도 기반 이후 예측 — orange
  target: "#915CE0",    // 목표 강도 (5·14 MPa·설계강도) — purple
};

// 회차 비교 색: 회차 번호(정렬 순서)에 고정. 선택을 바꿔도 같은 회차는 같은 색
const POUR_COLORS = ["#5E56F0", "#F4800B", "#0FB3A3", "#CB48AD", "#329BE7", "#818628", "#915CE0", "#3A4F8D"];
export function pourColor(index: number) {
  return POUR_COLORS[((index % POUR_COLORS.length) + POUR_COLORS.length) % POUR_COLORS.length];
}

const day = (h: number) => +(h / 24).toFixed(3);
const f1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

/** 공시체 시험 1회 = 점 하나 (예전에 3개씩 넣은 결과는 평균) */
export function testPoints(pred: Prediction, used?: boolean) {
  const groups = new Map<number, { age_h: number; sum: number; n: number; used: boolean }>();
  for (const t of pred.tests) {
    if (used != null && t.used_for_calibration !== used) continue;
    const g = groups.get(t.test_id) ?? { age_h: t.age_h, sum: 0, n: 0, used: t.used_for_calibration };
    g.sum += t.fc; g.n += 1;
    groups.set(t.test_id, g);
  }
  return [...groups.values()].map((g) => ({ age_h: g.age_h, fc: +(g.sum / g.n).toFixed(2), used: g.used }));
}

/** 마지막 데이터가 1시간 이내면 "현재", 아니면 마지막 데이터 시각 */
export function nowLabel(asOf: string) {
  return Date.now() - new Date(asOf).getTime() <= 3600_000 ? "현재" : `마지막 데이터 ${fmtDateTime(asOf)}`;
}

/** 타설 후 28일까지 실측 온도가 다 있는 회차 = 측정 완료 */
export function isComplete(pred: Prediction) {
  return hoursBetween(pred.start, pred.data_end) >= 28 * 24 - 1;
}

/** 목표 강도 가로선: 벽체 5, 슬래브 14, 설계강도 */
function targetLines(design: number | null | undefined) {
  return [5, 14, ...(design ? [design] : [])].map((v) => ({ yAxis: v, name: `${v} MPa` }));
}

/** 회차 하나의 압축강도 그래프 (화면설계서 1·9쪽) */
export function StrengthChart({ pred, design, height = 380, compact = false, yMax }: {
  pred: Prediction; design: number | null; height?: number; compact?: boolean; yMax?: number;
}) {
  const th = useChartTheme();
  const nowX = day(hoursBetween(pred.start, pred.as_of));
  const obs = pred.series.filter((s) => s.observed);
  // 수정 예측은 실측 끝점에서 이어지게 마지막 실측점부터 그린다
  const fut = pred.series.filter((s, i, a) => !s.observed || (a[i + 1] && !a[i + 1].observed));
  const tests = testPoints(pred);
  const option = {
    grid: compact ? { left: 36, right: 12, top: 28, bottom: 28 } : { left: 48, right: 64, top: 40, bottom: 76 },
    tooltip: {
      trigger: "axis",
      formatter: (params: { seriesName: string; value: number[]; marker: string }[]) => {
        const x = params[0]?.value[0];
        if (x == null) return "";
        const s = pred.series.reduce((a, b) => (Math.abs(day(b.age_h) - x) < Math.abs(day(a.age_h) - x) ? b : a));
        const base = pred.baseline?.series.find((b) => b.age_h === s.age_h);
        return [
          `<b>${fmtDateTime(s.t)}</b> · 타설 후 ${fmtAge(s.age_h)}`,
          `${s.observed ? "실측 기반 추정" : "수정 예측"} <b>${f1(s.strength)} MPa</b> (90% ${f1(s.lower)}–${f1(s.upper)})`,
          ...(base ? [`최초 예측 ${f1(base.strength)} MPa`] : []),
          `적산온도 ${f1(s.maturity)} ℃·일 · 내부온도 ${s.temp == null ? "—" : `${f1(s.temp)} ℃`} (${s.observed ? "관측" : "가정"})`,
          ...params.filter((p) => p.seriesName === "공시체").map((p) => `${p.marker}공시체 평균 ${f1(p.value[1])} MPa`),
        ].join("<br/>");
      },
    },
    legend: { show: !compact, data: ["최초 예측", "실측 기반 추정", "수정 예측", "목표 강도", "공시체"] },
    xAxis: { type: "value", name: compact ? "" : "타설 후 경과일", nameLocation: "middle", nameGap: 28, min: 0, max: 28, interval: 7 },
    yAxis: { type: "value", name: "MPa", min: 0, max: yMax },
    dataZoom: compact ? [] : [{ type: "inside" }, { type: "slider", height: 18, bottom: 4 }],
    series: [
      { // 90% 범위 음영
        name: "범위", type: "custom", silent: true, tooltip: { show: false }, data: [0], z: 0, clip: true,
        renderItem: (_: unknown, api: { coord: (p: number[]) => number[] }) => ({
          type: "polygon",
          shape: { points: [
            ...pred.series.map((s) => api.coord([day(s.age_h), s.upper])),
            ...[...pred.series].reverse().map((s) => api.coord([day(s.age_h), s.lower])),
          ] },
          style: { fill: LINE.forecast, opacity: 0.12 },
        }) },
      { name: "실측 기반 추정", type: "line", symbol: "none", data: obs.map((s) => [day(s.age_h), s.strength]),
        lineStyle: { width: 2.5, color: LINE.observed }, itemStyle: { color: LINE.observed }, z: 3,
        // 실측 구간 음영 + 현재 시점 세로선
        markArea: { silent: true, itemStyle: { color: LINE.observed, opacity: 0.07 }, data: [[{ xAxis: 0 }, { xAxis: nowX }]] },
        markLine: { symbol: "none", silent: true, lineStyle: { color: th.text, type: "dashed", width: 1 },
          label: { formatter: compact ? `${fmtAge(hoursBetween(pred.start, pred.as_of))}` : nowLabel(pred.as_of) + ` ${fmtAge(hoursBetween(pred.start, pred.as_of))}`,
            position: "end", color: th.strong, fontSize: 11, align: nowX > 14 ? "right" : "left" },
          data: [{ xAxis: nowX }] } },
      { name: "수정 예측", type: "line", symbol: "none", data: fut.map((s) => [day(s.age_h), s.strength]),
        lineStyle: { width: 2.5, color: LINE.forecast }, itemStyle: { color: LINE.forecast }, z: 2,
        endLabel: compact ? undefined : { show: true, formatter: `${f1(pred.strength_28d)} MPa`, color: LINE.forecast, fontWeight: 700 } },
      ...(pred.baseline ? [{
        name: "최초 예측", type: "line", symbol: "none", z: 1,
        data: pred.baseline.series.map((b) => [day(b.age_h), b.strength]),
        lineStyle: { width: 2, type: [8, 5], color: LINE.initial }, itemStyle: { color: LINE.initial },
      }] : []),
      { name: "목표 강도", type: "line", data: [], itemStyle: { color: LINE.target }, lineStyle: { type: "dotted", color: LINE.target },
        markLine: { symbol: "none", silent: true, lineStyle: { color: LINE.target, type: "dotted", width: 1 },
          label: { show: !compact, formatter: "{b}", position: "end", color: LINE.target, fontSize: 11 }, data: targetLines(design) } },
      { name: "공시체", type: "scatter", symbolSize: compact ? 7 : 10, z: 4,
        data: tests.map((t) => [day(t.age_h), t.fc]),
        itemStyle: { color: th.strong, borderColor: th.surface, borderWidth: 2 } },
    ],
  };
  return <Chart option={option} height={height} />;
}

export interface CompareItem { pred: Prediction; name: string; color: string }

/** 여러 회차를 같은 경과일 축에 (화면설계서 3쪽) */
export function CompareStrengthChart({ items, design, height = 400 }: { items: CompareItem[]; design?: number | null; height?: number }) {
  const th = useChartTheme();
  const series = items.flatMap(({ pred, name, color }) => {
    const done = isComplete(pred);
    const obs = pred.series.filter((s) => s.observed).map((s) => [day(s.age_h), s.strength]);
    const fut = pred.series.filter((s, i, a) => !s.observed || (a[i + 1] && !a[i + 1].observed)).map((s) => [day(s.age_h), s.strength]);
    const nowX = day(hoursBetween(pred.start, pred.as_of));
    return [
      { name, type: "line", symbol: "none", data: obs, lineStyle: { width: 2.5, color }, itemStyle: { color },
        // 진행 중 회차는 마지막 실측 시점에 세로선 (라벨은 겹치므로 범례·요약으로 대신)
        markLine: done ? undefined : { symbol: "none", silent: true, lineStyle: { color, type: "solid", width: 1, opacity: 0.6 },
          label: { show: false }, data: [{ xAxis: nowX }] } },
      ...(done ? [] : [{ name, type: "line", symbol: "none", data: fut,
        lineStyle: { width: 2, type: "dotted", color, opacity: 0.55 }, itemStyle: { color } }]),
      { name, type: "scatter", symbolSize: 8, data: testPoints(pred).map((t) => [day(t.age_h), t.fc]),
        itemStyle: { color, borderColor: th.surface, borderWidth: 1.5 } },
    ];
  });
  const option = {
    grid: { left: 56, right: 24, top: 40, bottom: 76 },
    tooltip: { trigger: "item", formatter: (p: { seriesName: string; value: number[] }) =>
      `${p.seriesName} · 타설 후 ${p.value[0].toFixed(1)}일<br/><b>${f1(p.value[1])} MPa</b>` },
    legend: { data: items.map((i) => i.name) },
    xAxis: { type: "value", name: "타설 후 경과일", nameLocation: "middle", nameGap: 28, min: 0, max: 28, interval: 7 },
    yAxis: { type: "value", name: "MPa", min: 0 },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 4 }],
    series: [...series,
      { name: "목표 강도", type: "line", data: [], markLine: { symbol: "none", silent: true,
        lineStyle: { color: LINE.target, type: "dashed", width: 1 }, label: { formatter: "{b}", color: LINE.target, fontSize: 11, position: "start" },
        data: targetLines(design) } }],
  };
  return <Chart option={option} height={height} />;
}

/** 회차 하나의 내부온도: 실선 = 관측, 점선 = 가정 (직전 24시간 반복) */
export function TempChart({ pred, height = 220, compact = false }: { pred: Prediction; height?: number; compact?: boolean }) {
  const th = useChartTheme();
  const option = {
    grid: compact ? { left: 36, right: 12, top: 16, bottom: 24 } : undefined,
    tooltip: { trigger: "axis", valueFormatter: (v: number) => (v == null ? "—" : `${Number(v).toFixed(1)} ℃`) },
    legend: { show: !compact, data: ["관측", "가정"] },
    xAxis: { type: "value", name: compact ? "" : "타설 후 경과일", nameLocation: "middle", nameGap: 28, min: 0, max: 28, interval: compact ? 14 : 7 },
    yAxis: { type: "value", name: "℃", scale: true },
    series: [
      { name: "관측", type: "line", symbol: "none", lineStyle: { width: 1.5, color: th.accent }, itemStyle: { color: th.accent },
        data: pred.series.filter((s) => s.observed).map((s) => [day(s.age_h), s.temp]) },
      { name: "가정", type: "line", symbol: "none", lineStyle: { width: 1.5, type: "dashed", color: th.text }, itemStyle: { color: th.text },
        data: pred.series.filter((s) => !s.observed).map((s) => [day(s.age_h), s.temp]) },
    ],
  };
  return <Chart option={option} height={height} />;
}

/** 여러 회차의 관측 내부온도 (예측 없음, 마지막 측정 시점까지만) */
export function CompareTempChart({ items, height = 200 }: { items: CompareItem[]; height?: number }) {
  const option = {
    grid: { left: 56, right: 24, top: 32, bottom: 40 },
    tooltip: { trigger: "axis", valueFormatter: (v: number) => (v == null ? "—" : `${Number(v).toFixed(1)} ℃`) },
    legend: { data: items.map((i) => i.name) },
    xAxis: { type: "value", name: "타설 후 경과일", nameLocation: "middle", nameGap: 24, min: 0, max: 28, interval: 7 },
    yAxis: { type: "value", name: "℃", scale: true },
    series: items.map(({ pred, name, color }) => ({
      name, type: "line", symbol: "none", lineStyle: { width: 1.5, color }, itemStyle: { color },
      data: pred.series.filter((s) => s.observed).map((s) => [day(s.age_h), s.temp]),
    })),
  };
  return <Chart option={option} height={height} />;
}
