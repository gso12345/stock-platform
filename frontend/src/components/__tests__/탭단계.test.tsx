/**
 * 탭의 단계 — "내 자산에 여기도 같은게 있으니 보기 안좋아"(디자인 1번).
 *
 * 내 자산·관심종목·퀀트에서 화면을 나누는 탭(내 자산 | 관심종목)과 그 아래 목록을 나누는 탭(전체·KB·신한…)이
 * 똑같은 상자 탭이라, 두 줄 중 어느 쪽이 큰 구분인지 안 보였다. 이제
 *   · 화면 탭(UnderlineTabs) — 상자·배경 없이 글자와 밑줄만
 *   · 목록 탭(ChipTabs·칩탭모양) — 공모주 증권사 칩과 같은 칩
 * 으로 한 단계씩 다르게 보인다. 옆으로 넘치면 더 있는 쪽 끝을 흐린다(디자인 6번).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Wallet } from "lucide-react";
import { UnderlineTabs, ChipTabs, 칩탭모양, 칩줄모양, type TabItem } from "../ui";

const 탭들: TabItem[] = [
  { id: "all", label: "전체", count: 9 },
  { id: "kb", label: "KB", count: 5, icon: Wallet },
  { id: "sh", label: "신한", count: 0 },
];
const 반 = (el: Element) => el.className.split(/\s+/);

/** 줄의 폭을 흉내 — jsdom 은 배치가 없어 늘 0 이다 */
function 폭흉내(el: HTMLElement, 값: { 보임: number; 전체: number; 왼쪽: number }) {
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 값.보임 });
  Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => 값.전체 });
  Object.defineProperty(el, "scrollLeft", { configurable: true, get: () => 값.왼쪽 });
}

describe("화면 탭(UnderlineTabs) — 글자와 밑줄만", () => {
  it("상자·배경이 없다 — 켜진 것도 바탕을 칠하지 않고 밑줄과 진한 글자로만", () => {
    render(<UnderlineTabs tabs={탭들} active="kb" onChange={() => {}} ariaLabel="자산 화면" />);
    const 줄 = screen.getByRole("tablist", { name: "자산 화면" });
    for (const 없을것 of ["bg-bg-card", "rounded-t-xl"]) expect(반(줄)).not.toContain(없을것);
    const 켜짐 = screen.getByRole("tab", { name: /KB/ });
    expect(켜짐.getAttribute("aria-selected")).toBe("true");
    expect(반(켜짐)).toEqual(expect.arrayContaining(["border-accent-blue", "text-text-primary", "border-b-2"]));
    expect(켜짐.className).not.toMatch(/\bbg-/);
    const 꺼짐 = screen.getByRole("tab", { name: /신한/ });
    expect(반(꺼짐)).toEqual(expect.arrayContaining(["border-transparent", "text-text-muted"]));
    expect(꺼짐.className).not.toMatch(/\bbg-/);
  });

  it("누르면 알린다", () => {
    const 바뀜 = vi.fn();
    render(<UnderlineTabs tabs={탭들} active="all" onChange={바뀜} />);
    fireEvent.click(screen.getByRole("tab", { name: /신한/ }));
    expect(바뀜).toHaveBeenCalledWith("sh");
  });
});

describe("목록 탭(ChipTabs) — 공모주 증권사 칩과 같은 칩", () => {
  it("칩 모양이고, 화면 읽기는 탭으로 읽는다", () => {
    render(<ChipTabs tabs={탭들} active="kb" onChange={() => {}} ariaLabel="목록 선택" />);
    const 줄 = screen.getByRole("tablist", { name: "목록 선택" });
    expect(반(줄)).toEqual(expect.arrayContaining(칩줄모양.split(" ")));
    const 켜짐 = screen.getByRole("tab", { name: /KB/ });
    expect(켜짐.getAttribute("aria-selected")).toBe("true");
    expect(켜짐.className).toBe(칩탭모양(true));
    expect(screen.getByRole("tab", { name: /전체/ }).className).toBe(칩탭모양(false));
    expect(켜짐.querySelector("svg")).not.toBeNull();             // 아이콘(포트폴리오)
    expect(screen.getByRole("tab", { name: /신한/ }).textContent).toBe("신한0");   // 0 개도 적는다
  });

  it("누르면 알린다", () => {
    const 바뀜 = vi.fn();
    render(<ChipTabs tabs={탭들} active="all" onChange={바뀜} />);
    fireEvent.click(screen.getByRole("tab", { name: /KB/ }));
    expect(바뀜).toHaveBeenCalledWith("kb");
  });

  it("칩 모양 — 켜진 것은 파랗게 테두리, 꺼진 것은 바탕색 — 공모주 증권사 칩과 같은 값", () => {
    expect(칩탭모양(true).split(" ")).toEqual(expect.arrayContaining(
      ["rounded-lg", "border", "bg-accent-blue/15", "border-accent-blue", "text-accent-blue", "whitespace-nowrap"]));
    expect(칩탭모양(false).split(" ")).toEqual(expect.arrayContaining(
      ["rounded-lg", "border", "bg-bg-elevated", "border-border", "text-text-secondary"]));
    expect(칩줄모양.split(" ")).toEqual(expect.arrayContaining(["overflow-x-auto", "scrollbar-hide"]));
  });
});

describe("넘치면 더 있는 쪽 끝을 흐린다", () => {
  it("칩 줄 — 처음엔 오른쪽, 가운데쯤이면 양쪽, 끝까지 가면 왼쪽, 다 보이면 없음", () => {
    const { rerender } = render(<ChipTabs tabs={탭들} active="all" onChange={() => {}} ariaLabel="목록 선택" />);
    const 줄 = screen.getByRole("tablist");
    const 값 = { 보임: 200, 전체: 500, 왼쪽: 0 };
    폭흉내(줄, 값);
    rerender(<ChipTabs tabs={탭들} active="kb" onChange={() => {}} ariaLabel="목록 선택" />);
    expect(반(줄)).toContain("fade-edge-right");
    값.왼쪽 = 150;
    act(() => { 줄.dispatchEvent(new Event("scroll")); });
    expect(반(줄)).toContain("fade-edge-both");
    값.왼쪽 = 300;
    act(() => { 줄.dispatchEvent(new Event("scroll")); });
    expect(반(줄)).toContain("fade-edge-left");
    값.전체 = 200; 값.왼쪽 = 0;
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(줄.className).not.toMatch(/fade-edge/);
  });

  it("화면 탭도 같다", () => {
    const { rerender } = render(<UnderlineTabs tabs={탭들} active="all" onChange={() => {}} ariaLabel="자산 화면" />);
    const 줄 = screen.getByRole("tablist");
    폭흉내(줄, { 보임: 100, 전체: 300, 왼쪽: 0 });
    rerender(<UnderlineTabs tabs={탭들} active="kb" onChange={() => {}} ariaLabel="자산 화면" />);
    expect(반(줄)).toContain("fade-edge-right");
  });
});
