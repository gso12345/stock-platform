"""공모주 — 상장일 시초가 예측 (services/ipo_service 참고)."""
import asyncio
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, model_validator
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.services import ipo_service

router = APIRouter(prefix="/ipo", tags=["공모주"])
limiter = Limiter(key_func=get_remote_address)


@router.get("")
async def ipo_overview():
    """다가오는 공모주(예측과 함께)·최근 상장 결과·예측 정확도·자료 상태.

    DB 를 읽고 예측을 세우는 일이라 이벤트 루프 밖에서 한다. 자료가 오래됐으면
    뒤에서 새로 받기 시작하고(refreshing), 이번 응답은 가진 것으로 한다."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, ipo_service.한눈에)


class 직접예측(BaseModel):
    offer_price: float = Field(..., gt=0, le=10_000_000, description="확정 공모가(원)")
    inst_ratio: float = Field(..., ge=0, le=100_000, description="기관 수요예측 경쟁률(N:1 의 N)")
    lockup_pct: float = Field(..., ge=0, le=100, description="의무보유확약 비율(%)")
    sub_ratio: Optional[float] = Field(None, ge=0, le=100_000, description="일반청약 경쟁률")
    band_low: Optional[float] = Field(None, gt=0, le=10_000_000, description="희망공모가 하단(원)")
    band_high: Optional[float] = Field(None, gt=0, le=10_000_000, description="희망공모가 상단(원)")
    offer_amount_eok: Optional[float] = Field(None, gt=0, le=1_000_000, description="공모금액(억원)")
    kind: str = Field("normal", pattern="^(normal|spac|reit)$")

    @model_validator(mode="after")
    def _밴드(self):
        if self.band_low and self.band_high and self.band_low > self.band_high:
            raise ValueError("희망공모가 하단이 상단보다 커요")
        return self


@router.post("/predict")
@limiter.limit("30/minute")
async def ipo_predict(request: Request, body: 직접예측):
    값 = body.model_dump()
    # 화면은 사람들이 쓰는 '억원' 으로 받고, 기록은 원천(38)대로 백만원이다
    억 = 값.pop("offer_amount_eok")
    값["offer_amount"] = 억 * 100 if 억 else None
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, ipo_service.직접_예측, 값)
