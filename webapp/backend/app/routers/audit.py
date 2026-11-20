"""변경 기록 조회 API (관리자 전용). 기록은 audit.py 의 AuditMiddleware 가 남긴다.

- GET /api/audit?user=&action=&target=&since=&until=&limit=   최신순
"""
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import require_role
from ..db import get_session
from ..models import AppUser, AuditLog

router = APIRouter(prefix="/api/audit", tags=["변경 기록"])


class AuditOut(BaseModel):
    id: int
    at: datetime
    user: str | None
    user_name: str | None     # 지금 계정 이름 (삭제된 계정·system 이면 없음)
    ip: str | None
    action: str
    method: str
    target: str
    status: int
    ok: bool
    detail: str | None


@router.get("", response_model=list[AuditOut])
def list_audit(user: str | None = None, action: str | None = None, target: str | None = None,
               since: datetime | None = None, until: datetime | None = None,
               limit: int = Query(200, ge=1, le=2000),
               db: Session = Depends(get_session), _=Depends(require_role("admin"))):
    q = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if user:
        q = q.where(AuditLog.login_id == user)
    if action:
        q = q.where(AuditLog.action.like(f"%{action}%"))
    if target:
        q = q.where(AuditLog.path.like(f"%{target}%"))   # 예: target=/api/pours/3
    if since:
        q = q.where(AuditLog.at >= since)
    if until:
        q = q.where(AuditLog.at < until)
    rows = list(db.scalars(q))
    names = dict(db.execute(select(AppUser.login_id, AppUser.name)
                            .where(AppUser.login_id.in_({a.login_id for a in rows if a.login_id}))).all())
    return [AuditOut(id=a.id, at=a.at, user=a.login_id, user_name=names.get(a.login_id), ip=a.ip, action=a.action, method=a.method,
                     target=a.path, status=a.status, ok=200 <= a.status < 400, detail=a.detail)
            for a in rows]
