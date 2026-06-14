"""
Finnhub API — 미국 주식 실시간 데이터
https://finnhub.io — 무료 60 req/min
"""
import httpx
import time
from datetime import datetime, timedelta
from app.core.config import settings
from app.core.cache import cache

BASE = "https://finnhub.io/api/v1"

PERIOD_TO_DAYS = {
    "1m": 30, "3m": 90, "6m": 180, "1y": 365,
    "2y": 730, "5y": 1825, "10y": 3650, "max": 3650,
}

RESOLUTION_MAP = {
    "1m": "D", "3m": "D", "6m": "D", "1y": "D",
    "2y": "W", "5y": "W", "10y": "M", "max": "M",
}


class FinnhubService:
    @property
    def _configured(self) -> bool:
        return bool(settings.FINNHUB_API_KEY)

    def _get(self, endpoint: str, params: dict = {}) -> dict | list:
        params = {**params, "token": settings.FINNHUB_API_KEY}
        try:
            r = httpx.get(f"{BASE}{endpoint}", params=params, timeout=10)
            return r.json()
        except Exception:
            return {}

    # ── 실시간 시세 ────────────────────────────────────
    def get_quote(self, symbol: str) -> dict | None:
        if not self._configured:
            return None
        ck = f"fh:quote:{symbol}"
        if c := cache.get(ck):
            return c
        d = self._get("/quote", {"symbol": symbol})
        if not d or d.get("c") in (None, 0):
            return cache.get_stale(ck)
        pc = float(d.get("pc", 0))
        curr = float(d.get("c", 0))
        change = curr - pc
        result = {
            "symbol":      symbol,
            "price":       round(curr, 2),
            "prev_close":  round(pc, 2),
            "open":        round(float(d.get("o", 0)), 2),
            "high":        round(float(d.get("h", 0)), 2),
            "low":         round(float(d.get("l", 0)), 2),
            "change":      round(change, 2),
            "change_rate": round(float(d.get("dp", 0)), 2),
            "currency":    "USD",
        }
        cache.set(ck, result, 15)  # 15초 캐시 (실시간)
        return result

    # ── 회사 프로필 ────────────────────────────────────
    def get_profile(self, symbol: str) -> dict:
        if not self._configured:
            return {}
        ck = f"fh:profile:{symbol}"
        if c := cache.get(ck):
            return c
        d = self._get("/stock/profile2", {"symbol": symbol})
        result = {
            "name":     d.get("name"),
            "exchange": d.get("exchange"),
            "industry": d.get("finnhubIndustry"),
            "market_cap": d.get("marketCapitalization", 0),  # 백만 달러 단위
            "logo":     d.get("logo"),
            "website":  d.get("weburl"),
            "currency": d.get("currency", "USD"),
            "country":  d.get("country"),
        }
        cache.set(ck, result, 3600)
        return result

    # ── 기본 재무 지표 ─────────────────────────────────
    def get_metrics(self, symbol: str) -> dict:
        if not self._configured:
            return {}
        ck = f"fh:metrics:{symbol}"
        if c := cache.get(ck):
            return c
        d = self._get("/stock/metric", {"symbol": symbol, "metric": "all"})
        m = d.get("metric", {})
        def _sf(v):
            if v is None: return None
            try:
                import math
                f = float(v)
                return None if (math.isnan(f) or math.isinf(f) or f == 0) else f
            except Exception:
                return None
        mc_millions = _sf(m.get("marketCapitalization"))
        ev_millions = _sf(m.get("enterpriseValue"))
        result = {
            "per":            _sf(m.get("peBasicExclExtraTTM") or m.get("peTTM")),
            "forward_per":    _sf(m.get("forwardPE")),
            "peg":            _sf(m.get("pegNormalizedAnnual") or m.get("peg5YExpected")),
            "pbr":            _sf(m.get("pbAnnual") or m.get("pbQuarterly")),
            "psr":            _sf(m.get("psAnnual") or m.get("psTTM")),
            "ev_ebitda":      _sf(m.get("evEbitdaAnnual") or m.get("evEbitdaTTM")),
            "ev_revenue":     _sf(m.get("evRevenueAnnual") or m.get("evRevenueTTM")),
            "market_cap":     int(mc_millions * 1_000_000) if mc_millions else None,
            "enterprise_value": int(ev_millions * 1_000_000) if ev_millions else None,
            "roe":            _sf(m.get("roeTTM") or m.get("roeRfy")),
            "roa":            _sf(m.get("roaTTM") or m.get("roaRfy")),
            "op_margin":      _sf(m.get("operatingMarginAnnual") or m.get("operatingMarginTTM")),
            "net_margin":     _sf(m.get("netProfitMarginAnnual") or m.get("netProfitMarginTTM")),
            "gross_margin":   _sf(m.get("grossMarginAnnual") or m.get("grossMarginTTM")),
            "eps":            _sf(m.get("epsBasicExclExtraItemsTTM") or m.get("epsTTM")),
            "current_ratio":  _sf(m.get("currentRatioAnnual") or m.get("currentRatioQuarterly")),
            "quick_ratio":    _sf(m.get("quickRatioAnnual") or m.get("quickRatioQuarterly")),
            "debt_ratio":     _sf(m.get("totalDebt/totalEquityAnnual") or m.get("longTermDebt/equityAnnual")),
            "week52_high":    _sf(m.get("52WeekHigh")),
            "week52_low":     _sf(m.get("52WeekLow")),
            "dividend_yield": _sf(m.get("dividendYieldIndicatedAnnual")),
            "beta":           _sf(m.get("beta")),
        }
        cache.set(ck, result, 3600)
        return result

    # ── 애널리스트 목표가 ───────────────────────────────
    def get_price_target(self, symbol: str) -> dict:
        if not self._configured:
            return {}
        ck = f"fh:pt:{symbol}"
        if c := cache.get(ck):
            return c
        d = self._get("/stock/price-target", {"symbol": symbol})
        if not isinstance(d, dict) or not d.get("targetMean"):
            return {}
        result = {
            "mean":   d.get("targetMean"),
            "high":   d.get("targetHigh"),
            "low":    d.get("targetLow"),
            "median": d.get("targetMedian"),
        }
        cache.set(ck, result, 21600)  # 6시간
        return result

    # ── 애널리스트 추천 동향 (최신월) ────────────────────
    def get_recommendation_trends(self, symbol: str) -> dict:
        if not self._configured:
            return {}
        ck = f"fh:rec:{symbol}"
        if c := cache.get(ck):
            return c
        d = self._get("/stock/recommendation", {"symbol": symbol})
        if not isinstance(d, list) or not d:
            return {}
        row = d[0]
        result = {
            "strong_buy":  int(row.get("strongBuy", 0) or 0),
            "buy":         int(row.get("buy", 0) or 0),
            "hold":        int(row.get("hold", 0) or 0),
            "sell":        int(row.get("sell", 0) or 0),
            "strong_sell": int(row.get("strongSell", 0) or 0),
            "period":      row.get("period", ""),
        }
        cache.set(ck, result, 21600)  # 6시간
        return result

    # ── OHLCV 차트 데이터 ───────────────────────────────
    def get_candles(self, symbol: str, period: str = "1y", resolution: str = "") -> list:
        if not self._configured:
            return []
        if not resolution:
            resolution = RESOLUTION_MAP.get(period, "D")
        ck = f"fh:candle:{symbol}:{period}:{resolution}"
        if c := cache.get(ck):
            return c
        days = PERIOD_TO_DAYS.get(period, 365)
        now = int(time.time())
        start = now - days * 86400
        d = self._get("/stock/candle", {
            "symbol": symbol, "resolution": resolution,
            "from": start, "to": now,
        })
        if d.get("s") != "ok":
            return cache.get_stale(ck) or []
        result = []
        ts_list = d.get("t", [])
        for i in range(len(ts_list)):
            dt = datetime.fromtimestamp(ts_list[i]).strftime("%Y-%m-%d")
            result.append({
                "date":   dt,
                "open":   round(float(d["o"][i]), 2),
                "high":   round(float(d["h"][i]), 2),
                "low":    round(float(d["l"][i]), 2),
                "close":  round(float(d["c"][i]), 2),
                "volume": int(d["v"][i]),
            })
        cache.set(ck, result, 300)
        return result

    # ── 미국 주식 상세 (통합) ──────────────────────────
    def get_stock_detail(self, symbol: str) -> dict:
        # 3개 요청 병렬 실행 (순차 900ms+ → 병렬 300ms)
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=3) as ex:
            fq = ex.submit(self.get_quote,   symbol)
            fp = ex.submit(self.get_profile, symbol)
            fm = ex.submit(self.get_metrics, symbol)
            quote   = fq.result() or {}
            profile = fp.result() or {}
            metrics = fm.result() or {}
        mc_raw = profile.get("market_cap", 0) or 0
        return {
            **quote,
            "name":           profile.get("name") or quote.get("name", symbol),
            "exchange":       profile.get("exchange"),
            "sector":         profile.get("industry"),
            "market_cap":     int(mc_raw * 1_000_000),  # 백만 → 실제값
            "per":            metrics.get("per"),
            "pbr":            metrics.get("pbr"),
            "psr":            metrics.get("psr"),
            "forward_per":    metrics.get("forward_per"),
            "peg":            metrics.get("peg"),
            "ev_ebitda":      metrics.get("ev_ebitda"),
            "ev_revenue":     metrics.get("ev_revenue"),
            "enterprise_value": metrics.get("enterprise_value"),
            "roe":            metrics.get("roe"),
            "roa":            metrics.get("roa"),
            "op_margin":      metrics.get("op_margin"),
            "net_margin":     metrics.get("net_margin"),
            "gross_margin":   metrics.get("gross_margin"),
            "eps":            metrics.get("eps"),
            "current_ratio":  metrics.get("current_ratio"),
            "quick_ratio":    metrics.get("quick_ratio"),
            "debt_ratio":     metrics.get("debt_ratio"),
            "week52_high":    metrics.get("week52_high"),
            "week52_low":     metrics.get("week52_low"),
            "dividend_yield": metrics.get("dividend_yield"),
            "beta":           metrics.get("beta"),
            "currency":       profile.get("currency", "USD"),
        }


    # ── 종목 검색 ──────────────────────────────────────
    def search(self, query: str) -> list[dict]:
        """Finnhub 심볼 검색 — 미국 전 종목 대상"""
        if not self._configured:
            return []
        ck = f"fh:search:{query.lower()}"
        if c := cache.get(ck):
            return c
        d = self._get("/search", {"q": query})
        results = []
        for item in (d.get("result") or [])[:20]:
            sym = item.get("symbol", "")
            desc = item.get("description", "")
            typ = item.get("type", "")
            # 미국 주식/ETF만 필터 (점 없는 심볼 = 미국)
            if not sym or "." in sym:
                continue
            market = "ETF" if typ == "ETP" else "US"
            results.append({
                "symbol":   sym,
                "name":     desc,
                "market":   market,
                "exchange": item.get("displaySymbol", sym),
                "type":     typ,
                "price":    None,
                "change_rate": None,
                "currency": "USD",
            })
        cache.set(ck, results, 300)
        return results


finnhub_service = FinnhubService()
