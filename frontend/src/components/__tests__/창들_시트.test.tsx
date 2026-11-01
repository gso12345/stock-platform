/**
 * 가운데 창 → 휴대폰에서는 아래 시트(8번) — 공용 창(ui 의 Modal)으로 옮긴 창들이 실제로 시트로 뜨고, 바깥을
 * 누르면 예전처럼 닫히는지. 시트 자체(끌어내려 닫기·자판)는 모달시트 가 본다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";
import { resolve } from "path";

const 설치 = vi.hoisted(() => ({ canPrompt: false, isIOS: true, installed: false, promptInstall: async () => {} }));
vi.mock("@/hooks/useInstallPrompt", () => ({ useInstallPrompt: () => 설치 }));

import SettingsModal from "../account/SettingsModal";
import InstallAppButton from "../layout/InstallAppButton";

const 시트 = () => document.querySelector("[data-sheet]") as HTMLElement | null;
const 뒤판 = () => document.querySelector(".modal-backdrop") as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === "(max-width: 639px)", media: q, addEventListener() {}, removeEventListener() {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("휴대폰에서 아래 시트로 뜨는 창들", () => {
  it("설정 — 시트로 뜨고, 바깥을 누르면 닫는다", () => {
    const 닫기 = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><SettingsModal onClose={닫기} /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(시트()).not.toBeNull();
    expect(시트()!.textContent).toContain("설정");
    fireEvent.click(screen.getByText("설정"));
    expect(닫기).not.toHaveBeenCalled();
    fireEvent.click(뒤판());
    expect(닫기).toHaveBeenCalledTimes(1);
  });

  it("아이폰 앱 설치 안내 — 시트로 뜨고, 바깥을 누르면 닫는다", () => {
    render(<InstallAppButton />);
    fireEvent.click(screen.getByRole("button", { name: /앱 설치/ }));
    expect(시트()!.textContent).toContain("앱으로 설치하기");
    fireEvent.click(뒤판());
    expect(screen.queryByText("앱으로 설치하기")).toBeNull();
  });

  it("팔로워·팔로잉 — 공용 창을 쓰고 바깥을 누르면 닫는다", () => {
    const 글 = readFileSync(resolve(__dirname, "../../pages/UserProfile.tsx"), "utf-8");
    const 자리 = 자리찾기(글, "{/* 팔로워/팔로잉 모달 */}");
    expect(글.slice(자리, 자리 + 300)).toMatch(/<Modal [^>]*onClose=\{\(\) => setFollowModal\(null\)\}>/);
  });
});

function 자리찾기(글: string, 표시: string) {
  const 자리 = 글.indexOf(표시);
  expect(자리).toBeGreaterThan(-1);
  return 자리;
}
