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

#: 지난 배당을 몇 건까지 보여줄지
최근_건수 = 8


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
    if 주기 in ("주", "월"):
        배당월 = list(range(1, 13))
    else:
        # 지난 1년치에서 실제로 받은 달만. 오래된 것까지 넣으면
        # 예전에 주다 만 달이 섞인다
        배당월 = sorted({d.month for d in 날들 if d >= 한해전})
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
        d = _다음_예상(날들[-1], 주기)
        예상일 = d.isoformat() if d else None

    return {
        "symbol": symbol, "market": market,
        "recent": 최근,
        "per_year": 연배당,
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
            # 한 해에 받을 것으로 보이는 돈
            "expected_year": round(수량 * float(정보.get("per_year") or 0), 2) if 수량 else None,
        })

    줄들.sort(key=lambda x: x["date"])
    return {"items": 줄들, "pending": 못받음}


def 진단() -> dict:
    """관리자 화면용 — 지금 무엇이 쉬고 있나."""
    return {"쉬는것": 쉼.쉬는것들(), "한번에": 한번에}
