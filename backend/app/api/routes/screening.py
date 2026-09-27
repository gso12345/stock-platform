from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from typing import Optional
import asyncio
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.database import get_db
from app.models.stock import ScreeningPreset
from app.models.user import User
from app.core.deps import require_user, get_current_user
from app.services.yf_service import yf_service, 스크리닝_숫자키, 스크리닝_글자키
from app.core.cache import cache

router = APIRouter(prefix="/screening", tags=["스크리닝"])
limiter = Limiter(key_func=get_remote_address)

_SORT_PATTERN = "^(" + "|".join(sorted(스크리닝_숫자키)) + ")$"


def _조건검사(filters: dict) -> dict:
    """모르는 키나 숫자가 아닌 값은 **요청 단계에서** 돌려보낸다.
    모르는 키는 모든 종목이 '값 없음'으로 떨어져 결과가 조용히 0개가 되고,
    숫자 자리에 글자가 오면 비교하다 500 이 난다 — 둘 다 사용자는
    '조건이 너무 좁은가 보다' 로 읽는다."""
    for key, cond in filters.items():
        if not isinstance(cond, dict):
            raise ValueError(f"{key} 조건 형식이 잘못됐어요")
        if key in 스크리닝_글자키:
            if set(cond) - {"eq"} or not isinstance(cond.get("eq"), str):
                raise ValueError(f"{key} 는 글자 하나로 골라요")
            continue
        if key not in 스크리닝_숫자키:
            raise ValueError(f"'{key}' 로는 거를 수 없어요")
        if set(cond) - {"min", "max"}:
            raise ValueError(f"{key} 조건은 최소·최대만 쓸 수 있어요")
        for v in cond.values():
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise ValueError(f"{key} 조건은 숫자여야 해요")
        if "min" in cond and "max" in cond and cond["min"] > cond["max"]:
            raise ValueError(f"{key} 의 최소가 최대보다 커요")
    return filters


class ScreeningRequest(BaseModel):
    market: str = Field("US", pattern="^(KR|US|ETF)$")
    filters: dict = Field(default={}, max_length=20)
    sort_by: str = Field("market_cap", pattern=_SORT_PATTERN)
    sort_order: str = Field("desc", pattern="^(asc|desc)$")
    limit: int = Field(50, ge=1, le=100)

    _조건 = field_validator("filters")(classmethod(lambda cls, v: _조건검사(v)))


class PresetSaveRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    market: str = Field(..., pattern="^(KR|US|ETF)$")
    filters: dict = Field(default={}, max_length=20)
    sort_by: str = Field(..., pattern=_SORT_PATTERN)
    sort_order: str = Field("desc", pattern="^(asc|desc)$")

    _조건 = field_validator("filters")(classmethod(lambda cls, v: _조건검사(v)))


def 줄세우기(results: list, sort_by: str, desc: bool) -> list:
    """값 없는 종목은 오름·내림 어느 쪽이든 **맨 뒤로.** 예전엔 없는 값을 0 으로
    쳐서, PER 낮은 순으로 세우면 PER 모르는 적자 기업들이 1등부터 깔렸다."""
    있음 = [r for r in results if r.get(sort_by) is not None]
    없음 = [r for r in results if r.get(sort_by) is None]
    return sorted(있음, key=lambda r: r[sort_by], reverse=desc) + 없음


@router.post("/run")
@limiter.limit("10/minute")
async def run_screening(request: Request, req: ScreeningRequest):
    ck = f"screening:{req.market}:{req.sort_by}:{req.sort_order}:{sorted(req.filters.items())}"
    if cached := cache.get(ck):
        return cached
    loop = asyncio.get_running_loop()
    results = await loop.run_in_executor(None, yf_service.screen_stocks, req.market, req.filters)
    results = 줄세우기(results, req.sort_by, req.sort_order == "desc")
    payload = {"results": results[: req.limit], "total": len(results)}
    cache.set(ck, payload, 300)
    return payload


@router.get("/presets")
def get_presets(db: Session = Depends(get_db), current_user: Optional[User] = Depends(get_current_user)):
    if not current_user:
        return []
    return db.query(ScreeningPreset).filter(ScreeningPreset.user_id == current_user.id).all()


@router.post("/presets")
def save_preset(req: PresetSaveRequest, db: Session = Depends(get_db), current_user: User = Depends(require_user)):
    preset = ScreeningPreset(
        name=req.name, market=req.market, filters=req.filters,
        sort_by=req.sort_by, sort_order=req.sort_order,
        user_id=current_user.id,
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return preset


@router.delete("/presets/{preset_id}")
def delete_preset(preset_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_user)):
    preset = db.query(ScreeningPreset).filter(
        ScreeningPreset.id == preset_id, ScreeningPreset.user_id == current_user.id
    ).first()
    if not preset:
        raise HTTPException(status_code=404, detail="프리셋을 찾을 수 없습니다")
    db.delete(preset)
    db.commit()
    return {"message": "삭제 완료"}
