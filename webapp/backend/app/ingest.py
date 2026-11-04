"""센서 CSV 적재.

1) 협력사 CSV(측압/수분)를 읽어 원본 그대로 pressure/moisture 테이블에 INSERT IGNORE
2) 영향받은 센서·기간의 10분 집계(sensor_10min)를 다시 계산
"""
import hashlib
import io
from datetime import timedelta

import numpy as np
import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine

from .config import GRAM_SENSORS, PRESSURE_OUTLIER_KG, RAWMO_MISSING, TEMP_MISSING

PRESSURE_COLS = ["mac", "press", "weight", "temp1", "temp2", "temp3", "temp", "humi",
                 "rawMo", "c_mo", "bat", "timestamp", "pressure_sn"]
MOISTURE_COLS = ["mac", "uf", "uf_val", "mo_r", "mo_per", "temp", "humi", "bat", "timestamp", "remark"]
INT_COLS = {"press", "rawMo", "uf", "mo_r"}
BATCH = 20000


class IngestError(ValueError):
    pass


def detect_kind(columns) -> str:
    cols = set(columns)
    if "uf" in cols and "press" not in cols:
        return "moisture"
    if "press" in cols:
        return "pressure"
    raise IngestError("측압(press) 또는 수분(uf) 컬럼이 없는 CSV입니다.")


def parse_csv(content: bytes, filename: str):
    raw = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False)
    kind = detect_kind(raw.columns)
    cols = PRESSURE_COLS if kind == "pressure" else MOISTURE_COLS
    # 같은 원본 행 = 같은 해시 (파일 이름과 무관)
    joined = raw.reindex(columns=cols, fill_value="").agg("|".join, axis=1)
    row_hash = [hashlib.md5(s.encode()).hexdigest() for s in joined]

    df = raw.reindex(columns=cols).replace({"\\0": None, "": None, " ": None})
    df["mac"] = df.mac.str.strip().str.upper()
    df["timestamp"] = pd.to_datetime(df.timestamp, errors="coerce")
    for c in cols:
        if c in ("mac", "timestamp", "pressure_sn", "remark"):
            continue
        df[c] = pd.to_numeric(df[c], errors="coerce")
        if c in INT_COLS:
            df[c] = df[c].round().astype("Int64")
    df["src_file"] = filename
    df["row_hash"] = row_hash
    df = df[df.timestamp.notna() & df.mac.notna()]
    return kind, df


def _insert(engine: Engine, table: str, df: pd.DataFrame) -> int:
    cols = list(df.columns)
    sql = f"INSERT IGNORE INTO {table} ({', '.join(f'`{c}`' for c in cols)}) VALUES ({', '.join(['%s'] * len(cols))})"
    obj = df.astype(object).where(df.notna(), None)
    obj["timestamp"] = [t.to_pydatetime() for t in df.timestamp]
    inserted = 0
    raw_conn = engine.raw_connection()
    try:
        cur = raw_conn.cursor()
        for i in range(0, len(obj), BATCH):
            chunk = obj.iloc[i:i + BATCH]
            inserted += cur.executemany(sql, [tuple(r) for r in chunk.itertuples(index=False)])
            raw_conn.commit()
    finally:
        raw_conn.close()
    return inserted


def _aggregate_pressure(d: pd.DataFrame) -> pd.DataFrame:
    temps = d[["temp1", "temp2", "temp3"]].astype(float)
    d = d.assign(
        temp_in=temps.where(temps > TEMP_MISSING).mean(axis=1),
        temp_out=d.temp.where(~((d.temp == 0) & (d.humi == 0))),
        humi=d.humi.where(~((d.temp == 0) & (d.humi == 0))),
        weight_kg=np.where(d.mac.isin(GRAM_SENSORS), d.weight / 1000, d.weight),
        c_mo=d.c_mo.where(d.rawMo < RAWMO_MISSING),
    )
    d["weight_kg"] = d.weight_kg.where(d.weight_kg.abs() <= PRESSURE_OUTLIER_KG)
    return d[["mac", "timestamp", "temp_in", "temp_out", "humi", "weight_kg", "c_mo"]]


def _aggregate_moisture(d: pd.DataFrame) -> pd.DataFrame:
    valid = ~((d.temp == 0) & (d.humi == 0))
    return d.assign(temp_out=d.temp.where(valid), humi=d.humi.where(valid))[
        ["mac", "timestamp", "temp_out", "humi", "uf_val"]]


def rebuild_10min(engine: Engine, kind: str, mac: str, start, end):
    """[start, end) 구간의 해당 센서 10분 집계를 DB 원본에서 다시 계산한다 (7일 단위)."""
    table = "pressure" if kind == "pressure" else "moisture"
    cols = (["mac", "timestamp", "temp1", "temp2", "temp3", "temp", "humi", "weight", "rawMo", "c_mo"]
            if kind == "pressure" else ["mac", "timestamp", "temp", "humi", "uf_val"])
    metrics = ["temp_in", "temp_out", "humi", "weight_kg", "c_mo", "uf_val"]
    t = pd.Timestamp(start).floor("10min")
    end = pd.Timestamp(end).ceil("10min") + timedelta(minutes=10)
    while t < end:
        t1 = min(t + timedelta(days=7), end)
        d = pd.read_sql(
            text(f"SELECT {', '.join(f'`{c}`' for c in cols)} FROM {table} "
                 "WHERE mac = :mac AND timestamp >= :a AND timestamp < :b"),
            engine, params={"mac": mac, "a": t.to_pydatetime(), "b": t1.to_pydatetime()})
        if not d.empty:
            for c in cols[2:]:
                d[c] = pd.to_numeric(d[c], errors="coerce")
            d = _aggregate_pressure(d) if kind == "pressure" else _aggregate_moisture(d)
            g = d.set_index("timestamp").resample("10min")
            agg = g.median(numeric_only=True)
            agg["n"] = g.size()
            agg = agg[agg.n > 0].reindex(columns=metrics + ["n"])
            agg = agg.reset_index().rename(columns={"timestamp": "bucket"})
            agg.insert(0, "mac", mac)
            _upsert_10min(engine, agg)
        t = t1


def _upsert_10min(engine: Engine, agg: pd.DataFrame):
    cols = ["mac", "bucket", "temp_in", "temp_out", "humi", "weight_kg", "c_mo", "uf_val", "n"]
    # 같은 MAC이 측압·수분 양쪽에 없으므로 행 단위 REPLACE로 충분
    sql = f"REPLACE INTO sensor_10min ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})"
    obj = agg[cols].astype(object).where(agg[cols].notna(), None)
    obj["bucket"] = [b.to_pydatetime() for b in agg.bucket]
    raw_conn = engine.raw_connection()
    try:
        cur = raw_conn.cursor()
        cur.executemany(sql, [tuple(r) for r in obj.itertuples(index=False)])
        raw_conn.commit()
    finally:
        raw_conn.close()


def ingest_csv(engine: Engine, content: bytes, filename: str) -> dict:
    kind, df = parse_csv(content, filename)
    if df.empty:
        raise IngestError("유효한 행(mac, timestamp)이 없습니다.")
    inserted = _insert(engine, kind, df)
    # 깨진 MAC(LoRa 파싱 오류)은 집계에서 제외: 영숫자 4~12자리만
    macs = df.groupby("mac").timestamp.agg(["min", "max", "size"])
    macs = macs[macs.index.str.fullmatch(r"[0-9A-F]{4,12}") & (macs["size"] >= 10)]
    for mac, r in macs.iterrows():
        rebuild_10min(engine, kind, mac, r["min"], r["max"])
    return {
        "kind": kind, "rows_total": len(df), "rows_inserted": int(inserted),
        "period_start": df.timestamp.min().to_pydatetime(),
        "period_end": df.timestamp.max().to_pydatetime(),
        "sensors": sorted(macs.index.tolist()),
    }
