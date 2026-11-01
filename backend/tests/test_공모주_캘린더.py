"""공모주 일정을 내 캘린더로 — 캘린더 앱이 말없이 틀리게 넣지 않게.

  · 하루 종일 일정의 끝(DTEND)은 그다음 날 — 그날로 적으면 청약 마지막 날이 빠진다
  · 한 줄 75바이트 — 한글은 3바이트라 글자 가운데서 자르면 깨진다
  · 같은 공모주·같은 일정은 늘 같은 UID — 다시 받으면 고쳐지고 두 번 안 생긴다
  · 고른 증권사만 — 화면의 '증권사로 거르기' 와 같은 이름 규칙(옛 이름 → 지금 이름)
"""
from datetime import date, datetime, timezone

import pytest

from app.services import ipo_calendar as C
from app.services import ipo_service


def _펴기(글: str) -> str:
    return 글.replace("\r\n ", "")


def _공모주(**덮):
    r = {"name": "에이비씨바이오", "sub_start": "2026-11-03", "sub_end": "2026-11-04", "list_date": "2026-11-12",
         "offer_price": 26000, "underwriter": "미래에셋대우(대표),키움증권 외 1", "inst_ratio": 1234.4,
         "lockup_pct": 12.34, "equal_shares": 3, "market": "코스닥"}
    r.update(덮)
    return r


지금 = datetime(2026, 10, 31, 1, 2, 3, tzinfo=timezone.utc)


class Test증권사_이름:
    @pytest.mark.parametrize("칸, 기대", [
        ("미래에셋증권,KB증권", ["미래에셋증권", "KB증권"]),
        ("미래에셋대우(대표), 키움증권 외 1", ["미래에셋증권", "키움증권"]),
        ("㈜신한금융투자 / 하이투자증권", ["신한투자증권", "iM증권"]),
        ("KB증권·KB증권", ["KB증권"]),
        ("-", []),
        (None, []),
        ("", []),
    ])
    def test_화면과_같은_규칙으로_나눈다(self, 칸, 기대):
        assert C.증권사들(칸) == 기대


class Test증권사_목록:
    """알림 설정의 '알림 받을 증권사' 칩 — 지난 3년 공모주를 주관한 증권사, 많이 맡은 순"""

    def test_많이_맡은_순_같으면_이름순_옛_이름과_함께_주관도_센다(self):
        기록 = {
            1: _공모주(underwriter="미래에셋대우(대표),키움증권"),
            2: _공모주(underwriter="미래에셋증권"),
            3: _공모주(underwriter="KB증권 외 1"),
            4: _공모주(underwriter="키움증권"),
            5: _공모주(underwriter="미래에셋증권, 미래에셋대우"),     # 한 공모주에 같은 증권사는 한 번
        }
        assert C.증권사_목록(기록, date(2026, 10, 31)) == [
            {"name": "미래에셋증권", "count": 3}, {"name": "키움증권", "count": 2}, {"name": "KB증권", "count": 1}]

    def test_같은_수면_이름순_들어온_차례가_아니라(self):
        기록 = {1: _공모주(underwriter="한화투자증권"), 2: _공모주(underwriter="대신증권"), 3: _공모주(underwriter="교보증권")}
        assert [b["name"] for b in C.증권사_목록(기록, date(2026, 10, 31))] == ["교보증권", "대신증권", "한화투자증권"]

    def test_청약은_3년_전이어도_상장이_그_안이면_든다(self):
        """가장 늦은 날로 본다 — 청약일만 보면 막 상장한 곳이 빠진다"""
        기록 = {1: _공모주(underwriter="걸친증권", sub_start="2023-10-25", sub_end="2023-10-26", list_date="2023-11-02")}
        assert C.증권사_목록(기록, date(2026, 10, 31)) == [{"name": "걸친증권", "count": 1}]

    def test_지난_3년만_다가오는_것과_날짜_하나만_있는_것도(self):
        기준 = date(2026, 10, 31)
        기록 = {
            "오래됨": _공모주(underwriter="옛증권", sub_start="2023-10-01", sub_end="2023-10-02", list_date="2023-10-10"),
            "경계": _공모주(underwriter="경계증권", sub_start=None, sub_end=None, list_date="2023-11-01"),
            "다가옴": _공모주(underwriter="새증권", sub_start="2026-12-01", sub_end="2026-12-02", list_date=None),
            "수요예측만": {"name": "수요예측만", "forecast_date": "2026-11-20", "underwriter": "예측증권"},
            "날짜없음": {"name": "날짜없음", "underwriter": "날짜없는증권"},
            "주관사없음": _공모주(underwriter=None),
        }
        이름들 = [b["name"] for b in C.증권사_목록(기록, 기준)]
        assert sorted(이름들) == sorted(["경계증권", "새증권", "예측증권"])
        assert C.증권사목록_햇수 == 3
        # 3년 전 그날(1,095일 전)은 들고, 그 하루 전은 뺀다
        assert [b["name"] for b in C.증권사_목록({1: _공모주(underwriter="가", sub_start=None, sub_end=None,
                                                              list_date="2023-11-01")}, 기준)] == ["가"]
        assert C.증권사_목록({1: _공모주(underwriter="가", sub_start=None, sub_end=None,
                                          list_date="2023-10-31")}, 기준) == []

    def test_로그인_없이_받고_브라우저가_한_시간_들고_있는다(self, monkeypatch):
        from fastapi.testclient import TestClient
        from app.main import app
        monkeypatch.setattr(ipo_service, "기록들", lambda: {
            1: _공모주(underwriter="KB증권"), 2: _공모주(underwriter="KB증권,삼성증권"),
            # 오늘(2026-10-31)에서 3년이 넘은 것 — 빠져야 한다(오늘을 제대로 넘기는지)
            3: _공모주(underwriter="옛증권", sub_start="2022-01-03", sub_end="2022-01-04", list_date="2022-01-12")})
        monkeypatch.setattr(ipo_service, "오늘", lambda: date(2026, 10, 31))
        r = TestClient(app).get("/api/v1/ipo/brokers")
        assert r.status_code == 200
        assert r.json() == {"brokers": [{"name": "KB증권", "count": 2}, {"name": "삼성증권", "count": 1}]}
        assert r.headers["cache-control"] == "public, max-age=3600"


class Test글:
    def test_쉼표_쌍반점_역빗금_줄바꿈을_막는다(self):
        assert C._글("26,000원; a\\b\n둘째\r\n셋째") == "26\\,000원\\; a\\\\b\\n둘째\\n셋째"

    def test_75바이트로_접고_펴면_원래대로(self):
        원래 = "DESCRIPTION:" + "공모주청약일정" * 20
        줄들 = C._접기(원래)
        assert len(줄들) > 1
        for i, l in enumerate(줄들):
            assert len(l.encode("utf-8")) <= 75
            l.encode("utf-8").decode("utf-8")          # 글자 가운데서 안 잘렸다
            assert l.startswith(" ") == (i > 0)
        assert len(줄들[0].encode("utf-8")) > 70, "첫 줄을 75바이트 가까이 채운다"
        assert "".join(l[1:] if i else l for i, l in enumerate(줄들)) == 원래

    def test_딱_75바이트는_안_접는다(self):
        assert C._접기("A" * 75) == ["A" * 75]
        assert C._접기("A" * 76) == ["A" * 75, " A"]


class Test고르기:
    def test_청약일이나_상장일이_있는_것만(self):
        기록 = {1: _공모주(), 2: {"name": "수요예측만", "forecast_date": "2026-11-20"}}
        assert [r["name"] for r in C.고르기(기록, date(2026, 10, 31))] == ["에이비씨바이오"]

    def test_지난_일정은_60일까지(self):
        기록 = {1: {"name": "61일전", "list_date": "2026-08-31"},
                2: {"name": "60일전", "list_date": "2026-09-01"}}
        assert [r["name"] for r in C.고르기(기록, date(2026, 10, 31))] == ["60일전"]

    def test_이름을_콕_집으면_날짜는_안_본다(self):
        기록 = {1: {"name": "옛날회사", "list_date": "2025-01-10"}, 2: _공모주()}
        assert [r["name"] for r in C.고르기(기록, date(2026, 10, 31), 이름="옛날회사")] == ["옛날회사"]

    def test_고른_증권사가_주관하는_것만_옛_이름도(self):
        기록 = {1: _공모주(name="가", underwriter="미래에셋대우"),
                2: _공모주(name="나", underwriter="KB증권"),
                3: _공모주(name="다", underwriter=None)}
        assert [r["name"] for r in C.고르기(기록, date(2026, 10, 31), 증권사=["미래에셋증권"])] == ["가"]
        assert len(C.고르기(기록, date(2026, 10, 31))) == 3

    def test_청약일_순(self):
        기록 = {1: _공모주(name="늦은", sub_start="2026-11-20", sub_end="2026-11-21"),
                2: _공모주(name="빠른", sub_start="2026-11-02", sub_end="2026-11-03"),
                3: {"name": "상장만", "list_date": "2026-11-10"}}
        assert [r["name"] for r in C.고르기(기록, date(2026, 10, 31))] == ["빠른", "상장만", "늦은"]


class Test만들기:
    def test_청약은_마지막_날까지_상장은_하루(self):
        글 = _펴기(C.만들기([_공모주()], 지금=지금))
        assert "SUMMARY:[청약] 에이비씨바이오\r\n" in 글
        assert "DTSTART;VALUE=DATE:20261103\r\nDTEND;VALUE=DATE:20261105\r\n" in 글
        assert "SUMMARY:[상장] 에이비씨바이오\r\n" in 글
        assert "DTSTART;VALUE=DATE:20261112\r\nDTEND;VALUE=DATE:20261113\r\n" in 글
        assert 글.count("BEGIN:VEVENT") == 2
        # 알람 — 청약은 8:30(휴대폰 알림과 같은 때), 상장은 9:00(장이 열리는 때)
        청약, 상장 = 글.split("BEGIN:VEVENT")[1:]
        assert 청약.count("TRIGGER:") == 1 and "TRIGGER:PT8H30M\r\n" in 청약
        assert 상장.count("TRIGGER:") == 1 and "TRIGGER:PT9H\r\n" in 상장
        # 하루 종일 일정이 그날 시간을 '바쁨' 으로 막지 않게
        assert 글.count("TRANSP:TRANSPARENT") == 2

    def test_마감일을_모르거나_거꾸로면_첫날_하루(self):
        글 = _펴기(C.만들기([_공모주(sub_end=None, list_date=None)], 지금=지금))
        assert "DTSTART;VALUE=DATE:20261103\r\nDTEND;VALUE=DATE:20261104\r\n" in 글
        글 = _펴기(C.만들기([_공모주(sub_end="2026-11-01", list_date=None)], 지금=지금))
        assert "DTEND;VALUE=DATE:20261104\r\n" in 글

    def test_설명에_공모가_주관사_숫자_앱주소(self):
        글 = _펴기(C.만들기([_공모주()], 지금=지금))
        청약 = 글.split("BEGIN:VEVENT")[1]
        assert "확정 공모가 26\\,000원" in 청약
        assert "주관사 미래에셋증권 · 키움증권" in 청약
        assert "기관경쟁률 1\\,234:1" in 청약 and "의무보유확약 12.3%" in 청약
        assert "균등 배정 약 3주" in 청약
        assert "https://stock-platform-one.vercel.app/ipo" in 청약
        상장 = 글.split("BEGIN:VEVENT")[2]
        assert "주관사" not in 상장 and "시장 코스닥" in 상장

    def test_공모가가_안_나왔으면_희망_밴드(self):
        글 = _펴기(C.만들기([_공모주(offer_price=None, band_low=9000, band_high=11000)], 지금=지금))
        assert "희망 공모가 9\\,000~11\\,000원" in 글

    def test_줄은_CRLF_로_끝나고_75바이트를_안_넘는다(self):
        글 = C.만들기([_공모주(name="아주아주긴이름의공모주회사" * 3)], 지금=지금)
        assert 글.endswith("END:VCALENDAR\r\n")
        assert "\n" not in 글.replace("\r\n", "")
        assert max(len(l.encode("utf-8")) for l in 글.split("\r\n")) <= 75

    def test_같은_일정은_날짜가_바뀌어도_같은_UID(self):
        """일정이 미뤄져 다시 받아도 새 일정이 하나 더 생기지 않고 그 일정이 고쳐진다"""
        def uid들(r):
            return [l for l in _펴기(C.만들기([r], 지금=지금)).split("\r\n") if l.startswith("UID:")]
        앞, 뒤 = uid들(_공모주()), uid들(_공모주(sub_start="2026-11-10", sub_end="2026-11-11", list_date="2026-11-19"))
        assert 앞 == 뒤 and len(set(앞)) == 2
        assert uid들(_공모주(name="다른회사")) != 앞

    def test_캘린더_머리(self):
        글 = _펴기(C.만들기([], 지금=지금, 이름="공모주 일정 · 키움증권"))
        assert 글.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")
        assert "X-WR-CALNAME:공모주 일정 · 키움증권" in 글
        assert "REFRESH-INTERVAL;VALUE=DURATION:PT6H" in 글
        assert "DTSTAMP" not in 글                     # 일정이 없으면 일정 줄도 없다


class Test주소:
    @pytest.fixture
    def 손님(self, monkeypatch):
        from fastapi.testclient import TestClient
        from app.main import app
        기록 = {1: _공모주(name="가나바이오", underwriter="KB증권"),
                2: _공모주(name="다라테크", underwriter="키움증권", sub_start="2026-11-20", sub_end="2026-11-21")}
        monkeypatch.setattr(ipo_service, "기록들", lambda: 기록)
        monkeypatch.setattr(ipo_service, "_뒤에서_받기", lambda: False)
        monkeypatch.setattr(ipo_service, "오늘", lambda: date(2026, 10, 31))
        return TestClient(app)

    def test_로그인_없이_캘린더로_받는다(self, 손님):
        r = 손님.get("/api/v1/ipo/calendar.ics")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/calendar")
        assert r.headers["content-disposition"].startswith("inline")
        assert "max-age" in r.headers["cache-control"]
        assert "가나바이오" in r.text and "다라테크" in r.text

    def test_한_곳만_받으면_파일로(self, 손님):
        r = 손님.get("/api/v1/ipo/calendar.ics", params={"name": "다라테크"})
        assert r.headers["content-disposition"].startswith("attachment")
        assert "다라테크" in r.text and "가나바이오" not in r.text
        assert "X-WR-CALNAME:공모주 · 다라테크\r\n" in _펴기(r.text)

    def test_증권사로_거른다_빈칸과_공백은_무시(self, 손님):
        r = 손님.get("/api/v1/ipo/calendar.ics", params={"brokers": " 키움증권 ,, "})
        assert "다라테크" in r.text and "가나바이오" not in r.text
        assert "X-WR-CALNAME:공모주 일정 · 키움증권\r\n" in _펴기(r.text)

    def test_캘린더가_부를_때도_묵은_자료를_새로_받기_시작한다(self, monkeypatch, 손님):
        """구독한 캘린더는 앱을 안 열어도 몇 시간마다 부른다 — 그때 묵은 일정을 내면 안 된다"""
        부름 = []
        monkeypatch.setattr(ipo_service, "_뒤에서_받기", lambda: 부름.append(1) or True)
        손님.get("/api/v1/ipo/calendar.ics")
        assert 부름 == [1]

    def test_증권사는_20개까지만_본다(self, monkeypatch, 손님):
        받은 = {}
        monkeypatch.setattr(C, "달력", lambda 이름, 증권사: (받은.update(증권사=증권사), "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")[1])
        손님.get("/api/v1/ipo/calendar.ics", params={"brokers": ",".join(f"증권{i}" for i in range(30))})
        assert len(받은["증권사"]) == 20

    def test_너무_긴_값은_거절(self, 손님):
        assert 손님.get("/api/v1/ipo/calendar.ics", params={"name": "가" * 101}).status_code == 422
