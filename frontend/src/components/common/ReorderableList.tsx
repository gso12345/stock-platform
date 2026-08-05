import React from "react";
import { useDragReorder, type 항목id } from "@/hooks/useDragReorder";

/**
 * 순서를 바꿀 수 있는 목록 — 폴더 관리·포트폴리오 관리가 같이 쓴다.
 *
 * 관심종목 안의 종목 드래그는 쉬운데 폴더·포트폴리오 드래그는 잘 안 된다는
 * 이야기가 있었다. 코드를 보니 같은 일을 서로 다르게 짜 두었다.
 *
 *   종목 드래그                     폴더·포트폴리오 드래그(예전)
 *   ─────────────────────────────  ──────────────────────────────
 *   전용 손잡이를 잡는다             줄 아무 데나 잡는다
 *   잡자마자 시작                   0.35초 꾹 누르고 있어야 시작
 *   손잡이에 touch-none             없음 → 끌면 모달이 같이 스크롤된다
 *   끄는 동안 줄이 실제로 비켜난다    놓을 때까지 자리가 안 바뀐다(색만 바뀜)
 *   항목 id 로 추적                 인덱스로 추적 (중간에 순서가 바뀌면 어긋남)
 *
 * 그래서 종목 쪽이 쓰던 훅(useDragReorder)을 그대로 쓰고, 손잡이도 같은
 * 모양으로 맞춘다. 덤으로 손잡이에 방향키를 붙였다 — 작은 목록에서는
 * 끄는 것보다 빠르고, 마우스를 쓰기 어려운 사람도 순서를 바꿀 수 있다.
 */
export function ReorderableList<T extends { id: 항목id }>({
  items, onReorder, itemKey = "data-reorder-id", children, className,
}: {
  items: T[];
  onReorder: (orderedIds: T["id"][]) => void;
  /** 터치 드래그가 대상 줄을 찾을 때 쓰는 속성 이름 (한 화면에 목록이 둘이면 다르게) */
  itemKey?: string;
  children: (item: T, ui: { isDragging: boolean; isDropTarget: boolean; handle: React.ReactNode }) => React.ReactNode;
  className?: string;
}) {
  const drag = useDragReorder<T>({ items, onCommit: onReorder });
  const list = drag.localOrder ?? items;

  /** 방향키로 한 칸 옮기기 */
  const 옮기기 = (id: 항목id, 방향: -1 | 1) => {
    const from = list.findIndex((i) => i.id === id);
    const to = from + 방향;
    if (from < 0 || to < 0 || to >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next.map((i) => i.id));
  };

  return (
    <div className={className}>
      {list.map((item) => {
        const isDragging = drag.dragId === item.id;
        const isDropTarget = drag.dropId === item.id;
        const handle = (
          <button
            type="button"
            draggable
            aria-label="순서 바꾸기 — 끌어서 옮기거나 위/아래 방향키를 누르세요"
            onDragStart={() => drag.start(item)}
            onDragEnd={drag.cancel}
            onTouchStart={() => drag.start(item)}
            onTouchMove={(e) => drag.moveToPoint(e.touches[0].clientX, e.touches[0].clientY, itemKey)}
            onTouchEnd={drag.drop}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") { e.preventDefault(); 옮기기(item.id, -1); }
              if (e.key === "ArrowDown") { e.preventDefault(); 옮기기(item.id, 1); }
            }}
            /* touch-none 이 없으면 손가락으로 끌 때 모달이 같이 스크롤된다 */
            className="cursor-grab active:cursor-grabbing text-text-dim hover:text-text-muted
                       touch-none flex-shrink-0 px-2 py-1 rounded
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
            title="드래그하여 순서 변경 (방향키도 됩니다)"
          >
            <svg width="12" height="18" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="2" r="1.5" /><circle cx="7" cy="2" r="1.5" />
              <circle cx="3" cy="8" r="1.5" /><circle cx="7" cy="8" r="1.5" />
              <circle cx="3" cy="14" r="1.5" /><circle cx="7" cy="14" r="1.5" />
            </svg>
          </button>
        );
        return (
          <div
            key={item.id}
            {...{ [itemKey]: item.id }}
            onDragOver={(e) => drag.onDragOver(e, item.id)}
            onDrop={drag.drop}
            className={`transition-[opacity,background-color] ${isDragging ? "opacity-40" : ""} ${
              isDropTarget && !isDragging ? "bg-accent-blue/10" : ""
            }`}
          >
            {children(item, { isDragging, isDropTarget, handle })}
          </div>
        );
      })}
    </div>
  );
}
