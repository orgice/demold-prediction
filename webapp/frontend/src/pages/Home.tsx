// [화면] 현재 공사 ( / )
// 진행 중인 회차(타설 후 28일 이내)의 상세 화면을 바로 보여 준다. 여러 건이면 위에서 고른다.
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, Pour } from "../api/client";
import { ErrorBox, Loading, useAsync } from "../components/common";
import { fmtFull } from "../format";
import PourDetail from "./PourDetail";

// 타설 후 28일(설계기준강도 확인 시점)이 지나지 않은 회차를 '진행 중'으로 본다
const ACTIVE_DAYS = 28;

/** 회차의 타설 시작: 확정값이 있으면 그것, 없으면 자동 추정값 */
function startOf(p: Pour) {
  return p.pour_start ?? p.detected_start;
}

/** 진행 중인 회차인지 (타설 시작 후 28일 이내) */
export function isActive(p: Pour, now = Date.now()) {
  const s = startOf(p);
  if (!s) return false;
  const age = now - new Date(s).getTime();
  return age >= 0 && age < ACTIVE_DAYS * 24 * 3600 * 1000;
}

export default function Home() {
  const { data, error } = useAsync(api.pours, []);
  const [picked, setPicked] = useState<number | null>(null);

  if (error) return <main className="page"><ErrorBox error={error} /></main>;
  if (!data) return <main className="page"><Loading /></main>;

  // 진행 중인 회차를 최근 타설 순으로
  const active = data.filter((p) => isActive(p))
    .sort((a, b) => new Date(startOf(b)!).getTime() - new Date(startOf(a)!).getTime());

  if (active.length === 0) {
    return (
      <main className="page">
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <h2>진행 중인 타설이 없습니다</h2>
          <div className="muted small" style={{ margin: "8px 0 16px" }}>
            타설 후 {ACTIVE_DAYS}일이 지나지 않은 회차가 여기에 표시됩니다.
          </div>
          <Link to="/pours" className="btn primary">타설 이력 · 새 타설 등록</Link>
        </div>
      </main>
    );
  }

  // 고른 회차, 고르지 않았으면 가장 최근 회차. 상세 화면(PourDetail)을 그대로 재사용한다
  const current = active.find((p) => p.id === picked) ?? active[0];
  return (
    <>
      {active.length > 1 && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <div className="chips">
            <span className="tiny">진행 중인 타설 {active.length}건</span>
            {active.map((p) => (
              <button key={p.id} className={`chip ${p.id === current.id ? "on" : ""}`} onClick={() => setPicked(p.id)}>
                {p.name} · {fmtFull(startOf(p))}
              </button>
            ))}
          </div>
        </div>
      )}
      <PourDetail key={current.id} pourId={current.id} live />
    </>
  );
}
