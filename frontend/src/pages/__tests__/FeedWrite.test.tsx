/**
 * 피드 글쓰기 화면 — "글쓰기 버튼을 따로 만들어주고 버튼을 누르면
 * 글쓰기 화면으로 넘어가게 해줘"
 *
 * 예전에는 피드 목록 맨 위에 접힌 패널이 얹혀 있었다. 그 패널에도 사진과
 * 투표는 있었지만 태그칸은 # 버튼 뒤에 숨어 있어서, 태그를 붙일 수 있다는
 * 사실 자체를 모르는 사람이 많았다.
 *
 * 여기서 못 박는 것 —
 *   1) 피드에서 글쓰기를 누르면 목록 위가 아니라 글쓰기 화면으로 간다
 *   2) 그 화면에 종목검색·제목·내용·태그가 처음부터 다 보인다
 *   3) 사진과 투표도 그대로 쓸 수 있다 (옮기면서 흘리기 쉬운 부분)
 *   4) 태그를 붙이면 실제로 서버로 넘어간다 — 칸만 있고 안 실리면 헛것이다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const 실제 = await vi.importActual<any>("react-router-dom");
  return { ...실제, useNavigate: () => navigate };
});

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = { isLoggedIn: true, user: { id: 1 }, username: "나" };
    return sel ? sel(s) : s;
  },
}));

const createPost = vi.fn(() => Promise.resolve({ id: 1 }));
vi.mock("@/api/stocks", async (원본가져오기) => ({
  ...(await 원본가져오기<any>()),
  communityApi: {
    ...((await 원본가져오기<any>()).communityApi ?? {}),
    getFeed: vi.fn(() => Promise.resolve({ items: [], total: 0, page: 1 })),
    createPost: (...a: any[]) => createPost(...(a as [])),
  },
  portfolioApi: {
    getPortfolios: vi.fn(() => Promise.resolve([])),
    getItems: vi.fn(() => Promise.resolve([])),
  },
  watchlistApi: { getPrices: vi.fn(() => Promise.resolve([])) },
  dashboardApi: { getExchangeRate: vi.fn(() => Promise.resolve({ value: 1300 })) },
}));

/* 종목 검색은 /search 한 곳만 쓴다 */
vi.mock("@/api/client", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({
      data: { results: [{ symbol: "005930", market: "KR", name: "삼성전자" }] },
    })),
  },
  API_BASE: "",
}));

vi.mock("@/hooks/useWebSocket", () => ({ usePricesStream: () => {} }));

import FeedWrite from "../FeedWrite";
import Feed from "../Feed";

function 그리기(무엇: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{무엇}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { navigate.mockReset(); createPost.mockClear(); });

describe("피드에서 글쓰기 화면으로", () => {
  it("글쓰기 버튼이 목록을 펼치지 않고 화면을 넘긴다", async () => {
    /* 예전에는 이 버튼이 그 자리에서 패널을 펼쳤다. 패널이 자라며 아래
       글들을 밀어내는 것이 이 화면을 따로 낸 이유다 */
    const u = userEvent.setup();
    그리기(<Feed />);
    await u.click(await screen.findByRole("button", { name: /글쓰기/ }));
    expect(navigate).toHaveBeenCalledWith("/feed/write");
  });

  it("빈 피드의 '첫 글 쓰기'도 같은 곳으로 보낸다", async () => {
    /* 여기만 맨 위로 올리게 두면, 올라간 자리에 접힌 한 줄이 있을 뿐이라
       한 번 더 눌러야 한다 */
    const u = userEvent.setup();
    그리기(<Feed />);
    await u.click(await screen.findByRole("button", { name: /첫 글 쓰기/ }));
    expect(navigate).toHaveBeenCalledWith("/feed/write");
  });
});

describe("글쓰기 화면이 갖춰야 할 칸", () => {
  it("종목검색·제목·내용·태그가 처음부터 다 보인다", async () => {
    /* 이 중 하나라도 클릭해야 나타나면 있는 줄 모른다 — 태그칸이 정확히
       그래서 안 쓰이고 있었다 */
    그리기(<FeedWrite />);
    expect(screen.getByPlaceholderText(/종목 검색/)).toBeInTheDocument();
    expect(screen.getByLabelText(/제목/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^내용$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/태그/)).toBeInTheDocument();
  });

  it("사진과 투표도 그대로 있다", () => {
    /* 옮기면서 제일 흘리기 쉬운 부분이다 */
    expect.assertions(2);
    그리기(<FeedWrite />);
    expect(screen.getByRole("button", { name: /사진 첨부/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /투표 만들기/ })).toBeInTheDocument();
  });

  it("투표를 켜면 질문과 선택지 칸이 나온다", async () => {
    const u = userEvent.setup();
    그리기(<FeedWrite />);
    await u.click(screen.getByRole("button", { name: /투표 만들기/ }));
    expect(screen.getByPlaceholderText(/투표 질문/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/선택지 1/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/선택지 2/)).toBeInTheDocument();
  });

  it("포트폴리오 공유 탭도 남아 있다", () => {
    그리기(<FeedWrite />);
    expect(screen.getByRole("button", { name: /포트폴리오 공유/ })).toBeInTheDocument();
  });
});

describe("쓴 것이 실제로 넘어간다", () => {
  it("종목을 고르고 본문을 쓰면 등록된다", async () => {
    const u = userEvent.setup();
    그리기(<FeedWrite />);

    await u.type(screen.getByPlaceholderText(/종목 검색/), "삼성");
    await u.click(await screen.findByRole("button", { name: /005930/ }));
    await u.type(screen.getByLabelText(/^내용$/), "괜찮아 보인다");

    await u.click(screen.getByRole("button", { name: /^등록$/ }));
    await waitFor(() => expect(createPost).toHaveBeenCalled());

    const [market, symbol, , body] = createPost.mock.calls[0] as any[];
    expect([market, symbol]).toEqual(["KR", "005930"]);
    expect(body).toBe("괜찮아 보인다");
  });

  it("태그칸에 넣은 종목이 함께 실린다", async () => {
    /* 칸만 만들고 안 실으면 아무 일도 안 한 것이다 */
    const u = userEvent.setup();
    그리기(<FeedWrite />);

    await u.type(screen.getByPlaceholderText(/종목 검색/), "삼성");
    await u.click(await screen.findByRole("button", { name: /005930/ }));
    await u.type(screen.getByLabelText(/^내용$/), "의견");
    await u.click(screen.getByRole("button", { name: /^등록$/ }));

    await waitFor(() => expect(createPost).toHaveBeenCalled());
    const 태그 = (createPost.mock.calls[0] as any[])[6];
    expect(태그).toEqual([{ symbol: "005930", market: "KR", name: "삼성전자" }]);
  });

  it("종목을 안 고르면 등록 버튼이 안 눌린다", async () => {
    /* 종목 없이 보내면 서버가 주소를 못 만든다 */
    const u = userEvent.setup();
    그리기(<FeedWrite />);
    await u.type(screen.getByLabelText(/^내용$/), "종목 없는 글");
    expect(screen.getByRole("button", { name: /^등록$/ })).toBeDisabled();
  });

  it("등록되면 피드로 돌아간다", async () => {
    /* 빈 화면에 그대로 남으면 방금 쓴 글이 올라갔는지 알 수 없다 */
    const u = userEvent.setup();
    그리기(<FeedWrite />);
    await u.type(screen.getByPlaceholderText(/종목 검색/), "삼성");
    await u.click(await screen.findByRole("button", { name: /005930/ }));
    await u.type(screen.getByLabelText(/^내용$/), "의견");
    await u.click(screen.getByRole("button", { name: /^등록$/ }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/feed", { replace: true }));
  });
});

describe("나가기", () => {
  it("빈 화면에서는 그냥 나간다", async () => {
    const u = userEvent.setup();
    const 물음 = vi.fn(() => true);
    vi.stubGlobal("confirm", 물음);
    그리기(<FeedWrite />);
    await u.click(screen.getByRole("button", { name: "뒤로" }));
    expect(물음).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/feed");
    vi.unstubAllGlobals();
  });

  it("쓰던 글이 있으면 물어보고, 아니라고 하면 안 나간다", async () => {
    /* 화면을 따로 낸 대가다 — 뒤로 한 번에 다 날아가면 안 쓰느니만 못하다 */
    const u = userEvent.setup();
    const 물음 = vi.fn(() => false);
    vi.stubGlobal("confirm", 물음);
    그리기(<FeedWrite />);
    await u.type(screen.getByLabelText(/^내용$/), "한참 쓴 글");
    await u.click(screen.getByRole("button", { name: "뒤로" }));
    expect(물음).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalledWith("/feed");
    vi.unstubAllGlobals();
  });
});
