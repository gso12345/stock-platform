"""퀀트 점수와 가중치 — 사용자가 고른 지표로 점수를 낸다.

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

def _clean_enabled_metrics(raw: dict) -> dict:
    """{factor_key: [metric_key, ...]} — 알 수 없는 factor/metric 키는 제거.
    유효한 항목이 하나도 없는 factor는 결과에서 제외(= 전체 지표 사용으로 간주)."""
    from app.services.quant_score import FACTOR_METRIC_KEYS
    cleaned = {}
    for fkey, allowed_keys in raw.items():
        if fkey not in FACTOR_METRIC_KEYS or not isinstance(allowed_keys, list):
            continue
        valid = [k for k in allowed_keys if k in FACTOR_METRIC_KEYS[fkey]]
        if valid:
            cleaned[fkey] = valid
    return cleaned


@router.get("/quant-score/weights")
def get_quant_score_weights(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """로그인한 사용자가 저장한 퀀트 점수 팩터 가중치/사용 지표 (없으면 기본값 반환)"""
    if current_user:
        row = db.query(QuantScoreWeight).filter(QuantScoreWeight.user_id == current_user.id).first()
        if row and row.weights:
            return {"weights": row.weights, "enabled_metrics": row.enabled_metrics or {}, "is_default": False}
    return {"weights": DEFAULT_WEIGHTS, "enabled_metrics": {}, "is_default": True}


@router.put("/quant-score/weights")
def save_quant_score_weights(
    payload: dict,
    current_user=Depends(require_user),
    db: Session = Depends(get_db),
):
    """퀀트 점수 팩터 가중치 + 팩터별 사용 지표 저장 (로그인 필요)
    weights: value/quality/momentum/growth/risk, 0~100
    enabled_metrics: {"value": ["per","pbr"], "quality": [...]} — 팩터를 생략하면 해당 팩터는 전체 지표 사용"""
    weights = payload.get("weights")
    if not isinstance(weights, dict):
        raise HTTPException(400, "weights 형식이 올바르지 않습니다")

    cleaned = {}
    for key in DEFAULT_WEIGHTS:
        v = weights.get(key, DEFAULT_WEIGHTS[key])
        try:
            v = float(v)
        except (TypeError, ValueError):
            raise HTTPException(400, f"{key} 가중치가 올바르지 않습니다")
        if v < 0 or v > 100:
            raise HTTPException(400, f"{key} 가중치는 0~100 사이여야 합니다")
        cleaned[key] = v
    if sum(cleaned.values()) <= 0:
        raise HTTPException(400, "가중치 합이 0보다 커야 합니다")

    enabled_metrics_raw = payload.get("enabled_metrics")
    enabled_metrics = _clean_enabled_metrics(enabled_metrics_raw) if isinstance(enabled_metrics_raw, dict) else {}

    row = db.query(QuantScoreWeight).filter(QuantScoreWeight.user_id == current_user.id).first()
    if row:
        row.weights = cleaned
        row.enabled_metrics = enabled_metrics
    else:
        row = QuantScoreWeight(user_id=current_user.id, weights=cleaned, enabled_metrics=enabled_metrics)
        db.add(row)
    db.commit()
    return {"weights": cleaned, "enabled_metrics": enabled_metrics}


@router.get("/quant-score/compare")
@limiter.limit("10/minute")
async def get_quant_score_compare(
    request: Request,
    symbols: str = Query(..., description="쉼표로 구분된 종목코드"),
    markets: str = Query(..., description="쉼표로 구분된 시장(symbols와 동일 순서, KR/US/ETF)"),
    w_value: float | None = Query(None, ge=0, le=100),
    w_quality: float | None = Query(None, ge=0, le=100),
    w_momentum: float | None = Query(None, ge=0, le=100),
    w_growth: float | None = Query(None, ge=0, le=100),
    w_risk: float | None = Query(None, ge=0, le=100),
    metrics_value: str | None = Query(None),
    metrics_quality: str | None = Query(None),
    metrics_momentum: str | None = Query(None),
    metrics_growth: str | None = Query(None),
    metrics_risk: str | None = Query(None),
    # 로그인 필수. 화면은 원래 로그인해야 쓸 수 있었는데 API 는 열려 있었다.
    # 요청 하나가 최대 30종목을 채점하고, 캐시가 없으면 종목마다 OHLCV 를
    # 받아온다 — 0.15 CPU 에서 가장 비싼 경로다
    current_user=Depends(require_user),
    db: Session = Depends(get_db),
):
    """관심종목 등 사용자가 직접 고른 소수 종목들의 퀀트 점수를 같은 기준(가중치/사용 지표)으로
    나란히 비교. 전체 시장을 스캔하는 방식과 달리 지정된 종목만 조회하므로
    캐시 여부와 무관하게 항상 최신 점수를 보여줄 수 있다."""
    from app.services.quant_score import collect_quant_metrics
    from app.services.quant_percentile_service import get_percentile_distributions, get_sector_distribution

    sym_list = [s.strip() for s in symbols.split(",") if s.strip()]
    mkt_list = [m.strip().upper() for m in markets.split(",") if m.strip()]
    if not sym_list or len(sym_list) != len(mkt_list):
        raise HTTPException(400, "symbols와 markets 개수가 일치해야 합니다")
    if any(not re.match(_SYMBOL_PATTERN, s) for s in sym_list):
        raise HTTPException(400, "유효하지 않은 심볼이 포함돼 있습니다")
    if len(sym_list) > 30:
        raise HTTPException(400, "한 번에 최대 30개까지 비교할 수 있습니다")
    if any(m not in ("KR", "US", "ETF") for m in mkt_list):
        raise HTTPException(400, "markets는 KR/US/ETF만 허용됩니다")

    override = {"value": w_value, "quality": w_quality, "momentum": w_momentum, "growth": w_growth, "risk": w_risk}
    saved_row = None
    if current_user:
        saved_row = db.query(QuantScoreWeight).filter(QuantScoreWeight.user_id == current_user.id).first()

    if any(v is not None for v in override.values()):
        weights = {k: (v if v is not None else DEFAULT_WEIGHTS[k]) for k, v in override.items()}
    else:
        weights = saved_row.weights if (saved_row and saved_row.weights) else DEFAULT_WEIGHTS

    metrics_override = {
        "value": metrics_value, "quality": metrics_quality,
        "momentum": metrics_momentum, "growth": metrics_growth, "risk": metrics_risk,
    }
    if any(v is not None for v in metrics_override.values()):
        enabled_metrics = _clean_enabled_metrics({
            k: v.split(",") for k, v in metrics_override.items() if v is not None
        })
    else:
        enabled_metrics = (saved_row.enabled_metrics if (saved_row and saved_row.enabled_metrics) else {})

    dist_cache: dict[str, dict] = {}

    def _dist(mkt: str) -> dict:
        if mkt not in dist_cache:
            dist_cache[mkt] = get_percentile_distributions(mkt)
        return dist_cache[mkt]

    sem = asyncio.Semaphore(16)

    async def _score_one(sym: str, mkt: str) -> dict:
        """한 종목 채점.

        느렸던 이유가 여기 있었다. 캐시가 5분이라 그 뒤에 들어온 사람은
        종목마다 OHLCV 를 새로 받는 값을 다 치렀다 — 관심종목 20개면
        20번이다. 퀀트 지표는 재무(하루 단위)와 가격(분 단위)이 섞인
        값이라 5분은 지나치게 짧다.

        두 가지를 바꿨다.
          · 신선 기간을 30분으로. 이 화면에서 5분과 30분의 차이는 눈에
            띄지 않지만, 다시 계산하는 값은 그대로 응답 시간이 된다.
          · 지났어도 마지막 값이 있으면 그걸 쓰고 새로 받기는 뒤로 미룬다.
            기다리게 하는 것보다 30분 지난 점수를 보여 주는 편이 낫다.
        """
        metrics_ck = f"qmetrics:{mkt}:{sym}"
        cached_metrics = cache.get(metrics_ck)
        if cached_metrics is None:
            # 지난 값이라도 있으면 그것으로 답하고, 새로 받는 것은 뒤로 미룬다
            지난값 = cache.get_stale(metrics_ck)
            if 지난값 is not None:
                _퀀트지표_뒤로미루기(sym, mkt, metrics_ck)
                metrics = dict(지난값)
            else:
                async with sem:
                    try:
                        metrics = await collect_quant_metrics(sym, mkt, fetch_ohlcv=True)
                    except Exception:
                        return {"symbol": sym, "market": mkt, "total_score": None, "grade": None, "factors": []}
                cache.set(metrics_ck, metrics, QMETRICS_TTL)
        else:
            metrics = dict(cached_metrics)
        sector = metrics.pop("_sector", None)
        sector_dist = get_sector_distribution(mkt, sector)
        result = compute_quant_score(metrics, weights, _dist(mkt), sector_dist, enabled_metrics)
        return {"symbol": sym, "market": mkt, **result}

    items = await asyncio.gather(*[_score_one(s, m) for s, m in zip(sym_list, mkt_list)])

    return {"weights": weights, "enabled_metrics": enabled_metrics, "items": list(items)}


@router.get("/{market}/{symbol}/quant-score")
@limiter.limit("30/minute")
async def get_quant_score(
    request: Request,
    market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN),
    w_value: float | None = Query(None, ge=0, le=100),
    w_quality: float | None = Query(None, ge=0, le=100),
    w_momentum: float | None = Query(None, ge=0, le=100),
    w_growth: float | None = Query(None, ge=0, le=100),
    w_risk: float | None = Query(None, ge=0, le=100),
    metrics_value: str | None = Query(None, description="쉼표로 구분된 가치 팩터 사용 지표 키 (미지정 시 저장된 설정/전체 지표)"),
    metrics_quality: str | None = Query(None, description="쉼표로 구분된 품질 팩터 사용 지표 키 (미지정 시 저장된 설정/전체 지표)"),
    metrics_momentum: str | None = Query(None, description="쉼표로 구분된 모멘텀 팩터 사용 지표 키 (미지정 시 저장된 설정/전체 지표)"),
    metrics_growth: str | None = Query(None, description="쉼표로 구분된 성장 팩터 사용 지표 키 (미지정 시 저장된 설정/전체 지표)"),
    metrics_risk: str | None = Query(None, description="쉼표로 구분된 안정성 팩터 사용 지표 키 (미지정 시 저장된 설정/전체 지표)"),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """가치/품질/모멘텀/성장/안정성 5팩터 기반 퀀트 종합 점수 + 등급(S~F)
    w_* 쿼리 파라미터가 하나라도 오면 저장된 가중치 대신 즉시 미리보기로 사용(저장 안 함)
    metrics_* 쿼리 파라미터가 오면 해당 팩터에서 지정한 지표만 즉시 미리보기로 사용(저장 안 함)
    지표 점수는 같은 시장(KR/US/ETF) 내 백분위 상대평가(분포는 일배치로 미리 캐시되어
    조회 시점에는 이분 탐색만 수행) — 표본이 부족한 지표는 절대평가로 폴백"""
    from app.services.quant_score import collect_quant_metrics
    from app.services.quant_percentile_service import get_percentile_distributions, get_sector_distribution

    override = {"value": w_value, "quality": w_quality, "momentum": w_momentum, "growth": w_growth, "risk": w_risk}
    saved_row = None
    if current_user:
        saved_row = db.query(QuantScoreWeight).filter(QuantScoreWeight.user_id == current_user.id).first()

    if any(v is not None for v in override.values()):
        weights = {k: (v if v is not None else DEFAULT_WEIGHTS[k]) for k, v in override.items()}
    else:
        weights = saved_row.weights if (saved_row and saved_row.weights) else DEFAULT_WEIGHTS

    metrics_override = {
        "value": metrics_value, "quality": metrics_quality,
        "momentum": metrics_momentum, "growth": metrics_growth, "risk": metrics_risk,
    }
    if any(v is not None for v in metrics_override.values()):
        enabled_metrics = _clean_enabled_metrics({
            k: v.split(",") for k, v in metrics_override.items() if v is not None
        })
    else:
        enabled_metrics = (saved_row.enabled_metrics if (saved_row and saved_row.enabled_metrics) else {})

    metrics = await collect_quant_metrics(symbol, market)
    sector = metrics.pop("_sector", None)
    percentile_dist = await asyncio.get_running_loop().run_in_executor(None, get_percentile_distributions, market)
    sector_dist = await asyncio.get_running_loop().run_in_executor(None, get_sector_distribution, market, sector)

    result = compute_quant_score(metrics, weights, percentile_dist, sector_dist, enabled_metrics)
    result["weights"] = weights
    result["enabled_metrics"] = enabled_metrics
    return result
