from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
import asyncio
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.database import get_db
from app.models.stock import ScreeningPreset
from app.services.yf_service import yf_service
from app.core.cache import cache

router = APIRouter(prefix="/screening", tags=["스크리닝"])
limiter = Limiter(key_func=get_remote_address)

_VALID_SORT = {"market_cap", "change_rate", "volume", "per", "pbr", "roe", "price"}
_VALID_MARKETS = {"KR", "US", "ETF"}


class ScreeningRequest(BaseModel):
    market: str = Field("US", pattern="^(KR|US|ETF)$")
    filters: dict = Field(default={}, max_length=20)
    sort_by: str = Field("market_cap", max_length=30)
    sort_order: str = Field("desc", pattern="^(asc|desc)$")
    limit: int = Field(50, ge=1, le=100)


class PresetSaveRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    market: str = Field(..., pattern="^(KR|US|ETF)$")
    filters: dict = Field(default={}, max_length=20)
    sort_by: str = Field(..., max_length=30)
    sort_order: str = Field("desc", pattern="^(asc|desc)$")


@router.post("/run")
@limiter.limit("10/minute")
async def run_screening(request: Request, req: ScreeningRequest):
    ck = f"screening:{req.market}:{req.sort_by}:{req.sort_order}:{sorted(req.filters.items())}"
    if cached := cache.get(ck):
        return cached
    loop = asyncio.get_running_loop()
    results = await loop.run_in_executor(None, yf_service.screen_stocks, req.market, req.filters)
    results.sort(key=lambda x: (x.get(req.sort_by) or 0), reverse=(req.sort_order == "desc"))
    payload = {"results": results[: req.limit], "total": len(results)}
    cache.set(ck, payload, 300)
    return payload


@router.get("/presets")
def get_presets(db: Session = Depends(get_db)):
    return db.query(ScreeningPreset).all()


@router.post("/presets")
def save_preset(req: PresetSaveRequest, db: Session = Depends(get_db)):
    preset = ScreeningPreset(
        name=req.name, market=req.market, filters=req.filters,
        sort_by=req.sort_by, sort_order=req.sort_order,
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return preset


@router.delete("/presets/{preset_id}")
def delete_preset(preset_id: int, db: Session = Depends(get_db)):
    preset = db.query(ScreeningPreset).filter(ScreeningPreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="프리셋을 찾을 수 없습니다")
    db.delete(preset)
    db.commit()
    return {"message": "삭제 완료"}
