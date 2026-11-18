"""백엔드 서버의 시작점.

uvicorn이 이 파일의 `app`을 실행한다 (backend/Dockerfile 참고).
기능별 API는 routers/ 폴더에 나뉘어 있고, 여기서 하나로 묶는다.

    /api/pours...   타설 회차·예측·공시체   (routers/pours.py)
    /api/sensors... 센서 데이터·CSV 업로드  (routers/sensors.py)
    /api/model...   강도 곡선 정보          (routers/model.py)
    /api/agent...   AI 상담                 (routers/agent.py)
    /api/auth...    로그인·로그아웃          (routers/auth.py)
    /api/users...   사용자 관리 (관리자)     (routers/users.py)
    /api/audit      변경 기록 (관리자)       (routers/audit.py, 기록은 audit.py)

/api/health 와 /api/auth/* 말고는 모두 로그인이 필요하다 (auth.py).
조회는 모든 권한, 회차·센서 데이터를 바꾸는 요청은 편집 권한 이상, 사용자 관리는 관리자만.

서버를 띄운 뒤 http://localhost:8000/docs 에서 모든 API를 직접 눌러 볼 수 있다.
"""
from fastapi import Depends, FastAPI
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware

from .audit import AuditMiddleware
from .auth import current_user, editor_for_writes, ensure_first_admin
from .config import CORS_ORIGINS
from .db import Base, engine
from .routers import agent, audit, auth, model, pours, sensors, users

app = FastAPI(title="거푸집 탈형 시점 예측 API", version="0.1.0")
# CORS: 다른 주소의 웹 화면이 로그인 쿠키를 들고 이 API를 부를 수 있게 허용할 주소 (config.CORS_ORIGINS)
# 평소에는 nginx·vite 프록시로 같은 주소에서 부르므로 CORS가 쓰이지 않는다
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.add_middleware(AuditMiddleware)   # 데이터를 바꾸는 요청·로그인을 audit_log 에 기록
writes_need_editor = [Depends(editor_for_writes)]   # 조회는 로그인만, 등록·수정·삭제는 편집 권한 이상
app.include_router(pours.router, dependencies=writes_need_editor)
app.include_router(sensors.router, dependencies=writes_need_editor)
app.include_router(model.router, dependencies=[Depends(current_user)])
app.include_router(agent.router, dependencies=[Depends(current_user)])   # AI 상담은 조회라 보기 권한도 가능
app.include_router(auth.router)
app.include_router(users.router)                     # 관리자 검사는 routers/users.py 안에서
app.include_router(audit.router)                     # 관리자 전용


@app.on_event("startup")
def create_tables():
    """서버가 켜질 때 DB에 테이블이 없으면 만든다 (이미 있으면 그대로 둔다)."""
    Base.metadata.create_all(engine)
    # 기존 DB에 나중에 추가된 컬럼 (create_all은 있는 테이블에 컬럼을 더하지 않는다)
    with engine.begin() as c:
        c.execute(text("ALTER TABLE pour ADD COLUMN IF NOT EXISTS member VARCHAR(10) NULL"))
        c.execute(text("ALTER TABLE pour ADD COLUMN IF NOT EXISTS notify_emails VARCHAR(500) NULL"))
        c.execute(text("ALTER TABLE pour ADD COLUMN IF NOT EXISTS notice TEXT NULL"))
    ensure_first_admin()


@app.get("/api/health")
def health():
    """서버가 살아 있는지 확인하는 용도."""
    return {"status": "ok"}
