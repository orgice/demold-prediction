from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import Base, engine
from .routers import agent, model, pours, sensors

app = FastAPI(title="거푸집 탈형 시점 예측 API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(pours.router)
app.include_router(sensors.router)
app.include_router(model.router)
app.include_router(agent.router)


@app.on_event("startup")
def create_tables():
    Base.metadata.create_all(engine)


@app.get("/api/health")
def health():
    return {"status": "ok"}
