/**
 * 포트폴리오 관리 창이 '전체에 넣을 것 고르기' 도 맡는다(디자인 2번).
 *
 * 내 자산 머리에 포트폴리오를 고르는 단추가 셋(포트폴리오 탭·'포트폴리오 선택(4/4)'·'포트폴리오 관리')이라
 * 같은 일을 나눠 했다. 칩 줄 끝의 '관리' 하나로 모으고, 전체에 넣을 것 고르기는 이 창의 체크로 옮겼다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PortfolioManagerModal } from "../portfolio/PortfolioModals";

const 둘 = [
  { id: 1, name: "KB", position: 0, count: 5, is_public: false },
  { id: 2, name: "신한", position: 1, count: 2, is_public: false },
];

function 그리기(목록 = 둘, 뺀것 = new Set<number>([2]), 고르기 = vi.fn()) {
  render(
    <PortfolioManagerModal portfolios={목록 as any} onClose={() => {}} onRename={() => {}} onDelete={() => {}}
      onReorder={() => {}} onAdd={() => {}} excludedIds={뺀것} onToggleInclude={고르기} />,
  );
  return 고르기;
}

describe("포트폴리오 관리 — 전체에 넣기", () => {
  it("포트폴리오마다 체크 — 넣은 것은 켜져 있고, 뺀 것은 꺼져 있다", () => {
    그리기();
    expect((screen.getByRole("checkbox", { name: "KB — 전체에 넣기" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "신한 — 전체에 넣기" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/체크한 포트폴리오만/)).toBeInTheDocument();
  });

  it("누르면 그 포트폴리오를 넣거나 뺀다", () => {
    const 고르기 = 그리기();
    fireEvent.click(screen.getByRole("checkbox", { name: "신한 — 전체에 넣기" }));
    expect(고르기).toHaveBeenCalledWith(2);
  });

  it("하나뿐이면 고를 것이 없다 — '전체' 가 곧 그것", () => {
    그리기([둘[0]], new Set());
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/체크한 포트폴리오만/)).toBeNull();
  });

  it("고르기를 넘기지 않으면(예전 쓰임) 체크 없이 그대로", () => {
    render(
      <PortfolioManagerModal portfolios={둘 as any} onClose={() => {}} onRename={() => {}} onDelete={() => {}}
        onReorder={() => {}} onAdd={() => {}} />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("KB")).toBeInTheDocument();
  });
});
