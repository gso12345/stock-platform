"""해외 회사 시가총액(나라 돈 → 달러)과 메뉴끼리 같은 값 — 사용자:
  "대시보드 순위표에 Sk하이닉스 TSMC 해외 시총이 달러랑 안맞아"
  "메뉴마다 연동좀해줘 같은회사 같은지표 데이터여도 어떤 메뉴에는 나오는데 어떤 메뉴에는 아예 안나와"

야후는 일부 해외 회사(TSMC·SK하이닉스 ADR·도쿄일렉트론)의 시가총액을 그 회사 장부의 돈으로 준다 — 사진의
스크리닝이 SK하이닉스 ADR 1,232,442조 원(929조 '달러'), TSMC 82,023조 원(61.86조), 도쿄일렉트론 16,412조 원
(12.38조)이었다. 이 값을 가리는 규칙(foreign_cap)과, 그 규칙을 쓰는 세 곳(스크리닝 표·대시보드 해외 순위·종목
상세)이 같은 값을 내는지 본다. 바깥(야후·나스닥)은 부르지 않는다.
"""
import asyncio

import numpy as np
import pandas as pd
import pytest

from app.core import health
from app.core.cache import cache
from app.services.market import foreign_cap as F
from app.services.market import ranking_service as R
from app.services.screening import service as S
from app.services.screening.table import 만들기, 원천표


# ── 규칙(foreign_cap) ─────────────────────────────────────────

class Test상한:
    def test_세_번째로_큰_미국_회사의_두_배(self):
        assert F.상한([5e12, 4e12, 3e12, 1e12]) == 6e12
        assert F.상한(v for v in (1e12, 3e12, 2e12)) == 2e12, "차례와 상관없다"

    def test_세_곳이_안_되면_모른다(self):
        assert F.상한([5e12, 4e12]) is None

    def test_모르는_값과_0_이하는_세지_않는다(self):
        assert F.상한([5e12, None, float("nan"), -1.0, 0, "x", 4e12, 1e12]) == 2e12


class Test흠:
    def test_상한을_넘는다(self):
        assert F.흠(8.1e12, 상한값=8e12) == 1 and F.흠(8e12, 상한값=8e12) == 0

    def test_닻과_3배_넘게_다르다_위로도_아래로도(self):
        assert F.흠(3.1e11, 닻=1e11) == 0 and F.흠(3.2e11, 닻=1e11) == 1
        assert F.흠(1e11 / 3.1, 닻=1e11) == 0 and F.흠(1e11 / 3.2, 닻=1e11) == 1

    def test_큰_값의_매출_60배(self):
        assert F.흠(6.0e10, 매출=1e9) == 0 and F.흠(6.1e10, 매출=1e9) == 1
        assert F.흠(5.0e10, 매출=1e8) == 1, "500억 달러부터 큰 값"
        assert F.흠(4.9e10, 매출=1e8) == 0, "작은 회사는 P/S 가 수백이어도 정상이다"

    def test_매출의_1퍼센트도_안_되면_크기와_상관없이(self):
        assert F.흠(1e9, 매출=1e11) == 0 and F.흠(0.99e9, 매출=1e11) == 1

    def test_큰_값의_순이익_500배(self):
        assert F.흠(5.0e11, 순이익=1e9) == 0 and F.흠(5.1e11, 순이익=1e9) == 1
        assert F.흠(4.9e10, 순이익=1e7) == 0, "작은 회사는 보지 않는다"

    def test_흠은_더해진다(self):
        assert F.흠(61.86e12, 닻=2.27e12, 매출=1.22e11, 순이익=5.2e10, 상한값=8e12) == 4


class Test고르기:
    상한값 = 8e12

    def test_TSMC_대만_달러를_환율로(self):
        assert F.고르기(61.86e12, 환율=1 / 30, 매출=1.22e11, 순이익=5.2e10, 상한값=self.상한값) == \
            pytest.approx(61.86e12 / 30)

    def test_바꾼_값과_닻이_둘_다_맞으면_바꾼_값(self):
        """닻(나스닥 ADR 주식 수 × 시세)은 ADR 웃돈만큼 다를 수 있다 — 장부 돈으로 바꾼 회사 전체 값이 먼저"""
        assert F.고르기(61.86e12, 환율=1 / 30, 닻=2.27e12, 매출=1.22e11, 상한값=self.상한값) == \
            pytest.approx(61.86e12 / 30)

    def test_SK하이닉스_ADR_원화(self):
        assert F.고르기(929.4e12, 환율=1 / 1326, 닻=1.0e12, 상한값=self.상한값) == pytest.approx(929.4e12 / 1326)

    def test_상한_아래로_와도_매출과_순이익으로_가린다(self):
        """엔으로 온 5조 '달러' — 상한(8조) 안쪽이지만 매출의 300배다"""
        assert F.고르기(5e12, 환율=1 / 150, 매출=1.6e10, 순이익=3.5e9, 상한값=self.상한값) == \
            pytest.approx(5e12 / 150)

    def test_멀쩡한_달러는_그대로(self):
        assert F.고르기(2.5e11, 환율=1 / 150, 닻=2.5e11, 매출=3e11, 순이익=3e10, 상한값=self.상한값) == 2.5e11, "토요타"
        assert F.고르기(2.5e11, 환율=1 / 150, 매출=3e11, 상한값=self.상한값) == 2.5e11, "닻이 없어도 — 바꾸면 매출의 1% 도 안 된다"
        assert F.고르기(3e11, 환율=1.08, 매출=3e10, 순이익=8e9, 상한값=self.상한값) == 3e11, "유로 — 둘 다 맞으면 받은 값"
        assert F.고르기(2e9, 환율=1 / 150, 매출=1e8, 상한값=self.상한값) == 2e9, "매출이 작은 작은 회사"

    def test_ADR_비율로_부풀린_값은_닻(self):
        """원주 수 × ADR 시세(5배) — 바꿔도(대만 달러로 보고 나누면) 닻과 6배 어긋나 닻이 남는다"""
        assert F.고르기(1.13e13, 환율=1 / 30.5, 닻=2.27e12, 매출=1.22e11, 순이익=5.2e10, 상한값=self.상한값) == 2.27e12

    def test_닻만_다르면_닻(self):
        """환율·매출을 모르고 상한 안쪽이어도 — 주식 수로 낸 값과 5배 어긋나면 받은 값이 다른 것을 센 것이다"""
        assert F.고르기(1e12, 닻=2e11, 상한값=self.상한값) == 2e11
        assert F.고르기(1e12, 닻=4e11, 상한값=self.상한값) == 1e12, "3배 안쪽이면 받은 값"

    def test_바꿀_길이_없으면_모른다(self):
        assert F.고르기(929.4e12, 상한값=self.상한값) is None
        assert F.고르기(929.4e12, 환율=1.0, 상한값=self.상한값) is None, "환율 1 은 바꿀 후보가 아니다"

    def test_상한을_모르면_가릴_근거가_없다(self):
        assert F.고르기(929.4e12) == 929.4e12

    def test_받은_값이_없으면_닻(self):
        assert F.고르기(None, 닻=1e11) == 1e11 and F.고르기(0, 닻=1e11) == 1e11 and F.고르기(None) is None
        assert F.고르기(float("nan"), 닻=1e11) == 1e11


# ── 스크리닝 표 ────────────────────────────────────────────────

#: 미국 회사 셋 — 상한 3.5조 × 2 = 7조
_미국 = [{"symbol": s, "price": 100.0, "market_cap": c, "country": "United States"}
        for s, c in (("NVDA", 5e12), ("AAPL", 4e12), ("MSFT", 3.5e12))]
_TSM_SEC = {"revenue": 1.2e11, "earnings": 5e10, "eps": 2.0, "equity": 1.0e11, "foreign": 1.0, "fin_fx": "TWD"}


def _줄들(표, n=20):
    return {x["symbol"]: x for x in 표.결과({}, "", "market_cap", True, 0, n)[0]}


class Test표_해외_시가총액:
    def test_TSMC_대만_달러를_달러로_바꾸고_PER_PSR_도_그_값으로(self):
        표 = 만들기("US", _미국 + [{"symbol": "TSM", "price": 300.0, "market_cap": 61.86e12, "country": "Taiwan"}], [],
                  {"us_sec": 원천표("us_sec", {"TSM": _TSM_SEC}), "us_fx": 원천표("us_fx", {"TWD": {"usd": 1 / 30}})})
        t = _줄들(표)["TSM"]
        시총 = 61.86e12 / 30
        assert t["market_cap"] == round(시총)
        assert t["eps"] == round(300 * 5e10 / 시총, 4), "ADR 1주의 EPS = 시세 × 순이익 ÷ 시가총액"
        assert t["per"] == round(300 / t["eps"], 2) and t["ps_ratio"] == round(시총 / 1.2e11, 2)
        assert t["pbr"] == round(시총 / 1.0e11, 2)
        assert 표.시총바꿈 == {"TSM": "TWD"}
        assert list(_줄들(표))[:4] == ["NVDA", "AAPL", "MSFT", "TSM"], "1·2위에 서지 않는다"

    def test_SEC_의_장부_돈이_야후_줄의_짐작보다_먼저(self):
        """야후 상세가 막힌 회차의 줄은 장부 돈을 모른다(예전엔 'USD' 로 짐작했다)"""
        풍 = [{"symbol": "TSM", "price": 300.0, "market_cap": 61.86e12, "fin_currency": "USD"}]
        표 = 만들기("US", _미국 + [{"symbol": "TSM", "price": 300.0, "country": "Taiwan"}], 풍,
                  {"us_sec": 원천표("us_sec", {"TSM": _TSM_SEC}), "us_fx": 원천표("us_fx", {"TWD": {"usd": 1 / 30}})})
        assert 표.한줄("TSM")["market_cap"] == pytest.approx(61.86e12 / 30)

    def test_야후_줄의_엔_장부는_매출로_가리고_PSR_을_다시_나눈다(self):
        """도쿄일렉트론(장외 ADR) — SEC 도 나스닥 분류도 없다. 야후가 장부 돈(엔)을 알려 준다"""
        풍 = [{"symbol": "TOELY", "price": 172.0, "market_cap": 12.38e12, "fin_currency": "JPY", "country": "Japan",
               "revenue": 1.6e10, "earnings": 3.5e9, "ps_ratio": 773.75}]
        표 = 만들기("US", _미국, 풍, {"us_fx": 원천표("us_fx", {"JPY": {"usd": 1 / 150}})})
        t = 표.한줄("TOELY")
        assert t["market_cap"] == pytest.approx(12.38e12 / 150)
        assert t["ps_ratio"] == round(12.38e12 / 150 / 1.6e10, 2), "그 나라 돈 시가총액으로 나눈 P/S 는 버린다"
        assert 표.시총바꿈 == {"TOELY": "JPY"}

    def test_매출을_모르면_야후의_PSR_을_둔다(self):
        """다른 종목엔 매출이 있어 매출 칸은 있다 — 그 종목만 모른다"""
        풍 = [{"symbol": "TOELY", "price": 172.0, "market_cap": 12.38e12, "fin_currency": "JPY", "country": "Japan",
               "ps_ratio": 5.2},
              {"symbol": "NVDA", "revenue": 1.3e11}]
        표 = 만들기("US", _미국, 풍, {"us_fx": 원천표("us_fx", {"JPY": {"usd": 1 / 150}})})
        assert 표.한줄("TOELY")["ps_ratio"] == 5.2 and 표.시총바꿈 == {"TOELY": "JPY"}

    def test_국내_ADR_은_원주_주식_수가_닻(self):
        """SK하이닉스 ADR(10주 = 원주 1주) — 원화 환율을 모르면 원주 주식 수 × 10 × ADR 시세"""
        원주 = {"price": 1_276_600.0, "market_cap": 929.4e12}
        기초 = _미국 + [{"symbol": "SKHY", "price": 145.0, "market_cap": 929.4e12, "country": "South Korea"}]
        표 = 만들기("US", 기초, [], {"kr_adr": {"SKHY": 원주}})
        assert 표.한줄("SKHY")["market_cap"] == pytest.approx(929.4e12 / 1_276_600 / 0.1 * 145)
        assert 표.시총바꿈 == {"SKHY": "닻"}
        # 환율을 알면 원화로 바꾼 값 — 닻과 3배 안쪽이니 바꾼 값이 먼저
        표 = 만들기("US", 기초, [], {"kr_adr": {"SKHY": 원주}, "us_fx": 원천표("us_fx", {"KRW": {"usd": 1 / 1326}})})
        assert 표.한줄("SKHY")["market_cap"] == pytest.approx(929.4e12 / 1326) and 표.시총바꿈 == {"SKHY": "KRW"}

    def test_나스닥_주식_수가_닻(self):
        기초 = _미국 + [{"symbol": "TSM", "price": 300.0, "market_cap": 61.86e12, "country": "Taiwan"}]
        표 = 만들기("US", 기초, [], {"us_sec": 원천표("us_sec", {"TSM": _TSM_SEC}), "us_shares": {"TSM": 5.2e9}})
        assert 표.한줄("TSM")["market_cap"] == pytest.approx(5.2e9 * 300) and 표.시총바꿈 == {"TSM": "닻"}

    def test_장부_돈을_모르는_해외_종목이_상한을_넘으면_비운다(self):
        """야후 상세가 막힌 장외 ADR — 바꿀 환율도 닻도 없다. 1위에 세우느니 빈칸"""
        표 = 만들기("US", _미국, [{"symbol": "OTCX", "price": 10.0, "market_cap": 9e12}], {})
        assert "market_cap" not in 표.한줄("OTCX") and 표.시총바꿈 == {"OTCX": "모름"}
        assert list(_줄들(표))[:3] == ["NVDA", "AAPL", "MSFT"]

    def test_상한은_미국_회사로만_낸다(self):
        """그 나라 돈으로 온 장외 종목 둘이 위에 서도 상한(세 번째로 큰 것의 두 배)이 부풀지 않게"""
        풍 = [{"symbol": "OTCX", "price": 10.0, "market_cap": 9e12}, {"symbol": "OTCY", "price": 10.0, "market_cap": 8e12}]
        표 = 만들기("US", _미국, 풍, {})
        assert 표.시총바꿈 == {"OTCX": "모름", "OTCY": "모름"}

    def test_야후_줄의_나라도_본다(self):
        """나스닥 분류(기초 줄)에 없는 미국 회사 — 야후 줄이 미국이라고 하면 커도 비우지 않는다"""
        풍 = [{"symbol": "BIGUS", "price": 10.0, "market_cap": 9e12, "country": "United States"}]
        표 = 만들기("US", _미국, 풍, {})
        assert 표.한줄("BIGUS")["market_cap"] == 9e12 and 표.시총바꿈 == {}

    def test_나라를_모르면_크기로는_가리지_않는다(self):
        """나스닥 분류를 못 받아 나라가 다 비면 미국 대형주도 '미국 회사가 아닌 곳' 이 된다 — 비우면 안 된다"""
        기초 = [{k: v for k, v in r.items() if k != "country"} for r in _미국]
        표 = 만들기("US", 기초 + [{"symbol": "GOOGL", "price": 250.0, "market_cap": 3e13}], [], {})
        assert 표.한줄("GOOGL")["market_cap"] == 3e13 and 표.시총바꿈 == {}

    def test_미국_회사는_커도_건드리지_않는다(self):
        표 = 만들기("US", _미국 + [{"symbol": "HUGE", "price": 1.0, "market_cap": 2e13, "country": "United States"}],
                  [], {})
        assert 표.한줄("HUGE")["market_cap"] == 2e13 and 표.시총바꿈 == {}

    def test_멀쩡한_해외_회사는_그대로(self):
        기초 = _미국 + [{"symbol": "ASML", "price": 800.0, "market_cap": 3e11, "country": "Netherlands"}]
        풍 = [{"symbol": "ASML", "fin_currency": "EUR", "revenue": 3e10}]
        표 = 만들기("US", 기초, 풍, {"us_fx": 원천표("us_fx", {"EUR": {"usd": 1.08}})})
        assert 표.한줄("ASML")["market_cap"] == 3e11 and 표.시총바꿈 == {}

    def test_국내_시장은_건드리지_않는다(self):
        표 = 만들기("KR", [{"symbol": "005930", "price": 70000.0, "market_cap": 4.3e14}], [], {})
        assert 표.한줄("005930")["market_cap"] == 4.3e14 and 표.시총바꿈 == {}


class Test서비스:
    @pytest.fixture
    def 표하나(self, monkeypatch):
        기초 = _미국 + [{"symbol": "TSM", "price": 300.0, "market_cap": 61.86e12, "country": "Taiwan"}]
        표 = 만들기("US", 기초, [{"symbol": "OTCX", "price": 10.0, "market_cap": 9e12}],
                  {"us_sec": 원천표("us_sec", {"TSM": _TSM_SEC}), "us_fx": 원천표("us_fx", {"TWD": {"usd": 1 / 30}})})
        monkeypatch.setattr(S, "_표", {"US": 표})
        return 표

    def test_바로잡은_종목의_주식_수_비운_곳은_0(self, 표하나):
        주식수 = S.해외시총_주식수()
        assert 주식수 == {"TSM": pytest.approx(61.86e12 / 30 / 300), "OTCX": 0.0}

    def test_시세를_모르는_줄은_주식_수를_못_낸다(self, monkeypatch):
        표 = 만들기("US", _미국, [{"symbol": "OTCX", "market_cap": 9e12, "fin_currency": "JPY"}],
                  {"us_fx": 원천표("us_fx", {"JPY": {"usd": 1 / 150}})})
        assert 표.시총바꿈 == {"OTCX": "JPY"}
        monkeypatch.setattr(S, "_표", {"US": 표})
        assert S.해외시총_주식수() == {}

    def test_표가_없거나_고친_곳이_없으면_빈_것(self, monkeypatch):
        monkeypatch.setattr(S, "_표", {})
        assert S.해외시총_주식수() == {}
        monkeypatch.setattr(S, "_표", {"US": 만들기("US", _미국, [], {})})
        assert S.해외시총_주식수() == {}

    def test_표를_지을_때_나스닥_주식_수를_닻으로_넘기고_고친_곳을_관리자_화면에(self, monkeypatch):
        받은 = {}

        def 가짜만들기(시장, 기초, 풍부, 원천):
            받은.update(원천)
            return 만들기(시장, 기초, 풍부, 원천)
        monkeypatch.setattr(S, "만들기", 가짜만들기)
        monkeypatch.setattr(S, "기초줄", lambda 시장: _미국 + [
            {"symbol": "TSM", "price": 300.0, "market_cap": 61.86e12, "country": "Taiwan"}])
        monkeypatch.setattr(S, "_표", {})
        monkeypatch.setattr(S, "_표판", {})
        monkeypatch.setattr(R, "_주식수", {"TSM": 5.2e9})
        health.reset()
        S._짓기("US", [], (0, 0, 0))
        assert 받은["us_shares"] == {"TSM": 5.2e9}
        기록 = {r["name"]: r for r in health.snapshot()}[S.이름_시총]
        assert 기록["detail"] == "1곳 고침 — TSM(닻)"
        # 고친 곳이 없으면 그렇다고
        monkeypatch.setattr(S, "기초줄", lambda 시장: list(_미국))
        S._짓기("US", [], (0, 0, 0))
        assert {r["name"]: r for r in health.snapshot()}[S.이름_시총]["detail"] == "고친 곳 없음(모두 달러로 옴)"

    def test_관리자_화면_글은_열두_곳까지(self, monkeypatch):
        health.reset()
        표 = 만들기("US", _미국, [], {})
        표.시총바꿈 = {f"T{i:02d}": "JPY" for i in range(13)}
        S._시총바꿈_남기기(표)
        글 = {r["name"]: r for r in health.snapshot()}[S.이름_시총]["detail"]
        assert 글.startswith("13곳 고침 — T00(JPY) · T01(JPY)") and "T11(JPY) …" in 글 and "T12" not in 글
        표.시총바꿈 = {f"T{i:02d}": "JPY" for i in range(12)}
        S._시총바꿈_남기기(표)
        assert {r["name"]: r for r in health.snapshot()}[S.이름_시총]["detail"].endswith("T11(JPY)"), "다 적었으면 … 없이"

    def test_국내_표는_남기지_않는다(self, monkeypatch):
        monkeypatch.setattr(S, "기초줄", lambda 시장: [{"symbol": "005930", "price": 1.0}])
        monkeypatch.setattr(S, "_표", {})
        monkeypatch.setattr(S, "_표판", {})
        health.reset()
        S._짓기("KR", [], (0, 0, 0))
        assert S.이름_시총 not in {r["name"] for r in health.snapshot()}


# ── 대시보드 해외 순위 ─────────────────────────────────────────

_분류 = {"NVDA": ("기술", "", "United States"), "AAPL": ("기술", "", "United States"),
         "MSFT": ("기술", "", "United States"), "TSM": ("기술", "", "Taiwan"), "SKHY": ("기술", "", "South Korea"),
         "ASML": ("기술", "", "Netherlands")}


def _순위줄들():
    return [{"symbol": "NVDA", "price": 180.0, "market_cap": 5e12},
            {"symbol": "AAPL", "price": 250.0, "market_cap": 4e12},
            {"symbol": "MSFT", "price": 500.0, "market_cap": 3.5e12},
            {"symbol": "TSM", "price": 300.0, "market_cap": 61.86e12},
            {"symbol": "SKHY", "price": 145.0, "market_cap": 929.4e12},
            {"symbol": "ASML", "price": 800.0, "market_cap": 3e11},
            {"symbol": "OTCX", "price": 10.0, "market_cap": 9e12}]


class Test해외순위:
    @pytest.fixture(autouse=True)
    def _분류깔기(self, monkeypatch):
        monkeypatch.setattr(R, "_나스닥_분류", dict(_분류))
        monkeypatch.setattr(R, "_나스닥_분류_읽음", True)
        monkeypatch.setattr(R, "_주식수", {})
        monkeypatch.setattr(S, "해외시총_주식수", lambda: {})

    def test_스크리닝_표가_고친_종목은_그_표의_주식_수_x_지금_시세(self, monkeypatch):
        monkeypatch.setattr(S, "해외시총_주식수", lambda: {"TSM": 6.9e9, "SKHY": 4.8e9, "OTCX": 0.0})
        줄들 = {r["symbol"]: r for r in R._해외시총_바로(_순위줄들())}
        assert 줄들["TSM"]["market_cap"] == pytest.approx(6.9e9 * 300)
        assert 줄들["SKHY"]["market_cap"] == pytest.approx(4.8e9 * 145)
        assert 줄들["OTCX"]["market_cap"] == 0, "표가 비운 곳은 순위에서 뺀다"
        assert 줄들["NVDA"]["market_cap"] == 5e12

    def test_표가_없으면_나스닥_주식_수와_상한으로(self, monkeypatch):
        monkeypatch.setattr(R, "_주식수", {"TSM": 5.2e9})
        줄들 = {r["symbol"]: r for r in R._해외시총_바로(_순위줄들())}
        assert 줄들["TSM"]["market_cap"] == pytest.approx(5.2e9 * 300), "닻"
        assert 줄들["SKHY"]["market_cap"] == 0, "닻도 환율도 없고 상한(7조)을 넘는다 — 뺀다"
        assert 줄들["OTCX"]["market_cap"] == 0, "나라를 모르는 곳도 상한을 넘으면"
        assert 줄들["ASML"]["market_cap"] == 3e11 and 줄들["MSFT"]["market_cap"] == 3.5e12

    def test_미국_회사는_커도_그대로(self):
        줄들 = _순위줄들() + [{"symbol": "HUGE", "price": 1.0, "market_cap": 2e13}]
        R._나스닥_분류["HUGE"] = ("기술", "", "United States")
        assert {r["symbol"]: r for r in R._해외시총_바로(줄들)}["HUGE"]["market_cap"] == 2e13

    def test_국내_ADR_은_나라를_잘못_적어도_본다(self):
        """나스닥 분류가 SK하이닉스 ADR 을 미국으로 적어도 — 국내 회사 ADR 목록에 있으면 가린다"""
        R._나스닥_분류["SKHY"] = ("기술", "", "United States")
        assert {r["symbol"]: r for r in R._해외시총_바로(_순위줄들())}["SKHY"]["market_cap"] == 0

    def test_분류를_못_받았으면_크기로는_가리지_않는다(self, monkeypatch):
        monkeypatch.setattr(R, "_나스닥_분류", {})
        줄들 = {r["symbol"]: r for r in R._해외시총_바로(_순위줄들())}
        assert 줄들["OTCX"]["market_cap"] == 9e12 and 줄들["NVDA"]["market_cap"] == 5e12
        assert 줄들["SKHY"]["market_cap"] == 929.4e12, "상한을 모르면 가릴 근거가 없다(표가 있으면 표로)"

    def test_받은_줄은_건드리지_않는다(self):
        원래 = _순위줄들()
        사본 = [dict(r) for r in 원래]
        나온 = R._해외시총_바로(원래)
        assert 원래 == 사본, "스크리닝 기초 줄도 이 표를 읽는다"
        assert 나온[0] is 원래[0], "고치지 않은 줄은 그대로"

    def test_시가총액_순위에_바로잡은_값으로_서고_한글_이름이_붙는다(self, monkeypatch):
        monkeypatch.setattr(R, "_주식수", {"TSM": 5.2e9})
        monkeypatch.setattr(S, "한글이름", lambda s: {"TSM": "TSMC", "NVDA": "엔비디아"}.get(s))
        위 = R._sort_us(_순위줄들(), "시가총액")
        assert [r["symbol"] for r in 위] == ["NVDA", "AAPL", "MSFT", "TSM", "ASML"]
        assert [r["rank"] for r in 위] == [1, 2, 3, 4, 5]
        assert 위[0]["name_ko"] == "엔비디아" and 위[3]["name_ko"] == "TSMC" and "name_ko" not in 위[1]

    def test_다른_순위에도_한글_이름(self, monkeypatch):
        monkeypatch.setattr(S, "한글이름", lambda s: "엔비디아" if s == "NVDA" else None)
        줄들 = [dict(r, change_rate=1.0) for r in _순위줄들()]
        위 = R._sort_us(줄들, "상승률", 장거름=False)
        assert {r["symbol"]: r.get("name_ko") for r in 위}["NVDA"] == "엔비디아"


# ── 종목 상세 ────────────────────────────────────────────────

from app.api.routes.stocks import price as P  # noqa: E402

_표줄 = {"price": 100.0, "market_cap": 1e12, "per": 20.0, "pbr": 3.0, "eps": 5.0, "forward_per": 18.0,
        "forward_eps": 5.5, "ps_ratio": 5.0, "peg_ratio": 1.2, "ev_ebitda": 15.0, "roe": 25.0, "roa": 10.0,
        "operating_margin": 30.0, "profit_margin": 20.0, "debt_ratio": 80.0, "current_ratio": 1.5,
        "dividend_yield": 1.5, "high_52w": 120.0, "low_52w": 80.0, "beta": 1.1, "sector": "기술", "industry": "반도체"}


class Test종목상세:
    @pytest.fixture(autouse=True)
    def _표(self, monkeypatch):
        self.줄 = dict(_표줄)
        monkeypatch.setattr(S, "한종목", lambda 시장, 종목: self.줄 if 종목 in ("AAA", "005930") else None)
        monkeypatch.setattr(S, "해외시총_주식수", lambda: {})

    def test_빈_칸을_표의_값으로_채운다(self):
        상세 = {"price": 110.0, "per": 22.0, "dividend_yield": 0.0, "roe": None, "eps": "", "sector": "Technology"}
        out = P.표로_채운_상세("US", "AAA", 상세)
        assert out["per"] == 22.0, "상세의 원천이 준 값이 먼저"
        assert out["dividend_yield"] == 0.0, "배당 0 은 값이다"
        assert (out["roe"], out["eps"], out["pbr"]) == (25.0, 5.0, 3.0)
        assert (out["psr"], out["peg"], out["ev_ebitda"], out["forward_per"], out["forward_eps"]) == \
            (5.0, 1.2, 15.0, 18.0, 5.5)
        assert (out["op_margin"], out["net_margin"], out["roa"], out["debt_ratio"], out["current_ratio"]) == \
            (30.0, 20.0, 10.0, 80.0, 1.5)
        assert (out["week52_high"], out["week52_low"], out["beta"]) == (120.0, 80.0, 1.1)
        assert (out["sector"], out["industry"]) == ("기술", "반도체"), "이름표는 스크리닝과 같게"
        assert out["market_cap"] == round(1e12 / 100 * 110), "표의 주식 수 × 지금 시세"
        assert 상세["sector"] == "Technology" and "pbr" not in 상세, "받은 dict(캐시일 수 있다)는 그대로"

    def test_0_이_모름인_칸(self):
        out = P.표로_채운_상세("US", "AAA", {"price": 100.0, "market_cap": 0, "per": 0, "pbr": 0, "psr": 0,
                                             "week52_high": 0, "week52_low": 0, "roe": 0, "beta": 0})
        assert (out["per"], out["pbr"], out["psr"], out["week52_high"], out["week52_low"]) == (20.0, 3.0, 5.0, 120.0, 80.0)
        assert out["market_cap"] == 1e12
        assert out["roe"] == 0 and out["beta"] == 0, "ROE·베타의 0 은 값이다"

    def test_시가총액이_표와_3배_넘게_어긋나면_표의_값(self):
        assert P.표로_채운_상세("US", "AAA", {"price": 100.0, "market_cap": 3.1e12})["market_cap"] == 3.1e12
        assert P.표로_채운_상세("US", "AAA", {"price": 100.0, "market_cap": 3.2e12})["market_cap"] == 1e12
        assert P.표로_채운_상세("US", "AAA", {"price": 100.0, "market_cap": 3.1e11})["market_cap"] == 1e12
        assert P.표로_채운_상세("US", "AAA", {"price": 100.0, "market_cap": 3.3e11})["market_cap"] == 3.3e11

    def test_국내도_같은_규칙_억원_단위가_어긋난_값을_거른다(self):
        self.줄.update(price=70000.0, market_cap=4.3e14)
        out = P.표로_채운_상세("KR", "005930", {"price": 70000.0, "market_cap": 4_300_000})
        assert out["market_cap"] == 4.3e14

    def test_표가_비운_해외_회사는_상세도_띄우지_않는다(self, monkeypatch):
        self.줄["market_cap"] = None
        monkeypatch.setattr(S, "해외시총_주식수", lambda: {"AAA": 0.0})
        assert P.표로_채운_상세("US", "AAA", {"price": 10.0, "market_cap": 9e12})["market_cap"] is None
        monkeypatch.setattr(S, "해외시총_주식수", lambda: {})
        assert P.표로_채운_상세("US", "AAA", {"price": 10.0, "market_cap": 9e12})["market_cap"] == 9e12
        monkeypatch.setattr(S, "해외시총_주식수", lambda: {"AAA": 0.0})
        assert P.표로_채운_상세("KR", "AAA", {"price": 10.0, "market_cap": 9e12})["market_cap"] == 9e12, "국내는 해당 없다"

    def test_채울_것이_없으면_받은_그대로(self):
        d = {"price": 1.0}
        assert P.표로_채운_상세("US", "ZZZ", d) is d, "표에 그 종목이 없다"
        e = {"price": None}
        assert P.표로_채운_상세("US", "AAA", e) is e, "가격을 못 받은 응답"
        f = {"price": 1.0}
        assert P.표로_채운_상세("ETF", "AAA", f) is f
        assert P.표로_채운_상세("US", "AAA", None) is None

    def test_표를_못_읽어도_상세는_나간다(self, monkeypatch):
        def 터짐(*a):
            raise RuntimeError("표")
        monkeypatch.setattr(S, "한종목", 터짐)
        d = {"price": 1.0}
        assert P.표로_채운_상세("US", "AAA", d) is d

    def test_라우트가_마지막에_표로_채운다(self, monkeypatch):
        async def 원래상세(market, symbol):
            return {"price": 110.0, "symbol": symbol}
        monkeypatch.setattr(P, "_상세", 원래상세)
        from starlette.requests import Request
        요청 = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b"",
                        "client": ("127.0.0.1", 1), "app": None, "server": ("test", 80), "scheme": "http"})
        out = asyncio.run(P.get_stock_detail(request=요청, market="US", symbol="AAA"))
        assert out["pbr"] == 3.0 and out["sector"] == "기술"


# ── 야후 줄의 장부 돈 ──────────────────────────────────────────

def _시세():
    날 = pd.bdate_range("2025-10-01", periods=260)
    return pd.DataFrame({"Close": np.linspace(100, 120, 260), "Volume": np.full(260, 1000)}, index=날)


def test_장부_돈을_모르면_비우고_막힌_회차가_알던_돈을_덮지_않는다():
    from app.services.market.yf_service import 스크리닝줄, _줄_잇기
    옛 = 스크리닝줄("TOELY", "US", {"financialCurrency": "JPY", "currency": "USD", "longName": "Tokyo Electron",
                                   "marketCap": 12.38e12}, _시세())
    새 = 스크리닝줄("TOELY", "US", {}, _시세())
    assert 옛["fin_currency"] == "JPY" and 새.get("fin_currency") is None
    assert _줄_잇기(옛, 새)["fin_currency"] == "JPY", "막힌 회차가 'USD' 로 덮으면 시가총액을 못 바로잡는다"


# ── 내 자산 배당 ──────────────────────────────────────────────

def test_꼬리_없는_국내_코드는_종목_목록으로_코스닥을_가린다(monkeypatch):
    """스크리닝 표에서 담은 종목은 6자리만 온다 — 예전엔 늘 '.KS' 라 코스닥 종목의 배당이 비었다"""
    from app.services.market import yf_service as Y
    from app.services.portfolio import dividend_service as D
    monkeypatch.setattr(Y, "_국내꼬리", lambda c: ".KQ" if c == "247540" else ".KS")
    assert D._야후심볼("247540", "KR") == "247540.KQ"
    assert D._야후심볼("005930", "KR") == "005930.KS"
    assert D._야후심볼("247540.KQ", "KR") == "247540.KQ" and D._야후심볼("005930.ks", "KR") == "005930.KS"
    assert D._야후심볼("0001A0", "KR") == "0001A0", "숫자만이 아니면 그대로"
    assert D._야후심볼("aapl", "US") == "AAPL"
