/**
 * 화면을 옮길 때 스크롤 — 새 화면은 맨 위에서, 뒤로 가면 보던 자리로.
 *
 * 앱 틀의 본문(main) 하나를 모든 화면이 같이 쓴다. 그래서 목록 중간에서 종목을 열면 상세가 중간부터
 * 보였고, 뒤로 가면 보던 자리를 잃었다(사용자: "실제 앱같이 느껴졌으면" — 2번).
 *
 *   · 새 화면(PUSH, 다른 경로)  → 맨 위
 *   · 뒤로·앞으로(POP)          → 그 화면에서 보던 자리(자료가 늦게 와 키가 모자라면 잠깐 기다렸다 맞춘다)
 *   · 같은 화면 안에서 주소만 바뀐 것(탭·거르기 — REPLACE, 같은 경로) → 그대로
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** 기록마다(location.key) 보던 자리 — 너무 많이 쌓이지 않게 오래된 것부터 버린다 */
const 기억 = new Map<string, number>();
export const 최대기억 = 60;
/** 되돌릴 자리에 못 닿으면(자료가 아직 안 와 키가 모자라면) 이만큼 프레임 동안 다시 맞춘다 — 약 1.5초 */
export const 되돌리기_프레임 = 90;

export function 자리적기(키: string, 자리: number): void {
  기억.delete(키);
  기억.set(키, 자리);
  while (기억.size > 최대기억) 기억.delete(기억.keys().next().value as string);
}

export function 자리읽기(키: string): number | undefined {
  return 기억.get(키);
}

/** 시험용 */
export function _기억비우기(): void {
  기억.clear();
}

/** 보던 자리로 — 닿을 때까지(또는 사람이 손대거나 시간이 다 될 때까지) 프레임마다 맞춘다 */
export function 되돌리기(el: HTMLElement, 자리: number): void {
  let 남은 = 되돌리기_프레임;
  let 손댐 = false;
  const 멈춤 = () => { 손댐 = true; };
  const 끝 = () => {
    el.removeEventListener("touchstart", 멈춤);
    el.removeEventListener("wheel", 멈춤);
  };
  el.addEventListener("touchstart", 멈춤, { passive: true });
  el.addEventListener("wheel", 멈춤, { passive: true });
  const 한번 = () => {
    if (손댐) { 끝(); return; }
    el.scrollTop = 자리;
    남은 -= 1;
    if (Math.abs(el.scrollTop - 자리) > 1 && 남은 > 0) requestAnimationFrame(한번);
    else 끝();
  };
  한번();
}

export function use스크롤기억(본문: RefObject<HTMLElement | null>): void {
  const location = useLocation();
  const 방식 = useNavigationType();
  const 지금키 = useRef(location.key);
  const 이전경로 = useRef(location.pathname);

  // 스크롤할 때마다 지금 화면의 자리를 적는다(숫자 하나 — 가볍다)
  useEffect(() => {
    const el = 본문.current;
    if (!el) return;
    const 적기 = () => 자리적기(지금키.current, el.scrollTop);
    el.addEventListener("scroll", 적기, { passive: true });
    return () => el.removeEventListener("scroll", 적기);
  }, [본문]);

  // 그리기 전에 맞춘다 — 그린 뒤에 옮기면 한 번 중간 자리가 보였다 튄다
  useLayoutEffect(() => {
    const el = 본문.current;
    const 이전 = 이전경로.current;
    지금키.current = location.key;
    이전경로.current = location.pathname;
    if (!el) return;
    if (방식 === "POP") {
      const 자리 = 자리읽기(location.key);
      if (자리 != null) 되돌리기(el, 자리);
      return;
    }
    if (방식 === "PUSH" && location.pathname !== 이전) el.scrollTop = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
}

/** 하단 탭을 지금 보는 화면에서 다시 누르면 맨 위로 — 앱들의 기본 동작 */
export function 맨위로(el: HTMLElement | null | undefined): void {
  if (!el) return;
  if (typeof el.scrollTo === "function") el.scrollTo({ top: 0, behavior: "smooth" });
  else el.scrollTop = 0;
}
