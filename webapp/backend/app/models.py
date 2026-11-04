"""DB 테이블.

pressure / moisture 테이블은 협력사 MariaDB 스키마와 컬럼명을 맞췄다.
(나중에 협력사 수집 서버가 이 DB로 바로 적재하면 실시간 연동이 된다)
"""
from datetime import datetime

from sqlalchemy import (BigInteger, CHAR, DateTime, Enum, Float, ForeignKey, Index, Integer,
                        Numeric, String, Text, func)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Pressure(Base):
    __tablename__ = "pressure"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mac: Mapped[str | None] = mapped_column(String(32))
    press: Mapped[int | None] = mapped_column(Integer)
    weight: Mapped[float | None] = mapped_column(Numeric(12, 2))
    temp1: Mapped[float | None] = mapped_column(Numeric(10, 2))
    temp2: Mapped[float | None] = mapped_column(Numeric(10, 2))
    temp3: Mapped[float | None] = mapped_column(Numeric(10, 2))
    temp: Mapped[float | None] = mapped_column(Numeric(10, 2))
    humi: Mapped[float | None] = mapped_column(Numeric(10, 2))
    rawMo: Mapped[int | None] = mapped_column(Integer)
    c_mo: Mapped[float | None] = mapped_column(Numeric(10, 2))
    bat: Mapped[float | None] = mapped_column(Numeric(10, 1))
    timestamp: Mapped[datetime | None] = mapped_column(DateTime)
    pressure_sn: Mapped[str | None] = mapped_column(String(32))
    src_file: Mapped[str | None] = mapped_column(String(255))
    row_hash: Mapped[str] = mapped_column(CHAR(32), unique=True)  # 같은 파일 재업로드 시 중복 방지

    __table_args__ = (Index("ix_pressure_mac_ts", "mac", "timestamp"),)


class Moisture(Base):
    __tablename__ = "moisture"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mac: Mapped[str | None] = mapped_column(String(32))
    uf: Mapped[int | None] = mapped_column(Integer)
    uf_val: Mapped[float | None] = mapped_column(Numeric(10, 2))
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
    bucket: Mapped[datetime] = mapped_column(DateTime, primary_key=True)
    temp_in: Mapped[float | None] = mapped_column(Float)    # 내부온도 채널 1~3 평균
    temp_out: Mapped[float | None] = mapped_column(Float)   # 외기온도
    humi: Mapped[float | None] = mapped_column(Float)
    weight_kg: Mapped[float | None] = mapped_column(Float)  # 측압 kg 환산, 중앙값
    c_mo: Mapped[float | None] = mapped_column(Float)
    uf_val: Mapped[float | None] = mapped_column(Float)     # 수분센서 (%)
    n: Mapped[int] = mapped_column(Integer)

    __table_args__ = (Index("ix_10min_bucket", "bucket"),)


class Pour(Base):
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

    tests: Mapped[list["StrengthTest"]] = relationship(
        back_populates="pour", cascade="all, delete-orphan", order_by="StrengthTest.test_datetime")

    @property
    def sensor_list(self) -> list[str]:
        return [s.strip().upper() for s in self.sensors.split(",") if s.strip()]

    @property
    def start(self) -> datetime | None:
        """적산온도 기준점: 확정값 > 자동 추정값."""
        return self.pour_start or self.detected_start


class StrengthTest(Base):
    __tablename__ = "strength_test"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pour_id: Mapped[int] = mapped_column(ForeignKey("pour.id", ondelete="CASCADE"))
    test_datetime: Mapped[datetime] = mapped_column(DateTime)
    nominal_age_day: Mapped[int | None] = mapped_column(Integer)
    curing: Mapped[str] = mapped_column(Enum("field", "water", name="curing"), default="field")
    s1: Mapped[float | None] = mapped_column(Float)
    s2: Mapped[float | None] = mapped_column(Float)
    s3: Mapped[float | None] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(String(255))

    pour: Mapped[Pour] = relationship(back_populates="tests")

    @property
    def values(self) -> list[float]:
        return [v for v in (self.s1, self.s2, self.s3) if v is not None]

    @property
    def average(self) -> float | None:
        v = self.values
        return round(sum(v) / len(v), 2) if v else None


class UploadLog(Base):
    __tablename__ = "upload_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(20))
    rows_total: Mapped[int] = mapped_column(Integer)
    rows_inserted: Mapped[int] = mapped_column(Integer)
    period_start: Mapped[datetime | None] = mapped_column(DateTime)
    period_end: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
