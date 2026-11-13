// 여러 화면에서 같이 쓰는 작은 부품들 (데이터 불러오기, 오류·로딩 표시, 창, 해체 시각 표시).
import { DependencyList, ReactNode, useCallback, useEffect, useState } from "react";
import type { Member, Milestone } from "../api/client";
import { fmtAge, fmtDateTime } from "../format";

/**
 * 서버에서 데이터를 불러오는 공통 도구.
 * 반환: data(결과), error(오류 문구), loading(불러오는 중), reload(다시 불러오기)
 * deps(두 번째 인자)의 값이 바뀌면 자동으로 다시 불러온다.
 * 예) const pours = useAsync(api.pours, []);
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    run().then(setData).catch((e) => setError(String(e.message ?? e))).finally(() => setLoading(false));
  }, [run]);
  useEffect(reload, [reload]);
  return { data, error, loading, reload, setData };
}

/** 빨간 오류 상자 (오류가 없으면 아무것도 안 그림) */
export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="alert error">{error}</div> : null;
}

/** "불러오는 중…" 같은 회색 안내 글자 */
export function Loading({ text = "불러오는 중…" }: { text?: string }) {
  return <div className="muted small">{text}</div>;
}

/** 화면 위에 뜨는 창. 바깥 어두운 부분을 누르면 닫힌다 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** 도달 상태 배지: 상태 색 + 글자 (색만으로 구분하지 않음). ‘예측 기준 도달’은 해체 승인 완료가 아니다 (DESIGN.md 1.3) */
export function MilestoneBadge({ m }: { m: Milestone }) {
  if (m.reached_at_as_of) return <span className="badge good">✓ 예측 기준 도달</span>;
  if (!m.expected) return <span className="badge bad">28일 내 미도달 예상</span>;
  return <span className="badge warn">⏳ 미도달</span>;
}

/** 부재 종류에 맞는 해체 기준만 고른다 (벽·기둥 5 MPa, 슬래브 14 MPa). 부재 미설정이면 빈 목록 */
export function memberMilestones(member: Member | null, ms: Milestone[]) {
  const t = member === "wall" ? 5 : member === "slab" ? 14 : null;
  return t == null ? [] : ms.filter((m) => m.threshold === t);
}

/** 목표 도달 상태 문구 (DESIGN.md 12.2: 구체적인 상태, 승인과 구분) */
export function targetState(m: Milestone): { cls: "good" | "warn" | "bad"; text: string } {
  if (m.reached_at_as_of) return { cls: "good", text: "예측 기준 도달" };
  if (!m.expected) return { cls: "bad", text: "28일 내 미도달 예상" };
  return { cls: "warn", text: "예측 기준 미도달" };
}

/** 최초 예상 대비 늦어짐(+)/빨라짐(−) */
function delayText(now: number | null, base: number | null | undefined) {
  if (now == null || base == null) return null;
  const d = now - base;
  if (Math.abs(d) < 1) return "최초 예상과 같음";
  const v = Math.abs(d) < 48 ? `${Math.abs(d).toFixed(0)}시간` : `${(Math.abs(d) / 24).toFixed(1)}일`;
  return `최초 예상보다 ${v} ${d > 0 ? "늦음" : "빠름"}`;
}

/** 해체 가능 예상 시각 카드의 한 줄 (벽체 5 MPa 등). baseAgeH = 최초 예상의 도달 시간 */
export function MilestoneRow({ m, baseAgeH }: { m: Milestone; baseAgeH?: number | null }) {
  const delay = delayText(m.expected_age_h, baseAgeH);
  return (
    <div className="milestone">
      <div>
        <div className="name">{m.label}</div>
        <div className="tiny">
          보수적(90% 하한) {fmtDateTime(m.conservative)} · 타설 후 {fmtAge(m.conservative_age_h)}
          {m.observed && <> · 실측 보간 {fmtDateTime(m.observed)}</>}
        </div>
      </div>
      <div className="when">
        <MilestoneBadge m={m} />
        <div>{fmtDateTime(m.expected)}</div>
        <div className="tiny">타설 후 {fmtAge(m.expected_age_h)}</div>
        {delay && <div className="tiny">{delay}</div>}
      </div>
    </div>
  );
}
