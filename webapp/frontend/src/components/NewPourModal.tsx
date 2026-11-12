// [창] 새 타설 등록 (대시보드·타설 이력·센서 데이터 화면에서 열림) — 화면설계서 8쪽
// 입력: CSV 파일(선택), 이름, 부재 종류, 타설 일시(날짜 + 선택 시각), 설계기준강도, 센서
// 센서는 자동으로 미리 고른다 (파일 속 센서, 또는 그날 데이터가 있는 센서). 직접 뺀 센서는 파일을 더해도 유지한다.
import { useEffect, useRef, useState } from "react";
import { api, Member, MEMBER_LABEL, Pour, UploadResult } from "../api/client";
import { CsvPeek, peekCsv } from "../csvPeek";
import { fmtDateTime, fromInput } from "../format";
import { ErrorBox, Info, Modal, useAsync } from "./common";

/** 올릴 파일 하나 + 미리 읽은 내용(peek) 또는 읽기 오류 */
interface FileItem { file: File; peek?: CsvPeek; error?: string }

/** 등록 결과: 만든 회차, 업로드 결과, 타설 시각을 못 정했는지 (그러면 '타설 시점 확인' 탭으로 보낸다) */
export interface NewPourResult { pour: Pour; uploads: UploadResult[]; needsTime: boolean }

/** 등록 후 이동할 주소: 시작 시각을 못 찾았으면 타설 시점 확인 탭 */
export const pourUrl = ({ pour, needsTime }: NewPourResult) => `/pours/${pour.id}${needsTime ? "?tab=pourtime" : ""}`;

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
  const [time, setTime] = useState(""); // 비우면 그날 측압으로 자동 추정
  const [design, setDesign] = useState("");
  const [member, setMember] = useState<Member | "">("");
  const [unpicked, setUnpicked] = useState<string[]>([]); // 사용자가 직접 뺀 센서 (파일을 더해도 유지)
  const [touched, setTouched] = useState({ date: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /** 파일 추가: 같은 파일은 한 번만, 추가하자마자 브라우저에서 미리 읽어 센서·기간을 보여 준다 */
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

  // 미리 읽은 파일들에서 센서 목록과 측압 시작 시각을 모은다
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

  // 직접 고치기 전에는 측압 파일 시작일로 타설일을 채워 둔다
  useEffect(() => {
    if (!touched.date) setDate(pressureStart ? pressureStart.slice(0, 10) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressureStart]);

  // 센서는 자동으로 정한다: 올릴 파일이 있으면 파일 속 센서, 없으면 타설일에 데이터가 있는 저장된 센서
  const start = date && time ? `${date}T${time}` : "";
  const refDay = date;
  const candidates = fileSensors.size > 0
    ? [...fileSensors.keys()].sort()
    : refDay
      ? (sensors.data ?? []).filter((s) => s.first.slice(0, 10) <= refDay && s.last.slice(0, 10) >= refDay).map((s) => s.mac)
      : [];
  const macs = candidates.filter((m) => !unpicked.includes(m));
  const macSource = fileSensors.size > 0 ? "올릴 파일에 있는 센서" : `${refDay}에 데이터가 있는 센서`;

  /**
   * 등록 버튼: ① 파일이 있으면 업로드(서버 저장·10분 집계) → ② 회차 생성
   * → ③ 시각 없이 날짜만 넣었으면 그날 측압으로 타설 시작을 자동 추정 (못 찾아도 등록은 됨)
   */
  async function submit() {
    if (candidates.length === 0) {
      return setErr(!name ? "이름과 센서를 선택하세요." : fileSensors.size === 0 && !refDay
        ? "CSV 파일을 추가하거나 타설일을 입력하세요. 센서를 자동으로 찾습니다."
        : `${refDay}에 데이터가 있는 센서가 없습니다. 그날의 CSV를 추가하세요.`);
    }
    if (!name.trim() || macs.length === 0) return setErr("이름과 센서를 선택하세요.");
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
        name: name.trim(), sensors: macs, pour_start: fromInput(start),
        design_strength: design ? Number(design) : null, member: member || null,
      });
      let needsTime = !time;
      if (!time && date) {
        setBusy("타설 시점 추정 중…");
        const found = await api.detect(pour.id, `${date}T00:00:00`).catch(() => null);
        needsTime = !found?.detected_start;
        if (needsTime) alert("회차는 등록됐지만 타설 시작 시각을 찾지 못했습니다. 이어지는 '타설 시점 확인'에서 직접 입력하세요.");
      }
      onDone({ pour, uploads, needsTime });
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
        <span>데이터 파일<Info align="right">이미 저장된 데이터로만 등록하려면 파일을 모두 빼세요.</Info></span>
        <div className="file-list">
          {files.map((f, i) => (
            <div key={i} className="file-row">
              {f.peek && <span className="badge neutral">{f.peek.kind === "pressure" ? "측압" : "수분"}</span>}
              <div className="grow">
                <div className="small"><b>{f.file.name}</b> <span className="tiny">{(f.file.size / 1e6).toFixed(1)} MB</span></div>
                <div className="tiny">
                  {f.error ? <span className="text-bad">{f.error}</span>
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
      </div>

      <label className="field">이름<input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 용인 6회차" /></label>
      <div className="form-row top">
        <div className="field">
          <span>타설 일시</span>
          <div className="row nowrap">
            <input type="date" aria-label="타설 날짜" value={date} className="grow"
              onChange={(e) => { setTouched((t) => ({ ...t, date: true })); setDate(e.target.value); }} />
            <input type="time" aria-label="타설 시작 시각" value={time} className="w-time"
              onChange={(e) => setTime(e.target.value)} />
          </div>
          <span className="tiny">
            {pressureStart && !touched.date ? "측압 파일 시작일로 날짜를 채웠습니다. " : ""}
            {time ? "입력한 시각을 타설 시작으로 확정합니다." : "시각을 비우면 그날 측압으로 타설 시작을 자동 추정합니다."}
          </span>
        </div>
        <label className="field">설계기준강도 (MPa)<input type="number" value={design} onChange={(e) => setDesign(e.target.value)} placeholder="예: 24" /></label>
      </div>
      <label className="field">부재 종류
        <select value={member} onChange={(e) => setMember(e.target.value as Member | "")}>
          <option value="">미지정 (5·14 MPa 모두 표시)</option>
          {(Object.keys(MEMBER_LABEL) as Member[]).map((m) => <option key={m} value={m}>{MEMBER_LABEL[m]} ({m === "wall" ? "5" : "14"} MPa)</option>)}
        </select>
      </label>
      <div className="field">
        <span>센서</span>
        {candidates.length > 0 ? (
          <div className="chips">
            {candidates.map((m) => (
              <label key={m} className={`chip ${macs.includes(m) ? "on" : ""}`}>
                <input type="checkbox" checked={macs.includes(m)} disabled={!!busy}
                  onChange={() => setUnpicked((u) => (u.includes(m) ? u.filter((x) => x !== m) : [...u, m]))} />
                {m}
              </label>
            ))}
          </div>
        ) : <span className="tiny">CSV를 추가하거나 타설일을 입력하면 센서를 찾아 미리 선택합니다.</span>}
        {candidates.length > 0 && <span className="tiny">{macSource}을 미리 골랐습니다.</span>}
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
