// [화면] 변경 기록 (/admin/audit, 관리자 전용)
// 데이터를 바꾼 모든 요청(회차·공시체·CSV·센서·사용자 관리)과 로그인 성공·실패. 최신순.
// 거부된 시도(권한 부족·입력 오류)도 남는다. 회차별 기록은 회차 상세 › 설정 탭에서도 볼 수 있다.
// 서버 API: GET /api/audit (backend routers/audit.py, 기록은 audit.py)
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, AuditQuery } from "../api/client";
import { ChangeDetail, who } from "../components/ChangeHistory";
import { Loading, useAsync } from "../components/common";
import { fmtFull } from "../format";

const LIMIT = 300;

/** 대상 주소를 읽기 쉽게: /api/pours/3/tests/5 → '3번 회차' 링크 + 나머지 */
function Target({ path }: { path: string }) {
  const m = path.match(/^\/api\/pours\/(\d+)/);
  if (m) return <Link to={`/pours/${m[1]}?tab=settings`}>{m[1]}번 회차</Link>;
  return <span className="tiny">{path.replace(/^\/api\//, "")}</span>;
}

export default function AdminAudit() {
  const [user, setUser] = useState("");
  const [action, setAction] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [onlyOk, setOnlyOk] = useState(false);
  const [q, setQ] = useState<AuditQuery>({ limit: LIMIT });

  // 글자 입력은 멈추고 0.3초 뒤에 반영. 기간은 그날 0시 ~ 다음 날 0시
  useEffect(() => {
    const t = setTimeout(() => {
      const next = until ? new Date(`${until}T00:00:00`) : null;
      if (next) next.setDate(next.getDate() + 1);
      const pad = (n: number) => String(n).padStart(2, "0");
      setQ({
        limit: LIMIT, user: user.trim(), action: action.trim(),
        since: since ? `${since}T00:00:00` : undefined,
        until: next ? `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T00:00:00` : undefined,
      });
    }, 300);
    return () => clearTimeout(t);
  }, [user, action, since, until]);

  const list = useAsync(() => api.audit(q), [q]);
  const rows = (list.data ?? []).filter((a) => !onlyOk || a.ok);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>변경 기록</h1>
          <div className="muted small">누가 언제 무엇을 바꿨는지 보여 줘요. 수정은 바꾸기 전 → 후 값이 남고, 거부된 시도도 함께 남아요.</div>
        </div>
        <Link className="btn" to="/admin/users">사용자 관리</Link>
      </div>

      <section className="card stack">
        <div className="card-head">
          <h2>기록 <span className="muted small">{list.data ? `${rows.length}건${list.data.length >= LIMIT ? ` (최근 ${LIMIT}건까지)` : ""}` : ""}</span></h2>
          <div className="list-filters">
            <input type="search" placeholder="사용자 ID" value={user} onChange={(e) => setUser(e.target.value)} aria-label="사용자 ID" />
            <input type="search" placeholder="작업 (예: 회차 수정)" value={action} onChange={(e) => setAction(e.target.value)} aria-label="작업 이름" />
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} aria-label="시작 날짜" />
            <span className="tiny">~</span>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-label="끝 날짜" />
            <label className="row small check-line">
              <input type="checkbox" checked={onlyOk} onChange={(e) => setOnlyOk(e.target.checked)} />성공만
            </label>
          </div>
        </div>
        {list.error && (
          <div className="alert error alert-inline">
            <span>변경 기록을 불러오지 못했어요. {list.error}</span>
            <button className="btn sm" onClick={list.reload}>다시 시도</button>
          </div>
        )}
        {list.loading && !list.data ? <Loading /> : (
          <div className="table-wrap">
            <table className="history-table">
              <thead><tr><th>시각</th><th>누가</th><th>작업</th><th>대상</th><th>바뀐 내용</th><th>결과</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{fmtFull(a.at)}</td>
                    <td className="nowrap">{who(a)}{a.ip && <div className="tiny">{a.ip}</div>}</td>
                    <td className="nowrap">{a.action}</td>
                    <td className="nowrap"><Target path={a.target} /></td>
                    <td><ChangeDetail detail={a.detail} /></td>
                    <td className="nowrap">{a.ok ? <span className="badge good">성공</span> : <span className="badge bad" title={`응답 ${a.status}`}>거부 {a.status}</span>}</td>
                  </tr>
                ))}
                {list.data && rows.length === 0 && (
                  <tr><td colSpan={6} className="table-empty muted">조건에 맞는 기록이 없어요.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
