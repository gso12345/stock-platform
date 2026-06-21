"""
퀀트 점수 계산 — 가치/품질/모멘텀/성장/안정성 5개 팩터를 0~100점으로 정규화해
가중합한 종합 점수와 등급(S+~D)을 산출한다.

각 팩터는 여러 지표로 구성되며, 지표별 0~100점은 업종 구분 없이 일반적인
"좋다/나쁘다" 경험적 기준 구간(lo~hi)을 선형 보간해 계산한다. 데이터가 없는
지표는 건너뛰고 나머지 지표만으로 팩터 점수를 계산하며, 모든 지표가 없는
팩터는 종합 점수 계산에서 제외(가중치 재정규화)한다.
"""
from __future__ import annotations
import statistics

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

# 점수 임계값(이상) → 등급, 내림차순으로 검사
GRADE_BANDS = [
    (90, "S"),
    (80, "A"),
    (70, "B"),
    (60, "C"),
    (50, "D"),
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


def compute_quant_score(metrics: dict, weights: dict | None = None) -> dict:
    """
    metrics: {metric_key: raw_value, ...} — 누락/None은 해당 지표 제외
    weights: {"value":25,"quality":25,"momentum":25,"growth":15,"risk":10} (합 100 아니어도 자동 정규화)
    """
    weights = {**DEFAULT_WEIGHTS, **(weights or {})}

    factors = []
    for fkey, metric_defs in METRIC_DEFS.items():
        metric_results = []
        for mkey, label, direction, lo, hi, unit in metric_defs:
            raw = metrics.get(mkey)
            score = None
            if raw is not None:
                try:
                    raw = float(raw)
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
