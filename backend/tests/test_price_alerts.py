"""가격 알림 — 언제 울리고, 언제 울리지 않는가.

이 기능은 두 가지로 망가지기 쉽다.

  1) 안 울린다. 시세가 캐시에 없거나, 조건 판정이 경계에서 어긋나거나,
     확인 함수가 예외로 죽는데 아무도 모른다.
  2) 너무 울린다. 8만원을 넘나드는 동안 30초마다 한 줄씩 쌓이면
     알림함이 그 종목 하나로 뒤덮인다.

둘 다 조용히 일어나므로 규칙을 못 박아 둔다.

그리고 이 기능은 0.15 CPU 서버에서 30초마다 돈다. '알림 확인 때문에
시세를 새로 받는다' 가 되는 순간 서버가 그것만 하다 끝난다 —
캐시만 읽는다는 것도 함께 고정한다.
"""
from datetime import datetime, timezone

import pytest

from app.services import alert_checker as A
from app.api.routes import alerts as R


# ── 대역 ──────────────────────────────────────────────────────
class _알림:
    """PriceAlert 한 줄. 실제 모델 대신 값만 들고 있는다."""
    def __init__(self, **kw):
        self.id = kw.get("id", 1)
        self.user_id = kw.get("user_id", 7)
        self.symbol = kw.get("symbol", "005930")
        self.market = kw.get("market", "KR")
        self.name = kw.get("name", "삼성전자")
        self.direction = kw.get("direction", "above")
        self.target = kw.get("target", 80_000.0)
        self.made_at_price = kw.get("made_at_price")
        self.is_active = kw.get("is_active", True)
        self.fired_at = kw.get("fired_at")
        self.fired_price = kw.get("fired_price")


class _질의:
    def __init__(self, rows): self._rows = rows
    def filter(self, *a, **k): return self
    def order_by(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def all(self): return list(self._rows)
    def first(self): return self._rows[0] if self._rows else None
    def count(self): return len(self._rows)


class _DB:
    def __init__(self, rows=(), 터질때=None):
        self.rows, self.added = list(rows), []
        self.commits = self.rollbacks = self.closes = self.flushes = 0
        self._터질때 = 터질때            # "query" | "commit" | None
    def query(self, *a, **k):
        if self._터질때 == "query":
            raise RuntimeError("표가 없다")
        return _질의(self.rows)
    def add(self, o): self.added.append(o)
    def flush(self):
        """새 줄에 id 를 매긴다 — 진짜 DB 가 하는 일을 흉내 낸다.
        커밋 전에 id 를 받아야 응답을 만들 수 있다(왕복 하나를 아낀다)."""
        self.flushes += 1
        for i, o in enumerate(self.added, start=1):
            if getattr(o, "id", None) is None:
                o.id = 1000 + i
    def delete(self, o): self.rows = [r for r in self.rows if r is not o]
    def commit(self):
        if self._터질때 == "commit":
            raise RuntimeError("커밋 실패")
        self.commits += 1
    def refresh(self, o): pass
    def rollback(self): self.rollbacks += 1
    def close(self): self.closes += 1


@pytest.fixture
def 시세():
    """price:{symbol} 캐시에 값을 넣었다 치우는 도구."""
    from app.core.cache import cache
    넣은것 = []

    def 넣기(symbol, price):
        cache.set(f"price:{symbol}", {"price": price}, 60)
        넣은것.append(f"price:{symbol}")
    yield 넣기
    for k in 넣은것:
        cache.delete(k)


@pytest.fixture
def 붙이기(monkeypatch):
    """확인하기() 가 쓸 SessionLocal 을 대역으로 바꾼다."""
    def 하기(db):
        import app.db.database as D
        monkeypatch.setattr(D, "SessionLocal", lambda: db)
    return 하기


# ── 조건 판정 ─────────────────────────────────────────────────
class Test조건:
    @pytest.mark.parametrize("방향, 목표, 지금, 기대", [
        ("above", 80_000, 80_001, True),
        ("above", 80_000, 80_000, True),    # 딱 맞으면 닿은 것이다
        ("above", 80_000, 79_999, False),
        ("below", 80_000, 79_999, True),
        ("below", 80_000, 80_000, True),
        ("below", 80_000, 80_001, False),
    ])
    def test_경계값(self, 방향, 목표, 지금, 기대):
        assert A._닿았나(방향, 목표, 지금) is 기대

    def test_문구는_시장에_맞는_단위를_쓴다(self):
        말 = A._문구("삼성전자", "above", 80_000, 80_500, "KR")
        assert "80,000원" in 말 and "80,500원" in 말 and "이상" in 말

        말 = A._문구("NVDA", "below", 100, 99.5, "US")
        assert "$100.00" in 말 and "$99.50" in 말 and "이하" in 말


# ── 울리는 경로 ───────────────────────────────────────────────
class Test울림:
    def test_닿으면_한_줄_넣고_스스로_꺼진다(self, 시세, 붙이기):
        시세("005930", 80_500)
        a = _알림(direction="above", target=80_000)
        db = _DB([a]); 붙이기(db)

        assert A.확인하기() == 1
        assert len(db.added) == 1 and db.commits == 1

        n = db.added[0]
        assert n.kind == "price_alert"
        assert n.user_id == a.user_id
        assert n.actor_id is None            # 사람이 한 일이 아니다
        # 눌렀을 때 그 종목으로 갈 수 있어야 알림이 쓸모 있다
        assert n.symbol == "005930" and n.market == "KR"
        assert "80,000원" in (n.preview or "")

        assert a.is_active is False          # 한 번 울리고 스스로 꺼진다
        assert a.fired_price == 80_500 and a.fired_at is not None

    def test_한_번_울린_알림은_다음_회차에_다시_안_울린다(self, 시세, 붙이기):
        """이 검사가 '도배' 를 막는 자리다.

        확인은 30초마다 돈다. 껐다는 표시를 안 하면 8만원 위에 머무는
        동안 계속 쌓여, 두 시간이면 240줄이 된다."""
        시세("005930", 80_500)
        a = _알림(direction="above", target=80_000)
        db = _DB([a]); 붙이기(db)
        assert A.확인하기() == 1

        # 다음 회차 — 꺼진 것은 조회에서 빠진다(is_active 필터)
        db2 = _DB([r for r in [a] if r.is_active]); 붙이기(db2)
        assert A.확인하기() == 0
        assert db2.added == []

    def test_아직_안_닿으면_아무것도_안_한다(self, 시세, 붙이기):
        시세("005930", 79_000)
        a = _알림(direction="above", target=80_000)
        db = _DB([a]); 붙이기(db)
        assert A.확인하기() == 0
        assert db.added == [] and db.commits == 0 and a.is_active is True

    def test_시세가_없으면_넘어가고_알림은_살아_있다(self, 붙이기):
        """캐시에 값이 없다고 여기서 새로 받아 오면 안 된다.

        30초마다 도는 자리다. 켜진 알림이 수천 개면 그만큼 바깥 조회가
        나가고, 0.15 CPU 서버는 그것만 하다 끝난다."""
        from app.core.cache import cache
        cache.delete("price:없는종목")
        a = _알림(symbol="없는종목")
        db = _DB([a]); 붙이기(db)
        assert A.확인하기() == 0
        assert a.is_active is True           # 다음 회차에 다시 본다

    def test_여러_건_중_닿은_것만_울린다(self, 시세, 붙이기):
        시세("005930", 80_500)
        시세("AAPL", 100.0)
        닿음 = _알림(id=1, symbol="005930", direction="above", target=80_000)
        아직 = _알림(id=2, symbol="AAPL", market="US", direction="above", target=250)
        db = _DB([닿음, 아직]); 붙이기(db)

        assert A.확인하기() == 1
        assert db.commits == 1               # 커밋은 한 번만
        assert 닿음.is_active is False and 아직.is_active is True


# ── 죽지 않는다 ───────────────────────────────────────────────
class Test안죽는다:
    """확인하기() 는 30초 주기 갱신 안에서 불린다.

    여기서 예외가 밖으로 나가면 시세·뉴스·순위 갱신이 통째로 멈춘다 —
    고치려던 것보다 나쁘다."""

    @pytest.mark.parametrize("터질때", ["query", "commit"])
    def test_어디서_터져도_예외를_안_내보낸다(self, 시세, 붙이기, 터질때):
        시세("005930", 80_500)
        db = _DB([_알림()], 터질때=터질때); 붙이기(db)
        assert A.확인하기() == 0
        assert db.rollbacks == 1 and db.closes == 1

    def test_켜진_것이_없으면_곧장_끝난다(self, 붙이기):
        db = _DB([]); 붙이기(db)
        assert A.확인하기() == 0
        assert db.added == [] and db.commits == 0

    def test_한_회차에_보는_수에_상한이_있다(self):
        assert 0 < A.한회차_최대 <= 5000


# ── 거는 쪽 ───────────────────────────────────────────────────
def _생짜(f):
    """slowapi 데코레이터를 벗겨 원래 함수를 꺼낸다."""
    return getattr(f, "__wrapped__", f)


class Test거는쪽:
    def test_값의_형태를_고정한다(self):
        from pydantic import ValidationError
        for 나쁜값 in [
            {"symbol": "", "market": "KR", "direction": "above", "target": 1},
            {"symbol": "005930'; DROP", "market": "KR", "direction": "above", "target": 1},
            {"symbol": "005930", "market": "JP", "direction": "above", "target": 1},
            {"symbol": "005930", "market": "KR", "direction": "up", "target": 1},
            {"symbol": "005930", "market": "KR", "direction": "above", "target": 0},
            {"symbol": "005930", "market": "KR", "direction": "above", "target": -1},
        ]:
            with pytest.raises(ValidationError):
                R.알림요청(**나쁜값)

        ok = R.알림요청(symbol="005930", market="KR", direction="above", target=80_000)
        assert ok.name == ""                 # 이름은 없어도 된다

    def test_한_사람이_걸_수_있는_수에_상한이_있다(self):
        from fastapi import HTTPException
        db = _DB([_알림(id=i) for i in range(R.최대_알림수)])
        me = type("나", (), {"id": 7})()
        본문 = R.알림요청(symbol="005930", market="KR", direction="above", target=80_000)
        with pytest.raises(HTTPException) as e:
            _생짜(R.만들기)(request=None, 본문=본문, db=db, me=me)
        assert e.value.status_code == 400
        assert db.added == []

    def test_같은_조건을_또_걸면_새로_안_만들고_켜기만_한다(self):
        """껐다 켰다는 흔한 동작이다. 그때마다 새 줄이 쌓이면 목록이
        같은 알림으로 뒤덮인다 — 표에도 한 벌로 못 박아 뒀다."""
        있던것 = _알림(is_active=False, fired_at=datetime.now(timezone.utc), fired_price=80_100)
        db = _DB([있던것])
        me = type("나", (), {"id": 7})()
        본문 = R.알림요청(symbol="005930", market="KR", direction="above", target=80_000)

        # 상한 검사(count)와 중복 검사(first)가 같은 _질의 를 쓰므로
        # 상한에 안 걸리게 한 줄만 둔다
        나온것 = _생짜(R.만들기)(request=None, 본문=본문, db=db, me=me)
        assert db.added == []                # 새 줄을 안 만든다
        assert 있던것.is_active is True
        assert 있던것.fired_at is None and 있던것.fired_price is None
        assert 나온것["id"] == 있던것.id and 나온것["is_active"] is True

    def test_없던_조건이면_새로_만든다(self):
        """방금 만든 줄의 id 를 응답에 실어야 한다.

        화면은 그 id 로 스위치를 끄고 켠다. id 가 없으면 방금 건 알림을
        지울 수도 끌 수도 없다 — 새로고침해야 손댈 수 있게 된다.

        커밋 뒤에 다시 읽지 않고 flush 로 id 를 받는다(왕복 하나를 아낀다).
        그래서 flush 가 실제로 불렸는지도 같이 본다."""
        db = _DB([])                     # 걸어 둔 것이 하나도 없다
        me = type("나", (), {"id": 7})()
        본문 = R.알림요청(symbol="005930", market="KR", name="삼성전자",
                          direction="above", target=80_000)
        나온것 = _생짜(R.만들기)(request=None, 본문=본문, db=db, me=me)

        assert len(db.added) == 1 and db.commits == 1
        assert db.flushes == 1, "id 를 못 받은 채 응답을 만들었다"
        assert 나온것["id"] and 나온것["id"] > 0
        assert 나온것["symbol"] == "005930" and 나온것["is_active"] is True
        assert 나온것["target"] == 80_000

    def test_응답을_만든_뒤에_커밋한다(self):
        """refresh 를 빼면서 순서가 중요해졌다.

        커밋이 먼저 나면 SQLAlchemy 가 속성을 만료시켜서, 응답을 만들
        때 방금 쓴 줄을 다시 읽어 온다 — 아끼려던 왕복이 그대로 되살아난다."""
        import inspect
        본문 = inspect.getsource(R.만들기)
        답자리 = 본문.index("답 = _내보내기(새것)")
        커밋자리 = 본문.index("db.commit()", 답자리)
        assert 답자리 < 커밋자리
        assert "db.refresh" not in 본문, "refresh 가 되살아났다 — 왕복이 하나 늘어난다"

    def test_다시_켜면_지난_기록을_지운다(self):
        a = _알림(is_active=False, fired_at=datetime.now(timezone.utc), fired_price=80_100)
        db = _DB([a])
        me = type("나", (), {"id": 7})()
        나온것 = _생짜(R.켜고끄기)(request=None, 알림id=1, db=db, me=me)
        assert a.is_active is True and a.fired_at is None and a.fired_price is None
        assert 나온것["fired_at"] is None

    def test_켜져_있으면_끈다(self):
        a = _알림(is_active=True)
        db = _DB([a])
        me = type("나", (), {"id": 7})()
        _생짜(R.켜고끄기)(request=None, 알림id=1, db=db, me=me)
        assert a.is_active is False

    def test_목표가를_고칠_수_있다(self):
        """예전에는 이 자리가 없었다. 79,000 을 78,000 으로 낮추려면
        지우고 다시 걸어야 했는데, 왕복이 두 번인 데다 지우기만 하고
        다시 거는 걸 잊으면 알림이 통째로 사라진다.

        '8만원 되면 알려줘' 는 한 번에 딱 맞게 잡히는 값이 아니라
        몇 번 만져 보게 되는 값이다."""
        a = _알림(id=1, target=79_000, direction="above")
        db = _DB([a])
        me = type("나", (), {"id": 7})()
        본문 = R.고치기요청(direction="below", target=78_000)
        나온것 = _생짜(R.고치기)(request=None, 본문=본문, 알림id=1, db=db, me=me)

        assert a.target == 78_000 and a.direction == "below"
        assert 나온것["target"] == 78_000 and 나온것["direction"] == "below"
        assert db.commits == 1
        assert db.added == [], "고치는데 새 줄을 만들었다"

    def test_고치면_다시_울릴_수_있게_되돌린다(self):
        """울린 알림은 스스로 꺼진다. 79,000 에서 울렸던 알림의 목표를
        85,000 으로 올렸는데 꺼진 채로 두면 새 조건은 영영 안 울린다 —
        사용자는 고쳤다고 생각하고 기다린다."""
        a = _알림(id=1, target=79_000, is_active=False,
                  fired_at=datetime.now(timezone.utc), fired_price=79_100)
        db = _DB([a])
        me = type("나", (), {"id": 7})()
        본문 = R.고치기요청(direction="above", target=85_000)
        나온것 = _생짜(R.고치기)(request=None, 본문=본문, 알림id=1, db=db, me=me)

        assert a.is_active is True
        assert a.fired_at is None and a.fired_price is None
        assert 나온것["is_active"] is True and 나온것["fired_at"] is None

    def test_같은_조건이_이미_있으면_거절한다(self):
        """표에 (user, symbol, direction, target) 이 한 벌로 못 박혀 있다.
        그냥 두면 DB 가 거절하고 사용자에게는 알 수 없는 500 이 간다."""
        from fastapi import HTTPException
        고칠것 = _알림(id=1, target=79_000, direction="above")
        이미있는것 = _알림(id=2, target=85_000, direction="above")
        db = _DB([고칠것, 이미있는것])
        me = type("나", (), {"id": 7})()
        본문 = R.고치기요청(direction="above", target=85_000)
        with pytest.raises(HTTPException) as e:
            _생짜(R.고치기)(request=None, 본문=본문, 알림id=1, db=db, me=me)
        assert e.value.status_code == 400
        assert 고칠것.target == 79_000, "거절했는데 값이 바뀌었다"
        assert db.commits == 0

    def test_자기_자신은_겹침으로_안_센다(self):
        """방향만 바꾸고 목표가는 그대로 두는 일이 흔하다. 자기 자신을
        겹침으로 세면 그때마다 '이미 있어요' 로 막힌다."""
        a = _알림(id=1, target=79_000, direction="above")
        db = _DB([a])
        me = type("나", (), {"id": 7})()
        본문 = R.고치기요청(direction="above", target=79_000)
        나온것 = _생짜(R.고치기)(request=None, 본문=본문, 알림id=1, db=db, me=me)
        assert 나온것["target"] == 79_000

    def test_고칠_때도_DB_를_한_번만_물어본다(self):
        """DB 가 Supabase 라 물어볼 때마다 네트워크를 건넌다.
        '고칠 줄 찾기' 와 '겹치는 것 찾기' 를 따로 물으면 왕복이 둘이다."""
        class _세는DB(_DB):
            def __init__(self, rows):
                super().__init__(rows)
                self.질의수 = 0
            def query(self, *a, **k):
                self.질의수 += 1
                return super().query(*a, **k)
        db = _세는DB([_알림(id=1, target=79_000)])
        me = type("나", (), {"id": 7})()
        _생짜(R.고치기)(request=None, 본문=R.고치기요청(direction="above", target=80_000),
                        알림id=1, db=db, me=me)
        assert db.질의수 == 1, f"DB 를 {db.질의수}번 물어봤다"

    def test_고치기_요청도_값의_형태를_고정한다(self):
        from pydantic import ValidationError
        for 나쁜값 in [
            {"direction": "up", "target": 1},
            {"direction": "above", "target": 0},
            {"direction": "above", "target": -1},
        ]:
            with pytest.raises(ValidationError):
                R.고치기요청(**나쁜값)

    def test_고치기도_응답을_만든_뒤에_커밋한다(self):
        import inspect
        본문 = inspect.getsource(R.고치기)
        assert 본문.index("답 = _내보내기(a)") < 본문.index("db.commit()")
        assert "db.refresh" not in 본문

    def test_없는_알림은_404(self):
        from fastapi import HTTPException
        db = _DB([])
        me = type("나", (), {"id": 7})()
        for 부르기 in (R.켜고끄기, R.지우기):
            with pytest.raises(HTTPException) as e:
                _생짜(부르기)(request=None, 알림id=99, db=db, me=me)
            assert e.value.status_code == 404
        with pytest.raises(HTTPException) as e:
            _생짜(R.고치기)(request=None, 본문=R.고치기요청(direction="above", target=1),
                            알림id=99, db=db, me=me)
        assert e.value.status_code == 404

    def test_지금값은_캐시만_읽는다(self, 시세):
        """알림을 거는 순간에도 바깥 조회를 하면 안 된다."""
        import inspect
        본문 = inspect.getsource(R._지금값)
        assert "cache.get" in 본문
        for 금지 in ("requests", "httpx", "yf.", "urlopen"):
            assert 금지 not in 본문, f"_지금값 이 {금지} 로 새로 받아 온다"

        시세("005930", 80_500)
        assert R._지금값("005930") == 80_500
        assert R._지금값("없는종목") is None


class Test알림함에_실린다:
    def test_알림_목록이_종목을_함께_내보낸다(self):
        """symbol·market 이 빠지면 알림을 눌러도 갈 곳이 없다."""
        import inspect
        from app.api.routes import community as C
        본문 = inspect.getsource(C.list_notifications)
        assert '"symbol"' in 본문 and '"market"' in 본문

    def test_notifications_표에_symbol_market_이_생긴다(self):
        """이미 돌고 있는 서버의 표에는 두 칸이 없다. 뜰 때 붙여야 한다."""
        import inspect
        from app import main as M
        본문 = inspect.getsource(M)
        # 표 이름 허용 목록에 없으면 붙이는 쪽에서 조용히 건너뛴다
        assert '_ALLOWED_MIGRATE_TABLES' in 본문
        허용줄 = next(l for l in 본문.splitlines() if "_ALLOWED_MIGRATE_TABLES = " in l)
        assert '"notifications"' in 허용줄
        assert '_add_col_if_missing("notifications", "symbol"' in 본문
        assert '_add_col_if_missing("notifications", "market"' in 본문

    def test_주기_갱신이_알림을_확인한다(self):
        import inspect
        from app.services import scheduler as S
        본문 = inspect.getsource(S)
        assert "alert_checker" in 본문 and "확인하기" in 본문
