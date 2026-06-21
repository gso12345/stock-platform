"""
퀀트 점수 상대평가용 — 시장별(KR/US/ETF) 지표 백분위 분포를 일배치로 계산해
DB에 캐시한다. 요청 시점(quant-score 엔드포인트)에는 이 캐시를 조회해
이분 탐색만 수행하므로 "비교"로 인한 지연이 거의 없다. 분포 갱신 자체는
이미 펀더멘털 일일 갱신 주기(scheduler.refresh_fundamentals_daily)에 맞춰
DB에 캐시된 종목들의 기존 데이터만 재사용하므로 추가 외부 API 호출이
늘어나지 않는다(모멘텀 지표만 yfinance OHLCV 캐시를 통해 조회).
"""
import logging
from app.db.database import SessionLocal
from app.models.stock import QuantPercentileCache
from app.core.cache import cache as mem_cache
from app.services.quant_score import METRIC_DEFS, collect_quant_metrics

log = logging.getLogger(__name__)

ALL_METRIC_KEYS = [mkey for defs in METRIC_DEFS.values() for (mkey, *_rest) in defs]
MIN_SAMPLES = 15


def _db_get(market: str) -> dict | None:
    db = SessionLocal()
    try:
        row = db.query(QuantPercentileCache).filter(QuantPercentileCache.market == market).first()
        return row.data if row else None
    except Exception as e:
        log.debug(f"퀀트 percentile DB 읽기 실패 {market}: {e}")
        return None
    finally:
        db.close()


def _db_set(market: str, data: dict):
    db = SessionLocal()
    try:
        row = db.query(QuantPercentileCache).filter(QuantPercentileCache.market == market).first()
        if row:
            row.data = data
        else:
            row = QuantPercentileCache(market=market, data=data)
            db.add(row)
        db.commit()
    except Exception as e:
        db.rollback()
        log.debug(f"퀀트 percentile DB 저장 실패 {market}: {e}")
    finally:
        db.close()


def get_percentile_distributions(market: str) -> dict:
    """in-memory(1시간) → DB. 일배치로만 갱신되는 값이라 요청 시점엔 조회만 한다."""
    ck = f"quant_pct:{market}"
    cached = mem_cache.get(ck)
    if cached is not None:
        return cached
    data = _db_get(market) or {}
    mem_cache.set(ck, data, 3600)
    return data


async def rebuild_market_distribution(market: str, symbols: list[str]) -> dict:
    """symbols의 캐시된 지표값을 모아 percentile 분포를 재계산한다.
    fundamentals_service/yf_service가 캐시 우선이라 이미 조회된 종목은
    추가 외부 호출 없이 즉시 반환되며, 미캐시 종목은 자연스럽게 건너뛴다."""
    samples: dict[str, list[float]] = {k: [] for k in ALL_METRIC_KEYS}
    for symbol in symbols:
        try:
            metrics = await collect_quant_metrics(symbol, market, fetch_ohlcv=True)
        except Exception:
            continue
        for k, v in metrics.items():
            if v is None or k not in samples:
                continue
            try:
                samples[k].append(float(v))
            except (TypeError, ValueError):
                pass

    data = {k: sorted(vals) for k, vals in samples.items() if len(vals) >= MIN_SAMPLES}
    if data:
        _db_set(market, data)
        mem_cache.set(f"quant_pct:{market}", data, 3600)
    log.info(
        f"퀀트 percentile 분포 갱신 [{market}] — "
        + ", ".join(f"{k}:{len(v)}" for k, v in data.items()) if data else f"퀀트 percentile 분포 갱신 [{market}] — 표본 부족"
    )
    return data


async def rebuild_all_distributions():
    """KR/US/ETF — DB에 이미 캐시된(=한 번이라도 조회된) 종목들로 분포 재계산"""
    from app.services.fundamentals_service import get_all_fund_symbols

    by_market: dict[str, list[str]] = {"KR": [], "US": [], "ETF": []}
    for sym, mkt in get_all_fund_symbols():
        if mkt in by_market:
            by_market[mkt].append(sym)

    for market, symbols in by_market.items():
        if not symbols:
            continue
        try:
            await rebuild_market_distribution(market, symbols)
        except Exception as e:
            log.warning(f"퀀트 percentile 분포 갱신 실패 [{market}]: {e}")
