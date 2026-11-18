"""알림 메일 자동 발송 API (발송 자체는 notify.py 가 백그라운드에서 한다).

- GET  /api/notify/status   자동 발송이 켜져 있는지, 마지막 확인·발송 시각, 마지막 오류 (로그인한 누구나)
- POST /api/notify/test     SMTP 설정 확인용 시험 메일 (관리자)
- POST /api/notify/run      다음 주기를 기다리지 않고 지금 한 번 확인·발송 (관리자)
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from .. import notify
from ..auth import current_user, require_role
from ..config import NOTIFY_INTERVAL_MIN, SMTP_FROM, SMTP_HOST
from ..security import kst_now

router = APIRouter(prefix="/api/notify", tags=["알림"])
EMAIL = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")


@router.get("/status", dependencies=[Depends(current_user)])
def notify_status():
    """자동 발송 상태. enabled=false 면 화면에서 메일 초안만 쓴다."""
    return {"enabled": notify.ENABLED, "interval_min": NOTIFY_INTERVAL_MIN,
            "sender": SMTP_FROM if notify.ENABLED else None, **notify.status}


class TestIn(BaseModel):
    to: str


def _need_enabled():
    if not notify.ENABLED:
        raise HTTPException(400, "SMTP 설정(SMTP_HOST)이 없어 자동 발송이 꺼져 있습니다. webapp/.env 를 확인하세요.")


@router.post("/test", dependencies=[Depends(require_role("admin"))])
async def send_test(body: TestIn):
    """시험 메일 한 통. 실패하면 SMTP 서버가 돌려준 오류를 그대로 보여 준다."""
    _need_enabled()
    to = body.to.strip()
    if not EMAIL.match(to):
        raise HTTPException(422, "메일 주소 형식이 아닙니다.")
    try:
        await run_in_threadpool(notify.send_mail, [to], "[FormCast] 알림 메일 시험 발송",
                                f"FormCast 알림 메일 자동 발송 설정 확인용 메일입니다.\n\n"
                                f"보낸 서버: {SMTP_HOST}\n보낸 시각: {kst_now():%Y-%m-%d %H:%M}\n")
    except Exception as e:
        raise HTTPException(502, f"발송 실패: {type(e).__name__}: {e}")
    return {"ok": True}


@router.post("/run", dependencies=[Depends(require_role("admin"))])
async def run_now():
    """지금 한 번 확인·발송. 보낸 메일 수와 상태를 돌려준다."""
    _need_enabled()
    sent = await run_in_threadpool(notify.run_once)
    return {"sent": sent, **notify.status}
