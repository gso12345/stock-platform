/**
 * 화면에서 고른 것을 기억한다 — 새로고침해도 남게.
 *
 * ── 왜 필요한가 ──
 *
 * 내 자산에서 포트폴리오를 고르거나, 전체 보기에서 볼 포트폴리오를
 * 체크해도 **아무 데도 안 남았다.** 그냥 useState 였다. 새로고침하거나
 * 다른 화면에 갔다 오면 매번 처음 상태로 돌아간다.
 *
 * 사용자에게는 '저장이 안 된다' 로 보인다. 맞는 말이다 — 고른 것을
 * 다음에도 기억하는 게 고르는 일의 절반이다.
 *
 * ── 서버가 아니라 이 기기에 담는 이유 ──
 *
 * '어느 탭을 보고 있었나' 는 그 사람의 **이 기기에서의 습관**이지
 * 계정에 딸린 자료가 아니다. 서버에 담으면 왕복이 하나 늘고, 폰에서
 * 고른 것이 PC 화면까지 바꾼다.
 *
 * ── 안 터지는 것이 먼저다 ──
 *
 * 시크릿 창·저장 차단·용량 초과에서 localStorage 는 던진다. 화면이
 * 기억을 못 하는 것은 불편이지만, 그것 때문에 화면이 하얗게 되는 건
 * 완전히 다른 문제다. 읽기·쓰기를 다 감싼다.
 */
import { useState, useCallback, useRef } from "react";

/** 열쇠 앞에 붙인다 — 다른 앱과 섞이지 않게 */
const 앞머리 = "내자산:";

function 읽기<T>(열쇠: string): T | undefined {
  try {
    const 담긴것 = localStorage.getItem(앞머리 + 열쇠);
    if (담긴것 == null) return undefined;
    return JSON.parse(담긴것) as T;
  } catch {
    /* 손상됐거나 못 읽는다. 없는 셈 친다 */
    return undefined;
  }
}

function 쓰기(열쇠: string, 값: unknown): void {
  try {
    localStorage.setItem(앞머리 + 열쇠, JSON.stringify(값));
  } catch {
    /* 시크릿 창·용량 초과. 기억을 못 할 뿐이지 화면은 그대로 돈다 */
  }
}

/**
 * useState 와 같은데, 값이 이 기기에 남는다.
 *
 * `되살리기` 로 담긴 값을 걸러낼 수 있다 — 지운 포트폴리오 id 가
 * 남아 있으면 없는 것을 고른 채로 화면이 열린다.
 */
export function use저장된값<T>(
  열쇠: string,
  기본값: T,
  되살리기?: (담긴것: unknown) => T | undefined,
): [T, (다음: T | ((앞: T) => T)) => void] {
  const [값, set값] = useState<T>(() => {
    const 담긴것 = 읽기<unknown>(열쇠);
    if (담긴것 === undefined) return 기본값;
    if (되살리기) {
      const 살린것 = 되살리기(담긴것);
      return 살린것 === undefined ? 기본값 : 살린것;
    }
    return 담긴것 as T;
  });

  /* 최신 값을 참조로 들고 있는다 — 함수형 갱신에서 담을 값을 알아야 한다 */
  const 지금 = useRef(값);
  지금.current = 값;

  const 바꾸기 = useCallback((다음: T | ((앞: T) => T)) => {
    const 새것 = typeof 다음 === "function"
      ? (다음 as (앞: T) => T)(지금.current)
      : 다음;
    지금.current = 새것;
    set값(새것);
    쓰기(열쇠, 새것);
  }, [열쇠]);

  return [값, 바꾸기];
}

/**
 * Set 을 담는 판. JSON 에 Set 이 없어서 배열로 오간다.
 *
 * '전체 보기에서 제외할 포트폴리오' 처럼 Set 이 자연스러운 자리가 있다.
 * 부르는 쪽이 매번 배열↔Set 을 옮기게 두면 한 곳만 빠뜨리기 쉽다.
 */
export function use저장된Set<T extends string | number>(
  열쇠: string,
  기본값: Set<T> = new Set(),
): [Set<T>, (다음: Set<T> | ((앞: Set<T>) => Set<T>)) => void] {
  const [배열, set배열] = use저장된값<T[]>(
    열쇠,
    [...기본값],
    (담긴것) => (Array.isArray(담긴것) ? (담긴것 as T[]) : undefined),
  );

  const 집합 = useRef<Set<T>>(new Set(배열));
  /* 배열이 바뀔 때만 새 Set 을 만든다. 매 렌더마다 새로 만들면
     이 값을 의존성으로 쓰는 useMemo 가 전부 다시 돈다 */
  const 앞배열 = useRef(배열);
  if (앞배열.current !== 배열) {
    앞배열.current = 배열;
    집합.current = new Set(배열);
  }

  const 바꾸기 = useCallback((다음: Set<T> | ((앞: Set<T>) => Set<T>)) => {
    const 새것 = typeof 다음 === "function" ? 다음(집합.current) : 다음;
    set배열([...새것]);
  }, [set배열]);

  return [집합.current, 바꾸기];
}
