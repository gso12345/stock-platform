/**
 * 신고 관리 — 처리한 것(블라인드·삭제·기각)을 '처리 취소' 로 되돌린다.
 * 예전에는 블라인드 복구만 있었고, 삭제·기각은 되돌릴 길이 없었다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

let 목록: any[] = [];
const 취소한것: number[] = [];
let 취소결과: any = { undone: ["글 #1 블라인드 해제"], kept: [] };
vi.mock("@/components/admin/adminApi", () => ({
  adminApi: {
    getReports: () => Promise.resolve({ total: 목록.length, items: 목록 }),
    reopenReport: (id: number) => { 취소한것.push(id); return Promise.resolve(취소결과); },
    blindReport: vi.fn(), dismissReport: vi.fn(), deleteReportContent: vi.fn(), unblindReport: vi.fn(),
  },
}));

import { ReportsTab } from "../admin/ReportsTab";

const 신고 = (x: any) => ({
  id: 1, reporter: "a", reason: "광고", post_id: 10, post_title: "제목", status: "resolved",
  action: "blind", created_at: "2026-09-28", ...x,
});

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ReportsTab qc={qc} /></MemoryRouter></QueryClientProvider>);
}

/** 확인창의 단추 — 목록의 단추와 이름이 같아 마지막 것이 확인창 것이다 */
const 마지막단추 = () => { const 다 = screen.getAllByRole("button", { name: "처리 취소" }); return 다[다.length - 1]; };

beforeEach(() => { 취소한것.length = 0; 취소결과 = { undone: ["글 #1 블라인드 해제"], kept: [] }; });

describe("신고 처리 취소", () => {
  for (const [action, 표시, 설명] of [
    ["blind", "블라인드함", /블라인드를 풀어/],
    ["delete", "삭제함", /삭제한 글을 되살려/],
    ["dismiss", "기각함", /기각을 거두고/],
  ] as const) {
    it(`${표시} 신고에도 처리 취소가 있고, 무엇이 되돌려지는지 먼저 묻는다`, async () => {
      목록 = [신고({ action, status: action === "dismiss" ? "dismissed" : "resolved" })];
      그리기();
      expect(await screen.findByText(표시)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "처리 취소" }));
      expect(await screen.findByText(설명)).toBeTruthy();
      expect(취소한것).toEqual([]);                       // 확인 전에는 안 보낸다
      fireEvent.click(마지막단추());
      await waitFor(() => expect(취소한것).toEqual([1]));
    });
  }

  it("대기 중인 신고에는 처리 취소가 없다", async () => {
    목록 = [신고({ status: "pending", action: null })];
    그리기();
    await screen.findByText("광고");
    expect(screen.queryByRole("button", { name: "처리 취소" })).toBeNull();
  });

  it("다른 신고 때문에 글을 그대로 뒀으면 그렇다고 알려 준다", async () => {
    목록 = [신고({})];
    취소결과 = { undone: [], kept: ["글 #10 (신고 #2 로도 처리됨)"] };
    그리기();
    fireEvent.click(await screen.findByRole("button", { name: "처리 취소" }));
    await screen.findByText(/블라인드를 풀어/);
    fireEvent.click(마지막단추());
    expect(await screen.findByText(/신고 #2 로도 처리됨/)).toBeTruthy();
  });

  it("삭제 확인창이 더는 '되돌릴 수 없다' 고 하지 않는다", async () => {
    목록 = [신고({ status: "pending", action: null })];
    그리기();
    fireEvent.click(await screen.findByRole("button", { name: "콘텐츠 삭제" }));
    expect(await screen.findByText(/처리 취소.*되살릴 수 있어요/)).toBeTruthy();
    expect(screen.queryByText(/되돌릴 수 없습니다/)).toBeNull();
  });
});
