from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
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


class PortfolioRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class ReorderRequest(BaseModel):
    order: list[int]


class PortfolioItemRequest(BaseModel):
    portfolio_id: Optional[int] = Field(None, ge=1)
    symbol: str = Field(..., min_length=1, max_length=20)
    market: str = Field(..., pattern="^(KR|US|ETF)$")
    name: Optional[str] = Field("", max_length=100)
    shares: float = Field(..., gt=0)
    avg_price: float = Field(..., ge=0)
    currency: str = Field("KRW", pattern="^(KRW|USD)$")
    input_exchange_rate: Optional[float] = Field(None, ge=0)
    purchase_date: Optional[str] = Field(None, max_length=10)
    note: Optional[str] = Field(None, max_length=200)
    asset_class: Optional[str] = Field(None, pattern="^(국내주식|해외주식|채권|금|현금)$")


def _ensure_portfolio(db: Session, user_id: int) -> Portfolio:
    """사용자의 첫 포트폴리오를 반환, 없으면 기본 포트폴리오를 생성"""
    pf = db.query(Portfolio).filter(Portfolio.user_id == user_id).order_by(Portfolio.position).first()
    if not pf:
        pf = Portfolio(name="기본 포트폴리오", user_id=user_id)
        db.add(pf)
        db.commit()
        db.refresh(pf)
    return pf


def _repair_orphan_items(db: Session, user_id: int) -> None:
    """startup 마이그레이션이 실패했거나 아직 실행되지 않은 경우를 대비한 안전장치.
    portfolio_id가 비어있는(다중 포트폴리오 도입 이전) 보유 종목을 기본 포트폴리오로 편입한다."""
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
    return {"id": pf.id, "name": pf.name, "position": pf.position, "count": count}


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
    for position, portfolio_id in enumerate(req.order):
        db.query(Portfolio).filter(
            Portfolio.id == portfolio_id, Portfolio.user_id == current_user.id,
        ).update({"position": position})
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
