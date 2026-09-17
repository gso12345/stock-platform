from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime
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


class BacktestRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20)
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
    strategy_id: Optional[int] = None

    @field_validator("start_date", "end_date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        return _parse_date(v)


class UniverseBacktestRequest(BaseModel):
    universe: str = Field("SP500", pattern="^(SP500|KOSPI|KOSDAQ|ETF|CUSTOM)$")
    custom_symbols: list[str] = Field(default=[], max_length=100)
    market: str = Field("US", pattern="^(KR|US|ETF)$")
    start_date: str
    end_date: str
    initial_capital: float = Field(10_000_000, ge=100_000, le=100_000_000_000)
    entry_conditions: dict
    exit_conditions: dict
    stop_loss: Optional[float] = Field(None, ge=0.1, le=99.0)
    take_profit: Optional[float] = Field(None, ge=0.1, le=999.0)
    position_size: float = Field(0.95, gt=0, le=1.0)
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
    days = (end_dt - start_dt).days
    period_map = [(30, "1mo"), (90, "3mo"), (180, "6mo"), (365, "1y"), (730, "2y"), (1825, "5y"), (3650, "10y")]
    period = next((p for d, p in period_map if days <= d), "max")

    mkt = "KR" if req.market == "KR" else "US"
    loop = asyncio.get_running_loop()
    ohlcv = await loop.run_in_executor(None, yf_service.get_ohlcv, req.symbol, period, "1d", mkt)
    ohlcv = [row for row in ohlcv if req.start_date <= row["date"] <= req.end_date]

    if len(ohlcv) < 20:
        raise HTTPException(status_code=400, detail="데이터가 부족합니다 (최소 20일 필요)")

    # 백테스트 실행
    result = backtest_engine.run(
        ohlcv=ohlcv,
        entry_conditions=req.entry_conditions,
        exit_conditions=req.exit_conditions,
        stop_loss=req.stop_loss,
        take_profit=req.take_profit,
        position_size=req.position_size,
        initial_capital=req.initial_capital,
    )

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

    ck = f"universe_bt:{sorted(req.model_dump().items())}"
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

    start_dt = datetime.strptime(req.start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(req.end_date, "%Y-%m-%d")
    days = (end_dt - start_dt).days
    period_map = [(30, "1mo"), (90, "3mo"), (180, "6mo"), (365, "1y"), (730, "2y"), (1825, "5y"), (3650, "10y")]
    period = next((p for d, p in period_map if days <= d), "max")

    loop = asyncio.get_running_loop()
    mkt = "KR" if req.market == "KR" else "US"

    sem = asyncio.Semaphore(5)  # 동시 5개 제한

    async def run_one(symbol: str):
        async with sem:
            try:
                ohlcv = await loop.run_in_executor(None, yf_service.get_ohlcv, symbol, period, "1d", mkt)
                ohlcv = [r for r in ohlcv if req.start_date <= r["date"] <= req.end_date]
                if len(ohlcv) < 30:
                    return None
                result = await loop.run_in_executor(
                    None,
                    lambda: backtest_engine.run(
                        ohlcv=ohlcv,
                        entry_conditions=req.entry_conditions,
                        exit_conditions=req.exit_conditions,
                        stop_loss=req.stop_loss,
                        take_profit=req.take_profit,
                        position_size=req.position_size,
                        initial_capital=req.initial_capital,
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

    reverse = req.rank_by not in ("mdd",)
    results.sort(key=lambda x: (x.get(req.rank_by) or 0), reverse=reverse)

    payload = {
        "universe": req.universe,
        "total_symbols": len(symbols),
        "tested": len(results),
        "results": results[:req.top_n],
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
    symbol: str = Field(..., min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-가-힣]+$")
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
    "kospi":  {"name": "코스피200",
               "assets": [{"symbol": "069500", "market": "KR", "weight": 100}]},
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
                      확장: bool = False) -> tuple[dict, dict]:
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

    나온것 = await asyncio.gather(*[하나(a) for a in 자산들])
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


async def _배당표(자산들: list, 시작: str, 끝: str, 표시통화: str, 환율: dict) -> dict:
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

    나온것 = await asyncio.gather(*[하나(a) for a in 자산들])
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
    가격표, 이은것 = await _시세모으기(
        req.assets, 기간, req.start_date, req.end_date, req.extended)

    섞였나 = len({("KRW" if a.market == "KR" else "USD") for a in req.assets}) > 1
    바꿔야하나 = any((("KRW" if a.market == "KR" else "USD") != req.currency) for a in req.assets)
    환율 = await _환율표(req.start_date, req.end_date, 기간) if 바꿔야하나 else {}
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
        배당 = await _배당표(쓸자산, req.start_date, req.end_date, req.currency, 환율)

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
        )

    내자산 = [a.model_dump() for a in 쓸자산]
    if req.equal_weight:
        #: '동일 비중' — 화면에서 적은 비중을 무시하고 똑같이 나눈다.
        #  0 을 넣으면 정규화가 알아서 균등하게 만든다.
        내자산 = [{**a, "weight": 0} for a in 내자산]

    loop = asyncio.get_running_loop()
    결과 = await loop.run_in_executor(None, lambda: 돌리자(가격표, 내자산, 배당))
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
    고른벤치 = 벤치마크표.get(req.benchmark) or 벤치마크표["none"]
    if 고른벤치["assets"]:
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
                벤치결과 = await loop.run_in_executor(
                    None, lambda: 돌리자(벤치표, [dict(x) for x in 쓸벤치], None))
                if 벤치결과:
                    """곡선까지 다 담으면 응답이 두 배가 된다. 견주는 데
                    필요한 것은 수치 몇 개와 곡선뿐이라 나머지는 뺀다."""
                    벤치 = {"key": req.benchmark, "name": 고른벤치["name"],
                            **{k: 벤치결과.get(k) for k in
                               ("final_value", "total_return", "twr_annual",
                                "irr_annual", "mdd", "volatility", "sharpe",
                                "contributed", "curve")}}
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
    return 결과


@router.post("/experiments", status_code=201)
def save_experiment(req: 실험저장요청, db: Session = Depends(get_db),
                    current_user: User = Depends(require_user)):
    """실험 설정을 저장한다 — 화면의 '내 실험 목록'."""
    from app.models.stock import PortfolioExperiment
    from app.services import portfolio_backtest as PB

    exp = PortfolioExperiment(
        user_id=current_user.id,
        name=req.name,
        currency=req.currency,
        initial_amount=req.initial_amount,
        start_date=req.start_date,
        end_date=req.end_date,
        assets=PB.정규화([a.model_dump() for a in req.assets]),
        contribution_period=req.contribution_period,
        contribution_amount=req.contribution_amount,
        rebalance_period=req.rebalance_period,
        total_return=req.total_return,
    )
    db.add(exp)
    db.commit()
    db.refresh(exp)
    return exp


@router.get("/experiments")
def list_experiments(db: Session = Depends(get_db),
                     current_user: Optional[User] = Depends(get_current_user)):
    """내 실험 목록 (비로그인은 빈 배열).

    401 을 내지 않는다 — 이 화면은 로그인 없이도 백테스트를 돌릴 수
    있고, 목록만 비면 된다. 401 을 내면 화면이 '실패' 로 읽는다."""
    from app.models.stock import PortfolioExperiment
    if not current_user:
        return []
    return (db.query(PortfolioExperiment)
            .filter(PortfolioExperiment.user_id == current_user.id)
            .order_by(PortfolioExperiment.created_at.desc())
            .limit(50).all())


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
