/**
 * 가격 알림 — 거는 데 걸리는 손이 몇 번인가.
 *
 * 기능은 다 있었는데 쓰기가 느렸다. 세 가지가 겹쳤다 —
 *
 *   1) 종에 붙는 개수 배지가 영영 안 떴다. 목록을 '패널을 열었을 때만'
 *      받아서, 열기 전에는 늘 0 이었다. 그래서 '이 종목에 알림을
 *      걸어 뒀나' 를 알려면 반드시 눌러 봐야 했다.
 *   2) 목표가를 손으로 다 쳐야 했다. 79,300원짜리 종목에 '5% 오르면'
 *      을 걸려면 83,265 를 암산해서 다섯 자리를 친다. 실제로는 그냥
 *      8만원 같은 어림수를 치게 되는데, 그건 원래 걸고 싶던 조건이 아니다.
 *   3) 고칠 수가 없었다. 79,000 을 78,000 으로 낮추려면 지우고 다시
 *      걸어야 했고, 지우기만 하고 잊으면 알림이 통째로 사라진다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AlertButton, { 목표가, 빠른퍼센트, 알림열쇠 } from "@/components/stock/AlertButton";
import { alertsApi, type 가격알림 } from "@/api/stocks";

vi.mock("@/api/stocks", () => ({
  alertsApi: {
    getAlerts: vi.fn(),
    createAlert: vi.fn(),
    toggleAlert: vi.fn(),
    editAlert: vi.fn(),
    deleteAlert: vi.fn(),
  },
}));

const 줄 = (o: Partial<가격알림> = {}): 가격알림 => ({
  id: 1, symbol: "005930", market: "KR", name: "삼성전자",
  direction: "above", target: 79_000, made_at_price: 78_000,
  is_active: true, fired_at: null, fired_price: null, ...o,
} as 가격알림);

let qc: QueryClient;

function 그리기(props: Partial<React.ComponentProps<typeof AlertButton>> = {}) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AlertButton market="KR" symbol="005930" name="삼성전자"
                     price={79_300} isLoggedIn {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(alertsApi.getAlerts).mockResolvedValue({ items: [], limit: 30 });
});

describe("목표가 계산", () => {
  it("원화는 정수로 자른다", () => {
    /* 83,265.15원 짜리 목표가는 뜻이 없다 */
    expect(목표가(79_300, 5, true)).toBe(83_265);
    expect(목표가(79_300, -5, true)).toBe(75_335);
  });

  it("달러는 센트까지", () => {
    expect(목표가(150.4, 10, false)).toBe(165.44);
    expect(목표가(150.4, -3, false)).toBe(145.89);
  });

  it("위아래가 짝을 이룬다 — 한쪽만 있으면 손절 알림을 못 건다", () => {
    const 오름 = 빠른퍼센트.filter((p) => p > 0).map(Math.abs);
    const 내림 = 빠른퍼센트.filter((p) => p < 0).map(Math.abs);
    expect([...오름].sort()).toEqual([...내림].sort());
  });
});

describe("배지 — 열어 보지 않아도 보인다", () => {
  it("걸어 둔 알림이 있으면 개수가 뜬다", async () => {
    /* 예전에는 패널을 열어야만 목록을 받아서, 배지가 영영 0 이었다 */
    vi.mocked(alertsApi.getAlerts).mockResolvedValue({
      items: [줄({ id: 1 }), 줄({ id: 2, target: 90_000 })], limit: 30,
    });
    그리기();
    expect(await screen.findByRole("button", { name: "가격 알림 2개" })).toBeInTheDocument();
  });

  it("꺼 둔 알림은 안 센다", async () => {
    vi.mocked(alertsApi.getAlerts).mockResolvedValue({
      items: [줄({ id: 1, is_active: false })], limit: 30,
    });
    그리기();
    expect(await screen.findByRole("button", { name: "가격 알림" })).toBeInTheDocument();
  });

  it("다른 종목 알림은 안 센다", async () => {
    /* 목록은 통째로 받는다. 고르는 것은 화면에서 한다 */
    vi.mocked(alertsApi.getAlerts).mockResolvedValue({
      items: [줄({ id: 1, symbol: "000660" })], limit: 30,
    });
    그리기();
    expect(await screen.findByRole("button", { name: "가격 알림" })).toBeInTheDocument();
  });

  it("종목별로 따로 안 받는다 — 종목을 옮겨도 요청이 안 는다", async () => {
    그리기();
    await waitFor(() => expect(alertsApi.getAlerts).toHaveBeenCalled());
    expect(alertsApi.getAlerts).toHaveBeenCalledWith();   // symbol 을 안 넘긴다
  });

  it("로그인 안 했으면 아예 안 받는다", () => {
    /* 401 이 계속 나가면 화면 오류 기록만 쌓이고 얻는 것이 없다 */
    그리기({ isLoggedIn: false });
    expect(alertsApi.getAlerts).not.toHaveBeenCalled();
  });
});

describe("빠른 목표 — 한 번 눌러서 건다", () => {
  it("퍼센트 칩이 위아래로 다 있다", async () => {
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    for (const p of 빠른퍼센트) {
      const 이름 = p > 0 ? `+${p}%` : `${p}%`;
      expect(screen.getByRole("button", { name: 이름 })).toBeInTheDocument();
    }
  });

  it("누르면 그 값으로 곧장 건다 — 입력칸을 거치지 않는다", async () => {
    vi.mocked(alertsApi.createAlert).mockResolvedValue(줄({ id: 5, target: 83_265 }));
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    await userEvent.click(screen.getByRole("button", { name: "+5%" }));
    await waitFor(() => expect(alertsApi.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "005930", direction: "above", target: 83_265 }),
    ));
  });

  it("내림 퍼센트는 '이하' 로 건다", async () => {
    /* -10% 를 '이상' 으로 걸면 지금 값에서 이미 조건을 넘긴다 —
       거는 즉시 울린다 */
    vi.mocked(alertsApi.createAlert).mockResolvedValue(줄({ id: 6 }));
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    await userEvent.click(screen.getByRole("button", { name: "-10%" }));
    await waitFor(() => expect(alertsApi.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "below", target: 71_370 }),
    ));
  });

  it("누른 즉시 목록에 뜬다 — 서버를 기다리지 않는다", async () => {
    /* '눌렀는데 반응이 없다' 가 제일 나쁜 지연이다. 사람은 안 눌렸다고
       생각하고 한 번 더 누른다 */
    let 풀기: (v: 가격알림) => void = () => {};
    vi.mocked(alertsApi.createAlert).mockReturnValue(new Promise((r) => { 풀기 = r; }));
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    await userEvent.click(screen.getByRole("button", { name: "+5%" }));
    expect(await screen.findByText(/83,265원 이상/)).toBeInTheDocument();
    풀기(줄({ id: 5, target: 83_265 }));
  });

  it("시세를 모르면 빠른 목표를 안 보여 준다", async () => {
    /* 기준이 없으면 '5%' 가 무엇의 5% 인지 알 수 없다 */
    그리기({ price: null });
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    expect(screen.queryByRole("button", { name: "+5%" })).toBeNull();
  });
});

describe("고치기 — 지우고 다시 걸지 않는다", () => {
  beforeEach(() => {
    vi.mocked(alertsApi.getAlerts).mockResolvedValue({ items: [줄({ id: 1, target: 79_000 })], limit: 30 });
  });

  it("연필을 누르면 그 자리에서 값을 고친다", async () => {
    vi.mocked(alertsApi.editAlert).mockResolvedValue(줄({ id: 1, target: 78_000 }));
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    await userEvent.click(await screen.findByRole("button", { name: "목표가 고치기" }));

    const 칸 = screen.getByRole("spinbutton", { name: "목표 가격 고치기" });
    await userEvent.clear(칸);
    await userEvent.type(칸, "78000");
    await userEvent.click(screen.getByRole("button", { name: "목표가 저장" }));

    await waitFor(() => expect(alertsApi.editAlert).toHaveBeenCalledWith(
      1, { direction: "above", target: 78_000 }));
    // 지우고 다시 걸면 안 된다 — 지우기만 하고 끝나는 사고가 난다
    expect(alertsApi.deleteAlert).not.toHaveBeenCalled();
    expect(alertsApi.createAlert).not.toHaveBeenCalled();
  });

  it("엔터로도 저장된다", async () => {
    vi.mocked(alertsApi.editAlert).mockResolvedValue(줄({ id: 1, target: 77_000 }));
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    await userEvent.click(await screen.findByRole("button", { name: "목표가 고치기" }));
    const 칸 = screen.getByRole("spinbutton", { name: "목표 가격 고치기" });
    await userEvent.clear(칸);
    await userEvent.type(칸, "77000{Enter}");
    await waitFor(() => expect(alertsApi.editAlert).toHaveBeenCalledWith(
      1, { direction: "above", target: 77_000 }));
  });

  it("고치던 값을 물릴 수 있다", async () => {
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    await userEvent.click(await screen.findByRole("button", { name: "목표가 고치기" }));
    await userEvent.click(screen.getByRole("button", { name: "고치기 취소" }));
    expect(screen.queryByRole("spinbutton", { name: "목표 가격 고치기" })).toBeNull();
    expect(alertsApi.editAlert).not.toHaveBeenCalled();
  });

  it("고칠 때 지금 값이 미리 들어 있다", async () => {
    /* 빈칸에서 시작하면 지금 얼마로 걸어 뒀는지 외워서 쳐야 한다 */
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    await userEvent.click(await screen.findByRole("button", { name: "목표가 고치기" }));
    expect(screen.getByRole("spinbutton", { name: "목표 가격 고치기" })).toHaveValue(79_000);
  });

  it("0 이나 빈칸은 저장이 안 눌린다", async () => {
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    await userEvent.click(await screen.findByRole("button", { name: "목표가 고치기" }));
    const 칸 = screen.getByRole("spinbutton", { name: "목표 가격 고치기" });
    await userEvent.clear(칸);
    expect(screen.getByRole("button", { name: "목표가 저장" })).toBeDisabled();
    await userEvent.type(칸, "0");
    expect(screen.getByRole("button", { name: "목표가 저장" })).toBeDisabled();
  });

  it("고치기가 실패하면 원래 값으로 되돌린다", async () => {
    /* 낙관적으로 고쳐 두고 실패를 안 되돌리면, 화면은 78,000 인데
       서버는 79,000 이다 — 그때부터 둘이 영영 어긋난다 */
    vi.mocked(alertsApi.editAlert).mockRejectedValue(new Error("같은 조건의 알림이 이미 있어요"));
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    await userEvent.click(await screen.findByRole("button", { name: "목표가 고치기" }));
    const 칸 = screen.getByRole("spinbutton", { name: "목표 가격 고치기" });
    await userEvent.clear(칸);
    await userEvent.type(칸, "78000{Enter}");
    await waitFor(() => expect(screen.getByText(/79,000원 이상/)).toBeInTheDocument());
  });
});

describe("모두 같은 목록을 본다", () => {
  it("건 뒤에 목록을 다시 안 받는다", async () => {
    /* 서버에 바꿔 달라고 한 뒤 목록을 통째로 다시 받으면 왕복이 둘이다.
       무료 서버는 한 번 다녀오는 데만 수백 ms 가 걸린다 */
    vi.mocked(alertsApi.createAlert).mockResolvedValue(줄({ id: 9, target: 83_265 }));
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    await waitFor(() => expect(alertsApi.getAlerts).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "+5%" }));
    await waitFor(() => expect(alertsApi.createAlert).toHaveBeenCalled());
    expect(alertsApi.getAlerts).toHaveBeenCalledTimes(1);
  });

  it("서버가 준 진짜 줄이 캐시에 들어간다", async () => {
    /* 임시 번호(음수 id)가 남으면 그 줄은 지울 수도 끌 수도 없다 */
    vi.mocked(alertsApi.createAlert).mockResolvedValue(줄({ id: 9, target: 83_265 }));
    그리기();
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
    await userEvent.click(screen.getByRole("button", { name: "+5%" }));
    await waitFor(() => {
      const 담김 = qc.getQueryData<{ items: 가격알림[] }>(알림열쇠);
      expect(담김?.items.every((a) => a.id > 0)).toBe(true);
    });
  });
});
