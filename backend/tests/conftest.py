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
