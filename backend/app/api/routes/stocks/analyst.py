"""실적과 투자의견.

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

@router.get("/{market}/{symbol}/earnings")
@limiter.limit("20/minute")
async def get_earnings(request: Request, market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """실적발표 일정 및 과거 실적 (yfinance)"""
    from app.core.cache import cache
    ck = f"earnings:{symbol}"
    if c := cache.get(ck):
        return c

    import yfinance as yf
    yf_sym = _resolve_kr_symbol(symbol, "KS") if market == "KR" else symbol

    def _fetch():
        try:
            t = yf.Ticker(yf_sym)
            result = {"history": [], "upcoming": []}

            # 과거 실적
            try:
                earn = t.earnings
                if earn is not None and not earn.empty:
                    for idx, row in earn.iterrows():
                        result["history"].append({
                            "period": str(idx),
                            "revenue": int(row.get("Revenue", 0) or 0),
                            "earnings": int(row.get("Earnings", 0) or 0),
                        })
            except Exception:
                pass

            # 향후 실적 발표 일정
            try:
                cal = t.calendar
                if cal is not None and isinstance(cal, dict):
                    ed = cal.get("Earnings Date")
                    if ed:
                        dates = ed if isinstance(ed, list) else [ed]
                        for dt in dates:
                            result["upcoming"].append(str(dt)[:10] if dt else "")
                    result["eps_estimate"] = cal.get("EPS Estimate")
                    result["revenue_estimate"] = cal.get("Revenue Estimate")
            except Exception:
                pass

            return result
        except Exception:
            return {"history": [], "upcoming": []}

    result = await _run(_fetch)
    cache.set(ck, result, 3600)
    return result


# yfinance recommendationKey → 한글 라벨 (전용 컨센서스 모듈이 비어있을 때 보조 소스로 사용)
_REC_KEY_LABEL = {
    "strong_buy": "강력매수", "buy": "매수", "outperform": "매수", "overweight": "매수",
    "hold": "보유", "neutral": "보유", "market_perform": "보유", "equal_weight": "보유",
    "sell": "매도", "underperform": "매도", "underweight": "매도",
    "strong_sell": "강력매도",
}


@router.get("/{market}/{symbol}/analyst")
@limiter.limit("10/minute")
async def get_analyst(request: Request, market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """애널리스트 투자의견 — 목표주가, 의견분포, 최근 리포트
    in-memory → DB fresh(24h) → DB stale(30일, +백그라운드 갱신) → 외부 API 순으로 조회.
    DB에 영속 저장해 Render 재시작으로 메모리 캐시가 비워져도 데이터가 사라지지 않게 한다."""
    from app.core.cache import cache
    from app.models.stock import AnalystCache
    from app.services.fundamentals_service import _db_get, _db_set
    ck = f"analyst:v3:{symbol}"
    if c := cache.get(ck):
        return c

    db_fresh = await _run(_db_get, AnalystCache, symbol, market, 24)
    if db_fresh:
        cache.set(ck, db_fresh, 86400)
        return db_fresh

    db_stale = await _run(_db_get, AnalystCache, symbol, market, 720)  # 30일까지는 stale로 사용
    stale_analyst = db_stale or cache.get_stale(ck)
    if db_stale:
        cache.set(ck, db_stale, 3600)

    import yfinance as yf
    yf_sym = _resolve_kr_symbol(symbol, "KS") if market == "KR" else symbol
    code6 = symbol.replace(".KS","").replace(".KQ","") if market == "KR" else ""

    def _fetch():
        from app.core.executor import detail_executor

        # 3개 yfinance 속성을 병렬로 조회 (순차 실행 시 15s 타임아웃 → 병렬 시 ~4s)
        def _get_apt():
            try:
                return yf.Ticker(yf_sym).analyst_price_targets
            except Exception:
                return None

        def _get_rs():
            try:
                return yf.Ticker(yf_sym).recommendations_summary
            except Exception:
                return None

        def _get_ud():
            try:
                return yf.Ticker(yf_sym).upgrades_downgrades
            except Exception:
                return None

        def _get_fund():
            try:
                return yf_service.get_fundamentals(yf_sym, market)
            except Exception:
                return None

        # Finnhub 목표주가/추천동향 — 국내 종목은 미지원이라 KR 제외
        def _get_fh_pt():
            if market == "KR":
                return None
            try:
                return finnhub_service.get_price_target(yf_sym)
            except Exception:
                return None

        def _get_fh_rec():
            if market == "KR":
                return None
            try:
                return finnhub_service.get_recommendation_trends(yf_sym)
            except Exception:
                return None

        # 요청마다 새 풀을 만들면 시한을 넘긴 작업의 스레드가 그대로 쌓인다
        # (app/core/executor.py 참고). 크기가 정해진 공용 풀에 얹는다.
        f_apt  = detail_executor.submit(_get_apt)
        f_rs   = detail_executor.submit(_get_rs)
        f_ud   = detail_executor.submit(_get_ud)
        f_fund = detail_executor.submit(_get_fund)
        f_fhpt = detail_executor.submit(_get_fh_pt)
        f_fhrec= detail_executor.submit(_get_fh_rec)
        apt, rs, ud, fund, fh_pt, fh_rec = (
            _시한내결과(f, 12)
            for f in (f_apt, f_rs, f_ud, f_fund, f_fhpt, f_fhrec)
        )

        result: dict = {}

        # 목표주가
        if apt and isinstance(apt, dict):
            result["price_targets"] = {
                "current": _safe_float(apt.get("current")),
                "mean":    _safe_float(apt.get("mean")),
                "median":  _safe_float(apt.get("median")),
                "high":    _safe_float(apt.get("high")),
                "low":     _safe_float(apt.get("low")),
            }

        # 투자의견 분포 (현재월)
        try:
            if rs is not None and not rs.empty:
                row = rs[rs["period"] == "0m"]
                if row.empty:
                    row = rs.iloc[[0]]
                r = row.iloc[0]
                result["consensus"] = {
                    "strong_buy":  int(r.get("strongBuy", 0) or 0),
                    "buy":         int(r.get("buy", 0) or 0),
                    "hold":        int(r.get("hold", 0) or 0),
                    "sell":        int(r.get("sell", 0) or 0),
                    "strong_sell": int(r.get("strongSell", 0) or 0),
                }
                history = []
                for _, hr in rs.iterrows():
                    history.append({
                        "period":      hr.get("period", ""),
                        "strong_buy":  int(hr.get("strongBuy", 0) or 0),
                        "buy":         int(hr.get("buy", 0) or 0),
                        "hold":        int(hr.get("hold", 0) or 0),
                        "sell":        int(hr.get("sell", 0) or 0),
                        "strong_sell": int(hr.get("strongSell", 0) or 0),
                    })
                result["consensus_history"] = history
        except Exception:
            pass

        # 최근 애널리스트 리포트 (최대 30개)
        try:
            if ud is not None and not ud.empty:
                reports = []
                for dt, row in ud.head(30).iterrows():
                    reports.append({
                        "date":         str(dt)[:10],
                        "firm":         str(row.get("Firm", "") or ""),
                        "to_grade":     str(row.get("ToGrade", "") or ""),
                        "from_grade":   str(row.get("FromGrade", "") or ""),
                        "action":       str(row.get("Action", "") or ""),
                        "price_action": str(row.get("priceTargetAction", "") or ""),
                        "target":       _safe_float(row.get("currentPriceTarget")),
                        "prior_target": _safe_float(row.get("priorPriceTarget")),
                    })
                result["reports"] = reports
        except Exception:
            pass

        # 목표주가/투자의견 보완 — 전용 컨센서스 모듈(apt/rs)이 비어있을 때
        # 펀더멘털(yfinance info)에 들어있는 컨센서스 값으로 대체 (국내 종목 등에서 자주 발생)
        if fund:
            if not result.get("price_targets") and fund.get("target_price_mean"):
                price_cached = cache.get(f"price:{symbol}") or cache.get_stale(f"price:{symbol}") or {}
                result["price_targets"] = {
                    "current": price_cached.get("price"),
                    "mean":    fund.get("target_price_mean"),
                    "high":    fund.get("target_price_high"),
                    "low":     fund.get("target_price_low"),
                }
            if not result.get("consensus") and fund.get("recommendation"):
                rec_label = _REC_KEY_LABEL.get(str(fund.get("recommendation","")).lower())
                if rec_label:
                    nc = result.setdefault("naver_consensus", {})
                    nc.setdefault("recommendation", rec_label)
                    if fund.get("analyst_count"):
                        nc.setdefault("analyst_count", int(fund["analyst_count"]))

        # 목표주가/투자의견 추가 보완 — yfinance에서 아무것도 못 얻었을 때 Finnhub로 대체
        if not result.get("price_targets") and fh_pt:
            price_cached = cache.get(f"price:{symbol}") or cache.get_stale(f"price:{symbol}") or {}
            result["price_targets"] = {
                "current": price_cached.get("price"),
                "mean":    fh_pt.get("mean"),
                "high":    fh_pt.get("high"),
                "low":     fh_pt.get("low"),
                "median":  fh_pt.get("median"),
            }
        if not result.get("consensus") and fh_rec:
            result["consensus"] = {
                "strong_buy":  fh_rec.get("strong_buy", 0),
                "buy":         fh_rec.get("buy", 0),
                "hold":        fh_rec.get("hold", 0),
                "sell":        fh_rec.get("sell", 0),
                "strong_sell": fh_rec.get("strong_sell", 0),
            }

        return result

    # KR 종목: Naver 컨센서스 목표주가 + 애널리스트 의견 직접 조회
    async def _fetch_kr_analyst() -> dict:
        """네이버 통합(integration) API의 totalInfos에서 목표주가·투자의견 항목을 값의
        패턴으로 탐지해 조회한다 (전용 consensusOpinion/opinion/consensus 엔드포인트는
        더 이상 응답하지 않아 제거됨 — 가격 조회에도 쓰이는 integration 엔드포인트를 재사용)"""
        import httpx, math, re
        headers = {
            "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/80.0 Mobile Safari/537.36",
            "Referer": "https://m.stock.naver.com/",
        }

        def _sf(v):
            try:
                f = float(str(v).replace(",",""))
                return None if (math.isnan(f) or math.isinf(f)) else f
            except Exception:
                return None

        # "4.04매수" / "3.50중립" 같은 투자의견 점수+등급 패턴
        _opinion_re = re.compile(r"^(\d(?:\.\d{1,2})?)\s*(적극매수|매수|중립|보유|매도|적극매도)$")
        _grade_to_label = {
            "적극매수": "강력매수", "매수": "매수", "중립": "보유", "보유": "보유",
            "매도": "매도", "적극매도": "강력매도",
        }

        try:
            loop = asyncio.get_running_loop()
            r = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: httpx.get(
                    f"https://m.stock.naver.com/api/stock/{code6}/integration",
                    headers=headers, timeout=8,
                )), timeout=10
            )
            if r.status_code != 200:
                return {}
            infos = r.json().get("totalInfos") or []

            out: dict = {}
            opinion_score = opinion_grade = None
            target_price = None

            for item in infos:
                name = str(item.get("name") or "")
                code = str(item.get("code") or "")
                value = str(item.get("value") or "").strip()
                if not value:
                    continue

                m = _opinion_re.match(value.replace(" ", ""))
                if m:
                    opinion_score = _sf(m.group(1))
                    opinion_grade = m.group(2)
                    continue

                if ("목표" in name and "주가" in name) or "target" in code.lower() or "goal" in code.lower():
                    tv = _sf(value)
                    if tv:
                        target_price = tv

            if target_price:
                price_src = cache.get(f"price:{yf_sym}") or cache.get_stale(f"price:{yf_sym}") or {}
                out["price_targets"] = {
                    "current": price_src.get("price"),
                    "mean":    target_price,
                }

            if opinion_grade:
                nc = out.setdefault("naver_consensus", {})
                nc["recommendation"] = _grade_to_label.get(opinion_grade, opinion_grade)
                if opinion_score is not None:
                    nc["score"] = opinion_score

            return out
        except Exception:
            return {}

    if stale_analyst:
        # stale 캐시(메모리 또는 DB) 즉시 반환, 백그라운드에서 갱신 + DB 영속 저장
        async def _bg_analyst():
            try:
                loop2 = asyncio.get_running_loop()
                r2 = await asyncio.wait_for(loop2.run_in_executor(None, _fetch), timeout=20)
                if market == "KR":
                    naver_r = await _fetch_kr_analyst()
                    r2 = {**r2, **naver_r}
                _enrich_analyst_fallback(r2, yf_sym, market)
                _fill_analyst_gaps(r2, stale_analyst)
                if r2:
                    cache.set(ck, r2, 86400)
                    await _run(_db_set, AnalystCache, symbol, market, r2)
            except Exception:
                pass
        asyncio.get_running_loop().create_task(_bg_analyst())
        return stale_analyst

    try:
        result = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, _fetch),
            timeout=20
        )
    except Exception:
        result = {}

    # KR 종목: Naver 컨센서스 목표주가·의견 보완
    if market == "KR":
        naver_analyst = await _fetch_kr_analyst()
        # Naver 데이터를 우선, yfinance로 보완
        result = {**result, **naver_analyst}

    _enrich_analyst_fallback(result, yf_sym, market)
    _fill_analyst_gaps(result, stale_analyst)

    if result:
        cache.set(ck, result, 86400)
        await _run(_db_set, AnalystCache, symbol, market, result)
    elif stale_analyst:
        return stale_analyst
    return result or {}


def _fill_analyst_gaps(result: dict, stale: dict | None):
    """이번 조회에서 타임아웃 등으로 빠진 항목을 이전 캐시 값으로 채워 정확도 유지 (새 값이 우선)"""
    if not stale:
        return
    for k, v in stale.items():
        if not result.get(k) and v:
            result[k] = v


def _enrich_analyst_fallback(result: dict, symbol: str, market: str):
    """price/fund 캐시로 투자의견·목표주가 보완 — 1차 조회가 비어있을 때 모든 시장 공통 폴백"""
    from app.core.cache import cache
    fund_cached  = cache.get(f"fund:{symbol}") or cache.get_stale(f"fund:{symbol}")
    price_cached = cache.get(f"price:{symbol}") or cache.get_stale(f"price:{symbol}")
    for src in [fund_cached, price_cached]:
        if not src:
            continue
        if not result.get("price_targets"):
            tp_mean = src.get("target_price_mean")
            curr    = src.get("price")
            if tp_mean:
                result["price_targets"] = {
                    "current": curr,
                    "mean":    tp_mean,
                    "high":    src.get("target_price_high"),
                    "low":     src.get("target_price_low"),
                }
        if src.get("forward_per") or src.get("recommendation"):
            nc = result.setdefault("naver_consensus", {})
            if nc.get("cons_per") is None and src.get("forward_per"):
                nc["cons_per"] = src.get("forward_per")
                nc["cons_eps"] = src.get("forward_eps")
            if nc.get("recommendation") is None:
                rec_label = _REC_KEY_LABEL.get(str(src.get("recommendation","")).lower())
                if rec_label:
                    nc["recommendation"] = rec_label
            if src.get("analyst_count"):
                nc.setdefault("analyst_count", src.get("analyst_count"))
