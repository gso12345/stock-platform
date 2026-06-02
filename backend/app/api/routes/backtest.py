from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime
import asyncio
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.database import get_db
from app.models.stock import Strategy, BacktestResult
from app.models.user import User
from app.core.deps import require_user
from app.services.backtest_engine import backtest_engine
from app.services.yf_service import yf_service

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
    rank_by: str = Field("total_return", pattern="^(total_return|annual_return|mdd|sharpe_ratio|win_rate|profit_factor)$")
    top_n: int = Field(20, ge=1, le=50)

    @field_validator("start_date", "end_date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        return _parse_date(v)


class StrategySaveRequest(BaseModel):
    name: str
    description: Optional[str] = None
    market: str
    entry_conditions: dict
    exit_conditions: dict
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None


@router.post("/run")
@limiter.limit("20/minute")
async def run_backtest(request: Request, req: BacktestRequest, db: Session = Depends(get_db), current_user: User = Depends(require_user)):
    """백테스트 실행"""
    start_dt = datetime.strptime(req.start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(req.end_date, "%Y-%m-%d")
    if end_dt <= start_dt:
        raise HTTPException(status_code=400, detail="종료일은 시작일보다 이후여야 합니다")
    days = (end_dt - start_dt).days
    period_map = [(3650, "10y"), (1825, "5y"), (730, "2y"), (365, "1y"), (180, "6mo"), (90, "3mo"), (30, "1mo")]
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
        initial_capital=req.initial_capital,
    )

    # 결과 저장
    bt_record = BacktestResult(
        strategy_id=req.strategy_id,
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


@router.post("/universe")
@limiter.limit("5/minute")
async def run_universe_backtest(request: Request, req: UniverseBacktestRequest, current_user: User = Depends(require_user)):
    """전체 종목 유니버스 백테스트"""
    from app.services.yf_service import SP500_SYMBOLS, KOSPI_SYMBOLS, KOSDAQ_SYMBOLS, ETF_SYMBOLS

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
    period_map = [(3650, "10y"), (1825, "5y"), (730, "2y"), (365, "1y"), (180, "6mo"), (90, "3mo"), (30, "1mo")]
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

    return {
        "universe": req.universe,
        "total_symbols": len(symbols),
        "tested": len(results),
        "results": results[:req.top_n],
    }


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
        .filter((Strategy.user_id == current_user.id) | (BacktestResult.strategy_id == None))
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
    result = db.query(BacktestResult).filter(BacktestResult.id == result_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="백테스트 결과를 찾을 수 없습니다")
    return result


# 전략 관리
@router.get("/strategies")
def get_strategies(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """내 전략 목록"""
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
