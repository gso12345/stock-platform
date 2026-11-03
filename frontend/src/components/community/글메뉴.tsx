/**
 * '⋯' 메뉴 — 글·댓글마다 흩어져 있던 단추(삭제·수정·신고·링크 복사)를 하나로 모은다(사용자가 고른 6번).
 *
 * 예전에는 내 글이면 종목 옆에 11px 휴지통이, 글 상세에는 깃발이, 댓글마다 '신고' 글자가 붙어 있었다.
 * 휴지통은 종목 바로 옆이라 잘못 누르기 쉬웠고, 깃발·신고 글자는 읽을 때 눈에 걸렸다.
 *
 * 메뉴 판은 body 에 띄운다(portal) — 댓글 창처럼 스크롤되는 상자 안에서 열면 상자 끝에서 잘린다.
 * 열린 채 화면이 움직이면 자리가 어긋나므로 스크롤하면 닫는다.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/components/ui";

export type 메뉴항목 = {
  이름: string;
  아이콘?: LucideIcon;
  누르면: () => void;
  /** 되돌릴 수 없는 일(삭제·신고) — 빨갛게 */
  위험?: boolean;
};

/** 판 높이를 모를 때 아래에 이만큼 남아 있지 않으면 위로 연다 */
const 판높이어림 = 200;

export default function 글메뉴({ 항목들, 이름 = "메뉴", 크기 = 16, className }: {
  항목들: 메뉴항목[];
  /** 단추 이름(화면 읽기) — "글 메뉴", "댓글 메뉴" */
  이름?: string;
  크기?: number;
  className?: string;
}) {
  const [열림, set열림] = useState(false);
  const 단추 = useRef<HTMLButtonElement>(null);
  const 판 = useRef<HTMLDivElement>(null);
  const [자리, set자리] = useState<React.CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!열림 || !단추.current) { set자리(null); return; }
    const r = 단추.current.getBoundingClientRect();
    const 오른쪽 = Math.max(8, window.innerWidth - r.right);
    set자리(window.innerHeight - r.bottom < 판높이어림 && r.top > 판높이어림
      ? { bottom: window.innerHeight - r.top + 4, right: 오른쪽 }
      : { top: r.bottom + 4, right: 오른쪽 });
  }, [열림]);

  useEffect(() => {
    if (!열림) return;
    const 닫기 = () => set열림(false);
    const 밖을누름 = (e: Event) => {
      const 곳 = e.target as Node;
      if (판.current?.contains(곳) || 단추.current?.contains(곳)) return;
      닫기();
    };
    const 키 = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc 는 메뉴만 닫는다 — 댓글 창 안의 메뉴에서 누르면 창까지 같이 닫혔다(창은 window 에서 듣는다)
      e.stopPropagation();
      닫기();
      단추.current?.focus();
    };
    document.addEventListener("pointerdown", 밖을누름, true);
    document.addEventListener("scroll", 닫기, true);
    document.addEventListener("keydown", 키);
    window.addEventListener("resize", 닫기);
    return () => {
      document.removeEventListener("pointerdown", 밖을누름, true);
      document.removeEventListener("scroll", 닫기, true);
      document.removeEventListener("keydown", 키);
      window.removeEventListener("resize", 닫기);
    };
  }, [열림]);

  if (항목들.length === 0) return null;
  return (
    <>
      <button ref={단추} type="button" aria-label={이름} aria-haspopup="menu" aria-expanded={열림}
        onClick={(e) => { e.stopPropagation(); set열림((v) => !v); }}
        className={cn("p-1.5 -m-1 rounded-full text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors flex-shrink-0", className)}>
        <MoreHorizontal size={크기} />
      </button>
      {열림 && createPortal(
        <div ref={판} role="menu" aria-label={이름}
          // 판은 body 에 붙지만 React 의 이벤트는 부모(카드)로 올라간다 — 카드가 글로 넘어가지 않게 막는다
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[70] min-w-[9rem] py-1 bg-bg-card border border-border rounded-xl shadow-float modal-pop"
          style={자리 ?? { visibility: "hidden", top: 0, right: 0 }}>
          {항목들.map((h) => {
            const 아이콘 = h.아이콘;
            return (
              <button key={h.이름} type="button" role="menuitem"
                onClick={() => { set열림(false); h.누르면(); }}
                className={cn("w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left transition-colors hover:bg-bg-elevated",
                  h.위험 ? "text-accent-red" : "text-text-primary")}>
                {아이콘 && <아이콘 size={16} className="flex-shrink-0" />}
                {h.이름}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
