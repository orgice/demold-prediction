"""로그인 API (화면: 로그인, 상단 사용자 표시).

- POST /api/auth/login   ID·비밀번호 확인 → 세션 쿠키 발급
- POST /api/auth/logout  세션 삭제 + 쿠키 지움
- GET  /api/auth/me      지금 로그인한 사용자 (로그인 안 했으면 null)
- PATCH /api/auth/me     내 계정 수정 (화면: 내 계정). ID·이름·비밀번호. 권한·사용 상태는 못 바꿈
    ID·비밀번호를 바꿀 때는 현재 비밀번호 확인. ID를 바꾸면 로그인은 새 ID로 이어지고,
    비밀번호를 바꾸면 다른 기기의 로그인은 끊긴다.
    ⚠ ID 변경 허용 여부는 고객 협의 전 (변경 기록 audit_log 에는 바꾸기 전 ID로 남은 기록이 그대로 있다)

로그인 잠금 (실패 기록은 DB login_failure 테이블 → 서버를 재시작해도 유지):
    - 같은 ID + 같은 IP 에서 10분 안에 5번 실패 → 그 IP에서 그 ID로 10분 동안 로그인 불가
      (다른 곳에 있는 진짜 사용자는 막히지 않는다)
    - 같은 IP 에서 10분 안에 20번 실패 (여러 ID를 돌려 가며 시도) → 그 IP 전체 10분 차단
    - 같은 ID 에 여러 IP 에서 10분 안에 30번 실패 → 그 ID 10분 잠금 (분산 공격 대비)
    로그인에 성공하면 그 ID·IP 의 실패 기록은 지운다.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..audit import client_ip

from ..auth import SESSION_COOKIE, current_user, purge_expired, to_out, user_from_request
from ..config import COOKIE_SECURE, SESSION_HOURS, SESSION_MAX_DAYS
from ..db import get_session
from ..models import AppUser, LoginFailure, UserSession
from ..schemas import LoginIn, MyAccountPatch, UserOut
from ..security import DUMMY_HASH, hash_password, kst_now, new_token, token_hash, verify_password

router = APIRouter(prefix="/api/auth", tags=["로그인"])

WINDOW = timedelta(minutes=10)
LIMIT_ID_IP, LIMIT_IP, LIMIT_ID = 5, 20, 30


def _count(db: Session, *conds) -> int:
    since = kst_now() - WINDOW
    return db.scalar(select(func.count()).select_from(LoginFailure).where(LoginFailure.at > since, *conds)) or 0


def locked(db: Session, key: str, ip: str) -> bool:
    return (_count(db, LoginFailure.login_id == key, LoginFailure.ip == ip) >= LIMIT_ID_IP
            or _count(db, LoginFailure.ip == ip) >= LIMIT_IP
            or _count(db, LoginFailure.login_id == key) >= LIMIT_ID)


def record_failure(db: Session, key: str, ip: str) -> None:
    now = kst_now()
    db.execute(delete(LoginFailure).where(LoginFailure.at < now - timedelta(days=1)))   # 오래된 기록 정리
    db.add(LoginFailure(at=now, login_id=key[:64], ip=ip))
    db.commit()


def is_https(request: Request) -> bool:
    """HTTPS로 들어온 요청인지. 앞단 HTTPS 프록시(Caddy)가 붙이는 X-Forwarded-Proto 로 판단한다.
    COOKIE_SECURE=true 면 항상 HTTPS 전용 쿠키."""
    return COOKIE_SECURE or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_session)):
    login_id = body.id.strip()
    key, ip = login_id.lower(), client_ip(request)
    if locked(db, key, ip):
        raise HTTPException(429, "로그인을 여러 번 실패했어요. 10분 뒤에 다시 시도해 주세요.")
    u = db.get(AppUser, login_id) if login_id else None
    ok = verify_password(body.password, u.password_hash if u else DUMMY_HASH)
    if u is None or not ok:
        record_failure(db, key, ip)
        raise HTTPException(401, "ID 또는 비밀번호가 맞지 않아요.")
    if not u.active:
        raise HTTPException(403, "사용 중지된 계정이에요. 관리자에게 문의해 주세요.")
    db.execute(delete(LoginFailure).where(LoginFailure.login_id == key, LoginFailure.ip == ip))
    request.state.login_id = u.login_id

    purge_expired(db)
    token, now = new_token(), kst_now()
    db.add(UserSession(token_hash=token_hash(token), login_id=u.login_id,
                       created_at=now, expires_at=now + timedelta(hours=SESSION_HOURS)))
    db.commit()
    # 쿠키는 최대 기간 동안 두고, 실제 만료(마지막 사용 후 SESSION_HOURS)는 서버가 판단한다
    response.set_cookie(SESSION_COOKIE, token, max_age=int(SESSION_MAX_DAYS * 86400), path="/",
                        httponly=True, samesite="lax", secure=is_https(request))
    return to_out(u)


@router.post("/logout", status_code=204)
def logout(request: Request, db: Session = Depends(get_session)):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == token_hash(token)))
        db.commit()
    res = Response(status_code=204)
    res.delete_cookie(SESSION_COOKIE, path="/")
    return res


@router.get("/me", response_model=UserOut | None)
def me(request: Request, db: Session = Depends(get_session)):
    u = user_from_request(request, db)
    return to_out(u) if u else None


@router.patch("/me", response_model=UserOut)
def update_me(body: MyAccountPatch, request: Request, db: Session = Depends(get_session),
              me: AppUser = Depends(current_user)):
    from .users import ID_RE, check_name, check_password   # 사용자 관리와 같은 검사 규칙

    new_id = (body.new_id or "").strip()
    changing_id = bool(new_id) and new_id != me.login_id
    if (changing_id or body.new_password) and not verify_password(body.current_password or "", me.password_hash):
        raise HTTPException(400, "현재 비밀번호가 맞지 않아요.")
    if changing_id:
        if not ID_RE.match(new_id):
            raise HTTPException(400, "ID는 영문·숫자·. _ - 로 3~32자여야 해요.")
        if new_id.lower() == me.login_id.lower():
            raise HTTPException(400, "대소문자만 다른 ID로는 바꿀 수 없어요.")
        if db.get(AppUser, new_id) is not None:   # 대소문자 구분 없이 비교 (utf8mb4_general_ci)
            raise HTTPException(409, f"이미 있는 ID예요: {new_id}")
    if body.name is not None:
        me.name = check_name(body.name)
    keep = token_hash(request.cookies.get(SESSION_COOKIE, ""))
    if body.new_password:
        me.password_hash = hash_password(check_password(body.new_password))
        # 지금 이 브라우저의 로그인만 남기고 다른 기기의 로그인은 끊는다
        db.execute(delete(UserSession).where(UserSession.login_id == me.login_id, UserSession.token_hash != keep))
    if changing_id:
        # ID는 키라서 새 계정 행을 만들고 세션을 옮긴 뒤 옛 행을 지운다 (권한·상태·만든 날은 그대로)
        old = me.login_id
        db.add(AppUser(login_id=new_id, name=me.name, role=me.role, password_hash=me.password_hash,
                       active=me.active, created_at=me.created_at))
        db.flush()
        db.query(UserSession).filter(UserSession.login_id == old).update({"login_id": new_id})
        db.flush()
        db.delete(me)
        db.commit()
        request.state.login_id = old   # 변경 기록에는 바꾸기 전 ID로 남긴다 (내용에 new_id 가 있음)
        return to_out(db.get(AppUser, new_id))
    db.commit()
    return to_out(me)
