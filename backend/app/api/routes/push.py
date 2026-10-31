"""웹 푸시 — 휴대폰(브라우저)마다 켜고 끄기, 시험 알림."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.core.deps import require_user
from app.db.database import get_db
from app.services import push_service

router = APIRouter(prefix="/push", tags=["웹 푸시"])
limiter = Limiter(key_func=get_remote_address)


class 열쇠들(BaseModel):
    p256dh: str = Field(..., min_length=80, max_length=200)
    auth:   str = Field(..., min_length=16, max_length=100)


class 구독요청(BaseModel):
    endpoint: str = Field(..., max_length=1000)
    keys: 열쇠들
    # 공모주 청약 첫날·마지막 날 아침 알림 — 고른 증권사가 있으면 그 증권사가 주관하는 것만
    ipo: bool = True
    brokers: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("endpoint")
    @classmethod
    def _끝점(cls, v: str) -> str:
        # 아무 주소나 받으면 우리 서버가 그 주소로 POST 를 보내게 된다(사내망·클라우드 정보 주소 등)
        if not push_service.받는_끝점인가(v):
            raise ValueError("알려진 푸시 서버 주소가 아니에요")
        return v

    @field_validator("brokers")
    @classmethod
    def _증권사(cls, v: list[str]) -> list[str]:
        return [b.strip()[:30] for b in v if b and b.strip()]


class 해지요청(BaseModel):
    endpoint: str = Field(..., max_length=1000)


@router.get("/key")
def push_key():
    """브라우저가 구독할 때 쓰는 공개키(applicationServerKey). 로그인 없이 — 공개키다"""
    try:
        return {"public_key": push_service.공개키()}
    except Exception:
        raise HTTPException(503, "푸시 열쇠를 준비하지 못했어요")


@router.post("/subscribe")
@limiter.limit("20/minute")
def push_subscribe(request: Request, body: 구독요청, db: Session = Depends(get_db), me=Depends(require_user)):
    줄 = push_service.구독하기(db, me.id, body.endpoint, body.keys.p256dh, body.keys.auth,
                            ipo=body.ipo, 증권사=body.brokers)
    return {"ok": True, "ipo": 줄.ipo, "brokers": [b for b in (줄.brokers or "").split(",") if b]}


@router.post("/unsubscribe")
@limiter.limit("20/minute")
def push_unsubscribe(request: Request, body: 해지요청, db: Session = Depends(get_db), me=Depends(require_user)):
    return {"ok": push_service.해지하기(db, me.id, body.endpoint)}


@router.post("/test")
@limiter.limit("5/minute")
async def push_test(request: Request, db: Session = Depends(get_db), me=Depends(require_user)):
    """켜 둔 기기 모두에 시험 알림 — 푸시 서버를 기다리는 일이라 이벤트 루프 밖에서"""
    결과 = await asyncio.get_running_loop().run_in_executor(None, push_service.시험_보내기, db, me.id)
    if not 결과["devices"]:
        raise HTTPException(404, "이 계정에 알림을 켠 기기가 없어요")
    return 결과
