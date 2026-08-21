/**
 * 좋아요 단추가 틀리게 하던 세 가지.
 *
 * 같은 코드가 네 곳에 복사돼 있었고(글 상세의 댓글·답글, 모달의
 * 댓글·답글) 네 벌 다 똑같이 틀렸다. 한 벌로 모으면서 고쳤으니,
 * 다시 틀어지지 않게 여기에 못 박아 둔다.
 */
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const 이동 = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => 이동 }));

let 로그인함 = true;
vi.mock("@/store/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: 로그인함 }),
}));

import { use좋아요 } from "../useLike";

beforeEach(() => { 로그인함 = true; 이동.mockClear(); });
afterEach(cleanup);

/** 손으로 풀었다 조였다 할 수 있는 약속 */
function 미룬약속<T>() {
  let 풀기!: (v: T) => void;
  let 깨기!: (e?: unknown) => void;
  const 약속 = new Promise<T>((res, rej) => { 풀기 = res; 깨기 = rej; });
  return { 약속, 풀기, 깨기 };
}

describe("use좋아요 — 기본 동작", () => {
  it("처음 값을 그대로 보여 준다", () => {
    const { result } = renderHook(() => use좋아요(true, 7, async () => {}));
    expect(result.current.눌림).toBe(true);
    expect(result.current.수).toBe(7);
  });

  it("누르면 서버 응답을 기다리지 않고 먼저 뒤집는다", async () => {
    const { 약속, 풀기 } = 미룬약속<{ liked: boolean; like_count: number }>();
    const { result } = renderHook(() => use좋아요(false, 3, () => 약속));

    act(() => { void result.current.누르기(); });
    expect(result.current.눌림).toBe(true);
    expect(result.current.수).toBe(4);        // 아직 서버는 답하지 않았다

    await act(async () => { 풀기({ liked: true, like_count: 4 }); await 약속; });
    expect(result.current.수).toBe(4);
  });

  it("눌린 것을 다시 누르면 하나 준다", async () => {
    const { result } = renderHook(() =>
      use좋아요(true, 5, async () => ({ liked: false, like_count: 4 })));
    await act(async () => { await result.current.누르기(); });
    expect(result.current.눌림).toBe(false);
    expect(result.current.수).toBe(4);
  });

  it("0 밑으로는 내려가지 않는다", async () => {
    const { result } = renderHook(() => use좋아요(true, 0, async () => {}));
    await act(async () => { await result.current.누르기(); });
    expect(result.current.수).toBe(0);
  });
});

describe("1. 서버 답을 쓴다 — 옛 코드는 응답을 버렸다", () => {
  it("화면이 들고 있던 값이 틀렸으면 서버 값으로 맞춘다", async () => {
    /* 다른 기기에서 이미 눌러 둔 상황. 화면은 '안 눌림' 으로 알고
       있어서 켜려 하지만, 서버는 토글이라 반대로 꺼진다 */
    const { result } = renderHook(() =>
      use좋아요(false, 10, async () => ({ liked: false, like_count: 9 })));

    await act(async () => { await result.current.누르기(); });

    expect(result.current.눌림).toBe(false);   // 추측(true) 이 아니라 서버 값
    expect(result.current.수).toBe(9);
  });

  it("서버가 수를 안 주면 먼저 뒤집어 둔 값을 유지한다", async () => {
    const { result } = renderHook(() =>
      use좋아요(false, 2, async () => ({ liked: true })));
    await act(async () => { await result.current.누르기(); });
    expect(result.current.수).toBe(3);
  });

  it("서버가 아무것도 안 주면 먼저 뒤집어 둔 값을 유지한다", async () => {
    const { result } = renderHook(() => use좋아요(false, 2, async () => null));
    await act(async () => { await result.current.누르기(); });
    expect(result.current.눌림).toBe(true);
    expect(result.current.수).toBe(3);
  });
});

describe("2. 되돌릴 때 '누르기 직전' 으로 간다 — 옛 코드는 처음 값으로 갔다", () => {
  it("한 번 성공한 뒤 실패하면 그 성공한 값으로 돌아간다", async () => {
    let 회차 = 0;
    const 보내기 = vi.fn(async () => {
      회차 += 1;
      if (회차 === 1) return { liked: true, like_count: 6 };
      throw new Error("실패");
    });
    /* 처음 5, 눌러서 6(성공), 다시 눌러서 5(실패) → 6 으로 돌아와야 한다.
       옛 코드는 prop 인 5 로 돌아가서, 하트는 켜져 있는데 수는 5 였다 */
    const { result } = renderHook(() => use좋아요(false, 5, 보내기));

    await act(async () => { await result.current.누르기(); });
    expect(result.current.수).toBe(6);

    await act(async () => { await result.current.누르기(); });
    expect(result.current.눌림).toBe(true);
    expect(result.current.수).toBe(6);         // 5 가 아니다
  });

  it("첫 시도가 실패하면 처음 값 그대로다", async () => {
    const { result } = renderHook(() =>
      use좋아요(false, 5, async () => { throw new Error("실패"); }));
    await act(async () => { await result.current.누르기(); });
    expect(result.current.눌림).toBe(false);
    expect(result.current.수).toBe(5);
  });
});

describe("3. 연타를 막는다 — 옛 코드는 그대로 다 보냈다", () => {
  it("답이 오기 전에 또 누르면 두 번째는 무시한다", async () => {
    const { 약속, 풀기 } = 미룬약속<{ liked: boolean; like_count: number }>();
    const 보내기 = vi.fn(() => 약속);
    const { result } = renderHook(() => use좋아요(false, 1, 보내기));

    act(() => { void result.current.누르기(); });
    act(() => { void result.current.누르기(); });
    act(() => { void result.current.누르기(); });

    expect(보내기).toHaveBeenCalledTimes(1);
    expect(result.current.수).toBe(2);          // 4 가 아니다

    await act(async () => { 풀기({ liked: true, like_count: 2 }); await 약속; });
  });

  it("답이 온 뒤에는 다시 누를 수 있다", async () => {
    const 보내기 = vi.fn(async () => ({ liked: true, like_count: 2 }));
    const { result } = renderHook(() => use좋아요(false, 1, 보내기));
    await act(async () => { await result.current.누르기(); });
    await act(async () => { await result.current.누르기(); });
    expect(보내기).toHaveBeenCalledTimes(2);
  });

  it("실패한 뒤에도 다시 누를 수 있다", async () => {
    const 보내기 = vi.fn(async () => { throw new Error("실패"); });
    const { result } = renderHook(() => use좋아요(false, 1, 보내기));
    await act(async () => { await result.current.누르기(); });
    await act(async () => { await result.current.누르기(); });
    expect(보내기).toHaveBeenCalledTimes(2);
  });
});

describe("로그인하지 않았으면", () => {
  it("서버로 보내지 않고 로그인 화면으로 보낸다", async () => {
    로그인함 = false;
    const 보내기 = vi.fn(async () => ({ liked: true, like_count: 2 }));
    const { result } = renderHook(() => use좋아요(false, 1, 보내기));

    await act(async () => { await result.current.누르기(); });

    expect(보내기).not.toHaveBeenCalled();
    expect(이동).toHaveBeenCalledWith("/login");
    expect(result.current.눌림).toBe(false);    // 화면도 그대로여야 한다
    expect(result.current.수).toBe(1);
  });
});

describe("쓰는 곳", () => {
  it("네 곳 모두 이 갈고리를 쓴다", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const 뿌리 = path.resolve(__dirname, "../..");
    for (const rel of ["pages/PostDetail.tsx", "components/community/PostDetailModal.tsx"]) {
      const s = fs.readFileSync(path.join(뿌리, rel), "utf-8");
      expect(s).toContain('from "@/hooks/useLike"');
      /* 한 파일에 댓글·답글 두 곳 */
      expect(s.split("use좋아요(").length - 1).toBe(2);
      expect(s).not.toContain("setLikeCount");
    }
  });
});

describe("옛 방식이 돌아오지 않게", () => {
  it("갈고리 안에 연타 잠금이 있다", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const s = fs.readFileSync(path.resolve(__dirname, "../useLike.ts"), "utf-8");
    expect(s).toContain("useRef");
  });
});

describe("모달의 공유 주소", () => {
  it("종목 게시판이 아니라 글 주소를 복사한다", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const s = fs.readFileSync(
      path.resolve(__dirname, "../../components/community/PostDetailModal.tsx"), "utf-8");
    const 코드만 = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    /* handleShare 안만 본다 — 종목 게시판으로 가는 링크는 화면 위쪽에
       따로 있고 그건 맞는 링크다 */
    const 시작 = 코드만.indexOf("const handleShare");
    expect(시작).toBeGreaterThan(-1);
    const 몸통 = 코드만.slice(시작, 코드만.indexOf("};", 시작));
    expect(몸통).toContain("/post/${post.id}");
    expect(몸통).not.toContain("post.symbol");
  });
});

describe("timeAgo 한 벌로", () => {
  it("날짜가 없으면 'NaN분 전' 대신 빈 글", async () => {
    const { timeAgo } = await import("@/utils/formatters");
    expect(timeAgo("")).toBe("");
    expect(timeAgo(null)).toBe("");
    expect(timeAgo(undefined)).toBe("");
    expect(timeAgo("어제")).toBe("");          // 못 읽는 값도 막는다
  });

  it("지난 시간을 사람 말로 적는다", async () => {
    const { timeAgo } = await import("@/utils/formatters");
    const 전 = (분: number) => new Date(Date.now() - 분 * 60_000).toISOString();
    expect(timeAgo(전(0))).toBe("방금 전");
    expect(timeAgo(전(5))).toBe("5분 전");
    expect(timeAgo(전(60 * 3))).toBe("3시간 전");
    expect(timeAgo(전(60 * 24 * 2))).toBe("2일 전");
    expect(timeAgo(전(60 * 24 * 40))).toMatch(/월|\d/);   // 30일 넘으면 날짜
  });

  it("복사본이 한 벌도 남아 있지 않다", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const 뿌리 = path.resolve(__dirname, "../..");
    const 파일들: string[] = [];
    const 훑기 = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "__tests__") 훑기(p); }
        else if (/\.tsx?$/.test(e.name)) 파일들.push(p);
      }
    };
    훑기(뿌리);
    const 정의한곳 = 파일들.filter((p) =>
      /function timeAgo\s*\(/.test(fs.readFileSync(p, "utf-8")));
    expect(정의한곳.map((p) => path.relative(뿌리, p))).toEqual(["utils/formatters.ts"]);
  });
});

describe("waitFor 자리 채우기", () => {
  it("갈고리가 다시 그려져도 상태를 잃지 않는다", async () => {
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => use좋아요(false, n, async () => ({ liked: true, like_count: 9 })),
      { initialProps: { n: 1 } });

    await act(async () => { await result.current.누르기(); });
    await waitFor(() => expect(result.current.수).toBe(9));

    rerender({ n: 1 });
    expect(result.current.수).toBe(9);
  });
});
