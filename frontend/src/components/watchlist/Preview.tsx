import { memo } from "react";
import { ChangeBadge, MarketBadge } from "@/components/ui";
import { normalizeSymbol } from "@/utils/prices";
import { fmtKRWFull, fmtUSDFull } from "@/utils/formatters";

/* ── 미리보기 예시 데이터 (비로그인 시 표시) ── */
export interface PreviewItem {
  id: number; symbol: string; market: string; name: string;
  folderId: number; price: number; change_rate: number; hasPrice?: boolean;
  /** 얼마가 올랐는지. 퍼센트만 보면 3% 가 300원인지 3만원인지 모른다 */
  change?: number | null;
}
export interface PreviewFolder { id: number; name: string; }

/* 폴더는 '이런 식으로 묶어 쓰는 화면'임을 보여주는 자리다. 주식만 있으면
   폴더가 왜 필요한지 와닿지 않으므로, 성격이 다른 묶음을 하나 둔다. */
export const PREVIEW_FOLDERS: PreviewFolder[] = [
  { id: -1, name: "국내 우량주" },
  { id: -2, name: "해외 성장주" },
  { id: -3, name: "ETF" },
  { id: -4, name: "금·채권" },
];
export const PREVIEW_WATCHLIST: PreviewItem[] = [
  { id: -1, symbol: "005930", market: "KR",  name: "삼성전자",          folderId: -1, price: 72400,  change_rate:  0.58 },
  { id: -2, symbol: "000660", market: "KR",  name: "SK하이닉스",        folderId: -1, price: 198500, change_rate:  1.33 },
  { id: -3, symbol: "005380", market: "KR",  name: "현대차",             folderId: -1, price: 218000, change_rate:  0.93 },
  { id: -4, symbol: "NVDA",   market: "US",  name: "엔비디아",           folderId: -2, price: 135.58, change_rate:  2.14 },
  { id: -5, symbol: "AAPL",   market: "US",  name: "애플",               folderId: -2, price: 221.85, change_rate:  0.73 },
  { id: -6, symbol: "MSFT",   market: "US",  name: "마이크로소프트",      folderId: -2, price: 510.32, change_rate:  0.47 },
  { id: -7, symbol: "GOOGL",  market: "US",  name: "알파벳A",            folderId: -2, price: 197.45, change_rate:  0.61 },
  { id: -8, symbol: "AMZN",   market: "US",  name: "아마존",             folderId: -2, price: 225.10, change_rate:  1.02 },
  { id: -9, symbol: "META",   market: "US",  name: "메타",               folderId: -2, price: 636.20, change_rate:  1.38 },
  { id: -10, symbol: "TSLA",  market: "US",  name: "테슬라",             folderId: -2, price: 247.15, change_rate: -0.94 },
  { id: -11, symbol: "SPY",   market: "ETF", name: "SPDR S&P 500 ETF",  folderId: -3, price: 534.21, change_rate:  0.41 },
  { id: -12, symbol: "QQQ",   market: "ETF", name: "Invesco QQQ Trust", folderId: -3, price: 461.83, change_rate:  0.89 },
  { id: -13, symbol: "GLD",   market: "ETF", name: "SPDR 골드 ETF",      folderId: -4, price: 244.10, change_rate:  0.35 },
  { id: -14, symbol: "TLT",   market: "ETF", name: "미국 장기국채 ETF",   folderId: -4, price:  88.42, change_rate: -0.28 },
];

export const PreviewItemRow = memo(function PreviewItemRow({ item, onNavigate }: { item: PreviewItem; onNavigate: () => void }) {
  const isKR = item.market === "KR";
  const hasPrice = item.hasPrice !== false;
  return (
    <div
      role="button"
      tabIndex={0}
      className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30 bg-bg-card hover:bg-bg-hover cursor-pointer transition-colors"
      onClick={onNavigate}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate(); } }}
    >
      {/* 마켓 배지 */}
      <MarketBadge market={item.market} />
      {/* 종목 정보 */}
      <div className="flex-1 min-w-0">
        <div className="font-mono font-bold text-sm text-text-primary">
          {normalizeSymbol(item.symbol)}
        </div>
        <div className="text-xs text-text-muted truncate">{item.name}</div>
      </div>
      {/* 가격 */}
      <div className="text-right flex-shrink-0 min-w-[80px]">
        <div className="text-sm font-mono font-semibold text-text-primary">
          {hasPrice
            ? (isKR ? fmtKRWFull(item.price) : fmtUSDFull(item.price))
            : <span className="text-text-muted text-xs">조회 중</span>}
        </div>
        {hasPrice && <ChangeBadge value={item.change_rate} className="text-xs"
          금액={item.change ?? null} 통화={item.market === "KR" ? "KRW" : "USD"} />}
      </div>
    </div>
  );
});

/* ── 검색 기반 종목 추가 모달 ─────────────────────────────── */
