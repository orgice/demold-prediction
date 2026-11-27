"""받아 두지 못한 지난 예보를 ASOS 관측 기온(또는 평년 기온)으로 대신 채운다 (예: 예보 수집을 켜기 전 회차의 최초 예상).

    docker compose -p demold_public exec backend python -m scripts.backfill_obs_forecast "2026-11-18 11:00" [시간=72] [--normal]

--normal: 관측 기온 대신 평년 기온(climate_normal)으로 채운다 (source='normal'). 그러면 그 기준 시각의 예측은
  앞으로의 외기 전체를 평년 기온으로 가정한다. 그때 몰랐던 실제 날씨를 쓰지 않으므로 관측 기온보다 공정하다.

- 공공데이터포털 단기예보 API는 최근 3일치 발표분만 주므로, 그보다 오래된 시점의 예보는 받을 수 없다.
- 대신 발표 시각 이후 '시간' 만큼의 실제 관측 기온(CLIMATE_STATION 관측소)을 그 발표의 예보로 저장한다.
  표시(source='obs')를 남기므로 예측 결과의 model.forecast 에 '기상청 관측 기온(그때 예보 대신)'으로 나온다.
- 완벽한 예보를 가정하는 셈이라 실제 예보로 했을 때보다 잘 맞아 보인다. 진짜 예보가 이미 있는 발표 시각은 건드리지 않는다.
- 발표 시각은 단기예보 발표 시각(02·05·08·11·14·17·20·23시) 중 하나로 적는다.
  최초 예상에 쓰려면 '타설 후 24시간 − 15분' 이전의 가장 최근 발표 시각을 적는다.
"""
import sys
from datetime import datetime, timedelta

import pandas as pd
from sqlalchemy import text

from app.config import CLIMATE_STATION, FORECAST_NX, FORECAST_NY, KMA_SERVICE_KEY
from app.db import Base, engine
from app.models import WeatherForecast
from app.weather import ASOS_URL, BASE_HOURS, _get, normal


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit('사용법: python -m scripts.backfill_obs_forecast "YYYY-MM-DD HH:MM" [시간=72] [--normal]')
    if not (KMA_SERVICE_KEY and FORECAST_NX and FORECAST_NY and CLIMATE_STATION):
        sys.exit("webapp/.env 에 KMA_SERVICE_KEY, FORECAST_NX, FORECAST_NY, CLIMATE_STATION 이 모두 있어야 합니다.")
    args = [a for a in sys.argv[1:] if a != "--normal"]
    use_normal = "--normal" in sys.argv
    base = datetime.fromisoformat(args[0])
    hours = int(args[1]) if len(args) > 1 else 72
    if base.minute or base.hour not in BASE_HOURS:
        sys.exit(f"발표 시각은 {BASE_HOURS}시 정각 중 하나여야 합니다.")
    Base.metadata.create_all(engine)
    with engine.connect() as c:
        src = c.execute(text("SELECT MIN(source) FROM weather_forecast WHERE base_time=:b AND nx=:x AND ny=:y"),
                        {"b": base, "x": FORECAST_NX, "y": FORECAST_NY}).scalar()
    if src == "fcst":
        sys.exit("이 발표 시각에는 진짜 예보가 이미 있습니다. 건드리지 않습니다.")
    a, b = base + timedelta(hours=1), base + timedelta(hours=hours)
    if use_normal:
        idx = pd.date_range(a, b, freq="1h")
        n = normal(idx, CLIMATE_STATION)
        if n is None:
            sys.exit("평년 기온 표가 아직 없습니다 (서버를 켜면 처음 한 번 만들어집니다).")
        rows = [{"base_time": base, "fcst_time": t.to_pydatetime(), "nx": FORECAST_NX, "ny": FORECAST_NY,
                 "temp": round(float(v), 2), "source": "normal"} for t, v in n.items()]
        _save(base, rows)
        print(f"{base:%Y-%m-%d %H:%M} 발표분을 평년 기온 {len(rows)}시간치로 채웠습니다 (관측소 {CLIMATE_STATION}).")
        return
    body = _get(ASOS_URL, {"dataCd": "ASOS", "dateCd": "HR", "stnIds": CLIMATE_STATION,
                           "startDt": a.strftime("%Y%m%d"), "startHh": a.strftime("%H"),
                           "endDt": b.strftime("%Y%m%d"), "endHh": b.strftime("%H"),
                           "numOfRows": 999, "pageNo": 1})
    items = (body.get("items") or {}).get("item", [])
    rows = [{"base_time": base, "fcst_time": datetime.strptime(i["tm"], "%Y-%m-%d %H:%M"),
             "nx": FORECAST_NX, "ny": FORECAST_NY, "temp": float(i["ta"]), "source": "obs"}
            for i in items if i.get("ta") not in (None, "")]
    if not rows:
        sys.exit("관측 기온을 받지 못했습니다 (아직 지나지 않은 시각이거나 관측소 자료 없음).")
    _save(base, rows)
    print(f"{base:%Y-%m-%d %H:%M} 발표분을 관측 기온 {len(rows)}시간치로 채웠습니다 "
          f"({rows[0]['fcst_time']:%m-%d %H시} ~ {rows[-1]['fcst_time']:%m-%d %H시}, 관측소 {CLIMATE_STATION}).")


def _save(base: datetime, rows: list[dict]) -> None:
    """그 발표 시각의 대신 채운 예보(관측·평년)를 지우고 새로 넣는다. 진짜 예보는 위에서 이미 막았다."""
    with engine.begin() as c:
        c.execute(text("DELETE FROM weather_forecast WHERE base_time=:b AND nx=:x AND ny=:y AND source IN ('obs', 'normal')"),
                  {"b": base, "x": FORECAST_NX, "y": FORECAST_NY})
        c.execute(WeatherForecast.__table__.insert(), rows)


if __name__ == "__main__":
    main()
