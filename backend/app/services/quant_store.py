"""퀀트 지표를 DB 에 남겨 둔다 (models.stock.QuantMetricsCache).

메모리 캐시(qmetrics:*)는 서버가 잠들 때마다 비워진다. 퀀트 비교 화면은
그때마다 종목별 재무·2년치 가격을 처음부터 다시 모았다 — 0.15 CPU 에서
가장 비싼 화면이다. 여기 남겨 둔 것을 한 번에 읽어 곧바로 답하고, 오래된
것은 뒤에서 새로 받는다.
"""
import logging
import math
from datetime import datetime

from sqlalchemy.exc import IntegrityError

from app.db.database import SessionLocal
from app.models.stock import QuantMetricsCache

log = logging.getLogger(__name__)

#: 이보다 오래된 저장값은 안 쓴다. 재무는 분기마다, 가격은 매일 바뀐다 —
#: 일주일 지난 점수는 '지난 값' 으로 보여 주기에도 너무 멀다.
최대보관초 = 7 * 86400


def 쓸만한가(지표: dict | None) -> bool:
    """가격까지 다 모은 지표만 남긴다. 가격(모멘텀)이 빠진 것은 가격 조회가
    시한에 걸린 반쪽짜리다 — 남기면 그 반쪽이 일주일 동안 점수가 된다."""
    return bool(지표) and any(str(k).startswith("mom_") for k in 지표)


def _깨끗이(지표: dict) -> dict:
    """NaN·무한대는 JSON 칸(Postgres)에 못 들어간다 — 비운다."""
    return {k: (None if isinstance(v, float) and not math.isfinite(v) else v)
            for k, v in 지표.items()}


def 여럿읽기(짝들: list[tuple[str, str]]) -> dict[tuple[str, str], tuple[dict, float]]:
    """(종목, 시장) 들의 저장값을 한 번에 읽는다 → {(종목, 시장): (지표, 지난 초)}.

    종목마다 따로 물으면 30종목이 DB 왕복 30번이다. IN 한 번으로 끝낸다.
    실패해도 빈 것을 돌려준다 — 이건 지름길이지 없으면 안 되는 길이 아니다."""
    if not 짝들:
        return {}
    원하는것 = set(짝들)
    db = SessionLocal()
    try:
        줄들 = (db.query(QuantMetricsCache)
                .filter(QuantMetricsCache.symbol.in_(sorted({s for s, _ in 짝들})))
                .all())
        지금 = datetime.utcnow()
        나온것 = {}
        for 줄 in 줄들:
            열쇠 = (줄.symbol, 줄.market)
            if 열쇠 not in 원하는것 or not 줄.data or not 줄.fetched_at:
                continue
            지난초 = (지금 - 줄.fetched_at).total_seconds()
            if 지난초 > 최대보관초:
                continue
            나온것[열쇠] = (dict(줄.data), 지난초)
        return 나온것
    except Exception as e:
        log.debug("퀀트 지표 저장값 읽기 실패: %s", type(e).__name__)
        return {}
    finally:
        db.close()


def 저장(종목: str, 시장: str, 지표: dict) -> None:
    """지표를 남긴다(있으면 고쳐 쓴다). 반쪽짜리는 남기지 않는다."""
    if not 쓸만한가(지표):
        return
    db = SessionLocal()
    try:
        값 = _깨끗이(지표)
        줄 = db.query(QuantMetricsCache).filter_by(symbol=종목, market=시장).first()
        if 줄:
            줄.data = 값
            줄.fetched_at = datetime.utcnow()
        else:
            db.add(QuantMetricsCache(symbol=종목, market=시장, data=값, fetched_at=datetime.utcnow()))
        db.commit()
    except IntegrityError:
        db.rollback()                    # 같은 순간 다른 쪽이 먼저 넣었다 — 그쪽 값이면 된다
    except Exception as e:
        db.rollback()
        log.debug("퀀트 지표 저장 실패 %s %s: %s", 시장, 종목, type(e).__name__)
    finally:
        db.close()
