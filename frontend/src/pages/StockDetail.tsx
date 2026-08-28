import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo , lazy, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import api from "@/api/client";
import { stocksApi, watchlistApi, watchlistFolderApi, financialsApi, portfolioApi, type QuantWeights, type QuantEnabledMetrics } from "@/api/stocks";
import { useQuantSettings, QUANT_DEFAULT_WEIGHTS } from "@/hooks/useQuantSettings";
import { marketSession, SESSION_LABEL } from "@/hooks/useLivePrices";
import QuantSettingsPanel from "@/components/quant/QuantSettingsPanel";
import { Card } from "@/components/ui";
import {
  ArrowLeft, Star, TrendingUp, TrendingDown, BarChart2, DollarSign,
  RefreshCw, CandlestickChart, LineChart, AreaChart,
  Newspaper, Users, Maximize2, X, List, MessageSquare,
  Gauge, Settings2, HelpCircle, Wallet, Share2, Check,
} from "lucide-react";
import type { Market, OHLCV } from "@/types";
import StockChart, { CANDLE_GROUPS, CANDLE_MAX_PERIOD, type ChartType } from "@/components/chart/StockChart";
import { fmtKRW, fmtUSD, fmtVolume } from "@/utils/formatters";
import { isETFStock } from "@/utils/etf";
import { addRecentlyViewed } from "@/utils/recentlyViewed";
import { GRADE_BANDS, gradeColor, scoreColor } from "@/utils/quant";
import CommunityTab from "@/components/community/CommunityTab";
import SupplyDemandTab from "@/components/stock/SupplyDemandTab";
import RangeBar from "@/components/stock/RangeBar";
import AlertButton from "@/components/stock/AlertButton";
import { EtfHoldingsTab } from "@/components/stock/EtfHoldingsTab";
import DailyTab from "@/components/stock/DailyTab";
import NewsTab from "@/components/stock/NewsTab";
import { AddToPortfolioModal } from "@/components/watchlist/WatchlistModals";

/* 재무제표·투자의견 탭은 필요할 때 받는다.
   둘이 1,111줄이라 종목상세 묶음의 절반 가까이였는데, 차트만 보고
   나가는 사람도 늘 함께 받았다. 훅이 없는 순수 렌더라 늦게 와도
   그리는 순서가 흐트러지지 않는다. */
const 재무제표탭 = lazy(() => import("@/components/stock/FinancialTab"));
const 투자의견탭 = lazy(() => import("@/components/stock/AnalystTab"));

import { SectionTitle } from "@/components/stock/DetailBits";

import { FIN_CUSTOM_KEY } from "@/constants/finMetrics";

const 유효 = (v: unknown): number | null =>
  typeof v === "number" && v !== 0 && Number.isFinite(v) ? v : null;

/* ── 메인 ───────────────────────────────────────────── */
/* 탭을 받아오는 잠깐. 카드 자리를 미리 잡아 둬야 표가 뜰 때 화면이
   밀리지 않는다 */
function 탭기다리기() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-bg-card border border-border rounded-xl p-4 animate-pulse flex flex-col gap-3">
          <div className="h-3 w-28 rounded bg-bg-elevated" />
          <div className="h-24 rounded bg-bg-elevated" />
        </div>
      ))}
    </div>
  );
}

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
  const 기본지표가_비었나 = !!detail && (유효(detail.eps) == null || 유효(detail.per) == null);
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
    (유효(fundamentalsData.eps) == null || 유효(fundamentalsData.per) == null);

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
      name: detail?.name ?? sym,
      watchlist_id: 1,
      folder_id: folderId ?? null,
    }),
    /* 별을 누른 즉시 채운다. 예전에는 서버가 답할 때까지 빈 별이라
       안 눌린 줄 알고 한 번 더 눌렀다 — 그러면 같은 종목이 두 줄 된다 */
    onMutate: () => { setInWatchlist(true); setWatchlistMsg("관심종목에 추가됐어요"); },
    onSuccess: (data: any) => {
      setWatchlistItemId(data?.id ?? null);
      qc.invalidateQueries({ queryKey: ["watchlist-items"] });
      qc.invalidateQueries({ queryKey: ["watchlist-items-check"] });
      setTimeout(() => setWatchlistMsg(""), 2000);
    },
    onError: (err: any) => {
      /* 낙관적으로 채워 둔 별을 되돌린다. 채운 채로 두면 관심종목
         화면에 없는 종목을 '담겨 있다' 고 말하게 된다.
         (아래 '이미 추가된 종목' 갈래에서는 다시 채운다 — 그때는
          정말 담겨 있는 것이 맞다) */
      setInWatchlist(false);
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
    onMutate: () => { setInWatchlist(false); setWatchlistMsg("관심종목에서 제거됐어요"); },
    onSuccess: () => {
      setWatchlistItemId(null);
      qc.invalidateQueries({ queryKey: ["watchlist-items"] });
      qc.invalidateQueries({ queryKey: ["watchlist-items-check"] });
      setTimeout(() => setWatchlistMsg(""), 2000);
    },
    onError: () => {
      setInWatchlist(true);                     // 되돌린다
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
    const fcst = (forecasts?.annual ?? []).filter((r) => r.type === "forecast");

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
    /* 화면 이름 → 서버가 주는 이름.
       서버(stocks.py get_forecasts)가 실제로 넣는 추정치는 셋뿐이다 —
       eps_est · revenue_est · growth_est.

       op_income_est · net_income_est 는 서버 어디에도 없다. 즉 컨센서스
       표의 영업이익·순이익 예상 칸은 처음부터 늘 '—' 였다. any 로 두고
       있어서 아무도 몰랐고, 타입을 붙이고 나서야 드러났다.

       줄을 지우지는 않는다 — 서버가 그 값을 넣기 시작하면 이 매핑이
       그대로 살아난다. 없는 이유를 여기 적어 두는 편이, 다음 사람이
       "왜 비지?" 하고 화면부터 뒤지는 것보다 낫다. */
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
           없으면 null 이라 표에 '—' 로 빠진다.

           키가 실행 중에 정해지므로 인덱스 서명이 필요하다. 전망행 에
           [k: string] 을 열어 두면 오타를 다시 못 잡으니, 여기서만
           Record 로 본다 — 어떤 이름이 실제로 오는지는 전망행 이 지킨다 */
        return (row as unknown as Record<string, number | null | undefined>)[예측키[key] ?? key] ?? null;
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
            <button aria-label="뒤로 가기" onClick={()=>navigate(-1)} className="mt-0.5 -ml-2 w-11 h-11 flex items-center justify-center rounded-lg hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"><ArrowLeft size={16}/></button>
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

              {/* 가격 알림 — 이 화면을 다시 열지 않아도 값이 오면 알려 준다.
                  관심종목은 '보고 싶다', 알림은 '이 값이 되면 알려 달라'로
                  하는 일이 다르다. */}
              <AlertButton
                market={m} symbol={sym} name={d?.name}
                price={d?.price} isLoggedIn={isLoggedIn}
              />

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
              <div className="absolute top-full mt-1 right-0 z-20 w-44 rounded-xl border border-border bg-bg-card shadow-float overflow-hidden">
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
                      className={`px-2.5 py-1 text-sm rounded-lg font-semibold transition-all ${isActive ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"}`}
                    >
                      {isActive ? (currentOpt?.label ?? group.label) : group.label}
                    </button>
                    {openGroup === group.key && (
                      <div className="absolute top-full left-0 mt-1 z-50 flex flex-col gap-0.5 p-1 rounded-lg border border-border bg-bg-card shadow-float min-w-[64px]">
                        {group.options.map(opt => (
                          <button key={opt.value}
                            onClick={() => { onCandleChange(opt.value); setOpenGroup(null); }}
                            className={`px-3 py-1.5 text-sm rounded-lg font-semibold whitespace-nowrap transition-all ${candleType === opt.value ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"}`}
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
                  className={`flex items-center gap-1 px-2.5 py-1 text-sm rounded-lg font-semibold transition-all ${chartType===value?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}
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
              <button onClick={()=>refetchChart()} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-blue text-white text-sm rounded-lg"><RefreshCw size={13}/>재시도</button>
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
                        className={`px-2.5 py-1 text-sm rounded-lg font-semibold transition-all ${isActive ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"}`}
                      >
                        {isActive ? (currentOpt?.label ?? group.label) : group.label}
                      </button>
                      {openGroup === group.key && (
                        <div className="absolute top-full left-0 mt-1 z-50 flex flex-col gap-0.5 p-1 rounded-lg border border-border bg-bg-card shadow-float min-w-[64px]">
                          {group.options.map(opt => (
                            <button key={opt.value}
                              onClick={() => { onCandleChange(opt.value); setOpenGroup(null); }}
                              className={`px-3 py-1.5 text-sm rounded-lg font-semibold whitespace-nowrap transition-all ${candleType === opt.value ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"}`}
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
                    className={`px-2.5 py-1 text-sm rounded-lg font-semibold transition-all ${chartType===value?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}
                  >{label}</button>
                ))}
              </div>
              <button aria-pressed={logScale} onClick={()=>setLogScale(v=>!v)}
                className={`px-2.5 py-1 text-sm rounded-lg border font-semibold transition-all ${logScale?"bg-accent-blue/20 border-accent-blue/50 text-accent-blue":"border-border text-text-muted"}`}
              >LOG</button>
            </div>
            <button aria-label="전체화면 끄기" onClick={()=>setFullscreen(false)} className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
              <X size={16}/>
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
      {mainTab==="financial" && (
        <Suspense fallback={<탭기다리기 />}>
        <재무제표탭
          customMetricKeys={customMetricKeys}
          d={d}
          exchangeRate={exchangeRate}
          finPeriod={finPeriod}
          finSubTab={finSubTab}
          finTabData={finTabData}
          financials={financials}
          isKR={isKR}
          isMobile={isMobile}
          loadingFin={loadingFin}
          selectedMetric={selectedMetric}
          setFinPeriod={setFinPeriod}
          setSelectedMetric={setSelectedMetric}
          setShowCustomSelector={setShowCustomSelector}
          setShowKRW={setShowKRW}
          showCustomSelector={showCustomSelector}
          showKRW={showKRW}
          updateCustomMetricKeys={updateCustomMetricKeys}
        />
        </Suspense>
      )}

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
                      <div className="absolute left-0 top-7 z-20 w-56 rounded-xl border border-border bg-bg-elevated shadow-float p-3 flex flex-col gap-1.5">
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
      {mainTab==="analyst" && (
        <Suspense fallback={<탭기다리기 />}>
        <투자의견탭
          analystData={analystData}
          analystSubTab={analystSubTab}
          consensusPeriod={consensusPeriod}
          exchangeRate={exchangeRate}
          forecasts={forecasts}
          isKR={isKR}
          isMobile={isMobile}
          loadingAnalyst={loadingAnalyst}
          setAnalystSubTab={setAnalystSubTab}
          setConsensusPeriod={setConsensusPeriod}
          setShowKRW={setShowKRW}
          showKRW={showKRW}
        />
        </Suspense>
      )}

      {/* 뉴스/공시 탭 */}
      {mainTab==="news" && (
        <NewsTab
          symbol={sym} isKR={isKR}
          뉴스={stockNews} 불러오는중={loadingNews}
          정렬={newsSort} set정렬={setNewsSort}
          서브탭={newsSubTab} set서브탭={(v) => setNewsSubTab(v as "news" | "disclosure")}
          실적={earningsData} fmt={fmt}
        />
      )}

      {/* 일별 탭 */}
      {mainTab==="daily" && (
        <DailyTab
          rows={(dailyOhlcv ?? []) as OHLCV[]}
          불러오는중={fetchingDaily}
          개월수={dailyMonths} set개월수={setDailyMonths}
          isKR={isKR} 상승색={upColor} 하락색={downColor}
        />
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
