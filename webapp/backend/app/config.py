import os

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "mysql+pymysql://demold:demold@localhost:3306/demold?charset=utf8mb4"
)

# 측압 weight 단위가 g인 센서. 나머지는 kg (컬럼설명: 4자리면 kg, 앞으로 g로 통일 예정)
GRAM_SENSORS = {m.strip().upper() for m in os.environ.get("GRAM_SENSORS", "").split(",") if m.strip()}

PRESSURE_OUTLIER_KG = 60      # 이 값을 넘는 측압은 센서 오류 (협력사 기준)
TEMP_MISSING = -100           # 이 값 이하 온도는 센서 미연결 (-127)
RAWMO_MISSING = 4095          # 수분센서 미연결로 추정

# 강도 기준 (KCS 14 20 12, 해체 가이드라인 표 2.1.1)
THRESHOLDS = {"wall": 5.0, "slab": 14.0}

# 적산온도 모델 (회차 단위 교차검증(LOPO) 결과 최적: Nurse-Saul T0=0℃ + 쌍곡선형)
DATUM_TEMP = 0.0
CALIBRATION_MAX_AGE_DAY = 1.6  # 이 재령 이하 공시체로 회차 보정
