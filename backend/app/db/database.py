from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

is_sqlite = settings.DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {}
engine_kwargs = {"connect_args": connect_args}

import os

if not is_sqlite:
    #: 연결 수를 줄인다(10+10 → 5+5).
    #
    #  Render 는 배포할 때 새 서버를 띄운 뒤 옛 서버를 내린다. 그 사이 두 서버가
    #  함께 연결을 잡으면 20+20 = 40 개까지 가는데, Supabase 무료 풀러의 연결
    #  한도가 그보다 작다. 배포 직후 관리자 통계·피드 같은 **서로 무관한 조회가
    #  같은 초에 한꺼번에 OperationalError** 로 떨어진 것이 이 모양이다.
    #  0.15 CPU 서버가 연결 20 개를 동시에 쓸 일도 없다.
    engine_kwargs.update({
        "pool_size": int(os.getenv("DB_POOL_SIZE", 5)),
        "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", 5)),
        #: 연결을 기다리는 한도. 기본 30초면 화면이 30초 멈춘 뒤에야 실패한다
        "pool_timeout": int(os.getenv("DB_POOL_TIMEOUT", 10)),
        "pool_pre_ping": True,  # 연결 유효성 자동 확인
        "pool_recycle": 1800,   # 30분마다 연결 재생성
    })

engine = create_engine(settings.DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
