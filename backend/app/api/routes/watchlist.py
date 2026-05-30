from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import asyncio

from app.db.database import get_db
from app.models.stock import Watchlist, WatchlistItem, WatchlistFolder
from app.services.yf_service import yf_service

router = APIRouter(prefix="/watchlist", tags=["관심종목"])


# ── Pydantic 스키마 ──────────────────────────────────────────
class AddItemRequest(BaseModel):
    symbol: str
    market: str
    name: str = ""
    memo: str = ""
    watchlist_id: int = 1
    folder_id: Optional[int] = None


class FolderRequest(BaseModel):
    name: str


class UpdateItemRequest(BaseModel):
    name: Optional[str] = None
    memo: Optional[str] = None
    folder_id: Optional[int] = None


# ── 헬퍼 ─────────────────────────────────────────────────────
def _ensure_watchlist(db: Session) -> Watchlist:
    wl = db.query(Watchlist).first()
    if not wl:
        wl = Watchlist(name="기본 관심목록")
        db.add(wl)
        db.commit()
        db.refresh(wl)
    return wl


def _item_to_dict(item: WatchlistItem) -> dict:
    return {
        "id":          item.id,
        "symbol":      item.symbol,
        "market":      item.market,
        "name":        item.name or item.symbol,
        "memo":        item.memo or "",
        "folder_id":   item.folder_id,
        "folder_name": item.folder.name if item.folder else None,
        "added_at":    str(item.added_at) if item.added_at else "",
    }


# ── 폴더 CRUD ────────────────────────────────────────────────
@router.get("/folders")
def get_folders(db: Session = Depends(get_db)):
    folders = db.query(WatchlistFolder).order_by(WatchlistFolder.position).all()
    result = []
    for f in folders:
        result.append({
            "id":       f.id,
            "name":     f.name,
            "position": f.position,
            "count":    len(f.items),
        })
    return result


@router.post("/folders")
def create_folder(req: FolderRequest, db: Session = Depends(get_db)):
    max_pos = db.query(WatchlistFolder).count()
    folder = WatchlistFolder(name=req.name, position=max_pos)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return {"id": folder.id, "name": folder.name, "position": folder.position, "count": 0}


@router.put("/folders/{folder_id}")
def update_folder(folder_id: int, req: FolderRequest, db: Session = Depends(get_db)):
    folder = db.query(WatchlistFolder).filter(WatchlistFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다")
    folder.name = req.name
    db.commit()
    return {"id": folder.id, "name": folder.name}


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: int, db: Session = Depends(get_db)):
    folder = db.query(WatchlistFolder).filter(WatchlistFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다")
    # 폴더 삭제 시 종목은 폴더 없는 상태로 유지
    for item in folder.items:
        item.folder_id = None
    db.delete(folder)
    db.commit()
    return {"message": "삭제 완료"}


# ── 관심종목 조회 (가격 포함) ─────────────────────────────────
@router.get("/items")
def get_items(market: Optional[str] = None, folder_id: Optional[int] = None, db: Session = Depends(get_db)):
    """관심종목 목록 조회 (가격 없는 메타데이터만)"""
    wl = _ensure_watchlist(db)
    q = db.query(WatchlistItem).filter(WatchlistItem.watchlist_id == wl.id)
    if market and market != "전체":
        q = q.filter(WatchlistItem.market == market)
    if folder_id is not None:
        q = q.filter(WatchlistItem.folder_id == folder_id)
    items = q.order_by(WatchlistItem.position, WatchlistItem.added_at).all()
    return [_item_to_dict(i) for i in items]


@router.get("/items/prices")
async def get_items_with_prices(market: Optional[str] = None, folder_id: Optional[int] = None, db: Session = Depends(get_db)):
    """관심종목 + 실시간 가격"""
    wl = _ensure_watchlist(db)
    q = db.query(WatchlistItem).filter(WatchlistItem.watchlist_id == wl.id)
    if market and market != "전체":
        q = q.filter(WatchlistItem.market == market)
    if folder_id is not None:
        q = q.filter(WatchlistItem.folder_id == folder_id)
    items = q.order_by(WatchlistItem.position, WatchlistItem.added_at).all()

    loop = asyncio.get_event_loop()

    async def fetch(item: WatchlistItem):
        meta = _item_to_dict(item)
        try:
            mkt = "KR" if item.market == "KR" else "US"
            price = await asyncio.wait_for(
                loop.run_in_executor(None, yf_service.get_stock_price, item.symbol, mkt),
                timeout=10,
            )
            return {**meta, **price}
        except Exception:
            return {**meta, "price": None, "change_rate": None}

    results = await asyncio.gather(*[fetch(i) for i in items])
    return list(results)


@router.get("/{watchlist_id}/prices")
async def get_watchlist_with_prices(watchlist_id: int, db: Session = Depends(get_db)):
    """기존 호환용"""
    wl = db.query(Watchlist).filter(Watchlist.id == watchlist_id).first()
    if not wl:
        wl = _ensure_watchlist(db)
    loop = asyncio.get_event_loop()

    async def fetch(item: WatchlistItem):
        try:
            mkt = "KR" if item.market == "KR" else "US"
            price = await asyncio.wait_for(
                loop.run_in_executor(None, yf_service.get_stock_price, item.symbol, mkt),
                timeout=10,
            )
            return {**_item_to_dict(item), **price}
        except Exception:
            return {**_item_to_dict(item), "price": None, "change_rate": None}

    results = await asyncio.gather(*[fetch(i) for i in wl.items])
    return {"id": wl.id, "name": wl.name, "items": list(results)}


# ── 종목 CRUD ─────────────────────────────────────────────────
@router.post("/items")
def add_item(req: AddItemRequest, db: Session = Depends(get_db)):
    wl = _ensure_watchlist(db)
    existing = db.query(WatchlistItem).filter(
        WatchlistItem.watchlist_id == wl.id,
        WatchlistItem.symbol == req.symbol,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="이미 추가된 종목입니다")
    count = db.query(WatchlistItem).filter(WatchlistItem.watchlist_id == wl.id).count()
    item = WatchlistItem(
        watchlist_id=wl.id,
        symbol=req.symbol,
        market=req.market,
        name=req.name,
        memo=req.memo,
        folder_id=req.folder_id,
        position=count,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_to_dict(item)


@router.put("/items/{item_id}")
def update_item(item_id: int, req: UpdateItemRequest, db: Session = Depends(get_db)):
    item = db.query(WatchlistItem).filter(WatchlistItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="종목을 찾을 수 없습니다")
    if req.name is not None:
        item.name = req.name
    if req.memo is not None:
        item.memo = req.memo
    if req.folder_id is not None:
        item.folder_id = req.folder_id if req.folder_id != -1 else None
    db.commit()
    return _item_to_dict(item)


@router.delete("/items/{item_id}")
def remove_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(WatchlistItem).filter(WatchlistItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="종목을 찾을 수 없습니다")
    db.delete(item)
    db.commit()
    return {"message": "제거 완료"}
