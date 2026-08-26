"""재무지표 추이와 컨센서스 — 분기에 한 번 바뀌는 값이라 DB 에도 남긴다.

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

@router.get("/{market}/{symbol}/metrics-history")
@limiter.limit("6/minute")
async def get_metrics_history(request: Request, market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """재무지표 연간/분기별 추이 (yfinance)

    메모리 → DB fresh(24시간) → DB stale(30일) → 외부 API 순으로 본다.

    이 화면 하나가 야후에 재무제표 6종을 한꺼번에 물어본다. 종목상세에서
    가장 무거운 호출인데 예전에는 메모리 캐시만 써서, 프로세스가
    재시작되면(무료 플랜에서는 잦다) 그 6번을 처음부터 다시 했다.
    재무제표는 분기에 한 번 바뀌므로 하루 지난 값도 충분히 쓸 만하다."""
    from app.core.cache import cache
    from app.models.stock import MetricsHistoryCache
    from app.services.fundamentals_service import _db_get, _db_set
    ck = f"metrics_hist5:{symbol}"  # v5: DART 첫 연도 성장률 보완
    if c := cache.get(ck):
        return c

    db_fresh = await _run(_db_get, MetricsHistoryCache, symbol, market, 24)
    if db_fresh:
        cache.set(ck, db_fresh, 3600)
        return db_fresh

    db_stale = await _run(_db_get, MetricsHistoryCache, symbol, market, 720)  # 30일까지 stale 허용
    _stale_mh = db_stale or cache.get_stale(ck)

    import yfinance as yf
    yf_sym = _resolve_kr_symbol(symbol, "KS") if market == "KR" else symbol

    def _process(fin_df, bal_df, shares, hist):
        """income + balance sheet 결합하여 지표 dict 반환"""
        rows: dict = {}

        def sv(df, row, col):
            try:
                v = df.loc[row, col]
                return float(v) if v == v and v is not None else None
            except Exception:
                return None

        if fin_df is not None and not fin_df.empty:
            for col in fin_df.columns:
                p = str(col)[:10]
                rows.setdefault(p, {"period": p})
                rev          = sv(fin_df, "Total Revenue", col)
                op           = sv(fin_df, "Operating Income", col) or sv(fin_df, "EBIT", col)
                net          = sv(fin_df, "Net Income", col)
                gross        = sv(fin_df, "Gross Profit", col)
                ebit         = sv(fin_df, "EBIT", col) or op
                interest_exp = sv(fin_df, "Interest Expense", col)
                # EPS: DataFrame 직접 읽기 (현재 주식수보다 정확, 주식분할·자사주 영향 없음)
                eps_df       = sv(fin_df, "Diluted EPS", col) or sv(fin_df, "Basic EPS", col)
                rows[p]["revenue"]    = int(rev) if rev else None
                rows[p]["op_income"]  = int(op)  if op  else None
                rows[p]["net_income"] = int(net) if net else None
                if rev and op:    rows[p]["op_margin"]    = round(op / rev * 100, 2)
                if rev and net:   rows[p]["net_margin"]   = round(net / rev * 100, 2)
                if rev and gross: rows[p]["gross_margin"] = round(gross / rev * 100, 2)
                if eps_df is not None:
                    rows[p]["eps"] = round(eps_df, 2)
                elif net and shares:
                    rows[p]["eps"] = round(net / shares, 2)
                if ebit and interest_exp and interest_exp != 0:
                    rows[p]["interest_coverage"] = round(ebit / abs(interest_exp), 2)

        if bal_df is not None and not bal_df.empty:
            for col in bal_df.columns:
                p = str(col)[:10]
                rows.setdefault(p, {"period": p})
                equity       = sv(bal_df, "Stockholders Equity", col) or sv(bal_df, "Common Stock Equity", col)
                debt         = sv(bal_df, "Total Debt", col)
                total_assets = sv(bal_df, "Total Assets", col)
                cash         = sv(bal_df, "Cash And Cash Equivalents", col) or \
                               sv(bal_df, "Cash Cash Equivalents And Short Term Investments", col)
                cur_a   = sv(bal_df, "Current Assets", col)
                cur_l   = sv(bal_df, "Current Liabilities", col)
                inv     = sv(bal_df, "Inventory", col)
                net     = rows[p].get("net_income")
                if equity and equity != 0:
                    rows[p]["equity"]    = int(equity)
                    if net:   rows[p]["roe"]       = round(net / equity * 100, 2)
                    if debt:  rows[p]["debt_ratio"] = round(debt / equity * 100, 2)
                    if shares:rows[p]["bps"]        = round(equity / shares, 2)
                if total_assets:
                    rows[p]["total_assets"] = int(total_assets)
                    if net is not None: rows[p]["roa"] = round(net / total_assets * 100, 2)
                if debt and cash:
                    rows[p]["net_debt"] = int(debt - cash)
                if cur_a and cur_l and cur_l != 0:
                    rows[p]["current_ratio"] = round(cur_a / cur_l, 2)
                    if inv: rows[p]["quick_ratio"] = round((cur_a - inv) / cur_l, 2)

        # 해당 기간 말 주가로 PER/PBR/PSR 계산
        if hist is not None and not hist.empty:
            import pandas as pd
            for p, row in rows.items():
                try:
                    p_date = pd.Timestamp(p)
                    # 기간 말 이전 가장 가까운 종가
                    past = hist[hist.index <= p_date]
                    if past.empty:
                        continue
                    close = float(past["Close"].iloc[-1])
                    row["period_close"] = round(close, 2)
                    if row.get("eps") and row["eps"] != 0:
                        row["per"] = round(close / row["eps"], 2)
                    if row.get("bps") and row["bps"] != 0:
                        row["pbr"] = round(close / row["bps"], 2)
                    rev = row.get("revenue")
                    if rev and rev != 0 and shares:
                        row["psr"] = round(close / (rev / shares), 2)
                except Exception:
                    pass

        return sorted(rows.values(), key=lambda x: x["period"])

    # ── _process와 같은 레벨 (get_metrics_history 스코프) ──────────

    def _add_growth(sorted_list: list):
        """YoY 성장률 계산 — 이미 정렬된 rows 리스트에 in-place 추가"""
        for i, row in enumerate(sorted_list):
            if i == 0:
                continue
            prev = sorted_list[i - 1]
            for key, gkey in [
                ("revenue",    "revenue_growth"),
                ("op_income",  "op_income_growth"),
                ("net_income", "net_income_growth"),
                ("eps",        "eps_growth"),
            ]:
                cv, pv = row.get(key), prev.get(key)
                if cv and pv and pv != 0:
                    row[gkey] = round((cv - pv) / abs(pv) * 100, 2)
            # PEG 보완 — PER ÷ EPS 성장률(%) (quant_score.py의 PEG 계산과 동일한 정의)
            if row.get("peg") is None and row.get("per") and row.get("eps_growth"):
                if row["eps_growth"] > 0:
                    row["peg"] = round(row["per"] / row["eps_growth"], 2)

    def _process_cf(cf_df) -> dict:
        """현금흐름 DataFrame → {period: {operating_cf, ...}} dict"""
        result: dict = {}
        if cf_df is None or cf_df.empty:
            return result
        for col in cf_df.columns:
            p = str(col)[:10]
            result.setdefault(p, {"period": p})

            def sv(name, _col=col, _df=cf_df):
                try:
                    v = _df.loc[name, _col]
                    return int(float(v)) if v == v and v is not None else None
                except Exception:
                    return None

            op    = sv("Operating Cash Flow")
            inv   = sv("Investing Cash Flow")
            fin   = sv("Financing Cash Flow")
            capex = sv("Capital Expenditure")
            da    = sv("Depreciation And Amortization") or sv("Depreciation Amortization Depletion")
            fcf   = sv("Free Cash Flow")

            if op    is not None: result[p]["operating_cf"] = op
            if inv   is not None: result[p]["investing_cf"] = inv
            if fin   is not None: result[p]["financing_cf"] = fin
            if capex is not None: result[p]["capex"] = capex
            if da    is not None: result[p]["da"] = da
            if fcf   is not None:
                result[p]["free_cf"] = fcf
            elif op is not None and capex is not None:
                result[p]["free_cf"] = op + capex
        return result

    def _fetch():
        try:
            t = yf.Ticker(yf_sym)
            shares = None

            # 1차: fast_info (IP 차단에 강함)
            try:
                fi = t.fast_info
                shares = float(getattr(fi, "shares", None) or 0) or None
            except Exception:
                pass

            # 2차: info (느리지만 fallback)
            if not shares:
                try:
                    shares = float(t.info.get("sharesOutstanding") or 0) or None
                except Exception:
                    pass

            # 3차: KR 종목은 market_cap / price 로 추정
            if not shares and market == "KR":
                try:
                    fi2 = t.fast_info
                    mc = getattr(fi2, "market_cap", None)
                    lp = getattr(fi2, "last_price", None)
                    if mc and lp and lp > 0:
                        shares = mc / lp
                except Exception:
                    pass

            hist = None
            try:
                # PER/PBR/PSR 계산용 주가 이력 — 6년으로 2020년부터 커버
                hist = t.history(period="6y", interval="1mo")
                if hist.index.tz is not None:
                    hist.index = hist.index.tz_localize(None)
            except Exception:
                pass

            # 재무 DataFrame 6종을 공용 풀에서 병렬 조회
            from app.core.executor import detail_executor

            def _get(attr):
                try:
                    return getattr(yf.Ticker(yf_sym), attr)
                except Exception:
                    return None

            _futures = {attr: detail_executor.submit(_get, attr) for attr in (
                "financials", "balance_sheet",
                "quarterly_financials", "quarterly_balance_sheet",
                "cashflow", "quarterly_cashflow",
            )}
            dfs = {attr: _시한내결과(fut, 20) for attr, fut in _futures.items()}

            annual    = _process(dfs["financials"],          dfs["balance_sheet"],          shares, hist)
            quarterly = _process(dfs["quarterly_financials"], dfs["quarterly_balance_sheet"], shares, hist)

            # YoY 성장률 추가
            _add_growth(annual)
            _add_growth(quarterly)

            # KR 종목: DART로 연간 첫 해 성장률 보완
            # yfinance가 최신 4년만 반환하면 가장 오래된 해(예: 2022)에 이전 연도 데이터가 없어
            # 성장률을 계산할 수 없음 — DART 5년 데이터로 전년도 수치를 가져와 보완
            if market == "KR" and annual:
                first = annual[0]
                has_growth = any(first.get(k) for k in ["revenue_growth", "op_income_growth", "net_income_growth"])
                has_data = any(first.get(k) for k in ["revenue", "op_income", "net_income"])
                if not has_growth and has_data:
                    first_year = first.get("period", "")[:4]
                    try:
                        dart_annual = dart_service.get_financials(symbol).get("annual", [])
                        prev_year = str(int(first_year) - 1)
                        prev = next((r for r in dart_annual if str(r.get("period", ""))[:4] == prev_year), None)
                        if prev:
                            for key, gkey in [
                                ("revenue",    "revenue_growth"),
                                ("op_income",  "op_income_growth"),
                                ("net_income", "net_income_growth"),
                            ]:
                                cv, pv = first.get(key), prev.get(key)
                                if cv and pv and pv != 0:
                                    first[gkey] = round((cv - pv) / abs(pv) * 100, 2)
                    except Exception:
                        pass

            # 현금흐름 병합
            try:
                cf_a = _process_cf(dfs["cashflow"])
                for row in annual:
                    row.update({k: v for k, v in cf_a.get(row["period"], {}).items() if k != "period"})
            except Exception:
                pass
            try:
                cf_q = _process_cf(dfs["quarterly_cashflow"])
                for row in quarterly:
                    row.update({k: v for k, v in cf_q.get(row["period"], {}).items() if k != "period"})
            except Exception:
                pass

            return {"annual": annual, "quarterly": quarterly}
        except Exception:
            return {"annual": [], "quarterly": []}

    # stale-while-revalidate: return stale immediately, refresh in background
    if _stale_mh:
        async def _bg_refresh_mh():
            try:
                loop2 = asyncio.get_running_loop()
                r = await asyncio.wait_for(loop2.run_in_executor(None, _fetch), timeout=60)
                # 이번에 일부 기간/필드가 비어오면 이전 캐시값으로 보강 (정확도 유지)
                r = {
                    "annual":    _merge_forecast_lists(r.get("annual", []),    _stale_mh.get("annual", [])),
                    "quarterly": _merge_forecast_lists(r.get("quarterly", []), _stale_mh.get("quarterly", [])),
                }
                cache.set(ck, r, 3600)
                # DB 에도 남긴다 — 재시작해도 이 6번을 다시 하지 않도록
                await _run(_db_set, MetricsHistoryCache, symbol, market, r)
            except Exception:
                pass
        asyncio.get_running_loop().create_task(_bg_refresh_mh())
        return _stale_mh

    # 재무이력은 데이터가 많아 timeout을 60초로 늘림
    try:
        loop = asyncio.get_running_loop()
        result = await asyncio.wait_for(loop.run_in_executor(None, _fetch), timeout=60)
    except asyncio.TimeoutError:
        result = {"annual": [], "quarterly": []}
    if result.get("annual") or result.get("quarterly"):
        cache.set(ck, result, 3600)
        await _run(_db_set, MetricsHistoryCache, symbol, market, result)
    else:
        cache.set(ck, result, 60)  # 완전 실패 시 짧게 캐시해 빠른 재시도 허용
    return result


def _period_to_label(code: str) -> tuple[str, str] | None:
    """yfinance 상대 기간 코드(0q/+1q/-1y 등)를 실제 연도·분기 라벨로 변환
    반환: (라벨, "annual"|"quarterly") — 변환 불가/장기(±5y) 코드는 None
    """
    from datetime import datetime
    m = re.match(r"^([+-]?\d+)([qy])$", code)
    if not m:
        return None
    offset = int(m.group(1))
    unit = m.group(2)
    today = datetime.now()
    if unit == "y":
        if abs(offset) >= 5:
            return None
        return (str(today.year + offset), "annual")
    cur_q = (today.month - 1) // 3 + 1
    global_idx = today.year * 4 + (cur_q - 1) + offset
    return (f"{global_idx // 4}-Q{global_idx % 4 + 1}", "quarterly")


def _merge_forecast_lists(new_list: list, stale_list: list) -> list:
    """기간(period)별로 병합 — 새로 받아온 값을 우선하고, 이번에 타임아웃 등으로
    빠진 항목/필드는 이전 캐시 값으로 채워 정확도를 유지"""
    if not stale_list:
        return new_list
    stale_map = {item.get("period"): item for item in stale_list}
    seen = set()
    merged = []
    for item in new_list:
        period = item.get("period")
        seen.add(period)
        base = dict(stale_map.get(period, {}))
        base.update({k: v for k, v in item.items() if v is not None})
        merged.append(base)
    for period, item in stale_map.items():
        if period not in seen:
            merged.append(item)
    return sorted(merged, key=lambda x: x.get("period", ""))


@router.get("/{market}/{symbol}/forecasts")
@limiter.limit("10/minute")
async def get_forecasts(request: Request, market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """컨센서스 추정치 — 연간/분기별 매출·EPS·영업이익·순이익·EBITDA·성장률
    in-memory → DB fresh(24h) → DB stale(30일) → 외부 API 순으로 조회해
    Render 재시작으로 메모리 캐시가 비워져도 데이터가 바로 사라지지 않게 한다."""
    from app.core.cache import cache
    from app.models.stock import ForecastsCache
    from app.services.fundamentals_service import _db_get, _db_set
    ck = f"forecasts:v3:{symbol}"
    if c := cache.get(ck):
        return c

    db_fresh = await _run(_db_get, ForecastsCache, symbol, market, 24)
    if db_fresh:
        cache.set(ck, db_fresh, 3600)
        return db_fresh

    db_stale = await _run(_db_get, ForecastsCache, symbol, market, 720)  # 30일까지는 stale로 사용
    stale = db_stale or cache.get_stale(ck)

    import yfinance as yf
    yf_sym = _resolve_kr_symbol(symbol, "KS") if market == "KR" else symbol

    def _fetch():
        from app.core.executor import detail_executor

        # 4개 yfinance 속성을 병렬로 조회 (각각 별도 Ticker 인스턴스)
        def _get_ee():
            try:
                return yf.Ticker(yf_sym).earnings_estimate
            except Exception:
                return None

        def _get_re():
            try:
                return yf.Ticker(yf_sym).revenue_estimate
            except Exception:
                return None

        def _get_et():
            try:
                return yf.Ticker(yf_sym).eps_trend
            except Exception:
                return None

        def _get_ge():
            try:
                return yf.Ticker(yf_sym).growth_estimates
            except Exception:
                return None

        # with 블록은 종료 시 모든 작업 완료까지 대기해 result(timeout=) 효과를
        # 무력화한다. 그렇다고 요청마다 새 풀을 만들면 시한을 넘긴 작업의
        # 스레드가 그대로 쌓이므로(app/core/executor.py 참고), 크기가 정해진
        # 공용 풀에 얹고 시한만 지킨다.
        f_ee = detail_executor.submit(_get_ee)
        f_re = detail_executor.submit(_get_re)
        f_et = detail_executor.submit(_get_et)
        f_ge = detail_executor.submit(_get_ge)
        ee, re_, et, ge = (_시한내결과(f, 12) for f in (f_ee, f_re, f_et, f_ge))

        annual: dict = {}
        quarterly: dict = {}

        def _upsert(store, period, **kwargs):
            if period not in store:
                store[period] = {"period": period, "type": "forecast"}
            for k, v in kwargs.items():
                if v is not None and store[period].get(k) is None:
                    store[period][k] = v

        # ── earnings_estimate (EPS 추정, 연간+분기) ──────────
        try:
            if ee is not None and not ee.empty:
                for idx, row in ee.iterrows():
                    conv = _period_to_label(str(idx))
                    if conv is None:
                        continue
                    p, bucket = conv
                    store = quarterly if bucket == "quarterly" else annual
                    _upsert(store, p,
                        eps_est=_safe_float(row.get("avg") or row.get("Avg Estimate")),
                        eps_low=_safe_float(row.get("low") or row.get("Low Estimate")),
                        eps_high=_safe_float(row.get("high") or row.get("High Estimate")),
                        eps_analysts=_safe_float(row.get("numberOfAnalysts") or row.get("No. of Analysts")),
                    )
        except Exception:
            pass

        # ── revenue_estimate (매출 추정) ─────────────────────
        try:
            if re_ is not None and not re_.empty:
                for idx, row in re_.iterrows():
                    conv = _period_to_label(str(idx))
                    if conv is None:
                        continue
                    p, bucket = conv
                    store = quarterly if bucket == "quarterly" else annual
                    _upsert(store, p,
                        revenue_est=_safe_float(row.get("avg") or row.get("Avg Estimate")),
                        revenue_low=_safe_float(row.get("low") or row.get("Low Estimate")),
                        revenue_high=_safe_float(row.get("high") or row.get("High Estimate")),
                    )
        except Exception:
            pass

        # ── eps_trend (추정치 변화 추이) ─────────────────────
        try:
            if et is not None and not et.empty:
                for idx, row in et.iterrows():
                    conv = _period_to_label(str(idx))
                    if conv is None:
                        continue
                    p, bucket = conv
                    store = quarterly if bucket == "quarterly" else annual
                    _upsert(store, p,
                        eps_current=_safe_float(row.get("current")),
                        eps_7d_ago=_safe_float(row.get("7daysAgo")),
                        eps_30d_ago=_safe_float(row.get("30daysAgo")),
                        eps_90d_ago=_safe_float(row.get("90daysAgo")),
                    )
        except Exception:
            pass

        # ── growth_estimates (성장률 추정) ───────────────────
        try:
            if ge is not None and not ge.empty:
                for idx, row in ge.iterrows():
                    conv = _period_to_label(str(idx))
                    if conv is None:
                        continue
                    p, bucket = conv
                    store = quarterly if bucket == "quarterly" else annual
                    _upsert(store, p,
                        growth_est=_safe_float(row.get(yf_sym) or row.get("stock")),
                    )
        except Exception:
            pass

        return {
            "annual":    sorted(annual.values(),    key=lambda x: x["period"]),
            "quarterly": sorted(quarterly.values(), key=lambda x: x["period"]),
        }

    try:
        result = await _run(_fetch)
    except Exception:
        result = {"annual": [], "quarterly": []}
    if stale:
        result = {
            "annual":    _merge_forecast_lists(result.get("annual", []),    stale.get("annual", [])),
            "quarterly": _merge_forecast_lists(result.get("quarterly", []), stale.get("quarterly", [])),
        }
    if result.get("annual") or result.get("quarterly"):
        cache.set(ck, result, 3600)
        await _run(_db_set, ForecastsCache, symbol, market, result)
        return result
    return stale or result
