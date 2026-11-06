import os

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "mysql+pymysql://demold:demold@localhost:3306/demold?charset=utf8mb4"
)

# 측압 weight 단위가 g인 센서. 나머지는 kg (컬럼설명: 4자리면 kg, 앞으로 g로 통일 예정)
GRAM_SENSORS = {m.strip().upper() for m in os.environ.get("GRAM_SENSORS", "").split(",") if m.strip()}

# 화면의 센서 목록에서 숨기는 센서 MAC (쉼표 구분, 데이터는 DB에 남김). 예: 본 실험과 무관한 예비시험 장치
HIDDEN_SENSORS = {m.strip().upper() for m in os.environ.get("HIDDEN_SENSORS", "").split(",") if m.strip()}

PRESSURE_OUTLIER_KG = 60      # 이 값을 넘는 측압은 센서 오류 (협력사 기준)
TEMP_MISSING = -100           # 이 값 이하 온도는 센서 미연결 (-127)
RAWMO_MISSING = 4095          # 수분센서 미연결로 추정

# 강도 기준 (KCS 14 20 12, 해체 가이드라인 표 2.1.1)
THRESHOLDS = {"wall": 5.0, "slab": 14.0}

# 적산온도 모델 (회차 단위 교차검증(LOPO) 결과 최적: Nurse-Saul T0=0℃ + 쌍곡선형)
DATUM_TEMP = 0.0
CALIBRATION_MAX_AGE_DAY = 1.6  # 이 재령 이하 공시체로 회차 보정

# 학습할 공시체 회차가 2개 미만일 때 쓰는 고정 강도곡선 S = Su·k(M−M0)/(1+k(M−M0))
FIXED_CURVE = {"Su": 24.8, "k": 0.01369, "M0": 11.48}   # MPa, 1/(℃·일), ℃·일
FIXED_CURVE_SIGMA = 0.3       # 고정 곡선의 로그 오차 (교차검증 불가 → 기본값)

# "최초 예상" 기준선: 타설 후 이 시간까지의 데이터로 했던 예측을 계획으로 보고 현재 예측과 비교
BASELINE_HOURS = 24
