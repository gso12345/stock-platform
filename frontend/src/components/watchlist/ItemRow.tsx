import { memo, useState, useRef } from "react";
import { ChangeBadge, MarketBadge } from "@/components/ui";
import { Trash2, Wallet, Settings2 } from "lucide-react";
import { normalizeSymbol } from "@/utils/prices";
import { fmtKRWFull, fmtUSDFull } from "@/utils/formatters";
import LivePrice from "@/components/ui/LivePrice";

const SWIPE_REVEAL = 210;   // 수정(70) + 보유종목추가(70) + 삭제(70)
const SWIPE_THRESHOLD = 50;

/* ── 종목 행: 드래그 재정렬 + 왼쪽으로 스와이프 → 수정/삭제 ─── */
export const ItemRow = memo(function ItemRow({ item, livePrice, onRemove, onNavigate, onEdit, onPrefetch, onAddToPortfolio,
  isDragging, isDragOver, onDragStart, onDragOver, onDrop,
  onTouchDragStart, onTouchDragMove, onTouchDragEnd }: {
  item: any; livePrice: any;
  onRemove: () => void; onNavigate: () => void; onEdit: () => void;
  onPrefetch?: () => void;
  onAddToPortfolio?: () => void;
  isDragging?: boolean; isDragOver?: boolean;
  onDragStart?: React.DragEventHandler;
  onDragOver?: React.DragEventHandler;
  onDrop?: React.DragEventHandler;
  onTouchDragStart?: () => void;
  onTouchDragMove?: (clientX: number, clientY: number) => void;
  onTouchDragEnd?: () => void;
}) {
  const p        = livePrice ?? item;
  const isKR     = item.market === "KR";
  const hasPrice = p.price != null && p.price > 0;

  const [swipeX, setSwipeX] = useState(0); // 음수 = 왼쪽으로 밀림
  const [isOpen, setIsOpen] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isScrolling = useRef<boolean | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isScrolling.current = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (isScrolling.current === null) isScrolling.current = Math.abs(dy) > Math.abs(dx);
    if (isScrolling.current) return;
    const base = isOpen ? -SWIPE_REVEAL : 0;
    // 왼쪽(음수)으로만 허용
    setSwipeX(Math.min(0, Math.max(-SWIPE_REVEAL - 16, base + dx)));
  };
  const onTouchEnd = () => {
    if (isScrolling.current) return;
    if (swipeX < -SWIPE_THRESHOLD) { setSwipeX(-SWIPE_REVEAL); setIsOpen(true); }
    else { setSwipeX(0); setIsOpen(false); }
  };
  const closeSwipe = () => { setSwipeX(0); setIsOpen(false); };

  return (
    <div
      className={`relative overflow-hidden border-b border-border/30 group ${isDragOver ? "bg-accent-blue/5" : ""} ${isDragging ? "opacity-40" : ""}`}
      onDragOver={onDragOver} onDrop={onDrop}
      onMouseEnter={onPrefetch}
    >
      {/* 스와이프 액션 버튼 (오른쪽 고정, 왼쪽으로 밀면 등장) */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: SWIPE_REVEAL }}>
        <button onClick={() => { closeSwipe(); onEdit(); }} aria-label="종목 수정"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-accent-blue text-white text-[10px] font-semibold">
          <Settings2 size={14}/><span>수정</span>
        </button>
        {onAddToPortfolio && (
          <button onClick={() => { closeSwipe(); onAddToPortfolio(); }} aria-label="보유종목 추가"
            className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-accent-green text-white text-[10px] font-semibold">
            <Wallet size={14}/><span>보유추가</span>
          </button>
        )}
        <button onClick={() => { closeSwipe(); onRemove(); }} aria-label="종목 삭제"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-accent-red text-white text-[10px] font-semibold">
          <Trash2 size={14}/><span>삭제</span>
        </button>
      </div>

      {/* 슬라이드 콘텐츠 */}
      <div
        className="flex items-center gap-2 px-3 py-3 bg-bg-card hover:bg-bg-hover transition-colors"
        style={{ transform: `translateX(${swipeX}px)`, transition: swipeX === 0 || swipeX === -SWIPE_REVEAL ? "transform 0.2s ease" : "none" }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onClick={swipeX !== 0 ? closeSwipe : undefined}
      >
        {/* 드래그 핸들 */}
        <div
          draggable
          onDragStart={onDragStart}
          onTouchStart={onTouchDragStart}
          onTouchMove={(e) => onTouchDragMove?.(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchEnd={onTouchDragEnd}
          className="cursor-grab active:cursor-grabbing text-text-dim hover:text-text-muted touch-none flex-shrink-0 px-1"
          title="드래그하여 순서 변경"
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="3" cy="2.5" r="1.3"/><circle cx="7" cy="2.5" r="1.3"/>
            <circle cx="3" cy="7"   r="1.3"/><circle cx="7" cy="7"   r="1.3"/>
            <circle cx="3" cy="11.5" r="1.3"/><circle cx="7" cy="11.5" r="1.3"/>
          </svg>
        </div>

        {/* 종목 정보 */}
        <div
          role="button"
          tabIndex={0}
          className="flex-1 min-w-0 cursor-pointer"
          onClick={onNavigate}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate(); } }}
        >
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-sm text-text-primary">
              {normalizeSymbol(item.symbol ?? "")}
            </span>
            {livePrice && <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse flex-shrink-0"/>}
            <MarketBadge market={item.market} />
          </div>
          <div className="text-[11px] text-text-muted truncate">{item.name || p.name}</div>
          {item.memo && <div className="text-[10px] text-text-muted/60 italic mt-0.5">{item.memo}</div>}
        </div>

        {/* 가격 */}
        <div
          role="button"
          tabIndex={0}
          className="text-right flex-shrink-0 cursor-pointer min-w-[80px]"
          onClick={onNavigate}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate(); } }}
        >
          <div className="text-sm font-mono font-semibold text-text-primary">
            {hasPrice
              ? <LivePrice value={Number(p.price)}>
                  {isKR ? fmtKRWFull(Number(p.price)) : fmtUSDFull(Number(p.price))}
                </LivePrice>
              : <span className="text-text-muted text-xs">—</span>}
          </div>
          {hasPrice && p.change_rate != null && <ChangeBadge value={Number(p.change_rate)} className="text-xs"/>}
        </div>

        {/* 포트폴리오 추가 버튼 */}
        {onAddToPortfolio && (
          <button onClick={(e) => { e.stopPropagation(); onAddToPortfolio(); }} className="text-text-muted hover:text-accent-green p-1.5 rounded-lg hover:bg-accent-green/10 transition-colors flex-shrink-0" title="포트폴리오에 추가"><Wallet size={14}/></button>
        )}
        {/* 편집/삭제 버튼 (데스크탑 hover) */}
        <div className="hidden md:flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button aria-label="종목 수정" onClick={onEdit}   className="text-text-muted hover:text-accent-blue p-1.5 rounded-lg hover:bg-accent-blue/10 transition-colors"><Settings2 size={13}/></button>
          <button aria-label="종목 삭제" onClick={onRemove} className="text-text-muted hover:text-accent-red  p-1.5 rounded-lg hover:bg-accent-red/10  transition-colors"><Trash2 size={13}/></button>
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  // 핸들러들이 매 렌더마다 새 함수로 만들어지므로 기본 얕은 비교로는 메모이제이션이
  // 전혀 동작하지 않는다. 실제로 화면에 영향을 주는 값만 비교한다.
  //
  // 드래그 중에도 메모이제이션을 유지한다. 드래그 로직이 state가 아닌 ref를 기준으로
  // 동작하도록 바뀌어서, 리렌더를 건너뛴 행이 낡은 핸들러를 들고 있어도 항상 최신
  // 순서를 읽는다. 예전에는 여기서 메모이제이션을 꺼버려 dragover가 발생할 때마다
  // 목록 전체가 다시 그려졌고, 종목이 많으면 드래그가 눈에 띄게 버벅였다.
  return (
    prev.item === next.item &&
    prev.livePrice === next.livePrice &&
    prev.isDragging === next.isDragging &&
    prev.isDragOver === next.isDragOver &&
    !!prev.onAddToPortfolio === !!next.onAddToPortfolio
  );
});

/* ── 관심종목 → 포트폴리오 추가 미니 모달 ─────────────────── */
