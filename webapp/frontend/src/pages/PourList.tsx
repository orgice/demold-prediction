// [화면] 타설 이력 ( /pours )
// 회차마다 카드 한 장: 현재 예측 강도, 해체 기준별 예상 시각, 28일 강도. 카드를 누르면 회차 상세로.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { ErrorBox, Loading, MilestoneBadge, useAsync } from "../components/common";
import NewPourModal from "../components/NewPourModal";
import { fmtAge, fmtDateTime, fmtFull } from "../format";

export default function PourList() {
  const { data, error, loading } = useAsync(api.summary, []);   // 회차별 예측 요약
  const [creating, setCreating] = useState(false);              // 새 타설 등록 창이 열려 있는지
  const nav = useNavigate();

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
      {creating && <NewPourModal onClose={() => setCreating(false)} onDone={({ pour }) => nav(`/pours/${pour.id}`)} />}
    </main>
  );
}
