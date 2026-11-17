"""새 타설 예측에 쓰는 곡선(전체 회차 학습)과 공시체별 적산온도를 JSON으로 출력.

사용: python -m scripts.export_curve > curve.json
"""
import json

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app import maturity
from app.db import SessionLocal, engine
from app.models import Pour

# 전체 회차로 곡선을 맞춘다 (exclude_id=None → 어떤 회차도 빼지 않음)
with SessionLocal() as s:
    pours = list(s.scalars(select(Pour).options(selectinload(Pour.tests), selectinload(Pour.exclusions)).order_by(Pour.id)))
model = maturity.train(engine, pours, exclude_id=None)
spec = []
for p in pours:
    d = maturity.pour_data(engine, p)
    if d is None:
        continue
    for r in d.specimens.itertuples():
        spec.append({"pour": p.name, "x": r.x, "fc": r.fc, "age_d": r.age_d})
print(json.dumps({"params": [float(v) for v in model["params"]], "sigma_uncal": model["sigma_uncal"],
                  "sigma_cal": model["sigma_cal"], "n": model["n_specimens"], "spec": spec}))
