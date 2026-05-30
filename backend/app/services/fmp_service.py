"""
FMP (Financial Modeling Prep) — 해외 재무제표
https://financialmodelingprep.com — 무료 250 req/day
"""
import httpx
from app.core.config import settings
from app.core.cache import cache

BASE = "https://financialmodelingprep.com/api/v3"


class FMPService:
    @property
    def _configured(self) -> bool:
        return bool(settings.FMP_API_KEY)

    def _get(self, endpoint: str, params: dict = {}) -> list | dict:
        params = {**params, "apikey": settings.FMP_API_KEY}
        try:
            r = httpx.get(f"{BASE}{endpoint}", params=params, timeout=12)
            return r.json()
        except Exception:
            return []

    # ── 실시간 시세 ────────────────────────────────────
    def get_quote(self, symbol: str) -> dict | None:
        if not self._configured:
            return None
        ck = f"fmp:quote:{symbol}"
        if c := cache.get(ck):
            return c
        data = self._get(f"/quote/{symbol}")
        if not data or not isinstance(data, list):
            return cache.get_stale(ck)
        q = data[0]
        result = {
            "symbol":      symbol,
            "name":        q.get("name"),
            "price":       q.get("price"),
            "prev_close":  q.get("previousClose"),
            "open":        q.get("open"),
            "high":        q.get("dayHigh"),
            "low":         q.get("dayLow"),
            "change":      q.get("change"),
            "change_rate": q.get("changesPercentage"),
            "volume":      q.get("volume"),
            "market_cap":  q.get("marketCap"),
            "per":         q.get("pe"),
            "eps":         q.get("eps"),
            "week52_high": q.get("yearHigh"),
            "week52_low":  q.get("yearLow"),
            "exchange":    q.get("exchange"),
            "currency":    "USD",
        }
        cache.set(ck, result, 15)
        return result

    # ── 회사 프로필 ────────────────────────────────────
    def get_profile(self, symbol: str) -> dict:
        if not self._configured:
            return {}
        ck = f"fmp:profile:{symbol}"
        if c := cache.get(ck):
            return c
        data = self._get(f"/profile/{symbol}")
        if not data or not isinstance(data, list):
            return {}
        p = data[0]
        result = {
            "name":          p.get("companyName"),
            "sector":        p.get("sector"),
            "industry":      p.get("industry"),
            "exchange":      p.get("exchangeShortName"),
            "website":       p.get("website"),
            "description":   p.get("description"),
            "country":       p.get("country"),
            "currency":      p.get("currency", "USD"),
            "logo":          p.get("image"),
            "ipo_date":      p.get("ipoDate"),
            "beta":          p.get("beta"),
        }
        cache.set(ck, result, 3600)
        return result

    # ── 손익계산서 (Income Statement) ─────────────────
    def get_income_statement(self, symbol: str, period: str = "annual", limit: int = 5) -> list:
        if not self._configured:
            return []
        ck = f"fmp:income:{symbol}:{period}:{limit}"
        if c := cache.get(ck):
            return c
        data = self._get(f"/income-statement/{symbol}", {"period": period, "limit": limit})
        if not isinstance(data, list):
            return cache.get_stale(ck) or []
        result = []
        for item in data:
            result.append({
                "period":     item.get("calendarYear") or item.get("date", "")[:7],
                "revenue":    item.get("revenue"),
                "op_income":  item.get("operatingIncome"),
                "net_income": item.get("netIncome"),
                "gross_profit": item.get("grossProfit"),
                "ebitda":     item.get("ebitda"),
                "eps":        item.get("eps"),
            })
        result.sort(key=lambda x: str(x["period"]))
        cache.set(ck, result, 3600)
        return result

    # ── 대차대조표 (Balance Sheet) ─────────────────────
    def get_balance_sheet(self, symbol: str, period: str = "annual", limit: int = 5) -> list:
        if not self._configured:
            return []
        ck = f"fmp:bs:{symbol}:{period}:{limit}"
        if c := cache.get(ck):
            return c
        data = self._get(f"/balance-sheet-statement/{symbol}", {"period": period, "limit": limit})
        if not isinstance(data, list):
            return cache.get_stale(ck) or []
        result = [
            {
                "period":      item.get("calendarYear") or item.get("date", "")[:7],
                "total_assets":       item.get("totalAssets"),
                "total_liabilities":  item.get("totalLiabilities"),
                "total_equity":       item.get("totalStockholdersEquity"),
                "cash":               item.get("cashAndCashEquivalents"),
                "total_debt":         item.get("totalDebt"),
            }
            for item in data
        ]
        result.sort(key=lambda x: str(x["period"]))
        cache.set(ck, result, 3600)
        return result

    # ── 통합 재무 (프론트에서 바로 사용) ──────────────
    def get_financials(self, symbol: str) -> dict:
        annual_inc = self.get_income_statement(symbol, "annual", 5)
        qtr_inc    = self.get_income_statement(symbol, "quarter", 8)
        return {
            "annual":    annual_inc,
            "quarterly": qtr_inc,
        }

    # ── 핵심 재무 지표 ─────────────────────────────────
    def get_key_metrics(self, symbol: str) -> dict:
        if not self._configured:
            return {}
        ck = f"fmp:metrics:{symbol}"
        if c := cache.get(ck):
            return c
        data = self._get(f"/key-metrics/{symbol}", {"limit": 1})
        if not data or not isinstance(data, list):
            return {}
        m = data[0]
        result = {
            "per":            m.get("peRatio"),
            "pbr":            m.get("pbRatio"),
            "roe":            m.get("roe"),
            "roa":            m.get("roa"),
            "debt_ratio":     m.get("debtToEquity"),
            "current_ratio":  m.get("currentRatio"),
            "dividend_yield": m.get("dividendYield"),
            "ev_ebitda":      m.get("enterpriseValueOverEBITDA"),
        }
        cache.set(ck, result, 3600)
        return result

    # ── 미국 주식 상세 통합 ────────────────────────────
    def get_stock_detail(self, symbol: str) -> dict:
        quote   = self.get_quote(symbol) or {}
        profile = self.get_profile(symbol) or {}
        metrics = self.get_key_metrics(symbol) or {}
        return {
            **quote,
            "name":           profile.get("name") or quote.get("name", symbol),
            "sector":         profile.get("sector"),
            "industry":       profile.get("industry"),
            "exchange":       profile.get("exchange"),
            "website":        profile.get("website"),
            "description":    profile.get("description"),
            "beta":           profile.get("beta"),
            "roe":            metrics.get("roe"),
            "roa":            metrics.get("roa"),
            "debt_ratio":     metrics.get("debt_ratio"),
            "current_ratio":  metrics.get("current_ratio"),
            "ev_ebitda":      metrics.get("ev_ebitda"),
            "dividend_yield": metrics.get("dividend_yield") or quote.get("dividend_yield"),
        }


fmp_service = FMPService()
