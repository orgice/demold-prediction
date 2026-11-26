// 여러 화면에서 같이 쓰는 작은 부품들 (데이터 불러오기, 오류·로딩 표시, 창, 해체 시각 표시).
import { DependencyList, InputHTMLAttributes, ReactNode, useCallback, useEffect, useRef, useState } from "react";
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

/** 타설 시각이 없는 회차를 보기 계정이 볼 때 안내 (서버 안내 '설정에서 입력…'은 편집 계정용) */
export const NO_START_VIEWER_MSG = "타설 시작 시각이 아직 입력되지 않았습니다. 편집 권한이 있는 담당자에게 입력을 요청해 주세요.";

/** 빨간 오류 상자 (오류가 없으면 아무것도 안 그림). onRetry 를 주면 오른쪽에 '다시 시도' 버튼 */
export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  if (!onRetry) return <div className="alert error">{error}</div>;
  return (
    <div className="alert error alert-inline" role="alert">
      <span>{error}</span>
      <button className="btn sm" onClick={onRetry}>다시 시도</button>
    </div>
  );
}

/** "불러오는 중…" 같은 회색 안내 글자 */
export function Loading({ text = "불러오는 중…" }: { text?: string }) {
  return <div className="muted small">{text}</div>;
}

/**
 * ⓘ 설명 툴팁. 화면에 늘 띄울 필요는 없지만 궁금하면 볼 수 있어야 하는 설명을 여기에 넣는다.
 * align: 화면 오른쪽 끝 근처면 "left", 왼쪽 끝 근처면 "right" (말풍선이 잘리지 않게)
 */
export function Info({ children, align }: { children: ReactNode; align?: "left" | "right" }) {
  // 평소엔 아이콘 위에 띄우고, 위쪽 공간(고정 메뉴바 아래)이 모자라면 아래에 띄운다 (말풍선이 잘리지 않게)
  const tip = useRef<HTMLSpanElement>(null);
  const [below, setBelow] = useState(false);
  const place = () => {
    const el = tip.current;
    const dot = el?.parentElement;
    if (!el || !dot) return;
    const bar = document.querySelector(".topbar");
    const barBottom = bar && getComputedStyle(bar).position === "sticky" ? bar.getBoundingClientRect().bottom : 0;
    setBelow(dot.getBoundingClientRect().top - el.offsetHeight - 8 < barBottom);
  };
  return (
    <span className={`info-dot ${align ?? ""} ${below ? "below" : ""}`} tabIndex={0} aria-label="설명 보기"
          onMouseEnter={place} onFocus={place}>
      i<span className="info-tip" role="tooltip" ref={tip}>{children}</span>
    </span>
  );
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
  return <span className="badge neutral">예정</span>;
}

/** 부재 종류에 맞는 해체 기준만 고른다 (기준 값은 회차 설정에 따라 서버가 계산). 부재 미설정이면 빈 목록 */
export function memberMilestones(member: Member | null, ms: Milestone[]) {
  return member == null ? [] : ms.filter((m) => m.key === member);
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
        <div className="when-time">{fmtDateTime(m.expected)}</div>
        <div className="tiny">타설 후 {fmtAge(m.expected_age_h)}</div>
        {delay && <div className="tiny">{delay}</div>}
      </div>
    </div>
  );
}

const EYE = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
const EYE_OFF = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.7 3.6M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="M3 3l18 18" /></svg>;

/**
 * 비밀번호 입력칸. 오른쪽 눈 아이콘을 누르면 입력한 글자를 보이거나 다시 가린다 (기본은 가림).
 * type 을 빼고는 일반 <input> 과 같은 속성을 받는다.
 */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "비밀번호 숨기기" : "비밀번호 보기";
  return (
    <span className="pw-wrap">
      <input {...props} type={visible ? "text" : "password"} />
      <button type="button" className="pw-toggle" onClick={() => setVisible((v) => !v)}
        aria-label={label} aria-pressed={visible} title={label} disabled={props.disabled}>
        {visible ? EYE_OFF : EYE}
      </button>
    </span>
  );
}
