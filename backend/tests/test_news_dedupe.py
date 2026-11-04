"""
같은 기사는 한 번만 — 국내·미국을 오가면 뉴스가 섞이던 오류(사용자 사진: 미국 증시 뉴스 맨 위에 국내 기사 둘이
두 번씩)의 서버 쪽 뿌리.

피드 한 곳이 같은 기사를 두 번 싣는 일이 있는데, 새로 받은 기사끼리는 안 걸렀다(지난 기사와 새 기사 사이만
걸렀다). 화면은 기사 주소를 이름표로 써서 겹친 이름표가 목록을 바꿀 때 앞 목록의 기사를 남겼고, 같은 기사가 두
번이면 인기순 점수도 부풀어 그 기사가 맨 위로 올라갔다.
"""
import asyncio

import pytest

from app.core.cache import cache
from app.services import news_service as ns
from app.api.routes.dashboard import _news_tab


def 기사(title, link, *, source="이투데이", ts=100, image="https://img.example.com/a.jpg"):
    return {"title": title, "link": link, "source": source, "image": image,
            "published": "11/04 09:00", "published_ts": ts, "summary": "요약", "_ts": ts}


class Test같은기사빼기:
    def test_주소가_같으면_처음_것만(self):
        r = ns.같은기사빼기([기사("가", "https://x/1", ts=3), 기사("가 고침", "https://x/1", ts=2),
                           기사("나", "https://x/2", ts=1)])
        assert [a["title"] for a in r] == ["가", "나"]

    def test_같은_언론사의_같은_제목은_주소_꼬리가_달라도_하나(self):
        r = ns.같은기사빼기([기사("홍콩 ELS 제재", "https://x/1?ref=rss"), 기사("홍콩 ELS 제재", "https://x/1")])
        assert len(r) == 1 and r[0]["link"] == "https://x/1?ref=rss"

    def test_언론사가_다르면_제목이_같아도_남긴다(self):
        # 통신사 기사를 여러 곳이 받아 쓴 것은 출처가 다른 기사다
        r = ns.같은기사빼기([기사("금리 동결", "https://a/1", source="연합뉴스"),
                           기사("금리 동결", "https://b/1", source="뉴시스")])
        assert len(r) == 2

    def test_순서는_그대로(self):
        r = ns.같은기사빼기([기사("셋", "https://x/3"), 기사("하나", "https://x/1"), 기사("둘", "https://x/2"),
                           기사("하나", "https://x/1")])
        assert [a["title"] for a in r] == ["셋", "하나", "둘"]

    @pytest.mark.parametrize("빈것", [None, []])
    def test_빈_목록도_안전하다(self, 빈것):
        assert ns.같은기사빼기(빈것) == []

    def test_주소가_없는_기사는_제목으로만_본다(self):
        r = ns.같은기사빼기([기사("가", ""), 기사("가", None), 기사("나", "")])
        assert [a["title"] for a in r] == ["가", "나"]

    def test_주소_앞뒤_공백은_같은_주소다(self):
        r = ns.같은기사빼기([기사("가", "https://x/1", source="A"), 기사("나", " https://x/1\n", source="B")])
        assert [a["title"] for a in r] == ["가"]

    def test_제목이_빈_기사끼리는_제목으로_묶지_않는다(self):
        # 빈 제목 둘을 '같은 제목' 으로 보면 주소가 다른 기사가 사라진다
        r = ns.같은기사빼기([기사("", "https://x/1"), 기사("", "https://x/2")])
        assert len(r) == 2


@pytest.fixture
def 시험열쇠():
    ck = "news:시험_같은기사"
    cache.set(ck, [], 1)
    yield ck
    cache.set(ck, [], 1)
    ns._refreshing.pop(ck, None)


class Test모을때_뺀다:
    def test_새로_받은_기사끼리도_같은_것을_뺀다(self, 시험열쇠, monkeypatch):
        받은것 = [기사("홍콩 ELS 제재", "https://kr/1", ts=50), 기사("코스피 급락에도 식품주", "https://kr/2", ts=40),
                 기사("홍콩 ELS 제재", "https://kr/1", ts=50), 기사("코스피 급락에도 식품주", "https://kr/2", ts=40),
                 기사("셋째", "https://kr/3", ts=30)]
        monkeypatch.setattr(ns, "_fetch_all_feeds", lambda *a, **k: [dict(x) for x in 받은것])
        결과 = ns._do_refresh_news(시험열쇠, ns.KR_FEEDS, 5, 100)
        assert [a["link"] for a in 결과] == ["https://kr/1", "https://kr/2", "https://kr/3"]
        담은것 = cache.get(시험열쇠)
        assert len({a["link"] for a in 담은것}) == len(담은것) == 3

    def test_같은_기사의_최신_것이_남는다(self, 시험열쇠, monkeypatch):
        # 같은 언론사·같은 제목을 주소만 바꿔 다시 실었으면 나중 것(최신)을 남긴다
        monkeypatch.setattr(ns, "_fetch_all_feeds", lambda *a, **k: [
            기사("고친 기사", "https://kr/old", ts=10), 기사("고친 기사", "https://kr/new", ts=20)])
        결과 = ns._do_refresh_news(시험열쇠, ns.KR_FEEDS, 5, 100)
        assert [a["link"] for a in 결과] == ["https://kr/new"]

    def test_겹친_기사가_인기순_점수를_부풀리지_않는다(self, 시험열쇠, monkeypatch):
        받은것 = [기사("엔비디아 실적 급등", "https://us/1", ts=5), 기사("엔비디아 실적 급등", "https://us/1", ts=5),
                 기사("엔비디아 신고가", "https://us/2", ts=4), 기사("금리 동결 발표", "https://us/3", ts=3),
                 기사("금리 인상 우려", "https://us/4", ts=2), 기사("환율 급락", "https://us/5", ts=1)]
        monkeypatch.setattr(ns, "_fetch_all_feeds", lambda *a, **k: [dict(x) for x in 받은것])
        ns._do_refresh_news(시험열쇠, ns.US_FEEDS, 5, 100)
        담은것 = {a["link"]: a for a in cache.get(시험열쇠)}
        # 같은 것을 뺀 목록으로 매긴 점수와 같아야 한다 — 두 번 센 점수가 아니라
        기대 = {a["link"]: a for a in ns._add_trending_score(
            [dict(x) for x in ns.같은기사빼기(받은것)])}
        assert {k: v["_trend_score"] for k, v in 담은것.items()} == \
               {k: v["_trend_score"] for k, v in 기대.items()}

    def test_지난_기사와_새_기사_사이도_같은_제목은_하나(self, 시험열쇠, monkeypatch):
        cache.set(시험열쇠, [기사("어제 기사", "https://kr/a?x=1", ts=5)], 1)
        cache._store.pop(시험열쇠, None)          # 지난 값(stale)으로만 남긴다
        monkeypatch.setattr(ns, "_fetch_all_feeds", lambda *a, **k: [기사("어제 기사", "https://kr/a", ts=6)])
        결과 = ns._do_refresh_news(시험열쇠, ns.KR_FEEDS, 5, 100)
        assert [a["link"] for a in 결과] == ["https://kr/a"]


class Test뉴스탭도_뺀다:
    def test_담아_둔_목록에_겹친_것이_있어도_한_번만_보낸다(self):
        cache.set("news:us", [기사("Fed holds", "https://us/1", source="CNBC", ts=3),
                              기사("Fed holds", "https://us/1", source="CNBC", ts=3),
                              기사("Car subscriptions", "https://us/2", source="Fortune", ts=2)], 300)
        try:
            for 정렬 in ("latest", "popular"):
                r = asyncio.run(_news_tab("us", 정렬, images_only=True))
                assert [a["link"] for a in r] == ["https://us/1", "https://us/2"]
        finally:
            cache.set("news:us", [], 1)
