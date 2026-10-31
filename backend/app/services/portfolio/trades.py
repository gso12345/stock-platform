"""사고판 기록 — 실현 손익과 해외주식 양도소득세 어림.

평단은 **이동평균**으로 잡는다. 이 앱의 보유가 이미 '수량 × 평단' 한 줄이라, 더 사면 평단이 섞이고
팔면 그 평단으로 이익을 센다 — 증권사 앱의 잔고 화면과 같은 방식이다.

해외주식 양도소득세(한국 거주자)
  · 한 해(1~12월)에 판 해외주식의 이익과 손실을 모두 더한다(손익통산)
  · 기본공제 250만원을 빼고, 남은 것의 22%(양도소득세 20% + 지방소득세 2%)
  · 국내 주식(소액주주)은 비과세, 국내에 상장한 해외 ETF 는 양도세가 아니라 배당소득세라 뺀다
실제 신고는 증권사가 주는 양도소득 자료(취득가는 원칙상 먼저 산 것부터 — 선입선출)로 한다. 여기 숫자는
그해 팔지 말지를 가늠하는 **어림값**이다 — 화면도 그렇게 말한다.
"""
from __future__ import annotations

import re

#: 해외주식 양도소득 기본공제(한 사람·한 해)
기본공제 = 2_500_000
#: 양도소득세 20% + 지방소득세 2%
세율 = 0.22
#: 0 으로 볼 수량 — 소수 주식(0.0001주)이 부동소수 오차로 남는 것을 막는다
남음_기준 = 1e-9

_국내코드 = re.compile(r"^[0-9][0-9A-Z]{5}(\.K[SQ])?$")


def 해외인가(symbol: str, market: str) -> bool:
    """양도세를 내는 해외주식인가 — 미국 주식, 미국에 상장한 ETF. 국내 상장 ETF(069500 등)는 아니다"""
    if market == "US":
        return True
    return market == "ETF" and not _국내코드.match((symbol or "").upper())


def _환율(currency: str, fx: "float | None") -> float:
    return float(fx) if currency == "USD" and fx else 1.0


def 매도(보유수: float, 평단: float, 매수환율: "float | None", currency: str,
        수량: float, 가격: float, 환율: "float | None", 수수료: float = 0.0) -> dict:
    """판 값 — {avg_cost, avg_fx, realized(원), 남은수}.

    달러 종목은 원화로 바꿔 센다 — 판 날 환율로 받은 돈에서, 산 때 환율로 낸 돈을 뺀다(환차익도 양도차익에
    든다). 산 때 환율을 모르면 판 날 환율로 본다(환차익은 0 으로)."""
    if 수량 <= 0:
        raise ValueError("판 수량은 0보다 커야 해요")
    if 수량 > 보유수 + 남음_기준:
        raise ValueError("가진 것보다 많이 팔 수 없어요")
    판환율 = _환율(currency, 환율)
    산환율 = _환율(currency, 매수환율) if currency == "USD" and 매수환율 else 판환율
    실현 = 수량 * 가격 * 판환율 - 수량 * 평단 * 산환율 - (수수료 or 0) * 판환율
    남은수 = max(0.0, 보유수 - 수량)
    return {"avg_cost": 평단, "avg_fx": 산환율 if currency == "USD" else None,
            "realized": round(실현, 2), "남은수": 0.0 if 남은수 <= 남음_기준 else 남은수}


def 매수(보유수: float, 평단: float, 매수환율: "float | None", currency: str,
        수량: float, 가격: float, 환율: "float | None", 수수료: float = 0.0) -> dict:
    """더 산 뒤의 보유 — {shares, avg_price, input_exchange_rate}.

    평단은 수수료까지 넣어 섞는다(취득가에 드는 비용이다). 달러 종목의 매수 환율은 **들인 돈으로 가중한**
    평균이다 — 원화로 들인 돈(수량 × 평단 × 환율)의 합이 그대로 남게."""
    if 수량 <= 0:
        raise ValueError("산 수량은 0보다 커야 해요")
    새수 = 보유수 + 수량
    들인돈 = 보유수 * 평단 + 수량 * 가격 + (수수료 or 0)
    새평단 = 들인돈 / 새수
    새환율 = None
    if currency == "USD":
        이번환율 = _환율(currency, 환율)
        전환율 = float(매수환율) if 매수환율 else 이번환율
        원화 = 보유수 * 평단 * 전환율 + (수량 * 가격 + (수수료 or 0)) * 이번환율
        새환율 = round(원화 / 들인돈, 4) if 들인돈 > 0 else 이번환율
    return {"shares": 새수, "avg_price": 새평단, "input_exchange_rate": 새환율}


def 한해_요약(판것들: list[dict]) -> dict:
    """그해 판 줄들(dict: symbol, market, realized) → 실현 손익과 해외주식 양도세 어림.

    {"realized": 전체, "domestic": 국내, "overseas": 해외, "deduction": 공제, "taxable": 과세표준,
     "tax": 세액, "rate": 세율}. 해외 손익이 마이너스면 세금은 0 — 손실은 다음 해로 넘어가지 않는다."""
    국내 = sum(r.get("realized") or 0 for r in 판것들 if not 해외인가(r["symbol"], r["market"]))
    해외 = sum(r.get("realized") or 0 for r in 판것들 if 해외인가(r["symbol"], r["market"]))
    과세표준 = max(0.0, 해외 - 기본공제)
    return {"realized": round(국내 + 해외), "domestic": round(국내), "overseas": round(해외),
            "deduction": 기본공제, "taxable": round(과세표준), "tax": round(과세표준 * 세율), "rate": 세율}
