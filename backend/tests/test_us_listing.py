"""
미국 상장 종목 목록 — "미국 모든 종목이 조회 가능하면 좋겠어"

지금까지 미국 종목은 코드에 적어둔 128개가 전부였다. 국내 목록이 내장
115개로 조용히 돌던 것과 똑같은 상황이고, 그때 제일 나빴던 건 '적은 목록으로
도는데 화면에는 아무 표시가 없던 것' 이었다.

그래서 여기서 제일 무겁게 못 박는 것은 파싱 성공이 아니라 **'미덥지 않은
목록은 안 쓴다'** 쪽이다. 절반만 받아온 목록을 그대로 쓰면, 어제까지 검색되던
종목이 오늘 안 되면서 아무도 이유를 모른다.
"""
import httpx
import pytest

from app.services import us_listing as ul


# ── 실제 파일 모양 ────────────────────────────────────────────
# NASDAQ Trader 심볼 디렉터리. 파이프 구분, 머리글 한 줄,
# 마지막에 컬럼 수가 안 맞는 'File Creation Time' 꼬리줄이 붙는다.
NASDAQ = """Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
MSFT|Microsoft Corporation - Common Stock|Q|N|N|100|N|N
NVDA|NVIDIA Corporation - Common Stock|Q|N|N|100|N|N
QQQ|Invesco QQQ Trust, Series 1|Q|N|N|100|Y|N
ZVZZT|NASDAQ TEST STOCK|G|Y|N|100|N|N
ABCDW|Some Acquisition Corp. - Warrant|S|N|N|100|N|N
File Creation Time: 0130202502:30|||||||
"""

# otherlisted 는 열이 다르다. ACT Symbol 은 클래스주를 점으로 쓰고(BRK.B),
# 야후와 같은 붙임표 표기는 맨 끝 NASDAQ Symbol 열에 따로 들어 있다.
OTHER = """ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
JPM|JPMorgan Chase & Co. Common Stock|N|JPM|N|100|N|JPM
BRK.B|Berkshire Hathaway Inc. Class B Common Stock|N|BRK.B|N|100|N|BRK-B
SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY
GLD|SPDR Gold Shares|P|GLD|Y|100|N|GLD
AGM$C|Federal Agricultural Mortgage Corp Pfd Series C|N|AGM.PRC|N|100|N|AGM-C
ARCC$B|Ares Capital Corp Depositary Shares each representing 1/1000th Preferred Series B|N|ARCC.PRB|N|100|N|ARCC-B
BABA|Alibaba Group Holding Limited American Depositary Shares|N|BABA|N|100|N|BABA
ABCDR|Some Acquisition Corp. Rights|N|ABCD.R|N|100|N|ABCDR
ATEST|NYSE TEST STOCK|N|ATEST|N|100|Y|ATEST
File Creation Time: 0130202502:30|||||||
"""


def _충분한목록(n=2500):
    """_쓸만한가 를 통과하는 최소 조건을 갖춘 목록"""
    rows = [{"s": s, "n": s, "x": "NASDAQ", "m": "US"} for s in ul._기준종목]
    rows += [{"s": f"T{i:05d}", "n": f"Test {i}", "x": "NASDAQ", "m": "US"}
             for i in range(n)]
    return rows


# ── 1. 파싱 ──────────────────────────────────────────────────
class Test파싱:
    def test_나스닥_파일을_읽는다(self):
        rows = ul._파싱(NASDAQ, "NASDAQ")
        심볼 = {r["s"] for r in rows}
        assert {"AAPL", "MSFT", "NVDA", "QQQ"} <= 심볼

    def test_ETF_를_구분한다(self):
        """ETF 는 시장이 US 가 아니라 ETF 다 — 검색 필터가 이걸로 나뉜다."""
        종목 = {r["s"]: r for r in ul._파싱(NASDAQ, "NASDAQ")}
        assert 종목["QQQ"]["m"] == "ETF"
        assert 종목["AAPL"]["m"] == "US"

    def test_거래소를_코드에서_풀어낸다(self):
        """P 는 NYSE Arca 다. ETF 가 대부분 여기 있어서, 이걸 못 풀면
        화면에 거래소가 'P' 로 나온다."""
        종목 = {r["s"]: r for r in ul._파싱(OTHER, "NYSE")}
        assert 종목["SPY"]["x"] == "NYSE ARCA"
        assert 종목["JPM"]["x"] == "NYSE"

    def test_클래스주를_야후_표기로_담는다(self):
        """이 파일의 ACT Symbol 열은 클래스주를 BRK.B 처럼 점으로 쓴다.
        '기호 섞인 심볼은 버린다'로 하면 버크셔가 통째로 사라진다."""
        점표기 = ("Symbol|Security Name|ETF|Test Issue\n"
                "BRK.B|Berkshire Hathaway Inc. Class B Common Stock|N|N")
        assert [r["s"] for r in ul._파싱(점표기, "NYSE")] == ["BRK-B"]

        심볼 = {r["s"] for r in ul._파싱(OTHER, "NYSE")}
        assert "BRK-B" in 심볼, 심볼
        assert "BRK.B" not in 심볼 and "BRK/B" not in 심볼

    def test_심볼_자리에_엉뚱한_글자가_오면_담지_않는다(self):
        """받다가 깨지면 심볼 칸에 설명문이나 머리글 조각이 들어온다.
        이름 칸은 멀쩡해서 이름 검사로는 안 걸린다."""
        깨진것 = ("Symbol|Security Name|ETF|Test Issue\n"
                "AAPL|Apple Inc. - Common Stock|N|N\n"
                "File Creation Time: 013025|Apple Inc. - Common Stock|N|N\n"
                "총 4,121 종목|Some Company Inc.|N|N")
        assert [r["s"] for r in ul._파싱(깨진것, "NASDAQ")] == ["AAPL"]

    def test_빗금_표기도_붙임표로_바꾼다(self):
        """열에 따라 BRK/B 로 오기도 한다."""
        빗금 = ("Symbol|Security Name|ETF|Test Issue\n"
               "BRK/B|Berkshire Hathaway Inc. Class B|N|N")
        assert [r["s"] for r in ul._파싱(빗금, "NYSE")] == ["BRK-B"]

    def test_예탁증서는_살린다(self):
        """알리바바 같은 ADR 은 멀쩡히 거래된다. 우선주 설명문에도
        'Depositary' 가 나온다고 같이 버리면 294개가 날아간다."""
        심볼 = {r["s"] for r in ul._파싱(OTHER, "NYSE")}
        assert "BABA" in 심볼

    def test_권리증서를_담지_않는다(self):
        심볼 = {r["s"] for r in ul._파싱(OTHER, "NYSE")}
        assert "ABCDR" not in 심볼

    def test_시험용_종목을_뺀다(self):
        """ZVZZT·ATEST 는 거래소가 시스템 점검용으로 올려둔 것이라
        검색에 나오면 안 된다."""
        심볼 = {r["s"] for r in ul._파싱(NASDAQ, "NASDAQ")} | \
               {r["s"] for r in ul._파싱(OTHER, "NYSE")}
        assert "ZVZZT" not in 심볼 and "ATEST" not in 심볼

    def test_우선주는_담지_않는다(self):
        """야후는 우선주를 AGM-PC 로 쓴다. 이 파일이 주는 AGM$C 도
        AGM-C 도 야후에서는 조회되지 않아, 검색에 나와도 눌러봐야 빈
        화면이라 없느니만 못하다.

        심볼 모양만 보면 못 거른다 — AGM-C 는 BRK-B 와 생김새가 같다.
        그래서 이름의 'Pfd'·'Preferred' 로 판단한다."""
        심볼 = {r["s"] for r in ul._파싱(OTHER, "NYSE")}
        assert "AGM-C" not in 심볼 and not any("$" in s for s in 심볼)
        # 'Depositary Shares ... Preferred Series B' 처럼 길게 쓴 것도 걸러야 한다
        assert "ARCC-B" not in 심볼, 심볼

    def test_꼬리줄을_종목으로_읽지_않는다(self):
        """마지막 줄은 'File Creation Time: ...' 이다. 빠뜨리면 그게
        종목 하나로 잡힌다."""
        심볼 = {r["s"] for r in ul._파싱(NASDAQ, "NASDAQ")}
        assert not any("FILE" in s or ":" in s for s in 심볼), 심볼

    def test_칸이_모자란_줄에서_터지지_않는다(self):
        """받다가 끊기면 마지막 줄이 심볼만 남고 이름 칸이 없다. 그때
        이름 칸을 그냥 집으면 파싱이 통째로 예외로 끝나고, 앞에서 잘 읽은
        4천 개까지 같이 날아간다."""
        잘린것 = ("Symbol|Security Name|ETF|Test Issue\n"
                "AAPL|Apple Inc. - Common Stock|N|N\n"
                "MSFT\n")                       # 여기서 연결이 끊겼다
        assert [r["s"] for r in ul._파싱(잘린것, "NASDAQ")] == ["AAPL"]

    def test_머리글_이름으로_컬럼을_찾는다(self):
        """위치로 읽으면 파일 형식이 한 칸만 밀려도 이름 자리에 시장
        구분이 들어오는데, 그게 아무 소리 없이 통과한다."""
        섞은것 = "\n".join([
            "Security Name|Symbol|ETF|Test Issue",
            "Apple Inc. - Common Stock|AAPL|N|N",
            "Invesco QQQ Trust|QQQ|Y|N",
        ])
        종목 = {r["s"]: r for r in ul._파싱(섞은것, "NASDAQ")}
        assert 종목["AAPL"]["n"].startswith("Apple")
        assert 종목["QQQ"]["m"] == "ETF"

    def test_머리글이_아예_다르면_빈손으로_돌아간다(self):
        assert ul._파싱("주욱|늘어선|무언가\n하나|둘|셋", "NASDAQ") == []

    def test_이름을_적당히_자른다(self):
        """이름은 화면에 한 줄로 나온다. 200자짜리가 들어오면 목록이 깨진다."""
        긴것 = "Symbol|Security Name|ETF\nXYZ|" + "가" * 300 + "|N"
        assert len(ul._파싱(긴것, "NASDAQ")[0]["n"]) <= 80


# ── 2. 미덥지 않은 목록은 안 쓴다 ─────────────────────────────
class Test안전장치:
    def test_너무_적으면_버린다(self):
        """절반만 받아온 목록을 쓰면 어제 되던 검색이 오늘 안 된다."""
        assert ul._쓸만한가(_충분한목록()) is True
        assert ul._쓸만한가(_충분한목록(10)) is False

    def test_기준_종목이_거의_없으면_버린다(self):
        """건수만 보면 '엉뚱한 파일을 다 읽은' 경우를 못 잡는다."""
        목록 = [r for r in _충분한목록() if r["s"] not in ul._기준종목]
        assert ul._쓸만한가(목록) is False
        목록.append({"s": "AAPL", "n": "Apple", "x": "NASDAQ", "m": "US"})
        assert ul._쓸만한가(목록) is False, "하나 맞은 것은 우연일 수 있다"

    def test_한쪽_거래소만_와도_통과시킨다(self):
        """두 파일 중 하나만 와도 쓰기로 했다. 나스닥 파일만 오면 JPM 이
        없는데, 그걸로 버리면 4,000개짜리 멀쩡한 목록을 통째로 날린다."""
        나스닥만 = [r for r in _충분한목록()
                  if r["s"] not in ("JPM", "JNJ", "WMT")]
        assert ul._쓸만한가(나스닥만) is True

        NYSE만 = [r for r in _충분한목록()
                 if r["s"] not in ("AAPL", "MSFT", "NVDA")]
        assert ul._쓸만한가(NYSE만) is True

    def test_버릴_때_이유를_남긴다(self, caplog):
        """조용히 버리면 '왜 종목이 128개지' 를 또 몇 주 헤맨다."""
        import logging
        with caplog.at_level(logging.WARNING, logger=ul.log.name):
            ul._쓸만한가(_충분한목록(10))
        assert caplog.records, "버린 이유가 로그에 없다"


# ── 3. 받아오기 ──────────────────────────────────────────────
class _가짜응답:
    def __init__(self, text, status=200):
        self.text, self.status_code = text, status

    def raise_for_status(self):
        if self.status_code != 200:
            raise httpx.HTTPStatusError("나쁨", request=None, response=None)


class _가짜클라이언트:
    def __init__(self, 응답들):
        self.응답들 = 응답들
        self.부른것 = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, timeout=None):
        self.부른것.append(url)
        for 조각, 응답 in self.응답들.items():
            if 조각 in url:
                if isinstance(응답, Exception):
                    raise 응답
                return 응답
        raise httpx.ConnectError("모름")


@pytest.fixture
def 가짜네트워크(monkeypatch):
    상자 = {}

    def _설치(응답들):
        cl = _가짜클라이언트(응답들)
        상자["cl"] = cl
        monkeypatch.setattr(ul.httpx, "Client", lambda *a, **k: cl)
        return cl
    _설치.상자 = 상자
    return _설치


def _많은줄(머리, 시작=0, n=2500):
    """_쓸만한가 를 통과할 만큼 줄을 붙인다"""
    꼬리 = "\n".join(f"T{i:05d}|Test {i} Inc. - Common Stock|Q|N|N|100|N|N"
                    for i in range(시작, 시작 + n))
    return 머리.replace("File Creation Time", 꼬리 + "\nFile Creation Time")


class Test받아오기:
    def test_두_파일을_합친다(self, 가짜네트워크):
        가짜네트워크({"nasdaqlisted": _가짜응답(_많은줄(NASDAQ)),
                    "otherlisted":  _가짜응답(OTHER)})
        rows, 출처 = ul.fetch_listing()
        심볼 = {r["s"] for r in rows}
        assert {"AAPL", "SPY", "GLD", "JPM", "BRK-B"} <= 심볼
        assert "NASDAQ Trader" in 출처

    def test_한_파일만_와도_쓴다(self, 가짜네트워크):
        """ETF 가 빠지더라도 종목이 128개인 것보다는 낫다."""
        가짜네트워크({"nasdaqlisted": _가짜응답(_많은줄(NASDAQ)),
                    "otherlisted":  httpx.ConnectError("끊김")})
        rows, 출처 = ul.fetch_listing()
        assert len(rows) > 2000 and "nasdaqlisted" in 출처

    def test_둘_다_실패하면_빈손으로_돌아간다(self, 가짜네트워크):
        """빈손으로 돌아가야 부르는 쪽이 '지난 목록을 유지' 를 택할 수 있다."""
        가짜네트워크({"nasdaqlisted": httpx.ConnectError("끊김"),
                    "otherlisted":  httpx.ConnectError("끊김")})
        rows, 사유 = ul.fetch_listing()
        assert rows == [] and 사유

    def test_적게_온_응답은_통째로_버린다(self, 가짜네트워크):
        """받긴 받았는데 세 줄뿐인 경우. 이걸 쓰면 검색이 망가진다."""
        가짜네트워크({"nasdaqlisted": _가짜응답(NASDAQ),
                    "otherlisted":  _가짜응답(OTHER)})
        rows, 사유 = ul.fetch_listing()
        assert rows == [], f"{len(rows)}개짜리 목록을 그대로 썼다"
        assert "미덥지" in 사유

    def test_같은_종목이_겹쳐도_한_번만_담는다(self, 가짜네트워크):
        겹침 = "Symbol|Security Name|ETF|Test Issue\nAAPL|Apple Inc. (재상장)|N|N"
        가짜네트워크({"nasdaqlisted": _가짜응답(_많은줄(NASDAQ)),
                    "otherlisted":  _가짜응답(겹침)})
        rows, _ = ul.fetch_listing()
        assert [r["s"] for r in rows].count("AAPL") == 1
        # 먼저 온 쪽(나스닥)의 이름이 남아야 한다
        assert "재상장" not in {r["s"]: r["n"] for r in rows}["AAPL"]
