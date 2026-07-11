import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Clock, TrendingUp, Plus, Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "@/api/client";
import { watchlistApi, watchlistFolderApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";

interface SR {
  symbol: string;
  name: string;
  market: string;
  type: string;
  exchange: string;
  price?: number | null;
  change_rate?: number | null;
  currency?: string;
}

const MARKET_STYLE: Record<string, string> = {
  KR:  "bg-blue-900/50 text-blue-300 border-blue-700/40",
  US:  "bg-emerald-900/50 text-emerald-300 border-emerald-700/40",
  ETF: "bg-violet-900/50 text-violet-300 border-violet-700/40",
};

const POPULAR: SR[] = [
  {symbol:"AAPL",     name:"Apple Inc.",        market:"US",  type:"EQUITY",exchange:"NASDAQ"},
  {symbol:"NVDA",     name:"NVIDIA Corporation",market:"US",  type:"EQUITY",exchange:"NASDAQ"},
  {symbol:"TSLA",     name:"Tesla Inc.",         market:"US",  type:"EQUITY",exchange:"NASDAQ"},
  {symbol:"005930.KS",name:"삼성전자",           market:"KR",  type:"EQUITY",exchange:"KOSPI"},
  {symbol:"000660.KS",name:"SK하이닉스",         market:"KR",  type:"EQUITY",exchange:"KOSPI"},
  {symbol:"035420.KS",name:"NAVER",             market:"KR",  type:"EQUITY",exchange:"KOSPI"},
  {symbol:"SPY",      name:"S&P 500 ETF",       market:"ETF", type:"ETF",   exchange:"NYSE"},
  {symbol:"035720.KQ",name:"카카오",             market:"KR",  type:"EQUITY",exchange:"KOSDAQ"},
];

const RECENT_KEY = "sp_recent_v2";
const getRecent  = (): SR[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)??"[]"); } catch { return []; } };
const saveRecent = (i: SR)  => { const p=[i,...getRecent().filter(r=>r.symbol!==i.symbol)].slice(0,8); localStorage.setItem(RECENT_KEY,JSON.stringify(p)); };

export default function SearchBar() {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<SR[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor]   = useState(0);
  const [recent, setRecent]   = useState<SR[]>([]);
  const [added, setAdded]     = useState<Set<string>>(new Set());
  const [folderDropdown, setFolderDropdown] = useState<string | null>(null);

  const inputRef          = useRef<HTMLInputElement>(null);
  const containerRef      = useRef<HTMLDivElement>(null);
  const folderDropdownRef = useRef<HTMLDivElement>(null);
  const debounce          = useRef<ReturnType<typeof setTimeout>|null>(null);

  const { data: folders = [] } = useQuery({
    queryKey: ["watchlist-folders"],
    queryFn: () => watchlistFolderApi.getFolders(),
    enabled: isLoggedIn,
    staleTime: 60_000,
  });

  /* 폴더 드롭다운 외부 클릭 닫기 */
  useEffect(() => {
    if (!folderDropdown) return;
    const h = (e: MouseEvent) => {
      if (folderDropdownRef.current && !folderDropdownRef.current.contains(e.target as Node)) {
        setFolderDropdown(null);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [folderDropdown]);

  const openSearch = () => {
    setRecent(getRecent());
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setFolderDropdown(null);
    inputRef.current?.blur();
  }, []);

  /* Esc 닫기 */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) closeSearch();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, closeSearch]);

  /* 외부 클릭 닫기 */
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) closeSearch();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, closeSearch]);

  /* 검색 */
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const { data } = await api.get<{ results: SR[] }>("/search", { params: { q: query } });
        setResults(data.results ?? []);
        setCursor(0);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
  }, [query]);

  const goTo = useCallback((item: SR) => {
    saveRecent(item);
    closeSearch();
    navigate(`/stocks/${item.market}/${encodeURIComponent(item.symbol)}`);
  }, [navigate]);

  const doAdd = useCallback(async (item: SR, folderId?: number | null) => {
    setFolderDropdown(null);
    try {
      await watchlistApi.addItem({ symbol: item.symbol, market: item.market as any, name: item.name, watchlist_id: 1, folder_id: folderId ?? undefined });
      setAdded(prev => new Set([...prev, item.symbol]));
      setTimeout(() => setAdded(prev => { const n = new Set(prev); n.delete(item.symbol); return n; }), 3000);
    } catch {}
  }, []);

  const handlePlusClick = useCallback((e: React.MouseEvent, item: SR) => {
    e.stopPropagation();
    if (!isLoggedIn) {
      closeSearch();
      navigate("/login");
      return;
    }
    const folderList = folders as any[];
    if (folderList.length > 0) {
      setFolderDropdown(prev => prev === item.symbol ? null : item.symbol);
      return;
    }
    doAdd(item, null);
  }, [isLoggedIn, navigate, folders, doAdd, closeSearch]);

  const activeList = query ? results : POPULAR;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, activeList.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter" && activeList[cursor]) { e.preventDefault(); goTo(activeList[cursor]); }
  };

  const fmtPrice = (item: SR) => {
    if (!item.price) return null;
    return item.market === "KR" ? `₩${item.price.toLocaleString("ko-KR")}` : `$${item.price.toFixed(2)}`;
  };

  const dispSym = (s: string) => s.replace(".KS","").replace(".KQ","");

  return (
    <div ref={containerRef} className="relative w-full max-w-xs md:max-w-sm">
      {/* 검색 입력창 */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
        open ? "border-accent-blue/60 bg-bg-card shadow-lg" : "border-border bg-bg-elevated hover:border-border-light"
      }`}>
        <Search size={13} className="text-text-muted flex-shrink-0" />
        <input
          ref={inputRef}
          className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted focus:outline-none min-w-0"
          placeholder="종목 검색..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={openSearch}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {loading && <div className="w-3.5 h-3.5 border border-accent-blue border-t-transparent rounded-full animate-spin flex-shrink-0"/>}
        {query && !loading && (
          <button onMouseDown={(e) => { e.preventDefault(); setQuery(""); setResults([]); inputRef.current?.focus(); }}
            className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0">
            <X size={13}/>
          </button>
        )}
      </div>

      {/* 드롭다운 */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-border bg-bg-card shadow-xl z-50 overflow-hidden slide-up"
             style={{ maxHeight: 420 }}>

          {/* 검색 결과 없음 */}
          {query && !loading && results.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-text-muted text-sm">"{query}"에 대한 결과 없음</p>
              <p className="text-text-dim text-xs mt-1">예: <span className="font-mono">005930</span> · <span className="font-mono">AAPL</span> · <span className="font-mono">삼성전자</span></p>
            </div>
          )}

          {/* 검색 결과 */}
          {query && results.length > 0 && (
            <ul className="overflow-y-auto" style={{ maxHeight: 380 }}>
              {results.map((item, i) => {
                const isAdded = added.has(item.symbol);
                const priceStr = fmtPrice(item);
                return (
                  <li key={item.symbol}>
                    <div className={`flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0 cursor-pointer transition-colors ${
                      i === cursor ? "bg-bg-elevated" : "hover:bg-bg-hover"
                    }`}
                      onMouseDown={(e) => { e.preventDefault(); goTo(item); }}
                      onMouseEnter={() => setCursor(i)}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-black border ${MARKET_STYLE[item.market] ?? MARKET_STYLE.US}`}>
                        {item.market === "ETF" ? "ETF" : item.market}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-sm text-text-primary">{dispSym(item.symbol)}</span>
                          <span className="text-2xs text-text-dim">{item.exchange}</span>
                        </div>
                        <p className="text-xs text-text-muted truncate">{item.name}</p>
                      </div>
                      {priceStr && (
                        <div className="text-right flex-shrink-0 mr-1">
                          <div className="text-xs font-mono text-text-primary">{priceStr}</div>
                          {item.change_rate != null && (
                            <div className={`text-2xs font-mono ${item.change_rate >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                              {item.change_rate >= 0 ? "+" : ""}{item.change_rate.toFixed(2)}%
                            </div>
                          )}
                        </div>
                      )}
                      <div className="relative flex-shrink-0" ref={folderDropdown === item.symbol ? folderDropdownRef : null}>
                        <button onMouseDown={(e) => { e.preventDefault(); handlePlusClick(e, item); }}
                          className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
                            isAdded ? "bg-accent-green/20 text-accent-green" : "bg-bg-elevated text-text-muted hover:bg-accent-blue/20 hover:text-accent-blue"
                          }`} title={isAdded ? "추가됨" : "관심종목 추가"}>
                          {isAdded ? <Check size={11}/> : <Plus size={11}/>}
                        </button>
                        {folderDropdown === item.symbol && (
                          <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-xl border border-border bg-bg-card shadow-lg overflow-hidden">
                            {(folders as any[]).map((f: any, idx: number) => (
                              <button
                                key={f.id}
                                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); doAdd(item, f.id); }}
                                className={`w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-bg-elevated transition-colors truncate ${idx > 0 ? "border-t border-border" : ""}`}
                              >
                                {f.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* 기본 화면 (쿼리 없을 때) */}
          {!query && (
            <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
              {/* 최근 검색 */}
              {recent.length > 0 && (
                <>
                  <div className="px-3 pt-3 pb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Clock size={10} className="text-text-dim"/>
                      <span className="text-2xs font-semibold text-text-dim uppercase tracking-widest">최근 검색</span>
                    </div>
                    <button onMouseDown={(e) => { e.preventDefault(); localStorage.removeItem(RECENT_KEY); setRecent([]); }}
                      className="text-2xs text-text-dim hover:text-text-muted transition-colors">전체 삭제</button>
                  </div>
                  {recent.map(item => (
                    <div key={item.symbol}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-bg-hover cursor-pointer border-b border-border last:border-0 transition-colors"
                      onMouseDown={(e) => { e.preventDefault(); goTo(item); }}
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-black border ${MARKET_STYLE[item.market] ?? MARKET_STYLE.US}`}>
                        {item.market === "ETF" ? "E" : item.market}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-mono font-bold text-sm text-text-primary">{dispSym(item.symbol)}</span>
                        <p className="text-xs text-text-muted truncate">{item.name}</p>
                      </div>
                      <button onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); const n = getRecent().filter(r => r.symbol !== item.symbol); localStorage.setItem(RECENT_KEY, JSON.stringify(n)); setRecent(n); }}
                        className="text-text-dim hover:text-text-muted p-1 flex-shrink-0 transition-colors"><X size={11}/></button>
                    </div>
                  ))}
                </>
              )}

              {/* 인기 종목 */}
              <div className="px-3 pt-3 pb-1.5">
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={10} className="text-text-dim"/>
                  <span className="text-2xs font-semibold text-text-dim uppercase tracking-widest">인기 종목</span>
                </div>
              </div>
              {POPULAR.map((item, i) => {
                const isAdded = added.has(item.symbol);
                return (
                  <div key={item.symbol}
                    className={`flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0 cursor-pointer transition-colors ${i === cursor ? "bg-bg-elevated" : "hover:bg-bg-hover"}`}
                    onMouseDown={(e) => { e.preventDefault(); goTo(item); }}
                    onMouseEnter={() => setCursor(i)}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-black border ${MARKET_STYLE[item.market] ?? MARKET_STYLE.US}`}>
                      {item.market === "ETF" ? "E" : item.market}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-sm text-text-primary">{dispSym(item.symbol)}</span>
                        <span className="text-2xs text-text-dim">{item.exchange}</span>
                      </div>
                      <p className="text-xs text-text-muted truncate">{item.name}</p>
                    </div>
                    <div className="relative flex-shrink-0" ref={folderDropdown === item.symbol ? folderDropdownRef : null}>
                      <button onMouseDown={(e) => { e.preventDefault(); handlePlusClick(e, item); }}
                        className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
                          isAdded ? "bg-accent-green/20 text-accent-green" : "bg-bg-elevated text-text-muted hover:bg-accent-blue/20 hover:text-accent-blue"
                        }`} title={isAdded ? "추가됨" : "관심종목 추가"}>
                        {isAdded ? <Check size={11}/> : <Plus size={11}/>}
                      </button>
                      {folderDropdown === item.symbol && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-xl border border-border bg-bg-card shadow-lg overflow-hidden">
                          {(folders as any[]).map((f: any, idx: number) => (
                            <button
                              key={f.id}
                              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); doAdd(item, f.id); }}
                              className={`w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-bg-elevated transition-colors truncate ${idx > 0 ? "border-t border-border" : ""}`}
                            >
                              {f.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
