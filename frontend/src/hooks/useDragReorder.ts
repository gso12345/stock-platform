import { useState, useRef, useCallback } from "react";

/**
 * 목록 드래그 재정렬 — 종목·폴더·포트폴리오 탭이 각자 복사해 쓰던 로직을 하나로 모았다.
 *
 * 핵심은 "ref를 진짜 기준으로 쓰는 것"이다. dragover/touchmove는 초당 수십 번 연달아
 * 발생하는데 state만 보면 직전 이동이 반영되기 전 값을 읽어 순서가 밀리거나 누락된다.
 * state는 화면 표시(반투명·하이라이트)용으로만 둔다.
 */
export function useDragReorder<T extends { id: number }>({
  items,
  onCommit,
}: {
  items: T[];
  onCommit: (orderedIds: number[]) => void;
}) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropId, setDropId] = useState<number | null>(null);
  const [localOrder, setLocalOrder] = useState<T[] | null>(null);

  const dragIdRef = useRef<number | null>(null);
  const orderRef  = useRef<T[] | null>(null);
  // 같은 항목 위에 머물러 있는 동안에도 dragover는 초당 수십 번 발생한다.
  // 마지막으로 처리한 대상을 기억해 두고 같은 대상이면 통째로 건너뛴다.
  const lastTargetRef = useRef<number | null>(null);

  const start = useCallback((item: T) => {
    dragIdRef.current = item.id;
    orderRef.current = items;
    lastTargetRef.current = null;
    setDragId(item.id);
    setLocalOrder(items);
  }, [items]);

  const moveTo = useCallback((targetId: number) => {
    const fromId = dragIdRef.current;
    if (fromId === null || fromId === targetId) return;
    if (lastTargetRef.current === targetId) return;   // 직전과 같은 위치 → 재계산 불필요
    lastTargetRef.current = targetId;
    const base = orderRef.current ?? items;
    const from = base.findIndex((i) => i.id === fromId);
    const to   = base.findIndex((i) => i.id === targetId);
    if (from === -1 || to === -1) return;
    const next = [...base];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    orderRef.current = next;
    setDropId(targetId);
    setLocalOrder(next);
  }, [items]);

  const drop = useCallback(() => {
    const order = orderRef.current;
    if (dragIdRef.current !== null && order) onCommit(order.map((i) => i.id));
    dragIdRef.current = null;
    orderRef.current = null;
    lastTargetRef.current = null;
    setDragId(null); setDropId(null); setLocalOrder(null);
  }, [onCommit]);

  const cancel = useCallback(() => {
    dragIdRef.current = null;
    orderRef.current = null;
    lastTargetRef.current = null;
    setDragId(null); setDropId(null); setLocalOrder(null);
  }, []);

  /** 화면 좌표 아래에 있는 항목으로 이동 (모바일 터치 드래그용) */
  const moveToPoint = useCallback((clientX: number, clientY: number, attr: string) => {
    if (dragIdRef.current === null) return;
    const el = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)
      ?.closest(`[${attr}]`) as HTMLElement | null;
    if (!el) return;
    const targetId = Number(el.getAttribute(attr));
    if (targetId) moveTo(targetId);
  }, [moveTo]);

  return {
    dragId, dropId, localOrder,
    isDragging: dragId !== null,
    start, moveTo, moveToPoint, drop, cancel,
    /** dragover 핸들러 (preventDefault 포함) */
    onDragOver: useCallback((e: React.DragEvent, targetId: number) => {
      e.preventDefault();
      moveTo(targetId);
    }, [moveTo]),
  };
}
