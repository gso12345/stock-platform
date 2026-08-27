/**
 * 내 자산 첫 화면 — "앱느낌이 너무 안 나는 것 같아"
 *
 * 휴대폰 폭으로 띄워 보니 종목이 첫 화면에 하나도 없었다. 상단바 → 탭 →
 * 미리보기 배너 → 제목 → 개수 → 버튼 세 개 → 요약카드 넷(2×2) → 도넛
 * 차트(180px) → 필터 두 줄. 그러고 나서야 종목 하나가 나왔다.
 *
 * 여기서 못 박는 것 —
 *   1) 요약은 카드 하나다. 넷을 같은 크기로 늘어놓으면 무엇이 중요한지
 *      알 수 없고 화면만 먹는다.
 *   2) 요약은 어느 탭에 있든 남는다. '지금 얼마인가' 는 늘 보여야 한다.
 *   3) 보유 종목이 기본 탭이다. 이 화면을 여는 가장 흔한 이유다.
 *   4) 로딩 뼈대가 실제 모양과 같다. 다르면 값이 도착할 때 화면이 튄다.
 *
 * ── 2)·3) 이 왜 바뀌었나 ──
 *
 * 예전에는 "구성은 늘 보인다" 였다. 접었다 폈다 하는 버튼이 있었는데
 * 볼 때마다 한 번 더 눌러야 해서 없앴던 것이다. 그 판단은 지금도 맞다 —
 * 되살아났는지 아래에서 계속 확인한다.
 *
 * 다만 그 뒤로 자산 흐름 그래프와 배당 달력이 그 위에 더해지면서, 정작
 * 보유 종목이 네댓 번을 넘겨야 나오는 화면이 됐다. 그래서 화면 자체를
 * 탭으로 갈랐다(자산/추이/배당/비중/뉴스). 접기 버튼과 다른 점은,
 * 탭은 '지금 무엇을 보고 있나' 를 늘 드러내고 안 연 탭의 서버 요청이
 * 아예 안 나간다는 것이다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-router-dom", async () => {
  const 실제 = await vi.importActual<any>("react-router-dom");
  return { ...실제, useNavigate: () => vi.fn() };
});

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = { isLoggedIn: false, user: null };
    return sel ? sel(s) : s;
  },
}));

/* 비로그인 미리보기 — 예시 종목이 실제 시세로 채워진다 */
vi.mock("@/api/stocks", async (원본가져오기) => ({
  ...(await 원본가져오기<any>()),
  portfolioApi: {
    getPortfolios: vi.fn(() => Promise.resolve([])),
    getItems: vi.fn(() => Promise.resolve([])),
    addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(),
    createPortfolio: vi.fn(), renamePortfolio: vi.fn(),
    deletePortfolio: vi.fn(), reorderPortfolios: vi.fn(),
  },
  watchlistApi: {
    getPrices: vi.fn((symbols: string[]) =>
      Promise.resolve(symbols.map((s) => ({
        symbol: s, price: 100, change: 1, change_rate: 0.5,
        currency: /^\d/.test(s) ? "KRW" : "USD",
      })))),
  },
  stocksApi: { getDetail: vi.fn(), getPrice: vi.fn() },
  dashboardApi: { getExchangeRate: vi.fn(() => Promise.resolve({ value: 1400 })) },
}));

import Portfolio from "../Portfolio";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Portfolio /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** 값이 다 도착해 요약이 그려졌다는 신호.
 *
 *  예전에는 구성 차트의 "종목별" 을 기다렸다. 그건 이제 '비중' 탭
 *  안이라 기본 화면에 없다.
 *
 *  탭 줄이 아니라 요약을 기다리는 이유 — 탭 줄은 시세보다 먼저 그려진다
 *  (뒤늦게 끼어들면 아래가 통째로 밀리기 때문에 일부러 그렇게 뒀다).
 *  그래서 탭 줄을 신호로 삼으면 요약이 아직 없는 순간에 통과한다. */
const 준비될때까지 = () => screen.findByText("평가손익", {}, { timeout: 4000 });

beforeEach(() => { try { localStorage.clear(); } catch { /* 무시 */ } });

describe("내 자산 첫 화면", () => {
  it("요약은 카드 하나로 모은다", async () => {
    /* 예전에는 총평가금액·총매입금액·평가손익·수익률이 같은 크기 카드
       넷으로 2×2 였다. 휴대폰에서 화면 3분의 1을 쓰면서도 무엇이 제일
       중요한지 알 수 없었다. */
    그리기();
    await 준비될때까지();
    // 평가금액이 크게 하나, 나머지는 작게 — '총 매입금액' 같은 옛 이름은 없다
    expect(screen.queryByText("총 매입금액")).toBeNull();
    expect(screen.getByText("매입금액")).toBeInTheDocument();
    expect(screen.getByText("적용 환율")).toBeInTheDocument();
  });

  it("보유 종목이 첫 화면에 나온다", async () => {
    /* 이 화면을 여는 가장 흔한 이유다. 예전에는 요약 → 자산 흐름 →
       배당 달력 → 구성 차트를 다 지나야 첫 종목이 나왔다 */
    그리기();
    expect(await 준비될때까지()).toBeInTheDocument();
    // 기본으로 고른 탭이 '자산' 이다
    expect(screen.getByRole("tab", { name: "자산" })).toHaveAttribute("aria-selected", "true");
  });

  it("구성은 접기 버튼이 아니라 탭 뒤에 있다", async () => {
    /* 접기 버튼은 되살리지 않는다 — 볼 때마다 한 번 더 눌러야 했다.
       탭은 다르다. '지금 무엇을 보고 있나' 가 늘 드러나고, 안 연 탭의
       서버 요청과 recharts(132KB)가 아예 안 나간다 */
    그리기();
    await 준비될때까지();
    expect(screen.queryByRole("button", { name: "구성 펼치기" })).toBeNull();
    // 열기 전에는 없다 = 그만큼 첫 화면이 가볍다
    expect(screen.queryByText("종목별")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "비중" }));
    expect(await screen.findByText("종목별", {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("손익과 오늘이 줄마다 하나씩 선다", async () => {
    /* 예전에는 총수익률이 평가금액 옆에 붙고, 오늘치가 평가손익과 한 줄에
       끼어 있었다. 셋이 뒤엉켜 어느 %가 무엇의 %인지 읽기 어려웠다 */
    그리기();
    await 준비될때까지();

    const 손익라벨 = screen.getByText("평가손익");
    const 오늘라벨 = screen.getByText("오늘");
    expect(손익라벨).toBeInTheDocument();
    expect(오늘라벨).toBeInTheDocument();
    // 서로 다른 줄이어야 한다 — 같은 부모에 나란히 있으면 한 줄이다
    expect(손익라벨.parentElement).not.toBe(오늘라벨.parentElement);
  });

  it("금액과 그 비율을 붙여 한 줄로 적는다", async () => {
    /* "+5,000,000" 과 "+12.34%" 가 떨어져 있으면 어느 금액의 비율인지
       매번 눈으로 이어 붙여야 한다 */
    그리기();
    await 준비될때까지();

    for (const 라벨 of ["평가손익", "오늘"]) {
      const 줄 = screen.getByText(라벨).parentElement!;
      // 한 덩어리 안에 부호 붙은 금액과 괄호 친 비율이 같이 있다
      expect(줄.textContent).toMatch(/[+-][\d,]+ \([+-]?\d+\.\d\d%\)/);
    }
  });

  it("총평가금액이 제일 크게 남는다", async () => {
    /* 손익 줄을 늘리면서 정작 '지금 얼마인가' 가 묻히면 안 된다 */
    그리기();
    await 준비될때까지();
    const 라벨 = screen.getByText(/평가금액$/);
    const 값 = 라벨.parentElement!.querySelector("span:last-child");
    /* text-[28px] 이었다. px 는 설정의 글씨 크기가 안 먹어서 토큰으로
       바꿨다 — text-3xl 이 정확히 28px 이고, 이 앱에서 가장 큰 크기다.
       (크기 이름이 바뀌었을 뿐 보이는 크기는 그대로다) */
    expect(값?.className).toMatch(/\btext-3xl\b/);
  });

  it("제목과 버튼이 한 줄에 있다", async () => {
    /* 두 줄이면 상단바·탭·배너까지 더해 다섯 줄을 지나야 요약이 나온다 */
    그리기();
    const 제목 = await screen.findByRole("heading", { name: "내 자산" });
    const 줄 = 제목.closest("div")?.parentElement;
    // 같은 상자 안에 있는지만 보면 세로로 쌓아도 통과한다. 가로줄인지까지 본다
    expect(줄?.textContent).toMatch(/종목 추가/);
    expect(줄?.className).toMatch(/items-center/);
    expect(줄?.className).not.toMatch(/flex-col/);
  });
});
