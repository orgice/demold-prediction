from datetime import datetime, timedelta

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import bindparam, select, text
from sqlalchemy.orm import Session

from .. import maturity
from ..db import engine, get_session
from ..ingest import IngestError, ingest_csv
from ..models import UploadLog
from ..schemas import SensorOut, UploadOut

router = APIRouter(prefix="/api", tags=["센서"])

METRICS = ["temp_in", "temp_out", "humi", "weight_kg", "c_mo", "uf_val"]


@router.get("/sensors", response_model=list[SensorOut])
def list_sensors():
    rows = pd.read_sql(text(
        "SELECT mac, MIN(bucket) AS first, MAX(bucket) AS last, COUNT(*) AS buckets, "
        "SUM(uf_val IS NOT NULL) AS moist FROM sensor_10min GROUP BY mac ORDER BY mac"), engine)
    return [SensorOut(mac=r.mac, kind="moisture" if r.moist > 0 else "pressure",
                      first=r["first"], last=r["last"], buckets=int(r.buckets)) for _, r in rows.iterrows()]


@router.get("/sensors/series")
def sensor_series(macs: list[str] = Query(...), start: datetime = Query(...), end: datetime = Query(...)):
    """10분 집계 시계열. 기간이 45일을 넘으면 1시간 평균으로 줄인다."""
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
    maturity.clear_cache()
    return results


@router.get("/uploads")
def upload_history(s: Session = Depends(get_session)):
    logs = s.scalars(select(UploadLog).order_by(UploadLog.id.desc()).limit(100))
    return [{"id": u.id, "filename": u.filename, "kind": u.kind, "rows_total": u.rows_total,
             "rows_inserted": u.rows_inserted, "period_start": u.period_start,
             "period_end": u.period_end, "created_at": u.created_at} for u in logs]
