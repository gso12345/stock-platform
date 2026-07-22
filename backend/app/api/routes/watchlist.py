from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field
from typing import Optional
import asyncio

from app.db.database import get_db
from app.models.stock import Watchlist, WatchlistItem, WatchlistFolder
from app.models.user import User
import re
from app.core.deps import get_current_user, require_user
from app.services.ticker_service import get_display_name
from app.core.cache import cache

router = APIRouter(prefix="/watchlist", tags=["관심종목"])


# ── Pydantic 스키마 ──────────────────────────────────────────
class AddItemRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$")
    market: str = Field(..., pattern="^(KR|US|ETF)$")
    name: str = Field("", max_length=100)
    memo: str = Field("", max_length=200)
    watchlist_id: int = Field(1, ge=1)
    folder_id: Optional[int] = Field(None, ge=1)  # 비어있으면 "기본 관심목록" 폴더로 자동 편입


class FolderRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)


class UpdateItemRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    memo: Optional[str] = Field(None, max_length=200)
    folder_id: Optional[int] = Field(None, ge=1)


class ReorderRequest(BaseModel):
    order: list[int] = Field(..., max_length=200)  # item id 목록 (새 순서대로)


# ── 헬퍼 ─────────────────────────────────────────────────────
def _ensure_watchlist(db: Session, user_id: Optional[int] = None) -> Watchlist:
    """user_id가 있으면 해당 유저의 watchlist, 없으면 guest(user_id=None) watchlist 반환"""
    q = db.query(Watchlist).filter(Watchlist.user_id == user_id)
    wl = q.first()
    if not wl:
        wl = Watchlist(name="기본 관심목록", user_id=user_id)
        try:
            db.add(wl)
            db.commit()
            db.refresh(wl)
        except IntegrityError:
            db.rollback()
            wl = db.query(Watchlist).filter(Watchlist.user_id == user_id).first()
    return wl


def _valid_folder_id(db: Session, folder_id: int, user_id: int) -> bool:
    """folder_id가 현재 유저 소유(또는 공유 폴더)인지 확인 — 타 유저 폴더로의 IDOR 방지"""
    return db.query(WatchlistFolder).filter(
        WatchlistFolder.id == folder_id,
        (WatchlistFolder.user_id == user_id) | (WatchlistFolder.user_id == None),
    ).first() is not None


def _ensure_default_folder(db: Session, user_id: int) -> WatchlistFolder:
    """"기본 관심목록" 폴더를 반환, 없으면 생성 — 폴더 없는 종목을 위한 더미 그룹 대신
    실제 폴더로 편입시켜 "폴더 없음" 상태를 없앤다"""
    folder = db.query(WatchlistFolder).filter(
        WatchlistFolder.user_id == user_id, WatchlistFolder.name == "기본 관심목록",
    ).first()
    if not folder:
        max_pos = db.query(WatchlistFolder).filter(
            (WatchlistFolder.user_id == user_id) | (WatchlistFolder.user_id == None)
        ).count()
        folder = WatchlistFolder(name="기본 관심목록", position=max_pos, user_id=user_id)
        try:
            db.add(folder)
            db.commit()
            db.refresh(folder)
        except IntegrityError:
            db.rollback()
            folder = db.query(WatchlistFolder).filter(
                WatchlistFolder.user_id == user_id, WatchlistFolder.name == "기본 관심목록",
            ).first()
    return folder


def _migrate_orphan_items(db: Session, wl: Watchlist, user_id: int) -> None:
    """folder_id가 비어있는(폴더 도입 이전) 관심종목을 "기본 관심목록" 폴더로 편입한다"""
    has_orphan = db.query(WatchlistItem).filter(
        WatchlistItem.watchlist_id == wl.id, WatchlistItem.folder_id.is_(None),
    ).first()
    if not has_orphan:
        return
    folder = _ensure_default_folder(db, user_id)
    db.query(WatchlistItem).filter(
        WatchlistItem.watchlist_id == wl.id, WatchlistItem.folder_id.is_(None),
    ).update({"folder_id": folder.id})
    db.commit()


def _item_to_dict(item: WatchlistItem) -> dict:
    return {
        "id":          item.id,
        "symbol":      item.symbol,
        "market":      item.market,
        "name":        get_display_name(item.symbol, item.market, item.name or item.symbol),
        "memo":        item.memo or "",
        "folder_id":   item.folder_id,
        "folder_name": item.folder.name if item.folder else None,
        "added_at":    str(item.added_at) if item.added_at else "",
    }


# ── 루트 ─────────────────────────────────────────────────────
@router.get("/")
def get_watchlist(
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """기본 관심목록 정보"""
    user_id = current_user.id if current_user else None
    wl = _ensure_watchlist(db, user_id=user_id)
    return {"id": wl.id, "name": wl.name, "count": len(wl.items)}


# ── 폴더 CRUD ────────────────────────────────────────────────
@router.get("/folders")
def get_folders(
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    user_id = current_user.id if current_user else None
    if user_id is not None:
        _migrate_orphan_items(db, _ensure_watchlist(db, user_id=user_id), user_id)
    folders = (
        db.query(WatchlistFolder)
        .filter((WatchlistFolder.user_id == user_id) | (WatchlistFolder.user_id == None))
        .order_by(WatchlistFolder.position)
        .all()
    )
    counts: dict[int, int] = {}
    if folders:
        rows = (
            db.query(WatchlistItem.folder_id, func.count(WatchlistItem.id))
            .filter(WatchlistItem.folder_id.in_([f.id for f in folders]))
            .group_by(WatchlistItem.folder_id)
            .all()
        )
        counts = dict(rows)
    return [
        {"id": f.id, "name": f.name, "position": f.position, "count": counts.get(f.id, 0)}
        for f in folders
    ]


@router.post("/folders")
def create_folder(
    req: FolderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    max_pos = db.query(WatchlistFolder).filter(
        (WatchlistFolder.user_id == current_user.id) | (WatchlistFolder.user_id == None)
    ).count()
    folder = WatchlistFolder(name=req.name, position=max_pos, user_id=current_user.id)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return {"id": folder.id, "name": folder.name, "position": folder.position, "count": 0}


@router.put("/folders/reorder")
def reorder_folders(
    req: ReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """관심종목 폴더 순서 일괄 저장 (소유했거나 공유된 폴더만 수정)"""
    # "/folders/{folder_id}"보다 먼저 등록해야 함 — 그렇지 않으면 "reorder"가
    # folder_id로 파싱되어 422 에러가 나고 이 라우트에 도달하지 못함
    owned_ids = {
        fid for (fid,) in db.query(WatchlistFolder.id)
        .filter(
            WatchlistFolder.id.in_(req.order),
            (WatchlistFolder.user_id == current_user.id) | (WatchlistFolder.user_id == None),
        ).all()
    }
    db.bulk_update_mappings(WatchlistFolder, [
        {"id": folder_id, "position": position}
        for position, folder_id in enumerate(req.order)
        if folder_id in owned_ids
    ])
    db.commit()
    return {"message": "순서 저장 완료"}


@router.put("/folders/{folder_id}")
def update_folder(
    folder_id: int,
    req: FolderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    folder = db.query(WatchlistFolder).filter(WatchlistFolder.id == folder_id).first()
    if not folder or folder.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다")
    folder.name = req.name
    db.commit()
    return {"id": folder.id, "name": folder.name}


@router.delete("/folders/{folder_id}")
def delete_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    folder = db.query(WatchlistFolder).filter(WatchlistFolder.id == folder_id).first()
    if not folder or folder.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다")
    if folder.items:
        if folder.name == "기본 관심목록":
            raise HTTPException(status_code=400, detail="기본 관심목록 폴더는 종목을 모두 비운 뒤에만 삭제할 수 있습니다")
        default_folder = _ensure_default_folder(db, current_user.id)
        for item in folder.items:
            item.folder_id = default_folder.id
    db.delete(folder)
    db.commit()
    return {"message": "삭제 완료"}


# ── 관심종목 일괄 가격 조회 (빠른 배치 fetch + 캐시 저장) ────────
_SYMBOL_RE = re.compile(r"^[A-Za-z0-9.\-]{1,20}$")


@router.get("/prices")
async def get_watchlist_prices_batch(
    symbols: str = Query(..., max_length=1000),
    markets: str = Query(..., max_length=500),
):
    """심볼 목록을 받아 캐시 우선 조회, 미캐시 종목은 배치 fetch 후 캐시 저장"""
    from app.services.price_fetcher import fetch_yf_quotes_with_fallback, fetch_naver_stocks

    sym_list = [s.strip() for s in symbols.split(",") if s.strip()]
    mkt_list = [m.strip() for m in markets.split(",") if m.strip()]
    if not sym_list:
        return []
    if len(sym_list) > 50:
        raise HTTPException(status_code=400, detail="한 번에 최대 50개 심볼만 조회 가능합니다")
    for sym in sym_list:
        if not _SYMBOL_RE.match(sym):
            raise HTTPException(status_code=400, detail=f"잘못된 심볼 형식: {sym}")
    while len(mkt_list) < len(sym_list):
        mkt_list.append("US")

    sym_to_mkt = dict(zip(sym_list, mkt_list))
    results: dict[str, dict] = {}
    uncached_us: list[str] = []
    uncached_kr: list[str] = []

    # 1. 캐시 우선 조회
    for sym, mkt in zip(sym_list, mkt_list):
        cached = cache.get(f"price:{sym}") or cache.get_stale(f"price:{sym}")
        if cached and cached.get("price"):
            results[sym] = {**cached, "market": mkt}
        elif mkt == "KR":
            uncached_kr.append(sym.replace(".KS", "").replace(".KQ", ""))
        else:
            uncached_us.append(sym)

    # 2. 미캐시 종목 배치 fetch (멀티쿼트로 빠르게)
    tasks = []
    labels: list[str] = []
    if uncached_us:
        tasks.append(fetch_yf_quotes_with_fallback(uncached_us))
        labels.append("us")
    if uncached_kr:
        tasks.append(fetch_naver_stocks(uncached_kr))
        labels.append("kr")

    if tasks:
        fetch_results = await asyncio.gather(*tasks, return_exceptions=True)
        for label, data in zip(labels, fetch_results):
            if isinstance(data, Exception) or not isinstance(data, dict):
                continue
            if label == "us":
                for sym, q in data.items():
                    if q and q.get("price"):
                        cache.set(f"price:{sym}", q, 120)
                        results[sym] = {**q, "market": sym_to_mkt.get(sym, "US")}
            else:  # kr
                for code, q in data.items():
                    if not q or not q.get("price"):
                        continue
                    cache.set(f"price:{code}", q, 120)
                    cache.set(f"price:{code}.KS", q, 120)
                    cache.set(f"price:{code}.KQ", q, 120)
                    for s in sym_list:
                        if s.replace(".KS", "").replace(".KQ", "") == code:
                            results[s] = {**q, "market": "KR"}

    return [
        results.get(sym, {"symbol": sym, "market": sym_to_mkt.get(sym, "US"), "price": None, "change_rate": 0})
        for sym in sym_list
    ]


async def _batch_fetch_prices(items: list[WatchlistItem]) -> dict[str, dict]:
    """관심종목 리스트를 심볼별 순차 호출 대신 배치 멀티쿼트로 가격 조회 (캐시 우선)"""
    from app.services.price_fetcher import fetch_yf_quotes_with_fallback, fetch_naver_stocks

    results: dict[str, dict] = {}
    uncached_us: list[str] = []
    uncached_kr: list[str] = []
    kr_symbol_map: dict[str, list[str]] = {}

    for item in items:
        sym = item.symbol
        mkt = "KR" if item.market == "KR" else "US"
        cached = cache.get(f"price:{sym}") or cache.get_stale(f"price:{sym}")
        if cached and cached.get("price"):
            results[sym] = cached
        elif mkt == "KR":
            bare = sym.replace(".KS", "").replace(".KQ", "")
            uncached_kr.append(bare)
            kr_symbol_map.setdefault(bare, []).append(sym)
        else:
            uncached_us.append(sym)

    tasks = []
    labels: list[str] = []
    if uncached_us:
        tasks.append(fetch_yf_quotes_with_fallback(uncached_us))
        labels.append("us")
    if uncached_kr:
        tasks.append(fetch_naver_stocks(uncached_kr))
        labels.append("kr")

    if tasks:
        fetch_results = await asyncio.gather(*tasks, return_exceptions=True)
        for label, data in zip(labels, fetch_results):
            if isinstance(data, Exception) or not isinstance(data, dict):
                continue
            if label == "us":
                for sym, q in data.items():
                    if q and q.get("price"):
                        cache.set(f"price:{sym}", q, 120)
                        results[sym] = q
            else:
                for code, q in data.items():
                    if not q or not q.get("price"):
                        continue
                    cache.set(f"price:{code}", q, 120)
                    for orig_sym in kr_symbol_map.get(code, [code]):
                        results[orig_sym] = q
    return results


# ── 관심종목 조회 (가격 포함) ─────────────────────────────────
@router.get("/items")
def get_items(
    market: Optional[str] = None,
    folder_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    if market and market not in ("KR", "US", "ETF", "전체", None):
        market = None  # 잘못된 market 값 무시
    """관심종목 목록 조회 (가격 없는 메타데이터만)"""
    user_id = current_user.id if current_user else None
    wl = _ensure_watchlist(db, user_id=user_id)
    if user_id is not None:
        _migrate_orphan_items(db, wl, user_id)
    q = db.query(WatchlistItem).filter(WatchlistItem.watchlist_id == wl.id)
    if market and market != "전체":
        q = q.filter(WatchlistItem.market == market)
    if folder_id is not None:
        q = q.filter(WatchlistItem.folder_id == folder_id)
    items = q.options(joinedload(WatchlistItem.folder)).order_by(WatchlistItem.position, WatchlistItem.added_at).all()
    return [_item_to_dict(i) for i in items]


@router.get("/items/prices")
async def get_items_with_prices(
    market: Optional[str] = None,
    folder_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """관심종목 + 실시간 가격"""
    user_id = current_user.id if current_user else None
    wl = _ensure_watchlist(db, user_id=user_id)
    if user_id is not None:
        _migrate_orphan_items(db, wl, user_id)
    q = db.query(WatchlistItem).filter(WatchlistItem.watchlist_id == wl.id)
    if market and market != "전체":
        q = q.filter(WatchlistItem.market == market)
    if folder_id is not None:
        q = q.filter(WatchlistItem.folder_id == folder_id)
    items = q.options(joinedload(WatchlistItem.folder)).order_by(WatchlistItem.position, WatchlistItem.added_at).all()

    price_map = await _batch_fetch_prices(items)
    return [
        {**_item_to_dict(item), **price_map[item.symbol]} if item.symbol in price_map
        else {**_item_to_dict(item), "price": None, "change_rate": None}
        for item in items
    ]


@router.get("/{watchlist_id}/prices")
async def get_watchlist_with_prices(
    watchlist_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """기존 호환용"""
    wl = db.query(Watchlist).filter(Watchlist.id == watchlist_id).first()
    if wl and wl.user_id is not None:
        if not current_user or wl.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="관심목록을 찾을 수 없습니다")
    if not wl:
        user_id = current_user.id if current_user else None
        wl = _ensure_watchlist(db, user_id=user_id)

    items = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.watchlist_id == wl.id)
        .options(joinedload(WatchlistItem.folder))
        .order_by(WatchlistItem.position, WatchlistItem.added_at)
        .all()
    )
    price_map = await _batch_fetch_prices(items)
    results = [
        {**_item_to_dict(item), **price_map[item.symbol]} if item.symbol in price_map
        else {**_item_to_dict(item), "price": None, "change_rate": None}
        for item in items
    ]
    return {"id": wl.id, "name": wl.name, "items": results}


# ── 종목 CRUD ─────────────────────────────────────────────────
@router.post("/items")
def add_item(
    req: AddItemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    if req.folder_id is not None and not _valid_folder_id(db, req.folder_id, current_user.id):
        raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다")
    # 폴더 미지정 시 "기본 관심목록" 폴더로 자동 편입 — 폴더 없는 항목이 생기지 않도록 함
    folder_id = req.folder_id if req.folder_id is not None else _ensure_default_folder(db, current_user.id).id
    wl = _ensure_watchlist(db, user_id=current_user.id)
    existing = db.query(WatchlistItem).filter(
        WatchlistItem.watchlist_id == wl.id,
        WatchlistItem.symbol == req.symbol,
        WatchlistItem.folder_id == folder_id,
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
        folder_id=folder_id,
        position=count,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_to_dict(item)


@router.put("/items/reorder")
def reorder_items(
    req: ReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """관심종목 순서 일괄 저장 (소유한 watchlist 아이템만 수정)"""
    wl = _ensure_watchlist(db, user_id=current_user.id)
    owned_ids = {
        iid for (iid,) in db.query(WatchlistItem.id)
        .filter(WatchlistItem.id.in_(req.order), WatchlistItem.watchlist_id == wl.id)
        .all()
    }
    db.bulk_update_mappings(WatchlistItem, [
        {"id": item_id, "position": position}
        for position, item_id in enumerate(req.order)
        if item_id in owned_ids
    ])
    db.commit()
    return {"message": "순서 저장 완료"}


@router.put("/items/{item_id}")
def update_item(
    item_id: int,
    req: UpdateItemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    wl = _ensure_watchlist(db, user_id=current_user.id)
    item = db.query(WatchlistItem).filter(
        WatchlistItem.id == item_id,
        WatchlistItem.watchlist_id == wl.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="종목을 찾을 수 없습니다")
    if req.name is not None:
        item.name = req.name
    if req.memo is not None:
        item.memo = req.memo
    if req.folder_id is not None:
        if not _valid_folder_id(db, req.folder_id, current_user.id):
            raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다")
        item.folder_id = req.folder_id
    db.commit()
    return _item_to_dict(item)


@router.delete("/items/{item_id}")
def remove_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    wl = _ensure_watchlist(db, user_id=current_user.id)
    item = db.query(WatchlistItem).filter(
        WatchlistItem.id == item_id,
        WatchlistItem.watchlist_id == wl.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="종목을 찾을 수 없습니다")
    db.delete(item)
    db.commit()
    return {"message": "제거 완료"}
