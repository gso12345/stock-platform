/**
 * 시세 배열 취급 유틸.
 *
 * WebSocket(/ws/prices)은 심볼을 정렬해 구독하고 서버는 최대 50종목만 스트리밍하므로,
 * 응답 배열의 순서·길이가 요청한 보유종목 목록과 일치한다고 가정하면 안 된다.
 * (인덱스로 짝지으면 종목별 가격이 뒤바뀌거나 50개 초과분의 가격이 사라진다)
 */

/** 종목별로 WebSocket 값을 우선하되, WS가 다루지 못한 종목은 HTTP 조회값으로 채운다 */
export function mergeEffectivePrices(
  wsPrices: any[] | null | undefined,
  batchPrices: any[] | null | undefined,
): any[] | null | undefined {
  if (!wsPrices)    return batchPrices;
  if (!batchPrices) return wsPrices;
  const bySymbol: Record<string, any> = {};
  batchPrices.forEach((d: any) => { if (d?.symbol) bySymbol[d.symbol] = d; });
  wsPrices.forEach((d: any) => { if (d?.symbol && d.price != null) bySymbol[d.symbol] = d; });
  return Object.values(bySymbol);
}

/** 심볼 → 시세 객체 (배열 순서에 의존하지 않고 조회하기 위한 색인) */
export function indexPricesBySymbol(prices: any[] | null | undefined): Record<string, any> {
  const map: Record<string, any> = {};
  prices?.forEach((d: any) => { if (d?.symbol) map[d.symbol] = d; });
  return map;
}
