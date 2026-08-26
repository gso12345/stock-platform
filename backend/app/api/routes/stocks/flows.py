"""수급(외국인·기관·개인)과 ETF 구성.

원래 stocks.py 한 파일에 있던 것을 탭 단위로 가른 조각이다.
공용 폴백·시한 처리는 _공용 에 있다.
"""
from ._공용 import (   # noqa: F401  — 쪼개기 전과 같은 이름을 쓴다
    APIRouter, Path, Query, HTTPException, Request, Depends, Literal,
    asyncio, logging, re, log, QMETRICS_TTL, _퀀트갱신중, _퀀트지표_뒤로미루기, Session,
    kis_service, finnhub_service, dart_service, yf_service,
    _resolve_kr_symbol, get_demo_price, get_demo_ohlcv, DEMO_PRICES,
    get_fdr_price, get_kr_db, compute_quant_score, DEFAULT_WEIGHTS, settings,
    cache, _safe_float, get_current_user, require_user, get_db,
    QuantScoreWeight, limiter, router_새로, _SYMBOL_PATTERN, _run, _시한내결과,
    get_kr_price, get_us_price,
)

router = router_새로()

@router.get("/KR/{symbol}/supply-demand")
@limiter.limit("10/minute")
async def get_supply_demand(request: Request, symbol: str = Path(..., pattern=_SYMBOL_PATTERN), days: int = Query(default=30, ge=1, le=365)):
    """수급 데이터 (외국인/기관/개인) — pykrx"""
    from app.core.cache import cache
    from datetime import datetime, timedelta
    ck = f"supply:{symbol}:{days}"
    if c := cache.get(ck):
        return c
    def _fetch():
        try:
            from app.core import pykrx_light
            pkrx = pykrx_light.stock()
            code = symbol.replace(".KS","").replace(".KQ","")
            end   = datetime.today().strftime("%Y%m%d")
            start = (datetime.today() - timedelta(days=days+10)).strftime("%Y%m%d")
            df = pkrx.get_market_trading_value_by_date(start, end, code)
            if df is None or df.empty:
                return []
            df = df.tail(days)
            rows = []
            for idx, row in df.iterrows():
                rows.append({
                    "date":        str(idx.date()),
                    "foreign":     int(row.get("외국인합계", row.get("외국인", 0)) or 0),
                    "institution": int(row.get("기관합계", row.get("기관", 0)) or 0),
                    "individual":  int(row.get("개인", 0) or 0),
                    "total":       int(row.get("전체", 0) or 0),
                })
            return rows
        except Exception:
            return []
    result = await _run(_fetch)
    cache.set(ck, result, 600)
    return result


@router.get("/ETF/{symbol}/holdings")
@limiter.limit("10/minute")
async def get_etf_holdings(request: Request, symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """ETF 보유비중 — yfinance funds_data (상위 25종목 + 섹터 비중)"""
    ck = f"etf_holdings:{symbol}"
    if c := cache.get(ck):
        return c

    def _fetch():
        try:
            import yfinance as yf
            # 숫자로만 이루어진 심볼 → 한국 ETF (예: 069500 → 069500.KS)
            yf_symbol = symbol
            if symbol.replace("-", "").isdigit():
                yf_symbol = symbol + ".KS"
            ticker = yf.Ticker(yf_symbol)
            result: dict = {"holdings": [], "sector_weights": []}

            def _to_pct(v) -> float:
                """fraction(0-1) 또는 이미 퍼센트(>1)인 값을 % 단위로 통일"""
                try:
                    f = float(v or 0)
                    return f * 100 if abs(f) <= 1.5 else f
                except Exception:
                    return 0.0

            # funds_data.top_holdings (올바른 속성명)
            # sector_weightings는 Dict[str, float] — DataFrame 아님
            try:
                fd = ticker.funds_data
                if fd is not None:
                    th = getattr(fd, "top_holdings", None)
                    if th is not None and hasattr(th, "iterrows") and not th.empty:
                        rows = []
                        for sym_idx, row in th.iterrows():
                            rows.append({
                                "symbol": str(sym_idx) if sym_idx else "",
                                "name": str(row.get("Name", sym_idx) or sym_idx),
                                "pct": _to_pct(row.get("Holding Percent", 0)),
                                "value": 0.0,
                            })
                        result["holdings"] = sorted(rows, key=lambda x: x["pct"], reverse=True)[:25]

                    sw = getattr(fd, "sector_weightings", None)
                    if sw and isinstance(sw, dict):
                        result["sector_weights"] = sorted(
                            [{"sector": k, "pct": _to_pct(v)} for k, v in sw.items()],
                            key=lambda x: x["pct"], reverse=True
                        )
            except Exception:
                pass

            # 폴백: info dict
            if not result["holdings"]:
                try:
                    info = ticker.info
                    raw = info.get("holdings") or []
                    if raw:
                        result["holdings"] = sorted([
                            {
                                "symbol": h.get("symbol", ""),
                                "name": h.get("holdingName", ""),
                                "pct": _to_pct(h.get("holdingPercent", 0)),
                                "value": 0.0,
                            }
                            for h in raw
                        ], key=lambda x: x["pct"], reverse=True)

                    if not result["sector_weights"]:
                        for d in (info.get("sectorWeightings") or []):
                            for k, v in d.items():
                                result["sector_weights"].append({"sector": k, "pct": _to_pct(v)})
                        result["sector_weights"].sort(key=lambda x: x["pct"], reverse=True)
                except Exception:
                    pass

            return result
        except Exception:
            return {"holdings": [], "sector_weights": []}

    def _fetch_kr_holdings() -> dict:
        """국내 ETF 구성종목 — KRX 에 직접 묻는다.

        처음에는 pykrx 를 썼는데 응답을 못 읽고 죽었다:
            UnicodeDecodeError: 'utf-8' codec can't decode byte 0xea ...
                                unexpected end of data
        pykrx 는 이 조회를 http:// 로 하고 자체 세션을 쓴다. 그쪽으로 오는
        응답이 중간에 끊겨(한글 한 글자가 잘린 채) 들어온 것이다.

        같은 데이터를 이 앱은 이미 다른 곳에서 잘 받고 있다 — krx_listing 이
        https 로, 브라우저처럼 보이는 헤더를 달아 종목 목록을 받아 온다.
        그 방식을 그대로 쓴다.

        KRX 는 종목을 6자리 코드가 아니라 ISIN 으로 받으므로 두 번 묻는다.
          1) MDCSTAT04601  ETF 전종목 기본정보 → 6자리 ↔ ISIN (하루 캐시)
          2) MDCSTAT05001  PDF(구성종목)      → 종목·비중·금액
        """
        import httpx

        code = symbol.replace(".KS", "").replace(".KQ", "")
        if not code.isdigit():
            return {"holdings": [], "sector_weights": []}

        URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
        HEADERS = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd",
        }

        def _행들(payload: dict, client: httpx.Client) -> list[dict]:
            """KRX 는 결과 배열의 이름이 화면마다 다르다(output/block1/OutBlock_1)."""
            r = client.post(URL, headers=HEADERS, data=payload, timeout=10)
            r.raise_for_status()
            j = r.json()
            for k in ("output", "block1", "OutBlock_1"):
                if isinstance(j.get(k), list):
                    return j[k]
            return []

        try:
            with httpx.Client(follow_redirects=True) as client:
                # 1) 6자리 → ISIN. 전 종목을 한 번에 받아 하루 동안 재사용한다
                isin_map = cache.get("krx_etf_isin") or {}
                if not isin_map:
                    for row in _행들({"bld": "dbms/MDC/STAT/standard/MDCSTAT04601"}, client):
                        짧은 = str(row.get("ISU_SRT_CD") or "").strip()
                        긴 = str(row.get("ISU_CD") or "").strip()
                        if 짧은 and 긴:
                            isin_map[짧은] = 긴
                    if isin_map:
                        cache.set("krx_etf_isin", isin_map, 86400)

                isin = isin_map.get(code)
                if not isin:
                    log.warning("ETF ISIN 없음 %s — 상장 ETF 목록에 없다", code)
                    return {"holdings": [], "sector_weights": [],
                            "reason": "상장 ETF 목록에서 못 찾음"}

                # 2) PDF. 전 영업일 기준으로 올라오므로 어제부터 며칠 물러간다
                from datetime import datetime, timedelta
                어제 = datetime.today() - timedelta(days=1)
                행 = []
                for 뒤로 in range(0, 5):
                    ymd = (어제 - timedelta(days=뒤로)).strftime("%Y%m%d")
                    행 = _행들({"bld": "dbms/MDC/STAT/standard/MDCSTAT05001",
                               "date": ymd, "isin": isin}, client)
                    if 행:
                        break

            if not 행:
                log.warning("ETF 구성종목 없음 %s — KRX 가 빈 표를 준다", code)
                return {"holdings": [], "sector_weights": [],
                        "reason": "한국거래소에 아직 공시된 구성내역이 없습니다"}

            def _수(v) -> float:
                try:
                    return float(str(v).replace(",", "").strip() or 0)
                except Exception:
                    return 0.0

            rows = []
            for it in 행:
                비중 = _수(it.get("COMPST_RTO"))
                if 비중 <= 0:
                    continue          # 현금·원화예금 등
                구성코드 = str(it.get("COMPST_ISU_CD") or "").strip()
                rows.append({
                    "symbol": 구성코드 if 구성코드.isdigit() else "",
                    # 이름을 KRX 가 같이 준다 — 종목마다 따로 물을 필요가 없다
                    "name": str(it.get("COMPST_ISU_NM") or 구성코드).strip(),
                    "pct": 비중,
                    "value": _수(it.get("COMPST_AMT")),
                })
            rows.sort(key=lambda x: x["pct"], reverse=True)
            log.info("ETF 구성종목 %s: %d개", code, len(rows))
            return {"holdings": rows[:25], "sector_weights": []}

        except Exception as e:
            # 조용히 빈 값을 주면 화면에는 '데이터가 없습니다' 만 뜨고
            # 무엇이 잘못됐는지 알 길이 없다
            log.warning("ETF 구성종목 조회 실패 %s: %s: %s", code, type(e).__name__, e)
            return {"holdings": [], "sector_weights": [],
                    "reason": "한국거래소에서 자료를 받지 못했습니다"}

    빈결과 = {"holdings": [], "sector_weights": []}
    """야후가 늦으면 15초에서 잘린다. 예전에는 그 자리에서 예외가 그대로
       올라가 500 이 났고, 화면에는 '불러올 수 없습니다' 가 떴다 — 사실은
       '아직 못 받았다' 인데. 국내 폴백까지 붙으면서 시간이 더 늘었으므로
       각 단계를 따로 감싸고, 늦으면 빈 결과로 넘어간다."""
    try:
        result = await _run(_fetch)
    except Exception:
        result = dict(빈결과)

    # 국내 ETF 는 야후가 비워서 보내는 일이 잦다 — 그때만 KRX 를 본다
    if not result.get("holdings") and symbol.replace(".KS", "").replace(".KQ", "").isdigit():
        try:
            result = await _run(_fetch_kr_holdings)
        except Exception:
            result = dict(빈결과)

    # 데이터가 있으면 1시간, 없으면 5분 캐시 (재시도 빠르게)
    cache.set(ck, result, 3600 if (result["holdings"] or result["sector_weights"]) else 300)
    return result
