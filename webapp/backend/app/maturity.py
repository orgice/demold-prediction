"""콘크리트 강도 예측 (적산온도 방식).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
이 파일이 하는 일
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
거푸집 센서가 잰 콘크리트 온도를 보고 "지금 강도가 얼마인지, 언제 해체 기준
(벽체 5 MPa, 슬래브 14 MPa)에 닿는지"를 계산한다. 화면의 강도 예측 탭에 보이는
숫자와 그래프는 모두 이 파일의 predict() 함수에서 나온다.

먼저 알아 두면 좋은 말
  - MPa(메가파스칼): 콘크리트가 얼마나 단단한지 나타내는 단위. 클수록 단단하다.
  - 공시체: 타설할 때 같은 콘크리트를 작은 원통 틀에 따로 담아 둔 시험용 조각.
    정해진 날(1일, 3일, 7일 ...)에 눌러 깨뜨려 실제 강도를 잰다.
    '현장양생' 공시체는 현장에 두어 실제 구조물과 비슷한 환경에서 굳힌 것이다.
  - 회차: 타설 한 번. 회차마다 사용한 센서, 타설 시각, 공시체 결과가 있다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
예측하는 방법 (4단계)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1단계. 적산온도 계산
  콘크리트는 따뜻할수록 빨리 굳는다. 그래서 "얼마나 오래, 얼마나 따뜻하게 있었나"를
  숫자 하나로 만든다. 10분마다 (온도 − 0℃)를 계속 더해 간다. 단위는 ℃·일.
    예) 20℃로 하루 = 20 ℃·일,  10℃로 이틀 = 20 ℃·일
        → 두 경우 모두 20 ℃·일이므로 강도도 거의 같다고 본다.
  0℃ 이하에서는 콘크리트가 거의 굳지 않는다고 보고 더하지 않는다.
  (전문 용어: Nurse-Saul 적산온도, 기준온도 T0 = 0℃)

2단계. 강도 곡선 (적산온도 → 강도)
  과거 회차의 공시체 결과를 모아 "적산온도가 이만큼이면 강도는 이만큼"이라는
  곡선 하나를 그려 둔다. 곡선 모양은 처음엔 빠르게 오르다가 점점 완만해져
  어떤 최대 강도(Su)에 가까워지는 형태다. (전문 용어: 쌍곡선형 강도 곡선)
    강도 = Su × k(M − M0) / (1 + k(M − M0))
      Su = 아주 오래 지나면 다다르는 최대 강도
      k  = 강도가 오르는 빠르기
      M0 = 강도가 오르기 시작하는 적산온도 (그 전에는 0으로 본다)
  2026년 기준 곡선으로는 5 MPa에 약 28 ℃·일, 14 MPa에 약 103 ℃·일이 필요하다.

3단계. 회차 보정
  같은 적산온도라도 회차마다 강도가 조금씩 다르다 (배합, 날씨, 양생 상태 차이).
  그래서 이 회차의 공시체 결과가 나오면 곡선을 그 회차에 맞게 통째로 올리거나 내린다.
    예) 1일 공시체가 6 MPa인데 곡선은 5 MPa → 이 회차는 곡선 × 1.2 로 계산
  정확도에 가장 크게 영향을 주는 단계다. 공시체 결과는 나오는 대로 바로 입력할수록 좋다.

4단계. 앞으로의 온도 가정
  아직 오지 않은 시간의 온도는 알 수 없으므로 "직전 24시간 온도가 그대로 반복된다"고 본다.
  날씨가 갑자기 추워지거나 더워지면 이 가정이 틀려 예측이 어긋나고,
  새 온도 데이터가 들어오면 다시 계산되며 따라잡는다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
'예상' 시각과 '보수적' 시각
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  - 예상: 곡선대로 갔을 때 기준 강도에 닿는 시각.
  - 보수적: 강도가 예상보다 낮게 나오는 경우까지 생각한 늦은 쪽 시각.
    과거 회차들을 대상으로 "이 곡선이 처음 보는 회차를 얼마나 틀렸는지"를 재 두고,
    그 틀린 정도로 90% 범위를 만든다. 보수적 시각은 그 범위의 아래쪽(하한) 기준이다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
공정한 평가를 위한 규칙: 예측하는 회차는 곡선 학습에서 뺀다
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  지난 회차를 다시 볼 때도 그 회차 자신의 공시체 결과는 곡선을 그리는 데 쓰지 않는다.
  답을 미리 보고 맞히는 꼴이 되지 않도록, 늘 "처음 보는 회차"처럼 예측한다.
  (전문 용어: LOPO = Leave-One-Pour-Out, 회차 하나씩 빼고 검증)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
알려진 한계 (2026년 시험 타설 5회차로 확인)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  - 학습한 회차가 5개뿐이고 겨울 회차가 없다. 추운 날(10℃ 미만) 예측은 믿기 어렵다.
  - 더운 날 친 회차는 14 MPa 이상에서 강도가 곡선보다 덜 자라, 슬래브 해체 시각을 이르게 예측했다.
  - 센서는 구조물 내부 온도를 재는데, 공시체는 크기가 작아 그보다 온도가 낮을 수 있다.
  - 벽체 5 MPa는 10℃ 이상에서 1일 공시체 보정 후 대체로 ±5시간 안에 맞았다.
  → 이 예측은 해체 시험 일정을 잡는 참고용이다. 해체 결정은 공시체 시험으로 확인한다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
함수가 불리는 순서 (화면의 강도 예측 = predict)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  predict()
    ├ train()                곡선 그리기 (2단계)
    ├ pour_temperature()     이 회차 센서 온도 가져오기
    ├ forecast_temperature() 앞으로의 온도 가정 (4단계)
    ├ maturity()             적산온도 계산 (1단계)
    ├ scale_factor()         회차 보정 (3단계)
    ├ hyperbolic()           적산온도 → 강도
    └ first_crossing()       기준 강도에 처음 닿는 시각 찾기
"""
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit
from sqlalchemy import bindparam, text
from sqlalchemy.engine import Engine

from .config import BASELINE_HOURS, CALIBRATION_MAX_AGE_DAY, DATUM_TEMP, FIXED_CURVE, FIXED_CURVE_SIGMA, THRESHOLDS

STEP = timedelta(minutes=10)     # 계산 간격: 10분마다 한 번씩 계산 (센서 데이터도 10분 단위로 정리돼 있음)
HORIZON = timedelta(days=28)     # 타설 후 28일까지 예측 (콘크리트 강도는 보통 28일 강도를 기준으로 본다)
Z90 = 1.645                      # 90% 범위를 만들 때 쓰는 통계 상수 (그대로 두면 됨)


class PredictionError(ValueError):
    """예측할 수 없을 때 내는 오류 (타설 시각 없음, 온도 데이터 없음 등).

    여기 적은 문구가 화면에 그대로 보이므로, 사용자가 무엇을 하면 되는지 알 수 있게 쓴다.
    """


# ━━━━━━━━━━ 온도 · 적산온도 (1단계) ━━━━━━━━━━
def temperature(engine: Engine, macs: list[str], start: datetime, end: datetime) -> pd.Series:
    """센서들이 잰 온도를 10분 간격으로 가져온다.

    - 구조물 내부온도(temp_in)만 쓴다.
    - macs: 센서 이름(MAC 주소) 목록. 한 회차에 센서가 여러 개면 같은 시각 값을 평균 낸다.
    - 6시간 이내의 짧은 빈 구간(센서 일시 끊김)은 앞뒤 값을 직선으로 이어 채운다.
      그보다 긴 공백은 그대로 비워 둔다 (모르는 값을 지어내지 않기 위해).
    """
    if not macs:
        return pd.Series(dtype=float)
    q = text("SELECT bucket, temp_in FROM sensor_10min "
             "WHERE mac IN :macs AND bucket >= :a AND bucket < :b").bindparams(bindparam("macs", expanding=True))
    d = pd.read_sql(q, engine, params={"macs": macs, "a": start, "b": end})
    if d.empty:
        return pd.Series(dtype=float)
    t = d.groupby("bucket").temp_in.mean()   # 같은 10분 칸의 여러 센서 값을 평균
    t = t.reindex(pd.date_range(t.index.min(), t.index.max(), freq=STEP))   # 빠진 10분 칸도 자리를 만든다
    return t.interpolate(limit=36, limit_area="inside")  # 36칸 = 6시간 이내 공백만 직선으로 채움


def pour_temperature(engine: Engine, pour, start: datetime, end: datetime) -> pd.Series:
    """이 회차의 온도. 사용자가 '제외 구간'으로 지정한 시간은 빼고 계산한다.

    제외 구간: 설정 탭에서 지정하는 구간. 센서가 이상한 값을 낸 때나 탈형 작업 중처럼
    콘크리트 온도라고 볼 수 없는 측정값을 계산에서 빼기 위한 것. (원본 데이터는 지우지 않는다)
    뺀 자리는 앞뒤 값을 직선으로 이어 채운다.
    """
    T = temperature(engine, pour.sensor_list, start, end)
    for e in pour.exclusions:
        T[(T.index >= e.start) & (T.index < e.end)] = np.nan   # 제외 구간을 일단 빈칸으로
    if T.empty:
        return T
    filled = T.interpolate(limit_area="inside")
    # 제외 구간만 채우고, 원래부터 비어 있던 긴 공백(센서가 꺼져 있던 때)은 그대로 둔다
    for e in pour.exclusions:
        m = (T.index >= e.start) & (T.index < e.end)
        T[m] = filled[m]
    return T


def maturity(T: pd.Series) -> pd.Series:
    """적산온도: 10분마다 (온도 − 0℃)를 계속 더해 간 값. 단위 ℃·일.

    예) 20℃가 10분 이어지면 20 × (10분 ÷ 1일) ≈ 0.14 ℃·일이 더해진다.
    0℃ 이하이거나 값이 비어 있는 칸은 0을 더한다 (강도가 자라지 않는다고 본다).
    """
    return ((T - DATUM_TEMP).clip(lower=0).fillna(0) * STEP / timedelta(days=1)).cumsum()


# ━━━━━━━━━━ 강도 곡선 (2단계) ━━━━━━━━━━
def hyperbolic(m, su, k, m0):
    """강도 곡선: 적산온도(m)를 넣으면 강도(MPa)가 나온다.

    m0가 되기 전까지는 0, 그 뒤로 빠르게 오르다가 점점 완만해지며 최대 강도 su에 가까워진다.
    """
    d = np.maximum(np.asarray(m, float) - m0, 0)
    return su * k * d / (1 + k * d)


def fit_curve(x, y):
    """공시체 결과 점들에 가장 잘 맞는 곡선을 찾는다 (Su, k, M0 세 값을 정한다).

    - x: 각 공시체를 시험한 순간의 적산온도,  y: 그 공시체의 실제 강도
    - 곡선과 점들 사이의 차이가 가장 작아지는 값을 컴퓨터가 반복 계산으로 찾는다.
    - p0: 찾기 시작하는 값,  bounds: 허용 범위 (예: 최대 강도 Su는 5~80 MPa 사이)
    """
    x, y = np.asarray(x, float), np.asarray(y, float)
    p, _ = curve_fit(hyperbolic, x, y, p0=[30, 1 / np.median(x), 0.05 * np.median(x)],
                     bounds=([5, 0, 0], [80, np.inf, x.max()]), maxfev=50000)
    return p


# ━━━━━━━━━━ 회차 보정 (3단계) ━━━━━━━━━━
MIN_CAL_MPA = 2.0        # 이보다 약한 공시체는 보정에 쓰지 않음 (값이 작으면 비율이 크게 흔들리기 때문)
                         # 주의: 추운 날은 1일 공시체가 이보다 약해 보정이 빠질 수 있다 (3월 회차 사례)
SCALE_RANGE = (0.6, 1.6)  # 보정 배율은 0.6배~1.6배를 넘지 않게 자른다 (이상한 시험값 하나에 휘둘리지 않도록)
MIN_SIGMA_MPA = 3.0      # 오차를 잴 때는 예측 3 MPa 이상인 점만 쓴다 (아주 약한 구간은 비율 오차가 과장됨)


def scale_factor(params, x, y):
    """회차 보정 배율: 이 회차 공시체가 곡선보다 몇 배 강한지(또는 약한지).

    예) 공시체 6 MPa, 곡선 5 MPa → 배율 약 1.2 → 이 회차 곡선 전체를 1.2배로 올린다.
    공시체가 여러 개면 모든 점에 가장 잘 맞는 배율 하나를 고른다 (최소제곱).
    실측·예측 둘 다 2 MPa 미만인 결과는 빼고, 쓸 결과가 하나도 없으면 1.0(보정 안 함).
    """
    x, y = np.asarray(x, float), np.asarray(y, float)
    b = hyperbolic(x, *params)                       # 곡선이 말하는 강도
    ok = (y >= MIN_CAL_MPA) | (b >= MIN_CAL_MPA)     # 너무 약한 결과는 뺀다
    if not ok.any() or np.dot(b[ok], b[ok]) == 0:
        return 1.0
    return float(np.clip(np.dot(y[ok], b[ok]) / np.dot(b[ok], b[ok]), *SCALE_RANGE))


# ━━━━━━━━━━ 학습 데이터 준비 ━━━━━━━━━━
@dataclass
class PourData:
    """곡선 학습에 쓰도록 정리한 회차 하나: 온도 기록과 공시체 결과."""
    pour_id: int
    start: datetime
    T: pd.Series           # 타설 시작부터의 온도 기록 (10분 간격)
    specimens: pd.DataFrame  # 공시체 결과 표: 시험 시각, 재령(타설 후 며칠), 그때 적산온도(x), 강도(fc)


def pour_data(engine: Engine, pour) -> PourData | None:
    """회차의 현장양생 공시체마다 '시험한 순간의 적산온도(x)'와 '실제 강도(fc)'를 짝지어 학습용 점을 만든다.

    수중양생 공시체(물속에서 표준 온도로 굳힌 것)는 현장 온도와 상관없으므로 쓰지 않는다.
    온도 기록이 끝난 뒤에 시험한 공시체도 그때의 적산온도를 알 수 없어서 뺀다.
    타설 시각이나 온도 기록이 없으면 None(쓸 수 없음).
    """
    if pour.start is None:
        return None
    start = pour.start
    T = pour_temperature(engine, pour, start, start + HORIZON + timedelta(days=2))
    T = T[T.index >= start]
    if T.dropna().empty:
        return None
    M = maturity(T)
    last = T.dropna().index.max()
    rows = []
    for t in pour.tests:
        if t.curing != "field" or t.test_datetime > last:
            continue  # 수중양생이거나, 온도 기록이 끝난 뒤의 시험
        for v in t.values:   # 한 번 시험에 공시체가 보통 3개 → 3개 모두 점으로 쓴다
            rows.append({"test_id": t.id, "test_datetime": t.test_datetime,
                         "age_d": (t.test_datetime - start) / timedelta(days=1),
                         "x": float(M.asof(t.test_datetime)), "fc": v})
    return PourData(pour.id, start, T, pd.DataFrame(rows))


# 계산 결과를 잠깐 기억해 두는 곳 (같은 조건이면 곡선을 다시 그리지 않아 화면이 빨라진다).
# 회차·공시체·센서 데이터가 바뀌면 clear_cache()로 비워서 새로 계산하게 한다.
_cache: dict = {}


def clear_cache():
    """기억해 둔 계산 결과를 지운다 (데이터가 바뀌었을 때 API 쪽에서 부른다)."""
    _cache.clear()


# ━━━━━━━━━━ 곡선 학습 (2단계) + 오차 크기 재기 ━━━━━━━━━━
def train(engine: Engine, pours: list, exclude_id: int | None):
    """과거 회차들로 강도 곡선을 그리고, 그 곡선이 얼마나 틀리는지(오차 크기)도 잰다.

    - exclude_id: 학습에서 뺄 회차. 예측하려는 회차 자신을 빼서 '처음 보는 회차'처럼 예측한다.
    - 공시체가 있는 회차가 2개 미만이면 곡선을 그릴 수 없어 config.py의 고정 곡선을 쓴다.

    오차 크기(sigma, σ)를 재는 방법:
      학습 회차 중 하나를 빼고 나머지로 곡선을 그려, 뺀 회차를 얼마나 틀렸는지 본다.
      이걸 회차마다 돌아가며 반복해 '처음 보는 회차를 보통 이 정도 틀린다'는 값을 얻는다.
      - sigma_uncal: 공시체 보정 없이 곡선만 썼을 때의 오차
      - sigma_cal  : 1일 공시체로 보정한 뒤의 오차 (보통 더 작다)
      이 값으로 화면의 90% 범위와 '보수적' 시각을 만든다.
    """
    # 같은 조건(회차·타설 시각·공시체 수·센서·제외 구간)이면 기억해 둔 결과를 쓴다
    key = (exclude_id, tuple(sorted((p.id, p.start, len(p.tests), p.sensors,
                                     tuple((e.start, e.end) for e in p.exclusions))
                                    for p in pours)))
    if key in _cache:
        return _cache[key]
    data = [d for p in pours if p.id != exclude_id
            for d in [pour_data(engine, p)] if d is not None and not d.specimens.empty]
    if len(data) < 2:
        # 공시체가 있는 회차가 부족 → 미리 정해 둔 고정 곡선 사용 (회차 보정은 그대로 적용됨)
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
    params = fit_curve(allspec.x, allspec.fc)   # 모든 학습 회차의 공시체로 곡선 하나

    # 오차 크기 재기: 회차 하나씩 빼고 곡선을 그려, 뺀 회차를 얼마나 틀렸는지 모은다
    uncal, cal = [], []
    for d in data:
        tr = allspec[allspec.pour != d.pour_id]   # 학습용 (이 회차 뺌)
        te = d.specimens                          # 시험용 (뺀 회차)
        p = fit_curve(tr.x, tr.fc)
        pred = hyperbolic(te.x, *p)
        ok = pred >= MIN_SIGMA_MPA
        uncal += list(np.log(te.fc[ok] / pred[ok]))   # 오차를 '몇 배 틀렸나'로 기록 (log(실측/예측))
        early = te[te.age_d <= CALIBRATION_MAX_AGE_DAY]   # 1일 공시체 (보정용)
        late = te[te.age_d > CALIBRATION_MAX_AGE_DAY]     # 그 뒤 공시체 (채점용)
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


# ━━━━━━━━━━ 예측 ━━━━━━━━━━
def forecast_temperature(T_obs: pd.Series, until: datetime) -> pd.Series:
    """앞으로의 온도 가정 (4단계): 직전 24시간 온도를 그대로 반복해 이어 붙인다.

    직전 기록이 6시간도 안 되면 하루 패턴을 알 수 없으므로 지금까지의 평균 온도로 채운다.
    기상 예보는 쓰지 않는다. 그래서 날씨가 갑자기 바뀌면 이 부분이 틀린다.
    """
    T_obs = T_obs.dropna()
    last = T_obs.index.max()
    future = pd.date_range(last + STEP, until, freq=STEP)
    if future.empty:
        return pd.Series(dtype=float)
    recent = T_obs[T_obs.index > last - timedelta(hours=24)]
    if len(recent) < 36:  # 36칸 = 6시간 미만이면 평균으로
        return pd.Series(T_obs.mean(), index=future)
    pattern = recent.values
    return pd.Series(np.resize(pattern, len(future)), index=future)   # 24시간 패턴을 이어 붙여 늘린다


def first_crossing(series: pd.Series, thr: float):
    """값이 처음으로 thr 이상이 되는 시각. 끝까지 못 넘으면 None.

    예) 강도 기록에서 처음 5 MPa를 넘는 시각 = 벽체 해체 가능 예상 시각
    """
    hit = series[series >= thr]
    return hit.index[0] if not hit.empty else None


def observed_crossing(tests: pd.DataFrame, thr: float):
    """공시체 결과로 본 '실제' 도달 시각 (화면의 '실측 보간').

    공시체는 정해진 날에만 시험하므로 정확한 도달 순간은 모른다.
    그래서 기준을 넘기 직전 시험과 넘은 시험 사이를 직선으로 이어 추정한다.
      예) 3일 차 3.8 MPa, 7일 차 9.0 MPa → 5 MPa는 그 사이 어디쯤인지 비례로 계산
    시험 간격이 길면(3일→7일) 이 '실제' 값도 하루 이상 어긋날 수 있다.
    첫 시험에서 이미 넘었으면 언제 넘었는지 알 수 없으므로 None.
    """
    if tests.empty:
        return None
    g = tests.groupby("test_datetime").fc.mean().sort_index()   # 같은 날 공시체 3개는 평균
    above = np.where(g.values >= thr)[0]
    if len(above) == 0:
        return None
    i = above[0]
    if i == 0:
        return None  # 첫 시험에서 이미 넘음 → 정확한 시각은 알 수 없음
    t0, t1, s0, s1 = g.index[i - 1], g.index[i], g.values[i - 1], g.values[i]
    return t0 + (t1 - t0) * ((thr - s0) / (s1 - s0))


def predict(engine: Engine, pour, all_pours: list, as_of: datetime | None = None) -> dict:
    """회차 하나의 강도 예측. 화면의 강도 예측 탭에 보이는 모든 숫자와 그래프가 여기서 나온다.

    as_of(기준 시각): "이 시각에 서서 예측한다"는 뜻. 이 시각까지의 온도·공시체 결과만 쓰고,
    그 뒤는 모르는 것으로 보고 예측한다. 생략하면 마지막 데이터 시각.
      → 이미 끝난 회차를 그냥 열면 28일 공시체까지 다 넣은 '사후' 결과가 보인다.
        당시에 어떻게 예측했는지 보려면 기준 시각을 그때로 바꿔야 한다.
    """
    if pour.start is None:
        raise PredictionError("타설 시작 시각이 없습니다. 설정에서 입력하거나 자동 추정을 실행하세요.")
    # 1) 곡선: 이 회차를 뺀 다른 회차들로 그린다 (부족하면 고정 곡선)
    model = train(engine, all_pours, exclude_id=pour.id)
    params = model["params"]
    start = pour.start
    end = start + HORIZON

    # 2) 온도: 기준 시각까지는 센서 기록, 그 뒤는 직전 24시간 반복으로 가정
    T_all = pour_temperature(engine, pour, start, end + STEP)
    T_all = T_all[T_all.index >= start]
    if T_all.dropna().empty:
        raise PredictionError("타설 이후 온도 데이터가 없습니다. 센서 목록을 확인하세요.")
    data_end = T_all.dropna().index.max()
    as_of = min(pd.Timestamp(as_of) if as_of else data_end, data_end)   # 데이터 끝보다 뒤로는 못 감
    as_of = max(as_of, pd.Timestamp(start) + STEP)                       # 타설 전으로도 못 감

    T_obs = T_all[T_all.index <= as_of]
    T = pd.concat([T_obs, forecast_temperature(T_obs, end)])
    # 3) 적산온도
    M = maturity(T)

    # 4) 회차 보정: 기준 시각까지 나온 현장양생 공시체 결과로 곡선을 올리거나 내린다
    tests = []
    for t in pour.tests:
        if t.curing != "field":
            continue
        for v in t.values:
            tests.append({"test_id": t.id, "test_datetime": t.test_datetime, "fc": v,
                          "x": float(M.asof(t.test_datetime)) if t.test_datetime >= start else 0.0})
    tests = pd.DataFrame(tests, columns=["test_id", "test_datetime", "fc", "x"])
    known = tests[tests.test_datetime <= as_of]   # 기준 시각에 이미 알고 있던 결과만
    scale, sigma = 1.0, model["sigma_uncal"]
    if not known.empty:
        scale = scale_factor(params, known.x, known.fc)
        sigma = model["sigma_cal"]   # 보정했으면 오차가 더 작으므로 90% 범위도 좁아진다

    # 5) 강도와 90% 범위
    #    하한 = 강도 × e^(−1.645σ),  상한 = 강도 × e^(+1.645σ)
    #    예) σ = 0.18이면 하한은 강도의 약 74%, 상한은 약 134%
    S = pd.Series(scale * hyperbolic(M.values, *params), index=M.index)
    lower, upper = S * np.exp(-Z90 * sigma), S * np.exp(Z90 * sigma)

    # 6) 해체 기준별 도달 시각: 예상(곡선) · 보수적(90% 하한) · 실측(공시체 사이 직선 추정)
    thresholds = {"벽체 해체 (5 MPa)": THRESHOLDS["wall"], "슬래브 해체 (14 MPa)": THRESHOLDS["slab"]}
    if pour.design_strength:
        thresholds[f"설계기준강도 ({pour.design_strength:g} MPa)"] = pour.design_strength

    def hours(t):
        """타설 후 몇 시간인지."""
        return None if t is None else round((t - start) / timedelta(hours=1), 1)

    def iso(t):
        """시각을 '2026-03-16T14:14:00' 같은 문자열로 (화면에 넘기는 형식)."""
        return None if t is None else pd.Timestamp(t).isoformat()

    milestones = []
    for label, thr in thresholds.items():
        exp, cons = first_crossing(S, thr), first_crossing(lower, thr)
        obs = observed_crossing(tests, thr)
        milestones.append({
            "label": label, "threshold": thr,
            "expected": iso(exp), "expected_age_h": hours(exp),
            "conservative": iso(cons), "conservative_age_h": hours(cons),
            "observed": iso(obs), "observed_age_h": hours(obs),
            "reached_at_as_of": bool(S.asof(as_of) >= thr),
        })

    # 7) 그래프용: 10분 간격 계산값을 1시간 간격으로 줄여서 보낸다 (화면이 가벼워지도록)
    hourly = pd.DataFrame({"temp": T, "maturity": M, "strength": S, "lower": lower, "upper": upper})
    hourly = hourly.resample("1h", origin=pd.Timestamp(start)).first()
    series = [{
        "t": iso(t), "age_h": hours(t), "observed": bool(t <= as_of),
        "temp": None if np.isnan(r.temp) else round(r.temp, 2), "maturity": round(r.maturity, 2),
        "strength": round(r.strength, 2), "lower": round(r.lower, 2), "upper": round(r.upper, 2),
    } for t, r in hourly.iterrows()]

    # 8) 화면으로 보낼 결과 묶음
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
    """최초 예상: 타설 후 24시간(BASELINE_HOURS) 시점에 했을 예측을 다시 계산한다.

    처음 세운 계획과 지금 예측을 비교하기 위한 것.
    화면의 회색 점선과 '최초 예상보다 n시간 늦음/빠름' 표시에 쓰인다.
    현재 기준 시각이 아직 타설 후 24시간 전이면 비교할 게 없으므로 None.
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
