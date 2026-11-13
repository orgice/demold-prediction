"""API로 주고받는 데이터의 모양.

pydantic이 요청이 이 모양과 맞는지 자동으로 검사한다 (틀리면 422 오류).
- ...In    : 화면 → 서버 (입력)
- ...Out   : 서버 → 화면 (응답)
- ...Patch : 일부만 고칠 때 (보낸 항목만 바뀜)
DB 테이블 정의는 models.py에 따로 있다.
"""
import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

Member = Literal["wall", "slab"]   # 부재 종류: 벽·기둥 / 슬래브
EMAIL = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")


def clean_emails(v: str | None) -> str | None:
    """'a@x.com; b@y.com' 처럼 쉼표·세미콜론·공백으로 나눈 주소를 검사하고 'a@x.com, b@y.com' 으로 정리한다."""
    if v is None:
        return None
    addrs = list(dict.fromkeys(a for a in re.split(r"[,;\s]+", v) if a))   # 순서 유지, 중복 제거
    bad = [a for a in addrs if not EMAIL.match(a)]
    if bad:
        raise ValueError(f"메일 주소 형식이 아닙니다: {', '.join(bad)}")
    if len(addrs) > 20:
        raise ValueError("알림 메일은 20개까지 등록할 수 있습니다.")
    return ", ".join(addrs) or None


Emails = Annotated[str | None, AfterValidator(clean_emails)]


class StrengthTestIn(BaseModel):
    """공시체 압축강도 시험 결과 입력."""
    test_datetime: datetime                          # 시험한 날짜·시각
    nominal_age_day: int | None = None               # 재령(일): 1일, 3일, 7일 …
    curing: Literal["field", "water"] = "field"      # 양생: 현장양생(field) / 수중양생(water)
    # 강도(MPa). 화면에서는 평균 하나만 s1에 넣는다. s2·s3는 예전에 3개씩 넣던 데이터용
    s1: float | None = Field(None, ge=0, le=200)
    s2: float | None = Field(None, ge=0, le=200)
    s3: float | None = Field(None, ge=0, le=200)
    note: str | None = None


class StrengthTestOut(StrengthTestIn):
    """공시체 결과 응답 (DB 번호와 평균이 붙음)."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    pour_id: int
    average: float | None


class PourIn(BaseModel):
    """새 타설 회차 등록."""
    name: str
    site: str | None = None                          # 현장 이름
    pour_start: datetime | None = None               # 확정된 타설 시작 (모르면 비움 → 자동 추정)
    pour_end: datetime | None = None
    design_strength: float | None = Field(None, gt=0, le=200)   # 설계기준강도(MPa), 배합표 값
    member: Member | None = None                     # 부재 종류
    sensors: list[str] = []                          # 이 회차에 쓴 센서 MAC 목록
    note: str | None = None
    notify_emails: Emails = None                     # 알림 메일 받을 주소 (쉼표 구분)


class PourPatch(BaseModel):
    """회차 정보 수정. 보낸 항목만 바뀐다."""
    name: str | None = None
    site: str | None = None
    pour_start: datetime | None = None
    pour_end: datetime | None = None
    design_strength: float | None = Field(None, gt=0, le=200)
    member: Member | None = None
    sensors: list[str] | None = None
    note: str | None = None
    notify_emails: Emails = None


class NoticeIn(BaseModel):
    """알림 메일 초안을 열었음(= 보냄)을 기록. key 는 알림 종류, milestones 는 그때의 기준별 예상 시각."""
    key: str = Field(max_length=100)
    milestones: dict[str, datetime | None] = {}      # {"14": "2026-07-05T08:50", ...}


class NoticeOut(BaseModel):
    """보낸 알림 기록. at·milestones 는 마지막으로 보낸 때 기준, sent 는 알림 키별 보낸 시각."""
    at: datetime
    milestones: dict[str, datetime | None]
    sent: dict[str, datetime]


class PourOut(BaseModel):
    """회차 응답. detected_*는 측압으로 자동 추정한 시각, pour_*는 사람이 확정한 시각."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    site: str | None
    pour_start: datetime | None
    pour_end: datetime | None
    detected_start: datetime | None
    detected_end: datetime | None
    design_strength: float | None
    member: str | None
    sensors: list[str]
    note: str | None
    test_count: int                                  # 입력된 공시체 시험 수
    notify_emails: str | None = None
    notice: NoticeOut | None = None                  # 마지막으로 보낸 알림 (없으면 아직 안 보냄)


class SensorOut(BaseModel):
    """센서 목록 한 줄: 종류(측압/수분)와 데이터가 있는 기간."""
    mac: str
    kind: str
    first: datetime
    last: datetime
    buckets: int                                     # 10분 집계 칸 수 (데이터 양)


class UploadOut(BaseModel):
    """CSV 업로드 결과: 전체 행 수, 새로 저장된 행 수(중복 제외), 기간, 센서."""
    filename: str
    kind: str
    rows_total: int
    rows_inserted: int
    period_start: datetime | None
    period_end: datetime | None
    sensors: list[str]


class ExclusionIn(BaseModel):
    """예측 계산에서 뺄 구간 입력."""
    start: datetime
    end: datetime
    reason: str | None = Field(None, max_length=255)

    @model_validator(mode="after")
    def check_order(self):
        if self.end <= self.start:
            raise ValueError("종료 시각은 시작 시각보다 뒤여야 합니다.")
        return self


class ExclusionOut(ExclusionIn):
    """제외 구간 응답."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    pour_id: int
