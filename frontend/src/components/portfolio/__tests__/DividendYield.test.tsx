/**
 * 배당 화면에 새로 붙은 것 — 세금, '내 몫', 그리고 배당률 두 가지.
 *
 * 배당 금액은 사람이 손으로 검산하는 숫자다. 그래서 여기서 막고 싶은
 * 사고는 전부 '숫자가 조용히 달라지는 것' 이다.
 *
 *   1) 세율은 market 이 아니라 **통화**로 가른다. 국내 상장 해외 ETF 는
 *      market 이 US·ETF 인데 배당은 원화로, 국내에서 이미 떼고 들어온다.
 *      market 으로 가르면 그런 종목만 엉뚱한 세율을 문다.
 *   2) 세후는 **선택**이다. 세후로 를 안 넘기면 예전과 똑같은 값이 나와야
 *      한다. 기본값이 뒤집히면 세금을 켠 적 없는 사람 전원의 배당 금액이
 *      하루아침에 달라진다 — 그런데 화면 어디에도 '왜' 가 안 적혀 있다.
 *   3) 통화가 섞이면 세율도 섞인다. 목록 전체에 한 세율을 먹이면 합계는
 *      그럴듯한데 어느 종목의 값도 맞지 않는다.
 *   4) 배당률의 분모는 화면이 보고 있는 몫이다. 서버는 전량 기준으로
 *      세니, 포트폴리오 하나만 열어 두면 분자만 크고 분모는 작아
 *      '내 자산의 8% 가 배당' 같은 배당률이 찍힌다.
 *   5) 분모를 모를 때는 0% 가 아니라 '—' 다. 0% 는 '배당을 안 준다' 로
 *      읽힌다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DividendCalendar, {
  원천징수, 세율, 회차금액, 한달금액, 달마다, 내몫으로, 배당키, type 보유몫,
} from "@/components/portfolio/DividendCalendar";
import { portfolioApi, type 배당줄 } from "@/api/stocks";

vi.mock("@/api/stocks", () => ({ portfolioApi: { getDividends: vi.fn() } }));
/* 환율을 못 박는다. 진짜 환율을 쓰면 손계산이 그날 시세에 흔들린다 */
vi.mock("@/hooks/useExchangeRate", () => ({ useExchangeRate: () => 1400 }));

const 환율 = 1400;

const 줄 = (덮: Partial<배당줄> = {}): 배당줄 => ({
  symbol: "005930", market: "KR", name: "삼성전자",
  date: "2026-12-30", confirmed: false, ex_date: null, pay_date: null,
  cycle: "분기", months: [3, 6, 9, 12], per_month: 1, currency: "KRW",
  last_date: "2026-06-30", last_amount: 1000,
  per_year: 4000, shares: 100, expected: 100_000, expected_year: 400_000,
  recent: [], ...덮,
});

/** 원화 종목 하나 — 한 회차 1000원 × 100주 = 100,000원 */
const 원화줄 = (덮: Partial<배당줄> = {}) => 줄(덮);

/** 달러 종목 하나 — $0.5 × 200주 × 1400 = 140,000원 */
const 달러줄 = (덮: Partial<배당줄> = {}) => 줄({
  symbol: "SCHD", market: "US", name: "SCHD", currency: "USD",
  last_amount: 0.5, shares: 200, ...덮,
});

function 그리기(props: React.ComponentProps<typeof DividendCalendar> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><DividendCalendar {...props} /></QueryClientProvider>,
  );
}

/** 요약 칸 하나만 들여다본다.
 *
 *  화면 전체에서 "—" 나 "8.00%" 를 찾으면 엉뚱한 곳이 걸린다 — 아래
 *  '고른 달' 합계도 배당이 없으면 "—" 를 쓴다. */
function 요약칸(라벨: string) {
  const 이름 = screen.getByText(라벨);
  const 칸 = 이름.parentElement;
  expect(칸, `'${라벨}' 칸을 못 찾았다`).not.toBeNull();
  return within(칸!);
}

beforeEach(() => vi.clearAllMocks());


describe("세율은 통화로 가른다", () => {
  it("원화는 15.4%, 달러는 15% — 두 숫자를 바꿔 끼우면 배당금이 조용히 틀어진다", () => {
    expect(세율("KRW")).toBe(0.154);
    expect(세율("USD")).toBe(0.15);
    /* 상수 자체도 못 박는다. 함수만 보면 두 상수를 서로 바꿔도
       '어쨌든 다른 값' 이라 눈치채기 어렵다 */
    expect(원천징수.국내).toBe(0.154);
    expect(원천징수.해외).toBe(0.15);
    expect(원천징수.국내).not.toBe(원천징수.해외);
  });

  it("국내 상장 해외 ETF 를 market 으로 가르면 틀린다 — 원화로 주면 국내 세율이다", () => {
    /* market 은 US/ETF 인데 배당은 원화로 들어오는 종목. market 으로
       가르는 순간 이 종목만 해외 15% 를 물게 된다 */
    expect(세율("KRW")).toBe(원천징수.국내);
    const 국내상장해외etf = 줄({ symbol: "360750", market: "ETF", currency: "KRW",
                                last_amount: 1000, shares: 100 });
    expect(회차금액(국내상장해외etf, 환율, true)).toBeCloseTo(100_000 * (1 - 0.154), 6);
    // 해외 세율(15%)이 먹었다면 85,000 이 된다
    expect(회차금액(국내상장해외etf, 환율, true)).not.toBeCloseTo(100_000 * (1 - 0.15), 2);
  });

  it("달러로 주면 market 이 KR 이어도 해외 세율이다", () => {
    const 국내계좌달러 = 줄({ market: "KR", currency: "USD",
                             last_amount: 0.5, shares: 200 });
    expect(회차금액(국내계좌달러, 환율, true)).toBeCloseTo(140_000 * (1 - 0.15), 6);
    expect(회차금액(국내계좌달러, 환율, true)).not.toBeCloseTo(140_000 * (1 - 0.154), 2);
  });

  it("통화를 모르면 해외로 본다 — 국내로 넘겨 짚으면 더 떼고 보여 준다", () => {
    expect(세율(undefined)).toBe(0.15);
    expect(세율("")).toBe(0.15);
    expect(세율("JPY")).toBe(0.15);
  });
});


describe("세후는 선택이다 — 안 켠 사람의 값이 안 바뀐다", () => {
  it("세후로 를 안 넘기면 예전 값 그대로다 — 기본값이 뒤집히면 전원의 배당금이 달라진다", () => {
    const 원 = 원화줄();
    const 달 = 달러줄();
    expect(회차금액(원, 환율)).toBe(100_000);          // 1000 × 100
    expect(회차금액(달, 환율)).toBe(140_000);          // 0.5 × 200 × 1400
    expect(한달금액(원, 환율)).toBe(100_000);
    expect(달마다([원], 환율)[2]).toBe(100_000);       // 3월
    /* 세율이 한 번이라도 먹었다면 이 값들이 나온다 */
    expect(회차금액(원, 환율)).not.toBe(84_600);
    expect(회차금액(달, 환율)).not.toBe(119_000);
  });

  it("세후로=false 도 세전이다 — 기본값만 맞추고 인자를 무시하는 것을 막는다", () => {
    expect(회차금액(원화줄(), 환율, false)).toBe(100_000);
    expect(한달금액(달러줄(), 환율, false)).toBe(140_000);
    expect(달마다([원화줄()], 환율, false)[2]).toBe(100_000);
  });

  it("원화 종목은 환율을 안 탄다 — 환산을 걸면 배당금이 1400배가 된다", () => {
    expect(회차금액(원화줄(), 9_999)).toBe(100_000);
    expect(회차금액(원화줄(), 9_999, true)).toBeCloseTo(84_600, 6);
  });

  it("세후로=true 면 통화별 세율이 먹는다", () => {
    const 원후 = 회차금액(원화줄(), 환율, true);
    const 달후 = 회차금액(달러줄(), 환율, true);
    expect(원후).not.toBeNull();
    expect(달후).not.toBeNull();
    expect(원후).toBeCloseTo(84_600, 6);   // 100,000 × (1 − 0.154)
    expect(달후).toBeCloseTo(119_000, 6);  // 140,000 × (1 − 0.15)
    // 세전보다 반드시 적다
    expect(원후).toBeLessThan(100_000);
    expect(달후).toBeLessThan(140_000);
  });

  it("한 달치는 회차 수만큼 곱하되 세금은 회차마다 똑같이 뗀다", () => {
    /* 주배당은 한 달에 네 번쯤 들어온다. 한 번으로 세면 4분의 1이 된다 */
    const 주배당 = 원화줄({ cycle: "주", per_month: 4 });
    expect(한달금액(주배당, 환율)).toBe(400_000);
    expect(한달금액(주배당, 환율, true)).toBeCloseTo(400_000 * (1 - 0.154), 6);
    /* 경계 — per_month 가 1 이하면 한 번으로 센다. 0 과 1 만 보면
       '> 1' 을 통째로 지우는 뮤테이션이 같은 값을 내고 지나간다.
       1보다 작은 값(반기·연배당을 달로 쪼갠 값)까지 넣어야 잡힌다 */
    expect(한달금액(원화줄({ per_month: 1 }), 환율)).toBe(100_000);
    expect(한달금액(원화줄({ per_month: 0 }), 환율)).toBe(100_000);
    expect(한달금액(원화줄({ per_month: 0.5 }), 환율)).toBe(100_000);
    expect(한달금액(원화줄({ per_month: 0.5 }), 환율, true)).toBeCloseTo(84_600, 6);
    expect(한달금액(원화줄({ per_month: 4.35 }), 환율)).toBeCloseTo(435_000, 6);
  });

  it("수량이 0이면 세후로도 0이다 — 세금 계산이 없는 배당을 만들어 내면 안 된다", () => {
    const 관심종목 = 원화줄({ shares: 0 });
    expect(회차금액(관심종목, 환율)).toBe(0);
    expect(회차금액(관심종목, 환율, true)).toBe(0);
    expect(달마다([관심종목], 환율, true).every((v) => v === 0)).toBe(true);
  });
});


describe("달마다 — 통화가 섞이면 세율도 섞인다", () => {
  /* 원화 종목은 3·12월, 달러 종목은 7·12월. 12월에 겹치게 둔다.
     한 달에 한 종목만 있으면 '목록 전체에 한 세율' 뮤테이션이
     겹치는 달에서만 티가 나기 때문이다. */
  const 목록 = () => [
    원화줄({ months: [3, 12] }),      // 회차 100,000
    달러줄({ months: [7, 12] }),      // 회차 140,000
  ];

  it("세전 합계는 통화만 환산하고 그대로 더한다", () => {
    const 칸 = 달마다(목록(), 환율);
    expect(칸).toHaveLength(12);
    expect(칸[2]).toBe(100_000);      // 3월  원화만
    expect(칸[6]).toBe(140_000);      // 7월  달러만
    expect(칸[11]).toBe(240_000);     // 12월 둘 다
    expect(칸[0]).toBe(0);            // 1월  비는 달
  });

  it("세후 합계에 두 세율이 각각 먹는다 — 목록 전체에 한 세율을 먹이면 어느 종목도 안 맞는다", () => {
    const 칸 = 달마다(목록(), 환율, true);
    expect(칸[2]).not.toBeNull();
    expect(칸[6]).not.toBeNull();

    // 손계산: 원화 100,000 × 0.846 = 84,600 / 달러 140,000 × 0.85 = 119,000
    expect(칸[2]).toBeCloseTo(84_600, 6);
    expect(칸[6]).toBeCloseTo(119_000, 6);
    expect(칸[11]).toBeCloseTo(203_600, 6);

    /* 한 세율만 먹였을 때 나오는 값들. 합계만 보면 '그럴듯한' 숫자라
       눈으로는 절대 못 잡는다 */
    expect(칸[6]).not.toBeCloseTo(140_000 * (1 - 0.154), 2);  // 118,440
    expect(칸[2]).not.toBeCloseTo(100_000 * (1 - 0.15), 2);   // 85,000
    expect(칸[11]).not.toBeCloseTo(203_040, 2);               // 둘 다 국내
    expect(칸[11]).not.toBeCloseTo(204_000, 2);               // 둘 다 해외
  });

  it("배당월 밖으로는 안 샌다 — 12칸을 벗어난 달은 버린다", () => {
    const 칸 = 달마다([원화줄({ months: [0, 3, 13] })], 환율);
    expect(칸).toHaveLength(12);
    expect(칸[2]).toBe(100_000);
    expect(칸.filter((v) => v > 0)).toHaveLength(1);
  });
});


describe("내몫으로 — 화면이 보고 있는 수량으로 맞춘다", () => {
  const 몫 = (수량: number): 보유몫 => ({ 수량, 원가: 1, 평가: 1 });

  it("보유를 안 넘기면 서버가 준 목록을 그대로 쓴다", () => {
    /* 전체 보기에는 분모가 없다. 이때 목록을 걸러 버리면 배당 달력이
       통째로 빈 화면이 된다 */
    const 원본 = [원화줄(), 달러줄()];
    const 결과 = 내몫으로(원본);
    expect(결과).toHaveLength(2);
    expect(결과).toEqual(원본);
    expect(결과.map((r) => r.shares)).toEqual([100, 200]);
  });

  it("보유에 없는 심볼은 뺀다 — 화면에서 빠진 종목의 배당까지 세면 안 된다", () => {
    const 결과 = 내몫으로([원화줄(), 달러줄()], { [배당키("KR", "005930")]: 몫(100) });
    expect(결과).toHaveLength(1);
    expect(결과[0].symbol).toBe("005930");
  });

  it("수량 0 인 심볼도 뺀다 — 관심종목만 남기면 안 준 배당이 합계에 들어간다", () => {
    const 결과 = 내몫으로([원화줄(), 달러줄()], {
      [배당키("KR", "005930")]: 몫(0),
      [배당키("US", "SCHD")]: 몫(200),
    });
    expect(결과.map((r) => r.symbol)).toEqual(["SCHD"]);
    /* 경계 — 0 만 걸러도 '<= 0' 을 '=== 0' 으로 바꾸는 뮤테이션이 지나간다 */
    expect(내몫으로([원화줄()], { [배당키("KR", "005930")]: 몫(-5) })).toHaveLength(0);
    expect(내몫으로([원화줄()], { [배당키("KR", "005930")]: 몫(1) })).toHaveLength(1);
  });

  it("수량이 다르면 그 수량으로 바꿔 준다 — 전량으로 세면 배당률이 말이 안 되게 커진다", () => {
    /* 서버는 가진 것 전부(200주)를 세는데 화면은 포트폴리오 하나(100주)만
       보고 있다. 수량을 안 맞추면 분자만 두 배가 된다 */
    const 결과 = 내몫으로([원화줄({ shares: 200 })], { [배당키("KR", "005930")]: 몫(100) });
    expect(결과).toHaveLength(1);
    expect(결과[0].shares).toBe(100);
    // 존재만 보지 않고 값까지 — 줄어든 수량이 금액에 실제로 반영되는가
    expect(회차금액(결과[0], 환율)).toBe(100_000);
    expect(달마다(결과, 환율)[2]).toBe(100_000);
  });

  it("원본 배당줄을 건드리지 않는다 — 캐시에 든 서버 응답을 덮어쓰면 되돌릴 길이 없다", () => {
    const 원본줄 = 원화줄({ shares: 200 });
    const 원본 = [원본줄];
    const 결과 = 내몫으로(원본, { [배당키("KR", "005930")]: 몫(100) });
    expect(원본줄.shares).toBe(200);        // 원본은 전량 그대로
    expect(원본).toHaveLength(1);
    expect(결과[0]).not.toBe(원본줄);       // 새 객체를 만들어 준다
    expect(결과[0].shares).toBe(100);
    // 수량 말고는 안 바꾼다
    expect(결과[0].symbol).toBe(원본줄.symbol);
    expect(결과[0].months).toEqual(원본줄.months);
    expect(결과[0].last_amount).toBe(원본줄.last_amount);
  });
});


describe("배당률 두 가지", () => {
  /* 원화 1000원 × 100주 × 3·6·9·12월 = 한 해 400,000원 */
  const 보유 = { [배당키("KR", "005930")]: { 수량: 100, 원가: 5_000_000, 평가: 6_000_000 } };

  it("연간 배당금·투자 배당률·시가 배당률 세 칸이 다 나온다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [원화줄()], pending: 0,
    });
    그리기({ 보유 });
    expect(await screen.findByText("연간 배당금")).toBeInTheDocument();
    expect(screen.getByText("투자 배당률")).toBeInTheDocument();
    expect(screen.getByText("시가 배당률")).toBeInTheDocument();
  });

  it("투자 배당률은 원가로, 시가 배당률은 평가로 나눈다 — 분모를 바꿔 끼우면 다른 이야기가 된다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [원화줄()], pending: 0,
    });
    그리기({ 보유 });
    await screen.findByText("연간 배당금");

    // 한 해 400,000원
    expect(요약칸("연간 배당금").getByText("₩400,000")).toBeInTheDocument();
    // 400,000 ÷ 5,000,000 = 8.00%
    expect(요약칸("투자 배당률").getByText("8.00%")).toBeInTheDocument();
    // 400,000 ÷ 6,000,000 = 6.67%
    expect(요약칸("시가 배당률").getByText("6.67%")).toBeInTheDocument();
    // 분모를 서로 바꾸면 두 값이 자리를 맞바꾼다
    expect(요약칸("투자 배당률").queryByText("6.67%")).not.toBeInTheDocument();
    expect(요약칸("시가 배당률").queryByText("8.00%")).not.toBeInTheDocument();
  });

  it("보유를 모르면 '—' 다 — 0% 는 '배당을 안 준다' 로 읽힌다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [원화줄()], pending: 0,
    });
    그리기();                       // 보유를 안 넘긴다(전체 보기)
    await screen.findByText("연간 배당금");

    for (const 라벨 of ["투자 배당률", "시가 배당률"]) {
      const 칸 = 요약칸(라벨);
      expect(칸.getByText("—"), `${라벨}이 '—' 가 아니다`).toBeInTheDocument();
      expect(칸.queryByText(/%/), `${라벨}에 퍼센트가 찍혔다`).not.toBeInTheDocument();
    }
    // 배당금 자체는 그대로 나온다 — 분모만 모르는 것이다
    expect(요약칸("연간 배당금").getByText("₩400,000")).toBeInTheDocument();
  });

  it("화면이 보고 있는 수량으로 배당률을 센다 — 전량으로 세면 두 배가 찍힌다", async () => {
    /* 서버는 전량 200주로 센다. 화면은 100주만 보고 있다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [원화줄({ shares: 200 })], pending: 0,
    });
    그리기({ 보유 });
    await screen.findByText("연간 배당금");

    expect(요약칸("연간 배당금").getByText("₩400,000")).toBeInTheDocument();
    expect(요약칸("투자 배당률").getByText("8.00%")).toBeInTheDocument();
    // 전량(200주) 기준이면 800,000원 / 16.00% 가 된다
    expect(screen.queryByText("₩800,000")).not.toBeInTheDocument();
    expect(screen.queryByText("16.00%")).not.toBeInTheDocument();
  });
});


describe("세전 · 세후 토글", () => {
  const 보유 = { [배당키("KR", "005930")]: { 수량: 100, 원가: 5_000_000, 평가: 6_000_000 } };

  it("세전에는 세금 근거를 안 쓴다 — 안 뗀 값 옆에 세율을 적으면 뗀 줄 안다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [원화줄()], pending: 0,
    });
    그리기({ 보유 });
    await screen.findByText("연간 배당금");
    expect(screen.getByText("한 해 예상")).toBeInTheDocument();
    expect(screen.queryByText(/2,000만원/)).not.toBeInTheDocument();
  });

  it("세후로 바꾸면 금액과 배당률이 같이 줄고, 어림값인 근거가 붙는다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [원화줄()], pending: 0,
    });
    그리기({ 보유 });
    await screen.findByText("연간 배당금");
    expect(요약칸("연간 배당금").getByText("₩400,000")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "세후" }));

    // 400,000 × (1 − 0.154) = 338,400
    expect(await screen.findByText("₩338,400")).toBeInTheDocument();
    expect(요약칸("연간 배당금").getByText("₩338,400")).toBeInTheDocument();
    expect(요약칸("연간 배당금").queryByText("₩400,000")).not.toBeInTheDocument();

    /* 배당률도 같이 줄어야 한다 — 분자만 세후로 바꾸고 배당률을 세전
       금액으로 두면 두 숫자가 서로 안 맞는다 */
    expect(요약칸("투자 배당률").getByText("6.77%")).toBeInTheDocument();  // 338,400 ÷ 5,000,000
    expect(요약칸("시가 배당률").getByText("5.64%")).toBeInTheDocument();  // 338,400 ÷ 6,000,000

    // 실수령이라고 밝히고, 어림값인 근거를 같이 쓴다
    expect(screen.getByText("한 해 실수령")).toBeInTheDocument();
    const 근거 = screen.getByText(/2,000만원/);
    expect(근거).toHaveTextContent("국내 15.4%");
    expect(근거).toHaveTextContent("해외 15%");
    expect(근거).toHaveTextContent(/종합과세/);
  });

  it("세후로 갔다가 세전으로 돌아오면 원래 금액이 그대로 온다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [원화줄()], pending: 0,
    });
    그리기({ 보유 });
    await screen.findByText("연간 배당금");

    await userEvent.click(screen.getByRole("button", { name: "세후" }));
    expect(await screen.findByText("₩338,400")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "세전" }));
    expect(await screen.findByText("₩400,000")).toBeInTheDocument();
    expect(요약칸("투자 배당률").getByText("8.00%")).toBeInTheDocument();
    expect(screen.queryByText(/2,000만원/)).not.toBeInTheDocument();
  });

  it("원화·달러를 같이 가진 사람은 세율도 섞여야 한다 — 화면 합계가 어느 종목과도 안 맞으면 안 된다", async () => {
    /* 원화 100,000 + 달러 140,000, 둘 다 3월. 세후 합계는
       84,600 + 119,000 = 203,600 이다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [원화줄({ months: [3] }), 달러줄({ months: [3] })], pending: 0,
    });
    그리기({ 보유: {
      [배당키("KR", "005930")]: { 수량: 100, 원가: 5_000_000, 평가: 6_000_000 },
      [배당키("US", "SCHD")]: { 수량: 200, 원가: 5_000_000, 평가: 6_000_000 },
    } });
    await screen.findByText("연간 배당금");
    expect(요약칸("연간 배당금").getByText("₩240,000")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "세후" }));

    expect(await screen.findByText("₩203,600")).toBeInTheDocument();
    expect(요약칸("연간 배당금").getByText("₩203,600")).toBeInTheDocument();
    // 목록 전체에 한 세율만 먹였을 때 나오는 값들
    expect(screen.queryByText("₩203,040")).not.toBeInTheDocument();  // 둘 다 국내 15.4%
    expect(screen.queryByText("₩204,000")).not.toBeInTheDocument();  // 둘 다 해외 15%
  });
});

/**
 * 시장까지 넣어 짝을 맞춘다.
 *
 * 심볼만으로 찾고 있었다. 서버는 (심볼, 시장) 으로 나눠 보내므로,
 * 같은 심볼을 두 시장에 담아 둔 사람은 응답에 두 줄을 받는다. 그 두
 * 줄이 **합쳐진 수량**을 각각 받아 배당이 두 배로 세어졌다.
 *
 * 같은 파일이 목록의 react key 로는 이미 `market:symbol` 을 쓰고
 * 있었으니, 한 파일 안에서 두 규칙이 섞여 있던 셈이다.
 */
describe("같은 심볼이 두 시장에 있어도 안 겹친다", () => {
  const 몫 = (수량: number): 보유몫 => ({ 수량, 원가: 1, 평가: 1 });

  it("시장이 다르면 다른 종목으로 센다", () => {
    const 미국 = 달러줄({ symbol: "SCHD", market: "US", shares: 999 });
    const 국내 = 달러줄({ symbol: "SCHD", market: "ETF", shares: 999 });
    const 결과 = 내몫으로([미국, 국내], {
      [배당키("US", "SCHD")]: 몫(100),
      [배당키("ETF", "SCHD")]: 몫(30),
    });
    expect(결과.map((r) => [r.market, r.shares])).toEqual([["US", 100], ["ETF", 30]]);
  });

  it("한쪽만 갖고 있으면 그 한 줄만 남는다", () => {
    /* 심볼로만 찾던 때는 안 가진 쪽까지 통과시켜 두 배로 셌다 */
    const 미국 = 달러줄({ symbol: "SCHD", market: "US" });
    const 국내 = 달러줄({ symbol: "SCHD", market: "ETF" });
    const 결과 = 내몫으로([미국, 국내], { [배당키("US", "SCHD")]: 몫(100) });
    expect(결과).toHaveLength(1);
    expect(결과[0].market).toBe("US");
  });

  it("배당키는 시장과 심볼을 둘 다 쓴다", () => {
    expect(배당키("US", "SCHD")).not.toBe(배당키("ETF", "SCHD"));
    expect(배당키("KR", "005930")).toContain("005930");
  });
});
