/**
 * 관심종목 목록 조회 — **한 군데서만** 정의한다 (보유 목록과 같은 이유,
 * hooks/usePortfolioItems 참고).
 *
 * `["watchlist-items"]` 를 네 곳이 각자 정의하고 있었다 — 관심종목·
 * 종목상세·퀀트, 그리고 늘 떠 있는 불러오기 위젯. react-query 는 먼저
 * 붙은 쪽의 fetcher 를 쓰므로, 한 곳만 고치면 고친 것이 실제로는 안 돈다.
 *
 * ── 무엇이 달라지나 ──
 *
 * 관심종목 화면은 목록을 받은 **뒤에야** 무엇의 시세를 물을지 알았다.
 *
 *     /watchlist/items ──▶ (답) ──▶ /watchlist/prices ──▶ (답)
 *
 * 내 자산처럼 서버가 이미 받아 둔 시세를 목록에 같이 실어 보낸다
 * (with_prices). 화면은 그걸로 먼저 그리고, 곧바로 새 시세를 다시 묻는다.
 */
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { watchlistApi } from "@/api/stocks";
import type { WatchlistItem, 시세행 } from "@/types";

export const 관심목록열쇠 = ["watchlist-items"] as const;
/** 목록에 딸려 온 시세가 담기는 자리. 화면이 첫 그림을 채울 때만 읽는다 */
export const 관심씨앗시세열쇠 = ["watchlist-seed-prices"] as const;

/**
 * 받은 것을 목록으로 푼다. 시세가 딸려 왔으면 따로 담아 둔다.
 *
 * 서버가 **배열을 그대로 주는 경우**도 받는다 — with_prices 를 모르는
 * 예전 서버, 반쯤 걸친 배포. 꾸러미만 알아보면 목록이 통째로 빈 것으로
 * 읽혀 관심종목이 하나도 없는 화면이 뜬다.
 */
export function 관심목록풀기(
  qc: Pick<QueryClient, "setQueryData">,
  받은것: { items?: unknown; prices?: unknown } | unknown[] | null | undefined,
): WatchlistItem[] {
  if (Array.isArray(받은것)) return 받은것 as WatchlistItem[];
  const 목록 = (Array.isArray(받은것?.items) ? 받은것!.items : []) as WatchlistItem[];
  const 시세 = 받은것?.prices;
  if (Array.isArray(시세) && 시세.length > 0) {
    qc.setQueryData(관심씨앗시세열쇠, 시세 as 시세행[]);
  }
  return 목록;
}

export function 관심목록설정(qc: QueryClient, 켜짐: boolean) {
  return {
    queryKey: 관심목록열쇠,
    queryFn: () => watchlistApi.getItemsWithCachedPrices().then((받은것) => 관심목록풀기(qc, 받은것)),
    enabled: 켜짐,
    staleTime: 120_000,
  };
}

/** 관심종목 목록을 받는다. 네 화면이 이걸 쓴다 */
export function use관심목록(켜짐: boolean) {
  const qc = useQueryClient();
  return useQuery<WatchlistItem[]>(관심목록설정(qc, 켜짐));
}
