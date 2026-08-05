import { useState, useRef, useCallback, useEffect } from "react";

/** 항목을 가리키는 값. 숫자만 쓰다가 문자열도 받게 넓혔다 — 관심종목 탭
 *  순서는 폴더(숫자 id)와 내계좌와 "최근조회"가 한 줄에 섞이는데, 이걸
 *  한 목록으로 다루려면 "folder:3" 같은 키가 필요하다. */
export type 항목id = number | string;

/**
 * 목록 드래그 재정렬 — 종목·폴더·포트폴리오 탭이 각자 복사해 쓰던 로직을 하나로 모았다.
 *
 * 핵심은 "ref를 진짜 기준으로 쓰는 것"이다. dragover/touchmove는 초당 수십 번 연달아
 * 발생하는데 state만 보면 직전 이동이 반영되기 전 값을 읽어 순서가 밀리거나 누락된다.
 * state는 화면 표시(반투명·하이라이트)용으로만 둔다.
 */
export function useDragReorder<T extends { id: 항목id }>({
  items,
  onCommit,
}: {
  items: T[];
  onCommit: (orderedIds: T["id"][]) => void;
}) {
  const [dragId, setDragId] = useState<항목id | null>(null);
  const [dropId, setDropId] = useState<항목id | null>(null);
  const [localOrder, setLocalOrder] = useState<T[] | null>(null);

  const dragIdRef = useRef<항목id | null>(null);
  const orderRef  = useRef<T[] | null>(null);
  // 같은 항목 위에 머물러 있는 동안에도 dragover는 초당 수십 번 발생한다.
  // 마지막으로 처리한 대상을 기억해 두고 같은 대상이면 통째로 건너뛴다.
  const lastTargetRef = useRef<항목id | null>(null);

  const start = useCallback((item: T) => {
    dragIdRef.current = item.id;
    orderRef.current = items;
    lastTargetRef.current = null;
    // 리렌더 없이 CSS만 바꿔, 드래그 중에는 화면 밖 항목 건너뛰기를 잠시 끈다
    // (순서가 계속 바뀌는 동안에는 오히려 레이아웃 재계산을 유발한다)
    document.body.classList.add("dragging-list");
    setDragId(item.id);
    setLocalOrder(items);
  }, [items]);

  const moveTo = useCallback((targetId: 항목id) => {
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
    document.body.classList.remove("dragging-list");
    setDragId(null); setDropId(null); setLocalOrder(null);
  }, [onCommit]);

  const cancel = useCallback(() => {
    dragIdRef.current = null;
    orderRef.current = null;
    lastTargetRef.current = null;
    document.body.classList.remove("dragging-list");
    setDragId(null); setDropId(null); setLocalOrder(null);
  }, []);

  /** 화면 좌표 아래에 있는 항목으로 이동 (모바일 터치 드래그용)
   *
   *  touchmove는 손가락을 움직이는 내내 초당 수십 번 발생하고, elementFromPoint는
   *  호출할 때마다 브라우저에 레이아웃 재계산을 강제한다. 그래서 화면 갱신 주기에
   *  맞춰 한 프레임당 한 번만 처리한다 (좌표는 항상 최신값을 쓴다). */
  const rafRef    = useRef<number | null>(null);
  const pointRef  = useRef<{ x: number; y: number; attr: string } | null>(null);

  const moveToPoint = useCallback((clientX: number, clientY: number, attr: string) => {
    if (dragIdRef.current === null) return;
    pointRef.current = { x: clientX, y: clientY, attr };
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const p = pointRef.current;
      if (!p || dragIdRef.current === null) return;
      const el = (document.elementFromPoint(p.x, p.y) as HTMLElement | null)
        ?.closest(`[${p.attr}]`) as HTMLElement | null;
      if (!el) return;
      /* 속성값은 언제나 문자열이다. 예전에는 Number() 로 되돌렸는데,
         그러면 "folder:3" 같은 키는 NaN 이 되고 id 0 은 falsy 라 조용히
         빠졌다. 실제 항목에서 되찾으면 둘 다 없는 문제가 된다 */
      const 값 = el.getAttribute(p.attr);
      if (값 == null) return;
      const 대상 = (orderRef.current ?? items).find((i) => String(i.id) === 값);
      if (대상 != null) moveTo(대상.id);
    });
  }, [moveTo, items]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    document.body.classList.remove("dragging-list");
  }, []);

  return {
    dragId, dropId, localOrder,
    isDragging: dragId !== null,
    start, moveTo, moveToPoint, drop, cancel,
    /** dragover 핸들러 (preventDefault 포함) */
    onDragOver: useCallback((e: React.DragEvent, targetId: 항목id) => {
      e.preventDefault();
      moveTo(targetId);
    }, [moveTo]),
  };
}
