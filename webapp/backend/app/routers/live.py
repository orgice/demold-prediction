"""대시보드 '새 타설 감지' API (계산은 live_detect.py).

- GET  /api/live/candidates            실시간 센서에서 찾은 새 타설 후보 (로그인한 누구나)
- POST /api/live/candidates/register   후보를 회차로 등록 (편집 이상). 감지 시각은 '자동 추정'으로 들어가고
                                       현장에서 '타설 시점 확인' 탭에서 확정한다
- POST /api/live/candidates/dismiss    '타설 아님'으로 무시 (편집 이상). 같은 후보를 다시 띄우지 않는다
"""
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import live_detect, maturity
from ..auth import current_user, require_role
from ..db import get_session
from ..models import AppUser, LiveDismissal, Pour
from ..schemas import Member, PourOut
from ..security import kst_now
from .pours import get_pour, to_out

router = APIRouter(prefix="/api/live", tags=["새 타설 감지"])


@router.get("/candidates", dependencies=[Depends(current_user)])
async def list_candidates():
    return await run_in_threadpool(live_detect.candidates)


def _find(key: str) -> dict:
    c = next((c for c in live_detect.candidates(fresh=True)["candidates"] if c["key"] == key), None)
    if c is None:
        raise HTTPException(404, "이미 등록했거나 무시한 후보예요. 화면을 새로 고쳐 주세요.")
    return c


class RegisterIn(BaseModel):
    key: str = Field(max_length=600)
    name: str = Field(min_length=1, max_length=100)
    member: Member | None = None
    design_strength: float | None = Field(None, gt=0, le=200)


@router.post("/candidates/register", response_model=PourOut, status_code=201)
def register(body: RegisterIn, request: Request, s: Session = Depends(get_session),
             _: AppUser = Depends(require_role("editor"))):
    c = _find(body.key)
    p = Pour(name=body.name.strip(), member=body.member, design_strength=body.design_strength,
             sensors=",".join(c["sensors"]), detected_start=c["start"], detected_end=c["end"])
    s.add(p)
    s.commit()
    maturity.clear_cache()
    live_detect.clear()
    request.state.audit_detail = json.dumps(
        {"회차": p.id, "이름": p.name, "자동 추정 타설 시작": c["start"], "센서": c["sensors"]}, ensure_ascii=False, default=str)
    return to_out(get_pour(s, p.id))


class DismissIn(BaseModel):
    key: str = Field(max_length=600)


@router.post("/candidates/dismiss", status_code=204)
def dismiss(body: DismissIn, request: Request, s: Session = Depends(get_session),
            u: AppUser = Depends(require_role("editor"))):
    c = _find(body.key)
    s.add(LiveDismissal(start=c["start"], sensors=",".join(c["sensors"]), login_id=u.login_id, at=kst_now()))
    s.commit()
    live_detect.clear()
    request.state.audit_detail = json.dumps({"타설 시작 (추정)": c["start"], "센서": c["sensors"]},
                                            ensure_ascii=False, default=str)
