"""공모주 — 상장일 시초가 예측 (services/ipo_service 참고)."""
import asyncio
from typing import Optional

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, Field, model_validator
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.services import ipo_calendar, ipo_service

router = APIRouter(prefix="/ipo", tags=["공모주"])
limiter = Limiter(key_func=get_remote_address)


@router.get("")
async def ipo_overview():
    """다가오는 공모주(예측과 함께)·최근 상장 결과·예측 정확도·자료 상태.

    DB 를 읽고 예측을 세우는 일이라 이벤트 루프 밖에서 한다. 자료가 오래됐으면
    뒤에서 새로 받기 시작하고(refreshing), 이번 응답은 가진 것으로 한다."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, ipo_service.한눈에)


@router.get("/brokers")
async def ipo_brokers(response: Response):
    """공모주를 주관한 증권사(지난 3년, 많이 맡은 순) — 알림 받을 증권사를 고르는 칸이 쓴다.

    로그인 없이 받는다(누구나 보는 자료다). 하루에 몇 곳 바뀌는 정도라 브라우저가 한 시간 들고 있게 한다."""
    loop = asyncio.get_running_loop()
    목록 = await loop.run_in_executor(
        None, lambda: ipo_calendar.증권사_목록(ipo_service.기록들(), ipo_service.오늘()))
    response.headers["Cache-Control"] = "public, max-age=3600"
    return {"brokers": 목록}


@router.get("/calendar.ics")
@limiter.limit("60/minute")
async def ipo_calendar_ics(
    request: Request,
    name: Optional[str] = Query(None, max_length=100, description="이 공모주 일정만"),
    brokers: Optional[str] = Query(None, max_length=300, description="쉼표로 이은 증권사 — 그 증권사가 주관하는 공모주만"),
):
    """청약·상장 일정을 iCalendar 로 — 캘린더 앱이 구독(webcal)하거나 한 곳만 받아 넣는다.

    로그인 없이 받는다. 캘린더 앱은 우리 로그인을 들고 오지 못하고, 공모주 일정은 누구나 보는 자료다."""
    증권사 = [b.strip() for b in (brokers or "").split(",") if b.strip()][:20]
    loop = asyncio.get_running_loop()
    글 = await loop.run_in_executor(None, ipo_calendar.달력, name, 증권사)
    return Response(글, media_type="text/calendar; charset=utf-8", headers={
        # 한 곳만 받을 때는 파일로(휴대폰은 '캘린더에 추가' 를 띄운다), 구독은 그대로 읽게
        "Content-Disposition": f'{"attachment" if name else "inline"}; filename="ipo.ics"',
        "Cache-Control": "public, max-age=1800",
    })


class 직접예측(BaseModel):
    offer_price: float = Field(..., gt=0, le=10_000_000, description="확정 공모가(원)")
    inst_ratio: float = Field(..., ge=0, le=100_000, description="기관 수요예측 경쟁률(N:1 의 N)")
    lockup_pct: float = Field(..., ge=0, le=100, description="의무보유확약 비율(%)")
    sub_ratio: Optional[float] = Field(None, ge=0, le=100_000, description="일반청약 경쟁률")
    band_low: Optional[float] = Field(None, gt=0, le=10_000_000, description="희망공모가 하단(원)")
    band_high: Optional[float] = Field(None, gt=0, le=10_000_000, description="희망공모가 상단(원)")
    offer_amount_eok: Optional[float] = Field(None, gt=0, le=1_000_000, description="공모금액(억원)")
    # 상세 페이지 항목 — 비워 두면 그 항목 없이 견준다
    float_pct: Optional[float] = Field(None, gt=0, le=100, description="상장일 유통가능물량(%)")
    equal_shares: Optional[float] = Field(None, ge=0, le=10_000, description="균등 배정 수량(계좌당 주)")
    old_pct: Optional[float] = Field(None, ge=0, le=100, description="구주매출 비중(%)")
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
