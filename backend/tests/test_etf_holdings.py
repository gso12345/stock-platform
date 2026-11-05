"""
ETF 보유비중 — 구성종목을 받는 길을 지킨다.

사용자: "종목상세탭 ETF 보유비중 정보 안불러오는 종목이 있어"

막힌 곳이 셋이었다(services/market/etf_holdings.py 머리말).
  · 국내 ETF — KRX 가 로그인한 세션에만 자료를 준다. 로그인 없이 물으면 'LOGOUT'. 그래서 국내 ETF 는 다 비었다
    → 네이버 증권 etfAnalysis(etfTop10MajorConstituentAssets: itemCode·itemName·etfWeight '9.34%')를 먼저 본다
  · 영문이 섞인 새 국내 코드(0193W0) — 숫자만 국내로 봐서 국내 길로 가지도 못했다
  · 미국 ETF — 야후 funds_data 는 운영 서버에서 막힌 야후 '상세'다 → 네이버 해외 ETF 구성을 함께 묻는다

그래도 비던 것(같은 말을 다시 들었다 — GitHub 일꾼에서 운영 서버·네이버에 실제로 물어 원인을 찾았다)
  · 국내 해외주식·채권·현금성 ETF(360750·459580·132030·148070) — 상위 10종목 비중이 '-' 라 다 버려졌다
    → 전체 구성(ETFComponent)을 먼저. 견본은 그때 받은 실제 응답을 줄였다
  · 미국 뉴욕아카 일부(SCHD·ARKK) — 네이버 코드가 'SCHD.K' → 자동완성으로 알아낸다
  · 미국 구성종목 티커가 비었다 — meta.itemCode 에 있다
  · 레버리지 ETF(SOXL) — 비중 합이 306% 라 '100% 넘으면 버린다' 에 걸렸다

KRX 길은 남겨 두었다(다시 열릴 수도 있다). 그 길을 고칠 때 두 번 헛짚었던 기록도 그대로 지킨다.
  1) pykrx 를 쓰면서 인자를 거꾸로 넘겼다 — 종목 자리에 날짜가 들어가 늘 빈 표가 왔다.
  2) pykrx 가 응답을 못 읽고 죽었다(UnicodeDecodeError) — http:// 와 자체 세션 탓이었다.
"""
import ast
import asyncio
import logging
import pathlib
import re
import sys
import types

import httpx
import pandas as pd
import pytest

from app.services.market import etf_holdings as 보유

# 구조 검사는 모듈로 import 하지 않고 파일로 읽는다
_소스 = (pathlib.Path(__file__).resolve().parents[1]
         / "app" / "api" / "routes" / "stocks" / "flows.py").read_text(encoding="utf-8")


def _보유비중구간() -> str:
    """ETF 보유비중 엔드포인트 안쪽만 잘라 낸다.

    파일 전체에서 이름으로 찾으면 안 된다 — 뉴스 쪽에도 _fetch_kr 이 있어서
    처음에는 엉뚱한 구간을 검사하고 있었다(그래서 폴백을 통째로 지워도
    테스트가 통과했다). 라우트 데코레이터를 기준으로 삼는다."""
    시작 = _소스.index('@router.get("/ETF/{symbol}/holdings")')
    끝 = _소스.find("@router.", 시작 + 10)
    return _소스[시작:끝 if 끝 > 시작 else len(_소스)]


def _코드만(본문: str) -> str:
    """주석과 문서화 문자열을 걷어낸다 — 무엇을 왜 그만뒀는지 적은 낱말을 코드로 착각하지 않게"""
    본문 = re.sub(r'"""[\s\S]*?"""', "", 본문)
    return re.sub(r"^\s*#.*$", "", 본문, flags=re.M)


def _호출들(함수이름: str) -> list[ast.Call]:
    나무 = ast.parse(_소스)
    return [n for n in ast.walk(나무)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 함수이름]


# ── 국내 코드 알아보기 ─────────────────────────────────────────────

class Test국내코드:
    @pytest.mark.parametrize("넣음, 나옴", [
        ("069500", "069500"), ("069500.KS", "069500"), ("069500.KQ", "069500"),
        ("0193W0", "0193W0"), ("0193w0", "0193W0"), ("0193W0.KS", "0193W0"),
        ("00680K", "00680K"), (" 360750 ", "360750"),
    ])
    def test_국내(self, 넣음, 나옴):
        """새로 상장하는 종목은 6자리 숫자가 바닥나 영문을 섞는다 — 숫자만 보면 이런 ETF 는 국내 길로 못 간다"""
        assert 보유.국내코드(넣음) == 나옴

    @pytest.mark.parametrize("넣음", ["SPY", "QQQ", "BRK-B", "69500", "0193W0X", "", "A12345", "069500.T"])
    def test_국내가_아니다(self, 넣음):
        assert 보유.국내코드(넣음) is None


class Test비중값:
    @pytest.mark.parametrize("넣음, 나옴", [("9.34%", 9.34), ("9.34", 9.34), (9.34, 9.34), ("1,234.5", 1234.5),
                                         (" 12 % ", 12.0), (0, 0.0)])
    def test_읽는다(self, 넣음, 나옴):
        assert 보유.비중값(넣음) == pytest.approx(나옴)

    @pytest.mark.parametrize("넣음", [None, True, "abc", "", "nan", "inf", "-"])
    def test_못_읽으면_None(self, 넣음):
        assert 보유.비중값(넣음) is None


# ── 국내 — 네이버 etfAnalysis ──────────────────────────────────────

국내응답 = {
    "etfTop10MajorConstituentAssets": [
        {"seq": 2, "itemCode": "000660", "itemName": "SK하이닉스", "etfWeight": "11.20%"},
        {"seq": 1, "itemCode": "005930", "itemName": "삼성전자", "etfWeight": "24.69%"},
        {"seq": 3, "itemCode": "", "itemName": "원화예금", "etfWeight": "1.50%"},
        {"seq": 4, "itemCode": "105560", "itemName": "KB금융", "etfWeight": "0.00%"},
        {"seq": 5, "itemCode": "035420", "itemName": "NAVER", "etfWeight": None},
        {"seq": 6, "itemCode": "069500", "itemName": "KODEX 200", "etfWeight": "3.00%"},
        "엉뚱한 값",
    ],
}


class Test국내_구성_읽기:
    def test_비중_큰_순으로_이름과_비중을_읽는다(self):
        rows = 보유.국내_구성_읽기(국내응답, "069500")
        assert [(r["symbol"], r["name"], r["pct"]) for r in rows] == [
            ("005930", "삼성전자", 24.69), ("000660", "SK하이닉스", 11.2), ("", "원화예금", 1.5)]

    def test_비중이_없거나_0_이하는_뺀다(self):
        이름들 = [r["name"] for r in 보유.국내_구성_읽기(국내응답, "069500")]
        assert "KB금융" not in 이름들 and "NAVER" not in 이름들

    def test_ETF_자신은_뺀다(self):
        assert "KODEX 200" not in [r["name"] for r in 보유.국내_구성_읽기(국내응답, "069500")]
        assert "KODEX 200" in [r["name"] for r in 보유.국내_구성_읽기(국내응답, "")]

    @pytest.mark.parametrize("응답", [{}, {"etfTop10MajorConstituentAssets": None}, [], None,
                                     {"etfTop10MajorConstituentAssets": "x"}])
    def test_모양이_달라도_죽지_않는다(self, 응답):
        assert 보유.국내_구성_읽기(응답, "069500") == []


def _가짜(처리):
    return httpx.Client(transport=httpx.MockTransport(처리))


# ── 국내 — 네이버 전체 구성(ETFComponent). 아래 견본은 2026-11-05 GitHub 일꾼에서 실제로 받은 응답을 줄였다 ──

def _구성줄(코드, 이름, 비중, 국내=None, 해외=None, isin="", 금액="0", 수="504", 날="2026-11-05"):
    return {"itemCode": 코드, "componentIsinCode": isin, "componentItemCode": 국내, "componentReutersCode": 해외,
            "componentCount": 수, "componentMarketType": "2" if 해외 else "0", "componentName": 이름,
            "evalAmount": 금액, "weight": 비중, "referenceDate": 날}


#: TIGER 미국S&P500 — 상위 10종목(etfAnalysis)은 비중이 전부 '-' 로 와서 다 비었다
미국담은국내 = [
    _구성줄("360750", "엔비디아", "7.66", 해외="NVDA.O", isin="US67066G1040", 금액="96388981"),
    _구성줄("360750", "애플", "7.42", 해외="AAPL.O", isin="US0378331005", 금액="93340920"),
    _구성줄("360750", "마이크로소프트", "5.92", 해외="MSFT.O", isin="US5949181045", 금액="74552525"),
]
#: KODEX CD금리액티브 — 현금·스왑·다른 ETF 를 담는다
현금성국내 = [
    _구성줄("459580", "원화현금", "46.73", isin="KRD010010001", 수="32"),
    _구성줄("459580", "스왑(하나금융투자)", "15.05", isin="SWAP00000014", 수="32"),
    _구성줄("459580", "KODEX 머니마켓액티브", "12.14", 국내="488770", isin="KR7488770009", 수="32"),
]


class Test국내_전체구성_읽기:
    def test_해외주식을_담은_국내_ETF_도_비중과_한글_이름과_해외_코드로(self):
        rows = 보유.국내_전체구성_읽기(미국담은국내, "360750")
        assert [(r["symbol"], r["name"], r["pct"]) for r in rows] == [
            ("NVDA.O", "엔비디아", 7.66), ("AAPL.O", "애플", 7.42), ("MSFT.O", "마이크로소프트", 5.92)]
        assert rows[0]["value"] == 96388981.0
        assert all("market" not in r for r in rows), "해외 종목은 잇기 가 미국 DB 로 가린다"

    def test_현금_스왑은_이름과_비중만_국내_상장은_국내로(self):
        rows = 보유.국내_전체구성_읽기(현금성국내, "459580")
        assert [(r["symbol"], r["name"], r.get("market")) for r in rows] == [
            ("", "원화현금", None), ("", "스왑(하나금융투자)", None), ("488770", "KODEX 머니마켓액티브", "KR")]

    def test_ISIN_이_KR7_이_아니면_국내로_달지_않는다(self):
        """채권(KR1…·KR6…)·현금(KRD…)은 국내 코드가 있어도 상장 종목이 아니다"""
        줄 = [_구성줄("148070", "국고채권03250-3512", "30", 국내="KR1035", isin="KR103502GE97")]
        assert "market" not in 보유.국내_전체구성_읽기(줄, "148070")[0]

    def test_비중이_없거나_0_이하와_ETF_자신과_이름_없는_것은_뺀다(self):
        줄 = [_구성줄("122630", "삼성전자", "23.32", 국내="005930", isin="KR7005930003"),
             _구성줄("122630", "2026-12 코스피200지수선물", "-"),
             _구성줄("122630", "매도 선물", "-4.0"),
             _구성줄("122630", "빈 칸", None),
             _구성줄("122630", "", "3.0"),
             _구성줄("122630", "KODEX 레버리지", "1.0", 국내="122630", isin="KR7122630007"),
             "엉뚱한 값"]
        assert [r["name"] for r in 보유.국내_전체구성_읽기(줄, "122630")] == ["삼성전자"]

    def test_비중_큰_순으로(self):
        섞임 = [미국담은국내[2], 미국담은국내[0], 미국담은국내[1]]
        assert [r["pct"] for r in 보유.국내_전체구성_읽기(섞임, "360750")] == [7.66, 7.42, 5.92]

    @pytest.mark.parametrize("응답", [None, {}, [], "x", {"items": []}])
    def test_모양이_달라도_죽지_않는다(self, 응답):
        assert 보유.국내_전체구성_읽기(응답, "360750") == []


class Test전체구성_덧:
    def test_전체_개수와_기준일(self):
        assert 보유.전체구성_덧(미국담은국내) == {"total": 504, "as_of": "2026-11-05"}

    @pytest.mark.parametrize("첫", [{"componentCount": "-", "referenceDate": "어제"},
                                   {"componentCount": "0", "referenceDate": None},
                                   {"componentCount": "1.5"}, {}])
    def test_못_읽는_값은_넣지_않는다(self, 첫):
        assert 보유.전체구성_덧([첫]) == {}

    @pytest.mark.parametrize("응답", [None, [], {}, ["x"]])
    def test_모양이_달라도_죽지_않는다(self, 응답):
        assert 보유.전체구성_덧(응답) == {}


class Test네이버_국내:
    def test_전체_구성을_먼저_묻는다(self):
        받은 = []

        def 처리(req: httpx.Request):
            받은.append(req)
            return httpx.Response(200, json=미국담은국내)

        out = 보유.네이버_국내("360750", client=_가짜(처리))
        assert len(받은) == 1, "전체 구성이 있으면 상위 10종목은 묻지 않는다"
        assert 받은[0].url.copy_with(query=None) == httpx.URL(
            "https://stock.naver.com/api/domestic/detail/360750/ETFComponent")
        assert dict(받은[0].url.params) == {"startIdx": "0", "pageSize": str(보유.전체구성쪽)}
        assert 받은[0].headers["Referer"] == "https://stock.naver.com/"
        assert "Mozilla" in 받은[0].headers["User-Agent"]
        assert out["source"] == "네이버 증권" and "reason" not in out
        assert [r["name"] for r in out["holdings"]] == ["엔비디아", "애플", "마이크로소프트"]
        assert (out["total"], out["as_of"], out["sector_weights"]) == (504, "2026-11-05", [])

    def test_화면에는_25줄까지(self):
        많이 = [_구성줄("069500", f"S{i}", str(40 - i), 국내=f"{i:06d}") for i in range(40)]
        out = 보유.네이버_국내("069500", client=_가짜(lambda r: httpx.Response(200, json=많이)))
        assert len(out["holdings"]) == 보유.보일수 == 25 and out["holdings"][0]["name"] == "S0"

    def test_전체_구성이_비면_상위_10종목으로_로그인_없이_모바일_API(self):
        받은 = []

        def 처리(req: httpx.Request):
            받은.append(req)
            if "ETFComponent" in req.url.path:
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=국내응답)

        out = 보유.네이버_국내("0193W0", client=_가짜(처리))
        assert str(받은[1].url) == "https://m.stock.naver.com/api/stock/0193W0/etfAnalysis"
        assert 받은[1].headers["Referer"] == "https://m.stock.naver.com/"
        assert out["source"] == "네이버 증권" and "reason" not in out and "total" not in out
        assert [r["name"] for r in out["holdings"]][:2] == ["삼성전자", "SK하이닉스"]

    def test_전체_구성이_터져도_상위_10종목으로(self):
        def 처리(req):
            if "ETFComponent" in req.url.path:
                raise httpx.ConnectError("끊김")
            return httpx.Response(200, json=국내응답)
        assert 보유.네이버_국내("069500", client=_가짜(처리))["holdings"][0]["name"] == "삼성전자"

    def test_전체_구성을_못_받고_상위도_비면_받지_못했다고(self):
        """'공개된 것이 없다' 는 원천이 없다고 답했을 때만 — 묻지도 못했는데 없다고 하면 거짓말이다"""
        def 처리(req):
            if "ETFComponent" in req.url.path:
                return httpx.Response(503, text="점검")
            return httpx.Response(200, json={"etfTop10MajorConstituentAssets": [
                {"itemCode": "", "itemName": "NVIDIA CORP", "etfWeight": "-"}]})
        out = 보유.네이버_국내("360750", client=_가짜(처리))
        assert out["holdings"] == [] and out["reason"] == "네이버 증권에서 구성종목을 받지 못했습니다"

    def test_전체_구성이_없다고_답하고_상위는_터지면_공개된_것이_없다고(self):
        def 처리(req):
            if "ETFComponent" in req.url.path:
                return httpx.Response(200, json=[])
            raise httpx.ConnectError("끊김")
        out = 보유.네이버_국내("360750", client=_가짜(처리))
        assert out["holdings"] == [] and out["reason"] == "네이버 증권에 공개된 구성종목이 없습니다"

    def test_클라이언트를_못_열어도_죽지_않는다(self, monkeypatch):
        monkeypatch.setattr(보유.httpx, "Client", lambda **k: 1 / 0)
        out = 보유.네이버_국내("069500")
        assert out["holdings"] == [] and out["reason"] == "네이버 증권에서 구성종목을 받지 못했습니다"

    def test_실패는_사람이_읽는_한_문장으로(self, caplog):
        def 처리(req):
            return httpx.Response(500, text="서버 내부: Traceback ...")
        with caplog.at_level(logging.WARNING, logger=보유.log.name):
            out = 보유.네이버_국내("069500", client=_가짜(처리))
        assert out["holdings"] == [] and out["reason"] == "네이버 증권에서 구성종목을 받지 못했습니다"
        assert "HTTPStatusError" in caplog.text, "왜 못 받았는지 로그에는 남아야 한다"

    def test_빈_목록이면_공개된_것이_없다고(self):
        out = 보유.네이버_국내("0193W0", client=_가짜(lambda r: httpx.Response(200, json={})))
        assert out["holdings"] == [] and out["reason"] == "네이버 증권에 공개된 구성종목이 없습니다"

    def test_JSON_이_아니면_실패로(self):
        out = 보유.네이버_국내("069500", client=_가짜(lambda r: httpx.Response(200, text="<html>점검</html>")))
        assert out["holdings"] == [] and out["reason"] == "네이버 증권에서 구성종목을 받지 못했습니다"


# ── 해외 — 네이버 해외 ETF 구성(칸 이름을 여기서 확인할 수 없었다) ─────────────

class Test해외_구성_읽기:
    def test_holdings_를_읽고_exposures_는_안_읽는다(self):
        j = {"exposures": [{"name": "정보기술", "ratio": 51.2}, {"name": "통신", "ratio": 15.0}],
             "holdings": [{"stockName": "애플", "reutersCode": "AAPL.O", "weight": 8.4},
                          {"stockName": "엔비디아", "reutersCode": "NVDA.O", "weight": 9.1}]}
        rows = 보유.해외_구성_읽기(j)
        assert [(r["name"], r["symbol"], r["pct"]) for r in rows] == [("엔비디아", "NVDA.O", 9.1),
                                                                    ("애플", "AAPL.O", 8.4)]

    def test_holdings_라는_이름을_먼저_본다(self):
        """이름·비중 칸을 가진 다른 목록(관련 ETF 따위)이 앞에 있어도 구성종목으로 읽지 않는다"""
        j = {"relatedEtfs": [{"name": "QQQM", "weight": 1.0}],
             "holdings": [{"stockName": "애플", "weight": 8.4}]}
        assert [r["name"] for r in 보유.해외_구성_읽기(j)] == ["애플"]

    def test_감싼_곳_안의_holdings_도_찾는다(self):
        j = {"result": {"etfCode": "QQQ.O",
                        "related": [{"name": "QQQM", "weight": 1.0}],
                        "holdings": {"asOf": "2026-10-31",
                                     "list": [{"name": "Microsoft", "symbol": "MSFT", "holdingRatio": "7.5%"}]}}}
        assert [(r["name"], r["symbol"], r["pct"]) for r in 보유.해외_구성_읽기(j)] == [("Microsoft", "MSFT", 7.5)]

    def test_0에서_1_비율이면_퍼센트로(self):
        j = {"holdings": [{"stockName": "A", "weight": 0.081}, {"stockName": "B", "weight": 0.05}]}
        assert [r["pct"] for r in 보유.해외_구성_읽기(j)] == pytest.approx([8.1, 5.0])

    def test_이름에_holdings_가_없으면_이름과_비중이_있는_목록(self):
        """단 exposure(섹터·국가 비중) 아래는 구성종목이 아니다 — 같은 깊이에 먼저 있어도 건너뛴다"""
        j = {"exposures": [{"name": "기술", "weight": 60}],
             "items": [{"korName": "마이크로소프트", "ticker": "MSFT", "weight": 7}]}
        assert [r["name"] for r in 보유.해외_구성_읽기(j)] == ["마이크로소프트"]
        j2 = {"exposure": {"sectors": [{"name": "기술", "weight": 60}]},
              "items": [{"korName": "애플", "ticker": "AAPL", "weight": 6}]}
        assert [r["name"] for r in 보유.해외_구성_읽기(j2)] == ["애플"]

    def test_등락률을_비중으로_읽지_않는다(self):
        """네이버는 등락률을 fluctuationsRatio 로 준다 — 'ratio' 가 들었다고 비중으로 읽으면 엉뚱한 숫자가 뜬다"""
        j = {"holdings": [{"stockName": "애플", "fluctuationsRatio": 2.5, "changeWeight": 1.0}]}
        assert 보유.해외_구성_읽기(j) == []

    def test_이름에_weight_가_든_칸도_읽는다(self):
        j = {"holdings": [{"stockName": "애플", "portfolioWeightPct": "6.6"}]}
        assert [r["pct"] for r in 보유.해외_구성_읽기(j)] == [6.6]

    def test_비중_합이_말이_안_되면_버린다(self, caplog):
        """틀린 숫자를 보여 주느니 비운다 — 가격(수백 달러)을 비중으로 읽은 꼴. 칸 이름은 로그에 남긴다"""
        j = {"holdings": [{"stockName": "A", "weight": 349.5}, {"stockName": "B", "weight": 200.1}]}
        with caplog.at_level(logging.WARNING, logger=보유.log.name):
            assert 보유.해외_구성_읽기(j) == []
        assert "stockName" in caplog.text and "weight" in caplog.text

    def test_레버리지_ETF_는_비중_합이_100_을_넘어도_받는다(self):
        """SOXL(3배) — 상위 10줄 비중 합이 306% 다(2026-11 실제). 100% 에서 자르던 때는 비었다"""
        j = {"holdings": {"baseDate": "2026-10-31", "holdings": [
            {"name": "ICE Semiconductor Index Swap", "weight": "152.4", "meta": None},
            {"name": "Dreyfus Government Cash Management", "weight": "61.2", "meta": None},
            {"name": "NVIDIA Corporation", "weight": "52.3", "meta": {"itemCode": "NVDA.O"}},
            {"name": "Broadcom Inc", "weight": "40.3", "meta": {"itemCode": "AVGO.O"}}]}}
        rows = 보유.해외_구성_읽기(j)
        assert len(rows) == 4 and sum(r["pct"] for r in rows) == pytest.approx(306.2)

    def test_합이_딱_상한이면_받고_넘으면_버린다(self):
        assert len(보유.해외_구성_읽기({"holdings": [{"stockName": "A", "weight": 300},
                                                   {"stockName": "B", "weight": 100.5}]})) == 2
        assert 보유.해외_구성_읽기({"holdings": [{"stockName": "A", "weight": 300},
                                               {"stockName": "B", "weight": 100.6}]}) == []

    def test_못_읽으면_칸_이름을_로그에(self, caplog):
        j = {"holdings": [{"뭔가": "x", "다른것": 1}]}
        with caplog.at_level(logging.WARNING, logger=보유.log.name):
            assert 보유.해외_구성_읽기(j) == []
        assert "뭔가" in caplog.text

    def test_25개까지(self):
        j = {"holdings": [{"stockName": f"S{i}", "weight": 1.0 + i / 100} for i in range(40)]}
        rows = 보유.해외_구성_읽기(j)
        assert len(rows) == 25 and rows[0]["name"] == "S39"

    @pytest.mark.parametrize("응답", [None, {}, [], {"holdings": []}, {"holdings": "x"}, "문자열"])
    def test_모양이_달라도_죽지_않는다(self, 응답):
        assert 보유.해외_구성_읽기(응답) == []


#: SPY 해외 구성 — 2026-11-05 실제 응답을 줄였다. 티커는 meta.itemCode 에, 채권·현금 줄은 meta 가 null
해외실제 = {"holdings": {"baseDate": "2026-10-31", "holdings": [
    {"rank": "1", "name": "Apple Inc.", "weight": "7.698600000", "top10absWeight": "20.65", "amount": "61347588023.15",
     "shares": "178010005", "price": {"currentPrice": "349.51", "changeRate": "5.31"},
     "meta": {"itemCode": "AAPL.O", "stockType": "worldstock", "stockEndType": "stock"}},
    {"rank": "2", "name": "NVIDIA Corporation", "weight": "7.580300000", "top10absWeight": "20.33",
     "price": {"currentPrice": "200.13", "changeRate": "-3.17"}, "meta": {"itemCode": "NVDA.O"}},
    {"rank": "3", "name": "United States of America 4.75% 15-MAY-2055", "weight": "4.220700000", "price": None,
     "meta": None}]},
    "exposures": {"countryExposure": {"baseDate": "2026-09-30", "items": [{"rank": "1", "name": "미국",
                                                                            "value": "99.5"}]}}}


class Test해외_실제_응답:
    def test_티커는_meta_itemCode_에서(self):
        rows = 보유.해외_구성_읽기(해외실제)
        assert [(r["name"], r["symbol"], r["pct"]) for r in rows] == [
            ("Apple Inc.", "AAPL.O", 7.6986), ("NVIDIA Corporation", "NVDA.O", 7.5803),
            ("United States of America 4.75% 15-MAY-2055", "", 4.2207)]

    def test_등락률_가격을_비중으로_읽지_않는다(self):
        """changeRate·currentPrice 는 price 안에 있다 — 비중은 weight"""
        assert [r["pct"] for r in 보유.해외_구성_읽기(해외실제)][0] == pytest.approx(7.6986)

    def test_금_ETF_는_현금_빚을_빼고(self):
        """GLD — Gold 100.034%, USD Cash -0.034%(빚)"""
        j = {"holdings": {"baseDate": "2026-09-30", "holdings": [
            {"rank": "1", "name": "Gold", "weight": "100.034000000", "meta": None},
            {"rank": "2", "name": "USD Cash", "weight": "-0.034000000", "meta": None}]}}
        assert [(r["name"], r["pct"]) for r in 보유.해외_구성_읽기(j)] == [("Gold", pytest.approx(100.034))]

    def test_기준일(self):
        assert 보유.해외_기준일(해외실제) == "2026-10-31"

    @pytest.mark.parametrize("응답", [None, {}, {"holdings": []}, {"holdings": {"baseDate": "10월"}},
                                     {"holdings": {"baseDate": None}}])
    def test_기준일이_없거나_이상하면_None(self, 응답):
        assert 보유.해외_기준일(응답) is None


class Test해외코드:
    def test_나스닥은_O_를_먼저(self):
        assert 보유.해외코드후보("QQQ", "NASDAQ") == ["QQQ.O", "QQQ", "QQQ.K"]

    def test_뉴욕_아카는_꼬리_없이_다음은_K(self):
        """SCHD·ARKK 는 네이버 코드가 'SCHD.K'·'ARKK.K' 다 — 예전에는 '.O' 만 더 물어서 404 였다"""
        assert 보유.해외코드후보("SPY", "NYSE ARCA") == ["SPY", "SPY.K", "SPY.O"]
        assert 보유.해외코드후보("voo", "") == ["VOO", "VOO.K", "VOO.O"]

    def test_네이버가_알려_준_코드를_맨_앞에_겹치지_않게(self):
        assert 보유.해외코드후보("SCHD", "NYSE ARCA", "SCHD.K") == ["SCHD.K", "SCHD", "SCHD.O"]
        assert 보유.해외코드후보("QQQ", "NASDAQ", "QQQ.O") == ["QQQ.O", "QQQ", "QQQ.K"]

    def test_야후_꼴_줄표는_점으로(self):
        assert 보유.해외코드후보("BRK-B", "NYSE")[0] == "BRK.B"

    def test_빈_것(self):
        assert 보유.해외코드후보("", "") == []
        assert 보유.해외코드후보("", "", "SPY") == []


def _자동완성(*항목):
    return {"query": "x", "items": list(항목)}


def _항목(code, rc, nation="USA"):
    return {"code": code, "name": code, "typeCode": "AMEX", "reutersCode": rc, "nationCode": nation,
            "category": "stock"}


class Test자동완성코드:
    def test_같은_티커의_네이버_코드(self):
        받은 = []

        def 처리(req: httpx.Request):
            받은.append(req)
            return httpx.Response(200, json=_자동완성(_항목("SCHD", "SCHD.K")))

        assert 보유.자동완성코드("schd", _가짜(처리)) == "SCHD.K"
        assert 받은[0].url.copy_with(query=None) == httpx.URL("https://ac.stock.naver.com/ac")
        assert dict(받은[0].url.params) == {"q": "SCHD", "target": "stock"}
        assert 받은[0].headers["Referer"] == "https://stock.naver.com/"

    def test_비슷한_티커는_건너뛴다(self):
        """QQQ 를 물으면 QQQX·QQQA 도 온다 — 앞에 와도 고르지 않는다"""
        답 = _자동완성(_항목("QQQX", "QQQX.O"), _항목("QQQ", "QQQ.O"), _항목("QQQA", "QQQA.O"))
        assert 보유.자동완성코드("QQQ", _가짜(lambda r: httpx.Response(200, json=답))) == "QQQ.O"

    def test_미국_종목만(self):
        답 = _자동완성(_항목("SPY", "SPY.T", nation="JPN"), _항목("SPY", "SPY"))
        assert 보유.자동완성코드("SPY", _가짜(lambda r: httpx.Response(200, json=답))) == "SPY"

    def test_줄표_티커는_점으로도_맞춰_본다(self):
        답 = _자동완성(_항목("BRK.B", "BRKb"))
        assert 보유.자동완성코드("BRK-B", _가짜(lambda r: httpx.Response(200, json=답))) == "BRKb"

    @pytest.mark.parametrize("처리", [
        lambda r: httpx.Response(500, json=_자동완성(_항목("SPY", "SPY"))),
        lambda r: httpx.Response(200, text="<html>"),
        lambda r: httpx.Response(200, json=_자동완성(_항목("SPY", "../../x"))),
        lambda r: httpx.Response(200, json=_자동완성(_항목("SPY", ""))),
        lambda r: httpx.Response(200, json={"items": "x"}),
        lambda r: httpx.Response(200, json=_자동완성("문자열", _항목("SPYX", "SPYX.O"))),
    ])
    def test_못_받으면_None(self, 처리):
        assert 보유.자동완성코드("SPY", _가짜(처리)) is None

    def test_터져도_None(self):
        def 처리(req):
            raise httpx.ConnectError("끊김")
        assert 보유.자동완성코드("SPY", _가짜(처리)) is None

    def test_빈_티커는_묻지_않는다(self):
        assert 보유.자동완성코드("", _가짜(lambda r: pytest.fail("물었다"))) is None


class Test네이버_해외:
    def test_네이버가_알려_준_코드로_바로(self, monkeypatch):
        """SCHD — 자동완성이 'SCHD.K' 를 알려 주면 그것으로 한 번에. 기준일도 같이"""
        monkeypatch.setattr(보유, "_거래소", lambda s: "NYSE ARCA")
        받은 = []

        def 처리(req: httpx.Request):
            받은.append(str(req.url.copy_with(query=None)))
            if req.url.host == "ac.stock.naver.com":
                return httpx.Response(200, json=_자동완성(_항목("SCHD", "SCHD.K")))
            return httpx.Response(200, json=해외실제)

        out = 보유.네이버_해외("SCHD", client=_가짜(처리))
        assert 받은 == ["https://ac.stock.naver.com/ac",
                      "https://stock.naver.com/api/stockSecurity/etfs/v2/foreign/SCHD.K/composition"]
        assert out["source"] == "네이버 증권" and out["as_of"] == "2026-10-31"
        assert [r["symbol"] for r in out["holdings"]][:2] == ["AAPL.O", "NVDA.O"]

    def test_첫_후보가_없으면_다음_후보로(self, monkeypatch):
        monkeypatch.setattr(보유, "_거래소", lambda s: "NYSE ARCA")
        받은 = []

        def 처리(req: httpx.Request):
            if req.url.host == "ac.stock.naver.com":
                return httpx.Response(200, json=_자동완성())        # 자동완성이 모르면 꼴로 짐작한다
            받은.append(str(req.url))
            if req.url.path.endswith("/SOXL/composition"):
                # 없는 코드 — 몸에 뭐가 실려 와도 200 이 아니면 읽지 않는다
                return httpx.Response(404, json={"holdings": [{"stockName": "가짜", "weight": 1.0}]})
            assert req.headers["Referer"] == "https://stock.naver.com/"
            return httpx.Response(200, json={"holdings": [{"stockName": "엔비디아", "symbolCode": "NVDA",
                                                           "weight": "8.0%"}]})

        out = 보유.네이버_해외("SOXL", client=_가짜(처리))
        assert 받은 == ["https://stock.naver.com/api/stockSecurity/etfs/v2/foreign/SOXL/composition",
                      "https://stock.naver.com/api/stockSecurity/etfs/v2/foreign/SOXL.K/composition"]
        assert out["source"] == "네이버 증권" and out["holdings"][0]["name"] == "엔비디아"
        assert "as_of" not in out, "기준일이 없으면 넣지 않는다"

    def test_자동완성이_터져도_꼴로_짐작해_묻는다(self, monkeypatch):
        monkeypatch.setattr(보유, "_거래소", lambda s: "NASDAQ")
        받은 = []

        def 처리(req: httpx.Request):
            if req.url.host == "ac.stock.naver.com":
                raise httpx.ReadTimeout("늦음")
            받은.append(req.url.path.rsplit("/", 2)[-2])
            return httpx.Response(200, json=해외실제)

        assert 보유.네이버_해외("QQQ", client=_가짜(처리))["holdings"]
        assert 받은 == ["QQQ.O"]

    def test_모두_못_받으면_이유(self, monkeypatch):
        monkeypatch.setattr(보유, "_거래소", lambda s: "")
        out = 보유.네이버_해외("GLD", client=_가짜(lambda r: httpx.Response(200, json={"holdings": []})))
        assert out["holdings"] == [] and out["reason"] == "구성종목을 받지 못했습니다"

    def test_터져도_다음_후보로(self, monkeypatch):
        monkeypatch.setattr(보유, "_거래소", lambda s: "")
        차례 = []

        def 처리(req):
            if req.url.host == "ac.stock.naver.com":
                return httpx.Response(200, json=_자동완성(_항목("VOO", "VOO")))
            차례.append(req.url.path.rsplit("/", 2)[-2])
            if len(차례) == 1:
                raise httpx.ConnectError("끊김")       # 구성 묻기가 터진다 — 자동완성이 아니라
            return httpx.Response(200, json={"holdings": [{"name": "A", "weight": 5}]})

        assert 보유.네이버_해외("VOO", client=_가짜(처리))["holdings"][0]["name"] == "A"
        assert 차례 == ["VOO", "VOO.K"]


# ── 눌러서 갈 곳 ───────────────────────────────────────────────

미국전부 = {f"Z{i:04d}" for i in range(보유.미국DB최소)} | {"NVDA", "BRK-B", "SPY"}
국내전부 = {f"9{i:05d}" for i in range(보유.국내DB최소)} | {"005930", "000660", "0126Z0"}


class Test잇기:
    def _잇기(self, 코드들, 미국=미국전부, 국내=국내전부):
        rows = [{"symbol": c, "name": c, "pct": 1.0} for c in 코드들]
        return [(r["symbol"], r["market"]) for r in 보유.잇기(rows, (국내, 미국))]

    def test_국내_DB_에_있는_국내_코드는_국내로(self):
        assert self._잇기(["005930", "0126Z0", "005930.KS"]) == [("005930", "KR"), ("0126Z0", "KR"),
                                                                ("005930", "KR")]

    def test_국내_꼴이어도_국내_DB_에_없으면_누를_수_없게(self):
        """중국 본토 코드(600519)도 6자리 숫자다 — 꼴만 보고 국내로 보내면 엉뚱한 종목이 열린다"""
        assert self._잇기(["600519"]) == [("", None)]

    def test_국내_DB_를_아직_못_읽었으면_국내_꼴만_믿는다(self):
        """내장 목록(115곳)뿐일 때 DB 로 가리면 LG에너지솔루션(373220)도 못 누른다"""
        assert self._잇기(["373220", "0193W0", "2330.TW"], 국내={"005930"}) == [
            ("373220", "KR"), ("0193W0", "KR"), ("", None)]

    def test_미국_DB_에_있으면_미국으로_거래소_꼬리는_떼고(self):
        assert self._잇기(["NVDA", "NVDA.O", "BRK.B", "spy"]) == [("NVDA", "US"), ("NVDA", "US"),
                                                                  ("BRK-B", "US"), ("SPY", "US")]

    def test_현금_ISIN_외국거래소는_누를_수_없게(self):
        assert self._잇기(["", "US0378331005", "2330.TW", "KRD010010001", "CASH"]) == [("", None)] * 5

    def test_원천이_국내_상장이라고_하면_DB_에_없어도_국내로(self):
        """국내 종목 DB 에는 ETF 가 없다 — KODEX 레버리지가 담은 'KODEX 200'(069500)은 DB 로 가리면 못 누른다.
        국내 전체 구성이 ISIN(KR7…)으로 국내 상장이라고 알려 준 줄만 그렇게 한다"""
        rows = [{"symbol": "069500", "name": "KODEX 200", "pct": 19.3, "market": "KR"},
                {"symbol": "069500", "name": "KODEX 200", "pct": 19.3},
                {"symbol": "NVDA.O", "name": "엔비디아", "pct": 7.7, "market": "KR"}]
        assert [(r["symbol"], r["market"]) for r in 보유.잇기(rows, (국내전부, 미국전부))] == [
            ("069500", "KR"), ("", None), ("NVDA", "US")]

    def test_미국_DB_를_아직_못_읽었으면_꼬리_없는_티커_꼴만_믿는다(self):
        assert self._잇기(["NVDA", "AAPL", "NVDA.O", "2330.TW"], 미국={"SPY"}) == [
            ("NVDA", "US"), ("AAPL", "US"), ("", None), ("", None)]

    def test_DB_를_못_읽어도_죽지_않는다(self, monkeypatch):
        from app.services.listings import ticker_service as ts
        monkeypatch.setattr(ts, "get_us_db", lambda: 1 / 0)
        assert 보유._아는종목() == (set(), set())

    def test_종목_DB_를_새로_받지_않는다(self, monkeypatch):
        """get_kr_db() 는 비어 있으면 바깥에서 받아 온다 — 보유비중 한 번 보려고 그러면 안 된다"""
        from app.services.listings import ticker_service as ts
        monkeypatch.setattr(ts, "get_kr_db", lambda: pytest.fail("국내 종목 DB 를 새로 받으려 했다"))
        monkeypatch.setattr(ts, "_kr_db", [{"c": "005930", "s": "005930.KS", "m": "KR"}])
        monkeypatch.setattr(ts, "get_us_db", lambda: [{"s": "NVDA", "m": "US"}, {"s": "SPY", "m": "ETF"},
                                                      {"s": "005930.KS", "m": "KR"}])
        assert 보유._아는종목() == ({"005930"}, {"NVDA", "SPY"})


# ── 라우트 전체 흐름 ──────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient
    from app.api.routes.stocks import _공용
    from app.core.cache import cache
    from app.main import app
    _공용.limiter.reset()
    for s in ("0193W0", "069500", "QQQ", "SPY", "GLD"):
        cache.delete(f"etf_holdings:{s}")
    monkeypatch.setattr(보유, "_아는종목", lambda: (국내전부, 미국전부))
    return TestClient(app)


def _가짜야후(monkeypatch, 상위=None, 섹터=None, 막힘=False):
    """yfinance 대신 — 막힘이면 운영 서버처럼 상세(funds_data·info)가 터진다"""
    불림 = []

    class 펀드:
        @property
        def top_holdings(self):
            if 막힘:
                raise RuntimeError("401 Invalid Crumb")
            return 상위 if 상위 is not None else pd.DataFrame()

        @property
        def sector_weightings(self):
            return 섹터 or {}

    class 종목:
        def __init__(self, s):
            불림.append(s)

        @property
        def funds_data(self):
            if 막힘:
                raise RuntimeError("401 Invalid Crumb")
            return 펀드()

        @property
        def info(self):
            raise RuntimeError("401 Invalid Crumb")

    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(Ticker=종목))
    return 불림


def _KRX_가짜(monkeypatch, 답):
    """flows 안에서 여는 httpx.Client 를 가짜 전송으로 — KRX 에 무엇을 물었는지 남긴다"""
    물음 = []
    원래 = httpx.Client

    def 처리(req):
        물음.append(str(req.url))
        return 답(req)

    monkeypatch.setattr(httpx, "Client", lambda **k: 원래(transport=httpx.MockTransport(처리)))
    return 물음


class Test라우트:
    def test_영문_섞인_국내_코드도_네이버로_받고_야후에_묻지_않는다(self, client, monkeypatch):
        야후 = _가짜야후(monkeypatch)
        받은코드 = []

        def 네이버(코드, client=None):
            받은코드.append(코드)
            return {"holdings": [{"symbol": "005930", "name": "삼성전자", "pct": 20.0, "value": 0.0},
                                 {"symbol": "NVDA.O", "name": "엔비디아", "pct": 10.0, "value": 0.0},
                                 {"symbol": "", "name": "원화예금", "pct": 1.0, "value": 0.0}],
                    "sector_weights": [], "source": "네이버 증권"}

        monkeypatch.setattr(보유, "네이버_국내", 네이버)
        물음 = _KRX_가짜(monkeypatch, lambda r: pytest.fail("네이버가 줬는데 KRX 에 물었다"))
        r = client.get("/api/v1/stocks/ETF/0193W0/holdings")
        assert r.status_code == 200
        j = r.json()
        assert 받은코드 == ["0193W0"] and 야후 == [] and 물음 == []
        assert [(h["name"], h["symbol"], h["market"]) for h in j["holdings"]] == [
            ("삼성전자", "005930", "KR"), ("엔비디아", "NVDA", "US"), ("원화예금", "", None)]
        assert j["source"] == "네이버 증권"

    def test_해외주식_담은_국내_ETF_도_전체_구성으로_화면까지(self, client, monkeypatch):
        """TIGER 미국S&P500 이 비던 것 — 전체 구성으로 받고, 해외 종목은 미국으로, 국내 상장 ETF 는 국내로 잇는다.
        전체 개수와 기준일도 화면까지 간다. 진짜 네이버_국내 가 돈다(가짜 전송만)"""
        _가짜야후(monkeypatch)
        from app.core.cache import cache
        cache.delete("etf_holdings:360750")
        줄들 = [*미국담은국내, _구성줄("360750", "KODEX 200", "1.0", 국내="069500", isin="KR7069500007")]
        물음 = _KRX_가짜(monkeypatch, lambda r: httpx.Response(200, json=줄들) if "ETFComponent" in r.url.path
                         else pytest.fail(f"전체 구성이 있는데 또 물었다: {r.url}"))
        j = client.get("/api/v1/stocks/ETF/360750/holdings").json()
        assert [(h["name"], h["symbol"], h["market"]) for h in j["holdings"]] == [
            ("엔비디아", "NVDA", "US"), ("애플", "", None), ("마이크로소프트", "", None),
            ("KODEX 200", "069500", "KR")]
        assert (j["total"], j["as_of"], j["source"]) == (504, "2026-11-05", "네이버 증권")
        assert len(물음) == 1

    def test_미국_뉴욕아카_ETF_도_네이버_코드로_받아_티커까지(self, client, monkeypatch):
        """SCHD·ARKK 가 비던 것 — 네이버 코드가 'SCHD.K' 다. 자동완성으로 알아내 묻고, 티커는 meta 에서 읽는다"""
        _가짜야후(monkeypatch, 막힘=True)
        from app.core.cache import cache
        cache.delete("etf_holdings:SCHD")
        monkeypatch.setattr(보유, "_거래소", lambda s: "NYSE ARCA")

        def 처리(r):
            if r.url.host == "ac.stock.naver.com":
                return httpx.Response(200, json=_자동완성(_항목("SCHD", "SCHD.K")))
            if r.url.path.endswith("/SCHD.K/composition"):
                return httpx.Response(200, json=해외실제)
            return httpx.Response(404, json={})

        _KRX_가짜(monkeypatch, 처리)
        j = client.get("/api/v1/stocks/ETF/SCHD/holdings").json()
        assert [(h["name"], h["symbol"], h["market"]) for h in j["holdings"]][:2] == [
            ("Apple Inc.", "", None), ("NVIDIA Corporation", "NVDA", "US")]
        assert j["source"] == "네이버 증권" and j["as_of"] == "2026-10-31"

    def test_네이버가_못_주면_KRX_로그인_요구를_알아보고_네이버의_이유를(self, client, monkeypatch, caplog):
        monkeypatch.setattr(보유, "네이버_국내",
                            lambda 코드, client=None: {"holdings": [], "sector_weights": [],
                                                      "reason": "네이버 증권에서 구성종목을 받지 못했습니다"})
        from app.core.cache import cache
        cache.delete("krx_etf_isin")
        물음 = _KRX_가짜(monkeypatch, lambda r: httpx.Response(400, text="LOGOUT"))
        with caplog.at_level(logging.WARNING):
            r = client.get("/api/v1/stocks/ETF/069500/holdings")
        assert r.status_code == 200
        j = r.json()
        assert j["holdings"] == [] and j["reason"] == "네이버 증권에서 구성종목을 받지 못했습니다"
        assert len(물음) == 1 and "data.krx.co.kr" in 물음[0], "LOGOUT 을 받고도 더 물었다"
        assert "로그인" in caplog.text

    def test_네이버가_못_주고_KRX_가_주면_KRX(self, client, monkeypatch):
        monkeypatch.setattr(보유, "네이버_국내",
                            lambda 코드, client=None: {"holdings": [], "sector_weights": [], "reason": "x"})
        from app.core.cache import cache
        cache.delete("krx_etf_isin")

        def 답(req):
            몸 = req.content.decode()
            if "MDCSTAT04601" in 몸:
                return httpx.Response(200, json={"output": [{"ISU_SRT_CD": "0193W0", "ISU_CD": "KR70193W0001"}]})
            return httpx.Response(200, json={"output": [
                {"COMPST_ISU_CD": "000660", "COMPST_ISU_NM": "SK하이닉스", "COMPST_RTO": "30.5", "COMPST_AMT": "1,000"},
                {"COMPST_ISU_CD": "KRD010010001", "COMPST_ISU_NM": "원화예금", "COMPST_RTO": "0", "COMPST_AMT": "5"},
                {"COMPST_ISU_CD": "0126Z0", "COMPST_ISU_NM": "삼성에피스홀딩스", "COMPST_RTO": "12", "COMPST_AMT": "7"},
                {"COMPST_ISU_CD": "US67066G1040", "COMPST_ISU_NM": "NVIDIA", "COMPST_RTO": "10", "COMPST_AMT": "9"}]})

        _KRX_가짜(monkeypatch, 답)
        j = client.get("/api/v1/stocks/ETF/0193W0/holdings").json()
        assert j["source"] == "한국거래소"
        # 영문이 섞인 구성종목 코드(0126Z0)도 국내로 — 숫자만 받던 때는 누를 수 없었다
        assert [(h["name"], h["symbol"], h["market"]) for h in j["holdings"]] == [
            ("SK하이닉스", "000660", "KR"), ("삼성에피스홀딩스", "0126Z0", "KR"), ("NVIDIA", "", None)]

    def test_미국_야후가_막혀도_네이버로(self, client, monkeypatch):
        _가짜야후(monkeypatch, 막힘=True)
        monkeypatch.setattr(보유, "네이버_해외", lambda s, client=None: {
            "holdings": [{"symbol": "NVDA.O", "name": "엔비디아", "pct": 9.0, "value": 0.0}],
            "sector_weights": [], "source": "네이버 증권"})
        j = client.get("/api/v1/stocks/ETF/QQQ/holdings").json()
        assert [(h["name"], h["symbol"], h["market"]) for h in j["holdings"]] == [("엔비디아", "NVDA", "US")]
        assert j["source"] == "네이버 증권"

    def test_미국_야후가_주면_야후를_쓰고_섹터도(self, client, monkeypatch):
        상위 = pd.DataFrame({"Name": ["NVIDIA Corp", "Apple Inc"], "Holding Percent": [0.09, 0.08]},
                          index=["NVDA", "AAPL"])
        _가짜야후(monkeypatch, 상위=상위, 섹터={"technology": 0.5, "healthcare": 0.1})
        monkeypatch.setattr(보유, "네이버_해외", lambda s, client=None: {
            "holdings": [{"symbol": "X", "name": "네이버것", "pct": 1.0, "value": 0.0}],
            "sector_weights": [], "source": "네이버 증권"})
        j = client.get("/api/v1/stocks/ETF/SPY/holdings").json()
        assert [h["name"] for h in j["holdings"]] == ["NVIDIA Corp", "Apple Inc"]
        assert [h["pct"] for h in j["holdings"]] == pytest.approx([9.0, 8.0])
        assert j["source"] == "야후 파이낸스"
        assert j["sector_weights"][0] == {"sector": "technology", "pct": pytest.approx(50.0)}

    def test_미국_둘_다_못_주면_이유와_함께_200(self, client, monkeypatch):
        _가짜야후(monkeypatch, 막힘=True)
        monkeypatch.setattr(보유, "네이버_해외",
                            lambda s, client=None: {"holdings": [], "sector_weights": [],
                                                    "reason": "네이버 쪽 이유"})
        r = client.get("/api/v1/stocks/ETF/GLD/holdings")
        assert r.status_code == 200
        assert r.json() == {"holdings": [], "sector_weights": [], "reason": "네이버 쪽 이유"}

    def test_미국_이유가_하나도_없으면_기본_이유(self, client, monkeypatch):
        """네이버 쪽이 시한에 걸려 빈 결과(이유 없음)만 와도 화면에는 한 문장이 간다"""
        _가짜야후(monkeypatch, 막힘=True)
        monkeypatch.setattr(보유, "네이버_해외", lambda s, client=None: {"holdings": [], "sector_weights": []})
        assert client.get("/api/v1/stocks/ETF/GLD/holdings").json()["reason"] == "구성종목을 받지 못했습니다"

    def test_시한을_넘겨도_500_이_아니다(self, client, monkeypatch):
        """_run 은 15초에서 자른다. 감싸지 않으면 그 예외가 그대로 올라가 500 이 되고, 화면에는
        '불러올 수 없습니다' 가 뜬다 — 사실은 '아직 못 받았다' 인데"""
        from app.api.routes.stocks import flows

        async def 늦음(fn, *a):
            raise asyncio.TimeoutError

        monkeypatch.setattr(flows, "_run", 늦음)
        for s in ("069500", "QQQ"):
            r = client.get(f"/api/v1/stocks/ETF/{s}/holdings")
            assert r.status_code == 200 and r.json()["holdings"] == []

    def test_받은_것은_1시간_못_받은_것은_5분(self, client, monkeypatch):
        from app.core.cache import cache
        기록 = {}
        원래 = cache.set
        monkeypatch.setattr(cache, "set", lambda k, v, ttl=60: (기록.__setitem__(k, ttl), 원래(k, v, ttl)))
        monkeypatch.setattr(보유, "네이버_국내", lambda 코드, client=None: {
            "holdings": [{"symbol": "005930", "name": "삼성전자", "pct": 20.0, "value": 0.0}],
            "sector_weights": []})
        client.get("/api/v1/stocks/ETF/0193W0/holdings")
        _가짜야후(monkeypatch, 막힘=True)
        monkeypatch.setattr(보유, "네이버_해외",
                            lambda s, client=None: {"holdings": [], "sector_weights": [], "reason": "x"})
        client.get("/api/v1/stocks/ETF/GLD/holdings")
        assert 기록["etf_holdings:0193W0"] == 3600 and 기록["etf_holdings:GLD"] == 300


# ── 구조 — 예전에 헛짚었던 자리 ─────────────────────────────────────

class Test구조:
    def test_국내_폴백_함수가_있다(self):
        """네이버가 비면 KRX 를 보는 자리. 이름은 뉴스 쪽 _fetch_kr 과 겹치지 않게 따로 둔다."""
        본문 = _보유비중구간()
        assert "def _fetch_kr_holdings" in 본문, "국내 폴백 함수가 없다"
        assert "_받기(_fetch_kr_holdings)" in 본문, "폴백을 부르지 않는다"

    def test_pykrx_를_거치지_않는다(self):
        본문 = _코드만(_보유비중구간())
        assert "pykrx" not in 본문, "다시 pykrx 를 타고 있다"
        assert "get_etf_portfolio_deposit_file" not in 본문

    def test_KRX_는_https_와_브라우저_헤더로(self):
        본문 = _코드만(_보유비중구간())
        assert "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd" in 본문
        assert "http://data.krx.co.kr" not in 본문, "http 로 부르고 있다"
        assert "User-Agent" in 본문 and "Referer" in 본문, "브라우저 헤더가 없다"

    def test_KRX_두_단계를_모두_부른다(self):
        본문 = _코드만(_보유비중구간())
        assert "MDCSTAT04601" in 본문 and "MDCSTAT05001" in 본문

    def test_ISIN_목록을_매번_받지_않는다(self):
        본문 = _코드만(_보유비중구간())
        assert 'cache.get("krx_etf_isin")' in 본문 and "86400" in 본문

    def test_결과_배열_이름을_가려_읽는다(self):
        본문 = _코드만(_보유비중구간())
        for 이름 in ("output", "block1", "OutBlock_1"):
            assert f'"{이름}"' in 본문, f"{이름} 을 안 본다"

    def test_수급_조회는_원래_순서가_맞다(self):
        """get_market_trading_value_by_date(fromdate, todate, ticker)"""
        호출 = _호출들("get_market_trading_value_by_date")
        assert 호출, "수급 조회가 사라졌다"
        인자 = [ast.unparse(a) for a in 호출[0].args]
        assert "start" in 인자[0] and "end" in 인자[1] and "code" in 인자[2], 인자

    def test_빈_결과에_이유를_남긴다(self):
        본문 = _보유비중구간()
        assert "ETF 구성종목 조회 실패" in 본문 and "ETF 구성종목 없음" in 본문
        assert 본문.count("log.warning") >= 3, "실패 자리마다 이유를 남겨야 한다"

    def test_내부_사정을_화면에_보내지_않는다(self):
        """reason 은 사람이 읽는 한 문장이어야 한다 — 예외 이름·스택은 로그에만"""
        for 원문 in (_보유비중구간(), pathlib.Path(보유.__file__).read_text(encoding="utf-8")):
            for m in re.finditer(r'"reason": ([^,\n}]+)|_빈것\(([^)]*)\)', 원문):
                값 = m.group(1) or m.group(2) or ""
                assert "type(e)" not in 값 and "str(e)" not in 값 and "__name__" not in 값, 값

    def test_성공했을_때도_개수를_남긴다(self):
        assert "log.info" in _보유비중구간()

    def test_KRX_구성종목_이름은_KRX_가_같이_준다(self):
        본문 = _코드만(_보유비중구간())
        assert "get_market_ticker_name" not in 본문
        assert "COMPST_ISU_NM" in 본문

    def test_날짜_되짚기가_지나치지_않다(self):
        m = re.search(r"range\(0, (\d+)\)", _보유비중구간())
        assert m and int(m.group(1)) <= 5
