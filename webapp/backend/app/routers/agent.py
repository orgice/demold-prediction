import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..agent import AgentError, run_agent
from ..db import get_session

router = APIRouter(prefix="/api/agent", tags=["AI 상담"])


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    history: list[ChatMessage] = []


class Step(BaseModel):
    tool: str
    args: dict
    ok: bool


class AskOut(BaseModel):
    answer: str
    steps: list[Step]
    elapsed_ms: int


@router.post("/ask", response_model=AskOut)
def ask(body: AskIn, s: Session = Depends(get_session)):
    t0 = time.monotonic()
    try:
        r = run_agent(s, body.question, [m.model_dump() for m in body.history])
    except AgentError as e:
        raise HTTPException(502, str(e))
    return AskOut(**r, elapsed_ms=int((time.monotonic() - t0) * 1000))
