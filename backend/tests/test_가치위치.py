"""가치 위치 — 지금 PER·PBR 이 이 종목의 지난날 가운데 어디쯤인지(사용자: "바로 할 수 있는 것 해줘").

조용히 틀리면 안 되는 것을 하나씩 못 박는다.
  · 손으로 셈한 답과 같다 — 쌌던 날 비율 · 가운데 값과의 비율 · 가장 쌌던/비쌌던 날
  · 그날 몰랐던 실적을 쓰지 않는다 — 연간은 끝 + 90일, 분기는 끝 + 45일(결산 분기는 90일)부터
  · 최근 4분기 합 — 이어진 분기만, 같은 끝의 연간 실적과 15% 넘게 다르면 분기를 쓰지 않는다
  · 적자·자본잠식인 실적을 쓰던 날은 빼고, 그 동안을 알려 준다. 지금 적자면 위치를 말하지 않는다
  · 주식 수·단위와 상관없다(순이익·주가에 어떤 수를 곱해도 같은 답)
  · 길(API) — 공식 PER·PBR 을 함께, ETF 는 셈하지 않고, 재무를 못 받으면 짧게만 들고 있는다
"""
import math
from datetime import date, timedelta

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.cache import cache
from app.api.routes import predict as R
from app.services.predict import valuation as V

API = "/api/v1/predict"


def _날들(n: int, 끝: str = "2026-11-11") -> list[str]:
    끝날 = np.datetime64(끝, "D")
    return [str(d) for d in np.busday_offset(끝날, np.arange(-(n - 1), 1), roll="backward")]


def _연(*줄들) -> list[dict]:
    """(period, 순이익, 순자산) → 재무 줄"""
    return [{"period": p, "net_income": n, "total_equity": e} for p, n, e in 줄들]


def _손셈(날들: list[str], 종가, 후보: list[tuple[date, date, float]]) -> dict:
    """같은 셈을 가장 단순하게 — 날마다 후보를 모두 훑어 그날 알던 것 가운데 끝이 가장 늦은 것"""
    마지막 = date.fromisoformat(날들[-1])
    분모 = []
    for d in 날들:
        아는 = [x for x in 후보 if min(x[0], 마지막) <= date.fromisoformat(d)]
        분모.append(max(아는, key=lambda x: x[1])[2] if 아는 else None)
    지금 = 종가[-1] / 분모[-1]
    지난 = [(d, 종가[i] / 분모[i]) for i, d in enumerate(날들[:-1]) if 분모[i] is not None and 분모[i] > 0]
    값들 = [r for _, r in 지난]
    싼 = min(지난, key=lambda x: x[1])
    비싼 = max(지난, key=lambda x: x[1])
    return {
        "below": sum(r < 지금 for r in 값들) / len(값들),
        "vs_median": 지금 / float(np.median(값들)),
        "cheapest": (싼[0], 싼[1] / 지금),
        "priciest": (비싼[0], 비싼[1] / 지금),
        "from": next(d for i, d in enumerate(날들[:-1]) if 분모[i] is not None),
        "days": len(값들),
    }


# ── 기간 읽기 ──────────────────────────────────────────────────
def test_끝날_읽기():
    assert V._끝날("2025-12-31", 해만됨=False) == date(2025, 12, 31)
    assert V._끝날("2025-09", 해만됨=False) == date(2025, 9, 30)
    assert V._끝날("2024-02", 해만됨=False) == date(2024, 2, 29)       # 윤년
    assert V._끝날("2025-02", 해만됨=False) == date(2025, 2, 28)
    assert V._끝날("2025", 해만됨=True) == date(2025, 12, 31)          # DART·FMP 연간
    # 분기 줄의 해만(FMP 분기는 넷이 같은 이름) · DART 분기 이름 · 빈 것 · 틀린 날짜는 읽지 않는다
    for 틀린 in ("2025", "2026Q1", "2026H1", "", None, "2025-13-01", "2025-02-30", "2025-1x", "abcd-ef"):
        assert V._끝날(틀린, 해만됨=False) is None, 틀린
    assert V._끝날("2026Q1", 해만됨=True) is None


def test_수_읽기():
    assert V._수({"a": 3}, "a") == 3.0 and V._수({"a": "4.5"}, "a") == 4.5
    for 틀린 in (None, "N/A", float("nan"), float("inf"), True, [1]):
        assert V._수({"a": 틀린}, "a") is None, 틀린
    assert V._수({}, "a") is None and V._수(None, "a") is None


# ── 알려진 날 · 4분기 합 ────────────────────────────────────────
def _후보(실적들) -> list[tuple[str, str, float, str]]:
    return sorted((x.알려진.isoformat(), x.끝.isoformat(), x.값, x.갈래) for x in 실적들)


def test_연간은_끝_90일_분기는_45일_결산_분기는_90일():
    """12월 결산 — 연간 2024·2025, 분기 2025년 1분기 ~ 2026년 2분기"""
    재무 = {
        "annual": _연(("2024-12-31", 100, 1000), ("2025-12-31", 120, 1100)),
        "quarterly": _연(("2025-03-31", 25, 1020), ("2025-06-30", 28, 1040), ("2025-09-30", 31, 1070),
                       ("2025-12-31", 36, 1100), ("2026-03-31", 40, 1150), ("2026-06-30", 50, 1200)),
    }
    assert _후보(V.순이익들(재무)) == [
        ("2025-03-31", "2024-12-31", 100, "annual"),
        ("2026-03-31", "2025-12-31", 120, "annual"),
        ("2026-05-15", "2026-03-31", 28 + 31 + 36 + 40, "ttm"),       # 끝 + 45일
        ("2026-08-14", "2026-06-30", 31 + 36 + 40 + 50, "ttm"),
    ]   # 2025-12-31 의 4분기 합(120)은 연간과 같은 끝이라 연간 것을 쓴다
    assert _후보(V.순자산들(재무)) == [
        ("2025-03-31", "2024-12-31", 1000, "annual"),
        ("2025-05-15", "2025-03-31", 1020, "quarter"),
        ("2025-08-14", "2025-06-30", 1040, "quarter"),
        ("2025-11-14", "2025-09-30", 1070, "quarter"),
        ("2026-03-31", "2025-12-31", 1100, "annual"),
        ("2026-05-15", "2026-03-31", 1150, "quarter"),
        ("2026-08-14", "2026-06-30", 1200, "quarter"),
    ]


def test_9월_결산이면_9월에_끝나는_4분기_합은_90일():
    """애플처럼 9월 결산 — 연간 실적이 아직 없는 2026년 9월 4분기 합은 결산이라 90일 뒤부터"""
    재무 = {
        "annual": _연(("2024-09-30", 90, 50), ("2025-09-30", 100, 60)),
        "quarterly": _연(("2025-06-30", 22, 61), ("2025-09-30", 26, 60), ("2025-12-31", 30, 64),
                       ("2026-03-31", 24, 66), ("2026-06-30", 25, 70), ("2026-09-30", 29, 75)),
    }
    순 = _후보(V.순이익들(재무))
    assert ("2026-05-15", "2026-03-31", 22 + 26 + 30 + 24, "ttm") in 순
    assert ("2026-08-14", "2026-06-30", 26 + 30 + 24 + 25, "ttm") in 순
    assert ("2026-12-29", "2026-09-30", 30 + 24 + 25 + 29, "ttm") in 순           # 끝 + 90일
    assert len(순) == 5
    assert ("2026-12-29", "2026-09-30", 75, "quarter") in _후보(V.순자산들(재무))
    # 연간 실적이 없으면 결산달을 모른다 — 모두 45일
    순2 = _후보(V.순이익들({"quarterly": 재무["quarterly"]}))
    assert [x[0] for x in 순2] == ["2026-05-15", "2026-08-14", "2026-11-14"]


def test_결산달은_가장_흔한_달():
    assert V._결산달([date(2022, 12, 31), date(2023, 12, 31), date(2024, 6, 30)]) == 12
    assert V._결산달([date(2025, 1, 26), date(2024, 1, 28)]) == 1
    assert V._결산달([]) is None


@pytest.mark.parametrize("합, 쓰나", [(114, True), (86, True), (116, False), (84, False)])
def test_4분기_합이_연간과_15퍼센트_넘게_다르면_분기를_쓰지_않는다(합, 쓰나):
    """2025 연간 100 — 같은 끝의 4분기 합이 114·86 이면 분기를 쓰고, 116·84 면(누적 금액이 섞였다 따위) 안 쓴다"""
    재무 = {
        "annual": _연(("2025-12-31", 100, 1000)),
        "quarterly": _연(("2025-03-31", 25, 1), ("2025-06-30", 25, 1), ("2025-09-30", 25, 1),
                       ("2025-12-31", 합 - 75, 1), ("2026-03-31", 30, 1)),
    }
    갈래들 = [x.갈래 for x in V.순이익들(재무)]
    assert 갈래들.count("ttm") == (1 if 쓰나 else 0) and 갈래들.count("annual") == 1


def test_적자_연간과_견줄_때도_크기로():
    """연간 −100 에 4분기 합 −110 은 10% 차이 — 쓴다(음수끼리도 |연간| 으로 견준다)"""
    재무 = {
        "annual": _연(("2025-12-31", -100, 1)),
        "quarterly": _연(("2025-03-31", -20, 1), ("2025-06-30", -30, 1), ("2025-09-30", -30, 1),
                       ("2025-12-31", -30, 1), ("2026-03-31", 10, 1)),
    }
    assert [x.값 for x in V.순이익들(재무) if x.갈래 == "ttm"] == [-80]


def test_분기가_비면_합하지_않는다():
    빈 = _연(("2025-03-31", 1, 1), ("2025-06-30", 1, 1), ("2025-12-31", 1, 1),   # 9월이 없다
            ("2026-03-31", 1, 1), ("2026-06-30", 1, 1))
    assert V.순이익들({"quarterly": 빈}) == []
    # 날 사이가 80~100 일이면 이어진 것 — 79일·101일은 아니다
    assert V._이어진([date(2025, 1, 1), date(2025, 3, 22), date(2025, 6, 30)])           # 80 · 100
    assert not V._이어진([date(2025, 1, 1), date(2025, 3, 21)])                          # 79
    assert not V._이어진([date(2025, 1, 1), date(2025, 4, 12)])                          # 101


def test_같은_끝은_며칠_차이까지():
    """52·53주 회계연도 — 연간 2025-09-27 과 분기 2025-09-30 은 같은 결산(10일 안)"""
    재무 = {"annual": _연(("2025-09-27", 100, 60)), "quarterly": _연(("2025-09-30", 30, 61), ("2025-12-31", 30, 64))}
    assert _후보(V.순자산들(재무)) == [("2025-12-26", "2025-09-27", 60, "annual"),
                                    ("2026-02-14", "2025-12-31", 64, "quarter")]
    assert V._같은끝(date(2025, 10, 7), [date(2025, 9, 27)]) == date(2025, 9, 27)
    assert V._같은끝(date(2025, 10, 8), [date(2025, 9, 27)]) is None


def test_같은_결산이_두_줄이면_뒤의_것():
    """고쳐 낸 실적(정정 공시)이 뒤에 붙어 오는 일 — 뒤의 줄을 쓴다"""
    재무 = {"annual": _연(("2025-12-31", 10, 100), ("2025-12-31", 12, 101))}
    assert [x.값 for x in V.순이익들(재무)] == [12] and [x.값 for x in V.순자산들(재무)] == [101]


def test_줄_모양이_엉망이어도_넘어간다():
    재무 = {"annual": [None, 3, "x", {"period": "2025-12-31"}, {"net_income": 5}, {"period": "2024-12-31", "net_income": 7}],
            "quarterly": "엉망"}
    assert _후보(V.순이익들(재무)) == [("2025-03-31", "2024-12-31", 7, "annual")]
    assert V.순이익들(None) == [] and V.순이익들({}) == [] and V.순자산들({"annual": None}) == []


# ── 그날 알던 실적 ─────────────────────────────────────────────
def test_그날_알던_것만_쓰고_알려진_날부터_바뀐다():
    날들 = _날들(600)
    일자 = [date.fromisoformat(d) for d in 날들]
    후보 = [V._실적(date(2025, 3, 31), date(2024, 12, 31), 10.0, "annual"),
          V._실적(date(2026, 3, 31), date(2025, 12, 31), 20.0, "annual")]
    쓴 = V._그날것(일자, 후보)
    for d, x in zip(일자, 쓴):
        if d < date(2025, 3, 31):
            assert x is None
        elif d < date(2026, 3, 31):
            assert x.값 == 10.0
        else:
            assert x.값 == 20.0
    # 경계 — 알려진 날 그날부터(3월 30일 월요일은 앞 것, 31일 화요일은 새 것)
    i = 날들.index("2026-03-31")
    assert 날들[i - 1] == "2026-03-30" and 쓴[i - 1].값 == 10.0 and 쓴[i].값 == 20.0


def test_늦게_알려져도_끝이_이른_것은_새것을_밀어내지_않는다():
    """분기 합(끝 9월, 11월에 알려짐) 다음에 끝이 더 이른 연간 실적이 늦게 알려지는 일 — 끝이 늦은 것을 쓴다"""
    일자 = [date.fromisoformat(d) for d in _날들(300)]
    후보 = [V._실적(일자[10], date(2025, 9, 30), 5.0, "ttm"),
          V._실적(일자[20], date(2025, 6, 30), 9.0, "annual")]
    assert [x.값 for x in V._그날것(일자, 후보)[10:30]] == [5.0] * 20


def test_마지막_날에는_받아_둔_실적을_모두_안다():
    """알려진 날이 아직 안 왔어도(애플 9월 결산을 11월에 받음) 받아 둔 것은 마지막 날에 쓴다 — 그 앞날에는 안 쓴다"""
    일자 = [date.fromisoformat(d) for d in _날들(300)]
    후보 = [V._실적(일자[0], date(2024, 9, 30), 7.0, "annual"),
          V._실적(일자[-1] + timedelta(days=40), date(2026, 9, 30), 8.0, "ttm")]
    쓴 = V._그날것(일자, 후보)
    assert [x.값 for x in 쓴[:-1]] == [7.0] * 299 and 쓴[-1].값 == 8.0
    assert V._그날것([], 후보) == []


# ── 위치 ──────────────────────────────────────────────────────
def test_손으로_셈한_답과_같다():
    """주가는 늘 100, 순이익 10 → 20 → 40 — PER 비율은 10 → 5 → 2.5. 지금(2.5)보다 쌌던 날은 없고, 가운데 값은 5"""
    날들 = _날들(600)
    재무 = {"annual": _연(("2023-12-31", 10, 50), ("2024-12-31", 20, 50), ("2025-12-31", 40, 50))}
    d = V.가치위치(날들, np.full(600, 100.0), 재무)
    p = d["per"]
    assert d["as_of"] == "2026-11-11" and p["why"] is None
    assert p["below"] == 0.0 and p["vs_median"] == 0.5
    assert p["cheapest"] == {"date": "2026-03-31", "vs_now": 1.0}            # 2.5 가 된 첫날(같으면 앞의 날)
    assert p["priciest"] == {"date": 날들[0], "vs_now": 4.0}
    assert p["from"] == 날들[0] and p["days"] == 599 and p["excluded"] == []
    assert p["basis"] == {"kind": "annual", "end": "2025-12-31"}
    # 순자산은 늘 50 — 주가도 늘 같으니 지금보다 쌌던 날이 없고 가운데 값과 같다
    b = d["pbr"]
    assert b["below"] == 0.0 and b["vs_median"] == 1.0 and b["cheapest"]["vs_now"] == 1.0


def test_꾸준히_오른_주가는_지금이_가장_비싸다():
    날들 = _날들(500)
    종가 = np.arange(1.0, 501.0)
    d = V.가치위치(날들, 종가, {"annual": _연(("2023-12-31", 3, 7))})
    for 칸 in ("per", "pbr"):
        x = d[칸]
        assert x["below"] == 1.0 and x["vs_median"] == round(500 / 250, 4)          # 가운데 값 = 1..499 의 가운데 250
        assert x["cheapest"] == {"date": 날들[0], "vs_now": round(1 / 500, 4)}
        assert x["priciest"] == {"date": 날들[-2], "vs_now": round(499 / 500, 4)}


@pytest.mark.parametrize("씨", [1, 2, 3, 4, 5])
def test_여러_벌의_가짜_자료로_단순한_셈과_같다(씨):
    rng = np.random.default_rng(씨)
    날들 = _날들(1300)
    종가 = 50 * np.exp(np.cumsum(rng.normal(0, 0.02, 1300)))
    해들 = list(range(2020, 2026))
    분기들 = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]
    연 = [(f"{y}-12-31", float(rng.uniform(-2, 10)), float(rng.uniform(-5, 60))) for y in 해들]
    분 = [(p, float(rng.uniform(0.5, 3)), float(rng.uniform(40, 70))) for p in 분기들]
    분[3] = (분[3][0], 연[-1][1] - sum(x[1] for x in 분[:3]), 분[3][2])      # 2025 4분기 합 = 2025 연간
    재무 = {"annual": _연(*연), "quarterly": _연(*분)}
    d = V.가치위치(날들, 종가, 재무)
    for 칸, 후보 in (("per", V.순이익들(재무)), ("pbr", V.순자산들(재무))):
        x = d[칸]
        if x["why"] is not None:
            assert x["why"] in ("loss", "deficit", "short")
            continue
        손 = _손셈(날들, 종가, [(c.알려진, c.끝, c.값) for c in 후보])
        assert x["below"] == round(손["below"], 4)
        assert x["vs_median"] == round(손["vs_median"], 4)
        assert x["cheapest"] == {"date": 손["cheapest"][0], "vs_now": round(손["cheapest"][1], 4)}
        assert x["priciest"] == {"date": 손["priciest"][0], "vs_now": round(손["priciest"][1], 4)}
        assert x["from"] == 손["from"] and x["days"] == 손["days"]


def test_주식_수와_단위와_상관없다():
    """순이익·순자산·주가에 어떤 수를 곱해도 같은 답 — 주식 수를 쓰지 않으니까"""
    rng = np.random.default_rng(11)
    날들 = _날들(900)
    종가 = 80 * np.exp(np.cumsum(rng.normal(0, 0.015, 900)))
    줄들 = [("2022-12-31", 3.0, 30.0), ("2023-12-31", 4.0, 33.0), ("2024-12-31", 2.5, 34.0), ("2025-12-31", 5.0, 39.0)]
    기준 = V.가치위치(날들, 종가, {"annual": _연(*줄들)})
    assert 기준["per"]["why"] is None and 기준["pbr"]["why"] is None
    for 배, 값배 in ((1e12, 1.0), (1.0, 1300.0), (5e8, 0.01)):
        다른 = V.가치위치(날들, 종가 * 값배, {"annual": _연(*[(p, n * 배, e * 배) for p, n, e in 줄들])})
        assert 다른 == 기준


@pytest.mark.parametrize("적자", [-5, 0])
def test_적자인_날은_빼고_그_동안을_알려_준다(적자):
    """2023 연간이 적자(0 도) — 2024-04-01 ~ 2025-03-28 은 PER 을 셀 수 없어 뺀다. 순자산은 그대로라 PBR 은 다 쓴다"""
    날들 = _날들(800)
    재무 = {"annual": _연(("2022-12-31", 10, 100), ("2023-12-31", 적자, 90), ("2024-12-31", 8, 95), ("2025-12-31", 9, 99))}
    d = V.가치위치(날들, np.linspace(100, 140, 800), 재무)
    p = d["per"]
    assert p["why"] is None and p["excluded"] == [{"from": "2024-04-01", "to": "2025-03-28"}]   # 2023-12-31 + 90 = 3월 30일(토)
    뺀날 = sum("2024-04-01" <= x <= "2025-03-28" for x in 날들)
    assert p["days"] == 799 - 뺀날 and p["from"] == 날들[0]
    assert d["pbr"]["excluded"] == [] and d["pbr"]["days"] == 799


def test_처음부터_적자면_from_은_실적을_안_첫날():
    """첫 실적부터 적자 — from 은 실적을 안 첫날이고 뺀 동안도 거기서 시작한다. 가장 쌌던 날은 셀 수 있는 날 가운데서"""
    날들 = _날들(800)
    재무 = {"annual": _연(("2022-12-31", -3, 100), ("2023-12-31", 4, 100), ("2024-12-31", 4, 100), ("2025-12-31", 4, 100))}
    p = V.가치위치(날들, np.linspace(100, 140, 800), 재무)["per"]
    assert 날들[0] > "2023-03-31"                        # 2022 연간은 첫날 전에 알려졌다 — 첫날부터 적자
    assert p["from"] == 날들[0] and p["excluded"] == [{"from": 날들[0], "to": "2024-03-29"}]
    assert p["cheapest"]["date"] == "2024-04-01" and p["priciest"]["date"] == 날들[-2]
    assert p["days"] == 799 - sum(x <= "2024-03-29" for x in 날들)


def test_뺀_동안은_여럿이면_앞에서_셋까지():
    표시 = np.array([0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 0], dtype=bool)
    날들 = [f"d{i:02d}" for i in range(len(표시))]
    assert V._동안들(날들, 표시) == [{"from": "d01", "to": "d02"}, {"from": "d04", "to": "d04"}, {"from": "d07", "to": "d07"}]
    끝까지 = np.array([0, 0, 1, 1], dtype=bool)
    assert V._동안들(["a", "b", "c", "d"], 끝까지) == [{"from": "c", "to": "d"}]
    assert V._동안들(["a"], np.array([True])) == [{"from": "a", "to": "a"}]
    assert V._동안들(["a", "b"], np.zeros(2, dtype=bool)) == []


def test_지금_적자거나_자본잠식이면_위치를_말하지_않는다():
    날들 = _날들(600)
    재무 = {"annual": _연(("2023-12-31", 10, 100), ("2024-12-31", 9, 90), ("2025-12-31", -1, -3))}
    d = V.가치위치(날들, np.full(600, 50.0), 재무)
    assert d["per"] == {"why": "loss"} and d["pbr"] == {"why": "deficit"}
    # 0 도 셀 수 없다
    재무["annual"][-1].update(net_income=0, total_equity=0)
    d = V.가치위치(날들, np.full(600, 50.0), 재무)
    assert d["per"] == {"why": "loss"} and d["pbr"] == {"why": "deficit"}


def test_셀_날이_1년이_안_되면_말하지_않는다():
    """실적을 안 첫날부터 지난날이 249일이면 short, 250일이면 셈한다"""
    날들 = _날들(600)
    for 지난날수, 까닭 in ((249, "short"), (250, None)):
        첫날 = date.fromisoformat(날들[-1 - 지난날수])
        재무 = {"annual": _연(((첫날 - timedelta(days=90)).isoformat(), 5, 10))}
        d = V.가치위치(날들, np.linspace(10, 20, 600), 재무)
        assert d["per"]["why"] == 까닭 and d["pbr"]["why"] == 까닭
        if 까닭:
            assert d["per"]["days"] == 249
        else:
            assert d["per"]["days"] == 250 and d["per"]["from"] == 첫날.isoformat()


def test_실적이_없으면_nodata():
    날들 = _날들(400)
    for 재무 in (None, {}, {"annual": [], "quarterly": []}, {"annual": [{"period": "2024-12-31", "revenue": 5}]}):
        d = V.가치위치(날들, np.full(400, 10.0), 재무)
        assert d["per"] == {"why": "nodata"} and d["pbr"] == {"why": "nodata"}
    assert V.가치위치([], np.array([]), {"annual": _연(("2024-12-31", 1, 1))}) == {
        "as_of": None, "per": {"why": "nodata"}, "pbr": {"why": "nodata"}}


def test_5년_넘은_날은_보지_않는다():
    """7년치 주가에 6년 전 실적 — 5년(1826일) 앞의 날부터만 본다"""
    날들 = _날들(1800)
    종가 = np.linspace(10, 30, 1800)
    종가[:400] = 1.0                                        # 아주 쌌던 옛날 — 창 밖이라 '가장 쌌던 날' 이 되면 안 된다
    d = V.가치위치(날들, 종가, {"annual": _연(("2019-12-31", 2, 4))})
    시작 = (date.fromisoformat(날들[-1]) - timedelta(days=1826)).isoformat()
    p = d["per"]
    assert p["from"] >= 시작 and p["from"] == next(x for x in 날들 if x >= 시작)
    assert p["cheapest"]["date"] == p["from"] and p["days"] == sum(x >= 시작 for x in 날들) - 1


def test_운영_자료_모양_그대로():
    """운영 서버가 주는 모양(2026년 11월 확인) — 연간은 결산일, 앞의 해는 비었고, 분기 6개. 지금은 최근 4분기 합을 쓴다"""
    날들 = _날들(1250)
    rng = np.random.default_rng(3)
    종가 = 60000 * np.exp(np.cumsum(rng.normal(0.0004, 0.017, 1250)))
    재무 = {
        "annual": [{"period": "2021-12-31", "net_income": None, "total_equity": None},
                   *_연(("2022-12-31", 54.73e12, 345.2e12), ("2023-12-31", 14.47e12, 353.2e12),
                        ("2024-12-31", 33.62e12, 391.7e12), ("2025-12-31", 44.26e12, 424.3e12))],
        "quarterly": _연(("2025-03-31", 8.2e12, 400e12), ("2025-06-30", 5.1e12, 405e12), ("2025-09-30", 12.2e12, 412e12),
                       ("2025-12-31", 18.7e12, 424.3e12), ("2026-03-31", 40e12, 450e12), ("2026-06-30", 58e12, 500e12)),
    }
    d = V.가치위치(날들, 종가, 재무)
    assert d["per"]["basis"] == {"kind": "ttm", "end": "2026-06-30"}
    assert d["pbr"]["basis"] == {"kind": "quarter", "end": "2026-06-30"}
    assert d["per"]["from"] == "2023-03-31" == d["pbr"]["from"]                 # 2022 연간 + 90일
    지금 = 종가[-1] / (12.2e12 + 18.7e12 + 40e12 + 58e12)
    가운데 = d["per"]["vs_median"]
    assert math.isclose(지금 / 가운데, float(np.median(  # 가운데 값 = 지금 ÷ vs_median
        _손_비율들(날들, 종가, V.순이익들(재무)))), rel_tol=1e-3)


def _손_비율들(날들, 종가, 후보):
    마지막 = date.fromisoformat(날들[-1])
    out = []
    for i, d in enumerate(날들[:-1]):
        아는 = [x for x in 후보 if min(x.알려진, 마지막) <= date.fromisoformat(d)]
        if 아는:
            x = max(아는, key=lambda c: c.끝)
            if x.값 > 0:
                out.append(종가[i] / x.값)
    return out


# ── 길(API) ───────────────────────────────────────────────────
@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _비우기():
    def 지우기():
        try:
            R.limiter._storage.reset()
        except Exception:
            pass
        for 항목 in cache.keys_with_ttl():
            열쇠 = 항목.get("key") if isinstance(항목, dict) else 항목
            if isinstance(열쇠, str) and 열쇠.startswith("predict:"):
                cache.delete(열쇠)
    지우기()
    yield
    지우기()


_재무 = {"annual": _연(("2022-12-31", 10, 100), ("2023-12-31", 12, 110), ("2024-12-31", 14, 120), ("2025-12-31", 16, 130)),
        "quarterly": []}


@pytest.fixture
def 원천(monkeypatch):
    """시세·재무·투자지표를 흉내 낸다 — 부른 것을 적어 둔다"""
    부름: list = []
    상자 = {"봉들": [{"date": d, "close": c} for d, c in zip(_날들(1250), np.linspace(50, 80, 1250))],
          "재무": _재무, "지표": {"per": 9.33, "pbr": "2.42"}}

    def 시세(symbol, period, interval, market):
        부름.append(("시세", symbol, period, interval, market))
        if isinstance(상자["봉들"], Exception):
            raise 상자["봉들"]
        return 상자["봉들"]

    async def 재무(symbol, market, 기다림=None):
        부름.append(("재무", symbol, market, 기다림))
        if isinstance(상자["재무"], Exception):
            raise 상자["재무"]
        return 상자["재무"]

    async def 지표(symbol, market, 기다림=None):
        부름.append(("지표", symbol, market, 기다림))
        return 상자["지표"]

    monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)
    monkeypatch.setattr(R.fundamentals_service, "get_financials", 재무)
    monkeypatch.setattr(R.fundamentals_service, "get_fundamentals", 지표)
    return 부름, 상자


def test_가치_위치를_공식_값과_함께(client, 원천):
    부름, _ = 원천
    r = client.get(f"{API}/KR/005930/valuation")
    assert r.status_code == 200, r.text
    d = r.json()
    assert sorted(부름) == [("시세", "005930", "5y", "1d", "KR"), ("재무", "005930", "KR", 15), ("지표", "005930", "KR", 15)]
    assert d["symbol"] == "005930" and d["market"] == "KR" and d["as_of"] == "2026-11-11"
    assert d["per"]["now"] == 9.33 and d["pbr"]["now"] == 2.42                     # 글로 온 수도 수로
    for 칸 in ("per", "pbr"):
        assert d[칸]["why"] is None and 0 <= d[칸]["below"] <= 1 and d[칸]["basis"]["end"] == "2025-12-31"
        assert set(d[칸]) == {"now", "why", "below", "vs_median", "cheapest", "priciest", "from", "days", "excluded", "basis"}


@pytest.mark.parametrize("값", [None, "N/A", 0, -3.2, float("nan"), float("inf"), [], {}])
def test_공식_값은_0보다_큰_수만(값):
    assert R._공식값(값) is None
    assert R._공식값("9.33") == 9.33 and R._공식값(205.59) == 205.59


def test_ETF_는_셈하지_않는다(client, 원천):
    부름, _ = 원천
    r = client.get(f"{API}/ETF/SPY/valuation")
    assert r.status_code == 404 and "ETF" in r.json()["detail"] and 부름 == []


def test_시세를_못_받으면_503_없으면_404(client, 원천):
    _, 상자 = 원천
    상자["봉들"] = RuntimeError("야후가 막혔다")
    r = client.get(f"{API}/US/AAPL/valuation")
    assert r.status_code == 503 and "잠시 뒤" in r.json()["detail"]
    상자["봉들"] = []
    r = client.get(f"{API}/US/ZZZZ/valuation")
    assert r.status_code == 404 and "시세를 찾지 못했어요" in r.json()["detail"]
    assert cache.get("predict:valuation:v1:US:AAPL") is None and cache.get("predict:valuation:v1:US:ZZZZ") is None


def test_재무_받기가_터져도_빈칸으로(client, 원천):
    _, 상자 = 원천
    상자["재무"] = RuntimeError("DART 가 막혔다")
    d = client.get(f"{API}/US/AAPL/valuation").json()
    assert d["per"] == {"why": "nodata", "now": 9.33} and d["pbr"] == {"why": "nodata", "now": 2.42}


def test_재무를_받으면_한_시간_못_받으면_5분만_들고_있는다(client, 원천, monkeypatch):
    부름, 상자 = 원천
    담은: dict = {}
    원래 = R.cache.set
    monkeypatch.setattr(R.cache, "set", lambda k, v, ttl=None: (담은.__setitem__(k, ttl), 원래(k, v, ttl)))
    가 = client.get(f"{API}/US/AAPL/valuation").json()
    나 = client.get(f"{API}/US/aapl/valuation").json()                  # 대소문자만 다른 같은 종목 — 다시 안 받는다
    assert 가 == 나 and [b[0] for b in 부름].count("재무") == 1
    assert 담은["predict:valuation:v1:US:AAPL"] == 3600
    상자["재무"] = {"annual": [], "quarterly": []}
    client.get(f"{API}/US/MSFT/valuation")
    assert 담은["predict:valuation:v1:US:MSFT"] == 300
    상자["재무"] = None
    client.get(f"{API}/US/NVDA/valuation")
    assert 담은["predict:valuation:v1:US:NVDA"] == 300


def test_잘못된_주소(client, 원천):
    부름, _ = 원천
    assert client.get(f"{API}/JP/7203/valuation").status_code == 422
    assert client.get(f"{API}/US/AB$C/valuation").status_code == 422
    assert 부름 == []


def test_요청_제한은_분당_30번(client, 원천):
    for _ in range(30):
        assert client.get(f"{API}/US/AAPL/valuation").status_code == 200
    assert client.get(f"{API}/US/AAPL/valuation").status_code == 429
