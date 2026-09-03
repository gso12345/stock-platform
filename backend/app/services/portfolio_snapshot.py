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


def _고쳐쓸까(있던것, 값: dict) -> bool:
    """이미 적힌 줄을 새 값으로 고쳐 쓸까.

    두 가지를 같이 지켜야 한다.

      1) **덜 채워진 값으로 되돌아가지 않는다.** 장중에 잠깐 캐시가
         비면 filled 가 줄어드는데, 그때 덮어쓰면 온전하던 줄이
         반쪽이 된다(그 하루가 17.9% 아래로 찍혔던 적이 있다).

      2) **더 채워졌거나 값이 달라졌으면 고쳐 쓴다.** 예전에는 (1) 만
         보느라, 시세가 다 채워진 첫 회차 값이 그날 값으로 굳었다 —
         새벽 00:15 값이 그날 종가 노릇을 했다.

    값이 똑같으면 안 쓴다. 15분마다 도는 일이라, 안 바뀐 줄에까지
    쓰기를 내보내면 그 자체가 부담이다.
    """
    옛채움 = 있던것.filled or 0
    새채움 = 값["filled"]
    if 새채움 < 옛채움:
        return False                     # (1) 덜 채워진 것으로 안 돌아간다
    if 새채움 > 옛채움:
        return True                      # 더 채워졌다
    # 같은 만큼 채워졌다 — 값이 달라졌을 때만
    return round(값["value"], 2) != round(있던것.total_value or 0, 2) \
        or round(값["cost"], 2) != round(있던것.total_cost or 0, 2)


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
    #: 포트폴리오 줄이 걸려 전체 줄만 남긴 사람 수. 0 이 아니면 DB 의
    #  옛 유니크 제약이 안 지워졌다는 뜻이다 — 눈에 보이게 남긴다
    쪼갠사람 = 0
    try:
        """오늘 것이 **다 채워진** 사람은 아예 안 꺼낸다.

        보유 종목이 있는 사람을 먼저 추리고, 그중 오늘 치가 이미
        온전한 사람을 뺀다. 사람이 늘어도 훑는 양이 '오늘 아직 덜 적힌
        사람' 만큼만 늘어난다.

        ── '있으면 끝' 이 아니라 '다 채워졌으면 끝' 인 이유 ──

        예전에는 오늘 줄이 하나라도 있으면 그 사람은 끝난 것으로 봤다.
        그런데 합계내기() 는 시세를 못 구한 종목을 **매입금액으로**
        세운다. 그래서 시세가 덜 들어온 이른 회차에 한 번 적히면,
        반쪽짜리 값이 그날 내내 얼어붙었다.

        실제로 재 봤다 — 두 종목 중 하나만 시세가 있으면 그날 점이
        280만원 대신 230만원으로, **17.9% 아래로** 찍힌다. 그래프에는
        그 하루만 뚝 떨어졌다 이튿날 되돌아오는 톱니로 남는다. 자산이
        그렇게 움직인 적은 없는데도.

        filled < priced 인 줄은 '아직 덜 됐다' 로 두고, 다음 회차
        (15분 뒤)에 더 채워졌으면 그 줄을 고쳐 쓴다."""
        가진사람 = {uid for (uid,) in db.query(PortfolioItem.user_id).distinct().all()}
        if not 가진사람:
            return 0
        """**하루 종일 다시 본다.** 첫 회차 값으로 굳히지 않는다.

        여기가 '자산 흐름 수치가 정확하지 않다' 의 원인이었다.

        예전에는 시세가 다 채워진 사람을 그날 회차에서 아예 뺐다.
        그래서 스케줄러가 새벽 00:15 에 처음 도는 순간의 값이 **그날
        값으로 굳었다.** 한국 장은 아직 열리지도 않은 시각이다. 어제
        점은 어제 새벽 값, 그제 점은 그제 새벽 값 — 점마다 하루 중
        시각이 제각각이라, 그래프의 일간 변동이 실제 움직임과 아무
        관계가 없었다.

        이제 매 회차 다시 계산해서 **그날 마지막으로 본 값**을 남긴다.
        계산은 이미 받아 둔 시세 캐시만 읽으므로 값이 거의 안 든다.
        DB 쓰기는 값이 실제로 달라졌을 때만 한다(_담기 안에서).

        '그날 종가' 는 아니고 '그날 마지막으로 본 값' 이다. 24시간 도는
        스케줄러에서는 자정 직전 값이라 한국 종목은 종가가 확정된 뒤다.
        완벽하진 않지만, 새벽 값으로 굳는 것보다는 훨씬 가깝다."""
        할사람 = sorted(가진사람)[:한회차_최대]
        if not 할사람:
            return 0

        #: 오늘 이미 적힌 줄 — (사람, 포트폴리오) 로 찾는다. 더 잘
        #  채워졌을 때만 고쳐 쓴다
        오늘것 = {(r.user_id, r.portfolio_id): r
                  for r in db.query(PortfolioSnapshot)
                             .filter(PortfolioSnapshot.day == 날,
                                     PortfolioSnapshot.user_id.in_(할사람)).all()}

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

            """전체 한 줄 + 포트폴리오마다 한 줄.

            예전에는 사람마다 하루 한 줄이었다. 그래서 '연금 계좌만
            어떻게 움직였나' 를 물어볼 수가 없었다 — 포트폴리오를 나눠
            쓰는 사람에게는 그게 자산 흐름을 보는 이유의 절반이다.

            전체 줄(portfolio_id=0)은 그대로 둔다. 포트폴리오별 줄을
            더해서 만드는 게 아니라 따로 낸다 — 포트폴리오에 안 속한
            종목(옛 자료)이 있으면 합이 안 맞는다."""
            줄들 = [(0, 합)]
            나눠: dict[int, list] = {}
            for it in 내것:
                # 옛 자료에는 포트폴리오가 안 붙어 있을 수 있다.
                # 그런 종목은 전체 줄에만 들어가고 포트폴리오별 줄에는 안 든다
                pid = getattr(it, "portfolio_id", None)
                if pid:
                    나눠.setdefault(pid, []).append(it)
            for pid, 그것들 in 나눠.items():
                쪽 = 합계내기(그것들, 환율)
                if 쪽["priced"] > 0 and 쪽["filled"] == 0:
                    continue                 # 위와 같은 이유
                줄들.append((pid, 쪽))

            def _담기(넣을것) -> bool:
                """한 사람 몫을 **따로 담는다**(SAVEPOINT).

                예전에는 사람 전부를 한 번에 commit 했다. 그래서 줄
                하나가 걸리면 그 회차 전체가 뒤집혔다 — 실제로 그
                사고가 났다(아래 참조).
                """
                바뀜 = False
                자리 = db.begin_nested()
                try:
                    for pid, 값 in 넣을것:
                        있던것 = 오늘것.get((uid, pid))
                        if 있던것 is None:
                            db.add(PortfolioSnapshot(
                                user_id=uid, portfolio_id=pid, day=날,
                                total_value=round(값["value"], 2),
                                total_cost=round(값["cost"], 2),
                                filled=값["filled"], priced=값["priced"],
                            ))
                            바뀜 = True
                        elif _고쳐쓸까(있던것, 값):
                            있던것.total_value = round(값["value"], 2)
                            있던것.total_cost = round(값["cost"], 2)
                            있던것.filled = 값["filled"]
                            있던것.priced = 값["priced"]
                            바뀜 = True
                    자리.commit()
                    return 바뀜
                except Exception as e:
                    자리.rollback()
                    log.debug("자산 기록 한 사람 실패 uid=%s: %s", uid, type(e).__name__)
                    return False

            고쳤나 = _담기(줄들)
            if not 고쳤나 and len(줄들) > 1:
                """포트폴리오 줄이 걸리면 **전체 줄만이라도** 남긴다.

                실제로 난 사고다. 스냅샷을 '하루 한 줄' 에서
                '포트폴리오마다 한 줄' 로 넓히면서 옛 유니크 제약
                (user_id, day)을 지우는 SQL 을 배포에 넣었는데, 그게
                실패해도 아무 소리가 안 났다. 그 뒤로는 포트폴리오 줄이
                옛 제약에 걸려 IntegrityError 가 나고, 한 번에 commit
                하던 탓에 **전체 줄까지 같이 날아갔다** — 자산 흐름
                그래프가 배포한 날에서 그냥 멈춰 섰다.

                제약을 못 지운 DB 에서도 전체 줄은 (user_id, day) 한
                벌이라 반드시 들어간다. 포트폴리오별 그래프는 못 그려도
                전체 그래프는 이어지는 것이, 둘 다 잃는 것보다 낫다."""
                고쳤나 = _담기(줄들[:1])
                if 고쳤나:
                    쪼갠사람 += 1
            if 고쳤나:
                적은수 += 1

        if 적은수:
            db.commit()
            log.info("자산 기록 %d명 (%s)", 적은수, 날)
        if 쪼갠사람:
            """조용히 넘어가지 않는다.

            이 수가 0 이 아니면 DB 에 옛 제약이 남아 있다는 뜻이다.
            전체 그래프는 살렸지만 포트폴리오별 그래프는 못 쌓고 있다."""
            log.warning(
                "자산 기록: %d명은 전체 줄만 남겼습니다. "
                "portfolio_snapshots 의 옛 유니크 제약(user_id, day)이 "
                "안 지워졌을 수 있습니다", 쪼갠사람)
            try:
                from app.core import errors
                errors.남기기("자산 기록 제약",
                              RuntimeError(f"{쪼갠사람}명 전체 줄만 기록"))
            except Exception:
                pass
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


# ── 빈 날 메우기 ────────────────────────────────────────────
#
# "앱을 안 연 날도 기록하게 해 줘" 를 받고 코드를 다시 봤다. 찍기() 는
# 앱을 여는 것과 아무 상관이 없다 — 스케줄러가 15분마다 보유 종목이
# 있는 **모든** 사람을 돈다. 그런데도 그래프에 구멍이 생긴다.
#
# 이유는 서버가 자기 때문이다. Render 무료 인스턴스는 아무도 안 들어오면
# 잠들고, 자는 동안에는 스케줄러도 안 돈다. 하루 종일 아무도 안 들어온
# 날은 그날 줄이 통째로 없다. 사용자 눈에는 '내가 앱을 안 연 날' 과
# 정확히 겹쳐 보인다 — 그래서 그렇게 읽으신 거고, 맞는 관찰이다.
#
# ── 어떻게 메우나 ──
#
# 값을 **지어내지 않는다.** 그날의 실제 종가를 받아서 다시 계산한다.
# 주말·공휴일처럼 장이 안 선 날은 직전 거래일 종가를 쓴다 — 그날
# 자산이 실제로 안 움직였으니 그게 맞는 값이다.
#
# ── 수준은 기록에서, 모양은 시세에서 ──
#
# 문제는 **그날 무엇을 갖고 있었는지** 를 우리가 모른다는 것이다.
# 지금 보유 목록밖에 없고, 판 종목은 아예 남아 있지 않다.
#
# 처음에는 지금 목록으로 그날 금액을 통째로 계산했다. 그게 틀렸다 —
# 그 뒤에 종목을 더 담은 사람은 메운 구간만 통째로 위로 뜬다. 실제로
# '메워졌는데 값이 이상하다' 로 나왔다. 앞뒤 원금이 같은지 보는 검사를
# 두긴 했는데, 그건 **기둥끼리만** 비교하는 것이라 창 바깥에서 산 것을
# 못 잡는다(모든 기둥이 똑같이 옛 원금이므로 검사는 그냥 통과한다).
#
# 그래서 나눈다.
#
#   수준(얼마인가)  ← 앞 기둥의 **실제 기록값**
#   모양(며칠 사이 몇 % 움직였나) ← 그날들의 **실제 종가**
#
#   메운값(d) = 앞기둥값 × 모형(d) / 모형(앞기둥날)
#
# 나누기에서 보유량이 약분된다. 그래서 지금 목록이 그날 목록과 달라도
# 수준은 안 틀린다 — 종목 구성이 크게 안 바뀌었다면 등락 모양만 빌려
# 오는 셈이다. 메운 첫 값은 앞 기둥과 정확히 이어진다.
#
# ── 그래도 안 메우는 경우 ──
#
# 앞 기둥에 붙여 늘였을 때 **뒤 기둥에 닿는지** 본다. 그 사이에 사거나
# 팔았으면 실제 기록이 계단처럼 뛰므로 안 닿는다. 3% 넘게 어긋나면
# 그 구멍은 그대로 둔다 — 언제 무엇을 샀는지 알 수 없다.
#
# 이 검사가 옛 원금 비교보다 곧다. 원금은 환율 때문에 매매가 없어도
# 매일 조금씩 달라져서 애먼 구간을 걸렀고, 정작 잡아야 할 것은 놓쳤다.
#
# 원금(매입금액)은 그 사이 내내 앞 기둥의 값을 그대로 쓴다. 매매가
# 없었다는 것을 위에서 확인했으니 안 바뀌는 게 맞다.
#
# purchase_date 가 그날 이후인 종목은 모형에서 뺀다. 적어 둔 사람에게는
# 모양까지 정확해진다.

#: 이보다 오래된 구멍은 안 건드린다. 오래될수록 '그날 무엇을 갖고
#  있었나' 를 어림하는 것이 위험해진다
메울수있는_과거일 = 120

#: 한 회차에 한 사람이 메울 날 수 상한. 남은 것은 다음 회차에 메운다
한사람_최대날 = 40

#: 한 회차에 볼 사람 수. 0.15 CPU 서버에서 한 번에 몰아 하지 않는다
메우기_한회차_최대 = 50

#: 앞 기둥에 붙여 늘인 것이 뒤 기둥에 이만큼 안에서 닿아야 메운다.
#  넘으면 그 사이에 사거나 판 것이다 — 그 구멍은 그대로 둔다.
맞물림_허용오차 = 0.03


def _봉표(symbol: str, market: str) -> "tuple[list, list] | None":
    """종목의 일봉을 (날짜들, 종가들) 로. 이미 받아 둔 것이 있으면 그대로.

    yf_service.get_ohlcv 가 캐시를 먼저 본다. 같은 종목을 여러 사람이
    갖고 있어도 조회는 한 번이다."""
    try:
        from app.services.yf_service import yf_service
        봉들 = yf_service.get_ohlcv(symbol, "1y", "1d", market or "US")
    except Exception as e:
        log.debug("일봉 조회 실패 %s: %s", symbol, type(e).__name__)
        return None
    쌍 = sorted(
        (str(b.get("date"))[:10], float(b["close"]))
        for b in (봉들 or []) if b.get("close")
    )
    if not 쌍:
        return None
    return [d for d, _ in 쌍], [c for _, c in 쌍]


def 그날이전종가(표: "tuple[list, list] | None", 날: str) -> "float | None":
    """그날(포함) 이전의 마지막 종가.

    주말·공휴일에는 장이 안 섰으니 값이 없다. 그때 비워 두면 그날
    자산이 0 이 되고, 직전 종가를 쓰면 '안 움직였다' 가 된다 — 실제로
    안 움직였다. 뒤엣것이 맞다."""
    if not 표:
        return None
    import bisect
    날짜들, 종가들 = 표
    i = bisect.bisect_right(날짜들, 날)
    return 종가들[i - 1] if i > 0 else None


def _과거환율표() -> "tuple[list, list] | None":
    """원/달러 일봉. 해외 종목을 원화로 바꾸는 데 쓴다.

    오늘 환율로 반년 전을 계산하면 그날 값이 아니다. 환율이 10%
    움직인 해에는 그 차이가 그대로 그래프에 남는다."""
    return _봉표("KRW=X", "US")


def 과거합계(items, 날: str, 환율: float, 봉표들: dict) -> "dict | None":
    """그날의 원화 합계. 합계내기() 와 **같은 규칙**을 쓴다.

    다른 것은 시세를 어디서 가져오느냐뿐이다 — 여기서는 그날의 종가다.
    규칙을 두 벌로 두면 언젠가 한쪽만 고쳐져서, 메운 날과 찍은 날이
    서로 다른 계산으로 나온 값이 된다.

    시세를 하나도 못 구하면 None. 매입금액을 그대로 적으면 '그날
    자산이 원금과 같았다' 는 거짓말이 남는다 — 찍기() 와 같은 판단이다.
    """
    value = cost = 0.0
    filled = priced = 0

    for it in items or []:
        산날 = getattr(it, "purchase_date", None)
        if 산날 and str(산날)[:10] > 날:
            continue                      # 그날엔 아직 안 산 종목이다

        수량 = float(getattr(it, "shares", 0) or 0)
        평단 = float(getattr(it, "avg_price", 0) or 0)
        시장 = getattr(it, "market", "") or ""
        통화 = getattr(it, "currency", None) or ("KRW" if 시장 == "KR" else "USD")
        입력환율 = getattr(it, "input_exchange_rate", None)
        유형 = getattr(it, "asset_class", None)

        비율 = (float(입력환율) if 입력환율 else 환율) if 통화 == "USD" else 1.0
        매입 = 평단 * 비율 * 수량
        cost += 매입

        달러종목 = 시장 in ("US", "ETF")
        지금 = None
        if 유형 not in 시세없는유형:
            priced += 1
            지금 = 그날이전종가(봉표들.get(getattr(it, "symbol", "")), 날)

        if 지금 is None:
            value += 매입
        else:
            filled += 1
            value += 지금 * 환율 * 수량 if 달러종목 else 지금 * 수량

    if priced > 0 and filled == 0:
        return None
    return {"value": value, "cost": cost, "filled": filled, "priced": priced}


def 빈날찾기(있는날: "set[str]", 앞: str, 뒤: str) -> "list[str]":
    """앞과 뒤 **사이**의 빈 날들. 양 끝은 안 넣는다."""
    from datetime import date as _date

    def 파싱(s: str) -> _date:
        y, m, d = (int(x) for x in s.split("-"))
        return _date(y, m, d)

    나온것 = []
    하루 = 파싱(앞) + timedelta(days=1)
    끝 = 파싱(뒤)
    while 하루 < 끝:
        s = 하루.strftime("%Y-%m-%d")
        if s not in 있는날:
            나온것.append(s)
        하루 += timedelta(days=1)
    return 나온것


def 늘인값(앞기둥값: float, 앞모형: float, 그날모형: float) -> "float | None":
    """앞 기둥의 기록값을 그날까지 시세만큼 늘인다.

    나누기에서 보유량이 약분된다 — 지금 목록이 그날 목록과 달라도
    수준이 안 틀리는 이유가 이것이다. 빌려 오는 것은 등락 모양뿐이다."""
    if not (앞기둥값 > 0 and 앞모형 > 0 and 그날모형 > 0):
        return None
    return 앞기둥값 * 그날모형 / 앞모형


def 맞물리나(앞기둥값: float, 앞모형: "float | None",
           뒤기둥값: "float | None", 뒤모형: "float | None") -> bool:
    """앞 기둥에 붙여 늘였을 때 뒤 기둥에 닿는가.

    그 사이에 사거나 팔았으면 실제 기록이 계단처럼 뛰므로 안 닿는다.
    그때는 언제 무엇을 샀는지 알 수 없으니 메우지 않는다.

    옛 판(앞뒤 원금이 같은가)보다 곧다. 원금은 환율 때문에 매매가
    없어도 매일 조금씩 달라져서 애먼 구간을 걸렀고, 정작 잡아야 할
    '창 바깥에서 산 것' 은 못 잡았다 — 기둥끼리는 똑같이 옛 원금이라
    검사가 그냥 통과했다."""
    if 앞모형 is None or 뒤모형 is None or 뒤기둥값 is None:
        return False
    예측 = 늘인값(앞기둥값, 앞모형, 뒤모형)
    if 예측 is None or not (뒤기둥값 > 0):
        return False
    return abs(예측 - 뒤기둥값) / 뒤기둥값 <= 맞물림_허용오차


def _내가_메운것(r) -> bool:
    """이 줄이 나중에 메운 것인가 — 실제로 그날 찍힌 것이 아니라.

    메운 줄은 **기둥으로 안 쓴다.** 규칙이 바뀌면 다시 계산해야 하는데,
    메운 줄이 다음 메우기의 기준이 되면 옛 규칙으로 낸 값이 그대로
    굳는다. 실제로 한 번 굳었다 — 지금 보유 목록으로 과거 금액을 통째로
    계산하던 판이 남아, 그 뒤에 종목을 더 담은 사람의 그래프가 그 구간만
    위로 떠 있었다.

    backfilled 열이 생기기 전에 메운 줄은 그 값이 0 이다. 그건 made_at
    으로 가려낸다 — 찍기() 는 **그날 그날** 적으므로 day 와 made_at 의
    한국 날짜가 반드시 같다. 다르면 나중에 넣은 줄이다."""
    if getattr(r, "backfilled", 0):
        return True
    적힌때 = getattr(r, "made_at", None)
    if 적힌때 is None:
        return False                     # 알 수 없으면 실제 기록으로 둔다
    try:
        때 = 적힌때 if 적힌때.tzinfo else 적힌때.replace(tzinfo=timezone.utc)
        return r.day != 때.astimezone(KST).strftime("%Y-%m-%d")
    except Exception:
        return False


def 메우기() -> int:
    """빈 날을 실제 종가로 메운다. 메운 줄 수를 돌려준다.

    스케줄러에서 하루 한 번 부른다. 15분마다 도는 찍기() 와 달리 여기는
    **바깥에서 값을 받아 온다** — 자주 돌 일이 아니다.

    어떤 예외도 밖으로 안 내보낸다 — 이 일이 주기 갱신 전체를 멈춰
    세우면 고치려던 것보다 나쁘다.
    """
    try:
        from app.db.database import SessionLocal
        from app.models.stock import PortfolioItem, PortfolioSnapshot
    except Exception as e:
        log.debug("빈 날 메우기 건너뜀: %s", type(e).__name__)
        return 0

    db = None
    메운수 = 0
    try:
        """환율표를 여기 안에서 받는다.

        try 밖에 두면 야후가 막힌 환경에서 이 함수가 예외를 밖으로
        던진다 — 스케줄러 루프가 그걸 맞으면 그 회차의 뒤 작업이
        통째로 안 돈다. '어떤 예외도 안 내보낸다' 가 이 함수의 계약이다."""
        환율표 = _과거환율표()
        db = SessionLocal()
        부터 = (datetime.now(KST) - timedelta(days=메울수있는_과거일)).strftime("%Y-%m-%d")
        가진사람 = sorted({uid for (uid,) in db.query(PortfolioItem.user_id).distinct().all()})
        if not 가진사람:
            return 0
        할사람 = 가진사람[:메우기_한회차_최대]

        items = db.query(PortfolioItem).filter(PortfolioItem.user_id.in_(할사람)).all()
        사람별: dict = {}
        for it in items:
            사람별.setdefault(it.user_id, []).append(it)

        #: 종목당 한 번만 받는다. 같은 종목을 여럿이 갖고 있어도 한 번이다
        봉표들: dict = {}
        for it in items:
            sym = getattr(it, "symbol", "")
            if sym and sym not in 봉표들 and getattr(it, "asset_class", None) not in 시세없는유형:
                봉표들[sym] = _봉표(sym, getattr(it, "market", "") or "US")

        모든줄 = (db.query(PortfolioSnapshot)
                  .filter(PortfolioSnapshot.user_id.in_(할사람),
                          PortfolioSnapshot.day >= 부터)
                  .order_by(PortfolioSnapshot.day).all())
        칸별: dict = {}
        for r in 모든줄:
            칸별.setdefault((r.user_id, r.portfolio_id), []).append(r)

        for uid, 내것 in 사람별.items():
            """전체 줄(0)과 포트폴리오별 줄을 같은 방법으로 메운다."""
            나눔 = {0: 내것}
            for it in 내것:
                pid = getattr(it, "portfolio_id", None)
                if pid:
                    나눔.setdefault(pid, []).append(it)

            for pid, 그것들 in 나눔.items():
                """메운 줄은 지우고 다시 넣는다.

                기둥은 **실제로 그날 찍힌 줄** 만이다. 메운 줄을 기둥으로
                쓰면 옛 규칙으로 낸 값이 다음 계산의 기준이 되어 그대로
                굳는다. 지우고 다시 넣으면 규칙을 고칠 때마다 저절로
                고쳐진다 — 이미 나간 잘못된 값도 여기서 사라진다."""
                모두 = 칸별.get((uid, pid)) or []
                줄들, 지울것 = [], []
                for r in 모두:
                    (지울것 if _내가_메운것(r) else 줄들).append(r)
                for r in 지울것:
                    db.delete(r)

                if len(줄들) < 2:
                    """기둥이 하나뿐이면 메울 구간을 못 정한다.

                    한쪽만 막힌 구멍을 메우려면 '그 사이에 매매가
                    없었나' 를 확인할 방법이 없다."""
                    continue

                있는날 = {r.day for r in 줄들}
                모형쟁여둠: dict = {}

                def 모형(날: str, _것들=그것들, _쟁임=모형쟁여둠):
                    """지금 보유 목록으로 낸 그날 값 — **모양만** 쓴다.

                    이 값의 수준(얼마인가)은 안 믿는다. 지금 목록이
                    그날 목록과 다를 수 있기 때문이다. 두 날의 **비율**
                    만 쓰면 보유량이 약분돼서 그 차이가 사라진다.

                    같은 날을 여러 번 묻게 되므로(기둥으로도, 메울
                    날로도) 한 번 낸 것은 쟁여 둔다."""
                    if 날 in _쟁임:
                        return _쟁임[날]
                    환 = 그날이전종가(환율표, 날)
                    """환율을 못 구하면 해외 종목이 통째로 0 이 된다.
                    그런 값으로 비율을 내면 그날 반토막 난 것처럼
                    보인다 — 찍기() 와 같은 판단이다."""
                    답 = 과거합계(_것들, 날, 환, 봉표들) if 환 and 환 > 0 else None
                    _쟁임[날] = 답
                    return 답

                남은 = 한사람_최대날
                자리 = db.begin_nested()
                try:
                    """기둥 쌍을 훑는다. 마지막 기둥과 오늘 사이도 본다.

                    꼬리는 뒤 기둥이 없으므로 '오늘의 모형값' 을 뒤에
                    세운다. 그러면 맞물림 검사가 '지금 목록이 앞 기둥의
                    기록값을 재현하나' 가 된다 — 그 뒤에 사고팔았으면
                    안 맞고, 그때는 안 메운다."""
                    쌍들 = [(줄들[i], 줄들[i + 1].day, 줄들[i + 1].total_value)
                            for i in range(len(줄들) - 1)]
                    끝모형 = 모형(오늘())
                    if 끝모형:
                        쌍들.append((줄들[-1], 오늘(), 끝모형["value"]))

                    for 앞, 뒷날, 뒷값 in 쌍들:
                        빈날 = 빈날찾기(있는날, 앞.day, 뒷날)
                        if not 빈날 or 남은 <= 0:
                            continue
                        앞모형 = 모형(앞.day)
                        뒤모형 = 모형(뒷날)
                        if not 맞물리나(앞.total_value or 0,
                                     앞모형["value"] if 앞모형 else None,
                                     뒷값,
                                     뒤모형["value"] if 뒤모형 else None):
                            continue
                        for 날 in 빈날:
                            if 남은 <= 0:
                                break
                            그날 = 모형(날)
                            if 그날 is None:
                                continue
                            값 = 늘인값(앞.total_value or 0,
                                     앞모형["value"], 그날["value"])
                            if 값 is None:
                                continue
                            db.add(PortfolioSnapshot(
                                user_id=uid, portfolio_id=pid, day=날,
                                backfilled=1,
                                total_value=round(값, 2),
                                # 매매가 없었다는 것을 위에서 확인했다.
                                # 원금은 그 사이 내내 안 바뀌는 게 맞다
                                total_cost=round(앞.total_cost or 0, 2),
                                filled=그날["filled"], priced=그날["priced"],
                            ))
                            있는날.add(날)
                            남은 -= 1
                            메운수 += 1
                    자리.commit()
                except Exception as e:
                    자리.rollback()
                    log.debug("빈 날 메우기 실패 uid=%s pid=%s: %s",
                              uid, pid, type(e).__name__)

        """메운 줄이 하나도 안 생겨도 commit 한다.

        지운 것이 있을 수 있다 — 규칙이 바뀌어 더는 메우면 안 되는
        구간의 옛 줄이 그렇다. 안 지우면 잘못된 값이 그대로 남는다."""
        db.commit()
        if 메운수:
            log.info("빈 날 메우기 %d줄", 메운수)
        return 메운수
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            pass
        log.warning("빈 날 메우기 실패: %s", type(e).__name__)
        return 0
    finally:
        try:
            if db is not None:
                db.close()
        except Exception:
            pass
