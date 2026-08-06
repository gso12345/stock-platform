/**
 * 미리보기가 로그인 화면을 따라간다 —
 * "로그인 안한 미리보기 내 자산이랑 관심종목이 로그인한 상황 업데이트
 *  반영이 안됬어"
 *
 * 미리보기는 처음 들어온 사람이 제일 먼저 보는 화면이다. 그런데 그 화면이
 * 로그인한 화면과 다른 코드로 그려져 있으면, 화면을 고칠 때마다 로그인한
 * 사람만 좋아지고 처음 온 사람은 옛 모습을 본다. 실제로 —
 *
 *   · 관심종목: 탭 줄을 따로 그려서, 탭 순서 변경이 미리보기에는 없었다
 *   · 내 자산: 오늘 등락만 0 으로 눌러 둬서, 로그인해야 '오늘' 칸이 살아났다
 *
 * 여기서 못 박는 것은 "같은 것을 쓴다" 는 것이다. 갈라지는 순간 다시
 * 뒤처지기 시작한다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Watchlist원문 from "../Watchlist.tsx?raw";
import Portfolio원문 from "../Portfolio.tsx?raw";

vi.mock("react-router-dom", async () => {
  const 실제 = await vi.importActual<any>("react-router-dom");
  return { ...실제, useNavigate: () => vi.fn() };
});

/* 로그인 안 한 사람 */
vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = { isLoggedIn: false, userId: null, username: null };
    return sel ? sel(s) : s;
  },
}));

vi.mock("@/api/stocks", async (원본가져오기) => {
  const 원본 = await 원본가져오기<any>();
  /* vi.mock 은 파일 맨 위로 끌어올려진다. 바깥 변수를 쓰면 초기화 전에
     닿아 터지므로 팩토리 안에서 만든다 */
  const 시세 = (syms: string[]) => Promise.resolve(syms.map((s) => ({
    symbol: s, price: 1000, change: 12, change_rate: 1.2,
    currency: /^\d/.test(s) ? "KRW" : "USD",
  })));
  return {
    ...원본,
    watchlistApi: { ...원본.watchlistApi, getItems: vi.fn(() => Promise.resolve([])), getPrices: vi.fn(시세) },
    watchlistFolderApi: { ...원본.watchlistFolderApi, getFolders: vi.fn(() => Promise.resolve([])) },
    portfolioApi: { ...원본.portfolioApi, getPortfolios: vi.fn(() => Promise.resolve([])), getItems: vi.fn(() => Promise.resolve([])) },
    dashboardApi: { ...원본.dashboardApi, getExchangeRate: vi.fn(() => Promise.resolve({ value: 1385 })) },
    stocksApi: { ...원본.stocksApi, getDetail: vi.fn(), getPrice: vi.fn() },
  };
});

vi.mock("@/hooks/useWebSocket", () => ({
  usePricesStream: () => ({ status: "idle", send: () => {} }),
}));

import Watchlist from "../Watchlist";
import Portfolio from "../Portfolio";

function 그리기(무엇: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{무엇}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { try { localStorage.clear(); } catch { /* 무시 */ } });

describe("관심종목 — 탭 줄이 한 벌이다", () => {
  it("미리보기 전용 탭 줄을 따로 그리지 않는다", () => {
    /* 여기가 뿌리다. 따로 그리는 순간, 탭 줄에 무엇을 더해도 미리보기에는
       안 나타난다 — 탭 순서 변경이 정확히 그랬다 */
    expect(Watchlist원문).not.toMatch(/\{isPreview \? \(\(\) => \{[\s\S]{0,400}폴더 탭/);
    const i = Watchlist원문.indexOf("{/* 폴더 탭");
    const 탭줄 = Watchlist원문.slice(i, i + 400);
    expect(탭줄).not.toMatch(/isPreview \?/);
  });

  it("미리보기에도 순서를 바꿀 수 있는 탭이 선다", async () => {
    /* data-tab-key 가 붙어 있어야 끌어서 옮길 수 있다 */
    그리기(<Watchlist />);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-tab-key]").length).toBeGreaterThan(1);
    });
  });

  it("미리보기 폴더도 같은 목록에서 나온다", async () => {
    그리기(<Watchlist />);
    await waitFor(() => expect(document.querySelectorAll("[data-tab-key]").length).toBeGreaterThan(1));
    const 키들 = [...document.querySelectorAll("[data-tab-key]")]
      .map((el) => el.getAttribute("data-tab-key")!);
    expect(키들[0]).toBe("recent");
    expect(키들.some((k) => k.startsWith("folder:"))).toBe(true);
  });

  it("로그인 전에는 순서를 서버로 보내지 않는다", () => {
    /* 보낼 폴더가 없다. 그대로 보내면 401 이 나고 인터셉터가 로그인
       화면으로 튕긴다 — 예시를 만지다 쫓겨나는 셈이다 */
    const i = Watchlist원문.indexOf("const 탭순서바꾸기");
    const 본문 = Watchlist원문.slice(i, Watchlist원문.indexOf("}, [", i));
    expect(본문).toMatch(/if \(isPreview\) return;/);
  });
});

describe("내 자산 — 오늘 등락을 같은 방법으로 센다", () => {
  it("미리보기라고 0 으로 눌러 두지 않는다", () => {
    /* 시세는 실제로 받아 온다. 등락률도 같이 오므로 셀 수 있는데도
       0 으로 덮으면, 로그인해야 비로소 '오늘' 칸이 살아난다 */
    const i = Portfolio원문.indexOf("const displaySummary");
    const 본문 = Portfolio원문.slice(i, Portfolio원문.indexOf("}, [", i));
    expect(본문).not.toMatch(/totalDailyChangeKRW: 0/);
  });

  it("미리보기 합계가 오늘치를 실제로 센다", () => {
    const i = Portfolio원문.indexOf("const previewSummaryLive");
    const 본문 = Portfolio원문.slice(i, Portfolio원문.indexOf("}, [", i));
    expect(본문).toMatch(/dailyChangeKRW/);
    expect(본문).not.toMatch(/totalDailyChangeRate: 0/);
  });

  it("미리보기 종목에도 전일대비가 붙는다", () => {
    /* 카드·표의 전일대비 칸이 미리보기에서만 비어 있으면, 그 기능이
       없는 줄 안다 */
    const i = Portfolio원문.indexOf("const previewEnrichedLive");
    const 본문 = Portfolio원문.slice(i, Portfolio원문.indexOf("}, [previewBatchPrices", i));
    expect(본문).toMatch(/전일대비율/);
    expect(본문).toMatch(/전일대비액/);
  });

  it("요약 카드는 로그인 여부와 상관없이 같은 것을 그린다", async () => {
    /* displaySummary 하나만 보고 그린다. 미리보기용 카드를 따로 두면
       카드를 고칠 때마다 한쪽만 좋아진다 */
    그리기(<Portfolio />);
    await screen.findByText("평가손익", {}, { timeout: 4000 });
    expect(screen.getByText("오늘")).toBeInTheDocument();
  });
});
