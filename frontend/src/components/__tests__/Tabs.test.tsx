/**
 * 공용 탭 — 7개 화면이 이제 이 컴포넌트 하나를 쓴다.
 *
 * 여기가 깨지면 대시보드·퀀트·뉴스·전략·피드·관심종목·포트폴리오·관리자가
 * 한꺼번에 깨진다. 그래서 '눌리면 바뀐다' 정도가 아니라, 각 화면이 실제로
 * 의존하는 성질(스크린리더가 읽을 수 있는가, 키보드로 되는가, 강조 정도가
 * 구분되는가, 마우스만 올려도 미리 불러오는가)을 못박아 둔다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs, UnderlineTabs, type TabItem } from "../ui";

const TABS: TabItem[] = [
  { id: "all", label: "전체" },
  { id: "kr",  label: "국내" },
  { id: "us",  label: "해외" },
];

describe("Tabs", () => {
  it("스크린리더가 탭 묶음과 선택 상태를 읽을 수 있다", () => {
    render(<Tabs tabs={TABS} active="kr" onChange={() => {}} ariaLabel="시장" />);
    expect(screen.getByRole("tablist", { name: "시장" })).toBeTruthy();
    // 선택된 것은 정확히 하나여야 한다 — 여러 개가 selected 면 읽는 사람이 헷갈린다
    const sel = screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true");
    expect(sel.map((t) => t.textContent)).toEqual(["국내"]);
  });

  it("누르면 그 탭의 id 를 돌려준다", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "해외" }));
    expect(onChange).toHaveBeenCalledWith("us");
  });

  it("키보드로도 고를 수 있다", () => {
    /* div+onClick 으로 만들었다면 여기서 걸린다. 실제 button 이어야 한다 */
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="all" onChange={onChange} />);
    const tab = screen.getByRole("tab", { name: "국내" });
    expect(tab.tagName).toBe("BUTTON");
    tab.focus();
    fireEvent.keyDown(tab, { key: "Enter" });
    fireEvent.click(tab);          // 브라우저는 Enter 를 click 으로 바꿔 보낸다
    expect(onChange).toHaveBeenCalledWith("kr");
  });

  it("마우스를 올리면 미리 불러올 수 있게 알려준다", () => {
    /* 피드가 이걸로 다음 탭 내용을 먼저 받아둔다.
       onHover 를 안 주면 아무 일도 없어야 한다 (다른 화면들이 안 준다) */
    const onHover = vi.fn();
    const { unmount } = render(<Tabs tabs={TABS} active="all" onChange={() => {}} onHover={onHover} />);
    fireEvent.mouseEnter(screen.getByRole("tab", { name: "해외" }));
    expect(onHover).toHaveBeenCalledWith("us");
    unmount();

    render(<Tabs tabs={TABS} active="all" onChange={() => {}} />);
    expect(() => fireEvent.mouseEnter(screen.getByRole("tab", { name: "해외" }))).not.toThrow();
  });

  it("solid 와 subtle 은 선택된 탭의 강조가 서로 다르다", () => {
    /* 관리자 화면은 한 줄에 필터가 여럿이라, 전부 파랗게 칠하면 무엇이
       주된 구획인지 알 수 없어진다. 그래서 보조 필터는 subtle 을 쓴다 */
    const { unmount } = render(<Tabs tabs={TABS} active="kr" onChange={() => {}} />);
    const solid = screen.getByRole("tab", { name: "국내" }).className;
    const solidTrack = screen.getByRole("tablist").className;
    unmount();

    render(<Tabs tabs={TABS} active="kr" onChange={() => {}} tone="subtle" />);
    const sub = screen.getByRole("tab", { name: "국내" }).className;
    const subTrack = screen.getByRole("tablist").className;

    expect(solid).toContain("bg-accent-blue");
    expect(sub).not.toContain("bg-accent-blue");
    expect(sub).toContain("bg-bg-card");
    // 담는 줄(트랙)도 달라야 한다. 선택된 칩이 카드색으로 '떠오르려면'
    // 배경이 그보다 어두운 elevated 여야 한다 — 둘 다 카드색이면 안 보인다
    expect(solidTrack).toContain("bg-bg-card");
    expect(subTrack).toContain("bg-bg-elevated");
  });

  it("크기 세 단계가 실제로 서로 다른 글자 크기를 낸다", () => {
    /* xs 는 포트폴리오 자산유형 필터(7개)용. 여기서 sm 과 같아지면
       탭 줄이 넓어져 모바일에서 가로 스크롤이 길어진다 */
    const cls = (size: "xs" | "sm" | "md") => {
      const { unmount } = render(<Tabs tabs={TABS} active="all" onChange={() => {}} size={size} />);
      const c = screen.getByRole("tab", { name: "전체" }).className;
      unmount();
      return c;
    };
    expect(cls("xs")).toContain("text-[11px]");
    expect(cls("sm")).toContain("text-xs");
    expect(cls("md")).toContain("text-sm");
    expect(new Set([cls("xs"), cls("sm"), cls("md")]).size).toBe(3);
  });

  it("개수와 아이콘은 준 것만 그린다", () => {
    render(<Tabs tabs={[{ id: "a", label: "전체", count: 12 }, { id: "b", label: "국내" }]}
      active="a" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: /전체/ }).textContent).toContain("12");
    /* 0 은 '없음'이 아니라 '0개'다. `count && <span>` 로 짜면 JSX 가 0 을
       그대로 흘려보내 겉보기엔 같지만 배지 없이 맨 숫자만 남는다.
       그래서 글자가 아니라 배지가 있는지를 본다 */
    const { container } = render(<Tabs tabs={[{ id: "a", label: "전체", count: 0 }]}
      active="a" onChange={() => {}} />);
    const badge = container.querySelector("button > span:last-child");
    expect(badge?.textContent).toBe("0");
  });
});

describe("UnderlineTabs", () => {
  it("포트폴리오와 관심종목이 같은 줄을 공유한다", async () => {
    /* 두 화면을 오가는 탭이라 라벨·순서가 어긋나면 화면이 튄다 */
    const { ASSET_PAGE_TABS } = await import("@/constants/tabs");
    expect(ASSET_PAGE_TABS.map((t) => t.id)).toEqual(["portfolio", "watchlist"]);

    const onChange = vi.fn();
    render(<UnderlineTabs tabs={ASSET_PAGE_TABS} active="watchlist" onChange={onChange} ariaLabel="자산 화면" />);
    expect(screen.getByRole("tab", { name: /관심종목/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /내 자산/ }));
    expect(onChange).toHaveBeenCalledWith("portfolio");
  });
});
