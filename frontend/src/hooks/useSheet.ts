/**
 * 아래에서 올라오는 시트(휴대폰) — 손잡이를 끌어내리면 닫히고, 자판이 올라오면 그 위로 올라간다.
 *
 * 예전에는 설정·종목 추가·사고팔기 같은 창이 휴대폰에서도 화면 가운데 떴다(사용자: "실제 앱같이
 * 느껴졌으면" — 8번). 휴대폰 앱들은 아래에서 올라오고 쓸어내려 닫는다. PC 는 그대로 가운데 창이다
 * (components/ui 의 Modal).
 */
import { useEffect, useRef, useState, type PointerEvent as 누름 } from "react";

/** 손잡이를 이만큼 끌어내리면 닫는다 */
export const 닫는거리 = 90;
/** 빠르게 쓸어내리면(px/ms) 짧게 끌어도 닫는다 */
export const 닫는속도 = 0.6;
/** 쓸어내리기로 볼 가장 짧은 거리 — 손잡이를 톡 건드린 것과 가른다 */
export const 쓸기최소 = 20;
/** 닫힐 때 내려가는 시간(ms) — 그 뒤에 닫기를 부른다 */
export const 내려가는시간 = 200;

export function 닫을까(거리: number, 걸린ms: number): boolean {
  if (거리 >= 닫는거리) return true;
  // 걸린 시간이 0 이면 나눈 값이 무한대 — 순식간에 쓸어내린 것이니 닫는다
  return 거리 >= 쓸기최소 && 거리 / 걸린ms >= 닫는속도;
}

/** 손잡이에 붙일 것과 움직일 판. 닫기가 없으면(닫을 수 없는 창) 손잡이는 끌리지 않는다 */
export function use끌어닫기(닫기?: () => void) {
  const 판 = useRef<HTMLDivElement>(null);
  const 시작 = useRef<{ y: number; 때: number } | null>(null);
  const 거리 = useRef(0);

  const 움직이기 = (d: number, 부드럽게: boolean) => {
    const el = 판.current;
    if (!el) return;
    // 올라오는 애니메이션(sheet-up)은 끝난 뒤에도 자리를 붙잡는다 — 끄지 않으면 끌어도 판이 안 움직인다
    el.style.animation = "none";
    el.style.transition = 부드럽게 ? `transform ${내려가는시간}ms ease` : "none";
    el.style.transform = d ? `translateY(${d}px)` : "";
  };

  if (!닫기) return { 판, 손잡이: {} as Record<string, never> };

  const 손잡이 = {
    onPointerDown: (e: 누름<HTMLElement>) => {
      시작.current = { y: e.clientY, 때: performance.now() };
      거리.current = 0;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      움직이기(0, false);
    },
    onPointerMove: (e: 누름<HTMLElement>) => {
      if (!시작.current) return;
      거리.current = Math.max(0, e.clientY - 시작.current.y);
      움직이기(거리.current, false);
    },
    onPointerUp: () => {
      if (!시작.current) return;
      const 걸린 = performance.now() - 시작.current.때;
      시작.current = null;
      if (닫을까(거리.current, 걸린)) {
        const el = 판.current;
        if (el) {
          el.style.transition = `transform ${내려가는시간}ms ease`;
          el.style.transform = "translateY(100%)";
        }
        setTimeout(닫기, 내려가는시간);
      } else {
        움직이기(0, true);
      }
    },
    onPointerCancel: () => {
      시작.current = null;
      움직이기(0, true);
    },
  };
  return { 판, 손잡이 };
}

/** 화면 자판이 가린 높이(px) — 켜짐일 때만 잰다. 자판이 올라오면 시트를 그만큼 올린다 */
export function use자판높이(켜짐: boolean): number {
  const [높이, set높이] = useState(0);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!켜짐 || !vv) return;
    const 재기 = () => set높이(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    재기();
    vv.addEventListener("resize", 재기);
    vv.addEventListener("scroll", 재기);
    return () => {
      vv.removeEventListener("resize", 재기);
      vv.removeEventListener("scroll", 재기);
    };
  }, [켜짐]);
  return 높이;
}
