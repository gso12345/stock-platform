"""
한국투자증권 KIS OpenAPI
- 국내 주식 실시간 시세
- 지수 (KOSPI, KOSDAQ)
- 상승/하락 상위 종목
"""
import httpx
import asyncio
from datetime import datetime, timedelta
from typing import Optional
from app.core.config import settings
from app.core.cache import cache

BASE_REAL = "https://openapi.koreainvestment.com:9443"
BASE_MOCK = "https://openapivts.koreainvestment.com:29443"


class KISService:
    def __init__(self):
        self.base = BASE_REAL if settings.KIS_IS_REAL else BASE_MOCK
        self._token: Optional[str] = None
        self._token_exp: Optional[datetime] = None

    @property
    def _configured(self) -> bool:
        return bool(settings.KIS_APP_KEY and settings.KIS_APP_SECRET)

    async def _get_token(self) -> Optional[str]:
        if not self._configured:
            return None
        if self._token and self._token_exp and datetime.now() < self._token_exp:
            return self._token
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(f"{self.base}/oauth2/tokenP", json={
                "grant_type": "client_credentials",
                "appkey": settings.KIS_APP_KEY,
                "appsecret": settings.KIS_APP_SECRET,
            })
            d = r.json()
            self._token = d.get("access_token")
            self._token_exp = datetime.now() + timedelta(hours=23)
            return self._token

    def _headers(self, token: str, tr_id: str) -> dict:
        return {
            "authorization": f"Bearer {token}",
            "appkey": settings.KIS_APP_KEY,
            "appsecret": settings.KIS_APP_SECRET,
            "tr_id": tr_id,
            "content-type": "application/json; charset=utf-8",
        }

    # ── 현재가 ─────────────────────────────────────────
    async def get_price(self, symbol: str) -> Optional[dict]:
        if not self._configured:
            return None
        ck = f"kis:price:{symbol}"
        if c := cache.get(ck):
            return c
        token = await self._get_token()
        if not token:
            return None
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(
                    f"{self.base}/uapi/domestic-stock/v1/quotations/inquire-price",
                    headers=self._headers(token, "FHKST01010100"),
                    params={"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": symbol},
                )
                o = r.json().get("output", {})
                result = {
                    "symbol": symbol,
                    "name": o.get("hts_kor_isnm", symbol),
                    "price": float(o.get("stck_prpr", 0)),
                    "prev_close": float(o.get("stck_sdpr", 0)),
                    "open": float(o.get("stck_oprc", 0)),
                    "high": float(o.get("stck_hgpr", 0)),
                    "low": float(o.get("stck_lwpr", 0)),
                    "change": float(o.get("prdy_vrss", 0)),
                    "change_rate": float(o.get("prdy_ctrt", 0)),
                    "volume": int(o.get("acml_vol", 0)),
                    "amount": int(o.get("acml_tr_pbmn", 0)),   # 거래대금
                    "market_cap": int(o.get("hts_avls", 0)),
                    "per": float(o.get("per", 0) or 0),
                    "pbr": float(o.get("pbr", 0) or 0),
                    "eps": float(o.get("eps", 0) or 0),
                    "week52_high": float(o.get("d252hgpr", 0) or 0),
                    "week52_low": float(o.get("d252lwpr", 0) or 0),
                    "currency": "KRW",
                }
                cache.set(ck, result, 5)   # 5초 캐시 (실시간)
                return result
        except Exception:
            return cache.get_stale(ck)

    # ── OHLCV ──────────────────────────────────────────
    async def get_ohlcv(self, symbol: str, period: str = "1y") -> list:
        if not self._configured:
            return []
        ck = f"kis:ohlcv:{symbol}:{period}"
        if c := cache.get(ck):
            return c
        token = await self._get_token()
        if not token:
            return []
        period_map = {
            "1m": 30, "3m": 90, "6m": 180, "1y": 365,
            "2y": 730, "5y": 1825, "10y": 3650, "max": 3650,
        }
        days = period_map.get(period, 365)
        end = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{self.base}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
                    headers=self._headers(token, "FHKST03010100"),
                    params={
                        "FID_COND_MRKT_DIV_CODE": "J",
                        "FID_INPUT_ISCD": symbol,
                        "FID_INPUT_DATE_1": start,
                        "FID_INPUT_DATE_2": end,
                        "FID_PERIOD_DIV_CODE": "D",
                        "FID_ORG_ADJ_PRC": "0",
                    },
                )
                data = r.json().get("output2", [])
                result = [
                    {
                        "date": item["stck_bsop_date"],
                        "open":   float(item.get("stck_oprc", 0)),
                        "high":   float(item.get("stck_hgpr", 0)),
                        "low":    float(item.get("stck_lwpr", 0)),
                        "close":  float(item.get("stck_clpr", 0)),
                        "volume": int(item.get("acml_vol", 0)),
                    }
                    for item in data if item.get("stck_bsop_date")
                ]
                result.sort(key=lambda x: x["date"])
                cache.set(ck, result, 300)
                return result
        except Exception:
            return cache.get_stale(ck) or []

    # ── 지수 ───────────────────────────────────────────
    async def get_index(self, code: str, name: str, display: str) -> Optional[dict]:
        """code: 0001=KOSPI, 1001=KOSDAQ, 2001=코스피200"""
        if not self._configured:
            return None
        ck = f"kis:idx:{name}"
        if c := cache.get(ck):
            return c
        token = await self._get_token()
        if not token:
            return None
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(
                    f"{self.base}/uapi/domestic-stock/v1/quotations/inquire-index-price",
                    headers=self._headers(token, "FHPUP02100000"),
                    params={"FID_COND_MRKT_DIV_CODE": "U", "FID_INPUT_ISCD": code},
                )
                o = r.json().get("output", {})
                result = {
                    "index": name,
                    "name": display,
                    "value": float(o.get("bstp_nmix_prpr", 0)),
                    "change": float(o.get("bstp_nmix_prdy_vrss", 0)),
                    "change_rate": float(o.get("bstp_nmix_prdy_ctrt", 0)),
                    "volume": int(o.get("acml_vol", 0)),
                }
                cache.set(ck, result, 10)  # 10초 캐시
                return result
        except Exception:
            return cache.get_stale(ck)

    # ── 상승/하락 순위 ─────────────────────────────────
    async def get_top_movers(self, sort: str = "rise") -> list:
        if not self._configured:
            return []
        ck = f"kis:movers:{sort}"
        if c := cache.get(ck):
            return c
        token = await self._get_token()
        if not token:
            return []
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{self.base}/uapi/domestic-stock/v1/ranking/fluctuation",
                    headers=self._headers(token, "FHPST01700000"),
                    params={
                        "fid_cond_mrkt_div_code": "J",
                        "fid_cond_scr_div_code":  "20170",
                        "fid_input_iscd":         "0000",
                        "fid_rank_sort_cls_code":  "0" if sort == "rise" else "1",
                        "fid_input_cnt_1":         "0",
                        "fid_prc_cls_code":        "1",
                        "fid_input_price_1": "", "fid_input_price_2": "",
                        "fid_vol_cnt": "", "fid_trgt_cls_code": "0",
                        "fid_trgt_exls_cls_code": "0", "fid_div_cls_code": "0",
                        "fid_rsfl_rate1": "", "fid_rsfl_rate2": "",
                        "fid_aply_rang_prc_4": "", "fid_aply_rang_prc_5": "",
                    },
                )
                items = r.json().get("output", [])[:20]
                result = [
                    {
                        "rank":   i + 1,
                        "symbol": item.get("mksc_shrn_iscd", ""),
                        "name":   item.get("hts_kor_isnm", ""),
                        "price":  float(item.get("stck_prpr", 0)),
                        "change_rate": float(item.get("prdy_ctrt", 0)),
                        "volume": int(item.get("acml_vol", 0)),
                        "amount": int(item.get("acml_tr_pbmn", 0)),
                    }
                    for i, item in enumerate(items)
                ]
                cache.set(ck, result, 60)
                return result
        except Exception:
            return cache.get_stale(ck) or []

    # ── 종목 랭킹 (시가총액/거래대금 등) ──────────────
    async def get_rankings(self, category: str = "시가총액") -> list:
        sort_map = {
            "상승률": "rise", "하락률": "fall",
        }
        if category in ("상승률", "하락률"):
            return await self.get_top_movers(sort_map[category])

        # 시가총액/거래대금/거래량은 별도 API
        if not self._configured:
            return []
        ck = f"kis:rank:{category}"
        if c := cache.get(ck):
            return c
        token = await self._get_token()
        if not token:
            return []

        api_map = {
            "시가총액": ("FHPST01260000", "20"),  # 시가총액 순위
            "거래대금": ("FHPST01290000", "20"),  # 거래대금 순위
            "거래량":   ("FHPST01280000", "20"),  # 거래량 순위
        }
        tr_id, sort_code = api_map.get(category, ("FHPST01260000", "20"))

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{self.base}/uapi/domestic-stock/v1/ranking/market-cap",
                    headers=self._headers(token, tr_id),
                    params={
                        "fid_cond_mrkt_div_code": "J",
                        "fid_cond_scr_div_code": "20174",
                        "fid_input_iscd": "0000",
                        "fid_div_cls_code": "0",
                        "fid_blng_cls_code": "0",
                        "fid_trgt_cls_code": "0",
                        "fid_trgt_exls_cls_code": "0",
                        "fid_input_price_1": "", "fid_input_price_2": "",
                        "fid_vol_cnt": "",
                    },
                )
                items = r.json().get("output", [])[:20]
                result = [
                    {
                        "rank":   i + 1,
                        "symbol": item.get("mksc_shrn_iscd", ""),
                        "name":   item.get("hts_kor_isnm", ""),
                        "price":  float(item.get("stck_prpr", 0)),
                        "change_rate": float(item.get("prdy_ctrt", 0)),
                        "volume": int(item.get("acml_vol", 0)),
                        "amount": int(item.get("acml_tr_pbmn", 0)),
                        "market_cap": int(item.get("stck_avls", 0)),
                    }
                    for i, item in enumerate(items)
                ]
                cache.set(ck, result, 60)
                return result
        except Exception:
            return cache.get_stale(ck) or []


kis_service = KISService()
