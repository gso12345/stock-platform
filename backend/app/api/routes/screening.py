from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from typing import Optional
import asyncio
import re
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.database import get_db
from app.models.stock import ScreeningPreset
from app.models.user import User
from app.core.deps import require_user, get_current_user
from app.services.market.yf_service import yf_service, 스크리닝_숫자키, 스크리닝_글자키
from app.services.screening import service as 스크리닝
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


def _칸검사(columns: Optional[list]) -> Optional[list]:
    """보기에 남길 칸 이름들 — 영문 소문자·숫자·밑줄만(화면의 칸 열쇠). 모르는 칸은 화면이 무시한다"""
    if columns is None:
        return None
    for c in columns:
        if not isinstance(c, str) or not re.fullmatch(r"[a-z0-9_]{1,40}", c):
            raise ValueError("칸 이름이 잘못됐어요")
    return columns


class ScreeningRequest(BaseModel):
    market: str = Field("US", pattern="^(KR|US|ETF)$")
    filters: dict = Field(default={}, max_length=20)
    sort_by: str = Field("market_cap", pattern=_SORT_PATTERN)
    sort_order: str = Field("desc", pattern="^(asc|desc)$")
    limit: int = Field(50, ge=1, le=100)
    #: 몇 번째 줄부터 — 상장된 모든 종목이라 결과가 수천 곳이다. 화면이 한 쪽(50곳)씩 넘긴다
    offset: int = Field(0, ge=0, le=50000)
    #: 티커·이름으로 찾기 — 'AAPL, MSFT' 처럼 쉼표로 여럿
    q: str = Field("", max_length=100)

    _조건 = field_validator("filters")(classmethod(lambda cls, v: _조건검사(v)))


class PresetSaveRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    market: str = Field(..., pattern="^(KR|US|ETF)$")
    filters: dict = Field(default={}, max_length=20)
    sort_by: str = Field(..., pattern=_SORT_PATTERN)
    sort_order: str = Field("desc", pattern="^(asc|desc)$")
    #: 보기 저장 — 보이는 칸들도 같이 남긴다(예전 보기는 없다 → 화면 기본 칸)
    columns: Optional[list] = Field(None, max_length=60)

    _조건 = field_validator("filters")(classmethod(lambda cls, v: _조건검사(v)))
    _칸 = field_validator("columns")(classmethod(lambda cls, v: _칸검사(v)))


class 종목하나(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$")
    market: str = Field(..., pattern="^(KR|US|ETF)$")


class 줄요청(BaseModel):
    items: list[종목하나] = Field(..., max_length=200)


#: 관심종목 PC 표가 붙이는 칸 — 넓은 화면에서 이름과 가격 사이 빈자리를 채운다
관심칸 = ("market_cap", "per", "forward_per", "pbr", "dividend_yield", "pct_from_52w_high", "return_1m",
         "return_1y", "sector", "industry", "currency")


@router.post("/rows")
@limiter.limit("60/minute")
async def screening_rows(request: Request, req: 줄요청):
    """종목 몇 개의 스크리닝 표 줄(시가총액·PER·배당·52주 위치·수익률) — 관심종목 PC 표가 쓴다.
    표가 아직 없으면 그 종목은 빠진다(표는 뒤에서 만든다 — 다음에 물으면 온다)"""
    out: dict[str, dict] = {}
    for it in req.items:
        줄 = 스크리닝.한종목(it.market, it.symbol)
        if 줄:
            out[f"{it.market}:{it.symbol}"] = {k: 줄[k] for k in 관심칸 if k in 줄}
    return {"rows": out}


@router.post("/run")
# 화면이 칸 제목을 누를 때마다·찾는 말이 바뀔 때마다 곧바로 다시 묻는다(예전엔 '실행' 단추를 눌러야 했다).
# 10번이면 칸 몇 개 눌러 보다 막힌다. 한 번은 들고 있는 시장 표를 거르고 세울 뿐이라 가볍다
@limiter.limit("40/minute")
async def run_screening(request: Request, req: ScreeningRequest):
    ck = (f"screening:{req.market}:{req.sort_by}:{req.sort_order}:{sorted(req.filters.items())}:"
          f"{req.q}:{req.offset}:{req.limit}")
    if cached := cache.get(ck):
        return cached
    loop = asyncio.get_running_loop()
    # 상장된 모든 종목의 표(services/screening) — 표가 없을 때만 그 자리에서 만든다
    표 = await loop.run_in_executor(None, 스크리닝.표, req.market)
    # 전 종목 기초 줄이 있으면 종목별 야후 줄을 처음 받는 중이어도 표는 이미 쓸 만하다 —
    # 그때 '받는 중' 이라고 알리면 화면이 3초마다 다시 묻는다
    짓는중 = yf_service.스크리닝_짓는중(req.market) if not 표.기초수 else None
    results, total = 표.결과(req.filters, req.q, req.sort_by, req.sort_order == "desc", req.offset, req.limit)
    payload = {
        "results": results, "total": total, "offset": req.offset,
        # 국가·섹터·산업·거래소 고르기 — 거르기 전 시장 전체에서
        "facets": 표.고를값들(),
        #: 표가 비어 종목별 야후 줄을 처음 짓는 중이면 {"done", "total"} — 화면은 받은 줄부터 보여 주고 곧 다시 묻는다
        "building": 짓는중,
        #: 표가 비었는데 야후에서 한 줄도 못 받았다 — 화면이 '맞는 종목이 없어요' 와 갈라 알린다
        "failed": not len(표) and 짓는중 is None and yf_service.스크리닝_못받음(req.market),
        #: 시세가 언제 것인가(유닉스 초) — 가격은 5분마다 묶음 시세로 새로 받는다
        "as_of": yf_service.스크리닝_찍은때(req.market),
    }
    # 받는 중이거나 못 받은 답은 남겨 두지 않는다 — 남기면 다 받은 뒤에도 그 답이 나간다. 원천이 새로 와
    # 뒤에서 표를 새로 만드는 동안 옛 표로 낸 답도 — 남기면 새 표가 1분 더 늦게(원천이 오고 2분 뒤에야) 보였다.
    # 남겨도 1분만 — 가격을 5분마다 새로 받는데 답을 5분 남기면 10분 전 시세가 나간다
    if 짓는중 is None and not payload["failed"] and 스크리닝.지금_표인가(req.market, 표):
        cache.set(ck, payload, 60)
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
        sort_by=req.sort_by, sort_order=req.sort_order, columns=req.columns,
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
