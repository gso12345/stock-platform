from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional
import logging

from app.db.database import get_db
from app.models.stock import PortfolioItem
from app.models.user import User
from app.core.deps import require_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/portfolio", tags=["포트폴리오"])


class PortfolioItemRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20)
    market: str = Field(..., pattern="^(KR|US|ETF)$")
    name: Optional[str] = Field("", max_length=100)
    shares: float = Field(..., gt=0)
    avg_price: float = Field(..., ge=0)
    currency: str = Field("KRW", pattern="^(KRW|USD)$")
    input_exchange_rate: Optional[float] = Field(None, ge=0)
    purchase_date: Optional[str] = Field(None, max_length=10)
    note: Optional[str] = Field(None, max_length=200)


def _to_dict(item: PortfolioItem) -> dict:
    return {
        "id":                item.id,
        "symbol":            item.symbol,
        "market":            item.market,
        "name":              item.name or item.symbol,
        "shares":            item.shares,
        "avgPrice":          item.avg_price,
        "currency":          item.currency,
        "inputExchangeRate": item.input_exchange_rate,
        "purchaseDate":      item.purchase_date,
        "note":              item.note,
    }


@router.get("/items")
def get_items(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    items = (
        db.query(PortfolioItem)
        .filter(PortfolioItem.user_id == current_user.id)
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
    try:
        item = PortfolioItem(
            user_id=current_user.id,
            symbol=req.symbol,
            market=req.market,
            name=req.name or "",
            shares=req.shares,
            avg_price=req.avg_price,
            currency=req.currency,
            input_exchange_rate=req.input_exchange_rate,
            purchase_date=req.purchase_date,
            note=req.note,
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
    item.symbol = req.symbol
    item.market = req.market
    item.name = req.name or ""
    item.shares = req.shares
    item.avg_price = req.avg_price
    item.currency = req.currency
    item.input_exchange_rate = req.input_exchange_rate
    item.purchase_date = req.purchase_date
    item.note = req.note
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
