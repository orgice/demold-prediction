"""실시간 수집 센서에서 새 타설 찾기 (대시보드 '새 타설 감지' 카드).

Delta Sharing 자동 수집(delta_sync.py)으로 센서 데이터가 실시간으로 들어오지만, 회차는 사람이 등록해야
예측·알림이 돈다. 그래서 '지금 데이터가 들어오는데 진행 중 회차에 연결되지 않은 측압 센서'에서
pour_detect 로 최근 LOOKBACK_DAYS 일의 타설을 찾아 후보로 보여 주고, 편집자가 확인해 회차로 등록한다.

후보 조건 (잡음 거르기. 2026-11 실데이터: 11/17 센서 7개 동시 상승은 통과, 센서 1개만 튄 날은 제외)
    - 센서 MIN_SENSORS 개 이상이 30분 안에 함께 오름
    - 함께 오른 센서들의 상승폭 합 MIN_RISE_KG 이상
제외: 이미 그 센서로 등록된 회차(시작이 ±SAME_POUR_H 안), 사람이 '무시'한 후보.
계산이 무거워 CACHE_SEC 동안 결과를 재사용한다 (새 데이터는 10분마다 들어온다).
"""
import threading
import time
from datetime import datetime, timedelta

import pandas as pd
from sqlalchemy import bindparam, select, text

from .config import GRAM_SENSORS
from .db import SessionLocal, engine
from .models import LiveDismissal, Pour
from .pour_detect import detect_from_raw
from .security import kst_now

LIVE_HOURS = 6          # 마지막 데이터가 이 시간 안에 있는 센서 = 실시간 수집 중
LOOKBACK_DAYS = 7       # 오늘 포함 최근 며칠에서 타설을 찾을지
ACTIVE_DAYS = 28        # 진행 중 회차 (Dashboard.tsx 의 ACTIVE_DAYS 와 같게)
MIN_SENSORS = 2
MIN_RISE_KG = 6.0
SAME_POUR_H = 12        # 같은 센서의 회차 시작이 후보와 이만큼 가까우면 이미 등록된 것으로 본다
CACHE_SEC = 300

_cache: dict = {"at": 0.0, "data": None}
_lock = threading.Lock()


def key_of(start: datetime, sensors: list[str]) -> str:
    return f"{start:%Y%m%dT%H%M}-{','.join(sorted(sensors))}"


def _start(p: Pour) -> datetime | None:
    return p.pour_start or p.detected_start


def live_sensors(now: datetime) -> list[str]:
    """지금 데이터가 들어오는 측압 센서 (10분 집계 기준)."""
    with engine.connect() as c:
        rows = c.execute(text(
            # 미래 시각 데이터(시각이 잘못 찍힌 시험 데이터)는 실시간으로 보지 않는다
            "SELECT DISTINCT s.mac FROM sensor_10min s JOIN (SELECT DISTINCT mac FROM pressure "
            "WHERE timestamp >= :a AND timestamp <= :b) p ON p.mac = s.mac WHERE s.bucket >= :a AND s.bucket <= :b"),
            {"a": now - timedelta(hours=LIVE_HOURS), "b": now + timedelta(minutes=30)})
        return sorted(m for (m,) in rows)


def _detect_days(macs: list[str], now: datetime) -> list[dict]:
    q = text("SELECT mac, timestamp, weight, temp1, temp2, temp3 FROM pressure "
             "WHERE mac IN :macs AND timestamp >= :a AND timestamp < :b").bindparams(bindparam("macs", expanding=True))
    out = []
    for i in range(LOOKBACK_DAYS):
        day = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        raw = pd.read_sql(q, engine, params={"macs": macs, "a": day + timedelta(hours=4), "b": day + timedelta(hours=23)})
        r = detect_from_raw(raw, day, GRAM_SENSORS)
        if r.start is None or len(r.sensors) < MIN_SENSORS or r.rise_kg < MIN_RISE_KG:
            continue
        out.append({"key": key_of(r.start, r.sensors), "start": r.start, "end": r.end, "sensors": r.sensors,
                    "rise_kg": r.rise_kg, "temp_jump": r.temp_jump, "score": r.score,
                    "events": [{"at": t, "mac": m, "kg": kg} for t, m, kg in r.events]})
    return out


def _compute() -> dict:
    now = kst_now()
    with SessionLocal() as s:
        pours = list(s.scalars(select(Pour)))
        dismissed = list(s.scalars(select(LiveDismissal).where(
            LiveDismissal.start >= now - timedelta(days=LOOKBACK_DAYS + 1))))
    live = live_sensors(now)
    # 진행 중 회차에 이미 연결된 센서는 그 회차가 보고 있으므로 빼고 찾는다
    busy = {m for p in pours if (st := _start(p)) and timedelta(0) <= now - st < timedelta(days=ACTIVE_DAYS)
            for m in p.sensor_list}
    free = [m for m in live if m not in busy]
    found = _detect_days(free, now) if len(free) >= MIN_SENSORS else []
    gone = {key_of(d.start, d.sensors.split(",")) for d in dismissed}

    def registered(c: dict) -> bool:
        return any((st := _start(p)) and abs(st - c["start"]) <= timedelta(hours=SAME_POUR_H)
                   and set(p.sensor_list) & set(c["sensors"]) for p in pours)

    return {"checked_at": now, "live_sensors": live, "free_sensors": free,
            "candidates": [c for c in found if c["key"] not in gone and not registered(c)]}


def candidates(fresh: bool = False) -> dict:
    """후보 목록 (CACHE_SEC 동안 재사용). fresh=True 면 다시 계산 (등록·무시 직후)."""
    with _lock:
        if fresh or _cache["data"] is None or time.time() - _cache["at"] > CACHE_SEC:
            _cache.update(data=_compute(), at=time.time())
        return _cache["data"]


def clear() -> None:
    _cache["data"] = None
