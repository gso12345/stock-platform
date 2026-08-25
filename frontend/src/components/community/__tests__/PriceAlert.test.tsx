/**
 * 가격 알림 — 거는 쪽(종목 상세의 종)과 받는 쪽(알림 목록).
 *
 * 이 기능은 앱에서 처음으로 '사람이 아닌 것이 보내는 알림'이다. 알림 목록은
 * 지금까지 언제나 보낸 사람이 있다고 보고, 동그란 프로필 사진과 "◯◯님이 …"
 * 를 그렸다. 가격 알림에는 보낸 사람이 없어서, 그대로 두면 빈 동그라미와
 * 이름 없는 문장만 남는다.
 *
 * 거는 쪽은 반대로 '너무 많이 걸리는' 것이 문제다. 목표가가 빈칸이거나 0인
 * 채로 걸리면 곧장 울려서 알림함이 뒤덮인다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotificationList, { type NotificationItem } from "@/components/community/NotificationList";
import AlertButton from "@/components/stock/AlertButton";
import { KIND_META, notificationHref } from "@/constants/notifications";
import { alertsApi, communityApi } from "@/api/stocks";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const 진짜 = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...진짜, useNavigate: () => navigate };
});

vi.mock("@/api/stocks", () => ({
  communityApi: { markNotificationRead: vi.fn() },
  alertsApi: {
    getAlerts: vi.fn(),
    createAlert: vi.fn(),
    toggleAlert: vi.fn(),
    deleteAlert: vi.fn(),
  },
}));

const 기본알림 = (덮어쓰기: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 1, kind: "comment", post_id: 10, comment_id: null,
  preview: "댓글 내용", is_read: false, created_at: new Date().toISOString(),
  actor_id: 2, actor_name: "홍길동", actor_color: 0, actor_avatar: null,
  ...덮어쓰기,
});

function 목록그리기(items: NotificationItem[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><NotificationList items={items} /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(communityApi.markNotificationRead).mockResolvedValue({} as never);
});


describe("받는 쪽 — 알림 목록", () => {
  const 가격알림 = 기본알림({
    id: 9, kind: "price_alert", post_id: null, actor_id: null, actor_name: "",
    preview: "삼성전자 80,000원 이상 — 지금 80,500원",
    symbol: "005930", market: "KR",
  });

  it("보낸 사람이 없는 알림은 이름 자리를 비워 두지 않는다", () => {
    목록그리기([가격알림]);
    // 종류 이름("가격 알림")이 이름 자리를 대신한다
    expect(screen.getByText(KIND_META.price_alert.label)).toBeInTheDocument();
    expect(screen.getByText(가격알림.preview!)).toBeInTheDocument();
  });

  it("사람이 보낸 알림은 그대로 이름과 문구를 쓴다", () => {
    목록그리기([기본알림()]);
    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.getByText(KIND_META.comment.text)).toBeInTheDocument();
  });

  it("누르면 그 종목으로 간다", async () => {
    목록그리기([가격알림]);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/stocks/KR/005930"));
  });

  it("종목을 모르면 아무 데도 안 보낸다", () => {
    // 예전 줄(symbol·market 이 없던 시절)이 섞여 있어도 눌렀을 때 터지면 안 된다
    expect(notificationHref({ ...가격알림, symbol: null, market: null })).toBeNull();
  });

  it("가격 알림은 설정 화면의 켜고 끄기 목록에 없다", async () => {
    /* 끄고 켜는 것이 알림마다 따로 있는데(종목 상세의 종), 설정에서 통째로
       끌 수 있으면 어느 쪽이 이기는지 알 수 없다. */
    const { NOTIFICATION_KINDS } = await import("@/constants/notifications");
    expect(NOTIFICATION_KINDS).not.toContain("price_alert");
  });
});


describe("거는 쪽 — 종목 상세의 종", () => {
  const 열기 = async () => {
    await userEvent.click(screen.getByRole("button", { name: /가격 알림/ }));
  };

  function 그리기(props: Partial<React.ComponentProps<typeof AlertButton>> = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AlertButton market="KR" symbol="005930" name="삼성전자" price={79_000}
                       isLoggedIn {...props} />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  beforeEach(() => {
    vi.mocked(alertsApi.getAlerts).mockResolvedValue({ items: [], limit: 30 });
    vi.mocked(alertsApi.createAlert).mockResolvedValue({} as never);
    vi.mocked(alertsApi.toggleAlert).mockResolvedValue({} as never);
    vi.mocked(alertsApi.deleteAlert).mockResolvedValue({} as never);
  });

  it("로그인 안 했으면 조회하지 않고 로그인으로 보낸다", async () => {
    그리기({ isLoggedIn: false });
    await 열기();
    expect(navigate).toHaveBeenCalledWith("/login");
    expect(alertsApi.getAlerts).not.toHaveBeenCalled();
  });

  it("열면 지금 시세가 목표가에 채워진다", async () => {
    그리기();
    await 열기();
    const 칸 = await screen.findByLabelText("목표 가격");
    expect((칸 as HTMLInputElement).value).toBe("79000");
  });

  it("목표가가 비어 있으면 걸 수 없다", async () => {
    /* 빈칸이면 Number("") 는 0 이다. 0 이상이면 무엇이든 곧장 울린다 */
    그리기({ price: null });
    await 열기();
    expect(await screen.findByRole("button", { name: "걸기" })).toBeDisabled();
  });

  it("0 이하는 걸 수 없다", async () => {
    그리기();
    await 열기();
    const 칸 = await screen.findByLabelText("목표 가격");
    await userEvent.clear(칸);
    await userEvent.type(칸, "0");
    expect(screen.getByRole("button", { name: "걸기" })).toBeDisabled();
  });

  it("걸면 종목·방향·목표가를 그대로 보낸다", async () => {
    그리기();
    await 열기();
    const 칸 = await screen.findByLabelText("목표 가격");
    await userEvent.clear(칸);
    await userEvent.type(칸, "80000");
    await userEvent.click(screen.getByRole("button", { name: "걸기" }));
    await waitFor(() => expect(alertsApi.createAlert).toHaveBeenCalledWith({
      symbol: "005930", market: "KR", name: "삼성전자",
      direction: "above", target: 80_000,
    }));
  });

  it("이하로 바꿔서도 걸 수 있다", async () => {
    그리기();
    await 열기();
    await userEvent.click(await screen.findByRole("button", { name: "이 값 이하" }));
    await userEvent.click(screen.getByRole("button", { name: "걸기" }));
    await waitFor(() => expect(alertsApi.createAlert)
      .toHaveBeenCalledWith(expect.objectContaining({ direction: "below" })));
  });

  it("걸어 둔 것이 있으면 종에 개수가 뜬다", async () => {
    vi.mocked(alertsApi.getAlerts).mockResolvedValue({
      items: [
        { id: 1, symbol: "005930", market: "KR", name: "삼성전자", direction: "above",
          target: 80_000, made_at_price: 79_000, is_active: true, fired_at: null, fired_price: null },
        { id: 2, symbol: "005930", market: "KR", name: "삼성전자", direction: "below",
          target: 70_000, made_at_price: 79_000, is_active: false,
          fired_at: new Date().toISOString(), fired_price: 69_900 },
      ],
      limit: 30,
    });
    그리기();
    await 열기();
    expect(await screen.findByText("80,000원 이상")).toBeInTheDocument();
    // 울려서 꺼진 것은 왜 꺼졌는지 말해 준다
    expect(screen.getByText(/울림/)).toBeInTheDocument();
    // 켜진 것만 센다 — 꺼진 것까지 세면 종이 계속 켜져 보인다
    await waitFor(() => expect(screen.getByRole("button", { name: "가격 알림 1개" })).toBeInTheDocument());
  });

  it("걸어 둔 것을 껐다 켰다 하고 지울 수 있다", async () => {
    vi.mocked(alertsApi.getAlerts).mockResolvedValue({
      items: [{ id: 5, symbol: "005930", market: "KR", name: "삼성전자", direction: "above",
                target: 80_000, made_at_price: 79_000, is_active: true, fired_at: null, fired_price: null }],
      limit: 30,
    });
    그리기();
    await 열기();
    const 스위치 = await screen.findByRole("switch", { name: "80,000원 이상 알림" });
    expect(스위치).toBeChecked();
    await userEvent.click(스위치);
    await waitFor(() => expect(alertsApi.toggleAlert).toHaveBeenCalledWith(5));

    await userEvent.click(screen.getByRole("button", { name: "알림 지우기" }));
    await waitFor(() => expect(alertsApi.deleteAlert).toHaveBeenCalledWith(5));
  });

  it("미국 종목은 달러로 보여 준다", async () => {
    vi.mocked(alertsApi.getAlerts).mockResolvedValue({
      items: [{ id: 1, symbol: "NVDA", market: "US", name: "NVIDIA", direction: "above",
                target: 200, made_at_price: 180, is_active: true, fired_at: null, fired_price: null }],
      limit: 30,
    });
    그리기({ market: "US", symbol: "NVDA", name: "NVIDIA", price: 180.5 });
    await 열기();
    expect(await screen.findByText("$200.00 이상")).toBeInTheDocument();
    const 칸 = screen.getByLabelText("목표 가격");
    expect((칸 as HTMLInputElement).value).toBe("180.50");
  });
});
