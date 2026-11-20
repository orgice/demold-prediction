"""타설 회차 API (화면: 현재 공사, 타설 이력, 회차 상세 4개 탭).

- 회차 목록·등록·수정·삭제
- /summary      타설 이력 카드용 예측 요약
- /detect       측압으로 타설 시각 자동 추정 (pour_detect.py)
- /prediction   강도 예측 (maturity.py)
- /pour-day     타설일 측압 그래프
- /tests        공시체 결과 입력·수정·삭제
- /exclusions   예측 계산에서 뺄 측정 구간 (원본 데이터는 그대로)
- /history      이 회차의 변경 기록 (편집 권한 이상). 수정·삭제는 바뀌기 전→후 값을 audit_log 에 남긴다

데이터가 바뀌는 API는 끝에 maturity.clear_cache()를 불러 예측을 새로 계산하게 한다.
"""
import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from .. import audit, criteria, maturity, notify
from ..auth import require_role
from ..db import engine, get_session
from ..models import AppUser, AuditLog, ExcludedRange, Pour, StrengthTest
from ..pour_detect import detect_pour, load_pressure_minutes
from ..schemas import (ExclusionIn, ExclusionOut, NoticeIn, NoticeOut, PourIn, PourOut, PourPatch, StrengthTestIn,
                       StrengthTestOut)

router = APIRouter(prefix="/api/pours", tags=["타설"])

# 변경 기록에 보일 항목 이름 (화면의 입력 칸 이름과 맞춘다)
POUR_LABELS = {
    "name": "이름", "site": "현장", "pour_start": "타설 시작", "pour_end": "타설 종료",
    "design_strength": "설계기준강도 (MPa)", "member": "부재 종류", "structure": "구조 형식",
    "durable": "내구성 중요 구조물", "removal_override": "해체 기준 직접 입력 (MPa)",
    "removal_override_reason": "해체 기준 사유", "sensors": "연결 센서", "note": "메모",
    "notify_emails": "알림 받을 메일",
}
TEST_LABELS = {
    "test_datetime": "시험 시각", "nominal_age_day": "재령 (일)", "curing": "양생",
    "s1": "강도 (MPa)", "s2": "강도 2 (MPa)", "s3": "강도 3 (MPa)", "note": "메모",
}


def pour_values(p: Pour) -> dict:
    """변경 기록용: 회차의 지금 값 (센서는 목록으로)."""
    return {k: (p.sensor_list if k == "sensors" else getattr(p, k)) for k in POUR_LABELS}


CURING_LABEL = {"field": "현장양생", "water": "수중양생"}


def test_values(t: StrengthTest) -> dict:
    return {k: (CURING_LABEL.get(t.curing, t.curing) if k == "curing" else getattr(t, k)) for k in TEST_LABELS}


def to_out(p: Pour) -> PourOut:
    """DB의 회차를 화면에 보낼 모양(PourOut)으로 바꾼다."""
    return PourOut(id=p.id, name=p.name, site=p.site, pour_start=p.pour_start, pour_end=p.pour_end,
                   detected_start=p.detected_start, detected_end=p.detected_end,
                   design_strength=p.design_strength, member=p.member, structure=p.structure, durable=bool(p.durable),
                   removal_override=p.removal_override, removal_override_reason=p.removal_override_reason,
                   criterion=criteria.criterion(p), sensors=p.sensor_list, note=p.note,
                   test_count=len(p.tests), notify_emails=p.notify_emails,
                   notice=NoticeOut(**json.loads(p.notice)) if p.notice else None)


def all_pours(s: Session) -> list[Pour]:
    """모든 회차를 공시체 결과와 함께 불러온다 (예측 모델 학습에 전체 회차가 필요)."""
    return list(s.scalars(select(Pour).options(selectinload(Pour.tests), selectinload(Pour.exclusions)).order_by(Pour.id)))


def get_pour(s: Session, pour_id: int) -> Pour:
    """회차 하나. 없으면 404 오류."""
    p = s.get(Pour, pour_id, options=[selectinload(Pour.tests), selectinload(Pour.exclusions)])
    if p is None:
        raise HTTPException(404, "타설 회차를 찾을 수 없습니다.")
    return p


@router.get("", response_model=list[PourOut])
def list_pours(s: Session = Depends(get_session)):
    """회차 목록."""
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
    """새 회차 등록. 센서 목록은 'MAC1,MAC2' 문자열로 저장한다."""
    if err := criteria.check_override(body.member, body.durable, body.removal_override, body.removal_override_reason):
        raise HTTPException(422, err)
    p = Pour(**body.model_dump(exclude={"sensors"}), sensors=",".join(x.upper() for x in body.sensors))
    if p.removal_override is None:
        p.removal_override_reason = None
    s.add(p)
    s.commit()
    maturity.clear_cache()
    return to_out(get_pour(s, p.id))


@router.get("/{pour_id}", response_model=PourOut)
def read_pour(pour_id: int, s: Session = Depends(get_session)):
    """회차 하나 조회."""
    return to_out(get_pour(s, pour_id))


@router.patch("/{pour_id}", response_model=PourOut)
def update_pour(pour_id: int, body: PourPatch, request: Request, s: Session = Depends(get_session)):
    """회차 수정. 보낸 항목만 바꾼다 (예: 타설 시각 확정, 설계강도). 바뀐 항목의 전→후 값을 변경 기록에 남긴다."""
    p = get_pour(s, pour_id)
    before = pour_values(p)
    data = body.model_dump(exclude_unset=True)   # 보내지 않은 항목은 빼고
    if "sensors" in data:
        data["sensors"] = ",".join(x.upper() for x in data["sensors"] or [])
    if data.get("durable") is None:
        data.pop("durable", None)   # durable 은 켜고 끄는 값이라 null 은 '안 바꿈'으로 본다
    for k, v in data.items():
        setattr(p, k, v)
    if p.removal_override is None:
        p.removal_override_reason = None   # 직접 입력이 없으면 사유도 남기지 않는다
    # 바꾼 결과로 직접 입력 값을 다시 검사 (부재·내구성을 바꿔 최소값이 올라갈 수도 있음)
    if err := criteria.check_override(p.member, bool(p.durable), p.removal_override, p.removal_override_reason):
        s.rollback()
        raise HTTPException(422, err)
    after = pour_values(p)
    s.commit()
    maturity.clear_cache()
    request.state.audit_detail = audit.detail_json({"changes": audit.changes(before, after, POUR_LABELS)})
    return to_out(get_pour(s, pour_id))


@router.delete("/{pour_id}", status_code=204)
def delete_pour(pour_id: int, request: Request, s: Session = Depends(get_session)):
    """회차와 그 공시체 결과를 지운다. 센서 데이터는 남는다."""
    p = get_pour(s, pour_id)
    gone = {"이름": p.name, "현장": p.site, "설계기준강도 (MPa)": p.design_strength,
            "공시체 결과": f"{len(p.tests)}건", "제외 구간": f"{len(p.exclusions)}건"}
    s.delete(p)
    s.commit()
    maturity.clear_cache()
    request.state.audit_detail = audit.detail_json({"deleted": gone})


@router.post("/{pour_id}/detect", response_model=PourOut)
def run_detection(pour_id: int, request: Request, date: datetime | None = None, s: Session = Depends(get_session)):
    """측압으로 타설 시작·종료 자동 추정. date: 타설일 (생략 시 기존 시작/추정값의 날짜)."""
    p = get_pour(s, pour_id)
    day = date or p.start
    if day is None:
        raise HTTPException(400, "타설일(date)을 알려주세요.")
    start, end = detect_pour(engine, day, p.sensor_list)
    if start is None:
        raise HTTPException(422, "해당 날짜에서 타설로 볼 만한 측압 상승을 찾지 못했습니다.")
    before = {"detected_start": p.detected_start, "detected_end": p.detected_end}
    p.detected_start, p.detected_end = start, end
    s.commit()
    request.state.audit_detail = audit.detail_json({"changes": audit.changes(
        before, {"detected_start": start, "detected_end": end},
        {"detected_start": "자동 추정 타설 시작", "detected_end": "자동 추정 타설 종료"})})
    maturity.clear_cache()
    return to_out(p)


@router.get("/{pour_id}/prediction")
def prediction(pour_id: int, as_of: datetime | None = Query(None, description="기준 시각 (생략 시 최신 데이터)"),
               s: Session = Depends(get_session)):
    """강도 예측 (강도 예측 탭의 모든 숫자·그래프). baseline = 타설 후 24시간 시점의 '최초 예상'."""
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
        # 센서별 [시각, kg] 목록. v != v 는 '값이 비어 있음(NaN)'을 확인하는 파이썬 관용구
        "series": {mac: [[t.isoformat(), None if v != v else round(v, 2)] for t, v in m[mac].items()]
                   for mac in m.columns} if not m.empty else {},
        "detected_start": p.detected_start, "detected_end": p.detected_end,
        "pour_start": p.pour_start, "pour_end": p.pour_end,
    }


# ---------- 공시체 ----------
@router.get("/{pour_id}/tests", response_model=list[StrengthTestOut])
def list_tests(pour_id: int, s: Session = Depends(get_session)):
    """이 회차의 공시체 결과 목록 (시험 시각 순)."""
    return get_pour(s, pour_id).tests


@router.post("/{pour_id}/tests", response_model=StrengthTestOut, status_code=201)
def add_test(pour_id: int, body: StrengthTestIn, s: Session = Depends(get_session)):
    """공시체 결과 추가. 현장양생 결과면 이 회차 예측이 보정된다."""
    get_pour(s, pour_id)
    t = StrengthTest(pour_id=pour_id, **body.model_dump())
    s.add(t)
    s.commit()
    maturity.clear_cache()
    return t


@router.put("/{pour_id}/tests/{test_id}", response_model=StrengthTestOut)
def update_test(pour_id: int, test_id: int, body: StrengthTestIn, request: Request, s: Session = Depends(get_session)):
    """공시체 결과 수정. 바뀐 항목의 전→후 값을 변경 기록에 남긴다."""
    t = s.get(StrengthTest, test_id)
    if t is None or t.pour_id != pour_id:
        raise HTTPException(404, "공시체 결과를 찾을 수 없습니다.")
    before = test_values(t)
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    after = test_values(t)
    s.commit()
    maturity.clear_cache()
    request.state.audit_detail = audit.detail_json({"changes": audit.changes(before, after, TEST_LABELS)})
    return t


@router.delete("/{pour_id}/tests/{test_id}", status_code=204)
def delete_test(pour_id: int, test_id: int, request: Request, s: Session = Depends(get_session)):
    """공시체 결과 삭제."""
    t = s.get(StrengthTest, test_id)
    if t is None or t.pour_id != pour_id:
        raise HTTPException(404, "공시체 결과를 찾을 수 없습니다.")
    request.state.audit_detail = audit.detail_json(
        {"deleted": {TEST_LABELS[k]: v for k, v in test_values(t).items() if v is not None}})
    s.delete(t)
    s.commit()
    maturity.clear_cache()


# ---------- 알림 메일 기록 ----------
@router.post("/{pour_id}/notice", response_model=PourOut)
def record_notice(pour_id: int, body: NoticeIn, s: Session = Depends(get_session)):
    """알림 메일 초안을 열었다고 기록한다. 같은 알림을 다시 띄우지 않고, 다음 '예측 변경' 판단의 기준이 된다.
    메일 발송 자체는 사용자의 메일 앱이 한다 (수행계획서: 초안 자동 작성 · 발송은 사용자)."""
    p = get_pour(s, pour_id)
    notify.save_notice(p, [body.key], body.milestones, auto=False)
    s.commit()
    return to_out(get_pour(s, pour_id))


# ---------- 제외 구간 ----------
@router.get("/{pour_id}/exclusions", response_model=list[ExclusionOut])
def list_exclusions(pour_id: int, s: Session = Depends(get_session)):
    """이 회차에서 예측 계산에 쓰지 않는 구간 목록."""
    return get_pour(s, pour_id).exclusions


@router.post("/{pour_id}/exclusions", response_model=ExclusionOut, status_code=201)
def add_exclusion(pour_id: int, body: ExclusionIn, s: Session = Depends(get_session)):
    """제외 구간 추가. 원본 센서 데이터는 지우지 않고, 예측할 때만 이 구간 온도를 앞뒤 값으로 잇는다."""
    get_pour(s, pour_id)
    e = ExcludedRange(pour_id=pour_id, **body.model_dump())
    s.add(e)
    s.commit()
    maturity.clear_cache()
    return e


@router.delete("/{pour_id}/exclusions/{exclusion_id}", status_code=204)
def delete_exclusion(pour_id: int, exclusion_id: int, request: Request, s: Session = Depends(get_session)):
    """제외 취소."""
    e = s.get(ExcludedRange, exclusion_id)
    if e is None or e.pour_id != pour_id:
        raise HTTPException(404, "제외 구간을 찾을 수 없습니다.")
    request.state.audit_detail = audit.detail_json({"deleted": {"제외 시작": e.start, "제외 종료": e.end, "사유": e.reason}})
    s.delete(e)
    s.commit()
    maturity.clear_cache()


# ---------- 변경 기록 ----------
class HistoryOut(BaseModel):
    id: int
    at: datetime
    user: str | None          # 로그인 ID ('system' = 자동 발송)
    user_name: str | None     # 지금 계정 이름 (삭제된 계정이면 없음)
    action: str
    target: str
    detail: str | None        # JSON 문자열: {"changes": [...]} / {"deleted": {...}} / 보낸 내용


@router.get("/{pour_id}/history", response_model=list[HistoryOut])
def history(pour_id: int, limit: int = Query(200, ge=1, le=1000), s: Session = Depends(get_session),
            _=Depends(require_role("editor"))):
    """이 회차의 변경 기록 (성공한 것만, 최신순). 회차 수정·공시체·제외 구간·타설 시각 추정·알림 발송.
    회차 등록 기록은 주소에 회차 번호가 없어 여기에는 나오지 않는다 (관리자 변경 기록 화면에서 확인)."""
    base = f"/api/pours/{pour_id}"
    rows = list(s.scalars(select(AuditLog)
                          .where(or_(AuditLog.path == base, AuditLog.path.like(f"{base}/%")),
                                 AuditLog.status >= 200, AuditLog.status < 400)
                          .order_by(AuditLog.id.desc()).limit(limit)))
    names = dict(s.execute(select(AppUser.login_id, AppUser.name)
                           .where(AppUser.login_id.in_({r.login_id for r in rows if r.login_id}))).all())
    return [HistoryOut(id=r.id, at=r.at, user=r.login_id, user_name=names.get(r.login_id), action=r.action,
                       target=r.path, detail=r.detail) for r in rows]
