// [화면] 센서 데이터 ( /sensors )
// 타설 회차를 고르면 그 회차 센서들의 측정값을 항목별 그래프로 보여 준다.
import { useEffect, useState } from "react";
import { api, Metric, Pour, SeriesResponse } from "../api/client";
import { Chart, sensorColor } from "../components/Chart";
import { ErrorBox, Loading, useAsync } from "../components/common";
import { addHours, fmtFull } from "../format";

// 그래프 목록 (위에서부터 이 순서). 데이터가 없는 항목은 그래프를 그리지 않는다
const PANELS: { metric: Metric; title: string; unit: string }[] = [
  { metric: "temp_in", title: "콘크리트 내부온도 (채널 1~3 평균)", unit: "℃" },
  { metric: "weight_kg", title: "측압 (kg 환산, 60kg 초과 제거)", unit: "kg" },
  { metric: "temp_out", title: "외기온도", unit: "℃" },
  { metric: "humi", title: "외기습도", unit: "%" },
  { metric: "c_mo", title: "내부 수분 c_mo (측압장치, rawMo=4095 제외)", unit: "" },
  { metric: "uf_val", title: "콘크리트 수분 uf_val (수분센서)", unit: "%" },
];


// 회차의 조회 기간: 타설 하루 전 ~ 타설 후 28일 중 그 회차 센서에 데이터가 있는 구간
const DAY_H = 24;
const iso19 = (s: string) => s.slice(0, 19);

export default function Sensors() {
  const sensors = useAsync(api.sensors, []);                   // 전체 센서 목록 (데이터 기간 포함)
  const pours = useAsync(api.pours, []);                       // 회차 목록
  const [pourId, setPourId] = useState<number | null>(null);   // 고른 회차
  const [macs, setMacs] = useState<string[]>([]);              // 켜 둔 센서
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const startOf = (p: Pour) => p.pour_start ?? p.detected_start;
  // 처음 열면 타설 시작이 가장 최근인 회차
  useEffect(() => {
    if (pourId != null || !pours.data?.length) return;
    const sorted = [...pours.data].sort((a, b) => ((startOf(a) ?? "") < (startOf(b) ?? "") ? 1 : -1));
    setPourId(sorted[0].id);
  }, [pours.data, pourId]);

  const pour = pours.data?.find((p) => p.id === pourId) ?? null;
  const allMacs = sensors.data?.map((s) => s.mac) ?? [];
  const pourSensors = (sensors.data ?? []).filter((s) => pour?.sensors.includes(s.mac));

  // 조회 기간 = [타설 하루 전, 타설 후 28일] 과 [센서 데이터 처음, 끝] 이 겹치는 구간
  let period: { start: string; end: string } | null = null;
  if (pour && pourSensors.length > 0) {
    const first = pourSensors.map((s) => iso19(s.first)).sort()[0];
    const last = pourSensors.map((s) => iso19(s.last)).sort().reverse()[0];
    const s = startOf(pour);
    const from = s ? [addHours(s, -DAY_H), first].sort()[1] : first;
    const to = s ? [addHours(s, 28 * DAY_H), last].sort()[0] : last;
    period = from <= to ? { start: from, end: to } : null;
  }

  // 회차가 바뀌면 그 회차 센서를 모두 켠다
  const pourKey = `${pour?.id}:${pourSensors.map((s) => s.mac).join(",")}`;
  useEffect(() => { setMacs(pourSensors.map((s) => s.mac)); }, [pourKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 센서·기간이 바뀌면 그래프 데이터를 다시 불러온다 (0.3초 기다려 연속 클릭 시 한 번만)
  useEffect(() => {
    if (macs.length === 0 || !period) return setData(null);
    setLoading(true); setErr(null);
    const t = setTimeout(() => {
      api.series(macs, period!.start, period!.end)
        .then(setData).catch((e) => setErr(e.message)).finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [macs, period?.start, period?.end]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 센서 칩을 누르면 켜고 끈다 */
  const toggle = (mac: string) => setMacs((m) => (m.includes(mac) ? m.filter((x) => x !== mac) : [...m, mac]));

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>센서 데이터</h1>
          <div className="muted small">타설 회차를 고르면 그 회차 센서의 타설 하루 전~28일 데이터를 보여 줍니다. 10분 중앙값 (45일 넘으면 1시간 평균). 드래그·휠로 확대할 수 있습니다.</div>
        </div>
      </div>
      {pours.data?.length === 0 && <div className="alert info">등록된 타설 회차가 없습니다. 데이터 업로드에서 새 타설을 등록하세요.</div>}
      {pour && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="form-row">
            <label className="field">타설 회차
              <select value={pour.id} onChange={(e) => setPourId(Number(e.target.value))}>
                {pours.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <div className="small">
              <div className="tiny">타설 시작</div>
              {fmtFull(startOf(pour))}{" "}
              {pour.pour_start ? <span className="badge good">확정</span>
                : pour.detected_start ? <span className="badge warn">자동 추정</span> : <span className="badge bad">없음</span>}
            </div>
            <div className="small">
              <div className="tiny">조회 기간</div>
              {period ? `${fmtFull(period.start)} ~ ${fmtFull(period.end)}` : "이 회차 센서에 해당 기간 데이터가 없습니다"}
            </div>
          </div>
          <div className="chips">
            {pourSensors.map((s) => (
              <span key={s.mac} className={`chip ${macs.includes(s.mac) ? "on" : ""}`} onClick={() => toggle(s.mac)}>
                <span className="dot" style={{ background: sensorColor(s.mac, allMacs.indexOf(s.mac)) }} />
                {s.mac} <span className="tiny">{s.kind === "moisture" ? "수분" : "측압"}</span>
              </span>
            ))}
            {pourSensors.length === 0 && <span className="tiny">이 회차 센서의 데이터가 없습니다.</span>}
          </div>
        </div>
      )}
      <ErrorBox error={err ?? sensors.error} />
      {loading && <Loading />}
      {data && PANELS.map(({ metric, title, unit }) => {
        const series = Object.entries(data.sensors).filter(([, s]) => s[metric]);
        if (series.length === 0) return null;
        const allMacs = sensors.data?.map((s) => s.mac) ?? [];
        return (
          <div className="card" key={metric}>
            <h3 style={{ marginBottom: 4 }}>{title}</h3>
            <Chart height={260} option={{
              tooltip: { trigger: "axis", valueFormatter: (v: number) => (v == null ? "—" : `${Number(v).toFixed(1)} ${unit}`) },
              xAxis: { type: "time" },
              yAxis: { type: "value", name: unit, scale: true },
              dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 4 }],
              series: series.map(([mac, s]) => {
                const c = sensorColor(mac, allMacs.indexOf(mac));
                return {
                  name: mac, type: "line", symbol: "none", connectNulls: false, sampling: "lttb",
                  lineStyle: { width: 1.5, color: c }, itemStyle: { color: c },
                  data: s.t.map((t, i) => [t.replace("T", " "), s[metric]![i]]),
                };
              }),
            }} />
          </div>
        );
      })}
      {data && Object.keys(data.sensors).length === 0 && <div className="alert info">이 기간에 선택한 센서 데이터가 없습니다.</div>}
    </main>
  );
}
