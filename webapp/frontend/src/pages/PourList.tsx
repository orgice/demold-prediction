import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { ErrorBox, Loading, MilestoneBadge, Modal, useAsync } from "../components/common";
import { fmtAge, fmtDateTime, fmtFull, fromInput } from "../format";

export default function PourList() {
  const { data, error, loading } = useAsync(api.summary, []);
  const [creating, setCreating] = useState(false);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>타설 이력</h1>
          <div className="muted small">전체 회차의 압축강도 예측과 해체 가능 예상 시각 (최신 센서 데이터 기준)</div>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>+ 새 타설 등록</button>
      </div>
      <ErrorBox error={error} />
      {loading && <Loading text="예측 계산 중…" />}
      <div className="grid cols-2">
        {data?.map(({ pour, error, current_strength, strength_28d, milestones, as_of, design_ratio_28d }) => (
          <Link key={pour.id} to={`/pours/${pour.id}`} className="card" style={{ color: "inherit" }}>
            <div className="card-head">
              <div>
                <h2>{pour.name}</h2>
                <div className="tiny">
                  타설 {fmtFull(pour.pour_start ?? pour.detected_start)}{" "}
                  {pour.pour_start ? <span className="badge good">확정</span> : <span className="badge warn">자동 추정</span>}
                </div>
              </div>
              {current_strength != null && (
                <div style={{ textAlign: "right" }}>
                  <div className="tiny">현재 예측 강도</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{current_strength.toFixed(1)} MPa</div>
                  <div className="tiny">기준 {fmtDateTime(as_of)}</div>
                </div>
              )}
            </div>
            {error && <div className="alert warn small">{error}</div>}
            {milestones && (
              <table>
                <tbody>
                  {milestones.map((m) => (
                    <tr key={m.label}>
                      <td>{m.label}</td>
                      <td>{fmtDateTime(m.expected)} <span className="tiny">({fmtAge(m.expected_age_h)})</span></td>
                      <td style={{ textAlign: "right" }}><MilestoneBadge m={m} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {strength_28d != null && (
              <div className="tiny" style={{ marginTop: 8 }}>
                28일 예측 {strength_28d.toFixed(1)} MPa
                {design_ratio_28d != null ? ` · 설계강도 대비 ${(design_ratio_28d * 100).toFixed(0)}%` : " · 설계강도 미입력"}
                {" · "}공시체 {pour.test_count}건
              </div>
            )}
          </Link>
        ))}
      </div>
      {creating && <NewPourModal onClose={() => setCreating(false)} />}
    </main>
  );
}

function NewPourModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const sensors = useAsync(api.sensors, []);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [design, setDesign] = useState("");
  const [macs, setMacs] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name || macs.length === 0) return setErr("이름과 센서를 선택하세요.");
    setBusy(true);
    setErr(null);
    try {
      const p = await api.createPour({
        name, sensors: macs, pour_start: fromInput(start),
        design_strength: design ? Number(design) : null,
      });
      if (!start && date) {
        await api.detect(p.id, `${date}T00:00:00`).catch(() => undefined); // 못 찾으면 상세에서 직접 입력
      }
      nav(`/pours/${p.id}`);
    } catch (e) {
      setErr(String((e as Error).message));
      setBusy(false);
    }
  }

  return (
    <Modal title="새 타설 등록" onClose={onClose}>
      <label className="field">이름<input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 용인 6회차" /></label>
      <div className="form-row">
        <label className="field">타설일 (자동 추정용)<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field">타설 시작 (알면 입력)<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field">설계기준강도 (MPa)<input type="number" value={design} onChange={(e) => setDesign(e.target.value)} placeholder="예: 24" /></label>
      </div>
      <div className="field">
        <span className="small muted">센서 선택</span>
        <div className="chips">
          {sensors.data?.map((s) => (
            <span key={s.mac} className={`chip ${macs.includes(s.mac) ? "on" : ""}`}
              onClick={() => setMacs((m) => (m.includes(s.mac) ? m.filter((x) => x !== s.mac) : [...m, s.mac]))}>
              {s.mac} <span className="tiny">{s.kind === "moisture" ? "수분" : "측압"} ~{fmtDateTime(s.last)}</span>
            </span>
          ))}
        </div>
      </div>
      <ErrorBox error={err} />
      <div className="actions">
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={busy} onClick={submit}>등록</button>
      </div>
    </Modal>
  );
}
