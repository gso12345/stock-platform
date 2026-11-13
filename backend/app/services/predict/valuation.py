"""가치 위치 — 지금 주가수익비율(PER)·주가순자산비율(PBR)이 이 종목의 지난날 가운데 어디쯤인지(사용자: "바로 할 수 있는
것 해줘" — 기본적 분석으로 6개월·1년 뒤를 맞힐 수 있느냐는 물음에 '예측 말고 바로 할 수 있는 것' 으로 내놓은 것).

예측이 아니다. 싸 보이는 종목이 오른다는 것은 여러 해·여러 종목을 모아야 겨우 보이는 약한 경향이라, 한 종목의 앞날을
말해 주지 않는다. 그래서 '지금이 이 종목의 지난날에 견주어 싼 편인가 비싼 편인가' 만 보여 준다.

셈하는 법
  · 날마다 '종가 ÷ 그날 알려져 있던 최근 1년 순이익'(PBR 은 '÷ 그날 알려져 있던 순자산'). 주식 수는 쓰지 않는다 —
    PER = 주가 × 주식 수 ÷ 순이익 이라, 주식 수가 그대로면 날들 사이의 차례와 가운데 값과의 비율은 주식 수와 상관없다.
    주식 수를 받아 쓰면 액면분할·주식 종류(ADR)·단위가 섞여 몇 배씩 틀리기 쉽다. 자사주 소각·증자로 주식 수가 바뀐
    만큼만 어긋난다(애플은 3년에 6%쯤 줄었다)
  · 최근 1년 순이익 — 분기 실적이 넷 이어 있으면 그 합(최근 4분기), 아니면 연간 실적. 연간만 쓰면 실적이 빠르게 바뀐 종목이
    크게 틀린다(운영 자료로 보니 2026년 11월 삼성전자 — 공식 PER 9.3배인데 2025년 연간 순이익으로는 27배쯤). 4분기 합이
    같은 끝의 연간 실적과 15% 넘게 다르면(누적 금액이 섞였다 따위) 분기 실적을 쓰지 않는다
  · 알려진 날 — 연간 실적은 회계연도 끝 + 90일(국내 사업보고서 마감), 분기는 분기 끝 + 45일(분기보고서 마감). 회계연도가
    끝나는 분기는 연간과 같이 90일. 늦게 잡는 쪽이 안전하다(일찍 잡으면 그날 몰랐던 실적으로 셈한다). 받아 둔 실적은
    마지막 날에는 모두 안다
  · 적자(순이익 0 이하)·자본잠식(순자산 0 이하) 실적을 쓰던 날은 뺀다 — 그때의 PER·PBR 은 뜻이 없다
  · 지금 = 마지막 날. 지난날(최대 5년) 가운데 지금보다 쌌던(비율이 낮았던) 날의 비율 · 지난날 가운데 값과의 비율 ·
    가장 쌌던 날 · 가장 비쌌던 날

재무 자료는 fundamentals_service.get_financials 의 모양 — {"annual": [...], "quarterly": [...]}, 줄마다 period('2025-12-31'
· 연간은 '2025' 도) · net_income · total_equity. 이 파일은 숫자만 다룬다(받기·담아 두기는 routes/predict).
"""
import calendar
import math
from collections import Counter
from datetime import date, timedelta
from typing import NamedTuple, Optional

import numpy as np

#: 실적이 알려졌다고 볼 때까지(일) — 국내 사업보고서는 회계연도가 끝나고 90일, 분기·반기보고서는 45일 안에 낸다
#: (미국은 큰 회사 60일·40일)
연간늦음 = 90
분기늦음 = 45
#: 지난날로 보는 기간(년)
창년 = 5
#: 지난날이 이보다 적으면 위치를 말하지 않는다 — 1년(영업일)
최소일수 = 250
#: 이 안이면 이어진 분기로 본다(분기 끝 사이 날 수)
분기간격 = (80, 100)
#: 4분기 합이 같은 끝의 연간 순이익과 이만큼 넘게 다르면 분기 실적을 믿지 않는다
분기어긋남 = 0.15
#: 끝날이 이만큼 안에서 같으면 같은 결산으로 본다(52·53주 회계연도는 끝이 며칠씩 다르다)
같은끝 = 10
#: 돌려주는 '뺀 동안' 의 수 — 적자를 오갔어도 화면에는 몇 개면 된다
뺀동안수 = 3


class _실적(NamedTuple):
    알려진: date
    끝: date
    값: float
    #: annual(연간) · ttm(최근 4분기 합) · quarter(분기 끝 순자산)
    갈래: str


def _끝날(period, 해만됨: bool) -> Optional[date]:
    """'2025-12-31' → 그날, '2025-12' → 그달 끝날. 해만됨이면 '2025' → 그해 12월 31일(DART·FMP 연간).
    분기 줄의 '2025'(FMP 분기는 해만 온다 — 넷이 같은 이름)·'2026Q1'(DART) 같은 것은 None"""
    s = str(period or "").strip()
    try:
        if len(s) == 10:
            return date.fromisoformat(s)
        if len(s) == 7 and s[4] == "-":
            y, m = int(s[:4]), int(s[5:])
            return date(y, m, calendar.monthrange(y, m)[1])
        if 해만됨 and len(s) == 4 and s.isdigit():
            return date(int(s), 12, 31)
    except ValueError:
        return None
    return None


def _수(줄: dict, 칸: str) -> Optional[float]:
    v = 줄.get(칸) if isinstance(줄, dict) else None
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _줄들(재무: Optional[dict], 갈래: str, 칸: str) -> dict[date, float]:
    """끝날 → 값(같은 끝이 둘이면 뒤의 것)"""
    줄들 = (재무 or {}).get(갈래) or []
    표: dict[date, float] = {}
    for 줄 in 줄들 if isinstance(줄들, list) else []:
        끝 = _끝날((줄 or {}).get("period") if isinstance(줄, dict) else None, 해만됨=갈래 == "annual")
        v = _수(줄, 칸)
        if 끝 is not None and v is not None:
            표[끝] = v
    return 표


def _같은끝(끝: date, 끝들) -> Optional[date]:
    for e in 끝들:
        if abs((e - 끝).days) <= 같은끝:
            return e
    return None


def _결산달(연간끝들) -> Optional[int]:
    """연간 실적이 끝나는 달 — 가장 흔한 달(삼성전자 12 · 애플 9 · 엔비디아 1)"""
    달들 = Counter(e.month for e in 연간끝들)
    return 달들.most_common(1)[0][0] if 달들 else None


def _늦음(끝: date, 결산달: Optional[int]) -> int:
    return 연간늦음 if 결산달 is not None and 끝.month == 결산달 else 분기늦음


def _이어진(끝들: list[date]) -> bool:
    return all(분기간격[0] <= (b - a).days <= 분기간격[1] for a, b in zip(끝들, 끝들[1:]))


def 순이익들(재무: Optional[dict]) -> list[_실적]:
    """그날 알려져 있던 '최근 1년 순이익' 의 후보 — 연간 실적과 최근 4분기 합"""
    연 = _줄들(재무, "annual", "net_income")
    분 = sorted(_줄들(재무, "quarterly", "net_income").items())
    결산달 = _결산달(연)
    합들: dict[date, float] = {}
    for i in range(3, len(분)):
        넷 = 분[i - 3: i + 1]
        if _이어진([e for e, _ in 넷]):
            합들[분[i][0]] = sum(v for _, v in 넷)
    # 같은 끝의 연간 실적과 견줘 본다 — 크게 다르면 분기 줄이 3개월 금액이 아니다(누적 따위)
    for 끝, 합 in 합들.items():
        e = _같은끝(끝, 연)
        if e is not None and abs(합 - 연[e]) > 분기어긋남 * abs(연[e]):
            합들 = {}
            break
    실적들 = [_실적(e + timedelta(days=연간늦음), e, v, "annual") for e, v in 연.items()]
    실적들 += [_실적(e + timedelta(days=_늦음(e, 결산달)), e, v, "ttm")
             for e, v in 합들.items() if _같은끝(e, 연) is None]
    return 실적들


def 순자산들(재무: Optional[dict]) -> list[_실적]:
    """그날 알려져 있던 순자산의 후보 — 연간 결산과 분기 끝"""
    연 = _줄들(재무, "annual", "total_equity")
    분 = _줄들(재무, "quarterly", "total_equity")
    결산달 = _결산달(연)
    실적들 = [_실적(e + timedelta(days=연간늦음), e, v, "annual") for e, v in 연.items()]
    실적들 += [_실적(e + timedelta(days=_늦음(e, 결산달)), e, v, "quarter")
             for e, v in 분.items() if _같은끝(e, 연) is None]
    return 실적들


def _그날것(날들: list[date], 실적들: list[_실적]) -> list[Optional[_실적]]:
    """날마다 그날까지 알려진 실적 가운데 끝이 가장 늦은 것. 마지막 날에는 받아 둔 것을 모두 안다"""
    if not 날들:
        return []
    마지막 = 날들[-1]
    차례 = sorted(실적들, key=lambda x: (min(x.알려진, 마지막), x.끝))
    쓴: list[Optional[_실적]] = []
    j, 지금것 = 0, None
    for d in 날들:
        while j < len(차례) and min(차례[j].알려진, 마지막) <= d:
            if 지금것 is None or 차례[j].끝 > 지금것.끝:
                지금것 = 차례[j]
            j += 1
        쓴.append(지금것)
    return 쓴


def _동안들(날들: list[str], 표시: np.ndarray) -> list[dict]:
    """표시가 이어진 동안 → [{from, to}] (앞에서부터 뺀동안수 개)"""
    동안들: list[dict] = []
    시작 = None
    for i, x in enumerate(표시):
        if x and 시작 is None:
            시작 = i
        if 시작 is not None and (not x or i == len(표시) - 1):
            끝 = i if x else i - 1
            동안들.append({"from": 날들[시작], "to": 날들[끝]})
            시작 = None
    return 동안들[:뺀동안수]


def _위치(날들: list[str], 종가: np.ndarray, 쓴: list[Optional[_실적]], 마이너스: str) -> dict:
    """지금(마지막 날)이 지난날 가운데 어디쯤인지. 셀 수 없으면 {"why": 까닭}"""
    지금것 = 쓴[-1]
    if 지금것 is None:
        return {"why": "nodata"}
    if 지금것.값 <= 0:
        return {"why": 마이너스}
    분모 = np.array([np.nan if x is None else x.값 for x in 쓴], dtype=float)
    지난 = np.arange(len(날들)) < len(날들) - 1
    알던 = 지난 & np.isfinite(분모)
    with np.errstate(invalid="ignore"):
        쓸 = 알던 & (분모 > 0)
        뺀 = 알던 & (분모 <= 0)
    if int(쓸.sum()) < 최소일수:
        return {"why": "short", "days": int(쓸.sum())}
    비율 = np.full(len(날들), np.nan)
    비율[쓸] = 종가[쓸] / 분모[쓸]
    지금 = float(종가[-1] / 지금것.값)
    지난비율 = 비율[쓸]
    자리 = np.flatnonzero(쓸)
    싼날, 비싼날 = int(자리[np.argmin(지난비율)]), int(자리[np.argmax(지난비율)])
    return {
        "why": None,
        "below": round(float(np.mean(지난비율 < 지금)), 4),
        "vs_median": round(지금 / float(np.median(지난비율)), 4),
        "cheapest": {"date": 날들[싼날], "vs_now": round(float(비율[싼날]) / 지금, 4)},
        "priciest": {"date": 날들[비싼날], "vs_now": round(float(비율[비싼날]) / 지금, 4)},
        "from": 날들[int(np.flatnonzero(알던)[0])],
        "days": int(쓸.sum()),
        "excluded": _동안들(날들, 뺀),
        "basis": {"kind": 지금것.갈래, "end": 지금것.끝.isoformat()},
    }


def 가치위치(날들: list[str], 종가: np.ndarray, 재무: Optional[dict]) -> dict:
    """{"as_of", "per": {...}, "pbr": {...}} — 날들은 차례로 선 'YYYY-MM-DD', 종가는 0 보다 큰 값(forecast.종가정리).
    per·pbr 은 셀 수 있으면 why=None 과 below·vs_median·cheapest·priciest·from·days·excluded·basis, 없으면 why 만
    (loss 지금 적자 · deficit 자본잠식 · short 셀 날이 1년 안 됨(days) · nodata 실적 없음)"""
    if not 날들:
        return {"as_of": None, "per": {"why": "nodata"}, "pbr": {"why": "nodata"}}
    일자 = [date.fromisoformat(d) for d in 날들]
    시작 = 일자[-1] - timedelta(days=round(창년 * 365.25))
    i0 = next(i for i, d in enumerate(일자) if d >= 시작)
    날들, 일자, 종가 = 날들[i0:], 일자[i0:], np.asarray(종가, dtype=float)[i0:]
    return {
        "as_of": 날들[-1],
        "per": _위치(날들, 종가, _그날것(일자, 순이익들(재무)), "loss"),
        "pbr": _위치(날들, 종가, _그날것(일자, 순자산들(재무)), "deficit"),
    }
