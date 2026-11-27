"""기상청 단기예보·평년 기온 (앞으로의 콘크리트 온도를 가정하는 데 쓴다, maturity.forecast_temperature).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
하는 일
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
위치: 회차 설정의 '현장 위치'(시·군·구, regions.py)마다 따로 받는다. 위치를 안 고른 회차는 .env 의 기본 위치
(FORECAST_NX·FORECAST_NY·CLIMATE_STATION). 진행 중인 회차(타설 후 ACTIVE_DAYS 일 이내)의 위치만 받는다.

1. 단기예보: FORECAST_INTERVAL_MIN 분마다 위치마다(격자 nx, ny) 최신 예보를 받아
   weather_forecast 표에 쌓는다. 예보는 하루 8번(02·05·…·23시) 나오고 약 4일 뒤까지 1시간 단위 기온을 준다.
   지우지 않고 쌓아 두므로, 지난 기준 시각(최초 예상 등)의 예측도 '그때 알던 예보'로 다시 계산된다.
2. 평년 기온: 관측소의 평년 기온이 climate_normal 표에 아직 없으면, 그 ASOS 관측소의
   지난 CLIMATE_YEARS 년 시간별 기온을 받아 '같은 날·같은 시각 평균'을 만들어 둔다 (관측소마다 한 번, 몇 분 걸림).
   예보가 끝난 뒤의 기온을 채우는 데 쓴다.

설정(webapp/.env): KMA_SERVICE_KEY (없으면 꺼짐), 기본 위치 FORECAST_NX, FORECAST_NY, CLIMATE_STATION (선택).
위치도 기본 위치도 없는 회차는 예전처럼 '직전 24시간 반복'으로 가정한다.
API: 공공데이터포털 '기상청_단기예보 조회서비스', '기상청_지상(종관, ASOS) 시간자료 조회서비스'
"""
import json
import threading
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
from sqlalchemy import text

from .config import (CLIMATE_STATION, CLIMATE_YEARS, FORECAST_INTERVAL_MIN, FORECAST_MAX_AGE_H, FORECAST_NX,
                     FORECAST_NY, KMA_SERVICE_KEY)
from . import health, regions
from .db import engine
from .models import ClimateNormal, WeatherForecast
from .security import kst_now

FCST_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst"
ASOS_URL = "https://apis.data.go.kr/1360000/AsosHourlyInfoService/getWthrDataList"
BASE_HOURS = (2, 5, 8, 11, 14, 17, 20, 23)   # 단기예보 발표 시각
READY_MIN = 15                               # 발표 후 이만큼 지나야 API에서 받을 수 있다
BACKFILL_H = 24                              # 최근 이 시간 안의 발표분 중 빠진 것을 채워 받는다 (fetch_recent)

ACTIVE_DAYS = 30                             # 타설 후 이 기간 안의 회차 위치만 예보를 받는다 (강도 예측은 28일까지)

KMA_ON = bool(KMA_SERVICE_KEY)


def active_locations() -> tuple[set[tuple[int, int]], set[int]]:
    """예보를 받을 격자들과 평년 기온을 준비할 관측소들: .env 기본 위치 + 진행 중인 회차들의 현장 위치."""
    grids = {(FORECAST_NX, FORECAST_NY)} if FORECAST_NX and FORECAST_NY else set()
    stations = {CLIMATE_STATION} if CLIMATE_STATION else set()
    since = kst_now() - timedelta(days=ACTIVE_DAYS)
    with engine.connect() as c:
        codes = c.execute(text(
            "SELECT DISTINCT region_code FROM pour WHERE region_code IS NOT NULL "
            "AND COALESCE(pour_start, detected_start, created_at) >= :t"), {"t": since}).scalars().all()
    for code in codes:
        r = regions.BY_CODE.get(code)
        if r:
            grids.add((r["nx"], r["ny"]))
            stations.add(r["station"])
    return grids, stations


def _get(url: str, params: dict) -> dict:
    """공공데이터포털 API 호출. 정상 응답이 아니면 오류를 낸다."""
    q = urllib.parse.urlencode({"serviceKey": KMA_SERVICE_KEY, "dataType": "JSON", **params})
    with urllib.request.urlopen(f"{url}?{q}", timeout=60) as r:
        d = json.load(r)
    head = d.get("response", {}).get("header", {})
    if head.get("resultCode") != "00":
        # 키 오류 등은 response 대신 OpenAPI_ServiceResponse 로 온다
        raise RuntimeError(head.get("resultMsg") or json.dumps(d, ensure_ascii=False)[:200])
    return d["response"]["body"]


# ━━━━━━━━━━ 1. 단기예보 ━━━━━━━━━━
def latest_base(now: datetime) -> datetime:
    """지금 받을 수 있는 가장 최근 예보 발표 시각."""
    t = now - timedelta(minutes=READY_MIN)
    hours = [h for h in BASE_HOURS if h <= t.hour]
    if hours:
        return t.replace(hour=hours[-1], minute=0, second=0, microsecond=0)
    return (t - timedelta(days=1)).replace(hour=BASE_HOURS[-1], minute=0, second=0, microsecond=0)


def fetch_forecast(nx: int, ny: int, base: datetime | None = None) -> int:
    """격자 (nx, ny) 의 예보 한 번(발표 시각 base) 1시간 기온을 받아 저장한다. 이미 있으면 건너뛴다. 저장한 행 수."""
    base = base or latest_base(kst_now())
    with engine.connect() as c:
        if c.execute(text("SELECT 1 FROM weather_forecast WHERE base_time=:b AND nx=:x AND ny=:y LIMIT 1"),
                     {"b": base, "x": nx, "y": ny}).first():
            return 0
    body = _get(FCST_URL, {"base_date": base.strftime("%Y%m%d"), "base_time": base.strftime("%H%M"),
                           "nx": nx, "ny": ny, "numOfRows": 2000, "pageNo": 1})
    items = (body.get("items") or {}).get("item", [])
    rows = [{"base_time": base, "nx": nx, "ny": ny,
             "fcst_time": datetime.strptime(i["fcstDate"] + i["fcstTime"], "%Y%m%d%H%M"),
             "temp": float(i["fcstValue"])} for i in items if i["category"] == "TMP"]
    if rows:
        with engine.begin() as c:
            c.execute(WeatherForecast.__table__.insert().prefix_with("IGNORE"), rows)
    return len(rows)


def fetch_recent(nx: int, ny: int, hours: int = BACKFILL_H) -> int:
    """최근 hours 시간 안의 발표분 중 아직 없는 예보를 모두 받는다. 저장한 행 수.

    센서 데이터는 몇 시간 늦게 들어오기도 해서, 예측 기준 시각(마지막 센서 시각)이 최신 발표보다 앞설 수 있다.
    그때는 기준 시각 이전 발표분이 있어야 예보를 쓸 수 있으므로, 서버를 껐다 켜거나 받기에 실패해 빠진 발표분을 채운다.
    (기상청 API는 최근 며칠치 발표분을 다시 받을 수 있다)
    """
    base = latest_base(kst_now())
    total = 0
    while base >= kst_now() - timedelta(hours=hours):
        total += fetch_forecast(nx, ny, base)
        base = latest_base(base - timedelta(minutes=1) + timedelta(minutes=READY_MIN))   # 바로 앞 발표 시각
    return total


def forecast_at(as_of: datetime, nx: int | None, ny: int | None) -> pd.Series | None:
    """격자 (nx, ny) 에서 기준 시각 as_of 에 알 수 있었던 가장 최근 예보 (예보 대상 시각 → 기온 ℃, 1시간 간격).

    결과의 attrs["source"]: "fcst" 진짜 예보, "obs"·"normal" 관측·평년 기온으로 대신 채운 것.

    as_of 보다 늦게 나온 예보는 쓰지 않는다 (그때는 몰랐으므로). FORECAST_MAX_AGE_H 보다 오래된 예보만 있으면 None.
    """
    if not (nx and ny):
        return None
    as_of = pd.Timestamp(as_of).to_pydatetime()
    with engine.connect() as c:
        base = c.execute(text(
            "SELECT MAX(base_time) FROM weather_forecast WHERE nx=:x AND ny=:y AND base_time <= :t AND base_time >= :t0"),
            {"x": nx, "y": ny, "t": as_of - timedelta(minutes=READY_MIN),
             "t0": as_of - timedelta(hours=FORECAST_MAX_AGE_H)}).scalar()
        if base is None:
            return None
        d = pd.read_sql(text("SELECT fcst_time, temp, source FROM weather_forecast WHERE nx=:x AND ny=:y AND base_time=:b "
                             "ORDER BY fcst_time"), c, params={"x": nx, "y": ny, "b": base})
    if d.empty:
        return None
    s = d.set_index("fcst_time").temp
    s.attrs["source"] = d.source.iloc[0]   # fcst(진짜 예보) / obs·normal(나중에 관측·평년 기온으로 대신 채움)
    return s


# ━━━━━━━━━━ 2. 평년 기온 ━━━━━━━━━━
def _doy(idx: pd.DatetimeIndex) -> np.ndarray:
    """1~365 (윤년은 3월부터 하루씩 당기고, 2월 29일은 2월 28일로 본다)."""
    leap_after_feb = (idx.year % 4 == 0) & (idx.month > 2)
    feb29 = (idx.month == 2) & (idx.day == 29)
    return np.asarray(idx.dayofyear - leap_after_feb - feb29)


def build_climate(station: int) -> int:
    """관측소의 지난 CLIMATE_YEARS 년 시간별 기온으로 평년 기온 표를 만든다. 만든 행 수 (이미 있으면 0)."""
    with engine.connect() as c:
        if c.execute(text("SELECT 1 FROM climate_normal WHERE station=:s LIMIT 1"), {"s": station}).first():
            return 0
    this_year = kst_now().year
    rows = []
    for y in range(this_year - CLIMATE_YEARS, this_year):
        for m in range(1, 13):
            a = date(y, m, 1)
            b = (a + timedelta(days=32)).replace(day=1) - timedelta(days=1)
            page = 1
            while True:   # 한 달 = 744행 이하라 보통 한 쪽으로 끝난다
                body = _get(ASOS_URL, {"dataCd": "ASOS", "dateCd": "HR", "stnIds": station,
                                       "startDt": a.strftime("%Y%m%d"), "startHh": "00",
                                       "endDt": b.strftime("%Y%m%d"), "endHh": "23",
                                       "numOfRows": 999, "pageNo": page})
                items = (body.get("items") or {}).get("item", [])
                rows += [(i["tm"], float(i["ta"])) for i in items if i.get("ta") not in (None, "")]
                if page * 999 >= int(body.get("totalCount") or 0):
                    break
                page += 1
    if not rows:
        return 0
    s = pd.DataFrame(rows, columns=["tm", "ta"]).assign(tm=lambda d: pd.to_datetime(d.tm)).set_index("tm").ta
    tab = s.groupby([_doy(s.index), s.index.hour]).mean().unstack().reindex(range(1, 366))
    tab = tab.interpolate(limit_direction="both")
    # 앞뒤 7일 평균으로 고르게 편다 (연말·연초는 이어 붙여서)
    tab = pd.concat([tab.iloc[-7:], tab, tab.iloc[:7]]).rolling(15, center=True).mean().iloc[7:-7]
    out = [{"station": station, "doy": int(d), "hour": int(h), "temp": round(float(tab.at[d, h]), 2)}
           for d in tab.index for h in tab.columns]
    with engine.begin() as c:
        c.execute(ClimateNormal.__table__.insert().prefix_with("IGNORE"), out)
    _normal_cache.pop(station, None)
    return len(out)


_normal_cache: dict = {}


def normal(idx: pd.DatetimeIndex, station: int | None) -> pd.Series | None:
    """관측소 station 기준 시각들의 평년 기온 (℃). 평년 기온 표가 없으면 None."""
    if not station:
        return None
    if station not in _normal_cache:
        d = pd.read_sql(text("SELECT doy, hour, temp FROM climate_normal WHERE station=:s"), engine,
                        params={"s": station})
        if len(d) < 365 * 24:
            return None   # 아직 만드는 중이거나 실패 → 다음에 다시 읽는다
        _normal_cache[station] = d.pivot(index="doy", columns="hour", values="temp").reindex(range(1, 366)).values
    tab = _normal_cache[station]
    return pd.Series(tab[np.clip(_doy(idx) - 1, 0, 364), idx.hour], index=idx)


# ━━━━━━━━━━ 백그라운드 실행 ━━━━━━━━━━
_climate_done: set[int] = set()   # 평년 기온 표를 준비한 관측소
_run_lock = threading.Lock()       # 주기 확인과 '위치를 바꿔서 바로 받기'가 겹치지 않게


def run_once() -> None:
    """진행 중인 위치들의 평년 기온을 준비하고(관측소마다 한 번) 최근 예보를 받는다. 결과는 장애 알림(health)에 알린다."""
    with _run_lock:
        _run(_climate_done)


def refresh_soon(on_done=None) -> None:
    """회차의 현장 위치를 바꿨을 때: 다음 주기를 기다리지 않고 백그라운드에서 바로 받는다. 끝나면 on_done()."""
    if not KMA_ON:
        return

    def job():
        try:
            run_once()
        except Exception as e:
            print(f"[weather] 확인 실패: {e}", flush=True)
        if on_done:
            on_done()
    threading.Thread(target=job, name="weather-now", daemon=True).start()


def _run(climate_done: set[int]) -> None:
    grids, stations = active_locations()
    errors = []
    for st in sorted(stations - climate_done):   # 실패하면 다음 확인 때 다시. 그동안 예보 이후는 예보 마지막 하루 반복
        try:
            n = build_climate(st)
            if n:
                print(f"[weather] 평년 기온 표를 만들었습니다: 관측소 {st}, {n}행", flush=True)
            climate_done.add(st)
        except Exception as e:
            print(f"[weather] 평년 기온 만들기 실패 (관측소 {st}): {e}", flush=True)
            errors.append(f"관측소 {st}: {type(e).__name__}: {e}")
    if stations:
        health.report("climate", not errors, "; ".join(errors) or None)
    errors = []
    for nx, ny in sorted(grids):
        try:
            n = fetch_recent(nx, ny)
            if n:
                print(f"[weather] 단기예보 {n}시간치 저장 (격자 {nx},{ny})", flush=True)
        except Exception as e:
            print(f"[weather] 단기예보 받기 실패 (격자 {nx},{ny}): {e}", flush=True)
            errors.append(f"격자 {nx},{ny}: {type(e).__name__}: {e}")
    if grids:
        health.report("weather", not errors, "; ".join(errors) or None)


def _loop() -> None:
    time.sleep(15)   # 서버가 다 켜진 뒤 시작
    while True:
        try:
            run_once()
        except Exception as e:   # DB 오류 등. 다음 확인 때 다시
            print(f"[weather] 확인 실패: {e}", flush=True)
        time.sleep(FORECAST_INTERVAL_MIN * 60)


def start() -> None:
    """서버 시작 시 부른다. 기상청 키가 있으면 백그라운드에서 현장 위치별 예보를 받고 평년 기온을 준비한다."""
    if KMA_ON:
        threading.Thread(target=_loop, name="weather", daemon=True).start()
        default = f"격자 {FORECAST_NX},{FORECAST_NY}" if FORECAST_NX and FORECAST_NY else "없음"
        print(f"[weather] 기상청 연동 켜짐: 회차별 현장 위치 + 기본 위치({default})", flush=True)
    else:
        print("[weather] KMA_SERVICE_KEY 가 없어 예보를 쓰지 않습니다 "
              "(앞으로의 온도는 직전 24시간 반복으로 가정).", flush=True)
