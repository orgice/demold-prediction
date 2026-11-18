// [회차 상세 › 설정 탭] 화면설계서 12쪽, 수행계획서 '센서와 타설 연결'·'데이터 상태 확인'
//   ① 기본 정보 (이름·현장·부재 종류·설계기준강도·해체 기준·알림 받을 메일·메모)
//      해체 기준: 조건(구조 형식·내구성)으로 자동 계산, 예외로 직접 입력(KCS 최소값 이상 + 사유). 서버 criteria.py 가 최종 계산
//   ② 연결 센서 선택·변경 → 이 회차 예측에 쓸 센서
//   ③ CSV 후속 데이터 추가 (같은 센서의 이어지는 기록, 중복 행은 건너뜀)
//   ④ 측정 구간 제외: 센서 이상·탈형 작업으로 튄 구간을 예측 계산에서만 뺀다 (원본은 그대로)
//   ⑤ 회차 삭제 (공시체 결과와 제외 구간은 함께 삭제, 센서 데이터는 남음)
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, Member, MEMBER_LABEL, Pour, Structure, STRUCTURE_LABEL, UploadResult } from "../api/client";
import { ErrorBox, Info, Loading, useAsync } from "../components/common";
import { previewCriterion } from "../components/criteria";
import { fmtDateTime, fmtFull, fmtSensorSpan, fromInput } from "../format";

const REASONS = ["탈형 작업", "센서 이상", "거푸집 설치 충격", "기타"];

/** 저장된 회차 값으로 채운 입력 칸 (처음 열 때·취소할 때) */
const initForm = (pour: Pour) => ({
  name: pour.name, site: pour.site ?? "", design: pour.design_strength?.toString() ?? "",
  note: pour.note ?? "", member: (pour.member ?? "") as Member | "", emails: pour.notify_emails ?? "",
  structure: (pour.structure ?? "") as Structure | "", durable: !!pour.durable,
  overrideOn: pour.removal_override != null, override: pour.removal_override?.toString() ?? "",
  reason: pour.removal_override_reason ?? "",
});

export default function SettingsTab({ pour, onSaved }: { pour: Pour; onSaved: () => void }) {
  const nav = useNavigate();
  const sensors = useAsync(api.sensors, []);
  const [f, setF] = useState(() => initForm(pour));
  const [macs, setMacs] = useState<string[]>(pour.sensors);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null); setMsg(null);
    if (!f.name.trim()) return setErr("이름을 입력하세요.");
    if (macs.length === 0) return setErr("연결 센서를 하나 이상 선택하세요.");
    if (overrideOn) {
      const v = Number(f.override);
      if (!f.override || !(v > 0)) return setErr("직접 입력할 해체 기준(MPa)을 입력하세요.");
      if (v < preview!.minimum) return setErr(`해체 기준은 KCS 최소값 ${preview!.minimum} MPa보다 낮게 정할 수 없습니다.`);
      if (!f.reason.trim()) return setErr("해체 기준을 직접 입력한 사유를 적어 주세요.");
    }
    try {
      const saved = await api.updatePour(pour.id, {
        name: f.name.trim(), site: f.site || null, note: f.note || null,
        design_strength: f.design ? Number(f.design) : null, member: f.member || null, sensors: macs,
        notify_emails: f.emails.trim() || null,
        structure: f.structure || null, durable: f.durable,
        removal_override: overrideOn ? Number(f.override) : null,
        removal_override_reason: overrideOn ? f.reason.trim() : null,
      });
      setF(initForm(saved));   // 서버가 정리한 값으로 (메일 주소 중복 제거·쉼표 구분 등)
      setMsg("저장했습니다. 그래프와 예측값을 다시 계산합니다."); onSaved();
    } catch (e) { setErr((e as Error).message); }
  };
  const remove = async () => {
    const text = `${pour.name}을(를) 삭제할까요?\n\n함께 삭제: 공시체 결과 ${pour.test_count}건, 제외 구간\n유지: 센서 원본 데이터 (센서 데이터 화면에서 계속 조회 가능)`;
    if (!confirm(text)) return;
    try { await api.deletePour(pour.id); nav("/pours"); }
    catch (e) { setErr((e as Error).message); }
  };
  const toggle = (m: string) => setMacs((x) => (x.includes(m) ? x.filter((y) => y !== m) : [...x, m]));
  const dirty = JSON.stringify(f) !== JSON.stringify(initForm(pour)) || [...macs].sort().join() !== [...pour.sensors].sort().join();
  // 해체 기준 미리보기 (부재를 정했을 때만). 직접 입력은 부재를 정해야 쓸 수 있다
  const preview = f.member ? previewCriterion(f.member, f.structure || null, f.durable, f.design ? Number(f.design) : null) : null;
  const overrideOn = !!preview && f.overrideOn;

  return (
    <>
      <div className="card stack">
        <h3>기본 정보</h3>
        <div className="form-row">
          <label className="field">이름<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">현장<input value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} /></label>
          <label className="field">부재 종류
            <select value={f.member} onChange={(e) => setF({ ...f, member: e.target.value as Member | "" })}>
              <option value="">미지정</option>
              {(Object.keys(MEMBER_LABEL) as Member[]).map((m) => <option key={m} value={m}>{MEMBER_LABEL[m]} ({m === "wall" ? "5" : "14"} MPa부터)</option>)}
            </select>
          </label>
          <label className="field">설계기준강도 (MPa)<input type="number" value={f.design} placeholder="배합표 확인 후 입력"
            onChange={(e) => setF({ ...f, design: e.target.value })} /></label>
        </div>
        <div className="field">
          <span>해체 기준<Info align="right">KCS 14 20 12 (해체 가이드라인 표 2.1.1) 기준입니다. 벽·기둥 측면은 5 MPa(내구성이 중요한 구조물은 10 MPa), 슬래브 밑면은 단층 구조면 설계기준강도의 2/3와 14 MPa 중 큰 값, 다층 구조면 설계기준강도 이상입니다.</Info></span>
          {!preview ? (
            <span className="tiny">부재 종류를 정하면 해체 기준을 계산합니다. 지금은 벽체 5 MPa·슬래브 14 MPa 최소값을 모두 보여 줍니다.</span>
          ) : (
            <>
              {f.member === "slab" && (
                <div className="form-row">
                  <label className="field">구조 형식
                    <select value={f.structure} onChange={(e) => setF({ ...f, structure: e.target.value as Structure | "" })}>
                      <option value="">미선택 (단층 기준으로 계산)</option>
                      {(Object.keys(STRUCTURE_LABEL) as Structure[]).map((k) => <option key={k} value={k}>{STRUCTURE_LABEL[k]}</option>)}
                    </select>
                  </label>
                </div>
              )}
              {f.member === "wall" && (
                <label className="row small check-line">
                  <input type="checkbox" checked={f.durable} onChange={(e) => setF({ ...f, durable: e.target.checked })} />
                  내구성이 중요한 구조물 (동결융해·탄산화·염해 등에 노출, 발주처 협의)
                </label>
              )}
              <span className="tiny">자동 계산 {preview.strength} MPa · {preview.basis}</span>
              {preview.warning && !overrideOn && <div className="alert warn small">{preview.warning}</div>}
              <label className="row small check-line">
                <input type="checkbox" checked={f.overrideOn} onChange={(e) => setF({ ...f, overrideOn: e.target.checked })} />
                기준 직접 입력 (책임기술자 지시, 필러 동바리 구조계산 등)
              </label>
              {overrideOn && (
                <div className="form-row top">
                  <label className="field">해체 기준 (MPa)
                    <input type="number" min={preview.minimum} step="0.1" value={f.override} placeholder={String(preview.strength)}
                      onChange={(e) => setF({ ...f, override: e.target.value })} />
                    <span className="tiny">KCS 최소값 {preview.minimum} MPa 이상</span>
                  </label>
                  <label className="field">사유 (필수)
                    <input value={f.reason} maxLength={300} placeholder="예: 책임기술자 지시로 상향"
                      onChange={(e) => setF({ ...f, reason: e.target.value })} />
                    <span className="tiny">변경 기록에 남습니다.</span>
                  </label>
                </div>
              )}
            </>
          )}
        </div>
        <label className="field">알림 받을 메일
          <input type="text" inputMode="email" value={f.emails} placeholder="예: site@company.com, manager@company.com"
            onChange={(e) => setF({ ...f, emails: e.target.value })} />
          <span className="tiny">대시보드 강도 알림의 메일 초안에 받는 사람으로 들어갑니다. 여러 명은 쉼표로 구분합니다.</span>
        </label>
        <label className="field">메모<textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <div className="tiny">
          타설 시각은 '타설 시점 확인' 탭에서 확정합니다. 현재 {pour.pour_start ? `확정 ${fmtFull(pour.pour_start)}` : `자동 추정 ${fmtFull(pour.detected_start)}`}.
        </div>

        <h3 className="mt-2">연결 센서<Info align="right">선택한 센서의 내부온도로 이 회차의 적산온도와 강도를 계산합니다.</Info></h3>
        {sensors.loading && <Loading />}
        <div className="chips">
          {[...(sensors.data ?? [])].sort((a, b) => Number(macs.includes(b.mac)) - Number(macs.includes(a.mac)) || (a.last < b.last ? 1 : -1))
            .map((s) => (
              <label key={s.mac} className={`chip ${macs.includes(s.mac) ? "on" : ""}`}>
                <input type="checkbox" checked={macs.includes(s.mac)} onChange={() => toggle(s.mac)} />
                {s.mac} <span className="tiny">{s.kind === "moisture" ? "수분" : "측압·내부온도"} · {fmtSensorSpan(s.first, s.last, s.buckets)}</span>
              </label>
            ))}
        </div>
        <ErrorBox error={err} />
        {msg && <div className="alert success small">{msg}</div>}
        <div className="actions">
          <button className="btn" disabled={!dirty} onClick={() => { setF(initForm(pour)); setMacs(pour.sensors); }}>취소</button>
          <button className="btn primary" disabled={!dirty} onClick={save}>변경 내용 저장</button>
        </div>
      </div>

      <FollowUpUpload onDone={() => { sensors.reload(); onSaved(); }} />
      <Exclusions pour={pour} onChanged={onSaved} />

      <div className="card row between">
        <div className="small muted">회차를 삭제해도 센서 원본 데이터는 남습니다.</div>
        <button className="btn danger" onClick={remove}>회차 삭제</button>
      </div>
    </>
  );
}

/** CSV 후속 데이터 추가: 같은 센서의 이어지는 CSV를 올린다 (중복 행은 서버가 건너뜀) */
function FollowUpUpload({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<UploadResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((x) => x.name.toLowerCase().endsWith(".csv"));
    if (files.length === 0) return;
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await api.upload(files)); onDone(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="card stack">
      <div className="card-head">
        <h3>CSV 후속 데이터 추가<Info align="right">같은 센서의 이어지는 CSV를 올려 기존 기록 뒤에 붙입니다. 이미 있는 행은 건너뜁니다.</Info></h3>
        <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? "업로드·집계 중…" : "+ 후속 데이터 추가"}</button>
        <input ref={input} type="file" accept=".csv" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      </div>
      <ErrorBox error={err} />
      {res && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>파일 / 센서</th><th>데이터 기간</th><th>새로 저장 / 전체</th></tr></thead>
            <tbody>{res.map((r) => (
              <tr key={r.filename}>
                <td>{r.filename} <span className="tiny">{r.sensors.join(", ")}</span></td>
                <td>{fmtDateTime(r.period_start)} ~ {fmtDateTime(r.period_end)}</td>
                <td><b>{r.rows_inserted.toLocaleString()}</b> / {r.rows_total.toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 측정 구간 제외: 지정한 구간만 강도 예측 계산에서 뺀다. 원본 데이터는 고치지 않는다 */
function Exclusions({ pour, onChanged }: { pour: Pour; onChanged: () => void }) {
  const list = useAsync(() => api.exclusions(pour.id), [pour.id]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    setErr(null);
    if (!start || !end) return setErr("제외할 시작·종료 시각을 입력하세요.");
    if (end <= start) return setErr("종료 시각은 시작 시각보다 뒤여야 합니다.");
    try {
      await api.addExclusion(pour.id, { start: fromInput(start)!, end: fromInput(end)!, reason });
      setStart(""); setEnd(""); list.reload(); onChanged();
    } catch (e) { setErr((e as Error).message); }
  };
  const cancel = async (id: number) => {
    try { await api.deleteExclusion(pour.id, id); list.reload(); onChanged(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="card stack">
      <div className="card-head">
        <h3>측정 구간 제외<Info align="right">센서 이상이나 탈형 작업으로 값이 튄 구간을 지정해 강도 예측 계산에서만 뺍니다. 원본 데이터는 고치지 않고 그대로 보존합니다.</Info></h3>
        <Link to={`/sensors?pour=${pour.id}`} className="btn sm">원본 보기</Link>
      </div>
      <div className="form-row">
        <label className="field">제외 시작<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field">제외 종료<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label className="field">사유
          <select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
        </label>
        <div className="actions start"><button className="btn primary" onClick={add}>제외 구간 추가</button></div>
      </div>
      <ErrorBox error={err ?? list.error} />
      {list.data && list.data.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>제외 구간</th><th>사유</th><th>원본</th><th /></tr></thead>
            <tbody>{list.data.map((x) => (
              <tr key={x.id}>
                <td>{fmtDateTime(x.start)} ~ {fmtDateTime(x.end)}</td>
                <td>{x.reason ?? "—"}</td>
                <td className="tiny">원본 유지</td>
                <td className="right"><button className="btn sm" onClick={() => cancel(x.id)}>제외 취소</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : list.data && <div className="tiny">제외한 구간이 없습니다.</div>}
    </div>
  );
}
