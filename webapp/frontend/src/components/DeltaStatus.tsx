// [센서 데이터 화면의 일부] 센서 데이터 자동 수집 상태 (협력사 Delta Sharing → DB)
// 켜져 있으면 마지막 수집 시각·새로 저장한 행 수·오류·토큰 만료일을 보여 준다. 관리자는 '지금 수집'.
// 서버: GET /api/delta/status, POST /api/delta/run (backend routers/delta.py, 수집은 delta_sync.py)
import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorBox, Info, useAsync } from "./common";
import { fmtFull } from "../format";

const TOKEN_WARN_DAYS = 14;   // 토큰 만료가 이만큼 남으면 미리 알린다

export default function DeltaStatus({ onSynced }: { onSynced?: () => void }) {
  const { user } = useAuth();
  const st = useAsync(api.deltaStatus, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const s = st.data;
  if (!s) return null;

  const run = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.runDelta();
      const n = Object.values(r.result ?? {}).reduce((a, b) => a + b, 0);
      setMsg(r.last_error ? null : n > 0 ? `새 데이터 ${n.toLocaleString()}행을 저장했어요.` : "새로 들어온 데이터가 없어요.");
      st.reload(); if (n > 0) onSynced?.();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const total = Object.values(s.last_inserted ?? {}).reduce((a, b) => a + b, 0);
  const daysLeft = s.token_expires ? (Date.parse(s.token_expires) - Date.now()) / 86_400_000 : null;

  return (
    <div className="card stack">
      <div className="card-head">
        <h3>센서 데이터 자동 수집
          <Info align="right">협력사가 Delta Sharing으로 공유한 측압·수분 센서 데이터를 {s.interval_min}분마다 가져와 저장해요. CSV로 이미 올린 기간과 겹치는 행은 건너뛰어요. 수집한 데이터는 아래 업로드 기록에 'Delta Sharing'으로 하루에 한 줄씩 남아요.</Info>
        </h3>
        {s.enabled && user?.role === "admin" && (
          <button className="btn sm" disabled={busy || s.running} onClick={run}>{busy || s.running ? "수집 중…" : "지금 수집"}</button>
        )}
      </div>
      {!s.enabled ? (
        <div className="tiny">꺼져 있어요. 자격증명 파일(webapp/.env 의 DELTA_SHARE_FILE)을 설정하면 켜져요. 지금은 CSV 업로드만 써요.</div>
      ) : (
        <div className="small">
          <span className="badge good">켜짐</span>{" "}
          마지막 수집 {s.last_run ? fmtFull(s.last_run) : "아직 없음 (서버 시작 직후)"}
          {s.last_run && !s.last_error && <> · 새 데이터 {total.toLocaleString()}행</>}
          {s.last_ok && s.last_error && <> · 마지막 성공 {fmtFull(s.last_ok)}</>}
        </div>
      )}
      {s.last_error && <div className="alert error small">수집 오류: {s.last_error}</div>}
      {daysLeft != null && daysLeft < TOKEN_WARN_DAYS && (
        <div className="alert warn small">
          접속 토큰이 {daysLeft <= 0 ? "만료됐어요" : `${Math.ceil(daysLeft)}일 뒤 만료돼요`} ({s.token_expires!.slice(0, 10)}). 협력사에 새 자격증명을 요청하세요.
        </div>
      )}
      <ErrorBox error={err} />
      {msg && <div className="alert success small" role="status">{msg}</div>}
    </div>
  );
}
