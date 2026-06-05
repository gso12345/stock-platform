import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/api/client";
import { stocksApi, watchlistApi, financialsApi } from "@/api/stocks";
import {
  ArrowLeft, Star, TrendingUp, TrendingDown, BarChart2, DollarSign,
  RefreshCw, FileText, CandlestickChart, LineChart, AreaChart,
  Newspaper, Users, ExternalLink, Maximize2, X, List, MessageSquare,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { Market } from "@/types";
import StockChart, { CANDLE_GROUPS, PERIOD_BY_CANDLE, CANDLE_DEFAULT_PERIOD, type ChartType } from "@/components/chart/StockChart";

/* ── 포맷 유틸 ──────────────────────────────────────── */
function fmtKRW(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}조`;
  if (abs >= 1e8)  return `${(v / 1e8).toFixed(0)}억`;
  if (abs >= 1e4)  return `${(v / 1e4).toFixed(0)}만`;
  return v.toLocaleString("ko-KR");
}

function fmtUSD(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return d.replace(/(\d{4})-?(\d{2})-?(\d{2})/, "$1년 $2월 $3일");
}

function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  return v.toFixed(digits);
}

/* ── 지표 셀 ────────────────────────────────────────── */
function StatCell({ label, value, color, sub }: { label: string; value: React.ReactNode; color?: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 p-3 rounded-xl border border-border bg-bg-elevated">
      <span className="text-2xs text-text-muted font-medium uppercase tracking-wide">{label}</span>
      <span className={`text-sm font-mono font-semibold truncate ${color ?? "text-text-primary"}`}>{value ?? "—"}</span>
      {sub && <span className="text-2xs text-text-muted font-mono">{sub}</span>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-2">{children}</h3>;
}

function TabBtn({ active, onClick, icon: Icon, label }: any) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${active ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-secondary hover:bg-bg-elevated"}`}>
      <Icon size={13} />{label}
    </button>
  );
}

/* ── 메인 ───────────────────────────────────────────── */
export default function StockDetail() {
  const { market, symbol: rawSymbol } = useParams<{ market: string; symbol: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const m   = (market?.toUpperCase() || "US") as Market;
  const sym = decodeURIComponent(rawSymbol ?? "").toUpperCase();
  const isKR = m === "KR";
  const { userId } = useAuthStore();

  const [candleType, setCandleType]   = useState("1d");
  const [chartType, setChartType]     = useState<ChartType>("candle");
  const [logScale, setLogScale]       = useState(false);
  const [fullscreen, setFullscreen]   = useState(false);
  const [chartPeriod, setChartPeriod] = useState(() => CANDLE_DEFAULT_PERIOD["1d"]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [mainTab, setMainTab]       = useState<"chart" | "financial" | "news" | "daily" | "analyst" | "supply" | "community">("chart");
  const [isMobile, setIsMobile]     = useState(typeof window !== "undefined" && window.innerWidth < 640);
  const [showKRW, setShowKRW]           = useState(false);
  const [analystSubTab, setAnalystSubTab] = useState<"opinion" | "consensus">("opinion");
  const [consensusPeriod, setConsensusPeriod] = useState<"annual" | "quarterly">("annual");
  const [finPeriod, setFinPeriod]       = useState<"annual" | "quarterly">("annual");
  const [finSubTab, setFinSubTab]       = useState<"basic" | "income" | "valuation" | "profitability" | "health" | "cashflow">("basic");
  const [selectedMetric, setSelectedMetric] = useState("revenue");
  const [supplyDays, setSupplyDays]   = useState(30);
  const [newsSort, setNewsSort]         = useState<"latest" | "popular">("latest");
  const [newsExpanded, setNewsExpanded] = useState(false);
  const [newsSubTab, setNewsSubTab]     = useState<"news" | "disclosure">("news");
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistItemId, setWatchlistItemId] = useState<number | null>(null);
  const [watchlistMsg, setWatchlistMsg] = useState("");
  const [openGroup, setOpenGroup]     = useState<string | null>(null);
  const candleDropdownRef             = useRef<HTMLDivElement>(null);

  // 캔들 그룹 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (candleDropdownRef.current && !candleDropdownRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  const onCandleChange = (type: string) => { setCandleType(type); setChartPeriod(CANDLE_DEFAULT_PERIOD[type] ?? "max"); };

  // 현재 캔들 값이 속한 그룹 key 반환
  const activeGroupKey = CANDLE_GROUPS.find(g => g.options.some(o => o.value === candleType))?.key ?? "day";

  const fmt = (v: number | null | undefined) => isKR ? fmtKRW(v) : fmtUSD(v);

  // 탭별 데이터 선제 prefetch
  const prefetchSecondaryData = useCallback((tabId?: string) => {
    const tab = tabId ?? "";
    if (tab === "financial" || tab === "") {
      qc.prefetchQuery({ queryKey: ["stock-financials",   m, sym], queryFn: () => financialsApi.get(m, sym),           staleTime: 900_000 });
      qc.prefetchQuery({ queryKey: ["stock-fundamentals", m, sym], queryFn: () => stocksApi.getFundamentals(m, sym),   staleTime: 900_000 });
      qc.prefetchQuery({ queryKey: ["metrics-history",    m, sym], queryFn: () => stocksApi.getMetricsHistory(m, sym), staleTime: 900_000 });
      qc.prefetchQuery({ queryKey: ["earnings",           m, sym], queryFn: () => stocksApi.getEarnings(m, sym),       staleTime: 900_000 });
    }
    if (tab === "analyst" || tab === "") {
      qc.prefetchQuery({ queryKey: ["analyst",   m, sym], queryFn: () => stocksApi.getAnalyst(m, sym),   staleTime: 900_000 });
      qc.prefetchQuery({ queryKey: ["forecasts", m, sym], queryFn: () => stocksApi.getForecasts(m, sym), staleTime: 900_000 });
    }
    if (tab === "news") {
      qc.prefetchQuery({ queryKey: ["stock-news", m, sym], queryFn: () => stocksApi.getNews(m, sym),       staleTime: 300_000 });
      qc.prefetchQuery({ queryKey: ["earnings",   m, sym], queryFn: () => stocksApi.getEarnings(m, sym),   staleTime: 900_000 });
    }
    if (tab === "daily" || tab === "") {
      qc.prefetchQuery({ queryKey: ["stock-ohlcv", m, sym, "1d", "1mo"], queryFn: () => stocksApi.getOHLCV(m, sym, "1mo", "1d"), staleTime: 300_000 });
    }
  }, [m, sym, qc]);

  const { data: detail, isLoading: loadingDetail, isPlaceholderData, error: detailError, refetch: refetchDetail, dataUpdatedAt } = useQuery({
    queryKey: ["stock-detail", m, sym],
    queryFn: () => stocksApi.getDetail(m, sym),
    enabled: !!sym, retry: 1, retryDelay: 3000,
    staleTime: 15_000,
    refetchInterval: 15_000,
    placeholderData: () => {
      // 대시보드 랭킹 캐시에서 해당 종목 데이터 즉시 활용
      for (const cat of ["시가총액", "상승률", "하락률", "거래량", "거래대금"]) {
        const cached = qc.getQueryData<any>(isKR ? ["dashboard-kr", cat] : ["dashboard-us", cat]);
        const item = cached?.rankings?.find((r: any) => r.symbol === sym);
        if (item) return item;
      }
      return undefined;
    },
  });

  const isIntraday = ["1m","2m","5m","15m","30m","60m","90m"].includes(candleType);

  const { data: ohlcv, isFetching: fetchingChart, refetch: refetchChart } = useQuery({
    queryKey: ["stock-ohlcv", m, sym, candleType, chartPeriod],
    queryFn: () => stocksApi.getOHLCV(m, sym, chartPeriod, candleType),
    enabled: !!sym, retry: 1,
    staleTime: isIntraday ? 15_000 : 21_600_000,
    placeholderData: (prev) => prev,
    refetchInterval: isIntraday ? 15_000 : false,
  });

  // 종목 진입 1초 후 일별탭 데이터만 선제 prefetch (차트 로딩과 경합 방지)
  useEffect(() => {
    if (!sym) return;
    const t = setTimeout(() => prefetchSecondaryData("daily"), 1000);
    return () => clearTimeout(t);
  }, [sym, prefetchSecondaryData]);

  // 일별 탭 — 기본 1개월, 더보기 클릭마다 1달씩 추가
  const [dailyMonths, setDailyMonths] = useState(1);
  const dailyPeriodStr = dailyMonths <= 1 ? "1mo" : dailyMonths <= 3 ? "3mo" : dailyMonths <= 6 ? "6mo" : "1y";
  const { data: dailyOhlcv, isFetching: fetchingDaily } = useQuery({
    queryKey: ["stock-ohlcv", m, sym, "1d", dailyPeriodStr],
    queryFn: () => stocksApi.getOHLCV(m, sym, dailyPeriodStr, "1d"),
    enabled: !!sym && mainTab === "daily",
    staleTime: 300_000,
    placeholderData: (prev) => prev,
  });

  const { data: financials, isLoading: loadingFin } = useQuery({
    queryKey: ["stock-financials", m, sym],
    queryFn: () => financialsApi.get(m, sym),
    enabled: !!sym && mainTab === "financial",
    retry: 1, staleTime: 900_000,
  });

  // KR 종목 벨류에이션 보완용 — 재무탭 진입 시 별도 fetch
  const { data: fundamentalsData } = useQuery({
    queryKey: ["stock-fundamentals", m, sym],
    queryFn: () => stocksApi.getFundamentals(m, sym),
    enabled: !!sym && mainTab === "financial",
    retry: 1, staleTime: 900_000,
  });

  const { data: metricsHistory } = useQuery({
    queryKey: ["metrics-history", m, sym],
    queryFn: () => stocksApi.getMetricsHistory(m, sym),
    enabled: !!sym && mainTab === "financial",
    retry: 1, staleTime: 900_000,
  });

  const { data: forecasts } = useQuery({
    queryKey: ["forecasts", m, sym],
    queryFn: () => stocksApi.getForecasts(m, sym),
    enabled: !!sym && (
      (mainTab === "financial" && finSubTab === "valuation") ||
      mainTab === "analyst"
    ),
    retry: 1, staleTime: 900_000,
  });

  const { data: analystData, isLoading: loadingAnalyst } = useQuery({
    queryKey: ["analyst", m, sym],
    queryFn: () => stocksApi.getAnalyst(m, sym),
    enabled: !!sym && mainTab === "analyst",
    retry: 1, staleTime: 900_000,
  });

  const { data: stockNews, isLoading: loadingNews } = useQuery({
    queryKey: ["stock-news", m, sym],
    queryFn: () => stocksApi.getNews(m, sym),
    enabled: !!sym && mainTab === "news" && newsSubTab === "news",
    staleTime: 300_000,
  });

  const { data: earningsData } = useQuery({
    queryKey: ["earnings", m, sym],
    queryFn: () => stocksApi.getEarnings(m, sym),
    enabled: !!sym && (mainTab === "news" || mainTab === "financial"),
    staleTime: 900_000,
  });

  const { data: supplyData, isLoading: loadingSupply } = useQuery({
    queryKey: ["supply-demand", sym, supplyDays],
    queryFn: () => stocksApi.getSupplyDemand(sym, supplyDays),
    enabled: !!sym && mainTab === "supply" && isKR,
    staleTime: 600_000,
  });

  const { data: exchangeRateData } = useQuery({
    queryKey: ["exchange-rate"],
    queryFn: () => api.get("/dashboard/exchange").then(r => r.data),
    enabled: !isKR,
    staleTime: 300_000,
  });
  const exchangeRate: number = (exchangeRateData as any)?.value ?? 1350;

  // 이미 추가된 종목인지 확인
  const { data: watchlistItems } = useQuery({
    queryKey: ["watchlist-items-check", userId],
    queryFn: () => watchlistApi.getItems(),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (watchlistItems) {
      const found = (watchlistItems as any[]).find((i: any) => i.symbol === sym);
      setInWatchlist(!!found);
      setWatchlistItemId(found?.id ?? null);
    }
  }, [watchlistItems, sym]);

  const addMutation = useMutation({
    mutationFn: () => watchlistApi.addItem({
      symbol: sym,
      market: m,
      name: (detail as any)?.name ?? sym,
      watchlist_id: 1,
    }),
    onSuccess: (data: any) => {
      setInWatchlist(true);
      setWatchlistItemId(data?.id ?? null);
      setWatchlistMsg("관심종목에 추가됐어요");
      qc.invalidateQueries({ queryKey: ["watchlist-items"] });
      qc.invalidateQueries({ queryKey: ["watchlist-items-check"] });
      setTimeout(() => setWatchlistMsg(""), 2000);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail ?? "추가 실패";
      if (msg.includes("이미")) {
        setInWatchlist(true);
        setWatchlistMsg("이미 추가된 종목이에요");
      } else {
        setWatchlistMsg(msg);
      }
      setTimeout(() => setWatchlistMsg(""), 2000);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => watchlistApi.removeItem(id),
    onSuccess: () => {
      setInWatchlist(false);
      setWatchlistItemId(null);
      setWatchlistMsg("관심종목에서 제거됐어요");
      qc.invalidateQueries({ queryKey: ["watchlist-items"] });
      qc.invalidateQueries({ queryKey: ["watchlist-items-check"] });
      setTimeout(() => setWatchlistMsg(""), 2000);
    },
  });

  const d = detail as any;
  const priceStr = d?.price != null
    ? isKR ? `₩${d.price.toLocaleString("ko-KR")}` : `$${d.price.toFixed(2)}`
    : "—";
  const isUp = (d?.change_rate ?? 0) >= 0;

  if (detailError && !detail) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 rounded-full bg-red-900/30 flex items-center justify-center"><TrendingDown size={20} className="text-accent-red"/></div>
        <p className="text-text-primary font-semibold">데이터를 불러올 수 없습니다 ({sym})</p>
        <div className="flex gap-2">
          <button onClick={()=>refetchDetail()} className="flex items-center gap-1.5 px-4 py-2 bg-accent-blue text-white text-sm font-semibold rounded-lg"><RefreshCw size={13}/>다시 시도</button>
          <button onClick={()=>navigate(-1)} className="px-4 py-2 text-text-muted text-sm rounded-lg border border-border">뒤로</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 fade-in">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button onClick={()=>navigate(-1)} className="mt-1 p-1.5 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"><ArrowLeft size={16}/></button>
          <div>
            <h1 className="text-2xl font-bold text-text-primary leading-tight">
              {d?.name && d.name !== sym ? d.name : sym.replace(".KS","").replace(".KQ","")}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-sm font-mono text-text-muted">{sym.replace(".KS","").replace(".KQ","")}</span>
              <span className={`text-2xs px-1.5 py-0.5 rounded border font-bold ${isKR?"border-blue-700/50 text-blue-400 bg-blue-900/20":m==="ETF"?"border-purple-700/50 text-purple-400 bg-purple-900/20":"border-green-700/50 text-green-400 bg-green-900/20"}`}>{m}</span>
              {d?.sector && <span className="text-2xs px-1.5 py-0.5 rounded bg-bg-elevated border border-border text-text-muted">{d.sector}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <button
            onClick={() => {
              if (inWatchlist && watchlistItemId) {
                removeMutation.mutate(watchlistItemId);
              } else if (!inWatchlist && !addMutation.isPending) {
                addMutation.mutate();
              }
            }}
            disabled={addMutation.isPending || removeMutation.isPending}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
              inWatchlist
                ? "border-accent-yellow/50 bg-accent-yellow/10 text-accent-yellow hover:bg-accent-red/10 hover:border-accent-red/50 hover:text-accent-red"
                : "border-border text-text-muted hover:border-accent-yellow/60 hover:text-accent-yellow"
            }`}
          >
            <Star size={14} fill={inWatchlist ? "currentColor" : "none"}/>
            {addMutation.isPending ? "추가 중..." : removeMutation.isPending ? "제거 중..." : inWatchlist ? "관심종목" : "추가"}
          </button>
          {watchlistMsg && (
            <span className="text-2xs text-text-muted animate-fade-in">{watchlistMsg}</span>
          )}
        </div>
      </div>

      {/* 통합 지표 패널 */}
      {d ? (
        <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
          {/* 현재가 + 등락 */}
          <div className="px-4 py-3 flex items-center gap-4 flex-wrap border-b border-border">
            <span className="text-3xl font-mono font-bold text-text-primary num">{priceStr}</span>
            <div className="flex items-center gap-1.5">
              {isUp ? <TrendingUp size={13} className="text-accent-green"/> : <TrendingDown size={13} className="text-accent-red"/>}
              {d.change != null && d.change !== 0 && (
                <span className={`text-sm font-mono font-semibold num ${isUp?"text-accent-green":"text-accent-red"}`}>
                  {isUp?"+":""}{isKR ? d.change.toLocaleString("ko-KR") : d.change.toFixed(2)}
                </span>
              )}
              <span className={`text-sm font-mono num ${isUp?"text-accent-green":"text-accent-red"}`}>
                ({isUp?"+":""}{(d.change_rate??0).toFixed(2)}%)
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse"/>
              <span className="text-2xs text-text-muted">
                {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("ko-KR", {hour:"2-digit",minute:"2-digit",second:"2-digit"}) : ""}
              </span>
            </div>
          </div>

          {/* 시세 지표 — 모바일 2열 / 데스크탑 5열 */}
          {(() => {
            const priceItems = [
              { label:"시가",     v: isKR ? d.open?.toLocaleString("ko-KR")  : d.open?.toFixed(2) },
              { label:"고가",     v: isKR ? d.high?.toLocaleString("ko-KR")  : d.high?.toFixed(2), color:"text-accent-red" },
              { label:"저가",     v: isKR ? d.low?.toLocaleString("ko-KR")   : d.low?.toFixed(2),  color:"text-accent-blue" },
              { label:"전일종가", v: isKR ? d.prev_close?.toLocaleString("ko-KR") : d.prev_close?.toFixed(2) },
              { label:"거래량",   v: d.volume ? (d.volume >= 1e8 ? `${(d.volume/1e8).toFixed(1)}억주` : d.volume >= 1e4 ? `${(d.volume/1e4).toFixed(1)}만주` : d.volume.toLocaleString("ko-KR")) : null },
              { label:"거래대금", v: fmt(d.price && d.volume ? d.price * d.volume : null) },
              { label:"시가총액", v: fmt(d.market_cap) },
              { label:"52주 고가",v: d.week52_high ? (isKR ? Math.round(d.week52_high).toLocaleString("ko-KR") : d.week52_high?.toFixed(2)) : null, color:"text-accent-red" },
              { label:"52주 저가",v: d.week52_low  ? (isKR ? Math.round(d.week52_low).toLocaleString("ko-KR")  : d.week52_low?.toFixed(2))  : null, color:"text-accent-blue" },
              { label:"배당수익률",v: d.dividend_yield != null ? `${d.dividend_yield.toFixed(2)}%` : null, color:"text-accent-green" },
            ];
            const COLS_SM = 5; // 데스크탑 열 수
            return (
              <div className="grid grid-cols-2 sm:grid-cols-5">
                {priceItems.map((item, i) => {
                  const isLastCol2  = i % 2 === 1;               // 모바일 오른쪽 열
                  const isLastCol5  = i % COLS_SM === COLS_SM-1; // 데스크탑 마지막 열
                  const isFirstRow2 = i < 2;                     // 모바일 첫 행
                  const isFirstRow5 = i < COLS_SM;               // 데스크탑 첫 행
                  return (
                    <div key={item.label} className={[
                      "px-4 py-3 flex flex-col gap-1",
                      !isLastCol2  ? "border-r border-border/40"        : "",
                      !isFirstRow2 ? "border-t border-border/40"        : "",
                      isLastCol2 && !isLastCol5 ? "sm:border-r border-border/40" : "",
                      isLastCol5               ? "sm:border-r-0"        : "",
                      !isFirstRow5             ? "sm:border-t border-border/40" : "",
                      isFirstRow2 && !isFirstRow5 ? "sm:border-t-0"    : "",
                    ].filter(Boolean).join(" ")}>
                      <span className="text-[10px] font-medium text-text-muted whitespace-nowrap">{item.label}</span>
                      <span className={`text-sm font-mono font-semibold num truncate ${(item as any).color ?? "text-text-primary"}`}>{item.v ?? "—"}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* 투자의견 요약 행 (US 종목, 데이터 있을 때만) */}
          {!isKR && (() => {
            const ad = analystData as any;
            const pt = ad?.price_targets;
            const cs = ad?.consensus;
            if (!pt && !cs) return null;
            const totalVotes = cs ? cs.strong_buy + cs.buy + cs.hold + cs.sell + cs.strong_sell : 0;
            const avgScore = cs && totalVotes > 0
              ? (cs.strong_buy*5 + cs.buy*4 + cs.hold*3 + cs.sell*2 + cs.strong_sell*1) / totalVotes
              : null;
            const ratingLabel = avgScore == null ? null
              : avgScore >= 4.5 ? "강력매수"
              : avgScore >= 3.5 ? "매수"
              : avgScore >= 2.5 ? "보유"
              : avgScore >= 1.5 ? "매도"
              : "강력매도";
            const ratingColor = avgScore == null ? "text-text-muted"
              : avgScore >= 4 ? "text-accent-green"
              : avgScore >= 3 ? "text-accent-yellow"
              : "text-accent-red";
            const upside = pt?.current && pt?.mean
              ? ((pt.mean - pt.current) / pt.current * 100)
              : null;
            if (!ratingLabel && !pt?.mean) return null;
            return (
              <div className="border-t border-border px-4 py-2.5 flex flex-wrap items-center gap-3 bg-bg-secondary/50">
                <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide flex-shrink-0">투자의견</span>
                {ratingLabel && (
                  <span className={`text-xs font-bold ${ratingColor}`}>{ratingLabel}</span>
                )}
                {pt?.mean != null && (
                  <span className="text-xs text-text-muted font-mono">
                    목표가 <span className="text-text-primary font-semibold">${pt.mean.toFixed(0)}</span>
                  </span>
                )}
                {upside != null && (
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${upside >= 0 ? "bg-accent-green/10 text-accent-green" : "bg-accent-red/10 text-accent-red"}`}>
                    {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                  </span>
                )}
                {totalVotes > 0 && (
                  <span className="text-2xs text-text-muted ml-auto">{totalVotes}명</span>
                )}
              </div>
            );
          })()}
        </div>
      ) : loadingDetail ? (
        <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-4 flex-wrap border-b border-border">
            <span className="text-3xl font-mono font-bold text-text-muted">—</span>
            <div className="ml-auto w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5">
            {["시가","고가","저가","전일종가","거래량","거래대금","시가총액","52주 고가","52주 저가","배당수익률"].map((label) => (
              <div key={label} className="px-4 py-3 flex flex-col gap-1 border-r border-border/40 border-b border-border/40">
                <span className="text-[10px] font-medium text-text-muted whitespace-nowrap">{label}</span>
                <span className="text-sm font-mono font-semibold text-text-muted">—</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 탭 네비게이션 */}
      <div className="flex flex-col gap-2">
        {/* 메인 탭 — 한 줄 + 가로 스크롤 */}
        <div className="flex border-b border-border bg-bg-card rounded-t-xl overflow-x-auto scrollbar-hide">
          {[
            { id:"chart",     Icon: BarChart2,      label:"차트" },
            { id:"daily",     Icon: List,            label:"일별" },
            { id:"financial", Icon: DollarSign,      label:"재무제표" },
            { id:"analyst",   Icon: TrendingUp,      label:"투자의견" },
            { id:"news",      Icon: Newspaper,       label:"뉴스/공시" },
            ...(isKR ? [{ id:"supply", Icon: Users, label:"수급" }] : []),
            { id:"community", Icon: MessageSquare,   label:"커뮤니티" },
          ].map(({ id, Icon, label }) => (
            <button key={id}
              onClick={() => { setMainTab(id as any); prefetchSecondaryData(id); }}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold transition-all border-b-2 -mb-px whitespace-nowrap flex-shrink-0 ${
                mainTab === id
                  ? "border-accent-blue text-accent-blue bg-accent-blue/5"
                  : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated"
              }`}
            >
              <Icon size={13}/>{label}
            </button>
          ))}
        </div>

        {/* 재무제표 서브탭 */}
        {mainTab==="financial" && (
          <div className="flex gap-1 overflow-x-auto scrollbar-hide">
            {([
              { value:"basic",         label:"기본 지표" },
              { value:"income",        label:"손익계산서" },
              { value:"valuation",     label:"밸류에이션" },
              { value:"profitability", label:"수익성" },
              { value:"health",        label:"재무건전성" },
              { value:"cashflow",      label:"현금흐름" },
            ] as const).map(({ value, label })=>(
              <button key={value} onClick={()=>setFinSubTab(value)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap transition-all flex-shrink-0 ${
                  finSubTab===value
                    ? "bg-accent-blue text-white"
                    : "bg-bg-card border border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
                }`}
              >{label}</button>
            ))}
          </div>
        )}
      </div>

      {/* 차트 탭 */}
      {mainTab==="chart" && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          {/* 봉 종류 */}
          <div className="px-4 py-2.5 border-b border-border flex flex-wrap items-center gap-2">
            <div ref={candleDropdownRef} className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary relative">
              {CANDLE_GROUPS.map(group => {
                const isActive = group.key === activeGroupKey;
                const currentOpt = group.options.find(o => o.value === candleType);
                return (
                  <div key={group.key} className="relative">
                    <button
                      onClick={() => {
                        if (isActive) {
                          setOpenGroup(prev => prev === group.key ? null : group.key);
                        } else {
                          onCandleChange(group.options[0].value);
                          setOpenGroup(null);
                        }
                      }}
                      className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all ${isActive ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"}`}
                    >
                      {isActive ? (currentOpt?.label ?? group.label) : group.label}
                    </button>
                    {openGroup === group.key && (
                      <div className="absolute top-full left-0 mt-1 z-50 flex flex-col gap-0.5 p-1 rounded-lg border border-border bg-bg-card shadow-xl min-w-[64px]">
                        {group.options.map(opt => (
                          <button key={opt.value}
                            onClick={() => { onCandleChange(opt.value); setOpenGroup(null); }}
                            className={`px-3 py-1.5 text-xs rounded-md font-semibold whitespace-nowrap transition-all ${candleType === opt.value ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"}`}
                          >{opt.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* 기간 선택 */}
            {(PERIOD_BY_CANDLE[candleType] ?? []).length > 0 && (
              <div className="flex gap-0.5 flex-wrap">
                {(PERIOD_BY_CANDLE[candleType] ?? []).map(({ label, value }) => (
                  <button key={value} onClick={() => setChartPeriod(value)}
                    className={`px-2 py-1 text-xs rounded-md font-semibold transition-all ${
                      chartPeriod === value
                        ? "bg-accent-blue/20 text-accent-blue"
                        : "text-text-muted hover:text-text-primary"
                    }`}
                  >{label}</button>
                ))}
              </div>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button onClick={()=>refetchChart()} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
                <RefreshCw size={13}/>
              </button>
              <button onClick={()=>setFullscreen(true)} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors" title="전체보기">
                <Maximize2 size={13}/>
              </button>
            </div>
          </div>
          {/* 차트 설정 */}
          <div className="px-4 py-2 border-b border-border bg-bg-secondary flex flex-wrap items-center gap-3">
            <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide">차트 설정</span>
            <div className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary">
              {([
                { value:"candle", label:"캔들",  Icon: CandlestickChart },
                { value:"line",   label:"라인",  Icon: LineChart },
                { value:"area",   label:"영역",  Icon: AreaChart },
              ] as const).map(({ value, label, Icon })=>(
                <button key={value} onClick={()=>setChartType(value)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-md font-semibold transition-all ${chartType===value?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}
                >
                  <Icon size={11}/>{label}
                </button>
              ))}
            </div>
            <button onClick={()=>setLogScale(v=>!v)}
              className={`px-2.5 py-1 text-xs rounded-lg border font-semibold transition-all ${logScale?"bg-accent-blue/20 border-accent-blue/50 text-accent-blue":"border-border text-text-muted hover:text-text-primary"}`}
            >
              LOG
            </button>
          </div>
          {ohlcv?.length ? (
            <div className="relative">
              {fetchingChart && (
                <div className="absolute top-2 right-2 z-10 w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/>
              )}
              <StockChart data={ohlcv} height={420} isKR={isKR} chartType={chartType} logScale={logScale}/>
            </div>
          ) : fetchingChart ? (
            <div className="h-[500px] flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/>
              <p className="text-text-muted text-sm">차트 로딩 중...</p>
            </div>
          ) : (
            <div className="h-[420px] flex flex-col items-center justify-center gap-3">
              <BarChart2 size={32} className="text-text-muted/40"/>
              <p className="text-text-muted text-sm">차트 데이터 없음</p>
              <button onClick={()=>refetchChart()} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-blue text-white text-xs rounded-lg"><RefreshCw size={12}/>재시도</button>
            </div>
          )}
        </div>
      )}

      {/* 전체보기 모달 */}
      {fullscreen && ohlcv?.length && (
        <div className="fixed inset-0 z-50 bg-bg-base flex flex-col">
          {/* 모달 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-card flex-shrink-0">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-bold text-text-primary">{d?.name ?? sym}</span>
              <div ref={candleDropdownRef} className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary relative">
                {CANDLE_GROUPS.map(group => {
                  const isActive = group.key === activeGroupKey;
                  const currentOpt = group.options.find(o => o.value === candleType);
                  return (
                    <div key={group.key} className="relative">
                      <button
                        onClick={() => {
                          if (isActive) {
                            setOpenGroup(prev => prev === group.key ? null : group.key);
                          } else {
                            onCandleChange(group.options[0].value);
                            setOpenGroup(null);
                          }
                        }}
                        className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all ${isActive ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"}`}
                      >
                        {isActive ? (currentOpt?.label ?? group.label) : group.label}
                      </button>
                      {openGroup === group.key && (
                        <div className="absolute top-full left-0 mt-1 z-50 flex flex-col gap-0.5 p-1 rounded-lg border border-border bg-bg-card shadow-xl min-w-[64px]">
                          {group.options.map(opt => (
                            <button key={opt.value}
                              onClick={() => { onCandleChange(opt.value); setOpenGroup(null); }}
                              className={`px-3 py-1.5 text-xs rounded-md font-semibold whitespace-nowrap transition-all ${candleType === opt.value ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"}`}
                            >{opt.label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {(PERIOD_BY_CANDLE[candleType] ?? []).length > 0 && (
                <div className="flex gap-0.5 flex-wrap">
                  {(PERIOD_BY_CANDLE[candleType] ?? []).map(({ label, value }) => (
                    <button key={value} onClick={() => setChartPeriod(value)}
                      className={`px-2 py-1 text-xs rounded-md font-semibold transition-all ${
                        chartPeriod === value
                          ? "bg-accent-blue/20 text-accent-blue"
                          : "text-text-muted hover:text-text-primary"
                      }`}
                    >{label}</button>
                  ))}
                </div>
              )}
              <div className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary">
                {([{value:"candle",label:"캔들"},{value:"line",label:"라인"},{value:"area",label:"영역"}] as const).map(({value,label})=>(
                  <button key={value} onClick={()=>setChartType(value)}
                    className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all ${chartType===value?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}
                  >{label}</button>
                ))}
              </div>
              <button onClick={()=>setLogScale(v=>!v)}
                className={`px-2.5 py-1 text-xs rounded-lg border font-semibold transition-all ${logScale?"bg-accent-blue/20 border-accent-blue/50 text-accent-blue":"border-border text-text-muted"}`}
              >LOG</button>
            </div>
            <button onClick={()=>setFullscreen(false)} className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
              <X size={18}/>
            </button>
          </div>
          {/* 전체 차트 — 메인 차트 높이를 줄여 보조지표 패널이 화면 안에 보이도록 */}
          <div className="flex-1 overflow-y-auto">
            <StockChart data={ohlcv} height={Math.max(260, Math.floor((window.innerHeight - 100) * 0.55))} isKR={isKR} chartType={chartType} logScale={logScale}/>
          </div>
        </div>
      )}

      {/* 재무제표 탭 */}
      {mainTab==="financial" && (() => {
        const mhRaw: any[] = (metricsHistory as any)?.[finPeriod] ?? [];
        const mh: any[] = mhRaw.filter((r: any) =>
          r.revenue != null || r.op_income != null || r.net_income != null ||
          r.per != null || r.pbr != null || r.roe != null
        );
        const fcst: any[] = ((forecasts as any)?.annual ?? []).filter((r:any) => r.type === "forecast");

        // metrics-history 최신값으로 detail의 None 보완
        const mhLatest = [...mh].sort((a,b)=>b.period.localeCompare(a.period))[0] ?? {};
        const fd = (fundamentalsData as any) ?? {};
        const dEnhanced = {
          per:          d?.per          ?? fd.per          ?? mhLatest.per          ?? null,
          pbr:          d?.pbr          ?? fd.pbr          ?? mhLatest.pbr          ?? null,
          psr:          d?.psr          ?? fd.psr          ?? mhLatest.psr          ?? null,
          eps:          d?.eps          ?? fd.eps          ?? mhLatest.eps          ?? null,
          bps:          d?.bps          ?? fd.bps          ?? mhLatest.bps          ?? null,
          roe:          d?.roe          ?? fd.roe          ?? mhLatest.roe          ?? null,
          roa:          d?.roa          ?? fd.roa          ?? null,
          op_margin:    d?.op_margin    ?? fd.op_margin    ?? mhLatest.op_margin    ?? null,
          net_margin:   d?.net_margin   ?? fd.net_margin   ?? mhLatest.net_margin   ?? null,
          gross_margin: d?.gross_margin ?? fd.gross_margin ?? mhLatest.gross_margin ?? null,
          debt_ratio:   d?.debt_ratio   ?? fd.debt_ratio   ?? mhLatest.debt_ratio   ?? null,
          current_ratio:d?.current_ratio ?? fd.current_ratio ?? mhLatest.current_ratio ?? null,
          quick_ratio:  d?.quick_ratio  ?? fd.quick_ratio  ?? mhLatest.quick_ratio  ?? null,
          // 재무제표 탭에서 안 보이던 항목들 — fundamentals에서 fallback
          forward_per:     d?.forward_per     ?? fd.forward_per     ?? null,
          peg:             d?.peg             ?? fd.peg             ?? null,
          ev_ebitda:       d?.ev_ebitda       ?? fd.ev_ebitda       ?? null,
          ev_revenue:      d?.ev_revenue      ?? fd.ev_revenue      ?? null,
          enterprise_value:d?.enterprise_value ?? fd.enterprise_value ?? null,
          forward_eps:     d?.forward_eps     ?? fd.forward_eps     ?? null,
          beta:            d?.beta            ?? fd.beta            ?? null,
        };

        // 기간 레이블 (연간: YYYY, 분기: YYYY-QQ)
        const periodLabel = (p: string) => finPeriod === "quarterly" ? p.slice(0,7) : p.slice(0,4);
        const mhYears = [...new Set(mh.map((r:any) => periodLabel(r.period)))].sort() as string[];

        // 예측 연도 제거 (컨센서스 표시 안 함)
        const allYears = [...mhYears];

        // 기간으로 데이터 조회
        const getVal = (key: string, year: string): number | null => {
          if (year.endsWith("E")) {
            const y = year.slice(0,-1);
            const row = fcst.find((r:any) => r.period.slice(0,4) === y);
            return row?.[key] ?? null;
          }
          const row = mh.find((r:any) => periodLabel(r.period) === year);
          return row?.[key] ?? null;
        };

        // 연간/분기 토글 컴포넌트
        const PeriodToggle = () => (
          <div className="flex gap-1 p-0.5 rounded-lg border border-border bg-bg-primary">
            {(["annual","quarterly"] as const).map(k=>(
              <button key={k} onClick={()=>setFinPeriod(k)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${finPeriod===k?"bg-accent-blue text-white":"text-text-muted"}`}>
                {k==="annual"?"연간":"분기"}
              </button>
            ))}
          </div>
        );

        // 전치 테이블 렌더러
        const TransTable = ({ rows }: { rows: { key:string; label:string; fmt:(v:number)=>string; color:string; boldLabel?:boolean }[] }) => {
          // allYears가 있으면 테이블은 표시 (값이 없는 셀은 — 으로)
          // allYears 자체가 없으면(데이터 미도착) 연결 중 표시
          if (!allYears.length) return <p className="text-text-muted text-sm py-4 text-center">연결 중...</p>;
          const filteredRows = rows.filter(r => r.key); // 모든 row 표시 (빈 셀은 — 로)
          return (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="text-xs w-max min-w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left pb-2 font-medium text-text-muted sticky left-0 bg-bg-card w-28 min-w-[7rem] whitespace-nowrap">지표</th>
                    {allYears.map(y=>(
                      <th key={y} className={`text-right pb-2 font-mono font-medium min-w-[72px] px-2 whitespace-nowrap ${y.endsWith("E")?"text-accent-yellow/80":"text-text-muted"}`}>
                        {y.endsWith("E") ? y : (finPeriod === "quarterly" ? y.replace(/(\d{4})-?Q(\d)/, "$1 Q$2") : y)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(({ key, label, fmt, color, boldLabel })=>(
                    <tr key={key} className="border-b border-border/30 hover:bg-bg-hover">
                      <td className={`py-1.5 pr-3 text-text-muted sticky left-0 bg-bg-card whitespace-nowrap ${boldLabel?"font-semibold":""}`}>{label}</td>
                      {allYears.map(y=>{
                        const v = getVal(key, y);
                        const isEst = y.endsWith("E");
                        return (
                          <td key={y} className={`py-1.5 px-2 text-right font-mono ${color} ${isEst?"opacity-70 italic":""}`}>
                            {v!=null ? fmt(v) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        };

        // 재무제표 통화 포맷 (showKRW 토글 반영)
        const fmtFin = (v: number | null | undefined): string => {
          if (v == null) return "—";
          if (isKR) return fmtKRW(v);
          if (showKRW) return fmtKRW(v * exchangeRate);
          return fmtUSD(v);
        };

        // stat cell용 금액 포맷 (showKRW 토글 반영, null 반환)
        const fmtFinVal = (v: number | null | undefined): string | null => {
          if (v == null) return null;
          if (isKR) return fmtKRW(v);
          if (showKRW) return fmtKRW(v * exchangeRate);
          return fmtUSD(v);
        };

        // 반응형 차트 높이 (모바일 compact, PC 표준)
        const chartH   = isMobile ? 160 : 210;
        const chartHSm = isMobile ? 145 : 185;

        // 공통 차트 옵션
        const chartProps = {
          margin: {top:8,right:8,left:0,bottom:4} as any,
          cartesianGridProps: { strokeDasharray:"3 3", stroke:"#232840" },
          xAxisProps: { tick:{fill:"#64748b",fontSize:10}, tickLine:false } as any,
          yAxisProps: { tick:{fill:"#64748b",fontSize:10}, tickLine:false, width:isMobile?46:58 } as any,
          tooltipProps: { contentStyle:{background:"#141824",border:"1px solid #232840",borderRadius:8,fontSize:11} } as any,
        };

        return (
          <div className="flex flex-col gap-4">

          {/* 원화 환산 토글 (US 종목만) */}
          {!isKR && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowKRW(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  showKRW
                    ? "bg-accent-blue/20 border-accent-blue/50 text-accent-blue"
                    : "border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
                }`}
              >
                ₩ 원화
                {showKRW && <span className="text-[10px] text-text-muted">(1USD≈{exchangeRate.toLocaleString("ko-KR")}₩)</span>}
              </button>
            </div>
          )}

          {/* ── 손익계산서 ── */}
          {finSubTab==="income" && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-semibold text-text-primary">손익계산서</span>
                <PeriodToggle />
              </div>
              {loadingFin ? (
                <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/></div>
              ) : (
                <div className="p-4 flex flex-col gap-4">
                  {/* 차트 */}
                  {financials&&(financials[finPeriod]?.length??0)>0 && (() => {
                    const finData = (financials[finPeriod] as any[]).filter((r:any) => r.revenue != null || r.op_income != null || r.net_income != null);
                    if (!finData.length) return null;
                    return (
                    <ResponsiveContainer width="100%" height={chartH}>
                      <BarChart data={finData} {...chartProps.margin}>
                        <CartesianGrid {...chartProps.cartesianGridProps}/>
                        <XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                        <YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>{const a=Math.abs(v);return isKR?(a>=1e12?(v/1e12).toFixed(0)+"조":a>=1e8?(v/1e8).toFixed(0)+"억":String(v)):(a>=1e9?(v/1e9).toFixed(0)+"B":a>=1e6?(v/1e6).toFixed(0)+"M":String(v));}}/>
                        <Tooltip {...chartProps.tooltipProps} formatter={(v:number,name:string)=>{const l:Record<string,string>={revenue:"매출",op_income:"영업이익",net_income:"당기순이익"};return[fmtFin(v),l[name]??name];}}/>
                        <Legend formatter={v=>({revenue:"매출",op_income:"영업이익",net_income:"당기순이익"}[v as string]??v)}/>
                        <Bar dataKey="revenue" fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={35}/>
                        <Bar dataKey="op_income" fill="#10b981" radius={[2,2,0,0]} maxBarSize={35}/>
                        <Bar dataKey="net_income" fill="#8b5cf6" radius={[2,2,0,0]} maxBarSize={35}/>
                      </BarChart>
                    </ResponsiveContainer>
                    );
                  })()}
                  {/* 전치 테이블 */}
                  <TransTable rows={[
                    { key:"revenue",          label:"매출",         fmt:(v)=>fmtFin(v), color:"text-accent-blue" },
                    { key:"revenue_growth",   label:"매출성장률",   fmt:(v)=>`${v.toFixed(1)}%`, color: "text-accent-blue" },
                    { key:"op_income",        label:"영업이익",     fmt:(v)=>fmtFin(v), color:"text-accent-green" },
                    { key:"op_income_growth", label:"영업이익성장률",fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-green" },
                    { key:"net_income",       label:"당기순이익",   fmt:(v)=>fmtFin(v), color:"text-purple-400" },
                    { key:"net_income_growth",label:"순이익성장률", fmt:(v)=>`${v.toFixed(1)}%`, color:"text-purple-400" },
                    { key:"op_margin",        label:"영업이익률",   fmt:(v)=>`${v.toFixed(1)}%`, color:"text-text-secondary" },
                    { key:"net_margin",       label:"순이익률",     fmt:(v)=>`${v.toFixed(1)}%`, color:"text-text-secondary" },
                    { key:"eps",              label:"EPS",          fmt:(v)=>isKR?`₩${Math.round(v).toLocaleString("ko-KR")}`:(showKRW?`₩${Math.round(v*exchangeRate).toLocaleString("ko-KR")}`:fmtUSD(v)), color:"text-cyan-400" },
                  ]}/>
                </div>
              )}
            </div>
          )}

          {/* ── 밸류에이션 ── */}
          {finSubTab==="valuation" && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-semibold text-text-primary">밸류에이션</span>
                <PeriodToggle />
              </div>
              <div className="p-4 flex flex-col gap-4">
                {/* 현재 지표 — detail 없으면 metricsHistory 최신값 사용 */}
                {d && (
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    <StatCell label="PER(현재)"    value={dEnhanced.per          != null ? `${fmtNum(dEnhanced.per)}배` : null} />
                    <StatCell label="PER(선행)"    value={dEnhanced.forward_per  != null ? `${fmtNum(dEnhanced.forward_per)}배` : null} />
                    <StatCell label="PEG"          value={dEnhanced.peg          != null ? fmtNum(dEnhanced.peg, 2) : null} />
                    <StatCell label="PBR"          value={dEnhanced.pbr          != null ? `${fmtNum(dEnhanced.pbr,2)}배` : null} />
                    <StatCell label="PSR"          value={dEnhanced.psr          != null ? `${fmtNum(dEnhanced.psr,2)}배` : null} />
                    <StatCell label="EV/EBITDA"    value={dEnhanced.ev_ebitda    != null ? `${fmtNum(dEnhanced.ev_ebitda,1)}배` : null} />
                    <StatCell label="EV/매출"      value={dEnhanced.ev_revenue   != null ? `${fmtNum(dEnhanced.ev_revenue,2)}배` : null} />
                    <StatCell label="시가총액"     value={fmtFinVal(d.market_cap)} />
                    <StatCell label="기업가치(EV)" value={fmtFinVal(dEnhanced.enterprise_value)} />
                  </div>
                )}
                {/* PER/PBR 연도별 차트 — PER/PBR 없으면 EPS 차트, mh 비어있으면 dEnhanced로 단일 포인트 */}
                {(() => {
                  const hasMultiple = mh.some((r:any) => r.per != null || r.pbr != null);
                  const hasEps = mh.some((r:any) => r.eps != null);
                  // mh가 비어있어도 dEnhanced에 값이 있으면 단일 포인트로 차트 표시
                  if (!hasMultiple && !hasEps) {
                    const hasDEnhancedValuation = dEnhanced.per != null || dEnhanced.pbr != null || dEnhanced.eps != null;
                    if (!hasDEnhancedValuation) return null;
                    const singlePoint = [{
                      period: "현재",
                      per: dEnhanced.per,
                      pbr: dEnhanced.pbr,
                      psr: dEnhanced.psr,
                      eps: dEnhanced.eps,
                    }];
                    if (dEnhanced.per != null || dEnhanced.pbr != null) {
                      return (
                        <ResponsiveContainer width="100%" height={chartHSm}>
                          <BarChart data={singlePoint} {...chartProps.margin}>
                            <CartesianGrid {...chartProps.cartesianGridProps}/>
                            <XAxis dataKey="period" {...chartProps.xAxisProps}/>
                            <YAxis {...chartProps.yAxisProps}/>
                            <Tooltip {...chartProps.tooltipProps} formatter={(v:number,n:string)=>[Number(v).toFixed(2),{per:"PER",pbr:"PBR",psr:"PSR"}[n]??n]}/>
                            <Legend formatter={v=>({per:"PER",pbr:"PBR",psr:"PSR"}[v as string]??v)}/>
                            {dEnhanced.per!=null&&<Bar dataKey="per" fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={25}/>}
                            {dEnhanced.pbr!=null&&<Bar dataKey="pbr" fill="#10b981" radius={[2,2,0,0]} maxBarSize={25}/>}
                            {dEnhanced.psr!=null&&<Bar dataKey="psr" fill="#8b5cf6" radius={[2,2,0,0]} maxBarSize={25}/>}
                          </BarChart>
                        </ResponsiveContainer>
                      );
                    }
                    if (dEnhanced.eps != null) {
                      return (
                        <ResponsiveContainer width="100%" height={chartHSm}>
                          <BarChart data={singlePoint.filter(r=>r.eps!=null)} {...chartProps.margin}>
                            <CartesianGrid {...chartProps.cartesianGridProps}/>
                            <XAxis dataKey="period" {...chartProps.xAxisProps}/>
                            <YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>fmtFin(v)}/>
                            <Tooltip {...chartProps.tooltipProps} formatter={(v:number)=>[fmtFin(v),"EPS"]}/>
                            <Bar dataKey="eps" fill="#06b6d4" radius={[2,2,0,0]} maxBarSize={35}/>
                          </BarChart>
                        </ResponsiveContainer>
                      );
                    }
                    return null;
                  }
                  if (hasMultiple) {
                    return (
                      <ResponsiveContainer width="100%" height={chartHSm}>
                        <BarChart data={mh} {...chartProps.margin}>
                          <CartesianGrid {...chartProps.cartesianGridProps}/>
                          <XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                          <YAxis {...chartProps.yAxisProps}/>
                          <Tooltip {...chartProps.tooltipProps} formatter={(v:number,n:string)=>[Number(v).toFixed(2),{per:"PER",pbr:"PBR",psr:"PSR"}[n]??n]}/>
                          <Legend formatter={v=>({per:"PER",pbr:"PBR",psr:"PSR"}[v as string]??v)}/>
                          <Bar dataKey="per" fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={25}/>
                          <Bar dataKey="pbr" fill="#10b981" radius={[2,2,0,0]} maxBarSize={25}/>
                          <Bar dataKey="psr" fill="#8b5cf6" radius={[2,2,0,0]} maxBarSize={25}/>
                        </BarChart>
                      </ResponsiveContainer>
                    );
                  }
                  // EPS 차트 (PER/PBR 없을 때)
                  return (
                    <ResponsiveContainer width="100%" height={chartHSm}>
                      <BarChart data={mh.filter((r:any)=>r.eps!=null)} {...chartProps.margin}>
                        <CartesianGrid {...chartProps.cartesianGridProps}/>
                        <XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                        <YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>fmtFin(v)}/>
                        <Tooltip {...chartProps.tooltipProps} formatter={(v:number)=>[fmtFin(v),"EPS"]}/>
                        <Bar dataKey="eps" fill="#06b6d4" radius={[2,2,0,0]} maxBarSize={35}/>
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()}
                {/* 전치 테이블 */}
                <TransTable rows={[
                  { key:"per",  label:"PER",        fmt:(v)=>`${v.toFixed(1)}배`, color:"text-accent-blue" },
                  { key:"pbr",  label:"PBR",        fmt:(v)=>`${v.toFixed(2)}배`, color:"text-accent-green" },
                  { key:"psr",  label:"PSR",        fmt:(v)=>`${v.toFixed(2)}배`, color:"text-purple-400" },
                  { key:"eps",  label:"EPS",  fmt:(v)=>isKR?`₩${Math.round(v).toLocaleString("ko-KR")}`:(showKRW?fmtKRW(Math.round(v*exchangeRate)):fmtUSD(v)), color:"text-cyan-400" },
                  { key:"bps",  label:"BPS",  fmt:(v)=>isKR?`₩${Math.round(v).toLocaleString("ko-KR")}`:(showKRW?fmtKRW(Math.round(v*exchangeRate)):fmtUSD(v)), color:"text-text-secondary" },
                ]}/>
              </div>
            </div>
          )}

          {/* ── 기본 (수익성 + 종합 지표) ── */}
          {finSubTab==="basic" && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-semibold text-text-primary">기본 지표</span>
                <PeriodToggle />
              </div>
              <div className="p-4 flex flex-col gap-4">{(() => {
                const BASIC_METRICS = [
                  { key:"revenue",       label:"매출",         color:"#3b82f6", pct:false },
                  { key:"op_income",     label:"영업이익",     color:"#10b981", pct:false },
                  { key:"net_income",    label:"당기순이익",   color:"#8b5cf6", pct:false },
                  { key:"gross_margin",  label:"매출총이익률", color:"#3b82f6", pct:true  },
                  { key:"op_margin",     label:"영업이익률",   color:"#10b981", pct:true  },
                  { key:"net_margin",    label:"순이익률",     color:"#8b5cf6", pct:true  },
                  { key:"roe",           label:"ROE",          color:"#f59e0b", pct:true  },
                  { key:"debt_ratio",    label:"부채비율",     color:"#ef4444", pct:true  },
                  { key:"current_ratio", label:"유동비율",     color:"#10b981", pct:false },
                ];
                const curr = BASIC_METRICS.find(m => m.key === selectedMetric) ?? BASIC_METRICS[0];
                const chartData = mh.filter((r:any) => r[selectedMetric] != null);
                return (<>
                  {/* 지표 선택 버튼 */}
                  <div className="flex flex-wrap gap-1">
                    {BASIC_METRICS.map(m=>(
                      <button key={m.key} onClick={()=>setSelectedMetric(m.key)}
                        className={`px-2.5 py-1 text-xs rounded-lg font-semibold border transition-all ${selectedMetric===m.key?"text-white border-transparent":"border-border text-text-muted hover:text-text-primary"}`}
                        style={selectedMetric===m.key?{background:m.color+"cc",borderColor:m.color}:{}}
                      >{m.label}</button>
                    ))}
                  </div>
                  {/* 선택 지표 차트 */}
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={chartH}>
                      <BarChart data={chartData} {...chartProps.margin}>
                        <CartesianGrid {...chartProps.cartesianGridProps}/>
                        <XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                        <YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>curr.pct?`${v}%`:fmtFin(v)}/>
                        <Tooltip {...chartProps.tooltipProps} formatter={(v:number)=>[curr.pct?`${Number(v).toFixed(1)}%`:(fmtFin(v)), curr.label]}/>
                        <Bar dataKey={selectedMetric} fill={curr.color} radius={[3,3,0,0]} maxBarSize={50}/>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-text-muted text-sm py-4 text-center">연결 중...</p>}
                  {/* 전치 테이블 */}
                  <TransTable rows={BASIC_METRICS.map(m=>({
                    key: m.key,
                    label: m.label,
                    fmt: (v:number) => m.pct ? `${v.toFixed(1)}%` : (m.key==="current_ratio"||m.key==="quick_ratio" ? `${(v*100).toFixed(0)}%` : (fmtFin(v))),
                    color: "text-text-secondary",
                  }))}/>
                </>);
              })()}
              </div>
            </div>
          )}

          {/* ── 수익성 ── */}
          {finSubTab==="profitability" && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-semibold text-text-primary">수익성</span>
                <PeriodToggle />
              </div>
              <div className="p-4 flex flex-col gap-4">
                {d && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    <StatCell label="ROE" value={dEnhanced.roe!=null?`${dEnhanced.roe.toFixed(1)}%`:null}
                      color={dEnhanced.roe!=null?(dEnhanced.roe>=15?"text-accent-green":dEnhanced.roe<0?"text-accent-red":"text-text-primary"):undefined}/>
                    <StatCell label="매출총이익률" value={dEnhanced.gross_margin!=null?`${dEnhanced.gross_margin.toFixed(1)}%`:null}/>
                    <StatCell label="영업이익률" value={dEnhanced.op_margin!=null?`${dEnhanced.op_margin.toFixed(1)}%`:null}
                      color={dEnhanced.op_margin!=null?(dEnhanced.op_margin>=15?"text-accent-green":dEnhanced.op_margin<0?"text-accent-red":"text-text-primary"):undefined}/>
                    <StatCell label="순이익률" value={dEnhanced.net_margin!=null?`${dEnhanced.net_margin.toFixed(1)}%`:null}/>
                    <StatCell label="EPS" value={dEnhanced.eps!=null?(isKR?`₩${Math.round(dEnhanced.eps).toLocaleString("ko-KR")}`:fmtUSD(dEnhanced.eps)):null}/>
                    <StatCell label="선행EPS" value={dEnhanced.forward_eps!=null?(isKR?`₩${Math.round(dEnhanced.forward_eps).toLocaleString("ko-KR")}`:fmtUSD(dEnhanced.forward_eps)):null}/>
                  </div>
                )}
                {mhYears.length > 0 && (
                  <ResponsiveContainer width="100%" height={chartHSm}>
                    <BarChart data={mh.filter((r:any)=>r.op_margin||r.net_margin)} {...chartProps.margin}>
                      <CartesianGrid {...chartProps.cartesianGridProps}/>
                      <XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                      <YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>`${v}%`}/>
                      <Tooltip {...chartProps.tooltipProps} formatter={(v:number,n:string)=>[`${Number(v).toFixed(1)}%`,{gross_margin:"매출총이익률",op_margin:"영업이익률",net_margin:"순이익률",roe:"ROE"}[n]??n]}/>
                      <Legend formatter={v=>({gross_margin:"매출총이익률",op_margin:"영업이익률",net_margin:"순이익률",roe:"ROE"}[v as string]??v)}/>
                      <Bar dataKey="gross_margin" fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={20}/>
                      <Bar dataKey="op_margin"    fill="#10b981" radius={[2,2,0,0]} maxBarSize={20}/>
                      <Bar dataKey="net_margin"   fill="#8b5cf6" radius={[2,2,0,0]} maxBarSize={20}/>
                      <Bar dataKey="roe"          fill="#f59e0b" radius={[2,2,0,0]} maxBarSize={20}/>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                <TransTable rows={[
                  { key:"gross_margin", label:"매출총이익률", fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-blue" },
                  { key:"op_margin",    label:"영업이익률",   fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-green" },
                  { key:"net_margin",   label:"순이익률",     fmt:(v)=>`${v.toFixed(1)}%`, color:"text-purple-400" },
                  { key:"roe",          label:"ROE",          fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-yellow" },
                  { key:"eps",          label:"EPS",          fmt:(v)=>isKR?`₩${Math.round(v).toLocaleString("ko-KR")}`:(showKRW?fmtKRW(Math.round(v*exchangeRate)):fmtUSD(v)), color:"text-cyan-400" },
                ]}/>
              </div>
            </div>
          )}

          {/* ── 재무건전성 ── */}
          {finSubTab==="health" && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-semibold text-text-primary">재무건전성</span>
                <PeriodToggle />
              </div>
              <div className="p-4 flex flex-col gap-4">
                {/* 현재 지표 */}
                {d && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    <StatCell label="부채비율"  value={dEnhanced.debt_ratio!=null?`${dEnhanced.debt_ratio.toFixed(0)}%`:null}
                      color={dEnhanced.debt_ratio!=null?(dEnhanced.debt_ratio>200?"text-accent-red":dEnhanced.debt_ratio<100?"text-accent-green":"text-text-primary"):undefined}/>
                    <StatCell label="유동비율"  value={dEnhanced.current_ratio!=null?`${(dEnhanced.current_ratio*100).toFixed(0)}%`:null}
                      color={dEnhanced.current_ratio!=null?(dEnhanced.current_ratio>=2?"text-accent-green":dEnhanced.current_ratio<1?"text-accent-red":"text-text-primary"):undefined}/>
                    <StatCell label="당좌비율"  value={dEnhanced.quick_ratio!=null?`${(dEnhanced.quick_ratio*100).toFixed(0)}%`:null}/>
                    <StatCell label="배당수익률" value={d.dividend_yield!=null?`${d.dividend_yield.toFixed(2)}%`:null} color="text-accent-green"/>
                    <StatCell label="배당성향"  value={d.payout_ratio!=null?`${d.payout_ratio.toFixed(1)}%`:null}/>
                    <StatCell label="베타"      value={dEnhanced.beta!=null?dEnhanced.beta.toFixed(2):null}
                      color={dEnhanced.beta!=null?(dEnhanced.beta>1.5?"text-accent-red":dEnhanced.beta<0.5?"text-accent-green":"text-text-primary"):undefined}/>
                  </div>
                )}
                {/* 차트 */}
                {mhYears.length > 0 && (
                  <ResponsiveContainer width="100%" height={chartHSm}>
                    <BarChart data={mh.filter((r:any)=>r.debt_ratio||r.current_ratio)} {...chartProps.margin}>
                      <CartesianGrid {...chartProps.cartesianGridProps}/>
                      <XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                      <YAxis yAxisId="ratio" {...chartProps.yAxisProps}/>
                      <YAxis yAxisId="pct" orientation="right" {...chartProps.yAxisProps} tickFormatter={(v:number)=>`${v}%`}/>
                      <Tooltip {...chartProps.tooltipProps} formatter={(v:number,n:string)=>{const l:Record<string,string>={current_ratio:"유동비율",quick_ratio:"당좌비율",debt_ratio:"부채비율(%)"};return[n==="debt_ratio"?`${Number(v).toFixed(0)}%`:(n==="current_ratio"||n==="quick_ratio")?`${(Number(v)*100).toFixed(0)}%`:Number(v).toFixed(2),l[n]??n];}}/>
                      <Legend formatter={v=>({current_ratio:"유동비율",quick_ratio:"당좌비율",debt_ratio:"부채비율(%)"}[v as string]??v)}/>
                      <Bar yAxisId="ratio" dataKey="current_ratio" fill="#10b981" radius={[2,2,0,0]} maxBarSize={20}/>
                      <Bar yAxisId="ratio" dataKey="quick_ratio"   fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={20}/>
                      <Bar yAxisId="pct"   dataKey="debt_ratio"    fill="#ef4444" radius={[2,2,0,0]} maxBarSize={20}/>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {/* 전치 테이블 */}
                <TransTable rows={[
                  { key:"debt_ratio",    label:"부채비율",   fmt:(v)=>`${v.toFixed(0)}%`,        color:"text-accent-red" },
                  { key:"current_ratio", label:"유동비율",   fmt:(v)=>`${(v*100).toFixed(0)}%`,  color:"text-accent-green" },
                  { key:"quick_ratio",   label:"당좌비율",   fmt:(v)=>`${(v*100).toFixed(0)}%`,  color:"text-accent-blue" },
                ]}/>
              </div>
            </div>
          )}

          {/* ── 현금흐름 ── */}
          {finSubTab==="cashflow" && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-semibold text-text-primary">현금흐름</span>
                <PeriodToggle />
              </div>
              <div className="p-4 flex flex-col gap-4">
                {/* 현금흐름 바 차트 */}
                {mh.some((r:any) => r.operating_cf != null) && (
                  <div>
                    <p className="text-xs text-text-muted font-semibold mb-2">영업 / 투자 / 재무 현금흐름</p>
                    <ResponsiveContainer width="100%" height={chartH}>
                      <BarChart data={mh.filter((r:any)=>r.operating_cf!=null)} {...chartProps.margin}>
                        <CartesianGrid {...chartProps.cartesianGridProps}/>
                        <XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                        <YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>{const a=Math.abs(v);return isKR?(a>=1e12?(v/1e12).toFixed(0)+"조":a>=1e8?(v/1e8).toFixed(0)+"억":String(v)):(a>=1e9?(v/1e9).toFixed(0)+"B":a>=1e6?(v/1e6).toFixed(0)+"M":String(v));}}/>
                        <Tooltip {...chartProps.tooltipProps} formatter={(v:number,name:string)=>{const l:Record<string,string>={operating_cf:"영업현금흐름",investing_cf:"투자현금흐름",financing_cf:"재무현금흐름"};return[fmtFin(v),l[name]??name];}}/>
                        <Legend formatter={v=>({operating_cf:"영업현금흐름",investing_cf:"투자현금흐름",financing_cf:"재무현금흐름"}[v as string]??v)}/>
                        <Bar dataKey="operating_cf" fill="#10b981" radius={[2,2,0,0]} maxBarSize={28}/>
                        <Bar dataKey="investing_cf" fill="#ef4444" radius={[2,2,0,0]} maxBarSize={28}/>
                        <Bar dataKey="financing_cf" fill="#f59e0b" radius={[2,2,0,0]} maxBarSize={28}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {/* FCF 차트 */}
                {mh.some((r:any) => r.free_cf != null) && (
                  <div>
                    <p className="text-xs text-text-muted font-semibold mb-2">잉여현금흐름 (FCF)</p>
                    <ResponsiveContainer width="100%" height={chartHSm}>
                      <BarChart data={mh.filter((r:any)=>r.free_cf!=null)} {...chartProps.margin}>
                        <CartesianGrid {...chartProps.cartesianGridProps}/>
                        <XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                        <YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>{const a=Math.abs(v);return isKR?(a>=1e12?(v/1e12).toFixed(0)+"조":a>=1e8?(v/1e8).toFixed(0)+"억":String(v)):(a>=1e9?(v/1e9).toFixed(0)+"B":a>=1e6?(v/1e6).toFixed(0)+"M":String(v));}}/>
                        <Tooltip {...chartProps.tooltipProps} formatter={(v:number)=>[fmtFin(v),"FCF"]}/>
                        <Bar dataKey="free_cf" radius={[2,2,0,0]} maxBarSize={35}
                          fill="#3b82f6"
                          label={false}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {/* 전치 테이블 */}
                <TransTable rows={[
                  { key:"operating_cf", label:"영업현금흐름", fmt:(v)=>fmtFin(v), color:"text-accent-green" },
                  { key:"investing_cf", label:"투자현금흐름", fmt:(v)=>fmtFin(v), color:"text-accent-red" },
                  { key:"financing_cf", label:"재무현금흐름", fmt:(v)=>fmtFin(v), color:"text-accent-yellow" },
                  { key:"free_cf",      label:"FCF",         fmt:(v)=>fmtFin(v), color:"text-accent-blue" },
                  { key:"capex",        label:"CAPEX",        fmt:(v)=>fmtFin(v), color:"text-text-secondary" },
                  { key:"da",           label:"감가상각비",   fmt:(v)=>fmtFin(v), color:"text-text-secondary" },
                ]}/>
              </div>
            </div>
          )}

          </div>
        );
      })()}

      {/* 투자의견 탭 */}
      {mainTab==="analyst" && (() => {
        const ad = analystData as any;
        const pt = ad?.price_targets;
        const cs = ad?.consensus;
        const nc = ad?.naver_consensus; // Naver 컨센서스 (국내 종목)
        const reports: any[] = ad?.reports ?? [];
        const history: any[] = ad?.consensus_history ?? [];

        // 합의 등급 계산
        const totalVotes = cs ? cs.strong_buy + cs.buy + cs.hold + cs.sell + cs.strong_sell : 0;
        const scoreMap = { strong_buy: 5, buy: 4, hold: 3, sell: 2, strong_sell: 1 };
        const avgScore = cs && totalVotes > 0
          ? (cs.strong_buy*5 + cs.buy*4 + cs.hold*3 + cs.sell*2 + cs.strong_sell*1) / totalVotes
          : null;
        const ratingLabel = avgScore == null ? "—"
          : avgScore >= 4.5 ? "강력매수"
          : avgScore >= 3.5 ? "매수"
          : avgScore >= 2.5 ? "보유"
          : avgScore >= 1.5 ? "매도"
          : "강력매도";
        const ratingColor = avgScore == null ? "text-text-muted"
          : avgScore >= 4 ? "text-accent-green"
          : avgScore >= 3 ? "text-accent-yellow"
          : "text-accent-red";

        const upside = pt?.current && pt?.mean
          ? ((pt.mean - pt.current) / pt.current * 100)
          : null;

        const gradeColor = (g: string) => {
          const l = g.toLowerCase();
          if (l.includes("strong buy") || l.includes("outperform") || l.includes("overweight")) return "text-accent-green";
          if (l.includes("buy") || l.includes("positive") || l.includes("add")) return "text-accent-green";
          if (l.includes("hold") || l.includes("neutral") || l.includes("equal")) return "text-accent-yellow";
          if (l.includes("sell") || l.includes("underperform") || l.includes("reduce") || l.includes("underweight")) return "text-accent-red";
          return "text-text-primary";
        };

        const actionLabel = (a: string, pa: string) => {
          const al = a.toLowerCase();
          const pal = (pa || "").toLowerCase();
          if (al === "init") return { text: "신규", color: "text-accent-blue bg-accent-blue/10" };
          if (pal === "raises") return { text: "↑상향", color: "text-accent-green bg-accent-green/10" };
          if (pal === "lowers") return { text: "↓하향", color: "text-accent-red bg-accent-red/10" };
          if (pal === "maintains") return { text: "유지", color: "text-text-muted bg-bg-elevated" };
          return { text: a, color: "text-text-muted bg-bg-elevated" };
        };

        return (
          <div className="flex flex-col gap-4">
            {/* 서브탭 */}
            <div className="flex gap-1 p-1 rounded-xl border border-border bg-bg-card w-fit">
              <button onClick={() => setAnalystSubTab("opinion")}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${analystSubTab==="opinion" ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"}`}>
                투자의견
              </button>
              <button onClick={() => setAnalystSubTab("consensus")}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${analystSubTab==="consensus" ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"}`}>
                컨센서스
              </button>
            </div>

            {analystSubTab==="opinion" && (loadingAnalyst ? (
              <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/></div>
            ) : !ad || (!pt && !cs && !nc && reports.length === 0) ? (
              <div className="rounded-xl border border-border bg-bg-card flex items-center justify-center py-16">
                <p className="text-text-muted text-sm">투자의견 데이터가 없습니다</p>
              </div>
            ) : (
              <>
                {/* ── 국내 Naver 컨센서스 ── */}
                {nc && (
                  <div className="rounded-xl border border-border bg-bg-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="col-span-2 sm:col-span-4">
                      <span className="text-xs font-bold text-text-muted uppercase tracking-widest">Naver 컨센서스</span>
                    </div>
                    {nc.cons_per != null && (
                      <StatCell label="컨센서스 PER" value={`${fmtNum(nc.cons_per)}배`} color="text-accent-blue" />
                    )}
                    {nc.cons_eps != null && (
                      <StatCell label="컨센서스 EPS" value={isKR ? `₩${Math.round(nc.cons_eps).toLocaleString("ko-KR")}` : `$${nc.cons_eps.toFixed(2)}`} color="text-accent-green" />
                    )}
                    {nc.recommendation && (
                      <StatCell label="투자의견" value={nc.recommendation} />
                    )}
                    {nc.analyst_count && (
                      <StatCell label="애널리스트 수" value={`${nc.analyst_count}명`} />
                    )}
                  </div>
                )}

                {/* ── 목표주가 & 합의 등급 ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* 목표주가 */}
                  {pt && (
                    <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-text-muted uppercase tracking-widest">목표주가</span>
                        {upside != null && (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${upside >= 0 ? "bg-accent-green/10 text-accent-green" : "bg-accent-red/10 text-accent-red"}`}>
                            {upside >= 0 ? "+" : ""}{upside.toFixed(1)}% 상승여력
                          </span>
                        )}
                      </div>
                      {/* 목표가 바 */}
                      {pt.low != null && pt.high != null && pt.current != null && (
                        <div className="flex flex-col gap-1">
                          <div className="relative h-2 rounded-full bg-bg-elevated overflow-hidden">
                            {(() => {
                              const range = pt.high - pt.low;
                              const curPct = range > 0 ? Math.min(100, Math.max(0, ((pt.current - pt.low) / range) * 100)) : 50;
                              const meanPct = range > 0 ? Math.min(100, Math.max(0, ((pt.mean - pt.low) / range) * 100)) : 50;
                              return (
                                <>
                                  <div className="absolute inset-0 bg-gradient-to-r from-accent-red/30 via-accent-yellow/30 to-accent-green/30"/>
                                  <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-accent-blue shadow z-10"
                                    style={{ left: `calc(${curPct}% - 5px)` }} title="현재가"/>
                                  <div className="absolute top-1/2 -translate-y-1/2 w-2 h-4 rounded-sm bg-accent-green/80"
                                    style={{ left: `calc(${meanPct}% - 1px)` }} title="평균목표가"/>
                                </>
                              );
                            })()}
                          </div>
                          <div className="flex justify-between text-2xs text-text-muted font-mono">
                            <span>저 {isKR ? `₩${Math.round(pt.low).toLocaleString("ko-KR")}` : `$${pt.low?.toFixed(0)}`}</span>
                            <span>고 {isKR ? `₩${Math.round(pt.high).toLocaleString("ko-KR")}` : `$${pt.high?.toFixed(0)}`}</span>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-2 mt-1">
                        {[
                          { label:"평균", v: pt.mean, color:"text-accent-blue" },
                          { label:"최고", v: pt.high, color:"text-accent-green" },
                          { label:"최저", v: pt.low,  color:"text-accent-red" },
                        ].map(item => (
                          <div key={item.label} className="flex flex-col gap-0.5 items-center p-2 rounded-lg bg-bg-elevated">
                            <span className="text-2xs text-text-muted">{item.label}</span>
                            <span className={`text-sm font-mono font-bold ${item.color}`}>
                              {item.v != null ? (isKR ? `₩${Math.round(item.v).toLocaleString("ko-KR")}` : `$${item.v.toFixed(0)}`) : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-text-muted text-center">
                        현재가 {isKR ? `₩${Math.round(pt.current ?? 0).toLocaleString("ko-KR")}` : `$${(pt.current ?? 0).toFixed(2)}`} 기준 · {totalVotes}명 애널리스트
                      </div>
                    </div>
                  )}

                  {/* 합의 등급 */}
                  {cs && (
                    <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-3">
                      <span className="text-xs font-bold text-text-muted uppercase tracking-widest">투자의견 합의</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-2xl font-bold ${ratingColor}`}>{ratingLabel}</span>
                        {avgScore != null && <span className="text-sm text-text-muted font-mono">{avgScore.toFixed(2)} / 5.0</span>}
                      </div>
                      {/* 분포 바 */}
                      <div className="flex flex-col gap-1.5">
                        {[
                          { label:"강력매수", key:"strong_buy",  color:"#10b981" },
                          { label:"매수",     key:"buy",         color:"#34d399" },
                          { label:"보유",     key:"hold",        color:"#f59e0b" },
                          { label:"매도",     key:"sell",        color:"#f87171" },
                          { label:"강력매도", key:"strong_sell", color:"#ef4444" },
                        ].map(({ label, key, color }) => {
                          const cnt = cs[key] ?? 0;
                          const pct = totalVotes > 0 ? (cnt / totalVotes) * 100 : 0;
                          return (
                            <div key={key} className="flex items-center gap-2">
                              <span className="text-2xs text-text-muted w-14 flex-shrink-0">{label}</span>
                              <div className="flex-1 h-2 rounded-full bg-bg-elevated overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }}/>
                              </div>
                              <span className="text-2xs font-mono text-text-muted w-6 text-right">{cnt}</span>
                            </div>
                          );
                        })}
                      </div>
                      {/* 최근 3개월 추이 */}
                      {history.length > 1 && (
                        <div className="border-t border-border pt-2">
                          <p className="text-2xs text-text-muted mb-1.5">최근 추이</p>
                          <div className="flex gap-2">
                            {history.slice(0, 4).map((h: any, i: number) => {
                              const tot = h.strong_buy + h.buy + h.hold + h.sell + h.strong_sell;
                              const bs = ((h.strong_buy + h.buy) / (tot || 1) * 100).toFixed(0);
                              const label = ["이번달","1개월전","2개월전","3개월전"][i] ?? h.period;
                              return (
                                <div key={i} className="flex-1 flex flex-col items-center gap-0.5 p-1.5 rounded-lg bg-bg-elevated">
                                  <span className="text-2xs text-text-muted">{label}</span>
                                  <span className="text-xs font-bold text-accent-green">{bs}%</span>
                                  <span className="text-2xs text-text-dim">매수</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── 최근 애널리스트 리포트 ── */}
                {reports.length > 0 && (
                  <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
                    <div className="px-4 py-3 border-b border-border">
                      <span className="text-sm font-semibold text-text-primary">최근 애널리스트 리포트</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border text-text-muted">
                            <th className="text-left px-4 py-2 font-medium">날짜</th>
                            <th className="text-left px-4 py-2 font-medium">증권사</th>
                            <th className="text-left px-4 py-2 font-medium">투자의견</th>
                            <th className="text-right px-4 py-2 font-medium">목표가</th>
                            <th className="text-center px-4 py-2 font-medium">액션</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reports.map((r: any, i: number) => {
                            const act = actionLabel(r.action, r.price_action);
                            return (
                              <tr key={i} className="border-b border-border/30 hover:bg-bg-hover transition-colors">
                                <td className="px-4 py-2.5 font-mono text-text-muted whitespace-nowrap">{r.date}</td>
                                <td className="px-4 py-2.5 font-semibold text-text-primary whitespace-nowrap">{r.firm || "—"}</td>
                                <td className={`px-4 py-2.5 font-semibold whitespace-nowrap ${gradeColor(r.to_grade)}`}>{r.to_grade || "—"}</td>
                                <td className="px-4 py-2.5 text-right font-mono text-text-primary whitespace-nowrap">
                                  {r.target != null ? (isKR ? `₩${Math.round(r.target).toLocaleString("ko-KR")}` : `$${r.target.toFixed(0)}`) : "—"}
                                  {r.prior_target != null && r.target != null && r.prior_target !== r.target && (
                                    <span className="text-text-muted ml-1 text-[10px]">
                                      ({r.target > r.prior_target ? "↑" : "↓"}{isKR ? `₩${Math.round(r.prior_target).toLocaleString("ko-KR")}` : `$${r.prior_target.toFixed(0)}`})
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-center">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${act.color}`}>{act.text}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ))}

            {analystSubTab==="consensus" && (() => {
              const fcstData = (forecasts as any)?.[consensusPeriod] ?? [];
              if (!fcstData.length) return (
                <div className="rounded-xl border border-border bg-bg-card flex items-center justify-center py-16">
                  <p className="text-text-muted text-sm">컨센서스 데이터가 없습니다</p>
                </div>
              );

              // 기간 컬럼 생성
              const periods = fcstData.map((r: any) => r.period);
              const periodLabel = (p: string) => {
                if (consensusPeriod === "annual") return p.slice(0,4);
                // 분기: 2024-01-01 → 2024 Q1 식으로
                const y = p.slice(0,4);
                const mo = parseInt(p.slice(5,7));
                const q = Math.ceil(mo/3);
                return `${y} Q${q}`;
              };

              const indicators = [
                { key: "revenue_est",  label: "매출 추정",        color: "text-accent-blue",    fmt: (v: number) => isKR ? fmtKRW(v) : fmtUSD(v) },
                { key: "revenue_low",  label: "매출 최저",         color: "text-accent-blue/60", fmt: (v: number) => isKR ? fmtKRW(v) : fmtUSD(v) },
                { key: "revenue_high", label: "매출 최고",         color: "text-accent-blue/60", fmt: (v: number) => isKR ? fmtKRW(v) : fmtUSD(v) },
                { key: "eps_est",      label: "EPS 추정",          color: "text-accent-green",   fmt: (v: number) => isKR ? `₩${Math.round(v).toLocaleString("ko-KR")}` : `$${v.toFixed(2)}` },
                { key: "eps_low",      label: "EPS 최저",          color: "text-accent-green/60",fmt: (v: number) => isKR ? `₩${Math.round(v).toLocaleString("ko-KR")}` : `$${v.toFixed(2)}` },
                { key: "eps_high",     label: "EPS 최고",          color: "text-accent-green/60",fmt: (v: number) => isKR ? `₩${Math.round(v).toLocaleString("ko-KR")}` : `$${v.toFixed(2)}` },
                { key: "eps_current",  label: "EPS 현재 추정",     color: "text-cyan-400",       fmt: (v: number) => isKR ? `₩${Math.round(v).toLocaleString("ko-KR")}` : `$${v.toFixed(2)}` },
                { key: "eps_30d_ago",  label: "EPS 30일 전",       color: "text-text-muted",     fmt: (v: number) => isKR ? `₩${Math.round(v).toLocaleString("ko-KR")}` : `$${v.toFixed(2)}` },
                { key: "eps_90d_ago",  label: "EPS 90일 전",       color: "text-text-muted",     fmt: (v: number) => isKR ? `₩${Math.round(v).toLocaleString("ko-KR")}` : `$${v.toFixed(2)}` },
                { key: "growth_est",   label: "EPS 성장률 추정",   color: "text-accent-yellow",  fmt: (v: number) => `${(v*100).toFixed(1)}%` },
              ].filter(ind => fcstData.some((r: any) => r[ind.key] != null));

              return (
                <div className="flex flex-col gap-3">
                  {/* 연간/분기 토글 */}
                  <div className="flex gap-1 p-0.5 rounded-lg border border-border bg-bg-primary w-fit">
                    {(["annual","quarterly"] as const).map(k => (
                      <button key={k} onClick={() => setConsensusPeriod(k)}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${consensusPeriod===k?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}>
                        {k==="annual" ? "연간" : "분기"}
                      </button>
                    ))}
                  </div>
                  {/* 테이블 */}
                  <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
                    <div className="px-4 py-3 border-b border-border">
                      <span className="text-sm font-semibold text-text-primary">애널리스트 컨센서스 추정치</span>
                    </div>
                    <div className="overflow-x-auto p-4">
                      <table className="text-xs w-max min-w-full">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left pb-2 font-medium text-text-muted sticky left-0 bg-bg-card min-w-[120px] pr-4">지표</th>
                            {periods.map((p: string) => (
                              <th key={p} className="text-right pb-2 font-mono font-semibold text-accent-yellow/90 px-3 min-w-[90px] whitespace-nowrap">{periodLabel(p)}E</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {indicators.map(ind => (
                            <tr key={ind.key} className="border-b border-border/30 hover:bg-bg-hover">
                              <td className={`py-2 pr-4 font-medium sticky left-0 bg-bg-card whitespace-nowrap ${ind.color}`}>{ind.label}</td>
                              {fcstData.map((r: any, i: number) => (
                                <td key={i} className={`py-2 px-3 text-right font-mono ${ind.color}`}>
                                  {r[ind.key] != null ? ind.fmt(r[ind.key]) : "—"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* 뉴스/공시 탭 */}
      {mainTab==="news" && (
        <div className="flex flex-col gap-4">
          {/* 서브탭 선택 */}
          <div className="flex gap-1 p-1 rounded-xl border border-border bg-bg-card w-fit">
            <button
              onClick={() => { setNewsSubTab("news"); setNewsExpanded(false); }}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${newsSubTab==="news" ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"}`}
            >
              <Newspaper size={11}/>뉴스
            </button>
            <button
              onClick={() => setNewsSubTab("disclosure")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${newsSubTab==="disclosure" ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"}`}
            >
              <FileText size={11}/>공시
            </button>
          </div>

          {/* ── 뉴스 서브탭 ── */}
          {newsSubTab==="news" && (
            <>
          {/* 종목 뉴스 */}
          <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-sm font-semibold text-text-primary">관련 뉴스</span>
              <div className="flex gap-1">
                {(["latest","popular"] as const).map(s=>(
                  <button key={s}
                    onClick={()=>setNewsSort(s)}
                    className={`px-2 py-0.5 text-2xs rounded font-semibold transition-all ${newsSort===s?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}>
                    {s==="latest"?"최신순":"인기순"}
                  </button>
                ))}
              </div>
            </div>
            {loadingNews ? (
              <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/></div>
            ) : (stockNews?.length ?? 0) > 0 ? (() => {
              const sorted = [...(stockNews ?? [])].sort((a,b)=>
                newsSort==="popular"
                  ? (b._trend_score ?? 0) - (a._trend_score ?? 0)
                  : String(b.published ?? "").localeCompare(String(a.published ?? ""))
              );
              const shown = newsExpanded ? sorted : sorted.slice(0, 10);
              const remaining = sorted.length - 10;
              return (
                <>
                  <ul>
                    {shown.map((item: any, i: number) => (
                      <li key={i} className="border-b border-border/30 last:border-0">
                        <a href={item.link} target="_blank" rel="noopener noreferrer"
                          className="flex items-start gap-3 px-4 py-3 hover:bg-bg-hover transition-colors group">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-text-primary group-hover:text-accent-blue transition-colors line-clamp-2">{item.title}</p>
                            <div className="flex items-center gap-2 mt-1">
                              {item.source && <span className="text-2xs text-accent-blue/70 font-medium">{item.source}</span>}
                              {item.published && <span className="text-2xs text-text-muted">{typeof item.published === "number" ? new Date(item.published*1000).toLocaleDateString("ko-KR") : item.published}</span>}
                            </div>
                            {item.summary && <p className="text-xs text-text-muted mt-1 line-clamp-2">{item.summary}</p>}
                          </div>
                          <ExternalLink size={12} className="text-text-muted flex-shrink-0 mt-1"/>
                        </a>
                      </li>
                    ))}
                  </ul>
                  {remaining > 0 && (
                    <button onClick={() => setNewsExpanded(v => !v)}
                      className="w-full py-2.5 text-xs font-semibold text-text-muted hover:text-accent-blue hover:bg-bg-elevated transition-all border-t border-border">
                      {newsExpanded ? "접기 ▲" : `더보기 (${remaining}건 더) ▼`}
                    </button>
                  )}
                </>
              );
            })() : (
              <p className="py-8 text-center text-text-muted text-sm">뉴스 데이터가 없습니다</p>
            )}
          </div>
          {/* 실적발표 */}
          {earningsData && (earningsData.upcoming?.length > 0 || earningsData.history?.length > 0) && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold text-text-primary">실적발표</span>
                <DollarSign size={14} className="text-text-muted"/>
              </div>
              <div className="p-4 flex flex-col gap-4">
                {/* 예정 실적 */}
                {earningsData.upcoming?.length > 0 && (
                  <div>
                    <SectionTitle>예정 발표일</SectionTitle>
                    <div className="flex flex-wrap gap-2">
                      {earningsData.upcoming.filter(Boolean).map((dt: string, i: number) => (
                        <span key={i} className="px-3 py-1.5 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-accent-blue text-xs font-mono font-semibold">
                          {dt}
                        </span>
                      ))}
                      {earningsData.eps_estimate != null && (
                        <span className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-text-muted text-xs">
                          EPS 예상: {isKR ? earningsData.eps_estimate?.toLocaleString("ko-KR") : `$${earningsData.eps_estimate?.toFixed(2)}`}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {/* 과거 실적 */}
                {earningsData.history?.length > 0 && (
                  <div>
                    <SectionTitle>과거 실적</SectionTitle>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-text-muted border-b border-border">
                            <th className="text-left pb-2 font-medium">연도</th>
                            <th className="text-right pb-2 font-medium text-accent-blue">매출</th>
                            <th className="text-right pb-2 font-medium text-accent-green">순이익</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...earningsData.history].reverse().map((row: any) => (
                            <tr key={row.period} className="border-b border-border/30 hover:bg-bg-hover">
                              <td className="py-1.5 font-mono text-text-muted">{row.period}</td>
                              <td className="py-1.5 text-right font-mono text-accent-blue num">{isKR?fmtKRW(row.revenue):fmtUSD(row.revenue)}</td>
                              <td className={`py-1.5 text-right font-mono num ${(row.earnings??0)>=0?"text-accent-green":"text-accent-red"}`}>{isKR?fmtKRW(row.earnings):fmtUSD(row.earnings)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

            </>
          )}

          {/* ── 공시 서브탭 ── */}
          {newsSubTab==="disclosure" && (
            isKR
              ? <DisclosurePanel symbol={sym} />
              : (
                <div className="rounded-xl border border-border bg-bg-card flex items-center justify-center py-16">
                  <p className="text-text-muted text-sm">공시 데이터는 국내 주식(KR)만 지원합니다</p>
                </div>
              )
          )}
        </div>
      )}

      {/* 일별 탭 */}
      {mainTab==="daily" && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-text-primary">일별 시세</span>
              {fetchingDaily && <div className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/>}
            </div>
            {dailyOhlcv?.length ? (
              <span className="text-xs text-text-muted">{(dailyOhlcv as any[]).length}일</span>
            ) : null}
          </div>
          {!dailyOhlcv?.length ? (
            <div className="py-12 text-center text-text-muted text-sm">{fetchingDaily ? "로딩 중..." : "데이터 없음"}</div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border bg-bg-secondary">
                    <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap sticky left-0 bg-bg-secondary">날짜</th>
                    <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">종가</th>
                    <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">등락률</th>
                    <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">거래량</th>
                    <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">거래대금</th>
                    <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">시가</th>
                    <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">고가</th>
                    <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap pr-4">저가</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(dailyOhlcv as any[])].reverse().map((bar: any, i: number, arr: any[]) => {
                    const prevClose = arr[i + 1]?.close;
                    const chgRate = prevClose ? ((bar.close - prevClose) / prevClose * 100) : 0;
                    const isPos = chgRate >= 0;
                    const amount = bar.close * (bar.volume || 0);
                    return (
                      <tr key={bar.date} className="border-b border-border/30 hover:bg-bg-hover">
                        <td className="px-4 py-2.5 font-mono text-text-muted whitespace-nowrap sticky left-0 bg-bg-card">{bar.date?.slice(0,10)}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-semibold text-text-primary whitespace-nowrap">
                          {isKR ? `₩${bar.close?.toLocaleString("ko-KR", {maximumFractionDigits:0})}` : `$${bar.close?.toFixed(2)}`}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono whitespace-nowrap ${prevClose ? (isPos ? "text-accent-green" : "text-accent-red") : "text-text-muted"}`}>
                          {prevClose ? `${isPos?"+":""}${chgRate.toFixed(2)}%` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-text-muted whitespace-nowrap">
                          {bar.volume ? (bar.volume >= 1e8 ? `${(bar.volume/1e8).toFixed(1)}억` : bar.volume >= 1e4 ? `${(bar.volume/1e4).toFixed(1)}만` : bar.volume.toLocaleString()) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-text-muted whitespace-nowrap">
                          {amount > 0 ? (isKR ? fmtKRW(amount) : fmtUSD(amount)) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-text-muted whitespace-nowrap">
                          {isKR ? bar.open?.toLocaleString("ko-KR", {maximumFractionDigits:0}) : bar.open?.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-accent-red/80 whitespace-nowrap">
                          {isKR ? bar.high?.toLocaleString("ko-KR", {maximumFractionDigits:0}) : bar.high?.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-accent-blue/80 whitespace-nowrap pr-4">
                          {isKR ? bar.low?.toLocaleString("ko-KR", {maximumFractionDigits:0}) : bar.low?.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* 더보기 버튼 — 1달씩 추가 */}
            {dailyMonths <= 12 && (
              <button
                onClick={() => setDailyMonths(prev => prev + 1)}
                disabled={fetchingDaily}
                className="w-full py-3 text-xs font-semibold text-text-muted hover:text-accent-blue hover:bg-bg-elevated transition-all border-t border-border"
              >
                {fetchingDaily ? "로딩 중..." : `더보기 (+1개월) ▼`}
              </button>
            )}
            </>
          )}
        </div>
      )}

      {/* 수급 탭 — 서비스 준비중 */}
      {mainTab==="supply" && isKR && (
        <div className="rounded-xl border border-border bg-bg-card flex flex-col items-center justify-center py-20 gap-4">
          <Users size={40} className="text-text-muted/30"/>
          <div className="text-center">
            <p className="text-text-primary font-semibold text-sm">서비스 준비중입니다</p>
            <p className="text-text-muted text-xs mt-1">투자자별 수급 데이터는 곧 제공될 예정입니다</p>
          </div>
        </div>
      )}

      {/* 커뮤니티 탭 — 서비스 준비중 */}
      {mainTab==="community" && (
        <div className="rounded-xl border border-border bg-bg-card flex flex-col items-center justify-center py-20 gap-4">
          <MessageSquare size={40} className="text-text-muted/30"/>
          <div className="text-center">
            <p className="text-text-primary font-semibold text-sm">서비스 준비중입니다</p>
            <p className="text-text-muted text-xs mt-1">종목 커뮤니티 기능은 곧 제공될 예정입니다</p>
          </div>
        </div>
      )}

      {/* 기업 정보 */}
      {d && (d.industry || d.description) && (
        <div className="rounded-xl p-4 border border-border bg-bg-card">
          {d.sector && <div className="flex flex-col gap-0.5 mb-3"><span className="text-2xs text-text-muted">섹터 · 산업</span><span className="text-sm text-text-primary">{d.sector}{d.industry?` > ${d.industry}`:""}</span></div>}
          {d.description && <p className="text-xs text-text-muted leading-relaxed line-clamp-4">{d.description}</p>}
        </div>
      )}
    </div>
  );
}

function DisclosurePanel({ symbol }: { symbol: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["disclosures", symbol],
    queryFn: () => api.get(`/stocks/KR/${encodeURIComponent(symbol)}/disclosures`).then(r=>r.data),
    staleTime: 1_800_000,
  });
  if (isLoading) return <div className="rounded-xl border border-border bg-bg-card p-8 text-center text-text-muted text-sm">공시 로딩 중...</div>;
  const items = Array.isArray(data) ? data : [];
  return (
    <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">최근 공시</span>
        <FileText size={14} className="text-text-muted"/>
      </div>
      {!items.length ? (
        <p className="py-8 text-center text-text-muted text-sm">공시 데이터가 없습니다 (OpenDART API 키 필요)</p>
      ) : (
        <ul>{items.map((item: any, i: number) => (
          <li key={i} className="border-b border-border/30 last:border-0">
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors group">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary group-hover:text-accent-blue transition-colors">{item.title}</p>
                <p className="text-2xs text-text-muted mt-0.5">{item.reporter} · {fmtDate(item.date?.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"))}</p>
              </div>
              <FileText size={13} className="text-text-muted flex-shrink-0"/>
            </a>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
