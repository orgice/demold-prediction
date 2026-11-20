// [대시보드의 일부] 새 타설 감지 — 실시간 수집 센서에서 찾은, 아직 회차로 등록되지 않은 타설
// 편집 권한: 이름·부재·설계강도를 정해 바로 회차로 등록하거나 '타설 아님'으로 무시한다.
//   등록하면 감지한 시각이 '자동 추정'으로 들어가고, 회차 상세 '타설 시점 확인' 탭에서 확정한다.
// 보기 권한: 안내만 보인다. 서버: GET/POST /api/live/candidates (backend routers/live.py, 계산은 live_detect.py)
import { useEffect, useState } from "react";
import { api, LiveCandidate, Member, MEMBER_LABEL, Pour } from "../api/client";
import { useCanEdit } from "../auth/AuthContext";
import { ErrorBox, Info, useAsync } from "./common";
import { fmtDateTime } from "../format";

const REFRESH_MS = 5 * 60_000;   // 서버도 5분 동안 결과를 재사용한다

/** 기존 회차 이름 방식(타설일 YYMMDD, 예: 260915) */
const defaultName = (start: string) => start.slice(2, 10).replace(/-/g, "");

export default function LiveCandidates({ onRegistered }: { onRegistered: (p: Pour) => void }) {
  const list = useAsync(api.liveCandidates, []);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") list.reload(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const items = list.data?.candidates ?? [];
  if (items.length === 0) return null;
  return (
    <>{items.map((c) => <CandidateCard key={c.key} c={c} onDone={list.reload} onRegistered={onRegistered} />)}</>
  );
}

function CandidateCard({ c, onDone, onRegistered }: { c: LiveCandidate; onDone: () => void; onRegistered: (p: Pour) => void }) {
  const canEdit = useCanEdit();
  const [name, setName] = useState(defaultName(c.start));
  const [member, setMember] = useState<Member | "">("");
  const [design, setDesign] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const register = async () => {
    if (!name.trim()) return setErr("회차 이름을 입력하세요.");
    setBusy(true); setErr(null);
    try {
      const p = await api.registerCandidate({ key: c.key, name: name.trim(), member: member || null,
        design_strength: design ? Number(design) : null });
      onRegistered(p); onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const dismiss = async () => {
    if (!confirm(`${fmtDateTime(c.start)} 측압 상승을 타설이 아닌 것으로 보고 다시 띄우지 않을까요?`)) return;
    setBusy(true); setErr(null);
    try { await api.dismissCandidate(c.key); onDone(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <section className="card stack">
      <div className="card-head">
        <h3>
          <span className="badge info">새 타설 감지</span>{" "}
          {fmtDateTime(c.start)} 타설로 보이는 측압 상승
          <Info align="right">실시간으로 수집 중인 센서 중 진행 중 회차에 연결되지 않은 센서에서, 센서 {c.sensors.length}개의 측압이 30분 안에 함께 올랐어요. 등록하면 이 시각을 자동 추정 타설 시각으로 강도 예측과 알림을 시작해요. 정확한 시각은 회차 상세의 '타설 시점 확인' 탭에서 확정하세요.</Info>
        </h3>
      </div>
      <div className="small">
        {fmtDateTime(c.start)} ~ {fmtDateTime(c.end)} · 센서 {c.sensors.length}개 함께 상승 · 상승 합 {c.rise_kg} kg
        {c.temp_jump && " · 내부온도 변화 있음"}
      </div>
      <div className="chips">{c.sensors.map((m) => <span key={m} className="chip">{m}</span>)}</div>
      <details className="small">
        <summary>센서별 상승 시각</summary>
        <div className="muted mt-2">{c.events.map((e) => `${e.at} ${e.mac} +${e.kg}kg`).join(" · ")}</div>
      </details>
      {canEdit ? (
        <>
          <div className="form-row">
            <label className="field">회차 이름<input value={name} maxLength={100} disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field">부재 종류
              <select value={member} disabled={busy} onChange={(e) => setMember(e.target.value as Member | "")}>
                <option value="">나중에 정하기</option>
                {(Object.keys(MEMBER_LABEL) as Member[]).map((m) => <option key={m} value={m}>{MEMBER_LABEL[m]}</option>)}
              </select>
            </label>
            <label className="field">설계기준강도 (MPa)<input type="number" value={design} disabled={busy} placeholder="나중에 입력 가능"
              onChange={(e) => setDesign(e.target.value)} /></label>
          </div>
          <ErrorBox error={err} />
          <div className="actions">
            <button className="btn" disabled={busy} onClick={dismiss}>타설 아님</button>
            <button className="btn primary" disabled={busy} onClick={register}>{busy ? "처리 중…" : "회차로 등록"}</button>
          </div>
        </>
      ) : (
        <div className="tiny">편집 권한이 있는 사용자가 확인하고 등록하면 강도 예측이 시작돼요.</div>
      )}
    </section>
  );
}
