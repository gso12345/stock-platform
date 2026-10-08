import { useEffect, useState } from "react";

/**
 * 화면이 넓은가(기본 1024px 이상 — Tailwind 의 lg 와 같은 기준).
 *
 * 배치는 CSS(lg:)로 바꾸는 것이 원칙이다. 이건 CSS 로 못 바꾸는 값 — 예를
 * 들어 그래프의 높이·반지름처럼 숫자로 넘겨야 하는 것 — 에만 쓴다.
 *
 * 창 크기를 바꾸면 따라 바뀐다. matchMedia 가 없는 곳(일부 검사 환경)에서는
 * 늘 '좁다' 로 본다 — 휴대폰 모양이 기본이다.
 */
export function use넓은화면(최소폭 = 1024): boolean {
  const 질의 = `(min-width: ${최소폭}px)`;
  const [넓음, set넓음] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && !!window.matchMedia?.(질의)?.matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq: MediaQueryList | undefined;
    try {
      mq = window.matchMedia?.(질의);
    } catch {
      mq = undefined;
    }
    if (!mq) return;
    const 바뀜 = (e: MediaQueryListEvent) => set넓음(e.matches);
    set넓음(mq.matches);
    mq.addEventListener?.("change", 바뀜);
    return () => mq?.removeEventListener?.("change", 바뀜);
  }, [질의]);
  return 넓음;
}
