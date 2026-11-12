// [센서 데이터 화면의 일부] 센서 데이터 불러오기 (수행계획서: 센서데이터 › 센서 데이터 불러오기)
// 기본: CSV를 끌어다 놓으면 새 타설 등록 창(NewPourModal)이 열려 업로드와 회차 등록을 한 번에 한다.
// 기존 회차에 이어지는 데이터는 '타설 등록 없이 파일만 올리기'로 올린다.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, Pour, UploadResult } from "../api/client";
import { ErrorBox, useAsync } from "./common";
import NewPourModal, { NewPourResult } from "./NewPourModal";
import { fmtFull } from "../format";

export default function UploadPanel({ onUploaded }: { onUploaded?: () => void }) {
  const history = useAsync(api.uploads, []);                       // 업로드 기록 표
  const [files, setFiles] = useState<File[]>([]);                  // '파일만 올리기'로 고른 파일
  const [over, setOver] = useState(false);                         // 파일을 끌고 드롭존 위에 있는지
  const [busy, setBusy] = useState(false);                         // 업로드 중
  const [results, setResults] = useState<UploadResult[] | null>(null);   // 방금 올린 결과
  const [err, setErr] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [pending, setPending] = useState<File[]>([]); // 팝업에 넘길 파일
  const [created, setCreated] = useState<Pour | null>(null);     // 방금 등록한 회차 (완료 알림용)
  const input = useRef<HTMLInputElement>(null);

  /** 고른 파일 중 .csv만 목록에 더한다 */
  const add = (list: FileList | null) => {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list).filter((x) => x.name.toLowerCase().endsWith(".csv"))]);
  };
  /** '파일만 올리기': 회차 등록 없이 업로드만 */
  const submit = async () => {
    setBusy(true); setErr(null); setResults(null); setCreated(null);
    try {
      setResults(await api.upload(files));
      setFiles([]); history.reload(); onUploaded?.();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  /** 새 타설 등록 창 열기 (고른 파일을 넘김) */
  const openRegister = (list: File[]) => { setPending(list); setRegistering(true); };

  /** 등록 창이 끝났을 때: 완료 알림을 띄우고 기록을 새로 불러온다 */
  const registered = ({ pour, uploads }: NewPourResult) => {
    setRegistering(false);
    setCreated(pour);
    setResults(uploads.length > 0 ? uploads : null);
    setFiles([]); history.reload(); onUploaded?.();
  };

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <h2>센서 데이터 불러오기</h2>
          <div className="muted small">
            측압·수분 CSV를 올리면서 새 타설을 함께 등록합니다. 이미 들어간 행은 자동으로 건너뜁니다.
          </div>
        </div>
        <button className="btn primary" onClick={() => openRegister(files)}>+ 새 타설 등록</button>
      </div>
      {created && (
        <div className="alert success" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span>
            {results ? `파일 ${results.length}개(${results.reduce((n, r) => n + r.rows_inserted, 0).toLocaleString()}행)를 저장하고 ` : ""}
            타설 이력에 <b>{created.name}</b>을(를) 등록했습니다.
          </span>
          <Link to={`/pours/${created.id}`} className="btn sm">타설 상세에서 그래프 보기</Link>
        </div>
      )}
      <div className={`dropzone ${over ? "over" : ""}`}
        onClick={() => openRegister([])}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); openRegister(Array.from(e.dataTransfer.files)); }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>CSV 파일을 끌어다 놓거나 클릭해서 새 타설 등록</div>
        <div className="tiny">측압·수분 파일은 컬럼으로 자동 구분합니다</div>
      </div>
      <div className="small muted">
        기존 회차에 이어지는 데이터라면{" "}
        <button className="btn sm" onClick={() => input.current?.click()}>타설 등록 없이 파일만 올리기</button>
        <input ref={input} type="file" accept=".csv" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>
      {files.length > 0 && (
        <div>
          <div className="card-head">
            <h3>선택한 파일 {files.length}개</h3>
            <div className="actions">
              <button className="btn" onClick={() => setFiles([])} disabled={busy}>비우기</button>
              <button className="btn" onClick={() => openRegister(files)} disabled={busy}>새 타설로 등록</button>
              <button className="btn primary" onClick={submit} disabled={busy}>{busy ? "업로드·집계 중… (큰 파일은 몇 분)" : "업로드"}</button>
            </div>
          </div>
          <ul className="small">{files.map((f) => <li key={f.name}>{f.name} ({(f.size / 1e6).toFixed(1)} MB)</li>)}</ul>
        </div>
      )}
      <ErrorBox error={err} />
      {results && (
        <div className="table-wrap">
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
      <details className="table-wrap">
        <summary className="small">업로드 기록</summary>
        <table>
          <thead><tr><th>시각</th><th>파일</th><th>종류</th><th>새로 저장 / 전체</th><th>데이터 기간</th></tr></thead>
          <tbody>{history.data?.map((u) => (
            <tr key={u.id}><td>{fmtFull(u.created_at)}</td><td>{u.filename}</td><td>{u.kind === "pressure" ? "측압" : "수분"}</td>
              <td>{u.rows_inserted.toLocaleString()} / {u.rows_total.toLocaleString()}</td>
              <td>{fmtFull(u.period_start)} ~ {fmtFull(u.period_end)}</td></tr>
          ))}</tbody>
        </table>
      </details>
      {registering && <NewPourModal initialFiles={pending} onClose={() => setRegistering(false)} onDone={registered} />}
    </section>
  );
}
