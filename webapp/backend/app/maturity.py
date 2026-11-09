"""적산온도 기반 압축강도 예측.

모델 (회차 단위 교차검증(LOPO) 결과로 선정):
  적산온도 M(t) = Σ max(T − T0, 0)·Δt   (Nurse-Saul, T0 = 0℃, 단위 ℃·일)
  강도      S(M) = Su·k(M−M0) / (1 + k(M−M0))   (쌍곡선형)
  회차 보정  그 회차 현장양생 공시체 결과가 있으면 S × s (s는 최소제곱 배율)

- 학습: 예측 대상 회차를 뺀 나머지 회차의 현장양생 공시체 (과거 회차도 정직하게 평가)
- 미래 온도: 기준 시각 직전 24시간 패턴을 반복한다고 가정
- 신뢰구간: 학습 회차들끼리 한 회차씩 빼고 맞춘 오차(로그 비율)의 표준편차로 ±1.645σ (90%)

쉽게 말하면:
  1. 적산온도 = 콘크리트가 '얼마나 오래, 얼마나 따뜻하게' 있었는지를 하나의 숫자로 만든 것.
     예) 20℃로 하루 = 20 ℃·일, 10℃로 이틀 = 20 ℃·일 → 둘의 강도는 거의 같다고 본다.
  2. 강도 곡선 = "적산온도가 이만큼이면 강도는 이만큼" 이라는 관계. 공시체 시험 결과로 맞춘다.
  3. 회차 보정 = 이 회차의 공시체 결과가 곡선보다 높거나 낮으면 곡선 전체를 그 비율만큼 올리거나 내린다.

함수 흐름 (화면의 강도 예측 = predict):
  predict() → train()(곡선 맞추기) → temperature()(온도) → forecast_temperature()(미래 온도)
            → maturity()(적산온도) → scale_factor()(회차 보정) → hyperbolic()(강도) → 해체 시각 계산
"""
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit
from sqlalchemy import bindparam, text
from sqlalchemy.engine import Engine

from .config import BASELINE_HOURS, CALIBRATION_MAX_AGE_DAY, DATUM_TEMP, FIXED_CURVE, FIXED_CURVE_SIGMA, THRESHOLDS

STEP = timedelta(minutes=10)     # 계산 간격 (센서 10분 집계와 같게)
HORIZON = timedelta(days=28)     # 타설 후 28일까지 예측
Z90 = 1.645                      # 정규분포에서 90% 범위를 만드는 배수


class PredictionError(ValueError):
    """예측할 수 없을 때 (타설 시각 없음, 온도 데이터 없음 등). 화면에 문구 그대로 보인다."""
    pass


# ---------- 온도 · 적산온도 ----------
def temperature(engine: Engine, macs: list[str], start: datetime, end: datetime) -> pd.Series:
    """센서들의 내부온도 평균 (10분). 내부온도가 없으면 외기온도."""
    if not macs:
        return pd.Series(dtype=float)
    q = text("SELECT mac, bucket, temp_in, temp_out FROM sensor_10min "
             "WHERE mac IN :macs AND bucket >= :a AND bucket < :b").bindparams(bindparam("macs", expanding=True))
    d = pd.read_sql(q, engine, params={"macs": macs, "a": start, "b": end})
    if d.empty:
        return pd.Series(dtype=float)
    g = d.groupby("bucket")[["temp_in", "temp_out"]].mean()   # 같은 10분 칸의 여러 센서를 평균
    t = g.temp_in.fillna(g.temp_out)
    t = t.reindex(pd.date_range(t.index.min(), t.index.max(), freq=STEP))
    return t.interpolate(limit=36, limit_area="inside")  # 6시간 이내 공백만 보간


def maturity(T: pd.Series) -> pd.Series:
    """적산온도: 10분마다 (온도 − 0℃)를 더해 간다. 0℃ 이하와 빈 값은 0으로. 단위 ℃·일."""
    return ((T - DATUM_TEMP).clip(lower=0).fillna(0) * STEP / timedelta(days=1)).cumsum()


def hyperbolic(m, su, k, m0):
    """강도 곡선: 적산온도 m → 강도(MPa). m0 전까지는 0, 이후 빠르게 오르다가 su에 가까워진다."""
    d = np.maximum(np.asarray(m, float) - m0, 0)
    return su * k * d / (1 + k * d)


def fit_curve(x, y):
    """공시체 점들(x = 적산온도, y = 강도)에 가장 잘 맞는 Su, k, M0를 찾는다.

    p0 = 찾기 시작하는 값, bounds = 허용 범위 (Su 5~80 MPa 등).
    """
    x, y = np.asarray(x, float), np.asarray(y, float)
    p, _ = curve_fit(hyperbolic, x, y, p0=[30, 1 / np.median(x), 0.05 * np.median(x)],
                     bounds=([5, 0, 0], [80, np.inf, x.max()]), maxfev=50000)
    return p


MIN_CAL_MPA = 2.0        # 이보다 약한 공시체는 비율이 불안정해 보정에 쓰지 않음
SCALE_RANGE = (0.6, 1.6)  # 보정 배율은 이 범위를 넘지 않게 자른다
MIN_SIGMA_MPA = 3.0      # 오차 추정은 예측 3 MPa 이상 구간만


def scale_factor(params, x, y):
    """회차 보정 배율 s: 이 회차 공시체(y)가 곡선 예측값(b)의 몇 배인지 (최소제곱).

    예) 공시체 6 MPa, 곡선 5 MPa → s ≈ 1.2 → 이 회차 곡선 전체를 1.2배로.
    실측·예측 둘 다 2 MPa 미만인 결과는 빼고, 쓸 결과가 없으면 1.0(보정 없음).
    """
    x, y = np.asarray(x, float), np.asarray(y, float)
    b = hyperbolic(x, *params)
    ok = (y >= MIN_CAL_MPA) | (b >= MIN_CAL_MPA)
    if not ok.any() or np.dot(b[ok], b[ok]) == 0:
        return 1.0
    return float(np.clip(np.dot(y[ok], b[ok]) / np.dot(b[ok], b[ok]), *SCALE_RANGE))


# ---------- 학습 데이터 ----------
@dataclass
class PourData:
    """학습용으로 정리한 회차 하나: 온도와 공시체 점들."""
    pour_id: int
    start: datetime
    T: pd.Series           # 타설 시작부터 관측 온도
    specimens: pd.DataFrame  # test_datetime, age_d, x, fc


def pour_data(engine: Engine, pour) -> PourData | None:
    """회차의 현장양생 공시체마다 '그 시각의 적산온도(x)'와 '강도(fc)'를 짝지어 학습 점을 만든다."""
    if pour.start is None:
        return None
    start = pour.start
    T = temperature(engine, pour.sensor_list, start, start + HORIZON + timedelta(days=2))
    T = T[T.index >= start]
    if T.dropna().empty:
        return None
    M = maturity(T)
    last = T.dropna().index.max()
    rows = []
    for t in pour.tests:
        if t.curing != "field" or t.test_datetime > last:
            continue  # 수중양생, 또는 온도 데이터가 끝난 뒤의 시험
        for v in t.values:
            rows.append({"test_id": t.id, "test_datetime": t.test_datetime,
                         "age_d": (t.test_datetime - start) / timedelta(days=1),
                         "x": float(M.asof(t.test_datetime)), "fc": v})
    return PourData(pour.id, start, T, pd.DataFrame(rows))


# 학습 결과를 기억해 두는 곳 (같은 조건이면 다시 계산하지 않음). 데이터가 바뀌면 clear_cache()로 비운다.
_cache: dict = {}


def clear_cache():
    """학습 결과 기억을 지운다 (회차·공시체·센서 데이터가 바뀔 때 호출)."""
    _cache.clear()


def train(engine: Engine, pours: list, exclude_id: int | None):
    """exclude_id를 뺀 회차로 곡선을 맞추고, 같은 회차들로 불확실성(σ)을 추정."""
    key = (exclude_id, tuple(sorted((p.id, p.start, len(p.tests)) for p in pours)))
    if key in _cache:
        return _cache[key]
    data = [d for p in pours if p.id != exclude_id
            for d in [pour_data(engine, p)] if d is not None and not d.specimens.empty]
    if len(data) < 2:
        # 공시체 회차가 부족하면 고정 곡선 사용 (회차 보정은 그대로 적용됨)
        result = {
            "params": np.array([FIXED_CURVE["Su"], FIXED_CURVE["k"], FIXED_CURVE["M0"]]),
            "sigma_uncal": FIXED_CURVE_SIGMA,
            "sigma_cal": FIXED_CURVE_SIGMA,
            "n_pours": 0,
            "n_specimens": 0,
            "pour_ids": [],
            "fixed": True,
        }
        _cache[key] = result
        return result
    allspec = pd.concat([d.specimens.assign(pour=d.pour_id) for d in data])
    params = fit_curve(allspec.x, allspec.fc)

    # 학습 회차 내부 LOPO로 오차 추정: 보정 전 / 1일 공시체 보정 후
    # LOPO(Leave-One-Pour-Out) = 한 회차를 빼고 나머지로 곡선을 맞춘 뒤, 뺀 회차를 얼마나 맞히는지 본다.
    # 이렇게 하면 '처음 보는 회차'에 대한 실제 오차를 알 수 있다.
    uncal, cal = [], []
    for d in data:
        tr = allspec[allspec.pour != d.pour_id]
        te = d.specimens
        p = fit_curve(tr.x, tr.fc)
        pred = hyperbolic(te.x, *p)
        ok = pred >= MIN_SIGMA_MPA
        uncal += list(np.log(te.fc[ok] / pred[ok]))   # 오차를 '비율'로 (log(실측/예측))
        early = te[te.age_d <= CALIBRATION_MAX_AGE_DAY]
        late = te[te.age_d > CALIBRATION_MAX_AGE_DAY]
        if not early.empty and not late.empty:
            # 1일 공시체로 보정했다면 그 뒤 시험들을 얼마나 맞혔을지
            s = scale_factor(p, early.x, early.fc)
            pl = s * hyperbolic(late.x, *p)
            ok = pl >= MIN_SIGMA_MPA
            cal += list(np.log(late.fc[ok] / pl[ok]))
    result = {
        "params": params,
        "sigma_uncal": float(np.std(uncal)) if uncal else 0.3,
        "sigma_cal": float(np.std(cal)) if cal else float(np.std(uncal) if uncal else 0.3),
        "n_pours": len(data),
        "n_specimens": len(allspec),
        "pour_ids": [d.pour_id for d in data],
        "fixed": False,
    }
    _cache[key] = result
    return result


# ---------- 예측 ----------
def forecast_temperature(T_obs: pd.Series, until: datetime) -> pd.Series:
    """관측 이후 온도: 직전 24시간 패턴 반복."""
    T_obs = T_obs.dropna()
    last = T_obs.index.max()
    future = pd.date_range(last + STEP, until, freq=STEP)
    if future.empty:
        return pd.Series(dtype=float)
    recent = T_obs[T_obs.index > last - timedelta(hours=24)]
    if len(recent) < 36:  # 6시간 미만이면 평균으로
        return pd.Series(T_obs.mean(), index=future)
    pattern = recent.values
    return pd.Series(np.resize(pattern, len(future)), index=future)   # 패턴을 이어 붙여 늘린다


def first_crossing(series: pd.Series, thr: float):
    """값이 처음으로 thr 이상이 되는 시각 (없으면 None). 예: 강도가 처음 5 MPa를 넘는 시각."""
    hit = series[series >= thr]
    return hit.index[0] if not hit.empty else None


def observed_crossing(tests: pd.DataFrame, start: datetime, thr: float):
    """공시체 평균을 시험 시점 사이에서 선형 보간한 실측 도달 시각."""
    if tests.empty:
        return None
    g = tests.groupby("test_datetime").fc.mean().sort_index()
    above = np.where(g.values >= thr)[0]
    if len(above) == 0:
        return None
    i = above[0]
    if i == 0:
        return None  # 첫 시험에서 이미 넘음 → 정확한 시각은 알 수 없음
    t0, t1, s0, s1 = g.index[i - 1], g.index[i], g.values[i - 1], g.values[i]
    return t0 + (t1 - t0) * ((thr - s0) / (s1 - s0))


def predict(engine: Engine, pour, all_pours: list, as_of: datetime | None = None) -> dict:
    """회차 하나의 강도 예측. 강도 예측 탭의 모든 숫자와 그래프가 여기서 나온다.

    as_of(기준 시각): 이 시각까지의 데이터만 쓰고 그 뒤는 예측한다. 생략하면 마지막 데이터 시각.
    """
    if pour.start is None:
        raise PredictionError("타설 시작 시각이 없습니다. 설정에서 입력하거나 자동 추정을 실행하세요.")
    # 1) 곡선: 이 회차를 뺀 다른 회차들로 학습 (부족하면 고정 곡선)
    model = train(engine, all_pours, exclude_id=pour.id)
    params = model["params"]
    start = pour.start
    end = start + HORIZON

    # 2) 온도: 타설 시작부터 관측값, 기준 시각 이후는 가정한 미래 온도
    T_all = temperature(engine, pour.sensor_list, start, end + STEP)
    T_all = T_all[T_all.index >= start]
    if T_all.dropna().empty:
        raise PredictionError("타설 이후 온도 데이터가 없습니다. 센서 목록을 확인하세요.")
    data_end = T_all.dropna().index.max()
    as_of = min(pd.Timestamp(as_of) if as_of else data_end, data_end)
    as_of = max(as_of, pd.Timestamp(start) + STEP)

    T_obs = T_all[T_all.index <= as_of]
    T = pd.concat([T_obs, forecast_temperature(T_obs, end)])
    # 3) 적산온도
    M = maturity(T)

    # 4) 공시체: 기준 시각까지 나온 현장양생 결과로 보정
    tests = []
    for t in pour.tests:
        if t.curing != "field":
            continue
        for v in t.values:
            tests.append({"test_id": t.id, "test_datetime": t.test_datetime, "fc": v,
                          "x": float(M.asof(t.test_datetime)) if t.test_datetime >= start else 0.0})
    tests = pd.DataFrame(tests, columns=["test_id", "test_datetime", "fc", "x"])
    known = tests[tests.test_datetime <= as_of]
    scale, sigma = 1.0, model["sigma_uncal"]
    if not known.empty:
        scale = scale_factor(params, known.x, known.fc)
        sigma = model["sigma_cal"]   # 보정했으면 오차 폭이 더 좁은 값을 쓴다

    # 5) 강도와 90% 범위 (하한 = 강도 × e^(−1.645σ), 상한 = 강도 × e^(+1.645σ))
    S = pd.Series(scale * hyperbolic(M.values, *params), index=M.index)
    lower, upper = S * np.exp(-Z90 * sigma), S * np.exp(Z90 * sigma)

    # 6) 해체 기준별 도달 시각: 예상(곡선) · 보수적(하한) · 실측(공시체 보간)
    thresholds = {"벽체 해체 (5 MPa)": THRESHOLDS["wall"], "슬래브 해체 (14 MPa)": THRESHOLDS["slab"]}
    if pour.design_strength:
        thresholds[f"설계기준강도 ({pour.design_strength:g} MPa)"] = pour.design_strength

    def hours(t):
        """타설 후 몇 시간인지."""
        return None if t is None else round((t - start) / timedelta(hours=1), 1)

    def iso(t):
        """시각을 '2026-03-16T14:14:00' 같은 문자열로."""
        return None if t is None else pd.Timestamp(t).isoformat()

    milestones = []
    for label, thr in thresholds.items():
        exp, cons = first_crossing(S, thr), first_crossing(lower, thr)
        obs = observed_crossing(tests, start, thr)
        milestones.append({
            "label": label, "threshold": thr,
            "expected": iso(exp), "expected_age_h": hours(exp),
            "conservative": iso(cons), "conservative_age_h": hours(cons),
            "observed": iso(obs), "observed_age_h": hours(obs),
            "reached_at_as_of": bool(S.asof(as_of) >= thr),
        })

    # 7) 그래프용: 10분 계산값을 1시간 간격으로 줄인다
    hourly = pd.DataFrame({"temp": T, "maturity": M, "strength": S, "lower": lower, "upper": upper})
    hourly = hourly.resample("1h", origin=pd.Timestamp(start)).first()
    series = [{
        "t": iso(t), "age_h": hours(t), "observed": bool(t <= as_of),
        "temp": None if np.isnan(r.temp) else round(r.temp, 2), "maturity": round(r.maturity, 2),
        "strength": round(r.strength, 2), "lower": round(r.lower, 2), "upper": round(r.upper, 2),
    } for t, r in hourly.iterrows()]

    s28 = float(S.iloc[-1])
    return {
        "pour_id": pour.id,
        "start": iso(start),
        "as_of": iso(as_of),
        "data_end": iso(data_end),
        "current_strength": round(float(S.asof(as_of)), 2),
        "current_range": [round(float(lower.asof(as_of)), 2), round(float(upper.asof(as_of)), 2)],
        "strength_28d": round(s28, 2),
        "design_ratio_28d": round(s28 / pour.design_strength, 3) if pour.design_strength else None,
        "milestones": milestones,
        "series": series,
        "tests": [{"test_id": int(r.test_id), "t": iso(r.test_datetime), "age_h": hours(r.test_datetime),
                   "fc": r.fc, "used_for_calibration": bool(r.test_datetime <= as_of)}
                  for r in tests.itertuples()],
        "model": {
            "method": "Nurse-Saul 적산온도 (T0=0℃) + 쌍곡선형 강도곡선",
            "params": {"Su": round(params[0], 2), "k": round(params[1], 5), "M0": round(params[2], 2)},
            "calibrated": not known.empty,
            "calibration_scale": round(scale, 3),
            "calibration_tests": int(len(known)),
            "sigma": round(sigma, 3),
            "interval": "90%",
            "train_pours": model["pour_ids"],
            "train_specimens": model["n_specimens"],
            "fixed_curve": model["fixed"],
            "forecast": "기준 시각 이후 온도는 직전 24시간 패턴 반복으로 가정",
        },
    }


def baseline(engine: Engine, pour, all_pours: list, current: dict) -> dict | None:
    """최초 예상: 타설 후 BASELINE_HOURS 시점에 했을 예측. 현재 기준 시각이 그보다 이르면 None.

    화면의 회색 점선과 '최초 예상보다 n일 늦음' 표시에 쓰인다.
    """
    t0 = pd.Timestamp(current["start"]) + timedelta(hours=BASELINE_HOURS)
    if pd.Timestamp(current["as_of"]) <= t0:
        return None
    b = predict(engine, pour, all_pours, t0.to_pydatetime())
    return {
        "as_of": b["as_of"],
        "hours": BASELINE_HOURS,
        "series": [{"age_h": r["age_h"], "strength": r["strength"]} for r in b["series"]],
        "milestones": [{"label": m["label"], "expected": m["expected"], "expected_age_h": m["expected_age_h"]}
                       for m in b["milestones"]],
    }
