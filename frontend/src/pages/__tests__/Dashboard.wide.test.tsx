/**
 * 대시보드를 PC 에서 보기 좋게.
 *
 * 휴대폰에 맞춘 화면이 PC 에서는 이랬다.
 *  · 지수 카드 넷이 왼쪽 절반에만 서고 오른쪽이 비었다.
 *  · 환율·금리 줄이 오른쪽에서 잘렸다. 손가락으로 미는 줄인데 마우스로는
 *    밀 수 없고 스크롤바도 숨겨 두어, VKOSPI·선물 카드는 PC 에서 볼 수 없었다.
 *  · 순위·뉴스가 1,600px 를 통째로 써서 종목명과 가격이 양 끝에 떨어졌다.
 *
 * 휴대폰 모양은 그대로여야 한다 — 바꾼 것은 전부 lg·xl 에서만 산다.
 * 레이아웃 자체(몇 픽셀에 무엇이 서는가)는 jsdom 이 계산하지 않으므로
 * 여기서는 class 와 열 수를 본다. 실제 모양은 1024·1280·1440·1920·390px
 * 화면으로 찍어 확인했다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const 줄 = (name: string, value: number, unit: string) =>
  ({ name, value, change: 0.01, change_rate: 0.01, unit });

/* 이름은 서버가 붙여 보내는 그대로(카드는 서버가 준 name 을 쓴다) */
const 지수 = (index: string, name: string, value: number) =>
  ({ index, name, value, change: 1, change_rate: 0.1 });

const 국내 = {
  indices: [지수("KOSPI", "코스피", 2648), 지수("KOSDAQ", "코스닥", 852),
            지수("KOSPI200", "코스피 200", 355), 지수("KOSPI100", "코스피 100", 2701)],
  exchange: { value: 1385.5, change: 2.1, change_rate: 0.15 },
  rates: [
    줄("한국 기준금리", 2.5, "%"), 줄("CD금리(91일)", 2.62, "%"), 줄("국고채 3년", 2.58, "%"),
    줄("국고채 5년", 2.71, "%"), 줄("국고채 10년", 2.88, "%"), 줄("원/유로", 1502.3, "원"),
    줄("원/100엔", 921.4, "원"), 줄("VKOSPI", 17.42, "pt"),
  ],
  futures: [{ name: "코스피200 선물", price: 356.1, change: 1.2, change_rate: 0.34, unit: "pt" }],
};                                                   // 원/달러 + 8 + 선물 = 10장
const 해외 = {
  indices: [지수("SP500", "S&P 500", 5812), 지수("NASDAQ", "나스닥", 18420),
            지수("DOW", "다우 산업", 42310), 지수("SOX", "필라델피아 반도체", 5120),
            지수("RUSSELL", "러셀 2000", 2231)],
  rates: [],
};
const 해외금리 = [
  줄("원/달러", 1385.5, "원"), 줄("원/유로", 1502.3, "원"), 줄("원/100엔", 921.4, "원"),
  줄("미국 단기금리(3M)", 4.12, "%"), 줄("미국 5년 국채", 3.98, "%"),
  줄("미국 10년 국채", 4.21, "%"), 줄("미국 30년 국채", 4.52, "%"), 줄("VIX 공포지수", 15.8, "pt"),
];                                                   // 8장

vi.mock("@/api/stocks", () => ({
  dashboardApi: {
    getKR: vi.fn(() => Promise.resolve(국내)),
    getUS: vi.fn(() => Promise.resolve(해외)),
    getUSRates: vi.fn(() => Promise.resolve(해외금리)),
    getNews: vi.fn(() => Promise.resolve([])),
    getRankings: vi.fn(() => Promise.resolve([])),
    getIndexDetail: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock("@/hooks/useWebSocket", () => ({
  useIndicesStream: () => ({ status: "disconnected" }),
  usePricesStream: () => ({ status: "disconnected" }),
}));

import Dashboard from "../Dashboard";
import { dashboardApi } from "@/api/stocks";

/** 응답을 붙잡아 두었다가 원할 때 내보낸다 */
function 붙잡기() {
  let 풀기: (v: unknown) => void = () => {};
  const 약속 = new Promise((r) => { 풀기 = r; });
  return { 약속, 풀기: (v: unknown) => 풀기(v) };
}

/* 칸 폭을 정해 준다 — jsdom 은 레이아웃을 안 해서 늘 0 이다 */
let 칸폭 = 0;
beforeEach(() => {
  칸폭 = 0;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true, get: () => 칸폭,
  });
});
afterEach(() => {
  delete (HTMLElement.prototype as any).clientWidth;
});

function 띄우기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Dashboard /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const 휴대폰줄 = "flex gap-3 overflow-x-auto p-2 -m-2 scrollbar-hide";
const 줄칸 = (글자: string) => screen.getByText(글자).closest(".overflow-x-auto") as HTMLElement;
/* class 를 낱말로 — 'lg:grid' 를 글자로 찾으면 'lg:grid-cols-…' 에도 걸린다 */
const class들 = (el: Element) => new Set(el.className.split(/\s+/));

describe("대시보드 — 국내", () => {
  it("휴대폰에서는 예전처럼 옆으로 미는 줄이다", async () => {
    띄우기();
    await screen.findByText("코스피200 선물");
    for (const 칸 of [줄칸("코스피"), 줄칸("코스피200 선물")]) {
      expect(칸.className.startsWith(휴대폰줄)).toBe(true);
    }
  });

  it("PC 에서는 줄을 감싸 VKOSPI·선물까지 밀지 않고 다 보인다", async () => {
    띄우기();
    await screen.findByText("코스피200 선물");
    for (const 칸 of [줄칸("코스피"), 줄칸("코스피200 선물")]) {
      expect(class들(칸).has("lg:grid")).toBe(true);
      expect(class들(칸).has("lg:overflow-visible")).toBe(true);
    }
    expect(줄칸("코스피200 선물")).toContainElement(screen.getByText("VKOSPI"));
  });

  it("1,440px(칸 1,211px): 지수 넷은 한 줄, 환율·금리 10장은 다섯 장씩 두 줄", async () => {
    칸폭 = 1211;
    띄우기();
    await screen.findByText("코스피200 선물");
    expect(줄칸("코스피").style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
    // 그냥 감싸면 8 + 2 — 끝줄에 두 장만 남는다
    expect(줄칸("코스피200 선물").style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
  });

  it("1,920px(칸 1,563px): 환율·금리 10장이 한 줄에 다 선다", async () => {
    칸폭 = 1563;
    띄우기();
    await screen.findByText("코스피200 선물");
    expect(줄칸("코스피200 선물").style.gridTemplateColumns).toBe("repeat(10, minmax(0, 1fr))");
  });

  it("불러오는 동안에도 같은 줄 수 — 값이 와도 아래 순위·뉴스가 밀려 내려가지 않는다", async () => {
    /* 뼈대가 넉 장이면 PC 에서 한 줄, 실제 10장은 두 줄이다. 값이 오는
       순간 줄이 하나 늘며 그 아래가 통째로 내려갔다 */
    const 국내응답 = 붙잡기();
    vi.mocked(dashboardApi.getKR).mockImplementationOnce(() => 국내응답.약속 as any);
    칸폭 = 1211;
    띄우기();
    const 지표 = screen.getByText("환율 · 금리 · 변동성").nextElementSibling as HTMLElement;
    expect(지표.children.length).toBe(10);
    const 뼈대열 = 지표.style.gridTemplateColumns;
    expect(뼈대열).toBe("repeat(5, minmax(0, 1fr))");

    await act(async () => { 국내응답.풀기(국내); });
    await screen.findByText("코스피200 선물");
    expect(지표.children.length).toBe(10);
    expect(지표.style.gridTemplateColumns).toBe(뼈대열);
  });

  it("아주 넓으면 순위와 뉴스가 나란히 선다 — 휴대폰에서는 예전처럼 위아래", async () => {
    띄우기();
    await screen.findByText("코스피200 선물");
    const 순위 = screen.getByText("국내 순위");
    const 뉴스 = screen.getByText("국내 금융뉴스");
    const 묶음 = 순위.closest("[class*='xl:grid-cols-2']") as HTMLElement;
    expect(묶음).not.toBeNull();
    expect(묶음).toContainElement(뉴스);
    expect(묶음.className).toMatch(/^flex flex-col gap-5 /);   // 탭 본문과 같은 간격 — 휴대폰 모양 그대로
  });
});

describe("대시보드 — 해외", () => {
  it("1,280px(칸 1,062px): 환율·금리 8장은 넉 장씩 두 줄 (6 + 2 가 아니라)", async () => {
    칸폭 = 1062;
    const user = userEvent.setup();
    띄우기();
    await screen.findByText("코스피200 선물");
    await user.click(screen.getByRole("tab", { name: /해외/ }));
    await screen.findByText("VIX 공포지수");
    const 지표 = 줄칸("VIX 공포지수");
    expect(지표.className.startsWith(휴대폰줄)).toBe(true);
    expect(지표.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
    expect(줄칸("나스닥").style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
    const 묶음 = screen.getByText("해외 순위").closest("[class*='xl:grid-cols-2']");
    expect(묶음).toContainElement(screen.getByText("해외 금융뉴스"));
  });

  it("불러오는 동안에도 같은 줄 수 — 뼈대 여덟 장", async () => {
    const 해외응답 = 붙잡기();
    const 금리응답 = 붙잡기();
    vi.mocked(dashboardApi.getUS).mockImplementationOnce(() => 해외응답.약속 as any);
    vi.mocked(dashboardApi.getUSRates).mockImplementationOnce(() => 금리응답.약속 as any);
    칸폭 = 1062;
    const user = userEvent.setup();
    띄우기();
    await screen.findByText("코스피200 선물");
    await user.click(screen.getByRole("tab", { name: /해외/ }));
    const 지표 = screen.getByText("환율 · 금리 · 국채").nextElementSibling as HTMLElement;
    expect(지표.children.length).toBe(8);
    expect(지표.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");

    await act(async () => { 해외응답.풀기(해외); 금리응답.풀기(해외금리); });
    await screen.findByText("VIX 공포지수");
    expect(지표.children.length).toBe(8);
    expect(지표.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
  });
});
