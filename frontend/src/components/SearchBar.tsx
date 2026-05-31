import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Clock, TrendingUp, Plus, Check, Filter } from "lucide-react";
import api from "@/api/client";
import { watchlistApi } from "@/api/stocks";

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
  {symbol:"MSFT",     name:"Microsoft Corp.",   market:"US",  type:"EQUITY",exchange:"NASDAQ"},
  {symbol:"TSLA",     name:"Tesla Inc.",         market:"US",  type:"EQUITY",exchange:"NASDAQ"},
  {symbol:"005930.KS",name:"삼성전자",           market:"KR",  type:"EQUITY",exchange:"KOSPI"},
  {symbol:"000660.KS",name:"SK하이닉스",         market:"KR",  type:"EQUITY",exchange:"KOSPI"},
  {symbol:"035420.KS",name:"NAVER",             market:"KR",  type:"EQUITY",exchange:"KOSPI"},
  {symbol:"SPY",      name:"S&P 500 ETF",       market:"ETF", type:"ETF",   exchange:"NYSE"},
  {symbol:"QQQ",      name:"NASDAQ 100 ETF",    market:"ETF", type:"ETF",   exchange:"NASDAQ"},
  {symbol:"035720.KQ",name:"카카오",             market:"KR",  type:"EQUITY",exchange:"KOSDAQ"},
];

const RECENT_KEY = "sp_recent_v2";
const getRecent  = (): SR[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)??"[]"); } catch { return []; } };
const saveRecent = (i: SR)  => { const p=[i,...getRecent().filter(r=>r.symbol!==i.symbol)].slice(0,8); localStorage.setItem(RECENT_KEY,JSON.stringify(p)); };

export default function SearchBar() {
  const navigate = useNavigate();
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState("");
  const [marketFilter, setMarketFilter] = useState("ALL");
  const [results, setResults] = useState<SR[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor]   = useState(0);
  const [recent, setRecent]   = useState<SR[]>([]);
  const [added, setAdded]     = useState<Set<string>>(new Set());

  const inputRef  = useRef<HTMLInputElement>(null);
  const panelRef  = useRef<HTMLDivElement>(null);
  const debounce  = useRef<ReturnType<typeof setTimeout>|null>(null);
  const composing = useRef(false);

  /* 열기/닫기 */
  const openModal  = () => { setRecent(getRecent()); setOpen(true); setTimeout(()=>inputRef.current?.focus(),30); };
  const closeModal = () => { setOpen(false); setQuery(""); setResults([]); };

  /* 단축키 */
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{
      if((e.ctrlKey||e.metaKey)&&e.key==="k"){ e.preventDefault(); openModal(); }
      if(e.key==="Escape"&&open) closeModal();
    };
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
  },[open]);

  /* 외부 클릭 */
  useEffect(()=>{
    if(!open) return;
    const h=(e:MouseEvent)=>{ if(panelRef.current&&!panelRef.current.contains(e.target as Node)) closeModal(); };
    document.addEventListener("mousedown",h);
    return ()=>document.removeEventListener("mousedown",h);
  },[open]);

  /* 검색 */
  useEffect(()=>{
    if(debounce.current) clearTimeout(debounce.current);
    if(!query.trim()){ setResults([]); setLoading(false); return; }
    setLoading(true);
    debounce.current = setTimeout(async()=>{
      try{
        const {data} = await api.get<{results:SR[]}>("/search",{params:{q:query,market:marketFilter}});
        setResults(data.results??[]);
        setCursor(0);
      }catch{ setResults([]); }
      finally{ setLoading(false); }
    },250);
  },[query,marketFilter]);

  /* 종목 이동 */
  const goTo = useCallback((item:SR)=>{
    saveRecent(item);
    setRecent(getRecent());
    closeModal();
    navigate(`/stocks/${item.market}/${encodeURIComponent(item.symbol)}`);
  },[navigate]);

  /* 관심종목 즉시 추가 */
  const addToWatchlist = useCallback(async(e:React.MouseEvent,item:SR)=>{
    e.stopPropagation();
    try{
      await watchlistApi.addItem({symbol:item.symbol,market:item.market as any,name:item.name,watchlist_id:1});
      setAdded(prev=>new Set([...prev,item.symbol]));
      setTimeout(()=>setAdded(prev=>{const n=new Set(prev);n.delete(item.symbol);return n;}),3000);
    }catch{}
  },[]);

  /* 키보드 */
  const activeList = query ? results : POPULAR;
  const onKeyDown=(e:React.KeyboardEvent<HTMLInputElement>)=>{
    // IME 조합 중(한국어 입력 등)에는 Enter 무시
    if(e.nativeEvent.isComposing) return;
    if(e.key==="ArrowDown"){e.preventDefault();setCursor(c=>Math.min(c+1,activeList.length-1));}
    if(e.key==="ArrowUp"  ){e.preventDefault();setCursor(c=>Math.max(c-1,0));}
    if(e.key==="Enter"&&activeList[cursor]){e.preventDefault();goTo(activeList[cursor]);}
  };

  const fmtPrice=(item:SR)=>{
    if(!item.price) return null;
    return item.market==="KR"?`₩${item.price.toLocaleString("ko-KR")}`:`$${item.price.toFixed(2)}`;
  };

  return(
    <>
      {/* 트리거 버튼 — 클릭 또는 Ctrl+K */}
      <button
        onClick={openModal}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-bg-elevated text-sm w-64 group transition-all cursor-pointer hover:border-accent-blue/40"
        type="button"
      >
        <Search size={13} className="text-text-muted group-hover:text-accent-blue transition-colors flex-shrink-0" />
        <span className="flex-1 text-left text-xs text-text-muted group-hover:text-text-secondary transition-colors">종목 검색 (국내·해외·ETF)...</span>
        <div className="flex gap-0.5 opacity-60">
          <kbd className="text-2xs px-1 py-0.5 rounded font-mono bg-bg-hover border border-border">Ctrl K</kbd>
        </div>
      </button>

      {/* 검색 패널 오버레이 */}
      {open&&(
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-14 px-4 bg-black/60 backdrop-blur-sm">
          <div ref={panelRef} className="w-full max-w-[580px] rounded-2xl overflow-hidden shadow-modal slide-up bg-bg-card border border-border">

            {/* 검색 입력 */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
              <Search size={15} className="text-text-muted flex-shrink-0" />
              <input
                ref={inputRef}
                className="flex-1 bg-transparent text-[15px] text-text-primary placeholder-text-dim focus:outline-none"
                placeholder="종목명 또는 코드  ·  AAPL · 삼성전자 · 005930 · NVDA"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                autoComplete="off"
                spellCheck={false}
              />
              {loading&&<div className="w-4 h-4 border border-accent-blue border-t-transparent rounded-full animate-spin flex-shrink-0"/>}
              {query&&!loading&&(
                <button onMouseDown={(e)=>{e.preventDefault();setQuery("");setResults([]);inputRef.current?.focus();}}
                  className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0"><X size={14}/></button>
              )}
            </div>

            {/* 시장 필터 탭 */}
            <div className="flex gap-1 px-4 py-2 border-b border-border">
              {["ALL","KR","US","ETF"].map(m=>(
                <button key={m} onMouseDown={(e)=>{e.preventDefault();setMarketFilter(m);}}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                    marketFilter===m ? "bg-accent-blue text-white" : "bg-bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {m==="ALL"?"전체":m==="KR"?"국내":m==="US"?"해외":m}
                </button>
              ))}
              <span className="ml-auto text-2xs text-text-dim flex items-center gap-1">
                <Filter size={9}/>
                {query?`${results.length}개 결과`:"검색어 입력"}
              </span>
            </div>

            {/* 결과 목록 */}
            <div className="overflow-y-auto" style={{maxHeight:420}}>

              {/* 검색 없음 */}
              {query&&!loading&&results.length===0&&(
                <div className="py-10 text-center">
                  <p className="text-text-muted text-sm">"{query}"에 대한 결과 없음</p>
                  <p className="text-text-dim text-xs mt-1">6자리 숫자(한국) 또는 영문 티커로 검색하세요</p>
                  <p className="text-text-dim text-xs mt-0.5">예: <span className="font-mono text-text-muted">005930</span> · <span className="font-mono text-text-muted">AAPL</span> · <span className="font-mono text-text-muted">삼성전자</span></p>
                </div>
              )}

              {/* 검색 결과 */}
              {query&&results.length>0&&(
                <ul>
                  {results.map((item,i)=>{
                    const isAdded = added.has(item.symbol);
                    const priceStr = fmtPrice(item);
                    return(
                      <li key={item.symbol}>
                        <div className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 transition-colors cursor-pointer ${
                          i===cursor?"bg-bg-elevated":"hover:bg-bg-hover"
                        }`}
                          onMouseDown={(e)=>{e.preventDefault();goTo(item);}}
                          onMouseEnter={()=>setCursor(i)}
                        >
                          {/* 마켓 배지 */}
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-2xs font-black border ${MARKET_STYLE[item.market]??MARKET_STYLE.US}`}>
                            {item.market==="ETF"?"ETF":item.market}
                          </div>

                          {/* 종목 정보 */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-sm text-text-primary">{item.symbol.replace(".KS","").replace(".KQ","")}</span>
                              {(item as any).ko_name && <span className="text-2xs text-text-muted">{(item as any).ko_name}</span>}
                              <span className="text-2xs text-text-dim">{item.exchange}</span>
                            </div>
                            <p className="text-xs text-text-muted truncate mt-0.5">{item.name}</p>
                          </div>

                          {/* 가격 */}
                          {priceStr&&(
                            <div className="text-right flex-shrink-0 mr-2">
                              <div className="text-xs font-mono text-text-primary">{priceStr}</div>
                              {item.change_rate!=null&&(
                                <div className={`text-2xs font-mono ${item.change_rate>=0?"text-accent-green":"text-accent-red"}`}>
                                  {item.change_rate>=0?"+":""}{item.change_rate.toFixed(2)}%
                                </div>
                              )}
                            </div>
                          )}

                          {/* 관심종목 추가 버튼 */}
                          <button
                            onMouseDown={(e)=>addToWatchlist(e,item)}
                            className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                              isAdded
                                ? "bg-accent-green/20 text-accent-green"
                                : "bg-white/5 text-text-muted hover:bg-accent-blue/20 hover:text-accent-blue"
                            }`}
                            title={isAdded?"추가됨":"관심종목 추가"}
                          >
                            {isAdded?<Check size={12}/>:<Plus size={12}/>}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* 기본 화면 (쿼리 없을 때) */}
              {!query&&(
                <>
                  {/* 최근 검색 */}
                  {recent.length>0&&(
                    <>
                      <div className="px-4 pt-3 pb-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Clock size={10} className="text-text-dim"/>
                          <span className="text-2xs font-semibold text-text-dim uppercase tracking-widest">최근 검색</span>
                        </div>
                        <button onMouseDown={(e)=>{e.preventDefault();localStorage.removeItem(RECENT_KEY);setRecent([]);}}
                          className="text-2xs text-text-dim hover:text-text-muted transition-colors">전체 삭제</button>
                      </div>
                      {recent.map((item,i)=>(
                        <div key={item.symbol}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover cursor-pointer border-b border-border last:border-0 transition-colors"
                          onMouseDown={(e)=>{e.preventDefault();goTo(item);}}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-2xs font-black border ${MARKET_STYLE[item.market]??MARKET_STYLE.US}`}>
                            {item.market==="ETF"?"ETF":item.market}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-mono font-bold text-sm text-white">{item.symbol.replace(".KS","").replace(".KQ","")}</span>
                            <p className="text-xs text-text-muted truncate">{item.name}</p>
                          </div>
                          <button onMouseDown={(e)=>{e.stopPropagation();e.preventDefault();const n=getRecent().filter(r=>r.symbol!==item.symbol);localStorage.setItem(RECENT_KEY,JSON.stringify(n));setRecent(n);}}
                            className="text-text-dim hover:text-text-muted p-1 flex-shrink-0 transition-colors"><X size={11}/></button>
                        </div>
                      ))}
                    </>
                  )}

                  {/* 인기 종목 */}
                  <div className="px-4 pt-3 pb-1.5">
                    <div className="flex items-center gap-1.5">
                      <TrendingUp size={10} className="text-text-dim"/>
                      <span className="text-2xs font-semibold text-text-dim uppercase tracking-widest">인기 종목</span>
                    </div>
                  </div>
                  {POPULAR.map((item,i)=>{
                    const isAdded=added.has(item.symbol);
                    return(
                      <div key={item.symbol}
                        className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 cursor-pointer transition-colors ${i===cursor?"bg-bg-elevated":"hover:bg-bg-hover"}`}
                        onMouseDown={(e)=>{e.preventDefault();goTo(item);}}
                        onMouseEnter={()=>setCursor(i)}
                      >
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-2xs font-black border ${MARKET_STYLE[item.market]??MARKET_STYLE.US}`}>
                          {item.market==="ETF"?"ETF":item.market}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-sm text-white">{item.symbol.replace(".KS","").replace(".KQ","")}</span>
                            <span className="text-2xs text-text-dim">{item.exchange}</span>
                          </div>
                          <p className="text-xs text-text-muted truncate mt-0.5">{item.name}</p>
                        </div>
                        <button
                          onMouseDown={(e)=>addToWatchlist(e,item)}
                          className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                            isAdded?"bg-accent-green/20 text-accent-green":"bg-white/5 text-text-muted hover:bg-accent-blue/20 hover:text-accent-blue"
                          }`}
                        >
                          {isAdded?<Check size={12}/>:<Plus size={12}/>}
                        </button>
                      </div>
                    );
                  })}

                  {/* 빠른 검색 태그 */}
                  <div className="px-4 py-3 border-t border-border">
                    <p className="text-2xs text-text-dim mb-2 uppercase tracking-widest font-semibold">빠른 검색</p>
                    <div className="flex flex-wrap gap-1.5">
                      {["META","AMD","NFLX","COST","GOOGL","JPM","005380.KS","035720.KQ","247540.KQ","SMCI","CRWD","ARM"].map(sym=>(
                        <button key={sym}
                          onMouseDown={(e)=>{e.preventDefault();setQuery(sym);setTimeout(()=>inputRef.current?.focus(),10);}}
                          className="px-2.5 py-1 text-xs font-mono text-text-muted rounded-lg transition-all hover:text-white"
                          className="bg-bg-elevated border border-border"
                        >{sym.replace(".KS","").replace(".KQ","")}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 하단 힌트 */}
            <div className="flex items-center gap-4 px-4 py-2 text-2xs text-text-dim border-t border-border bg-bg-secondary">
              <span><kbd className="px-1 rounded font-mono bg-bg-elevated border border-border">↑↓</kbd> 이동</span>
              <span><kbd className="px-1 rounded font-mono bg-bg-elevated border border-border">Enter</kbd> 상세</span>
              <span><kbd className="px-1 rounded font-mono bg-bg-elevated border border-border">+</kbd> 관심종목</span>
              <span><kbd className="px-1 rounded font-mono bg-bg-elevated border border-border">Esc</kbd> 닫기</span>
              <span className="ml-auto">국내: <span className="font-mono text-text-muted">005930</span> or <span className="font-mono text-text-muted">삼성전자</span></span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
