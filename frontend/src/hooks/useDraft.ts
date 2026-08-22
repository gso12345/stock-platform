/**
 * 쓰던 글이 날아가지 않게 한다.
 *
 * 글쓰기 화면은 저장이 실패해도 내용을 지키고 있었고(화면을 안 떠난다),
 * 뒤로 갈 때도 한 번 물어본다. 그런데 그 둘 사이에 구멍이 있었다 —
 * 새로고침, 탭 닫기, 휴대폰이 배경에서 앱을 정리하는 경우다.
 *
 * 휴대폰에서 긴 글을 쓰다가 전화가 오거나 다른 앱을 잠깐 보고 오면
 * 브라우저가 화면을 버리는 일이 흔하다. 돌아오면 빈 칸이다. 되돌릴
 * 방법이 없고, 무엇을 쓰고 있었는지도 기억이 안 난다.
 *
 * 그래서 브라우저에 잠깐 담아 둔다. 서버로 보내지 않는다 — 미완성 글이
 * 남의 눈에 띄면 안 되고, 이 서버는 CPU 0.15개라 자동 저장을 받아 줄
 * 여유도 없다.
 *
 * 담아 두는 기간에 상한을 둔다. 몇 주 전에 쓰다 만 글이 되살아나면
 * 그건 복구가 아니라 방해다.
 */
import { useEffect, useRef, useState } from "react";

/** 이만큼 지난 임시본은 없는 셈 친다 */
const 유효시간 = 1000 * 60 * 60 * 24;          // 하루

/** 글자를 멈추고 이만큼 지나면 담는다. 매 글자마다 담으면 낭비다 */
const 담는간격 = 800;

type 담긴것<T> = { 값: T; 때: number };

export function 임시저장읽기<T>(열쇠: string): T | null {
  try {
    const 날것 = localStorage.getItem(열쇠);
    if (!날것) return null;
    const { 값, 때 } = JSON.parse(날것) as 담긴것<T>;
    if (!때 || Date.now() - 때 > 유효시간) {
      localStorage.removeItem(열쇠);
      return null;
    }
    return 값;
  } catch {
    /* 손상됐거나 브라우저가 막아 둔 경우. 임시 저장은 곁들이라
       여기서 터지면 글쓰기 자체가 안 열린다 */
    return null;
  }
}

export function 임시저장지우기(열쇠: string) {
  try { localStorage.removeItem(열쇠); } catch { /* 무시 */ }
}

/**
 * 값이 바뀌면 잠깐 뒤에 담는다.
 *
 * @param 열쇠   화면마다 다른 이름
 * @param 값     담을 것
 * @param 담을까 비어 있으면 담지 않는다(빈 임시본이 생기면 다음에 열 때
 *               "이어서 쓰시겠어요?" 가 헛되이 뜬다)
 */
export function use임시저장<T>(열쇠: string, 값: T, 담을까: boolean) {
  const 시계 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const 최신 = useRef({ 값, 담을까 });
  최신.current = { 값, 담을까 };

  useEffect(() => {
    if (시계.current) clearTimeout(시계.current);
    시계.current = setTimeout(() => {
      try {
        if (담을까) {
          localStorage.setItem(열쇠, JSON.stringify({ 값, 때: Date.now() } as 담긴것<T>));
        } else {
          localStorage.removeItem(열쇠);
        }
      } catch { /* 저장 공간이 꽉 찼거나 막혀 있다 */ }
    }, 담는간격);
    return () => { if (시계.current) clearTimeout(시계.current); };
  }, [열쇠, JSON.stringify(값), 담을까]);

  /* 탭을 닫거나 새로고침할 때는 위 시계를 기다릴 수 없다.
     그 순간 바로 담는다.

     beforeunload 가 아니라 visibilitychange·pagehide 를 쓴다 —
     휴대폰 브라우저는 앱을 배경으로 보낼 때 beforeunload 를 안 부르는
     경우가 많고, 정작 화면이 버려지는 것은 그때다. */
  useEffect(() => {
    const 지금담기 = () => {
      try {
        const { 값: v, 담을까: c } = 최신.current;
        if (c) localStorage.setItem(열쇠, JSON.stringify({ 값: v, 때: Date.now() }));
      } catch { /* 무시 */ }
    };
    const 숨을때 = () => { if (document.visibilityState === "hidden") 지금담기(); };
    window.addEventListener("pagehide", 지금담기);
    document.addEventListener("visibilitychange", 숨을때);
    return () => {
      window.removeEventListener("pagehide", 지금담기);
      document.removeEventListener("visibilitychange", 숨을때);
    };
  }, [열쇠]);
}

/**
 * 화면을 열 때 임시본이 있으면 한 번 알려 준다.
 *
 * 곧바로 되살리지 않는 이유 — 새 글을 쓰려고 들어왔는데 예전 글이
 * 채워져 있으면 그것대로 당황스럽다. 고르게 한다.
 */
export function use임시본알림<T>(열쇠: string) {
  const [임시본, set임시본] = useState<T | null>(null);
  useEffect(() => { set임시본(임시저장읽기<T>(열쇠)); }, [열쇠]);
  return {
    임시본,
    닫기: () => set임시본(null),
    버리기: () => { 임시저장지우기(열쇠); set임시본(null); },
  };
}
