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


def 이름찾기(줄들: list, q: str) -> list:
    """티커나 이름에 찾는 말이 든 줄만. 쉼표로 여럿이면 그중 하나라도('AAPL, MSFT').
    띄어쓰기·대소문자는 가리지 않는다('bank of' → Bank of America)."""
    말들 = [m for m in (re.sub(r"\s+", "", 조각).lower() for 조각 in re.split(r"[,，]", q or "")) if m]
    if not 말들:
        return 줄들

    def 맞나(r: dict) -> bool:
        글 = (str(r.get("symbol") or "") + "|" + re.sub(r"\s+", "", str(r.get("name") or ""))).lower()
        return any(m in 글 for m in 말들)
    return [r for r in 줄들 if 맞나(r)]


def 고를값들(줄들: list) -> dict:
    """국가·섹터·산업 조건에 내놓을 값들 — 그 시장 전체에 실제로 있는 것만, 가나다(ABC)순"""
    return {k: sorted({r[k] for r in 줄들 if isinstance(r.get(k), str) and r[k]})
            for k in ("country", "sector", "industry")}


def 줄세우기(results: list, sort_by: str, desc: bool) -> list:
    """값 없는 종목은 오름·내림 어느 쪽이든 **맨 뒤로.** 예전엔 없는 값을 0 으로
    쳐서, PER 낮은 순으로 세우면 PER 모르는 적자 기업들이 1등부터 깔렸다."""
    있음 = [r for r in results if r.get(sort_by) is not None]
    없음 = [r for r in results if r.get(sort_by) is None]
    return sorted(있음, key=lambda r: r[sort_by], reverse=desc) + 없음


@router.post("/run")
# 화면이 칸 제목을 누를 때마다·찾는 말이 바뀔 때마다 곧바로 다시 묻는다(예전엔 '실행' 단추를 눌러야 했다).
# 10번이면 칸 몇 개 눌러 보다 막힌다. 한 번은 받아 둔 시장 사진을 거르고 세울 뿐이라 가볍다
@limiter.limit("40/minute")
async def run_screening(request: Request, req: ScreeningRequest):
    ck = f"screening:{req.market}:{req.sort_by}:{req.sort_order}:{sorted(req.filters.items())}:{req.q}:{req.limit}"
    if cached := cache.get(ck):
        return cached
    loop = asyncio.get_running_loop()
    # 시장 전체는 한 번만 꺼낸다 — 사진이 없으면 짓는 동안 잠깐 기다리는데, 두 번 꺼내면 두 번 기다린다
    전체 = await loop.run_in_executor(None, yf_service.스크리닝_전체, req.market)
    짓는중 = yf_service.스크리닝_짓는중(req.market)
    results = [r for r in 전체 if yf_service._apply_filters(r, req.filters)]
    results = 줄세우기(이름찾기(results, req.q), req.sort_by, req.sort_order == "desc")
    payload = {
        "results": results[: req.limit], "total": len(results),
        # 국가·섹터·산업 고르기 — 거르기 전 시장 전체에서
        "facets": 고를값들(전체),
        #: 사진이 없어 처음 짓는 중이면 {"done", "total"} — 화면은 받은 줄부터 보여 주고 곧 다시 묻는다
        "building": 짓는중,
        #: 사진도 없는데 야후에서 한 줄도 못 받았다 — 화면이 '맞는 종목이 없어요' 와 갈라 알린다
        "failed": not 전체 and 짓는중 is None and yf_service.스크리닝_못받음(req.market),
        #: 시세가 언제 것인가(유닉스 초) — 가격은 5분마다 묶음 시세로 새로 받는다
        "as_of": yf_service.스크리닝_찍은때(req.market),
    }
    # 받는 중이거나 못 받은 답은 남겨 두지 않는다 — 남기면 다 받은 뒤에도 그 답이 나간다.
    # 남겨도 1분만 — 가격을 5분마다 새로 받는데 답을 5분 남기면 10분 전 시세가 나간다
    if 짓는중 is None and not payload["failed"]:
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
