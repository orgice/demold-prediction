"""측압·내부온도로 타설 시작·종료 자동 추정.

협력사 시험 타설 자료에서 본 패턴:
- 콘크리트가 센서 높이까지 차면 측압이 계단식으로 오르고, 같은 순간 내부온도가 뛰는 경우가 많다
  (굳지 않은 콘크리트가 센서에 닿음. 콘크리트가 더 차가우면 내려간다)
- 센서 높이가 다르면 콘크리트가 차오르는 순서대로 수십 분 간격을 두고 오른다
- 거푸집 설치·망치질은 센서 하나에서만 짧게 튀고 온도 변화가 없다
- 센서가 재부팅되면 온도가 −127로 찍히고 측압 영점이 다시 잡혀, 이후 값은 그 전과 이어지지 않는다

방법:
1. 센서별 1분 측압(5분 이동중앙값)이 직전 30분 최저값보다 3 kg 이상 오른 시점을 '상승' 후보로 잡는다.
   시작은 평활 전 1분 값이 '상승 직전 수준(10~20분 전 중앙값) + 1 kg'을 넘어 그대로 유지된 첫 분으로 되짚는다.
2. 30분 안에 몰린 상승들을 한 묶음으로 보고 점수를 매긴다:
   상승 폭 합 × (센서 2개 이상이 함께 오르면 2배) × (내부온도가 5분 새 1.5℃ 이상 변하면 2배)
   상승 뒤 측압이 1.5 kg 미만이면(오류값에서 0으로 돌아온 것) 상승으로 보지 않는다.
   측압 센서가 하나뿐인 회차는 '함께 오름' 조건을 따지지 않는다.
3. 점수가 가장 높은 묶음의 첫 상승이 타설 시작, 그 뒤 6시간(센서 재부팅 전까지) 안에서
   측압 합이 가장 높은 시점이 타설 종료.
재부팅(정상 온도 → −127) 전후 10분은 후보에서 뺀다. 처음부터 −127인 미연결 구간은 재부팅으로 보지 않는다.
추정값은 확인용이며, 사용자가 화면에서 확정값을 입력할 수 있다.

검증 (2026-11-09): 협력사 2026년 시험 타설 5회차에서 측압·온도로 본 시각과 0~1분 차이.
실제 작업일지 시각과는 아직 비교하지 못했다.
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from sqlalchemy import bindparam, text
from sqlalchemy.engine import Engine

from .config import GRAM_SENSORS, PRESSURE_OUTLIER_KG, TEMP_MISSING

STEP_KG = 3.0            # 이보다 작은 상승은 타설로 보지 않음
BASE_WINDOW = 30         # 분: 상승 기준이 되는 직전 최저값 구간
GROUP_MIN = 30           # 분: 이 안에 시작한 상승들은 같은 타설로 묶음
TEMP_JUMP_C = 1.5        # 5분 사이 내부온도 변화폭 (콘크리트가 센서보다 차가우면 내려간다)
MIN_LEVEL_KG = 1.5       # 상승 뒤 측압이 이 값 이상이어야 함 (오류값에서 0으로 돌아오는 것은 타설이 아님)
RESET_GUARD = 10         # 분: 센서 재부팅 전후 제외
END_SEARCH_H = 6         # 시간: 타설 종료를 찾는 범위 (시작 후)


def load_pressure_minutes(engine: Engine, macs: list[str], start: datetime, end: datetime) -> pd.DataFrame:
    """원본 측압을 kg로 환산해 1분 중앙값으로. 반환: index=분, columns=MAC. (타설 시점 확인 그래프용)"""
    if not macs:
        return pd.DataFrame()
    q = text("SELECT mac, timestamp, weight FROM pressure "
             "WHERE mac IN :macs AND timestamp >= :a AND timestamp < :b").bindparams(
        bindparam("macs", expanding=True))
    d = pd.read_sql(q, engine, params={"macs": macs, "a": start, "b": end})
    if d.empty:
        return pd.DataFrame()
    d["weight"] = pd.to_numeric(d.weight, errors="coerce")
    d["kg"] = np.where(d.mac.isin(GRAM_SENSORS), d.weight / 1000, d.weight)
    d = d[d.kg.abs() <= PRESSURE_OUTLIER_KG]
    return d.set_index("timestamp").groupby("mac").kg.resample("1min").median().unstack(0)


@dataclass
class Detection:
    """추정 결과. start/end가 None이면 타설을 찾지 못한 것. 나머지는 근거 확인용."""
    start: datetime | None
    end: datetime | None
    sensors: list[str] = field(default_factory=list)   # 함께 오른 센서
    rise_kg: float = 0.0                               # 함께 오른 센서들의 상승폭 합
    temp_jump: bool = False                            # 내부온도가 뛰었는지
    score: float = 0.0                                 # 묶음 점수 (가장 높은 묶음이 뽑힘)
    candidates: int = 0                                # 후보 묶음 수
    events: list = field(default_factory=list)          # (시작, 센서, 상승 kg)


def _minutes(raw: pd.DataFrame, gram_sensors: set[str], t0: pd.Timestamp, t1: pd.Timestamp):
    """원본 → 센서별 1분 측압(kg)·내부온도·재부팅 표시."""
    d = raw.copy()
    d["weight"] = pd.to_numeric(d.weight, errors="coerce")
    # g 단위 센서: 설정(GRAM_SENSORS)에 없더라도 값의 20% 이상이 60~15000 사이면 g로 본다
    # (kg 센서는 60 kg를 넘지 않고, 20000대 값은 센서 오류)
    w = d.weight.abs()
    share = ((w > PRESSURE_OUTLIER_KG) & (w < 15000)).groupby(d.mac).mean()
    grams = set(gram_sensors) | set(share[share >= 0.2].index)
    d["kg"] = np.where(d.mac.isin(grams), d.weight / 1000, d.weight)
    d.loc[d.kg.abs() > PRESSURE_OUTLIER_KG, "kg"] = np.nan
    temps = d[["temp1", "temp2", "temp3"]].apply(pd.to_numeric, errors="coerce")
    d["missing"] = (temps <= TEMP_MISSING).any(axis=1)
    d["tin"] = temps.where(temps > TEMP_MISSING).mean(axis=1)
    idx = pd.date_range(t0, t1, freq="1min", inclusive="left")
    g = d.set_index("timestamp").groupby("mac")
    kg = g.kg.resample("1min").median().unstack(0).reindex(idx)
    tin = g.tin.resample("1min").mean().unstack(0).reindex(idx)
    missing = g.missing.resample("1min").max().unstack(0).reindex(idx)
    # 재부팅: 정상이던 온도가 −127로 바뀌는 순간 (처음부터 미연결인 구간은 재부팅이 아님)
    ok = missing.eq(False)
    reset = (missing.eq(True) & ok.shift(1, fill_value=False)).astype(bool)
    return kg, tin, reset


def detect_from_raw(raw: pd.DataFrame, pour_date: datetime, gram_sensors: set[str] = frozenset()) -> Detection:
    """raw: mac, timestamp, weight, temp1~3 (측압 원본). pour_date의 05~23시에서 타설을 찾는다."""
    day = pd.Timestamp(pour_date).normalize()
    t0, t1 = day + timedelta(hours=5), day + timedelta(hours=23)
    if raw.empty:
        return Detection(None, None)
    kg, tin, reset = _minutes(raw, gram_sensors, t0 - timedelta(minutes=BASE_WINDOW), t1)
    macs = [m for m in kg.columns if kg[m].notna().sum() >= 30]
    if not macs:
        return Detection(None, None)

    # guard: 재부팅 전후 10분 (이 구간의 변화는 믿지 않는다)
    guard = (reset.any(axis=1).astype(int)
             .rolling(2 * RESET_GUARD + 1, center=True, min_periods=1).max().astype(bool))
    smooth = kg[macs].rolling(5, min_periods=2).median()            # 5분 이동중앙값 (튀는 값 완화)
    base = smooth.rolling(BASE_WINDOW, min_periods=5).min().shift(1)  # 직전 30분 최저값
    rise = smooth - base                                              # 최저값보다 얼마나 올랐나
    tin_s = tin.rolling(3, min_periods=1).mean()
    # tjump: 5분 사이 내부온도가 1.5℃ 이상 변한 분 (센서별 True/False)
    tjump = ((tin_s - tin_s.shift(5)).abs() >= TEMP_JUMP_C) & ~guard.to_numpy()[:, None]

    # 1. 센서별 상승 시작점
    events = []
    for m in macs:
        r = rise[m]
        hit = (r >= STEP_KG) & (r.shift(1) < STEP_KG) & ~guard   # 3 kg 선을 아래→위로 넘은 분
        for t in r.index[hit.fillna(False).to_numpy()]:
            if t < t0:
                continue
            # 시작점: 평활 전 1분 값이 '상승 직전 수준(10~20분 전 중앙값) + 1 kg'을 넘어 그대로 유지된 첫 분
            # (5분 중앙값은 1~2분 늦고, 직전 30분 최저값 기준은 천천히 흐르는 값에 끌려 이르게 잡힌다)
            before = kg[m][t - timedelta(minutes=20):t - timedelta(minutes=10)].median()
            look = kg[m][t - timedelta(minutes=15):t]
            if pd.isna(before):
                onset = t
            else:
                below = look[~(look >= before + 1.0)]
                onset = below.index[-1] + timedelta(minutes=1) if not below.empty else look.index[0]
            win = slice(t, t + timedelta(minutes=30))
            ok = ~guard[r[win].index]
            # 상승 직후 10분의 측압 수준 (나중의 다른 상승이 섞이지 않게)
            level = smooth[m][t:t + timedelta(minutes=10)].median()
            if not level >= MIN_LEVEL_KG:
                continue
            events.append((onset, m, float(r[win][ok].max())))
    if not events:
        return Detection(None, None)

    # 2. 묶음별 점수: 시간순으로 놓고, 첫 상승에서 30분 안에 시작한 상승끼리 한 묶음
    events.sort()
    groups, cur = [], [events[0]]
    for e in events[1:]:
        if e[0] - cur[0][0] <= timedelta(minutes=GROUP_MIN):
            cur.append(e)
        else:
            groups.append(cur)
            cur = [e]
    groups.append(cur)

    best = None
    for grp in groups:
        per_mac = {}
        for _, m, mag in grp:
            per_mac[m] = max(per_mac.get(m, 0), mag)
        first, last = grp[0][0], grp[-1][0]
        win = tjump.loc[first - timedelta(minutes=15):last + timedelta(minutes=30)]
        temp = bool(win.to_numpy().any())
        together = len(per_mac) >= 2 or len(macs) == 1
        score = sum(per_mac.values()) * (2 if together else 1) * (2 if temp else 1)
        if best is None or score > best.score:
            best = Detection(first.to_pydatetime(), None, sorted(per_mac), round(sum(per_mac.values()), 1),
                             temp, round(score, 1), len(groups),
                             [(e[0].strftime("%H:%M"), e[1], round(e[2], 1)) for e in grp])
    if best.rise_kg < STEP_KG:
        return Detection(None, None)

    # 3. 종료: 시작 후 6시간(재부팅 전까지) 안에서 측압 합 최고점
    s = pd.Timestamp(best.start)
    span = smooth.loc[s:s + timedelta(hours=END_SEARCH_H), best.sensors]
    resets = reset.loc[span.index].any(axis=1)
    if resets.any():
        span = span.loc[:resets.idxmax() - timedelta(minutes=1)]
    total = (span - base.loc[s, best.sensors]).sum(axis=1, min_count=1)
    best.end = total.idxmax().to_pydatetime() if total.notna().any() else best.start
    return best


def detect_pour(engine: Engine, pour_date: datetime, macs: list[str]) -> tuple[datetime | None, datetime | None]:
    """DB에서 타설일의 측압 원본을 읽어 추정한다. 반환: (시작, 종료). 못 찾으면 (None, None)."""
    if not macs:
        return None, None
    day = pd.Timestamp(pour_date).normalize()
    q = text("SELECT mac, timestamp, weight, temp1, temp2, temp3 FROM pressure "
             "WHERE mac IN :macs AND timestamp >= :a AND timestamp < :b").bindparams(
        bindparam("macs", expanding=True))
    raw = pd.read_sql(q, engine, params={"macs": macs, "a": day + timedelta(hours=4),
                                         "b": day + timedelta(hours=23)})
    r = detect_from_raw(raw, day, GRAM_SENSORS)
    return r.start, r.end
