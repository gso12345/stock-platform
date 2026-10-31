/**
 * 사고팔기 창 — 저장하기 전에 결과를 보여 주고, 틀린 값은 그 자리에서 막는다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { portfolioApi } from "@/api/stocks";
import type { EnrichedItem } from "@/types/portfolio";
import TradeModal from "../TradeModal";

/** 맨 아래 '팔기' — 위의 '팔기' 는 팔기·더 사기 고르는 칸이다 */
const 저장단추 = () => { const 다 = screen.getAllByRole("button", { name: "팔기" }); return 다[다.length - 1]; };

vi.mock("@/api/stocks", () => ({ portfolioApi: { trade: vi.fn() } }));

const 애플 = {
  id: 7, symbol: "AAPL", market: "US", name: "애플", shares: 10, avgPrice: 100, currency: "USD",
  inputExchangeRate: 1300, currentPriceNative: 120, currentValueKRW: 0, costKRW: 0, pnlKRW: 0, pnlRate: 0,
  weight: 0, isForexItem: true, nativeAvgPrice: 100, nativeValue: 0, nativePnl: 0,
} as unknown as EnrichedItem;
const 삼성 = { ...애플, id: 8, symbol: "005930", market: "KR", name: "삼성전자", avgPrice: 70_000,
  currency: "KRW", inputExchangeRate: undefined, currentPriceNative: 80_000, isForexItem: false } as unknown as EnrichedItem;

const 닫음 = vi.fn<() => void>();
let qc: QueryClient;
function 그리기(item: EnrichedItem) {
  qc = new QueryClient();
  vi.spyOn(qc, "invalidateQueries");
  return render(<QueryClientProvider client={qc}><TradeModal item={item} exchangeRate={1400} onClose={닫음} /></QueryClientProvider>);
}
const 칸 = (이름: string) => screen.getByRole("textbox", { name: 이름 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T03:00:00Z"));
  vi.mocked(portfolioApi.trade).mockResolvedValue({ trade: {} as any, item: null });
});
afterEach(() => vi.useRealTimers());

describe("사고팔기 창", () => {
  it("팔기가 먼저 — 지금 시세·환율·오늘이 채워져 있다", () => {
    그리기(애플);
    expect(screen.getByRole("button", { name: "팔기", pressed: true })).toBeInTheDocument();
    expect(칸("가격")).toHaveValue("120");
    expect(칸("환율")).toHaveValue("1400");
    expect(screen.getByLabelText("날짜")).toHaveValue("2026-10-31");
    expect(screen.getByText(/매수 환율 1,300원/)).toBeInTheDocument();
  });

  it("수량을 넣기 전·가진 것보다 많으면 저장을 막고 이유를 말한다", async () => {
    그리기(애플);
    expect(screen.getByText("수량을 넣어 주세요")).toBeInTheDocument();
    expect(저장단추()).toBeDisabled();
    await userEvent.type(칸("수량"), "11");
    expect(screen.getByText("가진 것(10주)보다 많이 팔 수 없어요")).toBeInTheDocument();
  });

  it("'전부' 는 가진 수량을, 팔면 실현 손익과 보유에서 빠진다는 것을 보여 준다", async () => {
    그리기(애플);
    await userEvent.click(screen.getByRole("button", { name: "전부" }));
    expect(칸("수량")).toHaveValue("10");
    // 10 × 120 × 1,400 − 10 × 100 × 1,300 = 380,000원
    expect(screen.getByText(/실현 손익/)).toHaveTextContent("+₩380,000");
    expect(screen.getByText(/없음\(보유에서 빠져요\)/)).toBeInTheDocument();
  });

  it("더 사기로 바꾸면 새 평단과 매수 환율", async () => {
    그리기(애플);
    await userEvent.click(screen.getByRole("button", { name: "더 사기" }));
    await userEvent.type(칸("수량"), "10");
    expect(screen.getByText(/새 평단/)).toHaveTextContent("20주 · 새 평단 $110.00 · 매수 환율 1,354.55원");
  });

  it("저장하면 서버로 — 달러는 환율과 함께, 쉼표를 넣어 쳐도 읽는다", async () => {
    그리기(애플);
    await userEvent.type(칸("수량"), "5");
    await userEvent.clear(칸("가격"));
    await userEvent.type(칸("가격"), "1,200.5");
    await userEvent.type(칸("수수료"), "1");
    await userEvent.click(저장단추());
    await waitFor(() => expect(portfolioApi.trade).toHaveBeenCalledWith(7, {
      side: "sell", shares: 5, price: 1200.5, fx: 1400, fee: 1, trade_date: "2026-10-31",
    }));
    await waitFor(() => expect(닫음).toHaveBeenCalled());
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["portfolio-trades"] });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["portfolio-items-all"] });
  });

  it("원화 종목은 환율 칸이 없고 환율을 안 보낸다", async () => {
    그리기(삼성);
    expect(screen.queryByRole("textbox", { name: "환율" })).toBeNull();
    await userEvent.type(칸("수량"), "1");
    expect(screen.getByText(/실현 손익/)).toHaveTextContent("+₩10,000");
    await userEvent.click(저장단추());
    await waitFor(() => expect(portfolioApi.trade).toHaveBeenCalledWith(8, expect.objectContaining({ fx: null, price: 80_000 })));
  });

  it("서버가 거절하면 창을 두고 이유를 보인다", async () => {
    vi.mocked(portfolioApi.trade).mockRejectedValue(Object.assign(new Error("x"), {
      isAxiosError: true, response: { status: 400, data: { detail: "가진 것보다 많이 팔 수 없어요" } },
    }));
    그리기(애플);
    await userEvent.type(칸("수량"), "1");
    await userEvent.click(저장단추());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(닫음).not.toHaveBeenCalled();
  });
});
