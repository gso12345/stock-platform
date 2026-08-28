/**
 * 알림을 눌렀을 때 — 화면이 **먼저** 바뀌어야 한다.
 *
 * 예전에는 왕복을 둘이나 기다렸다.
 *
 *   눌림 → 서버에 '읽음' 알림(왕복 1) → 목록을 통째로 다시 받기(왕복 2)
 *        → 그제서야 파란 배경이 걷히고 → 그제서야 화면이 넘어감
 *
 * 한 칸이 한국↔싱가포르 왕복이라, 누르고 나서 한참을 아무 일도 안
 * 일어난 것처럼 보인다. 특히 가격 알림("8만원 됐어요")은 급해서 누르는
 * 것이라 그 멈춤이 제일 크게 느껴진다.
 *
 * 커뮤니티 댓글이 이미 이렇게 한다 — 쓰면 목록에 곧바로 얹고 서버는
 * 뒤따라간다. 같은 방식으로 맞췄다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import NotificationList, { 표시하기, 모두읽음, 빼기, 읽은것빼기, type NotificationItem }
  from "@/components/community/NotificationList";
import { communityApi } from "@/api/stocks";

const 이동 = vi.fn();
vi.mock("react-router-dom", async () => {
  const 원래 = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...원래, useNavigate: () => 이동 };
});
vi.mock("@/api/stocks", () => ({
  communityApi: {
    markNotificationRead: vi.fn(() => Promise.resolve({})),
    deleteNotification: vi.fn(() => Promise.resolve({})),
  },
}));

const 알림 = (o: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 1, kind: "price_alert", post_id: null, comment_id: null,
  preview: "삼성전자가 80,000원을 넘었어요", is_read: false,
  created_at: new Date().toISOString(),
  actor_id: null, actor_name: "", actor_color: 0, actor_avatar: null,
  symbol: "005930", market: "KR", ...o,
});

let qc: QueryClient;
function 그리기(items: NotificationItem[]) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["notiList"], items);
  qc.setQueryData(["notiUnread"], { count: items.filter((n) => !n.is_read).length, capped: false });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><NotificationList items={items} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); 이동.mockClear(); });

/* 줄마다 단추가 둘이다 — 줄 자체(누르면 열림)와 지우기(X).
   getByRole("button") 은 둘 다 잡아서 "여러 개를 찾았다" 로 터진다.
   지우기에는 이름이 있으므로 그것을 빼면 줄 단추만 남는다 */
const 줄단추 = () =>
  screen.getAllByRole("button").filter((b) => b.getAttribute("aria-label") !== "알림 지우기")[0];
const 지우기단추 = (n = 0) => screen.getAllByRole("button", { name: "알림 지우기" })[n];

describe("표시하기 — 목록 두 모양을 다 다룬다", () => {
  /* 종(notiList)은 배열, 전체 화면(notiPage)은 {items:[...]} 다.
     한쪽만 고치면 종에서 읽은 것이 전체 화면에서는 안 읽은 채로 남는다 */
  it("배열 모양", () => {
    const 앞 = [알림({ id: 1 }), 알림({ id: 2 })];
    expect(표시하기(앞, 1, true).map((n) => n.is_read)).toEqual([true, false]);
  });

  it("{items} 모양", () => {
    const 앞 = { items: [알림({ id: 1 }), 알림({ id: 2 })], total: 2 };
    const 뒤 = 표시하기(앞, 2, true);
    expect(뒤.items.map((n) => n.is_read)).toEqual([false, true]);
    expect(뒤.total).toBe(2);       // 다른 칸은 안 건드린다
  });

  it("모르는 모양은 그대로 둔다", () => {
    expect(표시하기(undefined, 1, true)).toBeUndefined();
    expect(표시하기(null, 1, true)).toBeNull();
  });

  it("되돌릴 수도 있다 — 서버가 실패했을 때 쓴다", () => {
    const 앞 = [알림({ id: 1, is_read: true })];
    expect(표시하기(앞, 1, false)[0].is_read).toBe(false);
  });
});

describe("모두읽음", () => {
  it("전부 읽음으로", () => {
    const 앞 = [알림({ id: 1 }), 알림({ id: 2, is_read: true })];
    expect(모두읽음(앞).every((n) => n.is_read)).toBe(true);
  });

  it("{items} 모양도", () => {
    const 앞 = { items: [알림({ id: 1 })] };
    expect(모두읽음(앞).items[0].is_read).toBe(true);
  });

  it("이미 읽은 줄은 그대로 둔다 — 쓸데없이 새 객체를 만들지 않는다", () => {
    const 읽은것 = 알림({ id: 2, is_read: true });
    expect(모두읽음([읽은것])[0]).toBe(읽은것);
  });
});

describe("누르면 화면이 먼저 바뀐다", () => {
  it("서버를 기다리지 않고 읽음으로 표시한다", async () => {
    /* 여기가 요점이다. 예전에는 await 뒤에 invalidate 라 왕복 둘을
       기다렸다 — 그동안 파란 배경이 그대로 남아 안 눌린 것처럼 보였다 */
    let 풀기: (v: unknown) => void = () => {};
    vi.mocked(communityApi.markNotificationRead)
      .mockReturnValue(new Promise((r) => { 풀기 = r; }));

    그리기([알림({ id: 7 })]);
    await userEvent.click(줄단추());

    // 서버가 아직 답하지 않았는데도 캐시는 이미 읽음이다
    expect((qc.getQueryData(["notiList"]) as NotificationItem[])[0].is_read).toBe(true);
    expect((qc.getQueryData(["notiUnread"]) as { count: number }).count).toBe(0);
    풀기({});
  });

  it("서버를 기다리지 않고 화면을 넘긴다", async () => {
    vi.mocked(communityApi.markNotificationRead)
      .mockReturnValue(new Promise(() => {}));      // 영영 안 온다
    그리기([알림({ id: 7 })]);
    await userEvent.click(줄단추());
    expect(이동).toHaveBeenCalled();
  });

  it("실패하면 되돌린다", async () => {
    /* 낙관적으로 고쳐 두고 실패를 안 되돌리면, 화면은 읽음인데
       서버는 안 읽음이다 — 그때부터 둘이 영영 어긋난다 */
    vi.mocked(communityApi.markNotificationRead).mockRejectedValue(new Error("끊김"));
    그리기([알림({ id: 7 })]);
    await userEvent.click(줄단추());
    await waitFor(() => {
      expect((qc.getQueryData(["notiList"]) as NotificationItem[])[0].is_read).toBe(false);
    });
  });

  it("이미 읽은 알림은 서버를 안 부른다", async () => {
    그리기([알림({ id: 7, is_read: true })]);
    await userEvent.click(줄단추());
    expect(communityApi.markNotificationRead).not.toHaveBeenCalled();
    expect(이동).toHaveBeenCalled();      // 이동은 그래도 한다
  });

  it("안 읽은 수가 0 밑으로 안 내려간다", async () => {
    그리기([알림({ id: 7 })]);
    qc.setQueryData(["notiUnread"], { count: 0, capped: false });
    await userEvent.click(줄단추());
    expect((qc.getQueryData(["notiUnread"]) as { count: number }).count).toBe(0);
  });
});

describe("가격 알림도 같은 목록에 온다", () => {
  it("보낸 사람이 없어도 안 깨진다", () => {
    /* 사람이 한 일이 아니라 actor 가 비어 있다. 그대로 그리면 빈
       동그라미와 이름 없는 문장이 남는다 */
    그리기([알림({ actor_id: null, actor_name: "" })]);
    expect(screen.getByText(/삼성전자가 80,000원/)).toBeInTheDocument();
  });

  it("누르면 그 종목으로 간다", async () => {
    그리기([알림({ symbol: "005930", market: "KR" })]);
    await userEvent.click(줄단추());
    expect(이동).toHaveBeenCalledWith(expect.stringContaining("005930"));
  });
});


/**
 * ── 지우기 ──
 *
 * '모두 읽음' 을 눌러도 목록은 그대로 남는다. 며칠 쓰면 다 읽은 알림
 * 수백 줄을 계속 넘겨야 새 것이 나온다 — 읽음 표시는 그 줄이
 * 쓸모없어졌다는 뜻인데 화면이 그걸 안 치웠다.
 *
 * 읽음과 같은 방식으로 만든다. 화면에서 먼저 빼고 서버는 뒤따라간다.
 */
describe("빼기 — 목록 두 모양을 다 다룬다", () => {
  it("배열 모양", () => {
    const 앞 = [알림({ id: 1 }), 알림({ id: 2 })];
    expect(빼기(앞, 1).map((n) => n.id)).toEqual([2]);
  });

  it("{items} 모양은 total 도 같이 줄인다", () => {
    /* 안 줄이면 '3건' 이라 적힌 밑에 두 줄만 남는다 */
    const 앞 = { items: [알림({ id: 1 }), 알림({ id: 2 })], total: 2 };
    const 뒤 = 빼기(앞, 1);
    expect(뒤.items.map((n) => n.id)).toEqual([2]);
    expect(뒤.total).toBe(1);
  });

  it("없는 id 면 total 을 안 건드린다", () => {
    const 앞 = { items: [알림({ id: 1 })], total: 1 };
    expect(빼기(앞, 99).total).toBe(1);
  });

  it("모르는 모양은 그대로 둔다", () => {
    expect(빼기(undefined, 1)).toBeUndefined();
    expect(빼기(null, 1)).toBeNull();
  });
});

describe("읽은것빼기", () => {
  it("읽은 줄만 뺀다 — 안 읽은 것은 남긴다", () => {
    /* 아직 못 본 것까지 쓸어 버리면 되돌릴 방법이 없다 */
    const 앞 = [알림({ id: 1, is_read: true }), 알림({ id: 2, is_read: false })];
    expect(읽은것빼기(앞).map((n) => n.id)).toEqual([2]);
  });

  it("{items} 모양도 total 을 맞춘다", () => {
    const 앞 = { items: [알림({ id: 1, is_read: true }), 알림({ id: 2 })], total: 2 };
    const 뒤 = 읽은것빼기(앞);
    expect(뒤.items.map((n) => n.id)).toEqual([2]);
    expect(뒤.total).toBe(1);
  });
});

describe("지우기를 누르면 화면이 먼저 바뀐다", () => {
  it("서버를 기다리지 않고 목록에서 뺀다", async () => {
    let 풀기: (v: unknown) => void = () => {};
    vi.mocked(communityApi.deleteNotification)
      .mockReturnValue(new Promise((r) => { 풀기 = r; }));

    그리기([알림({ id: 7 }), 알림({ id: 8 })]);
    await userEvent.click(지우기단추(0));

    expect((qc.getQueryData(["notiList"]) as NotificationItem[]).map((n) => n.id)).toEqual([8]);
    풀기({});
  });

  it("안 읽은 줄을 지우면 종의 숫자도 줄어든다", async () => {
    /* 안 줄이면 '1' 이 떠 있는데 눌러 보면 아무것도 없는 상태가 된다 */
    vi.mocked(communityApi.deleteNotification).mockReturnValue(new Promise(() => {}));
    그리기([알림({ id: 7, is_read: false })]);
    await userEvent.click(지우기단추(0));
    expect((qc.getQueryData(["notiUnread"]) as { count: number }).count).toBe(0);
  });

  it("이미 읽은 줄을 지울 때는 종의 숫자를 안 건드린다", async () => {
    vi.mocked(communityApi.deleteNotification).mockReturnValue(new Promise(() => {}));
    그리기([알림({ id: 7, is_read: true }), 알림({ id: 8, is_read: false })]);
    const 앞 = (qc.getQueryData(["notiUnread"]) as { count: number }).count;
    await userEvent.click(지우기단추(0));       // 읽은 줄이 위에 있다
    expect((qc.getQueryData(["notiUnread"]) as { count: number }).count).toBe(앞);
  });

  it("지우기가 줄을 열지 않는다", async () => {
    /* 줄 전체가 버튼이다. 이벤트를 안 막으면 지워 놓고 그 글로 넘어간다 */
    vi.mocked(communityApi.deleteNotification).mockReturnValue(new Promise(() => {}));
    그리기([알림({ id: 7 })]);
    await userEvent.click(지우기단추(0));
    expect(이동).not.toHaveBeenCalled();
    expect(communityApi.markNotificationRead).not.toHaveBeenCalled();
  });

  it("실패하면 되살린다", async () => {
    /* 화면에는 없는데 서버에는 남아 있으면, 새로고침하면 지운 줄이
       되살아난다 — 그때부터 둘이 영영 어긋난다 */
    vi.mocked(communityApi.deleteNotification).mockRejectedValue(new Error("끊김"));
    그리기([알림({ id: 7 })]);
    await userEvent.click(지우기단추(0));
    await waitFor(() => {
      expect((qc.getQueryData(["notiList"]) as NotificationItem[]).map((n) => n.id)).toEqual([7]);
    });
  });
});
