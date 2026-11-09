"""센서 데이터 API (화면: 센서 데이터, 데이터 업로드).

- GET  /api/sensors         센서 목록과 데이터가 있는 기간
- GET  /api/sensors/series  센서별 시계열 (그래프용)
- POST /api/upload          CSV 업로드 → DB 저장 → 10분 집계
- GET  /api/uploads         업로드 기록
"""
from datetime import datetime, timedelta

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import bindparam, select, text
from sqlalchemy.orm import Session

from .. import maturity
from ..db import engine, get_session
from ..config import HIDDEN_SENSORS
from ..ingest import IngestError, ingest_csv
from ..models import UploadLog
from ..schemas import SensorOut, UploadOut

router = APIRouter(prefix="/api", tags=["센서"])

# 그래프로 보여 주는 측정 항목 (sensor_10min 테이블의 컬럼)
METRICS = ["temp_in", "temp_out", "humi", "weight_kg", "c_mo", "uf_val"]


@router.get("/sensors", response_model=list[SensorOut])
def list_sensors():
    """센서 목록. 수분 값(uf_val)이 있으면 수분 센서, 아니면 측압 센서로 표시. 숨김 센서는 뺀다."""
    rows = pd.read_sql(text(
        "SELECT mac, MIN(bucket) AS first, MAX(bucket) AS last, COUNT(*) AS buckets, "
        "SUM(uf_val IS NOT NULL) AS moist FROM sensor_10min GROUP BY mac ORDER BY mac"), engine)
    return [SensorOut(mac=r.mac, kind="moisture" if r.moist > 0 else "pressure",
                      first=r["first"], last=r["last"], buckets=int(r.buckets))
            for _, r in rows.iterrows() if r.mac not in HIDDEN_SENSORS]


@router.get("/sensors/series")
def sensor_series(macs: list[str] = Query(...), start: datetime = Query(...), end: datetime = Query(...)):
    """10분 집계 시계열. 기간이 45일을 넘으면 1시간 평균으로 줄인다.

    돌려주는 모양: {"freq": "10min", "sensors": {"9288": {"t": [시각...], "temp_in": [값...], ...}}}
    값이 하나도 없는 항목은 빠진다.
    """
    if end <= start:
        raise HTTPException(400, "end는 start보다 뒤여야 합니다.")
    if end - start > timedelta(days=400):
        raise HTTPException(400, "한 번에 400일까지 조회할 수 있습니다.")
    q = text(f"SELECT mac, bucket, {', '.join(METRICS)} FROM sensor_10min "
             "WHERE mac IN :macs AND bucket >= :a AND bucket < :b ORDER BY bucket").bindparams(
        bindparam("macs", expanding=True))
    d = pd.read_sql(q, engine, params={"macs": [m.upper() for m in macs], "a": start, "b": end})
    freq = "10min"
    if end - start > timedelta(days=45):
        # 점이 너무 많으면 화면이 느려지므로 1시간 평균으로 줄인다
        freq = "1h"
        d = (d.set_index("bucket").groupby("mac")[METRICS].resample("1h").mean()
               .dropna(how="all").reset_index())
    out = {}
    for mac, g in d.groupby("mac"):
        out[mac] = {"t": [t.isoformat() for t in g.bucket]}
        for m in METRICS:
            v = g[m]
            if v.notna().any():
                out[mac][m] = [None if pd.isna(x) else round(float(x), 2) for x in v]
    return {"freq": freq, "sensors": out}


@router.post("/upload", response_model=list[UploadOut])
async def upload(files: list[UploadFile] = File(...), s: Session = Depends(get_session)):
    """CSV 여러 개를 받아 하나씩 저장한다 (실제 처리는 ingest.py). 이미 들어간 행은 건너뛴다."""
    results = []
    for f in files:
        if not f.filename.lower().endswith(".csv"):
            raise HTTPException(400, f"{f.filename}: CSV 파일만 올릴 수 있습니다.")
        try:
            r = ingest_csv(engine, await f.read(), f.filename)
        except IngestError as e:
            raise HTTPException(422, f"{f.filename}: {e}")
        s.add(UploadLog(filename=f.filename, kind=r["kind"], rows_total=r["rows_total"],
                        rows_inserted=r["rows_inserted"], period_start=r["period_start"],
                        period_end=r["period_end"]))
        s.commit()
        results.append(UploadOut(filename=f.filename, **r))
    # 새 데이터가 들어왔으니 예측 모델의 기억(캐시)을 지워 다시 계산하게 한다
    maturity.clear_cache()
    return results


@router.get("/uploads")
def upload_history(s: Session = Depends(get_session)):
    """최근 업로드 기록 100건 (최신순)."""
    logs = s.scalars(select(UploadLog).order_by(UploadLog.id.desc()).limit(100))
    return [{"id": u.id, "filename": u.filename, "kind": u.kind, "rows_total": u.rows_total,
             "rows_inserted": u.rows_inserted, "period_start": u.period_start,
             "period_end": u.period_end, "created_at": u.created_at} for u in logs]
