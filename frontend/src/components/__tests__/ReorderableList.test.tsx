/**
 * 폴더·포트폴리오 순서 바꾸기.
 *
 * "관심종목 안의 종목 드래그는 쉬운데 폴더·포트폴리오는 잘 안 된다"는
 * 이야기가 있었다. 코드를 보니 같은 일을 서로 다르게 짜 두었고, 관리
 * 모달 쪽은 (1) 0.35초 길게 눌러야 시작되고 (2) 손잡이에 touch-none 이
 * 없어 끌면 모달이 같이 스크롤되고 (3) 놓기 전에는 자리가 안 바뀌어
 * 어디로 가는지 보이지 않았다.
 *
 * 이제 종목 쪽과 같은 훅을 쓴다. 그 '같음'을 여기서 못 박는다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReorderableList } from "../common/ReorderableList";

const ITEMS = [
  { id: 1, name: "국내 우량주" },
  { id: 2, name: "해외 성장주" },
  { id: 3, name: "ETF" },
];

function 그리기(onReorder = vi.fn()) {
  render(
    <ReorderableList items={ITEMS} onReorder={onReorder} itemKey="data-row-id">
      {(f, { handle }) => (
        <div>{handle}<span>{f.name}</span></div>
      )}
    </ReorderableList>,
  );
  return onReorder;
}

const 손잡이 = () => screen.getAllByRole("button", { name: /순서 바꾸기/ });
const 줄이름 = () => screen.getAllByText(/국내 우량주|해외 성장주|ETF/).map((e) => e.textContent);

describe("순서 바꾸기 목록", () => {
  it("줄마다 전용 손잡이가 있다", () => {
    /* 줄 아무 데나 잡히면 이름을 고치려다 끌려 나간다.
       종목 목록도 손잡이 방식이라 여기도 맞춘다 */
    그리기();
    expect(손잡이()).toHaveLength(3);
  });

  it("손잡이를 끌면 모달이 같이 스크롤되지 않는다", () => {
    /* touch-none 이 없으면 손가락으로 끄는 동안 목록이 같이 움직여
       조준이 안 된다. 예전 폴더 관리가 정확히 그랬다 */
    그리기();
    expect(손잡이()[0].className).toContain("touch-none");
  });

  it("잡자마자 시작한다 — 길게 누를 필요가 없다", () => {
    /* 예전에는 350ms 롱프레스가 있었다. 그 사이 손가락이 8px 넘게
       움직이면 취소돼서, 끌려고 하면 시작조차 안 되는 일이 잦았다 */
    const onReorder = 그리기();
    const h = 손잡이();
    fireEvent.dragStart(h[0]);
    fireEvent.dragOver(h[2].closest("[data-row-id]")!);
    fireEvent.drop(h[2].closest("[data-row-id]")!);
    expect(onReorder).toHaveBeenCalledWith([2, 3, 1]);
  });

  it("놓기 전에도 자리가 바뀌는 게 보인다", () => {
    /* 예전에는 색만 바뀌고 순서는 놓아야 바뀌었다 — 어디로 가는지
       알 수 없으니 몇 번씩 다시 하게 된다 */
    그리기();
    const h = 손잡이();
    expect(줄이름()).toEqual(["국내 우량주", "해외 성장주", "ETF"]);
    fireEvent.dragStart(h[0]);
    fireEvent.dragOver(h[2].closest("[data-row-id]")!);
    expect(줄이름()).toEqual(["해외 성장주", "ETF", "국내 우량주"]);
  });

  it("끄는 중인 줄이 흐릿해진다", () => {
    그리기();
    const h = 손잡이();
    fireEvent.dragStart(h[0]);
    const 끌리는줄 = document.querySelector('[data-row-id="1"]')!;
    expect(끌리는줄.className).toContain("opacity-40");
  });

  it("방향키로도 순서를 바꿀 수 있다", () => {
    /* 목록이 서너 개뿐이라 끄는 것보다 빠르고, 마우스를 쓰기 어려운
       사람도 순서를 바꿀 수 있다 */
    const onReorder = 그리기();
    fireEvent.keyDown(손잡이()[0], { key: "ArrowDown" });
    expect(onReorder).toHaveBeenCalledWith([2, 1, 3]);

    onReorder.mockClear();
    fireEvent.keyDown(손잡이()[2], { key: "ArrowUp" });
    expect(onReorder).toHaveBeenCalledWith([1, 3, 2]);
  });

  it("맨 끝에서 더 밀어도 아무 일이 없다", () => {
    const onReorder = 그리기();
    fireEvent.keyDown(손잡이()[0], { key: "ArrowUp" });
    fireEvent.keyDown(손잡이()[2], { key: "ArrowDown" });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("자기 자신에게 놓으면 순서를 건드리지 않는다", () => {
    const onReorder = 그리기();
    const h = 손잡이();
    fireEvent.dragStart(h[1]);
    fireEvent.dragOver(h[1].closest("[data-row-id]")!);
    fireEvent.drop(h[1].closest("[data-row-id]")!);
    expect(onReorder).toHaveBeenCalledWith([1, 2, 3]);   // 원래 순서 그대로
  });
});
