import { DependencyList, ReactNode, useCallback, useEffect, useState } from "react";
import type { Milestone } from "../api/client";
import { fmtAge, fmtDateTime } from "../format";

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

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="alert error">{error}</div> : null;
}

export function Loading({ text = "불러오는 중…" }: { text?: string }) {
  return <div className="muted small">{text}</div>;
}

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

/** 도달 상태 배지: 상태 색 + 글자 (색만으로 구분하지 않음) */
export function MilestoneBadge({ m }: { m: Milestone }) {
  if (m.reached_at_as_of) return <span className="badge good">✓ 도달</span>;
  if (!m.expected) return <span className="badge bad">28일 내 미도달 예상</span>;
  return <span className="badge warn">⏳ 예정</span>;
}

export function MilestoneRow({ m }: { m: Milestone }) {
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
      </div>
    </div>
  );
}
