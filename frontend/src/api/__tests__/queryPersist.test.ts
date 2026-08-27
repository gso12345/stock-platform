/**
 * 지난번에 받아 둔 것을 남겼다가 다음에 바로 보여 주기.
 *
 * 이 기능은 잘못 만들면 세 가지로 사람을 다치게 한다 —
 *
 *   1) 남의 것을 보여 준다. 공용 기기에서 앞사람의 자산·관심종목이
 *      다음 사람 화면에 뜬다.
 *   2) 옛날 값이 눌러앉는다. 되살리면서 '방금 받았다' 로 표시하면
 *      react-query 가 신선하다고 보고 새로 안 받아 온다.
 *   3) 사흘 전 코스피가 잠깐 떴다 바뀐다. 빈 화면보다 나쁘다 —
 *      그 값을 보고 판단할 수도 있다.
 *
 * 아래 검사는 그 셋을 하나씩 막는다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  담을만한가, 골라담기, 되살릴것, 되살리기, 저장하기, 붙이기,
  최대나이, 최대바이트, 항목최대바이트, 남길것들,
} from "@/api/queryPersist";

const 지금 = 1_800_000_000_000;

function 항목(key: unknown[], data: unknown, t = 지금, status = "success") {
  return { queryKey: key, state: { data, dataUpdatedAt: t, status } };
}

beforeEach(() => {
  localStorage.clear();
});

describe("무엇을 남기나 — 누가 보느냐와 무관한 것만", () => {
  it.each(남길것들.map((k) => [k]))("%s 는 남긴다", (이름) => {
    expect(담을만한가([이름, "아무거나"])).toBe(true);
  });

  it.each([
    ["portfolio-items"], ["portfolio-history"], ["portfolio-news"],
    ["watchlist-items"], ["notifications-unread"], ["feed"], ["my-profile"],
    ["dividend-calendar"], ["stock-detail"],
  ])("%s 는 안 남긴다 — 로그인한 사람의 것이거나 남의 것이 될 수 있다", (이름) => {
    expect(담을만한가([이름, 1])).toBe(false);
  });

  it("이름표가 배열이 아니면 안 남긴다", () => {
    expect(담을만한가("dashboard-kr")).toBe(false);
    expect(담을만한가(null)).toBe(false);
    expect(담을만한가([])).toBe(false);
  });

  it("첫 칸만 본다 — 뒤 칸에 허용 이름이 있다고 통과시키지 않는다", () => {
    expect(담을만한가(["portfolio-items", "dashboard-kr"])).toBe(false);
  });
});

describe("골라담기", () => {
  it("허용된 것만 담는다", () => {
    const 담김 = 골라담기([
      항목(["dashboard-kr"], { a: 1 }),
      항목(["portfolio-items"], { 내자산: 1 }),
      항목(["news", "kr", "latest"], [1, 2]),
    ], 지금);
    expect(담김.map((x) => x.k[0])).toEqual(["dashboard-kr", "news"]);
  });

  it("실패한 조회는 안 담는다", () => {
    /* 되살려 봐야 화면에 아무것도 못 그리면서 '이미 받았다' 로 표시돼
       새로 받는 것만 늦춘다 */
    expect(골라담기([항목(["dashboard-kr"], undefined, 지금, "error")], 지금)).toHaveLength(0);
    expect(골라담기([항목(["dashboard-kr"], null, 지금, "success")], 지금)).toHaveLength(0);
  });

  it("받은 시각이 없으면 안 담는다 — 언제 것인지 모르면 되살릴 수 없다", () => {
    expect(골라담기([항목(["dashboard-kr"], { a: 1 }, 0)], 지금)).toHaveLength(0);
  });

  it("여섯 시간이 지난 것은 안 담는다", () => {
    expect(골라담기([항목(["dashboard-kr"], { a: 1 }, 지금 - 최대나이 - 1)], 지금)).toHaveLength(0);
    expect(골라담기([항목(["dashboard-kr"], { a: 1 }, 지금 - 최대나이 + 1000)], 지금)).toHaveLength(1);
  });

  it("혼자 너무 큰 항목은 뺀다", () => {
    const 큰것 = "x".repeat(항목최대바이트 + 100);
    const 담김 = 골라담기([
      항목(["news", "kr"], 큰것),
      항목(["dashboard-kr"], { a: 1 }),
    ], 지금);
    expect(담김.map((x) => x.k[0])).toEqual(["dashboard-kr"]);
  });

  it("다 합쳐 상한을 넘으면 거기서 멈춘다", () => {
    /* localStorage 는 보통 5MB 다. 넘치면 setItem 이 통째로 실패해서
       아무것도 안 남는다 — 하나도 못 남기느니 앞의 것만 남긴다 */
    const 한덩이 = "y".repeat(항목최대바이트 - 200);
    const 넣을것 = Array.from({ length: 10 }, (_, i) => 항목(["news", `k${i}`], 한덩이));
    const 담김 = 골라담기(넣을것, 지금);
    const 크기 = JSON.stringify(담김).length;
    expect(크기).toBeLessThanOrEqual(최대바이트);
    expect(담김.length).toBeGreaterThan(0);
    expect(담김.length).toBeLessThan(10);
  });

  it("JSON 으로 못 만드는 값은 조용히 넘어간다", () => {
    const 돌고도는것: Record<string, unknown> = {};
    돌고도는것.자기 = 돌고도는것;
    const 담김 = 골라담기([
      항목(["dashboard-kr"], 돌고도는것),
      항목(["dashboard-us"], { b: 2 }),
    ], 지금);
    expect(담김.map((x) => x.k[0])).toEqual(["dashboard-us"]);
  });
});

describe("되살릴것", () => {
  it("담긴 게 배열이 아니면 아무것도 안 준다", () => {
    expect(되살릴것(null)).toEqual([]);
    expect(되살릴것({ a: 1 })).toEqual([]);
    expect(되살릴것("깨진값")).toEqual([]);
  });

  it("허용 목록에 없는 것이 섞여 있으면 그것만 뺀다", () => {
    /* localStorage 는 사용자가 직접 고칠 수 있다. 담을 때만 거르고
       되살릴 때 안 거르면, 손으로 넣은 값이 그대로 캐시에 들어간다 */
    const 쓸것 = 되살릴것([
      { k: ["dashboard-kr"], d: { a: 1 }, t: 지금 },
      { k: ["portfolio-items"], d: { 내자산: 1 }, t: 지금 },
    ], 지금);
    expect(쓸것).toHaveLength(1);
    expect(쓸것[0].k[0]).toBe("dashboard-kr");
  });

  it("오래된 것은 되살리지 않는다", () => {
    const 쓸것 = 되살릴것([{ k: ["dashboard-kr"], d: { a: 1 }, t: 지금 - 최대나이 - 1 }], 지금);
    expect(쓸것).toEqual([]);
  });

  it("모양이 깨진 줄은 건너뛴다", () => {
    const 쓸것 = 되살릴것([
      null, 3, { k: "문자열", d: 1, t: 지금 }, { k: ["news"], t: 지금 },
      { k: ["news", "kr"], d: [1], t: 지금 },
    ], 지금);
    expect(쓸것).toHaveLength(1);
  });
});

describe("되살리기 — 캐시에 실제로 넣는다", () => {
  function 새캐시() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
  }

  it("담아 둔 값을 그대로 꺼내 놓는다", () => {
    localStorage.setItem("qcache_v1", JSON.stringify([
      { k: ["dashboard-kr"], d: { kospi: { value: 2600 } }, t: 지금 - 1000 },
    ]));
    const qc = 새캐시();
    expect(되살리기(qc, 지금)).toBe(1);
    expect(qc.getQueryData(["dashboard-kr"])).toEqual({ kospi: { value: 2600 } });
  });

  it("'받은 시각' 을 그때 값 그대로 넣는다", () => {
    /* 여기가 핵심이다. 지금 시각을 넣으면 react-query 가 신선하다고
       보고(staleTime 5분) 새로 안 받아 온다 — 옛날 값이 눌러앉는다 */
    const 받은때 = 지금 - 60_000;
    localStorage.setItem("qcache_v1", JSON.stringify([
      { k: ["dashboard-kr"], d: { a: 1 }, t: 받은때 },
    ]));
    const qc = 새캐시();
    되살리기(qc, 지금);
    const 상태 = qc.getQueryCache().find({ queryKey: ["dashboard-kr"] })?.state;
    expect(상태?.dataUpdatedAt).toBe(받은때);
  });

  it("담긴 게 없거나 깨져 있어도 안 터진다", () => {
    const qc = 새캐시();
    expect(되살리기(qc, 지금)).toBe(0);
    localStorage.setItem("qcache_v1", "{깨진 JSON");
    expect(되살리기(qc, 지금)).toBe(0);
  });

  it("localStorage 를 못 읽어도 안 터진다", () => {
    const 원래 = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error("사생활 보호 모드"); };
    try {
      expect(되살리기(새캐시(), 지금)).toBe(0);
    } finally {
      Storage.prototype.getItem = 원래;
    }
  });
});

describe("저장하기", () => {
  it("캐시에 있는 것 중 남길 것만 쓴다", () => {
    const qc = new QueryClient();
    qc.setQueryData(["dashboard-kr"], { a: 1 }, { updatedAt: 지금 });
    qc.setQueryData(["portfolio-items"], [{ 내자산: 1 }], { updatedAt: 지금 });
    저장하기(qc, 지금);
    const 글 = localStorage.getItem("qcache_v1")!;
    expect(글).toContain("dashboard-kr");
    expect(글).not.toContain("portfolio-items");
  });

  it("남길 게 하나도 없으면 자리를 비운다", () => {
    /* 안 지우면 로그아웃한 뒤에도 지난 값이 계속 남는다 */
    localStorage.setItem("qcache_v1", JSON.stringify([{ k: ["dashboard-kr"], d: 1, t: 지금 }]));
    저장하기(new QueryClient(), 지금);
    expect(localStorage.getItem("qcache_v1")).toBeNull();
  });

  it("용량이 넘쳐도 안 터진다", () => {
    const 원래 = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("QuotaExceededError"); };
    try {
      const qc = new QueryClient();
      qc.setQueryData(["dashboard-kr"], { a: 1 }, { updatedAt: 지금 });
      expect(() => 저장하기(qc, 지금)).not.toThrow();
    } finally {
      Storage.prototype.setItem = 원래;
    }
  });
});

describe("붙이기 — 몰아서 쓴다", () => {
  it("캐시가 여러 번 바뀌어도 한 번만 쓴다", () => {
    /* 대시보드 하나 여는 동안 캐시 이벤트가 수십 번 난다. 그때마다
       JSON.stringify 를 하면 그 자체가 화면을 버벅이게 한다 */
    vi.useFakeTimers();
    const qc = new QueryClient();
    const 쓴횟수 = vi.spyOn(Storage.prototype, "setItem");
    const 떼기 = 붙이기(qc, 1000);
    try {
      for (let i = 0; i < 20; i++) {
        qc.setQueryData(["dashboard-kr"], { a: i }, { updatedAt: Date.now() });
      }
      expect(쓴횟수).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1001);
      expect(쓴횟수).toHaveBeenCalledTimes(1);
    } finally {
      떼기();
      쓴횟수.mockRestore();
      vi.useRealTimers();
    }
  });

  it("화면을 떠날 때 한 번 더 쓴다", () => {
    /* 뜸 들이는 동안 탭을 닫으면 방금 받은 것이 통째로 안 남는다 */
    vi.useFakeTimers();
    const qc = new QueryClient();
    const 떼기 = 붙이기(qc, 10_000);
    try {
      qc.setQueryData(["dashboard-kr"], { a: 1 }, { updatedAt: Date.now() });
      localStorage.clear();
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(localStorage.getItem("qcache_v1")).toContain("dashboard-kr");
    } finally {
      떼기();
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      vi.useRealTimers();
    }
  });

  it("떼면 더 이상 안 쓴다", () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    붙이기(qc, 1000)();
    const 쓴횟수 = vi.spyOn(Storage.prototype, "setItem");
    try {
      qc.setQueryData(["dashboard-kr"], { a: 1 }, { updatedAt: Date.now() });
      vi.advanceTimersByTime(5000);
      expect(쓴횟수).not.toHaveBeenCalled();
    } finally {
      쓴횟수.mockRestore();
      vi.useRealTimers();
    }
  });
});
