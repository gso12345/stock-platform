/**
 * 내가 건 시세 알림 — 한 자리에 모아서 본다.
 *
 * 지금까지 이걸 볼 수 있는 곳은 **종목 상세의 종 단추 안**뿐이었다.
 * 그래서 "내가 어느 종목에 알림을 걸어 뒀지?" 를 알려면 종목을 하나씩
 * 열어 보는 수밖에 없었다 — 애초에 기억이 안 나서 묻는 질문인데,
 * 답을 보려면 그 종목을 이미 알고 있어야 하는 셈이다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import MyPriceAlerts, { 종목별로, 조건글, 내알림열쇠 } from "@/components/community/MyPriceAlerts";
import { alertsApi, type 가격알림 } from "@/api/stocks";

vi.mock("@/api/stocks", () => ({
  alertsApi: {
    getAlerts: vi.fn(),
    toggleAlert: vi.fn(() => Promise.resolve({})),
    deleteAlert: vi.fn(() => Promise.resolve({})),
  },
}));

const 알림 = (o: Partial<가격알림> = {}): 가격알림 => ({
  id: 1, symbol: "005930", market: "KR", name: "삼성전자",
  direction: "above", target: 80_000, made_at_price: 75_000,
  is_active: true, fired_at: null, fired_price: null, ...o,
});

let qc: QueryClient;
function 그리기(items: 가격알림[], open = true) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(alertsApi.getAlerts).mockResolvedValue({ items, limit: 20 });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><MyPriceAlerts open={open} onToggle={() => {}} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("조건글 — 무엇을 기다리는지 한 줄로", () => {
  it("국내는 원, 해외는 달러", () => {
    expect(조건글(알림({ target: 80_000 }))).toBe("80,000원 위로");
    expect(조건글(알림({ market: "US", symbol: "NVDA", target: 172.5, direction: "below" })))
      .toBe("$172.50 아래로");
  });
});

describe("종목별로 묶는다", () => {
  it("한 종목에 여러 알림을 걸 수 있다", () => {
    const 묶 = 종목별로([
      알림({ id: 1, target: 80_000 }),
      알림({ id: 2, target: 70_000, direction: "below" }),
    ]);
    expect(묶).toHaveLength(1);
    expect(묶[0].알림들).toHaveLength(2);
    // 한 종목 안은 목표가 순 — 위·아래가 뒤섞이면 안 읽힌다
    expect(묶[0].알림들.map((a) => a.target)).toEqual([80_000, 70_000]);
  });

  it("켜진 것이 있는 종목이 위로 온다", () => {
    /* 꺼 둔 알림은 지금 기다리는 것이 아니라 '나중에 다시 켤 것' 이다 */
    const 묶 = 종목별로([
      알림({ id: 1, symbol: "AAA", name: "가나다", is_active: false }),
      알림({ id: 2, symbol: "BBB", name: "하하하", is_active: true }),
    ]);
    expect(묶.map((g) => g.symbol)).toEqual(["BBB", "AAA"]);
  });

  it("켜진 수를 센다", () => {
    const 묶 = 종목별로([
      알림({ id: 1, is_active: true }),
      알림({ id: 2, target: 70_000, is_active: false }),
    ]);
    expect(묶[0].켜진수).toBe(1);
  });

  it("시장이 다르면 다른 종목이다", () => {
    /* 국내 005930 과 해외 005930 은 다른 회사다 */
    const 묶 = 종목별로([알림({ id: 1, market: "KR" }), 알림({ id: 2, market: "US" })]);
    expect(묶).toHaveLength(2);
  });
});

describe("화면", () => {
  it("어느 종목에 걸었는지 보여 준다", async () => {
    그리기([알림({ id: 1, name: "삼성전자" }),
            알림({ id: 2, symbol: "NVDA", market: "US", name: "NVIDIA", target: 200 })]);
    expect(await screen.findByText("삼성전자")).toBeInTheDocument();
    expect(screen.getByText("NVIDIA")).toBeInTheDocument();
    expect(screen.getByText("80,000원 위로")).toBeInTheDocument();
  });

  it("머리글에 몇 종목 몇 개인지 적는다", async () => {
    그리기([알림({ id: 1 }), 알림({ id: 2, target: 70_000 }),
            알림({ id: 3, symbol: "NVDA", market: "US", name: "NVIDIA" })], false);
    expect(await screen.findByText("2개 종목 · 3개")).toBeInTheDocument();
  });

  it("꺼 둔 것이 있으면 따로 센다", async () => {
    /* '3개 걸어 뒀는데 왜 안 와요' 의 답이 대개 '꺼 두셨어요' 다 */
    그리기([알림({ id: 1 }), 알림({ id: 2, target: 70_000, is_active: false })], false);
    expect(await screen.findByText(/1개 켬 \/ 1개 끔/)).toBeInTheDocument();
  });

  it("종목을 누르면 그 종목으로 간다", async () => {
    /* 목표가를 고치는 자리는 거기다 — 지금 시세가 옆에 있다 */
    그리기([알림()]);
    const 링크 = await screen.findByRole("link", { name: /삼성전자/ });
    expect(링크).toHaveAttribute("href", "/stocks/KR/005930");
  });

  it("이미 울린 알림은 그렇다고 적는다", async () => {
    /* 안 적으면 '켜 뒀는데 왜 또 안 와요' 가 된다 */
    그리기([알림({ fired_at: "2026-08-20T09:00:00" })]);
    expect(await screen.findByText("울림")).toBeInTheDocument();
  });

  it("아직 없으면 어디서 거는지 알려 준다", async () => {
    그리기([]);
    expect(await screen.findByText(/종 단추로/)).toBeInTheDocument();
  });
});

describe("누르면 화면이 먼저 바뀐다", () => {
  it("켜고 끄기는 서버를 안 기다린다", async () => {
    vi.mocked(alertsApi.toggleAlert).mockReturnValue(new Promise(() => {}));
    그리기([알림({ id: 1, is_active: true })]);
    const 스위치 = await screen.findByRole("switch");
    await userEvent.click(스위치);
    expect(스위치).toHaveAttribute("aria-checked", "false");
  });

  it("켜고 끄기가 실패하면 되돌린다", async () => {
    /* 되돌리지 않으면 화면은 꺼졌는데 서버는 켜져 있다 — 안 올 줄
       알았던 알림이 오거나, 올 줄 알았던 알림이 안 온다 */
    vi.mocked(alertsApi.toggleAlert).mockRejectedValue(new Error("끊김"));
    그리기([알림({ id: 1, is_active: true })]);
    const 스위치 = await screen.findByRole("switch");
    await userEvent.click(스위치);
    await waitFor(() => expect(스위치).toHaveAttribute("aria-checked", "true"));
  });

  it("지우기도 서버를 안 기다린다", async () => {
    vi.mocked(alertsApi.deleteAlert).mockReset();
    vi.mocked(alertsApi.deleteAlert).mockReturnValue(new Promise(() => {}));
    그리기([알림({ id: 1 }), 알림({ id: 2, target: 70_000 })]);
    await screen.findByText("80,000원 위로");
    await userEvent.click(screen.getAllByRole("button", { name: /지우기$/ })[0]);
    expect(screen.queryByText("80,000원 위로")).not.toBeInTheDocument();
    expect(screen.getByText("70,000원 위로")).toBeInTheDocument();
  });

  it("실패하면 되돌린다", async () => {
    /* 화면에는 지워졌는데 서버에는 남아 있으면, 새로고침하면
       되살아난다 — 그때부터 둘이 영영 어긋난다 */
    vi.mocked(alertsApi.deleteAlert).mockRejectedValue(new Error("끊김"));
    그리기([알림({ id: 1 })]);
    await screen.findByText("80,000원 위로");
    await userEvent.click(screen.getByRole("button", { name: /지우기$/ }));
    await waitFor(() => {
      expect(screen.getByText("80,000원 위로")).toBeInTheDocument();
    });
  });

  it("종목 상세의 종과 **같은 열쇠**를 쓴다", async () => {
    /* 같은 서버 목록(GET /alerts)을 두 화면이 그린다.
       예전에는 여기가 ["alerts","전체"], 종 쪽이 ["price-alerts","all"]
       로 갈려 있었다 — 각자 캐시에 담고 있었다는 뜻이고, 그러면 한쪽
       에서 지운 것이 다른 쪽에는 그대로 남아 화면을 옮기면 되살아난다.

       거기다 '종도 갱신한다' 며 부르던 ["alerts", symbol] 은 어느
       열쇠와도 안 맞아서 아무 일도 안 했다 — 죽은 코드였다.

       열쇠를 하나로 합치면 갱신이 아예 필요 없다. 한 캐시를 고치면
       두 화면이 같이 바뀐다. 그 사실 자체를 못 박는다. */
    const { 알림열쇠 } = await import("@/components/stock/AlertButton");
    expect(내알림열쇠).toEqual(알림열쇠);

    vi.mocked(alertsApi.deleteAlert).mockResolvedValue({});
    그리기([알림({ id: 1, symbol: "005930" })]);
    await screen.findByText("80,000원 위로");
    await userEvent.click(screen.getByRole("button", { name: /지우기$/ }));
    // 종이 보는 바로 그 캐시가 줄어든다
    await waitFor(() => {
      const 담긴것 = qc.getQueryData(알림열쇠) as { items: unknown[] } | undefined;
      expect(담긴것?.items).toHaveLength(0);
    });
  });

  it("접혀 있어도 개수는 받아 온다", async () => {
    /* '3개 걸어 둠' 이 보여야 펼쳐 볼 이유가 생긴다 */
    그리기([알림()], false);
    await waitFor(() => expect(alertsApi.getAlerts).toHaveBeenCalled());
    expect(qc.getQueryData(내알림열쇠)).toBeTruthy();
  });
});
