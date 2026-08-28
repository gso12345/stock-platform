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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DividendCalendar, { 날짜글, 어림날짜글, 남은날, 원본돈, 회차금액, 그달지난배당, 실제값인가, 짧은돈, 기준글, 그달날들, 앞으로그달, 날과요일, 날짜별로, 점날짜, 남은글 }
  from "@/components/portfolio/DividendCalendar";
import { portfolioApi, type 배당줄 } from "@/api/stocks";

vi.mock("@/api/stocks", () => ({ portfolioApi: { getDividends: vi.fn() } }));
/* 환율을 못 박는다. 진짜 환율을 쓰면 검사가 그날 시세에 흔들린다 */
vi.mock("@/hooks/useExchangeRate", () => ({ useExchangeRate: () => 1400 }));

const 앞으로 = (일: number) => {
  const d = new Date();
  d.setDate(d.getDate() + 일);
  return d.toISOString().slice(0, 10);
};

const 이번달 = new Date().getMonth() + 1;

/** 이번 달 안의 날짜 — 기본으로 고르는 달이 '이번 달' 이라, 앞으로(10) 로
 *  잡으면 달을 넘어가 목록에서 빠져 버린다 */
const 이번달날 = (일: number) => {
  const d = new Date();
  return `${d.getFullYear()}-${String(이번달).padStart(2, "0")}-${String(일).padStart(2, "0")}`;
};

const 줄 = (덮: Partial<배당줄> = {}): 배당줄 => ({
  symbol: "005930", market: "KR", name: "삼성전자",
  date: 앞으로(30), confirmed: false, ex_date: null, pay_date: null,
  cycle: "분기", months: [이번달], per_month: 1, currency: "KRW",
  last_date: "2026-06-30", last_amount: 361,
  per_year: 1444, shares: 100, expected: 36_100, expected_year: 144_400,
  recent: [], ...덮,
});

function 그리기(props: React.ComponentProps<typeof DividendCalendar> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><DividendCalendar {...props} /></QueryClientProvider>,
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
  it("공시된 날은 '확정' 으로 적고 날짜를 그대로 쓴다", async () => {
    const 날 = 이번달날(20);
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ confirmed: true, date: 날, ex_date: 날, months: [이번달] })],
      pending: 0,
    });
    그리기();
    expect(await screen.findByText("확정")).toBeInTheDocument();
    expect(screen.getByText(날짜글(날))).toBeInTheDocument();
  });

  it("추정한 날은 '예상' 으로 적고 날짜를 뭉갠다", async () => {
    const 날 = 이번달날(20);
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ confirmed: false, date: 날, months: [이번달] })],
      pending: 0,
    });
    그리기();
    expect(await screen.findByText("예상")).toBeInTheDocument();
    expect(screen.getByText(어림날짜글(날))).toBeInTheDocument();
    expect(screen.queryByText(날짜글(날))).not.toBeInTheDocument();
  });

  it("이번 회차 달이 아니면 D-day 를 안 적는다", async () => {
    /* 분기배당이면 2·5·8·11월에 주는데, 다음 회차 날짜만 안다.
       나머지 달까지 D-day 를 적으면 없는 날짜를 지어내는 것이다. */
    const 다음달 = (이번달 % 12) + 1;
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ months: [이번달, 다음달], date: `2026-${String(다음달).padStart(2, "0")}-15` })],
      pending: 0,
    });
    그리기();
    await screen.findByText("삼성전자");
    expect(screen.queryByText(/^D-/)).not.toBeInTheDocument();
    expect(screen.queryByText("확정")).not.toBeInTheDocument();
    expect(screen.queryByText("예상")).not.toBeInTheDocument();
  });
});


describe("금액", () => {
  it("안 갖고 있는 종목에는 금액을 안 쓴다", async () => {
    /* 관심종목처럼 수량이 0이면 '0원' 이라고 적으면 '배당을 안 준다'
       로 읽힌다. */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ shares: 0, expected: null, expected_year: null })], pending: 0,
    });
    그리기();
    const 이름 = await screen.findByText("삼성전자");
    /* 그 종목 줄 안만 본다. 화면 전체에서 "₩0" 을 찾으면 한 해 합계가
       걸린다 — 가진 게 없으면 한 해 0원인 것은 맞는 말이다.
       여기서 막고 싶은 것은 **줄에 금액이 붙는 것**이다. */
    const 줄칸 = 이름.closest("li");
    expect(줄칸).not.toBeNull();
    expect(within(줄칸!).queryByText(/₩/)).not.toBeInTheDocument();
  });

  it("갖고 있으면 이번 달에 받을 돈을 쓴다", async () => {
    /* 두 달짜리로 만든다 — 한 달만 있으면 '한 해 합계' 와 값이 같아
       어느 쪽을 본 것인지 알 수 없다 */
    const 다른달 = (이번달 % 12) + 1;
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ months: [이번달, 다른달] })], pending: 0,   // 361 × 100 = 36,100
    });
    그리기();
    await screen.findByText("삼성전자");
    expect(screen.getByText("₩72,200")).toBeInTheDocument();   // 한 해
    expect(screen.getAllByText("₩36,100").length).toBeGreaterThan(0);  // 이 달
  });

  it("보유 수량과 주당 금액을 같이 적는다", async () => {
    /* 금액만 있으면 왜 그 숫자인지 확인할 길이 없다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄()], pending: 0,
    });
    그리기();
    expect(await screen.findByText(/100주 · 주당 361원/)).toBeInTheDocument();
  });

  it("달러 종목은 원화로 환산하되 원래 금액도 같이 적는다", async () => {
    /* 환산값만 있으면 맞는지 확인할 길이 없다. 환율 1400 고정. */
    const 다른달 = (이번달 % 12) + 1;
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ symbol: "SCHD", market: "US", name: "SCHD", currency: "USD",
                   last_amount: 0.25, shares: 10, months: [이번달, 다른달] })],
      pending: 0,
    });
    그리기();
    await screen.findByText("SCHD");
    // 0.25 × 10 × 1400 = 3,500원
    expect(screen.getAllByText("₩3,500").length).toBeGreaterThan(0);
    expect(screen.getByText("$2.50")).toBeInTheDocument();
  });

  it("주배당은 한 달에 네 번 들어오는 것으로 센다", async () => {
    /* 한 번으로 세면 예상액이 4분의 1이 된다 */
    const 다른달 = (이번달 % 12) + 1;
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ cycle: "주", per_month: 4, months: [이번달, 다른달],
                   currency: "KRW", last_amount: 1000, shares: 10 })],
      pending: 0,
    });
    그리기();
    await screen.findByText("삼성전자");
    // 1000 × 10 × 4 = 40,000 (한 번으로 세면 10,000 이 된다)
    expect(screen.getAllByText("₩40,000").length).toBeGreaterThan(0);
    expect(screen.queryByText("₩10,000")).not.toBeInTheDocument();
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

  it("한 포트폴리오만 볼 때는 그 포트폴리오 이야기라고 한다", async () => {
    /* '전체' 를 보고 있는데 '이 포트폴리오에는' 이라고 하면 틀린 말이다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [], pending: 0 });
    그리기({ portfolioId: 7, 이름: "연금저축" });
    expect(await screen.findByText(/이 포트폴리오에는/)).toBeInTheDocument();
  });

  it("불러오기에 실패하면 다시 시도할 수 있다", async () => {
    vi.mocked(portfolioApi.getDividends).mockRejectedValue(new Error("서버 오류"));
    그리기();
    expect(await screen.findByRole("button", { name: /다시/ })).toBeInTheDocument();
  });
});


describe("주당 금액", () => {
  it("아주 작은 금액은 자릿수를 늘린다", () => {
    /* 주배당 ETF 는 한 주에 $0.063 을 준다. 두 자리로 자르면 $0.06 이
       되어 5% 를 깎아 보여 준다 — '주당 얼마' 는 사람이 눈으로
       검산하는 값이라 틀리면 안 된다. */
    expect(원본돈(0.063, "USD")).toBe("$0.0630");
    expect(원본돈(0.0025, "USD")).toBe("$0.0025");
  });

  it("보통 금액은 두 자리로", () => {
    expect(원본돈(1.57, "USD")).toBe("$1.57");
    expect(원본돈(0.18, "USD")).toBe("$0.18");
    expect(원본돈(361, "KRW")).toBe("361원");
  });

  it("화면에도 자릿수가 살아 있다", async () => {
    const 다른달 = (이번달 % 12) + 1;
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ symbol: "APLY", name: "APLY", currency: "USD",
                   cycle: "주", per_month: 4, last_amount: 0.063, shares: 25,
                   months: [이번달, 다른달] })],
      pending: 0,
    });
    그리기();
    expect(await screen.findByText(/주당 \$0\.0630/)).toBeInTheDocument();
  });
});


describe("월별 막대", () => {
  it("한 해 합계를 맨 위에 적는다", async () => {
    /* 이 화면에서 제일 먼저 보고 싶은 숫자다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ months: [3, 6, 9, 12] })], pending: 0,   // 36,100 × 4
    });
    그리기();
    expect(await screen.findByText("₩144,400")).toBeInTheDocument();
    expect(screen.getByText("한 해 예상")).toBeInTheDocument();
  });

  it("열두 달을 다 그린다 — 빈 달도", async () => {
    /* '어느 달이 비는가' 를 보는 것이 이 막대의 요점이다.
       목록만으로는 2·5·8·11월에만 주는 것을 알 수 없다. */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ months: [2, 5, 8, 11] })], pending: 0,
    });
    그리기();
    await screen.findByText("한 해 예상");
    for (let m = 1; m <= 12; m++) {
      expect(screen.getByRole("button", { name: new RegExp(`^${m}월 `) }),
             `${m}월 막대가 없다`).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /^1월 배당 없음/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^2월 ₩/ })).toBeInTheDocument();
  });

  it("막대를 누르면 그 달 내역이 펼쳐진다", async () => {
    const 다른달 = 이번달 === 3 ? 6 : 3;
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [
        줄({ symbol: "A", name: "이번달종목", months: [이번달] }),
        줄({ symbol: "B", name: "다른달종목", months: [다른달] }),
      ],
      pending: 0,
    });
    그리기();
    await screen.findByText("이번달종목");
    expect(screen.queryByText("다른달종목")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${다른달}월 `) }));
    expect(await screen.findByText("다른달종목")).toBeInTheDocument();
    expect(screen.queryByText("이번달종목")).not.toBeInTheDocument();
  });

  it("처음에는 이번 달을 보여 준다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ months: [이번달] })], pending: 0,
    });
    그리기();
    expect(await screen.findByText("이번 달")).toBeInTheDocument();
  });

  it("배당월을 적는다 — 분기배당이라도 회사마다 달이 다르다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ months: [2, 5, 8, 11] })], pending: 0,
    });
    그리기();
    await userEvent.click(await screen.findByRole("button", { name: /^2월 ₩/ }));
    expect(await screen.findByText("배당월 2·5·8·11")).toBeInTheDocument();
  });

  it("월·주배당은 배당월을 안 적는다 — 열두 달 다인데 적으면 시끄럽다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ cycle: "월", per_month: 1, months: Array.from({ length: 12 }, (_, i) => i + 1) })],
      pending: 0,
    });
    그리기();
    await screen.findByText("삼성전자");
    expect(screen.queryByText(/^배당월 /)).not.toBeInTheDocument();
  });
});


describe("포트폴리오별로 나눠 본다", () => {
  it("고른 포트폴리오만 물어본다", async () => {
    /* 예전에는 가진 것 전부 + 관심종목까지 한꺼번에 보여 줬다.
       탭이 여럿인 사람에게는 어느 계좌의 배당인지 알 수 없었다. */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [줄()], pending: 0 });
    그리기({ portfolioId: 7, 이름: "연금저축" });
    await waitFor(() => expect(portfolioApi.getDividends).toHaveBeenCalledWith(7));
  });

  it("전체 보기에서는 아무것도 안 넘긴다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [줄()], pending: 0 });
    그리기();
    await waitFor(() => expect(portfolioApi.getDividends).toHaveBeenCalledWith(undefined));
  });

  it("무엇의 배당인지 제목에 적는다", async () => {
    /* 탭을 바꾸면 목록도 바뀐다. 안 적으면 '왜 아까랑 다르지' 가 된다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [줄()], pending: 0 });
    그리기({ portfolioId: 7, 이름: "연금저축" });
    expect(await screen.findByText("연금저축")).toBeInTheDocument();
  });

  it("포트폴리오를 바꾸면 다시 물어본다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [줄()], pending: 0 });
    const { rerender } = 그리기({ portfolioId: 7 });
    await waitFor(() => expect(portfolioApi.getDividends).toHaveBeenCalledWith(7));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={qc}><DividendCalendar portfolioId={9} /></QueryClientProvider>,
    );
    await waitFor(() => expect(portfolioApi.getDividends).toHaveBeenCalledWith(9));
  });
});

/**
 * 금액은 실제로 받은 값에서 나와야 한다.
 *
 * '다음에 얼마 받나' 를 마지막 회차 금액으로 답하고 있었다. 분기배당은
 * 회차마다 금액이 다르다 — 결산배당이 붙는 분기가 특히 크다.
 * 0.20 / 0.25 / 0.30 / 0.35 를 주는 종목이 다음에 0.20 을 줄 차례인데
 * 마지막이 0.35 였으면, 화면은 75% 를 더 받는다고 말한다.
 *
 * 이 화면의 숫자로 생활비 계획을 세우는 사람이 있다.
 */
describe("이번 회차 금액", () => {
  it("마지막 회차가 아니라 이번 회차 금액을 쓴다", () => {
    const r = 줄({ currency: "USD", shares: 100, last_amount: 0.35, next_amount: 0.20 });
    // 0.20 × 100주 × 1400원 = 28,000원. 마지막(0.35)이면 49,000원이다
    expect(회차금액(r, 1400)).toBeCloseTo(28_000, 0);
  });

  it("이번 회차를 모르는 옛 응답은 마지막 회차로 떨어진다", () => {
    const r = 줄({ currency: "USD", shares: 100, last_amount: 0.35 });
    expect(회차금액(r, 1400)).toBeCloseTo(49_000, 0);
  });

  it("세후는 원천징수를 뗀다", () => {
    const r = 줄({ currency: "USD", shares: 100, next_amount: 0.20 });
    expect(회차금액(r, 1400, true)).toBeCloseTo(28_000 * 0.85, 0);
  });

  it("주당 금액을 화면에도 이번 회차로 적는다", async () => {
    /* 목록에 '주당 $0.35' 라고 적혀 있는데 옆의 금액은 0.20 으로
       계산돼 있으면, 눈으로 검산하는 사람이 반드시 어긋난다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({
        currency: "USD", shares: 100, last_amount: 0.35, next_amount: 0.20,
        date: 이번달날(20), months: [이번달],
        schedule: [{ month: 이번달, day: 20, amount: 0.20, year: 2025, actual: true }],
      })],
      pending: 0,
    });
    그리기();
    expect(await screen.findByText(/주당 \$0\.20/)).toBeInTheDocument();
    expect(screen.queryByText(/주당 \$0\.35/)).toBeNull();
  });
});

describe("그 달에 정말 얼마였나", () => {
  it("같은 달만 골라 해마다 보여 준다", () => {
    /* 예전에는 마지막 세 회차를 그냥 보여 줬다. 3월을 보고 있는데
       12·9·6월 금액이 나오니, 옆의 '3월 예상' 을 검산하는 데 아무
       도움이 안 됐다 */
    const r = 줄({ recent: [
      { date: "2024-03-25", amount: 0.20 },
      { date: "2024-06-25", amount: 0.25 },
      { date: "2025-03-25", amount: 0.22 },
      { date: "2025-12-25", amount: 0.35 },
    ] });
    expect(그달지난배당(r, 3)).toEqual([
      { year: 2025, amount: 0.22 },
      { year: 2024, amount: 0.20 },
    ]);
  });

  it("최근 해부터 적는다", () => {
    const r = 줄({ recent: [
      { date: "2023-03-25", amount: 0.10 },
      { date: "2025-03-25", amount: 0.30 },
      { date: "2024-03-25", amount: 0.20 },
    ] });
    expect(그달지난배당(r, 3, 3).map((x) => x.year)).toEqual([2025, 2024, 2023]);
  });

  it("그 달 기록이 없으면 아무것도 안 준다", () => {
    /* 없는데 다른 달 값을 갖다 붙이면 그게 곧 거짓말이다 */
    const r = 줄({ recent: [{ date: "2025-06-25", amount: 0.25 }] });
    expect(그달지난배당(r, 3)).toEqual([]);
  });

  it("화면에도 그 달 것만 적는다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({
        currency: "USD", shares: 100, date: 이번달날(20), months: [이번달],
        recent: [
          { date: `2024-${String(이번달).padStart(2, "0")}-20`, amount: 0.20 },
          { date: `2025-${String(이번달).padStart(2, "0")}-20`, amount: 0.22 },
          { date: "2025-01-15", amount: 0.99 },   // 다른 달 — 나오면 안 된다
        ],
      })],
      pending: 0,
    });
    그리기();
    const 글 = await screen.findAllByText(new RegExp(`지난 ${이번달}월`));
    expect(글.length).toBeGreaterThan(0);
    expect(글[0].textContent).toContain("2025 $0.22");
    expect(글[0].textContent).toContain("2024 $0.20");
    expect(글[0].textContent).not.toContain("0.99");
  });
});

describe("메운 값을 실제인 척하지 않는다", () => {
  it("actual 이 거짓이면 평균으로 친다", () => {
    const r = 줄({ schedule: [{ month: 3, day: 20, amount: 0.1, year: null, actual: false }] });
    expect(실제값인가(r, 3)).toBe(false);
  });

  it("actual 이 참이면 실제다", () => {
    const r = 줄({ schedule: [{ month: 3, day: 20, amount: 0.1, year: 2025, actual: true }] });
    expect(실제값인가(r, 3)).toBe(true);
  });

  it("표시가 없는 옛 응답은 실제로 친다", () => {
    /* 그때는 메우는 칸이 schedule 에 안 들어 있었다. 없다고 해서
       전부 '평균' 이라고 적으면, 멀쩡한 값에 다 딱지가 붙는다 */
    const r = 줄({ schedule: [{ month: 3, day: 20, amount: 0.1, year: 2025 }] });
    expect(실제값인가(r, 3)).toBe(true);
  });

  it("화면에 '평균' 이라고 적는다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({
        currency: "USD", shares: 100, cycle: "월", date: 이번달날(20),
        months: [이번달],
        schedule: [{ month: 이번달, day: 20, amount: 0.11, year: null, actual: false }],
      })],
      pending: 0,
    });
    그리기();
    expect(await screen.findByText(/\(평균\)/)).toBeInTheDocument();
  });

  it("실제 값에는 '평균' 을 안 붙인다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({
        currency: "USD", shares: 100, date: 이번달날(20), months: [이번달],
        schedule: [{ month: 이번달, day: 20, amount: 0.20, year: 2025, actual: true }],
      })],
      pending: 0,
    });
    그리기();
    await screen.findByText(/주당 \$0\.20/);
    expect(screen.queryByText(/\(평균\)/)).toBeNull();
  });
});

describe("좁은 화면과 넓은 화면", () => {
  /* jsdom 에는 화면 폭이 없어서 미디어 쿼리가 안 돈다. 대신 '두 폭에
     쓸 자리가 실제로 따로 있는가' 를 클래스로 본다 — 하나뿐이면
     한쪽 화면에서는 반드시 뭉개진다. */
  async function 그려보기() {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({
        currency: "USD", shares: 100, date: 이번달날(20), months: [이번달],
        recent: [{ date: `2025-${String(이번달).padStart(2, "0")}-20`, amount: 0.22 }],
      })],
      pending: 0,
    });
    const { container } = 그리기();
    await screen.findByText("삼성전자");
    return container;
  }

  it("지난 배당 자리가 폭마다 따로 있다", async () => {
    const c = await 그려보기();
    expect(c.querySelector(".sm\\:hidden")).toBeTruthy();       // 좁은 화면용
    expect(c.querySelector(".hidden.sm\\:block")).toBeTruthy(); // 넓은 화면용
  });

  it("한 폭에서는 하나만 보인다 — 둘 다 뜨면 같은 말이 두 번 나온다", async () => {
    const c = await 그려보기();
    const 좁은것 = c.querySelector(".sm\\:hidden");
    const 넓은것 = c.querySelector(".hidden.sm\\:block");
    expect(좁은것).not.toBe(넓은것);
    // 좁은 쪽은 sm 이상에서 숨고, 넓은 쪽은 sm 미만에서 숨는다
    expect(좁은것?.className).toContain("sm:hidden");
    expect(넓은것?.className).toContain("hidden");
  });

  it("연간 배당금이 좁은 화면에서 한 줄을 다 쓴다", async () => {
    /* 세 칸을 나란히 두면 휴대폰 폭에서 '1,234,567원' 이 잘려
       '1,234,5…' 가 된다 — 제일 먼저 보고 싶은 숫자가 못 읽힌다 */
    const c = await 그려보기();
    const 칸 = c.querySelector(".col-span-2");
    expect(칸?.className).toContain("sm:col-span-1");
  });

  it("막대 높이가 넓은 화면에서 늘어난다", async () => {
    /* PC 에서 44px 짜리 막대는 너무 납작해서 달끼리 비교가 안 된다 */
    const c = await 그려보기();
    const 막대 = c.querySelector("[class*='sm:h-[calc(var(--막대)']");
    expect(막대).toBeTruthy();
  });
});

describe("막대 위 라벨은 잘리면 안 된다", () => {
  /* 휴대폰 폭(390px)에서 열두 칸이면 한 칸이 28px 남짓이다. '8,140' 은
     다섯 글자라 '8,1…' 로 잘리는데, 잘린 숫자는 안 쓰느니만 못하다 —
     8,140 인지 81,400 인지 알 수가 없다. */
  it("천 단위 아래로 줄인다", () => {
    expect(짧은돈(8_140)).toBe("8천");
    expect(짧은돈(9_400)).toBe("9천");
    expect(짧은돈(1_000)).toBe("1천");
  });

  it("만·억은 그대로", () => {
    expect(짧은돈(37_470)).toBe("4만");
    expect(짧은돈(120_000_000)).toBe("1.2억");
  });

  it("천 밑은 그냥 숫자", () => {
    expect(짧은돈(870)).toBe("870");
  });

  it("0 은 아무것도 안 쓴다 — 빈 달에 '0' 이 붙으면 어지럽다", () => {
    expect(짧은돈(0)).toBe("");
  });

  it("만 단위에는 쉼표를 안 넣는다 — 쉼표 하나에 칸 하나를 쓴다", () => {
    expect(짧은돈(12_345_678)).toBe("1235만");
  });

  it("어떤 값이든 다섯 글자를 안 넘는다", () => {
    /* 한 칸이 28px 남짓이다. 다섯 글자가 이 글자 크기의 한계다 */
    for (const v of [1, 999, 1_000, 9_999, 10_000, 999_999, 12_345_678,
                     99_999_999, 999_999_999, 12_345_678_901]) {
      expect(짧은돈(v).length).toBeLessThanOrEqual(5);
    }
  });
});

/**
 * "작년 기준이 아니라 올해 확정된 데이터로 계산해 줘" 라는 말을 들었다.
 *
 * 파 보니 **계산은 이미 올해 것을 쓰고 있었다.** 서버는 달마다 따로
 * 최신 연도를 고른다 — 오늘이 8월이면 1~8월 칸은 올해 실제 지급이고
 * 9~12월 칸만 작년 것이다.
 *
 * 거짓말을 한 것은 라벨이었다. 이번 회차가 아닌 달에는 **조건 없이**
 * '작년 기준' 이 붙었다. 연도를 한 번도 안 봤다. 열두 달 중 여덟 달의
 * 라벨이 틀린 셈이다.
 */
describe("몇 년 것인지 제대로 적는다", () => {
  const 올해 = new Date().getFullYear();

  it("올해 받은 달에는 '올해 확정'", () => {
    const r = 줄({ schedule: [{ month: 3, day: 20, amount: 0.2, year: 올해, 올해확정: true, actual: true }] });
    expect(기준글(r, 3)).toBe("올해 확정");
  });

  it("작년 것에는 그 연도를 적는다 — '작년' 이라는 말로 뭉개지 않는다", () => {
    /* 재작년 것이면 '작년 기준' 은 그냥 틀린 말이다 */
    const r = 줄({ schedule: [{ month: 11, day: 20, amount: 0.2, year: 올해 - 1, 올해확정: false, actual: true }] });
    expect(기준글(r, 11)).toBe(`${올해 - 1}년 기준`);
  });

  it("평균으로 메운 칸에는 연도를 안 적는다", () => {
    /* 연도가 없는 값이다. '평균' 은 주당 금액 옆에 이미 적는다 */
    const r = 줄({ schedule: [{ month: 5, day: 15, amount: 0.1, year: null, actual: false }] });
    expect(기준글(r, 5)).toBeNull();
  });

  it("그 달 칸이 없으면 아무것도 안 적는다", () => {
    expect(기준글(줄({ schedule: [] }), 7)).toBeNull();
  });

  it("옛 응답(올해확정 없음)은 연도로 판단한다", () => {
    const r = 줄({ schedule: [{ month: 3, day: 20, amount: 0.2, year: 올해, actual: true }] });
    expect(기준글(r, 3)).toBe("올해 확정");
  });

  it("화면에 '작년 기준' 을 조건 없이 찍지 않는다", async () => {
    /* 이번 회차가 아닌 달을 골랐는데 그 달이 올해 것이면
       '올해 확정' 이 떠야 한다 */
    const 딴달 = (이번달 % 12) + 1;
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({
        currency: "USD", shares: 100, date: 이번달날(20),
        months: [이번달, 딴달],
        schedule: [
          { month: 이번달, day: 20, amount: 0.2, year: 올해, 올해확정: true, actual: true },
          { month: 딴달, day: 15, amount: 0.25, year: 올해, 올해확정: true, actual: true },
        ],
      })],
      pending: 0,
    });
    그리기();
    // 뼈대가 아니라 실제 내용이 뜰 때까지 기다린다
    await screen.findByText("연간 배당금");
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${딴달}월`) }));
    expect(await screen.findByText("올해 확정")).toBeInTheDocument();
    expect(screen.queryByText("작년 기준")).toBeNull();
  });
});

/**
 * 주배당은 한 달에 네다섯 번 준다.
 *
 * 그걸 한 칸으로 접으면 '8월 20일 · 주당 $0.189' 한 줄이 되는데,
 * 날짜는 그 달 **마지막** 회차이고 금액은 그 달 **합계**다. 두 값의
 * 기준이 서로 달라서, 나란히 찍으면 그냥 틀린 줄이다.
 */
describe("주배당은 날짜별로 다 적는다", () => {
  const 올해 = new Date().getFullYear();
  const 주배당줄 = (덮 = {}) => 줄({
    currency: "USD", shares: 100, cycle: "주", per_month: 4.35,
    date: 이번달날(27), months: Array.from({ length: 12 }, (_, i) => i + 1),
    schedule: [{
      month: 이번달, day: 27, amount: 0.252, year: 올해, 올해확정: true, actual: true,
      days: [6, 13, 20, 27].map((d) => ({ date: 이번달날(d), amount: 0.063 })),
    }],
    ...덮,
  });

  it("그 달에 받은 날들을 그대로 준다", () => {
    expect(그달날들(주배당줄(), 이번달).map((x) => x.amount)).toEqual([0.063, 0.063, 0.063, 0.063]);
  });

  it("앞으로 받을 날은 따로 온다 — 지난 것과 안 섞는다", () => {
    /* 지난 지급은 실제로 들어온 돈이고, 앞으로는 추정이다.
       한 배열에 담으면 화면이 둘을 구분할 방법이 없다 */
    const r = 주배당줄({ upcoming: [{ date: 이번달날(28), amount: 0.063 }] });
    expect(앞으로그달(r, 이번달)).toHaveLength(1);
    expect(그달날들(r, 이번달)).toHaveLength(4);   // 지난 것은 그대로
  });

  it("다른 달의 앞으로는 안 섞인다", () => {
    const 딴달 = (이번달 % 12) + 1;
    const r = 주배당줄({ upcoming: [{ date: `${올해}-${String(딴달).padStart(2, "0")}-05`, amount: 0.063 }] });
    expect(앞으로그달(r, 이번달)).toHaveLength(0);
    expect(앞으로그달(r, 딴달)).toHaveLength(1);
  });

  it("화면에 날짜가 네 줄 다 나온다", async () => {
    /* 이 보장은 그대로다. 다만 **어디에 있느냐**가 바뀌었다.
       예전에는 종목별 줄 안에 날짜를 늘어놨는데, 화면을 찍어 보니
       주배당 종목 하나가 네다섯 줄을 먹어서 목록이 통째로 빽빽했다.
       이제 '날짜별' 칩이 그 일을 한다 — 날짜를 머리글로 세우고
       그날 합계까지 낸다. 사진 속 배당 앱과 같은 모양이다. */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [주배당줄()], pending: 0 });
    그리기();
    await screen.findByText("연간 배당금");
    await userEvent.click(await screen.findByRole("button", { name: "날짜별" }));
    const 달 = String(이번달).padStart(2, "0");
    for (const d of [6, 13, 20, 27]) {
      expect(screen.getByText(`${달}.${String(d).padStart(2, "0")}`)).toBeInTheDocument();
    }
  });

  it("합계라고 밝히고 회차 수를 적는다", async () => {
    /* '주당 $0.252' 라고 쓰면 한 번에 그만큼 주는 줄로 읽는다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [주배당줄()], pending: 0 });
    그리기();
    expect(await screen.findByText(/그 달 합계/)).toBeInTheDocument();
    expect(screen.getByText(/\(4회\)/)).toBeInTheDocument();
  });

  it("앞으로의 날에는 '예상' 을 붙인다", async () => {
    /* 지난 것은 실제로 들어온 돈이고 앞으로의 것은 추정이다.
       섞이면 어느 쪽이 사실인지 알 길이 없어진다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [주배당줄({ upcoming: [{ date: 이번달날(28), amount: 0.063 }] })], pending: 0,
    });
    그리기();
    await screen.findByText("연간 배당금");
    await userEvent.click(await screen.findByRole("button", { name: "날짜별" }));
    expect(screen.getByText("예상")).toBeInTheDocument();
  });

  it("한 번만 주는 달은 날짜 목록을 안 만든다", async () => {
    /* 분기배당에까지 목록을 붙이면 한 줄짜리 목록이 되어 어지럽다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({
        currency: "USD", shares: 100, date: 이번달날(20), months: [이번달],
        schedule: [{ month: 이번달, day: 20, amount: 0.25, year: 올해, 올해확정: true, actual: true,
                     days: [{ date: 이번달날(20), amount: 0.25 }] }],
      })],
      pending: 0,
    });
    그리기();
    expect(await screen.findByText(/주당 \$0\.25/)).toBeInTheDocument();
    expect(screen.queryByText(/그 달 합계/)).toBeNull();
  });
});

describe("날과요일", () => {
  it("날짜와 요일을 같이 적는다 — 주배당은 '매주 무슨 요일' 이 곧 성격이다", () => {
    expect(날과요일("2026-09-03")).toBe("3일 (목)");
    expect(날과요일("2026-09-06")).toBe("6일 (일)");
  });

  it("이상한 값에도 안 터진다", () => {
    expect(날과요일("깨진값")).toBe("깨진값");
  });
});

describe("입금일을 같이 적는다", () => {
  it("공시된 지급일이 있으면 화면에 적는다", async () => {
    /* 이 화면이 답해야 할 질문은 '언제 들어오나' 다. 지금까지 적던
       날짜는 **기준일**(그날까지 갖고 있어야 받는 날)이지 입금일이
       아니다. 둘은 보통 몇 주 차이가 난다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({
        currency: "USD", shares: 100, confirmed: true,
        date: 이번달날(12), pay_date: 이번달날(26), months: [이번달],
      })],
      pending: 0,
    });
    그리기();
    expect(await screen.findByText(/입금/)).toBeInTheDocument();
  });

  it("기준일과 같으면 두 번 안 적는다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ currency: "USD", shares: 100, confirmed: true,
                   date: 이번달날(12), pay_date: 이번달날(12), months: [이번달] })],
      pending: 0,
    });
    그리기();
    await screen.findByText("연간 배당금");
    expect(screen.queryByText(/입금/)).toBeNull();
  });
});

describe("지난 배당은 해마다 한 줄", () => {
  it("주배당은 그 달 합계로 묶는다 — 같은 해가 두 번 찍히면 안 된다", () => {
    /* 주배당은 한 달에 네다섯 건이라, 그냥 자르면 '2026 · 2026' 이
       된다. 해마다 얼마였나를 보려고 만든 자리인데 아무것도 비교가
       안 된다. 옆에 적히는 예상값도 그 달 합계라 기준이 맞는다 */
    const r = 줄({ recent: [
      { date: "2025-08-07", amount: 0.06 }, { date: "2025-08-14", amount: 0.06 },
      { date: "2026-08-06", amount: 0.063 }, { date: "2026-08-13", amount: 0.063 },
      { date: "2026-08-20", amount: 0.063 }, { date: "2026-08-27", amount: 0.063 },
    ] });
    expect(그달지난배당(r, 8)).toEqual([
      { year: 2026, amount: 0.252 },
      { year: 2025, amount: 0.12 },
    ]);
  });

  it("한 번만 주는 달은 그대로", () => {
    const r = 줄({ recent: [
      { date: "2024-03-25", amount: 0.2 }, { date: "2025-03-25", amount: 0.22 },
    ] });
    expect(그달지난배당(r, 3)).toEqual([
      { year: 2025, amount: 0.22 }, { year: 2024, amount: 0.2 },
    ]);
  });
});

/**
 * 응답을 가볍게 — 서버가 미리 묶어 준다.
 *
 * 지난 지급 원본(recent)을 통째로 받아 화면에서 합치고 있었다.
 * 주배당이면 한 종목에 104건이라, 열두 종목 응답의 **절반**이 그
 * 배열이었다. 정작 화면이 쓰는 것은 '그 달에 해마다 얼마였나' 두 줄뿐이다.
 */
describe("월별지난 — 서버가 묶어 준 것을 쓴다", () => {
  it("월별지난이 있으면 그걸 쓴다", () => {
    const r = 줄({ 월별지난: [
      { year: 2026, month: 8, amount: 0.252 },
      { year: 2025, month: 8, amount: 0.12 },
      { year: 2026, month: 7, amount: 0.189 },
    ] });
    expect(그달지난배당(r, 8)).toEqual([
      { year: 2026, amount: 0.252 },
      { year: 2025, amount: 0.12 },
    ]);
  });

  it("다른 달은 안 섞인다", () => {
    const r = 줄({ 월별지난: [
      { year: 2026, month: 8, amount: 0.252 },
      { year: 2026, month: 7, amount: 0.189 },
    ] });
    expect(그달지난배당(r, 7)).toEqual([{ year: 2026, amount: 0.189 }]);
  });

  it("최신 해부터 적는다", () => {
    const r = 줄({ 월별지난: [
      { year: 2024, month: 3, amount: 0.1 },
      { year: 2026, month: 3, amount: 0.3 },
      { year: 2025, month: 3, amount: 0.2 },
    ] });
    expect(그달지난배당(r, 3, 3).map((x) => x.year)).toEqual([2026, 2025, 2024]);
  });

  it("옛 응답(월별지난 없음)은 원본에서 묶는다", () => {
    /* 배포가 엇갈리는 동안 옛 응답이 캐시에 남아 있을 수 있다.
       그때 이 자리가 비면 근거 줄이 통째로 사라진다 */
    const r = 줄({ recent: [
      { date: "2026-08-06", amount: 0.063 }, { date: "2026-08-13", amount: 0.063 },
      { date: "2025-08-07", amount: 0.06 },
    ] });
    expect(그달지난배당(r, 8)).toEqual([
      { year: 2026, amount: 0.126 },
      { year: 2025, amount: 0.06 },
    ]);
  });

  it("둘 다 없으면 빈 목록", () => {
    expect(그달지난배당(줄({ recent: undefined, 월별지난: undefined }), 3)).toEqual([]);
  });
});

describe("지난 배당은 두 줄까지만", () => {
  it("세 해가 있어도 최근 두 해만 — 자리가 한 줄이다", () => {
    /* 좁은 화면에서는 이름 아래 한 줄에 들어간다. 다 적으면
       그 줄이 넘쳐서 옆 칸을 밀어낸다 */
    const r = 줄({ 월별지난: [
      { year: 2026, month: 3, amount: 0.3 },
      { year: 2025, month: 3, amount: 0.2 },
      { year: 2024, month: 3, amount: 0.1 },
    ] });
    expect(그달지난배당(r, 3)).toHaveLength(2);
    expect(그달지난배당(r, 3).map((x) => x.year)).toEqual([2026, 2025]);
  });

  it("몇 개인지 부르는 쪽이 정할 수 있다", () => {
    const r = 줄({ 월별지난: [
      { year: 2026, month: 3, amount: 0.3 },
      { year: 2025, month: 3, amount: 0.2 },
      { year: 2024, month: 3, amount: 0.1 },
    ] });
    expect(그달지난배당(r, 3, 3)).toHaveLength(3);
  });
});


/**
 * ── 날짜별 보기 ──
 *
 * 종목별 목록만으로는 주배당을 못 읽는다. 주배당(연 52회)은 한 달에
 * 네다섯 번 들어오는데, 종목별로 접으면 한 줄에 '그 달 합계' 만 남아서
 * "이번 주 금요일에 얼마 들어오나" 를 아무 데서도 못 본다.
 *
 * 배당 앱들이 날짜를 머리글로 세우고 그 밑에 종목을 단다.
 *
 *   08.25
 *     MSFO   22주 × 195원   3,631원
 *     NVDY   23주 × 166원   3,251원
 */
describe("점날짜", () => {
  it("머리글은 08.25 모양이다", () => {
    expect(점날짜("2026-08-25")).toBe("08.25");
    expect(점날짜("2026-12-01")).toBe("12.01");
  });
});

describe("날짜별로", () => {
  const 주배당 = (심볼: string, 이름: string, 수량: number, 날들: [string, number][]) =>
    줄({
      symbol: 심볼, market: "US", name: 이름, currency: "USD", cycle: "주",
      shares: 수량, months: [이번달], per_month: 4,
      schedule: [{ month: 이번달, day: Number(날들[날들.length - 1][0].slice(8)),
                   amount: 날들.reduce((s, x) => s + x[1], 0), year: new Date().getFullYear(),
                   올해확정: true, days: 날들.map(([date, amount]) => ({ date, amount })) }],
    });

  it("같은 날에 들어오는 종목을 한 칸에 모은다", () => {
    const 칸들 = 날짜별로([
      주배당("MSFO", "MSFO", 22, [[이번달날(18), 0.1], [이번달날(25), 0.2]]),
      주배당("NVDY", "NVDY", 23, [[이번달날(25), 0.15]]),
    ], 이번달, 1400);

    expect(칸들.map((c) => c.date.slice(8))).toEqual(["25", "18"]);   // 최근 것부터
    expect(칸들[0].줄들.map((x) => x.r.symbol).sort()).toEqual(["MSFO", "NVDY"]);
    expect(칸들[1].줄들.map((x) => x.r.symbol)).toEqual(["MSFO"]);
  });

  it("칸 합계는 그 날 줄들의 합이다", () => {
    const 칸들 = 날짜별로([
      주배당("MSFO", "MSFO", 22, [[이번달날(25), 0.2]]),
      주배당("NVDY", "NVDY", 23, [[이번달날(25), 0.15]]),
    ], 이번달, 1400);
    // 0.2 × 22 × 1400 + 0.15 × 23 × 1400
    expect(칸들[0].합계).toBeCloseTo(0.2 * 22 * 1400 + 0.15 * 23 * 1400, 2);
    expect(칸들[0].합계).toBeCloseTo(칸들[0].줄들.reduce((s, x) => s + x.금액, 0), 6);
  });

  it("한 칸 안은 금액 큰 순이다", () => {
    const 칸들 = 날짜별로([
      주배당("작은것", "작은것", 1, [[이번달날(25), 0.1]]),
      주배당("큰것", "큰것", 100, [[이번달날(25), 0.1]]),
    ], 이번달, 1400);
    expect(칸들[0].줄들.map((x) => x.r.symbol)).toEqual(["큰것", "작은것"]);
  });

  it("지난 것과 앞으로의 것을 섞지 않는다", () => {
    /* 하나는 실제로 들어온 돈이고 하나는 추정이다. 한 칸에 같이 담으면
       어느 쪽이 사실인지 알 길이 없어진다 */
    const r = 줄({
      symbol: "SCHD", market: "US", currency: "USD", cycle: "주", shares: 10,
      months: [이번달],
      schedule: [{ month: 이번달, day: 10, amount: 0.1, year: new Date().getFullYear(),
                   올해확정: true, days: [{ date: 이번달날(10), amount: 0.1 }] }],
      upcoming: [{ date: 이번달날(24), amount: 0.1 }],
    });
    const 칸들 = 날짜별로([r], 이번달, 1400);
    const 지난것 = 칸들.find((c) => c.date === 이번달날(10))!;
    const 앞으로것 = 칸들.find((c) => c.date === 이번달날(24))!;
    expect(지난것.예상).toBe(false);
    expect(앞으로것.예상).toBe(true);
  });

  it("수량이 0이면 그 줄을 안 만든다", () => {
    /* '0원' 짜리 줄은 '배당을 안 준다' 로 읽힌다 */
    const 칸들 = 날짜별로([주배당("X", "X", 0, [[이번달날(25), 0.2]])], 이번달, 1400);
    expect(칸들).toEqual([]);
  });

  it("날짜별 기록이 없으면 그 달 일정에서 하루를 만든다", () => {
    /* 분기배당은 days 가 없다. 그래도 schedule.day 는 안다 */
    const r = 줄({
      shares: 100, currency: "KRW", months: [이번달],
      schedule: [{ month: 이번달, day: 15, amount: 361, year: new Date().getFullYear(), 올해확정: true }],
    });
    const 칸들 = 날짜별로([r], 이번달, 1400);
    expect(칸들).toHaveLength(1);
    expect(칸들[0].date.slice(8)).toBe("15");
    expect(칸들[0].합계).toBe(361 * 100);
  });

  it("금액이 0인 달은 줄을 안 만든다", () => {
    /* 서버는 schedule 칸마다 day 를 늘 채워 보낸다. 그러니 '날짜를
       모르는 달' 은 실제로는 안 오고, 걸러야 하는 것은 금액이 0인
       달이다 — 0원짜리 줄은 '배당을 안 준다' 로 읽힌다.
       (코드의 day 검사는 그래도 남겨 둔다. 없는 날짜로
        "2026-08-undefined" 를 만드는 것보다는 빠지는 편이 낫다) */
    const r = 줄({
      shares: 100, months: [이번달],
      schedule: [{ month: 이번달, day: 15, amount: 0, year: new Date().getFullYear() }],
    });
    expect(날짜별로([r], 이번달, 1400)).toEqual([]);
  });

  it("세후를 켜면 칸 합계도 줄어든다", () => {
    const 앞 = 날짜별로([주배당("X", "X", 10, [[이번달날(25), 1]])], 이번달, 1400, false);
    const 뒤 = 날짜별로([주배당("X", "X", 10, [[이번달날(25), 1]])], 이번달, 1400, true);
    expect(뒤[0].합계).toBeCloseTo(앞[0].합계 * 0.85, 2);
  });
});

describe("날짜별 화면", () => {
  const 주배당줄 = 줄({
    symbol: "MSFO", market: "US", name: "MSFO", currency: "USD", cycle: "주",
    shares: 22, months: [이번달], per_month: 4,
    schedule: [{ month: 이번달, day: 25, amount: 0.3, year: new Date().getFullYear(),
                 올해확정: true,
                 days: [{ date: 이번달날(18), amount: 0.1 }, { date: 이번달날(25), amount: 0.2 }] }],
  });

  it("칩을 누르면 날짜 머리글로 바뀐다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [주배당줄], pending: 0 });
    그리기();
    await waitFor(() => expect(screen.getByRole("button", { name: "날짜별" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "날짜별" }));

    const 스물다섯 = `${String(이번달).padStart(2, "0")}.25`;
    const 열여덟 = `${String(이번달).padStart(2, "0")}.18`;
    expect(screen.getByText(스물다섯)).toBeInTheDocument();
    expect(screen.getByText(열여덟)).toBeInTheDocument();
  });

  it("사진처럼 '22주 × 금액' 을 적는다", async () => {
    /* 곱셈이 보이면 그 옆 금액을 눈으로 검산할 수 있다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [주배당줄], pending: 0 });
    그리기();
    await waitFor(() => expect(screen.getByRole("button", { name: "날짜별" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "날짜별" }));
    expect(screen.getAllByText(/22주 ×/).length).toBeGreaterThan(0);
  });

  it("날짜를 하나도 모르면 칩을 안 그린다", async () => {
    /* 눌러 놓고 빈 화면을 보게 되는 칩은 고장으로 읽힌다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({
        shares: 100, months: [이번달],
        schedule: [{ month: 이번달, day: 15, amount: 0, year: new Date().getFullYear() }],
      })],
      pending: 0,
    });
    그리기();
    await waitFor(() => expect(screen.getByText(/삼성전자/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "날짜별" })).not.toBeInTheDocument();
  });
});


/**
 * ── 왼쪽 칸에 뭐라고 적나 ──
 *
 * 화면을 찍어 보고 찾은 거짓말이다.
 *
 *   기준일 8월 22일 · 오늘 8월 28일  →  화면에는 **"오늘"**
 *
 * 남은날()이 음수(-6)를 주는데 `남음 <= 0` 을 '오늘' 로 묶었다. 이미
 * 엿새 지난 날을 오늘이라고 한 셈이고, 그 말을 믿으면 오늘 사도 이번
 * 배당을 받는 줄 안다 — 기준일이 지났으면 못 받는다.
 */
describe("남은글", () => {
  const 오늘 = new Date(2026, 7, 28);          // 8월 28일

  it("기준일이 아직이면 D-N", () => {
    expect(남은글({ date: "2026-08-31" }, 오늘)).toEqual({ 글: "D-3", 강조: false });
  });

  it("기준일이 오늘이면 오늘", () => {
    expect(남은글({ date: "2026-08-28" }, 오늘)).toEqual({ 글: "오늘", 강조: true });
  });

  it("지난 기준일을 '오늘' 이라고 하지 않는다", () => {
    /* 여기가 고친 자리다 */
    expect(남은글({ date: "2026-08-22" }, 오늘).글).not.toBe("오늘");
  });

  it("기준일은 지났고 입금일이 아직이면 입금 D-N", () => {
    /* 배당에서 제일 흔한 상태다. 그때 알고 싶은 것은 '언제 통장에
       꽂히나' 지 '기준일이 언제였나' 가 아니다 */
    expect(남은글({ date: "2026-08-22", pay_date: "2026-08-30" }, 오늘))
      .toEqual({ 글: "입금 D-2", 강조: false });
  });

  it("오늘이 입금일이면 그렇게 말한다", () => {
    expect(남은글({ date: "2026-08-22", pay_date: "2026-08-28" }, 오늘))
      .toEqual({ 글: "입금일", 강조: true });
  });

  it("둘 다 지났으면 완료", () => {
    expect(남은글({ date: "2026-08-10", pay_date: "2026-08-20" }, 오늘).글).toBe("완료");
  });

  it("지급일을 모르면 '완료' 라고 안 한다", () => {
    /* 아직 안 들어왔을 수도 있다. 지난 일이라는 것만 말한다 */
    expect(남은글({ date: "2026-08-22" }, 오늘).글).toBe("지남");
    expect(남은글({ date: "2026-08-22", pay_date: null }, 오늘).글).toBe("지남");
  });
});

describe("종목별 줄이 빽빽하지 않다", () => {
  it("주배당이라도 날짜를 줄줄이 늘어놓지 않는다", async () => {
    /* 화면을 찍어 보니 주배당 종목 하나가 네다섯 줄을 먹었다 —
       종목 다섯 개짜리 목록이 스무 줄이 됐다. 날짜가 궁금하면
       '날짜별' 칩이 그 일을 제대로 한다(머리글 + 합계) */
    const 주배당 = 줄({
      symbol: "MSFO", market: "US", name: "MSFO", currency: "USD", cycle: "주",
      shares: 22, months: [이번달], per_month: 4,
      schedule: [{ month: 이번달, day: 25, amount: 0.56, year: new Date().getFullYear(),
                   올해확정: true,
                   days: [4, 11, 18, 25].map((d) => ({ date: 이번달날(d), amount: 0.14 })) }],
    });
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [주배당], pending: 0 });
    그리기();
    await waitFor(() => expect(screen.getByText("MSFO")).toBeInTheDocument());
    // 종목별 화면에는 개별 날짜가 없다
    expect(screen.queryByText(/4일 \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/11일 \(/)).not.toBeInTheDocument();
    // 대신 회차 수는 적는다 — 한 번에 그만큼 준다고 읽히면 안 된다
    expect(screen.getByText(/4회/)).toBeInTheDocument();
  });

  it("한 달만 주는 종목에 '배당월' 을 안 적는다", async () => {
    /* '배당월 8' 은 바로 위에 적힌 것을 한 번 더 말하는 줄이다 */
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ shares: 100, months: [이번달], per_month: 1,
                   schedule: [{ month: 이번달, day: 15, amount: 361,
                                year: new Date().getFullYear(), 올해확정: true }] })],
      pending: 0,
    });
    그리기();
    await waitFor(() => expect(screen.getByText("삼성전자")).toBeInTheDocument());
    expect(screen.queryByText(/^배당월/)).not.toBeInTheDocument();
  });

  it("여러 달 주는 종목에는 그대로 적는다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [줄({ shares: 100, months: [2, 5, 8, 11], per_month: 1,
                   schedule: [{ month: 이번달, day: 15, amount: 361,
                                year: new Date().getFullYear(), 올해확정: true }] })],
      pending: 0,
    });
    그리기();
    await waitFor(() => expect(screen.getByText("삼성전자")).toBeInTheDocument());
    expect(screen.getByText(/배당월 2·5·8·11/)).toBeInTheDocument();
  });
});
