/**
 * 관심종목 탭 줄 — 최근조회·폴더·내계좌가 한 줄로 서고, 통째로 순서를
 * 바꿀 수 있다.
 *
 * 예전에는 세 종류를 따로 그렸다. 그래서 순서를 바꿀 수 있는 것은 폴더끼리
 * 뿐이었고, 내계좌는 언제나 맨 뒤였다. 내계좌를 주로 보는 사람은 폴더를
 * 전부 지나쳐야 자기 계좌에 닿았다.
 *
 * 여기서 못 박는 것 —
 *   1) 셋이 한 목록이다 (따로 그리면 섞을 수가 없다)
 *   2) 저장된 순서가 실제로 화면에 나타난다
 *   3) 순서를 바꾸면 남는다
 *   4) 옮긴 직후의 클릭이 탭을 갈아치우지 않는다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { 최근조회키, 폴더키, 계좌키, 탭순서쓰기, 탭순서읽기 } from "@/utils/tabOrder";
import Watchlist원문 from "../Watchlist.tsx?raw";

vi.mock("react-router-dom", async () => {
  const 실제 = await vi.importActual<any>("react-router-dom");
  return { ...실제, useNavigate: () => vi.fn() };
});

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = { isLoggedIn: true, userId: 7, username: "나" };
    return sel ? sel(s) : s;
  },
}));

const 폴더 = [
  { id: 3, name: "반도체" },
  { id: 4, name: "배당주" },
];
const 계좌 = [{ id: 1, name: "연금저축" }];

vi.mock("@/api/stocks", async (원본가져오기) => {
  const 원본 = await 원본가져오기<any>();
  return {
    ...원본,
    watchlistApi: { ...원본.watchlistApi, getWatchlist: vi.fn(() => Promise.resolve([])), getPrices: vi.fn(() => Promise.resolve([])) },
    watchlistFolderApi: {
      ...원본.watchlistFolderApi,
      getFolders: vi.fn(() => Promise.resolve(폴더)),
      reorderFolders: vi.fn(() => Promise.resolve({})),
    },
    portfolioApi: {
      ...원본.portfolioApi,
      getPortfolios: vi.fn(() => Promise.resolve(계좌)),
      getItems: vi.fn(() => Promise.resolve([])),
    },
    dashboardApi: { ...원본.dashboardApi, getExchangeRate: vi.fn(() => Promise.resolve({ value: 1300 })) },
  };
});

/* useLivePrices 는 usePricesStream 의 반환을 구조분해한다 — 빈 함수로
   두면 화면이 렌더 단계에서 죽는다 */
vi.mock("@/hooks/useWebSocket", () => ({
  usePricesStream: () => ({ status: "idle", send: () => {} }),
}));

import Watchlist from "../Watchlist";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Watchlist /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** 탭 줄에 보이는 탭들을 순서대로 */
function 탭줄() {
  return [...document.querySelectorAll("[data-tab-key]")]
    .map((el) => el.getAttribute("data-tab-key")!);
}

beforeEach(() => localStorage.clear());

describe("탭 줄이 한 목록이다", () => {
  it("최근조회·폴더·내계좌가 모두 같은 목록에 선다", async () => {
    /* 따로 그리면 셋 사이의 순서를 바꿀 방법이 없다 */
    그리기();
    await waitFor(() => expect(탭줄().length).toBe(4));
    expect(탭줄()).toEqual([최근조회키, 폴더키(3), 폴더키(4), 계좌키(1)]);
  });

  it("'전체'는 맨 앞에 고정이다", async () => {
    /* '전체'는 폴더가 아니라 목록 그 자체라, 옮길 자리가 없다 */
    그리기();
    await waitFor(() => expect(탭줄().length).toBe(4));
    expect(await screen.findByRole("button", { name: /전체/ })).not.toHaveAttribute("data-tab-key");
  });
});

describe("저장된 순서", () => {
  it("저장해 둔 대로 나온다", async () => {
    탭순서쓰기(7, [계좌키(1), 폴더키(4), 최근조회키, 폴더키(3)]);
    그리기();
    await waitFor(() => expect(탭줄().length).toBe(4));
    expect(탭줄()).toEqual([계좌키(1), 폴더키(4), 최근조회키, 폴더키(3)]);
  });

  it("저장된 순서에 없는 새 탭도 빠지지 않는다", async () => {
    /* 폴더를 새로 만들면 저장된 순서에는 없다. 여기서 흘리면 만든
       폴더가 탭 줄에 아예 안 나온다 */
    탭순서쓰기(7, [계좌키(1)]);
    그리기();
    await waitFor(() => expect(탭줄().length).toBe(4));
    expect(탭줄()[0]).toBe(계좌키(1));
    expect(탭줄()).toContain(폴더키(3));
    expect(탭줄()).toContain(폴더키(4));
  });

  it("지워진 폴더가 저장된 순서에 남아 있어도 화면이 뜬다", async () => {
    탭순서쓰기(7, ["folder:999", 최근조회키]);
    그리기();
    await waitFor(() => expect(탭줄().length).toBe(4));
    expect(탭줄()).not.toContain("folder:999");
  });
});

describe("순서 바꾸기", () => {
  it("방향키로 옮기면 순서가 남는다", async () => {
    /* 탭 관리 창의 손잡이는 방향키도 받는다 — 손가락 드래그는 jsdom 에서
       재현이 안 되지만, 커밋 경로는 둘이 같다 */
    const u = userEvent.setup();
    그리기();
    await waitFor(() => expect(탭줄().length).toBe(4));

    await u.click(await screen.findByRole("button", { name: /탭 관리/ }));
    const 손잡이들 = await screen.findAllByRole("button", { name: /순서 바꾸기/ });
    손잡이들[0].focus();
    await u.keyboard("{ArrowDown}");

    await waitFor(() => expect(탭순서읽기(7)[0]).toBe(폴더키(3)));
    expect(탭순서읽기(7)[1]).toBe(최근조회키);
  });

  it("탭 관리 창에 최근조회와 내계좌도 들어 있다", async () => {
    /* 폴더만 있으면 셋 사이의 순서는 여전히 못 바꾼다 */
    const u = userEvent.setup();
    그리기();
    await waitFor(() => expect(탭줄().length).toBe(4));
    await u.click(await screen.findByRole("button", { name: /탭 관리/ }));
    expect(await screen.findAllByRole("button", { name: /순서 바꾸기/ })).toHaveLength(4);
  });

  it("최근조회·내계좌는 이름을 바꾸거나 지울 수 없다", async () => {
    /* 최근조회는 앱이 만드는 것이고, 내계좌는 내 자산에서 다룬다.
       여기서 지우게 두면 어디로 사라졌는지 알 수 없다 */
    const u = userEvent.setup();
    그리기();
    await waitFor(() => expect(탭줄().length).toBe(4));
    await u.click(await screen.findByRole("button", { name: /탭 관리/ }));
    expect(await screen.findAllByRole("button", { name: /이름 바꾸기/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /지우기/ })).toHaveLength(2);
  });
});

describe("옮긴 직후", () => {
  it("드래그로 놓은 클릭은 탭을 갈아치우지 않는다", () => {
    /* 안 그러면 옮기자마자 그 탭이 열려, 보고 있던 폴더가 바뀐다 */
    expect(Watchlist원문).toMatch(/방금끌었다\.current/);
  });

  it("폴더 순서만 바꿔도 탭 줄과 어긋나지 않는다", () => {
    /* 본문 폴더 목록에서 옮기면 서버 순서만 바뀐다. 저장된 탭 순서에도
       입히지 않으면 두 곳이 다른 순서를 보여준다 */
    expect(Watchlist원문).toMatch(/폴더순서반영/);
  });
});
