from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Body, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field
from typing import Optional
import logging

from app.db.database import get_db
from app.models.stock import Portfolio, PortfolioItem
from app.models.user import User
from app.core.deps import require_user
from app.services.ticker_service import get_display_name

log = logging.getLogger(__name__)

router = APIRouter(prefix="/portfolio", tags=["포트폴리오"])

# 프로세스 내에서 이미 repair를 수행한 user_id를 기억해 중복 실행 방지
_repaired_users: set[int] = set()
_MAX_REPAIRED = 10000


class PortfolioRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class ReorderRequest(BaseModel):
    order: list[int]


class PortfolioItemRequest(BaseModel):
    portfolio_id: Optional[int] = Field(None, ge=1)
    symbol: str = Field(..., min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-가-힣]+$")
    market: str = Field(..., pattern="^(KR|US|ETF)$")
    name: Optional[str] = Field("", max_length=100)
    shares: float = Field(..., gt=0)
    avg_price: float = Field(..., ge=0)
    currency: str = Field("KRW", pattern="^(KRW|USD)$")
    input_exchange_rate: Optional[float] = Field(None, ge=0)
    purchase_date: Optional[str] = Field(None, max_length=10)
    note: Optional[str] = Field(None, max_length=200)
    asset_class: Optional[str] = Field(None, pattern="^(국내주식|해외주식|채권|금|현금|커버드콜)$")


def _ensure_portfolio(db: Session, user_id: int) -> Portfolio:
    """사용자의 첫 포트폴리오를 반환, 없으면 기본 포트폴리오를 생성"""
    pf = db.query(Portfolio).filter(Portfolio.user_id == user_id).order_by(Portfolio.position).first()
    if not pf:
        pf = Portfolio(name="기본 포트폴리오", user_id=user_id)
        try:
            db.add(pf)
            db.commit()
            db.refresh(pf)
        except IntegrityError:
            db.rollback()
            pf = db.query(Portfolio).filter(Portfolio.user_id == user_id).order_by(Portfolio.position).first()
    return pf


def _repair_orphan_items(db: Session, user_id: int) -> None:
    """startup 마이그레이션이 실패했거나 아직 실행되지 않은 경우를 대비한 안전장치.
    portfolio_id가 비어있는(다중 포트폴리오 도입 이전) 보유 종목을 기본 포트폴리오로 편입한다.
    같은 프로세스 내에서는 user_id당 최초 1회만 실행한다."""
    if user_id in _repaired_users:
        return
    if len(_repaired_users) > _MAX_REPAIRED:
        _repaired_users.clear()
    _repaired_users.add(user_id)
    has_orphan = db.query(PortfolioItem).filter(
        PortfolioItem.user_id == user_id, PortfolioItem.portfolio_id.is_(None)
    ).first()
    if not has_orphan:
        return
    pf = _ensure_portfolio(db, user_id)
    db.query(PortfolioItem).filter(
        PortfolioItem.user_id == user_id, PortfolioItem.portfolio_id.is_(None)
    ).update({"portfolio_id": pf.id})
    db.commit()


def _valid_portfolio_id(db: Session, portfolio_id: int, user_id: int) -> bool:
    return db.query(Portfolio).filter(
        Portfolio.id == portfolio_id, Portfolio.user_id == user_id,
    ).first() is not None


def _to_dict(item: PortfolioItem) -> dict:
    return {
        "id":                item.id,
        "portfolioId":       item.portfolio_id,
        "symbol":            item.symbol,
        "market":            item.market,
        "name":              get_display_name(item.symbol, item.market, item.name or item.symbol),
        "shares":            item.shares,
        "avgPrice":          item.avg_price,
        "currency":          item.currency,
        "inputExchangeRate": item.input_exchange_rate,
        "purchaseDate":      item.purchase_date,
        "note":              item.note,
        "assetClass":        item.asset_class,
    }


def _portfolio_to_dict(pf: Portfolio, count: int) -> dict:
    return {"id": pf.id, "name": pf.name, "position": pf.position, "count": count, "is_public": pf.is_public or False}


# ── 포트폴리오 CRUD ─────────────────────────────────────────────
@router.get("/portfolios")
def get_portfolios(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    _repair_orphan_items(db, current_user.id)
    portfolios = (
        db.query(Portfolio)
        .filter(Portfolio.user_id == current_user.id)
        .order_by(Portfolio.position, Portfolio.id)
        .all()
    )
    if not portfolios:
        portfolios = [_ensure_portfolio(db, current_user.id)]
    counts: dict[int, int] = {}
    rows = (
        db.query(PortfolioItem.portfolio_id, func.count(PortfolioItem.id))
        .filter(PortfolioItem.portfolio_id.in_([p.id for p in portfolios]))
        .group_by(PortfolioItem.portfolio_id)
        .all()
    )
    counts = dict(rows)
    return [_portfolio_to_dict(p, counts.get(p.id, 0)) for p in portfolios]


@router.post("/portfolios", status_code=201)
def create_portfolio(
    req: PortfolioRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    max_pos = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).count()
    pf = Portfolio(name=req.name, user_id=current_user.id, position=max_pos)
    db.add(pf)
    db.commit()
    db.refresh(pf)
    return _portfolio_to_dict(pf, 0)


@router.put("/portfolios/reorder")
def reorder_portfolios(
    req: ReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """포트폴리오 순서 일괄 저장 (본인 소유 포트폴리오만 수정)"""
    # "/portfolios/{portfolio_id}"보다 먼저 등록해야 함 — 그렇지 않으면 "reorder"가
    # portfolio_id로 파싱되어 422 에러가 나고 이 라우트에 도달하지 못함
    owned_ids = {
        pid for (pid,) in db.query(Portfolio.id)
        .filter(Portfolio.id.in_(req.order), Portfolio.user_id == current_user.id)
        .all()
    }
    db.bulk_update_mappings(Portfolio, [
        {"id": portfolio_id, "position": position}
        for position, portfolio_id in enumerate(req.order)
        if portfolio_id in owned_ids
    ])
    db.commit()
    return {"message": "순서 저장 완료"}


@router.put("/portfolios/{portfolio_id}")
def update_portfolio(
    portfolio_id: int,
    req: PortfolioRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    pf = db.query(Portfolio).filter(
        Portfolio.id == portfolio_id, Portfolio.user_id == current_user.id,
    ).first()
    if not pf:
        raise HTTPException(status_code=404, detail="포트폴리오를 찾을 수 없습니다")
    pf.name = req.name
    db.commit()
    return _portfolio_to_dict(pf, len(pf.items))


@router.delete("/portfolios/{portfolio_id}")
def delete_portfolio(
    portfolio_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    pf = db.query(Portfolio).filter(
        Portfolio.id == portfolio_id, Portfolio.user_id == current_user.id,
    ).first()
    if not pf:
        raise HTTPException(status_code=404, detail="포트폴리오를 찾을 수 없습니다")
    remaining = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).count()
    if remaining <= 1:
        raise HTTPException(status_code=400, detail="최소 1개의 포트폴리오는 유지해야 합니다")
    db.delete(pf)
    db.commit()
    return {"message": "삭제 완료"}


# ── 자산 그래프 ──────────────────────────────────────────────
@router.get("/history")
def 자산흐름(
    days: int = Query(90, ge=7, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """내 자산이 하루하루 얼마였는지.

    기록은 서버가 15분마다 '오늘 치가 없는 사람' 만 한 줄씩 남긴다
    (portfolio_snapshot.찍기). 그래서 앱을 안 연 날은 비어 있다 —
    없는 날을 억지로 채우지 않고 그대로 비워서 내보낸다. 이어 그리는
    것은 화면이 할 일이고, 서버가 지어낸 값을 섞으면 안 된다.

    오늘 치는 여기서 즉석으로 계산해 얹는다. 15분을 기다려야 오늘
    점이 생기면, 방금 종목을 담은 사람에게는 그래프가 고장 나 보인다.
    """
    from datetime import timedelta as _td
    from app.models.stock import PortfolioSnapshot
    from app.services import portfolio_snapshot as PS

    부터 = (datetime.now(PS.KST) - _td(days=days)).strftime("%Y-%m-%d")
    rows = (db.query(PortfolioSnapshot)
            .filter(PortfolioSnapshot.user_id == current_user.id,
                    PortfolioSnapshot.day >= 부터)
            .order_by(PortfolioSnapshot.day)
            .all())
    points = [{"day": r.day, "value": r.total_value, "cost": r.total_cost,
               "filled": r.filled or 0, "priced": r.priced or 0} for r in rows]

    날 = PS.오늘()
    if not points or points[-1]["day"] != 날:
        환율 = PS._환율()
        내것 = db.query(PortfolioItem).filter(PortfolioItem.user_id == current_user.id).all()
        if 환율 > 0 and 내것:
            합 = PS.합계내기(내것, 환율)
            if not (합["priced"] > 0 and 합["filled"] == 0):
                points.append({"day": 날, "value": round(합["value"], 2),
                               "cost": round(합["cost"], 2),
                               "filled": 합["filled"], "priced": 합["priced"]})
    return {"points": points, "days": days}


# ── 배당 달력 ────────────────────────────────────────────────
@router.get("/dividends")
def 배당달력(
    include_watchlist: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """내 종목이 언제 얼마를 주는가.

    지금까지 배당은 '배당수익률 2.1%' 라는 숫자 하나로만 있었다.
    배당을 보고 사는 사람이 정작 알고 싶은 것은 **언제** 들어오느냐다.

    전 종목을 뒤지지 않는다 — 내가 가진 것과 관심 있는 것만 본다.
    그래야 조회 수가 사람마다 수십 건으로 묶인다.

    한 요청에 새로 받아 오는 종목 수에도 상한이 있다(dividend_service).
    처음 몇 번은 목록이 조금씩 길어지는 대신, 화면이 30초를 기다리는
    일이 없다. 아직 못 받은 수는 pending 으로 같이 내보낸다.
    """
    from app.models.stock import Watchlist, WatchlistItem
    from app.services import dividend_service as DV

    보유 = db.query(PortfolioItem).filter(PortfolioItem.user_id == current_user.id).all()
    후보: dict[tuple, dict] = {}
    for it in 보유:
        if (it.asset_class or "") == "현금":
            continue                     # 현금에는 배당이 없다
        열쇠 = (it.symbol, it.market)
        칸 = 후보.setdefault(열쇠, {"symbol": it.symbol, "market": it.market,
                                     "name": it.name or it.symbol, "shares": 0.0})
        # 같은 종목을 여러 포트폴리오에 나눠 담았으면 수량을 합친다
        칸["shares"] += float(it.shares or 0)

    if include_watchlist:
        관심 = (db.query(WatchlistItem)
                .join(Watchlist, Watchlist.id == WatchlistItem.watchlist_id)
                .filter(Watchlist.user_id == current_user.id)
                .limit(100).all())
        for w in 관심:
            열쇠 = (w.symbol, w.market)
            # 이미 보유 중이면 수량을 지우지 않는다
            후보.setdefault(열쇠, {"symbol": w.symbol, "market": w.market,
                                   "name": w.name or w.symbol, "shares": 0.0})

    return DV.달력(list(후보.values()))


# ── 종목 CRUD ────────────────────────────────────────────────
@router.get("/items")
def get_items(
    portfolio_id: Optional[int] = None,
    view_all: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    _repair_orphan_items(db, current_user.id)

    if view_all:
        items = (
            db.query(PortfolioItem)
            .filter(PortfolioItem.user_id == current_user.id)
            .order_by(PortfolioItem.created_at)
            .all()
        )
        pf_names = {
            p.id: p.name
            for p in db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
        }
        return [{**_to_dict(i), "portfolioName": pf_names.get(i.portfolio_id, "")} for i in items]

    if portfolio_id is not None:
        if not _valid_portfolio_id(db, portfolio_id, current_user.id):
            raise HTTPException(status_code=404, detail="포트폴리오를 찾을 수 없습니다")
        pf_id = portfolio_id
    else:
        pf_id = _ensure_portfolio(db, current_user.id).id

    items = (
        db.query(PortfolioItem)
        .filter(PortfolioItem.user_id == current_user.id, PortfolioItem.portfolio_id == pf_id)
        .order_by(PortfolioItem.created_at)
        .all()
    )
    return [_to_dict(i) for i in items]


@router.post("/items", status_code=201)
def create_item(
    req: PortfolioItemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    if req.portfolio_id is not None:
        if not _valid_portfolio_id(db, req.portfolio_id, current_user.id):
            raise HTTPException(status_code=404, detail="포트폴리오를 찾을 수 없습니다")
        pf_id = req.portfolio_id
    else:
        pf_id = _ensure_portfolio(db, current_user.id).id

    try:
        item = PortfolioItem(
            user_id=current_user.id,
            portfolio_id=pf_id,
            symbol=req.symbol,
            market=req.market,
            name=req.name or "",
            shares=req.shares,
            avg_price=req.avg_price,
            currency=req.currency,
            input_exchange_rate=req.input_exchange_rate,
            purchase_date=req.purchase_date,
            note=req.note,
            asset_class=req.asset_class,
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        return _to_dict(item)
    except Exception as e:
        db.rollback()
        log.error(f"포트폴리오 추가 실패 user={current_user.id} symbol={req.symbol}: {e}")
        raise HTTPException(status_code=500, detail="저장 중 오류가 발생했습니다")


@router.put("/items/{item_id}")
def update_item(
    item_id: int,
    req: PortfolioItemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    item = (
        db.query(PortfolioItem)
        .filter(PortfolioItem.id == item_id, PortfolioItem.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다")
    if req.portfolio_id is not None and req.portfolio_id != item.portfolio_id:
        if not _valid_portfolio_id(db, req.portfolio_id, current_user.id):
            raise HTTPException(status_code=404, detail="포트폴리오를 찾을 수 없습니다")
        item.portfolio_id = req.portfolio_id
    item.symbol = req.symbol
    item.market = req.market
    item.name = req.name or ""
    item.shares = req.shares
    item.avg_price = req.avg_price
    item.currency = req.currency
    item.input_exchange_rate = req.input_exchange_rate
    item.purchase_date = req.purchase_date
    item.note = req.note
    item.asset_class = req.asset_class
    db.commit()
    return _to_dict(item)


@router.get("/public/{user_id}")
def get_public_portfolios(
    user_id: int,
    db: Session = Depends(get_db),
):
    portfolios = (
        db.query(Portfolio)
        .filter(Portfolio.user_id == user_id, Portfolio.is_public.is_(True))
        .order_by(Portfolio.position, Portfolio.id)
        .all()
    )
    result = []
    for pf in portfolios:
        items = (
            db.query(PortfolioItem)
            .filter(PortfolioItem.portfolio_id == pf.id)
            .order_by(PortfolioItem.created_at)
            .all()
        )
        result.append({
            "id": pf.id,
            "name": pf.name,
            "items": [_to_dict(i) for i in items],
        })
    return result


@router.put("/{portfolio_id}/visibility")
def set_portfolio_visibility(
    portfolio_id: int = Path(...),
    is_public: bool = Body(..., embed=True),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    pf = db.query(Portfolio).filter(Portfolio.id == portfolio_id, Portfolio.user_id == current_user.id).first()
    if not pf:
        raise HTTPException(404, "포트폴리오를 찾을 수 없습니다")
    pf.is_public = is_public
    db.commit()
    return {"id": pf.id, "is_public": pf.is_public}


@router.delete("/items/{item_id}")
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    item = (
        db.query(PortfolioItem)
        .filter(PortfolioItem.id == item_id, PortfolioItem.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다")
    db.delete(item)
    db.commit()
    return {"message": "삭제 완료"}
