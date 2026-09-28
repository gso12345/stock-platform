/** 설정 화면에 '불러오기 표시' 가 있고, 고른 값이 저장된다 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SettingsModal from "../SettingsModal";
import { useSettingsStore, 정상불러오기표시 } from "@/store/settingsStore";

beforeEach(() => { localStorage.clear(); useSettingsStore.getState().set불러오기표시("보이기"); });

describe("설정 — 불러오기 표시", () => {
  it("세 가지 중 고를 수 있고, 고른 값이 저장된다", () => {
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><MemoryRouter><SettingsModal onClose={() => {}} /></MemoryRouter></QueryClientProvider>);
    const 무리 = screen.getByRole("radiogroup", { name: "불러오기 표시" });
    expect(무리).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /실패만/ }));
    expect(useSettingsStore.getState().불러오기표시).toBe("실패만");
    expect(JSON.parse(localStorage.getItem("portfolio_settings")!).불러오기표시).toBe("실패만");
    expect(screen.getByRole("radio", { name: /실패만/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("저장된 값이 이상하면 기본(보이기)으로", () => {
    expect(정상불러오기표시("아무거나")).toBe("보이기");
    expect(정상불러오기표시("끄기")).toBe("끄기");
  });
});

describe("다시 열어도 유지", () => {
  it("저장해 둔 불러오기 표시를 앱을 다시 열 때 그대로 읽는다", async () => {
    const { vi } = await import("vitest");
    localStorage.setItem("portfolio_settings", JSON.stringify({ 불러오기표시: "실패만" }));
    vi.resetModules();
    const { useSettingsStore: 새로 } = await import("@/store/settingsStore");
    expect(새로.getState().불러오기표시).toBe("실패만");
  });
});
