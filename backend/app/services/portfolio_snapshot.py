"""내 자산이 하루하루 얼마였는지 남긴다. 자산 그래프의 재료.

화면은 지금까지 '오늘 얼마인가' 만 말했다. 정작 보고 싶은 것은
'지난달보다 늘었나' 인데, 받쳐 줄 기록이 아무 데도 없었다.

값이 거의 안 드는 것이 요점이다.

  · 새로 조회하지 않는다. 이미 받아 둔 price:{symbol} 캐시만 읽는다.
  · 하루 한 사람당 한 줄. 이미 있으면 곧장 넘어간다.
  · 보유 종목이 있는 사람만 본다.

── 화면과 같은 숫자가 나와야 한다 ──

합계는 지금까지 화면(Portfolio.tsx)에서만 냈다. 서버가 제 방식대로
다시 계산하면 그래프의 오늘 점과 화면 위의 '총 평가금액' 이 서로 다른
말을 하게 된다 — 그건 그래프가 없는 것보다 나쁘다.

그래서 화면이 쓰는 규칙을 그대로 옮겼다.

  · 매입금액 = 평단가 × (USD 로 넣었으면 입력환율 or 현재환율) × 수량
  · 평가금액 = (US/ETF 면 시세 × 환율 × 수량, KR 이면 시세 × 수량)
  · 시세를 못 구한 종목은 평가금액 = 매입금액 (손익 0)

마지막 줄이 중요하다. 못 구했다고 현지 시세 자리에 평단가를 넣으면,
원화로 넣은 해외 종목은 이미 원화인 값에 환율을 또 곱해 수천 배가 된다.
화면이 예전에 그 사고를 냈고, 주석으로 남아 있다.
"""
import logging
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

#: 한국 날짜를 쓴다. UTC 로 적으면 밤 9시 이후 값이 '내일' 로 들어간다.
KST = timezone(timedelta(hours=9))

#: 한 회차에 볼 최대 사용자 수. 사람이 늘어도 한 번에 몰아 하지 않는다 —
#  다음 회차(15분 뒤)에 나머지를 본다. 어차피 하루 안에만 찍히면 된다.
한회차_최대 = 300

#: 시세가 없는 자산유형. 현금·채권 실물처럼 시세가 원래 없는 것들이라,
#  '시세를 못 구했다' 로 세면 안 된다.
시세없는유형 = {"현금"}


def _정규(symbol: str) -> str:
    """국내 종목 접미사를 뗀 비교용 열쇠 — 화면의 normalizeSymbol 과 같다."""
    s = (symbol or "").upper()
    for 꼬리 in (".KS", ".KQ"):
        if s.endswith(꼬리):
            return s[: -len(꼬리)]
    return s


def 시세(symbol: str) -> "float | None":
    """이미 받아 둔 시세에서 꺼낸다. 여기서 새로 받지 않는다.

    같은 종목이 캐시에 005930 으로도 005930.KS 로도 들어 있다. 어느
    경로로 들어왔는지에 따라 다르므로 둘 다 본다."""
    from app.core.cache import cache

    후보 = [symbol, _정규(symbol)]
    민 = _정규(symbol)
    if 민.isdigit():
        후보 += [f"{민}.KS", f"{민}.KQ"]
    for k in 후보:
        if not k:
            continue
        p = cache.get(f"price:{k}") or cache.get_stale(f"price:{k}")
        v = (p or {}).get("price")
        try:
            if v:
                return float(v)
        except (TypeError, ValueError):
            pass
    return None


def 합계내기(items, 환율: float) -> dict:
    """보유 목록 하나를 원화 합계로 접는다. 화면과 같은 규칙.

    돌려주는 것:
      value  원화 평가금액
      cost   원화 매입금액
      filled 시세를 실제로 구한 종목 수
      priced 시세가 있어야 하는 종목 수(현금 등 제외)
    """
    value = cost = 0.0
    filled = priced = 0

    for it in items or []:
        수량 = float(getattr(it, "shares", 0) or 0)
        평단 = float(getattr(it, "avg_price", 0) or 0)
        시장 = getattr(it, "market", "") or ""
        통화 = getattr(it, "currency", None) or ("KRW" if 시장 == "KR" else "USD")
        입력환율 = getattr(it, "input_exchange_rate", None)
        유형 = getattr(it, "asset_class", None)

        """평단가를 원화로 넣었으면 환율을 다시 곱하지 않는다.
        해외 종목이라도 '원화로 얼마에 샀다' 로 넣을 수 있어서,
        시장이 아니라 통화를 봐야 한다."""
        비율 = (float(입력환율) if 입력환율 else 환율) if 통화 == "USD" else 1.0
        매입 = 평단 * 비율 * 수량
        cost += 매입

        달러종목 = 시장 in ("US", "ETF")
        지금 = None if 유형 in 시세없는유형 else 시세(getattr(it, "symbol", ""))
        if 유형 not in 시세없는유형:
            priced += 1

        if 지금 is None:
            # 못 구했으면 매입금액 그대로. 현지가 자리에 평단가를 넣으면
            # 원화로 넣은 해외 종목이 환율만큼 부풀어 오른다
            value += 매입
        else:
            filled += 1
            value += 지금 * 환율 * 수량 if 달러종목 else 지금 * 수량

    return {"value": value, "cost": cost, "filled": filled, "priced": priced}


def _환율() -> float:
    """이미 받아 둔 원/달러. 여기서 새로 받지 않는다."""
    try:
        from app.core.cache import cache
        r = cache.get("extra:usdkrw") or cache.get_stale("extra:usdkrw") or {}
        v = float(r.get("value") or 0)
        return v if v > 0 else 0.0
    except Exception:
        return 0.0


def 오늘() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


def 찍기() -> int:
    """오늘 치가 없는 사람의 자산을 한 줄씩 남긴다. 남긴 수를 돌려준다.

    스케줄러에서 부른다. 어떤 예외도 밖으로 안 내보낸다 — 이 일이
    주기 갱신 전체를 멈춰 세우면 고치려던 것보다 나쁘다."""
    try:
        from app.db.database import SessionLocal
        from app.models.stock import PortfolioItem, PortfolioSnapshot
    except Exception as e:
        log.debug("자산 기록 건너뜀: %s", type(e).__name__)
        return 0

    환율 = _환율()
    if 환율 <= 0:
        # 환율이 없으면 해외 종목이 통째로 0 이 된다. 그런 값을
        # 그래프에 남기면 '그날 반토막 났다' 로 보인다
        log.debug("자산 기록 건너뜀: 환율 없음")
        return 0

    날 = 오늘()
    db = SessionLocal()
    적은수 = 0
    try:
        """오늘 이미 적은 사람은 아예 안 꺼낸다.

        보유 종목이 있는 사람을 먼저 추리고, 그중 오늘 치가 있는
        사람을 뺀다. 사람이 늘어도 훑는 양이 '오늘 아직 안 적은 사람'
        만큼만 늘어난다."""
        가진사람 = {uid for (uid,) in db.query(PortfolioItem.user_id).distinct().all()}
        if not 가진사람:
            return 0
        적힌사람 = {uid for (uid,) in db.query(PortfolioSnapshot.user_id)
                    .filter(PortfolioSnapshot.day == 날).all()}
        할사람 = sorted(가진사람 - 적힌사람)[:한회차_최대]
        if not 할사람:
            return 0

        items = (db.query(PortfolioItem)
                 .filter(PortfolioItem.user_id.in_(할사람)).all())
        묶음: dict[int, list] = {}
        for it in items:
            묶음.setdefault(it.user_id, []).append(it)

        for uid, 내것 in 묶음.items():
            합 = 합계내기(내것, 환율)
            if 합["priced"] > 0 and 합["filled"] == 0:
                """시세를 하나도 못 구한 날은 안 적는다.

                매입금액을 그대로 적으면 '그날 자산이 원금과 같았다' 는
                거짓말이 그래프에 남는다. 빈 날은 비워 두는 편이 낫다 —
                다음 회차(15분 뒤)에 시세가 들어오면 그때 적힌다."""
                continue
            db.add(PortfolioSnapshot(
                user_id=uid, day=날,
                total_value=round(합["value"], 2),
                total_cost=round(합["cost"], 2),
                filled=합["filled"], priced=합["priced"],
            ))
            적은수 += 1

        if 적은수:
            db.commit()
            log.info("자산 기록 %d명 (%s)", 적은수, 날)
        return 적은수
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            pass
        log.warning("자산 기록 실패: %s", type(e).__name__)
        try:
            from app.core import errors
            errors.남기기("자산 기록", e)
        except Exception:
            pass
        return 0
    finally:
        try:
            db.close()
        except Exception:
            pass
