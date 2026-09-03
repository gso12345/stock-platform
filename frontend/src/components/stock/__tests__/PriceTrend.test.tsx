/**
 * 종목 상세의 차트 탭 — 먼저 나올 것과 나중에 나올 것.
 *
 * 종목 상세를 열면 캔들이 먼저 나왔다. 그런데 대부분은 그 화면에서
 * '얼마나 올랐나' 하나를 보러 온다. 캔들에서 그걸 알려면 첫 봉과
 * 마지막 봉을 눈으로 찾아 암산해야 한다.
 *
 * 여기서 못 박는 것 —
 *   · 기본은 흐름(내 자산의 자산 흐름과 같은 모양)
 *   · '자세한 차트' 를 누르면 원래 캔들이 그대로 나온다
 *   · 되돌아갈 길이 있다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { 흐름만들기, 받을기간 } from "@/components/stock/PriceTrend";

const 봉 = (date: string, close: number) =>
  ({ date, open: close, high: close, low: close, close, volume: 1 });

/** 오늘로부터 며칠 전 — 기간 자르기가 오늘을 기준으로 돈다 */
const 날 = (며칠전: number) => {
  const d = new Date();
  d.setDate(d.getDate() - 며칠전);
  return d.toISOString().slice(0, 10);
};

describe("흐름만들기", () => {
  it("첫날 대비 %로 바꾼다", () => {
    /* 세로축을 숨겼으므로 값 자체는 어차피 안 보인다. 보이는 것은
       모양뿐이고, 그 모양을 읽을 자를 하나로 맞춘다 */
    const 점들 = 흐름만들기([봉(날(10), 100), 봉(날(5), 110), 봉(날(1), 90)], 30);
    expect(점들.map((p) => p.수익)).toEqual([0, 10, -10]);
  });

  it("종가도 같이 들고 간다 — 툴팁이 얼마인지 말해야 한다", () => {
    const 점들 = 흐름만들기([봉(날(10), 100), 봉(날(1), 120)], 30);
    expect(점들[1].close).toBe(120);
  });

  it("날짜순으로 세운다", () => {
    /* 원천이 거꾸로 줄 수도 있다. 그대로 그리면 선이 뒤로 간다 */
    const 점들 = 흐름만들기([봉(날(1), 120), 봉(날(10), 100)], 30);
    expect(점들[0].day).toBe(날(10));
    expect(점들[1].수익).toBeCloseTo(20);
  });

  it("고른 기간 밖은 자른다", () => {
    const 점들 = 흐름만들기([봉(날(90), 50), 봉(날(10), 100), 봉(날(1), 110)], 30);
    expect(점들).toHaveLength(2);
    expect(점들[0].수익).toBe(0);          // 기준이 90일 전이 아니라 10일 전
  });

  it("받아 온 것이 짧으면 있는 대로 다 보여 준다", () => {
    /* 잘라서 둘 이하가 되면 '기간을 늘렸는데 선이 사라졌다' 가 된다 */
    const 점들 = 흐름만들기([봉(날(300), 100), 봉(날(280), 120)], 30);
    expect(점들).toHaveLength(2);
  });

  it("값이 하나뿐이면 안 그린다", () => {
    /* 점 하나짜리 선은 그리면 고장으로 보인다 */
    expect(흐름만들기([봉(날(1), 100)], 30)).toEqual([]);
    expect(흐름만들기([], 30)).toEqual([]);
    expect(흐름만들기(undefined, 30)).toEqual([]);
  });

  it("0원이나 없는 종가는 버린다", () => {
    /* 0으로 나누면 Infinity 가 나오고 그래프가 통째로 찌그러진다 */
    const 점들 = 흐름만들기(
      [봉(날(10), 100), 봉(날(5), 0), { ...봉(날(3), 1), close: NaN }, 봉(날(1), 110)], 30);
    expect(점들).toHaveLength(2);
    expect(점들[1].수익).toBeCloseTo(10);
  });
});

describe("받을기간", () => {
  it("'올해' 는 1년치를 받아 화면에서 자른다", () => {
    /* 서버가 ytd 를 모른다 — yfinance PERIOD_MAP 에 없어서 조용히
       1년으로 떨어진다. 그걸 모르고 ytd 를 보내면 '올해' 를 눌러도
       1년치가 그대로 나온다 */
    expect(받을기간["올해"]).toBe("1y");
  });

  it("칩마다 받을 기간이 정해져 있다", () => {
    expect(받을기간["1개월"]).toBe("1mo");
    expect(받을기간["3개월"]).toBe("3mo");
    expect(받을기간["전체"]).toBe("max");
  });
});

/* ── 화면 ── */

vi.mock("@/api/stocks", () => ({
  stocksApi: { getOHLCV: vi.fn() },
}));
/* 자산 흐름 검사와 같은 목을 쓴다. 그리지 않고 트리만 훑어서 어떤
   props 를 넘겼는지 본다 — 렌더 순서에 안 기댄다 */
vi.mock("@/components/chart/ChartFrame", () => {
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
      const 차트 = (담김.AreaChart?.[0] ?? {}) as { data?: { 수익: number }[] };
      const 면들 = (담김.Area ?? []) as { dataKey?: string; stroke?: string }[];
      const 기준선 = (담김.ReferenceLine ?? []) as { y?: number }[];
      return (
        <div data-testid="차트">
          <span data-testid="점수">{차트.data?.length ?? 0}</span>
          <span data-testid="선들">{면들.map((a) => a.dataKey).join(",")}</span>
          <span data-testid="선색들">{면들.map((a) => `${a.dataKey}=${a.stroke}`).join(" ")}</span>
          <span data-testid="수익들">
            {(차트.data ?? []).map((p) => p.수익.toFixed(2)).join(" ")}
          </span>
          <span data-testid="기준선">{기준선.map((l) => `${l.y}`).join(" ")}</span>
        </div>
      );
    },
  };
});

import { stocksApi } from "@/api/stocks";
import PriceTrend from "@/components/stock/PriceTrend";

function 그리기(props: Partial<Parameters<typeof PriceTrend>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PriceTrend market="KR" symbol="005930" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("종목 흐름 화면", () => {
  beforeEach(() => {
    vi.mocked(stocksApi.getOHLCV).mockResolvedValue(
      [봉(날(60), 100_000), 봉(날(30), 110_000), 봉(날(1), 120_000)] as never,
    );
  });

  it("이 화면에 온 이유를 제일 크게 적는다", async () => {
    /* 캔들에서 '얼마나 올랐나' 를 알려면 첫 봉과 마지막 봉을 눈으로
       찾아 암산해야 한다 */
    그리기();
    expect(await screen.findByTestId("기간수익")).toHaveTextContent("+20.00%");
  });

  it("처음에는 3개월을 본다", async () => {
    그리기();
    await waitFor(() => expect(stocksApi.getOHLCV)
      .toHaveBeenCalledWith("KR", "005930", "3mo", "1d"));
  });

  it("기간을 바꾸면 그 기간으로 다시 물어본다", async () => {
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "1년" }));
    await waitFor(() => expect(stocksApi.getOHLCV)
      .toHaveBeenCalledWith("KR", "005930", "1y", "1d"));
  });

  it("%로 그린다 — 자산 흐름과 같은 자다", async () => {
    그리기();
    await waitFor(() => expect(screen.getByTestId("수익들"))
      .toHaveTextContent("0.00 10.00 20.00"));
  });

  it("최고·최저에 줄을 긋고 아래에 적는다", async () => {
    /* 세로 눈금이 없어서, 선이 오르내리는 모양은 보여도 얼마나
       오르내렸는지는 안 보인다 */
    그리기();
    expect(await screen.findByText(/최고 \+20\.00% · 최저 \+0\.00%/)).toBeInTheDocument();
  });

  it("국내는 원, 해외는 달러로 적는다", async () => {
    그리기();
    expect(await screen.findByText(/120,000원/)).toBeInTheDocument();
  });

  it("해외 종목은 달러", async () => {
    vi.mocked(stocksApi.getOHLCV).mockResolvedValue(
      [봉(날(60), 100), 봉(날(1), 120)] as never);
    그리기({ market: "US", symbol: "AAPL", 통화: "USD" });
    expect(await screen.findByText(/\$120/)).toBeInTheDocument();
  });

  it("'자세한 차트' 를 누르면 알려 준다", async () => {
    const 눌림 = vi.fn();
    그리기({ 자세히: 눌림 });
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "자세한 차트" }));
    expect(눌림).toHaveBeenCalled();
  });

  it("갈 곳이 없으면 그 버튼을 안 그린다", async () => {
    그리기();
    await screen.findByTestId("차트");
    expect(screen.queryByRole("button", { name: "자세한 차트" })).toBeNull();
  });

  it("그릴 값이 없으면 무엇을 기다리는지 말한다", async () => {
    vi.mocked(stocksApi.getOHLCV).mockResolvedValue([] as never);
    그리기();
    expect(await screen.findByText("이 기간에 그릴 값이 없어요")).toBeInTheDocument();
  });

  it("못 불러오면 화면 안에서 알린다", async () => {
    vi.mocked(stocksApi.getOHLCV).mockRejectedValue(new Error("끊김"));
    그리기();
    await waitFor(() => expect(screen.queryByTestId("차트")).toBeNull());
  });
});

describe("종목 상세에 실제로 붙어 있는가", () => {
  /* 컴포넌트만 맞고 화면이 안 쓰면 아무 소용이 없다 */
  it("차트 탭 기본이 흐름이고, 자세한 차트로 넘어갈 수 있다", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const 소스 = fs.readFileSync(
      path.resolve(__dirname, "../../../pages/StockDetail.tsx"), "utf-8");
    expect(소스).toContain('mainTab==="chart" && !자세한차트');
    expect(소스).toContain('mainTab==="chart" && 자세한차트');
    expect(소스).toContain("자세히={() => set자세한차트(true)}");
    // 되돌아갈 길이 없으면 한 번 누른 사람은 흐름을 다시 못 본다
    expect(소스).toContain("set자세한차트(false)");
    // 고른 것은 이 기기에 남는다
    expect(소스).toContain('use저장된값<boolean>("자세한차트", false)');
  });
});
