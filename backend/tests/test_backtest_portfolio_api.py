"""자산배분 백테스트 라우트 — **시세를 못 받았을 때**를 본다.

── 왜 이 파일이 따로 있나 ─────────────────────────────────

엔진(test_portfolio_backtest.py)은 이미 촘촘히 검사돼 있다. 그런데
엔진이 다 맞아도 라우트가 죽으면 사용자는 아무것도 못 본다.

실제로 그랬다. `_시세모으기` 의 `except` 안에서 `log.info(...)` 를
부르는데 그 파일에 `log` 가 없었다. 야후가 한 번 실패하는 순간
**예외 처리기 자체가 NameError 로 터져서** 500 이 나갔다. 원래는
'그 자산만 빼고 나머지로 계산' 이었어야 할 자리다.

검사로는 안 잡혔다 — 검사는 전부 엔진을 직접 불렀고, 라우트의
except 로 들어가는 길은 아무도 안 밟았다. 앱을 실제로 띄워
요청을 넣어 보고서야 나왔다.

── 여기서 못 박는 것 ───────────────────────────────────────

  ① 한 자산이 실패해도 **나머지로 계산해서 200 을 준다**
  ② 실패한 자산을 **skipped 에 적어 보낸다** (조용히 빼지 않는다)
  ③ 전부 실패하면 500 이 아니라 **400 과 사람이 읽을 말**
"""
import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _횟수제한_지우기():
    """검사마다 호출 횟수를 0 으로 되돌린다.

    /portfolio 에는 분당 10회 제한이 걸려 있다(실서비스에 필요한
    장치다 — 한 번에 시세를 열둘씩 받는 무거운 자리라 막아 둬야 한다).
    그런데 이 파일은 그보다 많이 부르므로, 뒤쪽 검사가 전부 429 를
    받고 엉뚱한 곳에서 KeyError 로 깨진다. 단독으로 돌리면 통과하고
    전체로 돌리면 깨지는, 제일 헷갈리는 모양이다.

    제한을 없애는 대신 **횟수만** 지운다. 제한 자체는 그대로 둬야
    누가 데코레이터를 떼었을 때 알아챌 수 있다.
    """
    _횟수리셋()
    yield
    _횟수리셋()


def _횟수리셋():
    from app.api.routes import backtest as R
    try:
        R.limiter._storage.reset()
    except Exception:
        pass


def 봉들(n=700, 시작=date(2019, 1, 2), 값=100.0):
    """yf_service.get_ohlcv 가 주는 모양 그대로"""
    나온것, d = [], 시작
    while len(나온것) < n:
        if d.weekday() < 5:
            나온것.append({"date": d.isoformat(), "open": 값, "high": 값,
                           "low": 값, "close": 값 + len(나온것) * 0.05,
                           "volume": 1000})
        d += timedelta(days=1)
    return 나온것


def _몸(자산들, **더):
    끝 = date(2021, 12, 30)
    기본 = {
        "assets": 자산들,
        "currency": "USD",
        "initial_amount": 10_000_000,
        "start_date": "2019-01-02",
        "end_date": 끝.isoformat(),
        "contribution_period": "none",
        "contribution_amount": 0,
        "rebalance_period": "yearly",
        # 배당까지 받으면 검사가 느려지고, 여기서 보려는 것도 아니다
        "total_return": False,
    }
    기본.update(더)
    return 기본


class Test시세를_못_받았을_때:
    def test_하나가_실패해도_나머지로_계산한다(self, client, monkeypatch):
        """야후는 자주 한두 개만 실패한다. 그때마다 화면 전체가
        500 이면 이 기능은 사실상 못 쓴다."""
        from app.api.routes import backtest as R

        def 시세(symbol, period, interval, market):
            if symbol == "터지는놈":
                raise RuntimeError("야후가 안 준다")
            return 봉들()

        monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)

        r = client.post("/api/v1/backtest/portfolio", json=_몸([
            {"symbol": "SPY", "market": "US", "weight": 50},
            {"symbol": "터지는놈", "market": "US", "weight": 50},
        ]))
        assert r.status_code == 200, f"실패 하나에 통째로 죽었다 — {r.text[:300]}"
        d = r.json()
        assert d["final_value"] > 0

    def test_뺀_자산을_감추지_않는다(self, client, monkeypatch):
        """조용히 빼면 사용자는 두 개를 담은 줄 알고 한 개짜리 결과를
        본다. 백테스트에서 제일 나쁜 실패다."""
        from app.api.routes import backtest as R

        def 시세(symbol, period, interval, market):
            if symbol == "터지는놈":
                raise RuntimeError("야후가 안 준다")
            return 봉들()

        monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)

        r = client.post("/api/v1/backtest/portfolio", json=_몸([
            {"symbol": "SPY", "market": "US", "weight": 50},
            {"symbol": "터지는놈", "market": "US", "weight": 50},
        ]))
        assert r.status_code == 200
        assert "터지는놈" in r.json()["skipped"]

    def test_전부_실패하면_종목_코드를_보라고_말한다(self, client, monkeypatch):
        """400 인 것만으로는 모자라다. **어떤 말인지**가 중요하다.

        이 자리를 그냥 지나가게 두면 아래의 다른 검사에 걸려 결국
        400 은 나간다 — 그런데 그 말은 '겹치는 기간이 너무 짧습니다,
        기간을 늘려 보세요' 다. 종목 코드를 잘못 친 사람은 그 말을
        믿고 기간을 늘려 다시 돌린다. 그리고 또 실패한다.

        **틀린 안내는 오류 메시지가 없는 것보다 나쁘다.** 그래서
        상태 코드가 아니라 말을 본다. (상태 코드만 봤더니 뮤테이션이
        그대로 살아남았다.)
        """
        from app.api.routes import backtest as R

        def 다터짐(symbol, period, interval, market):
            raise RuntimeError("야후가 안 준다")

        monkeypatch.setattr(R.yf_service, "get_ohlcv", 다터짐)

        r = client.post("/api/v1/backtest/portfolio", json=_몸([
            {"symbol": "없는종목", "market": "US", "weight": 100},
        ]))
        assert r.status_code == 400, f"500 이 나갔다 — {r.text[:300]}"
        말 = r.json()["detail"]
        assert isinstance(말, str)
        assert "종목" in 말 and "기간" not in 말, \
            f"시세를 못 받은 것인데 엉뚱한 안내를 한다 — {말!r}"

    def test_환율을_못_받으면_그_자산을_빼고_알린다(self, client, monkeypatch):
        """억지로 1:1 로 더하면 '71,000 + 225' 같은 뜻 없는 수가 된다.
        조용히 틀리느니 빼고 말하는 쪽이 낫다."""
        from app.api.routes import backtest as R

        def 시세(symbol, period, interval, market):
            if symbol == "USDKRW=X":
                raise RuntimeError("환율을 못 받는다")
            return 봉들()

        monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)

        r = client.post("/api/v1/backtest/portfolio", json=_몸([
            {"symbol": "SPY", "market": "US", "weight": 50},
            {"symbol": "005930", "market": "KR", "weight": 50},
        ], currency="KRW"))
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "SPY" in d["fx_skipped"], "환율 없이 달러를 원화에 그냥 더했다"
        assert d["mixed_currency"] is True


class Test예외_처리기가_스스로_터지지_않는다:
    """`except` 안에서 죽는 것은 특별히 고약하다.

    아무 일도 없을 때는 멀쩡히 돌고, **하필 뭔가 잘못됐을 때** 죽는다.
    그래서 개발 중에는 절대 안 보이고 실제 사용자만 만난다.
    """

    def test_로거가_정의돼_있다(self):
        from app.api.routes import backtest as R
        assert hasattr(R, "log"), \
            ("backtest.py 에 log 가 없다. 시세 실패를 적으려다 NameError 가 "
             "나서 500 이 된다 — 실제로 그렇게 났었다.")

    def test_모든_except_가_실제로_불러_봐도_안_터진다(self, client, monkeypatch):
        """위 검사는 이름만 본다. 여기서는 정말로 실패시켜 본다 —
        시세·환율·배당 세 길을 한꺼번에 터뜨린다."""
        from app.api.routes import backtest as R
        from app.services import dividend_service as DV

        def 다터짐(*a, **k):
            raise RuntimeError("전부 안 된다")

        monkeypatch.setattr(R.yf_service, "get_ohlcv", 다터짐)
        monkeypatch.setattr(DV, "한종목", 다터짐)

        r = client.post("/api/v1/backtest/portfolio", json=_몸([
            {"symbol": "SPY", "market": "US", "weight": 60},
            {"symbol": "005930", "market": "KR", "weight": 40},
        ], currency="KRW", total_return=True))
        assert r.status_code == 400, f"예외 처리기가 스스로 터졌다 — {r.text[:300]}"


class Test확장_ETF_가격:
    """ETF 가 생기기 전 구간을 지수로 잇는다.

    ── 여기서 제일 틀리기 쉬운 것 ──────────────────────────────

    **가격을 그대로 이어 붙이면 안 된다.** SPY 는 400 근처이고 ^GSPC 는
    5,000 근처다. 그냥 붙이면 ETF 가 시작하는 날 하루 만에 92% 폭락한
    것으로 잡힌다. 최대 낙폭이 -92% 로 나오고 수익률도 통째로 망가진다.

    이어야 할 것은 **수익률**이다. ETF 첫날 가격을 기준으로 지수를
    비율만큼 되감아 두 구간이 그 지점에서 매끄럽게 이어지게 만든다.
    """

    def test_이은_자리에서_값이_안_튄다(self):
        from app.api.routes.backtest import 앞에잇기
        from datetime import date as D
        지수 = {D(2020, 1, i): 1000.0 + i for i in range(1, 21)}
        etf = {D(2020, 1, i): 50.0 + i * 0.05 for i in range(10, 21)}

        이은것, 부터 = 앞에잇기(etf, 지수)
        assert 부터 == "2020-01-01"
        # 이음날 바로 앞과 뒤의 차이가 지수의 하루 변동과 비슷해야 한다
        앞 = 이은것[D(2020, 1, 9)]
        뒤 = 이은것[D(2020, 1, 10)]
        튐 = abs(뒤 - 앞) / 앞 * 100
        assert 튐 < 1, \
            (f"이은 자리에서 {튐:.0f}% 튀었다 — 가격을 그대로 붙였다. "
             "되감아서 수익률을 이어야 한다")
        # ETF 구간은 손대지 않는다
        assert 이은것[D(2020, 1, 15)] == etf[D(2020, 1, 15)]

    def test_되감은_값이_지수의_수익률을_그대로_갖는다(self):
        """이은 구간에서 하루 수익률이 지수와 같아야 한다.
        비율이 아니라 차이로 되감으면 여기서 갈린다."""
        from app.api.routes.backtest import 앞에잇기
        from datetime import date as D
        지수 = {D(2020, 1, 1): 1000.0, D(2020, 1, 2): 1100.0,   # +10%
                D(2020, 1, 3): 1000.0}
        etf = {D(2020, 1, 3): 50.0}
        이은것, _ = 앞에잇기(etf, 지수)
        올랐다 = 이은것[D(2020, 1, 2)] / 이은것[D(2020, 1, 1)] - 1
        assert 올랐다 == pytest.approx(0.10), \
            f"이은 구간의 수익률이 {올랐다:.1%} 다 — 지수는 +10% 였다"

    def test_지수가_없으면_원래_시세를_그대로_쓴다(self):
        """'확장' 은 더 보여 주려는 것이지, 없으면 못 쓰는 것이 아니다"""
        from app.api.routes.backtest import 앞에잇기
        from datetime import date as D
        etf = {D(2020, 1, 3): 50.0}
        assert 앞에잇기(etf, {}) == (etf, None)
        assert 앞에잇기(etf, {D(2021, 1, 1): 9.0}) == (etf, None)   # 앞이 없다

    def test_요청하면_이은_사실을_알려_준다(self, client, monkeypatch):
        """조용히 이으면 사용자는 1980년치 SPY 자료가 있는 줄 안다 —
        실제로는 지수를 본 것이고, 지수에는 배당도 보수도 없다."""
        from app.api.routes import backtest as R
        from datetime import date as D

        def 시세(symbol, period, interval, market):
            if symbol == "^GSPC":
                return 봉들(1400, D(2015, 1, 1), 100.0)
            return 봉들(700, D(2019, 1, 2), 50.0)

        monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)
        몸 = _몸([{"symbol": "SPY", "market": "US", "weight": 100}],
                 start_date="2015-01-01")
        없이 = client.post("/api/v1/backtest/portfolio", json=몸).json()
        같이 = client.post("/api/v1/backtest/portfolio",
                           json={**몸, "extended": True}).json()
        assert 없이["extended_from"] == {}
        assert "SPY" in 같이["extended_from"], "이었는데 말을 안 한다"
        assert 같이["start_date"] < 없이["start_date"], "이었는데 기간이 안 늘었다"


class Test벤치마크:
    def test_내가_잰_것과_같은_기간을_잰다(self, client, monkeypatch):
        """자산 하나가 늦게 상장해 2004년부터 재게 됐는데 벤치마크만
        2003년부터 재면, 더 긴 기간의 수익률과 견주는 셈이다.
        둘 다 맞는 수인데 비교만 틀린다 — 제일 알아채기 어렵다.
        (실제로 6040 이 277점, 내 것이 263점으로 나왔다.)"""
        from app.api.routes import backtest as R
        from datetime import date as D

        def 시세(symbol, period, interval, market):
            # 내 자산만 늦게 시작한다
            if symbol == "늦둥이":
                return 봉들(400, D(2020, 6, 1))
            return 봉들(900, D(2019, 1, 2))

        monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)
        r = client.post("/api/v1/backtest/portfolio", json=_몸(
            [{"symbol": "늦둥이", "market": "US", "weight": 100}],
            start_date="2019-01-02", end_date="2022-06-30", benchmark="spy"))
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        벤 = d["benchmark"]
        assert 벤 is not None, "벤치마크가 안 나왔다"
        assert len(벤["curve"]) == len(d["curve"]), \
            (f"벤치마크가 {len(벤['curve'])}점, 내 것이 {len(d['curve'])}점이다 — "
             "다른 기간끼리 견주고 있다")

    def test_없음이면_안_돌린다(self, client, monkeypatch):
        """쓸데없이 시세를 더 받으면 그만큼 느려진다"""
        from app.api.routes import backtest as R
        부른것 = []

        def 시세(symbol, period, interval, market):
            부른것.append(symbol)
            return 봉들()

        monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)
        client.post("/api/v1/backtest/portfolio", json=_몸(
            [{"symbol": "AAA", "market": "US", "weight": 100}], benchmark="none"))
        assert 부른것 == ["AAA"], f"없음인데 더 받았다 — {부른것}"

    def test_벤치마크가_실패해도_내_결과는_나온다(self, client, monkeypatch):
        """견주는 것은 덤이다. 덤 때문에 본래 답까지 버리면 안 된다."""
        from app.api.routes import backtest as R

        def 시세(symbol, period, interval, market):
            if symbol in ("SPY", "AGG"):
                raise RuntimeError("벤치마크만 안 된다")
            return 봉들()

        monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)
        r = client.post("/api/v1/backtest/portfolio", json=_몸(
            [{"symbol": "AAA", "market": "US", "weight": 100}], benchmark="6040"))
        assert r.status_code == 200, r.text[:300]
        assert r.json()["final_value"] > 0
        assert r.json()["benchmark"] is None

    def test_모르는_이름은_거른다(self, client):
        r = client.post("/api/v1/backtest/portfolio", json=_몸(
            [{"symbol": "AAA", "market": "US", "weight": 100}], benchmark="없는것"))
        assert r.status_code == 422


class Test거래비용_퍼센트:
    def test_화면은_퍼센트로_주고_서버가_비율로_바꾼다(self, client, monkeypatch):
        """0.1 을 그대로 엔진에 넣으면 수수료가 10% 가 된다 — 100배다.
        결과는 통째로 무너지는데 오류는 안 나므로 '왜 이렇게 손해지'
        만 남는다."""
        from app.api.routes import backtest as R
        monkeypatch.setattr(R.yf_service, "get_ohlcv", lambda *a, **k: 봉들())

        r = client.post("/api/v1/backtest/portfolio", json=_몸(
            [{"symbol": "AAA", "market": "US", "weight": 100}], cost_rate=0.1))
        d = r.json()
        # 1,000만원의 0.1% = 1만원. 10% 면 100만원이다.
        assert d["costs"] == pytest.approx(10_000, rel=0.01), \
            f"수수료가 {d['costs']:,.0f} 이다 — 퍼센트를 비율로 안 바꿨다"
        assert d["costs_included"] is True

    def test_0_이면_안_넣은_것으로_적는다(self, client, monkeypatch):
        from app.api.routes import backtest as R
        monkeypatch.setattr(R.yf_service, "get_ohlcv", lambda *a, **k: 봉들())
        d = client.post("/api/v1/backtest/portfolio", json=_몸(
            [{"symbol": "AAA", "market": "US", "weight": 100}])).json()
        assert d["costs_included"] is False and d["costs"] is None


class Test월_데이터:
    def test_점이_확_줄어든다(self, client, monkeypatch):
        from app.api.routes import backtest as R
        monkeypatch.setattr(R.yf_service, "get_ohlcv", lambda *a, **k: 봉들())
        몸 = _몸([{"symbol": "AAA", "market": "US", "weight": 100}])
        일별 = client.post("/api/v1/backtest/portfolio", json=몸).json()
        월별 = client.post("/api/v1/backtest/portfolio",
                           json={**몸, "data_interval": "monthly"}).json()
        assert len(월별["curve"]) < len(일별["curve"]) / 15
        assert 월별["data_interval"] == "monthly"

    def test_수치도_같은_날들_위에서_잰다(self, client, monkeypatch):
        """곡선만 솎으면 그래프는 가벼워도 수익률·낙폭은 일별 값이라,
        화면의 그림과 숫자가 서로 다른 것을 말하게 된다.

        수수료로 본다 — 리밸런싱이 일어난 날 수가 다르면 수수료도
        달라진다. 자산이 **둘 이상이고 서로 다르게 움직여야** 한다.
        (하나만 담으면 비중이 늘 100% 라 리밸런싱이 아무것도 안
        사고팔고, 수수료가 첫날치로 똑같이 나온다. 그렇게 짰다가
        이 검사가 헛돌았다.)"""
        from app.api.routes import backtest as R

        def 시세(symbol, period, interval, market):
            #: 오르는 쪽과 제자리인 쪽 — 그래야 비중이 틀어지고 리밸런싱이 산다
            if symbol == "오름":
                return [{**r, "close": 100 * (1.002 ** i)}
                        for i, r in enumerate(봉들())]
            return [{**r, "close": 100.0} for r in 봉들()]

        monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)
        몸 = _몸([{"symbol": "오름", "market": "US", "weight": 50},
                  {"symbol": "제자리", "market": "US", "weight": 50}],
                 rebalance_period="monthly", cost_rate=0.1)
        일별 = client.post("/api/v1/backtest/portfolio", json=몸).json()
        월별 = client.post("/api/v1/backtest/portfolio",
                           json={**몸, "data_interval": "monthly"}).json()
        assert 일별["costs"] > 10_000, "리밸런싱이 아무것도 안 사고팔았다 — 검사 자료를 보라"
        assert 월별["costs"] != 일별["costs"], \
            (f"월 {월별['costs']} · 일 {일별['costs']} 로 똑같다 — "
             "곡선만 솎고 계산은 일별로 하고 있다")


class Test동일_비중:
    def test_적은_비중을_무시하고_똑같이_나눈다(self, client, monkeypatch):
        from app.api.routes import backtest as R
        monkeypatch.setattr(R.yf_service, "get_ohlcv", lambda *a, **k: 봉들())
        r = client.post("/api/v1/backtest/portfolio", json=_몸([
            {"symbol": "AAA", "market": "US", "weight": 90},
            {"symbol": "BBB", "market": "US", "weight": 10},
        ], equal_weight=True))
        비중 = [a["weight"] for a in r.json()["assets"]]
        assert 비중 == pytest.approx([0.5, 0.5]), \
            f"동일 비중인데 {비중} 로 나왔다"

    def test_끄면_적은_대로_쓴다(self, client, monkeypatch):
        from app.api.routes import backtest as R
        monkeypatch.setattr(R.yf_service, "get_ohlcv", lambda *a, **k: 봉들())
        r = client.post("/api/v1/backtest/portfolio", json=_몸([
            {"symbol": "AAA", "market": "US", "weight": 90},
            {"symbol": "BBB", "market": "US", "weight": 10},
        ]))
        assert [a["weight"] for a in r.json()["assets"]] == pytest.approx([0.9, 0.1])


class Test현금만_담아도_안_죽는다:
    def test_현금뿐이면_400(self, client, monkeypatch):
        """굴릴 것이 없다. 이자를 지어내느니 안 재는 편이 낫다."""
        from app.api.routes import backtest as R
        monkeypatch.setattr(R.yf_service, "get_ohlcv",
                            lambda *a, **k: 봉들())

        r = client.post("/api/v1/backtest/portfolio", json=_몸([
            {"symbol": "현금", "market": "KR", "weight": 100},
        ], currency="KRW"))
        assert r.status_code == 400
        assert isinstance(r.json()["detail"], str)
