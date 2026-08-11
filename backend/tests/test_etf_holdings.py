"""
ETF 구성종목 — pykrx 인자 순서가 다시 뒤집히지 않게.

국내 ETF 는 야후가 구성종목을 거의 안 준다. 그래서 KRX(pykrx)를 보는데,
처음에 인자를 거꾸로 넘겼다.

    실제 시그니처: get_etf_portfolio_deposit_file(ticker, date)
    처음 쓴 것:    get_etf_portfolio_deposit_file(ymd, code)

종목 자리에 날짜("20260810")가 들어가니 KRX 는 늘 빈 표를 돌려줬다.
예외가 아니라 '빈 DataFrame' 이라 로그에도 안 남았고, 화면에는
"보유비중 데이터가 없습니다" 만 떴다 — 코드는 멀쩡해 보이는데.

같은 실수는 눈으로 못 잡는다. 함수의 실제 시그니처에 이름으로 맞춰 본다.
"""
import ast
import inspect
import pathlib
import re

import pytest

# 모듈로 import 하지 않고 파일로 읽는다 — 이건 구조 검사라 앱 전체를
# 띄울 필요가 없고, fastapi 가 없는 환경에서도 돌아야 한다.
_소스 = (pathlib.Path(__file__).resolve().parents[1]
         / "app" / "api" / "routes" / "stocks.py").read_text(encoding="utf-8")


def _보유비중구간() -> str:
    """ETF 보유비중 엔드포인트 안쪽만 잘라 낸다.

    파일 전체에서 이름으로 찾으면 안 된다 — 뉴스 쪽에도 _fetch_kr 이 있어서
    처음에는 엉뚱한 구간을 검사하고 있었다(그래서 폴백을 통째로 지워도
    테스트가 통과했다). 라우트 데코레이터를 기준으로 삼는다."""
    시작 = _소스.index('@router.get("/ETF/{symbol}/holdings")')
    끝 = _소스.find("@router.", 시작 + 10)
    return _소스[시작:끝 if 끝 > 시작 else len(_소스)]


def _호출들(함수이름: str) -> list[ast.Call]:
    """소스 전체에서 그 함수를 부르는 자리를 모은다."""
    나무 = ast.parse(_소스)
    찾음 = []
    for n in ast.walk(나무):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) \
                and n.func.attr == 함수이름:
            찾음.append(n)
    return 찾음


class Test인자순서:
    def test_국내_폴백_함수가_있다(self):
        """야후가 비면 KRX 를 보는 자리가 통째로 사라지면 국내 ETF 는 영영 빈다.
        이름은 뉴스 쪽 _fetch_kr 과 겹치지 않게 따로 둔다."""
        본문 = _보유비중구간()
        assert "def _fetch_kr_holdings" in 본문, "국내 폴백 함수가 없다"
        assert "_run(_fetch_kr_holdings)" in 본문, "폴백을 부르지 않는다"

    def test_ETF_구성종목을_부르는_자리가_있다(self):
        """폴백 자체가 사라지면 국내 ETF 는 영영 빈다."""
        assert _호출들("get_etf_portfolio_deposit_file"), \
            "국내 ETF 구성종목을 KRX 에서 가져오는 코드가 없다"

    def test_종목코드가_첫_인자다(self):
        """(ticker, date) 순서다. 뒤집으면 조용히 빈 표가 온다."""
        for 호출 in _호출들("get_etf_portfolio_deposit_file"):
            첫인자 = ast.unparse(호출.args[0])
            assert "code" in 첫인자, (
                f"첫 인자는 종목코드여야 한다 (지금: {첫인자}). "
                "get_etf_portfolio_deposit_file(ticker, date) 순서다"
            )
            # 날짜를 첫 자리에 넣는 실수를 못 박는다
            assert "ymd" not in 첫인자 and "date" not in 첫인자.lower(), \
                f"첫 자리에 날짜가 들어갔다: {첫인자}"

    @pytest.mark.skipif(
        pytest.importorskip("pykrx", reason="pykrx 미설치") is None, reason="")
    def test_실제_시그니처와_맞는다(self):
        """라이브러리가 인자 순서를 바꾸면 여기서 먼저 알아챈다."""
        from pykrx import stock
        칸 = list(inspect.signature(stock.get_etf_portfolio_deposit_file).parameters)
        assert 칸[0] == "ticker", f"pykrx 시그니처가 바뀌었다: {칸}"
        assert 칸[1] == "date", f"pykrx 시그니처가 바뀌었다: {칸}"

    def test_수급_조회는_원래_순서가_맞다(self):
        """같은 파일의 다른 pykrx 호출까지 흔들지 않았는지 확인한다.
        get_market_trading_value_by_date(fromdate, todate, ticker)"""
        호출 = _호출들("get_market_trading_value_by_date")
        assert 호출, "수급 조회가 사라졌다"
        인자 = [ast.unparse(a) for a in 호출[0].args]
        assert len(인자) >= 3
        assert "start" in 인자[0] and "end" in 인자[1] and "code" in 인자[2], 인자


class Test조용히_실패하지_않는다:
    def test_빈_결과에_이유를_남긴다(self):
        """빈 표가 오는 것은 예외가 아니라서 로그에 안 남았다.
        그래서 '왜 안 나오지' 를 코드만 보고는 알 수 없었다."""
        본문 = _보유비중구간()
        # 두 가지를 각각 남겨야 한다 — 하나만 보면 나머지를 지워도 통과한다
        assert "ETF 구성종목 조회 실패" in 본문, "KRX 호출이 터졌을 때 흔적이 없다"
        assert "ETF 구성종목 없음" in 본문, "빈 표가 왔을 때 흔적이 없다"
        assert 본문.count("log.warning") >= 3, "실패 자리마다 이유를 남겨야 한다"

    def test_성공했을_때도_개수를_남긴다(self):
        assert "log.info" in _보유비중구간()


class Test느려서_죽지_않는다:
    def test_종목명을_한_건씩_물어보지_않는다(self):
        """pykrx 로 이름을 하나씩 물으면 25번 왕복이다.
        우리 종목 DB 가 이미 코드→이름을 들고 있다."""
        본문 = _보유비중구간()
        assert "get_market_ticker_name" not in 본문, \
            "종목명을 KRX 에 한 건씩 묻고 있다 — 느려서 시한을 넘긴다"
        assert "get_kr_db()" in 본문

    def test_시한을_넘겨도_500_이_아니다(self):
        """_run 은 15초에서 자른다. 감싸지 않으면 그 예외가 그대로 올라가
        500 이 되고, 화면에는 '불러올 수 없습니다' 가 뜬다 —
        사실은 '아직 못 받았다' 인데."""
        전체 = _보유비중구간()
        본문 = 전체[전체.index("빈결과 = "):]
        assert 본문.count("try:") >= 2, "_run 호출을 감싸지 않았다"
        assert "except Exception:" in 본문

    def test_날짜_되짚기가_지나치지_않다(self):
        """한 번 물을 때마다 KRX 왕복이라 횟수가 그대로 응답 시간이 된다."""
        본문 = _보유비중구간()
        m = re.search(r"range\(0, (\d+)\)", 본문)
        assert m, "날짜 되짚기 구간을 못 찾음"
        assert int(m.group(1)) <= 5, "너무 많이 물러간다"
