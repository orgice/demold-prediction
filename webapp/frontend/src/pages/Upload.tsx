import { useRef, useState } from "react";
import { api, UploadResult } from "../api/client";
import { ErrorBox, useAsync } from "../components/common";
import { fmtFull } from "../format";

export default function Upload() {
  const history = useAsync(api.uploads, []);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list).filter((x) => x.name.toLowerCase().endsWith(".csv"))]);
  };
  const submit = async () => {
    setBusy(true); setErr(null); setResults(null);
    try {
      setResults(await api.upload(files));
      setFiles([]); history.reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <main className="page">
      <div>
        <h1>데이터 업로드</h1>
        <div className="muted small">
          센서 수집 DB에서 내려받은 측압·수분 CSV를 올리면 DB에 저장되고 예측에 바로 반영됩니다.
          이미 들어간 행은 자동으로 건너뜁니다.
        </div>
      </div>
      <div className={`dropzone ${over ? "over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
        <input ref={input} type="file" accept=".csv" multiple hidden onChange={(e) => add(e.target.files)} />
        <div style={{ fontSize: 16, fontWeight: 600 }}>CSV 파일을 끌어다 놓거나 클릭해서 선택</div>
        <div className="tiny">측압·수분 파일은 컬럼으로 자동 구분합니다</div>
      </div>
      {files.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>선택한 파일 {files.length}개</h3>
            <div className="actions">
              <button className="btn" onClick={() => setFiles([])} disabled={busy}>비우기</button>
              <button className="btn primary" onClick={submit} disabled={busy}>{busy ? "업로드·집계 중… (큰 파일은 몇 분)" : "업로드"}</button>
            </div>
          </div>
          <ul className="small">{files.map((f) => <li key={f.name}>{f.name} ({(f.size / 1e6).toFixed(1)} MB)</li>)}</ul>
        </div>
      )}
      <ErrorBox error={err} />
      {results && (
        <div className="card table-wrap">
          <h3 style={{ marginBottom: 8 }}>업로드 결과</h3>
          <table>
            <thead><tr><th>파일</th><th>종류</th><th>새로 저장</th><th>전체 행</th><th>기간</th><th>센서</th></tr></thead>
            <tbody>{results.map((r) => (
              <tr key={r.filename}><td>{r.filename}</td><td>{r.kind === "pressure" ? "측압" : "수분"}</td>
                <td><b>{r.rows_inserted.toLocaleString()}</b></td><td>{r.rows_total.toLocaleString()}</td>
                <td>{fmtFull(r.period_start)} ~ {fmtFull(r.period_end)}</td><td>{r.sensors.join(", ")}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="card table-wrap">
        <h3 style={{ marginBottom: 8 }}>업로드 기록</h3>
        <table>
          <thead><tr><th>시각</th><th>파일</th><th>종류</th><th>새로 저장 / 전체</th><th>데이터 기간</th></tr></thead>
          <tbody>{history.data?.map((u) => (
            <tr key={u.id}><td>{fmtFull(u.created_at)}</td><td>{u.filename}</td><td>{u.kind === "pressure" ? "측압" : "수분"}</td>
              <td>{u.rows_inserted.toLocaleString()} / {u.rows_total.toLocaleString()}</td>
              <td>{fmtFull(u.period_start)} ~ {fmtFull(u.period_end)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </main>
  );
}
