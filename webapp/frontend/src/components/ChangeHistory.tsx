// 변경 기록 표시 (누가 언제 무엇을 바꿨는지).
//   ChangeDetail   기록 한 줄의 내용: 수정이면 '항목: 전 → 후', 삭제면 지운 내용, 그 밖에는 보낸 값
//   PourHistory    회차 상세 › 설정 탭 아래의 '변경 기록' 카드 (편집 권한 이상)
// 서버: GET /api/pours/{id}/history (routers/pours.py), 관리자 전체 기록은 pages/AdminAudit.tsx
import { useState } from "react";
import { api, HistoryEntry, MEMBER_LABEL, Pour, STRUCTURE_LABEL } from "../api/client";
import { fmtFull } from "../format";
import { ErrorBox, Info, Loading, useAsync } from "./common";

type Change = { field: string; label: string; before: unknown; after: unknown };

// 보낸 내용(JSON)을 그대로 보여 줄 때 쓰는 항목 이름 (수정·삭제 기록은 서버가 이름을 붙여 준다)
const KEY_LABEL: Record<string, string> = {
  name: "이름", site: "현장", design_strength: "설계기준강도 (MPa)", member: "부재 종류", sensors: "연결 센서",
  test_datetime: "시험 시각", nominal_age_day: "재령 (일)", curing: "양생", s1: "강도 (MPa)", note: "메모",
  start: "시작", end: "종료", reason: "사유", label: "표시 이름", hidden: "숨김", key: "알림", to: "받는 사람",
  subject: "제목", role: "권한", active: "사용", id: "ID", pour_start: "타설 시작", pour_end: "타설 종료",
};
const VALUE_LABEL: Record<string, Record<string, string>> = {
  member: MEMBER_LABEL, structure: STRUCTURE_LABEL, curing: { field: "현장양생", water: "수중양생" },
};
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** 기록 값 하나를 화면 글자로 (없음은 —, 시각은 'YYYY-MM-DD HH:MM', 목록은 쉼표) */
export function fmtValue(v: unknown, field?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (Array.isArray(v)) return v.length ? v.map((x) => fmtValue(x)).join(", ") : "—";
  if (typeof v === "string") {
    if (field && VALUE_LABEL[field]?.[v]) return VALUE_LABEL[field][v];
    return DATETIME.test(v) ? fmtFull(v.replace(" ", "T")) : v;
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function parse(detail: string | null): unknown {
  if (!detail) return null;
  try { return JSON.parse(detail); } catch { return detail; }   // 너무 길어 잘린 기록은 글자 그대로
}

/** 기록 한 줄의 내용 */
export function ChangeDetail({ detail }: { detail: string | null }) {
  const d = parse(detail);
  if (d === null) return <span className="tiny">—</span>;
  if (typeof d !== "object" || Array.isArray(d)) return <span className="tiny change-raw">{String(detail)}</span>;
  const o = d as Record<string, unknown>;
  if (Array.isArray(o.changes)) {
    const list = o.changes as Change[];
    if (list.length === 0) return <span className="tiny">바뀐 값 없음 (같은 값으로 저장)</span>;
    return (
      <ul className="change-list">
        {list.map((c) => (
          <li key={c.field}>
            <span className="muted">{c.label}</span>{" "}
            <span className="change-before">{fmtValue(c.before, c.field)}</span>
            {" → "}<b>{fmtValue(c.after, c.field)}</b>
          </li>
        ))}
      </ul>
    );
  }
  const entries = Object.entries((o.deleted as Record<string, unknown> | undefined) ?? o);
  return (
    <ul className="change-list">
      {o.deleted !== undefined && <li className="tiny">삭제한 내용</li>}
      {entries.map(([k, v]) => (
        <li key={k}><span className="muted">{KEY_LABEL[k] ?? k}</span> {fmtValue(v, k)}</li>
      ))}
    </ul>
  );
}

/** 누가: 이름(ID). system 은 자동 발송 */
export function who(h: Pick<HistoryEntry, "user" | "user_name">) {
  if (h.user === "system") return "자동 (서버)";
  if (!h.user) return "—";
  return h.user_name ? `${h.user_name} (${h.user})` : h.user;
}

const PAGE = 10;

/** 회차 설정 탭의 변경 기록 카드: 최근 10건, '더 보기'로 전체 */
export function PourHistory({ pour }: { pour: Pour }) {
  const list = useAsync(() => api.pourHistory(pour.id), [pour]);   // 저장하면 pour 가 새로 와서 다시 불러온다
  const [all, setAll] = useState(false);
  const rows = list.data ?? [];
  const shown = all ? rows : rows.slice(0, PAGE);
  return (
    <div className="card stack">
      <div className="card-head">
        <h3>변경 기록<Info align="right">이 회차의 정보·공시체 결과·제외 구간·타설 시각을 누가 언제 바꿨는지 보여 줍니다. 수정은 바꾸기 전 → 후 값을 남깁니다. 편집·관리자 권한만 볼 수 있습니다.</Info></h3>
        {list.data && <span className="tiny">{rows.length}건</span>}
      </div>
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data && <Loading />}
      {list.data && (rows.length === 0 ? <div className="tiny">아직 변경 기록이 없습니다.</div> : (
        <div className="table-wrap">
          <table className="history-table">
            <thead><tr><th>시각</th><th>누가</th><th>작업</th><th>바뀐 내용</th></tr></thead>
            <tbody>{shown.map((h) => (
              <tr key={h.id}>
                <td className="nowrap">{fmtFull(h.at)}</td>
                <td className="nowrap">{who(h)}</td>
                <td className="nowrap">{h.action}</td>
                <td><ChangeDetail detail={h.detail} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      {rows.length > PAGE && (
        <div className="actions start">
          <button className="btn sm" onClick={() => setAll(!all)}>{all ? "최근 10건만 보기" : `전체 보기 (${rows.length}건)`}</button>
        </div>
      )}
    </div>
  );
}
