from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, JSON, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class WatchlistFolder(Base):
    __tablename__ = "watchlist_folders"

    id       = Column(Integer, primary_key=True, index=True)
    name     = Column(String(100), nullable=False)
    position = Column(Integer, default=0)
    user_id  = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    items    = relationship("WatchlistItem", back_populates="folder", cascade="all, delete-orphan")


class Watchlist(Base):
    __tablename__ = "watchlists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, default="기본 관심목록")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    items = relationship("WatchlistItem", back_populates="watchlist", cascade="all, delete-orphan")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id           = Column(Integer, primary_key=True, index=True)
    watchlist_id = Column(Integer, ForeignKey("watchlists.id"), nullable=False, index=True)
    folder_id    = Column(Integer, ForeignKey("watchlist_folders.id"), nullable=True, index=True)
    symbol       = Column(String(20), nullable=False, index=True)
    market       = Column(String(10), nullable=False, index=True)   # KR, US, ETF
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
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
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
    strategy_id = Column(Integer, ForeignKey("strategies.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
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


class Portfolio(Base):
    __tablename__ = "portfolios"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String(100), nullable=False, default="기본 포트폴리오")
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    position   = Column(Integer, default=0)
    is_public  = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    items      = relationship("PortfolioItem", back_populates="portfolio", cascade="all, delete-orphan")


class PortfolioItem(Base):
    __tablename__ = "portfolio_items"

    id                  = Column(Integer, primary_key=True, index=True)
    user_id             = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    portfolio_id        = Column(Integer, ForeignKey("portfolios.id"), nullable=True, index=True)
    symbol              = Column(String(20), nullable=False)
    market              = Column(String(10), nullable=False)   # KR, US, ETF
    name                = Column(String(100))
    shares              = Column(Float, nullable=False)
    avg_price           = Column(Float, nullable=False)
    currency            = Column(String(3), nullable=False, default="KRW")
    input_exchange_rate = Column(Float, nullable=True)
    purchase_date       = Column(String(10), nullable=True)
    note                = Column(String(200), nullable=True)
    asset_class         = Column(String(10), nullable=True)  # 국내주식/해외주식/채권/금 — 비어있으면 자동 분류
    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    updated_at          = Column(DateTime(timezone=True), onupdate=func.now())
    portfolio           = relationship("Portfolio", back_populates="items")


class FundamentalsCache(Base):
    """PER/PBR/ROE 등 밸류에이션 지표 DB 캐시"""
    __tablename__ = "fundamentals_cache"
    __table_args__ = (UniqueConstraint("symbol", "market", name="uq_fund_sym_mkt"),)

    id         = Column(Integer, primary_key=True, index=True)
    symbol     = Column(String(20), nullable=False, index=True)
    market     = Column(String(10), nullable=False)
    data       = Column(JSON, nullable=False)
    fetched_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class FinancialsCache(Base):
    """재무제표 (손익계산서·현금흐름·재무상태) DB 캐시"""
    __tablename__ = "financials_cache"
    __table_args__ = (UniqueConstraint("symbol", "market", name="uq_fin_sym_mkt"),)

    id         = Column(Integer, primary_key=True, index=True)
    symbol     = Column(String(20), nullable=False, index=True)
    market     = Column(String(10), nullable=False)
    data       = Column(JSON, nullable=False)
    fetched_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class AnalystCache(Base):
    """투자의견/목표주가/컨센서스 분포 DB 캐시 — Render 재시작으로 메모리 캐시가
    비워져도 직전 데이터를 바로 복구할 수 있도록 영속 저장"""
    __tablename__ = "analyst_cache"
    __table_args__ = (UniqueConstraint("symbol", "market", name="uq_analyst_sym_mkt"),)

    id         = Column(Integer, primary_key=True, index=True)
    symbol     = Column(String(20), nullable=False, index=True)
    market     = Column(String(10), nullable=False)
    data       = Column(JSON, nullable=False)
    fetched_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ForecastsCache(Base):
    """컨센서스 추정치(매출/EPS 등 연간·분기) DB 캐시"""
    __tablename__ = "forecasts_cache"
    __table_args__ = (UniqueConstraint("symbol", "market", name="uq_fcst_sym_mkt"),)

    id         = Column(Integer, primary_key=True, index=True)
    symbol     = Column(String(20), nullable=False, index=True)
    market     = Column(String(10), nullable=False)
    data       = Column(JSON, nullable=False)
    fetched_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class MetricsHistoryCache(Base):
    """재무지표 연간·분기 추이 DB 캐시.

    이 화면 하나가 야후에 재무제표 6종(손익·재무상태·현금흐름의 연간·분기)을
    한꺼번에 물어본다. 종목상세에서 가장 무거운 호출인데 메모리 캐시만
    쓰고 있어서, 프로세스가 재시작되면(무료 플랜에서는 자주 있다) 그
    6번을 처음부터 다시 했다.

    옆 동네(forecasts_cache·analyst_cache)는 이미 DB 에 남기고 있다.
    재무제표는 분기에 한 번 바뀌므로 하루 지난 값도 충분히 쓸 만하다."""
    __tablename__ = "metrics_history_cache"
    __table_args__ = (UniqueConstraint("symbol", "market", name="uq_mhist_sym_mkt"),)

    id         = Column(Integer, primary_key=True, index=True)
    symbol     = Column(String(20), nullable=False, index=True)
    market     = Column(String(10), nullable=False)
    data       = Column(JSON, nullable=False)
    fetched_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class DisclosuresCache(Base):
    """국내 공시 목록 DB 캐시 (OpenDART)"""
    __tablename__ = "disclosures_cache"
    __table_args__ = (UniqueConstraint("symbol", name="uq_disc_sym"),)

    id         = Column(Integer, primary_key=True, index=True)
    symbol     = Column(String(20), nullable=False, index=True)
    data       = Column(JSON, nullable=False)
    fetched_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class DartCorpMapCache(Base):
    """DART 전체 기업코드(corp_code) 매핑 DB 캐시 — 매번 수 MB ZIP을 재다운로드하지
    않도록 영속 저장 (재시작 후에도 즉시 사용 가능)"""
    __tablename__ = "dart_corp_map_cache"

    id         = Column(Integer, primary_key=True)
    data       = Column(JSON, nullable=False)
    fetched_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class QuantScoreWeight(Base):
    """사용자별 퀀트 점수 팩터 가중치 설정 (value/quality/momentum/growth/risk)"""
    __tablename__ = "quant_score_weights"

    id              = Column(Integer, primary_key=True, index=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    weights         = Column(JSON, nullable=False)
    enabled_metrics = Column(JSON, nullable=True)  # {"value": ["per","pbr"], "quality": [...]} — 없으면 전체 지표 사용
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())


class QuantPercentileCache(Base):
    """시장별(KR/US/ETF) 퀀트 지표 백분위 분포 캐시 — 상대평가 점수 계산용.
    일배치로 갱신되며, 요청 시점에는 이 캐시를 조회(이분 탐색)만 한다."""
    __tablename__ = "quant_percentile_cache"
    __table_args__ = (UniqueConstraint("market", name="uq_quant_pct_market"),)

    id         = Column(Integer, primary_key=True, index=True)
    market     = Column(String(10), nullable=False)
    data       = Column(JSON, nullable=False)  # {metric_key: [sorted_value, ...]}
    fetched_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ScreeningPreset(Base):
    __tablename__ = "screening_presets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    market = Column(String(10))
    filters = Column(JSON)
    sort_by = Column(String(50))
    sort_order = Column(String(4), default="desc")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class KrTicker(Base):
    """국내 상장 종목 목록 — 예전에는 파이썬 변수로만 들고 있었다.

    그 방식의 문제는 재시작마다 외부(FinanceDataReader/pykrx)에서 2,800개를
    다시 긁어야 한다는 것이었다. 그게 실패하면 코드에 적어둔 115개로 조용히
    떨어졌고, 화면에는 종목이 줄어든 것으로만 보였다. 실제로 프로덕션이
    그 상태였다 — 115개 밖의 종목은 검색도 시세 조회도 되지 않았다.

    목록을 여기 두면 갱신이 실패해도 지난 목록이 남는다. 그리고 평소
    재시작에는 DB만 읽으므로 FinanceDataReader 를 아예 안 불러도 된다.
    """
    __tablename__ = "kr_tickers"

    symbol      = Column(String(30), primary_key=True)           # 005930.KS, 00680K.KS
    code        = Column(String(20), nullable=False, index=True)  # 005930, 00680K
    name        = Column(String(100), nullable=False, index=True)
    # KRX 가 주는 시장 이름은 'KOSPI'·'KOSDAQ'·'KONEX' 만이 아니다.
    # 'KOSDAQ GLOBAL'(13자)이 있어서 처음에 10자로 잡았다가 저장이 통째로
    # 실패했다. 로컬은 SQLite 라 길이 제한을 무시해서 못 잡았고, PostgreSQL 에
    # 올린 뒤 관리자 화면의 '저장 실패' 표시로 알았다
    market      = Column(String(30), nullable=False)
    # 목록을 받아올 때 시세도 같이 오므로 함께 저장한다. 따로 받으면
    # 종목당 요청 한 번이라 0.15 CPU 에서는 감당이 안 된다.
    price       = Column(Float, nullable=True)
    change      = Column(Float, nullable=True)
    change_rate = Column(Float, nullable=True)
    volume      = Column(Float, nullable=True)
    market_cap  = Column(Float, nullable=True)
    # 상장주식수. KRX 가 목록과 함께 주는데 여기 담지 않고 있었다.
    #
    # 시가총액은 '현재가 × 상장주식수' 로 직접 계산한다. 남이 준 시총 값은
    # 전일 종가 기준인 데다, 예전에 표의 옆 칸을 잘못 읽어 시가총액 순위에서
    # 삼성전자가 사라진 적이 있어 안 쓰기로 했다.
    #
    # 그런데 이 값이 파이썬 변수에만 있었다. 평소 재시작은 DB 만 읽으므로
    # (그게 이 표를 만든 이유다) 재시작 직후에는 2,800 종목 전부 주식수가
    # 0 이 됐고, 계산이 안 되니 안 쓰기로 한 그 값으로 되돌아갔다.
    # 더 나쁜 것은 실시간 시세가 있는 종목이었다 — 그쪽 응답에는 시총이
    # 아예 없어서 0 이 되고, 순위에서 통째로 빠졌다. 사람이 많이 보는
    # 종목일수록 사라지는 셈이라 삼성전자가 가장 먼저 없어졌다.
    shares      = Column(Float, nullable=True)
    open        = Column(Float, nullable=True)
    high        = Column(Float, nullable=True)
    low         = Column(Float, nullable=True)
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class UsTicker(Base):
    """미국 상장 종목 목록 — kr_tickers 와 같은 이유로 DB에 둔다.

    미국 종목은 코드에 적어둔 128개가 전부였다. Finnhub 검색 경로가 있긴
    했지만 API 키가 있어야 하고, 없으면 조용히 128개로 떨어졌다.

    여기 두면 재시작에 외부 호출이 필요 없고, 갱신이 실패해도 지난 목록이
    남는다. 시세는 담지 않는다 — 국내와 달리 목록과 시세를 같은 곳에서
    받지 않고, 미국 시세는 야후 배치로 따로 온다.
    """
    __tablename__ = "us_tickers"

    symbol     = Column(String(20), primary_key=True)            # AAPL, BRK-B
    name       = Column(String(120), nullable=False, index=True)
    # NASDAQ / NYSE / NYSE ARCA / AMEX / BATS / IEX
    exchange   = Column(String(20), nullable=False)
    # 'US' 또는 'ETF' — 검색 필터가 이걸로 나뉜다
    market     = Column(String(10), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PriceAlert(Base):
    """가격 알림 — "삼성전자 8만원 되면 알려줘".

    자산 앱에 사람을 다시 오게 하는 가장 큰 힘인데 이 자리가 비어 있었다.
    알림 화면은 진작 있었지만 커뮤니티 반응(댓글·좋아요)만 받았다.

    ── 설계에서 신경 쓴 것 ──

    · 새 알림 파이프라인을 안 만든다. 조건이 맞으면 기존 notifications
      테이블에 kind="price_alert" 로 한 줄 넣는다. 종·읽지않음·목록이
      이미 다 돌아가므로 그것만으로 끝난다.

    · 한 번 울리면 스스로 꺼진다(is_active=False). 8만원을 넘나드는
      동안 계속 울리면 알림 화면이 그 종목 하나로 뒤덮인다.
      다시 받고 싶으면 사용자가 켠다 — 그게 '알림을 봤다' 는 뜻이다.

    · 확인은 이미 받아 둔 시세 캐시(price:{symbol})만 읽는다. 알림
      때문에 새로 조회하지 않는다. 0.15 CPU 서버라 그만한 여유가 없고,
      어차피 시세는 주기 갱신이 계속 받아 오고 있다.
    """
    __tablename__ = "price_alerts"
    __table_args__ = (
        # 확인할 때마다 '켜져 있는 것 전부' 를 훑으므로 그 조합이 가장 잦다
        UniqueConstraint("user_id", "symbol", "direction", "target",
                         name="uq_price_alert_once"),
    )

    id        = Column(Integer, primary_key=True, index=True)
    user_id   = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    symbol    = Column(String(20), nullable=False, index=True)
    market    = Column(String(10), nullable=False)          # KR, US, ETF
    name      = Column(String(100))                          # 알림 문구에 쓴다
    #: "above" = 이 값 이상이 되면, "below" = 이 값 이하가 되면
    direction = Column(String(5), nullable=False)
    target    = Column(Float, nullable=False)
    #: 만든 시점의 값. "8만원에 걸었는데 그때 얼마였지" 를 알 수 있게 남긴다
    made_at_price = Column(Float)
    is_active = Column(Boolean, default=True, nullable=False, server_default="true", index=True)
    fired_at  = Column(DateTime(timezone=True), nullable=True)
    #: 울릴 때의 값. 알림 문구에 그대로 쓴다
    fired_price = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PortfolioSnapshot(Base):
    """내 자산이 하루하루 얼마였는지. 자산 그래프의 재료다.

    지금까지 화면은 '오늘 얼마인가' 만 말했다. 자산 앱에서 정작 보고
    싶은 것은 '지난달보다 늘었나' 인데, 그걸 받쳐 줄 기록이 아무 데도
    없었다 — 매일 화면을 열어 숫자를 적어 두지 않는 한 알 수 없었다.

    ── 설계에서 신경 쓴 것 ──

    · 하루 한 줄이다. (user_id, day) 를 한 벌로 못 박아서, 하루에
      몇 번을 돌든 그날 값은 한 번만 남는다.

    · 날짜는 한국 날짜(KST)다. 쓰는 사람이 한국에 있고, UTC 로 적으면
      밤 9시 이후에 찍힌 값이 '내일' 로 들어간다.

    · 값은 이미 받아 둔 시세 캐시로만 계산한다. 그래프 때문에 시세를
      새로 받지 않는다 — 0.15 CPU 서버라 그만한 여유가 없다.

    · 시세를 하나도 못 구한 날은 아예 안 적는다. 매입금액을 그대로
      적으면 '그날 자산이 원금과 같았다' 는 거짓말이 그래프에 남는다.
      빈 날은 그냥 비워 두는 편이 정직하다.
    """
    __tablename__ = "portfolio_snapshots"
    __table_args__ = (
        UniqueConstraint("user_id", "day", name="uq_pf_snapshot_day"),
    )

    id      = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    #: "2026-08-26" — 한국 날짜
    day     = Column(String(10), nullable=False, index=True)
    #: 원화 환산 평가금액·매입금액. 화면의 합계와 같은 방법으로 낸다
    total_value = Column(Float, nullable=False)
    total_cost  = Column(Float, nullable=False)
    #: 시세를 실제로 구한 종목 수 / 시세가 있어야 하는 종목 수.
    #  한두 종목이 빠진 날인지 아닌지를 나중에 알 수 있어야 한다
    filled  = Column(Integer, default=0)
    priced  = Column(Integer, default=0)
    made_at = Column(DateTime(timezone=True), server_default=func.now())
