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
import DividendCalendar, { 날짜글, 어림날짜글, 남은날, 원본돈, 회차금액, 그달지난배당, 실제값인가, 짧은돈 }
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
