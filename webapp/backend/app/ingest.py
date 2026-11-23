"""센서 CSV 적재·삭제.

1) 협력사 CSV(측압/수분)를 읽어 원본 그대로 pressure/moisture 테이블에 INSERT IGNORE
2) 영향받은 센서·기간의 10분 집계(sensor_10min)를 다시 계산

흐름: save_upload() → parse_csv() → upload_log 기록 → _store() → _insert() → rebuild_10min()
      → _aggregate_*() → _upsert_10min()

원본 행마다 처음 저장한 업로드 id(upload_id)를 남겨, 업로드 하나를 정확히 지울 수 있게 한다
(delete_upload). 같은 행이 다른 파일에도 있으면 처음 올린 업로드에만 연결된다 (row_hash 중복 제거).
센서 하나의 기록 전체 삭제는 delete_sensor.
"""
import hashlib
import io
import re
from datetime import timedelta

import numpy as np
import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine

from .config import GRAM_SENSORS, PRESSURE_OUTLIER_KG, RAWMO_MISSING, TEMP_MISSING
from .db import SessionLocal
from .models import UploadLog

# 10분 집계에 넣는 센서 MAC: 영숫자 4~12자리만 (깨진 MAC은 LoRa 파싱 오류)
MAC_RE = r"[0-9A-F]{4,12}"

# 협력사 CSV의 컬럼 (DB 테이블 컬럼과 같은 이름)
PRESSURE_COLS = ["mac", "press", "weight", "temp1", "temp2", "temp3", "temp", "humi",
                 "rawMo", "c_mo", "bat", "timestamp", "pressure_sn"]
MOISTURE_COLS = ["mac", "uf", "uf_val", "mo_r", "mo_per", "temp", "humi", "bat", "timestamp", "remark"]
INT_COLS = {"press", "rawMo", "uf", "mo_r"}     # 정수로 저장하는 컬럼
BATCH = 20000                                    # DB에 한 번에 넣는 행 수 (큰 파일을 나눠 넣음)


GRAM_SHARE = 0.2          # 하루 값 중 이 비율 이상이 g 범위면 그날 그 센서는 g 단위로 본다
GRAM_RANGE = (60, 60_000)  # g 범위: kg 로는 나올 수 없고(60 kg 초과) g 로는 60 kg 이하인 값


def weight_to_kg(d: pd.DataFrame) -> pd.Series:
    """측압 weight 를 kg 로. 단위는 센서·날짜마다 자동 판단한다 (GRAM_SENSORS 에 적힌 센서는 항상 g).

    협력사 센서는 kg 로 보내다가 펌웨어가 바뀌며 g 로 바뀐다 (2026-10 중순 9288·A3E0, CDB0·CDE0·640xxx 는 처음부터 g).
    kg 센서는 60 kg 을 넘지 않으므로, 그날 값의 GRAM_SHARE 이상이 60~60000 이면 g 로 본다.
    d: mac, timestamp, weight. 반환: kg (범위 밖 오류값 제거는 부르는 쪽에서)."""
    w = pd.to_numeric(d.weight, errors="coerce").astype(float)
    a = w.abs()
    in_g = ((a > GRAM_RANGE[0]) & (a <= GRAM_RANGE[1])).astype(float).where(w.notna())
    day = pd.to_datetime(d.timestamp).dt.normalize()
    share = in_g.groupby([d.mac, day]).transform("mean")
    grams = d.mac.isin(GRAM_SENSORS) | (share >= GRAM_SHARE)
    return w.where(~grams, w / 1000)


class IngestError(ValueError):
    """CSV 형식이 맞지 않을 때. 화면에 문구 그대로 보인다."""
    pass


def detect_kind(columns) -> str:
    """컬럼 이름으로 CSV 종류 판별: press가 있으면 측압, uf만 있으면 수분."""
    cols = set(columns)
    if "uf" in cols and "press" not in cols:
        return "moisture"
    if "press" in cols:
        return "pressure"
    raise IngestError("측압(press) 또는 수분(uf) 컬럼이 없는 CSV입니다.")


def _read_raw(content: bytes) -> pd.DataFrame:
    """CSV 바이트를 문자열 표로 읽는다. UTF-8(BOM 포함)로 안 읽히면 CP949(엑셀 한글 기본)로 다시 읽는다.
    빈 파일·깨진 형식·읽을 수 없는 인코딩은 IngestError (업로드 화면에 그대로 보여 준다)."""
    if not content.strip():
        raise IngestError("빈 파일입니다. 내용이 있는 CSV를 올려 주세요.")
    for enc in ("utf-8-sig", "cp949"):
        try:
            text_ = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise IngestError("파일 인코딩을 읽을 수 없습니다. UTF-8 또는 CP949(엑셀 기본) CSV로 저장해 주세요.")
    try:
        return pd.read_csv(io.StringIO(text_), dtype=str, keep_default_na=False)
    except pd.errors.EmptyDataError:
        raise IngestError("빈 파일입니다. 내용이 있는 CSV를 올려 주세요.") from None
    except pd.errors.ParserError:
        raise IngestError("CSV 형식을 읽을 수 없습니다. 따옴표·쉼표가 깨졌는지 확인해 주세요.") from None


def parse_csv(content: bytes, filename: str):
    """CSV를 읽어 DB에 넣을 표로 정리한다. 반환: (종류, 표)."""
    raw = _read_raw(content)
    kind = detect_kind(raw.columns)
    cols = PRESSURE_COLS if kind == "pressure" else MOISTURE_COLS
    # 같은 원본 행 = 같은 해시 (파일 이름과 무관)
    # → 같은 데이터를 두 번 올려도 DB의 row_hash UNIQUE 제약 때문에 한 번만 들어간다
    joined = raw.reindex(columns=cols, fill_value="").agg("|".join, axis=1)
    row_hash = [hashlib.md5(s.encode()).hexdigest() for s in joined]

    # 협력사 CSV는 빈 값을 "\0" 문자로 적는다 → 빈 값(NULL)으로
    df = raw.reindex(columns=cols).replace({"\\0": None, "": None, " ": None})
    df["mac"] = df.mac.str.strip().str.upper()
    df["timestamp"] = pd.to_datetime(df.timestamp, errors="coerce")
    for c in cols:
        if c in ("mac", "timestamp", "pressure_sn", "remark"):
            continue
        df[c] = pd.to_numeric(df[c], errors="coerce")   # 숫자가 아닌 값은 빈 값으로
        if c in INT_COLS:
            df[c] = df[c].round().astype("Int64")
    df["src_file"] = filename
    df["row_hash"] = row_hash
    df = df[df.timestamp.notna() & df.mac.notna()]       # 시각이나 MAC이 없는 행은 버림
    return kind, df


def _insert(engine: Engine, table: str, df: pd.DataFrame) -> int:
    """원본 테이블에 넣는다. INSERT IGNORE라 이미 있는 행(같은 해시)은 건너뛴다. 반환: 새로 들어간 행 수."""
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
    """측압 원본 정제: 센서 오류값을 빼고 그래프·예측에 쓸 값으로 바꾼다."""
    temps = d[["temp1", "temp2", "temp3"]].astype(float)
    d = d.assign(
        # 내부온도: −127(미연결)을 뺀 채널 1~3 평균
        temp_in=temps.where(temps > TEMP_MISSING).mean(axis=1),
        # 외기: 온도·습도가 둘 다 0이면 수신 실패로 보고 뺀다
        temp_out=d.temp.where(~((d.temp == 0) & (d.humi == 0))),
        humi=d.humi.where(~((d.temp == 0) & (d.humi == 0))),
        # 측압: g 단위(센서·날짜별 자동 판단)는 kg로 환산
        weight_kg=weight_to_kg(d),
        # 수분: rawMo가 4095(미연결)면 뺀다
        c_mo=d.c_mo.where(d.rawMo < RAWMO_MISSING),
    )
    # 60 kg 넘는 측압은 센서 오류로 보고 뺀다
    d["weight_kg"] = d.weight_kg.where(d.weight_kg.abs() <= PRESSURE_OUTLIER_KG)
    return d[["mac", "timestamp", "temp_in", "temp_out", "humi", "weight_kg", "c_mo"]]


def _aggregate_moisture(d: pd.DataFrame) -> pd.DataFrame:
    """수분 원본 정제: 외기 온도·습도가 둘 다 0이면 수신 실패로 보고 뺀다."""
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
    # 기간이 길면 메모리를 많이 쓰므로 7일씩 나눠 처리
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
            # 10분 칸마다 중앙값 (튀는 값에 덜 흔들리도록 평균 대신 중앙값)
            g = d.set_index("timestamp").resample("10min")
            agg = g.median(numeric_only=True)
            agg["n"] = g.size()
            agg = agg[agg.n > 0].reindex(columns=metrics + ["n"])
            agg = agg.reset_index().rename(columns={"timestamp": "bucket"})
            agg.insert(0, "mac", mac)
            _upsert_10min(engine, agg)
        t = t1


def _upsert_10min(engine: Engine, agg: pd.DataFrame):
    """10분 집계를 저장한다. 같은 센서·같은 10분 칸이 이미 있으면 새 값으로 바꾼다."""
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


def _store(engine: Engine, kind: str, df: pd.DataFrame, upload_id: int | None) -> dict:
    """정리된 표를 원본 테이블에 넣고, 영향받은 센서의 10분 집계를 다시 계산한다."""
    inserted = _insert(engine, kind, df.assign(upload_id=upload_id))
    # 깨진 MAC(LoRa 파싱 오류)은 집계에서 제외: 영숫자 4~12자리, 10행 이상만
    macs = df.groupby("mac").timestamp.agg(["min", "max", "size"])
    macs = macs[macs.index.str.fullmatch(MAC_RE) & (macs["size"] >= 10)]
    for mac, r in macs.iterrows():
        rebuild_10min(engine, kind, mac, r["min"], r["max"])
    return {
        "kind": kind, "rows_total": len(df), "rows_inserted": int(inserted),
        "period_start": df.timestamp.min().to_pydatetime(),
        "period_end": df.timestamp.max().to_pydatetime(),
        "sensors": sorted(macs.index.tolist()),
    }


def ingest_csv(engine: Engine, content: bytes, filename: str, upload_id: int | None = None) -> dict:
    """CSV 파일 하나를 처리한다. 원본 저장 → 센서별 10분 집계 → 결과 요약. (업로드 기록은 남기지 않음)"""
    kind, df = parse_csv(content, filename)
    if df.empty:
        raise IngestError("유효한 행(mac, timestamp)이 없습니다.")
    return _store(engine, kind, df, upload_id)


def save_upload(engine: Engine, content: bytes, filename: str) -> dict:
    """업로드 화면·초기 적재의 입구. upload_log 를 먼저 만들어 id 를 얻고, 그 id 를 원본 행에 남기며 적재한다.

    적재 중 오류가 나면 업로드 기록도 지운다. 반환: ingest_csv 결과 + upload_id.
    """
    kind, df = parse_csv(content, filename)
    if df.empty:
        raise IngestError("유효한 행(mac, timestamp)이 없습니다.")
    with SessionLocal() as s:
        log = UploadLog(filename=filename, kind=kind, rows_total=len(df), rows_inserted=0,
                        period_start=df.timestamp.min().to_pydatetime(),
                        period_end=df.timestamp.max().to_pydatetime())
        s.add(log)
        s.commit()
        try:
            r = _store(engine, kind, df, log.id)
        except Exception:
            s.delete(log)
            s.commit()
            raise
        log.rows_inserted = r["rows_inserted"]
        log.sensors = ",".join(r["sensors"])[:500]
        s.commit()
        return {**r, "upload_id": log.id}


def _span(a, b) -> tuple:
    """rebuild_10min 이 다시 계산하는 10분 칸 범위 [시작, 끝)."""
    return pd.Timestamp(a).floor("10min").to_pydatetime(), (pd.Timestamp(b).ceil("10min") + timedelta(minutes=10)).to_pydatetime()


def delete_upload(engine: Engine, upload_id: int) -> dict:
    """업로드 하나로 저장된 원본 행을 지우고, 그 센서·기간의 10분 집계를 남은 원본으로 다시 계산한다.

    원본 삭제와 업로드 기록 삭제는 한 트랜잭션. 10분 집계는 원본에서 언제든 다시 만들 수 있는
    파생 값이라 그 뒤에 다시 계산한다 (실패해도 원본은 맞는 상태, 같은 기간을 다시 올리면 복구됨).
    """
    with engine.begin() as c:
        log = c.execute(text("SELECT kind, period_start, period_end FROM upload_log WHERE id = :id FOR UPDATE"),
                        {"id": upload_id}).first()
        if log is None:
            raise LookupError("업로드 기록이 없습니다.")
        table = "pressure" if log.kind == "pressure" else "moisture"
        spans = c.execute(text(f"SELECT mac, MIN(timestamp) AS a, MAX(timestamp) AS b FROM {table} "
                               "WHERE upload_id = :id GROUP BY mac"), {"id": upload_id}).all()
        deleted = c.execute(text(f"DELETE FROM {table} WHERE upload_id = :id"), {"id": upload_id}).rowcount
        # 10분 집계가 있던 센서만 다시 계산 (집계에서 빠졌던 깨진 MAC은 그대로 둔다)
        rebuild = []
        for mac, a, b in spans:
            lo, hi = _span(a, b)
            if c.execute(text("DELETE FROM sensor_10min WHERE mac = :m AND bucket >= :a AND bucket < :b"),
                         {"m": mac, "a": lo, "b": hi}).rowcount:
                rebuild.append((mac, a, b))
        c.execute(text("DELETE FROM upload_log WHERE id = :id"), {"id": upload_id})
    for mac, a, b in rebuild:
        rebuild_10min(engine, log.kind, mac, a, b)
    return {"rows_deleted": int(deleted), "sensors": sorted(m for m, _, _ in rebuild),
            "period_start": log.period_start, "period_end": log.period_end}


def delete_sensor(engine: Engine, mac: str) -> int | None:
    """센서 하나의 측정 기록 전체(원본·10분 집계)와 화면 설정을 한 트랜잭션으로 지운다.

    반환: 지운 원본 행 수. 그 센서의 데이터가 아예 없으면 None. 업로드 기록(upload_log)은 남긴다.
    """
    with engine.begin() as c:
        p = {"m": mac}
        buckets = c.execute(text("DELETE FROM sensor_10min WHERE mac = :m"), p).rowcount
        rows = (c.execute(text("DELETE FROM pressure WHERE mac = :m"), p).rowcount
                + c.execute(text("DELETE FROM moisture WHERE mac = :m"), p).rowcount)
        meta = c.execute(text("DELETE FROM sensor_meta WHERE mac = :m"), p).rowcount
    return int(rows) if (rows or buckets or meta) else None


def link_legacy_rows(engine: Engine) -> None:
    """upload_id 가 생기기 전에 저장된 원본 행을 업로드 기록에 연결한다 (서버 시작 때, 처음 한 번만 오래 걸림).

    같은 파일 이름의 업로드 중 실제로 행을 저장한(rows_inserted > 0) 가장 이른 업로드에 연결한다.
    다시 올려 0행이었던 업로드는 연결되는 행이 없어, 지워도 업로드 기록만 지워진다.
    센서 목록이 비어 있는 업로드 기록도 원본에서 채운다.
    """
    with engine.begin() as c:
        for table in ("pressure", "moisture"):
            c.execute(text(
                f"UPDATE {table} t JOIN (SELECT filename, MIN(id) AS id FROM upload_log "
                "WHERE kind = :k AND rows_inserted > 0 GROUP BY filename) u ON t.src_file = u.filename "
                "SET t.upload_id = u.id WHERE t.upload_id IS NULL"), {"k": table})
        todo = c.execute(text("SELECT id, kind, filename FROM upload_log WHERE sensors IS NULL")).all()
        if not todo:
            return
        found: dict[tuple[str, str], list[str]] = {}
        for table in {k for _, k, _ in todo}:
            if table not in ("pressure", "moisture"):
                continue
            for f, mac, n in c.execute(text(f"SELECT src_file, mac, COUNT(*) FROM {table} "
                                            "WHERE src_file IS NOT NULL GROUP BY src_file, mac")):
                if n >= 10 and mac and re.fullmatch(MAC_RE, mac):
                    found.setdefault((table, f), []).append(mac)
        for i, kind, f in todo:
            c.execute(text("UPDATE upload_log SET sensors = :s WHERE id = :id"),
                      {"s": ",".join(sorted(found.get((kind, f), [])))[:500], "id": i})
