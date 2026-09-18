/**
 * 자산배분 백테스트 화면 — 사진의 항목이 다 있고, 실제로 도는가.
 *
 * ── 이 검사가 지키는 것 ─────────────────────────────────────
 *
 * 이 화면이 내는 수를 보고 사람이 실제 돈을 넣는다. 그래서 두 가지를
 * 특히 못 박는다 —
 *
 *   ① **넣은 돈과 번 돈을 섞지 않는다.** 매달 넣는 사람에게 '초기 대비
 *      몇 %' 는 새빨간 거짓말이다. 총납입이 화면에 있어야 한다.
 *   ② **못 한 일을 감추지 않는다.** 자산 하나를 빼고 계산했으면 그
 *      사실이 보여야 한다. 조용히 빼면 사용자는 다 담은 줄 안다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* vi.mock 은 import 위로 끌어올려지므로, 팩토리가 볼 값은 vi.hoisted 로
   같이 끌어올려야 한다. 그냥 let 으로 두면 팩토리가 돌 때 아직 없다. */
const 상태 = vi.hoisted(() => ({ 로그인함: true, 실험들: [] as any[] }));

const 돌린것: any[] = [];
const runPortfolio = vi.fn((p: any) => {
  돌린것.push(p);
  return Promise.resolve(결과흉내);
});

const 결과흉내 = {
  start_date: "2018-01-02", end_date: "2026-09-01", years: 8.67,
  contributed: 62_000_000, final_value: 123_712_056, profit: 61_712_056,
  total_return: 99.54, twr_annual: 13.51, irr_annual: 13.45,
  mdd: 18.2, volatility: 14.3, sharpe: 0.92, dividends: 2_996_680,
  yearly: [{ year: 2018, return: -4.2 }, { year: 2019, return: 22.1 }],
  curve: [{ date: "2018-01-02", value: 10_000_000 },
          { date: "2026-09-01", value: 123_712_056 }],
  currency: "KRW" as const,
  assets: [{ symbol: "AAPL", market: "US", name: "Apple", weight: 0.6 }],
  skipped: [], fx_skipped: [], mixed_currency: true, costs_included: false,
  costs: null, cost_rate: null, data_interval: "daily" as const,
  risk_free_rate: 0, cash_rate: 0,
  benchmark: null, extended_from: {},
};

vi.mock("@/api/stocks", () => ({
  backtestApi: {
    runPortfolio: (...a: unknown[]) => runPortfolio(...(a as [any])),
    getExperiments: vi.fn(() => Promise.resolve(상태.실험들)),
    saveExperiment: vi.fn(), deleteExperiment: vi.fn(),
  },
}));
vi.mock("@/store/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: 상태.로그인함, userId: 1 }),
}));
vi.mock("@/hooks/useStockSearch", () => ({
  useStockSearch: () => ({
    query: "", setQuery: vi.fn(), searching: false,
    results: [{ symbol: "AAPL", market: "US", name: "Apple" },
              { symbol: "005930", market: "KR", name: "삼성전자" }],
  }),
}));

import 자산배분탭, { 보낼것, 예상초, 단계글, 진행바 } from "../AllocationTab";
import { 눈금글 } from "../AllocationResult";
import {
  기간에서날짜, 못돌리는이유, 첫설정, 읽는금액, 금액값들, 빠른기간,
} from "../AllocationForm";
import { 실험을설정으로 } from "../AllocationTab";
import 자산배분결과화면 from "../AllocationResult";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><자산배분탭 /></QueryClientProvider>);
}

beforeEach(() => {
  돌린것.length = 0; vi.clearAllMocks();
  상태.로그인함 = true; 상태.실험들 = [];
});

describe("사진의 항목이 다 있다", () => {
  it("여섯 가지가 화면에 있다", () => {
    그리기();
    for (const 이름 of ["테스트 기간", "테스트 금액", "테스트 자산",
                        "추가 납입 금액", "리밸런싱 주기"]) {
      expect(screen.getByText(이름), `${이름} 이 없다`).toBeInTheDocument();
    }
    expect(screen.getByText(/토탈 리턴/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /결과 확인/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^저장/ })).toBeInTheDocument();
    /* 목록은 여기 없다 — '전략 저장소' 탭이 그 일을 다 한다.
       저장한 것이 두 군데로 갈라져 있으면 어디에 뒀는지 기억해야 한다. */
    expect(screen.queryByRole("button", { name: "내 실험 목록" }),
      "목록 버튼이 아직 있다").toBeNull();
  });

  it("날짜는 늘 직접 입력이다", () => {
    /* 예전에는 슬라이더가 기본이고 체크박스를 켜야 날짜가 나왔다.
       슬라이더로는 '2020년 3월부터' 같은 것을 아예 못 고른다 —
       흔한 기간은 아래 버튼으로 한 번에 채우면 되니 굳이 둘 중
       하나를 고르게 할 이유가 없다. */
    그리기();
    expect(screen.getByLabelText("시작일")).toBeInTheDocument();
    expect(screen.getByLabelText("종료일")).toBeInTheDocument();
    expect(screen.queryByLabelText("직접 입력"), "체크박스가 아직 있다").toBeNull();
  });

  it("기간 빠른 버튼이 날짜를 바로 채운다", async () => {
    그리기();
    const 시작 = screen.getByLabelText("시작일") as HTMLInputElement;
    const 끝 = screen.getByLabelText("종료일") as HTMLInputElement;
    await userEvent.click(screen.getByLabelText("3년"));
    const 햇수 = (Number(끝.value.slice(0, 4)) - Number(시작.value.slice(0, 4)));
    expect(햇수).toBe(3);
    await userEvent.click(screen.getByLabelText("10년"));
    expect(Number(끝.value.slice(0, 4)) - Number(시작.value.slice(0, 4))).toBe(10);
  });

  it("고른 칩이 고른 티가 난다", async () => {
    /* 칩을 눌러도 눌린 표시가 안 나면 방금 무엇을 골랐는지 화면을
       봐서는 알 수가 없다. 색과 aria-pressed 둘 다 필요하다 —
       색은 눈으로 보는 사람에게, aria-pressed 는 읽어 주는 사람에게. */
    그리기();
    await userEvent.click(screen.getByLabelText("3년"));
    const 고름 = screen.getByLabelText("3년");
    const 안고름 = screen.getByLabelText("5년");
    expect(고름.getAttribute("aria-pressed"), "고른 칩이 안 눌린 걸로 나온다").toBe("true");
    expect(안고름.getAttribute("aria-pressed"), "안 고른 칩이 눌린 걸로 나온다").toBe("false");
    expect(고름.className, "고른 칩에 강조색이 없다").toMatch(/border-accent-blue/);
    expect(안고름.className, "안 고른 칩까지 강조색이다").not.toMatch(/border-accent-blue(?!\/)/);
  });

  it("빠른 기간에 1·3·5·10년이 있다", () => {
    for (const 년 of [1, 3, 5, 10]) expect(빠른기간).toContain(년);
  });

  it("통화를 고를 수 있다", () => {
    그리기();
    const 통화 = screen.getByLabelText("통화") as HTMLSelectElement;
    expect([...통화.options].map((o) => o.value)).toEqual(["KRW", "USD"]);
  });

  it("주기 드롭다운이 넷을 준다", () => {
    그리기();
    const 적립 = screen.getByLabelText("추가 납입 주기") as HTMLSelectElement;
    expect([...적립.options].map((o) => o.value))
      .toEqual(["none", "monthly", "quarterly", "yearly"]);
    const 리밸 = screen.getByLabelText("리밸런싱 주기") as HTMLSelectElement;
    expect([...리밸.options].map((o) => o.value))
      .toEqual(["none", "monthly", "quarterly", "yearly"]);
  });
});

describe("사진에 있던 나머지 항목", () => {
  it("여덟 가지 고르기 칸이 다 있다", () => {
    그리기();
    for (const 이름 of ["리밸런싱 주기", "리밸런싱 날짜", "데이터 기준",
                        "벤치 마크", "거래비용", "배분 기준"]) {
      expect(screen.getByLabelText(이름), `${이름} 칸이 없다`).toBeInTheDocument();
    }
    expect(screen.getByLabelText("확장된 ETF 가격 사용")).toBeInTheDocument();
    expect(screen.getByLabelText("통화")).toBeInTheDocument();
  });

  it("리밸런싱 날짜가 1~28일만 준다", () => {
    /* 29~31 은 없는 달이 있다. '31일' 을 고르면 2월이 통째로 빠지는데
       그게 화면에는 안 보인다 — 애초에 못 고르게 한다. */
    그리기();
    const 날 = screen.getByLabelText("리밸런싱 날짜") as HTMLSelectElement;
    const 값들 = [...날.options].map((o) => Number(o.value));
    expect(값들[0]).toBe(1);
    expect(Math.max(...값들)).toBe(28);
    expect(값들).toHaveLength(28);
  });

  it("거래비용을 직접 칠 수 있다", async () => {
    /* 증권사마다 수수료가 제각각이라 목록으로는 다 못 담는다.
       목록에만 두면 자기 수수료가 없는 사람은 비슷한 값을 고르게
       되고, 그건 틀린 값으로 계산하는 것이다. */
    그리기();
    const 비용 = screen.getByLabelText("거래비용") as HTMLInputElement;
    expect(비용.tagName, "아직 드롭다운이다 — 직접 못 친다").toBe("INPUT");
    expect(비용.value, "기본이 0 이 아니다").toBe("");
    await userEvent.type(비용, "0.037");
    expect(비용.value).toBe("0.037");
  });

  it("흔한 수수료는 버튼으로 한 번에", async () => {
    그리기();
    const 비용 = screen.getByLabelText("거래비용") as HTMLInputElement;
    await userEvent.click(screen.getByLabelText("거래비용 0.1%"));
    expect(비용.value).toBe("0.1");
    await userEvent.click(screen.getByLabelText("거래비용 반영 안 함"));
    expect(비용.value).toBe("");
  });

  it("데이터 기준과 벤치마크를 고를 수 있다", () => {
    그리기();
    const 기준 = screen.getByLabelText("데이터 기준") as HTMLSelectElement;
    expect([...기준.options].map((o) => o.value)).toEqual(["daily", "monthly"]);
    const 벤치 = screen.getByLabelText("벤치 마크") as HTMLSelectElement;
    expect([...벤치.options].map((o) => o.value))
      .toEqual(["none", "6040", "spy", "qqq", "kospi", "allweather"]);
    expect(벤치.value).toBe("none");
  });

  it("고른 설정이 그대로 서버에 간다", () => {
    /* 아무 일도 안 하는 조작칸은 없느니만 못하다. 이 저장소에서 이미
       '투자비중 슬라이더가 서버에 안 갔다' 를 한 번 겪었다. */
    const s = {
      ...첫설정(new Date(2026, 0, 1)),
      assets: [{ symbol: "A", market: "US", weight: 100 }],
      initial_amount: 1_000_000, contribution_period: "none" as const,
      rebalance_day: 20, cost_rate: 0.25, data_interval: "monthly" as const,
      benchmark: "6040" as const, equal_weight: true, extended: true,
    };
    const 보낸것 = 보낼것(s);
    expect(보낸것.rebalance_day).toBe(20);
    expect(보낸것.cost_rate).toBe(0.25);
    expect(보낸것.data_interval).toBe("monthly");
    expect(보낸것.benchmark).toBe("6040");
    expect(보낸것.equal_weight).toBe(true);
    expect(보낸것.extended).toBe(true);
  });

  it("거래비용은 퍼센트 그대로 보낸다", () => {
    /* 비율로 바꾸는 것은 서버 한 곳에서만 한다. 양쪽에서 나누면
       수수료가 100분의 1 이 되고, 결과가 그럴듯해서 아무도 못 알아챈다. */
    const s = { ...첫설정(new Date(2026, 0, 1)), cost_rate: 0.1 };
    expect(보낼것(s).cost_rate).toBe(0.1);
  });

  it("1980년부터도 돌릴 수 있다", async () => {
    /* 확장 ETF 가격을 켜면 지수가 1927년까지 있다. 옛날 구간을 못
       고르면 그 기능을 켜 놓고도 못 쓴다.

       예전에는 '최대년' 이라는 상수를 검사했는데, 슬라이더를 없앤
       뒤로는 **그 상수가 아무것도 안 막고 있었다** — 지키는 척만 하는
       검사였다. 지금은 날짜를 직접 치므로, 정말로 1980년을 넣고
       돌릴 수 있는지를 본다. */
    그리기();
    const 시작 = screen.getByLabelText("시작일") as HTMLInputElement;
    await userEvent.clear(시작);
    await userEvent.type(시작, "1980-01-02");
    expect(시작.value, "1980년을 못 넣는다").toBe("1980-01-02");

    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(screen.getByText("Apple"));
    await userEvent.click(screen.getByLabelText("1000만원"));
    expect(screen.getByRole("button", { name: /결과 확인/ }),
      "1980년으로 두면 못 돌린다").toBeEnabled();
  }, 20000);
});

describe("금액을 읽을 수 있게 적는다", () => {
  /* 0 이 몇 개인지 세게 하면 안 된다. 1000만과 1억은 눈으로 가르기
     어렵고, 한 자리 틀리면 결과가 열 배로 달라진다. */
  it("통화마다 단위가 다르다", () => {
    expect(읽는금액(10_000, "USD")).toBe("1만 달러");
    expect(읽는금액(10_000_000, "KRW")).toBe("1000만원");
    expect(읽는금액(100_000_000, "KRW")).toBe("1억원");
    expect(읽는금액(1_500_000, "KRW")).toBe("150만원");
  });

  it("빈 값에는 아무것도 안 적는다", () => {
    expect(읽는금액(0, "KRW")).toBe("");
    expect(읽는금액(NaN, "USD")).toBe("");
  });

  it("금액 버튼이 통화를 본다", () => {
    /* 원화에 1,000달러는 아무 쓸모가 없고, 달러에 100만도 마찬가지다 */
    expect(금액값들("KRW")).toEqual([1_000_000, 5_000_000, 10_000_000, 100_000_000]);
    expect(금액값들("USD")[0]).toBe(1_000);
  });

  it("버튼을 누르면 그 금액으로 바로 정해진다", async () => {
    /* 더하기로 두면 1,000만원을 넣으려고 여러 번 눌러야 하고, 한 번
       더 누르면 2,000만원이 되어 지우고 다시 시작해야 한다. */
    그리기();
    const 금액 = screen.getByLabelText("테스트 금액") as HTMLInputElement;
    await userEvent.click(screen.getByLabelText("1000만원"));
    expect(금액.value).toBe("10000000");
    await userEvent.click(screen.getByLabelText("100만원"));
    expect(금액.value, "더해졌다 — 바로 정해져야 한다").toBe("1000000");
  });
});

describe("자산을 담는다", () => {
  it("+ 를 누르면 검색이 열리고, 고르면 목록에 붙는다", async () => {
    그리기();
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(screen.getByText("Apple"));
    expect(await screen.findByLabelText("Apple 비중 (%)")).toBeInTheDocument();
  });

  it("담을 때마다 비중을 똑같이 나눈다", async () => {
    /* 0% 로 들어가면 '담았는데 결과에 아무 영향이 없는' 상태가 되고,
       그건 고장으로 읽힌다 */
    그리기();
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(screen.getByText("Apple"));
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(screen.getByText("삼성전자"));
    expect((await screen.findByLabelText("Apple 비중 (%)") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("삼성전자 비중 (%)") as HTMLInputElement).value).toBe("50");
  });

  it("같은 자산을 두 번 담지 않는다", async () => {
    /* 이미 담은 자산 줄에도 'Apple' 이 적혀 있어서, 글자만으로 찾으면
       검색 결과와 담긴 줄이 둘 다 잡힌다. 검색 결과 버튼은 이름 옆에
       심볼이 같이 적히므로 그걸로 가른다. */
    const 검색결과 = () => screen.getByRole("button", { name: /Apple\s*AAPL/ });
    그리기();
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(검색결과());
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(검색결과());
    expect(screen.getAllByLabelText("Apple 비중 (%)")).toHaveLength(1);
  });

  it("현금을 담을 수 있다 — 자산배분에서 아주 흔한 구성이다", async () => {
    그리기();
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(screen.getByText("+ 현금"));
    expect(await screen.findByLabelText("현금 비중 (%)")).toBeInTheDocument();
  });
});

describe("못 돌릴 때 이유를 말로 적는다", () => {
  /* 버튼만 회색이면 무엇이 모자란지 모른 채 화면을 뒤지게 된다 */
  it("자산이 없으면 그렇게 적는다", () => {
    그리기();
    expect(screen.getByText(/자산을 하나 이상/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /결과 확인/ })).toBeDisabled();
  });

  it("자산과 금액만 넣으면 바로 돌아간다", () => {
    /* ── 실제로 났던 고장 ──────────────────────────────────

       기본 설정이 '추가 납입 **매월** + 금액 비어 있음' 이었다.
       그래서 자산을 담고 금액을 넣어도 '결과 확인' 이 잠긴 채였다.
       잠긴 이유는 작은 글씨로만 적혀 있었고, 풀려면 **쓰지도 않을**
       적립 주기를 '없음' 으로 바꿔야 했다.

       사용자에게는 기능이 통째로 고장 난 것으로 보인다 — 실제로
       '백테스팅이 안 된다' 는 말을 들었다.

       기본값은 **아무것도 안 고쳐도 돌아가는 값**이어야 한다. */
    const 기본 = 첫설정(new Date(2026, 0, 1));
    expect(못돌리는이유(기본)).toMatch(/자산/);

    const 자산만 = { ...기본, assets: [{ symbol: "A", market: "US", weight: 100 }] };
    expect(못돌리는이유(자산만)).toMatch(/금액/);

    const 금액까지 = { ...자산만, initial_amount: 1_000_000 };
    expect(못돌리는이유(금액까지),
      "자산과 금액을 다 넣었는데도 막힌다 — 기본값이 스스로를 막고 있다")
      .toBeNull();
  });

  it("적립을 켜면 그때는 금액을 묻는다", () => {
    /* 위 검사의 짝이다. 막는 것 자체가 나쁜 게 아니라,
       **아무것도 안 고른 사람을 막는 것**이 나빴다. */
    const 기본 = 첫설정(new Date(2026, 0, 1));
    const 적립켬 = {
      ...기본, assets: [{ symbol: "A", market: "US", weight: 100 }],
      initial_amount: 1_000_000, contribution_period: "monthly" as const,
    };
    expect(못돌리는이유(적립켬)).toMatch(/납입/);
    expect(못돌리는이유({ ...적립켬, contribution_amount: 100_000 })).toBeNull();
  });

  it("화면에서도 자산·금액만으로 버튼이 열린다", async () => {
    /* 함수만 고치고 화면이 그대로면 아무것도 안 고쳐진다.
       실제로 눌러 본다. */
    그리기();
    expect(screen.getByRole("button", { name: /결과 확인/ })).toBeDisabled();
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(screen.getByText("Apple"));
    await userEvent.click(screen.getByLabelText("1000만원"));
    expect(screen.getByRole("button", { name: /결과 확인/ }),
      "자산과 금액을 넣었는데 여전히 잠겨 있다").toBeEnabled();
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });
});

describe("서버로 보내는 값", () => {
  it("주기가 '없음' 이면 적립 금액도 0 으로 보낸다", () => {
    /* 금액만 남겨 두면 서버가 '적립 있음' 으로 읽어 총납입이 부풀려진다 */
    const s = { ...첫설정(new Date(2026, 0, 1)),
                contribution_period: "none" as const, contribution_amount: 500_000 };
    expect(보낼것(s).contribution_amount).toBe(0);
  });

  it("금액이 비어 있어도 숫자로 보낸다", () => {
    const s = { ...첫설정(new Date(2026, 0, 1)), initial_amount: "" as const };
    expect(보낼것(s).initial_amount).toBe(0);
  });
});

describe("기간에서날짜", () => {
  it("오늘을 인자로 받는다 — 안에서 부르면 검사가 날짜에 흔들린다", () => {
    const r = 기간에서날짜(8, new Date(2026, 8, 16));
    expect(r.end_date).toBe("2026-09-16");
    expect(r.start_date).toBe("2018-09-16");
  });
});

describe("결과 — 넣은 돈과 번 돈을 섞지 않는다", () => {
  it("총 납입금이 화면에 있다", () => {
    render(<자산배분결과화면 r={결과흉내 as any} />);
    expect(screen.getByText("총 납입금")).toBeInTheDocument();
    expect(screen.getByText("₩62,000,000")).toBeInTheDocument();
  });

  it("연환산을 두 가지로 보여 준다", () => {
    /* 하나만 보여 주면 적립식의 핵심인 그 차이가 통째로 사라진다 */
    render(<자산배분결과화면 r={결과흉내 as any} />);
    expect(screen.getByText(/전략 성적/)).toBeInTheDocument();
    expect(screen.getByText(/내 수익률/)).toBeInTheDocument();
    expect(screen.getByText("13.51%")).toBeInTheDocument();
    expect(screen.getByText("13.45%")).toBeInTheDocument();
  });

  it("못 잰 값은 '—' 로 적는다", () => {
    /* 물음표 접근자만 쓰면 'undefined%' 가 찍힌다 */
    render(<자산배분결과화면 r={{ ...결과흉내, twr_annual: null, irr_annual: null,
                                   mdd: null, sharpe: null } as any} />);
    expect(screen.queryByText(/undefined/)).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("금액이 길어도 자르지 않고 글자를 줄인다", () => {
    /* 돈은 자릿수가 곧 뜻이다. 끝을 잘라 '₩181,740,043,5…' 로 보이면
       억인지 조인지 알 수 없고, 폰에서는 마우스를 올려 볼 수도 없다.
       (390px 에서 실제로 칸 밖으로 잘려 나가는 것을 찍어 보고 고쳤다.) */
    const 큰수 = 181_740_043_506_109;
    render(<자산배분결과화면 r={{ ...결과흉내, final_value: 큰수,
                                   contributed: 58_000_000 } as any} />);
    const 칸 = screen.getByText(`₩${큰수.toLocaleString("ko-KR")}`);
    expect(칸, "수가 잘렸다 — 자릿수가 사라지면 금액을 못 읽는다").toBeInTheDocument();
    expect(칸.className, "긴 수인데 큰 글자 그대로라 칸 밖으로 나간다")
      .not.toMatch(/text-lg/);
  });

  it("짧은 금액은 큰 글자 그대로 둔다", () => {
    /* 위 검사의 짝이다. 길이와 상관없이 늘 줄이면 보통 경우가
       공연히 작아진다 — 줄이는 것은 길 때만이어야 한다. */
    render(<자산배분결과화면 r={결과흉내 as any} />);
    expect(screen.getByText("₩62,000,000").className).toMatch(/text-lg/);
  });

  it("세로축 눈금이 통화를 본다", () => {
    /* 달러로 보고 있는데 '만' 이 붙으면 안 된다. $10,000 을 '1만' 이라
       적으면 달러를 만 단위로 세는 셈인데, 그렇게 읽는 사람은 없다.
       (처음에 `${v/10000}만` 하나로 끝냈다가 잡았다.) */
    expect(눈금글(10_000, "USD")).toBe("10K");
    expect(눈금글(1_500_000, "USD")).toBe("1.5M");
    expect(눈금글(10_000, "KRW")).toBe("1만");
    expect(눈금글(120_000_000, "KRW")).toBe("1.2억");
  });

  it("큰 값도 눈금이 짧다 — 축 너비가 54px 뿐이다", () => {
    /* '1000000000만' 같은 라벨이 나와 그래프를 덮는 것을 찍어 보고 고쳤다.
       눈금은 다섯 글자를 안 넘어야 축 안에 든다.
       1억~10조 는 30년 적립으로 실제로 닿을 수 있는 구간이다. */
    for (const v of [1e8, 1e10, 1e12, 1e13])
      expect(눈금글(v, "KRW").length,
             `${v} 의 눈금이 '${눈금글(v, "KRW")}' 로 너무 길다`).toBeLessThanOrEqual(5);
    for (const v of [1e6, 1e9, 1e12])
      expect(눈금글(v, "USD").length).toBeLessThanOrEqual(6);
  });

  it("말도 안 되는 값에서도 축을 안 덮는다", () => {
    /* 개인 자산으로 100조를 넘길 일은 없다. 그래도 넘어갔을 때
       '180000000000000000' 같은 라벨이 그래프를 통째로 가리면
       무엇이 잘못됐는지조차 안 보인다 — 조 위로도 자리를 묶어 둔다.
       여기만 한도가 느슨한 것은 일부러다. 이 구간까지 다섯 글자에
       맞추려고 규칙을 더 꼬면, 정작 흔한 구간이 읽기 나빠진다. */
    expect(눈금글(1.8e17, "KRW").length).toBeLessThanOrEqual(8);
    expect(눈금글(1.8e17, "KRW")).toMatch(/조$/);
  });

  it("거래비용을 안 넣었다는 것을 감추지 않는다", () => {
    render(<자산배분결과화면 r={결과흉내 as any} />);
    expect(screen.getByText(/수수료·세금·슬리피지/)).toBeInTheDocument();
  });

  it("벤치마크가 있으면 나란히 보여 준다", () => {
    /* 수익률만 보면 잘한 것인지 알 수 없다. 8년에 연 13%가 좋은
       성적인지는 같은 기간 S&P500 이 몇 %였나를 봐야 정해진다. */
    render(<자산배분결과화면 r={{ ...결과흉내, benchmark: {
      key: "6040", name: "주식 60 · 채권 40", contributed: 62_000_000,
      final_value: 98_000_000, total_return: 58.1, twr_annual: 9.2,
      irr_annual: 9.0, mdd: 22.4, volatility: 11.1, sharpe: 0.8, curve: [],
    } } as any} />);
    expect(screen.getByText(/주식 60 · 채권 40 와 견주기/)).toBeInTheDocument();
    expect(screen.getByText("9.2%")).toBeInTheDocument();
    /* 견주는 칸의 금액은 줄여서 적는다 — 세 칸을 390px 에 나누면
       20자리가 잘리고, 잘린 돈은 억인지 조인지 알 수 없다.
       정확한 금액은 바로 위 칸에 온전히 있다. */
    expect(screen.getByText("9800만")).toBeInTheDocument();
    /* 조건이 같다는 것을 말해 줘야 한다 — 기간이 다르면 견줄 수
       없는 수인데, 그걸 모르면 그냥 믿는다 */
    expect(screen.getByText(/같은 기간/)).toBeInTheDocument();
  });

  it("낙폭은 작은 쪽이 이긴다", () => {
    /* 낙폭만 부호가 거꾸로다. 그냥 빼면 **더 크게 물린 쪽**이
       초록으로 칠해진다 — 잘못 읽으면 위험한 조합을 좋은 것으로 본다. */
    const 벤치 = (mdd: number) => ({
      key: "spy", name: "S&P500", contributed: 62_000_000,
      final_value: 90_000_000, total_return: 45, twr_annual: 8,
      irr_annual: 8, mdd, volatility: 15, sharpe: 0.6, curve: [],
    });

    /* '-18.2%' 는 견주기 칸과 아래 '위험' 칸 두 군데에 나온다.
       화면 전체에서 찾으면 둘 다 걸리므로 견주기 칸 안에서만 찾는다. */
    const 견주기칸 = () => {
      const 머리 = screen.getByText(/와 견주기/);
      return within(머리.closest("div")!.parentElement!);
    };

    // 내 낙폭 18.2% < 벤치 33% → 내가 덜 물렸으니 내 값이 초록
    const 첫판 = render(<자산배분결과화면 r={{ ...결과흉내, benchmark: 벤치(33) } as any} />);
    expect(견주기칸().getByText("-18.2%").className).toMatch(/accent-green/);
    첫판.unmount();

    // 뒤집으면 빨강이어야 한다. 이 짝이 없으면 늘 초록인 코드도 통과한다
    render(<자산배분결과화면 r={{ ...결과흉내, benchmark: 벤치(5) } as any} />);
    expect(견주기칸().getByText("-18.2%").className, "내가 더 크게 물렸는데 초록이다")
      .toMatch(/accent-red/);
  });

  it("벤치마크가 없으면 그 칸을 안 그린다", () => {
    render(<자산배분결과화면 r={결과흉내 as any} />);
    expect(screen.queryByText(/견주기/)).toBeNull();
  });

  it("수수료를 냈으면 얼마를 냈는지 적는다", () => {
    render(<자산배분결과화면 r={{ ...결과흉내, costs_included: true,
                                   costs: 788_860, cost_rate: 0.001 } as any} />);
    expect(screen.getByText(/거래비용 0.1%/)).toBeInTheDocument();
    expect(screen.getByText(/₩788,860/)).toBeInTheDocument();
    expect(screen.queryByText(/반영하지 않았어요/)).toBeNull();
  });

  it("지수로 이은 구간이 있으면 반드시 말한다", () => {
    /* 조용히 이으면 사용자는 1980년치 SPY 자료가 있는 줄 안다 —
       실제로는 지수를 본 것이고, 지수에는 배당도 운용보수도 없다.
       이걸 안 적는 것은 '몰래 다른 자료로 계산' 과 같다. */
    render(<자산배분결과화면 r={{ ...결과흉내,
                                   extended_from: { SPY: "1980-01-02" } } as any} />);
    expect(screen.getByText(/SPY는 1980-01-02/)).toBeInTheDocument();
    expect(screen.getByText(/배당과 운용보수가 빠진 지수/)).toBeInTheDocument();
  });

  it("월 데이터로 쟀으면 낙폭이 작게 나온다고 알린다", () => {
    render(<자산배분결과화면 r={{ ...결과흉내, data_interval: "monthly" } as any} />);
    expect(screen.getByText(/최대 낙폭은 실제보다 작게/)).toBeInTheDocument();
  });

  it("뺀 자산이 있으면 먼저 알린다", () => {
    /* 조용히 빼고 계산하면 사용자는 다 담은 줄 알고 덜 담긴 결과를 본다 —
       백테스트에서 가장 나쁜 실패다 */
    render(<자산배분결과화면 r={{ ...결과흉내, skipped: ["NOPE"],
                                   fx_skipped: ["XYZ"] } as any} />);
    expect(screen.getByText(/일부 자산을 빼고 계산했어요/)).toBeInTheDocument();
    expect(screen.getByText(/NOPE/)).toBeInTheDocument();
    expect(screen.getByText(/XYZ/)).toBeInTheDocument();
  });
});

describe("실제로 돈다", () => {
  it("자산을 고르고 금액을 넣으면 결과가 그려진다", async () => {
    그리기();
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(screen.getByText("Apple"));
    await userEvent.type(screen.getByLabelText("테스트 금액"), "10000000");
    await userEvent.selectOptions(screen.getByLabelText("추가 납입 주기"), "none");

    await userEvent.click(screen.getByRole("button", { name: /결과 확인/ }));
    await waitFor(() => expect(runPortfolio).toHaveBeenCalled());
    expect(await screen.findByText("총 납입금")).toBeInTheDocument();

    const 보낸것 = 돌린것[0];
    expect(보낸것.assets).toHaveLength(1);
    expect(보낸것.initial_amount).toBe(10_000_000);
    expect(보낸것.total_return).toBe(true);
  }, 20000);
});

describe("로그인 전에도 무엇을 할 수 있는지 보인다", () => {
  it("저장 버튼을 숨기지 않고, 누르면 이유를 말한다", async () => {
    /* 아예 안 그리면 '저장이 어디 있지' 가 되고, 사용자는 기능이
       고장 난 것으로 읽는다. 결과 확인은 로그인 없이도 되므로
       그 사실까지 같이 알려 준다. */
    상태.로그인함 = false;
    그리기();
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(screen.getByText("Apple"));
    await userEvent.click(screen.getByLabelText("1000만원"));

    const 저장 = screen.getByRole("button", { name: "저장" });
    expect(저장, "로그인 전이라고 저장 버튼을 아예 없앴다").toBeInTheDocument();
    await userEvent.click(저장);
    expect(screen.getByText(/로그인이 필요해요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /결과 확인/ }),
      "로그인 없이도 결과 확인은 돼야 한다").toBeEnabled();
  });
});

describe("계산하는 동안 진행률을 보여 준다", () => {
  /* 아무 표시도 없이 몇 초 멈춰 있으면 사용자는 고장으로 읽는다.
     특히 무료 서버가 자고 있었으면 30초가 넘는다. */
  const 기본 = () => ({
    ...첫설정(new Date(2026, 0, 1)),
    assets: [{ symbol: "A", market: "US", weight: 100 }],
    initial_amount: 1_000_000,
  });

  it("할 일이 많을수록 더 오래 잡는다", () => {
    /* 고정된 시간으로 그리면, 짧은 경우엔 막대가 멈춰 있고 긴 경우엔
       92%에서 한참 기다리게 된다. */
    const 하나 = 예상초({ ...기본(), total_return: false });
    const 여덟 = 예상초({
      ...기본(), total_return: false,
      assets: Array.from({ length: 8 }, (_, i) => ({ symbol: `A${i}`, market: "US", weight: 12.5 })),
    });
    expect(여덟).toBeGreaterThan(하나);

    // 배당과 벤치마크는 서버가 실제로 더 하는 일이다
    expect(예상초({ ...기본(), total_return: true }))
      .toBeGreaterThan(예상초({ ...기본(), total_return: false }));
    expect(예상초({ ...기본(), benchmark: "6040" }))
      .toBeGreaterThan(예상초({ ...기본(), benchmark: "none" }));
  });

  it("현금은 시세를 안 받으므로 안 센다", () => {
    const 현금낀것 = { ...기본(), assets: [
      { symbol: "A", market: "US", weight: 50 },
      { symbol: "현금", market: "KR", weight: 50 },
    ]};
    expect(예상초(현금낀것)).toBe(예상초(기본()));
  });

  it("어디쯤인지 말로 알려 준다", () => {
    const s = 기본();
    expect(단계글(0.1, s)).toMatch(/시세/);
    expect(단계글(0.95, { ...s, benchmark: "6040" })).toMatch(/견줄/);
    // 네 구간이 서로 다른 말을 해야 한다 — 같으면 말해 주는 뜻이 없다
    const 말들 = [0.1, 0.5, 0.8, 0.95].map((r) => 단계글(r, { ...s, total_return: true }));
    expect(new Set(말들).size).toBe(4);
  });

  it("퍼센트가 오르고, 다 되기 전에 100%를 안 찍는다", async () => {
    /* 다 됐다고 해 놓고 계속 도는 것은 아무것도 안 보여 주는 것보다
       나쁘다 — 사용자는 화면이 멈춘 줄 안다. */
    vi.useFakeTimers();
    try {
      const { container } = render(<진행바 설정={기본()} />);
      const 바 = () => container.querySelector('[role="progressbar"]')!;
      const 값 = () => Number(바().getAttribute("aria-valuenow"));

      expect(값()).toBe(0);
      await act(async () => { vi.advanceTimersByTime(1000); });
      const 중간 = 값();
      expect(중간).toBeGreaterThan(0);

      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(값(), "다 되기도 전에 100%를 찍었다").toBeLessThanOrEqual(92);
      expect(값()).toBeGreaterThan(중간);
    } finally {
      vi.useRealTimers();
    }
  });

  it("오래 걸리면 왜 그런지 말해 준다", async () => {
    /* 무료 서버가 자고 있었으면 첫 요청이 30초 넘는다.
       아무 말이 없으면 고장으로 읽힌다. */
    vi.useFakeTimers();
    try {
      render(<진행바 설정={기본()} />);
      expect(screen.queryByText(/쉬고 있었나/)).toBeNull();
      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(screen.getByText(/쉬고 있었나/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("폰에서 날짜 두 개가 다 보인다", () => {
  it("좁은 화면에서는 세로로 쌓는다", () => {
    /* 날짜 칸 두 개를 폰에서 나란히 두면 하나가 150px 도 안 된다.
       거기에 브라우저가 붙이는 달력 단추까지 들어가는데, 그 단추
       크기도 날짜 글자 모양도 기기·언어마다 다르다 — 한국어는
       '2026. 09. 18.' 이라 영어보다 훨씬 넓다.

       jsdom 에는 배치가 없어서 폭을 잴 수 없다. 그래서 **규칙**을
       본다: 좁을 때 한 칸, 넓어지면 두 칸. */
    그리기();
    const 칸 = screen.getByLabelText("시작일").closest("div")!.parentElement!;
    expect(칸.className, "폰에서도 두 칸으로 나눠 놨다").toMatch(/grid-cols-1/);
    expect(칸.className, "넓은 화면에서 두 칸으로 안 벌어진다").toMatch(/sm:grid-cols-2/);
  });
});

describe("진행률이 실제로 계산 중에 뜬다", () => {
  it("돌리는 동안 막대가 보이고, 끝나면 사라진다", async () => {
    /* 진행바 부품만 따로 검사하면, 그걸 화면에 **안 달아도** 통과한다.
       실제로 '결과 확인' 을 눌러서 뜨는지 본다.
       (부품만 검사했더니 탭에서 한 줄을 지우는 뮤테이션이 살아남았다.) */
    let 응답보내기: (v: any) => void = () => {};
    runPortfolio.mockImplementationOnce(
      () => new Promise((resolve) => { 응답보내기 = resolve; }));

    그리기();
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(screen.getByText("Apple"));
    await userEvent.click(screen.getByLabelText("1000만원"));
    await userEvent.click(screen.getByRole("button", { name: /결과 확인/ }));

    const 막대 = await screen.findByRole("progressbar");
    expect(막대, "계산 중인데 진행률이 안 보인다").toBeInTheDocument();
    expect(screen.queryByText("총 납입금"), "아직 안 끝났는데 결과가 보인다").toBeNull();

    await act(async () => { 응답보내기(결과흉내); });
    expect(await screen.findByText("총 납입금")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar"), "끝났는데 막대가 남아 있다").toBeNull();
  }, 20000);
});

describe("비중 버튼 이름", () => {
  it("'동일비중' 이라고 적는다", async () => {
    /* 짧은 말이 낫다. '비중을 똑같이 나누기' 는 버튼치고 너무 길어
       폰에서 줄이 넘어간다. */
    그리기();
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(screen.getByText("Apple"));
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(screen.getByText("삼성전자"));
    // 비중을 흐트러뜨려야 버튼이 나온다
    await userEvent.clear(screen.getAllByLabelText(/비중 \(%\)/)[0]);
    await userEvent.type(screen.getAllByLabelText(/비중 \(%\)/)[0], "70");

    expect(screen.getByRole("button", { name: "동일비중" })).toBeInTheDocument();
    expect(screen.queryByText("비중을 똑같이 나누기"), "옛 글자가 남아 있다").toBeNull();
  }, 20000);
});

describe("저장했다는 것을 알려 준다", () => {
  /* 목록을 이 화면에서 없앴다. 그래서 저장 뒤에 아무 말도 안 하면
     저장이 됐는지 **알 방법이 아예 없다** — 버튼만 눌리고 화면은
     그대로다. 어디로 갔는지도 같이 적어야 찾으러 갈 수 있다. */
  async function 저장까지() {
    그리기();
    await userEvent.click(screen.getByLabelText("자산 추가"));
    await userEvent.click(screen.getByText("Apple"));
    await userEvent.click(screen.getByLabelText("1000만원"));
    await userEvent.click(screen.getByRole("button", { name: /^저장/ }));
  }

  it("저장하면 어디에서 볼 수 있는지 말해 준다", async () => {
    await 저장까지();
    const 알림 = await screen.findByText(/저장했어요/);
    expect(알림).toBeInTheDocument();
    expect(알림.textContent, "어디로 갔는지 안 알려 준다").toMatch(/전략 저장소/);
  }, 20000);

  it("설정을 고치면 그 표시를 내린다", async () => {
    /* 안 내리면 '저장했어요' 가 그대로 붙어 있어서, 고친 내용까지
       저장된 줄 알게 된다. */
    await 저장까지();
    expect(await screen.findByText(/저장했어요/)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("500만원"));
    await waitFor(() => {
      expect(screen.queryByText(/저장했어요/),
        "설정을 고쳤는데 '저장했어요' 가 그대로다").toBeNull();
    });
  }, 20000);
});


describe("가정을 감추지 않는다", () => {
  /* 샤프는 '무위험으로 그냥 둬도 얻었을 것' 을 뺀 수이고, 낙폭은 넣은
     돈을 지운 곡선에서 잰 수다. 무엇을 가정하고 잰 것인지 화면에 없으면
     사람은 자기 기준으로 읽는다 — 가정을 감추는 것이 가정 자체보다
     나쁘다. */

  it("무위험수익률과 현금 이자를 칠 수 있다", async () => {
    그리기();
    for (const 이름 of ["현금 이자", "무위험수익률"]) {
      expect(screen.getByLabelText(이름), `${이름} 칸이 없다`).toBeInTheDocument();
    }
  });

  it("고른 값이 그대로 서버에 간다", () => {
    const 설정 = { ...첫설정(), cash_rate: 3.5, risk_free_rate: 2.75 };
    const 보낼 = 보낼것(설정);
    /* 퍼센트 그대로 보낸다 — 비율로 바꾸는 것은 서버 한 곳에서만 한다.
       양쪽에서 나누면 100분의 1 이 되고 아무도 못 알아챈다. */
    expect(보낼.cash_rate).toBe(3.5);
    expect(보낼.risk_free_rate).toBe(2.75);
  });

  it("결과에 무엇을 가정했는지 적는다", () => {
    render(<자산배분결과화면 r={결과흉내 as never} />);
    const 글 = document.body.textContent ?? "";
    expect(글, "낙폭 기준을 안 적는다").toMatch(/낙폭.*넣은 돈/);
    expect(글, "무위험수익률을 안 적는다").toMatch(/무위험 0%/);
    expect(글, "현금 이자를 안 적는다").toMatch(/현금은 이자 없음/);
  });

  it("현금 이자를 넣었으면 그 값을 적는다", () => {
    render(<자산배분결과화면 r={{ ...결과흉내, cash_rate: 3 } as never} />);
    expect(document.body.textContent).toMatch(/현금 이자 연 3%/);
  });

  it("저장한 실험에서 두 설정을 되살린다", () => {
    /* 설정 하나라도 빠지면 불러와 다시 돌렸을 때 저장할 때와 다른
       수가 나온다. 오류도 경고도 없어서 눈으로는 못 찾는다. */
    const 지금 = 첫설정();
    const 되살림 = 실험을설정으로(
      { cash_rate: 3.5, risk_free_rate: 2 } as never, 지금);
    expect(되살림.cash_rate).toBe(3.5);
    expect(되살림.risk_free_rate).toBe(2);
  });

  it("옛날 실험에는 그 칸이 없다 — 지금 값을 그대로 둔다", () => {
    /* undefined 를 넣으면 입력칸이 통제 불능이 된다 */
    const 지금 = { ...첫설정(), cash_rate: 1.5, risk_free_rate: 1 };
    const 되살림 = 실험을설정으로({} as never, 지금);
    expect(되살림.cash_rate).toBe(1.5);
    expect(되살림.risk_free_rate).toBe(1);
  });
});
