"""
사용자 보고: "대시보드 순위가 정확하지도 않고 느려"

재 보니 이랬다.

국내
  · 거래대금 순위를 '거래량 상위 100' 안에서만 다시 줄 세웠다. 주가가 높은
    대형주(SK하이닉스 같은)는 거래대금 1·2위권인데도 후보에 없었다.
  · 그 거래대금 순위는 처음 한 번 만든 것이 **계속** 나갔다. 스케줄러는 네
    가지만 새로 받았고, 만료되면 KIS(최대 6초)를 거쳐 다시 지난 것을 줬다.
  · KIS 순위는 20위까지뿐이었고 거래량·거래대금도 시가총액 주소로 물었다.
  · 시가총액 페이지에는 '액면가' 칸이 끼어 있어, 칸 위치로 읽으면 거래량
    자리에서 외국인비율을 읽는다.
  · 시가총액 순위의 가격을 지난 값(몇 시간·며칠 전)으로 덮었다.

해외
  · 장이 열려 있는 동안 전종목 훑기가 안 돌아, 인기·S&P500 을 뺀 종목은 전날
    마감 값이었다 — 상승률 순위에 어제 오른 종목이 섞였다.
  · 정렬해 둔 순위가 만료돼도 지난 것을 계속 꺼내 줘서 장중 내내 멈춰 있었다.
"""
import asyncio
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.core.cache import cache
from app.services import ranking_service as rs

뉴욕 = ZoneInfo("America/New_York")


@pytest.fixture(autouse=True)
def _비우기():
    for c in rs.ALLOWED_CATEGORIES:
        cache.delete(f"rank:kr:{c}")
        cache.delete(f"rank:us:{c}")
    cache.delete("rank:kr:_rows")
    cache.delete(rs.US_ROWS_CK)
    rs._국내갱신 = None
    rs._국내갱신_실패 = 0.0
    yield
    rs._국내갱신 = None
    rs._국내갱신_실패 = 0.0


# ── 네이버 시세표를 칸 이름으로 읽는다 ──────────────────────────
def _표(머리: list[str], 줄들: list[list[str]], 앞칸: bool = False) -> str:
    th = "".join(f"<th>{h}</th>" for h in 머리)
    본문 = ""
    for 코드, 이름, *값 in 줄들:
        앞 = '<td><input type="checkbox"></td>' if 앞칸 else ""
        본문 += (f"<tr>{앞}<td>1</td><td><a href=\"/item/main.naver?code={코드}\">{이름}</a></td>"
                 + "".join(f"<td>{v}</td>" for v in 값) + "</tr>")
    return f'<table class="type_2"><thead><tr>{th}</tr></thead><tbody>{본문}</tbody></table>'


시총머리 = ["N", "종목명", "현재가", "전일비", "등락률", "액면가", "시가총액",
           "상장주식수", "외국인비율", "거래량", "PER", "ROE", "토론실"]
상승머리 = ["N", "종목명", "현재가", "전일비", "등락률", "거래량", "매수호가",
           "매도호가", "매수총잔량", "매도총잔량", "PER", "ROE"]


class Test칸_이름으로_읽는다:
    def test_시가총액_페이지에서_액면가와_외국인비율을_잘못_읽지_않는다(self):
        html = _표(시총머리, [["005930", "삼성전자", "71,000", "500", "+0.71%", "100",
                               "4,238,560", "5,969,783", "55.40", "10,123,456", "15.2", "8.4", ""]])
        줄 = rs._시세표_읽기(html, 0, has_market_cap=True)[0]
        assert 줄["volume"] == 10_123_456, "거래량 자리에서 외국인비율을 읽었다"
        assert 줄["market_cap"] == 4_238_560 * 10**8, "시가총액 자리에서 액면가를 읽었다"
        assert 줄["price"] == 71_000 and 줄["change_rate"] == 0.71

    def test_상승률_페이지에는_시가총액_칸이_없다(self):
        """칸 위치로 읽으면 매수총잔량을 시가총액으로 읽는다"""
        html = _표(상승머리, [["000660", "SK하이닉스", "200,000", "6,000", "+3.09%",
                               "5,000,000", "199,500", "200,000", "1,234", "5,678", "9.1", "20.1"]])
        줄 = rs._시세표_읽기(html, 0, has_market_cap=False)[0]
        assert 줄["volume"] == 5_000_000
        assert 줄["market_cap"] == 0

    def test_줄_앞에_머리줄에_없는_칸이_있어도_맞춰_읽는다(self):
        html = _표(시총머리, [["005930", "삼성전자", "71,000", "500", "+0.71%", "100",
                               "4,238,560", "5,969,783", "55.40", "10,123,456", "15.2", "8.4", ""]],
                  앞칸=True)
        assert rs._시세표_읽기(html, 0, has_market_cap=True)[0]["volume"] == 10_123_456

    def test_머리줄_칸_이름이_바뀌면_머리줄을_버리고_예전_위치로_읽는다(self):
        """'등락률' 이 '등락률(%)' 로 바뀌면 반쯤 맞는 머리줄로 읽게 된다 —
        등락률이 통째로 0 이 되는 식으로 조용히 틀린다."""
        머리 = ["N", "종목명", "현재가", "전일비", "등락률(%)", "시가총액", "상장주식수",
               "외국인비율", "거래량", "PER", "ROE"]
        html = _표(머리, [["005930", "삼성전자", "71,000", "500", "+0.71%", "4,200,000",
                           "5,969,782", "52.10", "12,345,678", "13.2", "8.4"]])
        줄 = rs._시세표_읽기(html, 0, has_market_cap=True)[0]
        assert 줄["change_rate"] == 0.71
        assert 줄["volume"] == 12_345_678 and 줄["market_cap"] == 4_200_000 * 10**8

    def test_머리줄이_없으면_예전_위치로_읽는다(self):
        html = ('<table><tr><td><a href="/item/main.naver?code=005930">삼성전자</a></td>'
                "<td>71,000</td><td>500</td><td>+0.71%</td><td>4,200,000</td><td>5,969,782</td>"
                "<td>52.10</td><td>12,345,678</td><td>13.2</td><td>8.4</td></tr></table>")
        줄 = rs._시세표_읽기(html, 0, has_market_cap=True)[0]
        assert 줄["volume"] == 12_345_678 and 줄["market_cap"] == 4_200_000 * 10**8


# ── 거래대금 ───────────────────────────────────────────────
def _줄(sym, price, volume, rate=1.0, cap=0):
    return {"symbol": sym, "name": sym, "market": "KOSPI", "price": price, "change": 0,
            "change_rate": rate, "volume": volume, "amount": price * volume, "market_cap": cap}


class Test거래대금:
    def test_비싼_대형주가_거래량_상위에_없어도_들어온다(self):
        """거래량 상위는 값싼 종목이 채운다. 예전에는 그 안에서만 줄 세웠다."""
        표 = {
            "시가총액": [_줄("000660.KS", 200_000, 5_000_000)],        # 1조
            "거래량":   [_줄(f"9{i:05d}.KQ", 2_000, 50_000_000 - i) for i in range(100)],  # 1,000억
            "상승률": [], "하락률": [],
        }
        assert rs._거래대금_순위(표)[0]["symbol"] == "000660.KS"

    def test_같은_종목은_한_줄이고_거래량이_큰_쪽을_쓴다(self):
        표 = {"시가총액": [_줄("005930.KS", 70_000, 9_000_000)],
              "거래량": [_줄("005930.KS", 70_000, 10_000_000)]}
        out = rs._거래대금_순위(표)
        assert len(out) == 1 and out[0]["volume"] == 10_000_000
        assert out[0]["amount"] == 70_000 * 10_000_000


# ── 국내 순위 만들기 ─────────────────────────────────────────
def _네이버(monkeypatch, 페이지: dict, 불림: list | None = None):
    async def 가짜(category):
        if 불림 is not None:
            불림.append(category)
        await asyncio.sleep(0)
        return [dict(r) for r in 페이지.get(category, [])]
    monkeypatch.setattr(rs, "fetch_naver_rank", 가짜)
    monkeypatch.setattr(rs, "get_fdr_price", lambda s: {"shares": 1000})


def _페이지(배수: int = 1) -> dict:
    return {
        "시가총액": [_줄("005930.KS", 70_000 * 배수, 9_000_000), _줄("000660.KS", 200_000, 5_000_000)],
        "상승률":   [_줄("111111.KQ", 1_000, 100_000, 29.9), _줄("555555.KQ", 1_500, 1_000, 0.0),
                     _줄("222222.KQ", 2_000, 50_000, 10.0)],
        "하락률":   [_줄("333333.KQ", 1_000, 100_000, -20.0)],
        "거래량":   [_줄("444444.KQ", 500, 90_000_000 * 배수)],
    }


class Test국내_순위를_한꺼번에_만든다:
    def test_일곱_가지를_다_만들고_언제_받은_것인지_적는다(self, monkeypatch):
        _네이버(monkeypatch, _페이지())
        전 = int(time.time())
        assert asyncio.run(rs.refresh_kr_rankings_from_naver())
        for c in ("시가총액", "상승률", "하락률", "거래량", "거래대금", "신고가", "신저가"):
            줄들 = cache.get(f"rank:kr:{c}")
            assert 줄들, f"{c} 를 안 만들었다"
            assert [r["rank"] for r in 줄들] == list(range(1, len(줄들) + 1))
            assert all(r["as_of"] >= 전 for r in 줄들)

    def test_거래대금도_갱신할_때마다_새로_만든다(self, monkeypatch):
        """예전에는 처음 만든 거래대금 순위가 그 뒤로 계속 나갔다."""
        _네이버(monkeypatch, _페이지(1))
        asyncio.run(rs.refresh_kr_rankings_from_naver())
        첫번째 = cache.get("rank:kr:거래대금")[0]["symbol"]
        _네이버(monkeypatch, _페이지(100))            # 삼성전자가 700만원 — 거래대금 1위로
        asyncio.run(rs.refresh_kr_rankings_from_naver())
        assert 첫번째 != cache.get("rank:kr:거래대금")[0]["symbol"] == "005930.KS"

    def test_분류마다_순위_번호가_따로다(self, monkeypatch):
        """같은 종목 줄을 두 분류가 함께 쓰면 번호를 서로 덮어쓴다(신고가는 상승률에서 나온다)"""
        _네이버(monkeypatch, _페이지())
        asyncio.run(rs.refresh_kr_rankings_from_naver())
        # 0% 인 555555 는 신고가에서 빠진다 — 222222 는 상승률 3위, 신고가 2위
        상승 = {r["symbol"]: r["rank"] for r in cache.get("rank:kr:상승률")}
        신고 = {r["symbol"]: r["rank"] for r in cache.get("rank:kr:신고가")}
        assert (상승["222222.KQ"], 신고["222222.KQ"]) == (3, 2)

    def test_동시에_불러도_네이버에는_한_번만_묻는다(self, monkeypatch):
        불림: list = []
        _네이버(monkeypatch, _페이지(), 불림)

        async def 셋이_같이():
            await asyncio.gather(*(rs.refresh_kr_rankings_from_naver() for _ in range(3)))
        asyncio.run(셋이_같이())
        assert sorted(불림) == sorted(rs.NAVER_SISE_PAGES), f"겹쳐 물었다: {불림}"

    def test_네_페이지를_한꺼번에_받는다(self, monkeypatch):
        """차례로 받으면 네 배가 걸린다 — 처음 여는 사람은 그동안 기다린다"""
        async def 느린(category):
            await asyncio.sleep(0.2)
            return [_줄("005930.KS", 70_000, 1)]
        monkeypatch.setattr(rs, "fetch_naver_rank", 느린)
        monkeypatch.setattr(rs, "get_fdr_price", lambda s: {"shares": 1000})
        t = time.perf_counter()
        asyncio.run(rs.refresh_kr_rankings_from_naver())
        assert time.perf_counter() - t < 0.5

    def test_하나도_못_받으면_있던_순위를_지우지_않는다(self, monkeypatch):
        cache.set("rank:kr:시가총액", [{"symbol": "OLD"}], 900)
        _네이버(monkeypatch, {})
        assert asyncio.run(rs.refresh_kr_rankings_from_naver()) is False
        assert cache.get("rank:kr:시가총액") == [{"symbol": "OLD"}]


class Test시가총액_가격:
    def test_묵은_실시간_값으로_가격을_덮지_않는다(self, monkeypatch):
        """예전에는 지난 값(get_stale)까지 꺼내 덮었다 — 1분 전에 받은 가격을
        어제 가격으로 바꾸고, 등락률은 네이버 것 그대로였다."""
        cache.set("price:005930.KS", {"price": 60_000, "change_rate": -5.0}, 1)
        time.sleep(1.1)                                   # 만료 — 지난 값만 남는다
        _네이버(monkeypatch, _페이지())
        asyncio.run(rs.refresh_kr_rankings_from_naver())
        삼성 = next(r for r in cache.get("rank:kr:시가총액") if r["symbol"] == "005930.KS")
        assert 삼성["price"] == 70_000 and 삼성["change_rate"] == 1.0
        cache.delete("price:005930.KS")

    def test_신선한_실시간_값이면_가격과_등락을_같이_쓴다(self, monkeypatch):
        cache.set("price:005930.KS", {"price": 72_000, "change": 2_000, "change_rate": 2.86}, 60)
        _네이버(monkeypatch, _페이지())
        asyncio.run(rs.refresh_kr_rankings_from_naver())
        삼성 = next(r for r in cache.get("rank:kr:시가총액") if r["symbol"] == "005930.KS")
        assert (삼성["price"], 삼성["change_rate"]) == (72_000, 2.86)
        assert 삼성["market_cap"] == 72_000 * 1000          # 시총도 그 가격으로
        cache.delete("price:005930.KS")


# ── 순위를 여는 라우트 ─────────────────────────────────────────
class Test국내_순위_라우트:
    @pytest.fixture
    def D(self, monkeypatch):
        from app.api.routes import dashboard as D
        from app.services.kis_service import kis_service
        monkeypatch.setattr(kis_service, "get_top_movers",
                            lambda *a, **k: pytest.fail("KIS 를 불렀다"), raising=False)
        return D

    def _장(self, monkeypatch, 상태):
        monkeypatch.setattr("app.services.market_hours.kr_session", lambda *a, **k: 상태)

    def test_신선한_캐시가_있으면_아무것도_안_부른다(self, D, monkeypatch):
        cache.set("rank:kr:거래대금", [{"symbol": "A"}], 900)
        monkeypatch.setattr(rs, "fetch_naver_rank", lambda c: pytest.fail("네이버를 불렀다"))
        assert asyncio.run(D._get_kr_rankings("거래대금")) == [{"symbol": "A"}]

    def test_처음이면_네이버에서_새로_받아_준다(self, D, monkeypatch):
        """예전에는 KIS(최대 6초) → 전일 종가로 전 종목 훑기(최대 6초) 순이었다.
        거래대금 1위는 거래량 페이지에 없는 SK하이닉스(20만원 × 500만주 = 1조)다 —
        예전 방식(거래량 상위 안에서만)이면 450억짜리 444444 가 1위였다."""
        self._장(monkeypatch, "regular")
        _네이버(monkeypatch, _페이지())
        줄들 = asyncio.run(D._get_kr_rankings("거래대금"))
        assert [r["symbol"] for r in 줄들][:2] == ["000660.KS", "005930.KS"]

    def test_장중에_묵은_순위면_새로_받는_동안_기다린다(self, D, monkeypatch):
        self._장(monkeypatch, "regular")
        cache.set("rank:kr:시가총액", [{"symbol": "OLD"}], 1)
        time.sleep(1.1)
        _네이버(monkeypatch, _페이지())
        assert asyncio.run(D._get_kr_rankings("시가총액"))[0]["symbol"] != "OLD"

    def test_장이_닫혔으면_지난_순위를_곧바로_주고_뒤에서_새로_받는다(self, D, monkeypatch):
        self._장(monkeypatch, "closed")
        cache.set("rank:kr:시가총액", [{"symbol": "OLD"}], 1)
        time.sleep(1.1)
        _네이버(monkeypatch, _페이지())

        async def 열기():
            처음 = await D._get_kr_rankings("시가총액")
            for _ in range(20):                       # 배경 갱신이 돌 틈을 준다
                await asyncio.sleep(0)
            return 처음
        assert asyncio.run(열기()) == [{"symbol": "OLD"}]
        assert cache.get("rank:kr:시가총액")[0]["symbol"] != "OLD", "뒤에서 새로 받지 않았다"

    def test_네이버가_방금_막혔으면_장중이라도_기다리지_않는다(self, D, monkeypatch):
        """막혀 있는 동안 순위를 여는 사람마다 6초씩 세우지 않는다"""
        self._장(monkeypatch, "regular")
        _네이버(monkeypatch, {})
        asyncio.run(rs.refresh_kr_rankings_from_naver())        # 실패 — 막힘 표시
        assert rs.국내갱신_막힘()
        cache.set("rank:kr:상승률", [{"symbol": "OLD"}], 1)
        time.sleep(1.1)
        monkeypatch.setattr(rs, "fetch_naver_rank", lambda c: pytest.fail("또 물었다"))
        t = time.perf_counter()
        assert asyncio.run(D._get_kr_rankings("상승률")) == [{"symbol": "OLD"}]
        assert time.perf_counter() - t < 0.5
        monkeypatch.setattr(rs, "_국내갱신_실패", 0.0)

    def test_다시_받으면_막힘이_풀린다(self, monkeypatch):
        _네이버(monkeypatch, {})
        asyncio.run(rs.refresh_kr_rankings_from_naver())
        assert rs.국내갱신_막힘()
        _네이버(monkeypatch, _페이지())
        asyncio.run(rs.refresh_kr_rankings_from_naver())
        assert not rs.국내갱신_막힘()

    def test_네이버가_안_되면_지난_순위를_준다(self, D, monkeypatch):
        self._장(monkeypatch, "regular")
        cache.set("rank:kr:상승률", [{"symbol": "OLD"}], 1)
        time.sleep(1.1)
        _네이버(monkeypatch, {})
        assert asyncio.run(D._get_kr_rankings("상승률")) == [{"symbol": "OLD"}]

    def test_아무것도_없고_네이버도_안_되면_전일_종가로라도(self, D, monkeypatch):
        self._장(monkeypatch, "regular")
        _네이버(monkeypatch, {})
        monkeypatch.setattr(rs, "get_kr_rankings", lambda c: [{"symbol": "FDR"}])
        assert asyncio.run(D._get_kr_rankings("거래량")) == [{"symbol": "FDR"}]

    def test_전일_종가_대체_순위는_오래_담아_두지_않는다(self, D, monkeypatch):
        """오래 담아 두면 네이버가 돌아와도 그동안 어제 순위를 낸다."""
        monkeypatch.setattr(rs, "_build_all_kr_rows",
                            lambda: [{"symbol": "A", "price": 1, "volume": 5}])
        rs.get_kr_rankings("거래량")
        남은수명 = cache._store["rank:kr:거래량"][1] - time.time()
        assert 0 < 남은수명 <= 120

    def test_화면이_보는_50줄까지만_보낸다(self, D, monkeypatch):
        cache.set("rank:kr:거래량", [{"symbol": f"S{i}"} for i in range(100)], 900)
        cache.set("rank:us:거래량", [{"symbol": f"U{i}"} for i in range(100)], 900)
        assert len(asyncio.run(D.kr_rankings("거래량"))) == 50
        assert len(asyncio.run(D.us_rankings("거래량"))) == 50


# ── 해외: 한 장의 값끼리만 견준다 ─────────────────────────────
def _장시각(y, m, d, h=15, mi=59) -> int:
    return int(datetime(y, m, d, h, mi, tzinfo=뉴욕).timestamp())


def _미국줄(sym, rate, t, cap=10**9, volume=1000):
    return {"symbol": sym, "name": sym, "price": 10.0, "change": 0.1, "change_rate": rate,
            "volume": volume, "amount": 10.0 * volume, "market_cap": cap, "regular_time": t}


class Test해외는_한_장끼리만:
    어제 = _장시각(2026, 10, 6)
    오늘 = _장시각(2026, 10, 7, 11, 30)

    def test_어제_오른_종목이_오늘_상승률에_섞이지_않는다(self):
        줄들 = ([_미국줄("YDAY", 80.0, self.어제)]
              + [_미국줄(f"T{i}", 1.0 + i / 100, self.오늘) for i in range(rs.US_SESSION_MIN_ROWS)])
        out = rs._sort_us(줄들, "상승률")
        assert "YDAY" not in [r["symbol"] for r in out]
        assert out[0]["symbol"] == f"T{rs.US_SESSION_MIN_ROWS - 1}"

    def test_오늘_장이_막_열려_몇_개뿐이면_어제_장으로만_줄_세운다(self):
        줄들 = ([_미국줄("NOW", 5.0, self.오늘)]
              + [_미국줄(f"Y{i}", 1.0 + i / 100, self.어제) for i in range(rs.US_SESSION_MIN_ROWS)])
        out = [r["symbol"] for r in rs._sort_us(줄들, "상승률")]
        assert "NOW" not in out and len(out) == rs.US_SESSION_MIN_ROWS

    def test_체결_시각을_모르면_거르지_않는다(self):
        줄들 = [dict(_미국줄(f"S{i}", float(i), 0)) for i in range(5)]
        assert len(rs._sort_us(줄들, "상승률")) == 5

    def test_시가총액은_장을_가리지_않는다(self):
        줄들 = ([_미국줄("BIG", 0.0, self.어제, cap=3 * 10**12)]
              + [_미국줄(f"T{i}", 1.0, self.오늘) for i in range(rs.US_SESSION_MIN_ROWS)])
        assert rs._sort_us(줄들, "시가총액")[0]["symbol"] == "BIG"

    def test_언제_장의_값인지_적는다(self):
        out = rs._sort_us([_미국줄("A", 1.0, self.오늘)], "시가총액")
        assert out[0]["as_of"] == self.오늘

    def test_정렬해_둔_순위의_수명은_안전망일_뿐이다(self, monkeypatch):
        """표가 바뀌면 그 자리에서 다시 만든다. 그 길이 빠져도 5분 안에는 표에서
        다시 줄 세운다 — 예전에는 15분이었고 만료돼도 지난 것을 계속 꺼내 줬다."""
        표 = [_미국줄(f"T{i}", float(i), self.오늘) for i in range(rs.US_MIN_ROWS)]
        monkeypatch.setattr(rs, "_build_us_rows", lambda: 표)
        rs.get_us_rankings("상승률")
        남은수명 = cache._store["rank:us:상승률"][1] - time.time()
        assert 0 < 남은수명 <= 300

    def test_표를_한_번_풀어_일곱_가지를_함께_만든다(self, monkeypatch):
        """해외 탭을 열면 다섯 탭을 한꺼번에 미리 받는다. 분류마다 표(6천 줄)를
        다시 풀면 0.15 CPU 에서 그게 겹친다."""
        표 = [_미국줄(f"T{i}", float(i), self.오늘, volume=i + 1) for i in range(rs.US_MIN_ROWS)]
        불림 = []
        monkeypatch.setattr(rs, "_build_us_rows", lambda: 불림.append(1) or 표)
        for c in ("시가총액", "상승률", "하락률", "거래대금", "거래량"):
            assert rs.get_us_rankings(c)
        assert len(불림) == 1, f"표를 {len(불림)}번 풀었다"

    def test_순위표를_만들_때_체결_시각을_싣는다(self):
        """시세 캐시에서 표를 만들 때 체결 시각이 빠지면 장 가르기가 통째로 꺼진다"""
        cache.set("price:AAPL", {"symbol": "AAPL", "name": "Apple", "price": 230.0,
                                 "change_rate": 1.0, "volume": 1, "market_cap": 1,
                                 "regular_time": self.오늘}, 60)
        줄 = next(r for r in rs._us_rows_from_cache() if r["symbol"] == "AAPL")
        assert 줄["regular_time"] == self.오늘
        cache.delete("price:AAPL")

    def test_정렬할_때_표의_줄을_건드리지_않는다(self):
        표 = [_미국줄(f"T{i}", float(i), self.오늘) for i in range(3)]
        rs._sort_us(표, "상승률")
        assert all("rank" not in r for r in 표)


class Test야후_체결시각:
    def test_마지막_체결_시각을_받아_온다(self):
        from app.services import price_fetcher as P
        assert "regularMarketTime" in P._YF_QUOTE_FIELDS
        out = P._parse_yf_quotes([{"symbol": "AAPL", "regularMarketPrice": 230.0,
                                   "regularMarketTime": 1_791_000_000}])
        assert out["AAPL"]["regular_time"] == 1_791_000_000

    def test_없으면_0(self):
        from app.services import price_fetcher as P
        out = P._parse_yf_quotes([{"symbol": "AAPL", "regularMarketPrice": 230.0}])
        assert out["AAPL"]["regular_time"] == 0


class Test장중에도_표를_채운다:
    def test_인기_S_P500_갱신이_곧바로_표에_쌓인다(self, monkeypatch):
        from app.services import scheduler as S
        from app.core.config import settings
        monkeypatch.setattr(settings, "FINNHUB_API_KEY", "", raising=False)
        cache.set("rank:us:상승률", [{"symbol": "OLD"}], 900)

        async def 가짜(심볼들):
            return {s: {"symbol": s, "name": s, "price": 100.0, "change_rate": 1.0, "volume": 1,
                        "market_cap": 10**9, "regular_time": 1} for s in 심볼들}
        monkeypatch.setattr(S, "fetch_yf_quotes", 가짜)

        async def 안기다림(*a, **k):
            return None
        monkeypatch.setattr(S.asyncio, "sleep", 안기다림)
        asyncio.run(S.refresh_us_stocks())
        표 = cache.get(rs.US_ROWS_CK) or []
        assert len(표) >= rs.US_MIN_ROWS, "받은 값이 표에 안 쌓였다"
        새순위 = cache.get("rank:us:상승률")
        assert 새순위 and 새순위[0]["symbol"] != "OLD", "정렬해 둔 옛 순위가 그대로다"

    def test_장이_열려_있어도_전종목을_이어_훑는다(self):
        import ast
        import inspect
        import textwrap
        from app.services import scheduler as S
        본문 = ast.unparse(ast.parse(textwrap.dedent(inspect.getsource(S.periodic_refresh))))
        자리 = 본문[본문.index("미국닫힘 ="):본문.index("_미국순위표_돌리기()")]
        assert "not 미국닫힘" in 자리, "장중에 훑는 자리가 없다"
        assert "refresh_us_rows()" in inspect.getsource(S._미국순위표_돌리기)
