from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, JSON, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class WatchlistFolder(Base):
    __tablename__ = "watchlist_folders"

    id       = Column(Integer, primary_key=True, index=True)
    name     = Column(String(100), nullable=False)
    position = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    items    = relationship("WatchlistItem", back_populates="folder", cascade="all, delete-orphan")


class Watchlist(Base):
    __tablename__ = "watchlists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, default="기본 관심목록")
    items = relationship("WatchlistItem", back_populates="watchlist", cascade="all, delete-orphan")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id           = Column(Integer, primary_key=True, index=True)
    watchlist_id = Column(Integer, ForeignKey("watchlists.id"), nullable=False)
    folder_id    = Column(Integer, ForeignKey("watchlist_folders.id"), nullable=True)
    symbol       = Column(String(20), nullable=False)
    market       = Column(String(10), nullable=False)   # KR, US, ETF
    name         = Column(String(100))
    memo         = Column(String(200))
    position     = Column(Integer, default=0)
    added_at     = Column(DateTime(timezone=True), server_default=func.now())
    watchlist    = relationship("Watchlist", back_populates="items")
    folder       = relationship("WatchlistFolder", back_populates="items")


class Strategy(Base):
    __tablename__ = "strategies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    version = Column(Integer, default=1)
    market = Column(String(10))  # KR, US, ETF
    entry_conditions = Column(JSON)
    exit_conditions = Column(JSON)
    stop_loss = Column(Float)
    take_profit = Column(Float)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    backtests = relationship("BacktestResult", back_populates="strategy")


class BacktestResult(Base):
    __tablename__ = "backtest_results"

    id = Column(Integer, primary_key=True, index=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id"), nullable=False)
    symbol = Column(String(20), nullable=False)
    market = Column(String(10))
    start_date = Column(String(10))
    end_date = Column(String(10))
    initial_capital = Column(Float, default=10000000)

    # 성과 지표
    total_return = Column(Float)
    annual_return = Column(Float)
    mdd = Column(Float)         # 최대낙폭
    sharpe_ratio = Column(Float)
    win_rate = Column(Float)
    total_trades = Column(Integer)

    # 상세 데이터 (JSON)
    equity_curve = Column(JSON)
    trades = Column(JSON)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    strategy = relationship("Strategy", back_populates="backtests")


class ScreeningPreset(Base):
    __tablename__ = "screening_presets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    market = Column(String(10))
    filters = Column(JSON)
    sort_by = Column(String(50))
    sort_order = Column(String(4), default="desc")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
