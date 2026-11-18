// [센서 데이터 › 센서 칩 ⋮ 메뉴] 칩 오른쪽 작은 아이콘으로 이름 변경 · 숨기기/다시 보이기 · 측정 기록 삭제.
// ⚠ 백엔드 API가 없어 지금은 목업 (api/sensors.ts, 이 브라우저에만 저장). 편집 권한 이상에게만 아이콘이 보인다.
import { useEffect, useRef, useState } from "react";
import type { Pour, SensorInfo } from "../api/client";
import { sensorName, sensorsApi, SENSORS_IS_MOCK } from "../api/sensors";
import { fmtDateTime, fmtSensorSpan } from "../format";
import { ErrorBox, Modal } from "./common";

const KIND = { pressure: "측압", moisture: "수분" } as const;
const MORE = <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3.5" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="12.5" r="1.4" /></svg>;

/** 칩 옆 ⋮ 버튼과 펼침 메뉴. 결과는 onChanged(바뀐 센서) / onDelete(삭제 확인 창 열기)로 알린다 */
export function SensorChipMenu({ s, onChanged, onDelete, onMessage }: {
  s: SensorInfo;
  onChanged: (s: SensorInfo) => void;
  onDelete: (s: SensorInfo) => void;
  onMessage: (msg: string | null, isError?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);   // 이름 입력 중이면 값
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const name = sensorName(s);

  // 바깥을 누르거나 Esc 면 닫는다
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) { setOpen(false); setRenaming(null); }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  const run = async (job: () => Promise<SensorInfo>, done: (r: SensorInfo) => string) => {
    setBusy(true); onMessage(null);
    try { const r = await job(); onChanged(r); onMessage(done(r)); setOpen(false); setRenaming(null); }
    catch (e) { onMessage((e as Error).message, true); }
    finally { setBusy(false); }
  };
  const mock = SENSORS_IS_MOCK ? " (목업: 이 브라우저에만 저장)" : "";
  const saveName = () => renaming !== null && run(() => sensorsApi.rename(s, renaming),
    (r) => (r.label ? `${s.mac} 이름을 '${r.label}'(으)로 바꿨습니다.` : `${s.mac} 이름을 MAC 주소로 되돌렸습니다.`) + mock);
  const toggleHidden = () => run(() => sensorsApi.setHidden(s, !s.hidden),
    () => (s.hidden ? `${name}을(를) 다시 목록에 보이게 했습니다.` : `${name}을(를) 숨겼습니다. 데이터와 회차 예측은 그대로이고, '숨긴 센서'에서 다시 보이게 할 수 있습니다.`) + mock);

  return (
    <div className="chip-menu-wrap" ref={box}>
      <button type="button" className={`chip-more ${open ? "on" : ""}`} aria-label={`${name} 관리`} aria-haspopup="menu" aria-expanded={open}
        title="이름 변경 · 숨기기 · 삭제" onClick={() => { setOpen((o) => !o); setRenaming(null); }}>{MORE}</button>
      {open && (
        <div className="chip-menu" role="menu">
          {renaming !== null ? (
            <div className="stack">
              <label className="field tiny">표시 이름 <span className="muted">(비우면 {s.mac})</span>
                <input autoFocus value={renaming} maxLength={50} disabled={busy} placeholder={s.mac}
                  onFocus={(e) => e.target.select()} onChange={(e) => setRenaming(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveName(); }} />
              </label>
              <div className="row nowrap chip-menu-actions">
                <button className="btn sm" disabled={busy} onClick={() => setRenaming(null)}>취소</button>
                <button className="btn sm primary" disabled={busy} onClick={saveName}>{busy ? "저장 중…" : "저장"}</button>
              </div>
            </div>
          ) : (
            <>
              <div className="chip-menu-head"><b>{name}</b>{s.label && <span className="tiny mono"> {s.mac}</span>}</div>
              <button role="menuitem" disabled={busy} onClick={() => setRenaming(name)}>이름 변경</button>
              <button role="menuitem" disabled={busy} onClick={toggleHidden}>{s.hidden ? "다시 보이기" : "목록에서 숨기기"}</button>
              <button role="menuitem" className="danger" disabled={busy} onClick={() => { setOpen(false); onDelete(s); }}>측정 기록 삭제…</button>
              {SENSORS_IS_MOCK && <div className="tiny muted chip-menu-foot">목업 · 실제 데이터는 바뀌지 않음</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 센서 측정 기록 삭제 확인 창: 무엇이 지워지고 어느 회차가 영향받는지 보여 주고, 확인 체크 후에만 삭제 */
export function DeleteSensorModal({ s, linked, pours, onClose, onDeleted }: {
  s: SensorInfo; linked: Pour[]; pours: Pour[]; onClose: () => void; onDeleted: (msg: string) => void;
}) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = sensorName(s);
  const remove = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await sensorsApi.remove(s, pours);
      onDeleted(SENSORS_IS_MOCK ? `${name}을(를) 삭제했습니다. 목업이라 실제 데이터는 그대로이고 이 브라우저의 목록에서만 뺐습니다.`
        : `${name}의 측정 기록 ${r.rows_deleted.toLocaleString()}행을 삭제했습니다.`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title="센서 데이터 삭제" onClose={busy ? () => undefined : onClose}>
      <dl className="csv-del">
        <dt>센서</dt><dd>{name}{s.label && <span className="tiny"> · {s.mac}</span>}</dd>
        <dt>종류</dt><dd>{KIND[s.kind] ?? s.kind}</dd>
        <dt>수집 기간</dt><dd>{fmtDateTime(s.first)} ~ {fmtDateTime(s.last)} <span className="tiny">({fmtSensorSpan(s.first, s.last, s.buckets)})</span></dd>
        <dt>연결 회차</dt><dd>{linked.length ? linked.map((p) => p.name).join(", ") : "없음"}</dd>
      </dl>
      <div className="alert warn small">
        이 센서의 <b>측정 기록 전체</b>(원본과 10분 집계)가 삭제됩니다.
        {linked.length > 0 && <> 연결된 <b>{linked.map((p) => p.name).join(", ")}</b>의 그래프와 강도 예측이 바뀌거나 예측할 수 없게 됩니다.</>}
        {" "}삭제한 데이터는 되돌릴 수 없고, 다시 쓰려면 CSV를 다시 올려야 합니다. 목록에서만 빼려면 <b>숨기기</b>를 쓰세요.
      </div>
      {SENSORS_IS_MOCK && <div className="tiny">지금은 목업이라 실제 데이터는 지워지지 않고 이 브라우저의 목록에서만 빠집니다.</div>}
      <label className="csv-confirm">
        <input type="checkbox" checked={ok} disabled={busy} onChange={(e) => setOk(e.target.checked)} />
        <span><b>{name}</b>의 측정 기록을 삭제하면 되돌릴 수 없다는 것을 확인했습니다.</span>
      </label>
      <ErrorBox error={err} />
      <div className="actions">
        <button className="btn" disabled={busy} onClick={onClose}>취소</button>
        <button className="btn danger" disabled={!ok || busy} onClick={remove}>{busy ? "삭제 중…" : "삭제"}</button>
      </div>
    </Modal>
  );
}
