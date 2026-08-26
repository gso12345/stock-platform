/**
 * 유저 상세의 숫자를 누르면 실제 내용이 나온다.
 *
 * 예전에는 "게시글 12 · 댓글 30 · 신고 보냄 3" 처럼 숫자만 있었다. 관리자가
 * 이 화면을 여는 이유는 대개 "이 사람이 무슨 글을 썼길래" 인데, 숫자만으로는
 * 다음에 무엇을 할지 정할 수 없었다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { 관리자원문 } from "./관리자원문";

const get = vi.fn();
vi.mock("@/api/client", () => ({ default: { get: (...a: any[]) => get(...a) } }));

import UserItemsPanel from "../admin/UserItemsPanel";

const 코드 = 관리자원문().replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const 감싸기 = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};
const 응답 = (items: any[], total = items.length) =>
  get.mockResolvedValue({ data: { items, total } });

beforeEach(() => get.mockReset());

describe("숫자를 누르면 펼쳐진다", () => {
  it("다섯 가지 모두 펼칠 수 있다", () => {
    for (const k of ["posts", "comments", "reports", "followers", "following"]) {
      expect(코드, `${k} 를 못 펼친다`).toContain(`kind: "${k}"`);
    }
    expect(코드).toMatch(/set펼친것\(열림 \? null : kind\)/);
  });

  it("0건이면 누르지 못한다", () => {
    /* 펼쳐 봐야 빈 목록이라 헛클릭이 된다 */
    expect(코드).toMatch(/const 빔 = !value;/);
    expect(코드).toMatch(/disabled=\{빔\}/);
  });

  it("한 번에 하나만 연다", () => {
    // 모달 안이라 자리가 좁다
    expect(코드).toMatch(/const \[펼친것, set펼친것\] = useState<항목종류 \| null>/);
  });

  it("펼친 상태를 읽어주는 기능에도 알린다", () => {
    expect(코드).toMatch(/aria-expanded=\{열림\}/);
  });
});

describe("게시글·댓글", () => {
  it("본문과 종목을 보여 준다", async () => {
    응답([{ id: 1, symbol: "005930", text: "삼성전자 어떻게 보세요?",
            likes: 3, comments: 2, created_at: "2026-08-01T00:00:00Z" }]);
    감싸기(<UserItemsPanel userId={7} kind="posts" />);
    expect(await screen.findByText("삼성전자 어떻게 보세요?")).toBeInTheDocument();
    expect(screen.getByText("005930")).toBeInTheDocument();
  });

  it("지워진 것도 보여 주되 상태를 표시한다", async () => {
    /* 관리자에게는 지워진 쪽이 오히려 봐야 할 대상이다 */
    응답([{ id: 1, text: "문제의 글", deleted: true, likes: 0, comments: 0 }]);
    감싸기(<UserItemsPanel userId={7} kind="posts" />);
    expect(await screen.findByText("문제의 글")).toBeInTheDocument();
    expect(screen.getByText("삭제됨")).toBeInTheDocument();
  });

  it("가려진 것도 구분해 준다", async () => {
    응답([{ id: 2, text: "가려진 글", blinded: true, likes: 0, comments: 0 }]);
    감싸기(<UserItemsPanel userId={7} kind="posts" />);
    expect(await screen.findByText("가려짐")).toBeInTheDocument();
  });

  it("내용이 비어도 자리를 지킨다", async () => {
    응답([{ id: 3, text: "", likes: 0, comments: 0 }]);
    감싸기(<UserItemsPanel userId={7} kind="posts" />);
    expect(await screen.findByText("(내용 없음)")).toBeInTheDocument();
  });
});

describe("신고 보냄", () => {
  it("사유와 처리 상태를 보여 준다", async () => {
    응답([{ id: 5, post_id: 42, text: "욕설", status: "pending" }]);
    감싸기(<UserItemsPanel userId={7} kind="reports" />);
    expect(await screen.findByText("욕설")).toBeInTheDocument();
    expect(screen.getByText("대기")).toBeInTheDocument();
    expect(screen.getByText("글 #42")).toBeInTheDocument();
  });

  it("처리된 신고는 다르게 보인다", async () => {
    응답([{ id: 6, comment_id: 9, text: "스팸", status: "resolved" }]);
    감싸기(<UserItemsPanel userId={7} kind="reports" />);
    expect(await screen.findByText("처리됨")).toBeInTheDocument();
    expect(screen.getByText("댓글 #9")).toBeInTheDocument();
  });
});

describe("팔로워·팔로잉", () => {
  it("사람 이름을 보여 준다", async () => {
    응답([{ id: 2, username: "hong", is_active: true }]);
    감싸기(<UserItemsPanel userId={7} kind="followers" />);
    expect(await screen.findByText("hong")).toBeInTheDocument();
  });

  it("정지된 사람을 표시한다", async () => {
    응답([{ id: 3, username: "spam99", is_active: false }]);
    감싸기(<UserItemsPanel userId={7} kind="following" />);
    expect(await screen.findByText("정지")).toBeInTheDocument();
  });

  it("탈퇴한 사람도 자리를 지킨다", async () => {
    /* 팔로우 기록은 남는데 사람이 없으면 빈 줄이 된다 */
    응답([{ id: 4, username: "(탈퇴 4)", is_active: null }]);
    감싸기(<UserItemsPanel userId={7} kind="followers" />);
    expect(await screen.findByText("(탈퇴 4)")).toBeInTheDocument();
  });
});

describe("가장자리", () => {
  it("올바른 주소와 종류로 부른다", async () => {
    응답([]);
    감싸기(<UserItemsPanel userId={7} kind="comments" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith("/admin/users/7/items",
      { params: { kind: "comments", limit: 30 } });
  });

  it("비었으면 그렇다고 말한다", async () => {
    응답([]);
    감싸기(<UserItemsPanel userId={7} kind="comments" />);
    expect(await screen.findByText("댓글이 없습니다")).toBeInTheDocument();
  });

  it("전체보다 적게 보여 줄 때 알려 준다", async () => {
    응답([{ id: 1, text: "글", likes: 0, comments: 0 }], 120);
    감싸기(<UserItemsPanel userId={7} kind="posts" />);
    expect(await screen.findByText(/최근 1건 \/ 전체 120건/)).toBeInTheDocument();
  });
});
