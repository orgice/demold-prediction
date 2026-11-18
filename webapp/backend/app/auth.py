"""로그인 확인·권한 검사 (다른 API에 Depends 로 붙인다).

    current_user          로그인한 사용자 (없거나 만료·중지면 401)
    require_role("admin") 그 권한 이상만 (모자라면 403)
    editor_for_writes     조회(GET)는 로그인만, 바꾸는 요청(POST·PATCH·PUT·DELETE)은 편집 권한 이상
                          (예외: 알림 메일 초안 기록 /notice 는 보기 권한도)

로그인 상태는 HttpOnly 쿠키(SESSION_COOKIE)에 든 세션 토큰으로 확인한다.
세션은 쓰는 동안 자동 연장된다: 마지막 사용 후 SESSION_HOURS 가 지나면 만료, 계속 써도 SESSION_MAX_DAYS 가 지나면 만료.
화면(nginx·vite 프록시)과 API가 같은 주소라서 브라우저가 쿠키를 자동으로 붙여 보낸다.
"""
from datetime import timedelta

from fastapi import Depends, HTTPException, Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .config import ADMIN_ID, ADMIN_NAME, ADMIN_PASSWORD, SESSION_HOURS, SESSION_MAX_DAYS
from .db import SessionLocal, get_session
from .models import AppUser, UserSession
from .schemas import UserOut
from .security import hash_password, kst_now, token_hash

SESSION_COOKIE = "demold_session"
ROLES = ["viewer", "editor", "admin"]          # 보기 < 편집 < 관리자
ROLE_LABEL = {"viewer": "보기", "editor": "편집", "admin": "관리자"}


def at_least(role: str, need: str) -> bool:
    return ROLES.index(role) >= ROLES.index(need)


def to_out(u: AppUser) -> UserOut:
    return UserOut(id=u.login_id, name=u.name, role=u.role, active=u.active, created_at=u.created_at)


EXTEND_STEP = timedelta(minutes=5)   # 연장은 5분에 한 번만 DB에 쓴다 (요청마다 쓰지 않게)


def session_deadline(s: UserSession):
    """이 세션이 아무리 써도 끝나는 시각 (로그인 후 SESSION_MAX_DAYS)"""
    return s.created_at + timedelta(days=SESSION_MAX_DAYS)


def user_from_request(request: Request, db: Session) -> AppUser | None:
    """쿠키의 세션 토큰으로 사용자를 찾는다. 없거나 만료·중지면 None.
    찾으면 세션 만료 시각을 '지금 + SESSION_HOURS' 로 늘리고, 변경 기록(audit.py)용으로 ID를 남긴다."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    s = db.get(UserSession, token_hash(token))
    now = kst_now()
    if s is None or s.expires_at <= now or session_deadline(s) <= now:
        return None
    u = db.get(AppUser, s.login_id)
    if u is None or not u.active:
        return None
    new_exp = min(now + timedelta(hours=SESSION_HOURS), session_deadline(s))
    if new_exp - s.expires_at >= EXTEND_STEP:
        s.expires_at = new_exp
        db.commit()
    request.state.login_id = u.login_id
    return u


def current_user(request: Request, db: Session = Depends(get_session)) -> AppUser:
    u = user_from_request(request, db)
    if u is None:
        raise HTTPException(401, "로그인이 필요해요.")
    return u


def require_role(need: str):
    def dep(u: AppUser = Depends(current_user)) -> AppUser:
        if not at_least(u.role, need):
            raise HTTPException(403, f"{ROLE_LABEL[need]} 권한이 필요해요. 관리자에게 요청해 주세요.")
        return u
    return dep


def editor_for_writes(request: Request, u: AppUser = Depends(current_user)) -> AppUser:
    # 알림 메일 초안 기록(/notice)은 데이터 수정이 아니라 '보냄' 표시라서 보기 권한도 허용
    if request.url.path.endswith("/notice"):
        return u
    if request.method not in ("GET", "HEAD", "OPTIONS") and not at_least(u.role, "editor"):
        raise HTTPException(403, "보기 권한으로는 등록·수정·삭제를 할 수 없어요. 관리자에게 편집 권한을 요청해 주세요.")
    return u


def purge_expired(db: Session) -> None:
    now = kst_now()
    db.execute(delete(UserSession).where(
        (UserSession.expires_at <= now) | (UserSession.created_at <= now - timedelta(days=SESSION_MAX_DAYS))))


def ensure_first_admin() -> None:
    """사용자가 한 명도 없고 .env 에 ADMIN_ID·ADMIN_PASSWORD 가 있으면 첫 관리자를 만든다 (서버 시작 때)."""
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(AppUser)):
            return
        if not ADMIN_ID or not ADMIN_PASSWORD:
            print("[auth] 사용자가 없습니다. .env 에 ADMIN_ID·ADMIN_PASSWORD 를 넣거나 "
                  "`python -m scripts.create_admin` 으로 첫 관리자를 만드세요.", flush=True)
            return
        db.add(AppUser(login_id=ADMIN_ID, name=ADMIN_NAME, role="admin",
                       password_hash=hash_password(ADMIN_PASSWORD), active=True, created_at=kst_now()))
        db.commit()
        print(f"[auth] 첫 관리자 계정을 만들었습니다: {ADMIN_ID}", flush=True)
