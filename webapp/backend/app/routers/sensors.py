"""센서 데이터 API (화면: 센서 데이터, 데이터 업로드).

- GET  /api/sensors         센서 목록과 데이터가 있는 기간
- GET  /api/sensors/series  센서별 시계열 (그래프용)
- PATCH  /api/sensors/{mac}  센서 표시 이름 변경·목록에서 숨기기 (편집 이상)
- DELETE /api/sensors/{mac}  센서 측정 기록 전체 삭제 (관리자)
- POST /api/upload          CSV 업로드 → DB 저장 → 10분 집계
- GET  /api/uploads         업로드 기록
- PATCH  /api/uploads/{id}  업로드 표시 이름 변경 (편집 이상)
- DELETE /api/uploads/{id}  그 CSV로 저장된 데이터 삭제 (관리자)

조회는 로그인만, 바꾸는 요청은 편집 이상 (main.py 의 editor_for_writes). 삭제는 되돌릴 수 없어 관리자만.
"""
import json
from datetime import datetime, timedelta

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from sqlalchemy import bindparam, select, text
from sqlalchemy.orm import Session

from .. import maturity
from ..auth import require_role
from ..db import engine, get_session
from ..config import HIDDEN_SENSORS
from ..ingest import IngestError, delete_sensor, delete_upload, save_upload
from ..models import Pour, SensorMeta, UploadLog
from ..schemas import SensorOut, SensorPatch, UploadOut, UploadPatch

router = APIRouter(prefix="/api", tags=["센서"])

# 그래프로 보여 주는 측정 항목 (sensor_10min 테이블의 컬럼)
METRICS = ["temp_in", "temp_out", "humi", "weight_kg", "c_mo", "uf_val"]


def _sensors(s: Session, mac: str | None = None) -> list[SensorOut]:
    """센서 목록 (숨긴 센서 포함, hidden 표시). 수분 값(uf_val)이 있으면 수분 센서, 아니면 측압 센서.
    .env 의 HIDDEN_SENSORS 는 환경 설정으로 영구 제외라 목록에 아예 넣지 않는다."""
    where = "WHERE mac = :mac " if mac else ""
    rows = pd.read_sql(text(
        "SELECT mac, MIN(bucket) AS first, MAX(bucket) AS last, COUNT(*) AS buckets, "
        f"SUM(uf_val IS NOT NULL) AS moist FROM sensor_10min {where}GROUP BY mac ORDER BY mac"),
        engine, params={"mac": mac} if mac else None)
    meta = {m.mac: m for m in s.scalars(select(SensorMeta))}
    return [SensorOut(mac=r.mac, kind="moisture" if r.moist > 0 else "pressure",
                      first=r["first"], last=r["last"], buckets=int(r.buckets),
                      label=meta[r.mac].label if r.mac in meta else None,
                      hidden=bool(meta[r.mac].hidden) if r.mac in meta else False)
            for _, r in rows.iterrows() if r.mac not in HIDDEN_SENSORS]


@router.get("/sensors", response_model=list[SensorOut])
def list_sensors(s: Session = Depends(get_session)):
    """센서 목록. 화면에서 숨긴 센서도 hidden=true 로 함께 준다 (센서 데이터 화면이 걸러 보여 줌)."""
    return _sensors(s)


def _clean_label(v: str | None, limit: int) -> str | None:
    """앞뒤 공백을 지우고, 비어 있으면 None (원래 이름으로 되돌림). 너무 길면 422."""
    v = (v or "").strip()
    if len(v) > limit:
        raise HTTPException(422, f"이름은 {limit}자까지 쓸 수 있어요.")
    return v or None


@router.patch("/sensors/{mac}", response_model=SensorOut)
def update_sensor(mac: str, body: SensorPatch, s: Session = Depends(get_session)):
    """센서 표시 이름 변경·목록에서 숨기기. 보낸 항목만 바꾼다. 회차 연결·예측 계산에는 영향이 없다."""
    mac = mac.strip().upper()
    if not _sensors(s, mac):
        raise HTTPException(404, "데이터가 있는 센서가 아닙니다.")
    m = s.get(SensorMeta, mac) or SensorMeta(mac=mac, hidden=False)
    if "label" in body.model_fields_set:
        m.label = _clean_label(body.label, 50)
    if "hidden" in body.model_fields_set and body.hidden is not None:
        m.hidden = body.hidden
    s.add(m)
    s.commit()
    return _sensors(s, mac)[0]


@router.delete("/sensors/{mac}", dependencies=[Depends(require_role("admin"))])
def remove_sensor(mac: str, request: Request, s: Session = Depends(get_session)):
    """센서 측정 기록 전체(원본·10분 집계)를 지운다. 되돌릴 수 없어 관리자만.

    연결된 회차의 센서 목록은 그대로 둔다 (그 회차는 이 센서의 데이터 없이 계산·표시됨).
    응답의 pours 는 이 센서가 연결돼 있던 회차 id.
    """
    mac = mac.strip().upper()
    pours = [p.id for p in s.scalars(select(Pour)) if mac in p.sensor_list]
    rows = delete_sensor(engine, mac)
    if rows is None:
        raise HTTPException(404, "데이터가 있는 센서가 아닙니다.")
    maturity.clear_cache()
    out = {"mac": mac, "rows_deleted": rows, "pours": pours}
    request.state.audit_detail = json.dumps(out, ensure_ascii=False)
    return out


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
async def upload(files: list[UploadFile] = File(...)):
    """CSV 여러 개를 받아 하나씩 저장한다 (실제 처리는 ingest.save_upload). 이미 들어간 행은 건너뛴다.

    파일마다 따로 처리한다: 잘못된 파일은 결과의 error 에 사유를 담고 나머지 파일은 저장한다.
    모든 파일이 실패하면(아무것도 저장 안 됨) 예전처럼 422 로 사유를 돌려준다.
    """
    results: list[UploadOut] = []
    try:
        for f in files:
            if not f.filename.lower().endswith(".csv"):
                results.append(UploadOut(filename=f.filename, error="CSV 파일만 올릴 수 있습니다."))
                continue
            try:
                r = save_upload(engine, await f.read(), f.filename)
            except IngestError as e:
                results.append(UploadOut(filename=f.filename, error=str(e)))
                continue
            results.append(UploadOut(filename=f.filename, **{k: v for k, v in r.items() if k != "upload_id"}))
    finally:
        # 새 데이터가 들어왔으면(중간에 예상 못 한 오류가 나도) 예측 모델의 기억(캐시)을 지워 다시 계산하게 한다
        if any(r.error is None for r in results):
            maturity.clear_cache()
    if results and all(r.error for r in results):
        raise HTTPException(422, " / ".join(f"{r.filename}: {r.error}" for r in results))
    return results


def _upload_out(u: UploadLog) -> dict:
    return {"id": u.id, "filename": u.filename, "label": u.label, "kind": u.kind,
            "sensors": [m for m in (u.sensors or "").split(",") if m],
            "rows_total": u.rows_total, "rows_inserted": u.rows_inserted, "period_start": u.period_start,
            "period_end": u.period_end, "created_at": u.created_at}


@router.get("/uploads")
def upload_history(s: Session = Depends(get_session)):
    """최근 업로드 기록 100건 (최신순)."""
    return [_upload_out(u) for u in s.scalars(select(UploadLog).order_by(UploadLog.id.desc()).limit(100))]


@router.patch("/uploads/{upload_id}")
def rename_upload(upload_id: int, body: UploadPatch, s: Session = Depends(get_session)):
    """업로드 표시 이름 변경. 원본 파일 이름(filename)과 원본 행의 src_file 은 그대로 둔다 (추적용)."""
    u = s.get(UploadLog, upload_id)
    if u is None:
        raise HTTPException(404, "업로드 기록이 없습니다.")
    u.label = _clean_label(body.label, 100)
    s.commit()
    return _upload_out(u)


@router.delete("/uploads/{upload_id}", dependencies=[Depends(require_role("admin"))])
def remove_upload(upload_id: int, request: Request):
    """이 CSV로 처음 저장된 원본 행을 지우고, 그 센서·기간의 10분 집계를 다시 계산한다. 관리자만.

    같은 데이터를 다시 올려 새로 저장된 행이 없던 업로드는 업로드 기록만 지운다.
    """
    try:
        out = delete_upload(engine, upload_id)
    except LookupError:
        raise HTTPException(404, "업로드 기록이 없습니다.")
    maturity.clear_cache()
    request.state.audit_detail = json.dumps(out, ensure_ascii=False, default=str)
    return out
