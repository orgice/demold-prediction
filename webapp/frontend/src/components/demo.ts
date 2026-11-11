// 대시보드 '예시 화면' 데이터. 서버 조회가 실패했을 때 사용자가 직접 고를 때만 쓴다 (실제 데이터로 자동 대체하지 않음).
// 숫자는 화면 동작 설명용이며 실제 회차와 무관하다.
import type { Milestone, Pour, Prediction } from "../api/client";
import { addHours } from "../format";

interface DemoSpec { id: number; name: string; site: string; member: "wall" | "slab"; daysAgo: number; su: number; k: number; temp: number; design: number }

const SPECS: DemoSpec[] = [
  { id: -1, name: "예시 1회차", site: "B동 슬래브", member: "slab", daysAgo: 40, su: 30, k: 0.012, temp: 18, design: 27 },
  { id: -2, name: "예시 2회차", site: "A동 벽체", member: "wall", daysAgo: 33, su: 35, k: 0.014, temp: 22, design: 27 },
  { id: -3, name: "예시 3회차", site: "C동 슬래브", member: "slab", daysAgo: 1.5, su: 27, k: 0.011, temp: 24, design: 27 },
];

const hourIso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 13) + ":00:00";

function build(spec: DemoSpec): { pour: Pour; pred: Prediction } {
  const start = hourIso(new Date(Date.now() - spec.daysAgo * 86400_000));
  const obsHours = Math.min(spec.daysAgo * 24, 28 * 24);
  const curve = (m: number) => { const d = Math.max(m - 10, 0); return (spec.su * spec.k * d) / (1 + spec.k * d); };
  let m = 0;
  const series: Prediction["series"] = [];
  for (let h = 0; h <= 28 * 24; h += 1) {
    const temp = spec.temp + 3 * Math.sin((2 * Math.PI * h) / 24) + (h < 24 ? 4 * Math.exp(-((h - 14) ** 2) / 40) : 0);
    m += temp / 24;
    const s = curve(m);
    series.push({ t: addHours(start, h), age_h: h, observed: h <= obsHours, temp: +temp.toFixed(1), maturity: +m.toFixed(1),
      strength: +s.toFixed(2), lower: +(s * 0.8).toFixed(2), upper: +(s * 1.2).toFixed(2) });
  }
  const at = (h: number) => series[Math.min(Math.round(h), series.length - 1)];
  const asOf = at(obsHours);
  const cross = (thr: number, key: "strength" | "lower") => series.find((s) => s[key] >= thr) ?? null;
  const milestones: Milestone[] = [[`벽체 해체 (5 MPa)`, 5], [`슬래브 해체 (14 MPa)`, 14], [`설계기준강도 (${spec.design} MPa)`, spec.design]]
    .map(([label, thr]) => {
      const e = cross(thr as number, "strength"), c = cross(thr as number, "lower");
      return { label: label as string, threshold: thr as number, expected: e?.t ?? null, expected_age_h: e?.age_h ?? null,
        conservative: c?.t ?? null, conservative_age_h: c?.age_h ?? null, observed: null, observed_age_h: null,
        reached_at_as_of: asOf.strength >= (thr as number) };
    });
  const tests = [1, 3, 7, 14, 28].filter((d) => d * 24 <= obsHours)
    .map((d, i) => ({ test_id: i + 1, t: addHours(start, d * 24), age_h: d * 24, fc: +(at(d * 24).strength * (1 + 0.05 * Math.sin(d))).toFixed(1), used_for_calibration: true }));
  const pour: Pour = { id: spec.id, name: spec.name, site: spec.site, pour_start: start, pour_end: null, detected_start: start, detected_end: null,
    design_strength: spec.design, member: spec.member, sensors: [], note: null, test_count: tests.length };
  const s28 = series[series.length - 1].strength;
  const pred: Prediction = {
    pour_id: spec.id, start, as_of: asOf.t, data_end: asOf.t, current_strength: asOf.strength,
    current_range: [asOf.lower, asOf.upper], strength_28d: s28, design_ratio_28d: +(s28 / spec.design).toFixed(3), milestones,
    baseline: obsHours > 24 ? { as_of: addHours(start, 24), hours: 24, milestones: [],
      series: series.map((s) => ({ age_h: s.age_h, strength: +(s.strength * 1.08).toFixed(2) })) } : null,
    series, tests,
    model: { method: "예시", calibrated: tests.length > 0, calibration_scale: 1, calibration_tests: tests.length, sigma: 0.15,
      interval: "90%", train_pours: [], train_specimens: 0, fixed_curve: false, forecast: "예시", params: {} },
  };
  return { pour, pred };
}

let cache: ReturnType<typeof build>[] | null = null;
/** 예시 회차 3개 (완료 2 · 진행 중 1) */
export function demoData() {
  cache ??= SPECS.map(build);
  return cache;
}
