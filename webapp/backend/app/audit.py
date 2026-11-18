"""변경 기록 (누가 언제 무엇을 바꿨는지) — audit_log 테이블.

AuditMiddleware 가 /api/ 아래의 '바꾸는 요청'(POST·PUT·PATCH·DELETE)을 모두 기록한다.
    - 누가: 로그인한 사용자 (auth.user_from_request 가 request.state.login_id 에 넣어 둔다)
    - 무엇을: ACTIONS 표의 작업 이름 + 주소(대상 id 포함) + 보낸 내용(JSON, 비밀번호는 가림)
    - 결과: 응답 코드 (거부된 시도도 남는다)
로그인 성공·실패도 남긴다. AI 상담(질문)과 조회는 데이터를 바꾸지 않으므로 남기지 않는다.
바뀌기 전 값은 남기지 않는다 (필요하면 같은 대상의 이전 기록을 보면 된다).
"""
import ipaddress
import json
import re

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from .db import SessionLocal
from .models import AuditLog
from .security import kst_now

# (메서드, 주소 패턴, 작업 이름). 위에서부터 처음 맞는 것을 쓴다
ACTIONS: list[tuple[str, str, str]] = [
    ("POST", r"/api/auth/login", "로그인"),
    ("POST", r"/api/auth/logout", "로그아웃"),
    ("PATCH", r"/api/auth/me", "내 계정 수정"),
    ("POST", r"/api/users", "사용자 추가"),
    ("PATCH", r"/api/users/[^/]+/active", "사용자 사용 중지·재개"),
    ("PATCH", r"/api/users/[^/]+", "사용자 수정"),
    ("DELETE", r"/api/users/[^/]+", "사용자 삭제"),
    ("POST", r"/api/pours", "회차 등록"),
    ("PATCH", r"/api/pours/\d+", "회차 수정"),
    ("DELETE", r"/api/pours/\d+", "회차 삭제"),
    ("POST", r"/api/pours/\d+/detect", "타설 시각 자동 추정"),
    ("POST", r"/api/pours/\d+/tests", "공시체 결과 입력"),
    ("PUT", r"/api/pours/\d+/tests/\d+", "공시체 결과 수정"),
    ("DELETE", r"/api/pours/\d+/tests/\d+", "공시체 결과 삭제"),
    ("POST", r"/api/pours/\d+/notice", "알림 메일 초안 기록"),
    ("POST", r"/api/pours/\d+/exclusions", "제외 구간 추가"),
    ("DELETE", r"/api/pours/\d+/exclusions/\d+", "제외 구간 삭제"),
    ("POST", r"/api/upload", "CSV 업로드"),
]
SKIP = re.compile(r"^/api/agent/")          # AI 상담 질문은 기록하지 않음
SECRET_KEYS = {"password", "current_password", "new_password"}
MAX_DETAIL = 4000

# 앞단 프록시(nginx·caddy)가 있는 내부망. 이 주소에서 온 요청만 X-Real-IP 를 믿는다
_PRIVATE = [ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "::1/128")]


def client_ip(request: Request) -> str:
    """접속한 사람의 IP. nginx(frontend/nginx.conf)가 넣어 주는 X-Real-IP 를 쓰되,
    프록시를 거치지 않고 바로 들어온 요청이면 그 헤더는 믿지 않는다 (위조 방지)."""
    peer = request.client.host if request.client else ""
    try:
        trusted = any(ipaddress.ip_address(peer) in n for n in _PRIVATE)
    except ValueError:
        trusted = False
    real = request.headers.get("x-real-ip", "").strip()
    return (real if trusted and real else peer)[:45]


def action_name(method: str, path: str) -> str:
    for m, pat, name in ACTIONS:
        if m == method and re.fullmatch(pat, path):
            return name
    return f"{method} {path}"[:50]


def mask(body: bytes, content_type: str) -> str | None:
    """보낸 내용을 기록용 문자열로. JSON 이 아니면(CSV 파일 등) 남기지 않는다. 비밀번호 값은 가린다."""
    if not body or "application/json" not in content_type:
        return None
    try:
        data = json.loads(body)
    except ValueError:
        return None
    if isinstance(data, dict):
        data = {k: ("***" if k in SECRET_KEYS else v) for k, v in data.items()}
    s = json.dumps(data, ensure_ascii=False)
    return s if len(s) <= MAX_DETAIL else s[:MAX_DETAIL] + "…"


def write(*, login_id: str | None, ip: str | None, action: str, method: str, path: str,
          status: int, detail: str | None) -> None:
    try:
        with SessionLocal() as db:
            db.add(AuditLog(at=kst_now(), login_id=login_id, ip=ip, action=action, method=method,
                            path=path[:255], status=status, detail=detail))
            db.commit()
    except Exception as e:   # 기록 실패가 본 작업을 망치지 않게 (서버 로그에만 남김)
        print(f"[audit] 기록 실패: {e}", flush=True)


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path, method = request.url.path, request.method
        if method in ("GET", "HEAD", "OPTIONS") or not path.startswith("/api/") or SKIP.match(path):
            return await call_next(request)
        ctype = request.headers.get("content-type", "")
        body = await request.body() if "application/json" in ctype else b""   # CSV 업로드 본문은 읽지 않음
        response = await call_next(request)
        login_id = getattr(request.state, "login_id", None)
        detail = mask(body, ctype)
        if path == "/api/auth/login":   # 로그인은 입력한 ID를 '누가'로 남기고 내용은 남기지 않음
            try:
                login_id = login_id or str(json.loads(body).get("id", ""))[:64] or None
            except (ValueError, AttributeError):
                pass
            detail = None
        write(login_id=login_id, ip=client_ip(request), action=action_name(method, path),
              method=method, path=path, status=response.status_code, detail=detail)
        return response
