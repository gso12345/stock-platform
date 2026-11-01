/**
 * 당겨서 새로고침 — 본문 맨 위에서 아래로 당기면 지금 화면의 자료를 다시 받는다.
 *
 * 설치한 앱에는 브라우저의 새로고침 단추가 없다. 화면 끝에서 튕기는 것도 꺼 두어(index.css 의
 * overscroll-behavior) 브라우저의 당겨서 새로고침도 안 됐다 — 새로 받을 방법이 화면마다 다르거나 없었다
 * (사용자: "실제 앱같이 느껴졌으면" — 4번).
 *
 *   · 손가락(터치)일 때만 — 마우스·PC 는 안 한다
 *   · 본문이 맨 위일 때, 아래로(세로가 더 크게) 당길 때만 — 옆으로 넘기는 차트·표는 건드리지 않는다
 *   · 창(시트·모달)·차트(canvas)·스스로 스크롤하는 칸 안에서 시작하면 안 한다
 *   · 당김 표시는 상태(state) 대신 요소를 바로 움직인다 — 손가락이 움직일 때마다 앱 틀을 다시 그리지 않게
 */
import { useEffect, useRef, useState, type RefObject } from "react";

/** 표시가 이만큼 내려오면(손가락은 그 두 배) 놓았을 때 새로고침 */
export const 당김_임계 = 64;
export const 당김_최대 = 96;
/** 손가락 1px 에 표시 0.5px — 끝까지 끌려오지 않고 묵직하게 */
export const 당김_저항 = 0.5;
/** 세로로 이만큼은 움직여야 당기기로 본다(살짝 닿은 것·누름과 가르기) */
export const 당김_시작 = 8;
/** 너무 빨리 끝나도 이만큼은 돈다 — 깜빡 사라지면 했는지 모른다 */
export const 최소_도는시간 = 500;
/** 서버가 느려도 이 뒤에는 표시를 거둔다(자료는 오는 대로 바뀐다) */
export const 최대_기다림 = 10_000;
/** 표시가 숨어 있는 자리(위로 이만큼) */
const 숨은자리 = 44;

export function 당김거리(dy: number): number {
  return Math.max(0, Math.min(당김_최대, (dy - 당김_시작) * 당김_저항));
}

/** 여기서 시작한 당기기를 받아도 되나 */
export function 당겨도되나(target: EventTarget | null, 본문: HTMLElement): boolean {
  if (본문.scrollTop > 0) return false;
  if (!(target instanceof Element)) return true;
  if (target.closest('[role="dialog"], .modal-backdrop, [data-no-pull], canvas')) return false;
  // 스스로 스크롤하는 칸(목록·표) 안이고 그 칸이 맨 위가 아니면 — 그 칸을 올리려는 것이다
  for (let n: Element | null = target; n && n !== 본문; n = n.parentElement) {
    if ((n as HTMLElement).scrollTop > 0) return false;
  }
  return true;
}

function 손가락기기(): boolean {
  try {
    return !!window.matchMedia?.("(pointer: coarse)")?.matches;
  } catch {
    return false;
  }
}

/** 본문에 당겨서 새로고침을 단다. 표시 요소는 숨은 채로 두면 여기서 움직인다. 새로 받는 중인지 돌려준다 */
export function use당겨서새로고침(
  본문: RefObject<HTMLElement | null>,
  표시: RefObject<HTMLElement | null>,
  새로고침: () => Promise<unknown>,
): boolean {
  const [도는중, set도는중] = useState(false);
  const 일 = useRef(새로고침);
  일.current = 새로고침;

  useEffect(() => {
    const el = 본문.current;
    if (!el || !손가락기기()) return;
    let 시작: { x: number; y: number } | null = null;
    let 당기는중 = false;
    let 거리 = 0;
    let 도는 = false;

    const 그리기 = (d: number, 부드럽게 = false) => {
      const t = 표시.current;
      if (!t) return;
      t.style.transition = 부드럽게 ? "transform 0.2s ease, opacity 0.2s ease" : "none";
      t.style.transform = `translate(-50%, ${d - 숨은자리}px) rotate(${Math.round(d * 4)}deg)`;
      t.style.opacity = String(Math.min(1, d / 당김_임계));
    };
    const 처음으로 = () => { 시작 = null; 당기는중 = false; 거리 = 0; };

    // 도는 동안의 손짓은 움직임에서 거른다(여기서 시작을 적어 둬도 당기기로 이어지지 않는다)
    const 닿음 = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !당겨도되나(e.target, el)) { 시작 = null; return; }
      시작 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const 움직임 = (e: TouchEvent) => {
      if (!시작 || 도는) return;
      const dx = e.touches[0].clientX - 시작.x;
      const dy = e.touches[0].clientY - 시작.y;
      if (!당기는중) {
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 당김_시작) { 처음으로(); return; }   // 옆으로 넘기기
        if (dy < -4) { 처음으로(); return; }                                                     // 위로 — 내리며 읽기
        if (dy > 당김_시작 && el.scrollTop <= 0) 당기는중 = true;
        else return;
      }
      거리 = 당김거리(dy);
      그리기(거리);
    };
    const 뗌 = () => {
      if (!당기는중) return;   // 당기지 않았다 — 다음 손짓은 닿음이 새로 시작한다
      const 넘음 = 거리 >= 당김_임계;
      처음으로();
      if (!넘음) { 그리기(0, true); return; }
      도는 = true;
      set도는중(true);
      그리기(당김_임계, true);
      const 시한 = new Promise((r) => setTimeout(r, 최대_기다림));
      const 받기 = Promise.race([Promise.resolve().then(() => 일.current()), 시한]).catch(() => undefined);
      const 최소 = new Promise((r) => setTimeout(r, 최소_도는시간));
      // 받기와 최소 시간이 둘 다 끝나면 거둔다. 그새 앱 틀이 치워졌으면 표시(ref)는 비어 그리기가 그냥
      // 지나가고, 상태 바꾸기도 무시된다
      void Promise.all([받기, 최소]).then(() => {
        도는 = false;
        set도는중(false);
        그리기(0, true);
      });
    };

    el.addEventListener("touchstart", 닿음, { passive: true });
    el.addEventListener("touchmove", 움직임, { passive: true });
    el.addEventListener("touchend", 뗌);
    el.addEventListener("touchcancel", 뗌);
    return () => {
      el.removeEventListener("touchstart", 닿음);
      el.removeEventListener("touchmove", 움직임);
      el.removeEventListener("touchend", 뗌);
      el.removeEventListener("touchcancel", 뗌);
    };
  }, [본문, 표시]);

  return 도는중;
}
