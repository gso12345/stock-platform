/**
 * 배당 달력.
 *
 * 이 화면은 '확실하지 않은 것' 을 다룬다. 그래서 정직함이 곧 정확성이다.
 *
 *   1) 회사가 공시한 날짜와 '지난 주기로 미뤄 본 날짜' 를 섞으면 안 된다.
 *      추정치를 '9월 30일' 이라고 적으면, 그날 안 들어왔을 때 사람은
 *      배당이 취소된 줄 안다. 추정은 '9월 말' 로 뭉갠다.
 *   2) 안 갖고 있는 종목(관심종목)에 '0원' 이라고 적으면 '배당을 안
 *      준다' 로 읽힌다. 금액 자체를 안 쓴다.
 *   3) 달러와 원을 그냥 더하면 완전히 틀린 숫자가 된다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DividendCalendar, { 날짜글, 어림날짜글, 남은날 }
  from "@/components/portfolio/DividendCalendar";
import { portfolioApi, type 배당줄 } from "@/api/stocks";

vi.mock("@/api/stocks", () => ({ portfolioApi: { getDividends: vi.fn() } }));

const 앞으로 = (일: number) => {
  const d = new Date();
  d.setDate(d.getDate() + 일);
  return d.toISOString().slice(0, 10);
};

const 줄 = (덮: Partial<배당줄> = {}): 배당줄 => ({
  symbol: "005930", market: "KR", name: "삼성전자",
  date: 앞으로(30), confirmed: false, ex_date: null, pay_date: null,
  cycle: "분기", last_date: "2026-06-30", last_amount: 361,
  per_year: 1444, shares: 100, expected: 36_100, expected_year: 144_400,
  recent: [], ...덮,
});

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><DividendCalendar /></QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());


describe("날짜 글", () => {
  it("확정된 날은 하루까지 적는다", () => {
    expect(날짜글("2026-09-30")).toBe("9월 30일");
  });

  it("추정한 날은 순으로 뭉갠다", () => {
    /* '9월 30일' 이라고 적으면 그날 안 들어왔을 때 사람은 배당이
       취소된 줄 안다. 애초에 하루까지 맞는 값이 아니다. */
    expect(어림날짜글("2026-09-30")).toBe("9월 말");
    expect(어림날짜글("2026-09-05")).toBe("9월 초");
    expect(어림날짜글("2026-09-15")).toBe("9월 중순");
  });

  it("남은 날을 센다", () => {
    const 오늘 = new Date(2026, 8, 1);           // 2026-09-01
    expect(남은날("2026-09-11", 오늘)).toBe(10);
    expect(남은날("2026-09-01", 오늘)).toBe(0);
  });
});


describe("확정과 예상을 섞지 않는다", () => {
  it("공시된 날은 '공시' 로 적고 날짜를 그대로 쓴다", async () => {
    const 날 = 앞으로(10);
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ confirmed: true, date: 날, ex_date: 날 })], pending: 0,
    });
    그리기();
    expect(await screen.findByText(/^공시 · /)).toBeInTheDocument();
    expect(screen.getByText(날짜글(날))).toBeInTheDocument();
  });

  it("추정한 날은 '예상' 으로 적고 날짜를 뭉갠다", async () => {
    const 날 = 앞으로(40);
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ confirmed: false, date: 날 })], pending: 0,
    });
    그리기();
    expect(await screen.findByText(/^예상 · /)).toBeInTheDocument();
    expect(screen.getByText(어림날짜글(날))).toBeInTheDocument();
    expect(screen.queryByText(날짜글(날))).not.toBeInTheDocument();
  });
});


describe("금액", () => {
  it("안 갖고 있는 종목에는 금액을 안 쓴다", async () => {
    /* 관심종목은 수량이 0이다. '0원' 이라고 적으면 '배당을 안 준다'
       로 읽힌다. */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ shares: 0, expected: null, expected_year: null })], pending: 0,
    });
    그리기();
    await screen.findByText("삼성전자");
    expect(screen.queryByText(/0원$/)).not.toBeInTheDocument();
    expect(screen.queryByText("한 해 예상")).not.toBeInTheDocument();
  });

  it("갖고 있으면 이번 회차에 받을 돈을 쓴다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄()], pending: 0,
    });
    그리기();
    expect(await screen.findByText("36,100원")).toBeInTheDocument();
  });

  it("원과 달러를 더하지 않고 나눠 적는다", async () => {
    /* 그냥 더하면 완전히 틀린 숫자가 된다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [
        줄({ expected_year: 144_400 }),
        줄({ symbol: "AAPL", market: "US", name: "애플", last_amount: 0.25,
             shares: 10, expected: 2.5, expected_year: 10 }),
      ],
      pending: 0,
    });
    그리기();
    const 합 = await screen.findByText(/144,400원/);
    expect(합).toHaveTextContent("144,400원 · $10.00");
  });

  it("해외 종목은 달러로 적는다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ symbol: "AAPL", market: "US", name: "애플",
                   last_amount: 0.25, shares: 10, expected: 2.5, expected_year: 10 })],
      pending: 0,
    });
    그리기();
    expect(await screen.findByText("$2.50")).toBeInTheDocument();
  });
});


describe("아직 못 받은 것", () => {
  it("확인 중인 종목 수를 숨기지 않는다", async () => {
    /* 목록이 짧은 것과 배당이 없는 것은 다른 일이다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄()], pending: 4,
    });
    그리기();
    expect(await screen.findByText("4개 확인 중")).toBeInTheDocument();
  });

  it("아직 하나도 못 받았으면 '없다' 고 하지 않는다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [], pending: 3 });
    그리기();
    expect(await screen.findByText(/확인하는 중/)).toBeInTheDocument();
  });

  it("정말 없으면 없다고 한다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [], pending: 0 });
    그리기();
    expect(await screen.findByText(/배당을 주는 종목이 아직 없어요/)).toBeInTheDocument();
  });

  it("불러오기에 실패하면 다시 시도할 수 있다", async () => {
    vi.mocked(portfolioApi.getDividends).mockRejectedValue(new Error("서버 오류"));
    그리기();
    expect(await screen.findByRole("button", { name: /다시/ })).toBeInTheDocument();
  });
});


describe("순서", () => {
  it("서버가 준 순서(날짜순)를 그대로 그린다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [
        줄({ symbol: "AAPL", name: "애플", date: 앞으로(5) }),
        줄({ symbol: "005930", name: "삼성전자", date: 앞으로(30) }),
      ],
      pending: 0,
    });
    그리기();
    await screen.findByText("애플");
    const 이름들 = screen.getAllByText(/애플|삼성전자/).map((e) => e.textContent);
    expect(이름들).toEqual(["애플", "삼성전자"]);
  });

  it("자산 화면에 붙어 있다", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const 글 = fs.readFileSync(
      path.resolve(__dirname, "../../../pages/Portfolio.tsx"), "utf-8");
    expect(글).toContain("isLoggedIn && items.length > 0 && <DividendCalendar />");
  });
});
