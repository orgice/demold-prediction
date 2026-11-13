// [화면] 타설 이력 ( /pours )
// 회차마다 카드 한 장: 현재 예측 강도, 해체 기준별 예상 시각, 28일 강도. 카드를 누르면 회차 상세로.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, Member, MEMBER_LABEL } from "../api/client";
import { ErrorBox, Loading, MilestoneBadge, useAsync } from "../components/common";
import NewPourModal, { pourUrl } from "../components/NewPourModal";
import { fmtAge, fmtDateTime, fmtFull } from "../format";

export default function PourList() {
  const { data, error, loading } = useAsync(api.summary, []);   // 회차별 예측 요약
  const [creating, setCreating] = useState(false);              // 새 타설 등록 창이 열려 있는지
  const nav = useNavigate();
  // 회차 이름 검색 + 부재 필터 (DESIGN.md 12.3)
  const [q, setQ] = useState("");
  const [member, setMember] = useState<Member | "none" | "all">("all");
  const shown = (data ?? []).filter(({ pour }) =>
    `${pour.name} ${pour.site ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())
    && (member === "all" || (member === "none" ? !pour.member : pour.member === member)));
  const filtered = q.trim() !== "" || member !== "all";

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>타설 이력</h1>
          <div className="muted small">회차별 압축강도 예측과 해체 가능 예상 시각</div>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>+ 새 타설 등록</button>
      </div>
      <ErrorBox error={error} />
      {loading && <Loading text="예측 계산 중…" />}
      {data?.length === 0 && <div className="alert info">등록된 회차가 없습니다. ‘새 타설 등록’으로 시작하세요.</div>}
      {!!data?.length && (
        <div className="list-filters">
          <input type="search" placeholder="회차명·현장 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="회차명·현장 검색" />
          <div className="seg" role="group" aria-label="부재 필터">
            {([["all", "전체"], ["wall", MEMBER_LABEL.wall], ["slab", MEMBER_LABEL.slab], ["none", "부재 미설정"]] as const).map(([k, label]) => (
              <button key={k} className={member === k ? "on" : ""} aria-pressed={member === k} onClick={() => setMember(k)}>{label}</button>
            ))}
          </div>
          <span className="tiny">{filtered ? `${shown.length} / ${data.length}개` : `${data.length}개`}</span>
          {filtered && <button className="btn sm" onClick={() => { setQ(""); setMember("all"); }}>조건 해제</button>}
        </div>
      )}
      {filtered && shown.length === 0 && <div className="muted small">조건에 맞는 회차가 없어요.</div>}
      <div className="grid cols-3">
        {shown.map(({ pour, error, current_strength, strength_28d, milestones, as_of, design_ratio_28d }) => (
          <Link key={pour.id} to={`/pours/${pour.id}`} className="card pour-card">
            <div className="card-head">
              <div>
                <h2>{pour.name}{pour.member && <span className="badge neutral badge-gap">{MEMBER_LABEL[pour.member]}</span>}</h2>
                <div className="tiny">
                  타설 {fmtFull(pour.pour_start ?? pour.detected_start)}{" "}
                  {pour.pour_start ? <span className="badge neutral">확정</span> : <span className="badge warn">자동 추정</span>}
                </div>
              </div>
              {current_strength != null && (
                <div className="right">
                  <div className="tiny">현재 예측 강도</div>
                  <div className="big-num">{current_strength.toFixed(1)}<span className="unit">MPa</span></div>
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
                      <td className="right"><MilestoneBadge m={m} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {strength_28d != null && (
              <div className="tiny mt-2">
                28일 예측 {strength_28d.toFixed(1)} MPa
                {design_ratio_28d != null ? ` · 설계강도 대비 ${(design_ratio_28d * 100).toFixed(0)}%` : " · 설계강도 미입력"}
                {" · "}공시체 {pour.test_count}건
              </div>
            )}
          </Link>
        ))}
      </div>
      {creating && <NewPourModal onClose={() => setCreating(false)} onDone={(r) => nav(pourUrl(r))} />}
    </main>
  );
}
