import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { dashboardApi } from "@/api/stocks";
import { Card, ChangeBadge, LoadingSpinner, formatNumber } from "@/components/ui";
import { useIndicesStream } from "@/hooks/useWebSocket";
import { TrendingUp, TrendingDown, Newspaper, Globe, Flag, ExternalLink, ChevronRight, RefreshCw } from "lucide-react";

const RANK_CATEGORIES = ["시가총액","상승률","하락률","거래대금","거래량"];

function fmtUSD(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/* ── 지수 카드 ───────────────────────────────────────────── */
function IndexCard({ name, value, change, change_rate, _demo, onClick }: any) {
  const pos = (change_rate ?? 0) >= 0;
  return (
    <Card
      className="flex flex-col gap-1 min-w-[145px] cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-2xs text-text-muted font-semibold uppercase tracking-wider truncate">{name}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <ChevronRight size={11} className="text-text-dim group-hover:text-accent-blue transition-colors" />
        </div>
      </div>
      <span className="text-lg font-mono font-bold text-text-primary num">
        {value > 0 ? value.toLocaleString("ko-KR", {maximumFractionDigits:2}) : "—"}
      </span>
      <div className="flex items-center gap-1">
        {pos ? <TrendingUp size={10} className="text-accent-green flex-shrink-0" /> : <TrendingDown size={10} className="text-accent-red flex-shrink-0" />}
        <ChangeBadge value={change_rate ?? 0} className="text-xs" />
      </div>
    </Card>
  );
}

/* ── 환율 / 금리 / 선물 카드 ─────────────────────────────── */
function ExtraCard({ name, value, change, change_rate, unit, _demo, _static }: any) {
  const isRate = unit === "%";
  const numVal = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g,"")) || 0;
  const chgVal = typeof change === "number" ? change : 0;
  const chgrVal = typeof change_rate === "number" ? change_rate : 0;
  const pos = chgVal >= 0;

  const formatted = isRate
    ? numVal.toFixed(2) + "%"
    : numVal > 0
      ? numVal.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + (unit && unit !== "%" ? " " + unit : "")
      : "—";

  return (
    <Card className="flex flex-col gap-1 min-w-[135px] flex-shrink-0">
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-2xs text-text-muted font-semibold truncate">{name}</span>
        {_demo && <span className="text-[8px] px-0.5 rounded bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20">DEMO</span>}
        {_static && <span className="text-[8px] px-0.5 rounded bg-blue-900/20 text-blue-400 border border-blue-700/20">고정</span>}
      </div>
      <span className="text-base font-mono font-bold text-text-primary num">{formatted}</span>
      {(chgVal !== 0 || chgrVal !== 0) && (
        <div className="flex items-center gap-1">
          {pos ? <TrendingUp size={10} className="text-accent-green" /> : <TrendingDown size={10} className="text-accent-red" />}
          <span className={`text-2xs font-mono ${pos ? "text-accent-green" : "text-accent-red"}`}>
            {pos ? "+" : ""}{isRate ? chgVal.toFixed(2) + "bp" : chgVal !== 0 ? chgVal.toFixed(2) : (chgrVal.toFixed(2) + "%")}
          </span>
        </div>
      )}
    </Card>
  );
}

/* ── 순위 테이블 (실시간 가격 반영) ─────────────────────── */
function RankingTable({ items, isKR, onSymbolClick, livePrices }: {
  items: any[]; isKR: boolean; onSymbolClick: (sym: string, mkt: string) => void; livePrices: Record<string, any>;
}) {
  const [showAll, setShowAll] = useState(false);

  if (!items?.length) return <div className="py-8 text-center text-text-muted text-sm">데이터 로딩 중...</div>;

  const dispSym = (s: string) => s.replace(".KS","").replace(".KQ","");
  const visible = showAll ? items : items.slice(0, 10);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-muted border-b border-border">
              <th className="text-left py-2 pl-3 w-7">#</th>
              <th className="text-left py-2">종목</th>
              <th className="text-right py-2">현재가</th>
              <th className="text-right py-2">등락률</th>
              <th className="text-right py-2">시가총액</th>
              <th className="text-right py-2 pr-3">거래량</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item: any) => {
              const mkt   = isKR ? "KR" : "US";
              const live  = livePrices[item.symbol];
              const price = live?.price ?? item.price;
              const chgr  = live?.change_rate ?? item.change_rate ?? 0;
              const hasLive = !!live;
              return (
                <tr key={item.symbol}
                  className="border-b border-border/30 hover:bg-bg-hover cursor-pointer transition-colors"
                  onClick={() => onSymbolClick(item.symbol, mkt)}
                >
                  <td className="py-2.5 pl-3 text-text-muted font-mono font-bold">{item.rank}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-1">
                      <span className="font-mono font-bold text-text-primary">{dispSym(item.symbol)}</span>
                      {hasLive && <span className="w-1 h-1 rounded-full bg-accent-green animate-pulse flex-shrink-0" />}
                    </div>
                    <div className="text-text-muted text-2xs truncate max-w-[100px]">{item.name}</div>
                  </td>
                  <td className="py-2.5 text-right font-mono text-text-primary num">
                    {price ? (isKR ? `₩${price.toLocaleString("ko-KR")}` : `$${price.toFixed(2)}`) : "—"}
                  </td>
                  <td className="py-2.5 text-right">
                    {price ? <ChangeBadge value={chgr} /> : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="py-2.5 text-right font-mono text-text-muted text-[10px]">
                    {item.market_cap ? (isKR ? formatNumber(item.market_cap) : fmtUSD(item.market_cap)) : "—"}
                  </td>
                  <td className="py-2.5 text-right font-mono text-text-muted pr-3">
                    {formatNumber(live?.volume ?? item.volume)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {items.length > 10 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="w-full py-2.5 text-xs font-semibold text-text-muted hover:text-accent-blue hover:bg-bg-elevated transition-all border-t border-border"
        >
          {showAll ? "접기 ▲" : `더보기 (${items.length - 10}개 더) ▼`}
        </button>
      )}
    </div>
  );
}

/* ── 뉴스 패널 ───────────────────────────────────────────── */
const NEWS_INITIAL = 10;

function NewsPanel({ news }: { news: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const [sort, setSort]         = useState<"latest" | "popular">("latest");

  const sorted = sort === "popular"
    ? [...news].sort((a, b) => (b._trend_score ?? 0) - (a._trend_score ?? 0))
    : [...news].sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));

  const shown = expanded ? sorted : sorted.slice(0, NEWS_INITIAL);
  const remaining = sorted.length - NEWS_INITIAL;

  if (!news?.length) return <div className="py-6 text-center text-text-muted text-xs">뉴스 로딩 중...</div>;
  return (
    <div className="flex flex-col">
      {/* 정렬 토글 */}
      <div className="flex gap-1 p-0.5 mb-1">
        {(["latest","popular"] as const).map(s=>(
          <button key={s} onClick={()=>setSort(s)}
            className={`px-2.5 py-1 text-2xs rounded-md font-semibold transition-all ${sort===s?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}>
            {s==="latest"?"최신순":"인기순"}
          </button>
        ))}
      </div>
      {shown.map((item: any, i: number) => (
        <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
          className="flex flex-col gap-0.5 py-2.5 px-1 border-b border-border/40 hover:bg-bg-hover transition-colors group">
          <div className="flex items-start gap-2">
            <span className="flex-1 text-xs text-text-primary group-hover:text-accent-blue transition-colors line-clamp-2 leading-relaxed">
              {item.title}
            </span>
            <ExternalLink size={10} className="text-text-muted mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="flex items-center gap-2 text-2xs text-text-muted">
            <span className="font-medium text-text-dim">{item.source}</span>
            {item.published && <><span>·</span><span>{item.published}</span></>}
          </div>
        </a>
      ))}
      {remaining > 0 && (
        <button onClick={() => setExpanded(!expanded)}
          className="py-2 text-2xs text-accent-blue hover:text-blue-400 transition-colors text-center">
          {expanded ? "접기 ▲" : `더보기 ${remaining}건 ▼`}
        </button>
      )}
    </div>
  );
}

/* ── 국내 탭 ─────────────────────────────────────────────── */
function KRTab({ liveIndices, navigate }: { liveIndices: any; navigate: (p: string) => void }) {
  const [category, setCategory] = useState("시가총액");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["dashboard-kr", category],
    queryFn: () => dashboardApi.getKR(category),
    staleTime: 60_000,
    refetchInterval: 30_000,
  });

  const KR_INDEX_KEYS = ["KOSPI","KOSDAQ","KOSPI200","KOSDAQ150"] as const;
  const KR_DISPLAY: Record<string, string> = {
    KOSPI:"코스피",KOSDAQ:"코스닥",KOSPI200:"코스피 200",KOSDAQ150:"코스닥 150"
  };
  const getIdx = (key: string) => {
    const live = liveIndices?.kr?.find((r: any) => r.index === key);
    const fetched = data?.indices?.find((r: any) => r.index === key);
    return live ?? fetched ?? { value: 0, change: 0, change_rate: 0 };
  };

  // useQuery가 30초마다 갱신하므로 별도 폴링 불필요 — rankings에서 직접 map 구성
  const rankLivePrices = useMemo(() => {
    if (!data?.rankings) return {};
    const map: Record<string, any> = {};
    data.rankings.forEach((r: any) => { map[r.symbol] = r; });
    return map;
  }, [data?.rankings]);

  return (
    <div className="flex flex-col gap-5">
      {/* 지수 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-2xs font-semibold text-text-muted uppercase tracking-widest">국내 지수</h2>
          <button onClick={() => refetch()} className="text-text-muted hover:text-accent-blue transition-colors">
            <RefreshCw size={11} />
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
          {KR_INDEX_KEYS.map((key) => {
            const idx = getIdx(key);
            return <div key={key} className="flex-shrink-0"><IndexCard name={KR_DISPLAY[key]} {...idx} onClick={() => navigate(`/index/${key}`)} /></div>;
          })}
        </div>
      </section>

      {/* 환율 / 금리 */}
      <section>
        <h2 className="text-2xs font-semibold text-text-muted uppercase tracking-widest mb-3">환율 · 금리</h2>
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
          {/* 환율 */}
          {data?.exchange && (
            <ExtraCard
              name="원/달러"
              value={data.exchange.value ?? data.exchange.usdkrw ?? 0}
              change={data.exchange.change ?? 0}
              change_rate={data.exchange.change_rate ?? 0}
              unit="원"
              _demo={data.exchange._demo}
            />
          )}
          {/* 금리 */}
          {data?.rates?.map((r: any) => (
            <ExtraCard key={r.name} {...r} />
          ))}
        </div>
      </section>

      {/* 순위 + 뉴스 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-text-primary">국내주식 순위</h3>
            <div className="flex gap-0.5 bg-bg-primary border border-border rounded-lg p-0.5 flex-wrap">
              {RANK_CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => setCategory(cat)}
                  className={`px-2 py-1 text-2xs font-semibold rounded-md transition-all ${
                    category === cat ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
                  }`}
                >{cat}</button>
              ))}
            </div>
          </div>
          <div>
            {isLoading ? <LoadingSpinner /> : (
              <RankingTable items={data?.rankings ?? []} isKR livePrices={rankLivePrices}
                onSymbolClick={(sym, mkt) => navigate(`/stocks/${mkt}/${encodeURIComponent(sym)}`)} />
            )}
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Newspaper size={14} className="text-text-muted" />
            <h3 className="text-sm font-semibold text-text-primary">국내 금융뉴스</h3>
            {data?.news && <span className="text-2xs text-text-muted ml-auto">{data.news.length}건</span>}
          </div>
          <div className="px-3 py-1">
            {isLoading ? <LoadingSpinner /> : <NewsPanel news={data?.news ?? []} />}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ── 해외 탭 ─────────────────────────────────────────────── */
function USTab({ liveIndices, navigate }: { liveIndices: any; navigate: (p: string) => void }) {
  const [category, setCategory] = useState("시가총액");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["dashboard-us", category],
    queryFn: () => dashboardApi.getUS(category),
    staleTime: 60_000,
    refetchInterval: 30_000,
  });

  const US_INDEX_KEYS = ["SP500","NASDAQ","DOW","SOX","RUSSELL"] as const;
  const US_DISPLAY: Record<string, string> = {
    SP500:"S&P 500", NASDAQ:"나스닥", DOW:"다우 산업", SOX:"필라델피아 반도체", RUSSELL:"러셀 2000"
  };
  const getIdx = (key: string) => {
    const live = liveIndices?.us?.find((r: any) => r.index === key);
    const fetched = data?.indices?.find((r: any) => r.index === key);
    return live ?? fetched ?? { value: 0, change: 0, change_rate: 0 };
  };

  const rankLivePrices = useMemo(() => {
    if (!data?.rankings) return {};
    const map: Record<string, any> = {};
    data.rankings.forEach((r: any) => { map[r.symbol] = r; });
    return map;
  }, [data?.rankings]);

  return (
    <div className="flex flex-col gap-5">
      {/* 지수 + 환율 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-2xs font-semibold text-text-muted uppercase tracking-widest">해외 지수 & 환율</h2>
          <button onClick={() => refetch()} className="text-text-muted hover:text-accent-blue transition-colors">
            <RefreshCw size={11} />
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
          {US_INDEX_KEYS.map((key) => {
            const idx = getIdx(key);
            return <div key={key} className="flex-shrink-0"><IndexCard name={US_DISPLAY[key]} {...idx} onClick={() => navigate(`/index/${key}`)} /></div>;
          })}
          {data?.exchange && (
            <ExtraCard
              name="원/달러"
              value={data.exchange.value ?? data.exchange.usdkrw ?? 0}
              change={data.exchange.change ?? 0}
              change_rate={data.exchange.change_rate ?? 0}
              unit="원"
              _demo={data.exchange._demo}
            />
          )}
        </div>
      </section>

      {/* 순위 + 뉴스 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-text-primary">해외주식 순위</h3>
            <div className="flex gap-0.5 bg-bg-primary border border-border rounded-lg p-0.5 flex-wrap">
              {RANK_CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => setCategory(cat)}
                  className={`px-2 py-1 text-2xs font-semibold rounded-md transition-all ${
                    category === cat ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
                  }`}
                >{cat}</button>
              ))}
            </div>
          </div>
          <div>
            {isLoading ? <LoadingSpinner /> : (
              <RankingTable items={data?.rankings ?? []} isKR={false} livePrices={rankLivePrices}
                onSymbolClick={(sym, mkt) => navigate(`/stocks/${mkt}/${encodeURIComponent(sym)}`)} />
            )}
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Globe size={14} className="text-text-muted" />
            <h3 className="text-sm font-semibold text-text-primary">해외 금융뉴스</h3>
            {data?.news && <span className="text-2xs text-text-muted ml-auto">{data.news.length}건</span>}
          </div>
          <div className="px-3 py-1">
            {isLoading ? <LoadingSpinner /> : <NewsPanel news={data?.news ?? []} />}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ── 메인 ────────────────────────────────────────────────── */
export default function Dashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"kr" | "us">("kr");
  const [liveIndices, setLiveIndices] = useState<any>(null);

  const { status: wsStatus } = useIndicesStream(
    useCallback((data: any) => setLiveIndices(data), []),
    30,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">대시보드</h1>
          <p className="text-text-muted text-xs mt-0.5">지수 클릭 → 상세 차트 · 종목 클릭 → 종목 상세</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${wsStatus==="connected" ? "bg-accent-green animate-pulse" : "bg-accent-red"}`} />
            <span className="text-2xs text-text-muted">{wsStatus==="connected" ? "실시간" : "오프라인"}</span>
          </div>
          <div className="flex gap-0.5 bg-bg-secondary border border-border rounded-xl p-1">
            <button onClick={() => setTab("kr")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tab==="kr" ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
              }`}><Flag size={11}/>국내</button>
            <button onClick={() => setTab("us")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tab==="us" ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
              }`}><Globe size={11}/>해외</button>
          </div>
        </div>
      </div>

      {tab === "kr"
        ? <KRTab liveIndices={liveIndices} navigate={navigate} />
        : <USTab liveIndices={liveIndices} navigate={navigate} />
      }
    </div>
  );
}
