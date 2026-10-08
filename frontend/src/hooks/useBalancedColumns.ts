import { useLayoutEffect, useRef, useState } from "react";

/**
 * 카드 N장을 줄마다 고르게 나눌 열 수.
 *
 * `repeat(auto-fill, minmax(…))` 만 쓰면 한 줄을 들어갈 만큼 채우고 남는
 * 것을 다음 줄로 넘긴다. 대시보드의 환율·금리 카드 10장이 1,920px 에서
 * 9장 + 1장, 해외 탭 8장이 1,280px 에서 6장 + 2장 — 끝줄에 한두 장만
 * 덩그러니 남았다.
 * 줄 수는 그대로 두고(이 폭에 몇 장 들어가나로 정한다) 그 줄 수로 카드를
 * 고르게 나눈다: 10장 두 줄이면 5 + 5, 8장이면 4 + 4, 11장이면 6 + 5.
 *
 * @param 최대열 이 폭에 최소 폭 카드가 몇 장 들어가나
 * @param 개수   카드 수
 * @returns 열 수. 0 이면 모른다는 뜻 — CSS 에 적힌 기본값을 쓴다.
 */
export function 고른열수(최대열: number, 개수: number): number {
  if (최대열 <= 0 || 개수 <= 0) return 0;
  const 줄 = Math.ceil(개수 / 최대열);
  return Math.ceil(개수 / 줄);
}

/**
 * 격자의 열 수를 '줄마다 고르게' 맞춘다. 돌려준 ref 와 style 을 격자 칸에
 * 같이 붙인다.
 *
 * 카드 수는 칸 안의 자식을 직접 센다 — 부르는 쪽이 따로 세면 카드를 하나
 * 더할 때 그 숫자 고치는 걸 잊는다(뼈대·'못 불러옴' 안내도 저절로 맞는다).
 *
 * 칸이 격자가 아닐 때(휴대폰에서는 옆으로 미는 줄이다)는
 * grid-template-columns 가 아무 효과가 없으므로 그대로 붙여 둬도 된다.
 */
export function use고른열<T extends HTMLElement = HTMLDivElement>(최소폭: number, 간격 = 12) {
  const ref = useRef<T>(null);
  const [최대열, set최대열] = useState(0);
  const [개수, set개수] = useState(0);

  /* 그릴 때마다 센다. 같은 값이면 React 가 다시 그리지 않는다.
     화면에 칠하기 전에 돌아야 카드가 한 번 엉뚱한 줄에 섰다가 옮겨 가는
     모습이 안 보인다(그래서 useEffect 가 아니라 useLayoutEffect) */
  useLayoutEffect(() => {
    set개수(ref.current?.childElementCount ?? 0);
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const 재기 = () => {
      const 모양 = getComputedStyle(el);
      const 폭 = el.clientWidth
        - (parseFloat(모양.paddingLeft) || 0) - (parseFloat(모양.paddingRight) || 0);
      /* 폭이 아니라 '몇 장 들어가나' 를 담는다 — 창 크기를 끄는 동안 매
         프레임 다시 그리지 않고, 들어가는 장 수가 바뀔 때만 다시 그린다 */
      set최대열(폭 > 0 ? Math.max(1, Math.floor((폭 + 간격) / (최소폭 + 간격))) : 0);
    };
    재기();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(재기);
    ro.observe(el);
    return () => ro.disconnect();
  }, [최소폭, 간격]);

  const 열 = 고른열수(최대열, 개수);
  return {
    ref,
    style: 열 ? { gridTemplateColumns: `repeat(${열}, minmax(0, 1fr))` } : undefined,
  };
}
