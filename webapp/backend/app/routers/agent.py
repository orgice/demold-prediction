"""AI 상담 API (화면: AI 상담).

질문을 받아 agent.py의 run_agent()에 넘기고, LLM의 답변과 'AI가 어떤 도구를 불렀는지'를 돌려준다.
"""
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..agent import AgentError, run_agent
from ..db import get_session

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
