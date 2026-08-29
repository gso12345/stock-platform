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
import AssetHistory, { 견주기, 올해일수, 기간들, 최고최저, 퍼센트글 } from "@/components/portfolio/AssetHistory";
import { portfolioApi, dashboardApi } from "@/api/stocks";
import { useSettingsStore } from "@/store/settingsStore";

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
      const 면들 = (담김.Area ?? []) as { dataKey?: string; stroke?: string; fill?: string; yAxisId?: string }[];
      const 칠들 = (담김.stop ?? []) as { stopColor?: string }[];
      const 기준선 = (담김.ReferenceLine ?? []) as { y?: number }[];
      return (
        <div data-testid="차트">
          <span data-testid="점수">{차트.data?.length ?? 0}</span>
          <span data-testid="선들">{면들.map((a) => a.dataKey).join(",")}</span>
          <span data-testid="날들">{(차트.data ?? []).map((p) => p.day).join(" ")}</span>
          {/* 값도 내보낸다 — 오늘 점을 화면 값으로 맞추는지 보려면
              '무슨 숫자를 넘겼나' 가 필요하다 */}
          <span data-testid="값들">
            {(차트.data ?? []).map((p) => (p as { value?: number }).value).join(" ")}
          </span>
          {/* 선 색·칠 색까지 내보낸다 — 등락 색상 설정을 따르는지 보려면
              '무슨 색을 넘겼나' 가 필요하다 */}
          <span data-testid="선색들">{면들.map((a) => `${a.dataKey}=${a.stroke}`).join(" ")}</span>
          <span data-testid="칠들">{면들.map((a) => `${a.dataKey}=${a.fill}`).join(" ")}</span>
          <span data-testid="칠색들">{칠들.map((c) => c.stopColor).join(" ")}</span>
          {/* 최고·최저 줄 — 세로축이 없는 대신 이 둘이 눈금 노릇을 한다 */}
          <span data-testid="기준선">{기준선.map((l) => `${l.y}`).join(" ")}</span>
          {/* 어느 선이 어느 세로축을 쓰나 — 손익이 평가금액과 같은 축에
              들어가면 그래프가 통째로 찌그러진다 */}
          <span data-testid="축들">
            {면들.map((a) => `${a.dataKey}:${a.yAxisId ?? "기본"}`).join(" ")}
          </span>
        </div>
      );
    },
  };
});

function 그리기(props: { portfolioId?: number; 오늘평가?: number; 오늘원금?: number } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><AssetHistory {...props} /></QueryClientProvider>,
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
  /* 색 설정은 전역이다. 되돌리지 않으면 앞 검사가 바꿔 놓은 값이
     뒤 검사로 새서, 혼자 돌리면 통과하고 다 같이 돌리면 실패한다 */
  useSettingsStore.setState({ colorScheme: "green-red" });
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

  it("포트폴리오를 고른 채로 비어 있으면 '이제 막 쌓기 시작' 이라고 말한다", async () => {
    /* 전체는 지난 기록이 다 있는데 포트폴리오를 고르면 텅 빈다 —
       기록이 사람 단위로만 남던 시절 것이라 그렇다. 그 이유를 안 적으면
       '전체는 나오는데 이건 왜 안 나오지' 로 읽힌다 */
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: [], days: 90 });
    그리기({ portfolioId: 3 });
    expect(await screen.findByText(/이제 막 쌓기 시작/)).toBeInTheDocument();
    // 전체일 때 하던 안내(내일 다시 오면)는 여기서 하면 안 된다
    expect(screen.queryByText(/내일 다시 오면/)).not.toBeInTheDocument();
  });
});


describe("포트폴리오별로 본다", () => {
  beforeEach(() => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000), 점("2026-08-24", 1_200_000)], days: 90,
    });
  });

  it("고른 포트폴리오를 서버에 같이 넘긴다", async () => {
    그리기({ portfolioId: 7 });
    await waitFor(() => expect(portfolioApi.getHistory).toHaveBeenCalledWith(90, 7));
  });

  it("포트폴리오가 다르면 캐시를 따로 쓴다", async () => {
    /* 열쇠에 포트폴리오가 빠지면 앞서 받아 둔 전체 그래프가 5분(staleTime)
       동안 그대로 남는다 — 칩을 눌러도 선이 안 바뀐다 */
    const { unmount } = 그리기({ portfolioId: 1 });
    await waitFor(() => expect(portfolioApi.getHistory).toHaveBeenCalledWith(90, 1));
    unmount();
    그리기({ portfolioId: 2 });
    await waitFor(() => expect(portfolioApi.getHistory).toHaveBeenCalledWith(90, 2));
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

  it("내 자산과 원금을 같이 그린다", async () => {
    /* 선 하나만 있으면 '올랐다' 는 보여도 '벌었다' 는 안 보인다.
       둘 다 기준일 대비 % 라, 돈을 더 넣은 날에는 원금 선도 같이
       올라간다 — 오른 이유가 '벌어서' 인지 '넣어서' 인지 갈린다 */
    그리기();
    await waitFor(() => expect(screen.getByTestId("선들"))
      .toHaveTextContent("원금수익,내수익"));
  });

  it("기간 변화는 기준일 대비 마지막 점이다", async () => {
    /* 매입가 대비 수익률(평가손익)과 다른 숫자다. 3년 전에 산 사람에게
       이번 달의 움직임과 전체 수익률은 전혀 다른 이야기다. */
    그리기();
    // 1,000,000 → 1,200,000 = +20%
    await waitFor(() => expect(screen.getByTestId("기간수익")).toHaveTextContent("+20.00%"));
  });

  it("기간을 바꾸면 그 기간으로 다시 물어본다", async () => {
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "1개월" }));
    await waitFor(() => expect(portfolioApi.getHistory).toHaveBeenCalledWith(30, undefined));

    await userEvent.click(screen.getByRole("button", { name: "1년" }));
    await waitFor(() => expect(portfolioApi.getHistory).toHaveBeenCalledWith(365, undefined));
  });

  it("처음에는 3개월을 본다", async () => {
    그리기();
    await waitFor(() => expect(portfolioApi.getHistory).toHaveBeenCalledWith(90, undefined));
  });

  it("'올해' 는 1월 1일부터 오늘까지로 물어본다", async () => {
    /* 예전에는 일수(30·90·365)가 곧 상태였다. 그 방식으로는 올해를 넣을
       수가 없었다 — 올해가 238일이면 '1년'(365)과 구분이 안 돼서
       지수만 1년치로 그려지고, 화면의 두 선이 서로 다른 기간이 된다. */
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "올해" }));
    await waitFor(() => expect(portfolioApi.getHistory).toHaveBeenCalledWith(올해일수(), undefined));
    // 고정값 셋 중 어느 것도 아니어야 한다(1월 초·연말 빼고)
    expect([30, 90, 365, 3650]).not.toContain(올해일수(new Date(2026, 7, 26)));
  });

  it("'전체' 는 서버 상한(3650일) 안에서 제일 길게 물어본다", async () => {
    /* 상한이 365 였다. 366 이상은 라우트 본문에 닿기도 전에 422 로
       거절돼서, 사용자에게는 '눌렀는데 아무 일도 안 일어남' 으로 보인다.
       서버 쪽 Query(le=...) 도 같이 풀어 뒀다. */
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "전체" }));
    await waitFor(() => expect(portfolioApi.getHistory).toHaveBeenCalledWith(3650, undefined));
  });
});

describe("올해일수", () => {
  it("1월 1일부터 센다", () => {
    expect(올해일수(new Date(2026, 0, 31))).toBe(30);
    expect(올해일수(new Date(2026, 1, 1))).toBe(31);
  });

  it("연초에도 7 밑으로 안 내려간다", () => {
    /* 서버가 days 를 ge=7 로 받는다. 1월 3일에 '올해' 를 누르면 2가 되어
       422 가 나고, 화면에는 아무 일도 안 일어난 것처럼 보인다. */
    expect(올해일수(new Date(2026, 0, 1))).toBe(7);
    expect(올해일수(new Date(2026, 0, 3))).toBe(7);
    expect(올해일수(new Date(2026, 0, 9))).toBe(8);
  });
});

describe("지수 기간을 기간마다 따로 적는다", () => {
  /* 예전에는 일수에서 되짚었다 — 일수<=30 이면 1mo, <=90 이면 3mo,
     나머지는 전부 1y. '올해'(238일)와 '전체'(3650일)가 둘 다 1y 로
     눌려서, 자산 선은 3년치인데 지수 선만 1년치가 되는 화면이 나온다. */
  it("올해는 ytd, 전체는 max 로 받는다", () => {
    const 표 = Object.fromEntries(기간들.map((g) => [g.id, g.지수]));
    expect(표).toEqual({
      "1개월": "1mo", "3개월": "3mo", "1년": "1y", "올해": "ytd", "전체": "max",
    });
  });

  it("고른 기간에 맞는 지수 기간으로 물어본다", async () => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000), 점("2026-08-24", 1_200_000)], days: 90,
    });
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    await waitFor(() => expect(dashboardApi.getIndexOHLCV)
      .toHaveBeenCalledWith("KOSPI", "3mo", "1d"));

    await userEvent.click(screen.getByRole("button", { name: "전체" }));
    await waitFor(() => expect(dashboardApi.getIndexOHLCV)
      .toHaveBeenCalledWith("KOSPI", "max", "1d"));
  });
});


describe("자산 화면에 붙어 있다", () => {
  it("'추이' 탭에서, 로그인하고 보유 종목이 있을 때만 그린다", async () => {
    /* 두 가지를 함께 못 박는다.

       1) 미리보기(로그인 전)에는 기록이 아예 없어서 늘 "아직 없어요" 만
          보인다 — 빈 상자를 하나 더 놓는 셈이다.
       2) 이제 '추이' 탭 안에 있다. 예전에는 요약 바로 아래에 늘 그려져
          있었고, 그래서 보유 종목을 보러 온 사람도 이 그래프의
          /portfolio/history 왕복을 먼저 기다려야 했다. 탭 뒤로 옮기면
          안 연 사람에게는 그 요청이 아예 안 나간다 — 0.15 CPU 서버다.

       (1) 은 '아예 안 그린다' 에서 '예시로 그린다' 로 바뀌었다. 로그인
       전에 이 그래프를 통째로 감췄더니, 이 앱이 무엇을 할 수 있는지가
       가입 전에는 안 보였다. 예시는 서버를 안 부른다 — 미리보기가
       0.15 CPU 서버에 요청을 늘리면 정작 쓰는 사람이 느려진다.

       이 조건이 조용히 풀리면(예: 탭 밖으로 나오면) 첫 화면이 도로
       느려지는데 화면만 봐서는 티가 안 난다. 그래서 원문으로 잡는다. */
    const fs = await import("fs");
    const path = await import("path");
    const 글 = fs.readFileSync(
      path.resolve(__dirname, "../../../pages/Portfolio.tsx"), "utf-8");
    expect(글).toContain('속탭 === "추이" && (isLoggedIn ? items.length > 0 : previewLoaded) && (');
    // 탭 밖에 또 한 벌 그리면 위 이득이 사라진다
    expect(글.match(/<AssetHistory\b/g) ?? []).toHaveLength(1);
  });
});

describe("견주기 — 모든 선을 같은 자로", () => {
  const 점 = (day: string, value: number, cost = 900_000) =>
    ({ day, value, cost, filled: 1, priced: 1 });
  const 지수 = (id: string, ...봉들: ReturnType<typeof 봉>[]) => ({ id, 봉들 });

  it("비교를 안 켜도 % 로 낸다", () => {
    /* 예전에는 비교를 켰을 때만 % 였다. 끄면 금액 축으로 돌아가서
       그래프 생김새가 아예 달랐다 — 켜고 끌 때마다 눈이 처음부터
       다시 읽어야 했다 */
    const 결과 = 견주기([점("2026-08-01", 1_000_000), 점("2026-08-02", 1_100_000)]);
    expect(결과.점들[0].내수익).toBeCloseTo(0);
    expect(결과.점들[1].내수익).toBeCloseTo(10);
    expect(결과.기준칸).toBe(0);
    expect(결과.쓴지수).toEqual([]);
  });

  it("원금도 같은 자로 잰다", () => {
    /* 돈을 더 넣으면 원금 선이 같이 올라간다. 그래야 오른 이유가
       '벌어서' 인지 '넣어서' 인지 눈으로 갈린다 */
    const 결과 = 견주기([
      점("2026-08-01", 1_000_000, 1_000_000),
      점("2026-08-02", 1_500_000, 1_400_000),   // 40만원을 더 넣었다
    ]);
    expect(결과.점들[0].원금수익).toBeCloseTo(0);
    expect(결과.점들[1].원금수익).toBeCloseTo(40);
    expect(결과.점들[1].내수익).toBeCloseTo(50);
  });

  it("원금이 0이면 원금 선을 안 그린다", () => {
    /* 나눌 수가 없다. 0으로 나눠 Infinity 를 그리면 그래프가 통째로
       찌그러진다 */
    const 결과 = 견주기([점("2026-08-01", 1_000_000, 0), 점("2026-08-02", 1_100_000, 0)]);
    expect(결과.점들[0].원금수익).toBeNull();
    expect(결과.점들[1].원금수익).toBeNull();
  });

  it("지수도 같은 첫날 대비 % 로 바꾼다", () => {
    const 결과 = 견주기(
      [점("2026-08-01", 1_000_000), 점("2026-08-02", 1_100_000)],
      [지수("KOSPI", 봉("2026-08-01", 2500), 봉("2026-08-02", 2600))],
    );
    expect(결과.점들[0].지수_KOSPI).toBeCloseTo(0);
    expect(결과.점들[1].지수_KOSPI).toBeCloseTo(4);
    expect(결과.점들[1].내수익).toBeCloseTo(10);
  });

  it("여러 지수를 한꺼번에 올린다", () => {
    /* 코스피와 나스닥을 같이 놓고 봐야 '국내가 빠진 달인가, 내가
       못한 건가' 가 갈린다 */
    const 결과 = 견주기(
      [점("2026-08-01", 1_000_000), 점("2026-08-02", 1_100_000)],
      [지수("KOSPI",  봉("2026-08-01", 2500), 봉("2026-08-02", 2600)),
       지수("NASDAQ", 봉("2026-08-01", 100),  봉("2026-08-02", 95))],
    );
    expect(결과.점들[1].지수_KOSPI).toBeCloseTo(4);
    expect(결과.점들[1].지수_NASDAQ).toBeCloseTo(-5);
    expect(결과.쓴지수).toEqual(["KOSPI", "NASDAQ"]);
  });

  it("지수마다 칸이 따로다 — 값이 섞이지 않는다", () => {
    const 결과 = 견주기(
      [점("2026-08-01", 1_000_000), 점("2026-08-02", 1_000_000)],
      [지수("KOSPI",  봉("2026-08-01", 100), 봉("2026-08-02", 110)),
       지수("KOSDAQ", 봉("2026-08-01", 100), 봉("2026-08-02", 120))],
    );
    expect(결과.점들[1].지수_KOSPI).toBeCloseTo(10);
    expect(결과.점들[1].지수_KOSDAQ).toBeCloseTo(20);
  });

  it("장이 안 선 날은 직전 종가를 쓴다", () => {
    /* 지수는 평일만 있고 내 기록은 주말에도 있다. 날짜가 안 맞는다고
       그날을 비우면 선이 끊겨 보인다 */
    const 결과 = 견주기(
      [점("2026-08-01", 1_000_000), 점("2026-08-02", 1_050_000), 점("2026-08-03", 1_100_000)],
      [지수("KOSPI", 봉("2026-08-01", 2500), 봉("2026-08-03", 2600))],   // 8/2 휴장
    );
    /* toBeCloseTo 는 null 을 0 처럼 받아 준다. 휴장일 처리를 지워도
       통과해 버리므로 '값이 있다' 를 먼저 못 박는다 */
    expect(결과.점들[1].지수_KOSPI).not.toBeNull();
    expect(결과.점들[1].지수_KOSPI).toBeCloseTo(0);      // 8/1 종가를 그대로
    expect(결과.점들[2].지수_KOSPI).toBeCloseTo(4);
  });

  it("기록이 지수보다 앞서면 겹치는 날부터 견준다", () => {
    /* 내 기록의 첫날을 기준으로 잡으면, 지수 범위가 그보다 늦게
       시작할 때 비교가 통째로 사라진다 — 사용자에게는 '눌렀는데
       아무 일도 안 일어남' 으로 보인다.

       그리고 겹치기 전 날은 0으로 안 채운다. 0을 넣으면
       '그날 안 움직였다' 는 거짓말이 된다. */
    const 결과 = 견주기(
      [점("2026-08-01", 1_000_000), 점("2026-08-03", 1_000_000), 점("2026-08-05", 1_100_000)],
      [지수("KOSPI", 봉("2026-08-03", 2500), 봉("2026-08-05", 2600))],
    );
    expect(결과.기준칸).toBe(1);
    expect(결과.점들[0].지수_KOSPI).toBeNull();      // 겹치기 전 — 비운다
    expect(결과.점들[1].지수_KOSPI).not.toBeNull();
    expect(결과.점들[1].지수_KOSPI).toBeCloseTo(0);  // 기준일
    expect(결과.점들[2].지수_KOSPI).toBeCloseTo(4);
    // 내 자산도 같은 기준일(8/3)에서 잰다
    expect(결과.점들[1].내수익).toBeCloseTo(0);
    expect(결과.점들[2].내수익).toBeCloseTo(10);
  });

  it("겹치는 날이 없는 지수 **하나만** 뺀다", () => {
    /* 여기가 여럿 켜기의 핵심이다. 하나 때문에 나머지 비교까지
       없던 일이 되면 여럿 켤 수 있게 한 뜻이 없다 */
    const 결과 = 견주기(
      [점("2026-08-01", 1_000_000), 점("2026-08-02", 1_100_000)],
      [지수("KOSPI",  봉("2026-08-01", 2500), 봉("2026-08-02", 2600)),
       지수("NASDAQ", 봉("2026-09-01", 100))],          // 통째로 뒤
    );
    expect(결과.쓴지수).toEqual(["KOSPI"]);
    expect(결과.점들[1].지수_KOSPI).toBeCloseTo(4);
    expect(결과.점들[1].지수_NASDAQ).toBeUndefined();
    // 그리고 KOSPI 기준일이 밀리지 않는다
    expect(결과.기준칸).toBe(0);
  });

  it("아직 안 받아 온 지수는 조용히 건너뛴다", () => {
    const 결과 = 견주기(
      [점("2026-08-01", 1_000_000), 점("2026-08-02", 1_100_000)],
      [{ id: "KOSPI", 봉들: undefined }, { id: "KOSDAQ", 봉들: [] }],
    );
    expect(결과.쓴지수).toEqual([]);
    expect(결과.점들[1].내수익).toBeCloseTo(10);      // 내 선은 그대로 그린다
  });

  it("값이 있는 점이 하나도 없으면 기준칸이 없다", () => {
    const 결과 = 견주기([점("2026-08-01", 0), 점("2026-08-02", 0)]);
    expect(결과.기준칸).toBe(-1);
    expect(결과.점들[0].내수익).toBeUndefined();
  });
});


describe("비교 칩", () => {
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

  it("비교를 안 켜도 % 선을 그린다", async () => {
    /* 여기가 '비교 없음도 비교가 있을 때처럼' 의 핵심이다.
       금액 축(cost/value)으로 돌아가지 않는다 */
    그리기();
    await screen.findByTestId("차트");
    expect(screen.getByTestId("선들")).toHaveTextContent("원금수익,내수익");
  });

  it("지수를 고르면 그때 받는다", async () => {
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    await waitFor(() => expect(dashboardApi.getIndexOHLCV)
      .toHaveBeenCalledWith("KOSPI", "3mo", "1d"));
  });

  it("지수를 켜도 원금 선은 그대로 남는다", async () => {
    /* 예전에는 비교를 켜면 원금이 사라졌다. 그런데 '벌어서 오른 것'
       과 '넣어서 오른 것' 을 가르는 선은 지수를 켠 뒤에도 필요하다 */
    vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([
      봉("2026-08-01", 2500), 봉("2026-08-02", 2600),
    ]);
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    await waitFor(() => expect(screen.getByTestId("선들"))
      .toHaveTextContent("지수_KOSPI,원금수익,내수익"));
  });

  it("둘을 같이 켜면 선이 둘 다 올라온다", async () => {
    vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([
      봉("2026-08-01", 2500), 봉("2026-08-02", 2600),
    ]);
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    await userEvent.click(screen.getByRole("button", { name: "나스닥" }));
    await waitFor(() => expect(screen.getByTestId("선들"))
      .toHaveTextContent("지수_KOSPI,지수_NASDAQ,원금수익,내수익"));
  });

  it("다시 누르면 그 지수만 꺼진다", async () => {
    vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([
      봉("2026-08-01", 2500), 봉("2026-08-02", 2600),
    ]);
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    await userEvent.click(screen.getByRole("button", { name: "나스닥" }));
    await waitFor(() => expect(screen.getByTestId("선들"))
      .toHaveTextContent("지수_KOSPI,지수_NASDAQ"));
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    await waitFor(() => expect(screen.getByTestId("선들"))
      .toHaveTextContent("지수_NASDAQ,원금수익,내수익"));
    expect(screen.getByTestId("선들")).not.toHaveTextContent("지수_KOSPI");
  });

  it("이겼는지 졌는지 지수마다 한 줄씩 적는다", async () => {
    /* 선이 붙어 있으면 눈으로는 어느 쪽이 이겼는지 잘 안 보인다 */
    vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([
      봉("2026-08-01", 2500), 봉("2026-08-02", 2600),
    ]);
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    // 내 자산 +10%, 코스피 +4% → 6%p 앞섬
    expect(await screen.findByText(/앞섬 6.00%p/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "나스닥" }));
    await waitFor(() => expect(screen.getAllByText(/앞섬 6.00%p/)).toHaveLength(2));
  });

  it("'없음' 은 켠 것을 다 끈다", async () => {
    vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([
      봉("2026-08-01", 2500), 봉("2026-08-02", 2600),
    ]);
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    await userEvent.click(screen.getByRole("button", { name: "나스닥" }));
    await waitFor(() => expect(screen.getByTestId("선들")).toHaveTextContent("지수_KOSPI"));
    await userEvent.click(screen.getByRole("button", { name: "없음" }));
    await waitFor(() => expect(screen.getByTestId("선들"))
      .toHaveTextContent("원금수익,내수익"));
    expect(screen.getByTestId("선들")).not.toHaveTextContent("지수_");
  });

  it("'없음' 은 아무것도 안 켰을 때 눌린 상태다", async () => {
    그리기();
    await screen.findByTestId("차트");
    expect(screen.getByRole("button", { name: "없음" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    expect(screen.getByRole("button", { name: "없음" })).toHaveAttribute("aria-pressed", "false");
  });
});


/**
 * 등락 색상 설정(초록/빨강 · 빨강/파랑)을 여기서도 따른다.
 *
 * 이 그래프만 안 따르고 있었다. 선은 늘 파랑(--accent-focus)이었고,
 * 기간 수익 숫자는 늘 초록/빨강이었다. 빨강/파랑을 고른 사람에게는
 * 같은 화면 안에서 보유 목록의 빨강이 '올랐다' 인데 이 그래프의
 * 빨강은 '내렸다' 가 된다 — 색이 뜻을 잃는다.
 *
 * 검사가 색값(#10b981 …)을 직접 적는 이유: 클래스 이름은 SVG stroke 에
 * 못 쓰므로 hooks/usePnlColors 가 색값 자체를 준다. 그 값이 바뀌면
 * 여기가 걸려야 한다 — 팔레트를 조용히 바꾸면 화면이 통째로 달라진다.
 */
describe("등락 색상 설정을 따른다", () => {
  const 오른점들 = [점("2026-08-20", 1_000_000), 점("2026-08-24", 1_200_000)];
  const 내린점들 = [점("2026-08-20", 1_200_000), 점("2026-08-24", 1_000_000)];

  it("초록/빨강 — 오르면 초록 선", async () => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 오른점들, days: 90 });
    그리기();
    await waitFor(() => expect(screen.getByTestId("선색들"))
      .toHaveTextContent("내수익=#10b981"));
    // 칠(gradient)도 같은 색이어야 한다. 선만 바뀌면 아래 면이 딴 색이다
    expect(screen.getByTestId("칠색들").textContent).toBe("#10b981 #10b981");
  });

  it("초록/빨강 — 내리면 빨강 선", async () => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 내린점들, days: 90 });
    그리기();
    await waitFor(() => expect(screen.getByTestId("선색들"))
      .toHaveTextContent("내수익=#ef4444"));
  });

  it("빨강/파랑 — 오르면 빨강 선", async () => {
    /* 여기가 핵심이다. 예전 코드는 어느 설정에서든 파랑을 그렸고,
       빨강/파랑 쓰는 사람에게 파랑은 '내렸다' 는 뜻이다 */
    useSettingsStore.setState({ colorScheme: "red-blue" });
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 오른점들, days: 90 });
    그리기();
    await waitFor(() => expect(screen.getByTestId("선색들"))
      .toHaveTextContent("내수익=#ef4444"));
  });

  it("빨강/파랑 — 내리면 파랑 선", async () => {
    useSettingsStore.setState({ colorScheme: "red-blue" });
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 내린점들, days: 90 });
    그리기();
    await waitFor(() => expect(screen.getByTestId("선색들"))
      .toHaveTextContent("내수익=#3b82f6"));
  });

  it("칠 무늬 id 에 색을 섞는다 — 색이 다른 그래프가 둘이어도 안 섞인다", async () => {
    /* SVG 는 id 를 문서 전체에서 찾는다. id 가 고정이면 먼저 그려진
       쪽 무늬로 둘 다 칠해져서, 오른 그래프가 내림 색으로 칠해진다 */
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 오른점들, days: 90 });
    그리기();
    await waitFor(() => expect(screen.getByTestId("칠들"))
      .toHaveTextContent("내수익=url(#자산흐름칠-10b981)"));
  });

  it("기간 수익 숫자도 같은 색을 쓴다", async () => {
    useSettingsStore.setState({ colorScheme: "red-blue" });
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 오른점들, days: 90 });
    그리기();
    const 숫자 = await screen.findByTestId("기간수익");
    expect(숫자.className).toContain("text-accent-red");
    expect(숫자.className).not.toContain("text-accent-green");
  });

  it("'앞섬/뒤짐' 도 같은 색을 쓴다", async () => {
    useSettingsStore.setState({ colorScheme: "red-blue" });
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 오른점들, days: 90 });
    vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([
      봉("2026-08-01", 2500), 봉("2026-08-02", 2600),
    ]);
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    const 말 = await screen.findByText(/앞섬/);
    expect(말.className).toContain("text-accent-red");
  });

  it("원금 선과 벤치마크 선은 설정과 무관하다", async () => {
    /* 이 둘은 '올랐나 내렸나' 가 아니라 '무슨 선인가' 를 가리키는
       색이다. 등락 색으로 칠하면 세 선이 같은 색이 되어 못 읽는다 */
    useSettingsStore.setState({ colorScheme: "red-blue" });
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 오른점들, days: 90 });
    vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([
      봉("2026-08-01", 2500), 봉("2026-08-02", 2600),
    ]);
    그리기();
    await waitFor(() => expect(screen.getByTestId("선색들"))
      .toHaveTextContent("원금수익=var(--text-dim)"));
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    /* 지수 색은 지수마다 못 박는다 — 켠 순서로 바뀌면 껐다 켤 때마다
       방금 보던 선이 어느 것인지 놓친다 */
    await waitFor(() => expect(screen.getByTestId("선색들"))
      .toHaveTextContent("지수_KOSPI=#8b5cf6"));
  });
});

/**
 * 한눈에 읽히게 —
 *
 * 그래프는 있는데 읽어 낼 수가 없었다. 세로축을 숨겼기 때문에(좁은
 * 화면에서 '1,234,567원' 눈금이 가로폭의 3분의 1을 먹는다) 선이
 * 오르내리는 모양은 보이는데 **얼마나** 오르내렸는지는 안 보였다.
 * 그리고 선이 둘·셋인데 어느 것이 무엇인지 화면에 적혀 있지 않았다 —
 * 점선 회색이 '원금' 이라는 건 툴팁을 띄워 봐야 알 수 있었고,
 * 휴대폰에서 툴팁을 띄우는 것 자체가 번거롭다.
 */
describe("최고최저", () => {
  const 점 = (v: number) => ({ day: "2026-08-20", value: v, cost: 0 });

  it("보고 있는 값에서 최고·최저를 낸다", () => {
    expect(최고최저([점(100), 점(300), 점(200)], "value")).toEqual({ 최고: 300, 최저: 100 });
  });

  it("비교 중에는 수익률에서 낸다", () => {
    const 점들 = [
      { day: "d1", value: 1, cost: 0, 내수익: -3 },
      { day: "d2", value: 2, cost: 0, 내수익: 7 },
    ];
    expect(최고최저(점들, "내수익")).toEqual({ 최고: 7, 최저: -3 });
  });

  it("값이 비어 있는 날은 건너뛴다", () => {
    /* 벤치마크 기준일보다 앞선 날은 수익률이 없다. null 을 0 으로
       세면 '그날 안 움직였다' 는 거짓말이 그래프의 최저선이 된다 */
    const 점들 = [
      { day: "d1", value: 1, cost: 0, 내수익: null },
      { day: "d2", value: 2, cost: 0, 내수익: 5 },
      { day: "d3", value: 3, cost: 0, 내수익: 9 },
    ];
    expect(최고최저(점들, "내수익")).toEqual({ 최고: 9, 최저: 5 });
  });

  it("전부 같은 값이면 안 긋는다", () => {
    /* 두 줄이 겹쳐서 라벨만 뭉친다 */
    expect(최고최저([점(100), 점(100)], "value")).toBeNull();
  });

  it("점이 하나뿐이면 안 긋는다", () => {
    expect(최고최저([점(100)], "value")).toBeNull();
  });
});

describe("퍼센트글", () => {
  it("오른 값에는 부호를 붙인다", () => {
    expect(퍼센트글(3.214)).toBe("+3.21%");
    expect(퍼센트글(0)).toBe("+0.00%");
  });
  it("내린 값은 그대로", () => {
    expect(퍼센트글(-1.5)).toBe("-1.50%");
  });
});

describe("눈금 노릇을 하는 두 줄", () => {
  const 점들 = [
    점("2026-08-20", 1_000_000),
    점("2026-08-21", 1_300_000),
    점("2026-08-24", 1_200_000),
  ];

  it("최고·최저에 줄을 긋는다", async () => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 점들, days: 90 });
    그리기();
    /* 축이 % 다. 100만 → 130만 → 120만 이면 0%·+30%·+20% 이고,
       줄은 최고 30 · 최저 0 에 그어진다 */
    await waitFor(() => expect(screen.getByTestId("기준선"))
      .toHaveTextContent("30 0"));
  });

  it("얼마인지 그래프 아래에 적는다 — 줄만 그으면 여전히 못 읽는다", async () => {
    /* 선 위에 적어 봤더니, 두 줄이 가까울 때 라벨끼리 겹쳐서 둘 다 못
       읽었다. 어디에 붙여도 선이나 오른쪽 끝(지금 값)을 가렸다.
       실제 화면을 찍어 보고 그래프 밖으로 뺐다. */
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 점들, days: 90 });
    그리기();
    expect(await screen.findByText(/최고 \+30\.00% · 최저 \+0\.00%/)).toBeInTheDocument();
  });

  it("전체 금액을 적지 않는다 — 자리가 좁다", async () => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 점들, days: 90 });
    그리기();
    await screen.findByText(/최고/);
    expect(screen.queryByText(/1,300,000/)).toBeNull();
  });

  it("금액 가리기를 켜면 위의 금액을 가린다", async () => {
    /* 최고·최저 줄은 이제 % 라 자산 규모를 말하지 않는다. 대신 그
       위의 기간 금액은 그대로 말해 버린다 — 지하철에서 옆자리가
       보는 것을 막으려고 켠 설정이다 */
    useSettingsStore.setState({ 금액가리기: true });
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 점들, days: 90 });
    그리기();
    const 금액 = await screen.findByTestId("기간금액");
    expect(금액.textContent).not.toMatch(/\d/);
    // 수익률은 가리지 않는다 — 그건 규모를 말하지 않는다
    expect(await screen.findByTestId("기간수익")).toHaveTextContent("+20.00%");
    useSettingsStore.setState({ 금액가리기: false });
  });

  it("비교를 안 켜도 %로 적는다", async () => {
    /* 축이 늘 % 다. 원화로 적으면 축과 이 줄이 다른 말을 한다 */
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 점들, days: 90 });
    그리기();
    await waitFor(() => expect(screen.getByText(/최고 \+?[\d.]+%/)).toBeInTheDocument());
  });

  it("움직임이 없으면 안 긋는다", async () => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000), 점("2026-08-21", 1_000_000)], days: 90,
    });
    그리기();
    await screen.findByTestId("차트");
    expect(screen.getByTestId("기준선")).toHaveTextContent("");
  });
});

describe("어느 선이 무엇인가", () => {
  const 점들 = [점("2026-08-20", 1_000_000), 점("2026-08-24", 1_200_000)];

  it("내 자산과 원금을 적는다", async () => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 점들, days: 90 });
    그리기();
    expect(await screen.findByText("내 자산")).toBeInTheDocument();
    expect(screen.getByText("원금")).toBeInTheDocument();
  });

  it("비교를 켜면 지수가 범례에 더해진다 — 원금은 그대로 남는다", async () => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({ points: 점들, days: 90 });
    vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([
      봉("2026-08-01", 2500), 봉("2026-08-02", 2600),
    ]);
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    /* 범례의 '코스피' 와 칩의 '코스피' 가 둘 다 있다 — 범례 쪽만 센다.
       칩은 button, 범례는 span 이다 */
    await waitFor(() => expect(
      screen.getAllByText("코스피").some((e) => e.tagName !== "BUTTON")).toBe(true));
    expect(screen.getByText("내 자산")).toBeInTheDocument();
    expect(screen.getByText("원금")).toBeInTheDocument();
  });
});

describe("툴팁에 그날 손익", () => {
  it("평가와 원금 말고 그 차이도 넘긴다", async () => {
    /* 두 선 사이의 간격이 곧 번 돈인데, 눈으로 재는 일은 생각보다
       어렵다. 숫자로 같이 적는다 */
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000), 점("2026-08-24", 1_200_000)], days: 90,
    });
    그리기();
    await waitFor(() => expect(screen.getByTestId("선들")).toHaveTextContent("원금수익,내수익,손익"));
  });

  it("손익은 세로 범위를 안 흔든다 — 제 축을 따로 쓴다", async () => {
    /* 이걸 안 하면 손익(수천만 원)이 평가금액과 같은 축에 들어가서,
       정작 보려는 선이 화면 가운데 얇은 띠로 눌린다. 실제로 찍어 보고
       알았다 — 그리지도 않는 선이 그래프를 통째로 찌그러뜨렸다 */
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000), 점("2026-08-24", 1_200_000)], days: 90,
    });
    그리기();
    await waitFor(() => expect(screen.getByTestId("축들")).toHaveTextContent("손익:손익축"));
    // 평가금액과 원금은 기본 축을 그대로 쓴다
    expect(screen.getByTestId("축들").textContent).toContain("내수익:기본");
  });

  it("손익 선은 안 그린다 — 세 번째 선이 생기면 그래프가 안 읽힌다", async () => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000), 점("2026-08-24", 1_200_000)], days: 90,
    });
    그리기();
    await waitFor(() => expect(screen.getByTestId("선색들")).toHaveTextContent("손익=none"));
  });

  it("비교를 켜도 손익은 그대로 넘긴다 — 제 축을 쓰므로 안 흔든다", async () => {
    /* 예전에는 비교 중에 손익을 아예 뺐다. 축이 % 라 원화를 얹으면
       찌그러진다는 이유였는데, 손익은 처음부터 제 축(손익축)을 쓴다.
       빼 두면 정작 비교하며 볼 때 '그날 얼마 벌었나' 가 사라진다 */
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000), 점("2026-08-24", 1_200_000)], days: 90,
    });
    vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([
      봉("2026-08-01", 2500), 봉("2026-08-02", 2600),
    ]);
    그리기();
    await screen.findByTestId("차트");
    await userEvent.click(screen.getByRole("button", { name: "코스피" }));
    await waitFor(() => expect(screen.getByTestId("선들"))
      .toHaveTextContent("지수_KOSPI,원금수익,내수익,손익"));
    expect(screen.getByTestId("축들").textContent).toContain("손익:손익축");
  });
});


/**
 * ── 오늘 점은 화면 위 큰 숫자와 같아야 한다 ──
 *
 * '자산 흐름 수치가 안 맞는다' 의 원인이었다.
 *
 * 화면 총액은 **실시간 시세**(WebSocket + 일괄 조회)로 낸다. 그런데
 * 그래프의 오늘 점은 서버가 **시세 캐시**로 낸 값이다. 장중에는 그 둘이
 * 다르다 — 같은 화면 안에서 같은 것을 두 숫자로 말하는 셈이다.
 *
 * 지난 점은 안 건드린다. 그건 그날의 기록이지 지금 값이 아니다.
 */
describe("오늘 점을 화면 값으로 맞춘다", () => {
  const 오늘 = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  it("서버의 오늘 점을 화면 값으로 덮어쓴다", async () => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000), 점(오늘(), 1_100_000)], days: 90,
    });
    그리기({ 오늘평가: 1_234_000, 오늘원금: 900_000 });
    await waitFor(() => expect(screen.getByTestId("차트")).toBeInTheDocument());
    // 점 수는 그대로 둘이다 — 덮어쓴 것이지 덧붙인 게 아니다
    expect(screen.getByTestId("점수")).toHaveTextContent("2");
    expect(screen.getByTestId("값들").textContent).toContain("1234000");
    expect(screen.getByTestId("값들").textContent).not.toContain("1100000");
  });

  it("서버에 오늘 점이 없으면 덧붙인다", async () => {
    /* 스냅샷은 하루 한 번 찍힌다. 오늘 것이 아직 없을 수 있는데,
       그때도 그래프 오른쪽 끝은 지금 값이어야 한다 */
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000)], days: 90,
    });
    그리기({ 오늘평가: 1_234_000, 오늘원금: 900_000 });
    await waitFor(() => expect(screen.getByTestId("차트")).toBeInTheDocument());
    expect(screen.getByTestId("점수")).toHaveTextContent("2");
    expect(screen.getByTestId("날들").textContent).toContain(오늘());
  });

  it("지난 점은 안 건드린다", async () => {
    /* 그건 그날의 기록이지 지금 값이 아니다 */
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000), 점("2026-08-21", 1_050_000)], days: 90,
    });
    그리기({ 오늘평가: 9_999_999, 오늘원금: 900_000 });
    await waitFor(() => expect(screen.getByTestId("차트")).toBeInTheDocument());
    const 값들 = screen.getByTestId("값들").textContent ?? "";
    expect(값들).toContain("1000000");
    expect(값들).toContain("1050000");
  });

  it("화면 값이 없으면 서버 값을 그대로 쓴다", async () => {
    /* 미리보기(로그인 전)에는 '내 총액' 이 없다 */
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000), 점(오늘(), 1_100_000)], days: 90,
    });
    그리기();
    await waitFor(() => expect(screen.getByTestId("차트")).toBeInTheDocument());
    expect(screen.getByTestId("값들").textContent).toContain("1100000");
  });

  it("0원이면 안 덮어쓴다", async () => {
    /* 아직 시세가 하나도 안 온 순간에 0 이 온다. 그걸 그리면
       '오늘 자산이 0 이 됐다' 는 거짓말이 된다 */
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000), 점(오늘(), 1_100_000)], days: 90,
    });
    그리기({ 오늘평가: 0, 오늘원금: 0 });
    await waitFor(() => expect(screen.getByTestId("차트")).toBeInTheDocument());
    expect(screen.getByTestId("값들").textContent).toContain("1100000");
  });
});
