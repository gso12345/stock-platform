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
from app.core.fetchcache import 캐시_우선_비동기
from app.core.config import settings

log = logging.getLogger(__name__)

FUND_FRESH_H = 24    # 펀더멘털 신선 기준: 24시간
FUND_STALE_H = 720   # 30일까지는 stale로 사용
FIN_FRESH_H  = 6     # 재무제표 신선 기준: 6시간
FIN_STALE_H  = 168   # 7일까지는 stale로 사용


# ── DB 읽기/쓰기 ──────────────────────────────────────────────

def _now():
    return datetime.utcnow()


async def _run(fn, *args):
    """블로킹 DB 호출을 이벤트 루프 밖 스레드풀에서 실행"""
    return await asyncio.get_running_loop().run_in_executor(None, fn, *args)


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
    from app.services.market.yf_service import yf_service
    loop = asyncio.get_running_loop()

    if market == "KR":
        from app.services.market.price_fetcher import fetch_naver_stock
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
            # 꼬리가 없으면 종목 목록에서 코스피·코스닥을 찾는다 — 늘 .KS 를 붙이면 코스닥은 야후가 빈손이다
            from app.services.market.yf_service import _resolve_kr_symbol
            yf_sym = symbol if symbol.endswith((".KS", ".KQ")) else _resolve_kr_symbol(code6, "KS")
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
            from app.services.fundamentals.dart_service import dart_service
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
            from app.services.fundamentals.fmp_service import fmp_service
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
    from app.services.market.yf_service import _resolve_kr_symbol
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


# ── 스크리닝과 같은 원천으로 빈 것 채우기 ──────────────────────
# 종목 상세는 종목별 원천(야후·네이버·FMP·DART 단일)만 보고, 스크리닝은 전 종목 일괄 원천(SEC·DART 일괄·KRX·네이버)을
# 본다. 운영에서는 야후 상세가 막혀, 스크리닝에는 매출·순이익·PER 이 있는 종목이 상세에서는 비었다(사용자: "스크리닝이랑
# 재무제표가 같이 연동되야하는 거 아니야?"). 종목별 원천이 비운 것만 스크리닝의 것으로 채운다 — 있는 값은 그대로.
# 캐시에는 넣지 않는다(읽을 때마다 지금의 스크리닝 표로) — 종목별 원천은 다음에 다시 받아 본다.

#: 투자지표 칸 ← 스크리닝 표의 칸
_표에서 = {
    "per": "per", "forward_per": "forward_per", "pbr": "pbr", "peg": "peg_ratio", "psr": "ps_ratio",
    "ev_ebitda": "ev_ebitda", "roe": "roe", "roa": "roa", "op_margin": "operating_margin",
    "net_margin": "profit_margin", "eps": "eps", "forward_eps": "forward_eps", "dividend_yield": "dividend_yield",
    "debt_ratio": "debt_ratio", "current_ratio": "current_ratio", "beta": "beta", "week52_high": "high_52w",
    "week52_low": "low_52w", "market_cap": "market_cap", "sector": "sector", "industry": "industry",
}


def 표로_채운_지표(지표: dict, 줄: dict | None) -> dict:
    """투자지표의 빈 칸만 스크리닝 표의 한 줄로 채운 새 dict"""
    if not 줄:
        return 지표
    빈것 = {k: 줄[칸] for k, 칸 in _표에서.items() if 지표.get(k) is None and 줄.get(칸) is not None}
    return {**지표, **빈것} if 빈것 else 지표


def 일괄_재무(시장: str, 줄: dict | None) -> dict:
    """스크리닝의 연간 재무 원천 한 줄(service.재무_원천줄) → 재무제표 탭의 연간 표. 원천에 있는 만큼만 —
    매출·EPS 는 해마다(미국 네 해·국내 매출 세 해), 순이익·영업이익은 그해와 지난해, 현금흐름·재무상태는 그해만.
    성장률은 metrics-history 의 _add_growth 와 같은 식"""
    빈 = {"annual": [], "quarterly": []}
    if not 줄:
        return 빈
    해들 = {int(k.split("@", 1)[1]) for k in 줄 if "@" in k and k.split("@", 1)[1].isdigit()}
    끝 = int(줄["_끝해"]) if 줄.get("_끝해") else max(해들, default=0)
    if not 끝:
        return 빈
    해들 = sorted(해들 | {끝})
    순이익칸 = "earnings" if 시장 == "US" else "net_income"
    rows: list[dict] = []
    for 해 in 해들:
        r: dict = {"period": str(해), "revenue": 줄.get(f"rev@{해}"), "eps": 줄.get(f"eps@{해}")}
        if 해 == 끝:
            if r["revenue"] is None:
                r["revenue"] = 줄.get("revenue")
            r.update(net_income=줄.get(순이익칸), op_income=줄.get("op_income"), total_assets=줄.get("assets"),
                     total_equity=줄.get("equity"), total_liabilities=줄.get("liabilities"),
                     operating_cf=줄.get("ocf"))
            if 줄.get("capex") is not None:
                r["capex"] = -abs(줄["capex"])                  # 야후·FMP 처럼 나간 돈은 음수
                if r["operating_cf"] is not None:
                    r["free_cf"] = r["operating_cf"] - abs(줄["capex"])
        elif 해 == 끝 - 1:
            r.update(net_income=줄.get(f"{순이익칸}_prev"), op_income=줄.get("op_income_prev"))
        매출, 영업, 순, 자본 = r.get("revenue"), r.get("op_income"), r.get("net_income"), r.get("total_equity")
        if 매출:
            if 영업 is not None:
                r["op_margin"] = round(영업 / 매출 * 100, 2)
            if 순 is not None:
                r["net_margin"] = round(순 / 매출 * 100, 2)
        if 자본:
            if r.get("total_liabilities") is not None:
                r["debt_ratio"] = round(r["total_liabilities"] / 자본 * 100, 2)
            if 순 is not None:
                r["roe"] = round(순 / 자본 * 100, 2)
        if r.get("total_assets") and 순 is not None:
            r["roa"] = round(순 / r["total_assets"] * 100, 2)
        rows.append({k: v for k, v in r.items() if v is not None})
    for 앞, 뒤 in zip(rows, rows[1:]):
        if int(뒤["period"]) - int(앞["period"]) != 1:
            continue                                            # 가운데 해가 비면 두 해 성장이 '전년 대비' 가 된다
        for 칸, 성장칸 in (("revenue", "revenue_growth"), ("op_income", "op_income_growth"),
                         ("net_income", "net_income_growth"), ("eps", "eps_growth")):
            cv, pv = 뒤.get(칸), 앞.get(칸)
            if cv and pv:
                뒤[성장칸] = round((cv - pv) / abs(pv) * 100, 2)
    rows = [r for r in rows if len(r) > 1]
    출처 = 줄.get("_출처") or ("SEC" if 시장 == "US" else "DART")
    return {"annual": rows, "quarterly": [], "source": 출처} if rows else 빈


async def _스크리닝(fn, *args):
    """스크리닝 쪽 읽기 — 실패하면 None(상세 화면을 그 때문에 깨지 않는다)"""
    try:
        return await _run(fn, *args)
    except Exception as e:
        log.debug("스크리닝 원천 읽기 실패: %s", type(e).__name__)
        return None


# ── 공개 API: 캐시 계층 통합 ──────────────────────────────────

async def get_fundamentals(symbol: str, market: str, 기다림: "float | None" = None) -> dict:
    """투자지표 — 종목별 원천(_투자지표)이 비운 칸은 스크리닝 표의 같은 종목 값으로(표로_채운_지표)"""
    from app.services.screening import service as 스크리닝
    지표 = await _투자지표(symbol, market, 기다림)
    return 표로_채운_지표(지표, await _스크리닝(스크리닝.한종목, market, symbol))


async def get_financials(symbol: str, market: str, 기다림: "float | None" = None) -> dict:
    """재무제표 — 종목별 원천(_재무제표)이 비면 스크리닝과 같은 연간 재무 원천(미국 SEC · 국내 DART → 네이버)으로"""
    r = await _재무제표(symbol, market, 기다림)
    if r and (r.get("annual") or r.get("quarterly")):
        return r
    from app.services.screening import service as 스크리닝
    줄 = await _스크리닝(스크리닝.재무_원천줄, market, symbol)
    일괄 = 일괄_재무(market, 줄)
    if 일괄["annual"] and market == "US":
        # 스크리닝처럼 해마다 EPS 도 시세 1주(ADR·B 주)로 — 안 맞추면 TSMC 의 EPS 가 스크리닝(ADR)과 다섯 배 다르다
        배율 = 시세주_배율(줄, await _스크리닝(스크리닝.한종목, market, symbol))
        if 배율:
            for 해 in 일괄["annual"]:
                if 해.get("eps") is not None:
                    해["eps"] = round(해["eps"] * 배율, 2)
    return 일괄 if 일괄["annual"] else r


def 시세주_배율(줄: dict | None, 표줄: dict | None) -> float | None:
    """SEC 의 장부 EPS 를 시세 1주로 맞출 배율 — 스크리닝 표(table._시세주_EPS)와 같은 기준. 해외 상장사(원주 EPS)이거나
    시세 ÷ EPS 가 시가총액 ÷ 순이익과 EPS_어긋남 배 넘게 다르면(다른 종류 주식) 순이익 × 시세 ÷ 시가총액 ÷ 장부 EPS.
    맞출 필요가 없거나 알 수 없으면 None"""
    from app.services.screening.table import EPS_어긋남
    eps, 순이익 = (줄 or {}).get("eps"), (줄 or {}).get("earnings")
    가격, 시총 = (표줄 or {}).get("price"), (표줄 or {}).get("market_cap")
    if not eps or 순이익 is None or not 가격 or not 시총 or 시총 <= 0:
        return None
    몫 = 가격 * 순이익 / 시총
    if not 몫 or (몫 > 0) != (eps > 0):
        return None
    견줌 = eps / 몫
    if not (줄 or {}).get("foreign") and 1 / EPS_어긋남 <= 견줌 <= EPS_어긋남:
        return None
    return 몫 / eps


async def _투자지표(symbol: str, market: str, 기다림: "float | None" = None) -> dict:
    """in-memory → DB fresh → DB stale(+bg갱신) → 외부 API fetch

    `기다림` — 아무 데도 없을 때 받아 오기를(남이 받는 중이면 그것을) 기다려 주는 상한(초).
    기본은 화면 상한(fetchcache.WAIT_SEC)만 기다리고 남이 받는 중이면 곧바로 빈손이다."""
    ck = f"fund:{symbol}"

    if fresh := cache.get(ck):
        return fresh

    db_fresh = await _run(_db_get, FundamentalsCache, symbol, market, FUND_FRESH_H)
    if db_fresh:
        cache.set(ck, db_fresh, 86400)
        return db_fresh

    db_stale = await _run(_db_get, FundamentalsCache, symbol, market, FUND_STALE_H)
    if db_stale:
        cache.set(ck, db_stale, 3600)
        asyncio.create_task(_bg_fund(symbol, market))
        return db_stale

    """여기서부터가 '아무 데도 없다' 인 자리다.

    예전에는 곧장 _fetch_fund 를 불렀다. 성공하면 담아 두니 두 번째부터
    빠른데, **실패하면 아무것도 안 담았다**. 원천이 죽어 있는 동안은
    요청마다 처음부터 다시 받으러 갔다 — 서버를 띄워 재 보니 재무제표가
    첫 요청 5.4초, 두 번째 2.6초였다. 캐시가 있는데 안 빨라진다.

    겹침도 안 막았다. 종목 상세는 탭 예닐곱 개가 한꺼번에 열리는
    화면이라, 같은 종목을 동시에 여러 번 받고 있었다."""
    async def _담기(r):
        cache.set(ck, r, 86400)
        await _run(_db_set, FundamentalsCache, symbol, market, r)

    return await 캐시_우선_비동기(
        ck, lambda: _fetch_fund(symbol, market), {},
        지난값=cache.get_stale(ck), 담기=_담기, 대기=기다림, 겹치면_기다림=기다림 or 0)


async def _재무제표(symbol: str, market: str, 기다림: "float | None" = None) -> dict:
    """in-memory → DB fresh → DB stale(+bg갱신) → 외부 API fetch — `기다림` 은 _투자지표 와 같다"""
    ck = f"financials:{symbol}"

    if fresh := cache.get(ck):
        return fresh

    db_fresh = await _run(_db_get, FinancialsCache, symbol, market, FIN_FRESH_H)
    if db_fresh:
        cache.set(ck, db_fresh, 3600)
        return db_fresh

    db_stale = await _run(_db_get, FinancialsCache, symbol, market, FIN_STALE_H)
    if db_stale:
        cache.set(ck, db_stale, 1800)
        asyncio.create_task(_bg_fin(symbol, market))
        return db_stale

    # 재무제표는 '틀은 왔는데 속이 빈' 응답이 흔하다. 그런 것을 성공으로
    # 담으면 빈 표가 한 시간 굳으므로, 여기서 미리 빈손으로 바꾼다.
    async def _받기():
        r = await _fetch_fin(symbol, market)
        return r if r and (r.get("annual") or r.get("quarterly")) else None

    async def _담기(r):
        cache.set(ck, r, 3600)
        await _run(_db_set, FinancialsCache, symbol, market, r)

    return await 캐시_우선_비동기(
        ck, _받기, {"annual": [], "quarterly": []},
        지난값=cache.get_stale(ck), 담기=_담기, 대기=기다림, 겹치면_기다림=기다림 or 0)


async def _bg_fund(symbol: str, market: str):
    try:
        r = await _fetch_fund(symbol, market)
        if r:
            cache.set(f"fund:{symbol}", r, 86400)
            await _run(_db_set, FundamentalsCache, symbol, market, r)
    except Exception:
        pass


async def _bg_fin(symbol: str, market: str):
    try:
        r = await _fetch_fin(symbol, market)
        if r and (r.get("annual") or r.get("quarterly")):
            cache.set(f"financials:{symbol}", r, 3600)
            await _run(_db_set, FinancialsCache, symbol, market, r)
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
                await _run(_db_set, FundamentalsCache, symbol, market, r)
                cache.set(f"fund:{symbol}", r, 86400)
                ok_fund += 1
        except Exception as e:
            log.debug(f"배치 펀더멘털 실패 {symbol}: {e}")
        await asyncio.sleep(0.8)

        # 재무제표
        try:
            r = await _fetch_fin(symbol, market)
            if r and (r.get("annual") or r.get("quarterly")):
                await _run(_db_set, FinancialsCache, symbol, market, r)
                cache.set(f"financials:{symbol}", r, 3600)
                ok_fin += 1
        except Exception as e:
            log.debug(f"배치 재무제표 실패 {symbol}: {e}")
        await asyncio.sleep(0.8)

    log.info(f"배치 갱신 완료 — 펀더멘털 {ok_fund}개 · 재무제표 {ok_fin}개 / 전체 {len(symbols)}개")
    return ok_fund, ok_fin
