"""측압으로 타설 시작·종료 자동 추정.

협력사 예비시험 자료의 측압 패턴 기준:
타설 중에는 측압이 층마다 계단식으로 오르고, 타설이 끝나면 최고점 이후 서서히 내려간다.
- 종료 = 당일 측압 합(기준선 대비)이 최고인 시점. 10분 이동중앙값으로 망치질 같은 짧은 튐 제거
- 시작 = 종료 전 6시간 안에서 신호가 최고점 높이의 20%를 처음 넘은 시점
추정값은 확인용이며, 사용자가 화면에서 확정값을 입력할 수 있다.
"""
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from sqlalchemy import bindparam, text
from sqlalchemy.engine import Engine

from .config import GRAM_SENSORS, PRESSURE_OUTLIER_KG


def load_pressure_minutes(engine: Engine, macs: list[str], start: datetime, end: datetime) -> pd.DataFrame:
    """원본 측압을 kg로 환산해 1분 중앙값으로. 반환: index=분, columns=MAC."""
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


def detect_pour(engine: Engine, pour_date: datetime, macs: list[str]) -> tuple[datetime | None, datetime | None]:
    day = pd.Timestamp(pour_date).normalize()
    m = load_pressure_minutes(engine, macs, day + timedelta(hours=5), day + timedelta(hours=23))
    if m.empty:
        return None, None
    smooth = m.rolling("10min", min_periods=3).median()
    base = smooth.iloc[: 60].median()                    # 당일 첫 1시간을 기준선으로
    base = base.fillna(smooth.median())
    signal = (smooth - base).clip(lower=0).sum(axis=1, min_count=1)
    signal = signal.asfreq("1min")
    if signal.dropna().empty or signal.max() < 3:        # 3kg 미만 변화는 타설로 보지 않음
        return None, None

    # 종료: 1시간 뒤에도 40% 이상 남는 최고점 (타설 후엔 서서히 빠지고, 오류 튐은 뚝 떨어진다)
    later = signal.shift(-60).rolling(21, center=True, min_periods=1).median()
    sustained = signal[(later >= 0.4 * signal) & (signal >= 3)]
    end = sustained.idxmax() if not sustained.empty else signal.idxmax()
    peak = signal[end]

    # 시작: 종료에서 거슬러 올라가며 신호가 최고점의 10% 이상 이어진 구간의 처음 (30분 이내 공백 허용)
    elevated = (signal >= 0.1 * peak).astype(float).where(signal.notna())
    elevated = elevated.ffill(limit=30).fillna(0).astype(bool)
    before = elevated[:end][::-1]
    gap = before[~before]
    start = gap.index[0] + timedelta(minutes=1) if not gap.empty else before.index[-1]
    start = max(start, end - timedelta(hours=6))
    return start.to_pydatetime(), end.to_pydatetime()
