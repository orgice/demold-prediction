"""AI 상담 API (화면: AI 상담).

질문을 받아 agent.py의 run_agent()에 넘기고, LLM의 답변과 'AI가 어떤 도구를 불렀는지'를 돌려준다.
- POST /api/agent/ask        : 답이 다 만들어지면 한 번에 돌려준다
- POST /api/agent/ask/stream : 진행 상황과 답변 글자를 생기는 대로 한 줄씩(JSON Lines) 보낸다 (화면은 이쪽을 쓴다)
"""
import json
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..agent import AgentError, run_agent, run_agent_stream
from ..db import SessionLocal, get_session

router = APIRouter(prefix="/api/agent", tags=["AI 상담"])


# ---- 주고받는 데이터 모양 (pydantic이 형식과 길이를 자동 검사) ----
class ChatMessage(BaseModel):
    """이전 대화 한 줄. role은 사용자(user) 또는 AI(assistant)."""
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AskIn(BaseModel):
    """질문 요청: 새 질문 + 지금까지의 대화."""
    question: str = Field(min_length=1, max_length=1000)
    history: list[ChatMessage] = []


class Step(BaseModel):
    """AI가 부른 도구 한 번 (예: get_prediction, 인자 pour_id=3, 성공 여부)."""
    tool: str
    args: dict
    ok: bool


class AskOut(BaseModel):
    """답변 + 도구 호출 기록 + 걸린 시간(밀리초)."""
    answer: str
    steps: list[Step]
    elapsed_ms: int


@router.post("/ask", response_model=AskOut)
def ask(body: AskIn, s: Session = Depends(get_session)):
    """AI에게 질문한다. LLM 서버가 설정되지 않았거나 응답이 없으면 502 오류."""
    t0 = time.monotonic()
    try:
        r = run_agent(s, body.question, [m.model_dump() for m in body.history])
    except AgentError as e:
        raise HTTPException(502, str(e))
    return AskOut(**r, elapsed_ms=int((time.monotonic() - t0) * 1000))


@router.post("/ask/stream")
def ask_stream(body: AskIn):
    """AI에게 질문하고, 답을 기다리지 않고 한 줄에 하나씩 JSON 이벤트로 받는다.

    이벤트 종류: step(도구 실행) · delta(답변 글자) · reset(보낸 글자 지움) · done(끝, elapsed_ms 포함) · error(실패)
    """
    history = [m.model_dump() for m in body.history]

    def events():
        t0 = time.monotonic()
        # 스트리밍 응답은 요청 처리가 끝난 뒤에 흘러가므로 Depends 세션 대신 여기서 세션을 연다
        with SessionLocal() as s:
            try:
                for ev in run_agent_stream(s, body.question, history):
                    if ev["type"] == "done":
                        ev = {**ev, "elapsed_ms": int((time.monotonic() - t0) * 1000)}
                    yield json.dumps(ev, ensure_ascii=False, default=str) + "\n"
            except AgentError as e:
                yield json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False) + "\n"
            except Exception:   # 예상 못 한 오류도 화면에 알린다 (이미 200 응답을 시작해서 HTTP 오류로는 못 알림)
                yield json.dumps({"type": "error", "message": "답변 중 서버 오류가 났습니다."}, ensure_ascii=False) + "\n"
                raise

    # X-Accel-Buffering: nginx(frontend)가 모아 두지 않고 바로바로 넘기게 한다
    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
