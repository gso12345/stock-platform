"""
퀀트 점수 계산 — 가치/품질/모멘텀/성장/안정성 5개 팩터를 0~100점으로 정규화해
가중합한 종합 점수와 등급(S+~D)을 산출한다.

각 팩터는 여러 지표로 구성되며, 지표별 0~100점은 같은 시장(KR/US/ETF) 내
동일 지표 분포에서의 백분위 순위로 환산한다(상대평가) — 백분위 분포는
일배치로 미리 계산해 DB/메모리에 캐시해두므로(quant_percentile_service)
요청 시점에는 정렬된 리스트에 대한 이분 탐색(O(log n))만 수행해 비교 비용이
거의 들지 않는다. 분포 표본이 부족한 지표/시장은 업종 구분 없는 일반적인
"좋다/나쁘다" 경험적 기준 구간(lo~hi) 선형 보간으로 대체(절대평가 폴백)한다.
데이터가 없는 지표는 건너뛰고 나머지 지표만으로 팩터 점수를 계산하며, 모든
지표가 없는 팩터는 종합 점수 계산에서 제외(가중치 재정규화)한다.
"""
from __future__ import annotations
import bisect
import statistics

# 백분위 분포 표본이 이보다 적으면 상대평가를 적용하지 않고 절대평가로 폴백
MIN_PERCENTILE_SAMPLES = 15
# 업종별 분포 표본 최소 기준 (시장 전체보다 표본이 적으므로 기준을 낮춤)
MIN_SECTOR_SAMPLES = 8

# 같은 시장이라도 업종별로 정상 범위가 크게 다른 지표 — 시장 전체 비교보다
# 업종(sector) 내 비교를 우선 적용 (예: 반도체 PER vs 금융 PER은 비교 의미가 약함)
SECTOR_RELATIVE_METRICS = {"per", "forward_per", "pbr", "ev_ebitda"}

DEFAULT_WEIGHTS = {
    "value": 25.0,
    "quality": 25.0,
    "momentum": 25.0,
    "growth": 15.0,
    "risk": 10.0,
}

FACTOR_LABELS = {
    "value": "가치",
    "quality": "품질",
    "momentum": "모멘텀",
    "growth": "성장",
    "risk": "안정성",
}

# (metric_key, label, direction, lo, hi, unit)
# direction "low"  : 값이 작을수록 좋음 (lo=100점 기준, hi=0점 기준, 0 이하는 0점)
# direction "high" : 값이 클수록 좋음 (lo=0점 기준, hi=100점 기준)
METRIC_DEFS: dict[str, list[tuple]] = {
    "value": [
        ("per",         "PER",        "low",  8,    35,  "배"),
        ("forward_per", "선행PER",     "low",  8,    30,  "배"),
        ("pbr",         "PBR",        "low",  0.8,  4,   "배"),
        ("ev_ebitda",   "EV/EBITDA",  "low",  5,    20,  "배"),
        ("peg",         "PEG",        "low",  0.5,  2.5, "배"),
    ],
    "quality": [
        ("roe",        "ROE",       "high", 0, 20, "%"),
        ("roa",        "ROA",       "high", 0, 10, "%"),
        ("op_margin",  "영업이익률", "high", 0, 25, "%"),
        ("net_margin", "순이익률",   "high", 0, 20, "%"),
    ],
    "momentum": [
        ("mom_1m",    "1개월 수익률",      "high", -15, 15, "%"),
        ("mom_3m",    "3개월 수익률",      "high", -25, 25, "%"),
        ("mom_6m",    "6개월 수익률",      "high", -35, 35, "%"),
        ("mom_12m",   "12개월 수익률",     "high", -40, 40, "%"),
        ("ma60_dev",  "60일 이평 이격도",  "high", -15, 15, "%"),
        ("ma200_dev", "200일 이평 이격도", "high", -25, 25, "%"),
    ],
    "growth": [
        ("revenue_growth",    "매출성장률(YoY)",     "high", -10, 30, "%"),
        ("net_income_growth", "순이익성장률(YoY)",   "high", -10, 40, "%"),
        ("op_income_growth",  "영업이익성장률(YoY)", "high", -10, 40, "%"),
    ],
    "risk": [
        ("debt_ratio", "부채비율",      "low", 30, 150, "%"),
        ("volatility", "연환산 변동성", "low", 15, 60,  "%"),
    ],
}

# 팩터별 사용 가능한 지표 키 목록 — enabled_metrics 유효성 검사용
FACTOR_METRIC_KEYS: dict[str, list[str]] = {
    fkey: [mkey for (mkey, *_rest) in defs] for fkey, defs in METRIC_DEFS.items()
}

# 점수 임계값(이상) → 등급, 내림차순으로 검사
GRADE_BANDS = [
    (90, "S"),
    (80, "A"),
    (60, "B"),
    (40, "C"),
    (20, "D"),
    (0,  "F"),
]


def grade_for_score(score: float) -> str:
    for threshold, grade in GRADE_BANDS:
        if score >= threshold:
            return grade
    return "D"


def _score_metric(value: float, direction: str, lo: float, hi: float) -> float:
    """value를 lo~hi 구간 기준 0~100점으로 환산 (구간 밖은 클램프)"""
    if direction == "low":
        if value <= 0:
            return 0.0  # 적자 등 — 비율 지표가 의미를 잃는 구간은 최저점
        if value <= lo:
            return 100.0
        if value >= hi:
            return 0.0
        return (hi - value) / (hi - lo) * 100
    else:
        if value <= lo:
            return 0.0
        if value >= hi:
            return 100.0
        return (value - lo) / (hi - lo) * 100


def _percentile_score(value: float, sorted_values: list[float], direction: str) -> float:
    """value가 sorted_values(오름차순) 내에서 차지하는 백분위를 0~100점으로 환산.
    direction="high"면 값이 클수록(=상위 percentile일수록) 높은 점수,
    "low"면 값이 작을수록 높은 점수."""
    n = len(sorted_values)
    if direction == "high":
        rank = bisect.bisect_right(sorted_values, value)
    else:
        rank = n - bisect.bisect_left(sorted_values, value)
    return rank / n * 100


def compute_quant_score(
    metrics: dict,
    weights: dict | None = None,
    percentile_dist: dict | None = None,
    sector_dist: dict | None = None,
    enabled_metrics: dict | None = None,
) -> dict:
    """
    metrics: {metric_key: raw_value, ...} — 누락/None은 해당 지표 제외
    weights: {"value":25,"quality":25,"momentum":25,"growth":15,"risk":10} (합 100 아니어도 자동 정규화)
    percentile_dist: {metric_key: [sorted_value, ...]} — 같은 시장 내 해당 지표의 정렬된 분포
    sector_dist: {metric_key: [sorted_value, ...]} — 같은 시장+업종 내 분포. PER/PBR/EV·EBITDA처럼
        업종별로 정상 범위가 크게 다른 지표(SECTOR_RELATIVE_METRICS)는 업종 내 비교를 우선 적용.
    둘 다(quant_percentile_service에서 일배치로 미리 계산) 표본이 충분하면 상대평가,
    부족하면 시장 전체 → 절대평가(lo~hi) 순으로 폴백.
    enabled_metrics: {factor_key: [metric_key, ...]} — 지정된 팩터는 목록에 있는 지표만 사용.
        팩터가 키에 없으면 해당 팩터는 전체 지표 사용(기본값).
    """
    weights = {**DEFAULT_WEIGHTS, **(weights or {})}
    percentile_dist = percentile_dist or {}
    sector_dist = sector_dist or {}
    enabled_metrics = enabled_metrics or {}

    factors = []
    for fkey, metric_defs in METRIC_DEFS.items():
        allowed = enabled_metrics.get(fkey)
        metric_results = []
        for mkey, label, direction, lo, hi, unit in metric_defs:
            if allowed is not None and mkey not in allowed:
                continue
            raw = metrics.get(mkey)
            score = None
            if raw is not None:
                try:
                    raw = float(raw)
                    dist = None
                    if mkey in SECTOR_RELATIVE_METRICS:
                        sd = sector_dist.get(mkey)
                        if sd and len(sd) >= MIN_SECTOR_SAMPLES:
                            dist = sd
                    if dist is None:
                        md = percentile_dist.get(mkey)
                        if md and len(md) >= MIN_PERCENTILE_SAMPLES:
                            dist = md
                    if dist is not None:
                        score = round(_percentile_score(raw, dist, direction), 1)
                    else:
                        score = round(_score_metric(raw, direction, lo, hi), 1)
                except (TypeError, ValueError):
                    raw = None
            metric_results.append({
                "key": mkey, "label": label, "value": raw,
                "score": score, "unit": unit, "direction": direction,
            })

        available = [m["score"] for m in metric_results if m["score"] is not None]
        factor_score = round(sum(available) / len(available), 1) if available else None
        factors.append({
            "key": fkey,
            "label": FACTOR_LABELS[fkey],
            "weight": weights.get(fkey, DEFAULT_WEIGHTS[fkey]),
            "score": factor_score,
            "metrics": metric_results,
        })

    weighted_sum = 0.0
    weight_total = 0.0
    for f in factors:
        if f["score"] is None:
            continue
        w = f["weight"]
        weighted_sum += f["score"] * w
        weight_total += w

    total_score = round(weighted_sum / weight_total, 1) if weight_total > 0 else None
    grade = grade_for_score(total_score) if total_score is not None else None

    return {
        "total_score": total_score,
        "grade": grade,
        "factors": factors,
    }


def compute_momentum_volatility(closes: list[float]) -> dict:
    """일별 종가 리스트(오름차순, 최근값이 마지막)로 1/3/6/12개월 수익률 +
    60일/200일 이동평균선 이격도 + 연환산 변동성 계산"""
    if not closes or len(closes) < 5:
        return {}
    n = len(closes)
    last = closes[-1]

    def _ret(trading_days_back: int) -> float | None:
        idx = n - 1 - trading_days_back
        if idx < 0:
            return None
        base = closes[idx]
        if not base:
            return None
        return round((last - base) / base * 100, 2)

    result: dict = {}
    for days, key in ((21, "mom_1m"), (63, "mom_3m"), (126, "mom_6m"), (252, "mom_12m")):
        r = _ret(days)
        if r is not None:
            result[key] = r

    # 이동평균선 이격도 — 현재가가 N일 이동평균선 대비 몇 % 위/아래인지
    def _ma_dev(window: int) -> float | None:
        if n < window:
            return None
        ma = sum(closes[-window:]) / window
        if not ma:
            return None
        return round((last - ma) / ma * 100, 2)

    d60 = _ma_dev(60)
    if d60 is not None:
        result["ma60_dev"] = d60
    d200 = _ma_dev(200)
    if d200 is not None:
        result["ma200_dev"] = d200

    # 최근 최대 126영업일(약 6개월) 일별 수익률의 표준편차 → 연환산(252거래일) 변동성(%)
    window = closes[-126:] if n > 126 else closes
    if len(window) >= 6:
        rets = [
            (window[i] - window[i - 1]) / window[i - 1]
            for i in range(1, len(window)) if window[i - 1]
        ]
        if len(rets) >= 5:
            stdev = statistics.pstdev(rets)
            result["volatility"] = round(stdev * (252 ** 0.5) * 100, 2)

    return result


_FUND_KEYS = ("per", "forward_per", "pbr", "ev_ebitda", "peg",
              "roe", "roa", "op_margin", "net_margin", "debt_ratio")


async def collect_quant_metrics(symbol: str, market: str, fetch_ohlcv: bool = True) -> dict:
    """퀀트 점수용 원시 지표 수집 — 종목상세 엔드포인트와 percentile 분포 배치 작업이
    동일한 정의를 공유하도록 한곳에 모음. 캐시 우선 조회(fundamentals_service/yf_service)라
    이미 캐시된 종목이면 추가 외부 호출 없이 즉시 반환된다."""
    from app.services.fundamentals_service import get_fundamentals, get_financials
    from app.services.yf_service import yf_service

    metrics: dict = {}
    fund = await get_fundamentals(symbol, market) or {}
    metrics["_sector"] = fund.get("sector")
    for k in _FUND_KEYS:
        if fund.get(k) is not None:
            metrics[k] = fund[k]

    try:
        fin = await get_financials(symbol, market)
        annual = fin.get("annual") or []
        if len(annual) >= 2:
            cur, prev = annual[-1], annual[-2]
            for key, gkey in (
                ("revenue", "revenue_growth"),
                ("net_income", "net_income_growth"),
                ("op_income", "op_income_growth"),
            ):
                cv, pv = cur.get(key), prev.get(key)
                if cv is not None and pv:
                    metrics[gkey] = round((cv - pv) / abs(pv) * 100, 2)

        if annual:
            latest = annual[-1]
            # yfinance .info에 debtToEquity/returnOnAssets/마진이 없는 종목
            # (특히 국내 종목)은 재무제표에서 직접 계산한 값으로 보완
            for mkey in ("debt_ratio", "roe", "roa", "op_margin", "net_margin"):
                if metrics.get(mkey) is None and latest.get(mkey) is not None:
                    metrics[mkey] = latest[mkey]

            # EV/EBITDA 보완 — market_cap(펀더멘털) + 최근 부채 - 현금, EBITDA(재무제표)
            if metrics.get("ev_ebitda") is None and latest.get("ebitda"):
                mc = fund.get("market_cap")
                if mc:
                    ev = mc + (latest.get("total_debt") or 0) - (latest.get("cash") or 0)
                    if ev:
                        metrics["ev_ebitda"] = round(ev / latest["ebitda"], 2)

            # PEG 보완 — PER ÷ EPS 성장률(전년 대비, %)
            if metrics.get("peg") is None and metrics.get("per") and len(annual) >= 2:
                cur_eps, prev_eps = annual[-1].get("eps"), annual[-2].get("eps")
                if cur_eps is not None and prev_eps:
                    eps_growth = (cur_eps - prev_eps) / abs(prev_eps) * 100
                    if eps_growth > 0:
                        metrics["peg"] = round(metrics["per"] / eps_growth, 2)
    except Exception:
        pass

    if fetch_ohlcv:
        try:
            import asyncio
            loop = asyncio.get_running_loop()
            ohlcv = await asyncio.wait_for(
                loop.run_in_executor(None, yf_service.get_ohlcv, symbol, "2y", "1d", market),
                timeout=15,
            )
            closes = [b["close"] for b in ohlcv if b.get("close")]
            metrics.update(compute_momentum_volatility(closes))
        except Exception:
            pass

    return metrics
