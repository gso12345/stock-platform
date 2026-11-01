/**
 * 화면이 넘어갈 때 — 들어갈 때는 오른쪽에서, 뒤로 갈 때는 왼쪽에서 밀려 들어오고, 하단 탭끼리는 살짝 나타난다.
 *
 * 예전에는 화면이 '툭' 바뀌었다(사용자: "실제 앱같이 느껴졌으면" — 7번). 휴대폰·태블릿(1024px 미만)에서만
 * 하고, 휴대폰의 '동작 줄이기' 를 켠 사람에게는 안 한다. 화면 내용은 그대로 두고 감싸는 틀만 잠깐
 * 움직인다(Web Animations) — 화면을 다시 만들지 않으니 보던 상태가 사라지지 않는다.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType, type NavigationType } from "react-router-dom";

export type 넘김 = "앞" | "뒤" | "탭" | "없음";

/** 하단 탭으로 오가는 화면 — 서로 옆 칸이라 밀지 않고 살짝 나타나게 */
export const 탭화면 = ["/", "/portfolio", "/watchlist", "/feed", "/news", "/more"];

export function 넘김종류(방식: NavigationType, 이전: string, 다음: string): 넘김 {
  if (이전 === 다음 || 방식 === "REPLACE") return "없음";
  // 하단 탭을 누른 것(상세에서 눌러도) — 깊이 들어가는 게 아니니 밀지 않는다. 뒤로 가기는 탭끼리만 살짝
  if (탭화면.includes(다음) && (방식 === "PUSH" || 탭화면.includes(이전))) return "탭";
  return 방식 === "POP" ? "뒤" : "앞";
}

export const 넘김모양: Record<Exclude<넘김, "없음">, { 키프레임: Keyframe[]; 시간: number }> = {
  앞: { 키프레임: [{ transform: "translateX(28px)", opacity: 0.6 }, { transform: "none", opacity: 1 }], 시간: 260 },
  뒤: { 키프레임: [{ transform: "translateX(-28px)", opacity: 0.6 }, { transform: "none", opacity: 1 }], 시간: 260 },
  탭: { 키프레임: [{ opacity: 0.5 }, { opacity: 1 }], 시간: 180 },
};

function 맞나(질의: string): boolean {
  try {
    return !!window.matchMedia?.(질의)?.matches;
  } catch {
    return false;
  }
}

export function use화면넘김(틀: RefObject<HTMLElement | null>): void {
  const location = useLocation();
  const 방식 = useNavigationType();
  const 이전 = useRef(location.pathname);

  useLayoutEffect(() => {
    const 앞경로 = 이전.current;
    이전.current = location.pathname;
    const el = 틀.current;
    if (!el || typeof el.animate !== "function") return;
    if (맞나("(prefers-reduced-motion: reduce)") || 맞나("(min-width: 1024px)")) return;
    const 종류 = 넘김종류(방식, 앞경로, location.pathname);
    if (종류 === "없음") return;
    const { 키프레임, 시간 } = 넘김모양[종류];
    el.animate(키프레임, { duration: 시간, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
}
