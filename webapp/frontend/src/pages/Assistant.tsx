import { useEffect, useRef, useState } from "react";
import { AgentStep, api, ChatMessage } from "../api/client";

interface Turn extends ChatMessage { steps?: AgentStep[]; elapsed_ms?: number; error?: boolean }

const EXAMPLES = [
  "테스트시험 슬래브 언제 떼도 돼?",
  "지금 벽체 해체 가능한 회차는?",
  "3회차 벽체 해체는 언제였고, 그때 내부온도는 어땠어?",
  "5회차 28일 강도가 설계강도에 도달할까?",
];

const TOOL_LABEL: Record<string, string> = {
  list_pours: "회차 목록 조회",
  get_prediction: "강도·해체 시각 예측",
  get_temperature_summary: "내부온도 조회",
};

function stepText(s: AgentStep) {
  const args = Object.entries(s.args).map(([k, v]) => `${k}=${v}`).join(", ");
  return `${TOOL_LABEL[s.tool] ?? s.tool}${args ? ` (${args})` : ""}`;
}

export default function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // 중괄호 필수: scrollIntoView 가 값을 돌려주는 브라우저에서 React 가 그 값을 정리 함수로 실행하다 죽는다
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

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
            해체 시점·강도·온도를 물어보세요. AI가 예측 기능을 직접 불러서 답합니다.
            강도와 시각은 적산온도 모델이 계산한 값이며, 최종 판단은 현장 책임자가 합니다.
          </div>
        </div>
        {turns.length > 0 && <button className="btn" onClick={() => setTurns([])} disabled={busy}>새 대화</button>}
      </div>

      <div className="card chat-log">
        {turns.length === 0 && (
          <div className="chat-empty">
            <div className="muted small">이런 질문을 해 보세요</div>
            <div className="chips">
              {EXAMPLES.map((q) => <button key={q} className="chip" onClick={() => send(q)}>{q}</button>)}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`bubble-row ${t.role}`}>
            <div className={`bubble ${t.role} ${t.error ? "error" : ""}`}>
              {t.steps && t.steps.length > 0 && (
                <div className="steps">
                  {t.steps.map((s, j) => (
                    <div key={j} className="tiny">{s.ok ? "✓" : "✗"} {stepText(s)}</div>
                  ))}
                </div>
              )}
              <div className="bubble-text">{t.content}</div>
              {t.elapsed_ms != null && <div className="tiny">{(t.elapsed_ms / 1000).toFixed(1)}초</div>}
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
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="예: 4회차 슬래브 해체 언제 가능해?"
          maxLength={1000} disabled={busy} />
        <button className="btn primary" type="submit" disabled={busy || !input.trim()}>보내기</button>
      </form>
    </main>
  );
}
