"""초기 데이터 적재: 센서 CSV + 타설 회차 + 공시체 압축강도.

사용: python -m scripts.seed /seed/sensors   (CSV 폴더, 하위 폴더 포함)
타설 회차는 seed/pours.csv, 공시체는 seed/strength.csv 에서 읽는다 (실데이터는 저장소에 없음).
형식은 seed/*.example.csv 참고 (값은 가짜 예시).
이미 들어간 행은 row_hash로 건너뛰므로 여러 번 실행해도 된다.
"""
import sys
import time
from pathlib import Path

import pandas as pd
from sqlalchemy import select

from app.db import Base, SessionLocal, engine
from app.ingest import ingest_csv
from app.models import Pour, StrengthTest, UploadLog
from app.pour_detect import detect_pour

SEED = Path(__file__).resolve().parents[1] / "seed"   # backend/seed 폴더



def load_sensors(folder: Path):
    """폴더(하위 폴더 포함)의 모든 CSV를 업로드 화면과 같은 방식(ingest_csv)으로 적재한다."""
    for f in sorted(folder.rglob("*.csv")):
        t = time.time()
        r = ingest_csv(engine, f.read_bytes(), f.name)
        with SessionLocal() as s:
            s.add(UploadLog(filename=f.name, kind=r["kind"], rows_total=r["rows_total"],
                            rows_inserted=r["rows_inserted"], period_start=r["period_start"],
                            period_end=r["period_end"]))
            s.commit()
        print(f"  {f.name}: {r['rows_inserted']:,}/{r['rows_total']:,}행, 센서 {r['sensors']} "
              f"({time.time() - t:.0f}초)", flush=True)


def load_pours():
    """seed/pours.csv의 회차를 만들고, 측압으로 타설 시각을 추정하고, strength.csv의 공시체를 붙인다.

    이름이 같은 회차가 이미 있으면 건너뛴다.
    """
    if not (SEED / "pours.csv").exists():
        print("  seed/pours.csv 가 없어 타설 회차 적재를 건너뜁니다 (형식: seed/pours.example.csv)")
        return
    # pours.csv: name, pour_date, sensors("MAC1,MAC2"), site  /  strength.csv 의 pour_no 는 pours.csv 의 행 번호(1부터)
    pours = pd.read_csv(SEED / "pours.csv", dtype=str)
    strength = (pd.read_csv(SEED / "strength.csv", parse_dates=["test_datetime"])
                if (SEED / "strength.csv").exists() else pd.DataFrame(columns=["pour_no"]))
    with SessionLocal() as s:
        for i, (name, day, sensors, site) in enumerate(
                pours[["name", "pour_date", "sensors", "site"]].itertuples(index=False), start=1):
            if s.scalar(select(Pour).where(Pour.name == name)):
                continue
            p = Pour(name=name, site=site, sensors=sensors,
                     note=f"타설일 {day}. 타설 시각은 측압 자동 추정값 — 실제 시각 확인 후 입력 필요")
            p.detected_start, p.detected_end = detect_pour(engine, pd.Timestamp(day), sensors.split(","))
            for r in strength[strength.pour_no == i].itertuples():
                p.tests.append(StrengthTest(
                    test_datetime=r.test_datetime.to_pydatetime(), nominal_age_day=int(r.nominal_age_day),
                    curing=r.curing, note=None if pd.isna(r.note) else r.note,
                    **{k: None if pd.isna(getattr(r, k)) else float(getattr(r, k)) for k in ("s1", "s2", "s3")}))
            s.add(p)
            print(f"  {name}: 추정 타설 {p.detected_start} ~ {p.detected_end}, 공시체 {len(p.tests)}건")
        s.commit()


if __name__ == "__main__":
    Base.metadata.create_all(engine)
    if len(sys.argv) > 1:
        print("센서 CSV 적재")
        load_sensors(Path(sys.argv[1]))
    print("타설 회차·공시체 적재")
    load_pours()
