"""
뉴스 응답을 만드는 규칙 — 정렬·이미지 필터·내부 필드 제거.

이 세 가지는 서로 얽혀 있어서 한쪽을 고치면 다른 쪽이 조용히 깨진다.
실제로 인기도 점수를 응답에서 빼면서 그 값으로 정렬하던 화면이 동작을 멈춘 적이
있는데, 오류가 나지 않아 알아채기 어려웠다.
"""
import asyncio
import pytest

from app.core.cache import cache
from app.api.routes.dashboard import _news_tab
from app.api.routes.stocks.news import _sort_and_clean_news


def article(title, *, image=None, ts=0, score=0):
    return {
        "title": title,
        "link": f"https://news.example.com/{title}",
        "image": image,
        "source": "언론사",
        "published": "07/26 12:00",
        "published_ts": ts,
        "summary": "요약",
        "_ts": ts,
        "_trend_score": score,
    }


# 최신순과 인기순이 서로 반대가 되도록 구성 — 정렬이 실제로 동작하는지 구분된다
ARTICLES = [
    article("오래됐지만 인기많음", image="https://i/1.jpg", ts=100, score=99),
    article("최신이지만 인기없음", image="https://i/2.jpg", ts=300, score=1),
    article("중간",               image=None,              ts=200, score=50),
]


@pytest.fixture
def 뉴스캐시():
    cache.set("news:kr", list(ARTICLES), 300)
    yield
    cache.set("news:kr", [], 1)


def 제목들(items):
    return [a["title"] for a in items]


def 내부필드(items):
    return [k for a in items for k in a if k.startswith("_")]


class Test뉴스탭:
    def test_최신순은_발행시각_역순이다(self, 뉴스캐시):
        r = asyncio.run(_news_tab("kr", "latest", images_only=False))
        assert 제목들(r) == ["최신이지만 인기없음", "중간", "오래됐지만 인기많음"]

    def test_인기순은_점수_역순이다(self, 뉴스캐시):
        r = asyncio.run(_news_tab("kr", "popular", images_only=False))
        assert 제목들(r) == ["오래됐지만 인기많음", "중간", "최신이지만 인기없음"]

    def test_이미지_필터를_켜면_이미지_있는_기사만_남는다(self, 뉴스캐시):
        r = asyncio.run(_news_tab("kr", "latest", images_only=True))
        assert 제목들(r) == ["최신이지만 인기없음", "오래됐지만 인기많음"]
        assert all(a["image"] for a in r)

    def test_이미지_필터와_인기순이_함께_동작한다(self, 뉴스캐시):
        r = asyncio.run(_news_tab("kr", "popular", images_only=True))
        assert 제목들(r) == ["오래됐지만 인기많음", "최신이지만 인기없음"]

    def test_내부_계산값은_응답에_실리지_않는다(self, 뉴스캐시):
        # _trend_score가 나가면 인기순 산식이 노출된다
        for sort in ("latest", "popular"):
            r = asyncio.run(_news_tab("kr", sort, images_only=False))
            assert 내부필드(r) == [], f"{sort}에서 내부 필드가 노출됐다"

    def test_화면에_필요한_필드는_그대로_남는다(self, 뉴스캐시):
        r = asyncio.run(_news_tab("kr", "latest", images_only=False))
        assert {"title", "link", "source", "published", "summary"} <= set(r[0])

    def test_캐시가_비어도_터지지_않는다(self):
        cache.set("news:kr", [], 300)
        r = asyncio.run(_news_tab("kr", "latest", images_only=True))
        assert r == []


class Test종목상세뉴스:
    def test_최신순_인기순이_다르게_정렬된다(self):
        items = [
            article("A", ts=1, score=9),
            article("B", ts=9, score=1),
        ]
        # published_ts 기준이므로 문자열이 아닌 숫자 비교가 되도록 맞춘다
        latest = _sort_and_clean_news(items, "latest")
        popular = _sort_and_clean_news(items, "popular")
        assert 제목들(latest) == ["B", "A"]
        assert 제목들(popular) == ["A", "B"]

    def test_내부_계산값은_제거된다(self):
        r = _sort_and_clean_news([article("A", ts=1, score=5)], "popular")
        assert 내부필드(r) == []

    @pytest.mark.parametrize("items", [None, []])
    def test_빈_입력도_안전하다(self, items):
        assert _sort_and_clean_news(items, "latest") == []
