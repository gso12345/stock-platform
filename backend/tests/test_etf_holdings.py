"""
국내 ETF 구성종목 — KRX 에 직접 묻는 경로를 지킨다.

여기까지 두 번 헛짚었다.
  1) pykrx 를 쓰면서 인자를 거꾸로 넘겼다. 시그니처는 (ticker, date) 인데
     (date, ticker) 로 줘서, 종목 자리에 날짜가 들어가 늘 빈 표가 왔다.
     예외가 아니라 빈 DataFrame 이라 로그에도 안 남았다.
  2) 순서를 고쳤더니 이번엔 pykrx 가 응답을 못 읽고 죽었다 —
     UnicodeDecodeError: ... 0xea ... unexpected end of data.
     pykrx 는 이 조회를 http:// 로 하고 자체 세션을 쓰는데, 그쪽으로 오는
     응답이 한글 한 글자가 잘린 채 끊겨 들어왔다.

그래서 pykrx 를 쓰지 않는다. 이 앱이 이미 잘 받고 있는 방식
(krx_listing 의 https + 브라우저 헤더)으로 직접 부른다.
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


def _코드만(본문: str) -> str:
    """주석과 문서화 문자열을 걷어낸다.

    설명에 "pykrx" 같은 낱말이 나올 수밖에 없다 — 무엇을 왜 그만뒀는지
    적어 두기 때문이다. 그걸 코드로 착각하면 멀쩡한 구현이 걸린다."""
    본문 = re.sub(r'"""[\s\S]*?"""', "", 본문)
    return re.sub(r"^\s*#.*$", "", 본문, flags=re.M)


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

    def test_pykrx_를_거치지_않는다(self):
        """pykrx 는 이 조회를 http:// 로 하고 자체 세션을 쓴다. 그쪽 응답이
        중간에 끊겨 들어와 UnicodeDecodeError 로 죽었다."""
        본문 = _코드만(_보유비중구간())
        assert "pykrx" not in 본문, "다시 pykrx 를 타고 있다"
        assert "get_etf_portfolio_deposit_file" not in 본문

    def test_이_앱이_쓰던_방식으로_부른다(self):
        """krx_listing 이 https + 브라우저 헤더로 잘 받고 있다. 같은 방식이라야
        같은 결과가 온다 — http 로 내려가면 그때 그 오류로 돌아간다."""
        본문 = _코드만(_보유비중구간())
        assert "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd" in 본문
        assert "http://data.krx.co.kr" not in 본문, "http 로 부르고 있다"
        assert "User-Agent" in 본문 and "Referer" in 본문, "브라우저 헤더가 없다"

    def test_두_단계를_모두_부른다(self):
        """KRX 는 6자리 코드가 아니라 ISIN 으로 종목을 받는다.
        목록(04601)으로 ISIN 을 얻고, PDF(05001)로 구성종목을 받는다."""
        본문 = _코드만(_보유비중구간())
        assert "MDCSTAT04601" in 본문, "ISIN 을 얻는 단계가 없다"
        assert "MDCSTAT05001" in 본문, "구성종목을 받는 단계가 없다"

    def test_ISIN_목록을_매번_받지_않는다(self):
        """전 종목 목록이라 무겁다. 하루에 한 번이면 충분하다."""
        본문 = _코드만(_보유비중구간())
        assert 'cache.get("krx_etf_isin")' in 본문
        assert "86400" in 본문

    def test_결과_배열_이름을_가려_읽는다(self):
        """KRX 는 화면마다 결과 배열의 이름이 다르다."""
        본문 = _코드만(_보유비중구간())
        for 이름 in ("output", "block1", "OutBlock_1"):
            assert f'"{이름}"' in 본문, f"{이름} 을 안 본다"

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

    def test_내부_사정을_화면에_보내지_않는다(self):
        """reason 은 사람이 읽는 한 문장이어야 한다. 예외 이름이나 스택을
        그대로 보내면 쓰는 사람에게는 뜻이 없고 서버 안쪽만 드러난다."""
        본문 = _보유비중구간()
        import re as _re
        for m in _re.finditer(r'"reason": ([^,\n}]+)', 본문):
            값 = m.group(1)
            assert "type(e)" not in 값 and "str(e)" not in 값 and "__name__" not in 값, \
                f"원시 예외를 화면으로 보낸다: {값}"

    def test_성공했을_때도_개수를_남긴다(self):
        assert "log.info" in _보유비중구간()


class Test느려서_죽지_않는다:
    def test_종목명을_한_건씩_물어보지_않는다(self):
        """pykrx 로 이름을 하나씩 물으면 25번 왕복이다.
        우리 종목 DB 가 이미 코드→이름을 들고 있다."""
        본문 = _코드만(_보유비중구간())
        assert "get_market_ticker_name" not in 본문, \
            "종목명을 KRX 에 한 건씩 묻고 있다 — 느려서 시한을 넘긴다"
        # KRX 가 구성종목 이름을 같이 준다. 따로 물을 필요가 없다
        assert "COMPST_ISU_NM" in 본문

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
