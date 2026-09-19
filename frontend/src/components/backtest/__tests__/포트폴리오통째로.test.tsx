/**
 * '이 포트폴리오 비중 그대로 담기' 단추 — **눌러서 실제로 들어오는가.**
 *
 * 위의 포트폴리오그대로.test 는 셈만 본다. 셈이 맞아도 단추가 안 보이거나
 * 눌러도 아무 일이 없으면 사용자에게는 없는 기능이다. 여기서는 화면을
 * 그려서 눌러 본다.
 *
 * 특히 두 가지를 못 박는다 —
 *
 *   ① **담아 둔 것을 말없이 지우지 않는다.** 이 단추는 목록을 갈아
 *      끼우므로, 이미 담은 것이 있으면 반드시 먼저 묻는다.
 *   ② **열둘을 넘어 잘렸으면 화면에 적는다.** 조용히 자르면 스무
 *      종목을 담은 줄 알고 열두 종목짜리 결과를 본다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const 상태 = vi.hoisted(() => ({
  로그인함: true,
  포폴들: [] as any[],
  보유들: [] as any[],
  시세들: [] as any[],
  환율: 1300,
  환율진짜: true,
  /** getPrices 를 몇 번 불렀나 — 못 받은 종목을 다시 받는지 본다 */
  시세부른횟수: 0,
}));

vi.mock("@/api/stocks", () => ({
  backtestApi: {
    runPortfolio: vi.fn(), getExperiments: vi.fn(() => Promise.resolve([])),
    getPortfolioProgress: vi.fn(() => Promise.resolve(null)),
    saveExperiment: vi.fn(), deleteExperiment: vi.fn(),
  },
  portfolioApi: {
    getPortfolios: vi.fn(() => Promise.resolve(상태.포폴들)),
    getItems: vi.fn(() => Promise.resolve(상태.보유들)),
  },
  watchlistApi: {
    getItems: vi.fn(() => Promise.resolve([])),
    //: 비중은 **평가금액** 기준이라 시세가 있어야 한다
    getPrices: vi.fn(() => {
      상태.시세부른횟수 += 1;
      return Promise.resolve(상태.시세들);
    }),
  },
  watchlistFolderApi: { getFolders: vi.fn(() => Promise.resolve([])) },
}));
vi.mock("@/store/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: 상태.로그인함, userId: 1 }),
}));
vi.mock("@/hooks/useStockSearch", () => ({
  useStockSearch: () => ({ query: "", setQuery: vi.fn(), searching: false, results: [] }),
}));
vi.mock("@/hooks/useExchangeRate", () => ({
  useExchangeRateLive: () => ({ 환율: 상태.환율, 진짜인가: 상태.환율진짜 }),
  useExchangeRate: () => 상태.환율,
  useExchangeRateChange: () => 0,
}));

import 자산배분설정, { 첫설정, 최대자산수 } from "../AllocationForm";
import { 재촉_횟수 } from "@/constants/portfolioQuery";
import type { 배분자산 } from "@/api/stocks";

function 보유줄(symbol: string, shares: number, avgPrice = 1000, 더: any = {}) {
  return { id: symbol, symbol, market: "KR", name: symbol,
           shares, avgPrice, currency: "KRW", ...더 };
}

/** 화면을 그리고, 바뀐 설정을 들고 있는다 */
function 그리기(첫자산: 배분자산[] = []) {
  const 바뀐것: any[] = [];
  let 값 = { ...첫설정(), assets: 첫자산 };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  /* 설정을 **실제로 들고 있는** 껍데기. 바꾸기만 spy 로 두고 값을
     고정해 두면, '담겼는지' 는 보여도 '화면이 그 값으로 다시 그려지는지'
     는 못 본다 — 갈아 끼우기·안내 문구가 전부 다시 그린 뒤에 나온다. */
  function 껍데기() {
    const [s, setS] = useState(값);
    값 = s;
    return (
      <자산배분설정
        값={s}
        바꾸기={(다음: any) => { 바뀐것.push(다음); setS(다음); }}
        돌리기={vi.fn()} 도는중={false}
      />
    );
  }
  const r = render(
    <QueryClientProvider client={qc}><껍데기 /></QueryClientProvider>);
  return { ...r, 바뀐것, 지금값: () => 값 };
}

/** 고르기 창을 열고 '내 자산' 칸으로 간다 */
async function 내자산칸열기() {
  await userEvent.click(screen.getByLabelText("자산 추가"));
  await userEvent.click(screen.getByLabelText("내 자산에서"));
}

/** 같은 일을 **가짜 시계 아래에서** 한다.
 *
 *  userEvent 는 안에서 진짜 setTimeout 을 기다린다. 가짜 시계를 켜 둔
 *  채로 부르면 그 기다림이 영영 안 끝나 검사가 5초 뒤 시간 초과로
 *  죽고, try/finally 의 useRealTimers 까지 못 가서 **그 뒤의 검사가
 *  전부 같이 죽는다**(실제로 그렇게 여덟 개가 한꺼번에 깨졌다).
 *  fireEvent 는 시계를 안 쓴다. */
function 내자산칸열기_가짜시계() {
  fireEvent.click(screen.getByLabelText("자산 추가"));
  fireEvent.click(screen.getByLabelText("내 자산에서"));
}

/* 가짜 시계를 켠 검사가 중간에 죽어도 **다음 검사는 진짜 시계로**
   시작해야 한다. 이 한 줄이 없으면 하나가 멈출 때 파일 전체가 같이
   죽어서, 진짜 원인이 뭔지 찾는 데만 한참 걸린다. */
afterEach(() => { vi.useRealTimers(); });

beforeEach(() => {
  vi.clearAllMocks();
  상태.로그인함 = true;
  상태.포폴들 = [{ id: 1, name: "연금저축" }];
  상태.보유들 = [보유줄("A", 30), 보유줄("B", 10)];
  상태.시세들 = [{ symbol: "A", market: "KR", price: 1000 },
                 { symbol: "B", market: "KR", price: 1000 }];
  상태.환율 = 1300;
  상태.환율진짜 = true;
  상태.시세부른횟수 = 0;
});


describe("단추가 보이고, 누르면 비중 그대로 들어온다", () => {
  it("내 자산 칸에 '비중 그대로 담기' 가 있다", async () => {
    그리기();
    await 내자산칸열기();
    expect(await screen.findByLabelText("이 포트폴리오를 비중 그대로 담기"))
      .toBeInTheDocument();
  });

  it("누르면 종목과 **비중이 같이** 들어온다", async () => {
    const { 지금값 } = 그리기();
    await 내자산칸열기();
    await userEvent.click(
      await screen.findByLabelText("이 포트폴리오를 비중 그대로 담기"));

    await waitFor(() => expect(지금값().assets).toHaveLength(2));
    const 몫 = Object.fromEntries(
      지금값().assets.map((a: 배분자산) => [a.symbol, a.weight]));
    /* A 30주 · B 10주, 둘 다 1,000원 → 75% 대 25%.
       똑같이 나누면 50/50 이 된다 — 그건 내가 굴리는 것과 다른 조합이다. */
    expect(몫.A, "비중을 안 가져오고 똑같이 나눴다").toBeCloseTo(75, 1);
    expect(몫.B).toBeCloseTo(25, 1);
  });

  it("'동일 비중' 이 켜져 있으면 같이 끈다", async () => {
    /* 켜진 채로 두면 서버가 비중을 무시하고 똑같이 나눈다 — 비중
       그대로 담아 놓고 비중이 안 먹는, 화면에는 75/25 로 적혀 있는데
       결과는 50/50 인 상태가 된다. 오류도 안 나고 표시도 없다. */
    const { 지금값 } = 그리기();
    await userEvent.click(screen.getByLabelText("배분 기준"));
    await userEvent.selectOptions(screen.getByLabelText("배분 기준"), "equal");
    await waitFor(() => expect(지금값().equal_weight).toBe(true));

    await 내자산칸열기();
    await userEvent.click(
      await screen.findByLabelText("이 포트폴리오를 비중 그대로 담기"));

    await waitFor(() => expect(지금값().assets).toHaveLength(2));
    expect(지금값().equal_weight,
      "비중 그대로 담았는데 '동일 비중' 이 켜진 채라 비중이 안 먹는다").toBe(false);
  });

  it("관심종목 칸으로 옮기면 사라진다 — 관심종목에는 비중이 없다", async () => {
    /* **내 자산을 먼저 열어 본 뒤** 옮겨야 한다. 바로 관심종목으로
       가면 보유 목록을 받은 적이 없어 단추가 저절로 안 보이고, 그러면
       '내자산일 때만' 이라는 조건을 지워도 검사가 안 죽는다
       (실제로 뮤테이션이 살아남는 것으로 확인했다).

       react-query 는 칸을 옮겨 질의가 꺼져도 **받아 둔 값을 들고
       있으므로**, 이 순서라야 진짜 상황이 된다. */
    그리기();
    await 내자산칸열기();
    await screen.findByLabelText("이 포트폴리오를 비중 그대로 담기");

    await userEvent.click(screen.getByLabelText("관심종목에서"));
    expect(screen.queryByLabelText("이 포트폴리오를 비중 그대로 담기"),
      "관심종목 칸인데 포트폴리오 담기 단추가 남아 있다").toBeNull();
  });

  it("로그인 안 했으면 안 보인다", async () => {
    상태.로그인함 = false;
    그리기();
    await 내자산칸열기();
    expect(screen.queryByLabelText("이 포트폴리오를 비중 그대로 담기")).toBeNull();
  });

  it("보유 종목이 없으면 안 보인다 — 눌러도 아무 일 없는 단추를 두지 않는다", async () => {
    상태.보유들 = [];
    그리기();
    await 내자산칸열기();
    await waitFor(() => expect(screen.getByText(/종목이 없어요/)).toBeInTheDocument());
    expect(screen.queryByLabelText("이 포트폴리오를 비중 그대로 담기")).toBeNull();
  });
});


describe("담아 둔 것을 말없이 지우지 않는다", () => {
  const 이미담은것: 배분자산[] = [
    { symbol: "SPY", market: "US", name: "SPY", weight: 100 }];

  it("이미 담은 것이 있으면 먼저 묻는다", async () => {
    const { 지금값 } = 그리기(이미담은것);
    await 내자산칸열기();
    await userEvent.click(
      await screen.findByLabelText("이 포트폴리오를 비중 그대로 담기"));

    expect(await screen.findByText(/담아 둔 자산을 바꿀까요/)).toBeInTheDocument();
    //: 아직은 안 바뀌어 있어야 한다
    expect(지금값().assets.map((a: 배분자산) => a.symbol)).toEqual(["SPY"]);
  });

  it("확인을 누르면 갈아 끼운다", async () => {
    const { 지금값 } = 그리기(이미담은것);
    await 내자산칸열기();
    await userEvent.click(
      await screen.findByLabelText("이 포트폴리오를 비중 그대로 담기"));
    await userEvent.click(await screen.findByRole("button", { name: "바꾸기" }));

    await waitFor(() =>
      expect(지금값().assets.map((a: 배분자산) => a.symbol)).toEqual(["A", "B"]));
  });

  it("비어 있으면 안 묻고 바로 담는다", async () => {
    const { 지금값 } = 그리기([]);
    await 내자산칸열기();
    await userEvent.click(
      await screen.findByLabelText("이 포트폴리오를 비중 그대로 담기"));

    await waitFor(() => expect(지금값().assets).toHaveLength(2));
    expect(screen.queryByText(/담아 둔 자산을 바꿀까요/)).toBeNull();
  });
});


describe("잘렸으면 화면에 적는다", () => {
  beforeEach(() => {
    /* 상한(최대자산수)보다 많이 담아야 잘린다. 숫자를 박아 두면
       상한을 올릴 때마다 이 검사가 조용히 뜻을 잃는다 — 실제로
       12 에서 20 으로 올렸을 때 그렇게 됐다. */
    상태.보유들 = Array.from({ length: 최대자산수 + 5 }, (_, i) => 보유줄(`S${i}`, i + 1));
    상태.시세들 = 상태.보유들.map((x: any) => (
      { symbol: x.symbol, market: "KR", price: 1000 }));
  });

  it("몇 개 중 몇 개를 담았는지 적는다", async () => {
    그리기();
    await 내자산칸열기();
    await userEvent.click(
      await screen.findByLabelText("이 포트폴리오를 비중 그대로 담기"));

    const 글 = await screen.findByText(
      new RegExp(`비중이 큰 ${최대자산수}개만 담았어요`));
    expect(글.textContent, "몇 개 중인지를 안 적는다")
      .toMatch(new RegExp(`${최대자산수 + 5}개`));
    expect(글.textContent, "원래 비중의 얼마인지를 안 적는다").toMatch(/%/);
  });

  it("열둘 안쪽이면 그 안내를 안 띄운다", async () => {
    상태.보유들 = [보유줄("A", 30), 보유줄("B", 10)];
    상태.시세들 = [{ symbol: "A", market: "KR", price: 1000 },
                   { symbol: "B", market: "KR", price: 1000 }];
    const { 지금값 } = 그리기();
    await 내자산칸열기();
    await userEvent.click(
      await screen.findByLabelText("이 포트폴리오를 비중 그대로 담기"));

    await waitFor(() => expect(지금값().assets).toHaveLength(2));
    expect(screen.queryByText(/만 담았어요/), "안 잘렸는데 잘렸다고 한다").toBeNull();
  });
});


describe("시세를 못 받은 종목은 **다시 받는다**", () => {
  beforeEach(() => {
    //: B 만 아직 못 받았다 — 서버가 시간을 넘겨 price 를 비운 채 준 모양
    상태.시세들 = [{ symbol: "A", market: "KR", price: 1000 },
                   { symbol: "B", market: "KR", price: null }];
  });

  it("못 받은 종목이 몇 개인지 적는다", async () => {
    /* 안 적으면 그 종목만 매입금액으로 비중이 잡히는데 화면에는
       아무 표시도 안 난다. 10년 전에 산 종목이면 지금 가치와 크게
       다르고, 그 차이가 그대로 백테스트의 비중이 된다. */
    그리기();
    await 내자산칸열기();
    expect(await screen.findByText(/1개는 아직 시세를 못 받았어요/))
      .toBeInTheDocument();
  });

  it("그동안 다시 물어본다 — 한 번 묻고 말지 않는다", async () => {
    vi.useFakeTimers();
    try {
      그리기();
      내자산칸열기_가짜시계();
      await vi.waitFor(() => expect(상태.시세부른횟수).toBeGreaterThan(0));
      const 처음 = 상태.시세부른횟수;

      //: 재촉주기(4초)를 두 번 넘긴다
      await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
      expect(상태.시세부른횟수, "못 받은 종목이 있는데 다시 안 물어본다")
        .toBeGreaterThan(처음);
    } finally {
      vi.useRealTimers();
    }
  });

  it("다 받으면 그만 물어본다 — 서버를 계속 두드리지 않는다", async () => {
    상태.시세들 = [{ symbol: "A", market: "KR", price: 1000 },
                   { symbol: "B", market: "KR", price: 1000 }];
    vi.useFakeTimers();
    try {
      그리기();
      내자산칸열기_가짜시계();
      await vi.waitFor(() => expect(상태.시세부른횟수).toBeGreaterThan(0));
      const 처음 = 상태.시세부른횟수;

      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(상태.시세부른횟수, "다 받았는데 계속 두드린다").toBe(처음);
    } finally {
      vi.useRealTimers();
    }
  });

  it("영영 못 받아도 언젠가 멈춘다", async () => {
    /* 상장폐지·야후가 모르는 심볼이 섞여 있으면 영원히 두드리게 된다.
       그건 서버를 제일 세게 때리는 짓이고, 그런다고 값이 생기지도 않는다.

       시계를 한 번에 크게 돌리면 안 된다 — 다시 받는 일이 비동기라
       한 번 돌릴 때마다 한 걸음씩만 나간다(그래서 60초를 한 번에
       돌렸더니 1회만 세어졌다). 여러 번 나눠 돌려 **잦아들 때까지**
       둔 뒤에 견준다. */
    vi.useFakeTimers();
    try {
      그리기();
      내자산칸열기_가짜시계();
      const 돌리기 = async (번: number) => {
        for (let i = 0; i < 번; i++) {
          await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        }
      };
      await 돌리기(15);
      const 잦아든뒤 = 상태.시세부른횟수;
      await 돌리기(15);
      expect(상태.시세부른횟수, "영영 못 받는 종목 때문에 계속 두드린다")
        .toBe(잦아든뒤);
      //: 몇 번까지 두드렸나 — 상수에 묶인다
      expect(잦아든뒤, `재촉 횟수(${재촉_횟수})보다 훨씬 많이 두드렸다`)
        .toBeLessThanOrEqual(재촉_횟수 + 2);
    } finally {
      vi.useRealTimers();
    }
  });
});


describe("환율을 실제로 받아 쓰고, 그 값을 적는다", () => {
  const 달러섞인것 = [
    보유줄("A", 30),
    보유줄("US종목", 1, 100, { market: "US", currency: "USD" }),
  ];

  beforeEach(() => {
    상태.보유들 = 달러섞인것;
    상태.시세들 = [{ symbol: "A", market: "KR", price: 1000 },
                   { symbol: "US종목", market: "US", price: 100 }];
  });

  it("비중에 쓴 환율을 화면에 적는다", async () => {
    상태.환율 = 1389;
    그리기();
    await 내자산칸열기();
    expect(await screen.findByText(/원\/달러 1,389원으로 환산/)).toBeInTheDocument();
  });

  it("받아 온 환율이 그대로 비중에 들어간다", async () => {
    /* 환율이 다르면 달러 종목의 비중이 달라져야 한다. 안 달라지면
       화면에 적힌 환율과 실제로 쓴 환율이 다르다는 뜻이다. */
    const 비중재기 = async (환율: number) => {
      상태.환율 = 환율;
      const { 지금값, unmount } = 그리기();
      await 내자산칸열기();
      await userEvent.click(
        await screen.findByLabelText("이 포트폴리오를 비중 그대로 담기"));
      await waitFor(() => expect(지금값().assets).toHaveLength(2));
      const w = 지금값().assets.find((a: 배분자산) => a.symbol === "US종목")!.weight;
      unmount();
      return w;
    };
    const 낮을때 = await 비중재기(1000);
    const 높을때 = await 비중재기(1500);
    expect(높을때, "환율을 올렸는데 달러 종목 비중이 그대로다")
      .toBeGreaterThan(낮을때);
  });

  it("환율을 못 받았으면 어림값이라고 말한다", async () => {
    /* 1350 을 조용히 쓰면 '오늘 환율' 처럼 보인다. 달러 종목 비중이
       어긋난 채로 지난 20년을 재게 되는데 화면에는 표시가 없다. */
    상태.환율 = 1350;
    상태.환율진짜 = false;
    그리기();
    await 내자산칸열기();
    expect(await screen.findByText(/환율을 못 받아 어림값/)).toBeInTheDocument();
  });

  it("달러 종목이 없으면 환율 이야기를 안 한다", async () => {
    //: 원화 종목만이면 환율이 비중에 아무 영향이 없다
    상태.보유들 = [보유줄("A", 30), 보유줄("B", 10)];
    상태.시세들 = [{ symbol: "A", market: "KR", price: 1000 },
                   { symbol: "B", market: "KR", price: 1000 }];
    그리기();
    await 내자산칸열기();
    await screen.findByLabelText("이 포트폴리오를 비중 그대로 담기");
    expect(screen.queryByText(/원\/달러/)).toBeNull();
  });
});
