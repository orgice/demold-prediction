"""사용자 관리 API (화면: 사용자 관리, 관리자 전용).

- GET    /api/users?q=        목록 (ID·이름 검색)
- POST   /api/users           추가
- PATCH  /api/users/{id}      이름·권한 수정, 비밀번호 재설정
- PATCH  /api/users/{id}/active  사용 중지 / 재개
- DELETE /api/users/{id}      삭제

지키는 규칙: 내 계정은 사용 중지·삭제·권한 변경 불가, 활성 관리자는 항상 1명 이상.
사용 중지·삭제·비밀번호 재설정을 하면 그 사용자의 기존 로그인(세션)은 끊긴다.
"""
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from ..auth import ROLES, SESSION_COOKIE, require_role, to_out
from ..db import get_session
from ..models import AppUser, UserSession
from ..schemas import ActiveIn, UserIn, UserOut, UserPatch
from ..security import hash_password, kst_now, token_hash

router = APIRouter(prefix="/api/users", tags=["사용자 관리"])
admin_only = require_role("admin")

ID_RE = re.compile(r"^[a-zA-Z0-9._-]{3,32}$")


def check_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise HTTPException(400, "이름을 입력해 주세요.")
    if len(name) > 50:
        raise HTTPException(400, "이름은 50자까지 입력할 수 있어요.")
    return name


def check_role(role: str) -> str:
    if role not in ROLES:
        raise HTTPException(400, "권한을 선택해 주세요.")
    return role


def check_password(pw: str) -> str:
    if len(pw) < 8:
        raise HTTPException(400, "비밀번호는 8자 이상으로 입력해 주세요.")
    if len(pw) > 128:
        raise HTTPException(400, "비밀번호는 128자까지 입력할 수 있어요.")
    return pw


def get_user(db: Session, login_id: str) -> AppUser:
    u = db.get(AppUser, login_id)
    if u is None:
        raise HTTPException(404, "사용자를 찾을 수 없어요.")
    return u


def ensure_admin_left(db: Session) -> None:
    """변경을 반영(flush)한 뒤 활성 관리자가 0명이면 되돌린다."""
    db.flush()
    n = db.scalar(select(func.count()).select_from(AppUser).where(AppUser.role == "admin", AppUser.active.is_(True)))
    if not n:
        db.rollback()
        raise HTTPException(400, "활성 관리자가 최소 1명은 있어야 해요.")


def end_sessions(db: Session, login_id: str, keep_token: str | None = None) -> None:
    """그 사용자의 로그인을 끊는다 (keep_token 은 지금 쓰는 내 세션이라 남긴다)."""
    q = delete(UserSession).where(UserSession.login_id == login_id)
    if keep_token:
        q = q.where(UserSession.token_hash != token_hash(keep_token))
    db.execute(q)


@router.get("", response_model=list[UserOut])
def list_users(q: str | None = None, db: Session = Depends(get_session), _=Depends(admin_only)):
    stmt = select(AppUser).order_by(AppUser.created_at, AppUser.login_id)
    k = (q or "").strip()
    if k:
        like = f"%{k}%"
        stmt = stmt.where(or_(AppUser.login_id.like(like), AppUser.name.like(like)))
    return [to_out(u) for u in db.scalars(stmt)]


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserIn, db: Session = Depends(get_session), _=Depends(admin_only)):
    login_id = body.id.strip()
    if not ID_RE.match(login_id):
        raise HTTPException(400, "ID는 영문·숫자·. _ - 로 3~32자여야 해요.")
    if db.get(AppUser, login_id) is not None:   # DB 비교는 대소문자 구분 없음 (utf8mb4_general_ci)
        raise HTTPException(409, f"이미 있는 ID예요: {login_id}")
    u = AppUser(login_id=login_id, name=check_name(body.name), role=check_role(body.role),
                password_hash=hash_password(check_password(body.password)), active=True, created_at=kst_now())
    db.add(u)
    db.commit()
    return to_out(u)


@router.patch("/{login_id}", response_model=UserOut)
def update_user(login_id: str, body: UserPatch, request: Request,
                db: Session = Depends(get_session), me: AppUser = Depends(admin_only)):
    u = get_user(db, login_id)
    if body.name is not None:
        u.name = check_name(body.name)
    if body.role is not None and body.role != u.role:
        if u.login_id == me.login_id:
            raise HTTPException(400, "내 계정의 권한은 직접 바꿀 수 없어요. 다른 관리자에게 요청해 주세요.")
        u.role = check_role(body.role)
    if body.password:
        u.password_hash = hash_password(check_password(body.password))
        end_sessions(db, u.login_id, keep_token=request.cookies.get(SESSION_COOKIE))
    ensure_admin_left(db)
    db.commit()
    return to_out(u)


@router.patch("/{login_id}/active", response_model=UserOut)
def set_active(login_id: str, body: ActiveIn, db: Session = Depends(get_session), me: AppUser = Depends(admin_only)):
    u = get_user(db, login_id)
    if u.login_id == me.login_id and not body.active:
        raise HTTPException(400, "내 계정은 사용 중지할 수 없어요.")
    u.active = body.active
    if not body.active:
        end_sessions(db, u.login_id)
    ensure_admin_left(db)
    db.commit()
    return to_out(u)


@router.delete("/{login_id}", status_code=204)
def delete_user(login_id: str, db: Session = Depends(get_session), me: AppUser = Depends(admin_only)):
    u = get_user(db, login_id)
    if u.login_id == me.login_id:
        raise HTTPException(400, "내 계정은 삭제할 수 없어요.")
    end_sessions(db, u.login_id)
    db.delete(u)
    ensure_admin_left(db)
    db.commit()
