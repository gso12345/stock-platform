"""브라우저에서 터진 것을 받아 둔다.

서버 오류는 이제 남는다(app/core/errors.py). 그런데 사용자가 겪는 고장의
절반은 브라우저에서 난다 — 화면이 흰 채로 멈추거나, 눌러도 아무 일이
안 일어나거나. 그건 서버 로그 어디에도 안 남는다.

오늘까지 그런 것을 전부 사용자 제보로 알았다. 이 자리가 그 역할을
대신한다.

받는 쪽을 열어 두는 것이라 조심할 것이 둘 있다.
  · 아무나 부를 수 있다 → 분당 상한을 둔다. 안 그러면 이 자리로
    0.15 CPU 서버를 멈춰 세울 수 있다.
  · 본문이 길 수 있다 → 길이를 자른다. 스택 전체를 그대로 받으면
    한 건에 수십 KB 다.
"""
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core import errors

router = APIRouter(prefix="/client-errors", tags=["오류"])
limiter = Limiter(key_func=get_remote_address)


class 화면오류(BaseModel):
    무엇:   str = Field(default="Error", max_length=200)
    자세히: str = Field(default="",      max_length=4000)
    어디서: str = Field(default="",      max_length=500)


@router.post("")
@limiter.limit("20/minute")
async def 받기(request: Request, 본문: 화면오류):
    """화면에서 보내온 오류 하나.

    답으로 아무것도 안 준다. 보내는 쪽은 답을 기다리지 않고,
    여기서 무슨 일이 있었는지 알려 줄 이유도 없다."""
    errors.화면오류_남기기(본문.무엇, 본문.자세히, 본문.어디서)
    return {"ok": True}
