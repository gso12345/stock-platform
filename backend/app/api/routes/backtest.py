from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from typing import Annotated, Optional
from datetime import datetime, timedelta
import asyncio
import logging
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.database import get_db
from app.models.stock import Strategy, BacktestResult
from app.models.user import User
from app.core.deps import require_user, get_current_user
from app.services.backtest_engine import backtest_engine
from app.services.yf_service import yf_service
from app.core.cache import cache

log = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/backtest", tags=["백테스트"])


def _parse_date(v: str) -> str:
    try:
        datetime.strptime(v, "%Y-%m-%d")
    except ValueError:
        raise ValueError("날짜 형식은 YYYY-MM-DD여야 합니다")
    return v


#: 지표를 데우려고 **요청한 시작일보다 앞서** 더 받아 오는 날 수.
#
#  엔진에서 제일 긴 지표가 200일 이동평균과 52주(252일) 고저다.
#  거래일로 252일이면 달력으로는 주말·휴장 때문에 365일이 넘는다.
#  넉넉히 400일을 잡는다 — 모자라면 앞부분 지표가 비고, 남으면
#  받아 오는 자료만 조금 많아진다(계산은 안 늘어난다).
워밍업일수 = 400


#: 종목 코드에 들어올 수 있는 글자.
#
#  이게 없으면 '../../../etc/passwd' 같은 것이 그대로 yfinance 로 가고,
#  캐시 열쇠로도 쓰인다. 아래 자산배분(자산칸)에는 처음부터 있었는데
#  위쪽 두 엔드포인트에만 없었다 — 같은 파일 안에서 한쪽 문만 지키고
#  있었던 셈이다.
#
#  '^'(지수), '='(환율), '.'(거래소 접미사)까지 받는다. 실제로 쓰는
#  심볼이 ^GSPC · USDKRW=X · 005930.KS 같은 모양이기 때문이다.
심볼모양 = r"^[A-Za-z0-9.\^=\-가-힣]+$"

#: 목록 안의 항목마다 모양을 걸 때 쓴다
심볼 = Annotated[str, Field(min_length=1, max_length=20, pattern=심볼모양)]


class BacktestRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20, pattern=심볼모양)
    market: str = Field("US", pattern="^(KR|US|ETF)$")
    start_date: str
    end_date: str
    initial_capital: float = Field(10_000_000, ge=100_000, le=100_000_000_000)
    entry_conditions: dict
    exit_conditions: dict
    stop_loss: Optional[float] = Field(None, ge=0.1, le=99.0)
    take_profit: Optional[float] = Field(None, ge=0.1, le=999.0)
    #: 한 번에 자본의 몇 %를 넣을까. 화면에 '투자비중' 슬라이더로 있다.
    #
    #  이 칸이 **없었다.** 화면은 값을 들고 있고 사람은 50% 로 내렸는데,
    #  서버는 그 값을 받지도 않으니 늘 95% 로 계산했다. 결과가 하나도
    #  안 바뀌니 '이 앱은 설정이 안 먹는다' 로 읽힌다 — 아무 일도 안 하는
    #  조작칸은 없느니만 못하다.
    position_size: float = Field(0.95, gt=0, le=1.0)
    #: 거래비용(%). 0.1 이면 0.1% — 화면이 퍼센트로 주고 서버가 나눈다.
    #  자산배분(/portfolio)에는 있었는데 여기만 없어서, 같은 화면의 두
    #  탭이 다른 기준으로 계산하고 있었다.
    cost_rate: float = Field(0, ge=0, le=5)
    #: 샤프를 잴 때 뺄 무위험수익률(연 %). 0 이면 '무위험 0%' 라는
    #  **가정**이고, 그 가정도 응답에 적어 내보낸다.
    risk_free_rate: float = Field(0, ge=0, le=20)
    strategy_id: Optional[int] = None

    @field_validator("start_date", "end_date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        return _parse_date(v)


class UniverseBacktestRequest(BaseModel):
    universe: str = Field("SP500", pattern="^(SP500|KOSPI|KOSDAQ|ETF|CUSTOM)$")
    #: 길이만 막고 **내용은 안 봤다.** 100개를 아무 글자로 채워 보낼 수
    #  있었고, 그게 전부 야후 요청과 캐시 열쇠가 됐다.
    #
    #  Annotated 로 **항목마다** 모양을 건다. json_schema_extra 로 적으면
    #  문서에만 나오고 실제로는 아무것도 안 막는다(그렇게 짰다가 고쳤다).
    custom_symbols: list[심볼] = Field(default=[], max_length=100)
    market: str = Field("US", pattern="^(KR|US|ETF)$")
    start_date: str
    end_date: str
    initial_capital: float = Field(10_000_000, ge=100_000, le=100_000_000_000)
    entry_conditions: dict
    exit_conditions: dict
    stop_loss: Optional[float] = Field(None, ge=0.1, le=99.0)
    take_profit: Optional[float] = Field(None, ge=0.1, le=999.0)
    position_size: float = Field(0.95, gt=0, le=1.0)
    #: 샤프를 잴 때 뺄 무위험수익률(연 %). 0.0 이면 '무위험 0%' 라는
    #  **가정**이고, 그 가정도 응답에 적어 내보낸다.
    risk_free_rate: float = Field(0, ge=0, le=20)
    cost_rate: float = Field(0, ge=0, le=5)
    rank_by: str = Field("total_return", pattern="^(total_return|annual_return|mdd|sharpe_ratio|win_rate|profit_factor)$")
    top_n: int = Field(20, ge=1, le=50)

    @field_validator("start_date", "end_date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        return _parse_date(v)


class StrategySaveRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    market: str = Field(..., pattern="^(KR|US|ETF)$")
    entry_conditions: dict
    exit_conditions: dict
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None


@router.post("/run")
@limiter.limit("20/minute")
async def run_backtest(request: Request, req: BacktestRequest, db: Session = Depends(get_db), current_user: Optional[User] = Depends(get_current_user)):
    """백테스트 실행"""
    start_dt = datetime.strptime(req.start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(req.end_date, "%Y-%m-%d")
    if end_dt <= start_dt:
        raise HTTPException(status_code=400, detail="종료일은 시작일보다 이후여야 합니다")
    """기간은 **오늘부터 거꾸로** 잡아야 한다. 길이로 잡으면 안 된다.

    예전에는 `days = 끝 - 시작` 으로 period 를 골랐다. 3년짜리 요청이면
    '5y' 를 받아 오는데, yfinance 의 period 는 **오늘 기준**이라 그건
    '오늘부터 5년 전까지' 다. 2020~2023 을 요청하면 겹치는 1.28년만
    남았고, 화면은 3년을 쟀다고 믿었다(실측). 2015년이나 2008년처럼
    아예 안 겹치는 구간은 '데이터가 부족합니다' 로 막혔다.

    10년 요청만 우연히 맞았다 — period_map 을 넘어가 'max' 로 떨어졌기
    때문이다. 그래서 '10년은 되는데 3년은 이상하다' 는, 원인을 짐작하기
    가장 어려운 모양이 됐다.

    자산배분 쪽 `_기간이름` 은 처음부터 오늘 기준으로 세고 있었다.
    같은 화면의 두 탭이 다른 규칙을 쓰고 있었던 셈이다."""
    mkt = "KR" if req.market == "KR" else "US"
    #: 지표를 데울 구간까지 거슬러 받는다(아래 워밍업 설명 참고)
    데울시작 = (start_dt - timedelta(days=워밍업일수)).date().isoformat()
    period = _기간이름(데울시작, req.end_date)
    loop = asyncio.get_running_loop()
    """시세를 못 받는 것은 **사용자가 고칠 수 있는 일**이다.

    감싸지 않으면 야후가 한 번 삐끗할 때마다 500 이 나가고, 화면에는
    '알 수 없는 오류' 만 뜬다. 종목 코드를 잘못 쳤는지 서버가 고장
    났는지 구분할 수가 없다.

    자산배분 쪽에서 이미 같은 것을 고쳤다 — 여기만 남아 있었다."""
    try:
        ohlcv = await loop.run_in_executor(
            None, yf_service.get_ohlcv, req.symbol, period, "1d", mkt)
    except Exception as e:
        log.info("백테스트 시세 실패 %s: %s", req.symbol, type(e).__name__)
        raise HTTPException(
            status_code=400,
            detail="시세를 받지 못했어요. 종목 코드를 확인해 주세요")
    """**지표를 데울 구간을 앞에 붙여 준다.**

    예전에는 요청한 기간으로 딱 잘라서 엔진에 줬다. 엔진은 받은
    자료로만 지표를 만드니 앞부분이 비어 있고, 빈 값에서는 어떤 신호도
    안 난다. 1년 백테스트에 MA200 을 걸면 **1년 중 79%(199봉)가 죽은
    구간**이었다 — 거래 1건, 데워서 재면 6건이었다(실측). MA120 이면
    47%, MA60 이면 23% 다.

    그래서 자료는 데울 구간까지 주고, **매매와 기록은 요청한 날부터**
    하게 한다(평가시작). 지표는 데운 값으로 계산되고 성과는 요청한
    구간만 잡힌다 — 둘을 섞으면 안 된다."""
    데운것 = [row for row in (ohlcv or []) if 데울시작 <= row["date"] <= req.end_date]
    ohlcv = [row for row in 데운것 if req.start_date <= row["date"]]

    if len(ohlcv) < 20:
        raise HTTPException(status_code=400, detail="데이터가 부족합니다 (최소 20일 필요)")

    # 백테스트 실행
    result = backtest_engine.run(
        ohlcv=데운것,
        entry_conditions=req.entry_conditions,
        exit_conditions=req.exit_conditions,
        stop_loss=req.stop_loss,
        take_profit=req.take_profit,
        position_size=req.position_size,
        initial_capital=req.initial_capital,
        #: 화면은 퍼센트(0.1)로 주고 엔진은 비율(0.001)로 받는다.
        #  이 자리를 안 나누면 수수료가 100배가 된다.
        거래비용=(req.cost_rate or 0) / 100,
        평가시작=req.start_date,
        무위험수익률=(req.risk_free_rate or 0) / 100,
    )

    """**그냥 들고 있었으면 어땠나**를 같이 낸다.

    '연 12%' 만 보면 잘한 것인지 알 수 없다. 같은 기간 그 종목을 그냥
    사서 들고만 있어도 15% 였다면, 그 전략은 사고파느라 3%를 버린 것이다.
    신호 백테스트에서 제일 먼저 물어야 할 질문인데 답이 없었다.

    같은 자료·같은 기간·같은 수수료로 **한 번만 사서 끝까지 들고 가는**
    전략을 돌린다. 시세를 더 받지 않으므로 느려지지도 않는다.
    (자산배분 쪽은 지수와 견주지만, 신호 백테스트는 '이 종목을 그냥
     들고 있기' 가 훨씬 정직한 상대다 — 종목을 고른 것까지 성과로
     치면 전략이 한 일을 알 수 없다.)"""
    사고버티기 = None
    try:
        묻지도않고삼 = {"logic": "AND", "conditions": [
            {"indicator": "PRICE", "operator": ">", "value": 0}]}
        안팜 = {"logic": "AND", "conditions": []}
        기준 = backtest_engine.run(
            ohlcv=데운것, entry_conditions=묻지도않고삼, exit_conditions=안팜,
            position_size=req.position_size, initial_capital=req.initial_capital,
            거래비용=(req.cost_rate or 0) / 100,
            평가시작=req.start_date,
            무위험수익률=(req.risk_free_rate or 0) / 100,
        )
        if 기준:
            사고버티기 = {k: 기준.get(k) for k in
                          ("total_return", "annual_return", "mdd", "sharpe_ratio")}
    except Exception as e:
        #: 견주는 것은 덤이다. 덤 때문에 본래 답까지 버리면 안 된다.
        log.info("사고버티기 계산 실패: %s", type(e).__name__)
    result["buy_and_hold"] = 사고버티기

    # 로그인 시에만 결과 DB 저장
    if current_user:
        bt_record = BacktestResult(
            strategy_id=req.strategy_id,
            user_id=current_user.id,
            symbol=req.symbol,
            market=req.market,
            start_date=req.start_date,
            end_date=req.end_date,
            initial_capital=req.initial_capital,
            total_return=result.get("total_return"),
            annual_return=result.get("annual_return"),
            mdd=result.get("mdd"),
            sharpe_ratio=result.get("sharpe_ratio"),
            win_rate=result.get("win_rate"),
            total_trades=result.get("total_trades"),
            equity_curve=result.get("equity_curve"),
            trades=result.get("trades"),
        )
        db.add(bt_record)
        db.commit()
        db.refresh(bt_record)
        return {"id": bt_record.id, **result}

    return result


@router.post("/universe")
@limiter.limit("5/minute")
async def run_universe_backtest(request: Request, req: UniverseBacktestRequest, current_user: Optional[User] = Depends(get_current_user)):
    """전체 종목 유니버스 백테스트"""
    from app.services.yf_service import SP500_SYMBOLS, KOSPI_SYMBOLS, KOSDAQ_SYMBOLS, ETF_SYMBOLS

    """캐시 열쇠를 **해시로 줄인다.**

    예전에는 요청 전체를 글자로 만들어 열쇠로 썼다. 종목 100개를 넣고
    재 보니 열쇠 하나가 2,852자였다. 조건을 조금만 바꿔도 완전히 다른
    열쇠가 생기고, 그게 전부 5분씩 남는다 — 512MB 서버에서는 그 자체가
    부담이다.

    sha1 로 40자로 줄인다. 값이 같으면 열쇠도 같으므로 캐시는 그대로
    듣고, 길이만 사라진다. (열쇠끼리 겹칠 일은 사실상 없고, 겹쳐도
    남의 자료가 새는 것이 아니라 같은 조건의 결과가 나온다.)"""
    import hashlib, json as _json
    _재료 = _json.dumps(req.model_dump(), sort_keys=True, default=str, ensure_ascii=False)
    ck = f"universe_bt:{hashlib.sha1(_재료.encode()).hexdigest()}"
    if cached := cache.get(ck):
        return cached

    start_dt = datetime.strptime(req.start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(req.end_date, "%Y-%m-%d")
    if end_dt <= start_dt:
        raise HTTPException(status_code=400, detail="종료일은 시작일보다 이후여야 합니다")

    universe_map = {
        "SP500": SP500_SYMBOLS,
        "KOSPI": KOSPI_SYMBOLS,
        "KOSDAQ": KOSDAQ_SYMBOLS,
        "ETF": ETF_SYMBOLS,
        "CUSTOM": req.custom_symbols,
    }
    symbols = universe_map.get(req.universe, SP500_SYMBOLS)
    if not symbols:
        raise HTTPException(status_code=400, detail="종목 목록이 비어있습니다")

    #: 기간과 워밍업은 /run 과 똑같은 규칙이다. 두 탭이 같은 전략을
    #  다른 구간으로 재면 나란히 놓고 볼 수가 없다.
    데울시작 = (start_dt - timedelta(days=워밍업일수)).date().isoformat()
    period = _기간이름(데울시작, req.end_date)

    loop = asyncio.get_running_loop()
    mkt = "KR" if req.market == "KR" else "US"

    sem = asyncio.Semaphore(5)  # 동시 5개 제한

    async def run_one(symbol: str):
        async with sem:
            try:
                ohlcv = await loop.run_in_executor(None, yf_service.get_ohlcv, symbol, period, "1d", mkt)
                데운것 = [r for r in ohlcv if 데울시작 <= r["date"] <= req.end_date]
                ohlcv = [r for r in 데운것 if req.start_date <= r["date"]]
                if len(ohlcv) < 30:
                    return None
                result = await loop.run_in_executor(
                    None,
                    lambda: backtest_engine.run(
                        ohlcv=데운것,
                        entry_conditions=req.entry_conditions,
                        exit_conditions=req.exit_conditions,
                        stop_loss=req.stop_loss,
                        take_profit=req.take_profit,
                        position_size=req.position_size,
                        initial_capital=req.initial_capital,
                        거래비용=(req.cost_rate or 0) / 100,
                        평가시작=req.start_date,
                        무위험수익률=(req.risk_free_rate or 0) / 100,
                    )
                )
                if not result:
                    return None
                return {
                    "symbol": symbol,
                    "market": req.market,
                    "total_return": result.get("total_return"),
                    "annual_return": result.get("annual_return"),
                    "mdd": result.get("mdd"),
                    "sharpe_ratio": result.get("sharpe_ratio"),
                    "win_rate": result.get("win_rate"),
                    "total_trades": result.get("total_trades"),
                    "profit_factor": result.get("profit_factor"),
                    "equity_curve": result.get("equity_curve", [])[-1:],
                }
            except Exception:
                return None

    raw = await asyncio.gather(*[run_one(s) for s in symbols])
    results = [r for r in raw if r is not None and r.get("total_trades", 0) > 0]

    """**못 잰 값을 0 으로 뭉개지 않는다.**

    손실이 한 번도 없으면 손익비는 나눌 수가 없어 None 이 온다.
    그런데 `or 0` 으로 두면 그게 0점이 되고, 0점은 '최악' 이라는 뜻이다 —
    **한 번도 안 진 전략이 순위 맨 아래로 밀렸다**(실측: 완벽 < 나쁨).

    손실이 없다는 것은 손익비가 무한대라는 뜻이므로, 높은 순으로 볼
    때는 맨 앞이 맞다. 낮은 순(최대 낙폭)일 때는 못 잰 것을 맨 뒤로
    보낸다 — 어느 쪽이든 '모르는 것' 이 '나쁜 것' 행세를 하면 안 된다.

    엔진이 없는 값을 None 으로 주는 것은 그렇게 쓰라고 그런 것이다.
    받는 쪽에서 0 으로 되돌리면 그 공이 통째로 헛일이 된다."""
    높은순 = req.rank_by not in ("mdd",)
    없음자리 = float("inf") if 높은순 else float("inf")

    def 순위값(x):
        v = x.get(req.rank_by)
        return 없음자리 if v is None else v

    results.sort(key=순위값, reverse=높은순)

    """**생존 편향을 반드시 적어 보낸다.**

    종목 목록이 '오늘 살아남아 시총 상위에 있는 것들' 로 고정돼 있다.
    그동안 망했거나 상장폐지됐거나 밀려난 회사는 애초에 목록에 없다.
    그래서 어떤 전략을 넣어도 실제보다 좋게 나온다 — 10년 전에 그
    전략을 돌렸다면 지금 목록에 없는 종목들도 같이 샀을 것이다.

    과거 시점의 구성 종목표가 있어야 제대로 고칠 수 있는데 지금은
    그 자료가 없다. 자료가 없으면 **없다고 말하는 것**이 맞다 —
    조용히 두면 사용자는 이 결과를 실제 성적으로 읽는다.

    'SP500' 이라는 이름도 정직하지 않아 개수를 같이 보낸다. 진짜
    S&P 500 이 아니라 손으로 고른 316개다."""
    payload = {
        "universe": req.universe,
        "total_symbols": len(symbols),
        "tested": len(results),
        "results": results[:req.top_n],
        "생존편향": (
            f"종목 {len(symbols)}개는 **오늘** 기준 목록이에요. "
            "그동안 상장폐지되거나 밀려난 회사는 처음부터 빠져 있어서, "
            "실제로 그때 돌렸을 때보다 결과가 좋게 나옵니다."
        ),
    }
    cache.set(ck, payload, 300)
    return payload


@router.get("/results")
def get_backtest_results(
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """내 백테스트 결과 목록"""
    results = (
        db.query(BacktestResult)
        .join(Strategy, BacktestResult.strategy_id == Strategy.id, isouter=True)
        .filter(
            or_(
                BacktestResult.user_id == current_user.id,
                and_(BacktestResult.user_id == None, Strategy.user_id == current_user.id),
            )
        )
        .order_by(BacktestResult.created_at.desc())
        .limit(limit)
        .all()
    )
    return results


@router.get("/results/{result_id}")
def get_backtest_result(
    result_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """백테스트 결과 상세 (본인 것만)"""
    result = (
        db.query(BacktestResult)
        .join(Strategy, BacktestResult.strategy_id == Strategy.id, isouter=True)
        .filter(
            BacktestResult.id == result_id,
            or_(
                BacktestResult.user_id == current_user.id,
                and_(BacktestResult.user_id == None, Strategy.user_id == current_user.id),
            ),
        )
        .first()
    )
    if not result:
        raise HTTPException(status_code=404, detail="백테스트 결과를 찾을 수 없습니다")
    return result


# 전략 관리
@router.get("/strategies")
def get_strategies(
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """내 전략 목록 (비로그인 시 빈 배열)"""
    if not current_user:
        return []
    return (
        db.query(Strategy)
        .filter(Strategy.is_active == True, Strategy.user_id == current_user.id)
        .all()
    )


@router.post("/strategies")
def save_strategy(req: StrategySaveRequest, db: Session = Depends(get_db), current_user: User = Depends(require_user)):
    """전략 저장"""
    strategy = Strategy(
        name=req.name,
        description=req.description,
        market=req.market,
        entry_conditions=req.entry_conditions,
        exit_conditions=req.exit_conditions,
        stop_loss=req.stop_loss,
        take_profit=req.take_profit,
        user_id=current_user.id,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


@router.put("/strategies/{strategy_id}")
def update_strategy(strategy_id: int, req: StrategySaveRequest, db: Session = Depends(get_db), current_user: User = Depends(require_user)):
    """전략 업데이트 (버전 관리)"""
    strategy = db.query(Strategy).filter(
        Strategy.id == strategy_id,
        Strategy.user_id == current_user.id,
    ).first()
    if not strategy:
        raise HTTPException(status_code=404, detail="전략을 찾을 수 없습니다")

    strategy.name = req.name
    strategy.description = req.description
    strategy.market = req.market
    strategy.entry_conditions = req.entry_conditions
    strategy.exit_conditions = req.exit_conditions
    strategy.stop_loss = req.stop_loss
    strategy.take_profit = req.take_profit
    strategy.version += 1
    db.commit()
    db.refresh(strategy)
    return strategy


@router.delete("/strategies/{strategy_id}")
def delete_strategy(strategy_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_user)):
    """전략 삭제 (비활성화)"""
    strategy = db.query(Strategy).filter(
        Strategy.id == strategy_id,
        Strategy.user_id == current_user.id,
    ).first()
    if not strategy:
        raise HTTPException(status_code=404, detail="전략을 찾을 수 없습니다")
    strategy.is_active = False
    db.commit()
    return {"message": "삭제 완료"}


# ═══════════════════════════════════════════════════════════════
#  자산배분 백테스트 — '이렇게 굴렸으면 어떻게 됐을까'
#
#  위쪽(/run·/universe)과 **다른 종류**다. 그쪽은 한 종목에 매매 신호를
#  걸어 보는 것이고, 이쪽은 여러 자산을 비중대로 담아 적립·리밸런싱하며
#  굴려 보는 것이다. 보통 사람이 실제로 하는 투자에 훨씬 가깝다.
# ═══════════════════════════════════════════════════════════════

class 자산칸(BaseModel):
    #: '^' 를 받아야 한다 — **지수 티커는 ^ 로 시작한다**(^KS11, ^GSPC).
    #
    #  예전에는 없었다. 그래서 벤치마크 '코스피'(^KS11)를 고르면
    #  벤치마크표의 칸을 이 모델로 만드는 자리에서 ValidationError 가
    #  나고, 그것이 바깥의 넓은 except 에 잡혀 **아무 말 없이** 비교
    #  줄만 사라졌다. 화면에는 고를 수 있게 떠 있는데 고르면 안 나오는,
    #  오류도 안 나는 모양이었다(실측으로 확인했다).
    symbol: str = Field(..., min_length=1, max_length=20, pattern=r"^[\^A-Za-z0-9.\-가-힣]+$")
    market: str = Field("US", pattern="^(KR|US|ETF)$")
    name: Optional[str] = Field(None, max_length=100)
    #: 비중. 60 으로 줘도 0.6 으로 줘도 된다 — 엔진이 합으로 나눠 맞춘다
    weight: float = Field(0, ge=0, le=1000)


#: 벤치마크 — '내 조합이 그냥 이렇게 둔 것보다 나았나'.
#
#  수익률만 보면 좋은지 나쁜지 알 수 없다. 8년에 연 9%가 잘한 것인지
#  아닌지는 같은 기간 S&P500 이 몇 %였나를 봐야 정해진다. 그래서 같은
#  기간·같은 납입·같은 비용으로 한 번 더 돌려 나란히 보여 준다.
벤치마크표: dict[str, dict] = {
    "none":   {"name": "없음", "assets": []},
    "6040":   {"name": "주식 60 · 채권 40",
               "assets": [{"symbol": "SPY", "market": "US", "weight": 60},
                          {"symbol": "AGG", "market": "US", "weight": 40}]},
    "spy":    {"name": "S&P500",
               "assets": [{"symbol": "SPY", "market": "US", "weight": 100}]},
    "qqq":    {"name": "나스닥100",
               "assets": [{"symbol": "QQQ", "market": "US", "weight": 100}]},
    #: 'kospi' 는 처음부터 069500(KODEX 200)이었다. **키의 뜻을 바꾸면
    #  안 된다** — 이미 저장된 실험들이 이 키를 들고 있어서, 뜻을 바꾸면
    #  같은 실험을 다시 열었을 때 조용히 다른 것과 견주게 된다.
    #  그래서 코스피 지수는 새 키로 더한다.
    "kospi":  {"name": "코스피200",
               "assets": [{"symbol": "069500", "market": "KR", "weight": 100}]},
    #: 코스피 지수 그 자체. ETF 가 아니라 **지수**라 배당이 없다 —
    #  토탈 리턴으로 잰 내 조합과 견주면 지수 쪽이 배당만큼 불리하다.
    #  그 사실을 화면이 적어 준다(index_only).
    "kospi_index": {"name": "코스피", "index_only": True,
                    "assets": [{"symbol": "^KS11", "market": "KR", "weight": 100}]},
    "allweather": {"name": "올웨더",
                   "assets": [{"symbol": "SPY", "market": "US", "weight": 30},
                              {"symbol": "TLT", "market": "US", "weight": 40},
                              {"symbol": "IEF", "market": "US", "weight": 15},
                              {"symbol": "GLD", "market": "US", "weight": 7.5},
                              {"symbol": "DBC", "market": "US", "weight": 7.5}]},
}

#: ETF 가 생기기 전 구간을 **그 ETF 가 따라가는 지수**로 잇는다.
#  화면의 '확장된 ETF 가격 사용'.
#
#  SPY 는 1993년에 생겼다. 1980년부터 보고 싶으면 그 앞 13년은 자료가
#  아예 없어서, 요청한 기간이 조용히 잘린다. 지수는 훨씬 길게 있다.
#
#  **공짜가 아니다** — 지수는 배당이 빠진 가격지수이고 운용보수도 없다.
#  이은 구간은 실제 ETF 보다 배당만큼 낮게, 보수만큼 높게 나온다.
#  그래서 어느 자산을 언제부터 이었는지 응답에 적어 화면에 띄운다.
지수잇기: dict[str, str] = {
    "SPY": "^GSPC", "VOO": "^GSPC", "IVV": "^GSPC", "SPLG": "^GSPC",
    "QQQ": "^IXIC", "QQQM": "^IXIC",
    "DIA": "^DJI",
    "IWM": "^RUT", "VTWO": "^RUT",
    "069500": "^KS11", "102110": "^KS11", "148020": "^KS11",
    "229200": "^KQ11",
}


class 자산배분요청(BaseModel):
    assets: list[자산칸] = Field(..., min_length=1, max_length=12)
    currency: str = Field("KRW", pattern="^(KRW|USD)$")
    initial_amount: float = Field(..., gt=0, le=1e12)
    start_date: str
    end_date: str
    contribution_period: str = Field("none", pattern="^(none|monthly|quarterly|yearly)$")
    contribution_amount: float = Field(0, ge=0, le=1e11)
    rebalance_period: str = Field("none", pattern="^(none|monthly|quarterly|yearly)$")
    #: 배당을 재투자해 '토탈 리턴' 으로 잴까. 화면의 체크박스.
    total_return: bool = True

    #: 달의 며칠에 리밸런싱·적립을 할까. 월급날에 맞추는 사람이 많다.
    #  29~31 은 없는 달이 있어 28 까지만 받는다.
    rebalance_day: int = Field(1, ge=1, le=28)
    #: 거래비용(%). 0.1 이면 0.1% — 화면이 퍼센트로 주고 여기서 나눈다.
    cost_rate: float = Field(0, ge=0, le=5)
    #: 일별로 잴까 월별로 잴까. 긴 기간은 월이 가볍다.
    data_interval: str = Field("daily", pattern="^(daily|monthly)$")
    #: 견줄 상대
    benchmark: str = Field("none")
    #: 비중을 화면에서 준 대로 쓸까, 똑같이 나눌까
    equal_weight: bool = False
    #: 현금에 붙는 연 이율(%). 0 이면 '현금은 안 불어난다' 는 가정이다.
    cash_rate: float = Field(0, ge=0, le=20)
    #: 샤프를 잴 때 뺄 무위험수익률(연 %).
    risk_free_rate: float = Field(0, ge=0, le=20)
    #: 진행 상황을 적어 둘 열쇠. 화면이 만들어 보내고 따로 물어본다.
    #  안 보내도 계산은 그대로 돈다 — 진행 표시만 어림으로 돌아간다.
    progress_key: Optional[str] = Field(None, min_length=8, max_length=64,
                                        pattern=r"^[A-Za-z0-9_-]+$")
    #: ETF 가 생기기 전 구간을 지수로 이을까
    extended: bool = False

    @field_validator("start_date", "end_date")
    @classmethod
    def _날짜(cls, v: str) -> str:
        return _parse_date(v)

    @field_validator("benchmark")
    @classmethod
    def _벤치(cls, v: str) -> str:
        if v not in 벤치마크표:
            raise ValueError(f"모르는 벤치마크입니다: {v}")
        return v


class 실험저장요청(자산배분요청):
    name: str = Field(..., min_length=1, max_length=100)


# ═══════════════════════════════════════════════════════════
#  진행 상황 — **서버가 실제로 어디까지 했나**
# ═══════════════════════════════════════════════════════════
#
#  ── 왜 필요한가 ───────────────────────────────────────────
#
#  화면의 진행바는 순전히 추측이었다. '설정을 보고 어림한 시간' 대비
#  '지난 시간' 이라 92%에서 멈춰 놓고, 실제로는 30초를 더 기다렸다.
#  자산 둘이면 어림이 4.2초인데 무료 서버가 자고 있었으면 첫 요청이
#  30초를 넘는다 — 4초 만에 92%를 찍고 그 뒤로는 안 움직였다.
#
#  멈춘 막대는 아무것도 없는 것보다 나쁘다. 사용자는 화면이 죽은 줄
#  알고 새로고침하는데, 그러면 처음부터 다시 시작한다.
#
#  ── 어떻게 ────────────────────────────────────────────────
#
#  스트리밍(SSE)이 아니라 **열쇠 + 물어보기**로 한다. 화면이 요청에
#  열쇠를 하나 실어 보내면, 서버가 일하면서 그 열쇠에 진행 상황을
#  적어 둔다. 화면은 따로 물어본다.
#
#  스트리밍을 안 쓴 이유 — 중간에 있는 프록시가 응답을 모아 뒀다가
#  한 번에 보내면 진행 상황이 통째로 안 온다. 그러면 '고쳤는데 그대로'
#  가 되는데, 그게 왜인지는 화면만 봐서는 알 수가 없다.
#
#  못 물어봐도 계산은 그대로 돈다 — 진행 표시만 예전처럼 어림으로
#  돌아간다. 덤이 본래 일을 막으면 안 된다.

#: 단계마다 전체에서 차지하는 몫. 실제로 시간을 먹는 순서다 —
#  시세 받기가 제일 크고, 엔진이 도는 것은 순식간이다.
_진행무게 = {"시세": 0.40, "환율": 0.05, "배당": 0.30, "계산": 0.05, "벤치마크": 0.20}
_진행순서 = ["시세", "환율", "배당", "계산", "벤치마크"]


def _진행쓰기(열쇠: Optional[str], 단계: str, 된것: int = 1, 전체: int = 1,
              글: str = "") -> None:
    """지금 무슨 단계의 몇 분의 몇인지 적어 둔다.

    앞 단계들의 몫을 다 더하고, 지금 단계는 된 만큼만 더한다. 그래서
    퍼센트가 **뒤로 가지 않는다** — 뒤로 가는 막대는 고장으로 읽힌다.
    """
    if not 열쇠:
        return
    앞 = sum(_진행무게[s] for s in _진행순서[:_진행순서.index(단계)])
    몫 = _진행무게[단계] * (된것 / 전체 if 전체 > 0 else 1)
    try:
        cache.set(f"진행:{열쇠}", {
            "단계": 단계,
            "done": 된것,
            "total": 전체,
            "글": 글,
            #: 99 를 넘지 않는다. 100 은 응답이 실제로 왔을 때만이다 —
            #  다 됐다고 해 놓고 계속 도는 것이 제일 나쁘다.
            "percent": min(round((앞 + 몫) * 100), 99),
        }, 180)
    except Exception:
        #: 진행 표시 때문에 계산이 멈추면 안 된다
        pass


def _기간이름(시작: str, 끝: str) -> str:
    """yfinance 가 받는 기간 이름. 넉넉히 잡는다.

    yfinance 의 period 는 **오늘 기준**이라, 옛날 구간을 보려면 그만큼
    길게 받아 와서 날짜로 잘라야 한다. 짧게 잡으면 요청한 구간이
    통째로 비어 '자료가 없다' 가 된다."""
    from datetime import datetime as _dt
    오늘 = _dt.now().date()
    시작일 = _dt.strptime(시작, "%Y-%m-%d").date()
    지난날 = (오늘 - 시작일).days
    for 한계, 이름 in [(365, "2y"), (730, "5y"), (1825, "10y")]:
        if 지난날 <= 한계:
            return 이름
    return "max"


def 앞에잇기(짧은것: dict, 긴것: dict) -> tuple[dict, Optional[str]]:
    """ETF 가 생기기 전 구간을 지수로 잇는다.

    **가격을 그대로 이어 붙이면 안 된다.** SPY 는 400 근처이고 ^GSPC 는
    5,000 근처라, 그냥 붙이면 ETF 가 시작하는 날 하루 만에 92% 폭락한
    것으로 잡힌다. 최대 낙폭이 -92% 로 나오고 수익률도 통째로 망가진다.

    이어야 할 것은 **수익률**이다. ETF 첫날 가격을 기준으로 지수를
    비율만큼 되감아, 두 구간이 그 지점에서 이어지게 만든다.

        되감은 가격(d) = ETF 첫날 가격 × 지수(d) / 지수(ETF 첫날)

    돌려주는 둘째 값은 '언제부터 이었나'. 조용히 이으면 사용자는
    1980년치 SPY 자료가 있는 줄 안다 — 실제로는 지수를 본 것이다.
    """
    if not 짧은것 or not 긴것:
        return 짧은것, None
    이음날 = min(짧은것)
    앞날들 = [d for d in 긴것 if d < 이음날]
    if not 앞날들:
        return 짧은것, None
    기준 = 긴것.get(이음날)
    if not 기준 or 기준 <= 0:
        """이음날에 지수 값이 없으면(그날 지수가 휴장) 바로 앞 날로 맞춘다.
        기준이 없다고 1.0 으로 두면 배율이 통째로 어긋난다."""
        앞선것 = [d for d in 긴것 if d <= 이음날]
        if not 앞선것:
            return 짧은것, None
        기준 = 긴것[max(앞선것)]
        if 기준 <= 0:
            return 짧은것, None
    배율 = 짧은것[이음날] / 기준
    이은것 = {d: 긴것[d] * 배율 for d in 앞날들}
    이은것.update(짧은것)
    return 이은것, min(앞날들).isoformat()


async def _시세모으기(자산들: list, 기간: str, 시작: str, 끝: str,
                      확장: bool = False, 알림=None) -> tuple[dict, dict]:
    """자산마다 일봉을 받아 {심볼: {날짜: 종가}} 로 만든다.

    현금은 건너뛴다 — 받아올 시세가 없다.
    동시에 받는 수를 묶는다. 0.15 CPU 에서 열두 개를 한꺼번에 던지면
    그 자체가 부담이고, 야후도 몰아치면 막는다.

    확장 — ETF 가 생기기 전 구간을 지수로 이을까(앞에잇기 참고).

    둘째로 돌려주는 것은 {심볼: 이은 시작일} 이다. 화면에 띄워야 한다.
    """
    from datetime import date as _date
    from app.services.portfolio_backtest import 현금류

    loop = asyncio.get_running_loop()
    sem = asyncio.Semaphore(4)

    def 표만들기(봉들) -> dict:
        표 = {}
        for r in 봉들 or []:
            d = r.get("date")
            종가 = r.get("close")
            if not d or not 종가 or not (시작 <= d <= 끝):
                continue
            try:
                표[_date.fromisoformat(d)] = float(종가)
            except (ValueError, TypeError):
                continue
        return 표

    async def 받기(심볼: str, 시장: str) -> dict:
        async with sem:
            try:
                봉들 = await loop.run_in_executor(
                    None, yf_service.get_ohlcv, 심볼, 기간, "1d", 시장)
            except Exception as e:
                log.info("자산배분 시세 실패 %s: %s", 심볼, type(e).__name__)
                return {}
        return 표만들기(봉들)

    async def 하나(a):
        if a.symbol in 현금류:
            return a.symbol, {}, None
        mkt = "KR" if a.market == "KR" else "US"
        표 = await 받기(a.symbol, mkt)
        이은날 = None
        지수 = 지수잇기.get(a.symbol.upper()) if 확장 else None
        if 지수 and 표:
            """지수를 받는 데 실패해도 원래 시세는 그대로 쓴다.
            '확장' 은 더 보여 주려는 것이지 없으면 못 쓰는 것이 아니다."""
            표, 이은날 = 앞에잇기(표, await 받기(지수, mkt))
        return a.symbol, 표, 이은날

    """하나 받을 때마다 알려 준다.

    gather 가 다 끝난 뒤에 한 번 알리면 진행바가 그 사이 내내 멈춰
    있다 — 자산 여덟이면 제일 오래 걸리는 구간이 통째로 죽은 시간이
    된다. 끝난 순서대로 세어 올린다(시작한 순서가 아니다)."""
    센것 = [0]

    async def 하나세며(a):
        결과 = await 하나(a)
        센것[0] += 1
        if 알림:
            알림(센것[0], len(자산들), getattr(a, "name", None) or getattr(a, "symbol", ""))
        return 결과

    나온것 = await asyncio.gather(*[하나세며(a) for a in 자산들])
    return ({심볼: 표 for 심볼, 표, _ in 나온것 if 표},
            {심볼: 날 for 심볼, _, 날 in 나온것 if 날})


async def _환율표(시작: str, 끝: str, 기간: str) -> dict:
    """일별 원/달러. {날짜: 환율}.

    통화를 맞추는 것이 이 기능에서 제일 놓치기 쉬운 자리다. 원화로 보는
    사람에게 미국 주식은 '주가 × 환율' 이고, 환율을 빼면 2022년처럼
    환율이 20% 오른 해의 결과가 통째로 틀린다. 한국 투자자에게 이건
    작은 항이 아니다.
    """
    from datetime import date as _date
    loop = asyncio.get_running_loop()
    try:
        봉들 = await loop.run_in_executor(
            None, yf_service.get_ohlcv, "USDKRW=X", 기간, "1d", "US")
    except Exception as e:
        log.info("환율 시계열 실패: %s", type(e).__name__)
        return {}
    표 = {}
    for r in 봉들 or []:
        d, 값 = r.get("date"), r.get("close")
        if d and 값 and 시작 <= d <= 끝:
            try:
                표[_date.fromisoformat(d)] = float(값)
            except (ValueError, TypeError):
                continue
    return 표


def _통화맞추기(가격표: dict, 자산들: list, 표시통화: str, 환율: dict) -> tuple[dict, list]:
    """자산의 원래 통화를 표시 통화로 바꾼다.

    국내 종목은 원, 해외는 달러로 온다. 한 포트폴리오 안에서 둘을 그냥
    더하면 '71,000 + 225' 같은 뜻 없는 수가 된다 — 조용히 틀리고
    화면에는 아무 표시도 안 난다.

    환율을 못 받았으면 **바꾸지 않고 그 자산을 뺀다.** 억지로 1:1 로
    더하느니 빼고 그 사실을 알리는 쪽이 낫다.

    그 '뺀다' 는 아래 한 군데에서만 일어난다 — 날마다 환율을 찾다가
    하나도 못 찾으면 새표가 비고, 빈 표는 뺀 것으로 친다. 환율 표가
    통째로 비었을 때를 위에서 따로 걸러도 결과는 똑같아서(그렇게
    짰다가 뮤테이션이 살아남는 것으로 확인했다) 두지 않는다.
    길이 하나면 한 군데만 맞으면 된다.
    """
    from app.services.portfolio_backtest import 현금류

    바뀐것, 뺀것 = {}, []
    for a in 자산들:
        표 = 가격표.get(a.symbol)
        if not 표 or a.symbol in 현금류:
            continue
        원래통화 = "KRW" if a.market == "KR" else "USD"
        if 원래통화 == 표시통화:
            바뀐것[a.symbol] = 표
            continue
        새표 = {}
        for d, 값 in 표.items():
            fx = 환율.get(d)
            if fx is None or fx <= 0:
                continue                      # 환율이 없는 날은 통째로 뺀다
            새표[d] = 값 * fx if 표시통화 == "KRW" else 값 / fx
        if 새표:
            바뀐것[a.symbol] = 새표
        else:
            뺀것.append(a.symbol)
    return 바뀐것, 뺀것


async def _배당표(자산들: list, 시작: str, 끝: str, 표시통화: str, 환율: dict,
                  알림=None) -> dict:
    """{심볼: {날짜: 주당 배당금}} — 표시 통화로 바꾼 값.

    배당도 통화를 맞춰야 한다. 안 맞추면 달러 배당이 원화 포트폴리오에
    1/1400 크기로 들어가 사실상 없는 것이 된다.
    """
    from datetime import date as _date
    from app.services import dividend_service as DV
    from app.services.portfolio_backtest import 현금류

    loop = asyncio.get_running_loop()
    sem = asyncio.Semaphore(4)

    async def 하나(a):
        if a.symbol in 현금류:
            return a.symbol, {}
        async with sem:
            try:
                받은것 = await loop.run_in_executor(None, DV.한종목, a.symbol, a.market, True)
            except Exception:
                return a.symbol, {}
        원래통화 = "KRW" if a.market == "KR" else "USD"
        표 = {}
        for x in (받은것 or {}).get("recent", []):
            d, 금액 = x.get("date"), x.get("amount")
            if not d or not 금액 or not (시작 <= d <= 끝):
                continue
            try:
                날 = _date.fromisoformat(d)
            except ValueError:
                continue
            값 = float(금액)
            if 원래통화 != 표시통화:
                fx = 환율.get(날)
                if not fx:
                    continue
                값 = 값 * fx if 표시통화 == "KRW" else 값 / fx
            표[날] = 값
        return a.symbol, 표

    센것 = [0]

    async def 하나세며(a):
        결과 = await 하나(a)
        센것[0] += 1
        if 알림:
            알림(센것[0], len(자산들), getattr(a, "name", None) or getattr(a, "symbol", ""))
        return 결과

    나온것 = await asyncio.gather(*[하나세며(a) for a in 자산들])
    return {심볼: 표 for 심볼, 표 in 나온것 if 표}


@router.post("/portfolio")
@limiter.limit("10/minute")
async def run_portfolio_backtest(request: Request, req: 자산배분요청):
    """자산배분 백테스트 실행."""
    from app.services import portfolio_backtest as PB

    시작dt = datetime.strptime(req.start_date, "%Y-%m-%d")
    끝dt = datetime.strptime(req.end_date, "%Y-%m-%d")
    if 끝dt <= 시작dt:
        raise HTTPException(status_code=400, detail="종료일은 시작일보다 이후여야 합니다")
    if (끝dt - 시작dt).days < 60:
        raise HTTPException(status_code=400, detail="기간이 너무 짧습니다 (최소 2개월)")

    기간 = _기간이름(req.start_date, req.end_date)
    열쇠 = req.progress_key
    _진행쓰기(열쇠, "시세", 0, max(len(req.assets), 1), "시세를 받는 중")
    가격표, 이은것 = await _시세모으기(
        req.assets, 기간, req.start_date, req.end_date, req.extended,
        알림=lambda 된, 전, 이름: _진행쓰기(열쇠, "시세", 된, 전, f"{이름} 시세"))

    고른벤치 = 벤치마크표.get(req.benchmark) or 벤치마크표["none"]

    def _통화(시장: str) -> str:
        return "KRW" if 시장 == "KR" else "USD"

    섞였나 = len({_통화(a.market) for a in req.assets}) > 1
    """환율은 **벤치마크 몫까지** 생각해서 받아야 한다.

    예전에는 내 자산만 봤다. 그러면 원화로 한국 종목만 담은 사람이
    S&P500 과 견주려 할 때 — 제일 흔한 조합이다 — 환율을 아예 안
    받는다. 벤치마크는 달러라 바꿀 환율이 없어 통째로 빠지고,
    화면에는 **아무 말도 없이** 비교 줄만 사라진다. 고른 것이 왜
    안 나오는지 알 길이 없다(실측: KRW+005930+S&P500 → benchmark None).
    """
    바꿔야하나 = any(_통화(a.market) != req.currency for a in req.assets) or \
        any(_통화(x["market"]) != req.currency for x in 고른벤치["assets"])
    if 바꿔야하나:
        _진행쓰기(열쇠, "환율", 0, 1, "환율을 받는 중")
    환율 = await _환율표(req.start_date, req.end_date, 기간) if 바꿔야하나 else {}
    _진행쓰기(열쇠, "환율", 1, 1, "환율 정리")
    가격표, 뺀것 = _통화맞추기(가격표, req.assets, req.currency, 환율)

    쓸자산 = [a for a in req.assets
              if a.symbol in 가격표 or a.symbol in PB.현금류]
    못받음 = [a.symbol for a in req.assets
              if a.symbol not in 가격표 and a.symbol not in PB.현금류]
    if not [a for a in 쓸자산 if a.symbol not in PB.현금류]:
        raise HTTPException(
            status_code=400,
            detail="시세를 받을 수 있는 자산이 없습니다. 종목 코드를 확인해 주세요")

    배당 = None
    if req.total_return:
        _진행쓰기(열쇠, "배당", 0, max(len(쓸자산), 1), "배당 기록을 받는 중")
        배당 = await _배당표(
            쓸자산, req.start_date, req.end_date, req.currency, 환율,
            알림=lambda 된, 전, 이름: _진행쓰기(열쇠, "배당", 된, 전, f"{이름} 배당"))
    _진행쓰기(열쇠, "배당", 1, 1, "배당 정리")

    #: 화면은 퍼센트(0.1)로 주고 엔진은 비율(0.001)로 받는다.
    #  이 자리를 안 나누면 수수료가 100배가 된다 — 결과가 통째로 무너지는데
    #  오류는 안 나므로 '왜 이렇게 손해지' 만 남는다.
    비용률 = (req.cost_rate or 0) / 100

    def 돌리자(표: dict, 자산들: list[dict], 그배당: Optional[dict]) -> dict:
        if req.data_interval == "monthly" and 표:
            """월 데이터는 **엔진에 넣기 전에** 솎는다.

            결과 곡선만 솎으면 안 된다. 그러면 곡선은 가벼워도 수익률·
            낙폭·리밸런싱은 일별로 계산된 값이라, 화면의 그래프와 숫자가
            서로 다른 것을 말하게 된다.

            배당은 그대로 둔다 — 배당일이 월말이 아니면 솎인 날에 안
            걸려서 통째로 사라진다. 엔진은 그날 시세가 있는 종목만
            재투자하므로 남은 배당은 알아서 무시된다."""
            남길날 = set(PB.월말만(sorted(
                set.intersection(*(set(표[s]) for s in 표)))))
            표 = {s: {d: v for d, v in 표[s].items() if d in 남길날} for s in 표}
            if 그배당:
                """달 안에 흩어진 배당을 그 달의 남은 날로 모은다.
                안 모으면 월 데이터에서 배당이 거의 다 사라져, 같은
                설정인데 '월' 로 바꾸기만 해도 성적이 뚝 떨어진다."""
                모은것: dict = {}
                차례 = sorted(남길날)
                for 심볼, 표2 in 그배당.items():
                    쌓기: dict = {}
                    for d, 금액 in 표2.items():
                        뒤 = [x for x in 차례 if x >= d]
                        if not 뒤:
                            continue
                        쌓기[뒤[0]] = 쌓기.get(뒤[0], 0.0) + 금액
                    if 쌓기:
                        모은것[심볼] = 쌓기
                그배당 = 모은것
        return PB.돌리기(
            가격표=표,
            자산들=자산들,
            초기금액=req.initial_amount,
            적립주기=req.contribution_period,
            적립금액=req.contribution_amount,
            리밸런싱=req.rebalance_period,
            배당=그배당,
            거래비용=비용률,
            리밸런싱날=req.rebalance_day,
            적립날짜=req.rebalance_day,
            현금이자=(req.cash_rate or 0) / 100,
            무위험수익률=(req.risk_free_rate or 0) / 100,
        )

    내자산 = [a.model_dump() for a in 쓸자산]
    if req.equal_weight:
        #: '동일 비중' — 화면에서 적은 비중을 무시하고 똑같이 나눈다.
        #  0 을 넣으면 정규화가 알아서 균등하게 만든다.
        내자산 = [{**a, "weight": 0} for a in 내자산]

    loop = asyncio.get_running_loop()
    _진행쓰기(열쇠, "계산", 0, 1, "굴려 보는 중")
    결과 = await loop.run_in_executor(None, lambda: 돌리자(가격표, 내자산, 배당))
    _진행쓰기(열쇠, "계산", 1, 1, "계산 끝")
    if not 결과:
        raise HTTPException(
            status_code=400,
            detail="겹치는 기간이 너무 짧습니다. 기간을 늘리거나 자산을 줄여 주세요")

    # ── 벤치마크 ──
    #
    # 수익률만 보면 잘한 것인지 알 수 없다. 8년에 연 9%가 좋은 성적인지는
    # 같은 기간 S&P500 이 몇 %였나를 봐야 정해진다. **같은 기간·같은
    # 납입·같은 비용**으로 한 번 더 돌린다 — 조건이 하나라도 다르면
    # 견줄 수 없는 수가 된다.
    벤치 = None
    #: 고른벤치 는 위(환율을 받을지 정하는 자리)에서 이미 뽑아 뒀다.
    if 고른벤치["assets"]:
        _진행쓰기(열쇠, "벤치마크", 0, 1, f"{고른벤치['name']} 와 견주는 중")
        try:
            벤치칸들 = [자산칸(**x) for x in 고른벤치["assets"]]
            벤치표, _ = await _시세모으기(
                벤치칸들, 기간, 결과["start_date"], 결과["end_date"], req.extended)
            벤치표, _ = _통화맞추기(벤치표, 벤치칸들, req.currency, 환율)
            """**내 포트폴리오가 실제로 잰 구간**으로 자른다.

            요청한 기간이 아니라 결과의 기간이다. 자산 하나가 늦게
            상장해 2004년부터 재게 됐는데 벤치마크만 2003년부터 재면,
            더 긴 기간의 수익률과 견주는 셈이라 둘 다 맞고 비교만
            틀린 수가 된다 — 제일 알아채기 어려운 모양이다.
            (실제로 6040 이 277점, 내 것이 263점으로 나왔다.)"""
            쓸벤치 = [x for x in 고른벤치["assets"] if x["symbol"] in 벤치표]
            if 쓸벤치:
                """**벤치마크도 배당을 받아야 한다.**

                예전에는 여기에 None 을 넣었다. '토탈 리턴' 을 켜면 내
                포트폴리오만 배당을 재투자하고 견주는 상대는 못 받았다.
                SPY 한 종목으로 10년을 재 보니 **16.6% 차이**가 났다
                (배당 있음 2,347만원 · 없음 2,013만원). 이기는 쪽으로
                기울어진 비교라, 어떤 조합을 넣어도 '벤치마크를 이겼다'
                가 나오기 쉬웠다.

                같은 기간·같은 납입·같은 비용으로 재겠다고 바로 위에
                적어 놓고, 배당만 빠져 있었다."""
                벤치배당 = None
                if req.total_return:
                    벤치배당 = await _배당표(
                        벤치칸들, 결과["start_date"], 결과["end_date"],
                        req.currency, 환율)
                벤치결과 = await loop.run_in_executor(
                    None, lambda: 돌리자(벤치표, [dict(x) for x in 쓸벤치], 벤치배당))
                if 벤치결과:
                    """곡선까지 다 담으면 응답이 두 배가 된다. 견주는 데
                    필요한 것은 수치 몇 개와 곡선뿐이라 나머지는 뺀다."""
                    벤치 = {"key": req.benchmark, "name": 고른벤치["name"],
                            #: 지수는 배당이 없다. 감추면 사용자는 같은
                            #  기준으로 견준 줄 안다.
                            "index_only": bool(고른벤치.get("index_only")),
                            **{k: 벤치결과.get(k) for k in
                               ("final_value", "total_return", "twr_annual",
                                "irr_annual", "mdd", "volatility", "sharpe",
                                #: 낙폭 곡선까지 준다 — 화면이 내 것과
                                #  나란히 그린다. 'mdd 는 6040 이 더
                                #  작았다' 만으로는 언제 얼마나 오래
                                #  잠겨 있었는지를 알 수 없다.
                                #: 요약표에서 나란히 견주는 것들. 없으면
                                #  '내 조합만 잰 수' 가 되어 비교가 안 된다.
                                "sortino", "best_month", "worst_month",
                                "positive_months", "total_months",
                                "this_month", "ytd",
                                "return_1y", "return_3y", "return_5y",
                                "std_1y", "std_3y", "std_5y",
                                "mdd_date", "crises",
                                "contributed", "curve", "drawdown")}}
        except Exception as e:
            #: 벤치마크를 못 받았다고 내 결과까지 버리면 안 된다.
            #  견주는 것은 덤이고, 본래 답은 이미 나와 있다.
            log.info("벤치마크 실패 %s: %s", req.benchmark, type(e).__name__)

    """무엇을 못 했는지 **반드시 적어 보낸다.**

    자산 하나를 조용히 빼고 계산하면 사용자는 세 개를 담은 줄 알고
    두 개짜리 결과를 본다. 그건 틀린 값을 자신 있게 보여 주는 것이고,
    백테스트에서는 그게 가장 나쁜 실패다."""
    결과["currency"] = req.currency
    결과["assets"] = [{"symbol": a.symbol, "market": a.market, "name": a.name,
                       "weight": w["weight"]}
                      for a, w in zip(쓸자산, PB.정규화(내자산))]
    결과["skipped"] = 못받음
    결과["fx_skipped"] = 뺀것
    결과["mixed_currency"] = 섞였나
    결과["costs_included"] = 비용률 > 0
    결과["data_interval"] = req.data_interval
    결과["benchmark"] = 벤치
    #: 어느 자산을 언제부터 지수로 이었나. 조용히 이으면 사용자는
    #  1980년치 SPY 자료가 있는 줄 안다 — 실제로는 지수를 본 것이다.
    결과["extended_from"] = {s: 날 for s, 날 in 이은것.items() if s in 가격표}
    #: 다 끝났다고 적어 둔다. 답이 늦게 와도 막대가 92% 에 걸려 있지
    #  않고 99 까지는 차 있다. **100 은 아니다** — 100 은 응답이
    #  실제로 왔을 때만이고, 그 몫은 화면이 맡는다(_진행쓰기 참고).
    _진행쓰기(열쇠, "벤치마크", 1, 1, "다 됐어요")
    return 결과


#: 경로 칸 이름만은 **영문**으로 둔다.
#
#  이 저장소는 이름을 한글로 짓지만, 여기만은 안 된다. Starlette 이
#  경로에서 칸을 찾을 때 쓰는 규칙이 [a-zA-Z_][a-zA-Z0-9_]* 라, {열쇠}
#  는 칸으로 안 잡히고 **글자 그대로**가 된다. 그러면 /progress/abc 가
#  어느 경로에도 안 걸려 404 가 난다 — 라우트 목록에는 멀쩡히 보이는데
#  부르면 없다고 하는, 눈으로는 못 찾는 모양이다(실제로 그렇게 짰다가
#  라우트 맞춰 보기로 확인했다).
@router.get("/portfolio/progress/{key}")
async def 진행보기(key: str):
    """지금 서버가 어디까지 했나.

    **어림이 아니라 실제**다 — 시세를 여덟 개 중 셋 받았으면 셋이라고
    적혀 있다. 화면은 이걸 그대로 그린다.

    아직 시작 전이거나 이미 지워졌으면 빈 값을 준다. 404 를 내면 화면이
    '실패' 로 읽어 에러를 띄우는데, 진행 표시는 덤이라 없다고 해서
    계산이 실패한 것이 아니다.

    로그인을 안 봐도 된다 — 열쇠는 화면이 만든 임의의 수라, 남의 것을
    맞히려면 그 수를 알아내야 하고 알아낸들 나오는 것은 '시세 3/8' 뿐
    이다. 진행 상황에는 무엇을 담았는지도, 결과도 들어 있지 않다."""
    if not key or len(key) > 64:
        return {}
    return cache.get(f"진행:{key}") or {}


@router.post("/experiments", status_code=201)
def save_experiment(req: 실험저장요청, db: Session = Depends(get_db),
                    current_user: User = Depends(require_user)):
    """실험 설정을 저장한다 — 전략 저장소에 놓이는 자산배분 실험.

    비중은 **화면이 준 그대로** 담는다. 예전에는 여기서 PB.정규화 를
    불렀는데, 그것은 합이 1이 되게 나누는 함수다 — 60/20/20 을 넣으면
    0.6/0.2/0.2 가 저장됐다. 화면은 이 수를 퍼센트로 읽으니 저장소에
    '20%' 가 '0.2%' 로 떴고, 실험을 다시 열면 비중 칸에 0.2 가 들어와
    있었다.

    정규화는 **계산할 때** 하는 일이지 보관할 때 하는 일이 아니다.
    돌릴 때 엔진이 어차피 합으로 나누므로 여기서 미리 나눌 이유가
    없고, 미리 나누면 사용자가 적은 수를 잃는다. 자산 수 상한(12)과
    빈 종목 걸러내기는 이미 요청 모델이 막는다.
    """
    from app.models.stock import PortfolioExperiment

    exp = PortfolioExperiment(
        user_id=current_user.id,
        name=req.name,
        currency=req.currency,
        initial_amount=req.initial_amount,
        start_date=req.start_date,
        end_date=req.end_date,
        assets=[a.model_dump() for a in req.assets],
        contribution_period=req.contribution_period,
        contribution_amount=req.contribution_amount,
        rebalance_period=req.rebalance_period,
        total_return=req.total_return,
        #: 나머지 설정도 빠짐없이 담는다 — 하나라도 빠지면 불러와
        #  다시 돌렸을 때 저장할 때와 다른 수가 나온다.
        rebalance_day=req.rebalance_day,
        cost_rate=req.cost_rate,
        data_interval=req.data_interval,
        benchmark=req.benchmark,
        equal_weight=req.equal_weight,
        extended=req.extended,
        cash_rate=req.cash_rate,
        risk_free_rate=req.risk_free_rate,
    )
    db.add(exp)
    db.commit()
    db.refresh(exp)
    return exp


def _비중되살리기(자산들: list[dict]) -> list[dict]:
    """이미 0.6/0.2/0.2 로 저장돼 버린 옛날 실험을 60/20/20 으로 되돌린다.

    저장할 때 합으로 나눠 버리던 시절의 줄들이 사람들 계정에 이미
    들어 있다. 저장 쪽만 고치면 그 줄들은 영영 '0.2%' 로 남고, 열면
    비중 칸에 0.2 가 들어와 손으로 다시 쳐야 한다.

    합을 보고 가른다 — 퍼센트로 적은 조합은 합이 100 근처고, 나눠져
    버린 것은 정확히 1 이다. 합이 1 이하인 조합, 즉 자산을 다 합쳐도
    1% 만 담는 조합은 뜻이 없으므로 이 갈림에 걸릴 진짜 설정은 없다.

    비중을 아예 안 적은 줄(합이 0 — '동일비중' 으로 두고 저장한 경우)은
    어느 쪽으로 가도 0 이라 결과가 같다. 그래서 따로 막지 않는다.
    """
    합 = sum(float(a.get("weight") or 0) for a in 자산들)
    if 합 > 1.5:
        return 자산들
    return [{**a, "weight": round(float(a.get("weight") or 0) * 100, 4)}
            for a in 자산들]


@router.get("/experiments")
def list_experiments(db: Session = Depends(get_db),
                     current_user: Optional[User] = Depends(get_current_user)):
    """내 실험 목록 (비로그인은 빈 배열).

    401 을 내지 않는다 — 이 화면은 로그인 없이도 백테스트를 돌릴 수
    있고, 목록만 비면 된다. 401 을 내면 화면이 '실패' 로 읽는다."""
    from app.models.stock import PortfolioExperiment
    if not current_user:
        return []
    줄들 = (db.query(PortfolioExperiment)
            .filter(PortfolioExperiment.user_id == current_user.id)
            .order_by(PortfolioExperiment.created_at.desc())
            .limit(50).all())
    #: 옛날 줄은 비중이 나눠진 채로 들어 있다. 보낼 때 되돌린다.
    #
    #  ORM 객체의 assets 를 그 자리에서 고치지 않고 **평범한 dict 로
    #  베껴서** 고친다. ORM 객체를 고치면 그 객체는 '바뀐 것' 으로
    #  표시되고, 이 세션에서 누가 commit 하는 순간 읽기만 한 요청이
    #  DB 를 조용히 바꿔 버린다. 그렇게 바뀐 값은 나중에 어디서
    #  바뀐 것인지 아무도 못 찾는다.
    #
    #  칸 이름을 손으로 적지 않고 표에서 가져온다 — 손으로 적으면
    #  나중에 칸이 하나 늘었을 때 그 칸만 조용히 빠진다.
    칸들 = [c.name for c in PortfolioExperiment.__table__.columns]
    return [{**{c: getattr(x, c) for c in 칸들},
             "assets": _비중되살리기(x.assets or [])}
            for x in 줄들]


@router.delete("/experiments/{experiment_id}")
def delete_experiment(experiment_id: int, db: Session = Depends(get_db),
                      current_user: User = Depends(require_user)):
    from app.models.stock import PortfolioExperiment
    exp = (db.query(PortfolioExperiment)
           .filter(PortfolioExperiment.id == experiment_id,
                   PortfolioExperiment.user_id == current_user.id)
           .first())
    if not exp:
        raise HTTPException(status_code=404, detail="실험을 찾을 수 없습니다")
    db.delete(exp)
    db.commit()
    return {"message": "삭제 완료"}
