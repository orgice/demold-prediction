"""설정값 모음.

os.environ.get(...)으로 읽는 값은 webapp/.env 파일(→ docker-compose.yml)에서 바꿀 수 있다.
나머지 숫자들은 모델·데이터 정제 기준이라 코드에서 직접 바꾼다.
"""
import os

# DB 접속 주소. Docker로 띄우면 docker-compose.yml이 넣어 주고, 여기 기본값은 Docker 없이 개발할 때용.
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "mysql+pymysql://demold:demold@localhost:3306/demold?charset=utf8mb4"
)

# 측압 weight 단위가 g인 센서. 나머지는 kg (컬럼설명: 4자리면 kg, 앞으로 g로 통일 예정)
# 예: .env 에 GRAM_SENSORS=CDB0,CDE0
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
