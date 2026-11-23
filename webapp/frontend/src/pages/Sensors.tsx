// [화면] 센서 데이터 ( /sensors ) — 화면설계서 13쪽, 수행계획서 센서데이터 메뉴
//   ① 타설 회차로 이동: 회차를 고르면 그 회차 센서와 '타설 전날 ~ 타설 후 29일'로 기간을 맞춘다
//   ② 시작일·종료일 (45일 넘으면 1시간 평균, 최대 400일)
//   ③ 센서 칩: 이름(없으면 MAC)·종류·수집 기간을 보고 여러 센서를 켜고 끈다 (숨긴 센서는 빠짐, 회차 연결 센서는 숨겨도 표시)
//   ③-1 칩 오른쪽 ⋮ 아이콘 (편집 권한): 이름 변경·숨기기·삭제. 숨긴 센서는 칩 끝 '숨긴 센서 N개'로 펼쳐 다시 보이게 함
//        (⚠ 백엔드 미연동 목업, components/SensorChipMenu.tsx)
//   ④ 지표별 그래프 (데이터가 없는 지표는 생략, 결측 구간은 선이 끊김)
//   아래: 센서 데이터 자동 수집 상태 (Delta Sharing, components/DeltaStatus.tsx)
//         센서 데이터 불러오기 (CSV 업로드 · 새 타설 등록)
// 주소에 ?pour=3 을 붙이면 3번 회차로 바로 연다 (회차 설정의 '원본 보기').
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, Pour, SensorInfo, SeriesResponse } from "../api/client";
import { sensorName, sensorsApi } from "../api/sensors";
import { DeleteSensorModal, SensorChipMenu } from "../components/SensorChipMenu";
import { Chart, sensorColor, useChartTheme } from "../components/Chart";
import { ErrorBox, Info, Loading, useAsync } from "../components/common";
import DeltaStatus from "../components/DeltaStatus";
import UploadPanel from "../components/UploadPanel";
import { useCanEdit } from "../auth/AuthContext";
import { addHours, fmtDateTime, fmtSensorSpan, hoursBetween } from "../format";
import type { Metric } from "../api/client";

// 그래프 목록 (위에서부터 이 순서). 데이터가 없는 항목은 그래프를 그리지 않는다
const PANELS: { metric: Metric; title: string; unit: string }[] = [
  { metric: "temp_in", title: "콘크리트 내부온도 (채널 1~3 평균)", unit: "℃" },
  { metric: "weight_kg", title: "측압 (kg 환산, 60kg 초과 제거)", unit: "kg" },
  { metric: "temp_out", title: "외기온도", unit: "℃" },
  { metric: "humi", title: "외기습도", unit: "%" },
  { metric: "c_mo", title: "측압장치 내부 수분 c_mo (rawMo=4095 제외)", unit: "" },
  { metric: "uf_val", title: "수분센서 수분값 uf_val", unit: "%" },
];

const MAX_DAYS = 400;
const startOf = (p: Pour) => p.pour_start ?? p.detected_start;
const dateOf = (iso: string) => iso.slice(0, 10);

export default function Sensors() {
  const canEdit = useCanEdit();   // CSV 불러오기는 편집 권한 이상만
  const chartTheme = useChartTheme();
  const sensors = useAsync(sensorsApi.list, []);   // 숨긴 센서 포함 (hidden 표시)
  const pours = useAsync(api.pours, []);
  const [params, setParams] = useSearchParams();
  const [pourId, setPourId] = useState<number | null>(params.get("pour") ? Number(params.get("pour")) : null);
  const [from, setFrom] = useState("");          // 시작일 (YYYY-MM-DD)
  const [to, setTo] = useState("");              // 종료일 (포함)
  const [macs, setMacs] = useState<string[]>([]);
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [seriesTick, setSeriesTick] = useState(0);   // '다시 시도'로 측정값을 다시 불러올 때 증가
  const [loading, setLoading] = useState(false);
  const [inited, setInited] = useState(false);
  const [showHidden, setShowHidden] = useState(false);   // 숨긴 센서 칩도 보기
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);   // 칩 메뉴 결과 안내
  const [toDelete, setToDelete] = useState<SensorInfo | null>(null);

  const all = sensors.data ?? [];
  const allMacs = all.map((s) => s.mac);                 // 색은 숨긴 센서까지 포함한 순서로 고정
  const nameOf = (mac: string) => sensorName(all.find((x) => x.mac === mac) ?? { mac });
  const pour = pours.data?.find((p) => p.id === pourId) ?? null;

  /** 회차로 이동: 그 회차 센서 + 타설 전날 ~ 타설 후 29일 */
  const goPour = (p: Pour) => {
    setPourId(p.id);
    setParams({ pour: String(p.id) }, { replace: true });
    const s = startOf(p);
    if (s) { setFrom(dateOf(addHours(s, -24))); setTo(dateOf(addHours(s, 29 * 24))); }
    setMacs(p.sensors.filter((m) => allMacs.includes(m)));
  };

  // 첫 화면: 주소의 회차, 없으면 최신 측정이 있는 센서 1개의 마지막 30일
  useEffect(() => {
    if (inited || !sensors.data || !pours.data) return;
    setInited(true);
    const p = pours.data.find((x) => x.id === pourId);
    if (p) return goPour(p);
    const latest = [...sensors.data].filter((s) => !s.hidden).sort((a, b) => (a.last < b.last ? 1 : -1))[0];
    if (!latest) return;
    setMacs([latest.mac]);
    setTo(dateOf(latest.last));
    setFrom(dateOf(addHours(latest.last.slice(0, 19), -29 * 24)));
  }, [sensors.data, pours.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = from ? `${from}T00:00:00` : "";
  const end = to ? `${dateOf(addHours(`${to}T00:00:00`, 24))}T00:00:00` : "";
  const days = start && end ? hoursBetween(start, end) / 24 : 0;
  const rangeError = !start || !end ? null : days <= 0 ? "종료일은 시작일과 같거나 뒤여야 합니다."
    : days > MAX_DAYS ? `한 번에 ${MAX_DAYS}일까지 조회할 수 있습니다.` : null;

  // 센서·기간이 바뀌면 다시 불러온다 (0.3초 기다려 연속 클릭 시 한 번만)
  useEffect(() => {
    if (macs.length === 0 || !start || !end || rangeError) { setData(null); return; }
    setLoading(true); setErr(null);
    const t = setTimeout(() => {
      api.series(macs, start, end).then(setData).catch((e) => setErr(e.message)).finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [macs.join(","), start, end, rangeError, seriesTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // 센서를 켤 때 지금 기간에 그 센서 기록이 없으면(또는 처음 고른 센서면) 기간을 그 센서의 수집 기간으로 맞춘다
  // 수집 기간이 MAX_DAYS보다 길면 마지막 MAX_DAYS일만
  const toggle = (mac: string) => {
    if (macs.includes(mac)) return setMacs(macs.filter((x) => x !== mac));
    const s = all.find((x) => x.mac === mac);
    if (s) {
      const first = dateOf(s.first), last = dateOf(s.last);
      const overlaps = from && to && first <= to && last >= from;
      if (macs.length === 0 || !overlaps) {
        const minFrom = dateOf(addHours(`${last}T00:00:00`, -(MAX_DAYS - 1) * 24));
        setFrom(first < minFrom ? minFrom : first);
        setTo(last);
      }
    }
    setMacs([...macs, mac]);
  };
  // 회차 센서를 앞에, 나머지는 최근 수집 순
  // 숨긴 센서는 칩에서 빼되, 지금 그래프에 켜져 있는 센서(회차 연결 등)는 남긴다
  const hiddenCount = all.filter((s) => s.hidden).length;
  const chipOrder = all.filter((s) => !s.hidden || showHidden || macs.includes(s.mac)).sort((a, b) =>
    Number(pour?.sensors.includes(b.mac) ?? 0) - Number(pour?.sensors.includes(a.mac) ?? 0) || (a.last < b.last ? 1 : -1));

  /** 센서 관리에서 바꾼 결과를 목록에 반영. 숨기거나 지운 센서는 그래프에서도 끈다 */
  const onSensorChanged = (s: SensorInfo | null, removedMac?: string) => {
    sensors.setData((xs) => (removedMac ? xs?.filter((x) => x.mac !== removedMac)
      : xs?.map((x) => (x.mac === s?.mac ? s : x))) ?? xs);
    const off = removedMac ?? (s?.hidden ? s.mac : null);
    if (off) setMacs((m) => m.filter((x) => x !== off));
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>센서 데이터</h1>
          <div className="muted small">센서별 측정값 원본 조회<Info align="right">10분 중앙값으로 그립니다 (45일이 넘으면 1시간 평균). 그래프는 드래그·휠과 아래 슬라이더로 확대합니다.</Info></div>
        </div>
      </div>

      <div className="card stack">
        <div className="form-row">
          <label className="field">타설 회차로 이동
            <select value={pourId ?? ""} onChange={(e) => { const p = pours.data?.find((x) => x.id === Number(e.target.value)); if (p) goPour(p); }}>
              <option value="" disabled>회차 선택</option>
              {pours.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">시작일<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field">종료일<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {pour && (
          <div className="tiny">
            {pour.name} 타설 시작 {fmtDateTime(startOf(pour))} {pour.pour_start ? "(확정)" : pour.detected_start ? "(자동 추정)" : "(없음)"}
            {" "}· 연결 센서 {pour.sensors.map(nameOf).join(", ") || "없음"}
          </div>
        )}
        <div className="chips" aria-label="센서 선택">
          {chipOrder.map((s) => (
            <span key={s.mac} className={`chip-item ${canEdit ? "has-menu" : ""} ${s.hidden ? "is-hidden" : ""}`}>
              <button type="button" className={`chip ${macs.includes(s.mac) ? "on" : ""}`} aria-pressed={macs.includes(s.mac)}
                onClick={() => toggle(s.mac)} title="수집 기간 · 실제 데이터 양 (기간 중간이 비어 있을 수 있음)">
                <span className="dot" style={{ background: sensorColor(s.mac, allMacs.indexOf(s.mac)) }} />
                {sensorName(s)} <span className="tiny">{s.label ? `${s.mac} · ` : ""}{s.kind === "moisture" ? "수분" : "측압"} · {fmtSensorSpan(s.first, s.last, s.buckets)}{s.hidden ? " · 숨김" : ""}</span>
              </button>
              {canEdit && <SensorChipMenu s={s} onChanged={(x) => onSensorChanged(x)} onDelete={setToDelete}
                onMessage={(text, error) => setNote(text ? { text, error } : null)} />}
            </span>
          ))}
          {hiddenCount > 0 && (
            <button type="button" className="link-btn tiny" aria-expanded={showHidden} onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? "숨긴 센서 접기" : `숨긴 센서 ${hiddenCount}개`}
            </button>
          )}
          {sensors.data?.length === 0 && <span className="tiny">저장된 센서 데이터가 없습니다.{canEdit && " 아래에서 CSV를 불러오세요."}</span>}
        </div>
        {note && <div className={`alert ${note.error ? "warn" : "success"} small`} role="status">{note.text}</div>}
        <ErrorBox error={rangeError} />
      </div>
      {toDelete && (
        <DeleteSensorModal s={toDelete} linked={(pours.data ?? []).filter((p) => p.sensors.includes(toDelete.mac))} pours={pours.data ?? []}
          onClose={() => setToDelete(null)}
          onDeleted={(text) => { const mac = toDelete.mac; setToDelete(null); setNote({ text }); onSensorChanged(null, mac); }} />
      )}

      <ErrorBox error={err ?? sensors.error ?? pours.error}
        onRetry={() => { if (sensors.error) sensors.reload(); if (pours.error) pours.reload(); if (err) setSeriesTick((t) => t + 1); }} />
      {loading && <Loading />}
      {!loading && macs.length === 0 && all.length > 0 && <div className="alert info">센서를 하나 이상 선택하세요.</div>}
      {data && Object.keys(data.sensors).length === 0 && <div className="alert info">선택한 기간에 이 센서들의 기록이 없습니다.</div>}
      {data && PANELS.map(({ metric, title, unit }) => {
        const series = Object.entries(data.sensors).filter(([, s]) => s[metric]);
        if (series.length === 0) return null;
        return (
          <div className="card" key={metric}>
            <h3 className="mb-2">{title}</h3>
            <Chart height={260} option={{
              tooltip: { trigger: "axis", valueFormatter: (v: number) => (v == null ? "—" : `${Number(v).toFixed(1)} ${unit}`) },
              // 눈금 글자를 한국식으로 (기본값은 영어 월 이름 'Oct' 등이 섞임)
              xAxis: { type: "time", axisLabel: { color: chartTheme.text, formatter: { year: "{yyyy}년", month: "{M}월", day: "{d}", hour: "{HH}:{mm}", minute: "{HH}:{mm}" } } },
              yAxis: { type: "value", name: unit, scale: true },
              dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 4 }],
              series: series.map(([mac, s]) => {
                const c = sensorColor(mac, allMacs.indexOf(mac));
                return {
                  name: nameOf(mac), type: "line", symbol: "none", connectNulls: false, sampling: "lttb",
                  lineStyle: { width: 1.5, color: c }, itemStyle: { color: c },
                  data: s.t.map((t, i) => [t.replace("T", " "), s[metric]![i]]),
                };
              }),
            }} />
          </div>
        );
      })}

      <DeltaStatus onSynced={() => { sensors.reload(); pours.reload(); }} />
      {canEdit && <UploadPanel onUploaded={() => { sensors.reload(); pours.reload(); }} />}
    </main>
  );
}
