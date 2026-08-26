/**
 * 자산 흐름 그래프.
 *
 * 기록은 서버가 하루 한 줄씩 남긴다. 그래서 이 화면은 '데이터가 아직
 * 없는 상태' 가 정상인 시기를 반드시 지나간다 —
 *
 *   · 오늘 처음 쓰는 사람에게는 점이 하나다. 점 하나로 선을 그리면
 *     아무것도 안 보이고, 사람은 그걸 고장으로 읽는다.
 *   · 앱을 안 연 날은 비어 있다. 그 자리를 화면이 지어내 채우면
 *     '그날도 이만큼이었다' 는 거짓말이 된다.
 *
 * 그리고 기간 변화(첫 점 대비 마지막 점)는 평가손익(매입가 대비)과
 * 다른 숫자다. 둘이 섞이면 3년 전에 산 사람에게 완전히 틀린 말을 한다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AssetHistory, { 견주기 } from "@/components/portfolio/AssetHistory";
import { portfolioApi, dashboardApi } from "@/api/stocks";

vi.mock("@/api/stocks", () => ({
  portfolioApi: { getHistory: vi.fn() },
  dashboardApi: { getIndexOHLCV: vi.fn() },
}));

/* recharts 는 jsdom 에서 폭이 0 이라 아무것도 안 그린다. 넘겨받은
   데이터를 눈에 보이는 글자로 뱉는 대역을 둔다 — 이 검사가 보고 싶은
   것은 '무엇을 넘겼나' 이지 SVG 모양이 아니다. */
vi.mock("@/components/chart/ChartFrame", () => {
  /** recharts 태그 이름별로 props 를 모은다 — 그리지 않고 트리만 훑는다 */
  type 마디 = { type?: unknown; props?: Record<string, unknown> } | 마디[] | null | undefined;
  const 모으기 = (node: 마디, out: Record<string, Record<string, unknown>[]>) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach((n) => 모으기(n, out)); return; }
    if (typeof node !== "object") return;
    const t = node.type as { displayName?: string; name?: string } | string | undefined;
    const 이름 = typeof t === "string" ? t : (t?.displayName || t?.name);
    if (이름) (out[이름] ??= []).push(node.props ?? {});
    모으기(node.props?.children as 마디, out);
  };

  return {
    default: ({ children }: { children: (R: never) => unknown }) => {
      const 만들기 = (이름: string) => {
        const C = () => null;
        C.displayName = 이름;
        return C;
      };
      const R = new Proxy({}, { get: (_t, k: string) => 만들기(k) }) as never;
      const 담김: Record<string, Record<string, unknown>[]> = {};
      모으기(children(R) as 마디, 담김);
      const 차트 = (담김.AreaChart?.[0] ?? {}) as { data?: { day: string }[] };
      const 면들 = (담김.Area ?? []) as { dataKey?: string }[];
      return (
        <div data-testid="차트">
          <span data-testid="점수">{차트.data?.length ?? 0}</span>
          <span data-testid="선들">{면들.map((a) => a.dataKey).join(",")}</span>
          <span data-testid="날들">{(차트.data ?? []).map((p) => p.day).join(" ")}</span>
        </div>
      );
    },
  };
});

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><AssetHistory /></QueryClientProvider>,
  );
}

/* 원금은 일부러 어느 평가금액과도 다른 값으로 둔다. 원금과 첫날
   평가금액이 같으면 '첫 점 대비' 와 '매입가 대비' 가 우연히 같은 답을
   내서, 둘을 바꿔 놔도 검사가 안 걸린다 */
const 점 = (day: string, value: number, cost = 900_000) =>
  ({ day, value, cost, filled: 1, priced: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([]);
});

/** 지수 종가 한 줄 */
const 봉 = (date: string, close: number) =>
  ({ date, open: close, high: close, low: close, close, volume: 0 });


describe("기록이 아직 없을 때", () => {
  it("점이 하나뿐이면 선을 안 그리고 무엇을 기다리는지 말한다", async () => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-26", 1_100_000)], days: 90,
    });
    그리기();
    expect(await screen.findByText("아직 그릴 기록이 없어요")).toBeInTheDocument();
    expect(screen.queryByTestId("차트")).not.toBeInTheDocument();
  });

  it("하나도 없어도 터지지 않는다", async () => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: [], days: 90 });
    그리기();
    expect(await screen.findByText("아직 그릴 기록이 없어요")).toBeInTheDocument();
  });

  it("불러오기에 실패하면 다시 시도할 수 있다", async () => {
    vi.mocked(portfolioApi.getHistory).mockRejectedValue(new Error("서버 오류"));
    그리기();
    expect(await screen.findByRole("button", { name: /다시/ })).toBeInTheDocument();
  });
});


describe("선을 그릴 때", () => {
  const 점들 = [
    점("2026-08-20", 1_000_000),
    점("2026-08-21", 1_050_000),
    점("2026-08-24", 1_200_000),   // 22·23 은 앱을 안 연 날
  ];

  beforeEach(() => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 점들, days: 90 });
  });

  it("받은 점을 그대로 그린다 — 빈 날을 지어내지 않는다", async () => {
    그리기();
    await waitFor(() => expect(screen.getByTestId("점수")).toHaveTextContent("3"));
    // 22·23 이 없는 채로 넘어가야 한다. 채워 넣으면 그날 값을 지어낸 것이다
    expect(screen.getByTestId("날들").textContent)
      .toBe("2026-08-20 2026-08-21 2026-08-24");
  });

  it("평가금액과 원금을 같이 그린다", async () => {
    /* 선 하나만 있으면 '올랐다' 는 보여도 '벌었다' 는 안 보인다 */
    그리기();
    await waitFor(() => expect(screen.getByTestId("선들")).toHaveTextContent("cost,value"));
  });

  it("기간 변화는 첫 점 대비 마지막 점이다", async () => {
    /* 매입가 대비 수익률(평가손익)과 다른 숫자다. 3년 전에 산 사람에게
       이번 달의 움직임과 전체 수익률은 전혀 다른 이야기다. */
    그리기();
    // 1,000,000 → 1,200,000 = +20%
    await waitFor(() => expect(screen.getByText(/\+20\.00%/)).toBeInTheDocument());
  });

  it("기간을 바꾸면 그 기간으로 다시 물어본다", async () => {
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "1개월" }));
    await waitFor(() => expect(portfolioApi.getHistory).toHaveBeenCalledWith(30));

    await userEvent.click(screen.getByRole("button", { name: "1년" }));
    await waitFor(() => expect(portfolioApi.getHistory).toHaveBeenCalledWith(365));
  });

  it("처음에는 3개월을 본다", async () => {
    그리기();
    await waitFor(() => expect(portfolioApi.getHistory).toHaveBeenCalledWith(90));
  });
});


describe("자산 화면에 붙어 있다", () => {
  it("로그인하고 보유 종목이 있을 때만 그린다", async () => {
    /* 미리보기(로그인 전)에는 기록이 아예 없어서 늘 "아직 없어요" 만
       보인다 — 빈 상자를 하나 더 놓는 셈이다. */
    const fs = await import("fs");
    const path = await import("path");
    const 글 = fs.readFileSync(
      path.resolve(__dirname, "../../../pages/Portfolio.tsx"), "utf-8");
    expect(글).toContain("isLoggedIn && items.length > 0 && <AssetHistory />");
  });
});

describe("벤치마크 견주기", () => {
  const 점 = (day: string, value: number) =>
    ({ day, value, cost: 900_000, filled: 1, priced: 1 });

  it("둘 다 첫날 대비 %로 바꾼다", () => {
    /* 원화 금액과 지수 포인트는 단위가 달라 한 축에 못 올린다.
       그대로 겹치면 자산 선이 바닥에 붙어 아무것도 안 보인다. */
    const 결과 = 견주기(
      [점("2026-08-01", 1_000_000), 점("2026-08-02", 1_100_000)],
      [봉("2026-08-01", 2500), 봉("2026-08-02", 2600)],
    );
    expect(결과[0].내수익).toBeCloseTo(0);
    expect(결과[0].지수수익).toBeCloseTo(0);
    expect(결과[1].내수익).toBeCloseTo(10);
    expect(결과[1].지수수익).toBeCloseTo(4);
  });

  it("장이 안 선 날은 직전 종가를 쓴다", () => {
    /* 지수는 평일만 있고 내 기록은 주말에도 있다. 날짜가 안 맞는다고
       그날을 비우면 선이 끊겨 보인다 */
    const 결과 = 견주기(
      [점("2026-08-01", 1_000_000), 점("2026-08-02", 1_050_000), 점("2026-08-03", 1_100_000)],
      [봉("2026-08-01", 2500), 봉("2026-08-03", 2600)],   // 8/2 휴장
    );
    /* toBeCloseTo 는 null 을 0 처럼 받아 준다. 휴장일 처리를 지워도
       통과해 버리므로 '값이 있다' 를 먼저 못 박는다 */
    expect(결과[1].지수수익).not.toBeNull();
    expect(결과[1].지수수익).toBeCloseTo(0);      // 8/1 종가를 그대로
    expect(결과[2].지수수익).toBeCloseTo(4);
  });

  it("기록이 지수보다 앞서면 겹치는 날부터 견준다", () => {
    /* 내 기록의 첫날을 기준으로 잡으면, 지수 범위가 그보다 늦게
       시작할 때 비교가 통째로 사라진다 — 사용자에게는 '눌렀는데
       아무 일도 안 일어남' 으로 보인다.

       그리고 겹치기 전 날은 0으로 안 채운다. 0을 넣으면
       '그날 안 움직였다' 는 거짓말이 된다. */
    const 결과 = 견주기(
      [점("2026-08-01", 1_000_000), 점("2026-08-03", 1_000_000), 점("2026-08-05", 1_100_000)],
      [봉("2026-08-03", 2500), 봉("2026-08-05", 2600)],   // 기록이 지수보다 앞선다
    );
    expect(결과[0].지수수익).toBeNull();      // 겹치기 전 — 비운다
    expect(결과[1].지수수익).not.toBeNull();
    expect(결과[1].지수수익).toBeCloseTo(0);  // 기준일
    expect(결과[2].지수수익).toBeCloseTo(4);
    // 내 자산도 같은 기준일(8/3)에서 잰다
    expect(결과[1].내수익).toBeCloseTo(0);
    expect(결과[2].내수익).toBeCloseTo(10);
  });

  it("겹치는 날이 아예 없으면 비교를 안 한다", () => {
    const 원본 = [점("2026-08-01", 1_000_000), 점("2026-08-02", 1_100_000)];
    const 결과 = 견주기(원본, [봉("2026-09-01", 2500)]);   // 지수가 통째로 뒤
    expect(결과[0].지수수익).toBeUndefined();
  });

  it("지수가 없으면 원래 점을 그대로 돌려준다", () => {
    const 원본 = [점("2026-08-01", 1_000_000), 점("2026-08-02", 1_100_000)];
    expect(견주기(원본, undefined)).toEqual(원본.map((p) => ({ ...p })));
    expect(견주기(원본, [])).toEqual(원본.map((p) => ({ ...p })));
  });
});


describe("벤치마크 화면", () => {
  const 점들 = [
    { day: "2026-08-01", value: 1_000_000, cost: 900_000, filled: 1, priced: 1 },
    { day: "2026-08-02", value: 1_100_000, cost: 900_000, filled: 1, priced: 1 },
  ];

  beforeEach(() => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 점들, days: 90 });
  });

  it("처음에는 지수를 안 받는다 — 안 고른 사람에게 왕복을 태우지 않는다", async () => {
    그리기();
    await screen.findByTestId("차트");
    expect(dashboardApi.getIndexOHLCV).not.toHaveBeenCalled();
  });

  it("지수를 고르면 그때 받는다", async () => {
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    await waitFor(() => expect(dashboardApi.getIndexOHLCV)
      .toHaveBeenCalledWith("KOSPI", "3mo", "1d"));
  });

  it("견줄 때는 원금 대신 지수를 그린다", async () => {
    vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([
      봉("2026-08-01", 2500), 봉("2026-08-02", 2600),
    ]);
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    /* 금액 축(cost/value)과 % 축(지수수익/내수익)을 섞으면 안 된다 */
    await waitFor(() => expect(screen.getByTestId("선들"))
      .toHaveTextContent("지수수익,내수익"));
  });

  it("이겼는지 졌는지 글로도 적는다", async () => {
    /* 선 두 개가 붙어 있으면 눈으로는 어느 쪽이 이겼는지 잘 안 보인다 */
    vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([
      봉("2026-08-01", 2500), 봉("2026-08-02", 2600),
    ]);
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    // 내 자산 +10%, 코스피 +4% → 6%p 앞섬
    expect(await screen.findByText(/앞섬 6.00%p/)).toBeInTheDocument();
  });

  it("'없음' 으로 되돌리면 다시 금액으로 그린다", async () => {
    vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([
      봉("2026-08-01", 2500), 봉("2026-08-02", 2600),
    ]);
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    await waitFor(() => expect(screen.getByTestId("선들")).toHaveTextContent("지수수익,내수익"));
    await userEvent.click(screen.getByRole("button", { name: "없음" }));
    await waitFor(() => expect(screen.getByTestId("선들")).toHaveTextContent("cost,value"));
  });
});
