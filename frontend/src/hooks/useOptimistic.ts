/**
 * 누른 즉시 화면을 고치고, 서버는 뒤따라가게 하는 공용 도구.
 *
 * ── 왜 한자리에 모으나 ──
 *
 * 커뮤니티 댓글은 처음부터 이렇게 했다 — 쓰면 목록에 곧바로 얹고
 * 서버는 뒤에서 따라간다. 그런데 나머지 화면은 대개 이랬다.
 *
 *   누름 → 서버 왕복(1) → invalidateQueries → 목록 통째로 다시 받기(2)
 *        → 그제서야 화면이 바뀐다
 *
 * 한 칸이 한국↔싱가포르 왕복이라, 누르고 나서 한참을 아무 일도 안
 * 일어난 것처럼 보인다. 그래서 사람은 한 번 더 누른다.
 *
 * 코드를 세어 보니 useMutation 이 마흔여섯 군데였고 그중 낙관 갱신을
 * 한 곳은 몇 곳뿐이었다. 같은 스무 줄을 스물여섯 번 베껴 쓰면 언젠가
 * 한 곳만 다르게 고쳐진다 — 규칙을 여기 한 벌만 둔다.
 *
 * ── 무엇을 지키나 ──
 *
 *   1) 먼저 취소한다. 이미 날아간 조회가 뒤늦게 도착하면 방금 고친
 *      화면을 옛 값으로 덮어쓴다.
 *   2) 이전 값을 들고 있다가 실패하면 되돌린다. 안 되돌리면 화면과
 *      서버가 영영 어긋난다 — 새로고침하면 지운 것이 되살아난다.
 *   3) 성공해도 굳이 다시 안 받는다. 이미 맞는 값이 화면에 있다.
 *      서버가 만든 id 같은 것이 필요하면 부르는 쪽에서 onSuccess 로
 *      갈아 끼운다.
 */
import { useCallback } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

/** onMutate 가 돌려주고 onError 가 받는 꾸러미 */
export interface 되돌릴것 {
  열쇠: QueryKey;
  이전: unknown;
}

export function use낙관() {
  const qc = useQueryClient();

  /**
   * 캐시를 지금 자리에서 고친다. 되돌릴 수 있게 이전 값을 돌려준다.
   *
   * `열쇠` 는 정확한 열쇠 하나다. 접두사로 여러 개를 한꺼번에 고쳐야
   * 하면 미리여럿() 을 쓴다.
   */
  const 미리 = useCallback(
    async <T,>(열쇠: QueryKey, 바꾸기: (앞: T | undefined) => T | undefined): Promise<되돌릴것> => {
      /* 날아가 있는 조회를 먼저 취소한다. 안 그러면 그 응답이 뒤늦게
         도착해 방금 고친 화면을 옛 값으로 덮어쓴다 */
      await qc.cancelQueries({ queryKey: 열쇠 });
      const 이전 = qc.getQueryData(열쇠);
      qc.setQueryData<T | undefined>(열쇠, (앞) => 바꾸기(앞));
      return { 열쇠, 이전 };
    },
    [qc],
  );

  /**
   * 접두사가 같은 조회를 한꺼번에 고친다.
   *
   * 같은 목록을 열쇠만 다르게 여러 벌 담아 두는 화면이 있다 —
   * 관심종목은 폴더마다, 내 자산은 포트폴리오마다. 하나만 고치면
   * 탭을 옮기는 순간 옛 값이 다시 보인다.
   */
  const 미리여럿 = useCallback(
    async <T,>(접두사: QueryKey, 바꾸기: (앞: T | undefined) => T | undefined): Promise<되돌릴것[]> => {
      await qc.cancelQueries({ queryKey: 접두사 });
      const 것들 = qc.getQueriesData({ queryKey: 접두사 });
      const 담은것: 되돌릴것[] = [];
      for (const [열쇠, 이전] of 것들) {
        담은것.push({ 열쇠, 이전 });
        qc.setQueryData<T | undefined>(열쇠, (앞) => 바꾸기(앞));
      }
      return 담은것;
    },
    [qc],
  );

  /**
   * 실패했을 때 되돌린다.
   *
   * onMutate 가 돌려준 것을 그대로 넘기면 된다 — 하나든 여럿이든.
   * undefined 면 아무것도 안 한다(onMutate 가 터졌을 때 그렇게 온다).
   */
  const 되돌리기 = useCallback(
    (ctx: 되돌릴것 | 되돌릴것[] | undefined | null) => {
      if (!ctx) return;
      for (const c of Array.isArray(ctx) ? ctx : [ctx]) {
        /* undefined 를 그대로 넣으면 '값 없음' 이 아니라 '캐시에 undefined
           를 담는다' 가 된다. 조회가 없던 상태로 되돌리려면 지워야 한다 */
        if (c.이전 === undefined) qc.removeQueries({ queryKey: c.열쇠, exact: true });
        else qc.setQueryData(c.열쇠, c.이전);
      }
    },
    [qc],
  );

  return { qc, 미리, 미리여럿, 되돌리기 };
}

/**
 * 목록에서 한 줄을 지운다 — 낙관 갱신에서 제일 흔한 모양.
 *
 * 배열이 그냥 오기도 하고 {items:[...]} 로 감싸여 오기도 한다.
 * 부르는 쪽마다 따로 다루면 한쪽만 고쳐진다.
 */
export function 목록에서빼기<T extends { id: number }>(앞: unknown, id: number): unknown {
  if (Array.isArray(앞)) return (앞 as T[]).filter((x) => x.id !== id);
  const o = 앞 as { items?: T[] } | undefined;
  if (o && Array.isArray(o.items)) return { ...o, items: o.items.filter((x) => x.id !== id) };
  return 앞;
}

/** 목록에서 한 줄을 고친다 */
export function 목록에서고치기<T extends { id: number }>(
  앞: unknown, id: number, 고침: Partial<T>,
): unknown {
  const 바꿔 = (arr: T[]) => arr.map((x) => (x.id === id ? { ...x, ...고침 } : x));
  if (Array.isArray(앞)) return 바꿔(앞 as T[]);
  const o = 앞 as { items?: T[] } | undefined;
  if (o && Array.isArray(o.items)) return { ...o, items: 바꿔(o.items) };
  return 앞;
}
