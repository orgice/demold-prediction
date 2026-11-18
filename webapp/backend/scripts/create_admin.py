"""관리자 계정 만들기 / 비밀번호 재설정 (관리자 비밀번호를 잊었을 때도 이것으로 복구).

    docker compose -p demold_public exec backend python -m scripts.create_admin <ID> [이름]

비밀번호는 화면에 보이지 않게 두 번 입력받는다. 이미 있는 ID면 관리자 권한·사용 중으로 바꾸고 비밀번호를 새로 정한다.
"""
import getpass
import sys

from app.db import Base, SessionLocal, engine
from app.models import AppUser, UserSession
from app.routers.users import ID_RE
from app.security import hash_password, kst_now


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("사용법: python -m scripts.create_admin <ID> [이름]")
    login_id = sys.argv[1].strip()
    name = (sys.argv[2] if len(sys.argv) > 2 else "관리자").strip() or "관리자"
    if not ID_RE.match(login_id):
        sys.exit("ID는 영문·숫자·. _ - 로 3~32자여야 합니다.")
    pw = getpass.getpass("비밀번호 (8자 이상): ")
    if len(pw) < 8:
        sys.exit("비밀번호는 8자 이상이어야 합니다.")
    if getpass.getpass("비밀번호 확인: ") != pw:
        sys.exit("두 비밀번호가 다릅니다.")

    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        u = db.get(AppUser, login_id)
        if u is None:
            db.add(AppUser(login_id=login_id, name=name, role="admin", password_hash=hash_password(pw),
                           active=True, created_at=kst_now()))
            print(f"관리자 계정을 만들었습니다: {login_id}")
        else:
            u.role, u.active, u.password_hash = "admin", True, hash_password(pw)
            db.query(UserSession).filter(UserSession.login_id == u.login_id).delete()
            print(f"기존 계정을 관리자로 바꾸고 비밀번호를 재설정했습니다: {u.login_id}")
        db.commit()


if __name__ == "__main__":
    main()
