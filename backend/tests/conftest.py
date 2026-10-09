"""검사 사이에 남는 것을 치운다.

캐시는 한 프로세스에 하나뿐이라 검사끼리 그대로 물려받는다. 대개는
검사 파일마다 자기가 쓴 열쇠를 지워서 넘어갔는데, '빈손 표시'
(`{열쇠}:miss`) 가 생기면서 그 방식이 무너졌다.

빈손 표시는 원래 열쇠와 이름이 다르다. 그래서 `cache.delete("fund:005930")`
로 치운 검사도 `fund:005930:miss` 는 그대로 남긴다. 다음 검사는 조회가
곧장 빈손으로 돌아오는 것을 보고 엉뚱한 데서 원인을 찾게 된다 —
단독으로 돌리면 통과하고 전체로 돌리면 깨진다.

그래서 여기서 한 번에 치운다. 검사 파일마다 열쇠 이름을 외우게 하는
것보다 낫다.
"""
import pytest


#: 아래 두 가지는 monkeypatch 를 빌리지 않고 직접 바꾸고 되돌린다. 모든
#: 검사에 붙는(autouse) 것이 monkeypatch 를 받으면, monkeypatch 가 검사의
#: 다른 준비물보다 먼저 서고 나중에 치워진다 — 그러면 검사가 가짜로 바꿔 둔
#: 함수가 다른 준비물의 뒷정리 때까지 살아 있어 엉뚱한 데서 터진다
#: (test_본인탈퇴 의 '중간에 터짐' 이 뒷정리의 회원 지우기에서 터졌다).


@pytest.fixture(autouse=True)
def _해외순위_사진_끄기():
    """해외 순위 사진(DB 에 남기는 마지막 순위)을 검사에서는 끈다.

    켜 두면 순위를 만드는 검사마다 가짜 종목(T0, T1 …)으로 만든 순위를
    검사용 DB 파일(stockplatform.db)에 써 두고, 다음 검사(다음 실행까지)가
    그것을 캐시에 깐다 — 단독으로는 통과하고 전체로 돌리면 깨진다.
    사진을 보는 검사(test_해외순위_살리기)는 임시 DB 로 직접 켠다."""
    try:
        from app.services import ranking_service as rs
    except Exception:
        yield
        return
    원래 = (rs._사진_불러옴, rs._순위사진_남기기)
    rs._사진_불러옴 = True
    rs._순위사진_남기기 = lambda 모두: None
    yield
    rs._사진_불러옴, rs._순위사진_남기기 = 원래


@pytest.fixture(autouse=True)
def _야후_쉼_풀기():
    """야후 시세 길의 '쉬는 중' 표시를 검사마다 새로 시작한다.

    한 검사에서 인증 배치나 spark 가 막혀(이 환경은 바깥으로 못 나간다)
    몇 분 쉬기로 하면, 그 뒤 검사들이 가짜로 바꿔 둔 길까지 건너뛴다."""
    def 풀기():
        try:
            from app.services import price_fetcher as pf
            pf._인증_막힌때 = 0.0
            pf._spark_막힌때 = 0.0
            pf._spark_판 = "v7"
        except Exception:
            pass
    풀기()
    yield
    풀기()


@pytest.fixture(autouse=True)
def _빈손표시_치우기():
    """검사 하나가 끝날 때마다 빈손 표시와 '받는 중' 자국을 지운다."""
    yield
    try:
        from app.core import fetchcache
        from app.core.cache import cache

        fetchcache.잊기()                     # 받는 중 표시
        for 항목 in cache.keys_with_ttl():
            열쇠 = 항목.get("key") if isinstance(항목, dict) else 항목
            if isinstance(열쇠, str) and 열쇠.endswith(":miss"):
                cache.delete(열쇠)
    except Exception:
        pass
