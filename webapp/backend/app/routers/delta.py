"""센서 데이터 자동 수집 API (수집 자체는 delta_sync.py 가 백그라운드에서 한다).

- GET  /api/delta/status   자동 수집이 켜져 있는지, 마지막 수집 시각·저장 행 수·오류, 토큰 만료일 (로그인한 누구나)
- POST /api/delta/run      다음 주기를 기다리지 않고 지금 한 번 수집 (관리자)
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool

from .. import delta_sync
from ..auth import current_user, require_role
from ..config import DELTA_SYNC_INTERVAL_MIN, DELTA_TABLES

router = APIRouter(prefix="/api/delta", tags=["센서 자동 수집"])


@router.get("/status", dependencies=[Depends(current_user)])
def delta_status():
    """자동 수집 상태. enabled=false 면 CSV 업로드만 쓴다. 접속 토큰 값은 돌려주지 않는다."""
    return {"enabled": delta_sync.ENABLED, "interval_min": DELTA_SYNC_INTERVAL_MIN,
            "tables": [t.split(".")[-1] for t in DELTA_TABLES], **delta_sync.status}


@router.post("/run", dependencies=[Depends(require_role("admin"))])
async def run_now():
    """지금 한 번 수집. 표별로 새로 저장한 행 수와 상태를 돌려준다."""
    if not delta_sync.ENABLED:
        raise HTTPException(400, "자격증명 파일(DELTA_SHARE_FILE)이 없어 자동 수집이 꺼져 있습니다. webapp/.env 를 확인하세요.")
    result = await run_in_threadpool(delta_sync.run_once)
    return {"result": result, **delta_sync.status}
