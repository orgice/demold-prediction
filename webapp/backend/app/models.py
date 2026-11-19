"""DB 테이블.

pressure / moisture 테이블은 협력사 MariaDB 스키마와 컬럼명을 맞췄다.
(나중에 협력사 수집 서버가 이 DB로 바로 적재하면 실시간 연동이 된다)

테이블 한눈에 보기:
    pressure       측압 센서 원본 (CSV 그대로, 수 초 간격)
    moisture       수분 센서 원본
    sensor_10min   위 두 원본을 정제해 10분 단위로 모은 값  ← 그래프·예측은 이것만 쓴다
    sensor_meta    센서 표시 이름·목록 숨김 (화면 설정)
    pour           타설 회차 (이름, 타설 시각, 사용 센서, 설계강도)
    strength_test  공시체 압축강도 시험 결과 (회차마다 여러 건)
    excluded_range 예측 계산에서 뺄 측정 구간 (센서 이상·탈형 작업). 원본은 그대로 둔다
    upload_log     CSV 업로드 기록
    app_user       로그인 계정 (ID, 이름, 권한, 비밀번호 해시)
    user_session   로그인 세션 (브라우저 쿠키 토큰의 해시, 만료 시각)
    login_failure  로그인 실패 기록 (잠금 판단용, 하루 지나면 지움)
    audit_log      변경 기록 (누가 언제 무엇을 바꿨는지)

각 클래스가 테이블 하나이고, `컬럼명: Mapped[파이썬 타입] = mapped_column(DB 타입)` 한 줄이 컬럼 하나다.
"""
from datetime import datetime

from sqlalchemy import (BigInteger, Boolean, CHAR, DateTime, Enum, Float, ForeignKey, Index, Integer,
                        Numeric, String, Text, func)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Pressure(Base):
    """측압 센서 원본. 거푸집에 붙은 장치가 측압·내부온도·외기·수분을 함께 보낸다."""
    __tablename__ = "pressure"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mac: Mapped[str | None] = mapped_column(String(32))                # 센서 고유번호 (예: 9288)
    press: Mapped[int | None] = mapped_column(Integer)                 # 로드셀 raw 값
    weight: Mapped[float | None] = mapped_column(Numeric(12, 2))       # 측압 (kg, 일부 센서는 g)
    temp1: Mapped[float | None] = mapped_column(Numeric(10, 2))        # 콘크리트 내부온도 채널 1~3 (−127 = 미연결)
    temp2: Mapped[float | None] = mapped_column(Numeric(10, 2))
    temp3: Mapped[float | None] = mapped_column(Numeric(10, 2))
    temp: Mapped[float | None] = mapped_column(Numeric(10, 2))         # 외기온도
    humi: Mapped[float | None] = mapped_column(Numeric(10, 2))         # 외기습도
    rawMo: Mapped[int | None] = mapped_column(Integer)                 # 내부 수분 raw (4095 = 미연결)
    c_mo: Mapped[float | None] = mapped_column(Numeric(10, 2))         # 내부 수분 환산값
    bat: Mapped[float | None] = mapped_column(Numeric(10, 1))          # 배터리 전압
    timestamp: Mapped[datetime | None] = mapped_column(DateTime)       # 측정 시각 (현장 현지 시각)
    pressure_sn: Mapped[str | None] = mapped_column(String(32))
    src_file: Mapped[str | None] = mapped_column(String(255))          # 어느 CSV에서 왔는지
    upload_id: Mapped[int | None] = mapped_column(Integer)             # 이 행을 처음 저장한 업로드 (upload_log.id)
    row_hash: Mapped[str] = mapped_column(CHAR(32), unique=True)  # 같은 파일 재업로드 시 중복 방지

    # 센서+시각으로 빨리 찾기 위한 색인, 업로드 단위 삭제용 색인
    __table_args__ = (Index("ix_pressure_mac_ts", "mac", "timestamp"), Index("ix_pressure_upload", "upload_id"))


class Moisture(Base):
    """수분 센서 원본 (콘크리트 수분·외기)."""
    __tablename__ = "moisture"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mac: Mapped[str | None] = mapped_column(String(32))
    uf: Mapped[int | None] = mapped_column(Integer)
    uf_val: Mapped[float | None] = mapped_column(Numeric(10, 2))       # 콘크리트 수분 (%)
    mo_r: Mapped[int | None] = mapped_column(Integer)
    mo_per: Mapped[float | None] = mapped_column(Numeric(10, 2))
    temp: Mapped[float | None] = mapped_column(Numeric(10, 2))
    humi: Mapped[float | None] = mapped_column(Numeric(10, 2))
    bat: Mapped[float | None] = mapped_column(Numeric(10, 1))
    timestamp: Mapped[datetime | None] = mapped_column(DateTime)
    remark: Mapped[str | None] = mapped_column(String(255))
    src_file: Mapped[str | None] = mapped_column(String(255))
    upload_id: Mapped[int | None] = mapped_column(Integer)             # 이 행을 처음 저장한 업로드 (upload_log.id)
    row_hash: Mapped[str] = mapped_column(CHAR(32), unique=True)

    __table_args__ = (Index("ix_moisture_mac_ts", "mac", "timestamp"), Index("ix_moisture_upload", "upload_id"))


class Sensor10min(Base):
    """10분 집계 (정제 후). 그래프·예측은 이 테이블을 쓴다."""
    __tablename__ = "sensor_10min"
    mac: Mapped[str] = mapped_column(String(32), primary_key=True)
    bucket: Mapped[datetime] = mapped_column(DateTime, primary_key=True)   # 10분 칸의 시작 시각
    temp_in: Mapped[float | None] = mapped_column(Float)    # 내부온도 채널 1~3 평균
    temp_out: Mapped[float | None] = mapped_column(Float)   # 외기온도
    humi: Mapped[float | None] = mapped_column(Float)
    weight_kg: Mapped[float | None] = mapped_column(Float)  # 측압 kg 환산, 중앙값
    c_mo: Mapped[float | None] = mapped_column(Float)
    uf_val: Mapped[float | None] = mapped_column(Float)     # 수분센서 (%)
    n: Mapped[int] = mapped_column(Integer)                 # 이 10분 안의 원본 행 수

    __table_args__ = (Index("ix_10min_bucket", "bucket"),)


class SensorMeta(Base):
    """센서별 화면 설정: 표시 이름, 목록에서 숨김. 측정 데이터와 회차 예측에는 영향이 없다."""
    __tablename__ = "sensor_meta"
    mac: Mapped[str] = mapped_column(String(32), primary_key=True)
    label: Mapped[str | None] = mapped_column(String(50))           # 사용자가 붙인 이름 (없으면 화면은 MAC)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")


class Pour(Base):
    """타설 회차. 한 번 콘크리트를 부은 것 = 한 회차."""
    __tablename__ = "pour"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100))
    site: Mapped[str | None] = mapped_column(String(200))
    pour_start: Mapped[datetime | None] = mapped_column(DateTime)   # 확정 타설 시작 (사용자 입력)
    pour_end: Mapped[datetime | None] = mapped_column(DateTime)     # 확정 타설 종료
    detected_start: Mapped[datetime | None] = mapped_column(DateTime)  # 측압 자동 추정
    detected_end: Mapped[datetime | None] = mapped_column(DateTime)
    design_strength: Mapped[float | None] = mapped_column(Float)    # 설계기준강도 (MPa)
    member: Mapped[str | None] = mapped_column(String(10))         # 부재 종류: wall(벽·기둥) / slab(슬래브)
    # 해체 기준 조건 (criteria.py). structure: 슬래브 구조 형식 single(단층)/multi(다층), durable: 벽 내구성 중요
    structure: Mapped[str | None] = mapped_column(String(10))
    durable: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # 해체 기준 직접 입력 (MPa)과 사유. 비어 있으면 조건으로 자동 계산
    removal_override: Mapped[float | None] = mapped_column(Float)
    removal_override_reason: Mapped[str | None] = mapped_column(String(300))
    sensors: Mapped[str] = mapped_column(String(500), default="")   # 쉼표 구분 MAC
    note: Mapped[str | None] = mapped_column(Text)
    notify_emails: Mapped[str | None] = mapped_column(String(500))  # 알림 메일 받을 주소 (쉼표 구분)
    # 보낸 알림 기록 (JSON): 마지막으로 보낸 시각, 그때의 기준별 예상 시각, 알림 키별 보낸 시각.
    # 예측이 바뀌었는지, 같은 알림을 이미 보냈는지 판단하는 데 쓴다
    notice: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # 이 회차의 공시체 결과들 (회차를 지우면 같이 지워짐)
    tests: Mapped[list["StrengthTest"]] = relationship(
        back_populates="pour", cascade="all, delete-orphan", order_by="StrengthTest.test_datetime")
    # 예측 계산에서 뺄 구간들
    exclusions: Mapped[list["ExcludedRange"]] = relationship(
        back_populates="pour", cascade="all, delete-orphan", order_by="ExcludedRange.start")

    @property
    def sensor_list(self) -> list[str]:
        """'9288,A3E0' 같은 문자열을 ['9288', 'A3E0'] 목록으로."""
        return [s.strip().upper() for s in self.sensors.split(",") if s.strip()]

    @property
    def start(self) -> datetime | None:
        """적산온도 기준점: 확정값 > 자동 추정값."""
        return self.pour_start or self.detected_start


class StrengthTest(Base):
    """공시체 압축강도 시험 1회 결과. 화면에서는 평균 하나를 s1에 저장한다."""
    __tablename__ = "strength_test"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pour_id: Mapped[int] = mapped_column(ForeignKey("pour.id", ondelete="CASCADE"))
    test_datetime: Mapped[datetime] = mapped_column(DateTime)
    nominal_age_day: Mapped[int | None] = mapped_column(Integer)    # 재령(일)
    curing: Mapped[str] = mapped_column(Enum("field", "water", name="curing"), default="field")  # 현장/수중양생
    s1: Mapped[float | None] = mapped_column(Float)
    s2: Mapped[float | None] = mapped_column(Float)
    s3: Mapped[float | None] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(String(255))

    pour: Mapped[Pour] = relationship(back_populates="tests")

    @property
    def values(self) -> list[float]:
        """입력된 강도 값들 (빈 칸 제외)."""
        return [v for v in (self.s1, self.s2, self.s3) if v is not None]

    @property
    def average(self) -> float | None:
        """강도 평균 (MPa). 값이 없으면 None."""
        v = self.values
        return round(sum(v) / len(v), 2) if v else None


class ExcludedRange(Base):
    """예측 계산에서 뺄 측정 구간. 원본 센서 데이터는 고치지 않고, 이 구간의 온도만 앞뒤 값으로 이어 계산한다."""
    __tablename__ = "excluded_range"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pour_id: Mapped[int] = mapped_column(ForeignKey("pour.id", ondelete="CASCADE"))
    start: Mapped[datetime] = mapped_column(DateTime)
    end: Mapped[datetime] = mapped_column(DateTime)
    reason: Mapped[str | None] = mapped_column(String(255))       # 예: 탈형 작업, 센서 이상

    pour: Mapped[Pour] = relationship(back_populates="exclusions")


class UploadLog(Base):
    """CSV 업로드 기록 (데이터 업로드 화면의 '업로드 기록' 표)."""
    __tablename__ = "upload_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(20))                  # pressure(측압) / moisture(수분)
    rows_total: Mapped[int] = mapped_column(Integer)
    rows_inserted: Mapped[int] = mapped_column(Integer)            # 중복을 뺀, 새로 저장된 행 수
    period_start: Mapped[datetime | None] = mapped_column(DateTime)
    period_end: Mapped[datetime | None] = mapped_column(DateTime)
    label: Mapped[str | None] = mapped_column(String(100))          # 사용자가 붙인 표시 이름 (없으면 filename)
    sensors: Mapped[str | None] = mapped_column(String(500))        # 이 CSV에 들어 있던 센서 (쉼표 구분 MAC)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AppUser(Base):
    """로그인 계정. 비밀번호는 원문 없이 해시만 저장한다 (security.py)."""
    __tablename__ = "app_user"
    login_id: Mapped[str] = mapped_column(String(32), primary_key=True)   # 로그인 ID (대소문자 구분 없이 하나만)
    name: Mapped[str] = mapped_column(String(50))
    role: Mapped[str] = mapped_column(String(10))                 # viewer(보기) / editor(편집) / admin(관리자)
    password_hash: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(default=True)            # False 면 사용 중지 (로그인 불가)
    created_at: Mapped[datetime] = mapped_column(DateTime)        # 한국 현지 시각


class UserSession(Base):
    """로그인 세션. 토큰 원문은 브라우저 쿠키에만 있고, 여기에는 sha256 해시만 둔다."""
    __tablename__ = "user_session"
    token_hash: Mapped[str] = mapped_column(CHAR(64), primary_key=True)
    login_id: Mapped[str] = mapped_column(ForeignKey("app_user.login_id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class LoginFailure(Base):
    """로그인 실패 한 번 = 한 줄. 잠금 판단(routers/auth.py)에 쓰고, 하루 지난 기록은 지운다."""
    __tablename__ = "login_failure"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime, index=True)
    login_id: Mapped[str] = mapped_column(String(64), index=True)   # 입력한 ID (소문자, 없는 ID일 수도 있음)
    ip: Mapped[str] = mapped_column(String(45), index=True)


class AuditLog(Base):
    """변경 기록: 데이터를 바꾸는 요청(등록·수정·삭제·업로드·사용자 관리)과 로그인 성공·실패를 남긴다 (audit.py)."""
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime, index=True)         # 한국 현지 시각
    login_id: Mapped[str | None] = mapped_column(String(64), index=True)   # 누가 (로그인 실패면 입력한 ID)
    ip: Mapped[str | None] = mapped_column(String(45))
    action: Mapped[str] = mapped_column(String(50))                     # 사람이 읽는 작업 이름 (예: 회차 수정)
    method: Mapped[str] = mapped_column(String(10))
    path: Mapped[str] = mapped_column(String(255))                      # 대상 (예: /api/pours/3)
    status: Mapped[int] = mapped_column(Integer)                        # 결과 (2xx 성공, 4xx 거부)
    detail: Mapped[str | None] = mapped_column(Text)                    # 보낸 내용 (비밀번호는 가림)
