/**
 * 관심종목 화면의 첫 그림 — 목록에 딸려 온 시세로 곧바로 채운다.
 *
 * 예전에는 목록을 받은 뒤에야 시세를 물었고(왕복 두 번), 그동안 가격이
 * 전부 빈칸이었다. 게다가 관심종목·보유 목록 중 먼저 온 쪽만으로 시세를
 * 물어서, 뒤엣것이 오면 같은 시세를 한 번 더 받았다.
 *
 * 여기서 못 박는 것 —
 *   1) 시세 조회가 끝나기 전에도 목록에 딸려 온 가격이 보인다
 *   2) 두 목록이 다 온 뒤에 시세를 **한 번만** 묻는다
 *   3) 목록 정의가 한 벌이다 — 서버가 배열만 주는 예전 모양도 읽는다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { 관심목록풀기, 관심씨앗시세열쇠 } from "@/hooks/useWatchlistItems";

vi.mock("react-router-dom", async () => {
  const 실제 = await vi.importActual<any>("react-router-dom");
  return { ...실제, useNavigate: () => vi.fn() };
});

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = { isLoggedIn: true, userId: 7, username: "나" };
    return sel ? sel(s) : s;
  },
}));

const 상태 = vi.hoisted(() => ({
  시세물음: [] as string[][],
  보유풀기: null as null | ((v: unknown) => void),
}));

vi.mock("@/api/stocks", async (원본가져오기) => {
  const 원본 = await 원본가져오기<any>();
  return {
    ...원본,
    watchlistApi: {
      ...원본.watchlistApi,
      getItemsWithCachedPrices: vi.fn(() => Promise.resolve({
        items: [{ id: 1, symbol: "005930.KS", market: "KR", name: "삼성전자", folder_id: 3, folder_name: "기본" }],
        prices: [{ symbol: "005930.KS", market: "KR", price: 71_300, change: 300, change_rate: 0.42 }],
      })),
      /* 시세 조회는 끝나지 않는다 — 그래도 첫 그림은 차야 한다 */
      getPrices: vi.fn((syms: string[]) => { 상태.시세물음.push([...syms].sort()); return new Promise(() => {}); }),
    },
    watchlistFolderApi: { ...원본.watchlistFolderApi, getFolders: vi.fn(() => Promise.resolve([{ id: 3, name: "기본" }])) },
    portfolioApi: {
      ...원본.portfolioApi,
      getPortfolios: vi.fn(() => Promise.resolve([])),
      /* 보유 목록은 늦게 온다 */
      getItemsWithPrices: vi.fn(() => new Promise((풀기) => { 상태.보유풀기 = 풀기; })),
    },
    dashboardApi: { ...원본.dashboardApi, getExchangeRate: vi.fn(() => Promise.resolve({ value: 1300 })) },
  };
});

vi.mock("@/hooks/useWebSocket", () => ({
  usePricesStream: () => ({ status: "idle", send: () => {} }),
}));

import Watchlist from "../Watchlist";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Watchlist /></MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  localStorage.clear();
  상태.시세물음 = [];
  상태.보유풀기 = null;
});

describe("관심종목 첫 그림", () => {
  it("시세 조회가 끝나기 전에도 목록에 딸려 온 가격이 보인다", async () => {
    그리기();
    await screen.findByText("삼성전자");
    expect(await screen.findByText(/71,300/)).toBeTruthy();
  });

  it("두 목록이 다 온 뒤에 시세를 한 번만 묻는다", async () => {
    그리기();
    await screen.findByText("삼성전자");
    await new Promise((r) => setTimeout(r, 50));
    expect(상태.시세물음).toEqual([]);           // 보유 목록이 아직이라 안 묻는다

    상태.보유풀기!({ items: [{ id: 9, symbol: "AAPL", market: "US", name: "애플", shares: 1 }], prices: [] });
    await waitFor(() => expect(상태.시세물음.length).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(상태.시세물음).toEqual([["005930.KS", "AAPL"]]);
  });
});

describe("관심종목 목록 풀기", () => {
  const 가짜qc = () => {
    const 담김 = new Map<string, unknown>();
    return { 담김, setQueryData: (k: readonly unknown[], v: unknown) => { 담김.set(JSON.stringify(k), v); return v; } } as any;
  };

  it("꾸러미면 목록을 돌려주고 시세는 따로 담는다", () => {
    const qc = 가짜qc();
    const 목록 = 관심목록풀기(qc, { items: [{ id: 1, symbol: "A" }], prices: [{ symbol: "A", price: 1 }] });
    expect(목록).toEqual([{ id: 1, symbol: "A" }]);
    expect(qc.담김.get(JSON.stringify(관심씨앗시세열쇠))).toEqual([{ symbol: "A", price: 1 }]);
  });

  it("예전 서버가 배열만 줘도 목록으로 읽는다 — 관심종목이 사라져 보이면 안 된다", () => {
    const qc = 가짜qc();
    expect(관심목록풀기(qc, [{ id: 1, symbol: "A" }] as any)).toEqual([{ id: 1, symbol: "A" }]);
    expect(qc.담김.size).toBe(0);
  });

  it("빈 시세는 담지 않는다", () => {
    const qc = 가짜qc();
    관심목록풀기(qc, { items: [], prices: [] });
    expect(qc.담김.size).toBe(0);
  });
});

describe("목록 정의는 한 벌", () => {
  it("관심종목 목록을 각자 정의하는 화면이 없다", async () => {
    const 파일들 = import.meta.glob("../../**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const 각자 = Object.entries(파일들)
      .filter(([경로]) => !경로.includes("__tests__"))
      .filter(([, 원문]) => /(useQuery|prefetchQuery|fetchQuery)\(\{\s*queryKey:\s*\["watchlist-items"\]/.test(원문))
      .map(([경로]) => 경로);
    expect(각자).toEqual([]);
  });
});

describe("상세 미리받기는 누를 낌새가 보일 때만", () => {
  it("보이는 줄을 전부 미리 받지 않는다 — 시세를 받는 순간에 요청이 몰렸다", async () => {
    const 원문 = (await import("../Watchlist.tsx?raw")).default as string;
    expect(원문).not.toMatch(/IntersectionObserver/);
  });
  it("마우스를 올리거나 손가락이 닿거나 초점이 오면 그 종목만 받는다", async () => {
    const 원문 = (await import("../../components/watchlist/ItemRow.tsx?raw")).default as string;
    expect(원문).toMatch(/onMouseEnter=\{onPrefetch\} onPointerDown=\{onPrefetch\} onFocus=\{onPrefetch\}/);
  });
});
