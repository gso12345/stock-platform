/**
 * 사고팔기 미리 셈 — 저장하기 전에 '팔면 얼마 남나', '더 사면 평단이 얼마가 되나' 를 보여 준다.
 *
 * 서버(backend/app/services/portfolio/trades.py)와 같은 셈이어야 한다 — 미리 본 숫자와 저장된 숫자가
 * 다르면 둘 다 못 믿는다. 평단은 이동평균, 달러 종목은 판 날 환율로 받고 산 때 환율로 낸 것을 뺀다.
 */

export interface 보유값 {
  shares: number;
  avgPrice: number;
  /** 산 때 환율(원/달러) — 달러 종목만, 모르면 비움 */
  inputExchangeRate?: number | null;
  currency: "KRW" | "USD";
}

const 환율 = (currency: string, fx?: number | null) => (currency === "USD" && fx ? fx : 1);

/** 팔면 — 실현 손익(원)과 남는 수량 */
export function 팔면(보유: 보유값, 수량: number, 가격: number, fx?: number | null, 수수료 = 0) {
  const 판환율 = 환율(보유.currency, fx);
  const 산환율 = 보유.currency === "USD" && 보유.inputExchangeRate ? 보유.inputExchangeRate : 판환율;
  const 실현 = 수량 * 가격 * 판환율 - 수량 * 보유.avgPrice * 산환율 - 수수료 * 판환율;
  const 남은수 = Math.max(0, 보유.shares - 수량);
  return { 실현: Math.round(실현 * 100) / 100, 남은수: 남은수 <= 1e-9 ? 0 : 남은수 };
}

/** 더 사면 — 새 수량·평단(수수료까지 섞는다)·매수 환율(들인 돈으로 가중) */
export function 사면(보유: 보유값, 수량: number, 가격: number, fx?: number | null, 수수료 = 0) {
  const 새수 = 보유.shares + 수량;
  const 들인돈 = 보유.shares * 보유.avgPrice + 수량 * 가격 + 수수료;
  const 새평단 = 새수 > 0 ? 들인돈 / 새수 : 0;
  let 새환율: number | null = null;
  if (보유.currency === "USD") {
    const 이번 = 환율(보유.currency, fx);
    const 전 = 보유.inputExchangeRate || 이번;
    const 원화 = 보유.shares * 보유.avgPrice * 전 + (수량 * 가격 + 수수료) * 이번;
    새환율 = 들인돈 > 0 ? Math.round((원화 / 들인돈) * 10_000) / 10_000 : 이번;
  }
  return { 새수, 새평단, 새환율 };
}

/** 양도세 어림에서 '앞으로 얼마까지 이익을 내도 세금이 없나' — 공제 남은 몫(원) */
export function 남은공제(해외손익: number, 공제: number): number {
  return Math.max(0, 공제 - Math.max(0, 해외손익));
}
