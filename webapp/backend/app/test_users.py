"""개발·시험용 계정 (권한마다 하나씩). 로컬 개발에서만 켠다.

SEED_TEST_USERS=true 로 서버를 켜면, 아래 계정 중 아직 없는 것만 만든다.
이미 있는 계정은 비밀번호·권한을 건드리지 않는다 (화면에서 바꾼 값 유지).
비밀번호가 코드에 공개돼 있으므로 실제 서비스(.env / docker compose)에서는 절대 켜지 말 것.
COOKIE_SECURE=true(HTTPS 서비스)이면 켜져 있어도 만들지 않는다.
"""
from sqlalchemy import select

from .config import COOKIE_SECURE, SEED_TEST_USERS
from .db import SessionLocal
from .models import AppUser
from .security import hash_password, kst_now

# (로그인 ID, 이름, 권한, 비밀번호) — 시험용 값
TEST_USERS = [
    ("test-admin", "시험 관리자", "admin", "test-admin-1234"),
    ("test-editor", "시험 편집자", "editor", "test-editor-1234"),
    ("test-viewer", "시험 보기", "viewer", "test-viewer-1234"),
]


def ensure_test_users() -> None:
    if not SEED_TEST_USERS:
        return
    if COOKIE_SECURE:
        print("[auth] COOKIE_SECURE=true 라서 시험용 계정을 만들지 않습니다 (실제 서비스 보호).", flush=True)
        return
    with SessionLocal() as db:
        have = set(db.scalars(select(AppUser.login_id)).all())
        made = []
        for login_id, name, role, pw in TEST_USERS:
            if login_id in have:
                continue
            db.add(AppUser(login_id=login_id, name=name, role=role,
                           password_hash=hash_password(pw), active=True, created_at=kst_now()))
            made.append(login_id)
        db.commit()
    if made:
        print(f"[auth] 시험용 계정을 만들었습니다: {', '.join(made)} (비밀번호는 app/test_users.py)", flush=True)
