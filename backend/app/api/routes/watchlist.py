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
import logging
import os
import re
from app.core.backoff import 쉼표
from app.core.deps import get_current_user, require_user
from app.services.ticker_service import get_display_name
from app.core.cache import cache

log = logging.getLogger(__name__)
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



async def _yf_only(symbols: list[str]) -> dict:
    """가격만 필요한 곳에서 쓰는 래퍼 — 폴백 개수(계측용)는 버린다."""
    from app.services.price_fetcher import fetch_yf_quotes_with_fallback
    data, _ = await fetch_yf_quotes_with_fallback(symbols)
    return data


# ── 관심종목 일괄 가격 조회 (빠른 배치 fetch + 캐시 저장) ────────
_SYMBOL_RE = re.compile(r"^[A-Za-z0-9.\-]{1,20}$")

#: 시세를 받아 오느라 화면을 붙잡아 둘 수 있는 최대 시간(초).
#:
#: 상한이 아예 없었다. 그런데 이 경로는 '내 자산' 화면 전체가 매달려
#: 있는 자리다 — 평가금액도, 보유 목록도, 배당 배지도 여기가 답해야
#: 그려진다. 실제로 재 보니 캐시에 없는 종목이 섞이면 **9초**가
#: 걸렸다(배치가 실패한 뒤 종목마다 단건으로 한 번씩 더 물어보기
#: 때문이다). 그동안 화면은 통째로 뼈대다.
#:
#: 상한을 넘기면 받아 둔 것만 주고 나머지는 null 로 답한다. 화면은
#: 그 모양을 이미 다룰 줄 안다(시세 조회 대상이 아닌 심볼과 같은 모양)
#: 이고, price 가 null 인 종목이 남아 있으면 몇 초 뒤 한 번 더 물어본다 —
#: 그래서 화면이 통째로 멈추는 대신 채워지면서 완성된다.
#:
#: 받아 오는 일 자체는 shield 로 배경에 남겨 둔다 — 여기서 취소하면
#: 다음 요청도, 그다음 요청도 똑같이 처음부터 돌아 영영 캐시가 안 찬다.
_시세_상한 = float(os.getenv("PRICE_BATCH_TIMEOUT", "3"))

#: 못 받는 종목은 쉬게 둔다.
#:
#: 실패를 기억하지 않아서, 야후가 모르는 심볼 하나가 섞여 있으면 화면을
#: 열 때마다 그 종목 때문에 단건 조회가 한 번씩 더 나갔다. 상장폐지된
#: 종목을 목록에 남겨 둔 사람은 그 비용을 영원히 문다.
#:
#: 지우지는 않는다 — 얼마 뒤 저절로 다시 찔러보고, 되살아나면 돌아온다.
시세쉼 = 쉼표(쉼_기준=3, 되살림_칸=2)

#: 지금 받아 오는 중인 묶음. 같은 종목을 두 번 물어보지 않으려고 둔다.
#:
#: 상한을 걸면서 새로 생긴 문제다 — 3초에 끊고 돌려보내는데 화면은 몇 초
#: 뒤 다시 물어본다. 그 사이 앞의 조회가 아직 안 끝났으면, 같은 종목을
#: 받아 오는 일이 둘·셋 겹쳐 돈다. 야후 입장에서는 같은 질문을 여러 번
#: 받는 셈이고, 이 서버 입장에서는 스레드가 그만큼 묶인다.
#:
#: 이미 도는 것이 있으면 그것에 붙는다. 끝나면 치운다.
_받는중: dict[str, asyncio.Task] = {}


def _한번만(열쇠: str, 만들기) -> asyncio.Task:
    """같은 열쇠로 이미 도는 일이 있으면 그것을 준다."""
    있던것 = _받는중.get(열쇠)
    if 있던것 and not 있던것.done():
        return 있던것
    새것 = asyncio.get_running_loop().create_task(만들기())
    _받는중[열쇠] = 새것
    새것.add_done_callback(lambda t, k=열쇠: _받는중.pop(k, None) if _받는중.get(k) is t else None)
    return 새것


@router.get("/prices")
async def get_watchlist_prices_batch(
    symbols: str = Query(..., max_length=1000),
    markets: str = Query(..., max_length=500),
):
    """심볼 목록을 받아 캐시 우선 조회, 미캐시 종목은 배치 fetch 후 캐시 저장"""
    from app.services.price_fetcher import fetch_yf_quotes_with_fallback, fetch_naver_stocks

    raw_syms = [s.strip() for s in symbols.split(",") if s.strip()]
    raw_mkts = [m.strip() for m in markets.split(",") if m.strip()]
    if not raw_syms:
        return []
    if len(raw_syms) > 50:
        raise HTTPException(status_code=400, detail="한 번에 최대 50개 심볼만 조회 가능합니다")
    while len(raw_mkts) < len(raw_syms):
        raw_mkts.append("US")

    # 시세를 조회할 수 없는 항목은 건너뛰고, 나머지는 그대로 돌려준다.
    #
    # 예전에는 형식에 안 맞는 심볼 하나만 있어도 400 으로 요청 전체를 거절했다.
    # 포트폴리오는 '현금'·'금'·'채권' 같은 한글 심볼을 허용하므로, 보유종목을
    # 시세 조회에 함께 넣자마자 관심종목 20개의 시세가 통째로 사라졌다.
    # 한 항목 때문에 나머지가 죽는 구조 자체가 문제였다.
    skipped = [s for s in raw_syms if not _SYMBOL_RE.match(s)]
    if skipped:
        log.info(f"시세 조회 대상이 아닌 심볼 {len(skipped)}개 건너뜀: {skipped[:5]}")
    sym_list = [s for s in raw_syms if _SYMBOL_RE.match(s)]
    mkt_list = [m for s, m in zip(raw_syms, raw_mkts) if _SYMBOL_RE.match(s)]
    if not sym_list:
        # 전부 조회 대상이 아니어도 요청한 순서대로 빈 값을 돌려준다 —
        # 프론트엔드가 심볼 기준으로 짝을 맞추므로 형식은 유지해야 한다
        return [{"symbol": s, "market": m, "price": None, "change_rate": 0}
                for s, m in zip(raw_syms, raw_mkts)]

    sym_to_mkt = dict(zip(sym_list, mkt_list))
    results: dict[str, dict] = {}
    uncached_us: list[str] = []
    uncached_kr: list[str] = []
    #: 쉬다가 이번 회차에 한 번 찔러볼 것들. 이쪽은 **기다리지 않는다**
    깨울_us: list[str] = []
    깨울_kr: list[str] = []

    # 쉬는 종목을 뒤로 미룬다 — 살아 있는 것부터 시간을 쓴다.
    # 계속 실패하는 심볼 하나가 매번 상한을 다 먹고 나머지를 굶기면 안 된다
    이번회차 = set(시세쉼.돌아가며_깨우기(sym_list, lambda s: f"price:{s}"))

    # 1. 캐시 우선 조회
    for sym, mkt in zip(sym_list, mkt_list):
        cached = cache.get(f"price:{sym}") or cache.get_stale(f"price:{sym}")
        if cached and cached.get("price"):
            results[sym] = {**cached, "market": mkt}
            continue
        if sym not in 이번회차:
            continue                     # 쉬는 중 — 이번엔 아예 안 물어본다
        코드 = sym.replace(".KS", "").replace(".KQ", "") if mkt == "KR" else sym
        if 시세쉼.쉬는가(f"price:{sym}"):
            # 되살아났나 찔러보는 것뿐이다. 이걸 기다리면, 상장폐지된 종목
            # 하나 때문에 멀쩡한 사람이 매번 상한을 꽉 채워 기다리게 된다 —
            # 되살아날 확률이 낮은 쪽에 사람의 시간을 쓰는 셈이다.
            # 배경으로 던져 두고 결과는 다음 요청이 캐시에서 줍는다.
            (깨울_kr if mkt == "KR" else 깨울_us).append(코드)
        elif mkt == "KR":
            uncached_kr.append(코드)
        else:
            uncached_us.append(sym)

    # 2. 미캐시 종목 배치 fetch (멀티쿼트로 빠르게)
    #
    # 받자마자 캐시에 넣는 것이 요점이다. 예전에는 gather 를 기다린 **뒤**에
    # 캐시에 넣었는데, 상한을 걸고 나니 그 자리가 상한을 넘긴 요청에서는
    # 아예 안 돌았다 — 배경에 남겨 둔 일이 값을 받아 놓고도 아무 데도
    # 안 넣어서, 다음 요청도 또 처음부터 받아야 했다. 상한을 건 뜻이 통째로
    # 사라지는 셈이다.
    def _성패기록(물어본것: list[str], 받은것: dict) -> None:
        """무엇이 됐고 무엇이 안 됐는지 쉼표에 남긴다.

        여기서 하는 것이 요점이다. 배경으로 던진 '되살아났나' 찔러보기도
        같은 자리를 지나므로, 되살아난 종목이 스스로 쉼에서 빠져나온다 —
        응답을 만드는 쪽에서 세면 그 길이 막힌다(배경 일의 결과를 모르니까).
        """
        for 이름 in 물어본것:
            q = 받은것.get(이름)
            됐나 = bool(q and q.get("price"))
            시세쉼.기록(f"price:{이름}", not 됐나)
            if 이름 in sym_to_mkt or 이름 in sym_list:
                continue
            # 국내는 접미사를 뗀 코드로 물어본다. 화면이 쓰는 이름으로도 남긴다
            for 원래 in sym_list:
                if 원래.replace(".KS", "").replace(".KQ", "") == 이름:
                    시세쉼.기록(f"price:{원래}", not 됐나)

    async def _받아서_담기(label: str, 코루틴, 물어본것: list[str]) -> None:
        try:
            data = await 코루틴
        except Exception as e:
            log.debug("시세 배치 실패(%s): %s", label, type(e).__name__)
            _성패기록(물어본것, {})
            return
        if not isinstance(data, dict):
            _성패기록(물어본것, {})
            return
        if label == "us":
            for sym, q in data.items():
                if q and q.get("price"):
                    cache.set(f"price:{sym}", q, 120)
        else:  # kr — 접미사(.KS/.KQ)를 붙여 찾는 자리가 있어 셋 다 담는다
            for code, q in data.items():
                if not q or not q.get("price"):
                    continue
                cache.set(f"price:{code}", q, 120)
                cache.set(f"price:{code}.KS", q, 120)
                cache.set(f"price:{code}.KQ", q, 120)
        _성패기록(물어본것, data)

    # 되살아났나 찔러보는 것은 배경으로 던진다. 사람은 안 기다린다
    if 깨울_us or 깨울_kr:
        async def _찔러보기():
            일 = []
            if 깨울_us:
                일.append(_한번만("us:" + ",".join(sorted(깨울_us)),
                                  lambda: _받아서_담기("us", _yf_only(깨울_us), 깨울_us)))
            if 깨울_kr:
                일.append(_한번만("kr:" + ",".join(sorted(깨울_kr)),
                                  lambda: _받아서_담기("kr", fetch_naver_stocks(깨울_kr), 깨울_kr)))
            await asyncio.gather(*일, return_exceptions=True)
        asyncio.get_running_loop().create_task(_찔러보기())

    tasks = []
    if uncached_us:
        tasks.append(_한번만("us:" + ",".join(sorted(uncached_us)),
                             lambda: _받아서_담기("us", _yf_only(uncached_us), uncached_us)))
    if uncached_kr:
        tasks.append(_한번만("kr:" + ",".join(sorted(uncached_kr)),
                             lambda: _받아서_담기("kr", fetch_naver_stocks(uncached_kr), uncached_kr)))

    if tasks:
        # 상한을 건다. 넘기면 받아 둔 것만 주고 나머지는 배경에서 마저 받는다 —
        # 그 결과는 위에서 캐시에 들어가므로 다음 요청 때는 곧바로 나온다
        모으기 = asyncio.gather(*tasks, return_exceptions=True)
        try:
            await asyncio.wait_for(asyncio.shield(모으기), timeout=_시세_상한)
        except Exception:
            log.info("시세 배치가 %.1f초를 넘겨 받은 것만 돌려준다 (남은 것은 배경에서)", _시세_상한)

        # 상한 안에 들어온 것을 캐시에서 다시 꺼낸다. 담는 자리가 한 곳뿐이라
        # '받아 놓고 응답에는 안 실리는' 어긋남이 생길 수 없다
        for sym, mkt in zip(sym_list, mkt_list):
            if sym in results:
                continue
            받은것 = cache.get(f"price:{sym}")
            if 받은것 and 받은것.get("price"):
                results[sym] = {**받은것, "market": mkt}

    # 건너뛴 심볼까지 포함해 요청한 순서대로 돌려준다. 프론트엔드는 심볼로
    # 짝을 맞추므로 빠진 항목이 있어도 되지만, 있으면 '조회 대상이 아님'을
    # 화면에서 구분할 수 있다
    return [
        results.get(sym, {"symbol": sym, "market": m, "price": None, "change_rate": 0})
        for sym, m in zip(raw_syms, raw_mkts)
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
        tasks.append(_yf_only(uncached_us))
        labels.append("us")
    if uncached_kr:
        tasks.append(fetch_naver_stocks(uncached_kr))
        labels.append("kr")

    if tasks:
        # 상한을 건다. 넘기면 받아 둔 것만 주고 나머지는 배경에서 마저 받는다 —
        # 그 결과는 캐시에 들어가므로 다음 요청 때는 곧바로 나온다
        모으기 = asyncio.gather(*tasks, return_exceptions=True)
        try:
            fetch_results = await asyncio.wait_for(asyncio.shield(모으기), timeout=_시세_상한)
        except Exception:
            log.info("시세 배치가 %.0f초를 넘겨 받은 것만 돌려준다 (남은 것은 배경에서)", _시세_상한)
            fetch_results = []
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
