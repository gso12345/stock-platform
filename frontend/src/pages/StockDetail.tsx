import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import api from "@/api/client";
import { stocksApi, watchlistApi, watchlistFolderApi, financialsApi, portfolioApi, type QuantWeights, type QuantEnabledMetrics } from "@/api/stocks";
import { useQuantSettings, QUANT_DEFAULT_WEIGHTS } from "@/hooks/useQuantSettings";
import { marketSession, SESSION_LABEL } from "@/hooks/useLivePrices";
import QuantSettingsPanel from "@/components/quant/QuantSettingsPanel";
import { Card, Tabs, 용어힌트 } from "@/components/ui";
import {
  ArrowLeft, Star, TrendingUp, TrendingDown, BarChart2, DollarSign,
  RefreshCw, FileText, CandlestickChart, LineChart, AreaChart,
  Newspaper, Users, ExternalLink, Maximize2, X, List, MessageSquare,
  Gauge, Settings2, HelpCircle, Wallet, Share2, Check,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { Market } from "@/types";
import StockChart, { CANDLE_GROUPS, CANDLE_MAX_PERIOD, type ChartType } from "@/components/chart/StockChart";
import { fmtKRW, fmtUSD, fmtNum, fmtDate, fmtNewsDateTime, fmtVolume } from "@/utils/formatters";
import { safeExternalUrl } from "@/utils/url";
import { isETFStock } from "@/utils/etf";
import { 격자, 축, 툴팁 } from "@/utils/chartTheme";
import { addRecentlyViewed } from "@/utils/recentlyViewed";
import { GRADE_BANDS, gradeColor, scoreColor } from "@/utils/quant";
import CommunityTab from "@/components/community/CommunityTab";
import SupplyDemandTab from "@/components/stock/SupplyDemandTab";
import RangeBar from "@/components/stock/RangeBar";
import { AddToPortfolioModal } from "@/components/watchlist/WatchlistModals";

/* ── 지표 셀 ────────────────────────────────────────── */
function StatCell({ label, value, color, sub }: { label: string; value: React.ReactNode; color?: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 p-3 rounded-xl border border-border bg-bg-elevated">
      {/* 이 한 자리가 PER·PBR·ROE 등 스물다섯 가지 이름을 다 그린다.
          용어힌트는 사전에 없는 이름이면 물음표 없이 글자만 내보내므로,
          어떤 이름이 와도 그냥 통과한다 */}
      <span className="text-xs text-text-muted font-medium uppercase tracking-wide">
        <용어힌트 이름={label} />
      </span>
      <span className={`text-base font-mono font-semibold truncate ${color ?? "text-text-primary"}`}>{value ?? "—"}</span>
      {sub && <span className="text-xs text-text-muted font-mono">{sub}</span>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-bold text-text-muted uppercase tracking-widest mb-2">{children}</h3>;
}

/* ── 재무제표 탭 — 기간 토글 ─────────────────────────────── */
function PeriodToggle({ finPeriod, setFinPeriod }: {
  finPeriod: "annual" | "quarterly";
  setFinPeriod: (v: "annual" | "quarterly") => void;
}) {
  return (
    <div className="flex gap-1 p-0.5 rounded-lg border border-border bg-bg-primary">
      {(["annual","quarterly"] as const).map(k=>(
        <button key={k} onClick={()=>setFinPeriod(k)}
          className={`px-2.5 py-1 text-sm font-semibold rounded-md transition-all ${finPeriod===k?"bg-accent-blue text-white":"text-text-muted"}`}>
          {k==="annual"?"연간":"분기"}
        </button>
      ))}
    </div>
  );
}

/* ── 재무제표 탭 — 전치 테이블 ──────────────────────────── */
function TransTable({ rows, allYears, getVal, finPeriod }: {
  rows: { key: string; label: string; fmt: (v: number) => string; color: string; boldLabel?: boolean }[];
  allYears: string[];
  getVal: (key: string, year: string) => number | null;
  finPeriod: "annual" | "quarterly";
}) {
  if (!allYears.length) return <p className="text-text-muted text-base py-4 text-center">연결 중...</p>;
  const filteredRows = rows.filter(r => r.key);
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="text-sm w-max min-w-full">
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
}
import MetricManagerModal from "@/components/stock/MetricManagerModal";

/* ── 사용자설정 재무지표 옵션 ───────────────────────────── */
const FIN_CUSTOM_OPTS = [
  // 손익계산서
  { key: "revenue",           label: "매출",           group: "손익계산서",   fmt: "fin",    color: "#3b82f6" },
  { key: "op_income",         label: "영업이익",       group: "손익계산서",   fmt: "fin",    color: "#10b981" },
  { key: "net_income",        label: "당기순이익",     group: "손익계산서",   fmt: "fin",    color: "#8b5cf6" },
  { key: "eps",               label: "EPS",            group: "손익계산서",   fmt: "epsbps", color: "#22d3ee" },
  { key: "revenue_growth",    label: "매출성장률",     group: "손익계산서",   fmt: "pct",    color: "#60a5fa" },
  { key: "op_income_growth",  label: "영업이익성장률", group: "손익계산서",   fmt: "pct",    color: "#34d399" },
  { key: "net_income_growth", label: "순이익성장률",   group: "손익계산서",   fmt: "pct",    color: "#a78bfa" },
  // 마진
  { key: "gross_margin",      label: "총이익률",       group: "마진",         fmt: "pct",    color: "#94a3b8" },
  { key: "op_margin",         label: "영업이익률",     group: "마진",         fmt: "pct",    color: "#10b981" },
  { key: "net_margin",        label: "순이익률",       group: "마진",         fmt: "pct",    color: "#8b5cf6" },
  // 수익성
  { key: "roe",               label: "ROE",            group: "수익성",       fmt: "pct",    color: "#06b6d4" },
  { key: "roa",               label: "ROA",            group: "수익성",       fmt: "pct",    color: "#0ea5e9" },
  /* ROCE 는 뺐다 — 백엔드가 이 값을 만들지 않는다(stocks.py 의 _process 는
     roce 를 계산하지 않는다). 목록에 두면 20칸 중 하나를 골라 놓고 영원히
     '—' 만 보게 된다. 백엔드가 주기 시작하면 그때 되살린다. */
  // 밸류에이션
  { key: "per",               label: "PER",            group: "밸류에이션",   fmt: "x",      color: "#f59e0b" },
  { key: "forward_per",       label: "선행PER",        group: "밸류에이션",   fmt: "x",      color: "#fbbf24" },
  { key: "pbr",               label: "PBR",            group: "밸류에이션",   fmt: "x",      color: "#f97316" },
  { key: "psr",               label: "PSR",            group: "밸류에이션",   fmt: "x",      color: "#eab308" },
  { key: "peg",               label: "PEG",            group: "밸류에이션",   fmt: "x",      color: "#84cc16" },
  { key: "ev_ebitda",         label: "EV/EBITDA",      group: "밸류에이션",   fmt: "x",      color: "#a3e635" },
  // 재무건전성
  { key: "debt_ratio",        label: "부채비율",       group: "재무건전성",   fmt: "pct",    color: "#ef4444" },
  { key: "current_ratio",     label: "유동비율",       group: "재무건전성",   fmt: "ratio_pct", color: "#22c55e" },
  { key: "interest_coverage", label: "이자보상비율",   group: "재무건전성",   fmt: "x",      color: "#16a34a" },
  { key: "net_debt",          label: "순부채",         group: "재무건전성",   fmt: "fin",    color: "#dc2626" },
  { key: "total_assets",      label: "총자산",         group: "재무건전성",   fmt: "fin",    color: "#6b7280" },
  { key: "equity",            label: "자기자본",       group: "재무건전성",   fmt: "fin",    color: "#4b5563" },
  // 현금흐름
  { key: "operating_cf",      label: "영업현금흐름",   group: "현금흐름",     fmt: "fin",    color: "#10b981" },
  { key: "investing_cf",      label: "투자현금흐름",   group: "현금흐름",     fmt: "fin",    color: "#ef4444" },
  { key: "financing_cf",      label: "재무현금흐름",   group: "현금흐름",     fmt: "fin",    color: "#f59e0b" },
  { key: "free_cf",           label: "잉여현금흐름",   group: "현금흐름",     fmt: "fin",    color: "#3b82f6" },
  { key: "capex",             label: "CAPEX",          group: "현금흐름",     fmt: "fin",    color: "#8b5cf6" },
  { key: "da",                label: "감가상각비",     group: "현금흐름",     fmt: "fin",    color: "#64748b" },
] as const;

const FIN_CUSTOM_KEY = "stkplt_fin_custom_v1";

/** 0 을 '값 없음' 으로 본다.
 *
 *  PER·EPS·BPS 같은 밸류에이션 지표에서 0 은 실제 값이 아니라 "못 구했다" 는
 *  뜻이다. 백엔드가 0.0 을 내려보내는 경로가 있는데(kis_service), `??` 도
 *  `== null` 도 0 을 값으로 치기 때문에 여러 출처를 순서대로 보는 폴백이
 *  첫 칸에서 멈춰 버렸다. 그래서 판정 전에 한 번 걸러 준다.
 *
 *  마진·부채비율·배당수익률처럼 0 이 정말 0 일 수 있는 것에는 쓰지 않는다. */
const 유효 = (v: unknown): number | null =>
  typeof v === "number" && v !== 0 && Number.isFinite(v) ? v : null;

/* ── 메인 ───────────────────────────────────────────── */
export default function StockDetail() {
  const { market, symbol: rawSymbol } = useParams<{ market: string; symbol: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const m   = (market?.toUpperCase() || "US") as Market;
  /* decodeURIComponent 는 깨진 % 인코딩에 URIError 를 던진다.
     /stocks/KR/% 같은 주소 하나로 이 화면이 아니라 앱 전체가 흰 화면이 됐다
     (그리다 던지면 React 가 트리를 통째로 걷어낸다). 못 풀면 원문을 쓴다 —
     어차피 없는 종목이면 아래 '데이터를 불러올 수 없습니다' 가 뜬다. */
  const sym = (() => {
    try { return decodeURIComponent(rawSymbol ?? "").toUpperCase(); }
    catch { return (rawSymbol ?? "").toUpperCase(); }
  })();
  const isKR = m === "KR";
  const { isLoggedIn } = useAuthStore();

  const [candleType, setCandleType]   = useState("1d");
  const [chartType, setChartType]     = useState<ChartType>("candle");
  const [logScale, setLogScale]       = useState(false);
  const [fullscreen, setFullscreen]   = useState(false);
  /* 전체화면 차트가 쓸 수 있는 높이. 창 크기·회전에 따라 달라지므로 잰다.
     
     useLayoutEffect 를 쓴다. StockChart 는 height 가 바뀌면 차트를 부수고
     다시 만든다(chart.remove() 후 재생성). 그냥 useEffect 로 재면 첫 그림이
     최소값(260px)으로 한 번 그려진 뒤 곧바로 부수고 제 높이로 다시 그려서,
     전체화면을 여는 순간 화면이 크게 흔들린다.
     useLayoutEffect 는 화면에 칠하기 전에 돌므로 처음부터 제 높이로 한 번만
     그린다. */
  const 전체차트칸 = useRef<HTMLDivElement>(null);
  const [전체차트높이, set전체차트높이] = useState(0);
  useLayoutEffect(() => {
    if (!fullscreen) { set전체차트높이(0); return; }
    const 재기 = () => {
      /* 소수점이 붙으면 콘텐츠가 컨테이너보다 미세하게 커져 스크롤바가
         생겼다 사라지기를 반복한다. 내림해서 잰다. */
      const h = Math.floor(전체차트칸.current?.getBoundingClientRect().height ?? 0);
      if (h > 0) set전체차트높이(h);
    };
    재기();
    // 화면을 돌리면 높이가 바뀐다. ResizeObserver 가 없는 환경도 있어 창
    // 크기 변화도 같이 듣는다
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(재기) : null;
    if (ro && 전체차트칸.current) ro.observe(전체차트칸.current);
    window.addEventListener("resize", 재기);
    window.addEventListener("orientationchange", 재기);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", 재기);
      window.removeEventListener("orientationchange", 재기);
    };
  }, [fullscreen]);

  /* 숫자키 단축키는 탭 목록이 만들어진 뒤에 건다 (아래 '탭목록' 참고).
     예전에는 여기에 7개짜리 배열이 따로 박혀 있어서 실제 탭과 어긋났다. */
  const [mainTab, setMainTab]       = useState<"chart" | "financial" | "quant" | "news" | "daily" | "analyst" | "supply" | "community" | "holdings">("chart");
  const [isMobile, setIsMobile]     = useState(typeof window !== "undefined" && window.innerWidth < 640);
  const [showKRW, setShowKRW]           = useState(false);
  /* 캔들/라인/영역·LOG 는 한 번 정하면 잘 안 바꾼다. 톱니를 눌렀을 때만 편다 */
  const [차트설정열림, set차트설정열림]  = useState(false);
  const [analystSubTab, setAnalystSubTab] = useState<"opinion" | "consensus">("opinion");
  const [consensusPeriod, setConsensusPeriod] = useState<"annual" | "quarterly">("annual");
  const [finPeriod, setFinPeriod]       = useState<"annual" | "quarterly">("annual");
  const [finSubTab, setFinSubTab]       = useState<"basic" | "income" | "valuation" | "profitability" | "health" | "cashflow" | "custom">("basic");
  const [showCustomSelector, setShowCustomSelector] = useState(false);
  const [customMetricKeys, setCustomMetricKeys] = useState<string[]>(() => {
    /* JSON.parse 는 무엇이든 돌려준다 — 숫자도, 객체도, null 도.
       배열인지 안 보고 그대로 쓰면 재무제표 탭에서 .map 이 터지고, 그리다
       터지는 것이라 앱 전체가 흰 화면이 된다. 저장된 값이 예전 형식이거나
       손으로 고쳐졌을 수 있으니 모양을 확인하고 받는다. */
    try {
      const r = localStorage.getItem(FIN_CUSTOM_KEY);
      if (r) {
        const 읽은것 = JSON.parse(r);
        if (Array.isArray(읽은것)) return 읽은것.filter((k): k is string => typeof k === "string");
      }
    } catch {}
    return ["revenue", "op_income", "net_income"];
  });
  const updateCustomMetricKeys = (keys: string[]) => {
    setCustomMetricKeys(keys);
    try { localStorage.setItem(FIN_CUSTOM_KEY, JSON.stringify(keys)); } catch {}
  };
  const [selectedMetric, setSelectedMetric] = useState("revenue");
  const [newsSort, setNewsSort]         = useState<"latest" | "popular">("latest");
  const [newsSubTab, setNewsSubTab]     = useState<"news" | "disclosure">("news");
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistItemId, setWatchlistItemId] = useState<number | null>(null);
  const [watchlistMsg, setWatchlistMsg] = useState("");
  const [openGroup, setOpenGroup]     = useState<string | null>(null);
  /* 봉 종류 고르는 줄이 일반 차트와 전체화면 차트에 하나씩, 둘 있다.
     예전에는 ref 하나를 두 곳에 달았다. 그러면 전체화면을 열 때 ref 가 그쪽을
     가리켰다가, 닫을 때 React 가 null 로 되돌린다. 일반 차트 쪽 div 는 그동안
     언마운트된 적이 없어 ref 를 다시 안 채우므로, 그 뒤로는 바깥을 눌러도
     드롭다운이 안 닫혔다(새로고침해야 돌아왔다). 그래서 각자 하나씩 갖는다. */
  const candleDropdownRef             = useRef<HTMLDivElement>(null);
  const candleDropdownFsRef           = useRef<HTMLDivElement>(null);

  // 캔들 그룹 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const 안쪽 = [candleDropdownRef.current, candleDropdownFsRef.current]
        .some((el) => el?.contains(e.target as Node));
      // 둘 다 화면에 없으면(=드롭다운을 그리는 곳이 없으면) 건드리지 않는다
      if (!안쪽) setOpenGroup(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  const onCandleChange = useCallback((type: string) => { setCandleType(type); }, []);

  // 현재 캔들 값이 속한 그룹 key 반환
  const activeGroupKey = CANDLE_GROUPS.find(g => g.options.some(o => o.value === candleType))?.key ?? "day";

  const isIntraday = ["1m","2m","5m","15m","30m","60m","90m"].includes(candleType);

  /* 탭별 데이터 선제 prefetch.
     탭을 실제로 누른 뒤에야 받는다 — 종목상세 화면 하나가 야후에 수십 번
     나가는 곳이라, 안 볼 탭까지 미리 받으면 0.15 CPU 에서 그대로 체감된다.
     (예전에는 tab === "" 일 때 전부 받는 분기가 있었는데, 실제로는 아무도
      빈 문자열로 부르지 않아 죽은 코드였다) */
  const prefetchSecondaryData = useCallback((tabId: string) => {
    const tab = tabId;
    if (tab === "financial") {
      qc.prefetchQuery({ queryKey: ["stock-financials",   m, sym], queryFn: () => financialsApi.get(m, sym),           staleTime: 900_000 });
      qc.prefetchQuery({ queryKey: ["stock-fundamentals", m, sym], queryFn: () => stocksApi.getFundamentals(m, sym),   staleTime: 900_000 });
      qc.prefetchQuery({ queryKey: ["metrics-history",    m, sym], queryFn: () => stocksApi.getMetricsHistory(m, sym), staleTime: 900_000 });
      qc.prefetchQuery({ queryKey: ["earnings",           m, sym], queryFn: () => stocksApi.getEarnings(m, sym),       staleTime: 900_000 });
    }
    if (tab === "analyst") {
      qc.prefetchQuery({ queryKey: ["analyst",   m, sym], queryFn: () => stocksApi.getAnalyst(m, sym),   staleTime: 900_000 });
      qc.prefetchQuery({ queryKey: ["forecasts", m, sym], queryFn: () => stocksApi.getForecasts(m, sym), staleTime: 900_000 });
    }
    if (tab === "news") {
      /* 키에 newsSort 가 빠져 있었다. 실제 질의는 ["stock-news", m, sym, newsSort]
         라서, 미리 받아 둔 것을 아무도 안 읽고 곧바로 같은 뉴스를 다시 받았다 —
         뉴스는 RSS 를 여러 개 도는 비싼 요청이라 한 번이 그대로 낭비였다. */
      qc.prefetchQuery({ queryKey: ["stock-news", m, sym, newsSort], queryFn: () => stocksApi.getNews(m, sym, newsSort), staleTime: 300_000 });
      qc.prefetchQuery({ queryKey: ["earnings",   m, sym], queryFn: () => stocksApi.getEarnings(m, sym),   staleTime: 900_000 });
    }
    if (tab === "daily") {
      qc.prefetchQuery({ queryKey: ["stock-ohlcv", m, sym, "1d", "1mo"], queryFn: () => stocksApi.getOHLCV(m, sym, "1mo", "1d"), staleTime: 300_000 });
    }
    if (tab === "quant") {
      qc.prefetchQuery({ queryKey: ["quant-score", m, sym, null, null], queryFn: () => stocksApi.getQuantScore(m, sym), staleTime: 60_000 });
    }
  }, [m, sym, qc, newsSort]);

  /* 얼마나 자주 다시 물어볼지는 장이 열려 있느냐에 달렸다.
     예전에는 조건 없이 15초였다. 토요일 밤에 이 화면을 켜 두면 값이 변할 수
     없는데도 시간당 240건(KR 은 NXT 까지 두 개라 480건)이 0.15 CPU 서버로
     나갔다. 관심종목(60초)·내 자산(120초)보다 자주 때리면서, 정작 저 두
     화면이 쓰는 장 세션 판단은 안 쓰고 있었다.
     marketSession 은 관심종목·내 자산이 이미 쓰는 것과 같은 함수다. */
  const [세션틱, set세션틱] = useState(0);
  const 장세션 = useMemo(() => marketSession(m), [m, 세션틱]);
  /* 휴장 중에는 폴링이 멈춘다 — 그러면 다시 그릴 일이 없어서 장이 열리는
     순간을 영영 못 알아챈다. 쉬는 동안만 1분에 한 번 시계를 본다. */
  useEffect(() => {
    if (장세션 !== "closed") return;
    const t = setInterval(() => set세션틱((v) => v + 1), 60_000);
    return () => clearInterval(t);
  }, [장세션]);

  const 시세주기 = 장세션 === "closed" ? false      // 휴장·주말: 아예 안 묻는다
                 : 장세션 === "regular" ? 15_000
                 : 60_000;                          // 장전·장마감 후엔 느슨하게

  const { data: detail, isLoading: loadingDetail, error: detailError, refetch: refetchDetail, dataUpdatedAt } = useQuery({
    queryKey: ["stock-detail", m, sym],
    queryFn: () => stocksApi.getDetail(m, sym),
    enabled: !!sym, retry: 1, retryDelay: 3000,
    staleTime: 15_000,
    // 분봉일 때는 아래 ohlcv 폴링이 같은 값을 실어 오므로 여기서는 쉰다
    refetchInterval: isIntraday ? false : 시세주기,
  });

  // 대체거래소(NXT/넥스트레이드) 시세 — KR 종목만 조회
  const { data: nxtData } = useQuery({
    queryKey: ["stock-nxt", m, sym],
    queryFn: () => stocksApi.getNXT(m, sym),
    enabled: !!sym && m === "KR",
    retry: 1,
    staleTime: 15_000,
    /* NXT 는 취급 종목이 한정돼 있다. available 이 false 면 화면에 아예 안
       그리는데도(아래 showNxt) 예전에는 15초마다 계속 물었다. 한 번 아니라고
       하면 그만 묻는다. 옆의 detail 과 달리 분봉 여부도 안 보고 있었다. */
    refetchInterval: (query) =>
      query.state.data && (query.state.data as any).available === false ? false : 시세주기,
  });

  const chartPeriod = CANDLE_MAX_PERIOD[candleType] ?? "max";

  /* 차트가 빈 배열로 오면 서버 캐시가 아직 안 찼을 수 있어 잠깐 더 기다린다.
     그런데 횟수 상한이 없었다 — 상장폐지·심볼 오타처럼 영영 안 채워지는
     종목에서는 4초마다(retry:1 이라 실제로는 4초당 2건) 끝없이 두드렸다.
     퀀트 폴링(아래)은 4회 상한을 두고 있으니 같은 방식으로 맞춘다. */
  const ohlcvPollCount = useRef(0);
  useEffect(() => { ohlcvPollCount.current = 0; }, [m, sym, candleType]);

  const { data: ohlcv, isFetching: fetchingChart, refetch: refetchChart } = useQuery({
    queryKey: ["stock-ohlcv", m, sym, candleType, chartPeriod],
    queryFn: () => stocksApi.getOHLCV(m, sym, chartPeriod, candleType),
    enabled: !!sym, retry: 1,
    staleTime: isIntraday ? 15_000 : 21_600_000,
    placeholderData: (prev) => prev,
    refetchInterval: isIntraday
      ? 시세주기
      : (query) => {
          // 에러로 끝난 것은 data 가 undefined 라 '비었다' 와 구분이 안 됐다
          if (query.state.status === "error") return false;
          if ((query.state.data?.length ?? 0) > 0) return false;
          if (ohlcvPollCount.current >= 5) return false;
          ohlcvPollCount.current += 1;
          return 4_000;
        },
  });

  // 종목 진입 1초 후 일별탭 데이터만 선제 prefetch (차트 로딩과 경합 방지)
  useEffect(() => {
    if (!sym) return;
    const t = setTimeout(() => prefetchSecondaryData("daily"), 1000);
    return () => clearTimeout(t);
  }, [sym, prefetchSecondaryData]);

  // 일별 탭 — 기본 1개월, 더보기 클릭마다 1달씩 추가
  const [dailyMonths, setDailyMonths] = useState(1);
  useEffect(() => { setDailyMonths(1); }, [sym, m]);
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

  /* 기본정보의 PER·EPS 가 detail 에 없을 때 이걸로 메운다.
     예전에는 재무탭에 들어가야만 불렀다. 그래서 기본정보의 EPS 는 재무제표
     탭을 한 번 들렀다 돌아와야 나타났다 — 처음 들어온 사람에게는 그냥
     "EPS 가 없는 종목" 으로 보인다.

     그렇다고 늘 부르면 종목을 열 때마다 요청이 하나 더 는다(0.15 CPU 서버다).
     그래서 detail 이 값을 못 준 종목에서만 부른다. detail 이 채워 주면
     이 요청은 아예 안 나간다. */
  /* 0 도 '비었다' 로 친다 — 그러지 않으면 백엔드가 eps=0.0 을 준 종목에서
     이 폴백이 열리지도 않는다(0 == null 은 false 다). 유효() 참고. */
  const 기본지표가_비었나 = !!detail && (유효((detail as any).eps) == null || 유효((detail as any).per) == null);
  const { data: fundamentalsData } = useQuery({
    queryKey: ["stock-fundamentals", m, sym],
    queryFn: () => stocksApi.getFundamentals(m, sym),
    enabled: !!sym && (mainTab === "financial" || 기본지표가_비었나),
    retry: 1, staleTime: 900_000,
  });

  /* dEnhanced.eps 의 세 번째이자 마지막 출처다. detail 도 fundamentals 도
     못 준 종목이 있다 — 야후에 trailingEps 가 없는 국내 종목이 그렇다.
     그런 종목은 여기까지 와야 EPS 가 나오는데, 이 질의가 재무탭 전용이라
     "재무제표 탭을 보고 오면 뜬다" 가 됐다. 그것이 이번 문의다.

     다만 detail 이 비었다고 곧바로 열면 안 된다. 이건 야후 재무제표를
     여러 개 부르는 제일 비싼 요청이고, 서버에 분당 6회 제한이 걸려 있다
     (stocks.py 의 metrics-history). 종목을 몇 개만 훑어도 429 가 난다.
     그래서 앞의 두 칸이 모두 값을 못 준 것을 확인한 뒤에만 연다. */
  const 지표보완도_비었나 =
    기본지표가_비었나 && !!fundamentalsData &&
    (유효((fundamentalsData as any).eps) == null || 유효((fundamentalsData as any).per) == null);

  const { data: metricsHistory } = useQuery({
    queryKey: ["metrics-history", m, sym],
    queryFn: () => stocksApi.getMetricsHistory(m, sym),
    enabled: !!sym && (mainTab === "financial" || 지표보완도_비었나),
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

  // 퀀트점수 — 가중치를 바꾸면 즉시 미리보기로 재계산(저장 전에는 서버에 반영 안 됨)
  const [showGradeHelp, setShowGradeHelp] = useState(false);
  // 초기 draft 동기화는 quantScore가 로드된 이후 한 번만 일어나도록 ref로 가드
  const quantSynced = useRef(false);
  const [quantSyncSource, setQuantSyncSource] = useState<{ weights?: QuantWeights; enabled_metrics?: QuantEnabledMetrics }>({});
  const quantSettings = useQuantSettings(quantSyncSource.weights, quantSyncSource.enabled_metrics);
  const { weights: quantWeights, metrics: quantMetrics, showSettings: showQuantSettings, setShowSettings: setShowQuantSettings } = quantSettings;

  // 일부 지표(특히 신규/저빈도 종목)는 백엔드 캐시가 아직 채워지지 않아
  // 첫 응답에 누락된 값이 섞여 올 수 있음 — 누락이 있으면 백그라운드 갱신이
  // 끝날 시간을 두고 몇 차례 재조회해서, 지표가 다 채워진 뒤에 점수를 보여준다.
  const quantPollCount = useRef(0);
  useEffect(() => { quantPollCount.current = 0; }, [m, sym]);

  const { data: quantScore, isLoading: loadingQuant } = useQuery({
    queryKey: ["quant-score", m, sym, quantWeights, quantMetrics],
    queryFn: () => stocksApi.getQuantScore(m, sym, quantWeights ?? undefined, quantMetrics ?? undefined),
    enabled: !!sym && mainTab === "quant",
    retry: 1,
    staleTime: 60_000,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasMissing = data.factors.some((f) => f.metrics.some((mt) => mt.value == null));
      if (hasMissing && quantPollCount.current < 4) {
        quantPollCount.current += 1;
        return 3000;
      }
      return false;
    },
  });

  const quantMetricsIncomplete = !!quantScore && quantScore.factors.some((f) => f.metrics.some((mt) => mt.value == null)) && quantPollCount.current < 4;

  useEffect(() => {
    if (quantScore && !quantSynced.current) {
      quantSynced.current = true;
      setQuantSyncSource({ weights: quantScore.weights, enabled_metrics: quantScore.enabled_metrics });
    }
  }, [quantScore]);

  const { data: stockNews, isLoading: loadingNews } = useQuery({
    queryKey: ["stock-news", m, sym, newsSort],
    queryFn: () => stocksApi.getNews(m, sym, newsSort),
    enabled: !!sym && mainTab === "news" && newsSubTab === "news",
    staleTime: 300_000,
  });

  const { data: earningsData } = useQuery({
    queryKey: ["earnings", m, sym],
    queryFn: () => stocksApi.getEarnings(m, sym),
    /* 다음 실적발표 D-day 를 헤더 배지로 쓰게 되면서 어느 탭에서든 필요해졌다.
       백엔드가 1시간 캐시라 종목당 사실상 한 번이고, 여기 staleTime 도 그에
       맞춰 올려 둔다 — 탭을 오갈 때마다 다시 묻지 않게. */
    enabled: !!sym,
    staleTime: 3_600_000,
  });

  const { data: exchangeRateData } = useQuery({
    queryKey: ["exchange-rate"],
    queryFn: () => api.get("/dashboard/exchange").then(r => r.data),
    enabled: !isKR,
    staleTime: 300_000,
  });
  const exchangeRate: number = (exchangeRateData as any)?.value ?? 1350;
  const fmt = useCallback((v: number | null | undefined) => isKR ? fmtKRW(v) : showKRW && v != null ? fmtKRW(v * exchangeRate) : fmtUSD(v), [isKR, showKRW, exchangeRate]);

  // 이미 추가된 종목인지 확인 — Watchlist/Quant와 동일 캐시 공유
  const { data: watchlistItems } = useQuery({
    queryKey: ["watchlist-items"],
    queryFn: () => watchlistApi.getItems(),
    enabled: isLoggedIn,
    staleTime: 120_000,
  });
  useEffect(() => {
    if (!isLoggedIn) {
      setInWatchlist(false);
      setWatchlistItemId(null);
      return;
    }
    if (watchlistItems) {
      const found = (watchlistItems as any[]).find((i: any) => i.symbol === sym);
      setInWatchlist(!!found);
      setWatchlistItemId(found?.id ?? null);
    }
  }, [watchlistItems, sym, isLoggedIn]);

  const { data: watchlistFolders = [] } = useQuery({
    queryKey: ["watchlist-folders"],
    queryFn: () => watchlistFolderApi.getFolders(),
    enabled: isLoggedIn,
    staleTime: 600_000,
  });
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const addMutation = useMutation({
    mutationFn: (folderId?: number | null) => watchlistApi.addItem({
      symbol: sym,
      market: m,
      name: (detail as any)?.name ?? sym,
      watchlist_id: 1,
      folder_id: folderId ?? null,
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
      if (err?.response?.status === 401) {
        setWatchlistMsg("로그인이 필요해요");
        setTimeout(() => setWatchlistMsg(""), 2000);
        navigate("/login");
        return;
      }
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
    onError: () => {
      setWatchlistMsg("제거 중 오류가 발생했어요");
      setTimeout(() => setWatchlistMsg(""), 2000);
    },
  });

  const d = detail as any;

  /* 국내 ETF 감지.
     예전에는 이름에 "ETF" 가 들어가는지만 봤는데, 국내 ETF 이름은 그렇게
     짓지 않는다(KODEX 200, TIGER 미국나스닥100). 그래서 사실상 모든 국내
     ETF 가 일반 종목으로 취급돼 '보유비중' 대신 '재무제표'·'투자의견'·'수급'
     탭이 뜨고, 그 탭들은 ETF 라 텅 비었다. utils/etf 참고 */
  const isETF = isETFStock(m, d?.name);
  const isKRETF = isKR && isETF;

  /* 탭 목록은 한 곳에서만 만든다.
     예전에는 그리는 곳(아래 탭 줄)과 숫자키 단축키가 각자 목록을 들고 있었다.
     그리는 쪽은 종목에 따라 6~8개로 변하는데 단축키 쪽은 7개 고정이라,
     ETF 에서 3 을 누르면 화면에 없는 '재무제표' 가 열리고(탭은 아무것도 안 눌린
     상태가 된다), KR 종목에서 7 은 일곱 번째인 '수급' 이 아니라 '커뮤니티' 로
     갔다. 수급·보유비중은 어떤 숫자로도 갈 수 없었다.
     목록이 하나면 탭이 늘고 줄어도 저절로 맞는다. */
  const 탭목록 = useMemo(() => [
    { id:"chart",     Icon: BarChart2,       label:"차트" },
    { id:"daily",     Icon: List,            label:"일별" },
    ...(!isETF ? [{ id:"financial", Icon: DollarSign, label:"재무제표" }] : []),
    { id:"quant",     Icon: Gauge,           label:"퀀트점수" },
    ...(!isETF ? [{ id:"analyst", Icon: TrendingUp, label:"투자의견" }] : []),
    { id:"news",      Icon: Newspaper,       label:"뉴스/공시" },
    ...(isKR && !isKRETF ? [{ id:"supply", Icon: Users, label:"수급" }] : []),
    ...(isETF ? [{ id:"holdings", Icon: BarChart2, label:"보유비중" }] : []),
    { id:"community", Icon: MessageSquare,   label:"커뮤니티" },
  ], [isETF, isKR, isKRETF]);

  /* 종목을 바꿔도 이 화면은 리마운트되지 않는다(라우트가 같고 params 만 바뀐다).
     그래서 고른 탭이 그대로 남는데, 탭 목록은 종목마다 다르다 — KR 종목에서
     '수급' 을 보다가 미국 종목으로 넘어가면 그 탭이 사라지면서 아무 탭도 안
     눌린 채 아래가 통째로 비었다. 없어진 탭에 서 있으면 차트로 되돌린다. */
  useEffect(() => {
    if (!탭목록.some((t) => t.id === mainTab)) setMainTab("chart");
  }, [탭목록, mainTab]);

  /* 공유받은 주소(?tab=financial)로 들어오면 그 탭을 연다.
     탭 목록이 종목에 따라 다르므로, 없는 탭이면 그냥 무시한다 — 위의
     되돌리기와 싸우지 않게 목록에 있는지 먼저 본다.
     한 번만 본다: 그 뒤 사용자가 탭을 옮겼는데 주소 때문에 되돌아가면 안 된다. */
  const 주소탭적용됨 = useRef(false);
  useEffect(() => {
    if (주소탭적용됨.current || !탭목록.length) return;
    const 원하는탭 = new URLSearchParams(window.location.search).get("tab");
    if (원하는탭 && 탭목록.some((t) => t.id === 원하는탭)) {
      setMainTab(원하는탭 as typeof mainTab);
      prefetchSecondaryData(원하는탭);
    }
    주소탭적용됨.current = true;
  }, [탭목록, prefetchSecondaryData]);

  /* 숫자키로 탭 이동 (1~9). 위에서 만든 목록을 그대로 쓴다 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setFullscreen(false); return; }
      // 입력 필드 포커스 중이면 단축키 무시
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = parseInt(e.key, 10) - 1;
      const 탭 = 탭목록[idx];
      if (탭) setMainTab(탭.id as typeof mainTab);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [탭목록]);

  useEffect(() => {
    if (d?.name) addRecentlyViewed(sym, m, d.name);
  }, [sym, m, d?.name]);

  // 재무제표 탭 데이터 가공 — detail은 15초마다 새 객체 참조로 갱신되므로
  // d 자체가 아닌 실제 사용하는 스칼라 값에 메모이제이션을 걸어, 값이 그대로면
  // 재무탭(긴 IIFE)이 매 polling마다 다시 계산되지 않도록 한다.
  const finTabData = useMemo(() => {
    const mhRaw: any[] = (metricsHistory as any)?.[finPeriod] ?? [];
    const mh: any[] = mhRaw.filter((r: any) =>
      r.revenue != null || r.op_income != null || r.net_income != null ||
      r.per != null || r.pbr != null || r.roe != null
    );
    const fcst: any[] = ((forecasts as any)?.annual ?? []).filter((r:any) => r.type === "forecast");

    /* 표는 metrics-history(야후) 만 보고 있었다. 그런데 국내 종목은 야후에
       재무가 비는 일이 흔해서, 바로 위 막대 차트는 DART 값으로 멀쩡히
       그려지는데 아래 표는 통째로 '연결 중...' 이었다 — 같은 카드 안에서.
       financials 응답(국내 DART / 해외 FMP)을 두 번째 출처로 쓴다.
       이미 받아 둔 것이라 새 요청이 없다.

       기간 라벨이 맞아떨어지는지가 관건이다.
         야후  "2024-12-31" → periodLabel 로 연간 "2024", 분기 "2024-12"
         DART  연간 "2024", 분기 "2024Q1"/"2024H1"/"2024Q3"
         FMP   연간 "2024", 분기 "2024-03"
       연간은 셋 다 "2024" 로 정확히 같다. 분기는 DART 가 분기 개념 자체가
       달라(1분기·반기·3분기) 야후와 섞으면 열이 어긋나므로, 야후 쪽이
       아예 비었을 때만 financials 를 쓴다.

       **양쪽을 반드시 같은 이름표로 줄여야 한다.** financials 가 야후 폴백을
       타면 period 가 "2025-06-30" 처럼 날짜로 온다. 그대로 쓰면 같은 자료가
       "2025"(야후 쪽, 줄인 것) 와 "2025-06-30"(그대로) 두 열로 서서 값이
       똑같은 칸이 나란히 찍혔다. */
    // 기간 레이블 (연간: YYYY, 분기: YYYY-QQ) — 두 출처가 같이 쓴다
    const periodLabel = (p: string) => finPeriod === "quarterly" ? p.slice(0,7) : p.slice(0,4);

    const finRaw: any[] = (financials as any)?.[finPeriod] ?? [];
    const 연간인가 = finPeriod === "annual";
    const fin: any[] = (연간인가 || mh.length === 0) ? finRaw : [];
    const finByPeriod = new Map<string, any>(
      fin.map((r: any) => [periodLabel(String(r.period)), r]));

    // metrics-history 최신값으로 detail의 None 보완
    const mhLatest = [...mh].sort((a,b)=>b.period.localeCompare(a.period))[0] ?? {};
    const fd = (fundamentalsData as any) ?? {};

    // 선행PER 보완 — 가장 가까운 연간 컨센서스 EPS 추정치 ÷ 현재가
    const nextFcstEps = [...fcst].sort((a,b)=>a.period.localeCompare(b.period))[0]?.eps_est;
    const fallbackForwardPer = (d?.price && nextFcstEps && nextFcstEps > 0)
      ? Math.round((d.price / nextFcstEps) * 100) / 100
      : null;

    const dEnhanced = {
      /* 밸류에이션 지표는 0 이 '없음' 이다 — PER 0배, EPS 0원, BPS 0원인
         회사는 없다. 그런데 백엔드(kis_service)가 값을 못 구하면 0.0 을
         내려보내고, `??` 는 0 을 넘기지 않으므로 뒤의 두 출처가 채워져
         있어도 0 이 그대로 이겼다. 그 결과 기본정보에는 'EPS 0원' 이,
         바로 아래 표에는(metrics-history 를 직접 읽는다) '5,240원' 이
         동시에 떴다. 0 을 없음으로 바꿔 폴백이 이어지게 한다.
         마진·부채비율처럼 0 이 실제 값일 수 있는 것은 손대지 않는다. */
      per:          유효(d?.per)  ?? 유효(fd.per)  ?? mhLatest.per  ?? null,
      pbr:          유효(d?.pbr)  ?? 유효(fd.pbr)  ?? mhLatest.pbr  ?? null,
      psr:          유효(d?.psr)  ?? 유효(fd.psr)  ?? mhLatest.psr  ?? null,
      eps:          유효(d?.eps)  ?? 유효(fd.eps)  ?? mhLatest.eps  ?? null,
      bps:          유효(d?.bps)  ?? 유효(fd.bps)  ?? mhLatest.bps  ?? null,
      roe:          유효(d?.roe)  ?? 유효(fd.roe)  ?? mhLatest.roe  ?? null,
      roa:          d?.roa          ?? fd.roa          ?? null,
      op_margin:    d?.op_margin    ?? fd.op_margin    ?? mhLatest.op_margin    ?? null,
      net_margin:   d?.net_margin   ?? fd.net_margin   ?? mhLatest.net_margin   ?? null,
      gross_margin: d?.gross_margin ?? fd.gross_margin ?? mhLatest.gross_margin ?? null,
      debt_ratio:   d?.debt_ratio   ?? fd.debt_ratio   ?? mhLatest.debt_ratio   ?? null,
      current_ratio:d?.current_ratio ?? fd.current_ratio ?? mhLatest.current_ratio ?? null,
      quick_ratio:  d?.quick_ratio  ?? fd.quick_ratio  ?? mhLatest.quick_ratio  ?? null,
      // 재무제표 탭에서 안 보이던 항목들 — fundamentals → 재무제표 기반 계산값 순으로 fallback
      forward_per:     d?.forward_per     ?? fd.forward_per     ?? fallbackForwardPer ?? null,
      peg:             d?.peg             ?? fd.peg             ?? mhLatest.peg       ?? null,
      ev_ebitda:       d?.ev_ebitda       ?? fd.ev_ebitda       ?? null,
      ev_revenue:      d?.ev_revenue      ?? fd.ev_revenue      ?? null,
      enterprise_value:d?.enterprise_value ?? fd.enterprise_value ?? null,
      forward_eps:     d?.forward_eps     ?? fd.forward_eps     ?? null,
      beta:            d?.beta            ?? fd.beta            ?? null,
      payout_ratio:    d?.payout_ratio    ?? fd.payout_ratio    ?? null,
    };

    /* 야후 연도 ∪ DART·FMP 연도. 야후에 없는 연도가 financials 에만 있으면
       그 열도 세운다 — 국내 종목은 이쪽이 더 길게 있는 경우가 많다.

       두 쪽 다 같은 이름표로 줄여야 한다. 처음에는 financials 의 period 를
       그대로 썼는데, 그쪽이 야후 폴백을 타면 "2025-06-30" 처럼 날짜가 통째로
       온다. 그러면 같은 자료가 "2025"(야후, 줄인 것) 와 "2025-06-30"(그대로)
       두 열로 서서, 값이 똑같은 칸이 나란히 찍혔다. */
    const mhYears = [...new Set([
      ...mh.map((r: any) => periodLabel(r.period)),
      ...fin.map((r: any) => periodLabel(String(r.period))),
    ])].sort() as string[];

    /* 컨센서스(예측) 연도를 실적 옆에 붙인다.
       그리는 배관은 원래 다 있었다 — 헤더는 "E" 로 끝나는 연도를 다르게
       칠하고, 아래 getVal 도 E 분기를 갖고 있었다. 그런데 allYears 에서
       예측 연도를 빼 놓아 아무 데도 안 쓰였다. 받아 온 forecasts 를 화면에서
       잘라 버리고 있었던 셈이다.
       분기 보기에는 붙이지 않는다 — 컨센서스는 연간으로만 온다. */
    const fcstYears = finPeriod === "annual"
      ? [...new Set(fcst.map((r: any) => String(r.period).slice(0, 4)))]
          .filter((y) => !mhYears.includes(y))
          .sort()
          .map((y) => `${y}E`)
      : [];
    const allYears = [...mhYears, ...fcstYears];

    /* 표의 키와 컨센서스 응답의 키가 다르다 — 표는 revenue 를 찾는데
       예측 쪽은 revenue_est 로 온다 */
    const 예측키: Record<string, string> = {
      revenue: "revenue_est", op_income: "op_income_est",
      net_income: "net_income_est", eps: "eps_est",
    };

    // 기간으로 데이터 조회
    const getVal = (key: string, year: string): number | null => {
      if (year.endsWith("E")) {
        const y = year.slice(0,-1);
        const row = fcst.find((r:any) => String(r.period).slice(0,4) === y);
        if (!row) return null;
        /* 배수(PER·PBR)는 추정치가 없다. 매핑에 없는 키는 그대로 찾아보고,
           없으면 null 이라 표에 '—' 로 빠진다 */
        return row[예측키[key] ?? key] ?? null;
      }
      const row = mh.find((r:any) => periodLabel(r.period) === year);
      const v = row?.[key];
      if (v != null) return v;
      /* 야후가 못 준 칸은 DART(국내)·FMP(해외) 값으로 채운다.
         이게 없으면 국내 종목 표가 통째로 비어 보였다 */
      return finByPeriod.get(year)?.[key] ?? null;
    };

    return { mh, fcst, dEnhanced, periodLabel, mhYears, allYears, getVal };
  }, [
    metricsHistory, forecasts, fundamentalsData, financials, finPeriod,
    d?.price, d?.per, d?.pbr, d?.psr, d?.eps, d?.bps, d?.roe, d?.roa,
    d?.op_margin, d?.net_margin, d?.gross_margin, d?.debt_ratio,
    d?.current_ratio, d?.quick_ratio, d?.forward_per, d?.peg,
    d?.ev_ebitda, d?.ev_revenue, d?.enterprise_value, d?.forward_eps,
    d?.beta, d?.payout_ratio,
  ]);

  const fmtPx = (v: number | null | undefined) => {
    if (v == null) return null;
    if (isKR) return v.toLocaleString("ko-KR");
    if (showKRW) return Math.round(v * exchangeRate).toLocaleString("ko-KR");
    return v.toFixed(2);
  };
  /* 기본정보에 쓸 PER·EPS. 재무제표 탭과 같은 값을 본다 —
     한 화면에서 두 숫자가 다르면 어느 쪽을 믿어야 할지 알 수 없다. */
  const 기본PER: number | null = finTabData.dEnhanced.per ?? null;
  const 기본EPS: number | null = finTabData.dEnhanced.eps ?? null;

  const priceItems = useMemo(() => {
    if (!d) return [] as { label: string; v: string | null; color?: string }[];
    return [
      { label:"시가",     v: fmtPx(d.open) },
      { label:"고가",     v: fmtPx(d.high), color:"text-accent-red" },
      { label:"저가",     v: fmtPx(d.low),  color:"text-accent-blue" },
      { label:"전일종가", v: fmtPx(d.prev_close) },
      { label:"거래량",   v: d.volume ? fmtVolume(d.volume, isKR) : null },
      /* 네이버가 실제 누적 거래대금(accumulatedTradingValue)을 주고 그것이
         detail 응답의 amount 로 온다. 예전에는 그걸 두고 종가×거래량으로
         다시 계산했는데, 장중에는 두 값이 다르다 — 하루 종일 오르내린
         가격으로 체결된 것을 마지막 가격 하나로 곱한 근사치였다.
         해외 종목에는 amount 가 없어 그때만 예전 방식으로 어림한다. */
      { label:"거래대금", v: fmt(d.amount ?? (d.price && d.volume ? d.price * d.volume : null)) },
      { label:"시가총액", v: fmt(d.market_cap) },
      { label:"52주 고가",v: fmtPx(d.week52_high), color:"text-accent-red" },
      { label:"52주 저가",v: fmtPx(d.week52_low),  color:"text-accent-blue" },
      { label:"배당수익률",v: d.dividend_yield != null ? `${d.dividend_yield.toFixed(2)}%` : null, color:"text-accent-green" },
      /* PER·EPS 는 재무제표 탭에도 있지만, 시세를 보는 김에 같이 확인하는
         사람이 많아 여기에도 둔다.

         값은 재무제표 탭과 같은 것을 쓴다(finTabData.dEnhanced). 처음에는
         detail 응답의 d.per / d.eps 만 봤는데, 그쪽이 비는 종목이 꽤 있어서
         '재무제표에는 EPS 가 나오는데 기본정보에는 안 나오는' 일이 생겼다.
         재무제표는 detail → fundamentals → metrics-history 순으로 채우고
         있었고, 기본정보만 첫 칸에서 멈춰 있었던 것이다.

         EPS 는 주당 '금액' 이라 원화환산을 따라간다. PER 은 배수라
         환산 대상이 아니다. */
      { label:"PER",      v: 기본PER != null ? `${기본PER.toFixed(2)}배` : null },
      { label:"EPS",      v: 기본EPS != null
                             ? (isKR || showKRW
                                 ? `${Math.round(isKR ? 기본EPS : 기본EPS * exchangeRate).toLocaleString("ko-KR")}원`
                                 : `$${기본EPS.toFixed(2)}`)
                             : null },
      /* 아래는 응답에 실려 오는데 화면에 한 번도 안 쓰던 것들이다.
         새 요청이 늘지 않으므로 그냥 보여 주는 편이 낫다. */
      // 유통 주식 수·비율 — 해외 종목만 온다
      ...(d.shares_outstanding != null
        ? [{ label:"상장주식수", v: fmtVolume(d.shares_outstanding, isKR) }] : []),
      ...(d.float_shares != null && d.shares_outstanding
        ? [{ label:"유통비율", v: `${((d.float_shares / d.shares_outstanding) * 100).toFixed(1)}%` }] : []),
      // 이동평균 — 지금 값이 추세 위인지 아래인지 바로 읽힌다
      ...(d.ma50 != null  ? [{ label:"50일선",  v: fmtPx(d.ma50) }] : []),
      ...(d.ma200 != null ? [{ label:"200일선", v: fmtPx(d.ma200) }] : []),
    ] as { label: string; v: string | null; color?: string }[];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.open, d?.high, d?.low, d?.prev_close, d?.volume, d?.price, d?.amount, d?.market_cap, d?.week52_high, d?.week52_low, d?.dividend_yield, d?.shares_outstanding, d?.float_shares, d?.ma50, d?.ma200, 기본PER, 기본EPS, isKR, showKRW, exchangeRate, fmt]);
  const priceStr = d?.price != null
    ? isKR ? `₩${d.price.toLocaleString("ko-KR")}`
      : showKRW ? `₩${Math.round(d.price * exchangeRate).toLocaleString("ko-KR")}`
      : `$${d.price.toFixed(2)}`
    : "—";
  /* 다음 실적발표까지 며칠 — 헤더 배지로 쓴다.
     응답의 upcoming 은 발표일 문자열 목록이다. 이미 지난 날짜가 섞여 올 수
     있어 오늘 이후 것 중 가장 가까운 것을 고른다. */
  const 실적Dday = useMemo(() => {
    const 목록: string[] = (earningsData as any)?.upcoming?.filter(Boolean) ?? [];
    if (!목록.length) return null;
    const 오늘 = new Date(); 오늘.setHours(0, 0, 0, 0);
    const 앞으로 = 목록
      .map((s) => ({ s, t: new Date(s).getTime() }))
      .filter((x) => Number.isFinite(x.t) && x.t >= 오늘.getTime())
      .sort((a, b) => a.t - b.t)[0];
    if (!앞으로) return null;
    const 남은날 = Math.round((앞으로.t - 오늘.getTime()) / 86_400_000);
    return 남은날 === 0 ? "오늘" : `D-${남은날}`;
  }, [earningsData]);

  const [담기열림, set담기열림] = useState(false);
  const [복사됨, set복사됨] = useState(false);

  /* 지금 보고 있는 탭까지 주소에 남긴다 — 받은 사람이 '재무제표를 봐' 라고
     따로 말하지 않아도 같은 화면을 연다. 라우트가 stocks/:market/:symbol/*
     도 받으므로 뒤에 탭을 붙여도 화면이 열린다. */
  const 공유하기 = useCallback(async () => {
    const 주소 = `${window.location.origin}/stocks/${m}/${encodeURIComponent(sym)}`
      + (mainTab === "chart" ? "" : `?tab=${mainTab}`);
    try {
      await navigator.clipboard.writeText(주소);
      set복사됨(true);
      setTimeout(() => set복사됨(false), 2000);
    } catch {
      /* 클립보드를 막아 둔 환경이 있다. 실패해도 화면을 방해하지 않는다 */
    }
  }, [m, sym, mainTab]);

  /* 내가 이 종목을 갖고 있나. 내 자산·퀀트·글쓰기가 이미 같은 키로 받아 둔
     것을 그대로 읽으므로 요청이 늘지 않는다. */
  const { data: 보유목록 } = useQuery({
    queryKey: ["portfolio-items-all"],
    queryFn: () => portfolioApi.getItems(undefined, true),
    enabled: isLoggedIn,
    staleTime: 300_000,
  });
  const 내보유 = useMemo(() => {
    const 것들 = (보유목록 as any[] | undefined) ?? [];
    const 맞는것 = 것들.filter((x) => (x.symbol ?? "").toUpperCase() === sym && x.market === m);
    if (!맞는것.length) return null;
    const 수량 = 맞는것.reduce((a, x) => a + (Number(x.shares) || 0), 0);
    if (!(수량 > 0)) return null;
    // 여러 계좌에 나눠 담았을 수 있다 — 수량 가중으로 평단을 합친다
    const 총액 = 맞는것.reduce((a, x) => a + (Number(x.shares) || 0) * (Number(x.avg_price ?? x.avgPrice) || 0), 0);
    return { 수량, 평단: 총액 / 수량, 계좌수: 맞는것.length };
  }, [보유목록, sym, m]);

  const isUp = (d?.change_rate ?? 0) >= 0;
  const { colorScheme, 화면모양 } = useSettingsStore();
  const upColor   = colorScheme === "red-blue" ? "text-accent-red"  : "text-accent-green";
  const downColor = colorScheme === "red-blue" ? "text-accent-blue" : "text-accent-red";

  const nxt = nxtData as any;
  const showNxt = isKR && nxt?.available && nxt?.price != null;
  const nxtIsUp = (nxt?.change_rate ?? 0) >= 0;

  // 미국 프리마켓/애프터마켓 시세 (정규장 외 시간대에 marketState로 구분됨)
  const extHoursPrice = d?.market_state === "PRE" ? d?.pre_market_price : d?.market_state === "POST" ? d?.post_market_price : null;
  const extHoursChangeRate = d?.market_state === "PRE" ? d?.pre_market_change_rate : d?.post_market_change_rate;
  const showExtHours = !isKR && extHoursPrice != null;
  const extHoursLabel = d?.market_state === "PRE" ? "프리마켓" : "애프터마켓";
  const extHoursUp = (extHoursChangeRate ?? 0) >= 0;
  const extHoursPriceStr = extHoursPrice != null
    ? (showKRW ? `₩${Math.round(extHoursPrice * exchangeRate).toLocaleString("ko-KR")}` : `$${extHoursPrice.toFixed(2)}`)
    : "—";

  if (detailError && !detail) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 rounded-full bg-accent-red/15 flex items-center justify-center"><TrendingDown size={20} className="text-accent-red"/></div>
        <p className="text-text-primary font-semibold">데이터를 불러올 수 없습니다 ({sym})</p>
        <div className="flex gap-2">
          <button onClick={()=>refetchDetail()} className="flex items-center gap-1.5 px-4 py-2 bg-accent-blue text-white text-base font-semibold rounded-lg"><RefreshCw size={13}/>다시 시도</button>
          <button onClick={()=>navigate(-1)} className="px-4 py-2 text-text-muted text-base rounded-lg border border-border">뒤로</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 fade-in">
      {/* 헤더 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <button aria-label="뒤로 가기" onClick={()=>navigate(-1)} className="mt-0.5 -ml-2 w-11 h-11 flex items-center justify-center rounded-lg hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"><ArrowLeft size={18}/></button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-text-primary leading-tight truncate">
                {d?.name && d.name !== sym ? d.name : sym.replace(".KS","").replace(".KQ","")}
              </h1>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0 relative" ref={folderMenuRef}>
            {/* 세 버튼을 한 줄에 눕힌다.
                담기·공유가 생기면서 세로로 3층이 쌓였고, 휴대폰에서는 그
                세로줄이 종목명 옆을 차지해 이름이 두 줄로 접히고 화면 위쪽이
                통째로 버튼 자리가 됐다.
                좁은 화면에서는 관심종목 버튼의 글자를 숨겨 아이콘 세 개만
                나란히 둔다 — 셋 다 44×44 라 손가락에는 그대로 맞는다. */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  if (!isLoggedIn) {
                    navigate("/login");
                    return;
                  }
                  if (inWatchlist && watchlistItemId) {
                    removeMutation.mutate(watchlistItemId);
                  } else if (!inWatchlist && !addMutation.isPending) {
                    setFolderMenuOpen(v => !v);
                  }
                }}
                disabled={addMutation.isPending || removeMutation.isPending}
                aria-label={inWatchlist ? "관심종목에서 빼기" : "관심종목에 넣기"}
                aria-pressed={inWatchlist}
                className={`flex items-center justify-center gap-1.5 w-11 h-11 sm:w-auto sm:h-auto sm:px-3 sm:py-2 rounded-xl border text-base font-medium transition-all ${
                  inWatchlist
                    ? "border-accent-yellow/50 bg-accent-yellow/10 text-accent-yellow hover:bg-accent-red/10 hover:border-accent-red/50 hover:text-accent-red"
                    : "border-border text-text-muted hover:border-accent-yellow/60 hover:text-accent-yellow"
                }`}
              >
                <Star size={16} className="sm:hidden" fill={inWatchlist ? "currentColor" : "none"}/>
                <Star size={14} className="hidden sm:block" fill={inWatchlist ? "currentColor" : "none"}/>
                {/* 글자는 넓은 화면에서만. 진행 중 표시도 같이 숨긴다 */}
                <span className="hidden sm:inline">
                  {addMutation.isPending ? "추가 중..." : removeMutation.isPending ? "제거 중..." : inWatchlist ? "관심종목" : "추가"}
                </span>
              </button>

              {/* 담기 — 관심종목(보고 싶다)과 보유(샀다)는 다른 일이다.
                  예전에는 종목상세에서 내 자산으로 가는 길이 아예 없어서,
                  방금 보던 종목을 내 자산에서 이름으로 다시 검색해야 했다.
                  모달은 관심종목 화면이 쓰는 것을 그대로 쓴다. */}
              <button
                aria-label="보유종목에 담기"
                title="보유종목에 담기"
                onClick={() => { if (!isLoggedIn) { navigate("/login"); return; } set담기열림(true); }}
                className="flex items-center justify-center w-11 h-11 rounded-xl border border-border text-text-muted hover:border-accent-green/60 hover:text-accent-green transition-all"
              >
                <Wallet size={16}/>
              </button>

              {/* 공유 — 앱의 다른 곳(피드·글 상세)이 쓰는 복사 방식과 같다.
                  지금 보고 있는 탭까지 주소에 남겨, 받은 사람이 같은 화면을 연다 */}
              <button
                aria-label={복사됨 ? "주소 복사됨" : "주소 복사"}
                title="주소 복사"
                onClick={공유하기}
                className="flex items-center justify-center w-11 h-11 rounded-xl border border-border text-text-muted hover:border-accent-blue/60 hover:text-accent-blue transition-all"
              >
                {복사됨 ? <Check size={16} className="text-accent-green"/> : <Share2 size={16}/>}
              </button>
            </div>

            {watchlistMsg && (
              <span className="text-xs text-text-muted animate-fade-in">{watchlistMsg}</span>
            )}
            {folderMenuOpen && !inWatchlist && (
              <div className="absolute top-full mt-1 right-0 z-20 w-44 rounded-xl border border-border bg-bg-card shadow-lg overflow-hidden">
                <button
                  onClick={() => { addMutation.mutate(null); setFolderMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-bg-elevated transition-colors"
                >
                  기본 (폴더 없음)
                </button>
                {(watchlistFolders as any[]).map((f: any) => (
                  <button
                    key={f.id}
                    onClick={() => { addMutation.mutate(f.id); setFolderMenuOpen(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-bg-elevated transition-colors border-t border-border truncate"
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 배지는 이름·버튼 줄 아래에 따로 둔다.
            이름 옆에 두면 휴대폰에서 자리를 다툰다. flex 안에서 배지는
            안 줄어드는데(flex-shrink-0), 위쪽에 min-w-0 이 없으면 그 폭이
            그대로 헤더를 밀어내 버튼이 화면 밖으로 나가고 가로 스크롤이
            생겼다. 줄을 따로 내어 화면 폭을 다 쓰고, 넘치면 가로로 민다. */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          <span className="text-base font-mono text-text-muted flex-shrink-0">{sym.replace(".KS","").replace(".KQ","")}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded border font-bold flex-shrink-0 whitespace-nowrap ${
            isETF ? "border-accent-purple/50 text-accent-purple bg-accent-purple/10"
            : isKR ? "border-accent-blue/50 text-accent-blue bg-accent-blue/10"
            : "border-accent-green/50 text-accent-green bg-accent-green/10"}`}>
            {isETF ? "ETF" : (isKR ? (d?.market ?? "KR") : m)}
          </span>
          {d?.sector && <span className="text-xs px-1.5 py-0.5 rounded bg-bg-elevated border border-border text-text-muted flex-shrink-0 whitespace-nowrap">{d.sector}</span>}
          {실적Dday && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-accent-yellow/10 border border-accent-yellow/30 text-accent-yellow font-semibold flex-shrink-0 whitespace-nowrap">
              실적 {실적Dday}
            </span>
          )}
          {내보유 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-accent-green/10 border border-accent-green/30 text-accent-green font-semibold flex-shrink-0 whitespace-nowrap">
              보유 {내보유.수량.toLocaleString("ko-KR")}주 · 평단 {
                isKR ? `₩${Math.round(내보유.평단).toLocaleString("ko-KR")}` : `$${내보유.평단.toFixed(2)}`
              }
            </span>
          )}
        </div>
      </div>

      {/* 현재가.
          다른 앱들은 종목명 바로 밑에 큰 숫자가 오고, 그다음이 곧바로
          차트다. 우리는 가격을 카드에 넣고 그 안에 지표 격자까지 붙여서,
          정작 차트는 화면을 한 장 넘겨야 나왔다. 카드 테두리를 없애 제목과
          한 덩어리로 만들고, 지표는 차트 아래로 내렸다. */}
      {d ? (
        <div className={화면모양 === "app" ? "overflow-hidden"
                                          : "rounded-xl border border-border bg-bg-card overflow-hidden"}>
          {/* 현재가 + 등락 */}
          <div className={화면모양 === "app"
            ? "px-1 pb-3 flex items-center gap-3 flex-wrap"
            : "px-4 py-3 flex items-center gap-4 flex-wrap border-b border-border"}>
            <span className={`font-mono font-bold text-text-primary num ${
              화면모양 === "app" ? "text-[2.125rem] leading-none" : "text-3xl"}`}>{priceStr}</span>
            <div className="flex items-center gap-1.5">
              {isUp ? <TrendingUp size={13} className={upColor}/> : <TrendingDown size={13} className={downColor}/>}
              {d.change != null && d.change !== 0 && (
                <span className={`text-base font-mono font-semibold num ${isUp?upColor:downColor}`}>
                  {isUp?"+":""}{fmtPx(d.change)}
                </span>
              )}
              <span className={`text-base font-mono num ${isUp?upColor:downColor}`}>
                ({isUp?"+":""}{(d.change_rate??0).toFixed(2)}%)
              </span>
            </div>
            {!isKR && (
              <button
                aria-pressed={showKRW} onClick={() => setShowKRW(v => !v)}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all whitespace-nowrap ${
                  showKRW
                    ? "bg-accent-blue/20 border-accent-blue/50 text-accent-blue"
                    : "border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
                }`}
                title={`1USD≈${exchangeRate.toLocaleString("ko-KR")}₩`}
              >
                ₩ 원화환산
                {showKRW && <span className="text-2xs text-text-muted">(1USD≈{exchangeRate.toLocaleString("ko-KR")}₩)</span>}
              </button>
            )}
            {showNxt && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border bg-bg-elevated" title="대체거래소(넥스트레이드) 시세">
                <span className="text-xs font-bold px-1 py-0.5 rounded bg-accent-purple/15 text-accent-purple leading-none">NXT</span>
                <span className="text-base font-mono font-semibold text-text-primary num">₩{nxt.price.toLocaleString("ko-KR")}</span>
                <span className={`text-xs font-mono num ${nxtIsUp?upColor:downColor}`}>
                  ({nxtIsUp?"+":""}{(nxt.change_rate??0).toFixed(2)}%)
                </span>
              </div>
            )}
            {showExtHours && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border bg-bg-elevated" title={`${extHoursLabel} 시세`}>
                <span className="text-xs font-bold px-1 py-0.5 rounded bg-accent-purple/15 text-accent-purple leading-none">{extHoursLabel}</span>
                <span className="text-base font-mono font-semibold text-text-primary num">{extHoursPriceStr}</span>
                <span className={`text-xs font-mono num ${extHoursUp?upColor:downColor}`}>
                  ({extHoursUp?"+":""}{(extHoursChangeRate??0).toFixed(2)}%)
                </span>
              </div>
            )}
            {/* 예전에는 조건 없이 초록 점이 계속 뛰었다. 휴장이든, 값이 몇
                시간 멈췄든 화면은 똑같이 '살아 있음' 이었다. 관심종목·내 자산은
                장 세션을 함께 보여 주는데 이 화면만 그러지 않았다. */}
            <div className="ml-auto flex items-center gap-1.5" aria-live="polite">
              <span className={`w-1.5 h-1.5 rounded-full ${
                장세션 === "regular" ? "bg-accent-green animate-pulse"
                : 장세션 === "closed" ? "bg-text-dim"
                : "bg-accent-yellow"}`}/>
              <span className="text-xs text-text-muted">
                {장세션 === "regular" ? "" : SESSION_LABEL[장세션] + " · "}
                {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("ko-KR", {hour:"2-digit",minute:"2-digit",second:"2-digit"}) : ""}
              </span>
            </div>
          </div>

          {/* 시세 지표 — 어디에 어떻게 둘지가 화면 모양마다 다르다.
              app 은 차트 아래 '통계' 로 내려가므로 여기서는 안 그린다. */}
          {/* '기본' 은 지표를 한 번에 다 편다.
              접었다 폈다 하게 뒀더니, 볼 때마다 더보기를 눌러야 해서
              오히려 번거로웠다. 숫자를 한눈에 보려고 이 모양을 고른
              사람에게 한 번 더 누르게 할 이유가 없다.
              칸선은 긋지 않는다 — 선을 그으면 표로 읽힌다. */}
          {화면모양 === "classic" && (
            <div className="px-3 py-2.5 grid grid-cols-4 gap-x-2 gap-y-2.5">
              {priceItems.map((item) => (
                <div key={item.label} className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-2xs text-text-dim whitespace-nowrap">{item.label}</span>
                  <span className={`text-sm font-mono font-semibold num truncate ${(item as any).color ?? "text-text-secondary"}`}>
                    {item.v ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          )}

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
                <span className="text-xs text-text-muted font-semibold uppercase tracking-wide flex-shrink-0">투자의견</span>
                {ratingLabel && (
                  <span className={`text-sm font-bold ${ratingColor}`}>{ratingLabel}</span>
                )}
                {pt?.mean != null && (
                  <span className="text-sm text-text-muted font-mono">
                    목표가 <span className="text-text-primary font-semibold">${pt.mean.toFixed(0)}</span>
                  </span>
                )}
                {upside != null && (
                  <span className={`text-sm font-bold px-1.5 py-0.5 rounded ${upside >= 0 ? "bg-accent-green/10 text-accent-green" : "bg-accent-red/10 text-accent-red"}`}>
                    {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                  </span>
                )}
                {totalVotes > 0 && (
                  <span className="text-xs text-text-muted ml-auto">{totalVotes}명</span>
                )}
              </div>
            );
          })()}
        </div>
      ) : loadingDetail ? (
        <div className="overflow-hidden">
          <div className="px-1 pb-3 flex items-center gap-3 flex-wrap">
            <span className="text-[2.125rem] leading-none font-mono font-bold text-text-dim">—</span>
            <div className="ml-auto w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/>
          </div>
          {/* 뼈대는 실제로 그려질 모양과 같아야 한다. 지표는 이제 차트
              아래 '통계' 로 내려갔으므로 여기서는 가격만 자리를 잡는다 */}
        </div>
      ) : null}

      {/* 탭 네비게이션 */}
      <div className="flex flex-col gap-2">
        {/* 메인 탭 — 한 줄 + 가로 스크롤 */}
        <div role="tablist" aria-label="종목 정보"
             className="flex border-b border-border bg-bg-card rounded-t-xl overflow-x-auto scrollbar-hide">
          {탭목록.map(({ id, Icon, label }, i) => (
            <button key={id} role="tab" aria-selected={mainTab === id}
              /* 숫자키 단축키와 같은 순서다 — 눌러 보기 전에 알 수 있게 적어 둔다 */
              title={`${label} (${i + 1})`}
              onClick={() => { setMainTab(id as typeof mainTab); prefetchSecondaryData(id); }}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold transition-all border-b-2 -mb-px whitespace-nowrap flex-shrink-0 ${
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
        {/* 공용 Tabs 로 옮겼다. 여기만 알약 모양(rounded-full)이라 같은 화면
            안에서 서브탭이 두 가지로 보였다 — 투자의견·뉴스는 이미 Tabs 를
            쓰고 있었다. ui/index.tsx 주석의 '모두 이걸 쓴다' 목록에도,
            일부러 안 옮긴 예외 목록에도 종목상세만 빠져 있었다.
            덤으로 role="tablist"/aria-selected 가 따라온다. */}
        {/* 알약 모양 그대로 둔다 — 항목이 일곱 개라 가로로 길고, 눌러서
            거르는 '필터' 에 가깝다. 공용 Tabs 로 옮겨 봤더니 칸을 나눠
            가지면서 글자가 눌려 읽기 나빠졌다.
            다만 공용 Tabs 가 주던 것(역할·선택 상태)은 손으로 붙여 둔다 —
            화면 읽어주는 기능이 "탭 목록, 3/7 선택됨" 으로 읽는다. */}
        {mainTab==="financial" && (
          <div role="tablist" aria-label="재무제표 항목"
               className="flex gap-1 overflow-x-auto scrollbar-hide">
            {([
              { value:"basic",         label:"기본 지표" },
              { value:"income",        label:"손익계산서" },
              { value:"valuation",     label:"밸류에이션" },
              { value:"profitability", label:"수익성" },
              { value:"health",        label:"재무건전성" },
              { value:"cashflow",      label:"현금흐름" },
              { value:"custom",        label:"사용자설정" },
            ] as const).map(({ value, label })=>(
              <button key={value} role="tab" aria-selected={finSubTab===value}
                onClick={()=>setFinSubTab(value)}
                className={`px-3 py-1.5 text-sm font-semibold rounded-full whitespace-nowrap transition-all flex-shrink-0 ${
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
                      className={`px-2.5 py-1 text-sm rounded-md font-semibold transition-all ${isActive ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"}`}
                    >
                      {isActive ? (currentOpt?.label ?? group.label) : group.label}
                    </button>
                    {openGroup === group.key && (
                      <div className="absolute top-full left-0 mt-1 z-50 flex flex-col gap-0.5 p-1 rounded-lg border border-border bg-bg-card shadow-xl min-w-[64px]">
                        {group.options.map(opt => (
                          <button key={opt.value}
                            onClick={() => { onCandleChange(opt.value); setOpenGroup(null); }}
                            className={`px-3 py-1.5 text-sm rounded-md font-semibold whitespace-nowrap transition-all ${candleType === opt.value ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"}`}
                          >{opt.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="ml-auto flex items-center gap-1">
              {/* 캔들/라인/영역·LOG 는 한 번 정해두면 잘 안 바꾼다. 늘 펼쳐
                  두면 차트가 보이기도 전에 컨트롤이 세 줄이 된다 */}
              <button onClick={()=>set차트설정열림(v=>!v)}
                aria-expanded={차트설정열림} aria-label="차트 설정"
                className={`p-1.5 rounded-lg transition-colors ${
                  차트설정열림 ? "bg-accent-blue/15 text-accent-blue"
                              : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"}`}>
                <Settings2 size={13}/>
              </button>
              <button aria-label="차트 새로고침" title="새로고침" onClick={()=>refetchChart()} className="w-11 h-11 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
                <RefreshCw size={13}/>
              </button>
              <button aria-label="차트 전체보기" onClick={()=>setFullscreen(true)} className="w-11 h-11 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors" title="전체보기">
                <Maximize2 size={13}/>
              </button>
            </div>
          </div>
          {/* 차트 설정 — 톱니를 눌렀을 때만 */}
          {차트설정열림 && (
          <div className="px-4 py-2 border-b border-border bg-bg-secondary flex flex-wrap items-center gap-3">
            <div className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary">
              {([
                { value:"candle", label:"캔들",  Icon: CandlestickChart },
                { value:"line",   label:"라인",  Icon: LineChart },
                { value:"area",   label:"영역",  Icon: AreaChart },
              ] as const).map(({ value, label, Icon })=>(
                <button key={value} aria-pressed={chartType===value} onClick={()=>setChartType(value)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-sm rounded-md font-semibold transition-all ${chartType===value?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}
                >
                  <Icon size={11}/>{label}
                </button>
              ))}
            </div>
            <button aria-pressed={logScale} onClick={()=>setLogScale(v=>!v)}
              className={`px-2.5 py-1 text-sm rounded-lg border font-semibold transition-all ${logScale?"bg-accent-blue/20 border-accent-blue/50 text-accent-blue":"border-border text-text-muted hover:text-text-primary"}`}
            >
              LOG
            </button>
          </div>
          )}
          {ohlcv?.length ? (
            <div className="relative">
              {fetchingChart && (
                <div className="absolute top-2 right-2 z-10 w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/>
              )}
              <StockChart data={ohlcv} height={isMobile ? 300 : 420} isKR={isKR} chartType={chartType} logScale={logScale}/>
            </div>
          ) : fetchingChart ? (
            <div className="h-[300px] sm:h-[500px] flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/>
              <p className="text-text-muted text-base">차트 불러오는 중</p>
            </div>
          ) : (
            <div className="h-[300px] sm:h-[420px] flex flex-col items-center justify-center gap-3">
              <BarChart2 size={32} className="text-text-muted/40"/>
              <p className="text-text-muted text-base">차트 데이터 없음</p>
              <button onClick={()=>refetchChart()} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-blue text-white text-sm rounded-lg"><RefreshCw size={12}/>재시도</button>
            </div>
          )}
        </div>
      )}

      {/* 통계 한눈에 보기 — 차트 아래.
          다른 앱들이 쓰는 자리다. 차트를 보고 나서 숫자를 확인하는 순서가
          자연스럽고, 무엇보다 차트가 첫 화면에 들어온다.
          칸선은 긋지 않는다 — 선을 그으면 표가 되고, 표는 앱이 아니라
          스프레드시트로 읽힌다. */}
      {화면모양 === "app" && mainTab === "chart" && d && (
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-bold text-text-primary px-1">통계</h2>
          {/* 52주 밴드에서 지금이 어디쯤인가.
              값은 원래부터 응답에 있었는데 숫자 두 개로만 놓여 있어서,
              위치를 알려면 세 숫자를 암산해야 했다. */}
          {d.week52_low != null && d.week52_high != null && d.price != null && (
            <div className="px-1 pb-1">
              <RangeBar
                low={d.week52_low} high={d.week52_high} current={d.price}
                lowLabel={`52주 최저 ${fmtPx(d.week52_low)}`}
                highLabel={`52주 최고 ${fmtPx(d.week52_high)}`}
                fmt={(v) => fmtPx(v) ?? "—"}
              />
            </div>
          )}
          <div className="px-1 grid grid-cols-3 gap-x-3 gap-y-3.5">
            {priceItems.map((item) => (
              <div key={item.label} className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs text-text-dim whitespace-nowrap">{item.label}</span>
                <span className={`text-base font-mono font-semibold num truncate ${(item as any).color ?? "text-text-primary"}`}>
                  {item.v ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 전체보기 모달 */}
      {fullscreen && ohlcv?.length && (
        <div className="fixed inset-0 z-50 bg-bg-base flex flex-col modal-backdrop">
          {/* 모달 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-card flex-shrink-0">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-bold text-text-primary">{d?.name ?? sym}</span>
              <div ref={candleDropdownFsRef} className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary relative">
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
                        className={`px-2.5 py-1 text-sm rounded-md font-semibold transition-all ${isActive ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"}`}
                      >
                        {isActive ? (currentOpt?.label ?? group.label) : group.label}
                      </button>
                      {openGroup === group.key && (
                        <div className="absolute top-full left-0 mt-1 z-50 flex flex-col gap-0.5 p-1 rounded-lg border border-border bg-bg-card shadow-xl min-w-[64px]">
                          {group.options.map(opt => (
                            <button key={opt.value}
                              onClick={() => { onCandleChange(opt.value); setOpenGroup(null); }}
                              className={`px-3 py-1.5 text-sm rounded-md font-semibold whitespace-nowrap transition-all ${candleType === opt.value ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"}`}
                            >{opt.label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary">
                {([{value:"candle",label:"캔들"},{value:"line",label:"라인"},{value:"area",label:"영역"}] as const).map(({value,label})=>(
                  <button key={value} aria-pressed={chartType===value} onClick={()=>setChartType(value)}
                    className={`px-2.5 py-1 text-sm rounded-md font-semibold transition-all ${chartType===value?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}
                  >{label}</button>
                ))}
              </div>
              <button aria-pressed={logScale} onClick={()=>setLogScale(v=>!v)}
                className={`px-2.5 py-1 text-sm rounded-lg border font-semibold transition-all ${logScale?"bg-accent-blue/20 border-accent-blue/50 text-accent-blue":"border-border text-text-muted"}`}
              >LOG</button>
            </div>
            <button onClick={()=>setFullscreen(false)} className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
              <X size={18}/>
            </button>
          </div>
          {/* 전체 차트.
              예전에는 높이를 '남은 공간의 55%' 로 줬다. 보조지표(RSI·MACD)를
              켰을 때 그것까지 한 화면에 담으려던 것인데, 지표를 안 켠
              보통의 경우에는 전체화면을 눌러도 차트가 화면 절반만 차지해
              '전체가 아닌 부분적으로' 뜨는 것처럼 보였다.

              이제 남은 공간을 실제로 재서 그만큼 준다. 보조지표를 켜면
              그 패널은 아래로 밀려 스크롤된다 — 주 차트가 작아지는 것보다
              한 번 밀어 보는 편이 낫다. 화면을 돌리면 다시 잰다. */}
          {/* overflow-x-hidden — 가로 스크롤바가 생기면 clientHeight 가
              콘텐츠에 따라 흔들리고, 그것이 다시 차트 높이를 바꾸는
              되먹임 고리가 된다. 아예 못 생기게 막는다. */}
          <div ref={전체차트칸} className="flex-1 overflow-y-auto overflow-x-hidden">
            {/* 높이를 재기 전에는 안 그린다. 임시 높이로 한 번 그렸다가
                다시 만들면 그 자체가 흔들림이다 */}
            {전체차트높이 > 0 && (
              <StockChart data={ohlcv} height={Math.max(260, 전체차트높이)}
                          isKR={isKR} chartType={chartType} logScale={logScale}/>
            )}
          </div>
        </div>
      )}

      {/* 재무제표 탭 */}
      {mainTab==="financial" && (() => {
        const { mh, dEnhanced, mhYears, allYears, getVal } = finTabData;

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

        // EPS/BPS 등 주당 지표 포맷 — fmtKRW("3만"처럼 만 단위로 축약)를 쓰지 않고
        // 원 단위까지 정확하게 표기 (예: 34,292원)
        const fmtEpsBps = (v: number | null | undefined): string | null => {
          if (v == null) return null;
          if (isKR) return `₩${Math.round(v).toLocaleString("ko-KR")}`;
          if (showKRW) return `₩${Math.round(v * exchangeRate).toLocaleString("ko-KR")}`;
          return fmtUSD(v);
        };

        // 반응형 차트 높이 (모바일 compact, PC 표준)
        const chartH   = isMobile ? 220 : 300;
        const chartHSm = isMobile ? 185 : 240;

        // 공통 차트 옵션
        const chartProps = {
          /* margin 은 반드시 margin={...} 로 넘긴다.
             예전에는 {...chartProps.margin} 으로 펼쳐서 넘겼다. 그러면 recharts 가
             모르는 top/right/left/bottom 이 각각 prop 으로 들어가고 정작 margin 은
             안 들어간다 — 차트 11개의 여백이 한 번도 적용된 적이 없었다.
             `as any` 가 붙어 있어서 타입 검사도 이걸 못 잡았으므로 떼어 둔다. */
          margin: {top:8,right:12,left:4,bottom:4},
          /* 축·격자·툴팁 색은 테마 토큰에서 읽는다. 예전에는 다크 값을 손으로
             적어 두어 라이트 모드에서 차트만 어둡게 남았다 (utils/chartTheme) */
          cartesianGridProps: 격자,
          xAxisProps: 축 as any,
          yAxisProps: { ...축, width: isMobile ? 46 : 58 } as any,
          tooltipProps: 툴팁 as any,
        };

        return (
          <div className="flex flex-col gap-4">

          {/* 원화 환산 토글 (US 종목만) */}
          {!isKR && (
            <div className="flex justify-end">
              <button
                aria-pressed={showKRW} onClick={() => setShowKRW(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg border transition-all ${
                  showKRW
                    ? "bg-accent-blue/20 border-accent-blue/50 text-accent-blue"
                    : "border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
                }`}
              >
                ₩ 원화
                {showKRW && <span className="text-2xs text-text-muted">(1USD≈{exchangeRate.toLocaleString("ko-KR")}₩)</span>}
              </button>
            </div>
          )}

          {/* ── 손익계산서 ── */}
          {finSubTab==="income" && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-base font-semibold text-text-primary">손익계산서</span>
                <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod} />
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
                      <BarChart data={finData} margin={chartProps.margin}>
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
                    { key:"net_income",       label:"당기순이익",   fmt:(v)=>fmtFin(v), color:"text-accent-purple" },
                    { key:"net_income_growth",label:"순이익성장률", fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-purple" },
                    { key:"op_margin",        label:"영업이익률",   fmt:(v)=>`${v.toFixed(1)}%`, color:"text-text-secondary" },
                    { key:"net_margin",       label:"순이익률",     fmt:(v)=>`${v.toFixed(1)}%`, color:"text-text-secondary" },
                    { key:"eps",              label:"EPS",          fmt:(v)=>fmtEpsBps(v)!, color:"text-accent-cyan" },
                    /* 백엔드가 매출·영업이익·순이익과 함께 eps_growth 도
                       만들어 보내는데(_add_growth) 표에는 없었다. 주당 이익이
                       얼마나 늘었는지가 정작 주주에게 가장 가까운 숫자다 */
                    { key:"eps_growth",       label:"EPS성장률",    fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-cyan" },
                  ]} allYears={allYears} getVal={getVal} finPeriod={finPeriod} />
                </div>
              )}
            </div>
          )}

          {/* ── 밸류에이션 ── */}
          {finSubTab==="valuation" && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-base font-semibold text-text-primary">밸류에이션</span>
                <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod} />
              </div>
              <div className="p-4 flex flex-col gap-4">
                {/* 현재 지표 — detail 없으면 metricsHistory 최신값 사용 */}
                {d && (
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    <StatCell label="PER(현재)"    value={dEnhanced.per          != null ? `${fmtNum(dEnhanced.per)}배` : null} />
                    <StatCell label="PER(선행)"    value={dEnhanced.forward_per  != null ? `${fmtNum(dEnhanced.forward_per)}배` : null} />
                    <StatCell label="EPS(선행)"    value={fmtEpsBps(dEnhanced.forward_eps)} />
                    <StatCell label="PEG"          value={dEnhanced.peg          != null ? fmtNum(dEnhanced.peg, 2) : null} />
                    <StatCell label="PBR"          value={dEnhanced.pbr          != null ? `${fmtNum(dEnhanced.pbr,2)}배` : null} />
                    <StatCell label="PSR"          value={dEnhanced.psr          != null ? `${fmtNum(dEnhanced.psr,2)}배` : null} />
                    <StatCell label="EV/EBITDA"    value={dEnhanced.ev_ebitda    != null ? `${fmtNum(dEnhanced.ev_ebitda,1)}배` : null} />
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
                          <BarChart data={singlePoint} margin={chartProps.margin}>
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
                          <BarChart data={singlePoint.filter(r=>r.eps!=null)} margin={chartProps.margin}>
                            <CartesianGrid {...chartProps.cartesianGridProps}/>
                            <XAxis dataKey="period" {...chartProps.xAxisProps}/>
                            <YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>fmtEpsBps(v)!}/>
                            <Tooltip {...chartProps.tooltipProps} formatter={(v:number)=>[fmtEpsBps(v)!,"EPS"]}/>
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
                        <BarChart data={mh} margin={chartProps.margin}>
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
                      <BarChart data={mh.filter((r:any)=>r.eps!=null)} margin={chartProps.margin}>
                        <CartesianGrid {...chartProps.cartesianGridProps}/>
                        <XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                        <YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>fmtEpsBps(v)!}/>
                        <Tooltip {...chartProps.tooltipProps} formatter={(v:number)=>[fmtEpsBps(v)!,"EPS"]}/>
                        <Bar dataKey="eps" fill="#06b6d4" radius={[2,2,0,0]} maxBarSize={35}/>
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()}
                {/* 전치 테이블 */}
                <TransTable rows={[
                  { key:"per",  label:"PER",        fmt:(v)=>`${v.toFixed(1)}배`, color:"text-accent-blue" },
                  { key:"pbr",  label:"PBR",        fmt:(v)=>`${v.toFixed(2)}배`, color:"text-accent-green" },
                  { key:"psr",  label:"PSR",        fmt:(v)=>`${v.toFixed(2)}배`, color:"text-accent-purple" },
                  { key:"eps",  label:"EPS",  fmt:(v)=>fmtEpsBps(v)!, color:"text-accent-cyan" },
                  { key:"bps",  label:"BPS",  fmt:(v)=>fmtEpsBps(v)!, color:"text-text-secondary" },
                ]} allYears={allYears} getVal={getVal} finPeriod={finPeriod} />
              </div>
            </div>
          )}

          {/* ── 기본 (수익성 + 종합 지표) ── */}
          {finSubTab==="basic" && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-base font-semibold text-text-primary">기본 지표</span>
                <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod} />
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
                        className={`px-2.5 py-1 text-sm rounded-lg font-semibold border transition-all ${selectedMetric===m.key?"text-white border-transparent":"border-border text-text-muted hover:text-text-primary"}`}
                        style={selectedMetric===m.key?{background:m.color+"cc",borderColor:m.color}:{}}
                      >{m.label}</button>
                    ))}
                  </div>
                  {/* 선택 지표 차트 */}
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={chartH}>
                      <BarChart data={chartData} margin={chartProps.margin}>
                        <CartesianGrid {...chartProps.cartesianGridProps}/>
                        <XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                        <YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>curr.pct?`${v}%`:fmtFin(v)}/>
                        <Tooltip {...chartProps.tooltipProps} formatter={(v:number)=>[curr.pct?`${Number(v).toFixed(1)}%`:(fmtFin(v)), curr.label]}/>
                        <Bar dataKey={selectedMetric} fill={curr.color} radius={[3,3,0,0]} maxBarSize={50}/>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-text-muted text-base py-4 text-center">연결 중...</p>}
                  {/* 전치 테이블 */}
                  <TransTable rows={BASIC_METRICS.map(m=>({
                    key: m.key,
                    label: m.label,
                    fmt: (v:number) => m.pct ? `${v.toFixed(1)}%` : (m.key==="current_ratio"||m.key==="quick_ratio" ? `${(v*100).toFixed(0)}%` : (fmtFin(v))),
                    color: "text-text-secondary",
                  }))} allYears={allYears} getVal={getVal} finPeriod={finPeriod} />
                </>);
              })()}
              </div>
            </div>
          )}

          {/* ── 수익성 ── */}
          {finSubTab==="profitability" && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-base font-semibold text-text-primary">수익성</span>
                <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod} />
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
                    <StatCell label="EPS" value={fmtEpsBps(dEnhanced.eps)}/>
                    <StatCell label="선행EPS" value={fmtEpsBps(dEnhanced.forward_eps)}/>
                  </div>
                )}
                {mhYears.length > 0 && (
                  <ResponsiveContainer width="100%" height={chartHSm}>
                    <BarChart data={mh.filter((r:any)=>r.op_margin||r.net_margin)} margin={chartProps.margin}>
                      <CartesianGrid {...chartProps.cartesianGridProps}/>
                      <XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                      <YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>`${v}%`}/>
                      <Tooltip {...chartProps.tooltipProps} formatter={(v:number,n:string)=>[`${Number(v).toFixed(1)}%`,{gross_margin:"매출총이익률",op_margin:"영업이익률",net_margin:"순이익률"}[n]??n]}/>
                      <Legend formatter={v=>({gross_margin:"매출총이익률",op_margin:"영업이익률",net_margin:"순이익률"}[v as string]??v)}/>
                      <Bar dataKey="gross_margin" fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={20}/>
                      <Bar dataKey="op_margin"    fill="#10b981" radius={[2,2,0,0]} maxBarSize={20}/>
                      <Bar dataKey="net_margin"   fill="#8b5cf6" radius={[2,2,0,0]} maxBarSize={20}/>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                <TransTable rows={[
                  { key:"gross_margin", label:"매출총이익률", fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-blue" },
                  { key:"op_margin",    label:"영업이익률",   fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-green" },
                  { key:"net_margin",   label:"순이익률",     fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-purple" },
                  { key:"roe",          label:"ROE",          fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-yellow" },
                  { key:"roa",          label:"ROA",          fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-cyan" },
                  { key:"eps",          label:"EPS",          fmt:(v)=>fmtEpsBps(v)!, color:"text-accent-cyan" },
                ]} allYears={allYears} getVal={getVal} finPeriod={finPeriod} />
              </div>
            </div>
          )}

          {/* ── 재무건전성 ── */}
          {finSubTab==="health" && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-base font-semibold text-text-primary">재무건전성</span>
                <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod} />
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
                    <StatCell label="배당성향"  value={dEnhanced.payout_ratio!=null?`${dEnhanced.payout_ratio.toFixed(1)}%`:null}/>
                    <StatCell label="베타"      value={dEnhanced.beta!=null?dEnhanced.beta.toFixed(2):null}
                      color={dEnhanced.beta!=null?(dEnhanced.beta>1.5?"text-accent-red":dEnhanced.beta<0.5?"text-accent-green":"text-text-primary"):undefined}/>
                  </div>
                )}
                {/* 차트 */}
                {mhYears.length > 0 && (
                  <ResponsiveContainer width="100%" height={chartHSm}>
                    <BarChart data={mh.filter((r:any)=>r.debt_ratio||r.current_ratio)} margin={chartProps.margin}>
                      <CartesianGrid {...chartProps.cartesianGridProps}/>
                      <XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                      <YAxis yAxisId="ratio" {...chartProps.yAxisProps} tickFormatter={(v:number)=>`${(v*100).toFixed(0)}%`}/>
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
                ]} allYears={allYears} getVal={getVal} finPeriod={finPeriod} />
              </div>
            </div>
          )}

          {/* ── 현금흐름 ── */}
          {finSubTab==="cashflow" && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-base font-semibold text-text-primary">현금흐름</span>
                <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod} />
              </div>
              <div className="p-4 flex flex-col gap-4">
                {/* 현금흐름 바 차트 */}
                {mh.some((r:any) => r.operating_cf != null) && (
                  <div>
                    <p className="text-sm text-text-muted font-semibold mb-2">영업 / 투자 / 재무 현금흐름</p>
                    <ResponsiveContainer width="100%" height={chartH}>
                      <BarChart data={mh.filter((r:any)=>r.operating_cf!=null)} margin={chartProps.margin}>
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
                    <p className="text-sm text-text-muted font-semibold mb-2">잉여현금흐름 (FCF)</p>
                    <ResponsiveContainer width="100%" height={chartHSm}>
                      <BarChart data={mh.filter((r:any)=>r.free_cf!=null)} margin={chartProps.margin}>
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
                ]} allYears={allYears} getVal={getVal} finPeriod={finPeriod} />
              </div>
            </div>
          )}

          {/* ── 사용자설정 ── */}
          {finSubTab==="custom" && (() => {
            const selectedOpts = customMetricKeys.map(k => FIN_CUSTOM_OPTS.find(o => o.key === k)).filter((o): o is typeof FIN_CUSTOM_OPTS[number] => !!o);
            const fmtVal = (opt: typeof FIN_CUSTOM_OPTS[number], v: number) => {
              if (opt.fmt === "fin") return fmtFin(v);
              if (opt.fmt === "pct") return `${v.toFixed(1)}%`;
              if (opt.fmt === "ratio_pct") return `${(v * 100).toFixed(0)}%`;
              if (opt.fmt === "epsbps") return fmtEpsBps(v)!;
              return `${v.toFixed(2)}x`;
            };
            const COLORS = ["#3b82f6","#10b981","#8b5cf6","#f59e0b","#ef4444","#06b6d4","#f97316","#22c55e","#ec4899","#14b8a6"];
            return (
              <div className="flex flex-col gap-4">
                {/* 기간 토글 */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-text-muted">지표 선택 후 차트·표로 확인</span>
                  <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod}/>
                </div>

                {/* 지표 관리 —
                    관심종목 탭 관리·내 자산 계좌 관리와 같은 모양이다.
                    예전에는 "지표 선택"(접이식 칩)과 "순서 조정"(◀▶ 버튼)이
                    화면에 늘 펼쳐져 있어, 정작 보려던 차트가 저 아래로
                    밀렸다. 순서 바꾸는 방식도 여기만 화살표였다. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setShowCustomSelector(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all"
                  >
                    <Settings2 size={13} />
                    지표 관리
                    <span className="text-text-dim font-normal">{customMetricKeys.length}/20</span>
                  </button>
                  {/* 고른 것을 여기서도 보여준다 — 창을 열지 않고도 무엇을
                      보고 있는지 알 수 있게. 누르면 바로 뺀다 */}
                  {selectedOpts.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => updateCustomMetricKeys(customMetricKeys.filter((k) => k !== opt.key))}
                      aria-label={`${opt.label} 빼기`}
                      title="눌러서 빼기"
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-white border border-transparent hover:opacity-80 transition-opacity"
                      style={{ background: opt.color + "bb", borderColor: opt.color }}
                    >
                      {opt.label}
                      <X size={10} className="opacity-70" />
                    </button>
                  ))}
                </div>

                {showCustomSelector && (
                  <MetricManagerModal
                    전체={FIN_CUSTOM_OPTS}
                    선택된={customMetricKeys}
                    onChange={updateCustomMetricKeys}
                    onClose={() => setShowCustomSelector(false)}
                  />
                )}

                {/* 선택된 지표 없을 때 */}
                {selectedOpts.length === 0 && (
                  <div className="rounded-xl border border-border bg-bg-card flex items-center justify-center py-12">
                    <p className="text-text-muted text-base">위에서 지표를 선택하세요</p>
                  </div>
                )}

                {/* 차트 — 단위별 분리 */}
                {selectedOpts.length > 0 && allYears.length > 0 && (() => {
                  const chartData = allYears.map(year => {
                    const row: any = { year };
                    selectedOpts.forEach(opt => { row[opt.key] = getVal(opt.key, year); });
                    return row;
                  });
                  const xFmt = (v: string) => finPeriod === "quarterly" ? v.replace(/(\d{4})-?Q(\d)/, "$1 Q$2") : v;
                  const ttFmt = (v: number, name: string) => {
                    const opt = FIN_CUSTOM_OPTS.find(o => o.key === name);
                    return [opt ? fmtVal(opt, v) : v, opt?.label ?? name];
                  };
                  const legFmt = (v: string) => FIN_CUSTOM_OPTS.find(o => o.key === v)?.label ?? v;
                  const UNIT_GROUPS = [
                    {
                      fmts: ["fin"],
                      label: isKR ? "금액 (조원 / 억원)" : "금액 (B / M)",
                      yFmt: (v: number) => { const a=Math.abs(v); return isKR?(a>=1e12?(v/1e12).toFixed(0)+"조":a>=1e8?(v/1e8).toFixed(0)+"억":String(v)):(a>=1e9?(v/1e9).toFixed(0)+"B":a>=1e6?(v/1e6).toFixed(0)+"M":v.toFixed(1)); },
                    },
                    {
                      fmts: ["epsbps"],
                      label: isKR ? "주당 (원)" : "주당 ($)",
                      yFmt: (v: number) => { const a=Math.abs(v); return isKR?(a>=10000?(v/10000).toFixed(1)+"만":v.toLocaleString("ko-KR")):("$"+v.toFixed(2)); },
                    },
                    {
                      fmts: ["pct", "ratio_pct"],
                      label: "비율 (%)",
                      yFmt: (v: number) => v.toFixed(1) + "%",
                    },
                    {
                      fmts: ["x"],
                      label: "배수 (x)",
                      yFmt: (v: number) => v.toFixed(2) + "x",
                    },
                  ];
                  return (
                    <>
                      {UNIT_GROUPS.map(group => {
                        const groupOpts = selectedOpts.filter(opt => group.fmts.includes(opt.fmt));
                        if (!groupOpts.length) return null;
                        return (
                          <div key={group.label} className="rounded-xl overflow-hidden border border-border bg-bg-card">
                            <div className="px-4 py-3 border-b border-border">
                              <span className="text-base font-semibold text-text-primary">추이 차트 — {group.label}</span>
                            </div>
                            <div className="p-4">
                              <ResponsiveContainer width="100%" height={chartH}>
                                <BarChart data={chartData} margin={chartProps.margin}>
                                  <CartesianGrid {...chartProps.cartesianGridProps}/>
                                  <XAxis dataKey="year" {...chartProps.xAxisProps} tickFormatter={xFmt}/>
                                  <YAxis {...chartProps.yAxisProps} tickFormatter={group.yFmt}/>
                                  <Tooltip {...chartProps.tooltipProps} formatter={ttFmt as any}/>
                                  <Legend formatter={legFmt}/>
                                  {groupOpts.map(opt => (
                                    <Bar key={opt.key} dataKey={opt.key} fill={COLORS[selectedOpts.indexOf(opt) % COLORS.length]} radius={[2,2,0,0]} maxBarSize={35}/>
                                  ))}
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}

                {/* 테이블 */}
                {selectedOpts.length > 0 && (
                  <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
                    <div className="px-4 py-3 border-b border-border">
                      <span className="text-base font-semibold text-text-primary">데이터 표</span>
                    </div>
                    <div className="p-4">
                      <TransTable
                        rows={selectedOpts.map(opt => ({
                          key: opt.key,
                          label: opt.label,
                          fmt: (v: number) => fmtVal(opt, v),
                          color: "text-text-primary",
                        }))}
                        allYears={allYears}
                        getVal={getVal}
                        finPeriod={finPeriod}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          </div>
        );
      })()}

      {/* 퀀트점수 탭 */}
      {mainTab==="quant" && (() => {
        return (
          <div className="flex flex-col gap-3">
            <Card className="flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl font-mono font-bold text-text-primary">
                    {quantMetricsIncomplete ? "···" : quantScore?.total_score ?? (loadingQuant ? "···" : "—")}
                  </span>
                  <span className="text-base text-text-muted">/ 100</span>
                  {!quantMetricsIncomplete && quantScore?.grade && (
                    <span className={`text-2xl font-bold ${gradeColor(quantScore.grade)}`}>{quantScore.grade}</span>
                  )}
                  <div className="relative">
                    <button
                      onClick={() => setShowGradeHelp((s) => !s)}
                      className={`flex items-center justify-center w-5 h-5 rounded-full border transition-colors ${
                        showGradeHelp ? "border-accent-blue text-accent-blue bg-accent-blue/5" : "border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
                      }`}
                      title="등급 기준 보기"
                    >
                      <HelpCircle size={13}/>
                    </button>
                    {showGradeHelp && (
                      <div className="absolute left-0 top-7 z-20 w-56 rounded-xl border border-border bg-bg-elevated shadow-lg p-3 flex flex-col gap-1.5">
                        <span className="text-base font-semibold text-text-secondary pb-1">종합 점수 → 등급 기준</span>
                        {GRADE_BANDS.map((b) => (
                          <div key={b.grade} className="flex items-center justify-between text-base">
                            <span className={`font-bold ${gradeColor(b.grade)}`}>{b.grade}</span>
                            <span className="text-text-secondary font-mono">{b.range}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {quantMetricsIncomplete && (
                  <span className="text-xs text-text-muted">일부 지표 데이터를 수집하는 중입니다…</span>
                )}
                </div>
                <button
                  onClick={() => setShowQuantSettings((s) => !s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    showQuantSettings ? "border-accent-blue text-accent-blue bg-accent-blue/5" : "border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
                  }`}
                >
                  <Settings2 size={14}/>기준 수정
                </button>
              </div>

              {showQuantSettings && (
                <QuantSettingsPanel
                  weightsDraft={quantSettings.weightsDraft}
                  metricsDraft={quantSettings.metricsDraft}
                  onUpdateWeight={quantSettings.updateWeight}
                  onToggleMetric={quantSettings.toggleMetric}
                  onReset={quantSettings.resetToDefault}
                  onSave={() => quantSettings.save.mutate({ weights: quantSettings.weightsDraft ?? QUANT_DEFAULT_WEIGHTS, metrics: quantSettings.metricsDraft ?? {} })}
                  onClose={() => setShowQuantSettings(false)}
                  isSaving={quantSettings.save.isPending}
                  isLoggedIn={isLoggedIn}
                  saveMsg={quantSettings.saveMsg}
                />
              )}

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {(quantScore?.factors ?? []).map((f) => (
                  <div key={f.key} className="flex flex-col gap-1.5 p-3 rounded-xl border border-border bg-bg-elevated">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-text-secondary">{f.label}</span>
                      <span className="text-xs text-text-muted">{f.weight}%</span>
                    </div>
                    <span className={`text-lg font-mono font-bold ${scoreColor(f.score)}`}>{quantMetricsIncomplete ? "···" : f.score ?? "—"}</span>
                    <div className="h-1.5 rounded-full bg-bg-primary overflow-hidden">
                      <div className="h-full bg-accent-blue rounded-full" style={{ width: `${quantMetricsIncomplete ? 0 : Math.max(0, Math.min(100, f.score ?? 0))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="flex flex-col gap-4">
              <SectionTitle>세부 지표</SectionTitle>
              {(quantScore?.factors ?? []).map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <span className="text-sm font-bold text-text-muted">{f.label}</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {f.metrics.map((mt) => (
                      <div key={mt.key} className="flex flex-col gap-0.5 p-2.5 rounded-lg border border-border/60 bg-bg-primary">
                        <span className="text-xs text-text-muted truncate">{mt.label}</span>
                        <span className="text-base font-mono text-text-primary">{mt.value != null ? `${mt.value}${mt.unit}` : "—"}</span>
                        <span className={`text-xs font-mono ${scoreColor(mt.score)}`}>
                          {mt.score != null ? `${mt.score}점` : "데이터 없음"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-xs text-text-muted leading-relaxed pt-1">
                업종 구분 없는 일반적인 기준 구간을 0~100점으로 환산한 참고용 점수이며 투자 조언이 아닙니다.
                일부 지표는 데이터가 없으면 제외되고, 해당 팩터·종합 점수의 가중치가 나머지 항목으로 재분배됩니다.
              </p>
            </Card>
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

        const analystGradeColor = (g: string) => {
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

        // 투자의견/컨센서스 통화 포맷 (showKRW 토글 반영)
        const fmtPrice = (v: number | null | undefined): string => {
          if (v == null) return "—";
          if (isKR) return `₩${Math.round(v).toLocaleString("ko-KR")}`;
          if (showKRW) return `₩${Math.round(v * exchangeRate).toLocaleString("ko-KR")}`;
          return `$${v.toFixed(2)}`;
        };
        const fmtPrice0 = (v: number | null | undefined): string => {
          if (v == null) return "—";
          if (isKR) return `₩${Math.round(v).toLocaleString("ko-KR")}`;
          if (showKRW) return `₩${Math.round(v * exchangeRate).toLocaleString("ko-KR")}`;
          return `$${v.toFixed(0)}`;
        };
        const fmtAmtKRW = (v: number): string => {
          if (isKR) return fmtKRW(v);
          if (showKRW) return fmtKRW(v * exchangeRate);
          return fmtUSD(v);
        };

        return (
          <div className="flex flex-col gap-4">
            {/* 서브탭 + 원화 환산 토글 */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Tabs
                fill={false} size="md" className="w-fit"
                ariaLabel="애널리스트 항목"
                tabs={[{ id: "opinion", label: "투자의견" }, { id: "consensus", label: "컨센서스" }]}
                active={analystSubTab}
                onChange={(id) => setAnalystSubTab(id as any)}
              />
              {!isKR && (
                <button
                  aria-pressed={showKRW} onClick={() => setShowKRW(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg border transition-all ${
                    showKRW
                      ? "bg-accent-blue/20 border-accent-blue/50 text-accent-blue"
                      : "border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
                  }`}
                >
                  ₩ 원화
                  {showKRW && <span className="text-2xs text-text-muted">(1USD≈{exchangeRate.toLocaleString("ko-KR")}₩)</span>}
                </button>
              )}
            </div>

            {analystSubTab==="opinion" && (loadingAnalyst ? (
              <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/></div>
            ) : !ad || (!pt && !cs && !nc && reports.length === 0) ? (
              <div className="rounded-xl border border-border bg-bg-card flex items-center justify-center py-16">
                <p className="text-text-muted text-base">투자의견 데이터가 없습니다</p>
              </div>
            ) : (
              <>
                {/* ── 컨센서스 보조 정보 (국내: Naver, 해외: 펀더멘털 기반) ── */}
                {nc && (
                  <div className="rounded-xl border border-border bg-bg-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="col-span-2 sm:col-span-4">
                      <span className="text-sm font-bold text-text-muted uppercase tracking-widest">{isKR ? "Naver 컨센서스" : "컨센서스 정보"}</span>
                    </div>
                    {nc.cons_per != null && (
                      <StatCell label="컨센서스 PER" value={`${fmtNum(nc.cons_per)}배`} color="text-accent-blue" />
                    )}
                    {nc.cons_eps != null && (
                      <StatCell label="컨센서스 EPS" value={fmtPrice(nc.cons_eps)} color="text-accent-green" />
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
                        <span className="text-sm font-bold text-text-muted uppercase tracking-widest">목표주가</span>
                        {upside != null && (
                          <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${upside >= 0 ? "bg-accent-green/10 text-accent-green" : "bg-accent-red/10 text-accent-red"}`}>
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
                          <div className="flex justify-between text-xs text-text-muted font-mono">
                            <span>저 {fmtPrice0(pt.low)}</span>
                            <span>고 {fmtPrice0(pt.high)}</span>
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
                            <span className="text-xs text-text-muted">{item.label}</span>
                            <span className={`text-base font-mono font-bold ${item.color}`}>
                              {fmtPrice0(item.v)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="text-sm text-text-muted text-center">
                        현재가 {fmtPrice(pt.current ?? 0)} 기준 · {totalVotes}명 애널리스트
                      </div>
                    </div>
                  )}

                  {/* 합의 등급 */}
                  {cs && (
                    <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-3">
                      <span className="text-sm font-bold text-text-muted uppercase tracking-widest">투자의견 합의</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-2xl font-bold ${ratingColor}`}>{ratingLabel}</span>
                        {avgScore != null && <span className="text-base text-text-muted font-mono">{avgScore.toFixed(2)} / 5.0</span>}
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
                              <span className="text-xs text-text-muted w-14 flex-shrink-0">{label}</span>
                              <div className="flex-1 h-2 rounded-full bg-bg-elevated overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }}/>
                              </div>
                              <span className="text-xs font-mono text-text-muted w-6 text-right">{cnt}</span>
                            </div>
                          );
                        })}
                      </div>
                      {/* 최근 3개월 추이 */}
                      {history.length > 1 && (
                        <div className="border-t border-border pt-2">
                          <p className="text-xs text-text-muted mb-1.5">최근 추이</p>
                          <div className="flex gap-2">
                            {history.slice(0, 4).map((h: any, i: number) => {
                              const tot = h.strong_buy + h.buy + h.hold + h.sell + h.strong_sell;
                              const bs = ((h.strong_buy + h.buy) / (tot || 1) * 100).toFixed(0);
                              const label = ["이번달","1개월전","2개월전","3개월전"][i] ?? h.period;
                              return (
                                <div key={i} className="flex-1 flex flex-col items-center gap-0.5 p-1.5 rounded-lg bg-bg-elevated">
                                  <span className="text-xs text-text-muted">{label}</span>
                                  <span className="text-sm font-bold text-accent-green">{bs}%</span>
                                  <span className="text-xs text-text-dim">매수</span>
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
                      <span className="text-base font-semibold text-text-primary">최근 애널리스트 리포트</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
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
                                <td className={`px-4 py-2.5 font-semibold whitespace-nowrap ${analystGradeColor(r.to_grade)}`}>{r.to_grade || "—"}</td>
                                <td className="px-4 py-2.5 text-right font-mono text-text-primary whitespace-nowrap">
                                  {fmtPrice0(r.target)}
                                  {r.prior_target != null && r.target != null && r.prior_target !== r.target && (
                                    <span className="text-text-muted ml-1 text-2xs">
                                      ({r.target > r.prior_target ? "↑" : "↓"}{fmtPrice0(r.prior_target)})
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-center whitespace-nowrap">
                                  <span className={`px-2 py-0.5 rounded-full text-2xs font-bold whitespace-nowrap ${act.color}`}>{act.text}</span>
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
                  <p className="text-text-muted text-base">컨센서스 데이터가 없습니다</p>
                </div>
              );

              // 기간 컬럼 생성
              const periods = fcstData.map((r: any) => r.period);
              const periodLabel = (p: string) => {
                if (consensusPeriod === "annual") return p;
                // 분기: "2026-Q1" → "2026 Q1"
                return p.replace("-", " ");
              };

              const indicators = [
                { key: "revenue_est",    label: "매출 추정",        color: "text-accent-blue",    fmt: fmtAmtKRW },
                { key: "revenue_low",    label: "매출 최저",         color: "text-accent-blue/60", fmt: fmtAmtKRW },
                { key: "revenue_high",   label: "매출 최고",         color: "text-accent-blue/60", fmt: fmtAmtKRW },
                { key: "op_income_est",  label: "영업이익 추정",     color: "text-accent-green",   fmt: fmtAmtKRW },
                { key: "net_income_est", label: "순이익 추정",       color: "text-accent-purple",     fmt: fmtAmtKRW },
                { key: "eps_est",        label: "EPS 추정",          color: "text-accent-green",   fmt: fmtPrice },
                { key: "eps_low",        label: "EPS 최저",          color: "text-accent-green/60",fmt: fmtPrice },
                { key: "eps_high",       label: "EPS 최고",          color: "text-accent-green/60",fmt: fmtPrice },
                { key: "eps_analysts",   label: "EPS 애널리스트 수", color: "text-text-muted",     fmt: (v: number) => `${Math.round(v)}명` },
                { key: "eps_current",    label: "EPS 현재 추정",     color: "text-accent-cyan",       fmt: fmtPrice },
                { key: "eps_7d_ago",     label: "EPS 7일 전",        color: "text-text-muted",     fmt: fmtPrice },
                { key: "eps_30d_ago",    label: "EPS 30일 전",       color: "text-text-muted",     fmt: fmtPrice },
                { key: "eps_90d_ago",    label: "EPS 90일 전",       color: "text-text-muted",     fmt: fmtPrice },
                { key: "growth_est",     label: "EPS 성장률 추정",   color: "text-accent-yellow",  fmt: (v: number) => `${(v*100).toFixed(1)}%` },
              ].filter(ind => fcstData.some((r: any) => r[ind.key] != null));

              // 컨센서스 차트용 데이터/포맷 (showKRW 토글 시 차트 값도 원화로 환산)
              const inKRW = isKR || showKRW;
              const convFactor = (!isKR && showKRW) ? exchangeRate : 1;
              const chartData = fcstData.map((r: any) => {
                const conv: any = { ...r, periodLabel: periodLabel(r.period) };
                if (convFactor !== 1) {
                  ["revenue_est","revenue_low","revenue_high","op_income_est","net_income_est","eps_est"].forEach(k => {
                    if (conv[k] != null) conv[k] = conv[k] * convFactor;
                  });
                }
                return conv;
              });
              const hasRevenueChart = fcstData.some((r: any) => r.revenue_est != null);
              const hasOpIncome  = fcstData.some((r: any) => r.op_income_est != null);
              const hasNetIncome = fcstData.some((r: any) => r.net_income_est != null);
              const hasEpsChart  = fcstData.some((r: any) => r.eps_est != null);
              const chartHSm = isMobile ? 185 : 240;
              const cMargin  = {top:8,right:12,left:4,bottom:4} as any;
              // 재무제표 탭과 같은 테마 토큰을 쓴다 (utils/chartTheme)
              const cGrid    = 격자;
              const cXAxis   = 축 as any;
              const cYAxis   = { ...축, width: isMobile ? 46 : 58 } as any;
              const cTooltip = 툴팁 as any;
              const fmtAmt = (v:number) => inKRW ? fmtKRW(v) : fmtUSD(v);
              const fmtEpsV = (v:number) => inKRW ? `₩${Math.round(v).toLocaleString("ko-KR")}` : `$${v.toFixed(2)}`;

              return (
                <div className="flex flex-col gap-3">
                  {/* 연간/분기 토글 */}
                  <div className="flex gap-1 p-0.5 rounded-lg border border-border bg-bg-primary w-fit">
                    {(["annual","quarterly"] as const).map(k => (
                      <button key={k} onClick={() => setConsensusPeriod(k)}
                        className={`px-3 py-1 text-sm font-semibold rounded-md transition-all ${consensusPeriod===k?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}>
                        {k==="annual" ? "연간" : "분기"}
                      </button>
                    ))}
                  </div>
                  {/* 컨센서스 추정치 그래프 */}
                  {(hasRevenueChart || hasEpsChart) && (
                    <div className="rounded-xl overflow-hidden border border-border bg-bg-card p-4">
                      <ResponsiveContainer width="100%" height={chartHSm}>
                        {hasRevenueChart ? (
                          <BarChart data={chartData} {...cMargin}>
                            <CartesianGrid {...cGrid}/>
                            <XAxis dataKey="periodLabel" {...cXAxis}/>
                            <YAxis {...cYAxis} tickFormatter={(v:number)=>{const a=Math.abs(v);return inKRW?(a>=1e12?(v/1e12).toFixed(0)+"조":a>=1e8?(v/1e8).toFixed(0)+"억":String(v)):(a>=1e9?(v/1e9).toFixed(0)+"B":a>=1e6?(v/1e6).toFixed(0)+"M":String(v));}}/>
                            <Tooltip {...cTooltip} formatter={(v:number,name:string)=>{const l:Record<string,string>={revenue_est:"매출 추정",op_income_est:"영업이익 추정",net_income_est:"순이익 추정"};return[fmtAmt(v),l[name]??name];}}/>
                            <Legend formatter={v=>({revenue_est:"매출",op_income_est:"영업이익",net_income_est:"순이익"}[v as string]??v)}/>
                            <Bar dataKey="revenue_est" fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={35}/>
                            {hasOpIncome && <Bar dataKey="op_income_est" fill="#10b981" radius={[2,2,0,0]} maxBarSize={35}/>}
                            {hasNetIncome && <Bar dataKey="net_income_est" fill="#8b5cf6" radius={[2,2,0,0]} maxBarSize={35}/>}
                          </BarChart>
                        ) : (
                          <BarChart data={chartData} {...cMargin}>
                            <CartesianGrid {...cGrid}/>
                            <XAxis dataKey="periodLabel" {...cXAxis}/>
                            <YAxis {...cYAxis} tickFormatter={(v:number)=>fmtEpsV(v)}/>
                            <Tooltip {...cTooltip} formatter={(v:number)=>[fmtEpsV(v),"EPS 추정"]}/>
                            <Bar dataKey="eps_est" fill="#06b6d4" radius={[2,2,0,0]} maxBarSize={35}/>
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  )}
                  {/* 테이블 */}
                  <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
                    <div className="px-4 py-3 border-b border-border">
                      <span className="text-base font-semibold text-text-primary">애널리스트 컨센서스 추정치</span>
                    </div>
                    <div className="overflow-x-auto p-4">
                      <table className="text-sm w-max min-w-full">
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
          <Tabs
            fill={false} size="md" className="w-fit"
            ariaLabel="뉴스·공시 선택"
            tabs={[
              { id: "news", label: "뉴스", icon: Newspaper },
              { id: "disclosure", label: "공시", icon: FileText },
            ]}
            active={newsSubTab}
            onChange={(id) => setNewsSubTab(id as any)}
          />

          {/* ── 뉴스 서브탭 ── */}
          {newsSubTab==="news" && (
            <>
          {/* 종목 뉴스 */}
          <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-base font-semibold text-text-primary">관련 뉴스</span>
              <div className="flex gap-1">
                {(["latest","popular"] as const).map(s=>(
                  <button key={s}
                    onClick={()=>setNewsSort(s)}
                    className={`px-2 py-0.5 text-xs rounded font-semibold transition-all ${newsSort===s?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}>
                    {s==="latest"?"최신순":"인기순"}
                  </button>
                ))}
              </div>
            </div>
            {loadingNews ? (
              <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/></div>
            ) : (stockNews?.length ?? 0) > 0 ? (() => {
              // 정렬은 서버가 처리한다 (인기도 산식을 노출하지 않기 위해)
              const sorted = stockNews ?? [];
              return (
                <>
                  <ul>
                    {sorted.map((item: any, i: number) => (
                      <li key={i} className="border-b border-border/30 last:border-0">
                        <a href={safeExternalUrl(item.link)} target="_blank" rel="noopener noreferrer nofollow"
                          className="flex items-start gap-3 px-4 py-3 hover:bg-bg-hover transition-colors group">
                          {safeExternalUrl(item.image) ? (
                            <img
                              src={safeExternalUrl(item.image)}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              width={80}
                              height={80}
                              referrerPolicy="no-referrer"
                              className="w-20 h-20 rounded-lg object-cover flex-shrink-0 bg-bg-elevated"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <div className="w-20 h-20 rounded-lg flex-shrink-0 bg-bg-elevated flex items-center justify-center">
                              <Newspaper size={20} className="text-text-muted" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-base text-text-primary group-hover:text-accent-blue transition-colors line-clamp-2">{item.title}</p>
                            <div className="flex items-center gap-2 mt-1">
                              {item.source && <span className="text-xs text-accent-blue/70 font-medium">{item.source}</span>}
                              {item.published && (
                                <span className="text-xs text-text-muted">
                                  {typeof item.published === "number"
                                    ? new Date(item.published*1000).toLocaleDateString("ko-KR")
                                    : fmtNewsDateTime(item.published)}
                                </span>
                              )}
                            </div>
                            {item.summary && <p className="text-sm text-text-muted mt-1 line-clamp-2">{item.summary}</p>}
                          </div>
                          <ExternalLink size={12} className="text-text-muted flex-shrink-0 mt-1"/>
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              );
            })() : (
              <p className="py-8 text-center text-text-muted text-base">뉴스 데이터가 없습니다</p>
            )}
          </div>
          {/* 실적발표 */}
          {earningsData && (earningsData.upcoming?.length > 0 || earningsData.history?.length > 0) && (
            <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <span className="text-base font-semibold text-text-primary">실적발표</span>
                <DollarSign size={14} className="text-text-muted"/>
              </div>
              <div className="p-4 flex flex-col gap-4">
                {/* 예정 실적 */}
                {earningsData.upcoming?.length > 0 && (
                  <div>
                    <SectionTitle>예정 발표일</SectionTitle>
                    <div className="flex flex-wrap gap-2">
                      {earningsData.upcoming.filter(Boolean).map((dt: string, i: number) => (
                        <span key={i} className="px-3 py-1.5 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-accent-blue text-sm font-mono font-semibold">
                          {dt}
                        </span>
                      ))}
                      {earningsData.eps_estimate != null && (
                        <span className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-text-muted text-sm">
                          EPS 예상: {isKR ? earningsData.eps_estimate?.toLocaleString("ko-KR") : `$${earningsData.eps_estimate?.toFixed(2)}`}
                        </span>
                      )}
                      {/* 매출 예상도 같이 온다. EPS 만 쓰고 버리고 있었다 */}
                      {earningsData.revenue_estimate != null && (
                        <span className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-text-muted text-sm">
                          매출 예상: {fmt(earningsData.revenue_estimate)}
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
                      <table className="w-full text-sm">
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
                  <p className="text-text-muted text-base">공시 데이터는 국내 주식(KR)만 지원합니다</p>
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
              <span className="text-base font-semibold text-text-primary">일별 시세</span>
              {fetchingDaily && <div className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/>}
            </div>
            {dailyOhlcv?.length ? (
              <span className="text-sm text-text-muted">{(dailyOhlcv as any[]).length}일</span>
            ) : null}
          </div>
          {!dailyOhlcv?.length ? (
            <div className="py-12 text-center text-text-muted text-base">{fetchingDaily ? "불러오는 중" : "데이터 없음"}</div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
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
                    const amount = bar.amount > 0 ? bar.amount : bar.close * (bar.volume || 0);
                    return (
                      <tr key={bar.date} className="border-b border-border/30 hover:bg-bg-hover">
                        <td className="px-4 py-2.5 font-mono text-text-muted whitespace-nowrap sticky left-0 bg-bg-card">{bar.date?.replace(/^(\d{4})(\d{2})(\d{2})/, "$1-$2-$3").slice(0,10)}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-semibold text-text-primary whitespace-nowrap">
                          {isKR ? `₩${bar.close?.toLocaleString("ko-KR", {maximumFractionDigits:0})}` : `$${bar.close?.toFixed(2)}`}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono whitespace-nowrap ${prevClose ? (isPos ? upColor : downColor) : "text-text-muted"}`}>
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
            {dailyMonths <= 6 && (
              <button
                onClick={() => setDailyMonths(prev => prev + 1)}
                disabled={fetchingDaily}
                className="w-full py-3 text-sm font-semibold text-text-muted hover:text-accent-blue hover:bg-bg-elevated transition-all border-t border-border"
              >
                {fetchingDaily ? "불러오는 중" : `더보기 (+1개월) ▼`}
              </button>
            )}
            </>
          )}
        </div>
      )}

      {/* 수급 탭 — 서비스 준비중 */}
      {/* 수급 탭 — 백엔드(stocks.py 의 supply-demand)는 진작 있었는데
          프론트에서 부르는 코드가 없어 "서비스 준비중" 안내판만 떠 있었다 */}
      {mainTab==="supply" && isKR && (
        <SupplyDemandTab symbol={sym} isMobile={isMobile} />
      )}

      {/* 보유비중 탭 — ETF 전용 */}
      {mainTab==="holdings" && isETF && (
        <EtfHoldingsTab symbol={sym} market={m} />
      )}

      {/* 커뮤니티 탭 */}
      {mainTab==="community" && (
        <CommunityTab market={m} symbol={sym} />
      )}

      {/* 담기 모달 — 관심종목 화면이 쓰는 것을 그대로 쓴다.
          계좌 목록 조회·현재가 자동입력·저장·캐시 무효화를 모달이 다 한다 */}
      {담기열림 && (
        <AddToPortfolioModal
          item={{ symbol: sym, market: m, name: d?.name ?? sym }}
          currentPrice={d?.price}
          onClose={() => set담기열림(false)}
        />
      )}

      {/* 기업 정보 */}
      {d && (d.industry || d.description) && (
        <div className="rounded-xl p-4 border border-border bg-bg-card">
          {d.sector && <div className="flex flex-col gap-0.5 mb-3"><span className="text-xs text-text-muted">섹터 · 산업</span><span className="text-base text-text-primary">{d.sector}{d.industry?` > ${d.industry}`:""}</span></div>}
          {d.description && <p className="text-sm text-text-muted leading-relaxed line-clamp-4">{d.description}</p>}
        </div>
      )}
    </div>
  );
}

/* ── ETF 보유비중 탭 ──────────────────────────────────────── */
const SECTOR_KO: Record<string, string> = {
  technology: "기술",
  financial_services: "금융",
  healthcare: "헬스케어",
  consumer_cyclical: "소비재(경기)",
  communication_services: "통신서비스",
  industrials: "산업재",
  consumer_defensive: "소비재(필수)",
  energy: "에너지",
  basic_materials: "소재",
  real_estate: "부동산",
  utilities: "유틸리티",
};

function EtfHoldingsTab({ symbol, market }: { symbol: string; market: Market }) {
  const navigate = useNavigate();
  /* 구성종목이 어느 시장인지는 응답에 없다. ETF 가 국내면 구성종목도 국내다
     — 해외 ETF 의 구성종목은 미국 주식으로 본다 */
  const 종목으로 = (s: string) =>
    navigate(`/stocks/${market === "KR" ? "KR" : "US"}/${encodeURIComponent(s)}`);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["etf_holdings", symbol],
    queryFn: () => stocksApi.getEtfHoldings(symbol),
    staleTime: 3_600_000,
    retry: 1,
  });

  if (isLoading) return (
    <div className="rounded-xl border border-border bg-bg-card p-8 text-center text-text-muted text-base">
      보유비중 불러오는 중
    </div>
  );

  if (isError) return (
    <div className="rounded-xl border border-border bg-bg-card flex flex-col items-center justify-center py-20 gap-4">
      <BarChart2 size={40} className="text-text-muted/30" />
      <p className="text-text-muted text-base">보유비중 데이터를 불러올 수 없습니다</p>
    </div>
  );

  const holdings = data?.holdings ?? [];
  const sectors = data?.sector_weights ?? [];

  const isKrEtf = symbol.replace("-","").match(/^\d+$/);
  if (!holdings.length && !sectors.length) return (
    <div className="rounded-xl border border-border bg-bg-card flex flex-col items-center justify-center py-20 gap-4">
      <BarChart2 size={40} className="text-text-muted/30" />
      <div className="text-center px-6">
        <p className="text-text-muted text-base">보유비중 데이터가 없습니다</p>
        <p className="text-2xs text-text-dim mt-2">
          {isKrEtf
            ? "국내 ETF 구성종목은 한국거래소에서 가져옵니다"
            : "이 종목은 구성종목이 공개되지 않습니다"}
        </p>
        {/* 왜 비었는지 서버가 알려 주면 보여 준다.
            단 서버가 주는 것은 사람이 읽는 한 문장이다 — 예외 이름이나
            스택 같은 내부 사정은 로그에만 남긴다. 화면에 그대로 뿌리면
            쓰는 사람에게는 뜻이 없고, 서버 안쪽 구조만 드러난다. */}
        {(data as any)?.reason && (
          <p className="text-2xs text-text-dim/70 mt-1">{(data as any).reason}</p>
        )}
      </div>
    </div>
  );

  const maxPct = holdings.length ? Math.max(...holdings.map(h => h.pct ?? 0)) || 1 : 1;

  return (
    <div className="flex flex-col gap-4">
      {/* 상위 보유종목 */}
      {holdings.length > 0 && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-base font-semibold text-text-primary">상위 보유종목</span>
            <span className="text-xs text-text-muted">{holdings.length}종목</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-muted border-b border-border bg-bg-secondary">
                  <th className="text-left px-4 py-2.5 font-medium w-8">#</th>
                  <th className="text-left px-2 py-2.5 font-medium">종목</th>
                  <th className="text-right px-4 py-2.5 font-medium w-24">비중</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h, i) => (
                  /* 심볼을 갖고 있으면서 글자로만 찍고 있었다. 앱의 다른
                     목록(관심종목·퀀트·대시보드 랭킹)은 전부 행을 눌러
                     그 종목으로 넘어간다 — 여기만 막다른 길이었다.
                     심볼이 없는 항목(현금·기타)은 그대로 둔다 */
                  <tr key={i}
                      onClick={h.symbol ? () => 종목으로(h.symbol) : undefined}
                      className={`border-b border-border/30 transition-colors ${
                        h.symbol ? "cursor-pointer hover:bg-bg-hover" : ""}`}>
                    <td className="px-4 py-2.5 text-text-muted font-mono text-xs">{i + 1}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-text-primary font-medium truncate max-w-[180px] sm:max-w-none">{h.name || h.symbol}</span>
                        {h.symbol && h.name && (
                          <span className="text-xs text-text-muted font-mono">{h.symbol}</span>
                        )}
                        <div className="mt-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden w-full max-w-[200px]">
                          <div
                            className="h-full bg-accent-blue rounded-full transition-all"
                            style={{ width: `${Math.min(((h.pct ?? 0) / maxPct) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-accent-blue whitespace-nowrap">
                      {(h.pct ?? 0).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 섹터 비중 */}
      {sectors.length > 0 && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-base font-semibold text-text-primary">섹터 비중</span>
          </div>
          <div className="p-4 flex flex-col gap-2.5">
            {sectors.map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm text-text-muted w-28 flex-shrink-0 truncate">
                  {SECTOR_KO[s.sector] ?? s.sector}
                </span>
                <div className="flex-1 h-2 bg-bg-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-purple rounded-full transition-all"
                    style={{ width: `${Math.min(s.pct, 100)}%` }}
                  />
                </div>
                <span className="text-sm font-mono font-semibold text-accent-purple w-14 text-right flex-shrink-0">
                  {s.pct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
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
  if (isLoading) return <div className="rounded-xl border border-border bg-bg-card p-8 text-center text-text-muted text-base">공시 불러오는 중</div>;
  const items = Array.isArray(data) ? data : [];
  return (
    <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-base font-semibold text-text-primary">최근 공시</span>
        <FileText size={14} className="text-text-muted"/>
      </div>
      {!items.length ? (
        <p className="py-8 text-center text-text-muted text-base">공시 데이터가 없습니다 (OpenDART API 키 필요)</p>
      ) : (
        <ul>{items.map((item: any, i: number) => (
          <li key={i} className="border-b border-border/30 last:border-0">
            {/* 같은 파일의 뉴스 링크는 safeExternalUrl 을 거치는데 여기만
                안 거치고 있었다. 지금은 서버가 dart.fss.or.kr 로 스킴을
                하드코딩해 만들므로 악용할 수 없지만, 한 화면에서 규칙이
                갈리면 다음에 고치는 사람이 어느 쪽을 따라야 할지 모른다. */}
            <a href={safeExternalUrl(item.url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors group">
              <div className="flex-1 min-w-0">
                <p className="text-base text-text-primary group-hover:text-accent-blue transition-colors">{item.title}</p>
                <p className="text-xs text-text-muted mt-0.5">{item.reporter} · {fmtDate(item.date?.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"))}</p>
              </div>
              <FileText size={13} className="text-text-muted flex-shrink-0"/>
            </a>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
