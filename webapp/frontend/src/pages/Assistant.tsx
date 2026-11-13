// [화면] AI 상담 ( /assistant )
// 질문을 보내면 서버의 AI(backend/app/agent.py)가 예측 도구를 불러 답한다.
// 대화는 이 화면에만 있고 저장되지 않는다 (새로고침하면 사라짐).
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AgentStep, api, ChatMessage, MEMBER_LABEL } from "../api/client";
import { Info, useAsync } from "../components/common";

/** 말풍선 하나: 질문 또는 답변 (+ AI가 부른 도구 목록, 걸린 시간, 오류 여부) */
interface Turn extends ChatMessage { steps?: AgentStep[]; elapsed_ms?: number; error?: boolean }

// 처음 화면에 보여 주는 예시 질문
const EXAMPLES = [
  "테스트시험 슬래브 언제 떼도 돼?",
  "지금 벽체 해체 가능한 회차는?",
  "3회차 벽체 해체는 언제였고, 그때 내부온도는 어땠어?",
  "5회차 28일 강도가 설계강도에 도달할까?",
];

// 도구 이름을 화면에 보여 줄 한국어로 (목록에 없으면 영어 이름 그대로)
const TOOL_LABEL: Record<string, string> = {
  list_pours: "회차 목록 조회",
  get_prediction: "강도·해체 시각 예측",
  get_temperature_summary: "내부온도 조회",
};

/** "강도·해체 시각 예측 (pour_id=3)" 같은 도구 호출 설명 */
function stepText(s: AgentStep) {
  const args = Object.entries(s.args).map(([k, v]) => `${k}=${v}`).join(", ");
  return `${TOOL_LABEL[s.tool] ?? s.tool}${args ? ` (${args})` : ""}`;
}

export default function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  // 타설 상세의 ‘이 타설에 질문하기’로 오면 ?pour=3 이 붙는다.
  // AI API는 회차 ID를 따로 받지 않으므로, 회차 이름을 질문 문장에 넣어 대상을 전달한다.
  const [params, setParams] = useSearchParams();
  const pourId = params.get("pour") ? Number(params.get("pour")) : null;
  const target = useAsync(() => (pourId ? api.pour(pourId) : Promise.resolve(null)), [pourId]);
  const tp = target.data;
  const examples = tp
    ? [`${tp.name} 목표 강도 도달 예상은?`, `${tp.name} 공시체 결과가 반영됐나요?`, `${tp.name} 예측의 근거를 설명해 줘`]
    : EXAMPLES;

  // 중괄호 필수: scrollIntoView 가 값을 돌려주는 브라우저에서 React 가 그 값을 정리 함수로 실행하다 죽는다
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

  /** 질문 보내기: 화면에 먼저 띄우고, 이전 대화와 함께 서버에 보낸 뒤 답을 붙인다 */
  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const history: ChatMessage[] = turns.filter((t) => !t.error).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: question }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api.ask(question, history);
      setTurns((t) => [...t, { role: "assistant", content: r.answer, steps: r.steps, elapsed_ms: r.elapsed_ms }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page chat-page">
      <div className="page-head">
        <div>
          <h1>AI 상담</h1>
          <div className="muted small">
            해체 시점·강도·온도를 물어보세요
            <Info align="right">AI가 예측 기능을 직접 불러서 답합니다. 강도와 시각은 적산온도 모델이 계산한 값이며, 최종 판단은 현장 책임자가 합니다.</Info>
          </div>
        </div>
        {turns.length > 0 && <button className="btn" onClick={() => setTurns([])} disabled={busy}>새 대화</button>}
      </div>

      {pourId && (
        <div className="chat-target">
          <span className="tiny">질문 대상</span>
          {tp ? <Link to={`/pours/${tp.id}`} className="pour-link">{tp.name}{tp.member ? ` · ${MEMBER_LABEL[tp.member]}` : ""}{tp.site ? ` · ${tp.site}` : ""}</Link>
            : target.error ? <span className="small">회차를 찾지 못했어요</span> : <span className="small muted">불러오는 중…</span>}
          <span className="tiny">질문에 회차 이름을 넣어 보내요</span>
          <button className="btn sm" onClick={() => setParams({}, { replace: true })}>대상 해제</button>
        </div>
      )}

      <div className="card chat-log">
        {turns.length === 0 && (
          <div className="chat-empty">
            <div className="muted small">이런 질문을 해 보세요</div>
            <div className="chips">
              {examples.map((q) => <button key={q} className="chip" onClick={() => send(q)}>{q}</button>)}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`bubble-row ${t.role}`}>
            <div className={`bubble ${t.role} ${t.error ? "error" : ""}`}>
              <div className="bubble-text">{t.content}</div>
              {/* 도구 호출·소요 시간 같은 기술 정보는 접어 둔다 (DESIGN.md 12.5) */}
              {((t.steps && t.steps.length > 0) || t.elapsed_ms != null) && (
                <details className="steps">
                  <summary className="tiny">
                    근거 보기{t.steps?.length ? ` · 예측 도구 ${t.steps.length}회` : ""}{t.elapsed_ms != null ? ` · ${(t.elapsed_ms / 1000).toFixed(1)}초` : ""}
                  </summary>
                  {t.steps?.map((s, j) => (
                    <div key={j} className="tiny">{s.ok ? "✓" : "✗"} {stepText(s)}</div>
                  ))}
                </details>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="bubble-row assistant">
            <div className="bubble assistant muted small">생각하는 중… 보통 10~30초 걸립니다</div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={tp ? `예: ${tp.name} 해체 언제 가능해?` : "예: 4회차 슬래브 해체 언제 가능해?"}
          maxLength={1000} disabled={busy} />
        <button className="btn primary" type="submit" disabled={busy || !input.trim()}>보내기</button>
      </form>
    </main>
  );
}
