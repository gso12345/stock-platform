from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import asyncio

from app.db.database import get_db
from app.models.stock import ScreeningPreset
from app.services.yf_service import yf_service

router = APIRouter(prefix="/screening", tags=["스크리닝"])


class ScreeningRequest(BaseModel):
    market: str = "US"  # KR, US, ETF
    filters: dict = {}
    sort_by: str = "market_cap"
    sort_order: str = "desc"
    limit: int = 50


class PresetSaveRequest(BaseModel):
    name: str
    market: str
    filters: dict
    sort_by: str
    sort_order: str = "desc"


@router.post("/run")
async def run_screening(req: ScreeningRequest):
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(None, yf_service.screen_stocks, req.market, req.filters)
    results.sort(key=lambda x: (x.get(req.sort_by) or 0), reverse=(req.sort_order == "desc"))
    return {"results": results[: req.limit], "total": len(results)}


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
