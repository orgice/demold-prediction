from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrengthTestIn(BaseModel):
    test_datetime: datetime
    nominal_age_day: int | None = None
    curing: Literal["field", "water"] = "field"
    s1: float | None = Field(None, ge=0, le=200)
    s2: float | None = Field(None, ge=0, le=200)
    s3: float | None = Field(None, ge=0, le=200)
    note: str | None = None


class StrengthTestOut(StrengthTestIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    pour_id: int
    average: float | None


class PourIn(BaseModel):
    name: str
    site: str | None = None
    pour_start: datetime | None = None
    pour_end: datetime | None = None
    design_strength: float | None = Field(None, gt=0, le=200)
    sensors: list[str] = []
    note: str | None = None


class PourPatch(BaseModel):
    name: str | None = None
    site: str | None = None
    pour_start: datetime | None = None
    pour_end: datetime | None = None
    design_strength: float | None = Field(None, gt=0, le=200)
    sensors: list[str] | None = None
    note: str | None = None


class PourOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    site: str | None
    pour_start: datetime | None
    pour_end: datetime | None
    detected_start: datetime | None
    detected_end: datetime | None
    design_strength: float | None
    sensors: list[str]
    note: str | None
    test_count: int


class SensorOut(BaseModel):
    mac: str
    kind: str
    first: datetime
    last: datetime
    buckets: int


class UploadOut(BaseModel):
    filename: str
    kind: str
    rows_total: int
    rows_inserted: int
    period_start: datetime | None
    period_end: datetime | None
    sensors: list[str]
