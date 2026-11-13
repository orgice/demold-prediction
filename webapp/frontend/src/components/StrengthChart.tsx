// 강도·온도 그래프 (대시보드와 회차 상세에서 같이 쓴다). 화면설계서 1·3·4·9쪽.
//   StrengthChart        회차 하나: 최초 예측(회색 점선) · 실측 기반 추정(파랑 실선) · 수정 예측(주황) · 목표 강도(보라 점선)
//   CompareStrengthChart 여러 회차를 같은 축에: 회차별 고유 색, 실측은 진한 실선, 예측은 옅은 점선
//   TempChart / CompareTempChart  콘크리트 내부온도
import type { Prediction } from "../api/client";
import { fmtAge, fmtDateTime, hoursBetween } from "../format";
import { Chart, useChartTheme } from "./Chart";

/** 그래프 의미별 색 (범례와 같은 색) */
export const LINE = {
  initial: "#9AA2AF",   // 최초 예측 (점선)
  observed: "#397CF5",  // 실측(관측 온도) 기반 추정 — blue
  forecast: "#E99B47",  // 가정 온도 기반 이후 예측 — orange 점선
  target: "#9673D4",    // 목표 강도 (5·14 MPa·설계강도) — purple
};

// 회차 비교 색: 회차 번호(정렬 순서)에 고정. 선택을 바꿔도 같은 회차는 같은 색
const POUR_COLORS = ["#2870FA", "#E99B47", "#397CF5", "#D9709B", "#54BE93", "#818628", "#9673D4", "#3A4F8D"];
export function pourColor(index: number) {
  return POUR_COLORS[((index % POUR_COLORS.length) + POUR_COLORS.length) % POUR_COLORS.length];
}

const day = (h: number) => +(h / 24).toFixed(3);
const f1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

/** 가로축 끝(일): 기본 30일, 공시체를 그보다 늦게 깼으면 그 점까지 보이게 하루 단위로 늘린다 */
function xMaxDay(preds: Prediction[]) {
  return Math.max(30, ...preds.flatMap((p) => p.tests.map((t) => Math.ceil(t.age_h / 24))));
}

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

/** 범례에 커서를 올리면 나오는 설명 */
const LEGEND_HELP: Record<string, string> = {
  "최초 예측": "타설 후 24시간까지의 데이터로 했던 예측입니다. 지금 예측과 비교해 도달이 늦어졌는지 빨라졌는지 봅니다.",
  "실측 기반 추정": "센서가 실제로 잰 내부온도로 계산한 강도입니다. 마지막 데이터 시점까지 그립니다.",
  "수정 예측": "마지막 데이터 이후의 예측입니다. 직전 24시간 온도가 반복된다고 가정하고, 공시체 결과가 있으면 보정해 이어 그립니다.",
  "목표 강도": "벽·기둥 측면 해체 5 MPa, 슬래브 밑면 해체 14 MPa, 그리고 입력한 설계기준강도입니다.",
  "공시체": "현장에서 깬 압축강도 시험 1회의 평균값입니다. 예측이 맞는지 확인하는 실측점입니다.",
  "관측": "센서가 실제로 잰 콘크리트 내부온도입니다.",
  "가정": "마지막 데이터 이후 온도입니다. 직전 24시간 패턴이 반복된다고 가정했습니다.",
};
const legendTip = {
  show: true,
  formatter: (p: { name: string }) =>
    LEGEND_HELP[p.name] ? `<b>${p.name}</b><br/><span style="display:inline-block;max-width:260px;white-space:normal">${LEGEND_HELP[p.name]}</span>` : p.name,
};

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
    legend: { show: !compact, data: ["최초 예측", "실측 기반 추정", "수정 예측", "목표 강도", "공시체"], tooltip: legendTip },
    xAxis: { type: "value", name: compact ? "" : "타설 후 경과일", nameLocation: "middle", nameGap: 28, min: 0, max: xMaxDay([pred]), interval: 7 },
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
          style: { fill: LINE.observed, opacity: 0.10 },
        }) },
      { name: "실측 기반 추정", type: "line", symbol: "none", data: obs.map((s) => [day(s.age_h), s.strength]),
        lineStyle: { width: 2.5, color: LINE.observed }, itemStyle: { color: LINE.observed }, z: 3,
        // 실측 구간 음영 + 현재 시점 세로선
        markArea: { silent: true, itemStyle: { color: LINE.observed, opacity: 0.025 }, data: [[{ xAxis: 0 }, { xAxis: nowX }]] },
        markLine: { symbol: "none", silent: true, lineStyle: { color: th.text, type: "dashed", width: 1 },
          label: { formatter: compact ? `${fmtAge(hoursBetween(pred.start, pred.as_of))}` : nowLabel(pred.as_of) + ` ${fmtAge(hoursBetween(pred.start, pred.as_of))}`,
            position: "end", color: th.strong, fontSize: 11, align: nowX > 14 ? "right" : "left" },
          data: [{ xAxis: nowX }] } },
      { name: "수정 예측", type: "line", symbol: "none", data: fut.map((s) => [day(s.age_h), s.strength]),
        // 가정 온도 기반 예측은 점선 (DESIGN.md 7장: 관측 구간과 색 + 선 종류로 구분)
        lineStyle: { width: 2.5, type: [6, 4], color: LINE.forecast }, itemStyle: { color: LINE.forecast }, z: 2,
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
    xAxis: { type: "value", name: "타설 후 경과일", nameLocation: "middle", nameGap: 28, min: 0, max: xMaxDay(items.map((i) => i.pred)), interval: 7 },
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
    legend: { show: !compact, data: ["관측", "가정"], tooltip: legendTip },
    xAxis: { type: "value", name: compact ? "" : "타설 후 경과일", nameLocation: "middle", nameGap: 28, min: 0, max: xMaxDay([pred]), interval: compact ? 14 : 7 },
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
    xAxis: { type: "value", name: "타설 후 경과일", nameLocation: "middle", nameGap: 24, min: 0, max: xMaxDay(items.map((i) => i.pred)), interval: 7 },
    yAxis: { type: "value", name: "℃", scale: true },
    series: items.map(({ pred, name, color }) => ({
      name, type: "line", symbol: "none", lineStyle: { width: 1.5, color }, itemStyle: { color },
      data: pred.series.filter((s) => s.observed).map((s) => [day(s.age_h), s.temp]),
    })),
  };
  return <Chart option={option} height={height} />;
}
