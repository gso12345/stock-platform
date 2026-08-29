/**
 * 화면에서 고른 것을 기억한다.
 *
 * 내 자산에서 포트폴리오를 고르거나, 전체 보기에서 볼 포트폴리오를
 * 체크해도 **아무 데도 안 남았다.** 그냥 useState 였다. 새로고침하거나
 * 다른 화면에 갔다 오면 매번 처음 상태로 돌아간다 — 사용자에게는
 * '저장이 안 된다' 로 보인다. 맞는 말이다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { use저장된값, use저장된Set } from "@/hooks/useSaved";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* 무시 */ }
});

describe("use저장된값", () => {
  it("담고 다시 열면 그대로다", () => {
    const 첫번째 = renderHook(() => use저장된값<number | null>("탭", null));
    act(() => { 첫번째.result.current[1](7); });
    expect(첫번째.result.current[0]).toBe(7);

    // 새로고침 = 훅을 처음부터 다시 띄우는 것
    const 두번째 = renderHook(() => use저장된값<number | null>("탭", null));
    expect(두번째.result.current[0]).toBe(7);
  });

  it("담긴 게 없으면 기본값", () => {
    const { result } = renderHook(() => use저장된값("없던것", "기본"));
    expect(result.current[0]).toBe("기본");
  });

  it("함수형 갱신도 된다", () => {
    const { result } = renderHook(() => use저장된값("수", 1));
    act(() => { result.current[1]((앞) => 앞 + 1); });
    expect(result.current[0]).toBe(2);
    expect(renderHook(() => use저장된값("수", 1)).result.current[0]).toBe(2);
  });

  it("되살리기로 못 쓸 값을 걸러낸다", () => {
    /* 지운 포트폴리오 id 가 담겨 있을 수 있다. 그대로 되살리면
       없는 것을 고른 채로 화면이 열린다 */
    localStorage.setItem("내자산:탭", JSON.stringify("망가진값"));
    const { result } = renderHook(() =>
      use저장된값<number | null>("탭", null,
        (담긴것) => (typeof 담긴것 === "number" ? 담긴것 : undefined)));
    expect(result.current[0]).toBeNull();
  });

  it("손상된 것에 터지지 않는다", () => {
    localStorage.setItem("내자산:탭", "{망가진");
    const { result } = renderHook(() => use저장된값("탭", "기본"));
    expect(result.current[0]).toBe("기본");
  });

  it("브라우저가 저장을 막아도 화면이 안 터진다", () => {
    /* 시크릿 창·용량 초과. 기억을 못 하는 것은 불편이지만,
       그것 때문에 화면이 하얗게 되는 건 완전히 다른 문제다 */
    const 원래 = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("막힘"); };
    try {
      const { result } = renderHook(() => use저장된값("탭", 1));
      expect(() => act(() => { result.current[1](2); })).not.toThrow();
      expect(result.current[0]).toBe(2);      // 화면은 그대로 돈다
    } finally {
      Storage.prototype.setItem = 원래;
    }
  });

  it("읽기가 막혀도 안 터진다", () => {
    const 원래 = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error("막힘"); };
    try {
      const { result } = renderHook(() => use저장된값("탭", "기본"));
      expect(result.current[0]).toBe("기본");
    } finally {
      Storage.prototype.getItem = 원래;
    }
  });

  it("열쇠가 다르면 안 섞인다", () => {
    const a = renderHook(() => use저장된값("가", 1));
    act(() => { a.result.current[1](10); });
    expect(renderHook(() => use저장된값("나", 1)).result.current[0]).toBe(1);
  });
});

describe("use저장된Set", () => {
  it("담고 다시 열면 그대로다", () => {
    const 첫번째 = renderHook(() => use저장된Set<number>("제외"));
    act(() => { 첫번째.result.current[1](new Set([1, 3])); });
    expect([...첫번째.result.current[0]].sort()).toEqual([1, 3]);

    const 두번째 = renderHook(() => use저장된Set<number>("제외"));
    expect([...두번째.result.current[0]].sort()).toEqual([1, 3]);
  });

  it("함수형 갱신으로 켜고 끈다", () => {
    const { result } = renderHook(() => use저장된Set<number>("제외"));
    const 뒤집기 = (id: number) => {
      act(() => {
        result.current[1]((앞) => {
          const 다음 = new Set(앞);
          if (다음.has(id)) 다음.delete(id); else 다음.add(id);
          return 다음;
        });
      });
    };
    뒤집기(2);
    expect(result.current[0].has(2)).toBe(true);
    뒤집기(2);
    expect(result.current[0].has(2)).toBe(false);
    // 지운 것도 남아야 한다 — '전부 포함' 이 담긴 상태다
    expect([...renderHook(() => use저장된Set<number>("제외")).result.current[0]]).toEqual([]);
  });

  it("담긴 게 배열이 아니면 기본값", () => {
    localStorage.setItem("내자산:제외", JSON.stringify({ 이상한: 1 }));
    const { result } = renderHook(() => use저장된Set<number>("제외"));
    expect([...result.current[0]]).toEqual([]);
  });

  it("안 바뀌면 같은 Set 을 돌려준다", () => {
    /* 매 렌더마다 새 Set 을 만들면 이 값을 의존성으로 쓰는 useMemo 가
       전부 다시 돈다 — 보유 목록 전체를 매번 다시 거르는 셈이다 */
    const { result, rerender } = renderHook(() => use저장된Set<number>("제외"));
    const 처음 = result.current[0];
    rerender();
    expect(result.current[0]).toBe(처음);
  });
});

describe("내 자산 화면에 실제로 붙어 있는가", () => {
  /* 훅만 맞고 화면이 안 쓰면 아무 소용이 없다 */
  it("고른 포트폴리오와 전체보기 제외를 둘 다 담는다", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const 소스 = fs.readFileSync(
      path.resolve(__dirname, "../../pages/Portfolio.tsx"), "utf-8");
    expect(소스).toContain("use저장된값<SelectedPortfolio | null>");
    expect(소스).toContain("use저장된Set<number>");
    // 옛 방식이 남아 있으면 저장이 안 된다
    expect(소스).not.toContain("useState<SelectedPortfolio | null>(null)");
    expect(소스).not.toContain("useState<Set<number>>(new Set())");
  });
});

/* 이 파일은 브라우저 저장소를 직접 만진다. 다른 검사로 새지 않게 치운다 */
afterEach(() => {
  try { localStorage.clear(); } catch { /* 무시 */ }
});
