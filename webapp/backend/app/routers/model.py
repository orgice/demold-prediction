import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import maturity
from ..config import DATUM_TEMP, THRESHOLDS
from ..db import engine, get_session
from .pours import all_pours

router = APIRouter(prefix="/api/model", tags=["모델"])


def needed_maturity(params, strength):
    """강도 곡선을 거꾸로 풀어 그 강도에 필요한 적산온도. 최종강도 이상이면 None."""
    su, k, m0 = params
    return None if strength >= su else float(m0 + strength / (k * (su - strength)))


@router.get("/curve")
def curve(s: Session = Depends(get_session)):
    """새 타설 예측에 쓰는 곡선 (전체 회차 학습)과 학습에 쓴 공시체."""
    pours = all_pours(s)
    try:
        model = maturity.train(engine, pours, exclude_id=None)
    except maturity.PredictionError as e:
        raise HTTPException(422, str(e))
    params = model["params"]
    z = maturity.Z90
    specimens = []
    for p in pours:
        if p.id not in model["pour_ids"]:
            continue
        d = maturity.pour_data(engine, p)
        for r in d.specimens.itertuples():
            specimens.append({"pour_id": p.id, "pour": p.name, "t": r.test_datetime.isoformat(),
                              "age_d": round(r.age_d, 3), "maturity": round(r.x, 2), "fc": r.fc})
    x_max = max(1100.0, max((sp["maturity"] for sp in specimens), default=0) * 1.05)
    # 탈형 판단 구간(0~150)은 촘촘하게, 그 뒤는 성기게
    grid = np.concatenate([np.arange(0, 150, 1.0), np.linspace(150, x_max, 250)])
    S = maturity.hyperbolic(grid, *params)
    sigma = model["sigma_uncal"]

    targets = []
    for label, thr in [("벽체 해체", THRESHOLDS["wall"]), ("슬래브 해체", THRESHOLDS["slab"])]:
        m = needed_maturity(params, thr)
        targets.append({
            "label": label, "strength": thr, "maturity": None if m is None else round(m, 1),
            # 내부온도가 일정하다고 할 때 걸리는 시간 (적산온도 기준온도 T0 위의 온도만 쌓임)
            "hours_at": {f"{t}": None if m is None else round(m / (t - DATUM_TEMP) * 24, 1) for t in (5, 10, 20, 30)},
        })
    return {
        "formula": "S = Su·k(M−M0) / (1 + k(M−M0)),  M = Σ max(T − T0, 0)·Δt",
        "params": {"Su": round(params[0], 2), "k": round(params[1], 5), "M0": round(params[2], 2), "T0": DATUM_TEMP},
        "sigma": round(sigma, 3),
        "interval": "90%",
        "train_pours": model["pour_ids"],
        "train_specimens": model["n_specimens"],
        "targets": targets,
        "curve": [{"maturity": round(float(m), 2), "strength": round(float(v), 2),
                   "lower": round(float(v * np.exp(-z * sigma)), 2), "upper": round(float(v * np.exp(z * sigma)), 2)}
                  for m, v in zip(grid, S)],
        "specimens": specimens,
    }
