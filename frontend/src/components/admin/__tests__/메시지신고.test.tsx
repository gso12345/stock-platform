/**
 * 관리자 신고 목록 — 1:1 메시지 신고.
 *
 * 관리자는 신고된 **그 메시지만** 본다(대화의 다른 메시지는 서버가 안 싣는다). 메시지는 지우지 않고 가린다 —
 * 서버가 '콘텐츠 삭제' 를 거절하므로 단추도 없다(메시지의 삭제 표시는 보낸 사람이 지운 것과 같은 칸이라,
 * 처리 취소 때 보낸 사람이 지운 것까지 되살아난다).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/admin/adminApi", () => ({
  adminApi: { getReports: vi.fn(), blindReport: vi.fn(), dismissReport: vi.fn(), deleteReportContent: vi.fn(), reopenReport: vi.fn() },
}));

import { ReportsTab } from "@/components/admin/ReportsTab";
import { adminApi } from "@/components/admin/adminApi";

const api = vi.mocked(adminApi);
const 신고 = (덧: Record<string, unknown>) => ({
  id: 1, reporter_id: 2, reporter: "나", post_id: null, comment_id: null, message_id: null,
  reason: "욕설·혐오 표현", status: "pending", action: null, created_at: "2026-11-06T01:00:00Z", ...덧,
});

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ReportsTab qc={qc} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("메시지 신고", () => {
  it("메시지·보낸 사람을 보이고, 처리는 블라인드·기각만", async () => {
    api.getReports.mockResolvedValue({ total: 2, items: [
      신고({ id: 1, message_id: 31, message_preview: "나쁜 말\n둘째 줄", message_author: "badguy" }),
      신고({ id: 2, post_id: 9, post_title: "글 제목", post_author: "writer" }),
    ] });
    api.blindReport.mockResolvedValue({});
    그리기();
    const 메시지칸 = (await screen.findByText("1:1 메시지 #31")).closest("div.rounded-xl") as HTMLElement;
    expect(within(메시지칸).getByText("· @badguy")).toBeInTheDocument();
    expect(within(메시지칸).getByText(/나쁜 말/)).toBeInTheDocument();
    expect(within(메시지칸).queryByRole("button", { name: "콘텐츠 삭제" })).toBeNull();
    expect(within(메시지칸).getByRole("button", { name: "블라인드" })).toBeInTheDocument();
    expect(within(메시지칸).getByRole("button", { name: "기각" })).toBeInTheDocument();
    // 글 신고는 그대로 셋
    const 글칸 = screen.getByText("게시글 #9").closest("div.rounded-xl") as HTMLElement;
    expect(within(글칸).getByRole("button", { name: "콘텐츠 삭제" })).toBeInTheDocument();

    await userEvent.click(within(메시지칸).getByRole("button", { name: "블라인드" }));
    await waitFor(() => expect(api.blindReport).toHaveBeenCalledWith(1));
  });

  it("가려진 것·보낸 사람이 지운 것은 그렇다고 적는다", async () => {
    api.getReports.mockResolvedValue({ total: 2, items: [
      신고({ id: 1, message_id: 31, message_preview: "a", message_author: "x", message_is_blinded: true, status: "resolved", action: "blind" }),
      신고({ id: 2, message_id: 32, message_preview: "b", message_author: "y", message_is_deleted: true }),
    ] });
    그리기();
    expect(await screen.findByText("블라인드됨")).toBeInTheDocument();
    expect(screen.getByText("보낸 사람이 지움")).toBeInTheDocument();
  });
});
