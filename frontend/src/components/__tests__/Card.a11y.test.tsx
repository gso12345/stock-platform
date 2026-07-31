/**
 * Card 접근성 — 누를 수 있는 카드는 키보드로도 눌려야 한다.
 *
 * 예전에는 그냥 <div onClick> 이었다. 대시보드의 지수 카드가 이걸 쓰는데,
 * 마우스로만 열 수 있었고 스크린리더는 누를 수 있는 요소인지조차 알 수 없었다.
 * Card 는 거의 모든 화면이 쓰므로 여기서 못 박아 둔다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Card } from "@/components/ui";

describe("Card 접근성", () => {
  it("누를 수 있으면 버튼으로 노출된다", () => {
    render(<Card onClick={() => {}}>코스피</Card>);
    const el = screen.getByRole("button", { name: /코스피/ });
    expect(el.tabIndex).toBe(0);
  });

  it("Enter 로 눌린다", () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick}>코스피</Card>);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Space 로도 눌린다", () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick}>코스피</Card>);
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("다른 키에는 반응하지 않는다", () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick}>코스피</Card>);
    fireEvent.keyDown(screen.getByRole("button"), { key: "a" });
    fireEvent.keyDown(screen.getByRole("button"), { key: "Tab" });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("누를 수 없는 카드는 버튼이 아니다", () => {
    // 단순 컨테이너까지 탭 순서에 끼면 키보드 이동이 번거로워진다
    render(<Card>그냥 상자</Card>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("마우스 클릭은 그대로 동작한다", () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick}>코스피</Card>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
