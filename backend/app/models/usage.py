"""관리자 화면의 '검색으로 찾은 종목'·'기능별 사용 통계' 를 쌓는 자리.

예전에는 서버 메모리의 카운터를 통째로 system_settings 한 칸(JSON)에 덮어
썼다. 그 방식은 배포 때마다 기록을 잃었다 —

  · 서버가 꺼질 때 저장하는 단계가 없었다. 마지막 저장(5분 주기) 뒤에 센
    것은 배포·잠들기 때마다 사라졌다.
  · 새 서버가 DB 에서 읽어 오다 실패하면(배포 직후 연결이 붐빌 때) 빈
    카운터로 시작했고, 다음 저장이 그 빈 카운터로 **지금까지의 기록을
    통째로 덮어썼다.**
  · 배포하는 동안 옛 서버와 새 서버가 함께 돌면, 둘이 번갈아 자기 숫자로
    덮어써서 한쪽이 센 것이 사라졌다.

그래서 한 줄에 한 항목을 두고, 저장할 때는 **늘어난 만큼만 더한다.**
서버는 아직 저장 안 한 증가분만 들고 있으므로, 읽기에 실패해도 덮어쓸
'전체 숫자' 가 애초에 없다.
"""
from sqlalchemy import BigInteger, Column, DateTime, String

from app.db.database import Base


class UsageCounter(Base):
    __tablename__ = "usage_counters"

    #: "search"(검색으로 찾은 종목) | "usage"(기능별 사용)
    kind  = Column(String(10), primary_key=True)
    #: search 는 "시장|종목코드"(예: "KR|005930"), usage 는 기능 이름(예: "dashboard")
    key   = Column(String(40), primary_key=True)
    #: 화면에 보일 이름 — 검색은 종목명, 사용 통계는 비워 둔다
    name  = Column(String(80), nullable=True)
    count = Column(BigInteger, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), nullable=True)
