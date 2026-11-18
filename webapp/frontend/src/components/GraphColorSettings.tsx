// [내 계정 › 그래프 색 설정] 기본은 접힘, 제목 줄을 누르면 펼친다.
// 그래프 선 색과 목표 강도선 색을 고르면 대시보드·회차 상세의 모든 강도·온도 그래프에 바로 적용된다.
// 계정이 백엔드 미연동 목업이라 색은 이 브라우저에만 저장한다 (chartColors.ts).
import { useId, useMemo, useState } from "react";
import type { Prediction } from "../api/client";
import {
  COLOR_PRESETS, DEFAULT_LINE_COLORS, LineColors, LineKey, resetLineColors, setLineColor, useLineColors,
} from "./chartColors";
import { demoData } from "./demo";
import { StrengthChart, TempChart } from "./StrengthChart";

type Dash = "solid" | "dash" | "dot";
interface Row { key: LineKey; name: string; help: string; dash: Dash }
interface Group { title: string; help: string; rows: Row[]; /** 같은 그래프에 함께 그려지는 선 (색 겹침 확인용) */ together: LineKey[] }

const STRENGTH_KEYS: LineKey[] = ["observed", "forecast", "initial", "target5", "target14", "targetDesign"];
const GROUPS: Group[] = [
  {
    title: "압축강도 그래프 선",
    help: "90% 예측 범위 음영은 실측 기반 추정과 같은 색을 씁니다.",
    together: STRENGTH_KEYS,
    rows: [
      { key: "observed", name: "실측 기반 추정", help: "센서가 잰 내부온도로 계산한 강도", dash: "solid" },
      { key: "forecast", name: "수정 예측", help: "마지막 데이터 이후, 가정 온도로 이어 그린 예측", dash: "dash" },
      { key: "initial", name: "최초 예측", help: "타설 후 24시간까지의 데이터로 했던 예측", dash: "dash" },
    ],
  },
  {
    title: "목표 강도선",
    help: "강도 그래프의 가로 기준선입니다. 회차 비교 그래프에도 같은 색을 씁니다.",
    together: STRENGTH_KEYS,
    rows: [
      { key: "target5", name: "5 MPa", help: "벽·기둥 측면 거푸집 해체 기준", dash: "dot" },
      { key: "target14", name: "14 MPa", help: "슬래브 밑면 거푸집 해체 기준", dash: "dot" },
      { key: "targetDesign", name: "설계기준강도", help: "회차에 입력한 설계강도 (입력한 회차만 표시)", dash: "dot" },
    ],
  },
  {
    title: "내부온도 그래프 선",
    help: "회차 하나의 콘크리트 내부온도 그래프입니다.",
    together: ["tempObserved", "tempAssumed"],
    rows: [
      { key: "tempObserved", name: "관측", help: "센서가 실제로 잰 내부온도", dash: "solid" },
      { key: "tempAssumed", name: "가정", help: "마지막 데이터 이후, 직전 24시간이 반복된다고 가정한 온도", dash: "dash" },
    ],
  },
];

const LABEL = Object.fromEntries(GROUPS.flatMap((g) => g.rows.map((r) => [r.key, r.name]))) as Record<LineKey, string>;
const DASH: Record<Dash, string | undefined> = { solid: undefined, dash: "6 4", dot: "2 3" };
const CHEVRON = <svg className="chev" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>;

/** 같은 그래프 안에서 이 선과 색이 같은 다른 선 이름들. 목표 강도선끼리 같은 색은 기본값이라 허용 */
function clashes(key: LineKey, group: Group, c: LineColors) {
  const isTarget = (k: LineKey) => k.startsWith("target");
  return group.together.filter((k) => k !== key && c[k] === c[key] && !(isTarget(k) && isTarget(key))).map((k) => LABEL[k]);
}

/** 미리보기용: 예시 1회차를 타설 후 10일째 시점으로 잘라 모든 선(실측·수정 예측·최초 예측·관측·가정)이 함께 보이게 한다 */
function previewSample() {
  const { pour, pred } = demoData()[0];
  const cutH = 10 * 24;
  const series = pred.series.map((s) => ({ ...s, observed: s.age_h <= cutH }));
  const asOf = series[cutH];
  const p: Prediction = { ...pred, series, as_of: asOf.t, data_end: asOf.t, current_strength: asOf.strength,
    current_range: [asOf.lower, asOf.upper], tests: pred.tests.filter((t) => t.age_h <= cutH) };
  return { pour, pred: p };
}

function LineSample({ color, dash }: { color: string; dash: Dash }) {
  return (
    <svg width="44" height="12" viewBox="0 0 44 12" aria-hidden="true" className="line-sample">
      <line x1="2" y1="6" x2="42" y2="6" stroke={color} strokeWidth="3" strokeDasharray={DASH[dash]} strokeLinecap={dash === "dot" ? "round" : "butt"} />
    </svg>
  );
}

function ColorRow({ row, group, colors }: { row: Row; group: Group; colors: LineColors }) {
  const value = colors[row.key];
  const changed = value !== DEFAULT_LINE_COLORS[row.key];
  const clash = clashes(row.key, group, colors);
  const inputId = `color-${row.key}`;
  return (
    <div className="color-row">
      <div className="color-row-name">
        <LineSample color={value} dash={row.dash} />
        <div>
          <label htmlFor={inputId} className="strong">{row.name}</label>
          <div className="tiny">{row.help}</div>
          {clash.length > 0 && <div className="tiny warn-text">같은 색인 선이 있어 구분하기 어렵습니다: {clash.join(", ")}</div>}
        </div>
      </div>
      <div className="color-row-pick">
        <div className="swatches" role="radiogroup" aria-label={`${row.name} 색`}>
          {COLOR_PRESETS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c}
              className={`swatch ${value === c ? "on" : ""}`} style={{ background: c }}
              onClick={() => setLineColor(row.key, c)} />
          ))}
        </div>
        <label className="custom-color" title="직접 고르기">
          <input id={inputId} type="color" value={value.toLowerCase()} onChange={(e) => setLineColor(row.key, e.target.value)} />
          <span className="mono">{value}</span>
        </label>
        <button type="button" className="btn sm" disabled={!changed} onClick={() => resetLineColors([row.key])}>기본색</button>
      </div>
    </div>
  );
}

export default function GraphColorSettings() {
  const [open, setOpen] = useState(false);   // 기본은 접힘 (열린 상태는 저장하지 않음)
  const colors = useLineColors();
  const bodyId = useId();
  const changedCount = (Object.keys(colors) as LineKey[]).filter((k) => colors[k] !== DEFAULT_LINE_COLORS[k]).length;

  return (
    <section className="card fold">
      <button type="button" className="fold-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
        <span className="tri" aria-hidden="true">{CHEVRON}</span>
        <span className="fold-title">
          <span className="fold-h">그래프 색 설정</span>
          <span className="tiny">강도·온도 그래프 선과 목표 강도선 색</span>
        </span>
        <span className={`badge ${changedCount ? "info" : "neutral"}`}>{changedCount ? `${changedCount}개 변경` : "기본색"}</span>
      </button>
      {open && <GraphColorBody id={bodyId} changedCount={changedCount} colors={colors} />}
    </section>
  );
}

/** 펼쳤을 때만 그린다 (미리보기 그래프 계산을 접힌 동안 하지 않도록) */
function GraphColorBody({ id, changedCount, colors }: { id: string; changedCount: number; colors: LineColors }) {
  const sample = useMemo(previewSample, []);
  return (
    <div id={id} className="fold-body stack loose">
      <div className="row between">
        <span className="tiny">고른 색은 대시보드와 회차 상세의 그래프에 바로 적용됩니다. 이 브라우저에만 저장되고 다른 PC에는 적용되지 않습니다.</span>
        <button type="button" className="btn sm" disabled={!changedCount} onClick={() => resetLineColors()}>모두 기본색으로</button>
      </div>

      <div className="card color-preview">
        <div className="row between">
          <h3>미리보기</h3>
          <span className="badge neutral">예시 데이터</span>
        </div>
        <StrengthChart pred={sample.pred} design={sample.pour.design_strength} height={300} />
        <TempChart pred={sample.pred} />
      </div>

      {GROUPS.map((g) => (
        <div key={g.title}>
          <h3>{g.title}</h3>
          <div className="tiny">{g.help}</div>
          <div className="color-rows">
            {g.rows.map((r) => <ColorRow key={r.key} row={r} group={g} colors={colors} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
