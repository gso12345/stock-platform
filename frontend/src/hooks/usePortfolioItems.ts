/**
 * 보유 목록 조회 — **한 군데서만** 정의한다.
 *
 * ── 왜 이 파일이 있나 ────────────────────────────────────────
 *
 * `["portfolio-items-all"]` 이라는 같은 이름표를 일곱 곳이 각자 정의하고
 * 있었다. 내 자산·관심종목·종목상세·글쓰기·마이페이지·퀀트, 그리고
 * 모든 화면에 늘 떠 있는 불러오기 위젯(LoadingProgressOverlay)이다.
 *
 * react-query 는 이름표로 묶으므로 겉보기에는 잘 돌았다. 요청도 한 번만
 * 나갔다. 그런데 **먼저 붙은 쪽의 fetcher 가 이긴다.**
 *
 * 그래서 내 자산이 시세를 목록과 같이 받도록 고쳤을 때, 그 고침이 실제
 * 앱에서는 한 번도 동작하지 않았다 — 위젯이 Layout 에 있어 늘 먼저
 * 붙고, 옛 방식으로 목록만 받아 갔기 때문이다. 검사는 통과했다.
 * 검사에서는 Layout 을 안 그리기 때문이다. 화면도 멀쩡했다. 그냥
 * 예전만큼 느렸을 뿐이다. 실제로 재현해서 확인했다 —
 *
 *     겉옷이 먼저 붙으면:  옛것 1회 · 새것 0회
 *
 * 정의가 일곱 벌이면 이런 어긋남은 반드시 또 생긴다. 한 벌로 모은다.
 *
 * ── 무엇이 달라지나 ─────────────────────────────────────────
 *
 * 이제 **어느 화면으로 들어오든** 보유 목록과 함께 이미 받아 둔 시세가
 * 온다. 대기 한 번(왕복 하나)이 그만큼 사라진다. 위젯이 먼저 받아도
 * 마찬가지다 — 같은 함수를 쓰므로.
 */
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { portfolioApi } from "@/api/stocks";
import { 하루수명, 시세열쇠 } from "@/constants/portfolioQuery";
import type { PortfolioItem } from "@/types/portfolio";

/** 보유 목록의 이름표. 손으로 적지 말고 이걸 쓴다 */
export const 보유목록열쇠 = ["portfolio-items-all"] as const;

/**
 * 보유 목록에 딸려 온 시세를, 시세 조회의 서랍에 미리 꽂아 둔다.
 *
 * ── 무엇을 없앤 것인가 ──
 *
 * 예전에는 왕복이 두 번이었다. 무엇의 시세를 물어볼지는 종목을 받아야
 * 알 수 있어서, 뒤엣것이 앞엣것을 기다렸다.
 *
 *     /portfolio/items ──▶ (답) ──▶ /watchlist/prices ──▶ (답)
 *
 * 그 두 번째 왕복 내내 총자산·손익·비중이 통째로 빈칸이었다. 종목이
 * 한 개든 서른 개든 늘 붙는 대기다. 이제 서버가 이미 받아 둔 시세를
 * 목록에 같이 실어 보내고, 여기서 그것을 시세 조회 자리에 꽂는다.
 *
 * ── 두 가지를 꼭 지켜야 한다 ──
 *
 * **낡은 것으로 표시해서** 꽂는다(updatedAt: 1). 지금 시각으로 넣으면
 * react-query 가 신선하다고 보고(staleTime 2분) 새로 안 받아 온다 —
 * 서버 캐시에 있던 옛 시세가 2분간 화면에 눌러앉는다. 빠른 대신 틀린
 * 값을 보여 주는 것은 느린 것보다 나쁘다.
 *
 * **비어 있을 때만** 꽂는다. 화면에 머물던 사람이 종목 하나를 고치면
 * 목록을 다시 받는데, 그때 화면에는 이미 실시간으로 받은 시세가 있다.
 * 서버 캐시 쪽이 더 낡았을 수 있으므로 있는 값을 밀어내지 않는다.
 * 이 꽂기는 **처음 열 때**를 위한 것이다.
 */
export function 시세꽂기(
  qc: { getQueryData: (k: readonly unknown[]) => unknown;
        setQueryData: (k: readonly unknown[], v: unknown, o?: { updatedAt?: number }) => unknown },
  받은것: { items?: unknown; prices?: unknown } | unknown[] | null | undefined,
): PortfolioItem[] {
  /* 서버가 **배열을 그대로 주는 경우**를 반드시 받아 줘야 한다.
     with_prices 를 모르는 예전 서버가 그렇다. 프런트가 먼저 올라가거나,
     배포가 반쯤 걸쳐 있거나, 옛 응답이 어딘가에 캐시돼 있으면 실제로
     그렇게 온다. 그때 꾸러미만 알아보면 목록이 통째로 빈 것으로 읽혀서
     **가진 종목이 하나도 없는 화면**이 뜬다 — 속도를 얻으려다 자산이
     사라져 보이는 것은 어떤 속도로도 못 갚는다. */
  if (Array.isArray(받은것)) return 받은것 as PortfolioItem[];
  const 목록 = (Array.isArray(받은것?.items) ? 받은것!.items : []) as PortfolioItem[];
  const 시세 = 받은것?.prices;
  if (Array.isArray(시세) && 시세.length > 0) {
    const 열쇠 = 시세열쇠(목록);
    if (qc.getQueryData(열쇠) == null) {
      qc.setQueryData(열쇠, 시세, { updatedAt: 1 });
    }
  }
  return 목록;
}

/**
 * 조회 설정 한 벌. 부르는 쪽은 enabled 만 정한다.
 *
 * queryFn 을 각자 적지 않게 하는 것이 이 함수의 전부다 — 각자 적으면
 * 먼저 붙은 쪽이 이기고, 그 어긋남은 화면에 아무 표시가 안 난다.
 */
export function 보유목록설정(qc: QueryClient, 켜짐: boolean) {
  return {
    queryKey: 보유목록열쇠,
    queryFn: () => portfolioApi.getItemsWithPrices(undefined, true)
      .then((받은것) => 시세꽂기(qc, 받은것)),
    enabled: 켜짐,
    staleTime: 하루수명,
  };
}

/** 보유 목록을 받는다. 일곱 화면이 이걸 쓴다 */
export function use보유목록(켜짐: boolean) {
  const qc = useQueryClient();
  return useQuery<PortfolioItem[]>(보유목록설정(qc, 켜짐));
}
