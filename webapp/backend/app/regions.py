"""현장 위치(시·군·구) 목록. 회차 설정에서 고르면 그 위치의 기상청 예보·평년 기온을 쓴다 (weather.py).

regions.json 한 줄 = 시·군·구 하나:
  code          행정구역코드 (회차에 저장하는 값)
  name          화면에 보일 이름 (예: 서울특별시 종로구)
  nx, ny        기상청 단기예보 격자
  station       평년 기온에 쓸 가장 가까운 ASOS 관측소 번호, station_name 그 이름, km 거리

만든 방법 (다시 만들 때):
  - 시·군·구·격자·위경도: 공공데이터포털 '기상청_단기예보 조회서비스' 활용가이드 첨부 엑셀 (2026-10 판)
  - 관측소 위치: ASOS 시간자료 활용가이드의 관측소 이름을 같은 엑셀의 지역 위경도에 맞춤 (시내 중심 기준이라 수 km 오차)
  - 관측소마다 2021년·2026년 시간자료가 나오는 것을 확인한 95곳 중 가장 가까운 곳 (최대 26 km)
"""
import json
from pathlib import Path

from .config import CLIMATE_STATION, FORECAST_NX, FORECAST_NY

REGIONS: list[dict] = json.loads((Path(__file__).parent / "regions.json").read_text(encoding="utf-8"))
BY_CODE = {r["code"]: r for r in REGIONS}


def location(region_code: str | None) -> tuple[int | None, int | None, int | None]:
    """회차의 현장 위치 → (예보 격자 nx, ny, 평년 관측소). 위치를 안 고른 회차는 .env 의 기본값 (없으면 None)."""
    r = BY_CODE.get(region_code or "")
    if r:
        return r["nx"], r["ny"], r["station"]
    return FORECAST_NX, FORECAST_NY, CLIMATE_STATION
