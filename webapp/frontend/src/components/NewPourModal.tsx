import { useEffect, useRef, useState } from "react";
import { api, Pour, UploadResult } from "../api/client";
import { CsvPeek, peekCsv } from "../csvPeek";
import { fmtDateTime, fromInput } from "../format";
import { ErrorBox, Modal, useAsync } from "./common";

interface FileItem { file: File; peek?: CsvPeek; error?: string }

export interface NewPourResult { pour: Pour; uploads: UploadResult[] }

/** 새 타설 등록. 올릴 CSV를 함께 받으면 업로드 → 타설 생성 → 자동 추정 순으로 처리한다. */
export default function NewPourModal({ onClose, onDone, initialFiles = [] }: {
  onClose: () => void;
  onDone: (r: NewPourResult) => void;
  initialFiles?: File[];
}) {
  const sensors = useAsync(api.sensors, []);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [design, setDesign] = useState("");
  const [macs, setMacs] = useState<string[]>([]);
  const [touched, setTouched] = useState({ date: false, macs: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: File[]) => {
    const csv = list.filter((f) => f.name.toLowerCase().endsWith(".csv"));
    const same = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
    setFiles((prev) => [...prev, ...csv.filter((f) => !prev.some((x) => same(x.file, f))).map((file) => ({ file }))]);
    csv.forEach((file) =>
      peekCsv(file)
        .then((peek) => setFiles((prev) => prev.map((x) => (x.file === file ? { ...x, peek } : x))))
        .catch((e) => setFiles((prev) => prev.map((x) => (x.file === file ? { ...x, error: (e as Error).message } : x)))));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => add(initialFiles), []);

  const peeks = files.flatMap((f) => (f.peek ? [f.peek] : []));
  const reading = files.some((f) => !f.peek && !f.error);
  const fileSensors = new Map<string, { kind: CsvPeek["kind"]; last: string }>();
  peeks.forEach((p) => p.sensors.forEach((s) => {
    const prev = fileSensors.get(s.mac);
    if (!prev || s.last > prev.last) fileSensors.set(s.mac, { kind: p.kind, last: s.last });
  }));
  // 깨진 MAC 행은 빼고 측압 센서가 처음 찍힌 시각
  const pressureStart = peeks.filter((p) => p.kind === "pressure")
    .flatMap((p) => p.sensors.map((s) => s.first)).sort()[0] ?? null;

  // 직접 고치기 전에는 파일 내용으로 타설일·센서를 채워 둔다
  const fileMacKey = [...fileSensors.keys()].sort().join(",");
  useEffect(() => {
    if (!touched.date) setDate(pressureStart ? pressureStart.slice(0, 10) : "");
    if (!touched.macs) setMacs(fileMacKey ? fileMacKey.split(",") : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressureStart, fileMacKey]);

  // DB에 있는 센서 + 파일에만 있는 새 센서
  const chips = (sensors.data ?? []).map((s) => {
    const f = fileSensors.get(s.mac);
    return { mac: s.mac, kind: s.kind, last: f && f.last > s.last ? f.last : s.last, fromFile: !!f };
  });
  for (const [mac, f] of fileSensors) {
    if (!chips.some((c) => c.mac === mac)) chips.push({ mac, kind: f.kind, last: f.last, fromFile: true });
  }

  const toggle = (mac: string) => {
    setTouched((t) => ({ ...t, macs: true }));
    setMacs((m) => (m.includes(mac) ? m.filter((x) => x !== mac) : [...m, mac]));
  };

  async function submit() {
    if (!name || macs.length === 0) return setErr("이름과 센서를 선택하세요.");
    setErr(null);
    let uploads: UploadResult[] = [];
    try {
      if (files.length > 0) {
        setBusy("업로드·집계 중… (큰 파일은 몇 분)");
        uploads = await api.upload(files.map((f) => f.file));
      }
    } catch (e) {
      setErr(`업로드 실패: ${(e as Error).message}`);
      return setBusy(null);
    }
    try {
      setBusy("타설 등록 중…");
      const pour = await api.createPour({
        name, sensors: macs, pour_start: fromInput(start),
        design_strength: design ? Number(design) : null,
      });
      if (!start && date) {
        setBusy("타설 시점 추정 중…");
        await api.detect(pour.id, `${date}T00:00:00`).catch(() => undefined); // 못 찾으면 상세에서 직접 입력
      }
      onDone({ pour, uploads });
    } catch (e) {
      // 업로드가 끝난 뒤 실패하면 데이터는 이미 저장돼 있으니 파일을 비우고 다시 등록하게 한다
      setErr(uploads.length > 0
        ? `파일은 저장됐지만 타설 등록에 실패했습니다: ${(e as Error).message}`
        : String((e as Error).message));
      if (uploads.length > 0) setFiles([]);
      setBusy(null);
    }
  }

  return (
    <Modal title="새 타설 등록" onClose={busy ? () => undefined : onClose}>
      <div className="field">
        <span className="small muted">데이터 파일</span>
        <div className="file-list">
          {files.map((f, i) => (
            <div key={i} className="file-row">
              {f.peek && <span className={`badge ${f.peek.kind === "pressure" ? "info" : "good"}`}>{f.peek.kind === "pressure" ? "측압" : "수분"}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="small"><b>{f.file.name}</b> <span className="tiny">{(f.file.size / 1e6).toFixed(1)} MB</span></div>
                <div className="tiny">
                  {f.error ? <span style={{ color: "var(--bad)" }}>{f.error}</span>
                    : f.peek ? `${f.peek.sensors.map((s) => s.mac).join(", ") || "센서 없음"} · ${fmtDateTime(f.peek.period_start)} ~ ${fmtDateTime(f.peek.period_end)}`
                    : "파일 읽는 중…"}
                </div>
              </div>
              <button className="btn sm" aria-label={`${f.file.name} 빼기`} disabled={!!busy}
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="file-add" disabled={!!busy}
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); add(Array.from(e.dataTransfer.files)); }}>
            + CSV 파일 추가 (끌어다 놓아도 됩니다)
          </button>
          <input ref={input} type="file" accept=".csv" multiple hidden
            onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        </div>
        <span className="tiny">이미 저장된 데이터로만 등록하려면 파일을 모두 빼세요.</span>
      </div>

      <label className="field">이름<input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 용인 6회차" /></label>
      <div className="form-row" style={{ alignItems: "start" }}>
        <label className="field">타설일 (자동 추정용)
          <input type="date" value={date} onChange={(e) => { setTouched((t) => ({ ...t, date: true })); setDate(e.target.value); }} />
          {pressureStart && !touched.date && <span className="tiny">측압 파일 시작일로 채웠습니다</span>}
        </label>
        <label className="field">타설 시작 (알면 입력)<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field">설계기준강도 (MPa)<input type="number" value={design} onChange={(e) => setDesign(e.target.value)} placeholder="예: 24" /></label>
      </div>
      <div className="field">
        <span className="small muted">
          센서 선택{fileSensors.size > 0 && " · 올릴 파일에 있는 센서를 골라 두었습니다"}
        </span>
        <div className="chips">
          {chips.map((s) => (
            <span key={s.mac} className={`chip ${macs.includes(s.mac) ? "on" : ""}`} onClick={() => toggle(s.mac)}>
              {s.mac} <span className="tiny">{s.kind === "moisture" ? "수분" : "측압"} ~{fmtDateTime(s.last)}</span>
              {s.fromFile && <span className="badge info">새 파일</span>}
            </span>
          ))}
        </div>
      </div>
      <ErrorBox error={err} />
      <div className="actions">
        <button className="btn" onClick={onClose} disabled={!!busy}>취소</button>
        <button className="btn primary" disabled={!!busy || reading} onClick={submit}>
          {busy ?? (reading ? "파일 읽는 중…" : files.length > 0 ? "업로드하고 등록" : "등록")}
        </button>
      </div>
    </Modal>
  );
}
