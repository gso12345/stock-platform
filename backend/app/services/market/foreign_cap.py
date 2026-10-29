"""미국에 상장한 해외 회사의 시가총액 — 그 회사 나라 돈으로 온 값을 가려 달러로.

야후는 일부 해외 회사(TSMC·SK하이닉스 ADR·도쿄일렉트론 …)의 시가총액을 그 회사 장부의 돈(대만 달러·원·엔)으로
준다. 시세는 달러라, 달러로 읽으면 TSMC 가 61조 달러(엔비디아의 열두 배), SK하이닉스 ADR 이 929조 달러가 된다
(사용자: "대시보드 순위표에 SK하이닉스 TSMC 해외 시총이 달러랑 안맞아"). 그 값으로 낸 PER·PBR·PSR 도 함께
틀린다. 어느 회사가 그런지는 정해져 있지 않다 — 토요타·소니(엔)는 달러로 온다. 그래서 회사마다 값을 보고 가린다:

  후보  받은 값(달러라고 온 것) · 받은 값 × 장부 돈 환율 · 닻(주식 수 × 시세 — 나스닥 목록·국내 원주)
  흠    · 미국 회사(달러 장부) 가운데 세 번째로 큰 시가총액의 두 배를 넘는다(그런 회사는 없다)
        · 닻과 3배 넘게 다르다
        · 큰 값(500억 달러 이상)인데 매출의 60배·순이익의 500배를 넘는다, 또는 매출의 1% 도 안 된다
  흠이 가장 적은 후보 — 같으면 받은 값 → 바꾼 값 → 닻 차례(멀쩡한 값을 함부로 안 바꾼다). 고른 것도 상한을
  넘으면(환율도 닻도 몰라 바꿀 후보가 없다) 모른다 — 929조 달러를 1위에 세우느니 빈칸이 낫다

스크리닝 표(매출·순이익·환율을 안다)와 대시보드 해외 순위(나스닥 주식 수만 안다)가 같은 규칙을 쓴다.
"""
from __future__ import annotations

import math
from collections.abc import Iterable

#: 미국에 상장한 국내 회사 ADR 중 SEC 연간 공시(20-F)가 아직 없는 것 → (국내 종목, ADR 1주가 원주 몇 주인가).
#: SK하이닉스는 2026년 7월 나스닥에 상장했다(ADR 10주 = 원주 1주) — 첫 20-F 가 나오면 SEC 값이 먼저다
국내_ADR: dict[str, tuple[str, float]] = {"SKHY": ("000660", 0.1)}

#: 닻과 이 배 넘게 다르면 닻과 다른 것을 센 값이다(√10 ≈ 3.16 — 돈 단위가 틀리면 30배·1,300배씩 다르다)
닻_배 = 10 ** 0.5
#: 매출·순이익으로 가리는 것은 이만큼 큰 값만 — 매출이 거의 없는 작은 회사는 P/S 가 수백이어도 정상이다
큰값 = 5e10
PS_위, PS_아래, PER_위 = 60.0, 0.01, 500.0
#: 미국 회사 중 세 번째로 큰 시가총액의 이 배를 넘으면 달러일 수 없다(한 곳이 엉터리여도 흔들리지 않게 세 번째)
상한_배 = 2.0


def _양수(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and f > 0 else None


def 상한(미국_시총들: Iterable) -> float | None:
    """미국 회사(달러 장부) 시가총액들 → 이보다 크면 달러일 수 없는 값. 세 곳이 안 되면 모른다"""
    큰것 = sorted((v for v in map(_양수, 미국_시총들) if v is not None), reverse=True)[:3]
    return 큰것[2] * 상한_배 if len(큰것) == 3 else None


def 흠(값: float, 닻: float | None = None, 매출: float | None = None, 순이익: float | None = None,
      상한값: float | None = None) -> int:
    """시가총액 후보 하나의 흠 수(위 머리말의 셋)"""
    n = 0
    if 상한값 is not None and 값 > 상한값:
        n += 1
    if 닻 is not None and max(값 / 닻, 닻 / 값) > 닻_배:
        n += 1
    if 매출 is not None and ((값 >= 큰값 and 값 / 매출 > PS_위) or 값 / 매출 < PS_아래):
        n += 1
    if 순이익 is not None and 값 >= 큰값 and 값 / 순이익 > PER_위:
        n += 1
    return n


def 고르기(받은값, 환율=None, 닻=None, 매출=None, 순이익=None, 상한값=None) -> float | None:
    """받은값 — 달러라고 온 시가총액, 환율 — 장부 돈 1 = 달러 얼마(모르면 None), 닻 — 주식 수 × 시세(달러, 모르면
    None), 매출·순이익 — 달러(모르거나 0 이하면 None), 상한값 — 상한(). → 고른 시가총액(받은 값이 없으면 닻,
    고른 것도 상한을 넘으면 None)"""
    받은값, 환율, 닻, 매출, 순이익, 상한값 = map(_양수, (받은값, 환율, 닻, 매출, 순이익, 상한값))
    if 받은값 is None:
        return 닻
    재료 = {"매출": 매출, "순이익": 순이익, "상한값": 상한값}
    후보 = [(받은값, 닻)]                       # (값, 견줄 닻) — 닻은 자기 자신과 견주지 않는다
    if 환율 is not None and 환율 != 1.0:
        후보.append((받은값 * 환율, 닻))
    if 닻 is not None:
        후보.append((닻, None))
    점수 = [흠(값, 견줄닻, **재료) for 값, 견줄닻 in 후보]
    고른 = 후보[min(range(len(후보)), key=lambda i: (점수[i], i))][0]
    return None if 상한값 is not None and 고른 > 상한값 else 고른
