/**
 * 앱 틀(Layout)이 테마를 브라우저에도 알리는가 — 설정을 바꾸면 클래스·색 모드·상태 표시줄 색이 한꺼번에 바뀌고,
 * 기기(시스템) 설정은 '시스템' 을 골랐을 때만 본다(사용자: "시스템설정과 앱설정이 통일이 되지 않아").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/components/layout/SearchBar", () => ({ default: () => null }));
vi.mock("@/components/layout/LoadingProgressOverlay", () => ({ default: () => null }));
vi.mock("@/components/community/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/layout/InstallAppButton", () => ({ default: () => null }));
vi.mock("@/components/account/SettingsModal", () => ({ default: () => null }));
vi.mock("@/api/client", async (원본) => ({
  ...(await 원본<any>()),
  default: { get: vi.fn((주소: string) => Promise.resolve({ data: 주소.includes("popups") ? [] : null })) },
}));
vi.mock("@/routes/pages", () => ({ 화면미리받기: () => {} }));
vi.mock("@/utils/한가할때", () => ({ 한가할때: () => () => {}, 아껴쓰는중: () => true }));

import Layout from "../layout/Layout";
import { useSettingsStore } from "@/store/settingsStore";
import { 상태줄색 } from "@/utils/테마";

/** 기기 설정 흉내 — 라이트인가, 그리고 바뀜을 알릴 수 있게 듣는 쪽을 모아 둔다 */
let 기기라이트 = false;
const 듣는쪽: ((e: { matches: boolean }) => void)[] = [];
function 기기바꾸기(라이트: boolean) {
  기기라이트 = 라이트;
  듣는쪽.forEach((f) => f({ matches: 라이트 }));
}

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>내용</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const 지금 = () => ({
  클래스: [...document.documentElement.classList].filter((c) => c === "light" || c === "dark").sort().join(" "),
  색모드: document.querySelector('meta[name="color-scheme"]')!.getAttribute("content"),
  상태줄: document.querySelector('meta[name="theme-color"]')!.getAttribute("content"),
});
const 다크 = { 클래스: "dark", 색모드: "dark", 상태줄: 상태줄색.dark };
const 라이트 = { 클래스: "light", 색모드: "only light", 상태줄: 상태줄색.light };

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "dark";
  document.head.innerHTML = '<meta name="color-scheme" content="dark"><meta name="theme-color" content="#0f1117">';
  기기라이트 = false;
  듣는쪽.length = 0;
  window.matchMedia = ((q: string) => ({
    matches: q.includes("prefers-color-scheme: light") ? 기기라이트 : false,
    media: q,
    addEventListener: (_: string, f: (e: { matches: boolean }) => void) => { if (q.includes("prefers-color-scheme")) 듣는쪽.push(f); },
    removeEventListener: () => {},
  })) as never;
});

describe("설정을 바꾸면 브라우저에도 알린다", () => {
  it("라이트 ↔ 다크 — 클래스·색 모드·상태 표시줄 색이 함께", async () => {
    useSettingsStore.getState().setTheme("dark");
    그리기();
    expect(지금()).toEqual(다크);
    await act(async () => { useSettingsStore.getState().setTheme("light"); });
    expect(지금()).toEqual(라이트);
    await act(async () => { useSettingsStore.getState().setTheme("dark"); });
    expect(지금()).toEqual(다크);
  });

  it("다크를 골랐으면 기기가 라이트로 바뀌어도 그대로 다크", async () => {
    useSettingsStore.getState().setTheme("dark");
    그리기();
    await act(async () => { 기기바꾸기(true); });
    expect(지금(), "앱 다크인데 기기 설정을 따라갔다").toEqual(다크);
  });

  it("라이트를 골랐으면 기기가 다크여도 그대로 라이트", async () => {
    useSettingsStore.getState().setTheme("light");
    그리기();
    await act(async () => { 기기바꾸기(false); });
    expect(지금()).toEqual(라이트);
  });

  it("'시스템' 이면 기기를 따라 바뀐다", async () => {
    useSettingsStore.getState().setTheme("system");
    그리기();
    expect(지금()).toEqual(다크);
    await act(async () => { 기기바꾸기(true); });
    expect(지금()).toEqual(라이트);
    await act(async () => { 기기바꾸기(false); });
    expect(지금()).toEqual(다크);
  });
});
