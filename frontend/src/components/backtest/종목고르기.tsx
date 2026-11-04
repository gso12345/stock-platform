/**
 * 단일 종목 백테스트의 종목 — 이름으로 찾아 고른다(사용자가 고른 7번).
 *
 * 예전에는 시장(US·KR)을 먼저 고르고 '005930.KS' 같은 코드를 직접 쳐야 했다. 코드를 외우는 사람만 쓸 수 있었고,
 * 국내 종목은 꼬리(.KS·.KQ)까지 알아야 했다. 이제 피드 글쓰기처럼 이름·코드로 찾아 누른다 — 시장도 고른 종목에서
 * 정해진다(서버가 국내 여섯 자리 코드의 꼬리를 알아서 붙인다).
 */
import { useState } from "react";
import { Search, X } from "lucide-react";
import { MarketBadge } from "@/components/ui";
import { useStockSearch } from "@/hooks/useStockSearch";
import type { Market } from "@/types";

export interface 고른종목 { symbol: string; market: Market; name: string }

/** 처음 고른 종목, 그리고 저장한 전략의 시장이 지금 종목과 다를 때 바꿔 넣을 종목 */
export const 기본종목: Record<"KR" | "US", 고른종목> = {
  US: { symbol: "AAPL", market: "US", name: "Apple" },
  KR: { symbol: "005930", market: "KR", name: "삼성전자" },
};

/** 검색 결과의 시장을 백테스트가 받는 시장으로 */
export function 시장으로(m: string | undefined): Market {
  return m === "KR" || m === "ETF" ? m : "US";
}

export default function 종목고르기({ 고른것, 고르기 }: { 고른것: 고른종목; 고르기: (x: 고른종목) => void }) {
  const { query, setQuery, results, searching } = useStockSearch();
  const [찾기, set찾기] = useState(false);
  const 닫기 = () => { set찾기(false); setQuery(""); };

  if (!찾기) {
    return (
      <button type="button" onClick={() => set찾기(true)} aria-label={`테스트 종목 ${고른것.name} 바꾸기`}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-bg-elevated text-left hover:border-accent-blue/50 transition-colors">
        <MarketBadge market={고른것.market} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text-primary truncate">{고른것.name}</span>
          <span className="block text-2xs text-text-dim num">{고른것.symbol}</span>
        </span>
        <span className="text-xs font-medium text-accent-blue flex-shrink-0">바꾸기</span>
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
        <input autoFocus type="search" aria-label="종목 검색" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="종목명 또는 코드 (예: 삼성전자, AAPL)" maxLength={40}
          // 브라우저가 search 칸에 따로 붙이는 지우기(×)는 감춘다 — 오른쪽 '검색 닫기' 와 × 가 둘이 된다
          className="w-full pl-9 pr-10 py-2.5 bg-bg-primary border border-border rounded-xl text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue [&::-webkit-search-cancel-button]:hidden" />
        <button type="button" aria-label="검색 닫기" onClick={닫기}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-text-dim hover:text-text-primary">
          <X size={16} />
        </button>
      </div>
      {searching && <p className="text-xs text-text-dim px-1">찾는 중…</p>}
      {!searching && query.trim() && results.length === 0 && (
        <p className="text-xs text-text-dim px-1">찾는 종목이 없어요</p>
      )}
      {results.length > 0 && (
        <ul className="flex flex-col max-h-64 overflow-y-auto rounded-xl border border-border divide-y divide-border">
          {results.slice(0, 20).map((x) => (
            <li key={`${x.market}:${x.symbol}`}>
              <button type="button" aria-label={`${x.name || x.symbol} 고르기`}
                onClick={() => { 고르기({ symbol: x.symbol, market: 시장으로(x.market), name: x.name || x.symbol }); 닫기(); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-bg-elevated transition-colors">
                <MarketBadge market={시장으로(x.market)} />
                <span className="text-sm text-text-primary truncate flex-1">{x.name || x.symbol}</span>
                <span className="text-2xs text-text-dim flex-shrink-0 num">{x.symbol}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
