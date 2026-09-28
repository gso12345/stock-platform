"""DB 연결이 잠깐 끊긴 것은 503 — 코드 고장(500)과 가른다.

배포 직후 관리자 통계·피드처럼 서로 무관한 조회가 같은 초에 한꺼번에
OperationalError 로 떨어졌다. 연결 문제다. 500 '처리 못 함' 은 고장으로
읽히고, 503 '잠시 후 다시' 가 맞는 답이다.
"""
import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.main import app, _DB연결문제
from app.core import errors

_r = APIRouter()


@_r.get("/__test/db-끊김")
def _끊김():
    raise OperationalError("SELECT 1", {}, Exception("server closed the connection unexpectedly"))


@_r.get("/__test/쿼리-틀림")
def _틀림():
    raise ProgrammingError("SELEC 1", {}, Exception("syntax error"))


app.include_router(_r)


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def test_연결이_끊기면_503과_다시_시도_안내(client):
    errors.비우기()
    r = client.get("/__test/db-끊김")
    assert r.status_code == 503
    assert "다시 시도" in r.json()["detail"]
    #: 그래도 기록은 남긴다 — 자주 나면 원인을 찾아야 한다
    assert any(e["무엇"] == "OperationalError" for e in errors.목록())


def test_쿼리가_틀린_것은_그대로_500(client):
    assert client.get("/__test/쿼리-틀림").status_code == 500


def test_판별():
    assert _DB연결문제(OperationalError("x", {}, Exception("y")))
    assert not _DB연결문제(ProgrammingError("x", {}, Exception("y")))
    assert not _DB연결문제(ValueError("x"))


def test_연결_풀은_작게_잡는다():
    """배포 때 두 서버가 겹쳐도 Supabase 한도를 넘지 않게"""
    import inspect
    from app.db import database
    src = inspect.getsource(database)
    assert '"DB_POOL_SIZE", 5' in src and '"DB_MAX_OVERFLOW", 5' in src
