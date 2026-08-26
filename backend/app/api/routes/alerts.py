"""가격 알림 — "삼성전자 8만원 되면 알려줘".

자산 앱에 사람을 다시 오게 하는 가장 큰 힘인데 이 자리가 비어 있었다.
알림 화면은 진작 있었지만 커뮤니티 반응(댓글·좋아요)만 받았다.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.deps import require_user
from app.db.database import get_db
from app.models.stock import PriceAlert

log = logging.getLogger(__name__)

router = APIRouter(prefix="/alerts", tags=["가격 알림"])
limiter = Limiter(key_func=get_remote_address)

#: 한 사람이 걸 수 있는 알림 수.
#
# 확인은 30초마다 '켜져 있는 것 전부' 를 훑는다. 캐시만 읽으므로 한 건에
# 거의 값이 안 들지만, 한 사람이 수천 개를 걸면 그것만으로 0.15 CPU 가
# 밀린다. 나중에 유료로 풀어 줄 자리이기도 하다(무료 30 / 유료 무제한).
최대_알림수 = 30

_기호패턴 = r"^[A-Za-z0-9._-]{1,20}$"


class 알림요청(BaseModel):
    symbol:    str   = Field(..., pattern=_기호패턴)
    market:    str   = Field(..., pattern=r"^(KR|US|ETF)$")
    name:      str   = Field(default="", max_length=100)
    direction: str   = Field(..., pattern=r"^(above|below)$")
    target:    float = Field(..., gt=0)


def _내알림(db: Session, uid: int):
    return db.query(PriceAlert).filter(PriceAlert.user_id == uid)


def _내보내기(a: PriceAlert) -> dict:
    return {
        "id": a.id, "symbol": a.symbol, "market": a.market, "name": a.name or a.symbol,
        "direction": a.direction, "target": a.target,
        "made_at_price": a.made_at_price,
        "is_active": bool(a.is_active),
        "fired_at": a.fired_at.isoformat() if a.fired_at else None,
        "fired_price": a.fired_price,
    }


@router.get("")
def 목록(symbol: str | None = Query(default=None),
         db: Session = Depends(get_db), me=Depends(require_user)):
    """내 알림. symbol 을 주면 그 종목 것만."""
    q = _내알림(db, me.id)
    if symbol:
        q = q.filter(PriceAlert.symbol == symbol)
    rows = q.order_by(PriceAlert.is_active.desc(), PriceAlert.id.desc()).limit(200).all()
    return {"items": [_내보내기(a) for a in rows], "limit": 최대_알림수}


@router.post("")
@limiter.limit("30/minute")
def 만들기(request: Request, 본문: 알림요청,
           db: Session = Depends(get_db), me=Depends(require_user)):
    """알림을 건다. 같은 조건이 이미 있으면 새로 안 만들고 켜기만 한다.

    껐다 켰다 하는 것이 흔한 동작인데, 그때마다 새 줄이 쌓이면 목록이
    같은 알림으로 뒤덮인다. 표에도 (user, symbol, direction, target) 을
    한 벌로 못 박아 뒀다.

    ── DB 왕복을 줄인다 ──

    예전에는 '켜진 것 세기'(count) 와 '같은 조건 찾기'(first) 를 따로
    물어봤다. DB 가 같은 기계에 있으면 공짜지만 여기는 Supabase 라
    한 번 물어볼 때마다 네트워크를 건넌다. 어차피 한 사람의 알림은
    30개까지라 통째로 한 번에 꺼내서 둘 다 여기서 센다.

    commit 뒤의 refresh 도 뺐다. 그건 방금 쓴 줄을 다시 읽어 오는
    일인데(왕복 하나 더), flush 로 id 만 받아 두면 그럴 이유가 없다.
    """
    내것 = _내알림(db, me.id).limit(최대_알림수 * 4).all()

    if sum(1 for a in 내것 if a.is_active) >= 최대_알림수:
        raise HTTPException(400, f"알림은 {최대_알림수}개까지 걸 수 있어요. 안 쓰는 것을 지워 주세요.")

    있던것 = next((a for a in 내것
                   if a.symbol == 본문.symbol
                   and a.direction == 본문.direction
                   and a.target == 본문.target), None)

    지금값 = _지금값(본문.symbol)
    if 있던것:
        있던것.is_active = True
        있던것.fired_at = None
        있던것.fired_price = None
        있던것.made_at_price = 지금값
        있던것.name = 본문.name or 있던것.name
        답 = _내보내기(있던것)          # 커밋 전에 만들어 둔다 — 뒤에 다시 안 읽는다
        db.commit()
        return 답

    새것 = PriceAlert(
        user_id=me.id, symbol=본문.symbol, market=본문.market,
        name=본문.name or 본문.symbol, direction=본문.direction,
        target=본문.target, made_at_price=지금값, is_active=True,
    )
    db.add(새것)
    db.flush()                           # id 를 받는다. 아직 커밋은 아니다
    답 = _내보내기(새것)
    db.commit()
    return 답


@router.patch("/{알림id}")
@limiter.limit("60/minute")
def 켜고끄기(request: Request, 알림id: int = Path(..., ge=1),
             db: Session = Depends(get_db), me=Depends(require_user)):
    a = _내알림(db, me.id).filter(PriceAlert.id == 알림id).first()
    if not a:
        raise HTTPException(404, "없는 알림입니다")
    a.is_active = not a.is_active
    if a.is_active:
        # 다시 켜는 것은 '한 번 더 받겠다' 는 뜻이다. 지난 기록은 지운다
        a.fired_at = None
        a.fired_price = None
        a.made_at_price = _지금값(a.symbol)
    답 = _내보내기(a)                    # 커밋 전에. refresh 는 왕복 하나 더다
    db.commit()
    return 답


@router.delete("/{알림id}")
@limiter.limit("60/minute")
def 지우기(request: Request, 알림id: int = Path(..., ge=1),
           db: Session = Depends(get_db), me=Depends(require_user)):
    a = _내알림(db, me.id).filter(PriceAlert.id == 알림id).first()
    if not a:
        raise HTTPException(404, "없는 알림입니다")
    db.delete(a); db.commit()
    return {"ok": True}


def _지금값(symbol: str) -> "float | None":
    """이미 받아 둔 시세에서 꺼낸다. 알림 때문에 새로 조회하지 않는다."""
    try:
        from app.core.cache import cache
        p = cache.get(f"price:{symbol}") or cache.get_stale(f"price:{symbol}")
        v = (p or {}).get("price")
        return float(v) if v else None
    except Exception:
        return None
