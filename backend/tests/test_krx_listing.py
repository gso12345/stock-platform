"""
KRX 종목 목록을 라이브러리 없이 직접 받아오기.

왜 만들었나: FinanceDataReader 로 목록 한 번 받으려면 그 라이브러리가
프로세스가 죽을 때까지 메모리에 남는다(파이썬은 올린 모듈을 못 내려놓는다).
프로덕션에서 73.8MB, 딸린 것까지 119.8MB였다. FDR 코드를 열어보니 하는 일은
HTTP 요청 두 번이라, 이미 쓰는 httpx 로 같은 일을 한다.

이 파일에서 못 박는 것
  · 요청 형태가 KRX 가 받아주는 모양일 것 (헤더·본문·URL)
  · 응답 파싱이 실제 응답 모양을 정확히 다룰 것 — '1,234' 같은 콤마 숫자,
    '-' 같은 빈 값, 6자리 아닌 코드
  · 한 경로가 막히면 다음 경로로 넘어갈 것
  · 이상한 응답(몇 개만 온 것)을 정상으로 받아들이지 않을 것

주의: 이 샌드박스는 data.krx.co.kr 로 나갈 수 없다. 그래서 실제 호출은
검증할 수 없고, 요청 형태와 파싱만 검증한다. 실제 응답 모양은 FDR 소스에
적힌 필드 이름을 그대로 따랐다.
"""
import json

import httpx
import pytest

from app.services import krx_listing as kl


# ── 실제 KRX 응답 모양 (FDR 소스의 필드 이름을 그대로 사용) ──
def _krx_row(code="005930", name="삼성전자", market="KOSPI", close="71,900"):
    return {
        "ISU_SRT_CD": code, "ISU_ABBRV": name, "MKT_NM": market,
        "TDD_CLSPRC": close, "CMPPREVDD_PRC": "1,200", "FLUC_RT": "1.70",
        "ACC_TRDVOL": "12,345,678", "MKTCAP": "429,000,000,000,000",
        "TDD_OPNPRC": "70,900", "TDD_HGPRC": "72,000", "TDD_LWPRC": "70,500",
    }


def _krx_payload(rows):
    return json.dumps({"OutBlock_1": rows})


def _csv_payload(rows):
    head = "Code,Name,Market,Close,Changes,ChagesRatio,Volume,Marcap,Open,High,Low"
    return "\n".join([head] + rows)


class _가짜응답:
    def __init__(self, text, status=200):
        self.text = text
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("에러", request=None, response=None)


class Test숫자_파싱:
    """KRX 는 숫자를 문자열로 준다. 여기서 틀리면 시세가 통째로 0이 된다."""

    @pytest.mark.parametrize("입력, 기대", [
        ("71,900", 71900.0),
        ("1,234,567,890", 1234567890.0),
        ("-1,200", -1200.0),
        ("1.70", 1.70),
        ("-", 0.0),            # KRX 가 값 없을 때 주는 것
        ("", 0.0),
        (None, 0.0),
        ("0", 0.0),
        (71900, 71900.0),      # CSV 는 숫자로 올 수도 있다
        (71900.5, 71900.5),
        ("알수없음", 0.0),      # 터지지 않아야 한다
    ])
    def test_콤마와_빈값을_처리한다(self, 입력, 기대):
        assert kl._num(입력) == 기대


class Test종목_한_줄:
    def test_KOSPI는_KS_KOSDAQ는_KQ(self):
        assert kl._row("005930", "삼성전자", "KOSPI")["s"] == "005930.KS"
        assert kl._row("247540", "에코프로비엠", "KOSDAQ")["s"] == "247540.KQ"

    @pytest.mark.parametrize("입력, 기대", [("5930", "005930"), ("660", "000660"),
                                          ("12345", "012345"), ("005930", "005930")])
    def test_앞의_0을_채운다(self, 입력, 기대):
        # CSV·JSON 이 코드를 숫자로 담으면 000660 이 660 으로 온다
        assert kl._row(입력, "무엇", "KOSPI")["c"] == 기대

    @pytest.mark.parametrize("코드", ["", "   ", "1234567", None, "-", "00-930", "005 30"])
    def test_쓸_수_없는_코드는_버린다(self, 코드):
        assert kl._row(코드, "무엇", "KOSPI") is None

    @pytest.mark.parametrize("코드, 이름", [
        ("00680K", "미래에셋증권2우B"),
        ("02826K", "삼성물산우B"),
        ("0126Z0", "삼성에피스홀딩스"),
        ("0009K0", "에임드바이오"),
        ("00104K", "CJ4우(전환)"),
        ("0030R0", "대신밸류리츠"),
    ])
    def test_영문자가_섞인_코드도_받는다(self, 코드, 이름):
        """종목코드는 숫자만이 아니다. 우선주·전환주·신주는 영문자가 섞인다.
        처음에 숫자만 받도록 짰다가 실제 종목 79개를 버렸다 — 실제 KRX
        데이터에서 확인한 코드들이다."""
        r = kl._row(코드, 이름, "KOSPI")
        assert r is not None, f"{코드}({이름}) 는 실제 상장 종목인데 버려졌다"
        assert r["c"] == 코드 and r["s"] == f"{코드}.KS"

    def test_빈_코드가_유령종목이_되지_않는다(self):
        """빈 값을 먼저 거르지 않으면 zfill 이 ''를 '000000' 으로 만든다.
        그러면 존재하지 않는 종목이 목록과 DB에 들어간다."""
        for 빈것 in ("", None, "   "):
            assert kl._row(빈것, "무엇", "KOSPI") is None, f"{빈것!r} 가 종목이 됐다"

    def test_이름이_없으면_버린다(self):
        assert kl._row("005930", "", "KOSPI") is None
        assert kl._row("005930", None, "KOSPI") is None

    def test_기존_형식과_같은_모양이다(self):
        # 검색·시세 코드가 이 키들을 그대로 쓴다. 하나만 달라도 조용히 깨진다
        r = kl._row("005930", "삼성전자", "KOSPI")
        assert set(r) == {"s", "n", "x", "m", "c"}
        assert r == {"s": "005930.KS", "n": "삼성전자", "x": "KOSPI", "m": "KR", "c": "005930"}


class TestKRX_공식_API:
    def _client(self, monkeypatch, 응답, 기록=None):
        c = httpx.Client()
        def 가짜post(url, **kw):
            if 기록 is not None:
                기록.append((url, kw))
            return _가짜응답(응답)
        monkeypatch.setattr(c, "post", 가짜post)
        return c

    def test_목록과_시세를_함께_받는다(self, monkeypatch):
        c = self._client(monkeypatch, _krx_payload([_krx_row()]))
        listing, prices = kl.fetch_live(c, "20260729")
        assert listing == [{"s": "005930.KS", "n": "삼성전자", "x": "KOSPI",
                            "m": "KR", "c": "005930"}]
        p = prices["005930.KS"]
        assert p["price"] == 71900.0
        assert p["change"] == 1200.0 and p["change_rate"] == 1.70
        assert p["volume"] == 12345678 and p["market_cap"] == 429_000_000_000_000
        assert p["open"] == 70900.0 and p["high"] == 72000.0 and p["low"] == 70500.0
        assert p["currency"] == "KRW"

    def test_시세_형식이_기존과_같다(self, monkeypatch):
        # 이 값을 get_fdr_price() 가 그대로 내보낸다
        c = self._client(monkeypatch, _krx_payload([_krx_row()]))
        _, prices = kl.fetch_live(c, "20260729")
        assert set(prices["005930.KS"]) == {
            "symbol", "name", "price", "change", "change_rate", "volume",
            "market_cap", "currency", "high", "low", "open",
        }

    def test_종가가_0이면_시세를_안_넣는다(self, monkeypatch):
        # 거래정지 종목은 목록에는 있어야 하지만 시세는 없어야 한다
        c = self._client(monkeypatch, _krx_payload([_krx_row(close="-")]))
        listing, prices = kl.fetch_live(c, "20260729")
        assert len(listing) == 1 and prices == {}

    def test_요청_형태가_KRX가_받아주는_모양이다(self, monkeypatch):
        기록 = []
        c = self._client(monkeypatch, _krx_payload([_krx_row()]), 기록)
        kl.fetch_live(c, "20260729")
        url, kw = 기록[0]
        assert url == "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
        assert kw["data"]["bld"] == "dbms/MDC/STAT/standard/MDCSTAT01501"
        assert kw["data"]["mktId"] == "ALL", "ALL 이 아니면 KOSDAQ 이 빠진다"
        assert kw["data"]["trdDd"] == "20260729"
        # KRX 는 브라우저에서 온 요청만 받는다 — 헤더가 없으면 거절당한다
        assert "Mozilla" in kw["headers"]["User-Agent"]
        assert "krx.co.kr" in kw["headers"]["Referer"]

    def test_빈_응답도_터지지_않는다(self, monkeypatch):
        for 본문 in ('{"OutBlock_1": []}', '{}', '{"OutBlock_1": null}'):
            c = self._client(monkeypatch, 본문)
            assert kl.fetch_live(c, "20260729") == ([], {})


class TestGitHub_CSV:
    def _client(self, monkeypatch, 응답):
        c = httpx.Client()
        monkeypatch.setattr(c, "get", lambda url, **kw: _가짜응답(응답))
        return c

    def test_CSV도_같은_결과를_만든다(self, monkeypatch):
        c = self._client(monkeypatch, _csv_payload([
            "005930,삼성전자,KOSPI,71900,1200,1.7,12345678,429000000000000,70900,72000,70500",
        ]))
        listing, prices = kl.fetch_csv_cache(c, "20260729")
        assert listing[0]["s"] == "005930.KS"
        assert prices["005930.KS"]["price"] == 71900.0
        assert prices["005930.KS"]["change_rate"] == 1.7

    def test_날짜를_하이픈_형식으로_바꾼다(self, monkeypatch):
        받은url = []
        c = httpx.Client()
        monkeypatch.setattr(c, "get", lambda url, **kw: (받은url.append(url),
                                                        _가짜응답(_csv_payload([])))[1])
        kl.fetch_csv_cache(c, "20260729")
        assert "2026-07-29.csv" in 받은url[0], f"URL 형식이 틀렸다: {받은url[0]}"

    def test_망가진_줄은_건너뛴다(self, monkeypatch):
        c = self._client(monkeypatch, _csv_payload([
            ",,,,,,,,,,",                                     # 빈 줄
            "00-930,잘못된코드,KOSPI,100,0,0,0,0,0,0,0",        # 코드에 기호
            "0059301,너무긴코드,KOSPI,100,0,0,0,0,0,0,0",       # 7자리
            "005930,,KOSPI,100,0,0,0,0,0,0,0",                # 이름 없음
            "005930,삼성전자,KOSPI,71900,1200,1.7,1,1,1,1,1",  # 정상
            "00680K,미래에셋증권2우B,KOSPI,9910,0,0,1,1,1,1,1",  # 영문 섞인 정상 코드
        ]))
        listing, _ = kl.fetch_csv_cache(c, "20260729")
        assert [r["c"] for r in listing] == ["005930", "00680K"]


class Test경로_전환:
    """한 경로가 막히면 다음으로 넘어가야 한다. 안 넘어가면 종목이 115개가 된다."""

    def _충분한행(self, n=600):
        return [_krx_row(code=f"{i:06d}", name=f"종목{i}") for i in range(1, n + 1)]

    def test_KRX가_되면_CSV는_안_부른다(self, monkeypatch):
        부른것 = []
        monkeypatch.setattr(kl, "_candidate_days", lambda c: ["20260729"])
        monkeypatch.setattr(kl, "fetch_live",
                            lambda c, d: (부른것.append("live"), ([{"s": "A", "n": "가", "x": "KOSPI", "m": "KR", "c": "000001"}] * 600, {}))[1])
        monkeypatch.setattr(kl, "fetch_csv_cache",
                            lambda c, d: (부른것.append("csv"), ([], {}))[1])
        listing, _, 출처 = kl.fetch_listing()
        assert 부른것 == ["live"]
        assert len(listing) == 600 and "KRX" in 출처

    def test_KRX가_막히면_CSV로_넘어간다(self, monkeypatch):
        monkeypatch.setattr(kl, "_candidate_days", lambda c: ["20260729"])
        monkeypatch.setattr(kl, "fetch_live",
                            lambda c, d: (_ for _ in ()).throw(httpx.ConnectError("막힘")))
        monkeypatch.setattr(kl, "fetch_csv_cache",
                            lambda c, d: ([{"s": "A", "n": "가", "x": "KOSPI", "m": "KR", "c": "000001"}] * 700, {}))
        listing, _, 출처 = kl.fetch_listing()
        assert len(listing) == 700 and "CSV" in 출처

    def test_둘_다_막히면_빈_결과를_돌려준다(self, monkeypatch):
        # 예외를 밖으로 던지면 부르는 쪽이 다음 폴백으로 못 넘어간다
        monkeypatch.setattr(kl, "_candidate_days", lambda c: ["20260729"])
        monkeypatch.setattr(kl, "fetch_live", lambda c, d: (_ for _ in ()).throw(RuntimeError("x")))
        monkeypatch.setattr(kl, "fetch_csv_cache", lambda c, d: (_ for _ in ()).throw(RuntimeError("y")))
        assert kl.fetch_listing() == ([], {}, "")

    def test_몇_개만_온_응답은_받아들이지_않는다(self, monkeypatch):
        """KOSPI 만도 800개가 넘는다. 3개가 왔다면 응답이 잘린 것이고,
        그걸 저장하면 DB의 정상 목록을 3개로 덮어쓴다."""
        monkeypatch.setattr(kl, "_candidate_days", lambda c: ["20260729"])
        monkeypatch.setattr(kl, "fetch_live",
                            lambda c, d: ([{"s": "A", "n": "가", "x": "KOSPI", "m": "KR", "c": "000001"}] * 3, {}))
        monkeypatch.setattr(kl, "fetch_csv_cache", lambda c, d: ([], {}))
        assert kl.fetch_listing() == ([], {}, "")

    def test_날짜를_며칠_거슬러_시도한다(self, monkeypatch):
        # 주말·연휴에는 당일 데이터가 없다
        시도 = []

        def 어제만성공(c, ymd):
            시도.append(ymd)
            if len(시도) < 3:
                raise httpx.HTTPStatusError("없음", request=None, response=None)
            return ([{"s": "A", "n": "가", "x": "KOSPI", "m": "KR", "c": "000001"}] * 600, {})

        monkeypatch.setattr(kl, "_candidate_days", lambda c: ["20260729", "20260728", "20260727"])
        monkeypatch.setattr(kl, "fetch_live", 어제만성공)
        listing, _, 출처 = kl.fetch_listing()
        assert len(시도) == 3 and len(listing) == 600
        assert "20260727" in 출처

    def test_영업일_후보에_KRX가_준_날이_맨_앞이다(self, monkeypatch):
        c = httpx.Client()
        monkeypatch.setattr(kl, "latest_trading_day", lambda cl: "20260101")
        assert kl._candidate_days(c)[0] == "20260101"

    def test_영업일_조회가_실패해도_후보가_있다(self, monkeypatch):
        c = httpx.Client()
        monkeypatch.setattr(kl, "latest_trading_day", lambda cl: None)
        days = kl._candidate_days(c)
        assert len(days) >= 5 and all(len(d) == 8 for d in days)


class Test라이브러리_없이:
    def test_pandas도_FDR도_쓰지_않는다(self):
        import ast
        import inspect
        tree = ast.parse(inspect.getsource(kl))
        모듈 = set()
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                모듈 |= {a.name.split(".")[0] for a in n.names}
            elif isinstance(n, ast.ImportFrom) and n.module:
                모듈.add(n.module.split(".")[0])
        무거운것 = 모듈 & {"pandas", "numpy", "FinanceDataReader", "pykrx", "requests"}
        assert not 무거운것, f"무거운 라이브러리를 쓰고 있다: {무거운것}"
        assert "httpx" in 모듈
