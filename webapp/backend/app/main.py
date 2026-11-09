"""백엔드 서버의 시작점.

uvicorn이 이 파일의 `app`을 실행한다 (backend/Dockerfile 참고).
기능별 API는 routers/ 폴더에 나뉘어 있고, 여기서 하나로 묶는다.

    /api/pours...   타설 회차·예측·공시체   (routers/pours.py)
    /api/sensors... 센서 데이터·CSV 업로드  (routers/sensors.py)
    /api/model...   강도 곡선 정보          (routers/model.py)
    /api/agent...   AI 상담                 (routers/agent.py)

서버를 띄운 뒤 http://localhost:8000/docs 에서 모든 API를 직접 눌러 볼 수 있다.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import Base, engine
from .routers import agent, model, pours, sensors

app = FastAPI(title="거푸집 탈형 시점 예측 API", version="0.1.0")
# CORS: 다른 주소(예: 개발용 프론트엔드 :5173)의 웹 화면이 이 API를 부를 수 있게 허용
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(pours.router)
app.include_router(sensors.router)
app.include_router(model.router)
app.include_router(agent.router)


@app.on_event("startup")
def create_tables():
    """서버가 켜질 때 DB에 테이블이 없으면 만든다 (이미 있으면 그대로 둔다)."""
    Base.metadata.create_all(engine)


@app.get("/api/health")
def health():
    """서버가 살아 있는지 확인하는 용도."""
    return {"status": "ok"}
