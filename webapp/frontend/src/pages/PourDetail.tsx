import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, Pour, Prediction, StrengthTest, StrengthTestIn } from "../api/client";
import { Chart, sensorColor, useChartTheme } from "../components/Chart";
import { ErrorBox, Loading, MilestoneRow, useAsync } from "../components/common";
import { fmtAge, fmtDateTime, fmtFull, fromInput, hoursBetween, toInput } from "../format";

type Tab = "predict" | "pourtime" | "tests" | "settings";
const TABS: [Tab, string][] = [
  ["predict", "강도 예측"], ["pourtime", "타설 시점 확인"], ["tests", "공시체 결과"], ["settings", "설정"],
];

// pourId 를 주면 그 회차를 보여준다 (메인 화면에서 진행 중인 타설을 띄울 때). 없으면 주소의 :id
export default function PourDetail({ pourId, live }: { pourId?: number; live?: boolean } = {}) {
  const routeId = useParams().id;
  const id = pourId ?? Number(routeId);
  const pour = useAsync(() => api.pour(id), [id]);
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(([k]) => k === params.get("tab"))?.[0] ?? "predict") as Tab;
  const setTab = (t: Tab) => setParams(t === "predict" ? {} : { tab: t }, { replace: true });
  const [version, setVersion] = useState(0); // 저장 후 예측 다시 계산
  const changed = () => { pour.reload(); setVersion((v) => v + 1); };

  if (pour.error) return <main className="page"><ErrorBox error={pour.error} /></main>;
  if (!pour.data) return <main className="page"><Loading /></main>;
  const p = pour.data;
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{p.name} {live && <span className="badge good" style={{ verticalAlign: "middle" }}>공사 진행 중</span>}</h1>
          <div className="muted small">
            {p.site ?? ""} · 타설 시작 {fmtFull(p.pour_start ?? p.detected_start)}{" "}
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
              ? `시험 ${testMeans(pred, true).length}회(공시체 ${pred.model.calibration_tests}개)로 회차 보정`
              : "공시체 결과 입력 시 정확도 향상"}
          </div>
        </div>
      </div>

      <div className="grid split">
        <div className="card">
          <div className="card-head"><h3>압축강도 예측 곡선</h3><span className="tiny">음영 = 90% 범위</span></div>
          <StrengthChart pred={pred} design={pour.design_strength} />
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>해체 가능 예상 시각</h3>
          <div className="milestones">{pred.milestones.map((m) => <MilestoneRow key={m.label} m={m} />)}</div>
          <div className="tiny" style={{ marginTop: 10 }}>
            벽·기둥 측면 5 MPa, 슬래브 밑면 14 MPa (KCS 14 20 12). 현장 판단은 보수적 시각 기준을 권장합니다.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>콘크리트 내부온도</h3><span className="tiny">점선 = 가정한 미래 온도</span></div>
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

function StrengthChart({ pred, design }: { pred: Prediction; design: number | null }) {
  const th = useChartTheme();
  const day = (h: number) => +(h / 24).toFixed(3);
  const obs = pred.series.filter((s) => s.observed);
  const fut = pred.series.filter((s, i, a) => !s.observed || (a[i + 1] && !a[i + 1].observed));
  const lines = [
    { yAxis: 5, name: "벽체 5 MPa" }, { yAxis: 14, name: "슬래브 14 MPa" },
    ...(design ? [{ yAxis: design, name: `설계 ${design} MPa` }] : []),
  ];
  const option = {
    tooltip: {
      trigger: "axis",
      // 커서 위치에 가장 가까운 시점의 강도·범위·적산온도·내부온도를 함께 보여 준다
      formatter: (params: { seriesName: string; value: number[]; marker: string }[]) => {
        const x = params[0]?.value[0];
        if (x == null) return "";
        const s = pred.series.reduce((a, b) => (Math.abs(day(b.age_h) - x) < Math.abs(day(a.age_h) - x) ? b : a));
        const f1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
        const rows = [
          `<b>${fmtDateTime(s.t)}</b> · 타설 후 ${fmtAge(s.age_h)}`,
          `${params.find((p) => p.seriesName.startsWith("예측"))?.marker ?? ""}예측 강도 <b>${f1(s.strength)} MPa</b>`,
          `90% 범위 ${f1(s.lower)}–${f1(s.upper)} MPa`,
          `적산온도 <b>${f1(s.maturity)} ℃·일</b>`,
          `내부온도 ${s.temp == null ? "—" : `${f1(s.temp)} ℃`} (${s.observed ? "관측" : "가정"})`,
          ...params.filter((p) => p.seriesName === "공시체 시험 결과")
            .map((p) => `${p.marker}공시체 평균 ${f1(p.value[1])} MPa`),
        ];
        return rows.join("<br/>");
      },
    },
    legend: { data: ["예측 (관측 온도)", "예측 (가정 온도)", "공시체 시험 결과"] },
    xAxis: { type: "value", name: "타설 후 (일)", nameLocation: "middle", nameGap: 28, min: 0, max: 28 },
    yAxis: { type: "value", name: "MPa", min: 0 },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 4 }],
    series: [
      { // 90% 범위: 상한을 따라갔다가 하한을 거꾸로 돌아오는 다각형
        name: "범위", type: "custom", silent: true, tooltip: { show: false }, data: [0],
        renderItem: (_: unknown, api: { coord: (p: number[]) => number[] }) => ({
          type: "polygon",
          shape: { points: [
            ...pred.series.map((s) => api.coord([day(s.age_h), s.upper])),
            ...[...pred.series].reverse().map((s) => api.coord([day(s.age_h), s.lower])),
          ] },
          style: { fill: th.accent, opacity: 0.15 },
        }),
        clip: true, z: 0 },
      { name: "예측 (관측 온도)", type: "line", data: obs.map((s) => [day(s.age_h), s.strength]), symbol: "none",
        lineStyle: { width: 2, color: th.accent }, itemStyle: { color: th.accent },
        markLine: {
          symbol: "none", silent: true, label: { formatter: "{b}", position: "insideEndTop", color: th.text },
          lineStyle: { color: th.text, type: "dashed", width: 1 },
          data: [...lines, { xAxis: day(hoursBetween(pred.start, pred.as_of)), name: nowLabel(pred.as_of) }],
        } },
      { name: "예측 (가정 온도)", type: "line", data: fut.map((s) => [day(s.age_h), s.strength]), symbol: "none",
        lineStyle: { width: 2, type: "dashed", color: th.accent }, itemStyle: { color: th.accent } },
      { name: "공시체 시험 결과", type: "scatter", symbolSize: 10,
        data: testMeans(pred, true).map((t) => [day(t.age_h), t.fc]),
        itemStyle: { color: "#eb6834", borderColor: th.surface, borderWidth: 1.5 } },
    ],
  };
  return <Chart option={option} height={380} />;
}

// 마지막 센서 데이터가 1시간 이내면 "현재 시각", 늦어지면 그 시각을 적어 데이터가 끊긴 걸 보이게 한다
function nowLabel(asOf: string) {
  const lagMs = Date.now() - new Date(asOf).getTime();
  return lagMs <= 3600_000 ? "현재 시각" : `마지막 데이터 ${fmtDateTime(asOf)}`;
}

// 한 번의 시험(같은 test_id)에서 깬 공시체 2~3개를 평균 내 점 하나로 그린다
function testMeans(pred: Prediction, used: boolean) {
  const groups = new Map<number, { age_h: number; sum: number; n: number }>();
  for (const t of pred.tests) {
    if (t.used_for_calibration !== used) continue;
    const g = groups.get(t.test_id) ?? { age_h: t.age_h, sum: 0, n: 0 };
    g.sum += t.fc; g.n += 1;
    groups.set(t.test_id, g);
  }
  return [...groups.values()].map((g) => ({ age_h: g.age_h, fc: +(g.sum / g.n).toFixed(2) }));
}

function TempChart({ pred }: { pred: Prediction }) {
  const th = useChartTheme();
  const day = (h: number) => +(h / 24).toFixed(3);
  const option = {
    tooltip: { trigger: "axis", valueFormatter: (v: number) => (v == null ? "—" : `${Number(v).toFixed(1)} ℃`) },
    legend: { data: ["관측", "가정"] },
    xAxis: { type: "value", name: "타설 후 (일)", nameLocation: "middle", nameGap: 28, min: 0, max: 28 },
    yAxis: { type: "value", name: "℃", scale: true },
    series: [
      { name: "관측", type: "line", symbol: "none", lineStyle: { width: 1.5, color: th.accent }, itemStyle: { color: th.accent },
        data: pred.series.filter((s) => s.observed).map((s) => [day(s.age_h), s.temp]) },
      { name: "가정", type: "line", symbol: "none", lineStyle: { width: 1.5, type: "dashed", color: th.text }, itemStyle: { color: th.text },
        data: pred.series.filter((s) => !s.observed).map((s) => [day(s.age_h), s.temp]) },
    ],
  };
  return <Chart option={option} height={220} />;
}

// ---------------- 타설 시점 확인 ----------------
function PourTimeTab({ pour, onSaved }: { pour: Pour; onSaved: () => void }) {
  const th = useChartTheme();
  const day = useAsync(() => api.pourDay(pour.id), [pour.id, pour.detected_start, pour.pour_start]);
  const [start, setStart] = useState(toInput(pour.pour_start));
  const [end, setEnd] = useState(toInput(pour.pour_end));
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async (s: string | null, e: string | null) => {
    setErr(null);
    try {
      await api.updatePour(pour.id, { pour_start: s, pour_end: e });
      setMsg("저장했습니다. 강도 예측이 새 타설 시각으로 다시 계산됩니다.");
      onSaved();
    } catch (x) { setErr((x as Error).message); }
  };
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
const emptyTest = (): StrengthTestIn => ({
  test_datetime: "", nominal_age_day: null, curing: "field", s1: null, s2: null, s3: null, note: null,
});

function TestsTab({ pour, onSaved }: { pour: Pour; onSaved: () => void }) {
  const tests = useAsync(() => api.tests(pour.id), [pour.id]);
  const [form, setForm] = useState<StrengthTestIn>(emptyTest());
  const [editing, setEditing] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const num = (v: string) => (v === "" ? null : Number(v));
  const submit = async () => {
    setErr(null);
    if (!form.test_datetime) return setErr("시험 일시를 입력하세요.");
    try {
      if (editing) await api.updateTest(pour.id, editing, form);
      else await api.addTest(pour.id, form);
      setForm(emptyTest()); setEditing(null); tests.reload(); onSaved();
    } catch (e) { setErr((e as Error).message); }
  };
  const edit = (t: StrengthTest) => {
    setEditing(t.id);
    setForm({ ...t, test_datetime: t.test_datetime.slice(0, 19) });
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
          현장양생 공시체 결과를 넣으면 이 회차 예측이 보정됩니다 (1일 공시체 하나로도 14 MPa 시각 오차가 크게 줄어듭니다).
          수중양생은 표시만 하고 보정에는 쓰지 않습니다.
        </div>
        <div className="form-row">
          <label className="field">시험 일시<input type="datetime-local" value={toInput(form.test_datetime)}
            onChange={(e) => setForm({ ...form, test_datetime: fromInput(e.target.value) ?? "" })} /></label>
          <label className="field">재령 (일)<input type="number" value={form.nominal_age_day ?? ""}
            onChange={(e) => setForm({ ...form, nominal_age_day: num(e.target.value) })} /></label>
          <label className="field">양생<select value={form.curing} onChange={(e) => setForm({ ...form, curing: e.target.value as "field" | "water" })}>
            <option value="field">현장양생</option><option value="water">수중양생</option></select></label>
          {(["s1", "s2", "s3"] as const).map((k, i) => (
            <label key={k} className="field">공시체 {i + 1} (MPa)<input type="number" step="0.1" value={form[k] ?? ""}
              onChange={(e) => setForm({ ...form, [k]: num(e.target.value) })} /></label>
          ))}
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          {editing && <button className="btn" onClick={() => { setEditing(null); setForm(emptyTest()); }}>취소</button>}
          <button className="btn primary" onClick={submit}>{editing ? "수정 저장" : "추가"}</button>
        </div>
        <ErrorBox error={err} />
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>시험 일시</th><th>재령</th><th>양생</th><th>S1</th><th>S2</th><th>S3</th><th>평균 (MPa)</th><th>비고</th><th /></tr></thead>
          <tbody>
            {tests.data?.map((t) => (
              <tr key={t.id}>
                <td>{fmtFull(t.test_datetime)}</td>
                <td>{t.nominal_age_day ?? "—"}일</td>
                <td>{t.curing === "field" ? "현장" : "수중"}</td>
                <td>{t.s1 ?? "—"}</td><td>{t.s2 ?? "—"}</td><td>{t.s3 ?? "—"}</td>
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

// ---------------- 설정 ----------------
function SettingsTab({ pour, onSaved }: { pour: Pour; onSaved: () => void }) {
  const nav = useNavigate();
  const [f, setF] = useState({
    name: pour.name, site: pour.site ?? "", design: pour.design_strength?.toString() ?? "",
    note: pour.note ?? "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    try {
      await api.updatePour(pour.id, {
        name: f.name, site: f.site || null, note: f.note || null,
        design_strength: f.design ? Number(f.design) : null,
      });
      setMsg("저장했습니다."); onSaved();
    } catch (e) { setErr((e as Error).message); }
  };
  const remove = async () => {
    if (!confirm(`${pour.name}과 공시체 결과를 모두 삭제할까요? (센서 데이터는 남습니다)`)) return;
    await api.deletePour(pour.id); nav("/pours");
  };

  return (
    <div className="card">
      <div className="form-row">
        <label className="field">이름<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">현장<input value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} /></label>
        <label className="field">설계기준강도 (MPa)<input type="number" value={f.design} placeholder="배합표 확인 후 입력"
          onChange={(e) => setF({ ...f, design: e.target.value })} /></label>
      </div>
      <label className="field" style={{ marginTop: 12 }}>메모<textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      <div className="actions" style={{ marginTop: 12, justifyContent: "space-between" }}>
        <button className="btn danger" onClick={remove}>회차 삭제</button>
        <button className="btn primary" onClick={save}>저장</button>
      </div>
      {msg && <div className="alert info" style={{ marginTop: 10 }}>{msg}</div>}
      <ErrorBox error={err} />
    </div>
  );
}
