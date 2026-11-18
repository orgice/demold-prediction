"""비밀번호 해시·세션 토큰 도구 (로그인용).

- 비밀번호는 원문을 저장하지 않고 scrypt 해시만 저장한다 (파이썬 기본 hashlib, 추가 라이브러리 없음).
  저장 형식: "scrypt$n$r$p$소금(hex)$해시(hex)"  → 나중에 강도(n)를 올려도 예전 해시를 그대로 검사할 수 있다.
- 세션 토큰은 브라우저 쿠키에만 원문이 있고, DB에는 sha256 해시만 저장한다 (DB가 새도 토큰을 못 씀).
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

_N, _R, _P = 2**14, 8, 1   # scrypt 강도 (메모리 약 16MB, 한 번에 수십 ms)


def kst_now() -> datetime:
    """한국 현지 시각 (컨테이너 시계는 UTC). 다른 화면처럼 시간대 없는 현지 시각으로 저장한다."""
    return (datetime.utcnow() + timedelta(hours=9)).replace(microsecond=0)


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=_N, r=_R, p=_P)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${h.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, h = stored.split("$")
        if algo != "scrypt":
            return False
        got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p))
        return hmac.compare_digest(got.hex(), h)
    except (ValueError, TypeError):
        return False


# 없는 ID로 로그인할 때도 비슷한 시간이 걸리게 하는 가짜 해시 (ID가 있는지 시간 차로 알아내지 못하게)
DUMMY_HASH = hash_password(secrets.token_hex(8))


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
