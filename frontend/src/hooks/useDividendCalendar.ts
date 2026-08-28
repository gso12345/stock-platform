/**
 * 배당 달력 조회 — 한 자리에서만 정한다.
 *
 * 두 곳이 같은 열쇠로 같은 것을 받고 있었다.
 *
 *   · 내 자산 화면(Portfolio.tsx) — 보유 줄에 붙는 배당 배지용
 *   · 배당 탭(DividendCalendar.tsx) — 달력 본체
 *
 * 열쇠가 같으니 한 번만 받는 것은 좋다. 그런데 **옵션이 서로 달랐다.**
 * 배지 쪽은 화면이 뜨자마자 나가고 pending 을 안 봤고, 달력 쪽만 나중에
 * pending 을 보게 고쳤다. 먼저 나간 쪽이 부분 응답을 공유 캐시에 써 넣고
 * staleTime 10분으로 굳히므로, 달력이 아무리 다시 물어보려 해도 소용이
 * 없다 — 열려고 할 때는 이미 '신선한' 부분합이 자리를 잡고 있다.
 *
 * 그래서 옵션째로 한 자리에 모은다. 한쪽만 고쳐지는 일이 구조적으로
 * 불가능해진다.
 *
 * ── pending 을 왜 보나 ──
 *
 * 서버는 한 요청에 새로 받아 올 종목 수를 묶는다(dividend_service.한번에).
 * 못 받은 수는 pending 으로 알려 준다. 그걸 안 보면 부분합이 '연간
 * 배당금' 으로 굳는데, 실제로 이런 제보를 받았다 —
 *
 *     포트폴리오1 34만 + 포트폴리오2 89만 인데 전체가 34만
 *
 * 전체를 먼저 열면 상한에 걸려 일부만 받아지고, 그 값이 10분간 남는다.
 */
import { useQuery } from "@tanstack/react-query";
import { portfolioApi, type 배당줄 } from "@/api/stocks";

export interface 배당응답 { items: 배당줄[]; pending: number }

/** 아직 못 받은 종목이 남아 있을 때 다시 물어보는 간격 */
export const 재촉주기 = 4_000;

/** 서버 캐시가 하루라 그보다 자주 물어볼 이유가 없다 */
export const 평소수명 = 600_000;

/**
 * 조회 열쇠.
 *
 * 전체 보기는 "all", 특정 포트폴리오는 그 id.
 * 부르는 쪽이 undefined / null / "all" 로 제각각 넘겨도 한 모양으로 모은다 —
 * 그 셋이 갈리면 같은 화면을 두 번 받게 된다.
 */
export function 배당열쇠(portfolioId?: number | null) {
  return ["dividend-calendar", portfolioId ?? "all"] as const;
}

export function use배당달력(portfolioId?: number | null, 켜짐 = true) {
  return useQuery<배당응답>({
    queryKey: 배당열쇠(portfolioId),
    queryFn: () => portfolioApi.getDividends(portfolioId ?? undefined),
    enabled: 켜짐,
    staleTime: 평소수명,
    /* 아직 못 받은 종목이 남아 있으면 몇 초 뒤 다시 물어본다.
       다 채워지면(pending 0) 알아서 멈춘다 — 계속 두드리면 그 자체가
       부담이다. 보유 뉴스가 쓰는 것과 같은 방식이다. */
    refetchInterval: (q) => ((q.state.data?.pending ?? 0) > 0 ? 재촉주기 : false),
    refetchIntervalInBackground: false,
  });
}
