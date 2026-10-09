"""
사용자 요청: "공모주 상장 시가 예측할 수 있는 메뉴를 만들어줘"

자료는 38커뮤니케이션의 세 목록(수요예측결과·청약일정·신규상장)이다. 여기서는
그 페이지 모양(겹겹이 든 표, EUC-KR, 단위가 괄호로 붙은 머리글)을 흉내 낸 가짜
페이지로 읽기·받기·합치기·저장을, 만든 기록으로 예측과 시간순 검증을 본다.
"""
import math
import random
import threading
import time
from datetime import date, timedelta

import pytest
from urllib.parse import parse_qs, urlparse

from app.core import health
from app.services import ipo_service as S


# ── 가짜 38 페이지 ───────────────────────────────────────────
def _쪽(제목: str, 머리글: list, 줄들: list) -> bytes:
    """바깥 화면 틀 표 안에 자료 표가 든, EUC-KR 페이지."""
    머리 = "".join(f"<td>{h}</td>" for h in 머리글)
    몸 = "".join(
        "<tr>" + "".join(f"<td>{c}</td>" for c in 줄) + "</tr>"
        f'<tr><td colspan="{len(머리글)}" height="1"></td></tr>'
        for 줄 in 줄들)
    html = (
        '<html><head><meta http-equiv="Content-Type" content="text/html; charset=euc-kr"></head><body>'
        '<table width="100%"><tr><td>'
        '<table><tr><td><a href="/">38커뮤니케이션</a></td><td>공모주</td><td>장외</td><td>게시판</td></tr></table>'
        f'<table width="100%" summary="{제목}"><tr bgcolor="#eeeeee">{머리}</tr>{몸}</table>'
        '</td></tr></table></body></html>')
    return html.encode("cp949")


def _이름(n: str, no: int) -> str:
    return f'<a href="/html/fund/?o=v&no={no}&l=&page=1"><font color="#333">{n}</font></a>'


수요예측_머리 = ["기업명", "예측일", "희망공모가(원)", "공모가(원)", "공모금액<br>(백만원)",
            "기관<br>경쟁률", "의무보유<br>확약", "주간사"]
청약_머리 = ["종목명", "공모주일정", "확정공모가", "희망공모가", "청약경쟁률", "주간사", "분석"]
상장_머리 = ["기업명", "신규상장일", "현재가(원)", "전일비(%)", "공모가(원)", "공모가대비 등락률(%)",
          "시초가(원)", "시초/공모(%)", "첫날종가(원)"]


class _응답:
    def __init__(self, status=200, content=b"", ctype="text/html"):
        self.status_code = status
        self.content = content
        self.headers = {"content-type": ctype}


def _가짜원천(monkeypatch, 쪽들: dict, 상태=200):
    """쪽들: {("수요예측", 1): bytes, …}. 없는 쪽은 마지막 쪽을 다시 준다(실제 사이트처럼)."""
    물음: list = []

    def get(url, **k):
        물음.append(url)
        if 상태 != 200:
            return _응답(상태)
        # 'o=r' 이 'o=r1' 안에도 들어 있다 — 글자 포함이 아니라 값으로 가른다
        o = parse_qs(urlparse(url).query)["o"][0]
        목록 = next(n for n, p in S._목록경로.items() if parse_qs(urlparse(p).query)["o"][0] == o)
        쪽 = int(url.rsplit("page=", 1)[1])
        있는 = sorted(p for (n, p) in 쪽들 if n == 목록)
        if not 있는:
            return _응답(200, _쪽("빈", ["메뉴"], []))
        return _응답(200, 쪽들[(목록, min(쪽, 있는[-1]))])
    monkeypatch.setattr(S.httpx, "get", get)
    return 물음


@pytest.fixture(autouse=True)
def _깨끗이(monkeypatch):
    monkeypatch.setattr(S, "_기록", None)
    monkeypatch.setattr(S, "_받은때", 0.0)
    monkeypatch.setattr(S, "_시도때", 0.0)
    monkeypatch.setattr(S, "_상태", {})
    monkeypatch.setattr(S, "_갱신중", False)
    monkeypatch.setattr(S, "_좋은바탕", None)
    monkeypatch.setattr(S, "쪽_쉼", 0)
    monkeypatch.setattr(S, "_db_읽기", lambda: ({}, 0.0, {}))
    monkeypatch.setattr(S, "_db_쓰기", lambda 기록, 상태: None)
    monkeypatch.setattr(S, "_코드붙이기", lambda 기록: None)
    S._예측보관.clear()
    yield
    S._예측보관.clear()


# ── 글자 → 값 ───────────────────────────────────────────────
class Test글자를_값으로:
    def test_숫자(self):
        assert S._수("12,000원") == 12000 and S._수("-") is None and S._수("") is None

    def test_경쟁률(self):
        assert S._경쟁률("1,234.56:1") == pytest.approx(1234.56)
        assert S._경쟁률("1234.56 : 1") == pytest.approx(1234.56)
        assert S._경쟁률("-") is None and S._경쟁률("0:1") is None, "0 은 아직 없음이다"

    def test_확약_0퍼센트는_값이다(self):
        assert S._퍼센트("0.00%") == 0.0 and S._퍼센트("45.67%") == pytest.approx(45.67)
        assert S._퍼센트("-") is None

    def test_밴드(self):
        assert S._범위("11,000~13,000") == (11000, 13000)
        assert S._범위("15,000") == (15000, 15000) and S._범위("-") == (None, None)

    def test_날짜와_기간(self):
        assert S._날짜("2025.10.13") == date(2025, 10, 13) == S._날짜("2025/10/13")
        assert S._기간("2025.10.13~10.14") == (date(2025, 10, 13), date(2025, 10, 14))
        assert S._기간("2025.12.31~01.02") == (date(2025, 12, 31), date(2026, 1, 2)), "해를 넘긴다"
        assert S._기간("2025.10.13") == (date(2025, 10, 13), date(2025, 10, 13))

    def test_같은_종목을_같은_열쇠로(self):
        assert S.열쇠("에이비씨 바이오") == S.열쇠("(주)에이비씨바이오") == S.열쇠("에이비씨바이오(코스닥)")

    def test_스팩과_리츠는_따로(self):
        assert S.종류("미래에셋비전스팩7호") == "spac" and S.종류("한화제12호스팩") == "spac"
        assert S.종류("케이티리츠") == "reit" and S.종류("에이비씨바이오") == "normal"


# ── 표 읽기 ─────────────────────────────────────────────────
def _수요예측쪽(*줄):
    return _쪽("수요예측결과", 수요예측_머리, list(줄))


class Test표를_머리글로_읽는다:
    def test_수요예측결과(self):
        html = _수요예측쪽(
            [_이름("에이비씨바이오", 2101), "2025.10.01", "11,000~13,000", "15,000", "18,000",
             "1,234.56:1", "45.67%", "미래에셋증권"]).decode("cp949")
        줄들, 이유 = S.읽기_수요예측(html)
        assert 이유 == "" and len(줄들) == 1
        r = 줄들[0]
        assert r["name"] == "에이비씨바이오" and r["no"] == "2101"
        assert (r["band_low"], r["band_high"], r["offer_price"]) == (11000, 13000, 15000)
        assert r["offer_amount"] == 18000 and r["inst_ratio"] == pytest.approx(1234.56)
        assert r["lockup_pct"] == pytest.approx(45.67) and r["forecast_date"] == "2025-10-01"

    def test_칸_순서가_바뀌어도_읽는다(self):
        머리 = ["기업명", "기관경쟁률", "의무보유확약", "희망공모가", "공모가", "예측일"]
        html = _쪽("수요예측결과", 머리, [["가나다", "500:1", "10%", "9,000~10,000", "10,000", "2025.09.01"]]).decode("cp949")
        r = S.읽기_수요예측(html)[0][0]
        assert (r["inst_ratio"], r["lockup_pct"], r["offer_price"]) == (500, 10, 10000)

    def test_청약일정(self):
        html = _쪽("청약일정", 청약_머리, [[_이름("에이비씨바이오", 2101), "2025.10.13~10.14", "15,000",
                                         "11,000~13,000", "1,500.25:1", "미래에셋증권", "분석"]]).decode("cp949")
        r = S.읽기_청약(html)[0][0]
        assert (r["sub_start"], r["sub_end"]) == ("2025-10-13", "2025-10-14")
        assert r["sub_ratio"] == pytest.approx(1500.25) and r["offer_price"] == 15000

    def test_신규상장(self):
        html = _쪽("신규상장", 상장_머리, [["에이비씨바이오", "2025/10/22", "30,000", "+2.0", "15,000",
                                         "+100.0", "33,000", "220.00", "31,500"]]).decode("cp949")
        r = S.읽기_신규상장(html)[0][0]
        assert (r["list_date"], r["offer_price"], r["open_price"], r["close_price"]) == \
            ("2025-10-22", 15000, 33000, 31500), "공모가 대비·시초/공모 칸과 헷갈렸다"

    def test_비슷한_이름의_칸이_앞에_와도_헷갈리지_않는다(self):
        머리 = ["기업명", "공모가대비 등락률(%)", "시초/공모(%)", "신규상장일", "공모가(원)", "시초가(원)"]
        html = _쪽("신규상장", 머리, [["가나다", "+50.0", "180.00", "2025/10/22", "10,000", "18,000"]]).decode("cp949")
        r = S.읽기_신규상장(html)[0][0]
        assert (r["offer_price"], r["open_price"]) == (10000, 18000)

    def test_수요예측_일정_표는_결과로_읽지_않고_일정으로_읽는다(self):
        """처음 배포에서 결과 자리(o=r)에 온 표 — 경쟁률·확약이 없는 '일정' 이었다"""
        머리 = ["종목명", "수요예측일", "희망공모가(원)", "확정공모가", "공모금액(백만)", "주간사"]
        html = _쪽("수요예측일정", 머리, [[_이름("가나바이오", 77), "2025.10.13~10.14", "11,000~13,000",
                                         "-", "18,000", "KB증권"]]).decode("cp949")
        줄들, 이유 = S.읽기_수요예측(html)
        assert 줄들 == [] and "종목명 | 수요예측일" in 이유
        r = S.읽기_수요예측일정(html)[0][0]
        assert (r["forecast_date"], r["band_low"], r["band_high"]) == ("2025-10-13", 11000, 13000)
        assert r["offer_amount"] == 18000 and r["offer_price"] is None and r["underwriter"] == "KB증권"

    def test_수요예측_결과는_경쟁률과_확약만_있으면_읽는다(self):
        for 머리, 줄 in (
            (["기업명", "예측일", "공모희망가(원)", "공모가(원)", "공모금액(백만원)", "기관경쟁률", "의무보유확약", "주간사"],
             ["가나", "2025.10.01", "9,000~11,000", "12,000", "15,000", "1,523.45:1", "38.20%", "증권"]),
            (["기업명", "기관경쟁률", "의무보유확약"], ["가나", "1,523.45:1", "38.20%"]),
        ):
            r = S.읽기_수요예측(_쪽("수요예측결과", 머리, [줄]).decode("cp949"))[0][0]
            assert r["inst_ratio"] == pytest.approx(1523.45) and r["lockup_pct"] == pytest.approx(38.2)
        assert "offer_price" not in r and "band_low" not in r, "표에 없는 칸까지 실었다"

    def test_머리글이_바뀌면_지금_머리글을_이유로_남긴다(self):
        html = _쪽("수요예측결과", ["회사", "날짜", "가격대", "가격", "금액", "비율", "약속", "증권사"],
                   [["가", "2025.01.01", "1~2", "2", "3", "4:1", "5%", "증권"]]).decode("cp949")
        줄들, 이유 = S.읽기_수요예측(html)
        assert 줄들 == [] and "표를 못 찾음" in 이유 and "회사 | 날짜" in 이유
        # 원천의 글을 그대로 옮긴 것임을 밝힌다(원천은 '주간사' 같은 옛 용어를 쓴다)
        assert "원천 표 머리글(그대로)" in 이유

    def test_바깥_틀_표를_자료_표로_보지_않는다(self):
        """바깥 표의 한 칸에 안쪽 표 글자가 다 들어 있어도 그걸 머리글로 쓰지 않는다"""
        html = _수요예측쪽([_이름("가", 1), "2025.10.01", "1,000~2,000", "2,000", "100",
                           "10:1", "1%", "증권"]).decode("cp949")
        표들 = S._표들(html)
        assert len(표들) == 3
        assert len(표들[0]) == 1, "바깥 틀 표에 안쪽 표의 줄이 섞였다"
        assert S.읽기_수요예측(html)[0][0]["name"] == "가"


# ── 받기 ────────────────────────────────────────────────────
class Test받기:
    def test_EUC_KR_로_읽는다(self, monkeypatch):
        _가짜원천(monkeypatch, {("수요예측", 1): _수요예측쪽(
            [_이름("에이비씨바이오", 1), "2025.10.01", "1~2", "2", "3", "4:1", "5%", "증권"])})
        줄들, 이유 = S._목록받기("수요예측", 1)
        assert 줄들[0]["name"] == "에이비씨바이오"

    def test_끝_쪽을_넘으면_멈춘다(self, monkeypatch):
        쪽들 = {("수요예측", p): _수요예측쪽(
            [_이름(f"종목{p}", p), "2025.10.01", "1~2", "2", "3", "4:1", "5%", "증권"]) for p in (1, 2)}
        물음 = _가짜원천(monkeypatch, 쪽들)
        줄들, _ = S._목록받기("수요예측", 30)
        assert [r["name"] for r in 줄들] == ["종목1", "종목2"]
        assert len(물음) == 3, "같은 쪽을 다시 받으면 거기서 멈춰야 한다"

    def test_새_규칙_한참_전까지_가면_멈춘다(self, monkeypatch):
        쪽들 = {("수요예측", p): _수요예측쪽(
            [_이름(f"종목{p}", p), f"{2024 - p * 1}.05.01", "1~2", "2", "3", "4:1", "5%", "증권"]) for p in range(1, 6)}
        물음 = _가짜원천(monkeypatch, 쪽들)
        S._목록받기("수요예측", 30)
        assert len(물음) == 2, "2022년 쪽에서 멈춰야 한다"

    def test_https_가_안_되면_http_로(self, monkeypatch):
        물음: list = []

        def get(url, **k):
            물음.append(url)
            if url.startswith("https://"):
                raise S.httpx.ConnectError("막힘")
            return _응답(200, _수요예측쪽([_이름("가", 1), "2025.10.01", "1~2", "2", "3", "4:1", "5%", "증권"]))
        monkeypatch.setattr(S.httpx, "get", get)
        assert S._목록받기("수요예측", 1)[0]
        앞 = len(물음)
        S._목록받기("수요예측", 1)
        assert 물음[앞:] == [물음[-1]] and 물음[-1].startswith("http://"), "된 쪽을 기억해 먼저 묻는다"

    def test_처음에는_거슬러_받고_마친_목록은_앞쪽만(self, monkeypatch):
        쪽들 = {("신규상장", p): _쪽("신규상장", 상장_머리, [[f"종목{p}", "2025/10/22", "1", "+0", "10,000", "+1", "12,000", "120", "1"]])
               for p in range(1, 6)}
        물음 = _가짜원천(monkeypatch, 쪽들)
        S.새로받기()
        assert sum("o=nw" in u for u in 물음) == 6, "처음에는 끝까지 거슬러 받는다"
        assert S._상태["신규상장"]["backfilled"] is True
        물음.clear()
        S.새로받기()
        assert sum("o=nw" in u for u in 물음) == S.평소_쪽수

    def test_못_받은_목록은_다음에도_거슬러_받는다(self, monkeypatch):
        """나중에 고친 목록(수요예측결과)이 다른 목록 덕에 '다 받았다' 로 보여
        과거를 영영 안 받으면, 비교할 공모주에 기관경쟁률·확약이 없다"""
        쪽들 = {("신규상장", p): _쪽("신규상장", 상장_머리, [[f"종목{p}", "2025/10/22", "1", "+0", "10,000", "+1", "12,000", "120", "1"]])
               for p in range(1, 4)}
        물음 = _가짜원천(monkeypatch, 쪽들)
        S.새로받기()                                     # 수요예측(결과)은 표가 없어 실패
        assert not S._상태["수요예측"]["backfilled"]
        쪽들.update({("수요예측", p): _수요예측쪽(
            [_이름(f"가{p}", p), "2025.10.01", "1~2", "2", "3", "4:1", "5%", "증권"]) for p in range(1, 5)})
        물음.clear()
        S.새로받기()
        assert sum("o=r1" in u for u in 물음) == 5, "고쳐진 목록을 거슬러 받지 않았다"
        assert sum("o=nw" in u for u in 물음) == S.평소_쪽수

    def test_수요예측_일정도_받아_공모금액을_채운다(self, monkeypatch):
        머리 = ["종목명", "수요예측일", "희망공모가(원)", "확정공모가", "공모금액(백만)", "주간사"]
        _가짜원천(monkeypatch, {
            ("수요예측일정", 1): _쪽("수요예측일정", 머리, [[_이름("가나바이오", 7), "2025.10.13~10.14",
                                                         "11,000~13,000", "13,000", "18,000", "KB증권"]]),
            ("수요예측", 1): _수요예측쪽([_이름("가나바이오", 7), "2025.10.14", "11,000~13,000", "13,000",
                                         "", "1,200:1", "41%", "KB증권"]),
        })
        S.새로받기(쪽수=1)
        r = S.기록들()[S.열쇠("가나바이오")]
        assert r["offer_amount"] == 18000 and r["inst_ratio"] == 1200 and r["lockup_pct"] == 41
        assert S._상태["수요예측일정"]["rows"] == 1

    def test_막히면_이유를_관리자_화면에(self, monkeypatch):
        health.reset()
        _가짜원천(monkeypatch, {}, 상태=403)
        S.새로받기(쪽수=1)
        줄 = {h["name"]: h for h in health.snapshot()}["공모주 수요예측"]
        assert 줄["streak"] == 1 and "HTTP 403" in 줄["last_error"]

    def test_받으면_줄_수를_관리자_화면에(self, monkeypatch):
        health.reset()
        _가짜원천(monkeypatch, {("수요예측", 1): _수요예측쪽(
            [_이름("가", 1), "2025.10.01", "1~2", "2", "3", "4:1", "5%", "증권"])})
        S.새로받기(쪽수=1)
        assert "1줄" in {h["name"]: h for h in health.snapshot()}["공모주 수요예측"]["detail"]


# ── 합치기 ──────────────────────────────────────────────────
class Test세_목록을_합친다:
    def test_한_종목_기록으로(self):
        기록: dict = {}
        S.합치기(기록, [{"name": "에이비씨바이오", "inst_ratio": 1200.0, "lockup_pct": 0.0, "offer_price": 15000}])
        S.합치기(기록, [{"name": "에이비씨 바이오", "sub_ratio": 1500.0, "sub_start": "2025-10-13"}])
        S.합치기(기록, [{"name": "(주)에이비씨바이오", "list_date": "2025-10-22", "open_price": 33000,
                        "offer_price": 15000}])
        assert len(기록) == 1
        r = next(iter(기록.values()))
        assert (r["inst_ratio"], r["sub_ratio"], r["open_price"]) == (1200.0, 1500.0, 33000)
        assert r["lockup_pct"] == 0.0, "확약 0% 를 '없음' 으로 지웠다"

    def test_빈_칸이_알던_값을_지우지_않는다(self):
        기록: dict = {}
        S.합치기(기록, [{"name": "가", "inst_ratio": 900.0}])
        S.합치기(기록, [{"name": "가", "inst_ratio": None, "underwriter": ""}])
        assert 기록["가"]["inst_ratio"] == 900.0


# ── 저장 ────────────────────────────────────────────────────
class Test다시_떠도_남는다:
    def test_DB_에_남기고_다시_읽는다(self, tmp_path, monkeypatch):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from app.db import database
        from app.models.stock import IpoSnapshot
        엔진 = create_engine(f"sqlite:///{tmp_path}/ipo.db")
        IpoSnapshot.__table__.create(엔진)
        monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=엔진))
        monkeypatch.undo()        # _깨끗이 가 막아 둔 DB 함수를 풀고 다시 깐다
        monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=엔진))
        monkeypatch.setattr(S, "_기록", None)
        monkeypatch.setattr(S, "쪽_쉼", 0)
        monkeypatch.setattr(S, "_코드붙이기", lambda 기록: None)
        _가짜원천(monkeypatch, {("수요예측", 1): _수요예측쪽(
            [_이름("에이비씨바이오", 1), "2025.10.01", "1~2", "2", "3", "4:1", "5%", "증권"])})
        S.새로받기(쪽수=1)
        monkeypatch.setattr(S, "_기록", None)            # 서버가 다시 떴다
        monkeypatch.setattr(S, "_받은때", 0.0)
        assert "에이비씨바이오" in S.기록들()
        assert S._받은때 > 0, "언제 받은 것인지도 남아야 다시 받을 때를 안다"
        엔진.dispose()

    def test_하나도_못_받으면_있던_기록을_덮지_않는다(self, monkeypatch):
        써짐: list = []
        monkeypatch.setattr(S, "_db_쓰기", lambda 기록, 상태: 써짐.append(1))
        monkeypatch.setattr(S, "_기록", {"가": {"name": "가"}})
        _가짜원천(monkeypatch, {}, 상태=500)
        S.새로받기(쪽수=1)
        assert 써짐 == [] and "가" in S.기록들()


# ── 만든 기록 ────────────────────────────────────────────────
def _만든기록(n=70, 시작=date(2023, 7, 3), 씨앗=1, 잡음=0.08) -> dict:
    """y = 기관·확약·청약이 클수록 높게 시작하는 세상."""
    rnd = random.Random(씨앗)
    기록 = {}
    for i in range(n):
        d = 시작 + timedelta(days=7 * i)
        기관 = rnd.choice([50, 150, 400, 800, 1200, 1600])
        확약 = rnd.uniform(0, 60)
        청약 = rnd.choice([30, 200, 800, 1500, 2500])
        y = 0.15 * math.log1p(기관) + 0.01 * 확약 + 0.05 * math.log1p(청약) - 1.0 + rnd.gauss(0, 잡음)
        배율 = min(max(math.exp(y), 0.6), 4.0)
        기록[f"T{i}"] = {"name": f"테스트{i}", "kind": "normal", "list_date": d.isoformat(),
                         "offer_price": 10000, "open_price": round(10000 * 배율),
                         "inst_ratio": 기관, "lockup_pct": 확약, "sub_ratio": 청약,
                         "band_low": 8000, "band_high": 10000, "offer_amount": 20000}
    return 기록


def _대상(**k):
    기본 = {"name": "대상", "kind": "normal", "offer_price": 10000, "inst_ratio": 800,
          "lockup_pct": 20, "sub_ratio": 800, "band_low": 8000, "band_high": 10000, "offer_amount": 20000}
    return {**기본, **k}


오늘 = date(2025, 1, 1)


class Test예측:
    def test_수요가_셀수록_높게_본다(self):
        기록 = _만든기록()
        센 = S.예측하기(기록, _대상(inst_ratio=1600, lockup_pct=55, sub_ratio=2500), 오늘)
        약한 = S.예측하기(기록, _대상(inst_ratio=50, lockup_pct=2, sub_ratio=30), 오늘)
        assert 센["ok"] and 약한["ok"]
        assert 센["ratio"] > 약한["ratio"] * 1.5, (센["ratio"], 약한["ratio"])

    def test_가격은_첫날_범위_안이고_호가에_맞는다(self):
        p = S.예측하기(_만든기록(), _대상(offer_price=12_345), 오늘)
        assert 0.6 * 12_345 <= p["price"] <= 4.0 * 12_345
        assert p["price"] % S.호가단위(p["price"]) == 0

    def test_호가단위(self):
        for 가격, 단위 in ((1_999, 1), (2_000, 5), (4_999, 5), (5_000, 10), (19_999, 10), (20_000, 50),
                         (49_999, 50), (50_000, 100), (199_999, 100), (200_000, 500), (500_000, 1_000)):
            assert S.호가단위(가격) == 단위, 가격

    def test_4배_위로는_안_본다(self):
        assert S.가격으로(15_000, 9.0) == 60_000 and S.가격으로(15_000, 0.1) == 9_000

    def test_비슷한_공모주와_회귀의_가운데(self):
        p = S.예측하기(_만든기록(), _대상(), 오늘)
        이웃, 회귀 = p["parts"]["neighbors_ratio"], p["parts"]["regression_ratio"]
        assert 회귀 is not None
        assert p["ratio"] == pytest.approx(math.sqrt(이웃 * 회귀), rel=2e-3)

    def test_예측_배율도_4배를_넘지_않는다(self):
        기록 = _만든기록()
        for r in 기록.values():
            r["open_price"] = 40_000 if r["inst_ratio"] >= 800 else 10_000
        p = S.예측하기(기록, _대상(inst_ratio=90_000, lockup_pct=99, sub_ratio=90_000), 오늘)
        assert p["ratio"] <= 4.0 and p["price"] <= 40_000

    def test_딱_2배로_시작한_것도_따블이다(self):
        기록 = _만든기록()
        for r in 기록.values():
            r["open_price"] = 20_000
        p = S.예측하기(기록, _대상(), 오늘)
        assert p["p_double"] == 1.0 and p["p_below"] == 0.0

    def test_범위와_확률이_이웃에서_나온다(self):
        p = S.예측하기(_만든기록(), _대상(), 오늘)
        assert p["range"]["low_ratio"] <= p["range"]["high_ratio"]
        assert 0 <= p["p_double"] <= 1 and 0 <= p["p_below"] <= 1
        assert 1 <= len(p["neighbors"]) <= 5 and p["neighbors"][0]["name"].startswith("테스트")

    def test_청약_전이면_청약경쟁률_없이_맞히고_그렇다고_말한다(self):
        p = S.예측하기(_만든기록(), _대상(sub_ratio=None), 오늘)
        assert p["ok"] and "청약경쟁률" in p["missing"] and "청약경쟁률" not in p["used"]

    def test_수요예측_전에는_예측하지_않는다(self):
        p = S.예측하기(_만든기록(), _대상(inst_ratio=None), 오늘)
        assert not p["ok"] and "수요예측" in p["reason"]

    def test_새_규칙_전_상장은_쓰지_않는다(self):
        """2023-06-26 전에는 시초가가 공모가의 2배에서 막혀 있었다"""
        기록 = _만든기록()
        앞 = S.예측하기(기록, _대상(), 오늘)
        for i in range(30):
            기록[f"옛{i}"] = {**_대상(name=f"옛{i}"), "list_date": f"2022-0{1 + i % 9}-1{i % 9}",
                             "open_price": 6000}
        assert S.예측하기(기록, _대상(), 오늘)["ratio"] == 앞["ratio"]

    def test_기준일_뒤에_상장한_것은_쓰지_않는다(self):
        기록 = _만든기록()
        앞 = S.예측하기(기록, _대상(), date(2024, 6, 1))
        for k, r in 기록.items():
            if r["list_date"] >= "2024-06-01":
                r["open_price"] = 40_000          # 미래가 터무니없어도
        assert S.예측하기(기록, _대상(), date(2024, 6, 1))["ratio"] == 앞["ratio"], "미래를 보고 맞혔다"

    def test_스팩은_스팩끼리(self):
        기록 = _만든기록()
        p = S.예측하기(기록, _대상(name="한화제30호스팩", kind="spac", offer_price=2000), 오늘)
        assert not p["ok"] and "스팩" in p["reason"]
        for i in range(10):
            기록[f"S{i}"] = {**_대상(name=f"가나{i}호스팩", kind="spac", offer_price=2000,
                                    inst_ratio=100 + 50 * i, lockup_pct=2 * i, sub_ratio=200 + 100 * i),
                            "list_date": (date(2024, 1, 5) + timedelta(days=9 * i)).isoformat(),
                            "open_price": 2000 + 30 * i}
        p = S.예측하기(기록, _대상(name="한화제30호스팩", kind="spac", offer_price=2000), 오늘)
        assert p["ok"] and all(n["name"].endswith("스팩") for n in p["neighbors"])

    def test_분위기는_그날_전_상장만(self):
        기록 = {f"A{i}": {"name": f"A{i}", "kind": "normal", "list_date": "2024-03-04",
                         "offer_price": 10000, "open_price": 20000} for i in range(4)}
        기록.update({f"B{i}": {"name": f"B{i}", "kind": "normal", "list_date": "2024-03-11",
                              "offer_price": 10000, "open_price": 10000} for i in range(4)})
        assert S.분위기(기록, date(2024, 3, 11)) == pytest.approx(math.log(2)), "같은 날 상장이 섞였다"
        assert S.분위기(기록, date(2024, 3, 4)) is None
        표 = S.모델(기록).표("normal")
        assert all(x[0]["mood"] == pytest.approx(math.log(2)) for x in 표 if x[2]["name"].startswith("B")), \
            "학습표의 분위기에 같은 날 상장이 섞였다"


class Test시간순_검증:
    def test_그때까지_상장한_것만으로_맞혀_본다(self):
        기록 = _만든기록()
        검증 = S.걸어가며_검증(기록, 최근=20)
        assert 검증["n"] == 20 and len(검증["rows"]) == 20
        assert 검증["median_abs_err_pp"] is not None and 0 <= 검증["direction_hit"] <= 1
        # 잡음이 작은 세상이라 꽤 맞아야 한다
        assert 검증["median_abs_err_pp"] < 25, 검증["median_abs_err_pp"]

    def test_자기_결과를_보고_맞히지_않는다(self):
        기록 = _만든기록()
        가운데 = sorted(기록.values(), key=lambda r: r["list_date"])[50]
        앞 = {r["name"]: r["pred_ratio"] for r in S.걸어가며_검증(기록, 최근=30)["rows"]}
        가운데["open_price"] = 39_000 if 가운데["open_price"] < 20_000 else 6_000
        뒤 = {r["name"]: r["pred_ratio"] for r in S.걸어가며_검증(기록, 최근=30)["rows"]}
        assert 앞[가운데["name"]] == 뒤[가운데["name"]], "맞힐 대상의 실제 시초가가 예측에 들어갔다"

    def test_맞힌_뒤의_결과가_예측을_바꾸지_않는다(self):
        기록 = _만든기록()
        첫 = {r["name"]: r["pred_ratio"] for r in S.걸어가며_검증(기록, 최근=10)["rows"]}
        마지막 = max(기록.values(), key=lambda r: r["list_date"])
        마지막["open_price"] = 40_000
        둘째 = {r["name"]: r["pred_ratio"] for r in S.걸어가며_검증(기록, 최근=10)["rows"]}
        del 첫[마지막["name"]], 둘째[마지막["name"]]
        assert 첫 == 둘째


# ── 한눈에 ──────────────────────────────────────────────────
class Test한눈에:
    def _채우기(self, monkeypatch):
        기록 = _만든기록(n=90, 시작=date(2023, 7, 3))
        기록["UP1"] = _대상(name="곧상장", sub_start="2099-01-02", sub_end="2099-01-03")
        기록["UP2"] = {"name": "예측전", "kind": "normal", "forecast_date": "2099-01-01"}
        기록["OLD"] = {"name": "지난것", "kind": "normal", "forecast_date": "2020-01-01"}
        monkeypatch.setattr(S, "_기록", 기록)
        monkeypatch.setattr(S, "_받은때", time.time())
        monkeypatch.setattr(S, "_시도때", time.time())
        return 기록

    def test_다가오는_공모주와_예측(self, monkeypatch):
        self._채우기(monkeypatch)
        값 = S.한눈에()
        이름들 = [u["name"] for u in 값["upcoming"]]
        assert "곧상장" in 이름들 and "예측전" in 이름들 and "지난것" not in 이름들
        곧 = next(u for u in 값["upcoming"] if u["name"] == "곧상장")
        assert 곧["prediction"]["ok"] and 곧["stage"] == "청약 완료"
        assert not next(u for u in 값["upcoming"] if u["name"] == "예측전")["prediction"]["ok"]
        assert 값["accuracy"]["n"] > 0 and 값["recent"] and 값["train_since"] == "2023-06-26"

    def test_오래됐으면_뒤에서_새로_받는다(self, monkeypatch):
        self._채우기(monkeypatch)
        불림 = threading.Event()
        monkeypatch.setattr(S, "새로받기", lambda *a, **k: 불림.set())
        monkeypatch.setattr(S, "_받은때", time.time() - S.갱신간격 - 1)
        monkeypatch.setattr(S, "_시도때", 0.0)
        assert S.한눈에()["refreshing"] is True
        assert 불림.wait(3)

    def test_못_받은_목록이_있으면_6시간을_기다리지_않는다(self, monkeypatch):
        """고친 것을 배포해도 몇 시간 뒤에야 반영되던 것 — 처음 배포의 상태 그대로"""
        self._채우기(monkeypatch)
        불림 = threading.Event()
        monkeypatch.setattr(S, "새로받기", lambda *a, **k: 불림.set())
        monkeypatch.setattr(S, "_시도때", 0.0)
        monkeypatch.setattr(S, "_상태", {
            "수요예측": {"rows": 0, "reason": "표를 못 찾음 — 머리글: 종목명 | 수요예측일"},
            "청약": {"rows": 420, "reason": ""}, "신규상장": {"rows": 300, "reason": ""}})
        S.한눈에()
        assert 불림.wait(3), "못 받은 목록이 있는데 6시간을 기다렸다"

    def test_다_받았고_6시간_안이면_다시_안_받는다(self, monkeypatch):
        self._채우기(monkeypatch)
        불림: list = []
        monkeypatch.setattr(S, "새로받기", lambda *a, **k: 불림.append(1))
        monkeypatch.setattr(S, "_시도때", 0.0)
        monkeypatch.setattr(S, "_상태", {k: {"rows": 10, "reason": ""} for k in S._목록경로})
        S.한눈에()
        time.sleep(0.1)
        assert 불림 == []

    def test_막혀_있으면_화면을_열_때마다_두드리지_않는다(self, monkeypatch):
        self._채우기(monkeypatch)
        불림: list = []
        monkeypatch.setattr(S, "새로받기", lambda *a, **k: 불림.append(1))
        monkeypatch.setattr(S, "_받은때", 0.0)
        monkeypatch.setattr(S, "_시도때", time.time())     # 방금 시도했다(실패)
        S.한눈에()
        time.sleep(0.1)
        assert 불림 == []


# ── 단계 ────────────────────────────────────────────────────
@pytest.mark.parametrize("기록,단계", [
    ({"open_price": 1}, "상장"),
    ({"list_date": "2025-01-01"}, "상장"),
    ({"list_date": "2025-02-01"}, "상장 예정"),
    ({"sub_ratio": 100.0}, "청약 완료"),
    ({"inst_ratio": 100.0, "sub_end": "2025-01-20"}, "청약 예정"),
    ({"inst_ratio": 100.0}, "수요예측 완료"),
    ({}, "수요예측 전"),
])
def test_단계(기록, 단계):
    assert S.단계(기록, date(2025, 1, 10)) == 단계


# ── API ─────────────────────────────────────────────────────
@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


class TestAPI:
    def test_한눈에(self, client, monkeypatch):
        monkeypatch.setattr(S, "_기록", _만든기록())
        monkeypatch.setattr(S, "_받은때", time.time())
        r = client.get("/api/v1/ipo")
        assert r.status_code == 200
        assert {"upcoming", "recent", "accuracy", "source", "as_of"} <= set(r.json())

    def test_직접_넣어_보기(self, client, monkeypatch):
        monkeypatch.setattr(S, "_기록", _만든기록())
        r = client.post("/api/v1/ipo/predict", json={
            "offer_price": 10000, "inst_ratio": 1200, "lockup_pct": 30, "sub_ratio": 1500,
            "band_low": 8000, "band_high": 10000, "offer_amount_eok": 200})
        assert r.status_code == 200 and r.json()["ok"] and r.json()["price"] > 0

    def test_공모금액은_억원으로_받아_백만원으로(self, client, monkeypatch):
        받은: list = []
        monkeypatch.setattr(S, "직접_예측", lambda 값: 받은.append(값) or {"ok": False, "reason": "x"})
        client.post("/api/v1/ipo/predict", json={"offer_price": 10000, "inst_ratio": 1,
                                                 "lockup_pct": 1, "offer_amount_eok": 250})
        assert 받은[0]["offer_amount"] == 25_000

    @pytest.mark.parametrize("몸", [
        {"inst_ratio": 1, "lockup_pct": 1},                                   # 공모가 없음
        {"offer_price": 0, "inst_ratio": 1, "lockup_pct": 1},                 # 0원
        {"offer_price": 1000, "inst_ratio": 1, "lockup_pct": 120},            # 확약 120%
        {"offer_price": 1000, "inst_ratio": 1, "lockup_pct": 1, "band_low": 2000, "band_high": 1000},
        {"offer_price": 1000, "inst_ratio": 1, "lockup_pct": 1, "kind": "etf"},
    ])
    def test_잘못_넣으면_422(self, client, 몸):
        assert client.post("/api/v1/ipo/predict", json=몸).status_code == 422
