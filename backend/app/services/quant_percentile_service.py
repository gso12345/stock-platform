"""
퀀트 점수 상대평가용 — 시장별(KR/US/ETF) + 업종별 지표 백분위 분포를 일배치로
계산해 DB에 캐시한다. 요청 시점(quant-score 엔드포인트)에는 이 캐시를 조회해
이분 탐색만 수행하므로 "비교"로 인한 지연이 거의 없다. 분포 갱신 자체는
이미 펀더멘털 일일 갱신 주기(scheduler.refresh_fundamentals_daily)에 맞춰
DB에 캐시된 종목들의 기존 데이터만 재사용하므로 추가 외부 API 호출이
늘어나지 않는다(모멘텀 지표만 yfinance OHLCV 캐시를 통해 조회).

저장 구조: {"market": {metric_key: [sorted_value, ...]}, "sector": {sector_name: {metric_key: [...]}}}
PER/PBR/EV-EBITDA처럼 업종별로 정상 범위가 크게 다른 지표(SECTOR_RELATIVE_METRICS)는
업종 내 분포를 별도로 모아두고, quant_score.compute_quant_score가 업종 표본이
충분하면 우선 사용하도록 한다.
"""
import asyncio
import logging
from app.db.database import SessionLocal
from app.models.stock import QuantPercentileCache
from app.core.cache import cache as mem_cache
from app.services.quant_score import METRIC_DEFS, collect_quant_metrics, SECTOR_RELATIVE_METRICS, MIN_SECTOR_SAMPLES

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


def _load(market: str) -> dict:
    """in-memory(1시간) → DB. 일배치로만 갱신되는 값이라 요청 시점엔 조회만 한다."""
    ck = f"quant_pct:{market}"
    cached = mem_cache.get(ck)
    if cached is not None:
        return cached
    data = _db_get(market) or {}
    mem_cache.set(ck, data, 3600)
    return data


def get_percentile_distributions(market: str) -> dict:
    """시장 전체 분포 {metric_key: [sorted_value, ...]}"""
    return _load(market).get("market", {})


def get_sector_distribution(market: str, sector: str | None) -> dict:
    """같은 시장+업종 분포 {metric_key: [sorted_value, ...]} — 업종 정보 없으면 빈 dict"""
    if not sector:
        return {}
    return (_load(market).get("sector") or {}).get(sector, {})


async def rebuild_market_distribution(market: str, symbols: list[str]) -> dict:
    """symbols의 캐시된 지표값을 모아 시장 전체 + 업종별 percentile 분포를 재계산한다.
    fundamentals_service/yf_service가 캐시 우선이라 이미 조회된 종목은
    추가 외부 호출 없이 즉시 반환되며, 미캐시 종목은 자연스럽게 건너뛴다."""
    samples: dict[str, list[float]] = {k: [] for k in ALL_METRIC_KEYS}
    sector_samples: dict[str, dict[str, list[float]]] = {}

    sem = asyncio.Semaphore(16)

    async def _one(symbol: str):
        async with sem:
            try:
                return await collect_quant_metrics(symbol, market, fetch_ohlcv=True)
            except Exception:
                return None

    results = await asyncio.gather(*[_one(s) for s in symbols])

    for metrics in results:
        if not metrics:
            continue
        sector = metrics.pop("_sector", None)
        for k, v in metrics.items():
            if v is None or k not in samples:
                continue
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            samples[k].append(fv)
            if sector and k in SECTOR_RELATIVE_METRICS:
                sector_samples.setdefault(sector, {}).setdefault(k, []).append(fv)

    market_data = {k: sorted(vals) for k, vals in samples.items() if len(vals) >= MIN_SAMPLES}
    sector_data = {
        sector: {k: sorted(vals) for k, vals in metric_map.items() if len(vals) >= MIN_SECTOR_SAMPLES}
        for sector, metric_map in sector_samples.items()
    }
    sector_data = {sector: m for sector, m in sector_data.items() if m}

    data = {"market": market_data, "sector": sector_data}
    if market_data:
        _db_set(market, data)
        mem_cache.set(f"quant_pct:{market}", data, 3600)
    log.info(
        f"퀀트 percentile 분포 갱신 [{market}] — "
        + ", ".join(f"{k}:{len(v)}" for k, v in market_data.items())
        + f" / 업종 {len(sector_data)}개"
        if market_data else f"퀀트 percentile 분포 갱신 [{market}] — 표본 부족"
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
