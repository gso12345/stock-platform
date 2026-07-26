import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

/**
 * 뉴스 기사의 링크·이미지 주소는 외부 RSS 피드에서 그대로 넘어온다.
 * 피드가 변조되면 javascript: 같은 주소가 섞일 수 있고, 그대로 렌더하면
 * 사용자가 기사를 누르는 순간 우리 사이트 권한으로 실행된다.
 * 서버에서 걸러내지만 화면에서도 한 번 더 막는지 확인한다.
 */

const ARTICLES = [
  { title: "정상 기사", link: "https://news.example.com/1", image: "https://img.example.com/1.jpg",
    source: "언론사", published: "07/26 12:00" },
  { title: "위험한 링크", link: "javascript:alert(document.cookie)", image: null,
    source: "언론사", published: "07/26 11:00" },
  { title: "개행 끼워넣기", link: "java\nscript:alert(1)", image: null,
    source: "언론사", published: "07/26 10:00" },
  { title: "위험한 이미지", link: "https://news.example.com/4", image: "javascript:alert(1)",
    source: "언론사", published: "07/26 09:00" },
  { title: "프로토콜 생략", link: "//evil.example.com/x", image: null,
    source: "언론사", published: "07/26 08:00" },
];

vi.mock("@/api/stocks", () => ({
  dashboardApi: { getNews: vi.fn(() => Promise.resolve(ARTICLES)) },
}));

const News = (await import("../News")).default;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><News /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("뉴스 — 외부 주소 처리", () => {
  it("정상 기사는 링크가 그대로 연결된다", async () => {
    renderPage();
    const a = (await screen.findByText("정상 기사")).closest("a")!;
    expect(a).toHaveAttribute("href", "https://news.example.com/1");
  });

  it("javascript: 링크는 href가 붙지 않는다", async () => {
    renderPage();
    const a = (await screen.findByText("위험한 링크")).closest("a")!;
    expect(a).not.toHaveAttribute("href");
  });

  it("개행을 끼워 넣은 우회도 막는다", async () => {
    renderPage();
    const a = (await screen.findByText("개행 끼워넣기")).closest("a")!;
    expect(a).not.toHaveAttribute("href");
  });

  it("프로토콜을 생략한 주소도 막는다", async () => {
    renderPage();
    const a = (await screen.findByText("프로토콜 생략")).closest("a")!;
    expect(a).not.toHaveAttribute("href");
  });

  it("위험한 이미지 주소는 렌더하지 않는다", async () => {
    const { container } = renderPage();
    await screen.findByText("위험한 이미지");
    // alt=""인 장식 이미지는 role로 잡히지 않으므로 직접 조회한다
    container.querySelectorAll("img").forEach((img) => {
      expect(img.getAttribute("src") ?? "").toMatch(/^https?:\/\//);
    });
  });

  it("이미지에 크기와 referrer 차단이 설정된다", async () => {
    const { container } = renderPage();
    await screen.findByText("정상 기사");
    const img = container.querySelector("img")!;
    // 크기가 없으면 이미지가 뜰 때마다 아래 기사가 밀려 내려간다
    expect(img).toHaveAttribute("width", "80");
    expect(img).toHaveAttribute("height", "80");
    // 우리 사이트 주소가 언론사 서버로 새어 나가지 않도록
    expect(img).toHaveAttribute("referrerPolicy", "no-referrer");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("외부 링크는 새 탭에서 열고 참조 관계를 끊는다", async () => {
    renderPage();
    const a = (await screen.findByText("정상 기사")).closest("a")!;
    expect(a).toHaveAttribute("target", "_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(a.getAttribute("rel")).toContain("noreferrer");
  });
});
