"""응답이 너무 컸다 — 자산 곡선을 **모양을 지키며** 솎는다.

20년치 날마다 곡선은 5,000칸이 넘고, 벤치마크 곡선까지 붙으면 응답
하나가 수백 KB 였다. 폰 화면 폭은 400px 남짓이라 그만큼 그려도 눈에
보이는 것은 같다. 무료 서버는 그걸 JSON 으로 만드는 데도 시간을 쓴다.

그냥 n칸마다 하나씩 집으면 **꼭대기와 바닥이 빠진다.** 그러면 그래프의
최고점이 옆의 '최종 평가액' 이나 '최대 낙폭' 과 다른 말을 한다. 그래서
묶음마다 제일 높은 칸과 제일 낮은 칸을 남긴다. 끝 칸은 꼭 남긴다 —
그래프의 마지막 점이 곧 최종 평가액이다.

벤치마크 곡선은 **내 곡선이 남긴 날짜에 맞춘다.** 따로 솎으면 두 곡선의
날짜가 어긋나 화면이 짝을 못 지어 벤치마크 선이 듬성듬성 끊긴다.
"""
from datetime import date, timedelta
import json

import pytest

from app.services.portfolio_backtest import 곡선솎기, 날짜맞추기, 곡선칸수
from test_자산배분_설정이_실제로_먹나 import (  # noqa: F401 — 가짜 시세·제한 해제를 그대로 쓴다
    _가짜시세, _횟수제한_지우기, client, 몸,
)


def _곡선(n):
    d0 = date(2000, 1, 3)
    return [{"date": (d0 + timedelta(days=i)).isoformat(),
             "value": 100 + (i % 97) - (i % 13) * 3 + i * 0.01} for i in range(n)]


def test_짧은_곡선은_그대로():
    c = _곡선(곡선칸수)
    assert 곡선솎기(c) == c


def test_긴_곡선은_줄이되_꼭대기_바닥_처음_끝을_지킨다():
    c = _곡선(6000)
    솎은 = 곡선솎기(c)
    assert len(솎은) <= 곡선칸수 * 2 + 2
    assert len(솎은) < len(c) / 4
    값들 = [x["value"] for x in 솎은]
    assert max(값들) == max(x["value"] for x in c)
    assert min(값들) == min(x["value"] for x in c)
    assert 솎은[0] == c[0] and 솎은[-1] == c[-1]
    # 날짜 순서가 흐트러지지 않는다
    assert [x["date"] for x in 솎은] == sorted(x["date"] for x in 솎은)
    assert len({x["date"] for x in 솎은}) == len(솎은)


def test_벤치는_남긴_날짜에_맞추고_없는날은_그전_값을_쓴다():
    벤치 = [{"date": "2020-01-02", "value": 1}, {"date": "2020-01-03", "value": 2},
            {"date": "2020-01-06", "value": 3}, {"date": "2020-01-08", "value": 4}]
    나온것 = 날짜맞추기(벤치, ["2020-01-01", "2020-01-03", "2020-01-07"])
    # 벤치 자료가 시작되기 전 날은 건너뛴다, 1/7 은 1/6 값, 끝 칸(1/8)은 늘 남긴다
    assert 나온것 == [{"date": "2020-01-03", "value": 2}, {"date": "2020-01-07", "value": 3},
                     {"date": "2020-01-08", "value": 4}]


def test_실제_응답이_작아지고_마지막_점이_최종평가액이다(client):
    r = client.post("/api/v1/backtest/portfolio", json=몸(benchmark="spy"))
    assert r.status_code == 200, r.text
    결과 = r.json()
    크기 = len(json.dumps(결과))
    assert 크기 < 200_000, f"응답 {크기 / 1000:.0f}KB"
    assert len(결과["curve"]) <= 곡선칸수 * 2 + 2
    assert 결과["curve"][-1]["value"] == pytest.approx(결과["final_value"], abs=0.01)
    벤치 = 결과["benchmark"]
    assert 벤치["curve"][-1]["value"] == pytest.approx(벤치["final_value"], abs=0.01)
    # 벤치 곡선의 날짜는 (마지막 칸 말고는) 전부 내 곡선에 있다 — 화면이 짝을 짓는다
    내날 = {x["date"] for x in 결과["curve"]}
    assert all(x["date"] in 내날 for x in 벤치["curve"][:-1])
