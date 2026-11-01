/**
 * 옆으로 넘치는 줄의 끝 흐림 — 더 있는 쪽 끝을 흐리게 해 "옆으로 더 있다" 를 보인다.
 *
 * 예전에는 종목 상세 탭·스크리닝 도구 단추·관심종목 폴더 줄이 화면 끝에서 뚝 잘려, 옆에 더 있는지 알 수
 * 없었다(사용자가 고른 디자인 6번). 돌려준 ref 를 스크롤하는 줄에 달고, 돌려준 클래스를 그 줄에 붙인다
 * (index.css 의 fade-edge-*). 넘치지 않으면 클래스가 비어 아무것도 흐리지 않는다.
 */
import { useEffect, useLayoutEffect, useState } from "react";

export type 넘친쪽 = "" | "left" | "right" | "both";

/** 지금 어느 쪽에 가려진 것이 있나 — 1px 은 반올림 오차로 본다 */
export function 넘친쪽재기(el: { scrollLeft: number; clientWidth: number; scrollWidth: number }): 넘친쪽 {
  const 왼 = el.scrollLeft > 1;
  const 오 = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  return 왼 && 오 ? "both" : 왼 ? "left" : 오 ? "right" : "";
}

/** [줄에 달 ref, 줄에 붙일 클래스] — 줄이 나중에 나타나도(로그인 뒤 등) 붙도록 콜백 ref 로 받는다 */
export function use끝흐림<T extends HTMLElement>(): [(el: T | null) => void, string] {
  const [줄, set줄] = useState<T | null>(null);
  const [쪽, set쪽] = useState<넘친쪽>("");

  // 내용(탭 개수·글자)이 바뀌면 넘침도 바뀐다 — 그릴 때마다 잰다. 한 줄의 폭만 읽어 가볍고, 값이 같으면
  // 다시 그리지 않는다
  useLayoutEffect(() => {
    if (줄) set쪽(넘친쪽재기(줄));
  });

  useEffect(() => {
    if (!줄) return;
    const 재기 = () => set쪽(넘친쪽재기(줄));
    줄.addEventListener("scroll", 재기, { passive: true });
    window.addEventListener("resize", 재기);
    const 지켜봄 = typeof ResizeObserver === "function" ? new ResizeObserver(재기) : null;
    지켜봄?.observe(줄);
    return () => {
      줄.removeEventListener("scroll", 재기);
      window.removeEventListener("resize", 재기);
      지켜봄?.disconnect();
    };
  }, [줄]);

  return [set줄, 흐림클래스[쪽]];
}

/** 이름을 통째로 적어 둔다 — 조각을 이어 붙이면 Tailwind 가 쓰이는 클래스로 못 알아본다 */
const 흐림클래스: Record<넘친쪽, string> = {
  "": "",
  left: "fade-edge-left",
  right: "fade-edge-right",
  both: "fade-edge-both",
};
