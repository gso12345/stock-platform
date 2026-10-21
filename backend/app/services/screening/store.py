"""스크리닝 원천에서 받은 덩어리를 DB 에 남긴다 — 서버가 잠들었다 깨도 곧바로 쓰게.

시장 사진(yf_service._사진_남기기)과 같은 표(screening_snapshots)에 열쇠만 달리 남긴다:

  KR_KRX    국내 전 종목 지표·업종·기간 수익률(KRX)
  KR_NAVER  국내 예상 PER·EPS·52주 고저(네이버, 종목마다 돌아가며)
  KR_DART   국내 매출·영업이익·순이익·자산·부채·자본(DART — 키가 있을 때)
  US_SEC    미국 매출·순이익·영업이익·EPS·주당배당·현금흐름·자본·부채(SEC)
  US_KO     미국 종목 한글 이름(네이버)
"""
from __future__ import annotations

import logging
import math
import time
from datetime import datetime

log = logging.getLogger(__name__)


def _깨끗이(v):
    """NaN·무한대는 JSON 칸(Postgres)에 못 들어간다 — 비운다"""
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, dict):
        return {k: _깨끗이(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_깨끗이(x) for x in v]
    return v


def 읽기(열쇠: str) -> tuple[dict | None, float]:
    """(남긴 것, 남긴 때 유닉스 초). 없거나 못 읽으면 (None, 0)"""
    try:
        from app.db.database import SessionLocal
        from app.models.stock import ScreeningSnapshot
        db = SessionLocal()
        try:
            줄 = db.query(ScreeningSnapshot).filter_by(market=열쇠).first()
        finally:
            db.close()
        if not 줄 or not isinstance(줄.data, dict) or not 줄.fetched_at:
            return None, 0.0
        return 줄.data, time.time() - (datetime.utcnow() - 줄.fetched_at).total_seconds()
    except Exception as e:
        log.debug("스크리닝 원천 %s 읽기 실패: %s", 열쇠, type(e).__name__)
        return None, 0.0


def 남기기(열쇠: str, 값: dict) -> bool:
    try:
        from app.db.database import SessionLocal
        from app.models.stock import ScreeningSnapshot
        db = SessionLocal()
        try:
            줄 = db.query(ScreeningSnapshot).filter_by(market=열쇠).first()
            깨끗 = _깨끗이(값)
            if 줄:
                줄.data, 줄.fetched_at = 깨끗, datetime.utcnow()
            else:
                db.add(ScreeningSnapshot(market=열쇠, data=깨끗, fetched_at=datetime.utcnow()))
            db.commit()
            return True
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
    except Exception as e:
        log.debug("스크리닝 원천 %s 남기기 실패: %s", 열쇠, type(e).__name__)
        return False
