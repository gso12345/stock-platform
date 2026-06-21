"""
펀더멘털 & 재무제표 서비스
- DB 캐시 우선 조회 (신선 → stale → 외부 API)
- 결과를 DB에 저장하여 이후 즉시 응답 가능
- 스케줄러에서 배치 갱신 호출
"""
import asyncio
import math
import logging
from datetime import datetime, timedelta

from app.db.database import SessionLocal
from app.models.stock import FundamentalsCache, FinancialsCache
from app.core.cache import cache
from app.core.config import settings

log = logging.getLogger(__name__)

FUND_FRESH_H = 24    # 펀더멘털 신선 기준: 24시간
FUND_STALE_H = 720   # 30일까지는 stale로 사용
FIN_FRESH_H  = 6     # 재무제표 신선 기준: 6시간
FIN_STALE_H  = 168   # 7일까지는 stale로 사용


# ── DB 읽기/쓰기 ──────────────────────────────────────────────

def _now():
    return datetime.utcnow()


def _db_get(model, symbol: str, market: str, max_age_h: float) -> dict | None:
    db = SessionLocal()
    try:
        row = db.query(model).filter(
            model.symbol == symbol,
            model.market == market,
        ).first()
        if not row or not row.data:
            return None
        if row.fetched_at is None:
            return row.data
        age = _now() - row.fetched_at
        if age > timedelta(hours=max_age_h):
            return None
        return row.data
    except Exception as e:
        log.debug(f"DB 읽기 실패 {symbol}: {e}")
        return None
    finally:
        db.close()


def _db_set(model, symbol: str, market: str, data: dict):
    if not data:
        return
    db = SessionLocal()
    try:
        row = db.query(model).filter(
            model.symbol == symbol,
            model.market == market,
        ).first()
        if row:
            row.data = data
            row.fetched_at = _now()
        else:
            row = model(symbol=symbol, market=market, data=data, fetched_at=_now())
            db.add(row)
        db.commit()
    except Exception as e:
        db.rollback()
        log.debug(f"DB 저장 실패 {symbol}: {e}")
    finally:
        db.close()


def get_all_fund_symbols() -> list[tuple[str, str]]:
    """펀더멘털 DB 캐시에 저장된 모든 (symbol, market)"""
    db = SessionLocal()
    try:
        rows = db.query(FundamentalsCache.symbol, FundamentalsCache.market).all()
        return [(r.symbol, r.market) for r in rows]
    except Exception:
        return []
    finally:
        db.close()


# ── 외부 API Fetch 로직 ───────────────────────────────────────

async def _fetch_fund(symbol: str, market: str) -> dict:
    from app.services.yf_service import yf_service
    loop = asyncio.get_running_loop()

    if market == "KR":
        from app.services.price_fetcher import fetch_naver_stock
        code6 = symbol.replace(".KS", "").replace(".KQ", "")
        naver_fund: dict = {}
        try:
            naver = await asyncio.wait_for(fetch_naver_stock(code6), timeout=8)
            if naver:
                naver_fund = {
                    k: naver[k] for k in
                    ("per", "pbr", "eps", "bps", "dividend_yield", "week52_high", "week52_low", "market_cap",
                     "forward_per", "forward_eps")
                    if naver.get(k) is not None
                }
        except Exception:
            pass
        try:
            yf_sym = symbol if symbol.endswith((".KS", ".KQ")) else f"{code6}.KS"
            yf_fund = await asyncio.wait_for(
                loop.run_in_executor(None, yf_service.get_fundamentals, yf_sym, "KR"),
                timeout=15,
            )
        except Exception:
            yf_fund = {}
        return {**(yf_fund or {}), **naver_fund}

    # US / ETF
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(None, yf_service.get_fundamentals, symbol, market),
            timeout=20,
        ) or {}
    except Exception:
        return {}


async def _fetch_fin(symbol: str, market: str) -> dict:
    loop = asyncio.get_running_loop()

    if market == "KR":
        if settings.DART_API_KEY:
            from app.services.dart_service import dart_service
            try:
                r = await asyncio.wait_for(
                    loop.run_in_executor(None, dart_service.get_financials, symbol), timeout=15
                )
                if r and (r.get("annual") or r.get("quarterly")):
                    return r
            except Exception:
                pass
    else:
        if settings.FMP_API_KEY:
            from app.services.fmp_service import fmp_service
            try:
                r = await asyncio.wait_for(
                    loop.run_in_executor(None, fmp_service.get_financials, symbol), timeout=15
                )
                if r and (r.get("annual") or r.get("quarterly")):
                    return r
            except Exception:
                pass

    return await _yf_financials(symbol, market)


async def _yf_financials(symbol: str, market: str) -> dict:
    import yfinance as yf
    from app.services.yf_service import _resolve_kr_symbol
    yf_sym = _resolve_kr_symbol(symbol, "KS") if market == "KR" else symbol

    def _fetch():
        t = yf.Ticker(yf_sym)
        result = {"annual": [], "quarterly": []}

        def sv(df, row, col):
            try:
                v = df.loc[row, col]
                f = float(v)
                return int(f) if not (math.isnan(f) or math.isinf(f)) else None
            except Exception:
                return None

        pairs = [
            ("financials", "cashflow", "balance_sheet", "annual"),
            ("quarterly_financials", "quarterly_cashflow", "quarterly_balance_sheet", "quarterly"),
        ]
        for (fa, ca, ba, key) in pairs:
            try:
                fin = getattr(t, fa, None)
                cf  = getattr(t, ca, None)
                bal = getattr(t, ba, None)
                if fin is None or fin.empty:
                    continue
                rows = []
                for col in fin.columns:
                    period = str(col)[:10]
                    rd = {
                        "period":       period,
                        "revenue":      sv(fin, "Total Revenue", col),
                        "op_income":    sv(fin, "Operating Income", col) or sv(fin, "EBIT", col),
                        "net_income":   sv(fin, "Net Income", col),
                        "gross_profit": sv(fin, "Gross Profit", col),
                        "ebit":         sv(fin, "EBIT", col),
                        "ebitda":       sv(fin, "EBITDA", col),
                        "eps":          sv(fin, "Diluted EPS", col) or sv(fin, "Basic EPS", col),
                    }
                    if cf is not None and not cf.empty and col in cf.columns:
                        rd["operating_cf"] = sv(cf, "Operating Cash Flow", col) or sv(cf, "Total Cash From Operating Activities", col)
                        rd["investing_cf"] = sv(cf, "Investing Cash Flow", col) or sv(cf, "Total Cash From Investing Activities", col)
                        rd["financing_cf"] = sv(cf, "Financing Cash Flow", col) or sv(cf, "Total Cash From Financing Activities", col)
                        rd["capex"]         = sv(cf, "Capital Expenditure", col)
                        fcf, cap = rd.get("operating_cf"), rd.get("capex")
                        rd["free_cf"] = (fcf + cap) if fcf and cap else None
                    if bal is not None and not bal.empty and col in bal.columns:
                        rd["total_debt"]   = sv(bal, "Total Debt", col)
                        rd["total_equity"] = sv(bal, "Stockholders Equity", col) or sv(bal, "Common Stock Equity", col)
                        rd["total_assets"] = sv(bal, "Total Assets", col)
                        rd["cash"]         = sv(bal, "Cash And Cash Equivalents", col) or \
                                              sv(bal, "Cash Cash Equivalents And Short Term Investments", col)
                    rev = rd.get("revenue")
                    if rev:
                        if rd.get("gross_profit"):
                            rd["gross_margin"] = round(rd["gross_profit"] / rev * 100, 2)
                        if rd.get("op_income"):
                            rd["op_margin"] = round(rd["op_income"] / rev * 100, 2)
                        if rd.get("net_income"):
                            rd["net_margin"] = round(rd["net_income"] / rev * 100, 2)
                    # 펀더멘털 API(yfinance .info)에 debtToEquity/returnOnAssets가
                    # 없는 종목(특히 국내 종목)을 위한 재무제표 기반 자체 계산
                    if rd.get("total_debt") is not None and rd.get("total_equity"):
                        rd["debt_ratio"] = round(rd["total_debt"] / rd["total_equity"] * 100, 2)
                    if rd.get("net_income") is not None and rd.get("total_assets"):
                        rd["roa"] = round(rd["net_income"] / rd["total_assets"] * 100, 2)
                    if rd.get("net_income") is not None and rd.get("total_equity"):
                        rd["roe"] = round(rd["net_income"] / rd["total_equity"] * 100, 2)
                    rows.append(rd)
                result[key] = sorted(rows, key=lambda x: x["period"])
            except Exception:
                pass
        return result

    try:
        return await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, _fetch), timeout=30
        )
    except Exception:
        return {"annual": [], "quarterly": []}


# ── 공개 API: 캐시 계층 통합 ──────────────────────────────────

async def get_fundamentals(symbol: str, market: str) -> dict:
    """in-memory → DB fresh → DB stale(+bg갱신) → 외부 API fetch"""
    ck = f"fund:{symbol}"

    if fresh := cache.get(ck):
        return fresh

    db_fresh = _db_get(FundamentalsCache, symbol, market, FUND_FRESH_H)
    if db_fresh:
        cache.set(ck, db_fresh, 86400)
        return db_fresh

    db_stale = _db_get(FundamentalsCache, symbol, market, FUND_STALE_H)
    if db_stale:
        cache.set(ck, db_stale, 3600)
        asyncio.create_task(_bg_fund(symbol, market))
        return db_stale

    mem_stale = cache.get_stale(ck)

    result = await _fetch_fund(symbol, market)
    if result:
        cache.set(ck, result, 86400)
        _db_set(FundamentalsCache, symbol, market, result)
        return result

    return mem_stale or {}


async def get_financials(symbol: str, market: str) -> dict:
    """in-memory → DB fresh → DB stale(+bg갱신) → 외부 API fetch"""
    ck = f"financials:{symbol}"

    if fresh := cache.get(ck):
        return fresh

    db_fresh = _db_get(FinancialsCache, symbol, market, FIN_FRESH_H)
    if db_fresh:
        cache.set(ck, db_fresh, 3600)
        return db_fresh

    db_stale = _db_get(FinancialsCache, symbol, market, FIN_STALE_H)
    if db_stale:
        cache.set(ck, db_stale, 1800)
        asyncio.create_task(_bg_fin(symbol, market))
        return db_stale

    mem_stale = cache.get_stale(ck)

    result = await _fetch_fin(symbol, market)
    if result and (result.get("annual") or result.get("quarterly")):
        cache.set(ck, result, 3600)
        _db_set(FinancialsCache, symbol, market, result)
        return result

    return mem_stale or {"annual": [], "quarterly": []}


async def _bg_fund(symbol: str, market: str):
    try:
        r = await _fetch_fund(symbol, market)
        if r:
            cache.set(f"fund:{symbol}", r, 86400)
            _db_set(FundamentalsCache, symbol, market, r)
    except Exception:
        pass


async def _bg_fin(symbol: str, market: str):
    try:
        r = await _fetch_fin(symbol, market)
        if r and (r.get("annual") or r.get("quarterly")):
            cache.set(f"financials:{symbol}", r, 3600)
            _db_set(FinancialsCache, symbol, market, r)
    except Exception:
        pass


# ── 배치 갱신 (스케줄러 호출) ─────────────────────────────────

async def batch_refresh(symbols: list[tuple[str, str]]):
    """(symbol, market) 목록을 순차 갱신 (rate limit 고려 0.8s 간격)"""
    ok_fund = ok_fin = 0
    for symbol, market in symbols:
        # 펀더멘털
        try:
            r = await _fetch_fund(symbol, market)
            if r:
                _db_set(FundamentalsCache, symbol, market, r)
                cache.set(f"fund:{symbol}", r, 86400)
                ok_fund += 1
        except Exception as e:
            log.debug(f"배치 펀더멘털 실패 {symbol}: {e}")
        await asyncio.sleep(0.8)

        # 재무제표
        try:
            r = await _fetch_fin(symbol, market)
            if r and (r.get("annual") or r.get("quarterly")):
                _db_set(FinancialsCache, symbol, market, r)
                cache.set(f"financials:{symbol}", r, 3600)
                ok_fin += 1
        except Exception as e:
            log.debug(f"배치 재무제표 실패 {symbol}: {e}")
        await asyncio.sleep(0.8)

    log.info(f"배치 갱신 완료 — 펀더멘털 {ok_fund}개 · 재무제표 {ok_fin}개 / 전체 {len(symbols)}개")
    return ok_fund, ok_fin
