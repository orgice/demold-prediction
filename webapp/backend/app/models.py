"""DB 테이블.

pressure / moisture 테이블은 협력사 MariaDB 스키마와 컬럼명을 맞췄다.
(나중에 협력사 수집 서버가 이 DB로 바로 적재하면 실시간 연동이 된다)

테이블 한눈에 보기:
    pressure       측압 센서 원본 (CSV 그대로, 수 초 간격)
    moisture       수분 센서 원본
    sensor_10min   위 두 원본을 정제해 10분 단위로 모은 값  ← 그래프·예측은 이것만 쓴다
    pour           타설 회차 (이름, 타설 시각, 사용 센서, 설계강도)
    strength_test  공시체 압축강도 시험 결과 (회차마다 여러 건)
    upload_log     CSV 업로드 기록

각 클래스가 테이블 하나이고, `컬럼명: Mapped[파이썬 타입] = mapped_column(DB 타입)` 한 줄이 컬럼 하나다.
"""
from datetime import datetime

from sqlalchemy import (BigInteger, CHAR, DateTime, Enum, Float, ForeignKey, Index, Integer,
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
    row_hash: Mapped[str] = mapped_column(CHAR(32), unique=True)  # 같은 파일 재업로드 시 중복 방지

    # 센서+시각으로 빨리 찾기 위한 색인
    __table_args__ = (Index("ix_pressure_mac_ts", "mac", "timestamp"),)


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
    row_hash: Mapped[str] = mapped_column(CHAR(32), unique=True)

    __table_args__ = (Index("ix_moisture_mac_ts", "mac", "timestamp"),)


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
    sensors: Mapped[str] = mapped_column(String(500), default="")   # 쉼표 구분 MAC
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # 이 회차의 공시체 결과들 (회차를 지우면 같이 지워짐)
    tests: Mapped[list["StrengthTest"]] = relationship(
        back_populates="pour", cascade="all, delete-orphan", order_by="StrengthTest.test_datetime")

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
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
