/**
 * 누른 즉시 화면을 고치는 공용 도구.
 *
 * 코드를 세어 보니 useMutation 이 마흔여섯 군데인데 낙관 갱신을 한
 * 곳은 몇 곳뿐이었다. 나머지는 이랬다 —
 *
 *   누름 → 서버 왕복(1) → invalidateQueries → 목록 다시 받기(2)
 *        → 그제서야 화면이 바뀐다
 *
 * 한 칸이 한국↔싱가포르 왕복이라, 누르고 나서 한참을 아무 일도 안
 * 일어난 것처럼 보인다. 그래서 사람은 한 번 더 누른다.
 *
 * 여기서 못 박는 것은 셋이다.
 *   1) 날아가 있는 조회를 먼저 취소한다 (안 그러면 옛 값이 덮어쓴다)
 *   2) 실패하면 되돌린다 (안 되돌리면 화면과 서버가 영영 어긋난다)
 *   3) 없던 조회는 '되돌릴 때 지운다' (undefined 를 담으면 안 된다)
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { use낙관, 목록에서빼기, 목록에서고치기 } from "@/hooks/useOptimistic";

function 띄우기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => use낙관(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
  return { qc, 훅: result };
}

describe("미리 — 캐시를 지금 자리에서 고친다", () => {
  it("고치고, 이전 값을 돌려준다", async () => {
    const { qc, 훅 } = 띄우기();
    qc.setQueryData(["줄들"], [{ id: 1 }, { id: 2 }]);

    let 되돌릴것: unknown;
    await act(async () => {
      되돌릴것 = await 훅.current.미리(["줄들"], (앞: { id: number }[] | undefined) =>
        (앞 ?? []).filter((x) => x.id !== 1));
    });

    expect(qc.getQueryData(["줄들"])).toEqual([{ id: 2 }]);
    expect((되돌릴것 as { 이전: unknown }).이전).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("되돌리면 원래대로", async () => {
    const { qc, 훅 } = 띄우기();
    qc.setQueryData(["줄들"], [{ id: 1 }, { id: 2 }]);
    let ctx: never;
    await act(async () => {
      ctx = (await 훅.current.미리(["줄들"], () => [])) as never;
      훅.current.되돌리기(ctx);
    });
    expect(qc.getQueryData(["줄들"])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("없던 조회는 되돌릴 때 지운다", async () => {
    /* undefined 를 그대로 담으면 '값 없음' 이 아니라 '캐시에 undefined
       가 있음' 이 된다 — 그 뒤로 조회가 안 돈다 */
    const { qc, 훅 } = 띄우기();
    await act(async () => {
      const ctx = await 훅.current.미리(["없던것"], () => [{ id: 9 }]);
      훅.current.되돌리기(ctx);
    });
    expect(qc.getQueryState(["없던것"])).toBeUndefined();
  });

  it("아무것도 안 넘기면 조용히 넘어간다", () => {
    /* onMutate 가 터지면 ctx 가 undefined 로 온다. 거기서 또 터지면
       원래 오류가 뭐였는지 알 수 없게 된다 */
    const { 훅 } = 띄우기();
    expect(() => 훅.current.되돌리기(undefined)).not.toThrow();
    expect(() => 훅.current.되돌리기(null)).not.toThrow();
  });
});

describe("미리여럿 — 접두사가 같은 조회를 한꺼번에", () => {
  it("같은 목록을 여러 벌 담아 둔 화면을 다 고친다", async () => {
    /* 관심종목은 폴더마다, 내 자산은 포트폴리오마다 같은 목록을
       열쇠만 다르게 담는다. 하나만 고치면 탭을 옮기는 순간 옛 값이
       다시 보인다 */
    const { qc, 훅 } = 띄우기();
    qc.setQueryData(["목록", 1], [{ id: 1 }, { id: 2 }]);
    qc.setQueryData(["목록", 2], [{ id: 1 }, { id: 3 }]);

    await act(async () => {
      await 훅.current.미리여럿(["목록"], (앞: { id: number }[] | undefined) =>
        (앞 ?? []).filter((x) => x.id !== 1));
    });
    expect(qc.getQueryData(["목록", 1])).toEqual([{ id: 2 }]);
    expect(qc.getQueryData(["목록", 2])).toEqual([{ id: 3 }]);
  });

  it("여럿도 한 번에 되돌린다", async () => {
    const { qc, 훅 } = 띄우기();
    qc.setQueryData(["목록", 1], [{ id: 1 }]);
    qc.setQueryData(["목록", 2], [{ id: 2 }]);
    await act(async () => {
      const ctx = await 훅.current.미리여럿(["목록"], () => []);
      훅.current.되돌리기(ctx);
    });
    expect(qc.getQueryData(["목록", 1])).toEqual([{ id: 1 }]);
    expect(qc.getQueryData(["목록", 2])).toEqual([{ id: 2 }]);
  });
});

describe("목록 다루기 — 두 모양을 다 받는다", () => {
  /* 배열이 그냥 오기도 하고 {items:[...]} 로 감싸여 오기도 한다.
     부르는 쪽마다 따로 다루면 한쪽만 고쳐진다 */
  it("배열에서 빼기", () => {
    expect(목록에서빼기([{ id: 1 }, { id: 2 }], 1)).toEqual([{ id: 2 }]);
  });

  it("{items} 에서 빼기 — 다른 칸은 안 건드린다", () => {
    const 뒤 = 목록에서빼기({ items: [{ id: 1 }, { id: 2 }], total: 2 }, 1) as
      { items: { id: number }[]; total: number };
    expect(뒤.items).toEqual([{ id: 2 }]);
    expect(뒤.total).toBe(2);
  });

  it("배열에서 고치기", () => {
    expect(목록에서고치기<{ id: number; name: string }>([{ id: 1, name: "앞" }], 1, { name: "뒤" }))
      .toEqual([{ id: 1, name: "뒤" }]);
  });

  it("{items} 에서 고치기", () => {
    const 뒤 = 목록에서고치기<{ id: number; name: string }>({ items: [{ id: 1, name: "앞" }] }, 1, { name: "뒤" }) as
      { items: { id: number; name: string }[] };
    expect(뒤.items[0].name).toBe("뒤");
  });

  it("모르는 모양은 그대로 둔다", () => {
    expect(목록에서빼기(undefined, 1)).toBeUndefined();
    expect(목록에서고치기(null, 1, {})).toBeNull();
    expect(목록에서빼기({ 딴것: 1 }, 1)).toEqual({ 딴것: 1 });
  });

  it("없는 id 면 아무것도 안 바뀐다", () => {
    const 앞 = [{ id: 1 }];
    expect(목록에서빼기(앞, 99)).toEqual([{ id: 1 }]);
  });
});


describe("날아가 있는 조회를 먼저 취소한다", () => {
  it("늦게 도착한 응답이 방금 고친 화면을 덮어쓰지 않는다", async () => {
    /* 여기가 취소를 하는 이유다.
     *
     * 목록을 다시 받는 중에 사용자가 한 줄을 지웠다고 하자. 취소하지
     * 않으면 그 조회가 몇 백 밀리초 뒤에 **지우기 전 목록**을 들고
     * 도착해서 캐시를 덮어쓴다. 화면에서는 지운 줄이 되살아난다 —
     * 사용자에게는 '지웠는데 다시 생겼다' 로 보인다.
     */
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => use낙관(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    let 응답풀기: (v: { id: number }[]) => void = () => {};
    const 늦은조회 = qc.fetchQuery({
      queryKey: ["줄들"],
      queryFn: () => new Promise<{ id: number }[]>((r) => { 응답풀기 = r; }),
    }).catch(() => { /* 취소되면 여기로 온다 — 정상이다 */ });

    // 조회가 아직 날아가 있는 동안 한 줄을 지운다
    await act(async () => {
      await result.current.미리(["줄들"], () => [{ id: 2 }]);
    });
    expect(qc.getQueryData(["줄들"])).toEqual([{ id: 2 }]);

    // 이제 옛 응답이 도착한다 — 지우기 전 목록이다
    await act(async () => {
      응답풀기([{ id: 1 }, { id: 2 }]);
      await 늦은조회;
    });

    expect(qc.getQueryData(["줄들"]), "옛 응답이 덮어썼다").toEqual([{ id: 2 }]);
  });
});
