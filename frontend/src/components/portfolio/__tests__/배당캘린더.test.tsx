/**
 * 배당 일정을 캘린더 파일로.
 *
 * 배당 달력의 원칙을 캘린더에도 그대로 — **공시된 날짜만** 하루로 박는다. 지난 주기로 미뤄 본
 * 날짜는 화면에서도 '10월 초' 로 뭉개는 값이라, 캘린더에 하루로 넣으면 확정처럼 보인다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DividendCalendar, { 배당일정들 } from "@/components/portfolio/DividendCalendar";
import { portfolioApi, type 배당줄 } from "@/api/stocks";

vi.mock("@/api/stocks", () => ({ portfolioApi: { getDividends: vi.fn() } }));
vi.mock("@/hooks/useExchangeRate", () => ({ useExchangeRate: () => 1400 }));
const 받은것: { 이름: string; 글: string }[] = [];
vi.mock("@/utils/캘린더", async (원본) => ({
  ...(await 원본<any>()),
  ics받기: (이름: string, 글: string) => 받은것.push({ 이름, 글 }),
}));

const 오늘 = new Date("2026-10-31T03:00:00Z");

const 줄 = (덮: Partial<배당줄> = {}): 배당줄 => ({
  symbol: "005930", market: "KR", name: "삼성전자",
  date: "2026-12-31", confirmed: true, ex_date: "2026-12-31", pay_date: null,
  cycle: "분기", months: [12], per_month: 1, currency: "KRW",
  last_date: "2026-09-30", last_amount: 361, per_year: 1444, shares: 100,
  expected: 36_100, expected_year: 144_400, ...덮,
} as 배당줄);

describe("어떤 날짜를 넣나", () => {
  it("공시된 기준일과 입금일 — 날짜 순, 받을 돈을 적는다", () => {
    const { 일정들, 빠진수 } = 배당일정들([
      줄({ pay_date: "2027-04-20" }),
      줄({ symbol: "AAPL", market: "US", name: "애플", currency: "USD", date: "2026-11-10",
           ex_date: "2026-11-10", pay_date: "2026-11-13", expected: 2.6 }),
    ], 오늘);
    expect(빠진수).toBe(0);
    expect(일정들.map((e) => `${e.시작} ${e.제목}`)).toEqual([
      "2026-11-10 [배당 기준일] 애플",
      "2026-11-13 [배당 입금] 애플",
      "2026-12-31 [배당 기준일] 삼성전자",
      "2027-04-20 [배당 입금] 삼성전자",
    ]);
    expect(일정들[0].설명).toContain("그날까지 갖고 있어야");
    expect(일정들[1].설명).toBe("받을 돈(세전) 약 $2.60");
    expect(일정들[2].설명).toContain("약 36,100원");
  });

  it("예상 날짜(공시 전)는 안 넣고 센다", () => {
    const { 일정들, 빠진수 } = 배당일정들([
      줄({ confirmed: false, ex_date: null, date: "2026-12-15" }),
      줄({ symbol: "000660", confirmed: false, ex_date: null, date: "2027-01-10" }),
    ], 오늘);
    expect(일정들).toEqual([]);
    expect(빠진수).toBe(2);
  });

  it("지난 날짜는 빼고, 기준일은 지났어도 입금이 남았으면 입금만", () => {
    const { 일정들, 빠진수 } = 배당일정들([
      줄({ date: "2026-10-20", ex_date: "2026-10-20", pay_date: "2026-11-05" }),
      줄({ symbol: "X", date: "2026-09-01", ex_date: "2026-09-01", pay_date: "2026-09-20" }),
      줄({ symbol: "Y", confirmed: false, ex_date: null, date: "2026-10-01" }),   // 지난 예상 — 셀 것도 없다
    ], 오늘);
    expect(일정들.map((e) => e.제목)).toEqual(["[배당 입금] 삼성전자"]);
    expect(빠진수).toBe(0);
  });

  it("오늘 날짜는 넣는다", () => {
    expect(배당일정들([줄({ date: "2026-10-31", ex_date: "2026-10-31" })], 오늘).일정들).toHaveLength(1);
  });

  it("안 갖고 있으면(받을 돈 없음) 금액을 안 적는다", () => {
    const { 일정들 } = 배당일정들([줄({ expected: null, pay_date: "2027-01-05" })], 오늘);
    expect(일정들[0].설명).toBe("그날까지 갖고 있어야 이번 배당을 받아요.");
    expect(일정들[1].설명).toBeUndefined();
    // 0원도 같다 — '약 0원' 이라고 적으면 배당을 안 주는 줄 안다
    expect(배당일정들([줄({ expected: 0 })], 오늘).일정들[0].설명).toBe("그날까지 갖고 있어야 이번 배당을 받아요.");
  });

  it("같은 일정은 늘 같은 UID — 다시 받으면 고쳐지고 두 번 안 생긴다", () => {
    const a = 배당일정들([줄({ pay_date: "2027-04-20" })], 오늘).일정들;
    const b = 배당일정들([줄({ pay_date: "2027-04-20" })], 오늘).일정들;
    expect(a.map((e) => e.고유)).toEqual(b.map((e) => e.고유));
    expect(new Set(a.map((e) => e.고유)).size).toBe(2);
    expect(a[0].고유).toMatch(/^[A-Za-z0-9.-]+$/);
  });

  it("UID 에는 캘린더가 못 읽는 글자를 안 넣는다 — 'BRK/B' 같은 기호도", () => {
    const { 일정들 } = 배당일정들([줄({ symbol: "BRK/B 우", market: "US" })], 오늘);
    expect(일정들[0].고유).toBe("div-US-BRKB-2026-12-31-rec");
  });
});

describe("배당 달력의 캘린더 단추", () => {
  beforeEach(() => {
    받은것.length = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(오늘);
  });
  afterEach(() => vi.useRealTimers());

  function 그리기(items: 배당줄[], 미리보기 = false) {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items, pending: 0 } as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <DividendCalendar 미리보기={미리보기 ? { items, pending: 0 } : undefined} />
      </QueryClientProvider>,
    );
  }

  it("누르면 .ics 를 받고 몇 개인지 알려 준다", async () => {
    그리기([줄({ pay_date: "2027-01-20" }), 줄({ symbol: "000660", name: "SK하이닉스", confirmed: false, ex_date: null })]);
    await userEvent.click(await screen.findByRole("button", { name: /캘린더/ }));
    expect(받은것).toHaveLength(1);
    expect(받은것[0].이름).toBe("dividends.ics");
    expect(받은것[0].글).toContain("SUMMARY:[배당 입금] 삼성전자");
    expect(받은것[0].글).not.toContain("SK하이닉스");
    expect(screen.getByRole("status")).toHaveTextContent("2개 일정을 받았어요 · 예상 날짜 1곳은 공시되면 다시 받으세요");
  });

  it("공시된 날짜가 하나도 없으면 파일을 안 만들고 이유를 말한다", async () => {
    그리기([줄({ confirmed: false, ex_date: null })]);
    await userEvent.click(await screen.findByRole("button", { name: /캘린더/ }));
    expect(받은것).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("공시된 배당 날짜가 아직 없어요(예상 날짜 1곳은 공시되면 넣을 수 있어요)");
  });

  it("남은 날짜가 아예 없으면 그렇게 말한다", async () => {
    그리기([줄({ date: "2026-09-01", ex_date: "2026-09-01" })]);
    await userEvent.click(await screen.findByRole("button", { name: /캘린더/ }));
    expect(screen.getByRole("status")).toHaveTextContent("앞으로 남은 배당 날짜가 없어요");
  });

  it("로그인 전 예시에는 안 붙인다 — 내 종목이 아니다", async () => {
    그리기([줄()], true);
    await screen.findByText("올해 예상 배당");
    expect(screen.queryByRole("button", { name: /캘린더/ })).toBeNull();
  });
});
