/**
 * ETF 보유비중 탭 — 사용자: "종목상세탭 ETF 보유비중 정보 안불러오는 종목이 있어".
 *
 * 서버가 국내 ETF 를 네이버에서 받게 바뀌면서 화면이 지킬 것:
 *   1) 구성종목을 누르면 서버가 알려 준 시장(market)으로 간다 — 국내 ETF 가 담은 미국 주식(엔비디아)을
 *      /stocks/KR/NVDA 로 열면 없는 화면이다. market 이 없는 예전 응답만 ETF 시장으로 짐작한다
 *   2) 갈 곳이 없는 것(현금)은 누를 수 없다
 *   3) 영문이 섞인 국내 코드(0193W0)도 국내 ETF 로 안내한다 — 숫자만 보던 때는 '공개되지 않습니다' 라고 했다
 *   4) 어디서 받았는지(출처)와 비어 있는 이유를 보여 준다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const 상태 = vi.hoisted(() => ({ 응답: null as any, 실패: false }));

vi.mock("@/api/stocks", () => ({
  stocksApi: {
    getEtfHoldings: vi.fn(() => (상태.실패 ? Promise.reject(new Error("429")) : Promise.resolve(상태.응답))),
  },
}));

import { EtfHoldingsTab, 국내코드꼴, 기준일 } from "@/components/stock/EtfHoldingsTab";
import { stocksApi } from "@/api/stocks";

function 지금주소() {
  return <p data-testid="주소">{useLocation().pathname}</p>;
}

function 그리기(symbol: string, market: "KR" | "US" | "ETF") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/etf"]}>
        <Routes>
          <Route path="/etf" element={<EtfHoldingsTab symbol={symbol} market={market as never} />} />
          {/* 어디로 가든 주소를 보인다 — 엉뚱한 주소(/stocks/KR/)로 가도 '안 갔다' 로 보이지 않게 */}
          <Route path="*" element={<지금주소 />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const 국내ETF응답 = {
  holdings: [
    { symbol: "005930", name: "삼성전자", pct: 24.69, value: 0, market: "KR" },
    { symbol: "NVDA", name: "엔비디아", pct: 9.12, value: 0, market: "US" },
    { symbol: "", name: "원화예금", pct: 1.5, value: 0, market: null },
  ],
  sector_weights: [],
  source: "네이버 증권",
};

beforeEach(() => {
  상태.응답 = null;
  상태.실패 = false;
  vi.mocked(stocksApi.getEtfHoldings).mockClear();
});

describe("구성종목을 누르면", () => {
  it("국내 ETF 가 담은 미국 주식은 미국 화면으로 — 서버가 알려 준 시장", async () => {
    상태.응답 = 국내ETF응답;
    그리기("0193W0", "KR");
    await userEvent.click(await screen.findByText("엔비디아"));
    expect(screen.getByTestId("주소")).toHaveTextContent("/stocks/US/NVDA");
  });

  it("국내 주식은 국내 화면으로", async () => {
    상태.응답 = 국내ETF응답;
    그리기("0193W0", "KR");
    await userEvent.click(await screen.findByText("삼성전자"));
    expect(screen.getByTestId("주소")).toHaveTextContent("/stocks/KR/005930");
  });

  it("갈 곳이 없는 것(현금)은 누를 수 없다", async () => {
    상태.응답 = 국내ETF응답;
    그리기("0193W0", "KR");
    const 줄 = (await screen.findByText("원화예금")).closest("tr")!;
    expect(줄.className).not.toContain("cursor-pointer");
    await userEvent.click(줄);
    expect(screen.queryByTestId("주소")).toBeNull();
  });

  it("market 이 없는 예전 응답은 ETF 시장으로 짐작한다", async () => {
    상태.응답 = { holdings: [{ symbol: "AAPL", name: "Apple", pct: 7, value: 0 }], sector_weights: [] };
    그리기("QQQ", "ETF");
    await userEvent.click(await screen.findByText("Apple"));
    expect(screen.getByTestId("주소")).toHaveTextContent("/stocks/US/AAPL");
  });

  it("market 이 없는 예전 응답 — 국내 ETF 면 국내로", async () => {
    상태.응답 = { holdings: [{ symbol: "000660", name: "SK하이닉스", pct: 10, value: 0 }], sector_weights: [] };
    그리기("069500", "KR");
    await userEvent.click(await screen.findByText("SK하이닉스"));
    expect(screen.getByTestId("주소")).toHaveTextContent("/stocks/KR/000660");
  });
});

describe("출처와 빈 이유", () => {
  it("몇 종목인지와 어디서 받았는지", async () => {
    상태.응답 = 국내ETF응답;
    그리기("069500", "KR");
    expect(await screen.findByText("3종목 · 네이버 증권")).toBeInTheDocument();
  });

  it("전체가 더 많으면 '전체 N개 중' 과 기준일 — '3종목' 만 적으면 ETF 가 3종목만 담은 줄 안다", async () => {
    const 올해 = new Date().getFullYear();
    상태.응답 = { ...국내ETF응답, total: 504, as_of: `${올해}-10-31` };
    그리기("360750", "KR");
    expect(await screen.findByText("전체 504개 중 3개 · 네이버 증권 · 10.31 기준")).toBeInTheDocument();
  });

  it("전체 개수가 보이는 것보다 많지 않으면 종목 수만", async () => {
    상태.응답 = { ...국내ETF응답, total: 3 };
    그리기("069500", "KR");
    expect(await screen.findByText("3종목 · 네이버 증권")).toBeInTheDocument();
  });

  it("출처가 없으면 종목 수만", async () => {
    상태.응답 = { holdings: [{ symbol: "AAPL", name: "Apple", pct: 7, value: 0, market: "US" }], sector_weights: [] };
    그리기("QQQ", "ETF");
    expect(await screen.findByText("1종목")).toBeInTheDocument();
  });

  it("영문이 섞인 국내 코드도 국내 ETF 로 안내하고 서버가 준 이유를 보인다", async () => {
    상태.응답 = { holdings: [], sector_weights: [], reason: "네이버 증권에 공개된 구성종목이 없습니다" };
    그리기("0193W0", "KR");
    expect(await screen.findByText("국내 ETF 구성종목은 네이버 증권에서 가져옵니다")).toBeInTheDocument();
    expect(screen.getByText("네이버 증권에 공개된 구성종목이 없습니다")).toBeInTheDocument();
    expect(screen.queryByText(/공개하지 않는 ETF/)).toBeNull();
  });

  it("미국 ETF 가 비면 '공개하지 않거나 아직 못 받았다'", async () => {
    상태.응답 = { holdings: [], sector_weights: [], reason: "구성종목을 받지 못했습니다" };
    그리기("GLD", "ETF");
    expect(await screen.findByText("구성종목을 공개하지 않는 ETF 이거나 아직 받지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("구성종목을 받지 못했습니다")).toBeInTheDocument();
  });

  it("요청 자체가 실패하면 불러올 수 없다고", async () => {
    상태.실패 = true;
    그리기("SPY", "ETF");
    /* 탭이 한 번 더 묻는다(retry: 1, 1초 뒤) — 그 뒤에 실패로 */
    expect(await screen.findByText("보유비중 데이터를 불러올 수 없습니다", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(stocksApi.getEtfHoldings).toHaveBeenCalledTimes(2);
  });

  it("섹터 비중만 있어도 보여 준다", async () => {
    상태.응답 = { holdings: [], sector_weights: [{ sector: "technology", pct: 51.2 }] };
    그리기("XLK", "ETF");
    expect(await screen.findByText("기술")).toBeInTheDocument();
    expect(screen.getByText("51.2%")).toBeInTheDocument();
  });
});

describe("기준일", () => {
  const 오늘 = new Date(2026, 10, 5);
  it("올해면 월.일, 아니면 해까지", () => {
    expect(기준일("2026-10-31", 오늘)).toBe("10.31");
    expect(기준일("2025-12-31", 오늘)).toBe("25.12.31");
  });
  it("꼴이 다르면 그대로", () => {
    expect(기준일("10월 말", 오늘)).toBe("10월 말");
    expect(기준일("2026-1-5", 오늘)).toBe("2026-1-5");
  });
});

describe("국내 코드 꼴", () => {
  it.each(["069500", "0193W0", "0193w0", "00680K", "069500.KS", "0193W0.KQ"])("%s 는 국내", (s) => {
    expect(국내코드꼴.test(s)).toBe(true);
  });
  it.each(["SPY", "BRK-B", "69500", "0193W0X", "A12345", "069500.T"])("%s 는 국내가 아니다", (s) => {
    expect(국내코드꼴.test(s)).toBe(false);
  });
});
