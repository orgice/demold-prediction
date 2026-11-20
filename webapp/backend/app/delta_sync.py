"""협력사 센서 데이터 자동 수집 (Databricks Delta Sharing → pressure/moisture 테이블).

협력사가 Delta Sharing(Bearer Token)으로 센서 원본 테이블을 공유한다. 자격증명 파일(config.share)을
DELTA_SHARE_FILE 위치에 두면 서버가 DELTA_SYNC_INTERVAL_MIN 분마다 새 행을 가져와 CSV 업로드와 같은 길
(ingest._insert: 원본 INSERT IGNORE → ingest.rebuild_10min: 10분 집계 다시 계산)로 저장한다. 파일이 없으면 수집은 꺼진다.
    ⚠ 자격증명 파일에는 접속 토큰이 들어 있다. 저장소에 넣지 않는다 (.gitignore 의 *.share).

공유 테이블 → 우리 컬럼 (CSV 와 같은 이름. 2026-11 기존 CSV 행과 값·시각을 맞대어 확인)
    측압: lat_press_sens_data_base   수분: moist_sens_data_base   (아래 PRESSURE_MAP·MOISTURE_MAP)
    시각 SENS_EVNT_DTM 은 UTC → DELTA_UTC_OFFSET_H(9)시간을 더해 현장 현지 시각(KST)으로 저장

새 행 고르기
    공유 테이블은 파일 하나(분할 없음, 스트리밍 테이블이라 버전·변경 조회 불가)라서 매번 파일 전체를 받는다
    (측압 약 32MB). 메모리를 아끼려고 필요한 컬럼만 조금씩 읽으면서 센서별로
    'DB에 있는 그 센서의 마지막 시각 − DELTA_LOOKBACK_H' 이후 행만 남긴다 (늦게 도착한 행도 받기 위해 되돌아봄).
    그중 같은 센서·같은 시각 행이 이미 DB에 있으면 건너뛴다 → CSV 로 먼저 올린 기간과 겹쳐도 두 번 들어가지 않는다.
    같은 공유 행은 row_hash('delta|' + 값)로도 한 번만 들어간다.

업로드 기록: 종류별로 하루에 한 줄 ('Delta Sharing 측압 2026-11-20'). 센서 데이터 화면의 CSV 목록에 보이고,
CSV 처럼 이름 변경·삭제할 수 있다 (삭제하면 그날 수집한 행이 지워지고, 다음 수집 때 다시 들어온다).
"""
import hashlib
import io
import json
import os
import threading
import time
import urllib.request
from datetime import datetime, timedelta

import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from sqlalchemy import select, text

from . import maturity
from .config import (DELTA_LOOKBACK_H, DELTA_SHARE_FILE, DELTA_SYNC_INTERVAL_MIN, DELTA_TABLES, DELTA_UTC_OFFSET_H)
from .db import SessionLocal, engine
from .ingest import INT_COLS, MAC_RE, MOISTURE_COLS, PRESSURE_COLS, _insert, rebuild_10min
from .models import UploadLog
from .security import kst_now

# 공유 테이블 컬럼 → 우리 컬럼
PRESSURE_MAP = {
    "SENS_MAC_VAL": "mac", "LAT_PRESS_VAL": "press", "LAT_PRESS_CONV_VAL": "weight",
    "CONC_SEC_FST_MEAS_TMPR": "temp1", "CONC_SEC_SND_MEAS_TMPR": "temp2", "CONC_SEC_THD_MEAS_TMPR": "temp3",
    "EXT_TMPR_VAL": "temp", "EXT_HUM_VAL": "humi", "SOIL_MOIST_VAL": "rawMo", "SOIL_MOIST_RT": "c_mo",
    "BAT_VOLT_VAL": "bat", "SENS_EVNT_DTM": "timestamp", "PRESS_SENS_SR_NUM": "pressure_sn",
}
MOISTURE_MAP = {
    "SENS_MAC_VAL": "mac", "MOIST_VAL": "uf", "MOIST_RT": "uf_val", "MOIST_AVG_VAL": "mo_r", "MOIST_AVG_RT": "mo_per",
    "EXT_TMPR_VAL": "temp", "EXT_HUM_VAL": "humi", "BAT_VOLT_VAL": "bat", "SENS_EVNT_DTM": "timestamp",
}
KIND_LABEL = {"pressure": "측압", "moisture": "수분"}
BATCH_ROWS = 200_000

ENABLED = os.path.isfile(DELTA_SHARE_FILE) and os.path.getsize(DELTA_SHARE_FILE) > 0
# 화면에 보여 줄 상태 (GET /api/delta/status)
status: dict = {"last_run": None, "last_ok": None, "last_error": None, "last_inserted": {}, "token_expires": None,
                "running": False}
_lock = threading.Lock()


class DeltaError(RuntimeError):
    pass


# ---------- Delta Sharing 프로토콜 (REST) ----------
def _profile() -> dict:
    with open(DELTA_SHARE_FILE, encoding="utf-8") as f:
        p = json.load(f)
    if not p.get("endpoint") or not p.get("bearerToken"):
        raise DeltaError("자격증명 파일에 endpoint·bearerToken 이 없습니다.")
    status["token_expires"] = p.get("expirationTime")
    return p


def _file_urls(p: dict, table: str) -> list[str]:
    """표 하나의 데이터 파일(parquet) 주소 목록. 주소는 잠시만 쓸 수 있는 서명 주소라 바로 받는다."""
    share, schema, name = table.split(".")
    req = urllib.request.Request(
        f"{p['endpoint'].rstrip('/')}/shares/{share}/schemas/{schema}/tables/{name}/query",
        data=b"{}", method="POST",
        headers={"Authorization": f"Bearer {p['bearerToken']}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            lines = r.read().decode().splitlines()
    except urllib.error.HTTPError as e:
        # 토큰이 만료·폐기되면 401/403. 응답 본문에 토큰은 들어 있지 않다
        raise DeltaError(f"Delta Sharing 조회 실패 ({e.code}): {e.read().decode(errors='replace')[:300]}") from None
    return [json.loads(x)["file"]["url"] for x in lines if x.strip() and '"file"' in x]


def _download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=300) as r:
        return r.read()


# ---------- 새 행 고르기 ----------
def _db_last(kind: str) -> dict[str, datetime]:
    """센서별 DB의 마지막 측정 시각."""
    with engine.connect() as c:
        return {m: t for m, t in c.execute(text(f"SELECT mac, MAX(timestamp) FROM {kind} GROUP BY mac")) if m and t}


def _read_new(data: bytes, cols: dict[str, str], last: dict[str, datetime]) -> pd.DataFrame:
    """parquet 에서 필요한 컬럼만 조금씩 읽으며 센서별 기준 시각 이후 행만 남긴다 (시각은 KST 로 바꿈)."""
    pf = pq.ParquetFile(io.BytesIO(data))
    offset, back = timedelta(hours=DELTA_UTC_OFFSET_H), timedelta(hours=DELTA_LOOKBACK_H)
    # 센서별 기준 (UTC 로 비교). DB에 없는 센서는 처음부터 전부
    cutoff = {m.upper(): t - offset - back for m, t in last.items()}
    earliest = min(cutoff.values()) if len(cutoff) else None
    ts_type = pf.schema_arrow.field("SENS_EVNT_DTM").type
    parts = []
    for b in pf.iter_batches(batch_size=BATCH_ROWS, columns=list(cols)):
        # 1차: 가장 이른 기준보다 오래된 행은 pandas 로 바꾸기 전에 버린다 (모르는 센서가 있으면 건너뜀)
        known = pc.is_in(pc.utf8_upper(pc.utf8_trim_whitespace(b.column("SENS_MAC_VAL"))),
                         value_set=pa.array(list(cutoff), pa.string()))
        if earliest is not None:
            recent = pc.greater(b.column("SENS_EVNT_DTM"), pa.scalar(earliest, type=ts_type))
            b = b.filter(pc.or_kleene(pc.invert(known), recent))
        if b.num_rows:
            d = b.to_pandas()
            mac = d.SENS_MAC_VAL.astype(str).str.strip().str.upper()
            lim = mac.map(cutoff)
            parts.append(d[lim.isna() | (d.SENS_EVNT_DTM > lim)])
    if not parts:
        return pd.DataFrame(columns=list(cols.values()))
    d = pd.concat(parts, ignore_index=True).rename(columns=cols)
    d["timestamp"] = pd.to_datetime(d.timestamp) + offset
    return d


def _to_rows(kind: str, d: pd.DataFrame, table: str) -> pd.DataFrame:
    """CSV 적재(ingest.parse_csv)와 같은 모양으로: 컬럼 순서·숫자 변환·row_hash·src_file."""
    cols = PRESSURE_COLS if kind == "pressure" else MOISTURE_COLS
    d = d.reindex(columns=cols)
    d["mac"] = d.mac.astype(str).str.strip().str.upper()
    for c in cols:
        if c in ("mac", "timestamp", "pressure_sn", "remark"):
            continue
        d[c] = pd.to_numeric(d[c], errors="coerce")
        if c in INT_COLS:
            d[c] = d[c].round().astype("Int64")
    if "pressure_sn" in d:
        d["pressure_sn"] = d.pressure_sn.where(d.pressure_sn.notna(), None)
    d = d[d.timestamp.notna() & d.mac.str.fullmatch(MAC_RE)]   # 시험 장치(TEST-NODATA-001 등)·깨진 MAC 은 버림
    joined = d.astype(str).agg("|".join, axis=1)
    d = d.assign(src_file=f"delta:{table}"[:255],
                 row_hash=[hashlib.md5(("delta|" + s).encode()).hexdigest() for s in joined])
    return d


def _drop_existing(kind: str, d: pd.DataFrame) -> pd.DataFrame:
    """같은 센서·같은 시각 행이 DB에 이미 있으면 뺀다 (CSV 로 먼저 올린 기간과 겹칠 때)."""
    keep = []
    with engine.connect() as c:
        for mac, g in d.groupby("mac"):
            have = {t for (t,) in c.execute(
                text(f"SELECT timestamp FROM {kind} WHERE mac = :m AND timestamp >= :a AND timestamp <= :b"),
                {"m": mac, "a": g.timestamp.min().to_pydatetime(), "b": g.timestamp.max().to_pydatetime()})}
            keep.append(g[~g.timestamp.isin(pd.to_datetime(list(have)))] if have else g)
    return pd.concat(keep, ignore_index=True) if keep else d.iloc[0:0]


def _day_log(kind: str, d: pd.DataFrame) -> int:
    """오늘 이 종류의 수집 기록(upload_log) id. 없으면 만든다."""
    name = f"Delta Sharing {KIND_LABEL[kind]} {kst_now():%Y-%m-%d}"
    with SessionLocal() as s:
        log = s.scalar(select(UploadLog).where(UploadLog.filename == name, UploadLog.kind == kind))
        if log is None:
            log = UploadLog(filename=name, kind=kind, rows_total=0, rows_inserted=0,
                            period_start=d.timestamp.min().to_pydatetime(), period_end=d.timestamp.max().to_pydatetime())
            s.add(log)
            s.commit()
        return log.id


def _update_log(log_id: int, r: dict) -> None:
    with SessionLocal() as s:
        log = s.get(UploadLog, log_id)
        log.rows_total += r["rows_total"]
        log.rows_inserted += r["rows_inserted"]
        log.period_start = min(filter(None, [log.period_start, r["period_start"]]))
        log.period_end = max(filter(None, [log.period_end, r["period_end"]]))
        log.sensors = ",".join(sorted(set(filter(None, (log.sensors or "").split(","))) | set(r["sensors"])))[:500]
        s.commit()


# ---------- 한 번 수집 ----------
def sync_table(p: dict, table: str, kind: str) -> int:
    """표 하나를 수집한다. 반환: 새로 저장한 행 수."""
    cols = PRESSURE_MAP if kind == "pressure" else MOISTURE_MAP
    last = _db_last(kind)
    inserted = 0
    for url in _file_urls(p, table):
        new = _read_new(_download(url), cols, last)
        # 센서별로 나눠 저장 (처음 수집할 때 수십만 행이 한꺼번에 오면 메모리를 많이 쓰므로)
        # CSV 의 _store 와 달리 새 행이 몇 개뿐이어도 10분 집계를 다시 계산한다 (MAC 은 _to_rows 에서 이미 걸렀음)
        for mac, g in new.groupby("mac"):
            d = _drop_existing(kind, _to_rows(kind, g, table))
            if d.empty:
                continue
            log_id = _day_log(kind, d)
            n = _insert(engine, kind, d.assign(upload_id=log_id))
            a, b = d.timestamp.min().to_pydatetime(), d.timestamp.max().to_pydatetime()
            if n:
                rebuild_10min(engine, kind, mac, a, b)
            _update_log(log_id, {"rows_total": len(d), "rows_inserted": int(n), "period_start": a, "period_end": b,
                                 "sensors": [mac] if n else []})
            inserted += int(n)
    return inserted


def run_once() -> dict:
    """모든 공유 표를 한 번 수집한다. 겹쳐 부르면 앞의 수집이 끝날 때까지 기다리지 않고 바로 돌아간다."""
    if not _lock.acquire(blocking=False):
        return {"skipped": "이미 수집 중입니다."}
    status["running"] = True
    errors, result = [], {}
    try:
        p = _profile()
        for table, kind in DELTA_TABLES.items():
            try:
                result[table] = sync_table(p, table, kind)
            except Exception as e:   # 한 표가 실패해도 다른 표는 계속
                errors.append(f"{table.split('.')[-1]}: {type(e).__name__}: {e}")
        if any(result.values()):
            maturity.clear_cache()   # 새 데이터로 예측을 다시 계산하게
    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
    finally:
        status.update(last_run=kst_now(), last_inserted=result, last_error=" / ".join(errors)[:500] or None,
                      running=False)
        if not errors:
            status["last_ok"] = status["last_run"]
        else:
            print(f"[delta] 수집 실패: {status['last_error']}", flush=True)
        _lock.release()
    return result


def _loop() -> None:
    time.sleep(20)   # 서버가 다 켜진 뒤 시작
    while True:
        run_once()
        time.sleep(max(1.0, DELTA_SYNC_INTERVAL_MIN) * 60)


def start() -> None:
    """서버 시작 시 부른다. 자격증명 파일이 있으면 백그라운드에서 주기적으로 수집한다."""
    if ENABLED:
        threading.Thread(target=_loop, name="delta-sync", daemon=True).start()
        print(f"[delta] 센서 데이터 자동 수집 켜짐: 표 {len(DELTA_TABLES)}개, {DELTA_SYNC_INTERVAL_MIN:g}분마다", flush=True)
    else:
        print(f"[delta] 자격증명 파일({DELTA_SHARE_FILE})이 없어 자동 수집은 꺼져 있습니다 (CSV 업로드만 사용).", flush=True)
