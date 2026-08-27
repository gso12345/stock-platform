/**
 * 자산 추가 — 종목과 현금을 한 창에서.
 *
 * 예전에는 창이 둘이었다. '종목 추가' 와 '현금 추가' 버튼이 나란히
 * 있었는데, 담으려는 사람 입장에서는 둘 다 '내 자산에 뭘 넣는' 같은
 * 일이다. 무엇을 넣느냐에 따라 눌러야 할 버튼이 달라서, 현금 버튼을
 * 못 찾고 종목 검색창에 '현금' 을 쳐 보는 일이 생긴다.
 *
 * 한 창에서 종류만 고르게 합쳤다. 여기서 못 박는 것 —
 *
 *   1) 종류를 고르는 줄이 있고, 고르면 화면이 따라간다
 *   2) 현금은 검색 단계를 건너뛴다(고를 종목이 없다)
 *   3) 저장할 때 넘기는 모양이 종류마다 다르다 — 현금은 수량 1 에
 *      금액을 싣는다. 이게 어긋나면 합계가 통째로 틀어진다
 *   4) 고칠 때는 종류를 못 바꾼다. 종목을 현금으로 바꾸면 수량·평단이
 *      갈 곳이 없다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PortfolioItem } from "@/types/portfolio";

/* 검색 결과를 검사가 켜고 끈다 — '종목을 고른 뒤 현금으로 바꾸면?' 을
   보려면 고를 종목이 실제로 있어야 한다 */
let 검색결과: { symbol: string; market: string; name: string; exchange: string }[] = [];
vi.mock("@/hooks/useStockSearch", () => ({
  useStockSearch: () => ({ query: "삼성", setQuery: vi.fn(), results: 검색결과, searching: false }),
}));
vi.mock("@/api/stocks", () => ({
  stocksApi: { getPrice: vi.fn(() => Promise.resolve({ price: 100 })) },
}));

import { PortfolioModal } from "@/components/portfolio/PortfolioModals";

const 저장 = vi.fn();

function 그리기(item?: PortfolioItem) {
  return render(
    <PortfolioModal item={item} defaultFx={1400} onClose={vi.fn()} onSave={저장} />,
  );
}

beforeEach(() => { vi.clearAllMocks(); 검색결과 = []; });

describe("무엇을 담을지 고른다", () => {
  it("새로 담을 때는 종류 줄이 있고 주식·ETF 로 시작한다", () => {
    그리기();
    expect(screen.getByRole("button", { name: "주식·ETF" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "현금" })).toHaveAttribute("aria-pressed", "false");
    // 주식은 먼저 종목을 골라야 한다
    expect(screen.getByPlaceholderText(/종목명 또는 코드 검색/)).toBeInTheDocument();
  });

  it("현금을 고르면 검색을 건너뛰고 곧장 금액을 묻는다", async () => {
    /* 현금에는 고를 종목이 없다. 검색창을 그대로 두면 '현금' 을 쳐
       보게 되고, 아무것도 안 나오면 담을 방법이 없다고 느낀다 */
    그리기();
    await userEvent.click(screen.getByRole("button", { name: "현금" }));

    expect(screen.queryByPlaceholderText(/종목명 또는 코드 검색/)).toBeNull();
    expect(screen.getByText(/금액 \*/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "원화 (₩)" })).toHaveAttribute("aria-pressed", "true");
  });

  it("종목을 고른 뒤 현금으로 바꿔도 화면이 하나다", async () => {
    /* 고른 종목이 남아 있으면 현금 화면과 매수 정보 화면이 같이
       그려진다 — 저장 버튼이 둘이 되고, 어느 쪽이 눌리는지 알 수 없다 */
    검색결과 = [{ symbol: "005930", market: "KR", name: "삼성전자", exchange: "KOSPI" }];
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /005930/ }));
    expect(screen.getByText(/매수 정보 입력/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "현금" }));
    expect(screen.getAllByRole("button", { name: /저장/ })).toHaveLength(1);
    expect(screen.getByText(/금액 \*/)).toBeInTheDocument();
    // 매수 정보 칸(수량)은 안 보여야 한다
    expect(screen.queryByText(/보유 수량/)).toBeNull();
  });

  it("주식으로 되돌아오면 다시 검색부터다", async () => {
    그리기();
    await userEvent.click(screen.getByRole("button", { name: "현금" }));
    await userEvent.click(screen.getByRole("button", { name: "주식·ETF" }));
    expect(screen.getByPlaceholderText(/종목명 또는 코드 검색/)).toBeInTheDocument();
  });
});

describe("현금을 담을 때 넘기는 모양", () => {
  async function 현금담기(금액: string, 통화?: "달러 ($)") {
    그리기();
    await userEvent.click(screen.getByRole("button", { name: "현금" }));
    if (통화) await userEvent.click(screen.getByRole("button", { name: 통화 }));
    await userEvent.type(screen.getByPlaceholderText("0"), 금액);
    await userEvent.click(screen.getByRole("button", { name: /저장/ }));
  }

  it("수량 1 에 금액을 싣는다 — 합계가 그 규칙으로 난다", async () => {
    /* 현금에는 '몇 주' 가 없지만 보유 종목과 같은 표에 들어간다.
       수량 × 평단으로 합계를 내므로 수량이 1 이 아니면 그만큼 곱해진다 */
    await 현금담기("5000000");
    expect(저장).toHaveBeenCalledTimes(1);
    expect(저장.mock.calls[0][0]).toMatchObject({
      symbol: "현금", market: "KR", name: "원화 현금",
      shares: 1, avgPrice: 5_000_000, currency: "KRW", assetClass: "현금",
    });
  });

  it("달러 현금은 시장도 US 로 간다", async () => {
    /* market 이 KR 이면 원화로 세어 환율이 안 곱해진다 */
    await 현금담기("1000", "달러 ($)");
    expect(저장.mock.calls[0][0]).toMatchObject({
      market: "US", name: "달러 현금", currency: "USD", avgPrice: 1000, shares: 1,
    });
  });

  it("금액이 없으면 저장 버튼이 안 눌린다", async () => {
    그리기();
    await userEvent.click(screen.getByRole("button", { name: "현금" }));
    expect(screen.getByRole("button", { name: /저장/ })).toBeDisabled();
  });

  it("0원은 못 담는다 — 담아 봐야 화면에 0원 줄만 생긴다", async () => {
    그리기();
    await userEvent.click(screen.getByRole("button", { name: "현금" }));
    await userEvent.type(screen.getByPlaceholderText("0"), "0");
    expect(screen.getByRole("button", { name: /저장/ })).toBeDisabled();
  });
});

describe("고칠 때", () => {
  const 현금항목: PortfolioItem = {
    id: 9, symbol: "현금", market: "KR", name: "원화 현금", shares: 1,
    avgPrice: 3_000_000, currency: "KRW", assetClass: "현금", note: "비상금",
  };

  it("현금을 고치면 현금 화면으로 열린다", () => {
    /* 예전에는 현금이면 아예 다른 창이 떴다. 지금은 같은 창이 종류를
       알아서 잡는다 */
    그리기(현금항목);
    expect(screen.getByText("현금 수정")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3000000")).toBeInTheDocument();
    expect(screen.getByDisplayValue("비상금")).toBeInTheDocument();
  });

  it("고칠 때는 종류를 못 바꾼다", () => {
    /* 종목을 현금으로 바꾸면 수량·평단·매수일이 갈 곳이 없다.
       바꾸려면 지우고 다시 담는 편이 맞다 */
    그리기(현금항목);
    expect(screen.queryByRole("button", { name: "주식·ETF" })).toBeNull();
  });

  it("종목을 고치면 매수 정보 화면으로 열린다", () => {
    그리기({
      id: 1, symbol: "005930", market: "KR", name: "삼성전자",
      shares: 10, avgPrice: 50_000, currency: "KRW", assetClass: "국내주식",
    });
    expect(screen.getByText("보유 수정")).toBeInTheDocument();
    expect(screen.queryByText(/금액 \*/)).toBeNull();
  });
});
