/**
 * 관심종목을 PC 에서 보기 좋게(사용자: "관심종목 PC버전에서도 최적화된 화면").
 *
 * 휴대폰 목록을 그대로 늘리면 이름은 왼쪽 끝, 가격은 오른쪽 끝이고 그 사이 1,000px 이 비었다.
 * 넓은 화면(lg)에서는 칸 이름 줄을 두고 줄마다 시가총액·PER·배당·52주 고점 대비·1개월을 채운다 —
 * 값은 스크리닝 표(/screening/rows)에서 온다.
 *
 * 여기서 못 박는 것 —
 *   1) 휴대폰에서는 지표를 묻지도 않는다(칸이 없다)
 *   2) 넓은 화면에서는 보이는 종목을 한 번에 묻고, 줄마다 제 값을 붙인다(시장:종목 열쇠)
 *   3) 값을 모르는 칸은 '—'
 *   4) 칸 이름 줄과 줄의 칸 수가 같다(머리와 몸이 어긋나지 않게)
 * jsdom 은 레이아웃을 계산하지 않으므로 class 를 보고, 실제 모양은 1440·1920·390px 로 찍어 확인했다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { 관심표칸, 간단표칸, 관심표머리, 간단관심줄 } from "@/components/watchlist/ItemRow";
import { PreviewItemRow } from "@/components/watchlist/Preview";

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
  물음: [] as { symbol: string; market: string }[][],
  /** 지표 답을 늦게 주고 싶을 때 — 없으면 곧바로 */
  답: null as null | (() => Promise<unknown>),
}));

vi.mock("@/api/stocks", async (원본가져오기) => {
  const 원본 = await 원본가져오기<any>();
  const 시세 = [
    { symbol: "005930.KS", market: "KR", price: 71_300, change: 300, change_rate: 0.42 },
    { symbol: "NVDA", market: "US", price: 180.5, change: -1.5, change_rate: -0.82 },
  ];
  return {
    ...원본,
    watchlistApi: {
      ...원본.watchlistApi,
      getItemsWithCachedPrices: vi.fn(() => Promise.resolve({
        items: [
          { id: 1, symbol: "005930.KS", market: "KR", name: "삼성전자", folder_id: 3, folder_name: "반도체" },
          { id: 2, symbol: "NVDA", market: "US", name: "엔비디아", folder_id: 3, folder_name: "반도체" },
        ],
        prices: 시세,
      })),
      getPrices: vi.fn(() => Promise.resolve(시세)),
    },
    watchlistFolderApi: { ...원본.watchlistFolderApi, getFolders: vi.fn(() => Promise.resolve([{ id: 3, name: "반도체" }])) },
    portfolioApi: {
      ...원본.portfolioApi,
      getPortfolios: vi.fn(() => Promise.resolve([])),
      getItemsWithPrices: vi.fn(() => Promise.resolve({ items: [], prices: [] })),
    },
    dashboardApi: { ...원본.dashboardApi, getExchangeRate: vi.fn(() => Promise.resolve({ value: 1300 })) },
    screeningApi: {
      ...원본.screeningApi,
      rows: vi.fn((items: { symbol: string; market: string }[]) => {
        상태.물음.push(items);
        if (상태.답) return 상태.답();
        /* 엔비디아는 서버 표가 모른다 — 칸이 비어야 한다 */
        return Promise.resolve({
          rows: {
            "KR:005930.KS": {
              market_cap: 425e12, per: 12.34, dividend_yield: 2.1, pct_from_52w_high: -8.25, return_1m: 3.5,
            },
          },
        });
      }),
    },
  };
});

vi.mock("@/hooks/useWebSocket", () => ({
  usePricesStream: () => ({ status: "idle", send: () => {} }),
}));

import Watchlist from "../Watchlist";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Watchlist /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** 이름이 든 줄(관심종목 줄의 칸 상자) */
const 줄찾기 = (이름: string) => screen.getByText(이름).closest(`[class*='lg:grid-cols-']`) as HTMLElement;
/** 줄의 지표 칸(넓은 화면에서만 보이는 hidden lg:block) 글자 */
const 지표글 = (줄: HTMLElement) =>
  [...줄.querySelectorAll(":scope > .lg\\:block")].map((el) => el.textContent?.trim());

beforeEach(() => {
  localStorage.clear();
  상태.물음 = [];
  상태.답 = null;
});

describe("관심종목 — 휴대폰", () => {
  it("지표를 묻지 않는다 — 칸이 없는 화면에서 서버를 부르지 않는다", async () => {
    그리기();
    await screen.findByText("엔비디아");
    await new Promise((r) => setTimeout(r, 50));
    expect(상태.물음).toEqual([]);
    // 줄 모양은 휴대폰 그대로 — 표 칸은 lg 에서만
    const 줄 = 줄찾기("삼성전자");
    expect(줄.className).toContain("flex");
    expect(줄.className).toContain(관심표칸);
  });
});

describe("관심종목 — 넓은 화면", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q === "(min-width: 1024px)", media: q,
      addEventListener() {}, removeEventListener() {},
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("보이는 종목을 한 번에 묻고, 줄마다 제 값을 붙인다", async () => {
    그리기();
    await screen.findByText("엔비디아");
    await waitFor(() => expect(상태.물음.length).toBeGreaterThan(0));
    const 물은것 = 상태.물음[상태.물음.length - 1].map((i) => `${i.market}:${i.symbol}`).sort();
    expect(물은것).toEqual(["KR:005930.KS", "US:NVDA"]);

    // 시가총액 425조 · PER 12.3 · 배당 2.10% · 52주 고점 대비 -8.3% · 1개월 ▲ 3.50%
    await waitFor(() => expect(지표글(줄찾기("삼성전자"))).toEqual(["425조", "12.3", "2.10%", "-8.3%", "▲ 오름 3.50%"]));
    // 서버 표가 모르는 종목은 칸마다 '—'
    expect(지표글(줄찾기("엔비디아"))).toEqual(["—", "—", "—", "—", "—"]);
  });

  it("칸 이름 줄 — 넓은 화면에서만, 줄과 같은 칸", async () => {
    그리기();
    await screen.findByText("엔비디아");
    const 머리 = screen.getByText("52주 고점 대비").parentElement as HTMLElement;
    expect(머리.className).toContain("hidden");
    expect(머리.className).toContain(관심표칸);
    expect(머리.getAttribute("aria-hidden")).toBe("true");
    expect([...머리.children].map((c) => c.textContent)).toEqual(
      ["", "종목", "현재가", "시가총액", "PER", "배당수익률", "52주 고점 대비", "1개월", ""]);
    // 줄도 같은 아홉 칸 — 손잡이 · 종목 · 현재가 · 지표 다섯 · 단추
    expect(줄찾기("삼성전자").children.length).toBe(머리.children.length);
  });

  it("지표가 맨 나중에 와도 줄이 다시 그려진다(줄은 바뀐 것만 다시 그린다)", async () => {
    let 풀기: (v: unknown) => void = () => {};
    상태.답 = () => new Promise((r) => { 풀기 = r; });
    그리기();
    await screen.findByText("엔비디아");
    await waitFor(() => expect(상태.물음.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));             // 목록·시세가 다 자리 잡은 뒤
    expect(지표글(줄찾기("삼성전자"))[0]).toBe("—");
    await act(async () => { 풀기({ rows: { "KR:005930.KS": { market_cap: 425e12 } } }); });
    await waitFor(() => expect(지표글(줄찾기("삼성전자"))[0]).toBe("425조"));
  });
});

describe("간단 줄 — 최근 조회·포트폴리오 탭·미리보기", () => {
  /** 넓은 화면에서 칸을 차지하는 아이 — lg:hidden(휴대폰의 시장 배지)은 빠진다 */
  const 보이는칸 = (el: Element) => [...el.children].filter((c) => !String(c.className).includes("lg:hidden"));

  it("칸 이름 줄과 같은 일곱 칸 — 종목 · 현재가 · 지표 다섯", () => {
    const { container } = render(<>
      <관심표머리 간단 />
      <간단관심줄 market="KR" symbol="005930" name="삼성전자" price={71_300} change={300} change_rate={0.42}
        지표={{ market_cap: 425e12, per: 12.34 }} onNavigate={() => {}} />
    </>);
    const [머리, 줄] = [...container.children];
    expect(머리.className).toContain(간단표칸);
    expect(줄.className).toContain(간단표칸);
    expect([...머리.children].map((c) => c.textContent))
      .toEqual(["종목", "현재가", "시가총액", "PER", "배당수익률", "52주 고점 대비", "1개월"]);
    expect(보이는칸(줄).length).toBe(머리.children.length);
    expect(지표글(줄 as HTMLElement)).toEqual(["425조", "12.3", "—", "—", "—"]);
  });

  it("시세가 0·없음이면 가격 대신 글 — 기다리면 오는지('조회 중'), 원래 없는지('시세 없음')", () => {
    const { rerender } = render(<간단관심줄 market="KR" symbol="005930" name="삼성전자" price={0} onNavigate={() => {}} />);
    expect(screen.getByText("조회 중")).toBeTruthy();
    expect(screen.queryByText(/₩/)).toBeNull();
    rerender(<간단관심줄 market="KR" symbol="CASH" name="현금" price={null} 시세없음글="시세 없음" onNavigate={() => {}} />);
    expect(screen.getByText("시세 없음")).toBeTruthy();
  });

  it("미리보기 — 시세를 못 받은 예시 종목은 적어 둔 예시 가격을 보이지 않는다", () => {
    render(<PreviewItemRow item={{ id: -1, symbol: "AAPL", market: "US", name: "애플", folderId: -1, price: 230,
      change_rate: 1, hasPrice: false }} onNavigate={() => {}} />);
    expect(screen.getByText("조회 중")).toBeTruthy();
    expect(screen.queryByText(/230/)).toBeNull();
  });
});
