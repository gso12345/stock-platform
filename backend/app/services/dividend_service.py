"""배당 달력 — 내 종목이 언제 얼마를 주는가.

지금까지 배당은 '배당수익률 2.1%' 라는 숫자 하나로만 있었다. 그런데
배당을 보고 사는 사람이 정작 알고 싶은 것은 **언제** 들어오느냐다.
그 자리가 통째로 비어 있었다.

── 무엇을 원천으로 쓰나 ──

야후(yfinance) 두 가지다.

  · Ticker.dividends — 지난 배당 내역(기준일과 금액). 국내(.KS/.KQ)도
    해외도 나온다.
  · Ticker.calendar — 회사가 이미 공시한 다음 배당기준일·지급일.
    대개 미국 종목에만 채워져 있다.

공시된 날짜가 있으면 그걸 쓰고, 없으면 지난 내역의 간격으로 다음
날짜를 **추정**한다. 추정한 것은 반드시 추정이라고 표시해서 내보낸다 —
'8월 12일에 들어온다' 와 '8월 중순쯤일 것 같다' 는 다른 말이다.

── 값을 어떻게 아끼나 ──

이 조회는 종목 하나에 HTTP 두 번이다. 보유 20종목이면 40번인데,
0.15 CPU 서버에서 한 요청에 그걸 다 하면 화면이 30초를 기다린다.
그래서 세 겹으로 막는다.

  · 캐시_우선 — 담긴 것/지난 것을 즉시 주고 뒤에서 채운다. 배당은
    하루에 몇 번씩 바뀌는 값이 아니라 하루를 담아 둔다.
  · 한 요청에 새로 받는 종목 수를 묶는다. 나머지는 다음 요청 때
    채워진다 — 처음 몇 번은 목록이 조금씩 길어지는 대신 안 멈춘다.
  · 쉼표 — 배당을 아예 안 주는 종목이 훨씬 많다. 빈손으로 돌아온
    종목은 한동안 그만 물어본다.
"""
import logging
from datetime import date, datetime, timedelta

from app.core.backoff import 쉼표
from app.core.cache import cache
from app.core.fetchcache import 캐시_우선

log = logging.getLogger(__name__)

#: 배당 내역은 하루에 몇 번씩 바뀌지 않는다
수명 = 60 * 60 * 24
#: 빈손(=배당 없는 종목)은 더 오래 기억한다. 무배당 종목이 훨씬 많다
빈손수명 = 60 * 60 * 24 * 3

#: 한 요청에 새로 받아 올 종목 수. 나머지는 다음 요청 때 채워진다
한번에 = 6

#: 안 되는 종목은 쉬게 둔다. 후보가 사람마다 수십 개라 '돌아가며' 쪽
쉼 = 쉼표(쉼_기준=3, 되살림_칸=1)

#: 지난 배당을 몇 건까지 들여다볼지.
#
#  8 이었다. 분기배당이면 두 해치지만 주배당 ETF 는 두 달치밖에 안 된다 —
#  달마다 실제로 얼마를 줬는지 보려면 최소 한 해가 필요하고, '작년 이맘때
#  얼마였나' 까지 보려면 두 해가 있어야 한다. 주배당(연 52회) 두 해면
#  104건이라 넉넉히 잡는다.
최근_건수 = 120

#: 달별 금액·날짜를 뽑을 때 몇 해까지 거슬러 보나
되짚는_해 = 2


def _야후심볼(symbol: str, market: str) -> str:
    """국내 종목은 야후에서 접미사가 필요하다."""
    s = (symbol or "").upper()
    if market != "KR":
        return s
    if s.endswith(".KS") or s.endswith(".KQ"):
        return s
    return f"{s}.KS" if s.isdigit() else s


def _주기(날들: list) -> "str | None":
    """지난 기준일 간격으로 배당 주기를 읽는다.

    간격의 '가운데 값' 을 쓴다. 평균을 쓰면 특별배당 한 번이 통째로
    주기를 흔든다 — 삼성전자처럼 분기배당에 결산배당이 겹치는 종목이
    실제로 그렇다."""
    if len(날들) < 2:
        return None
    간격 = sorted((날들[i] - 날들[i - 1]).days for i in range(1, len(날들)))
    if not 간격:
        return None
    가운데 = 간격[len(간격) // 2]
    if 가운데 <= 10:
        # 주배당 ETF(APLY·NVDY·AMZY 같은 것). '월' 로 묶으면 한 달에
        # 네 번 받는 것을 한 번으로 세어 예상액이 4분의 1이 된다
        return "주"
    if 가운데 <= 45:
        return "월"
    if 가운데 <= 135:
        return "분기"
    if 가운데 <= 270:
        return "반기"
    if 가운데 <= 500:
        return "연"
    return None


_주기일수 = {"주": 7, "월": 30, "분기": 91, "반기": 182, "연": 365}

#: 한 달에 몇 번 받나. 주배당은 4~5주라 평균을 쓴다(365/12/7)
_한달회차 = {"주": 4.35, "월": 1.0, "분기": 1.0, "반기": 1.0, "연": 1.0}


def _월별일정(최근: list, 날들: list, 주기: "str | None") -> list:
    """달마다 '며칠에, 주당 얼마' 를 실제 내역에서 뽑는다.

    ── 왜 필요한가 ──

    지금까지 화면은 마지막 회차 금액(last_amount) 하나를 열두 달에 다
    썼다. 그런데 분기배당은 회차마다 금액이 다르다 — 결산배당이 붙는
    4분기가 특히 크다. 마지막 회차가 그 큰 회차면 한 해 예상이 통째로
    부풀고, 작은 회차면 반대로 깎인다.

    예: 분기마다 0.20 / 0.25 / 0.30 / 0.35 를 주는 종목이면 한 해 1.10
    인데, 마지막 회차(0.35)를 네 번 곱하면 1.40 이 된다 — 27% 를 더
    받는 것으로 나온다.

    ── 어떻게 뽑나 ──

    달마다 **가장 최근 해의 실제 지급액**을 쓴다. 주배당·월배당처럼 한
    달에 여러 번 주는 종목은 그 달 안의 지급을 합친다.

    날짜는 그 달에 실제로 준 날이다. '분기배당은 91일마다' 로 미루면
    회차마다 며칠씩 밀려서 1년 뒤에는 달이 바뀐다 — 3월 말에 주던
    종목이 4월로 넘어가 버린다.
    """
    if not 최근:
        return []
    자를날 = date.today() - timedelta(days=365 * 되짚는_해)
    칸: dict = {}
    for x, d in zip(최근, 날들):
        if d < 자를날:
            continue
        칸.setdefault(d.month, []).append((d, float(x.get("amount") or 0)))

    결과 = []
    for m in sorted(칸):
        것들 = sorted(칸[m])
        # 그 달이 마지막으로 나온 해만 쓴다. 두 해를 다 더하면 두 배가 된다
        최신해 = 것들[-1][0].year
        같은해 = [(d, a) for d, a in 것들 if d.year == 최신해]
        결과.append({
            "month": m,
            "day": 같은해[-1][0].day,
            "amount": round(sum(a for _, a in 같은해), 6),
            "year": 최신해,
        })
    return 결과


def _다음_일정(일정: list, 오늘: "date | None" = None) -> "date | None":
    """월별 일정에서 앞으로 제일 가까운 날.

    예전에는 '마지막 기준일 + 주기일수' 였다. 91일씩 더하면 회차마다
    며칠씩 밀리고, 네 번 밀리면 364일이라 한 해에 하루씩 앞당겨진다 —
    몇 해 지나면 달이 바뀐다. 실제로 준 달·날을 그대로 쓴다."""
    if not 일정:
        return None
    오늘 = 오늘 or date.today()
    후보 = []
    for 해 in (오늘.year, 오늘.year + 1):
        for 칸 in 일정:
            try:
                d = date(해, 칸["month"], min(칸["day"], _그달끝(해, 칸["month"])))
            except ValueError:
                continue
            if d >= 오늘:
                후보.append(d)
    return min(후보) if 후보 else None


def _그달끝(해: int, 달: int) -> int:
    """그 달의 마지막 날. 2월 30일 같은 날짜를 만들지 않으려고."""
    import calendar as _cal
    return _cal.monthrange(해, 달)[1]


def _다음_예상(마지막: date, 주기: "str | None") -> "date | None":
    """마지막 기준일 + 주기. 이미 지난 날짜가 나오면 올 때까지 민다.

    한 번만 더하면 오래 안 들여다본 종목에서 과거 날짜가 나온다 —
    달력에 지난 날짜가 '다음 배당' 으로 찍히는 것은 그냥 틀린 정보다."""
    일수 = _주기일수.get(주기 or "")
    if not 일수:
        return None
    다음 = 마지막 + timedelta(days=일수)
    오늘 = date.today()
    돈수 = 0
    while 다음 < 오늘 and 돈수 < 24:
        다음 += timedelta(days=일수)
        돈수 += 1
    return 다음 if 다음 >= 오늘 else None


def _가져오기(symbol: str, market: str) -> dict:
    """야후에서 한 종목의 배당을 읽는다. 실패하면 빈 dict."""
    import yfinance as yf

    야후 = _야후심볼(symbol, market)
    t = yf.Ticker(야후)

    최근: list[dict] = []
    try:
        s = t.dividends
        if s is not None and len(s):
            for 날, 금액 in list(s.items())[-최근_건수:]:
                try:
                    d = 날.date() if hasattr(날, "date") else 날
                    최근.append({"date": d.isoformat(), "amount": float(금액)})
                except Exception:
                    continue
    except Exception as e:
        log.debug("배당 내역 실패 %s: %s", 야후, type(e).__name__)

    if not 최근:
        return {}                      # 배당을 안 주는 종목이거나 못 받았다

    날들 = [date.fromisoformat(x["date"]) for x in 최근]
    주기 = _주기(날들)

    """지난 1년치 합 = 연 배당금.

    '주당 얼마' 는 종목마다 자릿수가 달라(삼성전자 361원, 애플 0.25달러)
    그 자체로는 비교가 안 된다. 화면에서 수량을 곱해 '내가 받을 돈' 으로
    쓰려고 여기서 합만 내 둔다."""
    한해전 = date.today() - timedelta(days=365)
    연배당 = round(sum(x["amount"] for x, d in zip(최근, 날들) if d >= 한해전), 6)

    """배당월 — 이 종목이 몇 월에 주나.

    화면이 '2, 5, 8, 11' 처럼 적어 준다. 분기배당이라도 회사마다 달이
    달라서(2·5·8·11 vs 3·6·9·12), 이걸 안 적으면 한 해 계획을 못 세운다.

    주배당·월배당은 열두 달 전부다."""
    일정 = _월별일정(최근, 날들, 주기)
    if 주기 in ("주", "월"):
        배당월 = list(range(1, 13))
        # 아직 한 해가 안 찬 종목은 빈 달이 생긴다. 월배당인 걸 아는데
        # 몇 달이 비어 보이면 '그 달은 안 준다' 로 읽힌다 — 있는 달들의
        # 평균으로 메운다
        있는것 = {x["month"]: x for x in 일정}
        if 있는것:
            평균 = round(sum(x["amount"] for x in 있는것.values()) / len(있는것), 6)
            어느날 = sorted(있는것.values(), key=lambda x: x["month"])[-1]["day"]
            일정 = [있는것.get(m) or {"month": m, "day": 어느날, "amount": 평균, "year": None}
                    for m in 배당월]
    else:
        배당월 = [x["month"] for x in 일정]
        if not 배당월:
            배당월 = sorted({d.month for d in 날들})

    확정일 = 지급일 = None
    try:
        cal = t.calendar or {}
        ex = cal.get("Ex-Dividend Date")
        pay = cal.get("Dividend Date")
        # 이미 지난 날짜는 '다음 배당' 이 아니다. 야후는 지난 회차를
        # 그대로 남겨 두는 일이 잦다
        if isinstance(ex, date) and ex >= date.today():
            확정일 = ex.isoformat()
        if isinstance(pay, date) and pay >= date.today():
            지급일 = pay.isoformat()
    except Exception as e:
        log.debug("배당 일정 실패 %s: %s", 야후, type(e).__name__)

    예상일 = None
    if not 확정일:
        # 실제로 준 달·날 패턴을 먼저 쓰고, 그게 없을 때만 주기로 민다
        d = _다음_일정(일정) or _다음_예상(날들[-1], 주기)
        예상일 = d.isoformat() if d else None

    return {
        "symbol": symbol, "market": market,
        "recent": 최근,
        "per_year": 연배당,
        #: 앞으로 한 해 받을 것으로 보이는 주당 금액.
        #
        #  per_year(지난 1년 실제 합)와 다를 수 있다 — 반년 전에 배당을
        #  시작한 종목은 지난 1년 합이 반년치뿐이라 실제보다 작게 나온다.
        #  화면이 '한 해 예상' 으로 쓰는 것은 이쪽이다.
        "plan_year": round(sum(x["amount"] for x in 일정), 6) if 일정 else 연배당,
        #: 달마다 며칠에 주당 얼마 — [{"month":3,"day":31,"amount":0.25}, ...]
        "schedule": 일정,
        "cycle": 주기,
        #: 몇 월에 주나 — [2, 5, 8, 11]. 주·월배당은 1~12 전부
        "months": 배당월,
        #: 한 달에 몇 번. 주배당만 1보다 크다
        "per_month": _한달회차.get(주기 or "", 1.0),
        #: 국내면 원, 아니면 달러. 화면이 원화로 환산할 때 쓴다
        "currency": "KRW" if market == "KR" else "USD",
        "last_date": 최근[-1]["date"],
        "last_amount": 최근[-1]["amount"],
        # 회사가 공시한 날짜. 있으면 이쪽이 옳다
        "ex_date": 확정일,
        "pay_date": 지급일,
        # 없을 때만 쓰는 추정치. 화면에서 '예상' 이라고 밝힌다
        "estimated_date": 예상일,
    }


def 한종목(symbol: str, market: str, 받아도되나: bool = True) -> dict:
    """담긴 것 → 지난 것 → (여유가 있으면) 직접. 없으면 빈 dict."""
    ck = f"div:{market}:{symbol}"
    if (c := cache.get(ck)) is not None:
        return c
    if (s := cache.get_stale(ck)) is not None:
        return s
    if not 받아도되나 or 쉼.쉬는가(ck):
        return {}

    def 받기():
        try:
            결과 = _가져오기(symbol, market)
        except Exception as e:
            log.debug("배당 조회 실패 %s: %s", symbol, type(e).__name__)
            쉼.기록(ck, True)
            return {}
        쉼.기록(ck, not 결과)
        if 결과:
            cache.set(ck, 결과, 수명)
        return 결과

    return 캐시_우선(ck, 받기, {}, miss_ttl=빈손수명)


def 달력(보유: list) -> dict:
    """내 종목들의 배당을 날짜순으로 묶는다.

    `보유` 는 (symbol, market, name, shares) 를 가진 것들. shares 가
    0 이면 관심종목처럼 '갖고 있진 않지만 보고 싶은' 것으로 친다.

    한 요청에 새로 받는 종목 수를 묶는다. 처음 몇 번은 목록이 조금씩
    길어지는 대신, 화면이 30초를 기다리는 일이 없다."""
    남은칸 = 한번에
    줄들 = []
    못받음 = 0

    # 쉬는 종목을 뒤로 미룬다 — 살아 있는 것부터 칸을 쓴다
    차례 = 쉼.돌아가며_깨우기(list(보유 or []),
                              lambda x: f"div:{x.get('market')}:{x.get('symbol')}")
    미룬것 = [x for x in (보유 or []) if x not in 차례]

    for it in 차례 + 미룬것:
        sym, mkt = it.get("symbol"), it.get("market")
        if not sym or not mkt:
            continue
        ck = f"div:{mkt}:{sym}"
        담긴것 = cache.get(ck) or cache.get_stale(ck)
        if 담긴것 is None and 남은칸 <= 0:
            못받음 += 1
            continue
        if 담긴것 is None:
            남은칸 -= 1
        정보 = 한종목(sym, mkt, 받아도되나=True)
        if not 정보:
            continue

        날 = 정보.get("ex_date") or 정보.get("estimated_date")
        if not 날:
            continue
        수량 = float(it.get("shares") or 0)
        줄들.append({
            **정보,
            "name": it.get("name") or sym,
            "shares": 수량,
            "date": 날,
            "confirmed": bool(정보.get("ex_date")),
            # 이번 회차에 받을 것으로 보이는 돈. 수량이 0이면 안 낸다
            "expected": round(수량 * float(정보.get("last_amount") or 0), 2) if 수량 else None,
            # 한 해에 받을 것으로 보이는 돈. 지난 1년 실제 합(per_year)이
            # 아니라 앞으로 한 해 계획(plan_year)을 쓴다 — 화면의 월별
            # 막대를 다 더한 값과 같아야 두 숫자가 서로 안 어긋난다
            "expected_year": round(수량 * float(정보.get("plan_year") or 정보.get("per_year") or 0), 2) if 수량 else None,
        })

    줄들.sort(key=lambda x: x["date"])
    return {"items": 줄들, "pending": 못받음}


def 진단() -> dict:
    """관리자 화면용 — 지금 무엇이 쉬고 있나."""
    return {"쉬는것": 쉼.쉬는것들(), "한번에": 한번에}
