"""회차별 거푸집 해체 기준 강도 (KCS 14 20 12, 해체 가이드라인 표 2.1.1).

기준은 회차 설정에서 고른 조건으로 자동 계산한다. 사람이 숫자를 직접 적는 것은 예외로만 허용한다.

    부재 위치                      조건                 해체 기준
    벽·기둥 (측면)                 보통                  5 MPa
                                   내구성 중요           10 MPa
    슬래브 (밑면)                  단층 구조(또는 미선택) max(14, 설계기준강도 × 2/3)
                                   다층 구조             max(14, 설계기준강도)

- 설계기준강도를 넣지 않은 슬래브는 14 MPa로 계산하고 경고를 붙인다 (실제 기준은 더 높을 수 있음).
- 직접 입력(override)은 책임기술자 지시·필러 동바리 구조계산 같은 경우에 쓴다.
  KCS 최소값(벽 5 / 내구성 중요 10 / 슬래브 14 MPa)보다 낮게는 입력할 수 없고, 사유를 함께 남겨야 한다.
  입력 내용은 변경 기록(audit_log, 회차 수정)에 그대로 남는다.
- 부재를 정하지 않은 회차는 기준이 없으므로 벽 5·슬래브 14 MPa 최소값을 둘 다 보여 준다 (maturity.predict).

화면의 설정 탭 미리보기(frontend/src/components/criteria.ts)가 같은 규칙을 쓴다. 바꿀 때 함께 바꾼다.
"""
from .config import THRESHOLDS

DURABLE_WALL = 10.0   # 내구성이 중요한 구조물의 측면 기준 (얼고 녹음·탄산화·염해 등에 노출, 발주처와 협의)
STRUCTURE_LABEL = {"single": "단층 구조", "multi": "다층 구조"}


def minimum(member: str, durable: bool) -> float:
    """직접 입력해도 이보다 낮게는 못 내리는 KCS 최소값."""
    if member == "wall":
        return DURABLE_WALL if durable else THRESHOLDS["wall"]
    return THRESHOLDS["slab"]


def auto(member: str, structure: str | None, durable: bool, design: float | None) -> tuple[float, str, str | None]:
    """조건으로 계산한 기준 (값, 계산 근거 문구, 경고 문구)."""
    if member == "wall":
        if durable:
            return DURABLE_WALL, "벽·기둥 측면, 내구성 중요 구조물: 10 MPa", None
        return THRESHOLDS["wall"], "벽·기둥 측면: 5 MPa", None

    floor = THRESHOLDS["slab"]
    if not design:
        warn = "설계기준강도를 입력하지 않아 최소값 14 MPa로 계산했습니다. 실제 기준은 더 높을 수 있습니다."
        return floor, "슬래브 밑면: 최소 14 MPa", warn
    if structure == "multi":
        v = max(floor, design)
        return v, f"슬래브 밑면, 다층 구조: 설계기준강도 {design:g} MPa 이상 (최소 14 MPa)", None
    v = round(max(floor, design * 2 / 3), 1)
    basis = f"슬래브 밑면, 단층 구조: 설계기준강도 {design:g} × 2/3 = {design * 2 / 3:.1f} MPa와 14 MPa 중 큰 값"
    warn = None if structure == "single" else "구조 형식(단층/다층)을 고르지 않아 단층 기준으로 계산했습니다. 다층이면 설계기준강도가 기준입니다."
    return v, basis, warn


def criterion(pour) -> dict | None:
    """회차의 해체 기준. 부재를 정하지 않았으면 None.

    strength = 실제로 쓰는 기준, auto_strength = 조건으로 계산한 값, minimum = 직접 입력 하한.
    """
    if pour.member not in ("wall", "slab"):
        return None
    durable = bool(pour.durable)
    value, basis, warning = auto(pour.member, pour.structure, durable, pour.design_strength)
    out = {"strength": value, "auto_strength": value, "minimum": minimum(pour.member, durable),
           "basis": basis, "warning": warning, "overridden": False, "override_reason": None}
    if pour.removal_override is not None:
        out.update(strength=pour.removal_override, overridden=True, override_reason=pour.removal_override_reason,
                   basis=f"직접 입력 {pour.removal_override:g} MPa (자동 계산 {value:g} MPa)")
    return out


def check_override(member: str | None, durable: bool, value: float | None, reason: str | None) -> str | None:
    """직접 입력 값이 허용되는지. 문제가 있으면 오류 문구, 괜찮으면 None."""
    if value is None:
        return None
    if member not in ("wall", "slab"):
        return "해체 기준을 직접 입력하려면 부재 종류를 먼저 정하세요."
    low = minimum(member, durable)
    if value < low:
        return f"해체 기준은 KCS 최소값 {low:g} MPa보다 낮게 정할 수 없습니다."
    if not (reason or "").strip():
        return "해체 기준을 직접 입력할 때는 사유를 적어야 합니다."
    return None
