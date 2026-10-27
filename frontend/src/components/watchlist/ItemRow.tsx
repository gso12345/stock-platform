import { memo, useState, useRef } from "react";
import { ChangeBadge, MarketBadge } from "@/components/ui";
import { Trash2, Wallet, Settings2 } from "lucide-react";
import { normalizeSymbol } from "@/utils/prices";
import { fmtKRWFull, fmtUSDFull } from "@/utils/formatters";
import LivePrice from "@/components/ui/LivePrice";
import { 등락표시 } from "@/components/common/StockTable";
import { 돈글, 부호글, 적자인가 } from "@/components/screening/screeningDefs";
import type { 관심지표 } from "@/api/screening";

/* ── 넓은 화면(lg)의 표 ──
   휴대폰 목록을 PC 에서 그대로 늘리면 이름은 왼쪽 끝, 가격은 오른쪽 끝에 놓이고 그 사이 1,000px 이
   비었다(사용자: "관심종목 PC버전에서도 최적화된 화면"). 넓은 화면에서는 칸을 나눠 표로 그리고, 빈자리에
   시가총액·PER·배당·52주 위치·1개월 수익률(스크리닝 표의 값)을 둔다. 휴대폰 모양은 그대로다. */
export const 관심표칸 =
  "lg:grid lg:grid-cols-[1rem_minmax(10rem,2.2fr)_minmax(7.5rem,1.3fr)_repeat(5,minmax(4.75rem,1fr))_5.5rem] lg:items-center lg:gap-x-3";
/** 끌기 손잡이·단추가 없는 줄(최근조회·포트폴리오 탭·미리보기)의 칸 */
export const 간단표칸 =
  "lg:grid lg:grid-cols-[minmax(10rem,2.2fr)_minmax(7.5rem,1.3fr)_repeat(5,minmax(4.75rem,1fr))] lg:items-center lg:gap-x-3";

/** 카드 맨 위의 칸 이름 줄 — 넓은 화면에서만. 간단 — 끌기 손잡이·단추 칸이 없는 줄들 위 */
export function 관심표머리({ 간단 = false }: { 간단?: boolean }) {
  const 칸 = "text-right";
  return (
    <div className={`hidden ${간단 ? 간단표칸 : 관심표칸} px-3 py-2 border-b border-border/50 text-2xs font-medium text-text-muted bg-bg-elevated/40`}
      aria-hidden>
      {!간단 && <span />}
      <span>종목</span>
      <span className={칸}>현재가</span>
      <span className={칸}>시가총액</span>
      <span className={칸}>PER</span>
      <span className={칸}>배당수익률</span>
      <span className={칸}>52주 고점 대비</span>
      <span className={칸}>1개월</span>
      {!간단 && <span />}
    </div>
  );
}

/** 끌기·밀기 없는 줄(최근조회·포트폴리오 탭·미리보기). 넓은 화면에서는 관심종목 표와 같은 칸이다.
 *  휴대폰에서는 예전처럼 시장 배지가 맨 앞, 넓은 화면에서는 이름 옆(종목 칸 안) */
export function 간단관심줄({ market, symbol, name, price, change, change_rate, 시세없음글 = "조회 중", 지표, onNavigate }: {
  market: string; symbol: string; name: string;
  price?: number | null; change?: number | null; change_rate?: number | null;
  /** 시세가 없을 때의 글 — 기다리면 오는지('조회 중'), 원래 없는지('시세 없음') */
  시세없음글?: string;
  지표?: 관심지표;
  onNavigate: () => void;
}) {
  const isKR = market === "KR";
  const hasPrice = price != null && Number(price) > 0;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`flex items-center gap-2 px-3 py-2.5 border-b border-border/30 bg-bg-card hover:bg-bg-hover cursor-pointer transition-colors ${간단표칸}`}
      onClick={onNavigate}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate(); } }}
    >
      <span className="lg:hidden flex-shrink-0"><MarketBadge market={market} /></span>
      <div className="flex-1 min-w-0">
        {/* 이름이 먼저다. 사람은 "삼성전자" 로 찾지 "005930" 으로 찾지 않는다 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-base font-semibold text-text-primary truncate">{name}</span>
          <span className="hidden lg:inline-flex flex-shrink-0"><MarketBadge market={market} /></span>
        </div>
        <div className="font-mono text-xs text-text-muted">{normalizeSymbol(symbol)}</div>
      </div>
      <div className="text-right flex-shrink-0 min-w-[80px]">
        <div className="text-sm font-mono font-semibold text-text-primary">
          {hasPrice
            ? (isKR ? fmtKRWFull(Number(price)) : fmtUSDFull(Number(price)))
            : <span className="text-text-muted text-xs">{시세없음글}</span>}
        </div>
        {hasPrice && change_rate != null && (
          <ChangeBadge value={Number(change_rate)} className="text-xs"
            금액={change != null ? Number(change) : null} 통화={isKR ? "KRW" : "USD"} />
        )}
      </div>
      <지표칸들 지표={지표} 국내={isKR} />
    </div>
  );
}

/** 넓은 화면의 지표 칸들 — 값이 없으면(서버 표가 아직 없거나 그 종목을 모르면) — */
function 지표칸들({ 지표, 국내 }: { 지표?: 관심지표; 국내: boolean }) {
  const 없음 = <span className="text-text-dim">—</span>;
  const 수 = (v: number | undefined, 글: (v: number) => string) =>
    typeof v === "number" && Number.isFinite(v) ? 글(v) : null;
  /* 적자면 PER 이 없다 — 스크리닝 표처럼 '—'(모름)과 갈라 적는다 */
  const 적자 = <span className="text-text-dim" title="이익이 0 밑이라 PER 을 셀 수 없다">적자</span>;
  const 칸들 = [
    수(지표?.market_cap, (v) => 돈글(v, 국내 ? "KRW" : (지표?.currency ?? "USD"))),
    수(지표?.per, (v) => v.toFixed(1)) ?? (적자인가(지표) ? 적자 : null),
    수(지표?.dividend_yield, (v) => `${v.toFixed(2)}%`),
    수(지표?.pct_from_52w_high, (v) => 부호글(v, 1)),
  ];
  return (
    <>
      {칸들.map((글, i) => (
        <span key={i} className="hidden lg:block text-right font-mono num text-xs text-text-secondary">{글 ?? 없음}</span>
      ))}
      <span className="hidden lg:block text-right text-xs">
        {typeof 지표?.return_1m === "number" && Number.isFinite(지표.return_1m) ? <등락표시 값={지표.return_1m} /> : 없음}
      </span>
    </>
  );
}

const SWIPE_REVEAL = 210;   // 수정(70) + 보유종목추가(70) + 삭제(70)
const SWIPE_THRESHOLD = 50;

/* ── 종목 행: 드래그 재정렬 + 왼쪽으로 스와이프 → 수정/삭제 ─── */
export const ItemRow = memo(function ItemRow({ item, livePrice, 지표, onRemove, onNavigate, onEdit, onPrefetch, onAddToPortfolio,
  isDragging, isDragOver, onDragStart, onDragOver, onDrop,
  onTouchDragStart, onTouchDragMove, onTouchDragEnd }: {
  item: any; livePrice: any;
  /** 넓은 화면의 표 칸(스크리닝 표의 시가총액·PER …) */
  지표?: 관심지표;
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
      /* 누를 낌새가 보이면 그 종목만 미리 받는다 — 마우스는 올릴 때,
         손가락은 닿을 때, 키보드는 초점이 올 때 */
      onMouseEnter={onPrefetch} onPointerDown={onPrefetch} onFocus={onPrefetch}
    >
      {/* 스와이프 액션 버튼 (오른쪽 고정, 왼쪽으로 밀면 등장) */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: SWIPE_REVEAL }}>
        <button onClick={() => { closeSwipe(); onEdit(); }} aria-label="종목 수정"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-accent-blue text-white text-2xs font-semibold">
          <Settings2 size={14}/><span>수정</span>
        </button>
        {onAddToPortfolio && (
          <button onClick={() => { closeSwipe(); onAddToPortfolio(); }} aria-label="보유종목 추가"
            className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-accent-green text-white text-2xs font-semibold">
            <Wallet size={14}/><span>보유추가</span>
          </button>
        )}
        <button onClick={() => { closeSwipe(); onRemove(); }} aria-label="종목 삭제"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-accent-red text-white text-2xs font-semibold">
          <Trash2 size={14}/><span>삭제</span>
        </button>
      </div>

      {/* 슬라이드 콘텐츠 */}
      <div
        className={`flex items-center gap-2 px-3 py-3 bg-bg-card hover:bg-bg-hover transition-colors ${관심표칸}`}
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
          {/* 이름이 먼저다.
              사람은 "삼성전자" 로 종목을 찾지 "005930" 으로 찾지 않는다.
              순위·보유종목은 이미 이렇게 그리고 있었는데 관심종목만
              거꾸로였다 — 세 화면이 종목을 서로 다르게 그리던 것 자체가
              '통일 안 된 느낌' 의 원인이었다. */}
          <div className="flex items-center gap-1.5">
            <span className="text-base font-semibold text-text-primary truncate">
              {item.name || p.name || normalizeSymbol(item.symbol ?? "")}
            </span>
            {livePrice && <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse flex-shrink-0"/>}
            <MarketBadge market={item.market} />
          </div>
          <div className="font-mono text-xs text-text-muted">{normalizeSymbol(item.symbol ?? "")}</div>
          {item.memo && <div className="text-2xs text-text-muted/60 italic mt-0.5">{item.memo}</div>}
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
          {hasPrice && p.change_rate != null && (
            <ChangeBadge value={Number(p.change_rate)} className="text-xs"
              금액={p.change != null ? Number(p.change) : null}
              통화={isKR ? "KRW" : "USD"} />
          )}
        </div>

        <지표칸들 지표={지표} 국내={isKR} />

        <div className="flex items-center flex-shrink-0 lg:justify-end">
          {/* 포트폴리오 추가 버튼 */}
          {onAddToPortfolio && (
            <button onClick={(e) => { e.stopPropagation(); onAddToPortfolio(); }} className="text-text-muted hover:text-accent-green p-1.5 rounded-lg hover:bg-accent-green/10 transition-colors flex-shrink-0" title="포트폴리오에 추가"><Wallet size={14}/></button>
          )}
          {/* 편집/삭제 버튼 (데스크탑 hover) */}
          <div className="hidden md:flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button aria-label="종목 수정" onClick={onEdit}   className="text-text-muted hover:text-accent-blue p-1.5 rounded-lg hover:bg-accent-blue/10 transition-colors"><Settings2 size={13}/></button>
            <button aria-label="종목 삭제" onClick={onRemove} className="text-text-muted hover:text-accent-red  p-1.5 rounded-lg hover:bg-accent-red/10  transition-colors"><Trash2 size={13}/></button>
          </div>
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
    prev.지표 === next.지표 &&
    prev.isDragging === next.isDragging &&
    prev.isDragOver === next.isDragOver &&
    !!prev.onAddToPortfolio === !!next.onAddToPortfolio
  );
});

/* ── 관심종목 → 포트폴리오 추가 미니 모달 ─────────────────── */
