"""걸어 둔 가격 알림이 조건에 닿았는지 본다.

값이 거의 안 드는 것이 요점이다.

  · 새로 조회하지 않는다. 이미 받아 둔 price:{symbol} 캐시만 읽는다.
    시세는 주기 갱신이 계속 받아 오고 있으므로 그걸로 충분하다.
  · 켜져 있는 알림만 훑는다. 한 번 울린 것은 스스로 꺼진다.
  · 캐시에 값이 없는 종목은 그냥 넘어간다. 그 종목을 받아 오는 것은
    이 함수가 할 일이 아니다 — 다음 회차에 시세가 들어오면 그때 본다.
    받아 오는 것은 scheduler.알림종목_시세_받기 다(켜진_알림종목 을 1분마다 받는다).

울릴 때는 새 알림 파이프라인을 안 만들고 기존 notifications 표에
kind="price_alert" 로 한 줄 넣는다. 종·읽지않음·목록이 이미 다 돌아간다.
"""
import logging

log = logging.getLogger(__name__)

#: 한 회차에 볼 최대 알림 수. 사용자가 늘면 여기가 커지는데,
#: 캐시만 읽어도 수만 건이면 0.15 CPU 에 얹힌다.
한회차_최대 = 2000


def _값(symbol: str) -> "float | None":
    from app.core.cache import cache
    p = cache.get(f"price:{symbol}") or cache.get_stale(f"price:{symbol}")
    v = (p or {}).get("price")
    try:
        return float(v) if v else None
    except (TypeError, ValueError):
        return None


def _닿았나(방향: str, 목표: float, 지금: float) -> bool:
    return 지금 >= 목표 if 방향 == "above" else 지금 <= 목표


def _문구(이름: str, 방향: str, 목표: float, 지금: float, 시장: str) -> str:
    돈 = (lambda v: f"{v:,.0f}원") if 시장 == "KR" else (lambda v: f"${v:,.2f}")
    말 = "이상" if 방향 == "above" else "이하"
    return f"{이름} {돈(목표)} {말} — 지금 {돈(지금)}"


def 확인하기() -> int:
    """조건에 닿은 알림을 울린다. 울린 개수를 돌려준다.

    스케줄러에서 부른다. 어떤 예외도 밖으로 안 내보낸다 — 알림 확인이
    주기 갱신 전체를 멈춰 세우면 고치려던 것보다 나쁘다."""
    try:
        from app.db.database import SessionLocal
        from app.models.stock import PriceAlert
        from app.models.community import Notification
        from datetime import datetime, timezone
    except Exception as e:
        log.debug("알림 확인 건너뜀: %s", type(e).__name__)
        return 0

    db = SessionLocal()
    울린수 = 0
    새것들: list = []
    try:
        켜진것 = (db.query(PriceAlert)
                  .filter(PriceAlert.is_active.is_(True))
                  .limit(한회차_최대).all())
        if not 켜진것:
            return 0

        이제 = datetime.now(timezone.utc)
        for a in 켜진것:
            지금 = _값(a.symbol)
            if 지금 is None:
                continue                      # 시세가 아직 없다. 다음 회차에
            if not _닿았나(a.direction, a.target, 지금):
                continue

            울림 = Notification(
                user_id=a.user_id,
                actor_id=None,                # 사람이 한 일이 아니다
                kind="price_alert",
                symbol=a.symbol, market=a.market,
                preview=_문구(a.name or a.symbol, a.direction, a.target, 지금, a.market)[:100],
            )
            db.add(울림)
            새것들.append(울림)
            """한 번 울리면 스스로 끈다.

            8만원을 넘나드는 동안 계속 울리면 알림 화면이 그 종목 하나로
            뒤덮인다. 다시 받고 싶으면 사용자가 켠다 — 그게 '알림을 봤다'
            는 뜻이다."""
            a.is_active = False
            a.fired_at = 이제
            a.fired_price = 지금
            울린수 += 1

        if 울린수:
            db.flush()
            새id = [n.id for n in 새것들]
            db.commit()
            log.info("가격 알림 %d건 울림", 울린수)
            # 앱을 닫고 기다리는 사람에게는 휴대폰으로 — 뒤에서 보낸다(이 함수는 기다리지 않는다)
            from app.services import push_service
            push_service.알림_보내기(새id)
        return 울린수
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            pass
        log.warning("가격 알림 확인 실패: %s", type(e).__name__)
        try:
            from app.core import errors
            errors.남기기("가격 알림 확인", e)
        except Exception:
            pass
        return 0
    finally:
        try:
            db.close()
        except Exception:
            pass


def 켜진_알림종목() -> list[tuple[str, str]]:
    """켜져 있는 알림이 걸린 (종목, 시장) — 겹치지 않게.

    확인하기() 는 캐시만 읽으므로, 이 종목들의 시세는 누군가 받아 줘야 한다
    (scheduler.알림종목_시세_받기). 어떤 예외도 안 내보낸다 — 못 읽으면 빈 목록."""
    try:
        from app.db.database import SessionLocal
        from app.models.stock import PriceAlert
    except Exception as e:
        log.debug("알림 종목 읽기 건너뜀: %s", type(e).__name__)
        return []

    db = SessionLocal()
    try:
        쌍 = (db.query(PriceAlert.symbol, PriceAlert.market)
              .filter(PriceAlert.is_active.is_(True))
              .distinct()
              .limit(한회차_최대).all())
        return [(s, m) for s, m in 쌍]
    except Exception as e:
        log.debug("알림 종목 읽기 실패: %s", type(e).__name__)
        return []
    finally:
        try:
            db.close()
        except Exception:
            pass
