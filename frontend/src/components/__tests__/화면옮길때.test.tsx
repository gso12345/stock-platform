/**
 * 화면을 옮길 때 — 처음 여는 화면도 머리·탭은 그대로, 코드는 미리.
 *
 * 화면마다 코드를 따로 받는다(lazy). 예전에는
 *   1) 처음 여는 화면의 코드를 받는 동안 바깥 대기 화면(BootScreen)까지
 *      올라가, 머리·하단 탭까지 통째로 사라졌다가 다시 나타났다.
 *   2) 코드는 '옮긴 다음' 에야 받기 시작해, 그 왕복이 끝나야 데이터를
 *      묻기 시작했다.
 * 여기서 못 박는 것 —
 *   · 화면 코드를 받는 동안 메뉴는 남아 있고, 내용 자리만 기다린다
 *   · 메뉴에 손을 대면(올리기·닿기·초점) 그 화면 코드를 미리 받는다
 *   · 한가해지면 하단 탭 화면들을 미리 받는다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { lazy } from "react";

const 받음 = vi.hoisted(() => new Set<string>());

vi.mock("@/components/SearchBar", () => ({ default: () => null }));
vi.mock("@/components/LoadingProgressOverlay", () => ({ default: () => null }));
vi.mock("@/components/community/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/InstallAppButton", () => ({ default: () => null }));
vi.mock("@/components/SettingsModal", () => ({ default: () => null }));
vi.mock("@/api/client", async (원본) => ({
  ...(await 원본<any>()),
  default: { get: vi.fn((주소: string) => Promise.resolve({ data: 주소.includes("popups") ? [] : null })) },
}));
vi.mock("@/routes/pages", () => ({
  화면미리받기: (주소: string) => { 받음.add(주소); },
}));
let 한가할때_할일: (() => void) | null = null;
vi.mock("@/utils/한가할때", () => ({
  한가할때: (f: () => void) => { 한가할때_할일 = f; return () => {}; },
  아껴쓰는중: () => false,
}));

import Layout from "../Layout";

const 영영안옴 = lazy(() => new Promise<{ default: () => null }>(() => {}));

function 그리기(주소 = "/portfolio") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[주소]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>대시보드 내용</div>} />
            <Route path="portfolio" element={<영영안옴 />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { 받음.clear(); 한가할때_할일 = null; });

describe("화면 코드를 받는 동안", () => {
  it("메뉴는 남아 있고 내용 자리만 기다린다", async () => {
    그리기("/portfolio");
    expect(await screen.findByLabelText("화면을 불러오는 중")).toBeTruthy();
    // 머리·메뉴가 그대로 있다 — 대시보드 메뉴 글자가 보인다
    expect(screen.getAllByText("대시보드").length).toBeGreaterThan(0);
  });
});

describe("메뉴에 손을 대면 그 화면 코드를 미리 받는다", () => {
  it.each([
    ["올리기", fireEvent.pointerEnter],
    ["닿기", fireEvent.pointerDown],
    ["초점", fireEvent.focus],
  ])("%s", async (_, 일) => {
    그리기("/");
    await screen.findByText("대시보드 내용");
    const 링크 = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "/news")!;
    일(링크);
    expect(받음.has("/news")).toBe(true);
  });
});

describe("한가해지면", () => {
  it("하단 탭 화면들을 미리 받는다", async () => {
    그리기("/");
    await screen.findByText("대시보드 내용");
    await waitFor(() => expect(한가할때_할일).not.toBeNull());
    expect(받음.size).toBe(0);                      // 한가해지기 전에는 안 받는다
    한가할때_할일!();
    expect([...받음].sort()).toEqual(["/", "/feed", "/news", "/portfolio", "/quant"]);
  });
});

describe("대시보드 선제 요청", () => {
  it("대시보드로 들어올 때만 곧바로, 아니면 한가할 때", async () => {
    const 원문 = (await import("../../main.tsx?raw")).default as string;
    expect(원문).toMatch(/if \(window\.location\.pathname === "\/"\) 대시보드_선제요청\(\);\s*else 한가할때\(대시보드_선제요청/);
  });
  it("화면 코드는 미리받기와 같은 함수로 불러온다", async () => {
    const 원문 = (await import("../../main.tsx?raw")).default as string;
    expect(원문).toMatch(/const StockDetail = lazy\(화면들\.StockDetail\);/);
    expect(원문).not.toMatch(/lazy\(\(\) => import\(/);
  });
});
