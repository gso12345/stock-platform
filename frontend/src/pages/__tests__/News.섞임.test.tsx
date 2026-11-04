/**
 * 국내·미국을 오가면 뉴스가 섞이던 것 — 사용자: "국내 미국 왔다갔다하면 뉴스 섞이는 오류 고쳐줘"
 * (미국 증시 뉴스 맨 위에 국내 기사 둘이 두 번씩 붙어 있던 사진).
 *
 * 원인 — 서버가 준 목록에 **같은 기사가 두 번**(같은 주소) 있었다. 화면은 기사 주소를 이름표(key)로 썼는데,
 * 이름표가 겹치면 React 는 목록을 바꿀 때 겹친 것 중 하나를 못 지우고 화면에 남긴다. 국내 → 미국으로 바꿀
 * 때마다 그 찌꺼기가 하나씩 남아, 오갈수록 미국 목록 위에 국내 기사가 쌓였다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const 기사 = (title: string, link: string, source = "언론사") => ({
  title, link, source, image: `https://img.example.com/${encodeURIComponent(title)}.jpg`, published: "11/04 09:00",
});

/* 국내 목록에 같은 기사가 두 번씩 — 인기순 맨 위의 두 기사(사진 그대로) */
const 국내 = [
  기사("홍콩 ELS 제재", "https://kr.example.com/1", "이투데이"),
  기사("홍콩 ELS 제재", "https://kr.example.com/1", "이투데이"),
  기사("코스피 급락에도 식품주", "https://kr.example.com/2", "이투데이"),
  기사("코스피 급락에도 식품주", "https://kr.example.com/2", "이투데이"),
  기사("국내 셋째 기사", "https://kr.example.com/3"),
  /* 통신사 기사를 두 곳이 받아 쓴 것 — 제목은 같아도 출처가 다른 기사다 */
  기사("금리 동결", "https://kr.example.com/4", "연합뉴스"),
  기사("금리 동결", "https://kr.example.com/5", "뉴시스"),
  /* 주소가 없는 기사 둘 — 주소만 이름표로 쓰면 둘 다 'null' 로 겹친다 */
  { ...기사("주소 없는 기사", ""), link: null },
  { ...기사("주소 없는 다른 기사", ""), link: null },
];
const 미국 = [
  기사("Car subscriptions", "https://us.example.com/1", "Fortune"),
  기사("Fed holds rates", "https://us.example.com/2", "CNBC"),
];
const 국내제목 = ["홍콩 ELS 제재", "코스피 급락에도 식품주", "국내 셋째 기사", "금리 동결", "주소 없는 기사",
                  "주소 없는 다른 기사"];

vi.mock("@/api/stocks", () => ({
  dashboardApi: {
    getNews: vi.fn((market: string) => Promise.resolve(market === "us" ? 미국 : 국내)),
  },
}));

const News = (await import("../News")).default;

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><News /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const 목록 = () => screen.getByText(/증시 뉴스/).closest("div.overflow-hidden") as HTMLElement;

/** React 가 이름표(key) 때문에 남긴 말 — 겹치거나(같은 기사 두 번) 빈(주소 없는 기사) 이름표 */
let 이름표경고: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  이름표경고 = [];
  vi.spyOn(console, "error").mockImplementation((...말: unknown[]) => {
    const 글 = 말.map(String).join(" ");
    if (/same key|unique "key"/.test(글)) 이름표경고.push(글);
  });
});
/* 모든 시험 끝에 본다 — React 는 같은 경고를 한 번만 내서, 한 시험에서만 보면 앞 시험이 이미 낸 경고를 놓친다 */
afterEach(() => {
  vi.restoreAllMocks();
  expect(이름표경고, `이름표 경고: ${이름표경고.join("\n")}`).toEqual([]);
});

describe("국내·미국을 오가도 기사가 안 섞인다", () => {
  it("미국으로 바꾸면 국내 기사가 하나도 안 남는다 — 몇 번을 오가도", async () => {
    그리기();
    await screen.findAllByText("홍콩 ELS 제재");
    for (let 번 = 1; 번 <= 3; 번++) {
      await userEvent.click(screen.getByRole("tab", { name: "미국" }));
      await screen.findByText("Car subscriptions");
      for (const 제목 of 국내제목) {
        expect(within(목록()).queryByText(제목), `${번}번째 오갔을 때 미국 목록에 국내 기사 '${제목}' 가 남았다`).toBeNull();
      }
      await userEvent.click(screen.getByRole("tab", { name: "국내" }));
      await screen.findAllByText("홍콩 ELS 제재");
      for (const 제목 of ["Car subscriptions", "Fed holds rates"]) {
        expect(within(목록()).queryByText(제목), `${번}번째 오갔을 때 국내 목록에 미국 기사가 남았다`).toBeNull();
      }
    }
  });

  it("같은 기사(같은 주소)는 한 번만 보인다 — 출처가 다르면 제목이 같아도 둘 다", async () => {
    그리기();
    await screen.findAllByText("홍콩 ELS 제재");
    expect(screen.getAllByText("홍콩 ELS 제재")).toHaveLength(1);
    expect(screen.getAllByText("코스피 급락에도 식품주")).toHaveLength(1);
    expect(screen.getAllByText("금리 동결"), "다른 언론사의 같은 제목까지 지웠다").toHaveLength(2);
    // 머리의 개수도 겹친 것을 빼고 센다
    expect(within(목록()).getByText("7")).toBeInTheDocument();
  });


  it("정렬을 바꿔도 앞 목록이 안 남는다", async () => {
    그리기();
    await screen.findAllByText("홍콩 ELS 제재");
    await userEvent.click(screen.getByRole("tab", { name: "미국" }));
    await screen.findByText("Car subscriptions");
    await userEvent.click(screen.getByRole("button", { name: "인기순" }));
    await userEvent.click(screen.getByRole("tab", { name: "국내" }));
    await screen.findAllByText("홍콩 ELS 제재");
    await userEvent.click(screen.getByRole("button", { name: "최신순" }));
    await userEvent.click(screen.getByRole("tab", { name: "미국" }));
    await waitFor(() => expect(screen.getByText("Car subscriptions")).toBeInTheDocument());
    for (const 제목 of 국내제목) expect(within(목록()).queryByText(제목)).toBeNull();
  });
});
