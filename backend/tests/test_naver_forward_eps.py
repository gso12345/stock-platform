"""국내 종목의 선행 EPS — 한 번도 나온 적이 없던 값.

── 무엇이 문제였나 ─────────────────────────────────────────

네이버 통합 응답의 지표들은 열쇠를 **전부 소문자로 낮춰** 담는다.

    code_key = str(item.get("code","")).lower()
    info[code_key] = item.get("value","")

그런데 선행 EPS 만 `info.get("cnsEps")` 로 대문자 E 를 섞어 찾고 있었다.
담긴 것은 "cnseps" 이므로 **늘 None** 이다.

바로 옆 선행 PER 은 멀쩡히 나왔다 — 그쪽은 pct("cnsPer") 로 부르고
pct 는 안에서 key.lower() 를 하기 때문이다. 그래서 화면에는
'선행 PER 은 나오는데 선행 EPS 만 빈칸' 이라는, 원인을 짐작하기
어려운 모양으로 보였다.

── 이 검사가 지키는 것 ─────────────────────────────────────

이 고장은 **화면에 오류로 안 나타난다.** 값이 없으면 그냥 "—" 가
찍히고, 그건 '이 종목은 원래 선행 EPS 가 없나 보다' 로 읽힌다.
그래서 눈으로는 영영 못 찾는다.

네이버를 진짜로 부르지 않는다 — 응답만 흉내 내어 **파싱 경로**를
그대로 태운다. 담는 쪽과 꺼내는 쪽의 대소문자가 어긋나면 걸린다.
"""
import asyncio
import json

import pytest

from app.services.price_fetcher import _fetch_naver_one


class _응답:
    def __init__(self, 본문):
        self.status_code = 200
        self._본문 = 본문

    def json(self):
        return self._본문


class _가짜손님:
    """httpx.AsyncClient 흉내 — basic 과 integration 두 경로만 답한다"""

    def __init__(self, basic, integration):
        self._basic, self._intg = basic, integration

    async def get(self, url, *a, **k):
        return _응답(self._intg if url.endswith("/integration") else self._basic)


#: 네이버가 실제로 주는 모양. 지표는 code/value 쌍의 목록으로 온다.
#  code 는 낙타등(cnsEps)인데, 담는 쪽이 소문자로 낮춘다 — 그 어긋남이
#  이 파일의 주제다.
기본응답 = {
    "stockName": "삼성전자",
    "closePrice": "71,000",
    "compareToPreviousClosePrice": "500",
    "fluctuationsRatio": "0.71",
    "stockExchangeType": {"code": "KS"},
}

통합응답 = {
    "totalInfos": [
        {"code": "per",      "value": "12.34"},
        {"code": "cnsPer",   "value": "10.50"},
        {"code": "pbr",      "value": "1.23"},
        {"code": "eps",      "value": "5,750"},
        {"code": "cnsEps",   "value": "6,800"},
        {"code": "bps",      "value": "57,000"},
        {"code": "marketValue", "value": "420조"},
    ],
}


def _받기(basic=None, intg=None):
    """`or` 로 기본값을 고르면 안 된다 — 빈 dict 가 거짓이라 기본값으로
    바뀌어, '통합 응답이 비었을 때' 를 검사할 수가 없다.
    실제로 그렇게 써서 검사가 거짓으로 통과할 뻔했다."""
    손님 = _가짜손님(기본응답 if basic is None else basic,
                     통합응답 if intg is None else intg)
    return asyncio.run(_fetch_naver_one(손님, "005930"))


class Test선행EPS:
    def test_선행_EPS_가_나온다(self):
        """여기가 전부다. 예전에는 늘 None 이었다."""
        나온것 = _받기()
        assert 나온것 is not None
        assert 나온것["forward_eps"] == 6800, "선행 EPS 를 못 읽었다"

    def test_선행_PER_과_같이_나온다(self):
        """둘 중 하나만 나오는 상태가 바로 이 고장의 겉모습이었다 —
        선행 PER 은 되는데 선행 EPS 만 빈칸."""
        나온것 = _받기()
        assert 나온것["forward_per"] == 10.50
        assert 나온것["forward_eps"] == 6800

    def test_현재_EPS_와_BPS_도_그대로(self):
        """같이 num() 으로 바꾼 값들이다. 옆엣것을 깨뜨리지 않았는지 본다."""
        나온것 = _받기()
        assert 나온것["eps"] == 5750
        assert 나온것["bps"] == 57000

    def test_네이버가_대문자로_줘도_읽는다(self):
        """담는 쪽이 낮추므로 원천이 어떤 모양으로 주든 읽혀야 한다.
        이 검사가 '소문자로 낮춰 담는다' 는 약속을 못 박는다."""
        대문자 = {"totalInfos": [{"code": "CNSEPS", "value": "6,800"}]}
        assert _받기(intg=대문자)["forward_eps"] == 6800

    def test_선행_EPS_가_없는_종목은_빈칸(self):
        """모든 종목에 컨센서스가 있는 것은 아니다. 없으면 None 이어야
        하고, 0 으로 내려보내면 화면에 '₩0' 이 찍힌다 — 없는 것과
        0원은 완전히 다른 말이다."""
        없음 = {"totalInfos": [{"code": "per", "value": "12.34"}]}
        assert _받기(intg=없음)["forward_eps"] is None

    def test_통합_응답이_통째로_없어도_시세는_온다(self):
        """지표를 못 받았다고 시세까지 잃으면 안 된다"""
        나온것 = _받기(intg={})
        assert 나온것["price"] == 71000
        assert 나온것["forward_eps"] is None


class Test열쇠를_소문자로_꺼낸다:
    """값 검사만으로는 '다음에 또 대문자를 섞는' 것을 못 막는다.

    info 에서 직접 꺼내 쓰는 자리가 늘어날 때마다 같은 실수가 날 수
    있으므로, **소문자로 낮추지 않고 직접 꺼내는 자리가 없는지** 본다.
    """

    def test_info_에서_꺼낼_때_늘_소문자로_묻는다(self):
        """정확히 이 고장을 잡는다.

        num()·pct() 는 안에서 key.lower() 를 하므로 어떤 모양으로 불러도
        괜찮다. 문제는 info 에서 **직접** 꺼내는 자리인데, 거기 적는
        이름이 소문자가 아니면 영영 못 찾는다. 그런데 화면에는 오류가
        안 뜨고 그냥 빈칸이라, 눈으로는 못 잡는다."""
        import inspect, re
        소스 = inspect.getsource(_fetch_naver_one)
        # 주석은 뺀다 — 위 사연을 적어 둔 줄에 그 이름이 그대로 들어 있다
        코드만 = "\n".join(줄 for 줄 in 소스.splitlines()
                            if not 줄.lstrip().startswith("#"))
        어긴것 = [이름 for 이름 in re.findall(r'info\.get\(\s*"([^"]+)"', 코드만)
                   if 이름 != 이름.lower()]
        assert 어긴것 == [], \
            f"소문자가 아닌 이름으로 찾는다(담긴 것은 전부 소문자다): {어긴것}"
