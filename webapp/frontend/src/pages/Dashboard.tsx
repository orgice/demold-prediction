// [화면] 시험 강도 대시보드 ( / ) — 화면설계서 1~6쪽, 수행계획서 대시보드 기능
//   ① 진행 중 회차 배너·선택   ② 이전 회차 선택 (검색·전체 선택·선택 해제·개별 선택, 최대 3개)
//   ③ 겹쳐 보기 / 회차별 보기 (회차별: 1개 = 큰 그래프, 2개 = 절반씩, 3개 = 3분의 1씩, 4개 = 기준 회차 큰 그래프 + 아래 3개)
//      ④ 회차 요약 (현재·28일·보정) + ▸ 기준 강도 도달 예상 시점
//   ⑤ 종 아이콘 = 알림 패널: 강도 알림(해체 기준 도달 하루 전 → 메일 자동 발송 또는 초안) + 확인 필요(빠진 입력, 메일과 무관)
//      숫자 = 아직 안 보낸 강도 알림 + 확인 필요 항목
//   ⑥ 새 타설 감지 (맨 위): 실시간 수집 센서에서 찾은 미등록 타설 → 확인 후 회차로 등록 (components/LiveCandidates.tsx)
// 진행 중 회차 = 타설 후 28일이 지나지 않은 회차. 센서 데이터는 10분마다 자동 수집되므로(delta_sync.py)
// 화면도 10분마다 회차와 예측을 다시 불러온다 (탭이 보일 때만).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, MEMBER_LABEL, Pour, Prediction } from "../api/client";
import { useCanEdit } from "../auth/AuthContext";
import { ErrorBox, Info, Loading, MilestoneRow, useAsync } from "../components/common";
import { AlertItem, alertsFor, KIND_LABEL, mailtoUrl, milestoneSnapshot, recipients } from "../components/alerts";
import { demoData } from "../components/demo";
import LiveCandidates from "../components/LiveCandidates";
import NewPourModal, { pourUrl } from "../components/NewPourModal";
import {
  CompareItem, CompareStrengthChart, CompareTempChart, isComplete, pourColor, StrengthChart, TempChart,
} from "../components/StrengthChart";
import { fmtAge, fmtDateTime, hoursBetween, nowKst } from "../format";

const ACTIVE_DAYS = 28;
const REFRESH_MS = 10 * 60_000;   // 센서 자동 수집 주기와 같게
const MAX_PREV = 3;          // 이전 회차는 3개까지 (기준 회차 포함 최대 4개 그래프)
type View = "overlay" | "separate";

const startOf = (p: Pour) => p.pour_start ?? p.detected_start;
/** 펼침 꺾쇠 (aria-expanded="true"인 버튼 안에서 90° 회전) */
const CHEVRON = <svg className="chev" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>;

/** 진행 중: 타설 시작 후 28일 이내 */
export function isActive(p: Pour) {
  const s = startOf(p);
  if (!s) return false;
  const h = hoursBetween(s, nowKst());
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
  const [kpiOpen, setKpiOpen] = useState(false);   // 예측 강도·보정 카드 (기본 접힘, 한 번 누르면 모든 회차가 같이 열림)
  const kpi = { open: kpiOpen, toggle: () => setKpiOpen((o) => !o) };
  const [creating, setCreating] = useState(false);
  const canEdit = useCanEdit();   // 보기 계정에게는 '새 타설 등록'을 숨긴다
  const [preds, setPreds] = useState<Record<number, PredState>>({});
  const nav = useNavigate();

  const setViewSaved = (v: View) => { setView(v); try { localStorage.setItem("dash.view", v); } catch { /* 저장 불가 */ } };

  // 예시 모드는 사용자가 고를 때만
  const list: Pour[] | null = demo ? demoData().map((d) => d.pour) : pours.data;
  const sorted = useMemo(() => [...(list ?? [])].filter((p) => startOf(p))
    .sort((a, b) => (startOf(b)! > startOf(a)! ? 1 : -1)), [list]);
  const active = sorted.filter(isActive);
  const unstarted = (list ?? []).filter((p) => !startOf(p)).length;   // 시작 시각이 없어 예측·표시할 수 없는 회차

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
  const [reloadTick, setReloadTick] = useState(0);   // 다시 불러오기(10분 갱신·다시 시도) 때마다 증가 → 지운 예측을 다시 부른다
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
  }, [key, demo, reloadTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = () => { setPreds({}); setReloadTick((t) => t + 1); pours.reload(); };
  // 회차 하나의 예측만 다시 부른다 (예측 실패 카드의 '다시 시도')
  const retryPred = (id: number) => {
    setPreds((s) => { const { [id]: _, ...rest } = s; return rest; });
    setReloadTick((t) => t + 1);
  };

  // 자동 갱신: 화면을 비우지 않고(그래프 확대·펼침 유지) 새 값이 오면 바꿔 끼운다. 실패하면 이전 값을 그대로 둔다
  const refresh = () => {
    api.pours().then(pours.setData).catch(() => undefined);
    // 선택하지 않은 회차의 예측은 버려, 나중에 고르면 새로 불러오게 한다
    setPreds((s) => Object.fromEntries(selectedIds.filter((id) => s[id]).map((id) => [id, s[id]])));
    for (const id of selectedIds) {
      api.prediction(id).then((data) => setPreds((s) => ({ ...s, [id]: { data } }))).catch(() => undefined);
    }
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // 실시간 수집 데이터 반영: 10분마다 회차·예측을 다시 불러온다 (탭이 보일 때만, 예시 모드 제외)
  useEffect(() => {
    if (demo) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") refreshRef.current(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [demo]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const items: Item[] = selectedIds.map((id) => ({ pour: byId.get(id)!, state: preds[id] ?? {}, retry: () => retryPred(id) }));
  const alerts = buildAlerts(items);
  const checks = demo ? [] : checkItems(active);   // 예시 화면에서는 확인 필요를 만들지 않는다
  const count = alerts.unsent + checks.length;

  return (
    <main className="page">
      <DashHead demo={demo} bell={bell} count={count} onBell={() => setBell((b) => !b)}
        onExitDemo={() => { setDemo(false); setPreds({}); setMainSel(null); setPrev([]); }}
        onCreate={sorted.length > 0 && !demo && canEdit ? () => setCreating(true) : undefined} />
      {bell && <AlertPanel alerts={alerts} checks={checks} demo={demo}
        onSent={(p) => pours.setData((xs) => xs?.map((x) => (x.id === p.id ? p : x)) ?? xs)} />}
      {/* 아직 메일 초안을 열지 않은 알림이나 확인 필요 항목이 있으면 종을 열지 않아도 본문 상단에 한 줄 요약 (DESIGN.md 8장 5) */}
      {!bell && count > 0 && (
        <div className="alert warn alert-inline">
          <span><span className="ico" aria-hidden="true">⚠</span> {[
            alerts.unsent > 0 && `선택한 회차에 확인할 강도 알림 ${alerts.unsent}건`,
            checks.length > 0 && `진행 중 회차에 확인 필요 ${checks.length}건`,
          ].filter(Boolean).join(", ")}이 있어요.</span>
          <button className="btn sm" onClick={() => setBell(true)}>알림 보기</button>
        </div>
      )}
      {!demo && <LiveCandidates onRegistered={(p) => { pours.reload(); setMainSel(p.id); }} />}

      {unstarted > 0 && sorted.length > 0 && (
        <div className="alert info alert-inline small">
          <span>타설 시작 시각이 없는 회차 {unstarted}건은 대시보드에 나오지 않습니다. 타설 이력에서 시각을 확인해 주세요.</span>
          <Link to="/pours" className="btn sm">타설 이력</Link>
        </div>
      )}
      {sorted.length === 0 ? (
        <div className="card empty">
          <h2>{unstarted > 0 ? "표시할 타설 회차가 없습니다" : "등록된 타설 회차가 없습니다"}</h2>
          <div className="muted small">{unstarted > 0
            ? `등록된 회차 ${unstarted}건에 타설 시작 시각이 없어 예측할 수 없습니다. 타설 이력에서 시각을 입력하거나 자동 추정을 실행해 주세요.`
            : canEdit
            ? "새 타설을 등록하면 강도 예측과 기준 강도 도달 시점이 여기에 표시됩니다."
            : "타설이 등록되면 강도 예측과 기준 강도 도달 시점이 여기에 표시됩니다."}</div>
          <div className="actions center">
            {canEdit && <button className="btn primary" onClick={() => setCreating(true)}>+ 새 타설 등록</button>}
            <Link to="/pours" className="btn">타설 이력</Link>
          </div>
        </div>
      ) : (
        <>
          <Banner active={active} sorted={sorted} mainIds={mainIds} mainSel={mainSel} onPick={setMainSel}
            demo={demo} />
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
            ? <Overlay items={items} colorOf={colorOf} demo={demo} kpi={kpi} />
            : <Separate items={items} colorOf={colorOf} demo={demo} kpi={kpi} />}
          <div className="tiny">예측값은 참고 정보입니다. 거푸집 해체 승인은 현장 시공 측이 합니다.</div>
        </>
      )}
      {creating && <NewPourModal onClose={() => setCreating(false)} onDone={(r) => nav(pourUrl(r))} />}
    </main>
  );
}

// ---------------- 머리말 · 배너 ----------------
function DashHead({ demo, bell, count, onBell, onExitDemo, onCreate }: {
  demo: boolean; bell: boolean; count: number; onBell: () => void; onExitDemo?: () => void; onCreate?: () => void;
}) {
  return (
    <>
    <div className="page-head">
      <div className="row nowrap">
        <h1>시험 강도 대시보드</h1>
        <button className={`icon-btn ${bell ? "on" : ""}`} onClick={onBell} aria-expanded={bell}
          aria-label={`알림${count ? ` ${count}건` : ""}`} title="알림 (강도 알림 · 확인 필요)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          {count > 0 && <span className="dot-count">{count}</span>}
        </button>
      </div>
      {/* 대시보드의 주 행동은 ‘새 타설 등록’ 하나 (DESIGN.md 8장 1) */}
      {onCreate && <button className="btn primary" onClick={onCreate}>+ 새 타설 등록</button>}
    </div>
    {demo && (
      <div className="demo-band" role="status">
        <span><b>예시 데이터입니다.</b> 실제 측정값이 아닌 화면 확인용 데이터를 보여 주고 있어요.</span>
        <button className="btn sm" onClick={onExitDemo}>실제 데이터로 돌아가기</button>
      </div>
    )}
    </>
  );
}

function Banner({ active, sorted, mainIds, mainSel, onPick, demo }: {
  active: Pour[]; sorted: Pour[]; mainIds: number[]; mainSel: number | "all" | null;
  onPick: (v: number | "all") => void; demo: boolean;
}) {
  const main = sorted.find((p) => p.id === mainIds[0]);
  const options = active.length > 0 ? active : sorted;
  const value = mainSel === "all" ? "all" : String(mainIds[0] ?? "");
  const elapsed = (p: Pour) => fmtAge(hoursBetween(startOf(p)!, nowKst()));
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
            <Info align="right">타설 후 28일 이내 회차가 진행 중으로 표시됩니다. 실시간 수집 센서에서 새 타설이 감지되면 위에 '새 타설 감지'가 떠서 바로 등록할 수 있어요.</Info>
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
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------- 확인 필요 ----------------
// 진행 중 회차의 빠진 입력. 종 아이콘 알림 패널에 강도 알림과 함께 보여 주지만 메일과는 무관하다
// (보냄 기록 없음: 입력하면 사라진다). 해당 입력 탭으로 바로 보낸다 (DESIGN.md 12.1)
interface CheckItem { pour: Pour; text: string; tab: string; action: string }

function checkItems(pours: Pour[]): CheckItem[] {
  return pours.flatMap((p) => [
    !p.pour_start && { pour: p, text: "타설 시각 미확정", tab: "pourtime", action: "타설 시점 확인" },
    p.test_count === 0 && { pour: p, text: "공시체 미입력", tab: "tests", action: "공시체 결과 입력" },
    !p.member && { pour: p, text: "부재 미설정", tab: "settings", action: "부재 설정" },
  ].filter((x): x is CheckItem => !!x));
}

function CheckSection({ items }: { items: CheckItem[] }) {
  return (
    <div className="stack panel-sec" role="group" aria-label="확인 필요">
      <div className="card-head"><h3>확인 필요 {items.length > 0 && <span className="badge warn">{items.length}</span>}</h3>
        <span className="tiny">진행 중 회차 기준 · 입력하면 예측이 다시 계산됩니다</span></div>
      {items.length === 0
        ? <div className="muted small">진행 중 회차에 빠진 입력이 없습니다.</div>
        : (
          <div className="check-list">
            {items.map((it) => (
              <div key={`${it.pour.id}-${it.tab}`} className="check-row">
                <span className="check-name">{title(it.pour)}</span>
                <span className="badge warn">{it.text}</span>
                <Link to={`/pours/${it.pour.id}?tab=${it.tab}`} className="btn sm">{it.action}</Link>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ---------------- 이전 회차 선택 ----------------
function PrevPicker({ previous, picked, onChange }: { previous: Pour[]; picked: number[]; onChange: (ids: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // 열려 있을 때 바깥을 누르거나 Esc를 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const shown = previous.filter((p) => title(p).toLowerCase().includes(q.trim().toLowerCase()));
  const full = picked.length >= MAX_PREV;
  const toggle = (id: number) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : full ? picked : [...picked, id]);
  return (
    <div className="picker" ref={boxRef}>
      <button ref={btnRef} className="btn sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {CHEVRON} 이전 회차 선택{picked.length ? ` · ${picked.length}개` : ""}
      </button>
      {open && (
        <div className="picker-pop">
          <input placeholder="회차명 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="회차명 검색" />
          <div className="row">
            <button className="btn sm" onClick={() => onChange(shown.slice(0, MAX_PREV).map((p) => p.id))}>전체 선택</button>
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
type Item = { pour: Pour; state: PredState; retry?: () => void };
/** 예측 강도·보정 카드의 접힘 상태 (모든 회차 카드가 함께 쓴다) */
type Fold = { open: boolean; toggle: () => void };

function PourName({ pour, demo, color }: { pour: Pour; demo: boolean; color?: string }) {
  return (
    <span className="pour-name">
      {color && <span className="dot" style={{ background: color }} aria-hidden="true" />}
      {demo ? <b>{title(pour)}</b> : <Link to={`/pours/${pour.id}`} className="pour-link">{title(pour)}</Link>}
    </span>
  );
}

/** 예측 강도·보정 카드: 기본 접힘. 한 곳을 누르면 화면의 모든 회차 카드가 같이 열리고 닫힌다 (kpiOpen 은 대시보드가 갖는다) */
function Kpis({ pred, compact = false, open, onToggle }: { pred: Prediction; compact?: boolean; open: boolean; onToggle: () => void }) {
  const ratio = pred.design_ratio_28d;
  return (
    <div className="kpi-fold">
      <button className="kpi-fold-head" aria-expanded={open} onClick={onToggle}>
        {CHEVRON}
        <span className="kpi-fold-h">{compact ? "예측 강도" : "예측 강도·보정"}</span>
        {!open && <span className="kpi-fold-sum">현재 {pred.current_strength.toFixed(1)} · 28일 {pred.strength_28d.toFixed(1)} MPa</span>}
      </button>
      {open && <KpiGrid pred={pred} compact={compact} ratio={ratio} />}
    </div>
  );
}

function KpiGrid({ pred, compact, ratio }: { pred: Prediction; compact: boolean; ratio: number | null | undefined }) {
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
        onClick={onToggle} disabled={!item.state.data}>{CHEVRON}</button>
      {status && <span className="tiny">{status}</span>}
    </div>
  );
}

function statusText(pred?: Prediction) {
  if (!pred) return "";
  return isComplete(pred) ? `완료 · 28일 ${pred.strength_28d.toFixed(1)} MPa`
    : `진행 중 · 현재 ${pred.current_strength.toFixed(1)} / 28일 예측 ${pred.strength_28d.toFixed(1)} MPa`;
}

function PredFallback({ state, onRetry }: { state: PredState; onRetry?: () => void }) {
  if (state.error) return (
    <div className="alert warn small alert-inline">
      <span>예측할 수 없습니다: {state.error}</span>
      {onRetry && <button className="btn sm" onClick={onRetry}>다시 시도</button>}
    </div>
  );
  return <Loading text="예측 계산 중…" />;
}

/** 큰 그래프 카드 (겹쳐 보기 회차 1개, 회차별 보기 1개·4개일 때 맨 위) */
function BigCard({ item: it, color, demo, open, onToggle, yMax, kpi }: {
  item: Item; color?: string; demo: boolean; open: boolean; onToggle: () => void; yMax?: number; kpi: Fold;
}) {
  const pred = it.state.data;
  return (
    <div className="card stack loose">
      <SummaryHead item={it} color={color} demo={demo} open={open} onToggle={onToggle} />
      {pred ? (
        <>
          <Kpis pred={pred} open={kpi.open} onToggle={kpi.toggle} />
          <Milestones pred={pred} open={open} />
          <div>
            <h3>압축강도 예측 비교</h3>
            <StrengthChart pred={pred} yMax={yMax} />
          </div>
          <div>
            <h3>콘크리트 내부온도<Info align="right">점선은 직전 24시간 온도 패턴이 반복된다고 가정한 값입니다.</Info></h3>
            <TempChart pred={pred} />
          </div>
        </>
      ) : <PredFallback state={it.state} onRetry={it.retry} />}
    </div>
  );
}

// ---------------- 겹쳐 보기 ----------------
function Overlay({ items, colorOf, demo, kpi }: { items: Item[]; colorOf: (id: number) => string; demo: boolean; kpi: Fold }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const toggle = (id: number) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  if (items.length === 0) return null;

  // 회차 하나: 상세와 같은 요약 + 그래프
  if (items.length === 1) {
    const it = items[0];
    return <BigCard key={it.pour.id} item={it} demo={demo} open={!!open[it.pour.id]} onToggle={() => toggle(it.pour.id)} kpi={kpi} />;
  }

  // 여러 회차: 같은 경과일 축
  const ready: CompareItem[] = items.filter((i) => i.state.data)
    .map((i) => ({ pred: i.state.data!, name: i.pour.name, color: colorOf(i.pour.id) }));
  return (
    <div className="card stack loose">
      <div className="sum-grid">
        {items.map((it) => (
          <div key={it.pour.id} className="sum-cell">
            <SummaryHead item={it} color={colorOf(it.pour.id)} demo={demo} open={!!open[it.pour.id]}
              onToggle={() => toggle(it.pour.id)} />
            <div className="tiny">{it.state.data ? statusText(it.state.data) : it.state.error ? `예측 불가: ${it.state.error}` : "계산 중…"}</div>
            {it.state.error && it.retry && <div><button className="btn sm" onClick={it.retry}>다시 시도</button></div>}
            {it.state.data && <Milestones pred={it.state.data} open={!!open[it.pour.id]} />}
          </div>
        ))}
      </div>
      <div>
        <h3>압축강도 예측 비교<Info align="right">회차별 진한 선은 실측 온도로 계산한 강도, 옅은 점선은 예측, 점은 공시체 시험 결과입니다.</Info></h3>
        {ready.length > 0 ? <CompareStrengthChart items={ready} />
          : !items.every((i) => i.state.error) && <Loading text="예측 계산 중…" />}
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
// 1개: 겹쳐 보기와 같은 큰 그래프 / 2개: 절반씩 / 3개: 3분의 1씩
// 4개 이상(이전 회차 3개, 또는 진행 회차가 여럿): 기준 회차를 맨 위 큰 그래프로, 나머지는 아래 3분의 1씩
function Separate({ items, colorOf, demo, kpi }: { items: Item[]; colorOf: (id: number) => string; demo: boolean; kpi: Fold }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const toggle = (id: number) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  if (items.length === 0) return null;
  // 모든 카드의 강도 축을 맞춘다
  const ys = items.flatMap((i) => i.state.data
    ? [i.state.data.strength_28d, ...i.state.data.tests.map((t) => t.fc), ...i.state.data.milestones.map((m) => m.threshold)] : []);
  const yMax = Math.ceil((Math.max(14, ...ys) * 1.15) / 6) * 6;

  const top = items.length === 1 || items.length >= 4 ? items[0] : null;
  const rest = top ? items.slice(1) : items;
  const cols = rest.length === 2 ? 2 : 3;
  const half = cols === 2;
  return (
    <div className="stack loose">
      {top && <BigCard key={top.pour.id} item={top} color={items.length > 1 ? colorOf(top.pour.id) : undefined} demo={demo}
        open={!!open[top.pour.id]} onToggle={() => toggle(top.pour.id)} yMax={items.length > 1 ? yMax : undefined} kpi={kpi} />}
      {rest.length > 0 && (
        <div className={`grid sep-grid sep-${cols}`}>
          {rest.map((it) => {
            const pred = it.state.data;
            return (
              <div key={it.pour.id} className="card stack">
                <SummaryHead item={it} color={colorOf(it.pour.id)} demo={demo} open={!!open[it.pour.id]}
                  onToggle={() => toggle(it.pour.id)} />
                {pred ? (
                  <>
                    <Kpis pred={pred} compact open={kpi.open} onToggle={kpi.toggle} />
                    <Milestones pred={pred} open={!!open[it.pour.id]} />
                    <div>
                      <h3 className="small">압축강도 예측</h3>
                      <StrengthChart pred={pred} compact height={half ? 280 : 220} yMax={yMax} />
                    </div>
                    <div>
                      <h3 className="small">콘크리트 내부온도</h3>
                      <TempChart pred={pred} compact height={half ? 150 : 120} />
                    </div>
                  </>
                ) : <PredFallback state={it.state} onRetry={it.retry} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- 강도 알림 ----------------
// 알림 종류·조건·메일 초안 내용은 components/alerts.ts 에 있다
interface Alerts { list: AlertItem[]; failed: Pour[]; selected: number; unsent: number }

/** 알림 대상: 선택한 회차. 아직 메일 초안을 열지 않은 알림을 위로 */
function buildAlerts(items: Item[]): Alerts {
  const list: AlertItem[] = [];
  const failed: Pour[] = [];
  for (const { pour, state } of items) {
    if (state.error) failed.push(pour);
    else if (state.data) list.push(...alertsFor(pour, state.data));
  }
  list.sort((x, y) => Number(!!x.sentAt) - Number(!!y.sentAt));
  return { list, failed, selected: items.length, unsent: list.filter((x) => !x.sentAt).length };
}

const ALERT_ICON: Record<AlertItem["kind"], string> = { dayBefore: "⏰" };

function AlertPanel({ alerts, checks, demo, onSent }: { alerts: Alerts; checks: CheckItem[]; demo: boolean; onSent: (p: Pour) => void }) {
  const canEdit = useCanEdit();   // 받는 사람은 회차 설정(편집 권한)에서 정한다
  // 서버 SMTP 자동 발송이 켜져 있으면 받는 사람이 있는 진행 중 회차는 서버가 바로 보낸다 (backend notify.py)
  const ns = useAsync(() => (demo ? Promise.resolve(null) : api.notifyStatus()), [demo]);
  const auto = !!ns.data?.enabled;
  // 초안을 열면 '보냄'으로 기록 → 같은 알림은 종 아이콘 숫자에서 빠진다
  const record = (a: AlertItem) => {
    if (demo) return;
    api.recordNotice(a.pour.id, { key: a.key, milestones: milestoneSnapshot(a.pred) }).then(onSent).catch(() => undefined);
  };
  return (
    <section className="card stack" aria-label="알림">
      <div className="stack" role="group" aria-label="강도 알림">
      <h3>강도 알림 {alerts.unsent > 0 && <span className="badge warn">{alerts.unsent}</span>}
        <Info align="right">{auto
          ? `부재 해체 기준 강도에 도달하기 하루 전에 알립니다. 서버가 ${ns.data!.interval_min}분마다 확인해, 받는 사람이 정해진 회차(타설 후 28일 이내)는 메일로 자동 발송합니다. 받는 사람이 없는 회차는 메일 초안 열기로 직접 보냅니다. 받는 사람은 회차 설정에서 정합니다.`
          : "부재 해체 기준 강도에 도달하기 하루 전에 알립니다. 메일 초안 열기를 누르면 기본 메일 앱에 받는 사람·제목·본문이 채워진 초안이 열립니다. 발송은 내용을 확인한 뒤 직접 합니다. 받는 사람은 회차 설정에서 정합니다."}</Info>
      </h3>
      {auto && <div className="tiny">메일 자동 발송 켜짐{ns.data!.sender ? ` · 보내는 주소 ${ns.data!.sender}` : ""}{ns.data!.last_run ? ` · 마지막 확인 ${fmtDateTime(ns.data!.last_run)}` : ""}</div>}
      {auto && ns.data!.last_error && <div className="alert error small">자동 발송 실패: {ns.data!.last_error}. 다음 확인 때 다시 보냅니다.</div>}
      {alerts.selected === 0 && <div className="muted small">선택한 회차가 없습니다.</div>}
      {alerts.failed.length > 0 && (
        <div className="alert error small">
          예측 조회 실패: {alerts.failed.map((p) => p.name).join(", ")}. 이 회차는 경고 여부를 판단하지 못했습니다.
        </div>
      )}
      {alerts.selected > 0 && alerts.list.length === 0 && alerts.failed.length === 0 && (
        <div className="muted small">선택한 회차 중 알릴 내용이 없습니다.</div>
      )}
      <div className="alert-list">
        {alerts.list.map((a) => {
          const to = recipients(a.pour);
          return (
            <div key={`${a.pour.id}-${a.key}`} className={`alert ${a.sentAt ? "info" : "warn"}`}>
              <div className="alert-title">
                <span className="ico" aria-hidden="true">{ALERT_ICON[a.kind]}</span>{title(a.pour)} · {KIND_LABEL[a.kind]}
                {a.sentAt && <span className="badge neutral badge-gap">{a.auto ? "자동 발송" : "메일 초안"} {fmtDateTime(a.sentAt)}</span>}
              </div>
              <div className="small">{a.text}</div>
              <div className="row">
                <a className="btn sm" href={mailtoUrl(a, `${window.location.origin}/pours/${a.pour.id}`)} onClick={() => record(a)}>
                  {a.sentAt ? "초안 다시 열기" : "메일 초안 열기"}
                </a>
                {to.length > 0
                  ? <span className="tiny">받는 사람 {to.join(", ")}</span>
                  : <span className="tiny">받는 사람 미설정 · {demo ? "회차 설정에서 입력" : canEdit ? <Link to={`/pours/${a.pour.id}?tab=settings`}>회차 설정에서 입력</Link> : "편집 권한이 있는 사람이 회차 설정에서 입력"}</span>}
              </div>
            </div>
          );
        })}
      </div>
      </div>
      {!demo && <CheckSection items={checks} />}
    </section>
  );
}
