import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragReorder } from "../useDragReorder";

type Row = { id: number; name: string };
const rows: Row[] = [1, 2, 3, 4, 5].map((id) => ({ id, name: `종목${id}` }));
const ids = (arr: Row[] | null) => (arr ?? []).map((r) => r.id);

describe("useDragReorder", () => {
  beforeEach(() => {
    document.body.className = "";
  });

  it("앞의 항목을 뒤로 끌면 그 위치로 들어간다", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDragReorder<Row>({ items: rows, onCommit }));

    act(() => result.current.start(rows[0]));   // 1번을 잡고
    act(() => result.current.moveTo(3));        // 3번 위로

    expect(ids(result.current.localOrder)).toEqual([2, 3, 1, 4, 5]);
  });

  it("뒤의 항목을 앞으로 끌면 그 위치로 들어간다", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDragReorder<Row>({ items: rows, onCommit }));

    act(() => result.current.start(rows[4]));   // 5번을 잡고
    act(() => result.current.moveTo(2));        // 2번 위로

    expect(ids(result.current.localOrder)).toEqual([1, 5, 2, 3, 4]);
  });

  it("연속으로 여러 칸 이동해도 순서가 누적된다", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDragReorder<Row>({ items: rows, onCommit }));

    act(() => result.current.start(rows[0]));
    act(() => result.current.moveTo(2));
    act(() => result.current.moveTo(3));
    act(() => result.current.moveTo(4));

    // 1번이 4번 자리까지 밀려간다
    expect(ids(result.current.localOrder)).toEqual([2, 3, 4, 1, 5]);
  });

  it("같은 대상 위에 머무르면 재계산하지 않는다 (dragover 폭주 방지)", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDragReorder<Row>({ items: rows, onCommit }));

    act(() => result.current.start(rows[0]));
    act(() => result.current.moveTo(3));
    const afterFirst = result.current.localOrder;

    act(() => result.current.moveTo(3));   // 같은 대상 반복
    act(() => result.current.moveTo(3));

    // 순서가 더 흔들리지 않고 객체도 그대로여야 한다
    expect(ids(result.current.localOrder)).toEqual([2, 3, 1, 4, 5]);
    expect(result.current.localOrder).toBe(afterFirst);
  });

  it("자기 자신 위로는 움직이지 않는다", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDragReorder<Row>({ items: rows, onCommit }));

    act(() => result.current.start(rows[0]));
    act(() => result.current.moveTo(1));

    expect(ids(result.current.localOrder)).toEqual([1, 2, 3, 4, 5]);
  });

  it("드래그를 시작하지 않았으면 이동 요청을 무시한다", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDragReorder<Row>({ items: rows, onCommit }));

    act(() => result.current.moveTo(3));

    expect(result.current.localOrder).toBeNull();
    expect(result.current.isDragging).toBe(false);
  });

  it("놓으면 최종 순서를 한 번만 저장하고 상태를 비운다", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDragReorder<Row>({ items: rows, onCommit }));

    act(() => result.current.start(rows[0]));
    act(() => result.current.moveTo(3));
    act(() => result.current.drop());

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith([2, 3, 1, 4, 5]);
    expect(result.current.localOrder).toBeNull();
    expect(result.current.isDragging).toBe(false);
  });

  it("취소하면 저장하지 않고 되돌린다", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDragReorder<Row>({ items: rows, onCommit }));

    act(() => result.current.start(rows[0]));
    act(() => result.current.moveTo(3));
    act(() => result.current.cancel());

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.localOrder).toBeNull();
  });

  it("드래그 중에만 body에 표시용 클래스를 붙인다", () => {
    const { result } = renderHook(() => useDragReorder<Row>({ items: rows, onCommit: vi.fn() }));

    expect(document.body.classList.contains("dragging-list")).toBe(false);
    act(() => result.current.start(rows[0]));
    expect(document.body.classList.contains("dragging-list")).toBe(true);
    act(() => result.current.drop());
    expect(document.body.classList.contains("dragging-list")).toBe(false);
  });

  it("드래그 도중 목록이 갱신돼도 잡고 있던 순서를 기준으로 계산한다", () => {
    // 시세 갱신 등으로 부모가 리렌더돼 items 배열이 새로 만들어지는 상황
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ items }) => useDragReorder<Row>({ items, onCommit }),
      { initialProps: { items: rows } },
    );

    act(() => result.current.start(rows[0]));
    act(() => result.current.moveTo(3));
    rerender({ items: rows.map((r) => ({ ...r })) });   // 새 객체로 교체
    act(() => result.current.moveTo(5));

    // 중간에 목록이 새로 와도 이동이 처음부터 다시 계산되지 않는다
    expect(ids(result.current.localOrder)).toEqual([2, 3, 4, 5, 1]);
  });
});
