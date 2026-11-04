import { useEffect, useState } from "react";
import { api, Metric, SeriesResponse } from "../api/client";
import { Chart, sensorColor } from "../components/Chart";
import { ErrorBox, Loading, useAsync } from "../components/common";
import { fmtDateTime } from "../format";

const PANELS: { metric: Metric; title: string; unit: string }[] = [
  { metric: "temp_in", title: "콘크리트 내부온도 (채널 1~3 평균)", unit: "℃" },
  { metric: "weight_kg", title: "측압 (kg 환산, 60kg 초과 제거)", unit: "kg" },
  { metric: "temp_out", title: "외기온도", unit: "℃" },
  { metric: "humi", title: "외기습도", unit: "%" },
  { metric: "c_mo", title: "내부 수분 c_mo (측압장치, rawMo=4095 제외)", unit: "" },
  { metric: "uf_val", title: "콘크리트 수분 uf_val (수분센서)", unit: "%" },
];

export default function Sensors() {
  const sensors = useAsync(api.sensors, []);
  const pours = useAsync(api.pours, []);
  const [macs, setMacs] = useState<string[]>([]);
  const [range, setRange] = useState({ start: "", end: "" });
  // 처음 열면 가장 최근까지 데이터가 있는 센서의 마지막 30일을 보여준다
  useEffect(() => {
    if (!sensors.data?.length || range.start) return;
    const latest = [...sensors.data].sort((a, b) => (a.last < b.last ? 1 : -1))[0];
    const end = new Date(latest.last);
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    setRange({ start: iso(new Date(end.getTime() - 29 * 86400_000)), end: iso(end) });
    setMacs([latest.mac]);
  }, [sensors.data, range.start]);
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (macs.length === 0 || !range.start) return setData(null);
    setLoading(true); setErr(null);
    const t = setTimeout(() => {
      api.series(macs, `${range.start}T00:00:00`, `${range.end}T23:59:59`)
        .then(setData).catch((e) => setErr(e.message)).finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [macs, range]);

  const toggle = (mac: string) => setMacs((m) => (m.includes(mac) ? m.filter((x) => x !== mac) : [...m, mac]));
  const jumpToPour = (id: string) => {
    const p = pours.data?.find((x) => x.id === Number(id));
    const s = p?.pour_start ?? p?.detected_start;
    if (!p || !s) return;
    const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    setRange({ start: iso(new Date(d.getTime() - 86400_000)), end: iso(new Date(d.getTime() + 29 * 86400_000)) });
    setMacs(p.sensors);
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>센서 데이터</h1>
          <div className="muted small">10분 중앙값 (45일 넘게 조회하면 1시간 평균). 드래그·휠로 확대할 수 있습니다.</div>
        </div>
      </div>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="form-row">
          <label className="field">타설 회차로 이동
            <select defaultValue="" onChange={(e) => jumpToPour(e.target.value)}>
              <option value="" disabled>선택…</option>
              {pours.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">시작<input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} /></label>
          <label className="field">끝<input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} /></label>
        </div>
        <div className="chips">
          {sensors.data?.map((s, i) => (
            <span key={s.mac} className={`chip ${macs.includes(s.mac) ? "on" : ""}`} onClick={() => toggle(s.mac)}>
              <span className="dot" style={{ background: sensorColor(s.mac, i) }} />
              {s.mac} <span className="tiny">{s.kind === "moisture" ? "수분" : "측압"} · {fmtDateTime(s.first)}~{fmtDateTime(s.last)}</span>
            </span>
          ))}
        </div>
      </div>
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
