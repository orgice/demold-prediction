// [화면] 시험 강도 대시보드 ( / ) — 화면설계서 1~6쪽, 수행계획서 대시보드 기능
//   ① 진행 중 회차 배너·선택   ② 이전 회차 선택 (검색·전체 선택·선택 해제·개별 선택, 최대 4개)
//   ③ 겹쳐 보기 / 회차별 보기  ④ 회차 요약 (현재·28일·보정) + ▸ 기준 강도 도달 예상 시점
//   ⑤ 종 아이콘 = 강도 알림 패널 (28일 예측 미달·도달 임박, 메일 초안)
// 진행 중 회차 = 타설 후 28일이 지나지 않은 회차. 협력사 DB 연동 후에는 실시간 수집 회차가 된다.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, MEMBER_LABEL, Pour, Prediction } from "../api/client";
import { ErrorBox, Info, Loading, MilestoneRow, useAsync } from "../components/common";
import { demoData } from "../components/demo";
import NewPourModal, { pourUrl } from "../components/NewPourModal";
import {
  CompareItem, CompareStrengthChart, CompareTempChart, isComplete, pourColor, StrengthChart, TempChart,
} from "../components/StrengthChart";
import { fmtAge, fmtDateTime, hoursBetween } from "../format";

const ACTIVE_DAYS = 28;
const MAX_PREV = 4;          // 이전 회차는 4개까지 (진행 회차 포함 최대 5개 그래프)
type View = "overlay" | "separate";

const startOf = (p: Pour) => p.pour_start ?? p.detected_start;
const nowIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };

/** 진행 중: 타설 시작 후 28일 이내 */
export function isActive(p: Pour) {
  const s = startOf(p);
  if (!s) return false;
  const h = hoursBetween(s, nowIso());
  return h >= 0 && h < ACTIVE_DAYS * 24;
}

/** 회차 표시 이름: "3회차 · 슬래브" */
function title(p: Pour) {
  return [p.name, p.member ? MEMBER_LABEL[p.member] : p.site].filter(Boolean).join(" · ");
}

type PredState = { data?: Prediction; error?: string };

function readView(): View {
  try { return localStorage.getItem("dash.view") === "separate" ? "separate" : "overlay"; } catch { return "overlay"; }
}

export default function Dashboard() {
  const pours = useAsync(api.pours, []);
  const [demo, setDemo] = useState(false);
  const [mainSel, setMainSel] = useState<number | "all" | null>(null);  // 배너에서 고른 회차 (진행 회차가 여럿이면 "all" 가능)
  const [prev, setPrev] = useState<number[]>([]);                         // 이전 회차 선택
  const [view, setView] = useState<View>(readView);
  const [bell, setBell] = useState(false);
  const [creating, setCreating] = useState(false);
  const [preds, setPreds] = useState<Record<number, PredState>>({});
  const nav = useNavigate();

  const setViewSaved = (v: View) => { setView(v); try { localStorage.setItem("dash.view", v); } catch { /* 저장 불가 */ } };

  // 예시 모드는 사용자가 고를 때만
  const list: Pour[] | null = demo ? demoData().map((d) => d.pour) : pours.data;
  const sorted = useMemo(() => [...(list ?? [])].filter((p) => startOf(p))
    .sort((a, b) => (startOf(b)! > startOf(a)! ? 1 : -1)), [list]);
  const active = sorted.filter(isActive);

  // 기준 회차: 고른 것 > 가장 최근 진행 회차 > (진행 회차가 없으면) 가장 최근 회차
  const mainIds: number[] = mainSel === "all" ? active.map((p) => p.id)
    : mainSel != null && sorted.some((p) => p.id === mainSel) ? [mainSel]
    : sorted[0] ? [(active[0] ?? sorted[0]).id] : [];
  const previous = sorted.filter((p) => !mainIds.includes(p.id));
  const prevIds = prev.filter((id) => previous.some((p) => p.id === id));
  const selectedIds = [...mainIds, ...prevIds];
  const byId = new Map(sorted.map((p) => [p.id, p]));
  // 색은 회차 번호 순서에 고정 (선택을 바꿔도 같은 회차는 같은 색)
  const colorOf = (id: number) => pourColor([...sorted].sort((a, b) => a.id - b.id).findIndex((p) => p.id === id));

  // 선택한 회차의 예측을 불러온다 (이미 불러온 회차는 다시 부르지 않음)
  const key = selectedIds.join(",");
  useEffect(() => {
    if (demo) {
      setPreds(Object.fromEntries(demoData().map((d) => [d.pour.id, { data: d.pred }])));
      return;
    }
    for (const id of selectedIds) {
      if (preds[id]) continue;
      setPreds((s) => ({ ...s, [id]: {} }));
      api.prediction(id)
        .then((data) => setPreds((s) => ({ ...s, [id]: { data } })))
        .catch((e) => setPreds((s) => ({ ...s, [id]: { error: String(e.message ?? e) } })));
    }
  }, [key, demo]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = () => { setPreds({}); pours.reload(); };

  if (!demo && pours.error) {
    return (
      <main className="page">
        <DashHead demo={false} bell={false} count={0} onBell={() => undefined} />
        <div className="card empty">
          <h2>대시보드를 불러오지 못했습니다</h2>
          <ErrorBox error={pours.error} />
          <div className="actions center">
            <button className="btn primary" onClick={retry}>다시 시도</button>
            <button className="btn" onClick={() => setDemo(true)}>예시 화면 보기</button>
          </div>
        </div>
      </main>
    );
  }
  if (!list) return <main className="page"><Loading /></main>;

  const items = selectedIds.map((id) => ({ pour: byId.get(id)!, state: preds[id] ?? {} }));
  const alerts = buildAlerts(items);

  return (
    <main className="page">
      <DashHead demo={demo} bell={bell} count={alerts.list.length} onBell={() => setBell((b) => !b)}
        onExitDemo={() => { setDemo(false); setPreds({}); setMainSel(null); setPrev([]); }} />
      {bell && <AlertPanel alerts={alerts} />}

      {sorted.length === 0 ? (
        <div className="card empty">
          <h2>등록된 타설 회차가 없습니다</h2>
          <div className="muted small">새 타설을 등록하면 강도 예측과 기준 강도 도달 시점이 여기에 표시됩니다.</div>
          <div className="actions center">
            <button className="btn primary" onClick={() => setCreating(true)}>+ 새 타설 등록</button>
            <Link to="/pours" className="btn">타설 이력</Link>
          </div>
        </div>
      ) : (
        <>
          <Banner active={active} sorted={sorted} mainIds={mainIds} mainSel={mainSel} onPick={setMainSel}
            demo={demo} onCreate={() => setCreating(true)} />
          <div className="dash-controls">
            <PrevPicker previous={previous} picked={prevIds} onChange={setPrev} />
            <span className="small muted sel-names">
              선택: {selectedIds.map((id) => byId.get(id)?.name).join("  ")}
            </span>
            <div className="seg" role="group" aria-label="보기 방식">
              <button className={view === "overlay" ? "on" : ""} aria-pressed={view === "overlay"} onClick={() => setViewSaved("overlay")}>겹쳐 보기</button>
              <button className={view === "separate" ? "on" : ""} aria-pressed={view === "separate"} onClick={() => setViewSaved("separate")}>회차별 보기</button>
            </div>
          </div>
          {view === "overlay"
            ? <Overlay items={items} colorOf={colorOf} demo={demo} />
            : <Separate items={items} colorOf={colorOf} demo={demo} />}
          <div className="tiny">예측값은 참고 정보입니다. 거푸집 해체 승인은 현장 시공 측이 합니다.</div>
        </>
      )}
      {creating && <NewPourModal onClose={() => setCreating(false)} onDone={(r) => nav(pourUrl(r))} />}
    </main>
  );
}

// ---------------- 머리말 · 배너 ----------------
function DashHead({ demo, bell, count, onBell, onExitDemo }: {
  demo: boolean; bell: boolean; count: number; onBell: () => void; onExitDemo?: () => void;
}) {
  return (
    <div className="page-head">
      <div className="row nowrap">
        <h1>시험 강도 대시보드</h1>
        <button className={`icon-btn ${bell ? "on" : ""}`} onClick={onBell} aria-expanded={bell}
          aria-label={`강도 알림${count ? ` ${count}건` : ""}`} title="강도 알림">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          {count > 0 && <span className="dot-count">{count}</span>}
        </button>
      </div>
      {demo && (
        <div className="small row">
          <span className="badge warn">예시 데이터</span>
          <button className="btn sm" onClick={onExitDemo}>실제 데이터로 돌아가기</button>
        </div>
      )}
    </div>
  );
}

function Banner({ active, sorted, mainIds, mainSel, onPick, demo, onCreate }: {
  active: Pour[]; sorted: Pour[]; mainIds: number[]; mainSel: number | "all" | null;
  onPick: (v: number | "all") => void; demo: boolean; onCreate: () => void;
}) {
  const main = sorted.find((p) => p.id === mainIds[0]);
  const options = active.length > 0 ? active : sorted;
  const value = mainSel === "all" ? "all" : String(mainIds[0] ?? "");
  const elapsed = (p: Pour) => fmtAge(hoursBetween(startOf(p)!, nowIso()));
  return (
    <section className="banner">
      <div className="grow">
        <div className="banner-label">
          {demo ? "예시 데이터 · " : ""}
          {active.length > 0 ? `진행 중인 시험 ${active.length}건` : "진행 중인 시험 없음"}
        </div>
        <div className="banner-title">
          {mainSel === "all" ? `진행 중 회차 ${mainIds.length}개 비교`
            : main ? `${title(main)}${active.some((p) => p.id === main.id) ? ` · ${elapsed(main)} 경과` : ""}` : "—"}
        </div>
        {active.length === 0 && (
          <div className="banner-sub">
            가장 최근 회차를 보여 줍니다
            <Info align="right">협력사 DB 연동 후에는 실시간으로 수집되는 회차(타설 후 28일 이내)가 진행 중으로 표시됩니다.</Info>
          </div>
        )}
      </div>
      <div className="banner-actions">
        <select aria-label={active.length > 0 ? "진행 중 회차 선택" : "기준 회차 선택"} value={value}
          onChange={(e) => onPick(e.target.value === "all" ? "all" : Number(e.target.value))}>
          {options.map((p) => (
            <option key={p.id} value={p.id}>{title(p)}{active.length > 0 ? ` · ${elapsed(p)} 경과` : ` · ${fmtDateTime(startOf(p))}`}</option>
          ))}
          {active.length > 1 && <option value="all">진행 중 전체 비교</option>}
        </select>
        {active.length === 0 && !demo && (
          <div className="row">
            <Link to="/pours" className="btn sm">타설 이력</Link>
            <button className="btn sm" onClick={onCreate}>+ 새 타설 등록</button>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------- 이전 회차 선택 ----------------
function PrevPicker({ previous, picked, onChange }: { previous: Pour[]; picked: number[]; onChange: (ids: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = previous.filter((p) => title(p).toLowerCase().includes(q.trim().toLowerCase()));
  const full = picked.length >= MAX_PREV;
  const toggle = (id: number) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : full ? picked : [...picked, id]);
  return (
    <div className="picker">
      <button className="btn sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} 이전 회차 선택{picked.length ? ` · ${picked.length}개` : ""}
      </button>
      {open && (
        <div className="picker-pop">
          <input placeholder="회차명 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="회차명 검색" />
          <div className="row">
            <button className="btn sm" onClick={() => onChange(previous.slice(0, MAX_PREV).map((p) => p.id))}>전체 선택</button>
            <button className="btn sm" onClick={() => onChange([])}>선택 해제</button>
          </div>
          {previous.length > MAX_PREV && <div className="tiny">최대 {MAX_PREV}개 (전체 선택 = 최근 {MAX_PREV}개)</div>}
          <div className="picker-list">
            {shown.map((p) => (
              <label key={p.id} className={`picker-item ${!picked.includes(p.id) && full ? "disabled" : ""}`}>
                <input type="checkbox" checked={picked.includes(p.id)} disabled={!picked.includes(p.id) && full}
                  onChange={() => toggle(p.id)} />
                <span>{title(p)}</span>
                <span className="tiny">{fmtDateTime(startOf(p))}</span>
              </label>
            ))}
            {shown.length === 0 && <div className="tiny">{previous.length === 0 ? "이전 회차가 없습니다." : "일치하는 회차가 없습니다."}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 회차 요약 ----------------
type Item = { pour: Pour; state: PredState };

function PourName({ pour, demo, color }: { pour: Pour; demo: boolean; color?: string }) {
  return (
    <span className="row nowrap">
      {color && <span className="dot" style={{ background: color }} aria-hidden="true" />}
      {demo ? <b>{title(pour)}</b> : <Link to={`/pours/${pour.id}`} className="pour-link">{title(pour)}</Link>}
    </span>
  );
}

function Kpis({ pred, compact = false }: { pred: Prediction; compact?: boolean }) {
  const ratio = pred.design_ratio_28d;
  return (
    <div className={`grid kpis ${compact ? "kpis-2" : ""}`}>
      <div className="kpi">
        <div className="label">{compact ? `현재 ${fmtAge(hoursBetween(pred.start, pred.as_of))}` : "현재 예측 강도"}</div>
        <div className="value">{pred.current_strength.toFixed(1)}<span className="unit">MPa</span></div>
        {!compact && <div className="sub">90% 범위 {pred.current_range[0].toFixed(1)}–{pred.current_range[1].toFixed(1)}</div>}
      </div>
      <div className="kpi">
        <div className="label">28일 예측{compact ? "" : " 강도"}</div>
        <div className="value">{pred.strength_28d.toFixed(1)}<span className="unit">MPa</span></div>
        {!compact && <div className="sub">{ratio != null
          ? <>설계강도 대비 {(ratio * 100).toFixed(0)}%{ratio < 1 && <span className="text-warn"> · 양생 관리 필요</span>}</>
          : "설계강도 미입력"}</div>}
      </div>
      {!compact && (
        <div className="kpi">
          <div className="label">보정</div>
          <div className="value">{pred.model.calibrated ? `×${pred.model.calibration_scale.toFixed(2)}` : "없음"}</div>
          <div className="sub">{pred.model.calibrated ? "공시체 결과로 이 회차 예측 보정" : "공시체 결과 입력 시 정확도 향상"}</div>
        </div>
      )}
    </div>
  );
}

/** ▸ 를 누르면 기준 강도 도달 예상 시점 목록이 펼쳐진다 (기본 접힘) */
function Milestones({ pred, open }: { pred: Prediction; open: boolean }) {
  if (!open) return null;
  return (
    <div className="stack tight">
      <h3>기준 강도 도달 예상 시점
        <Info align="right">예상 = 중앙 예측, 보수적 = 90% 하한이 기준에 닿는 시각입니다. 실제 해체 승인 시각이 아닙니다.</Info>
      </h3>
      <div className="milestones">
        {pred.milestones.map((m) => (
          <MilestoneRow key={m.label} m={m} baseAgeH={pred.baseline?.milestones.find((b) => b.label === m.label)?.expected_age_h} />
        ))}
      </div>
    </div>
  );
}

function SummaryHead({ item, color, demo, open, onToggle, status }: {
  item: Item; color?: string; demo: boolean; open: boolean; onToggle: () => void; status?: string;
}) {
  return (
    <div className="sum-head">
      <PourName pour={item.pour} demo={demo} color={color} />
      <button className="tri" aria-expanded={open} aria-label={`${item.pour.name} 기준 강도 도달 예상 시점 ${open ? "접기" : "펼치기"}`}
        onClick={onToggle} disabled={!item.state.data}>{open ? "▾" : "▸"}</button>
      {status && <span className="tiny">{status}</span>}
    </div>
  );
}

function statusText(pred?: Prediction) {
  if (!pred) return "";
  return isComplete(pred) ? `완료 · 28일 ${pred.strength_28d.toFixed(1)} MPa`
    : `진행 중 · 현재 ${pred.current_strength.toFixed(1)} / 28일 예측 ${pred.strength_28d.toFixed(1)} MPa`;
}

function PredFallback({ state }: { state: PredState }) {
  if (state.error) return <div className="alert warn small">예측할 수 없습니다: {state.error}</div>;
  return <Loading text="예측 계산 중…" />;
}

// ---------------- 겹쳐 보기 ----------------
function Overlay({ items, colorOf, demo }: { items: Item[]; colorOf: (id: number) => string; demo: boolean }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const toggle = (id: number) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  if (items.length === 0) return null;

  // 회차 하나: 상세와 같은 요약 + 그래프
  if (items.length === 1) {
    const it = items[0];
    const pred = it.state.data;
    return (
      <div className="card stack loose">
        <SummaryHead item={it} demo={demo} open={!!open[it.pour.id]} onToggle={() => toggle(it.pour.id)} />
        {pred ? (
          <>
            <Kpis pred={pred} />
            <Milestones pred={pred} open={!!open[it.pour.id]} />
            <div>
              <h3>압축강도 예측 비교</h3>
              <StrengthChart pred={pred} design={it.pour.design_strength} />
            </div>
            <div>
              <h3>콘크리트 내부온도<Info align="right">점선은 직전 24시간 온도 패턴이 반복된다고 가정한 값입니다.</Info></h3>
              <TempChart pred={pred} />
            </div>
          </>
        ) : <PredFallback state={it.state} />}
      </div>
    );
  }

  // 여러 회차: 같은 경과일 축
  const ready: CompareItem[] = items.filter((i) => i.state.data)
    .map((i) => ({ pred: i.state.data!, name: i.pour.name, color: colorOf(i.pour.id) }));
  const designs = [...new Set(items.map((i) => i.pour.design_strength).filter((d): d is number => d != null))];
  return (
    <div className="card stack loose">
      <div className="sum-grid">
        {items.map((it) => (
          <div key={it.pour.id} className="sum-cell">
            <SummaryHead item={it} color={colorOf(it.pour.id)} demo={demo} open={!!open[it.pour.id]}
              onToggle={() => toggle(it.pour.id)} />
            <div className="tiny">{it.state.data ? statusText(it.state.data) : it.state.error ? `예측 불가: ${it.state.error}` : "계산 중…"}</div>
            {it.state.data && <Milestones pred={it.state.data} open={!!open[it.pour.id]} />}
          </div>
        ))}
      </div>
      <div>
        <h3>압축강도 예측 비교<Info align="right">회차별 진한 선은 실측 온도로 계산한 강도, 옅은 점선은 예측, 점은 공시체 시험 결과입니다.</Info></h3>
        {ready.length > 0 ? <CompareStrengthChart items={ready} design={designs.length === 1 ? designs[0] : null} /> : <Loading text="예측 계산 중…" />}
      </div>
      {ready.length > 0 && (
        <div>
          <h3>콘크리트 내부온도<Info align="right">회차별 관측 온도만 그립니다 (예측 없음).</Info></h3>
          <CompareTempChart items={ready} />
        </div>
      )}
    </div>
  );
}

// ---------------- 회차별 보기 ----------------
function Separate({ items, colorOf, demo }: { items: Item[]; colorOf: (id: number) => string; demo: boolean }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  // 모든 카드의 강도 축을 맞춘다
  const ys = items.flatMap((i) => i.state.data ? [i.state.data.strength_28d, ...i.state.data.tests.map((t) => t.fc)] : [])
    .concat(items.map((i) => i.pour.design_strength ?? 0));
  const yMax = Math.ceil((Math.max(14, ...ys) * 1.15) / 6) * 6;
  return (
    <div className="grid sep-grid">
      {items.map((it) => {
        const pred = it.state.data;
        return (
          <div key={it.pour.id} className="card stack">
            <SummaryHead item={it} color={colorOf(it.pour.id)} demo={demo} open={!!open[it.pour.id]}
              onToggle={() => setOpen((o) => ({ ...o, [it.pour.id]: !o[it.pour.id] }))} />
            {pred ? (
              <>
                <Kpis pred={pred} compact />
                <Milestones pred={pred} open={!!open[it.pour.id]} />
                <div>
                  <h3 className="small">압축강도 예측</h3>
                  <StrengthChart pred={pred} design={it.pour.design_strength} compact height={220} yMax={yMax} />
                </div>
                <div>
                  <h3 className="small">콘크리트 내부온도</h3>
                  <TempChart pred={pred} compact height={120} />
                </div>
              </>
            ) : <PredFallback state={it.state} />}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- 강도 알림 ----------------
interface AlertItem { pour: Pour; kind: "under" | "soon"; title: string; text: string }
interface Alerts { list: AlertItem[]; failed: Pour[]; selected: number }

/** 알림 대상: 선택한 회차. 28일 예측이 기준보다 낮거나(FR-012), 진행 중 회차가 24시간 안에 기준에 닿을 때(FR-011) */
function buildAlerts(items: Item[]): Alerts {
  const list: AlertItem[] = [];
  const failed: Pour[] = [];
  for (const { pour, state } of items) {
    if (state.error) { failed.push(pour); continue; }
    const pred = state.data;
    if (!pred) continue;
    // 부재 종류를 정했으면 그 기준만, 아니면 5·14 MPa 모두
    const base = pour.member === "wall" ? [5] : pour.member === "slab" ? [14] : [5, 14];
    const targets = [...base.map((v) => ({ v, name: `${v} MPa` })),
      ...(pour.design_strength ? [{ v: pour.design_strength, name: `설계강도 ${pour.design_strength} MPa` }] : [])];
    const under = targets.filter((t) => pred.strength_28d < t.v);
    if (under.length) {
      list.push({ pour, kind: "under", title: `${title(pour)} · 강도 도달 주의`,
        text: `28일 예측 강도 ${pred.strength_28d.toFixed(1)} MPa가 ${under.map((u) => u.name).join(", ")} 기준보다 낮습니다.` });
    }
    // 도달 임박: 데이터가 지금 들어오고 있는 회차만
    const live = Date.now() - new Date(pred.as_of).getTime() < 3 * 3600_000;
    if (live) {
      for (const m of pred.milestones) {
        if (m.reached_at_as_of || !m.expected || !targets.some((t) => t.v === m.threshold)) continue;
        const h = hoursBetween(pred.as_of, m.expected);
        if (h >= 0 && h <= 24) {
          list.push({ pour, kind: "soon", title: `${title(pour)} · 도달 임박`,
            text: `${m.label} 도달 예상 ${fmtDateTime(m.expected)} (약 ${Math.max(1, Math.round(h))}시간 후), 보수적 ${fmtDateTime(m.conservative)}.` });
        }
      }
    }
  }
  return { list, failed, selected: items.length };
}

function mailto(a: AlertItem) {
  const subject = `[FormCast] ${a.title}`;
  const body = [`${a.pour.name}${a.pour.site ? ` (${a.pour.site})` : ""}`, "", a.text, "",
    "※ 예측값은 참고 정보이며, 거푸집 해체 승인은 현장 책임자가 합니다."].join("\n");
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function AlertPanel({ alerts }: { alerts: Alerts }) {
  return (
    <section className="card stack" aria-label="강도 알림">
      <h3>강도 알림<Info align="right">메일 작성은 기본 메일 앱에 초안만 엽니다. 수신자 확인과 발송은 직접 합니다.</Info></h3>
      {alerts.selected === 0 && <div className="muted small">선택한 회차가 없습니다.</div>}
      {alerts.failed.length > 0 && (
        <div className="alert error small">
          예측 조회 실패: {alerts.failed.map((p) => p.name).join(", ")}. 이 회차는 경고 여부를 판단하지 못했습니다.
        </div>
      )}
      {alerts.selected > 0 && alerts.list.length === 0 && alerts.failed.length === 0 && (
        <div className="muted small">선택한 회차 중 주의할 회차가 없습니다.</div>
      )}
      <div className="stack tight">
        {alerts.list.map((a, i) => (
          <div key={i} className="alert warn stack tight">
            <div className="strong">{a.kind === "soon" ? "⏰ " : "⚠ "}{a.title}</div>
            <div className="small">{a.text}</div>
            <a className="btn sm self-start" href={mailto(a)}>메일 작성</a>
          </div>
        ))}
      </div>
    </section>
  );
}
