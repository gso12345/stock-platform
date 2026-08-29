"""CORS 가 라우터를 따라가는가.

── 왜 검사가 필요한가 ──

PATCH 가 allow_methods 에서 빠져 있었다. 그래서 시세 알림 켜고 끄기가
브라우저의 preflight 에서 막혀 **서버 코드에 닿지도 못했다.** 지우기
(DELETE)는 되는데 켜고 끄기만 안 되던 이유다. 관리자 화면의 PATCH
아홉 개도 같이 막혀 있었다.

조용히 망가지는 방식이 나빴다.

  · 서버 로그에 아무것도 안 남는다 — 요청이 오지도 않는다
  · 라우트는 멀쩡히 등록돼 있고, 검사도 함수를 직접 부르면 통과한다
  · 화면은 낙관 갱신으로 먼저 바꿔 놓고 실패를 받아 되돌리므로,
    사용자에게는 '눌러도 아무 일이 없다' 로만 보인다

새 메서드를 쓰는 라우트를 넣는 사람이 이 목록을 같이 고칠 거라고
믿을 수 없다. 라우터를 훑어서 자동으로 맞춰 본다.
"""
import re
import pathlib

import pytest


def _라우터가_쓰는_메서드() -> set:
    """소스에서 @router.get/post/... 를 모아 본다."""
    뿌리 = pathlib.Path(__file__).resolve().parent.parent / "app"
    쓰는것 = set()
    for f in 뿌리.rglob("*.py"):
        본문 = f.read_text(encoding="utf-8")
        for m in re.finditer(r"@\w+\.(get|post|put|patch|delete|head|options)\(", 본문):
            쓰는것.add(m.group(1).upper())
    return 쓰는것


def _허용한_메서드() -> set:
    from app.main import app
    from fastapi.middleware.cors import CORSMiddleware

    for mw in app.user_middleware:
        if mw.cls is CORSMiddleware:
            옵션 = getattr(mw, "kwargs", None) or getattr(mw, "options", {})
            return {m.upper() for m in 옵션.get("allow_methods", [])}
    pytest.fail("CORS 미들웨어를 못 찾았다")


def test_라우터가_쓰는_메서드는_전부_허용된다():
    """빠지면 그 라우트는 브라우저에서 **아예 못 부른다.**

    서버·검사에서는 멀쩡히 보이므로 배포하고 나서야 안다.
    """
    쓰는것 = _라우터가_쓰는_메서드()
    허용 = _허용한_메서드()
    빠진것 = 쓰는것 - 허용
    assert not 빠진것, (
        f"라우터는 {sorted(쓰는것)} 를 쓰는데 CORS 는 {sorted(허용)} 만 허용합니다. "
        f"빠진 것: {sorted(빠진것)} — 그 라우트는 브라우저에서 못 부릅니다."
    )


def test_PATCH_가_들어_있다():
    """이번에 실제로 빠졌던 것. 이름을 박아 둔다 — 위 검사는 라우터에
    PATCH 라우트가 하나도 없어지면 조용히 통과한다."""
    assert "PATCH" in _허용한_메서드()


def test_시세알림_켜고끄기가_브라우저에서_불린다():
    """preflight 를 실제로 쳐 본다.

    소스를 읽는 것만으로는 부족하다 — 미들웨어 순서나 origin 설정
    때문에 막히는 경우도 있다.
    """
    from fastapi.testclient import TestClient
    from app.main import app

    c = TestClient(app)
    r = c.options(
        "/api/v1/alerts/1",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert r.status_code < 400, f"preflight 가 막혔다: {r.status_code} {r.text[:200]}"
    허용 = r.headers.get("access-control-allow-methods", "")
    assert "PATCH" in 허용.upper(), f"허용 목록에 PATCH 가 없다: {허용!r}"


@pytest.mark.parametrize("메서드", ["GET", "POST", "PUT", "PATCH", "DELETE"])
def test_흔히_쓰는_메서드가_다_열려_있다(메서드):
    from fastapi.testclient import TestClient
    from app.main import app

    c = TestClient(app)
    r = c.options(
        "/api/v1/alerts/1",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": 메서드,
        },
    )
    assert r.status_code < 400, f"{메서드} preflight 실패: {r.status_code}"
