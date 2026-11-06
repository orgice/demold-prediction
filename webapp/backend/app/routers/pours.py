from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import maturity
from ..db import engine, get_session
from ..models import Pour, StrengthTest
from ..pour_detect import detect_pour, load_pressure_minutes
from ..schemas import PourIn, PourOut, PourPatch, StrengthTestIn, StrengthTestOut

router = APIRouter(prefix="/api/pours", tags=["타설"])


def to_out(p: Pour) -> PourOut:
    return PourOut(id=p.id, name=p.name, site=p.site, pour_start=p.pour_start, pour_end=p.pour_end,
                   detected_start=p.detected_start, detected_end=p.detected_end,
                   design_strength=p.design_strength, sensors=p.sensor_list, note=p.note,
                   test_count=len(p.tests))


def all_pours(s: Session) -> list[Pour]:
    return list(s.scalars(select(Pour).options(selectinload(Pour.tests)).order_by(Pour.id)))


def get_pour(s: Session, pour_id: int) -> Pour:
    p = s.get(Pour, pour_id, options=[selectinload(Pour.tests)])
    if p is None:
        raise HTTPException(404, "타설 회차를 찾을 수 없습니다.")
    return p


@router.get("", response_model=list[PourOut])
def list_pours(s: Session = Depends(get_session)):
    return [to_out(p) for p in all_pours(s)]


@router.get("/summary")
def summary(s: Session = Depends(get_session)):
    """목록 화면용: 회차별 현재 예측 요약 (실패한 회차는 error 메시지)."""
    pours = all_pours(s)
    out = []
    for p in pours:
        item = {"pour": to_out(p).model_dump(mode="json")}
        try:
            r = maturity.predict(engine, p, pours)
            item.update({k: r[k] for k in ("as_of", "data_end", "current_strength", "strength_28d",
                                           "design_ratio_28d", "milestones")})
        except maturity.PredictionError as e:
            item["error"] = str(e)
        out.append(item)
    return out


@router.post("", response_model=PourOut, status_code=201)
def create_pour(body: PourIn, s: Session = Depends(get_session)):
    p = Pour(**body.model_dump(exclude={"sensors"}), sensors=",".join(x.upper() for x in body.sensors))
    s.add(p)
    s.commit()
    maturity.clear_cache()
    return to_out(get_pour(s, p.id))


@router.get("/{pour_id}", response_model=PourOut)
def read_pour(pour_id: int, s: Session = Depends(get_session)):
    return to_out(get_pour(s, pour_id))


@router.patch("/{pour_id}", response_model=PourOut)
def update_pour(pour_id: int, body: PourPatch, s: Session = Depends(get_session)):
    p = get_pour(s, pour_id)
    data = body.model_dump(exclude_unset=True)
    if "sensors" in data:
        data["sensors"] = ",".join(x.upper() for x in data["sensors"] or [])
    for k, v in data.items():
        setattr(p, k, v)
    s.commit()
    maturity.clear_cache()
    return to_out(get_pour(s, pour_id))


@router.delete("/{pour_id}", status_code=204)
def delete_pour(pour_id: int, s: Session = Depends(get_session)):
    s.delete(get_pour(s, pour_id))
    s.commit()
    maturity.clear_cache()


@router.post("/{pour_id}/detect", response_model=PourOut)
def run_detection(pour_id: int, date: datetime | None = None, s: Session = Depends(get_session)):
    """측압으로 타설 시작·종료 자동 추정. date: 타설일 (생략 시 기존 시작/추정값의 날짜)."""
    p = get_pour(s, pour_id)
    day = date or p.start
    if day is None:
        raise HTTPException(400, "타설일(date)을 알려주세요.")
    start, end = detect_pour(engine, day, p.sensor_list)
    if start is None:
        raise HTTPException(422, "해당 날짜에서 타설로 볼 만한 측압 상승을 찾지 못했습니다.")
    p.detected_start, p.detected_end = start, end
    s.commit()
    maturity.clear_cache()
    return to_out(p)


@router.get("/{pour_id}/prediction")
def prediction(pour_id: int, as_of: datetime | None = Query(None, description="기준 시각 (생략 시 최신 데이터)"),
               s: Session = Depends(get_session)):
    pours = all_pours(s)
    p = next((x for x in pours if x.id == pour_id), None)
    if p is None:
        raise HTTPException(404, "타설 회차를 찾을 수 없습니다.")
    try:
        r = maturity.predict(engine, p, pours, as_of)
        r["baseline"] = maturity.baseline(engine, p, pours, r)
        return r
    except maturity.PredictionError as e:
        raise HTTPException(422, str(e))


@router.get("/{pour_id}/pour-day")
def pour_day(pour_id: int, date: datetime | None = None, s: Session = Depends(get_session)):
    """타설일 확인용 1분 측압 (당일 0시 ~ 다음날 12시)."""
    p = get_pour(s, pour_id)
    day = (date or p.start or datetime.now()).replace(hour=0, minute=0, second=0, microsecond=0)
    m = load_pressure_minutes(engine, p.sensor_list, day, day + timedelta(hours=36))
    return {
        "date": day.isoformat(),
        "series": {mac: [[t.isoformat(), None if v != v else round(v, 2)] for t, v in m[mac].items()]
                   for mac in m.columns} if not m.empty else {},
        "detected_start": p.detected_start, "detected_end": p.detected_end,
        "pour_start": p.pour_start, "pour_end": p.pour_end,
    }


# ---------- 공시체 ----------
@router.get("/{pour_id}/tests", response_model=list[StrengthTestOut])
def list_tests(pour_id: int, s: Session = Depends(get_session)):
    return get_pour(s, pour_id).tests


@router.post("/{pour_id}/tests", response_model=StrengthTestOut, status_code=201)
def add_test(pour_id: int, body: StrengthTestIn, s: Session = Depends(get_session)):
    get_pour(s, pour_id)
    t = StrengthTest(pour_id=pour_id, **body.model_dump())
    s.add(t)
    s.commit()
    maturity.clear_cache()
    return t


@router.put("/{pour_id}/tests/{test_id}", response_model=StrengthTestOut)
def update_test(pour_id: int, test_id: int, body: StrengthTestIn, s: Session = Depends(get_session)):
    t = s.get(StrengthTest, test_id)
    if t is None or t.pour_id != pour_id:
        raise HTTPException(404, "공시체 결과를 찾을 수 없습니다.")
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    s.commit()
    maturity.clear_cache()
    return t


@router.delete("/{pour_id}/tests/{test_id}", status_code=204)
def delete_test(pour_id: int, test_id: int, s: Session = Depends(get_session)):
    t = s.get(StrengthTest, test_id)
    if t is None or t.pour_id != pour_id:
        raise HTTPException(404, "공시체 결과를 찾을 수 없습니다.")
    s.delete(t)
    s.commit()
    maturity.clear_cache()
