/**
 * 시세 배열 취급 유틸.
 *
 * WebSocket(/ws/prices)은 심볼을 정렬해 구독하고 서버는 최대 50종목만 스트리밍하므로,
 * 응답 배열의 순서·길이가 요청한 보유종목 목록과 일치한다고 가정하면 안 된다.
 * (인덱스로 짝지으면 종목별 가격이 뒤바뀌거나 스트리밍 대상 밖 종목의 가격이 사라진다)
 *
 * 다만 응답 항목의 symbol이 "요청한 심볼과 항상 같지는 않다".
 * 국내 종목은 캐시 경로에 따라 접미사가 붙은 채(005930.KS) 또는 없이(005930) 돌아오므로,
 * 접미사를 흡수한 정규화 키를 함께 색인해 두고 조회 시 폴백한다.
 */

import type { 시세행 } from "@/types";

/** 국내 종목 접미사(.KS/.KQ)를 제거한 비교용 키 */
export function normalizeSymbol(sym: string): string {
  return sym.replace(/\.(KS|KQ)$/i, "").toUpperCase();
}

/** 종목별로 WebSocket 값을 우선하되, WS가 다루지 못한 종목은 HTTP 조회값으로 채운다 */
export function mergeEffectivePrices(
  wsPrices: 시세행[] | null | undefined,
  batchPrices: 시세행[] | null | undefined,
): 시세행[] | null | undefined {
  if (!wsPrices)    return batchPrices;
  if (!batchPrices) return wsPrices;
  const bySymbol: Record<string, 시세행> = {};
  batchPrices.forEach((d) => { if (d?.symbol) bySymbol[d.symbol] = d; });
  wsPrices.forEach((d) => { if (d?.symbol && d.price != null) bySymbol[d.symbol] = d; });
  return Object.values(bySymbol);
}

/** 심볼 → 시세 객체 색인 (원본 심볼 + 접미사 제거 키를 함께 담는다) */
export function indexPricesBySymbol(
  prices: 시세행[] | null | undefined,
): Record<string, 시세행> {
  const map: Record<string, 시세행> = {};
  const put = (key: string, d: 시세행) => {
    const cur = map[key];
    // 가격이 있는 항목을 우선 — 값 없는 응답이 유효한 값을 가리지 않도록
    if (!cur || (cur.price == null && d.price != null)) map[key] = d;
  };
  prices?.forEach((d) => {
    if (!d?.symbol) return;
    put(d.symbol, d);
    put(normalizeSymbol(d.symbol), d);
  });
  return map;
}

/** 색인에서 시세 조회 — 요청 심볼과 응답 심볼의 접미사가 달라도 찾아낸다 */
export function lookupPrice(
  index: Record<string, 시세행>, symbol: string,
): 시세행 | undefined {
  if (!symbol) return undefined;
  return index[symbol] ?? index[normalizeSymbol(symbol)];
}
