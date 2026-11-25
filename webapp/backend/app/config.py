"""설정값 모음.

os.environ.get(...)으로 읽는 값은 webapp/.env 파일(→ docker-compose.yml)에서 바꿀 수 있다.
나머지 숫자들은 모델·데이터 정제 기준이라 코드에서 직접 바꾼다.
"""
import os

# DB 접속 주소. Docker로 띄우면 docker-compose.yml이 넣어 주고, 여기 기본값은 Docker 없이 개발할 때용.
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "mysql+pymysql://demold:demold@localhost:3306/demold?charset=utf8mb4"
)

# 측압 weight 단위가 항상 g인 센서. 적지 않아도 센서·날짜별로 자동 판단한다 (ingest.weight_to_kg)
# 자동 판단이 틀리는 센서만 적는다. 예: .env 에 GRAM_SENSORS=CDB0,CDE0
GRAM_SENSORS = {m.strip().upper() for m in os.environ.get("GRAM_SENSORS", "").split(",") if m.strip()}

# 화면의 센서 목록에서 숨기는 센서 MAC (쉼표 구분, 데이터는 DB에 남김). 예: 본 실험과 무관한 예비시험 장치
HIDDEN_SENSORS = {m.strip().upper() for m in os.environ.get("HIDDEN_SENSORS", "").split(",") if m.strip()}

# ---- 로그인 ----
# 로그인 유지 시간 (시간). 마지막으로 쓴 뒤 이만큼 아무것도 안 하면 다시 로그인해야 한다 (쓰는 동안은 자동 연장)
SESSION_HOURS = float(os.environ.get("SESSION_HOURS", "12"))
# 계속 쓰더라도 로그인 후 이 기간(일)이 지나면 다시 로그인해야 한다
SESSION_MAX_DAYS = float(os.environ.get("SESSION_MAX_DAYS", "7"))
# HTTPS로 서비스할 때 true (쿠키를 HTTPS에서만 보냄). 로컬 http://localhost 에서는 false
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
# 사용자가 한 명도 없을 때 서버가 켜지면서 만드는 첫 관리자 (비워 두면 만들지 않음 → scripts.create_admin 사용)
ADMIN_ID = os.environ.get("ADMIN_ID", "").strip()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
ADMIN_NAME = os.environ.get("ADMIN_NAME", "관리자").strip() or "관리자"
# 로컬 개발용: 권한별 시험 계정(test-admin·test-editor·test-viewer)을 만든다 (app/test_users.py). 실제 서비스에서는 끄기
SEED_TEST_USERS = os.environ.get("SEED_TEST_USERS", "false").lower() == "true"
# 다른 주소의 화면이 이 API를 부를 수 있게 허용할 주소 (쉼표 구분). 같은 주소(nginx·vite 프록시)면 필요 없다
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

# ---- 알림 메일 자동 발송 (notify.py) ----
# SMTP_HOST 를 비워 두면 자동 발송은 꺼지고 화면에서 메일 초안만 연다
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_SECURITY = os.environ.get("SMTP_SECURITY", "starttls").strip().lower()   # starttls(587) / ssl(465) / none(25)
SMTP_PORT = int(os.environ.get("SMTP_PORT", "") or {"ssl": 465, "none": 25}.get(SMTP_SECURITY, 587))
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "").strip() or SMTP_USER   # 보내는 주소 (비우면 SMTP_USER)
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "FormCast").strip()
NOTIFY_INTERVAL_MIN = float(os.environ.get("NOTIFY_INTERVAL_MIN", "10") or 10)   # 몇 분마다 알림을 확인할지
APP_URL = os.environ.get("APP_URL", "").strip() or "http://localhost:8080"   # 메일의 '자세히 보기' 링크 주소

# ---- 센서 데이터 자동 수집 (delta_sync.py, Databricks Delta Sharing) ----
# 협력사가 보낸 자격증명 파일(config.share) 위치. 파일이 없거나 비어 있으면 자동 수집은 꺼진다
# Docker 에서는 webapp/.env 의 DELTA_SHARE_FILE(내 컴퓨터 경로)을 이 위치로 읽기 전용 연결한다 (docker-compose.yml)
DELTA_SHARE_FILE = os.environ.get("DELTA_SHARE_FILE_IN_CONTAINER", "/secrets/delta.share")
# 수집할 공유 표 '공유.스키마.표=종류' (쉼표 구분). 종류: pressure(측압) / moisture(수분)
DELTA_TABLES = dict(x.strip().split("=", 1) for x in os.environ.get(
    "DELTA_TABLES",
    "formis_prod_sensor_share.bronze.lat_press_sens_data_base=pressure,"
    "formis_prod_sensor_share.bronze.moist_sens_data_base=moisture").split(",") if "=" in x)
DELTA_SYNC_INTERVAL_MIN = float(os.environ.get("DELTA_SYNC_INTERVAL_MIN", "10") or 10)   # 몇 분마다 수집할지
DELTA_UTC_OFFSET_H = 9        # 공유 표의 시각은 UTC → 현장 현지 시각(KST)으로 바꿀 때 더하는 시간
DELTA_LOOKBACK_H = 48         # 늦게 도착한 행을 받으려고 센서별 마지막 시각보다 이만큼 앞부터 다시 본다

# ---- 데이터 정제 기준 (센서 오류값 걸러내기) ----
PRESSURE_OUTLIER_KG = 60      # 이 값을 넘는 측압은 센서 오류 (협력사 기준)
TEMP_MISSING = -100           # 이 값 이하 온도는 센서 미연결 (-127)
RAWMO_MISSING = 4095          # 수분센서 미연결로 추정

# ---- 해체 기준 강도 ----
# 강도 기준 (KCS 14 20 12, 해체 가이드라인 표 2.1.1): 벽·기둥 측면 5 MPa, 슬래브 밑면 14 MPa
THRESHOLDS = {"wall": 5.0, "slab": 14.0}

# ---- 강도 예측 모델 ----
# 적산온도 모델 (회차 단위 교차검증(LOPO) 결과 최적: Nurse-Saul T0=0℃ + 쌍곡선형)
# DATUM_TEMP(T0): 이 온도 이하에서는 콘크리트 강도가 자라지 않는다고 본다
DATUM_TEMP = 0.0
CALIBRATION_MAX_AGE_DAY = 1.6  # 이 재령 이하 공시체로 회차 보정 (모델 오차 추정용)

# 학습할 공시체 회차가 2개 미만일 때 쓰는 고정 강도곡선 S = Su·k(M−M0)/(1+k(M−M0))
#   Su: 아주 오래 지났을 때 다다르는 최대 강도, k: 강도가 오르는 속도, M0: 강도가 오르기 시작하는 적산온도
FIXED_CURVE = {"Su": 24.8, "k": 0.01369, "M0": 11.48}   # MPa, 1/(℃·일), ℃·일
FIXED_CURVE_SIGMA = 0.3       # 고정 곡선의 로그 오차 (교차검증 불가 → 기본값). 90% 범위 폭을 정한다

# "최초 예상" 기준선: 타설 후 이 시간까지의 데이터로 했던 예측을 계획으로 보고 현재 예측과 비교
BASELINE_HOURS = 24

# ---- 앞으로의 온도: 기상청 예보·평년 기온 (weather.py, maturity.forecast_temperature) ----
# 공공데이터포털 인증키 (단기예보·ASOS 시간자료 활용신청 필요). 비우면 예보를 쓰지 않고 직전 24시간 반복으로 가정
KMA_SERVICE_KEY = os.environ.get("KMA_SERVICE_KEY", "").strip()
# 현장 위치: 단기예보 격자 좌표(nx, ny)와 평년 기온을 만들 가까운 ASOS 관측소 번호. 비우면 각각 쓰지 않는다
FORECAST_NX = int(os.environ.get("FORECAST_NX", "") or 0) or None
FORECAST_NY = int(os.environ.get("FORECAST_NY", "") or 0) or None
CLIMATE_STATION = int(os.environ.get("CLIMATE_STATION", "") or 0) or None
FORECAST_INTERVAL_MIN = 60    # 몇 분마다 새 예보를 확인할지 (예보는 3시간마다 나온다)
FORECAST_MAX_AGE_H = 12       # 기준 시각보다 이만큼 넘게 오래된 예보는 쓰지 않는다 (직전 24시간 반복으로 대체)
CLIMATE_YEARS = 5             # 평년 기온: 지난 몇 년의 같은 날·같은 시각 기온을 평균할지
# 콘크리트 내부온도 = 외기 + 차이. 차이는 직전 24시간 값에서 시작해 장기 차이로 줄어든다 (수화열이 식는 것)
AMBIENT_OFFSET_INF = 0.6      # 장기 차이 (℃). 2026년 회차들의 재령 3~7일 '내부 − 외기' 중앙값
AMBIENT_OFFSET_TAU_H = 24     # 차이가 줄어드는 빠르기 (시간). 이만큼 지나면 남은 차이가 약 37%로 준다
