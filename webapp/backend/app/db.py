"""데이터베이스(MariaDB) 연결.

- engine: DB와 실제로 연결하는 통로. 여러 파일에서 가져다 쓴다.
- SessionLocal: API 요청 하나를 처리하는 동안 쓰는 '작업 단위'(세션)를 만드는 틀.
- Base: models.py의 테이블 클래스들이 상속하는 부모 클래스.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import DATABASE_URL

# pool_pre_ping: 오래 쉬던 연결이 끊겼으면 자동으로 다시 연결
# pool_recycle: 1시간(3600초)마다 연결을 새로 만들어 DB 쪽 타임아웃을 피함
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    """모든 테이블 클래스의 부모. (models.py 참고)"""
    pass


def get_session():
    """API 함수에 DB 세션을 하나 빌려주고, 요청이 끝나면 자동으로 닫는다.

    FastAPI의 Depends(get_session)로 쓰인다.
    """
    with SessionLocal() as session:
        yield session
