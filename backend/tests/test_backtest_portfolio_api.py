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
