// [화면] 회차 상세 ( /pours/3 ) — 화면설계서 9~12쪽
// 위쪽: 회차 이름·타설 시작·센서. 아래: 탭 4개
//   강도 예측       PredictionTab  (예측 강도, 해체 가능 시각, 그래프)
//   타설 시점 확인  PourTimeTab    (타설일 측압 그래프, 실제 타설 시각 입력)
//   공시체 결과     TestsTab       (압축강도 시험 결과 입력)
//   설정            SettingsTab    (기본 정보, 연결 센서, CSV 후속 데이터, 제외 구간, 회차 삭제) → PourSettings.tsx
// 지금 탭은 주소 뒤 ?tab=... 에 기록돼 새로고침해도 유지된다.
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api, MEMBER_LABEL, Pour, StrengthTest, StrengthTestIn } from "../api/client";
import { Chart, sensorColor, useChartTheme } from "../components/Chart";
import { ErrorBox, Loading, MilestoneRow, useAsync } from "../components/common";
import { StrengthChart, TempChart, testPoints } from "../components/StrengthChart";
import { fmtFull, fromInput, toInput } from "../format";
import SettingsTab from "./PourSettings";

type Tab = "predict" | "pourtime" | "tests" | "settings";
// [탭 이름(주소용), 화면에 보이는 글자]
const TABS: [Tab, string][] = [
  ["predict", "강도 예측"], ["pourtime", "타설 시점 확인"], ["tests", "공시체 결과"], ["settings", "설정"],
];

export default function PourDetail() {
  const id = Number(useParams().id);
  const pour = useAsync(() => api.pour(id), [id]);
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(([k]) => k === params.get("tab"))?.[0] ?? "predict") as Tab;
  const setTab = (t: Tab) => setParams(t === "predict" ? {} : { tab: t }, { replace: true });
  const [version, setVersion] = useState(0); // 저장 후 예측 다시 계산
  // 다른 탭에서 저장하면: 회차 정보를 다시 불러오고, 강도 예측도 새로 계산하게 한다
  const changed = () => { pour.reload(); setVersion((v) => v + 1); };

  if (pour.error) return <main className="page"><ErrorBox error={pour.error} /></main>;
  if (!pour.data) return <main className="page"><Loading /></main>;
  const p = pour.data;
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{p.name}{p.member && <span className="badge neutral" style={{ verticalAlign: "middle", marginLeft: 8 }}>{MEMBER_LABEL[p.member]}</span>}</h1>
          <div className="muted small">
            {p.site ? `${p.site} · ` : ""}타설 시작 {fmtFull(p.pour_start ?? p.detected_start)}{" "}
            {p.pour_start ? <span className="badge good">확정</span> : <span className="badge warn">자동 추정 — 확인 필요</span>}
            {" "}· 센서 {p.sensors.join(", ")}
          </div>
        </div>
      </div>
      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === "predict" && <PredictionTab pour={p} version={version} />}
      {tab === "pourtime" && <PourTimeTab pour={p} onSaved={changed} />}
      {tab === "tests" && <TestsTab pour={p} onSaved={changed} />}
      {tab === "settings" && <SettingsTab pour={p} onSaved={changed} />}
    </main>
  );
}

// ---------------- 강도 예측 ----------------
/** 강도 예측 탭: KPI 3개(현재 강도·28일 강도·보정) → 예측 곡선과 해체 시각 → 내부온도 → 모델 정보 */
function PredictionTab({ pour, version }: { pour: Pour; version: number }) {
  const latest = useAsync(() => api.prediction(pour.id), [pour.id, version]);
  if (latest.error) return <ErrorBox error={latest.error} />;
  const pred = latest.data;
  if (!pred) return <Loading text="예측 계산 중…" />;

  return (
    <>
      <div className="grid kpis">
        <div className="kpi">
          <div className="label">현재 예측 강도</div>
          <div className="value">{pred.current_strength.toFixed(1)} MPa</div>
          <div className="sub">90% 범위 {pred.current_range[0].toFixed(1)}–{pred.current_range[1].toFixed(1)}</div>
        </div>
        <div className="kpi">
          <div className="label">28일 예측 강도</div>
          <div className="value">{pred.strength_28d.toFixed(1)} MPa</div>
          <div className="sub">
            {pred.design_ratio_28d != null
              ? `설계강도 대비 ${(pred.design_ratio_28d * 100).toFixed(0)}%${pred.design_ratio_28d < 1 ? " — 양생 관리 필요" : ""}`
              : "설계강도 미입력 (설정 탭)"}
          </div>
        </div>
        <div className="kpi">
          <div className="label">보정</div>
          <div className="value">{pred.model.calibrated ? `×${pred.model.calibration_scale.toFixed(2)}` : "없음"}</div>
          <div className="sub">
            {pred.model.calibrated
              ? `현장양생 시험 ${testPoints(pred, true).length}회로 이 회차 보정`
              : "공시체 결과 입력 시 정확도 향상"}
          </div>
        </div>
      </div>

      <div className="grid split">
        <div className="card">
          <div className="card-head"><h3>최초 예측과 실측 기반 추정</h3><span className="tiny">옅은 주황 음영 = 90% 범위</span></div>
          <StrengthChart pred={pred} design={pour.design_strength} />
          <div className="tiny">점선은 최초 예측(타설 후 24시간 시점), 초록선은 실측 온도로 계산한 값, 주황선은 현재 시점에서 이어지는 수정 예측입니다.</div>
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>해체 가능 예상 시각</h3>
          <div className="milestones">{pred.milestones.map((m) => (
            <MilestoneRow key={m.label} m={m}
              baseAgeH={pred.baseline?.milestones.find((b) => b.label === m.label)?.expected_age_h} />
          ))}</div>
          <div className="tiny" style={{ marginTop: 10 }}>
            벽·기둥 측면 5 MPa, 슬래브 밑면 14 MPa (KCS 14 20 12). 현장 판단은 보수적 시각 기준을 권장합니다.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>콘크리트 내부온도</h3><span className="tiny">점선 = 최근 24시간 패턴을 반복한다는 가정</span></div>
        <TempChart pred={pred} />
      </div>

      <details className="card small">
        <summary>모델 정보</summary>
        <div className="muted" style={{ marginTop: 8 }}>
          {pred.model.method} ·{" "}
          {pred.model.fixed_curve
            ? "고정 곡선 (학습할 공시체 회차가 2개 미만)"
            : `학습 회차 ${pred.model.train_pours.join(", ")}번 (이 회차 제외), 공시체 ${pred.model.train_specimens}개`} ·
          곡선 Su={pred.model.params.Su} MPa, k={pred.model.params.k}, M0={pred.model.params.M0} ℃·일 ·
          σ={pred.model.sigma} · {pred.model.forecast}
        </div>
      </details>
    </>
  );
}

// ---------------- 타설 시점 확인 ----------------
/** 타설 시점 확인 탭: 타설일 1분 측압 그래프(추정·확정 시각 표시) + 실제 타설 시각 입력 */
function PourTimeTab({ pour, onSaved }: { pour: Pour; onSaved: () => void }) {
  const th = useChartTheme();
  const day = useAsync(() => api.pourDay(pour.id), [pour.id, pour.detected_start, pour.pour_start]);
  const [start, setStart] = useState(toInput(pour.pour_start));
  const [end, setEnd] = useState(toInput(pour.pour_end));
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  /** 확정 시각 저장 (null을 보내면 확정 해제 → 자동 추정값으로 돌아감) */
  const save = async (s: string | null, e: string | null) => {
    setErr(null);
    try {
      await api.updatePour(pour.id, { pour_start: s, pour_end: e });
      setMsg("저장했습니다. 강도 예측이 새 타설 시각으로 다시 계산됩니다.");
      onSaved();
    } catch (x) { setErr((x as Error).message); }
  };
  /** 저장된 타설일로 자동 추정을 다시 돌린다 */
  const redetect = async () => {
    setErr(null);
    try { await api.detect(pour.id); setMsg("자동 추정을 다시 했습니다."); onSaved(); }
    catch (x) { setErr((x as Error).message); }
  };

  const option = useMemo(() => {
    if (!day.data) return null;
    const marks = [
      // 시작 라벨은 아래, 종료 라벨은 위 (두 시각이 가까워도 겹치지 않게)
      pour.detected_start && { xAxis: pour.detected_start, name: "추정 시작", lineStyle: { type: "dashed" }, label: { position: "start" } },
      pour.detected_end && { xAxis: pour.detected_end, name: "추정 종료", lineStyle: { type: "dashed" }, label: { position: "end" } },
      pour.pour_start && { xAxis: pour.pour_start, name: "확정 시작", lineStyle: { type: "solid", width: 2 }, label: { position: "start" } },
      pour.pour_end && { xAxis: pour.pour_end, name: "확정 종료", lineStyle: { type: "solid", width: 2 }, label: { position: "end" } },
    ].filter(Boolean);
    return {
      tooltip: { trigger: "axis", valueFormatter: (v: number) => (v == null ? "—" : `${Number(v).toFixed(1)} kg`) },
      xAxis: { type: "time" },
      yAxis: { type: "value", name: "측압 (kg)" },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 4 }],
      series: Object.entries(day.data.series).map(([mac, pts], i) => ({
        name: mac, type: "line", symbol: "none", data: pts.map(([t, v]) => [t.replace("T", " "), v]),
        lineStyle: { width: 1.5, color: sensorColor(mac, i) }, itemStyle: { color: sensorColor(mac, i) },
        ...(i === 0 ? { markLine: { symbol: "none", label: { formatter: "{b}", color: th.text },
          lineStyle: { color: th.strong }, data: marks.map((m) => ({ ...(m as object), xAxis: String((m as { xAxis: string }).xAxis).replace("T", " ") })) } } : {}),
      })),
    };
  }, [day.data, pour, th]);

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h3>타설일 측압 (1분 중앙값, 60kg 초과 제거)</h3>
          <button className="btn sm" onClick={redetect}>자동 추정 다시 하기</button>
        </div>
        <div className="tiny" style={{ marginBottom: 8 }}>
          타설 중에는 측압이 층마다 계단식으로 오르고, 타설이 끝나면 최고점 이후 서서히 내려갑니다.
          드래그·휠로 확대해서 시작과 종료를 확인하세요. 짧게 튀는 값은 거푸집 설치 중 망치질일 수 있습니다.
        </div>
        {day.loading && <Loading />}
        <ErrorBox error={day.error} />
        {option && Object.keys(day.data!.series).length > 0 ? <Chart option={option} height={400} />
          : !day.loading && <div className="alert info">이 날짜의 측압 데이터가 없습니다.</div>}
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 10 }}>타설 시각 확정</h3>
        <div className="small muted" style={{ marginBottom: 10 }}>
          자동 추정: {fmtFull(pour.detected_start)} ~ {fmtFull(pour.detected_end)}.
          실제 시각(작업일지·레미콘 송장)을 알면 입력하세요. 적산온도는 <b>타설 시작</b>부터 계산합니다.
        </div>
        <div className="form-row">
          <label className="field">타설 시작<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field">타설 종료<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn primary" onClick={() => save(fromInput(start), fromInput(end))}>저장</button>
            <button className="btn" onClick={() => { setStart(toInput(pour.detected_start)); setEnd(toInput(pour.detected_end)); }}>
              추정값 넣기
            </button>
            {pour.pour_start && <button className="btn" onClick={() => { setStart(""); setEnd(""); save(null, null); }}>확정 해제</button>}
          </div>
        </div>
        {msg && <div className="alert info" style={{ marginTop: 10 }}>{msg}</div>}
        <ErrorBox error={err} />
      </div>
    </>
  );
}

// ---------------- 공시체 결과 ----------------
/** 빈 입력칸 (현장양생 기본) */
const emptyTest = (): StrengthTestIn => ({
  test_datetime: "", nominal_age_day: null, curing: "field", s1: null, s2: null, s3: null, note: null,
});

/** 공시체 결과 탭: 평균 압축강도 하나를 입력. 현장양생 결과는 이 회차 예측 보정에 쓰인다 */
function TestsTab({ pour, onSaved }: { pour: Pour; onSaved: () => void }) {
  const tests = useAsync(() => api.tests(pour.id), [pour.id]);
  const [form, setForm] = useState<StrengthTestIn>(emptyTest());
  const [editing, setEditing] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const num = (v: string) => (v === "" ? null : Number(v));
  const submit = async () => {
    setErr(null);
    if (!form.test_datetime) return setErr("시험 일시를 입력하세요.");
    if (form.s1 == null) return setErr("평균 압축강도를 입력하세요.");
    try {
      if (editing) await api.updateTest(pour.id, editing, form);
      else await api.addTest(pour.id, form);
      setForm(emptyTest()); setEditing(null); tests.reload(); onSaved();
    } catch (e) { setErr((e as Error).message); }
  };
  const edit = (t: StrengthTest) => {
    setEditing(t.id);
    // 평균 하나만 다룬다: 예전에 3개로 넣은 결과는 평균값으로 바꿔 저장된다
    setForm({ ...t, test_datetime: t.test_datetime.slice(0, 19), s1: t.average, s2: null, s3: null });
  };
  const remove = async (t: StrengthTest) => {
    if (!confirm(`${fmtFull(t.test_datetime)} 시험 결과를 삭제할까요?`)) return;
    await api.deleteTest(pour.id, t.id); tests.reload(); onSaved();
  };

  return (
    <>
      <div className="card">
        <h3 style={{ marginBottom: 10 }}>{editing ? "공시체 결과 수정" : "공시체 결과 입력"}</h3>
        <div className="small muted" style={{ marginBottom: 10 }}>
          시험기관 보고서의 평균 압축강도(MPa) 하나를 입력합니다. 재령 1.6일 이하 현장양생 결과는 이 회차 예측 보정에 쓰이고
          (1일 공시체 하나로도 14 MPa 도달 시각 오차가 크게 줄어듭니다), 수중양생 결과는 기록만 하고 보정에는 쓰지 않습니다.
        </div>
        <div className="form-row">
          <label className="field">시험 일시<input type="datetime-local" value={toInput(form.test_datetime)}
            onChange={(e) => setForm({ ...form, test_datetime: fromInput(e.target.value) ?? "" })} /></label>
          <label className="field">재령 (일)<input type="number" value={form.nominal_age_day ?? ""}
            onChange={(e) => setForm({ ...form, nominal_age_day: num(e.target.value) })} /></label>
          <label className="field">양생<select value={form.curing} onChange={(e) => setForm({ ...form, curing: e.target.value as "field" | "water" })}>
            <option value="field">현장양생</option><option value="water">수중양생</option></select></label>
          <label className="field">평균 압축강도 (MPa)<input type="number" step="0.1" value={form.s1 ?? ""}
            onChange={(e) => setForm({ ...form, s1: num(e.target.value), s2: null, s3: null })} /></label>
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          {editing && <button className="btn" onClick={() => { setEditing(null); setForm(emptyTest()); }}>취소</button>}
          <button className="btn primary" onClick={submit}>{editing ? "수정 저장" : "추가"}</button>
        </div>
        <ErrorBox error={err} />
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>시험 일시</th><th>재령</th><th>양생</th><th>평균 압축강도 (MPa)</th><th>비고</th><th /></tr></thead>
          <tbody>
            {tests.data?.map((t) => (
              <tr key={t.id}>
                <td>{fmtFull(t.test_datetime)}</td>
                <td>{t.nominal_age_day ?? "—"}일</td>
                <td>{t.curing === "field" ? "현장" : "수중"}</td>
                <td><b>{t.average?.toFixed(1) ?? "—"}</b></td>
                <td className="tiny">{t.note}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn sm" onClick={() => edit(t)}>수정</button>{" "}
                  <button className="btn sm danger" onClick={() => remove(t)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tests.data?.length === 0 && <div className="muted small" style={{ padding: 12 }}>아직 입력된 결과가 없습니다.</div>}
      </div>
    </>
  );
}

