/**
 * 매매 탭 — 그해 실현 손익, 해외주식 양도세 어림, '앞으로 얼마까지 세금 없이' 를 보여 준다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { portfolioApi, type 매매응답 } from "@/api/stocks";
import { useSettingsStore } from "@/store/settingsStore";
import TradeHistory from "../TradeHistory";

vi.mock("@/api/stocks", () => ({ portfolioApi: { getTrades: vi.fn(), deleteTrade: vi.fn() } }));

const 응답 = (덮: Partial<매매응답["summary"]> = {}, items: 매매응답["items"] = []): 매매응답 => ({
  year: 2026, years: [2026, 2025], items,
  summary: { realized: 1_200_000, domestic: 200_000, overseas: 1_000_000, deduction: 2_500_000,
             taxable: 0, tax: 0, rate: 0.22, ...덮 },
});
const 판줄 = {
  id: 3, portfolioId: 1, itemId: 7, symbol: "AAPL", market: "US", name: "애플", currency: "USD" as const,
  side: "sell" as const, shares: 5, price: 120, fx: 1400, fee: 1, avgCost: 100, avgFx: 1300,
  realized: 188_600, tradeDate: "2026-03-02", note: null, overseas: true,
};

function 그리기(로그인 = true, portfolioId?: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><TradeHistory 로그인={로그인} portfolioId={portfolioId} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.getState().setColorScheme("red-blue");
  vi.mocked(portfolioApi.getTrades).mockResolvedValue(응답());
  vi.mocked(portfolioApi.deleteTrade).mockResolvedValue({});
});

describe("매매 탭", () => {
  it("로그인 전에는 부르지 않고 무엇을 하는지 말한다", () => {
    그리기(false);
    expect(screen.getByText("사고판 기록과 해외주식 양도세 어림")).toBeInTheDocument();
    expect(portfolioApi.getTrades).not.toHaveBeenCalled();
  });

  it("공제 안이면 세금이 없고 앞으로 얼마까지 괜찮은지", async () => {
    그리기();
    expect(await screen.findByText("낼 세금이 없어요")).toBeInTheDocument();
    expect(screen.getByText("올해 해외주식으로 ₩1,500,000까지 더 이익을 내도 세금이 없어요")).toBeInTheDocument();
    expect(screen.getByText("+₩1,200,000")).toHaveClass("text-accent-red");
  });

  it("공제를 넘으면 세액과 셈을 보인다", async () => {
    vi.mocked(portfolioApi.getTrades).mockResolvedValue(응답({ overseas: 5_000_000, taxable: 2_500_000, tax: 550_000 }));
    그리기();
    expect(await screen.findByText("₩550,000")).toBeInTheDocument();
    expect(screen.getByText(/해외 손익 \+₩5,000,000 − 기본공제 ₩2,500,000 = 과세표준 ₩2,500,000 × 22%/)).toBeInTheDocument();
    expect(screen.queryByText(/더 이익을 내도 세금이 없어요/)).toBeNull();
    expect(screen.getByText(/어림값이에요/)).toBeInTheDocument();
  });

  it("해를 고르면 그해로 다시 부르고, 포트폴리오도 넘긴다", async () => {
    그리기(true, 4);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "해 고르기" }), "2025");
    await waitFor(() => expect(portfolioApi.getTrades).toHaveBeenLastCalledWith(2025, 4));
    expect(vi.mocked(portfolioApi.getTrades).mock.calls[0]).toEqual([undefined, 4]);
  });

  it("기록 줄 — 지우기는 묻고 나서, 보유는 그대로라고 말한다", async () => {
    vi.mocked(portfolioApi.getTrades).mockResolvedValue(응답({}, [판줄]));
    그리기();
    expect(await screen.findByText("애플")).toBeInTheDocument();
    expect(screen.getByText("5주 × $120 · 환율 1,400")).toBeInTheDocument();
    expect(screen.getByText("+₩188,600")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "2026-03-02 애플 기록 지우기" }));
    expect(screen.getByText(/보유 수량은 그대로라/)).toBeInTheDocument();
    expect(portfolioApi.deleteTrade).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(portfolioApi.deleteTrade).toHaveBeenCalledWith(3));
  });

  it("기록이 없으면 어떻게 남기는지", async () => {
    그리기();
    expect(await screen.findByText("2026년에 사고판 기록이 없어요")).toBeInTheDocument();
  });

  it("해가 하나뿐이면 고르는 칸이 없다", async () => {
    vi.mocked(portfolioApi.getTrades).mockResolvedValue({ ...응답(), years: [2026] });
    그리기();
    await screen.findByText("2026년 실현 손익");
    expect(screen.queryByRole("combobox", { name: "해 고르기" })).toBeNull();
  });
});
