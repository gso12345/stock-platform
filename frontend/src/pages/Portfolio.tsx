import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { stocksApi, portfolioApi, watchlistApi } from "@/api/stocks";
import { useLivePrices } from "@/hooks/useLivePrices";
import LiveBadge from "@/components/ui/LiveBadge";
import { Card, RowSkeleton, Tabs, UnderlineTabs, ChangeBadge, 못불러옴} from "@/components/ui";
import { ASSET_PAGE_TABS } from "@/constants/tabs";
import { Plus, Wallet, LogIn, ChevronUp, ChevronDown, ChevronsUpDown, LayoutGrid, Table2, DollarSign, Landmark, Receipt, TrendingUp, TrendingDown, Percent, Settings2, RefreshCw, Eye, EyeOff, PieChart as PieIcon, Grid2x2 } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import 차트틀 from "@/components/chart/ChartFrame";
import { useSettingsStore } from "@/store/settingsStore";
import { usePnlColors } from "@/hooks/usePnlColors";
import { use배당달력 } from "@/hooks/useDividendCalendar";
import { 내몫으로, 배당키 } from "@/components/portfolio/DividendCalendar";
import { use돈 } from "@/hooks/useMoney";
import { mergeEffectivePrices, indexPricesBySymbol, lookupPrice } from "@/utils/prices";
import { extractErrorMessage } from "@/utils/errors";
import { withNativeValues, 오늘변화원화, 전일대비주당 } from "@/utils/holdings";
import { useExchangeRate, useExchangeRateChange } from "@/hooks/useExchangeRate";
import { type AssetClass, resolveAssetClass } from "@/utils/assetClass";
import type { Market, ChartMode, PortfolioItem, SelectedPortfolio, PortfolioMeta, EnrichedItem } from "@/types/portfolio";
import AssetHistory from "@/components/portfolio/AssetHistory";
import DividendCalendar, { type 보유몫 } from "@/components/portfolio/DividendCalendar";
import 자산지도, { type 지도칸 } from "@/components/portfolio/AssetTreemap";
import 수익기여 from "@/components/portfolio/ProfitContribution";
import 보유뉴스 from "@/components/portfolio/HoldingNews";
import { use미리보기흐름, use미리보기배당, use미리보기뉴스 } from "@/hooks/usePortfolioPreview";
import {
  PortfolioModal, ConfirmDeleteModal, PortfolioPill,
  PortfolioFilterDropdown, AddPortfolioButton, PortfolioManagerModal,
} from "@/components/portfolio/PortfolioModals";
import { SortHead, HoldingCard, HoldingTableRow, type SortField, type 배당몫 } from "@/components/portfolio/HoldingRow";


/* ── Constants ─────────────────────────────────────────── */
const PIE_COLORS  = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4","#f97316","#84cc16","#ec4899","#14b8a6","#6366f1"];

/* ── 미리보기 예시 데이터 (비로그인 시 표시) ────────────────── */
type PreviewEnrichedBase = Omit<EnrichedItem, "isForexItem" | "nativeAvgPrice" | "nativeValue" | "nativePnl">;

/* 자산유형 탭이 일곱 개인데 예시에는 주식뿐이라, 로그인 전에는 '금'이나
   '채권'을 눌러도 빈 화면만 나왔다. 유형별 합계·구성 차트가 무엇을 하는
   기능인지 보려면 예시 자체에 그 유형들이 있어야 한다.
   (유형은 @/utils/assetClass 가 종목명·코드로 알아서 분류한다 —
    GLD→금, TLT→채권, JEPI→커버드콜) */
const PREVIEW_ENRICHED: PreviewEnrichedBase[] = [
  { id: -1, symbol: "005930", market: "KR", name: "삼성전자",   shares: 50,  avgPrice: 100000, currency: "KRW",
    currentPriceNative: 72400,  currentValueKRW: 3_620_000,  costKRW: 5_000_000,  pnlKRW: -1_380_000, pnlRate: -27.60, weight: 0 },
  { id: -2, symbol: "NVDA",   market: "US", name: "엔비디아",   shares: 50,  avgPrice: 110,   currency: "USD", inputExchangeRate: 1320,
    currentPriceNative: 875,    currentValueKRW: 57_750_000, costKRW: 7_260_000,  pnlKRW: 50_490_000, pnlRate: 695.45, weight: 0 },
  { id: -3, symbol: "AAPL",   market: "US", name: "애플",       shares: 30,  avgPrice: 172,   currency: "USD", inputExchangeRate: 1310,
    currentPriceNative: 195,    currentValueKRW: 7_663_500,  costKRW: 6_759_600,  pnlKRW:  903_900, pnlRate: 13.37, weight: 0 },
  { id: -4, symbol: "000660", market: "KR", name: "SK하이닉스", shares: 10,  avgPrice: 300000, currency: "KRW",
    currentPriceNative: 185000, currentValueKRW: 1_850_000,  costKRW: 3_000_000,  pnlKRW: -1_150_000, pnlRate: -38.33, weight: 0 },
  { id: -5, symbol: "SPY",    market: "ETF", name: "SPDR S&P500 ETF", shares: 10, avgPrice: 420, currency: "USD", inputExchangeRate: 1300,
    currentPriceNative: 535,    currentValueKRW: 6_955_000,  costKRW: 5_460_000,  pnlKRW: 1_495_000, pnlRate: 27.38, weight: 0 },
  { id: -6, symbol: "GLD",    market: "ETF", name: "SPDR 골드 ETF", shares: 15, avgPrice: 185, currency: "USD", inputExchangeRate: 1310,
    currentPriceNative: 244,    currentValueKRW: 4_941_000,  costKRW: 3_635_250,  pnlKRW: 1_305_750, pnlRate: 35.92, weight: 0 },
  { id: -7, symbol: "TLT",    market: "ETF", name: "미국 장기국채 ETF", shares: 20, avgPrice: 95, currency: "USD", inputExchangeRate: 1330,
    currentPriceNative: 88,     currentValueKRW: 2_376_000,  costKRW: 2_527_000,  pnlKRW: -151_000, pnlRate: -5.98, weight: 0 },
  { id: -8, symbol: "JEPI",   market: "ETF", name: "JPM 커버드콜 ETF", shares: 40, avgPrice: 55, currency: "USD", inputExchangeRate: 1320,
    currentPriceNative: 58,     currentValueKRW: 3_132_000,  costKRW: 2_904_000,  pnlKRW: 228_000, pnlRate: 7.85, weight: 0 },
  /* 현금은 시세가 없다. 평가금액 = 매입금액이라 손익이 늘 0이고,
     그래서 '현금 비중'을 눈으로 확인할 수 있다 */
  { id: -9, symbol: "현금", market: "KR", name: "원화 현금", shares: 1, avgPrice: 5_000_000, currency: "KRW",
    assetClass: "현금",
    currentPriceNative: 5_000_000, currentValueKRW: 5_000_000, costKRW: 5_000_000, pnlKRW: 0, pnlRate: 0, weight: 0 },
];

/** 시세를 다 못 받았을 때 다시 물어보는 간격.
 *
 *  서버가 시세를 모으는 데 쓰는 시간에 상한이 있어서(3초), 못 채운
 *  종목은 비워서 온다. 그 사이 서버는 배경에서 마저 받아 캐시에 넣으므로
 *  잠깐 뒤 다시 물어보면 그때는 곧바로 나온다. */
const 재촉주기 = 3_000;
/** 평소 주기. WebSocket 이 상한(50종목) 때문에 못 다루는 종목용 */
const 평소주기 = 120_000;
/** 몇 번까지 재촉할지. 이 뒤로는 평소 주기로 물러난다 */
const 재촉_횟수 = 3;

/* 시세를 물어볼 대상 — 현금은 시세가 없으니 뺀다 */
const PREVIEW_PRICEABLE = PREVIEW_ENRICHED.filter((i) => i.assetClass !== "현금");
/* ── 자산유형 — 분류 규칙은 @/utils/assetClass 에 공용으로 둔다 (관심종목과 동일 기준) ── */
const ASSET_FILTER_TABS: { id: AssetClass | "전체"; label: string }[] = [
  { id: "전체",     label: "전체" },
  { id: "국내주식", label: "국내주식" },
  { id: "해외주식", label: "해외주식" },
  { id: "채권",     label: "채권" },
  { id: "금",       label: "금" },
  { id: "커버드콜", label: "커버드콜" },
  { id: "현금",     label: "현금" },
];

/* ── 내 자산 안 탭 ────────────────────────────────────────
 *
 * 예전에는 전부 세로로 쌓여 있었다 — 요약 → 자산 흐름 그래프 → 배당
 * 달력 → 구성 차트 → 자산유형 필터 → 그제서야 보유 종목. 휴대폰에서
 * **내 종목을 보려면 화면을 네다섯 번 넘겨야** 했다. 정작 이 화면을
 * 여는 가장 흔한 이유가 그 목록인데.
 *
 * 눈에 안 보이는 값도 컸다. 자산 흐름과 배당 달력이 화면이 뜨자마자
 * /portfolio/history 와 /portfolio/dividends 를 부른다. 즉 **보유
 * 종목이 보이기 전에 요청 두 개를 더 기다리는** 구조였다 —
 * Render 무료 등급은 0.15 CPU 다.
 *
 * 탭으로 나누면 둘 다 풀린다. 안 연 탭은 mount 되지 않으므로 그 탭의
 * 요청도 안 나간다. recharts(gzip 132KB)도 '비중' 을 열 때만 받는다.
 *
 * 총 평가금액은 탭 위에 남긴다 — 어느 탭에 있든 '지금 얼마인가' 는
 * 늘 보여야 한다. 참고한 자산 앱들도 그 배치다.
 */
type 자산탭 = "자산" | "추이" | "배당" | "비중" | "뉴스";

/** 화면 안 탭 다섯.
 *
 *  한때 추이·배당·뉴스는 로그인해야만 보였다. 기록도 배당도 '내 것' 이
 *  있어야 나오는 값이라, 안 그러면 늘 "아직 없어요" 만 보였기 때문이다.
 *
 *  그런데 그러면 **이 화면이 무엇을 할 수 있는지**가 가입 전에는 안
 *  보인다 — 자산 흐름 그래프도, 배당 달력도, 종목 뉴스도 이 앱을 쓸
 *  이유 그 자체인데 존재조차 모르게 된다.
 *
 *  그래서 다섯 탭을 다 열고, 로그인 전에는 예시로 채운다. 예시는
 *  서버를 안 부르고(constants/portfolioPreview) 탭마다 '예시' 라고
 *  적는다. */
const 모든탭: 자산탭[] = ["자산", "추이", "배당", "비중", "뉴스"];


/* ── Main Page ──────────────────────────────────────────── */
export default function Portfolio() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modalOpen,       setModalOpen]       = useState(false);
  const [editItem,        setEditItem]        = useState<PortfolioItem | undefined>(undefined);
  const [deleteTarget,    setDeleteTarget]    = useState<PortfolioItem | null>(null);
  const [chartMode,       setChartMode]       = useState<ChartMode>("stock");
  const [modalError,      setModalError]      = useState<string | null>(null);
  const [viewMode,        setViewMode]        = useState<"table" | "card">(
    () => (typeof window !== "undefined" && window.innerWidth < 640) ? "card" : "table"
  );
  const [currencyMode,    setCurrencyMode]    = useState<"krw" | "native">("krw"); // 해외종목 원화/외화 표시 모드
  const [assetFilterTab,  setAssetFilterTab]  = useState<AssetClass | "전체">("전체");
  const [속탭,            set속탭]            = useState<자산탭>("자산");
  /* 파이 ↔ 지도. 종목이 열 개를 넘으면 파이는 조각이 얇아져 못 읽는다 */
  const [구성모양,        set구성모양]        = useState<"파이" | "지도">("파이");

  const { isLoggedIn } = useAuthStore();
  const { colorScheme, 화면모양, 금액가리기, 토글금액가리기 } = useSettingsStore();
  const 돈 = use돈();

  // 행에 마우스를 올리면 상세 페이지 데이터 선제 prefetch (클릭 시 즉시 표시)
  const prefetchStock = useCallback((item: any) => {
    const mkt = item.market as Market;
    const sym = item.symbol;
    if (queryClient.getQueryData(["stock-detail", mkt, sym])) return;
    queryClient.prefetchQuery({ queryKey: ["stock-detail", mkt, sym], queryFn: () => stocksApi.getDetail(mkt, sym), staleTime: 60_000 });
  }, [queryClient]);
  const { pnlColor } = usePnlColors(colorScheme);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir,   setSortDir]   = useState<"asc" | "desc">("desc");

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  /* ── 포트폴리오 목록 ── */
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<SelectedPortfolio | null>(null);
  /* 전체 보기(포트폴리오 모아보기)에서 제외할 포트폴리오 — 비어있으면 전부 포함 */
  const [excludedPortfolioIds, setExcludedPortfolioIds] = useState<Set<number>>(new Set());
  const toggleExcludedPortfolio = (id: number) => {
    setExcludedPortfolioIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const { data: portfolios = [] } = useQuery<PortfolioMeta[]>({
    queryKey: ["portfolios"],
    queryFn:  portfolioApi.getPortfolios,
    enabled:  isLoggedIn,
    // 포트폴리오 메타(이름·개수)는 mutation onSuccess에서 invalidate되므로 5분 캐시
    staleTime: 300_000,
  });

  useEffect(() => {
    if (!isLoggedIn || portfolios.length === 0) return;
    if (selectedPortfolioId == null) { setSelectedPortfolioId("all"); return; }
    if (selectedPortfolioId !== "all" && !portfolios.some((p) => p.id === selectedPortfolioId)) {
      setSelectedPortfolioId("all");
    }
  }, [isLoggedIn, portfolios, selectedPortfolioId]);

  const isAllView = selectedPortfolioId === "all";
  /* count 가 하나라도 비면 합계 전체가 NaN 이 되어 탭에 '전체 (NaN)' 이
     찍힌다. 숫자 하나가 없는 것과 화면에 NaN 이 뜨는 것은 다른 일이다 */
  const totalItemCount = portfolios.reduce((s, p) => s + (p.count ?? 0), 0);

  const createPortfolioMutation = useMutation({
    mutationFn: (name: string) => portfolioApi.createPortfolio(name),
    onSuccess: (pf) => {
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      setSelectedPortfolioId(pf.id);
    },
  });

  const renamePortfolioMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => portfolioApi.renamePortfolio(id, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portfolios"] }),
  });

  const [deletePortfolioTarget, setDeletePortfolioTarget] = useState<PortfolioMeta | null>(null);
  const [showPortfolioManager, setShowPortfolioManager] = useState(false);
  const deletePortfolioMutation = useMutation({
    mutationFn: (id: number) => portfolioApi.deletePortfolio(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      if (selectedPortfolioId === id) setSelectedPortfolioId(null);
      setDeletePortfolioTarget(null);
    },
  });
  const handleConfirmDeletePortfolio = () => {
    if (deletePortfolioTarget) deletePortfolioMutation.mutate(deletePortfolioTarget.id);
  };

  /* ── 포트폴리오 탭 길게 눌러 드래그 정렬 (관심종목 폴더탭과 동일 패턴) ── */
  const [dragPortfolioId,  setDragPortfolioId]  = useState<number | null>(null);
  const [dropPortfolioId,  setDropPortfolioId]  = useState<number | null>(null);
  const [localPortfolioOrder, setLocalPortfolioOrder] = useState<PortfolioMeta[] | null>(null);
  const dragPortfolioIdRef       = useRef<number | null>(null); // onDragOver 즉시 접근용
  const localPortfolioOrderRef   = useRef<PortfolioMeta[] | null>(null);
  const portfolioLongPressTimer  = useRef<number | null>(null);
  const portfolioTouchStartPos   = useRef<{ x: number; y: number } | null>(null);
  const portfolioJustDragged     = useRef(false);

  const reorderPortfoliosMutation = useMutation({
    mutationFn: (order: number[]) => portfolioApi.reorderPortfolios(order),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portfolios"] }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      setLocalPortfolioOrder(null);
    },
  });

  const handlePortfolioDragStart = (pf: PortfolioMeta) => {
    dragPortfolioIdRef.current = pf.id;
    localPortfolioOrderRef.current = portfolios;
    setDragPortfolioId(pf.id);
    setLocalPortfolioOrder(portfolios);
  };

  const movePortfolioTo = (targetId: number) => {
    const fromId = dragPortfolioIdRef.current;
    if (fromId === null || fromId === targetId) return;
    setDropPortfolioId(targetId);
    const base = localPortfolioOrderRef.current ?? portfolios;
    const from = base.findIndex((p) => p.id === fromId);
    const to   = base.findIndex((p) => p.id === targetId);
    if (from === -1 || to === -1) return;
    const next = [...base];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    localPortfolioOrderRef.current = next;
    setLocalPortfolioOrder(next);
  };

  const handlePortfolioDragOver = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    movePortfolioTo(targetId);
  };

  const handlePortfolioDrop = () => {
    const order = localPortfolioOrderRef.current;
    if (dragPortfolioIdRef.current !== null && order) {
      reorderPortfoliosMutation.mutate(order.map((p) => p.id));
    }
    dragPortfolioIdRef.current = null;
    localPortfolioOrderRef.current = null;
    setDragPortfolioId(null); setDropPortfolioId(null); setLocalPortfolioOrder(null);
  };

  const PORTFOLIO_LONG_PRESS_MS = 350;
  const PORTFOLIO_LONG_PRESS_MOVE_TOLERANCE = 8;

  const clearPortfolioLongPressTimer = () => {
    if (portfolioLongPressTimer.current !== null) {
      window.clearTimeout(portfolioLongPressTimer.current);
      portfolioLongPressTimer.current = null;
    }
  };

  const handlePortfolioTouchStart = (pf: PortfolioMeta, e: React.TouchEvent) => {
    const t = e.touches[0];
    portfolioTouchStartPos.current = { x: t.clientX, y: t.clientY };
    clearPortfolioLongPressTimer();
    portfolioLongPressTimer.current = window.setTimeout(() => {
      handlePortfolioDragStart(pf);
    }, PORTFOLIO_LONG_PRESS_MS);
  };

  const handlePortfolioTouchMoveGated = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (dragPortfolioIdRef.current !== null) {
      e.preventDefault();
      const el = (document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null)?.closest("[data-portfolio-id]") as HTMLElement | null;
      if (el) {
        const targetId = Number(el.dataset.portfolioId);
        if (targetId) movePortfolioTo(targetId);
      }
      return;
    }
    const start = portfolioTouchStartPos.current;
    if (start) {
      const dx = Math.abs(t.clientX - start.x);
      const dy = Math.abs(t.clientY - start.y);
      if (dx > PORTFOLIO_LONG_PRESS_MOVE_TOLERANCE || dy > PORTFOLIO_LONG_PRESS_MOVE_TOLERANCE) {
        clearPortfolioLongPressTimer();
      }
    }
  };

  const handlePortfolioTouchEnd = () => {
    clearPortfolioLongPressTimer();
    if (dragPortfolioIdRef.current !== null) {
      portfolioJustDragged.current = true;
      handlePortfolioDrop();
    }
    portfolioTouchStartPos.current = null;
  };

  const handlePortfolioTabClick = (pf: PortfolioMeta) => {
    if (portfolioJustDragged.current) {
      portfolioJustDragged.current = false;
      return;
    }
    setSelectedPortfolioId(pf.id);
  };

  /* ── 서버 데이터 ──
     전체(view_all) 한 번만 불러와서 캐시해두고, 특정 포트폴리오 탭은 그 결과를
     클라이언트에서 필터링만 한다 — 탭마다 매번 새로 불러오면 전환할 때마다
     로딩이 보여서 느리게 느껴지는 문제를 없앤다 */
  const { data: allItems = [], isLoading: itemsLoading, isError: 못받음, error: 실패사유, refetch: 다시받기 } = useQuery<PortfolioItem[]>({
    queryKey: ["portfolio-items-all"],
    queryFn:  () => portfolioApi.getItems(undefined, true),
    enabled:  isLoggedIn,
    // 종목 목록은 mutation onSuccess에서 invalidate되므로 5분 캐시 (가격은 별도 쿼리로 갱신)
    staleTime: 300_000,
  });

  const items = useMemo(() => {
    if (isAllView || selectedPortfolioId == null) return allItems;
    return allItems.filter((i) => i.portfolioId === selectedPortfolioId);
  }, [allItems, isAllView, selectedPortfolioId]);

  const addMutation = useMutation({
    mutationFn: (data: Omit<PortfolioItem, "id">) =>
      portfolioApi.addItem({
        portfolio_id: isAllView ? undefined : (selectedPortfolioId ?? undefined),
        symbol: data.symbol, market: data.market, name: data.name,
        shares: data.shares, avg_price: data.avgPrice, currency: data.currency,
        input_exchange_rate: data.inputExchangeRate ?? null,
        purchase_date: data.purchaseDate ?? null,
        note: data.note ?? null,
        asset_class: data.assetClass ?? null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-items-all"] });
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      setModalError(null);
    },
    onError: (err) => setModalError(extractErrorMessage(err)),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Omit<PortfolioItem, "id"> }) =>
      portfolioApi.updateItem(id, {
        symbol: data.symbol, market: data.market, name: data.name,
        shares: data.shares, avg_price: data.avgPrice, currency: data.currency,
        input_exchange_rate: data.inputExchangeRate ?? null,
        purchase_date: data.purchaseDate ?? null,
        note: data.note ?? null,
        asset_class: data.assetClass ?? null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-items-all"] });
      setModalError(null);
    },
    onError: (err) => setModalError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => portfolioApi.deleteItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-items-all"] });
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      setDeleteTarget(null);
    },
  });

  /* ── 환율 — 공용 훅 (전용 엔드포인트 우선, 실패 시 금리 목록 폴백) ── */
  const exchangeRate = useExchangeRate();
  /* 환율이 오늘 얼마나 움직였나 — 해외 종목의 원화 평가금액은 주가와
     환율 둘이 같이 정한다. 예전에는 주가만 봤다(utils/holdings 주석) */
  const 환율등락 = useExchangeRateChange();

  /* 이 화면은 항상 '내 자산' 쪽이고, '관심종목'은 누르면 다른 페이지로
     넘어간다. 그래서 고를 상태가 따로 없다 */
  const handleTabChange = (tab: string) => {
    if (tab === "watchlist") navigate("/watchlist");
  };

  /* ── 현재가 조회 (배치 1회 요청 — 종목별 개별 요청 대신, 전체 종목 기준으로
     한 번만 캐시해서 탭을 바꿔도 다시 불러오지 않도록 함) ──
     현금 항목은 시세가 없으므로 가격 조회 대상에서 제외 (인덱스 정합성 유지) ── */
  const priceableItems = useMemo(() => allItems.filter((i) => i.assetClass !== "현금"), [allItems]);

  /* ── 실시간 WebSocket 가격 (기존 120초 폴링 대체) ── */
  const [wsPrices, setWsPrices] = useState<any[] | null>(null);
  const priceSymbols = useMemo(() => priceableItems.map((i) => i.symbol), [priceableItems]);
  const priceMarkets = useMemo(() => priceableItems.map((i) => i.market), [priceableItems]);
  /* 연결이 오래 끊기면 받아둔 스냅샷을 버린다. 예전에는 이 초기화가 없어
     끊긴 시점의 가격이 HTTP로 새로 받은 시세를 영원히 덮어썼고,
     평가금액·손익이 통째로 과거 값에 멈춰 있었다 */
  const live = useLivePrices(
    priceSymbols, priceMarkets,
    useCallback((prices: any[]) => setWsPrices(prices), []),
    useCallback(() => setWsPrices(null), []),
  );

  const { data: batchPrices, isLoading: pricesLoading, isError: 시세못받음 } = useQuery({
    queryKey:       ["portfolio-prices", priceableItems.map((i) => `${i.market}:${i.symbol}`).join(",")],
    queryFn:        () => watchlistApi.getPrices(priceableItems.map((i) => i.symbol), priceableItems.map((i) => i.market)),
    enabled:        priceableItems.length > 0,
    staleTime:      120_000,
    /* 두 가지 이유로 다시 물어본다.
     *
     * 1) WebSocket 은 서버 상한 때문에 최대 50종목만 흘려준다. 이 조회가
     *    한 번만 돌면 51번째부터는 첫 값에 고정된다.
     * 2) **아직 시세를 못 받은 종목이 남아 있을 때.**
     *    서버는 시세를 모으는 데 3초까지만 쓰고, 못 채운 종목은 price 를
     *    비운 채 돌려준다 — 화면이 통째로 멈추는 것을 막으려는 것이다.
     *    (상한이 없던 시절 실측 9초였고, 그동안 평가금액도 보유 목록의
     *    합계도 배당 배지도 전부 뼈대였다.)
     *    못 받은 것은 서버가 배경에서 마저 받아 캐시에 넣으므로, 몇 초 뒤
     *    한 번 더 물어보면 그때는 곧바로 나온다. 화면이 멈추는 대신
     *    채워지면서 완성된다.
     *
     * 다 채워지면 평소 주기로 돌아간다 — 계속 두드리면 그 자체가 부담이다. */
    refetchInterval: (q) => {
      const 아직 = (q.state.data ?? []).filter((p: { price?: number | null }) => p?.price == null).length;
      if (아직 === 0) return 평소주기;
      /* 다만 몇 번만 재촉한다. 영영 못 받는 종목이 섞여 있으면
         (상장폐지·오타·야후가 모르는 심볼) 3초마다 영원히 두드리게 된다 —
         그건 서버를 제일 세게 때리는 짓이고, 그런다고 값이 생기지도 않는다. */
      return q.state.dataUpdateCount <= 재촉_횟수 ? 재촉주기 : 평소주기;
    },
    refetchIntervalInBackground: false,
  });

  /* 종목별로 WebSocket 값을 우선하되, WS가 다루지 못한 종목(스트리밍 상한 50개
     초과분·가격 미수신분)은 HTTP 조회값으로 채운다 */
  const effectivePrices = useMemo(
    () => mergeEffectivePrices(wsPrices, batchPrices),
    [wsPrices, batchPrices],
  );

  /* ── 비로그인 미리보기용 실시간 현재가 (예시 보유종목도 실제 시세로 표시) ── */
  const { data: previewBatchPrices } = useQuery({
    queryKey:       ["portfolio-preview-prices"],
    queryFn:        () => watchlistApi.getPrices(PREVIEW_PRICEABLE.map((i) => i.symbol), PREVIEW_PRICEABLE.map((i) => i.market)),
    enabled:        !isLoggedIn,
    staleTime:      120_000,
    refetchInterval:120_000,
  });
  // 실시간 현재가를 아직 못 불러왔으면(=null) 정적 예시가를 절대 보여주지 않음 — 실데이터 도착 후에만 표시
  const previewLoaded = previewBatchPrices != null;

  const previewEnrichedLive = useMemo<EnrichedItem[]>(() => {
    /* 배열 순서가 아니라 종목코드로 짝짓는다. 서버가 한 종목을 건너뛰면
       그 뒤가 통째로 한 칸씩 밀려 엉뚱한 가격이 붙는다 — 실제로 겪은 일이다 */
    const bySymbol = indexPricesBySymbol(previewBatchPrices);
    const list = PREVIEW_ENRICHED.map((base) => {
      const d = base.assetClass === "현금" ? null : lookupPrice(bySymbol, base.symbol);
      const currentPriceNative = d?.price ?? base.currentPriceNative;
      const isUSDStock = base.market === "US" || base.market === "ETF";
      const currentValueKRW = isUSDStock
        ? currentPriceNative * exchangeRate * base.shares
        : currentPriceNative * base.shares;
      const fxForCost = base.currency === "USD"
        ? (base.inputExchangeRate ?? exchangeRate)
        : 1; // 평단가를 원화로 입력했으면 이미 원화 금액이므로 환율을 다시 곱하지 않음
      const costKRW = base.avgPrice * fxForCost * base.shares;
      const pnlKRW = currentValueKRW - costKRW;
      const pnlRate = costKRW !== 0 ? (pnlKRW / costKRW) * 100 : 0;

      /* 오늘 등락 — 로그인했을 때와 같은 방법으로 센다.
         예전에는 미리보기만 0 으로 두었다. 그런데 시세는 실제로 받아 오므로
         등락률도 같이 온다. 안 세면 미리보기의 '오늘' 칸만 늘 0 이 되고,
         로그인해야 비로소 값이 나타나는 이상한 화면이 된다. */
      const changeRate = d?.change_rate ?? null;
      const dailyChangeKRW = 오늘변화원화(currentValueKRW, changeRate, 환율등락, isUSDStock) ?? 0;
      const 전일대비액 = d?.price != null ? 전일대비주당(currentPriceNative, changeRate) : null;

      return withNativeValues(
        { ...base, currentPriceNative, currentValueKRW, costKRW, pnlKRW, pnlRate, weight: 0,
          dailyChangeKRW, 전일대비율: changeRate, 전일대비액 },
        exchangeRate,
      );
    });
    const totalKRW = list.reduce((s, e) => s + e.currentValueKRW, 0);
    return list.map((e) => ({ ...e, weight: totalKRW > 0 ? (e.currentValueKRW / totalKRW) * 100 : 0 }));
  }, [previewBatchPrices, exchangeRate, 환율등락]);

  const previewSummaryLive = useMemo(() => {
    const totalValue = previewEnrichedLive.reduce((s, e) => s + e.currentValueKRW, 0);
    const totalCost  = previewEnrichedLive.reduce((s, e) => s + e.costKRW, 0);
    const totalPnl   = totalValue - totalCost;
    const totalRate  = totalCost !== 0 ? (totalPnl / totalCost) * 100 : 0;
    const totalDailyChangeKRW = previewEnrichedLive.reduce((s, e) => s + (e.dailyChangeKRW ?? 0), 0);
    const 어제 = totalValue - totalDailyChangeKRW;
    return {
      totalValue, totalCost, totalPnl, totalRate, totalDailyChangeKRW,
      totalDailyChangeRate: 어제 !== 0 ? (totalDailyChangeKRW / 어제) * 100 : 0,
    };
  }, [previewEnrichedLive]);

  /* ── 심볼 → 시세 (배열 순서에 의존하지 않도록 심볼로 짝지음) ──
     WebSocket은 심볼을 정렬해 구독하므로 응답 순서가 보유종목 순서와 다를 수 있다.
     인덱스로 짝지으면 종목별 가격이 뒤바뀌므로 반드시 심볼 기준으로 매칭한다. */
  const priceBySymbol = useMemo(() => indexPricesBySymbol(effectivePrices), [effectivePrices]);

  const priceMap = useMemo(() => {
    const map: Record<number, number> = {};
    priceableItems.forEach((item) => {
      const d = lookupPrice(priceBySymbol, item.symbol);
      if (d?.price != null && d.price > 0) map[item.id] = d.price;
    });
    return map;
  }, [priceableItems, priceBySymbol]);

  /* ── 일일 등락률 맵 (현재가 조회 결과의 change_rate, % 단위) ── */
  const changeRateMap = useMemo(() => {
    const map: Record<number, number> = {};
    priceableItems.forEach((item) => {
      const d = lookupPrice(priceBySymbol, item.symbol);
      if (d?.change_rate != null) map[item.id] = d.change_rate;
    });
    return map;
  }, [priceableItems, priceBySymbol]);

  /* ── 전체 보기에서 제외된 포트폴리오의 종목은 집계에서 빼기 ── */
  const filteredItems = useMemo(() => {
    if (!isAllView || excludedPortfolioIds.size === 0) return items;
    return items.filter((i) => i.portfolioId == null || !excludedPortfolioIds.has(i.portfolioId));
  }, [items, isAllView, excludedPortfolioIds]);

  /* ── KRW 환산 enriched items ── */
  const enriched = useMemo<EnrichedItem[]>(() => {
    const list = filteredItems.map((raw) => {
      const item: PortfolioItem = {
        ...raw,
        currency: raw.currency ?? (raw.market === "KR" ? "KRW" : "USD"),
      };
      // US/ETF API는 항상 USD로 반환 → 저장된 currency 무관하게 항상 환율 곱셈
      const isUSDStock = item.market === "US" || item.market === "ETF";
      const hasLivePrice = priceMap[item.id] != null;

      // 매입가는 저장된 통화 기준
      const fxForCost = item.currency === "USD"
        ? (item.inputExchangeRate ?? exchangeRate)
        : 1; // 평단가를 원화로 입력했으면 이미 원화 금액이므로 환율을 다시 곱하지 않음
      const costKRW = item.avgPrice * fxForCost * item.shares;

      // 현재가를 아직 못 불러왔으면 avgPrice를 그대로 "현지가"로 쓰면 안 됨 —
      // 원화로 입력한 해외종목의 경우 avgPrice가 이미 원화 금액이라 환율을 또 곱하는
      // 사고가 나므로, 가격 미수신 시엔 매입금액을 그대로 평가금액으로 폴백(손익 0)
      const currentPriceNative = hasLivePrice
        ? priceMap[item.id]
        : (isUSDStock ? item.avgPrice / fxForCost : item.avgPrice);

      const currentValueKRW = hasLivePrice
        ? (isUSDStock ? currentPriceNative * exchangeRate * item.shares : currentPriceNative * item.shares)
        : costKRW;

      const pnlKRW = currentValueKRW - costKRW;
      const pnlRate = costKRW !== 0 ? (pnlKRW / costKRW) * 100 : 0;

      /* 일일 등락(원화 기준) — 어제 평가금액을 역산한다.
         해외 종목은 환율 등락도 같이 곱한다(utils/holdings 주석 참고).

         시세를 못 받았을 때는 환율도 안 곱한다. 그때 평가금액은 오늘
         환율로 잰 값이 아니라 **매입금액 그대로**(costKRW)라서, 환율이
         움직여도 그 숫자는 안 바뀐다 — 곱하면 없는 변화를 지어낸다. */
      const changeRate = changeRateMap[item.id];
      const dailyChangeKRW = 오늘변화원화(
        currentValueKRW,
        hasLivePrice ? changeRate : null,
        환율등락,
        isUSDStock && hasLivePrice,
      ) ?? 0;
      /* 한 주가 어제보다 얼마 움직였는지. 화면에 '전일대비'로 나간다.
         수익률(매입가 대비)과는 다른 숫자다 — 어제 산 사람과 3년 전에 산
         사람에게 오늘 하루의 움직임은 같지만 수익률은 전혀 다르다. */
      const 전일대비율 = changeRate ?? null;
      const 전일대비액 = hasLivePrice ? 전일대비주당(currentPriceNative, changeRate) : null;

      return withNativeValues(
        { ...item, currentPriceNative, currentValueKRW, costKRW, pnlKRW, pnlRate, weight: 0,
          dailyChangeKRW, 전일대비율, 전일대비액 },
        exchangeRate,
      );
    });

    const totalKRW = list.reduce((s, e) => s + e.currentValueKRW, 0);
    return list.map((e) => ({
      ...e,
      weight: totalKRW > 0 ? (e.currentValueKRW / totalKRW) * 100 : 0,
    }));
  }, [filteredItems, priceMap, changeRateMap, exchangeRate, 환율등락]);

  /* ── 전체 보기 — 포트폴리오별 비중 ── */
  const portfolioBreakdown = useMemo(() => {
    if (!isAllView) return [];
    const map: Record<string, { id: number | null; name: string; value: number }> = {};
    enriched.forEach((e) => {
      const key = String(e.portfolioId ?? "unknown");
      if (!map[key]) map[key] = { id: e.portfolioId ?? null, name: e.portfolioName || "기타", value: 0 };
      map[key].value += e.currentValueKRW;
    });
    const total = Object.values(map).reduce((s, v) => s + v.value, 0);
    return Object.values(map)
      .map((v) => ({ ...v, weight: total > 0 ? (v.value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [enriched, isAllView]);

  /* ── 요약 ──
     어떤 보유 목록이 들어와도 같은 방식으로 합계를 낸다. 자산유형 탭을
     '국내주식'으로 바꾸면 아래 표만 국내주식으로 걸러지고 위 합계는 전체
     그대로여서, 표와 합계가 서로 다른 것을 말하고 있었다. */
  const 합계내기 = useCallback((rows: EnrichedItem[]) => {
    const totalValue = rows.reduce((s, e) => s + e.currentValueKRW, 0);
    const totalCost  = rows.reduce((s, e) => s + e.costKRW, 0);
    const totalPnl   = totalValue - totalCost;
    const totalRate  = totalCost !== 0 ? (totalPnl / totalCost) * 100 : 0;
    const totalDailyChangeKRW = rows.reduce((s, e) => s + (e.dailyChangeKRW ?? 0), 0);
    const prevTotalValue = totalValue - totalDailyChangeKRW;
    const totalDailyChangeRate = prevTotalValue !== 0 ? (totalDailyChangeKRW / prevTotalValue) * 100 : 0;
    return { totalValue, totalCost, totalPnl, totalRate, totalDailyChangeKRW, totalDailyChangeRate };
  }, []);

  const summary = useMemo(() => 합계내기(enriched), [enriched, 합계내기]);

  /* ── 정렬 ──
     로그인 여부와 무관하게 같은 규칙을 쓴다. 예전에는 미리보기에서 표
     머리글을 눌러도 아무 일이 없어, 정렬이 되는 화면인지조차 알 수
     없었다. 화면 안에서 줄 순서만 바꾸는 일이라 막을 이유가 없다. */
  const 정렬 = useCallback((rows: EnrichedItem[]) => {
    if (!sortField) return rows;
    return [...rows].sort((a, b) => {
      if (sortField === "name") {
        const av = a.name || a.symbol, bv = b.name || b.symbol;
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const map: Record<SortField, number> = {
        name: 0, shares: a.shares, value: a.currentValueKRW, pnl: a.pnlKRW, pnlRate: a.pnlRate, weight: a.weight,
      };
      const bmap: Record<SortField, number> = {
        name: 0, shares: b.shares, value: b.currentValueKRW, pnl: b.pnlKRW, pnlRate: b.pnlRate, weight: b.weight,
      };
      return sortDir === "asc" ? map[sortField] - bmap[sortField] : bmap[sortField] - map[sortField];
    });
  }, [sortField, sortDir]);

  const sortedEnriched = useMemo(() => 정렬(enriched), [enriched, 정렬]);

  /* ── 차트 데이터 ── */
  const stockPieData = useMemo(() => {
    const merged: Record<string, { name: string; value: number }> = {};
    enriched.forEach((e) => {
      const name = (e.market === "US" || e.market === "ETF") ? e.symbol : (e.name || e.symbol);
      if (merged[e.symbol]) merged[e.symbol].value += e.currentValueKRW;
      else merged[e.symbol] = { name, value: e.currentValueKRW };
    });
    const sorted = Object.values(merged).sort((a, b) => b.value - a.value);
    const top  = sorted.slice(0, 10);
    const rest = sorted.slice(10);
    const data = top.map((e) => ({ name: e.name, value: Math.round(e.value) }));
    if (rest.length > 0) {
      data.push({ name: "기타", value: Math.round(rest.reduce((s, e) => s + e.value, 0)) });
    }
    return data;
  }, [enriched]);

  const marketPieData = useMemo(() => {
    const map: Record<string, number> = {};
    enriched.forEach((e) => {
      const cls = resolveAssetClass(e);
      map[cls] = (map[cls] ?? 0) + e.currentValueKRW;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [enriched]);

  const previewStockPie = useMemo(() => previewEnrichedLive.map((e) => ({
    name: e.market === "US" || e.market === "ETF" ? e.symbol : e.name,
    value: e.currentValueKRW,
  })), [previewEnrichedLive]);
  const previewMarketPie = useMemo(() => Object.entries(
    previewEnrichedLive.reduce((acc, e) => { const cls = resolveAssetClass(e); acc[cls] = (acc[cls] ?? 0) + e.currentValueKRW; return acc; }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name, value })), [previewEnrichedLive]);

  const portfolioPieData = useMemo(
    () => portfolioBreakdown.map((p) => ({ name: p.name, value: Math.round(p.value) })),
    [portfolioBreakdown],
  );

  const activePieData = useMemo(
    () => (isLoggedIn
      ? (chartMode === "portfolio" ? portfolioPieData : chartMode === "stock" ? stockPieData : marketPieData)
      : (chartMode === "stock" ? previewStockPie : previewMarketPie)),
    [isLoggedIn, chartMode, portfolioPieData, stockPieData, marketPieData, previewStockPie, previewMarketPie],
  );

  /* 범례용 합계·비율 — 매 렌더마다 reduce를 다시 돌리지 않도록 미리 계산 */
  const pieLegend = useMemo(() => {
    const total = activePieData.reduce((s, e) => s + e.value, 0);
    return activePieData.map((e) => ({
      ...e,
      pct: total > 0 ? (e.value / total) * 100 : 0,
    }));
  }, [activePieData]);

  /* ── 전체 보기를 벗어나면 포트폴리오별 비중 탭에 머물러 있지 않도록 ── */
  useEffect(() => {
    if (!isAllView && chartMode === "portfolio") setChartMode("stock");
  }, [isAllView, chartMode]);

  const 보일탭들 = useMemo(() => 모든탭.map((t) => ({ id: t, label: t })), []);



  /* ── 보유 종목 줄에 붙일 배당 정보 ──
     배당 탭과 **같은 열쇠**를 쓴다. 탭을 열어 봤으면 캐시가 그대로
     쓰이고, 안 열어 봤으면 여기서 한 번 받아 배당 탭이 물려받는다.

     예전에는 여기에 !pricesLoading 이 걸려 있었다. '시세와 같이 나가면
     0.15 CPU 서버에서 서로 밀어낸다' 는 이유였는데, 그 대가가 컸다 —
     화면을 열면 요청이 **세 번 줄지어** 나갔다.

         보유 목록 → 시세 → 배당

     한 칸이 한국↔싱가포르 왕복이라, 서버가 아무리 빨라도 배지가 뜨기까지
     왕복 세 번이 그대로 쌓인다. 게다가 시세 쪽은 상한이 없어 실측 9초가
     나왔고, 그동안 배당은 시작조차 못 했다.

     시세에 상한을 걸었으니(서버 4초) 이제 나란히 보낸다. 둘은 서로
     기다릴 이유가 없는 값이다 — 배당은 보유 목록만 있으면 낸다. */
  const { data: 배당자료 } = use배당달력(
    isAllView ? undefined : selectedPortfolioId,
    isLoggedIn && items.length > 0,
  );





  /* ── CRUD ── */
  const handleAdd = (data: Omit<PortfolioItem, "id">) => {
    setModalError(null);
    addMutation.mutate(data, { onSuccess: () => { setModalOpen(false); setModalError(null); } });
  };
  const handleEdit = (data: Omit<PortfolioItem, "id">) => {
    if (!editItem) return;
    setModalError(null);
    editMutation.mutate({ id: editItem.id, data }, { onSuccess: () => { setEditItem(undefined); setModalError(null); } });
  };
  /* 현금도 같은 창에서 고친다. 예전에는 현금이면 다른 창을 띄웠다 —
     쓰는 사람에게는 둘 다 '담아 둔 것을 고치는' 같은 일이다 */
  const openEditModal = useCallback((item: PortfolioItem) => setEditItem(item), []);

  /* 행 컴포넌트에 넘길 핸들러 — 렌더마다 새로 만들어지면 memo가 무력화되므로 고정한다 */
  const handleRowNavigate = useCallback((item: EnrichedItem) => {
    navigate(`/stocks/${item.market}/${encodeURIComponent(item.symbol)}`);
  }, [navigate]);
  const handleRowEdit   = useCallback((item: EnrichedItem) => openEditModal(item), [openEditModal]);
  const handleRowDelete = useCallback((item: EnrichedItem) => setDeleteTarget(item), []);
  const handleConfirmDelete = () => {
    if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
  };

  const isLoading = itemsLoading || pricesLoading;

  /**
   * 시세를 **하나도** 못 받았나.
   *
   * 여기가 조용히 거짓말을 하고 있었다. 시세가 없으면 평가금액이
   * 매입금액으로 떨어지도록 만들어 뒀는데(그래야 원화로 입력한 해외
   * 종목에 환율을 두 번 곱하는 사고가 안 난다), 화면은 그 사실을
   * 어디에도 안 적었다. 그래서 시세 조회가 통째로 실패하면 —
   *
   *     평가금액 = 매입금액,  평가손익 +0원 (0.00%)
   *
   * 이 나온다. 사람은 이걸 '본전' 으로 읽는다. 실제로는 **모른다** 가
   * 맞는 답이다. 둘은 전혀 다른 말이다.
   *
   * 한 종목도 못 받았을 때만 센다. 몇 개만 빠진 것은 서버가 배경에서
   * 마저 받아 오므로 곧 채워진다(위 재촉 주기).
   */
  const 시세전부실패 = useMemo(() => {
    if (!isLoggedIn || priceableItems.length === 0 || pricesLoading) return false;
    if (시세못받음) return true;
    return priceableItems.every((i) => priceMap[i.id] == null);
  }, [isLoggedIn, priceableItems, pricesLoading, 시세못받음, priceMap]);

  /* ── 미리보기 vs 실데이터 ── */
  const allDisplayEnriched = useMemo(
    () => (isLoggedIn ? sortedEnriched : 정렬(previewEnrichedLive)),
    [isLoggedIn, sortedEnriched, previewEnrichedLive, 정렬],
  );
  const displayEnriched = useMemo(
    () => assetFilterTab === "전체"
      ? allDisplayEnriched
      : allDisplayEnriched.filter((e) => resolveAssetClass(e) === assetFilterTab),
    [allDisplayEnriched, assetFilterTab],
  );

  /* ── 배당 화면에 넘길 '내 몫' ──
     배당금(분자)은 서버가 주지만 '얼마를 넣어서 그만큼 받나'(분모)는
     이 화면만 안다. 요청을 하나 더 보내는 대신 여기서 내려보낸다.
     자산유형 필터는 일부러 안 태운다 — 투자배당률은 '내 포트폴리오
     전체' 대비여야 뜻이 맞는다. */
  const 보유몫들 = useMemo<Record<string, 보유몫>>(() => {
    const 칸: Record<string, 보유몫> = {};
    /* 미리보기(비로그인)에서도 만든다. 안 그러면 예시 배당 화면의
       투자배당률·시가배당률이 '—' 로만 나와서, 그 두 칸이 무엇을
       말하는 자리인지 로그인 전에는 알 수가 없다 */
    for (const e of allDisplayEnriched) {
      if (resolveAssetClass(e) === "현금") continue;   // 현금에는 배당이 없다
      /* 심볼만으로 키를 잡고 있었다. 서버는 (심볼, 시장) 으로 나눠서
         보내므로, 같은 심볼을 두 시장에 담아 둔 사람은 배당 응답에 두 줄을
         받는다. 그 두 줄이 여기서 합쳐진 수량을 각각 다시 받아 두 배로
         세어졌다. 목록의 react key 는 이미 `market:symbol` 을 쓰고 있어서
         한 파일 안에서도 두 규칙이 섞여 있었다. */
      const 키 = 배당키(e.market, e.symbol);
      const 몫 = 칸[키] ?? (칸[키] = { 수량: 0, 원가: 0, 평가: 0 });
      몫.수량 += e.shares;
      몫.원가 += e.costKRW;
      몫.평가 += e.currentValueKRW;
    }
    return 칸;
  }, [allDisplayEnriched]);

  const 배당정보 = useMemo<Record<string, 배당몫>>(() => {
    const 칸: Record<string, 배당몫> = {};
    /* 배당 탭과 **같은 함수**를 거친다.
       예전에는 서버 응답을 그대로 돌았다. 그러면 전체 보기에서
       포트폴리오를 제외해도 이 배지만 제외 전 기준으로 남는다 —
       같은 화면의 두 자리가 서로 다른 모집단을 말하게 된다. */
    for (const r of 내몫으로(배당자료?.items ?? [], 보유몫들)) {
      /* plan_year(앞으로 한 해)를 쓴다. per_year 는 '지난 1년에 실제로
         받은 합' 이라 배당 탭의 월별 막대 합계와 다른 숫자가 나온다 —
         두 화면이 서로 다른 배당률을 말하게 된다. */
      칸[배당키(r.market, r.symbol)] = {
        months: r.months ?? [],
        perYear: r.plan_year ?? r.per_year ?? 0,
        currency: r.currency,
      };
    }
    return 칸;
  }, [배당자료, 보유몫들]);

  /* ── 로그인 전 미리보기 ──
     보유 수량만 예시고, 시세·시세이력·배당·뉴스는 **실제 값**이다.
     지어낸 값을 진짜처럼 보여 주면 화면이 무엇을 할 수 있는지 알리려다
     거짓말을 하는 셈이 된다(hooks/usePortfolioPreview 주석 참고).

     탭을 눌렀을 때만 받는다 — 안 그러면 로그인 안 한 방문자 때문에
     0.15 CPU 서버가 느려진다. */
  const 미리보기중 = !isLoggedIn;
  const 예시흐름 = use미리보기흐름(allDisplayEnriched, exchangeRate, 미리보기중 && 속탭 === "추이");
  const 예시배당 = use미리보기배당(allDisplayEnriched, 미리보기중 && 속탭 === "배당");
  const 예시뉴스 = use미리보기뉴스(allDisplayEnriched, 미리보기중 && 속탭 === "뉴스");

  /* ── 자산 지도(트리맵) 칸 ──
     파이와 같은 세 가지 갈래를 그대로 쓰되, 파이처럼 열한 번째부터
     '기타' 로 뭉치지 않는다 — 지도는 칸이 많아도 읽히는 것이 요점이다.

     색은 오늘 등락이다. 시세를 하나도 못 받은 묶음은 0% 가 아니라
     '모름'(null)이어야 한다. 0 으로 적으면 '안 움직였다' 는 거짓말이 된다. */
  const 지도칸들 = useMemo<지도칸[]>(() => {
    const 묶기 = (열쇠: (e: EnrichedItem) => string, 이름짓기: (e: EnrichedItem) => string) => {
      const 칸 = new Map<string, { name: string; 평가: number; 오늘: number; 안다: boolean }>();
      for (const e of allDisplayEnriched) {
        const k = 열쇠(e);
        const c = 칸.get(k) ?? { name: 이름짓기(e), 평가: 0, 오늘: 0, 안다: false };
        c.평가 += e.currentValueKRW;
        c.오늘 += e.dailyChangeKRW ?? 0;
        if (e.전일대비율 != null) c.안다 = true;
        칸.set(k, c);
      }
      const 총 = [...칸.values()].reduce((s, c) => s + c.평가, 0);
      return [...칸.entries()].map(([k, c]) => {
        const 어제 = c.평가 - c.오늘;
        return {
          key: k,
          name: c.name,
          value: Math.round(c.평가),
          등락률: c.안다 && 어제 !== 0 ? (c.오늘 / 어제) * 100 : null,
          비중: 총 > 0 ? (c.평가 / 총) * 100 : 0,
        };
      }).sort((a, b) => b.value - a.value);
    };
    if (chartMode === "portfolio") {
      return 묶기((e) => String(e.portfolioId ?? "기타"), (e) => e.portfolioName || "기타");
    }
    if (chartMode === "market") {
      return 묶기((e) => resolveAssetClass(e), (e) => resolveAssetClass(e));
    }
    return 묶기((e) => e.symbol,
      (e) => ((e.market === "US" || e.market === "ETF") ? e.symbol : (e.name || e.symbol)));
  }, [allDisplayEnriched, chartMode]);
  const hasForexHoldings = useMemo(
    () => displayEnriched.some((e) => e.market === "US" || e.market === "ETF"),
    [displayEnriched],
  );
  /* 자산유형 탭을 고르면 합계도 그 유형만 센다 — '국내주식'을 누르면
     국내주식 합계, '채권'을 누르면 채권 합계. '전체'일 때만 통째로 센다.

     미리보기도 로그인했을 때와 같은 방법으로 센다. 예전에는 미리보기의
     오늘 등락만 0 으로 눌러 뒀는데, 시세는 실제로 받아 오므로 그럴 이유가
     없었다. 그 탓에 로그인해야 비로소 '오늘' 칸이 살아나는 화면이 됐다. */
  const displaySummary = useMemo(() => {
    if (assetFilterTab === "전체") return isLoggedIn ? summary : previewSummaryLive;
    return 합계내기(displayEnriched);
  }, [assetFilterTab, isLoggedIn, summary, previewSummaryLive, displayEnriched, 합계내기]);

  /* 숫자만 바뀌면 '전체 합계인 줄' 알고 오해한다. 카드 이름에 무엇의
     합계인지 같이 적는다 — '총 평가금액' vs '채권 평가금액' */
  const 요약범위 = assetFilterTab === "전체" ? "총" : assetFilterTab;
  // 로그인/비로그인 모두 현재가를 다 불러오기 전까지 추정치를 보여주지 않음
  // 구성 차트는 자산유형 필터와 무관하게 전체 보유종목 기준으로 항상 표시
  const hasDisplay      = allDisplayEnriched.length > 0 && (isLoggedIn ? !isLoading : previewLoaded);

  return (
    <div className="flex flex-col gap-4 fade-in pb-20">

      {/* ── 상단 탭 ── */}
      <UnderlineTabs
        ariaLabel="자산 화면"
        tabs={ASSET_PAGE_TABS}
        active="portfolio"
        onChange={handleTabChange}
      />

      {/* ── 포트폴리오 선택 탭 ── */}
      {isLoggedIn && (
        <div className="flex items-center border-b border-border bg-bg-card rounded-t-xl overflow-x-auto scrollbar-hide">
          {portfolios.length > 0 && (
            <>
              <button
                onClick={() => setSelectedPortfolioId("all")}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all flex-shrink-0 whitespace-nowrap ${
                  isAllView
                    ? "border-accent-blue text-accent-blue bg-accent-blue/5"
                    : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated"
                }`}
              >
                <span>전체</span>
                <span className="text-xs opacity-60">({totalItemCount})</span>
              </button>
              {(localPortfolioOrder ?? portfolios).map((pf) => (
                <PortfolioPill
                  key={pf.id}
                  portfolio={pf}
                  active={pf.id === selectedPortfolioId}
                  onSelect={() => handlePortfolioTabClick(pf)}
                  draggable={portfolios.length > 1}
                  isDragging={dragPortfolioId === pf.id}
                  isDropTarget={dropPortfolioId === pf.id}
                  onDragStart={() => handlePortfolioDragStart(pf)}
                  onDragOver={(e) => handlePortfolioDragOver(e, pf.id)}
                  onDrop={handlePortfolioDrop}
                  onTouchStart={(e) => handlePortfolioTouchStart(pf, e)}
                  onTouchMove={handlePortfolioTouchMoveGated}
                  onTouchEnd={handlePortfolioTouchEnd}
                />
              ))}
            </>
          )}
          {portfolios.length === 0 && (
            <AddPortfolioButton onAdd={(name) => createPortfolioMutation.mutate(name)} />
          )}
        </div>
      )}

      {/* ── 로그인 배너 (미리보기 모드) ── */}
      {!isLoggedIn && (
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-accent-blue/10 border border-accent-blue/20">
          <div className="w-8 h-8 rounded-lg bg-accent-blue/20 flex items-center justify-center flex-shrink-0">
            <LogIn size={14} className="text-accent-blue" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-text-primary">미리보기 모드</p>
            <p className="text-xs text-text-muted mt-0.5">아래는 예시 데이터입니다. 로그인하면 내 종목을 직접 추가·관리할 수 있어요.</p>
          </div>
          <Link to="/login"
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue transition-colors"
          >
            <LogIn size={13} /> 로그인
          </Link>
        </div>
      )}

      {/* ── 헤더 ── */}
      {/* 좁은 화면에서는 제목과 버튼을 세로로 쌓는다.
          한 줄에 나란히 두면 버튼 개수(포트폴리오 수에 따라 늘어남)에 밀려 제목이
          찌그러지고, 한글은 글자 사이에서도 줄바꿈돼 세로로 쪼개진다. */}
      {/* 제목과 버튼을 한 줄에 둔다.
          예전에는 두 줄이었다. 상단바·탭·미리보기 배너까지 더하면 요약이
          나오기 전에 다섯 줄을 지나야 했고, 휴대폰에서는 그것만으로 화면
          절반이었다. 제목은 줄바꿈되지 않게 고정하고 버튼만 줄인다. */}
      <div className={화면모양 === "classic"
        ? "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        : "flex items-center justify-between gap-2"}>
        <div className="min-w-0 flex items-baseline gap-2">
          <h1 className="text-xl font-bold text-text-primary whitespace-nowrap">내 자산</h1>
          <p className="text-text-muted text-xs truncate">
            {isLoggedIn && itemsLoading ? "불러오는 중" : `${displayEnriched.length}개`}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* 금액 가리기 —
              지하철에서 내 자산을 열면 옆자리가 평가금액을 그대로 본다.
              설정 창에도 같은 스위치가 있지만, 급할 때 설정을 찾아 들어갈
              수는 없다. 자산 앱들이 하나같이 여기에 눈을 다는 이유다. */}
          <button
            onClick={토글금액가리기}
            aria-pressed={금액가리기}
            aria-label={금액가리기 ? "금액 보이기" : "금액 가리기"}
            title={금액가리기 ? "금액 보이기" : "금액 가리기"}
            className={`p-2 rounded-lg border transition-all ${
              금액가리기
                ? "border-accent-blue/40 text-accent-blue bg-accent-blue/10"
                : "border-border text-text-muted hover:text-accent-blue hover:border-accent-blue/40"
            }`}
          >
            {금액가리기 ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button
            onClick={() => { queryClient.invalidateQueries({ queryKey: ["portfolios"] }); queryClient.invalidateQueries({ queryKey: ["portfolio-items-all"] }); queryClient.invalidateQueries({ queryKey: ["portfolio-prices"] }); }}
            className="p-2 rounded-lg border border-border text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all"
            title="내 자산 업데이트"
          >
            <RefreshCw size={13} />
          </button>
          {isAllView && portfolios.length > 1 && (
            <PortfolioFilterDropdown
              portfolios={portfolios}
              excludedIds={excludedPortfolioIds}
              onToggle={toggleExcludedPortfolio}
            />
          )}
          {/* 관심종목의 "폴더 관리 / 종목 추가"와 같은 위치·형태로 맞춘다.
              로그인 전에도 버튼을 숨기지 않는다 — 버튼이 아예 없으면 이
              화면으로 무엇을 할 수 있는지 알 수가 없다. 누르면 로그인으로
              보내서, 왜 로그인이 필요한지가 그 자리에서 드러나게 한다. */}
          {(isLoggedIn ? portfolios.length > 0 : true) && (
            <button
              onClick={() => isLoggedIn ? setShowPortfolioManager(true) : navigate("/login")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all whitespace-nowrap"
              title={isLoggedIn ? "포트폴리오 추가/편집" : "로그인하면 포트폴리오를 만들 수 있어요"}
            >
              <Settings2 size={13} /><span className="hidden sm:inline">포트폴리오 관리</span>
            </button>
          )}
          {/* "전체"는 여러 포트폴리오를 모아 보는 화면이라 어디에 담을지가 모호하다.
              종목 추가는 특정 포트폴리오를 고른 상태에서만 노출한다 */}
          {(!isLoggedIn || !isAllView) && (
            <button
              onClick={() => {
                if (!isLoggedIn) { navigate("/login"); return; }
                setEditItem(undefined); setModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 transition-all whitespace-nowrap"
              title={isLoggedIn ? undefined : "로그인하면 내 종목을 담을 수 있어요"}
            >
              <Plus size={13} />자산 추가
            </button>
          )}
        </div>
      </div>

      {/* ── 요약 카드 ── */}
      {/* 보유종목이 실제로 연동(로그인 + 종목 추가)되기 전에는 미리보기 수치를 보여주지 않음 */}
      {/* 로그인 상태에서는 현재가를 다 불러오기 전까지 매입가 기반 추정치를 보여주지 않고 로딩 표시만 함 */}
      {/* 로딩 뼈대 — 실제로 그려질 모양과 같아야 값이 도착할 때 안 튄다 */}
      {((isLoggedIn && items.length > 0 && pricesLoading) || (!isLoggedIn && !previewLoaded)) && (
        화면모양 === "classic" ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {["총 평가금액", "총 매입금액", "평가손익", "수익률"].map((label) => (
            <Card key={label} className="flex flex-col gap-1">
              <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide">{label}</span>
              <div className="h-4 w-20 rounded bg-bg-elevated animate-pulse mt-0.5" />
            </Card>
          ))}
        </div>
      ) : (
        /* 뼈대는 실제로 그려질 모양과 같아야 한다. 예전에는 여기가 카드
           넷이었는데 본체는 카드 하나라, 값이 도착할 때 화면이 크게 튀었다 */
        <Card className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-2xs text-text-muted">평가금액</span>
            {/* 평가금액과 손익은 시세를 받아야 안다. 매입가로 대신 채우면
                그건 그냥 틀린 숫자다 — 여기만 뼈대로 둔다 */}
            <div className="h-6 w-40 rounded bg-bg-elevated animate-pulse" />
            <div className="h-3 w-32 rounded bg-bg-elevated animate-pulse" />
          </div>
          {/* 매입금액과 환율은 시세와 아무 상관이 없다. 내가 얼마에 샀는지는
              보유 목록에 이미 들어 있고, 환율은 따로 받는다.
              그런데도 셋을 통째로 뼈대로 두고 있었다 — 시세가 늦는 동안
              화면 전체가 '아무것도 없는 곳' 으로 보이던 이유다.
              아는 것부터 적어 두면 그 사이가 훨씬 짧게 느껴진다 */}
          <div className="grid grid-cols-2 gap-2 pt-2.5 border-t border-border/50">
            {[
              { label: "매입금액", value: 돈.원(displaySummary.totalCost) },
              { label: "적용 환율", value: `${Math.round(exchangeRate).toLocaleString("ko-KR")}원` },
            ].map((c) => (
              <div key={c.label} className="flex flex-col gap-1">
                <span className="text-2xs text-text-dim">{c.label}</span>
                <span className="text-sm font-mono font-semibold text-text-primary num">{c.value}</span>
              </div>
            ))}
          </div>
        </Card>
        )
      )}

      {((isLoggedIn && items.length > 0 && !pricesLoading) || (!isLoggedIn && previewLoaded)) && (
        화면모양 === "classic" ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: `${요약범위} 평가금액`, value: 돈.원(displaySummary.totalValue), color: "text-text-primary", icon: Landmark, tint: "" },
            { label: `${요약범위} 매입금액`, value: 돈.원(displaySummary.totalCost),  color: "text-text-primary", icon: Receipt,  tint: "" },
            { label: "평가손익",   value: 돈.원부호(displaySummary.totalPnl),  color: pnlColor(displaySummary.totalPnl),
              icon: displaySummary.totalPnl >= 0 ? TrendingUp : TrendingDown,
              tint: displaySummary.totalPnl >= 0 ? "bg-accent-red/5 border-accent-red/20" : "bg-accent-blue/5 border-accent-blue/20" },
            { label: "수익률",     value: `${displaySummary.totalRate >= 0 ? "+" : ""}${displaySummary.totalRate.toFixed(2)}%`, color: pnlColor(displaySummary.totalRate),
              icon: Percent,
              tint: displaySummary.totalRate >= 0 ? "bg-accent-red/5 border-accent-red/20" : "bg-accent-blue/5 border-accent-blue/20" },
          ].map((c) => (
            <Card key={c.label} className={`flex flex-col gap-1 ${c.tint} ${!isLoggedIn ? "opacity-80" : ""}`}>
              <div className="flex items-center gap-1.5">
                <c.icon size={13} className={c.color === "text-text-primary" ? "text-text-dim" : c.color} />
                <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide">{c.label}</span>
              </div>
              <span className={`text-lg font-mono font-bold ${c.color}`}>{c.value}</span>
              {c.label.endsWith("평가금액") && (
                <span className="text-2xs text-text-dim">환율 {Math.round(exchangeRate).toLocaleString("ko-KR")}원</span>
              )}
              {c.label === "평가손익" && (
                <span className={`text-2xs font-mono ${pnlColor(displaySummary.totalDailyChangeKRW)}`}>
                  오늘 {돈.원부호(displaySummary.totalDailyChangeKRW)}
                </span>
              )}
              {c.label === "수익률" && (
                <span className={`text-2xs font-mono ${pnlColor(displaySummary.totalDailyChangeRate)}`}>
                  오늘 {displaySummary.totalDailyChangeRate >= 0 ? "+" : ""}{displaySummary.totalDailyChangeRate.toFixed(2)}%
                </span>
              )}
            </Card>
          ))}
        </div>
        ) : (
        /* 요약은 카드 하나로 모은다.
           예전에는 같은 크기 카드 넷이 2×2 로 놓여, 휴대폰에서 화면 3분의 1을
           쓰면서도 무엇이 제일 중요한지 알 수 없었다. 여기 들어와서 제일 먼저
           보고 싶은 건 '지금 얼마인가' 하나다.

           그 아래는 줄마다 하나씩 —
             평가손익  +5,000,000 (+12.34%)
             오늘      +123,000 (+0.21%)
           예전에는 총수익률이 평가금액 옆에 붙고 오늘치가 손익과 한 줄에
           끼어 있었다. 셋이 뒤엉켜서 어느 %가 무엇의 %인지 읽기 어려웠다.
           금액과 그 비율은 붙이고, 성격이 다른 줄은 나눈다. */
        <Card className={`flex flex-col p-0 overflow-hidden ${!isLoggedIn ? "opacity-90" : ""}`}>
          {/* 지금 얼마인가 */}
          <div className="flex flex-col gap-1 px-4 pt-4 pb-3.5">
            <span className="text-2xs text-text-muted">{요약범위} 평가금액</span>
            <span className={`text-3xl leading-none font-mono font-bold num ${
              시세전부실패 ? "text-text-secondary" : "text-text-primary"
            }`}>
              {돈.원(displaySummary.totalValue)}
            </span>
            {/* 시세를 하나도 못 받았으면 이 숫자는 **매입금액**이다.
                그렇게 만들어 둔 이유가 있다(원화로 입력한 해외 종목에
                환율을 두 번 곱하는 사고를 막는다). 문제는 화면이 그
                사실을 어디에도 안 적었다는 것이다 — 평가손익이 +0원
                으로 뜨고, 사람은 그걸 '본전' 으로 읽는다.
                실제로는 '모른다' 가 맞는 답이다. */}
            {시세전부실패 && (
              <span className="text-2xs text-accent-yellow break-keep">
                지금 시세를 못 받았어요. 매입금액을 그대로 보여 주는 중이라
                손익은 아직 알 수 없어요.
              </span>
            )}
          </div>

          {/* 얼마나 벌었나 — 줄마다 하나씩 */}
          <div className="flex flex-col gap-2 px-4 py-3 bg-bg-elevated/40 border-y border-border/50">
            {[
              { label: "평가손익", 금액: displaySummary.totalPnl,             비율: displaySummary.totalRate },
              { label: "오늘",     금액: displaySummary.totalDailyChangeKRW,  비율: displaySummary.totalDailyChangeRate },
            ].map((행) => (
              <div key={행.label} className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-text-muted shrink-0">{행.label}</span>
                {/* 관심종목·퀀트와 같은 부품을 쓴다. 같은 것이 화면마다
                    다른 모양이면 읽는 사람이 매번 다시 익혀야 한다 */}
                <ChangeBadge value={행.비율} 금액={행.금액} 통화="KRW" className="text-sm" 내돈 />
              </div>
            ))}
          </div>

          {/* 참고값 */}
          <div className="grid grid-cols-2 gap-2 px-4 py-3">
            {[
              { label: "매입금액", value: 돈.원(displaySummary.totalCost), icon: Receipt },
              { label: "적용 환율", value: `${Math.round(exchangeRate).toLocaleString("ko-KR")}원`, icon: Landmark },
            ].map((c) => (
              <div key={c.label} className="flex flex-col gap-0.5 min-w-0">
                <span className="text-2xs text-text-dim flex items-center gap-1">
                  <c.icon size={11} />{c.label}
                </span>
                <span className="text-sm font-mono font-semibold text-text-secondary num truncate">{c.value}</span>
              </div>
            ))}
          </div>
        </Card>
        )
      )}

      {/* ── 내 자산 안 탭 ──
          요약(위)은 어느 탭에 있든 남는다 — '지금 얼마인가' 는 늘 보여야
          한다. 아래만 갈아 끼운다. 파일 위쪽 자산탭 주석에 왜 나눴는지가
          적혀 있다(첫 화면 스크롤과 요청 수). */}
      {/* 시세가 오기 전에도 그린다. previewLoaded 를 기다리게 했더니
          탭 줄이 뒤늦게 끼어들면서 아래가 통째로 밀려 내려갔다 */}
      {(!isLoggedIn || items.length > 0) && (
        <Tabs
          ariaLabel="내 자산 화면"
          tabs={보일탭들}
          active={속탭}
          onChange={(id) => set속탭(id as 자산탭)}
        />
      )}

      {/* ── 추이 ──
          '지금 얼마인가' 다음에 오는 질문이 '어떻게 변해 왔나' 다.

          로그인 안 한 미리보기에서는 탭 자체가 없다 — 남의 기록이 아니라
          아무 기록도 없어서, 늘 "아직 없어요" 만 보이게 된다. */}
      {속탭 === "추이" && (isLoggedIn ? items.length > 0 : previewLoaded) && (
        <>
          <AssetHistory 미리보기={미리보기중 ? (예시흐름.점들 ?? undefined) : undefined}
                        받는중={예시흐름.받는중} />
          {/* 그래프가 '얼마나' 를 말하면, 이건 '누가' 를 말한다.
              합계가 +512만원일 때 그게 한 종목이 혼자 번 것인지 열 종목이
              조금씩 모은 것인지는 완전히 다른 상황인데 합계로는 같아 보인다 */}
          <Card className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5">
              <TrendingUp size={14} className="text-accent-blue" />
              <span className="text-sm font-semibold text-text-primary">수익 기여</span>
            </div>
            {/* 위 그래프의 기간 칩과 기준이 다르다. 안 적으면 기간을 바꿨을 때
                이 숫자도 따라 바뀔 것으로 읽는다 — 종목별 기간 기록은 서버에
                없다(스냅샷은 하루에 사용자당 합계 한 줄이다).

                '누적 손익' 이라고만 적었더니 아래 '오늘' 칩에는 안 맞는
                말이 됐다. 두 칩의 기준을 각각 적는다. */}
            <p className="text-2xs text-text-dim break-keep -mt-1.5">
              ‘총’ 은 매입가 대비, ‘오늘’ 은 어제 종가 대비예요. 위 그래프의 기간과는 다른 기준이에요.
            </p>
            <수익기여 항목={allDisplayEnriched} onSelect={(r) =>
              navigate(`/stocks/${r.market}/${encodeURIComponent(r.symbol)}`)} />
          </Card>
        </>
      )}

      {/* ── 배당 ── */}
      {속탭 === "배당" && (isLoggedIn ? items.length > 0 : previewLoaded) && (
        <DividendCalendar
          portfolioId={isAllView ? undefined : (selectedPortfolioId ?? undefined)}
          이름={isAllView ? undefined : portfolios.find((p) => p.id === selectedPortfolioId)?.name}
          보유={보유몫들}
          미리보기={예시배당}
        />
      )}

      {/* ── 뉴스 ──
          내 종목 얘기가 어디에 흩어져 있는지 찾아다닐 이유가 없다 */}
      {속탭 === "뉴스" && (isLoggedIn ? items.length > 0 : previewLoaded) && (
        <보유뉴스
          portfolioId={isAllView ? undefined : (selectedPortfolioId ?? undefined)}
          미리보기={예시뉴스}
        />
      )}

      {/* ── 비중 ── */}
      {속탭 === "비중" && ((isLoggedIn && items.length > 0 && isLoading) || (!isLoggedIn && !previewLoaded)) && (
        <Card className="flex items-center justify-center h-[180px] text-text-muted text-sm">
          가격 불러오는 중
        </Card>
      )}
      {속탭 === "비중" && hasDisplay && (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-border -mx-4 px-4 pb-0 gap-2">
            <div className="flex overflow-x-auto scrollbar-hide">
              {([
                { id: "stock",  label: "종목별" },
                { id: "market", label: "자산유형별" },
                ...(isAllView && portfolios.length > 1 ? [{ id: "portfolio", label: "포트폴리오별" }] : []),
              ] as { id: ChartMode; label: string }[]).map(({ id, label }) => (
                <button key={id} onClick={() => setChartMode(id)}
                  className={`px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-all whitespace-nowrap ${
                    chartMode === id ? "border-accent-blue text-accent-blue" : "border-transparent text-text-muted hover:text-text-primary"
                  }`}
                >{label}</button>
              ))}
            </div>
            {/* 파이 ↔ 지도.
                파이는 종목이 예닐곱 개를 넘으면 조각이 얇아져 못 읽는다.
                그래서 열한 번째부터 '기타' 로 뭉쳐 두고 있었는데, 스무
                종목을 가진 사람에게는 절반이 '기타' 인 그림이 된다. */}
            <div className="flex gap-0.5 p-0.5 mb-1.5 rounded-lg border border-border bg-bg-primary shrink-0 self-center">
              {([
                { id: "파이", icon: PieIcon,  label: "원그래프로 보기" },
                { id: "지도", icon: Grid2x2,  label: "지도로 보기" },
              ] as const).map((v) => (
                <button key={v.id} onClick={() => set구성모양(v.id)}
                  aria-pressed={구성모양 === v.id} aria-label={v.label} title={v.label}
                  className={`p-1.5 rounded-lg transition-all ${
                    구성모양 === v.id ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  <v.icon size={13} />
                </button>
              ))}
            </div>
          </div>
          {구성모양 === "지도" ? (
            <자산지도
              칸들={지도칸들}
              가림={금액가리기}
              onSelect={(이름) => {
                /* 지도 칸은 이름만 안다. 종목별일 때만 종목으로 보낸다 —
                   '국내주식' 이나 '연금저축' 을 종목코드로 열 수는 없다 */
                if (chartMode !== "stock") return;
                const 것 = allDisplayEnriched.find((e) => (e.name || e.symbol) === 이름 || e.symbol === 이름);
                if (것) navigate(`/stocks/${것.market}/${encodeURIComponent(것.symbol)}`);
              }}
            />
          ) : activePieData.length > 0 ? (
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 items-center sm:items-start">
              {/* 파이 차트 */}
              <div className="flex-shrink-0 w-full sm:w-44">
                <차트틀 height={180}>
                  {(R) => (
                  <R.PieChart key={chartMode}>
                    <R.Pie
                      data={activePieData} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" outerRadius={72} innerRadius={30}
                      isAnimationActive animationBegin={0} animationDuration={700} animationEasing="ease-out"
                    >
                      {activePieData.map((_, i) => (
                        <R.Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </R.Pie>
                    <R.Tooltip
                      contentStyle={{
                        background: "var(--bg-card)", border: "1px solid var(--border-default)",
                        borderRadius: 8, fontSize: 11, color: "var(--text-primary)",
                      }}
                      itemStyle={{ color: "var(--text-primary)" }}
                      labelStyle={{ color: "var(--text-muted)", display: "none" }}
                      formatter={(v: number) => [돈.원줄임(Number(v)), ""]}
                    />
                  </R.PieChart>
                  )}
                </차트틀>
              </div>
              {/* 우측 목록 */}
              <div className="flex-1 min-w-0 w-full self-center flex flex-col gap-0.5 py-1">
                {pieLegend.map((entry, i) => {
                    const pct = entry.pct;
                    return (
                      <div key={entry.name} className="flex items-center gap-2 py-1">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="flex-1 text-xs text-text-secondary truncate min-w-0">{entry.name}</span>
                        <div className="flex-shrink-0 w-16 h-1.5 bg-bg-elevated rounded-full overflow-hidden hidden sm:block">
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${Math.min(100, pct)}%`, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        </div>
                        <span className="text-xs font-mono font-semibold text-text-primary w-10 text-right flex-shrink-0">
                          {pct.toFixed(1)}%
                        </span>
                        <span className="text-xs font-mono text-text-muted text-right flex-shrink-0 w-20 hidden sm:block">
                          {돈.원줄임(entry.value)}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-text-muted text-sm">데이터 없음</div>
          )}
        </Card>
      )}

      {/* ── 보유 종목 ──
          바깥 상자를 되돌렸다.
          안쪽 종목 카드와 테두리가 겹쳐 보인다는 이유로 뺐는데, 없애고
          보니 보유 종목 묶음이 어디서 시작하고 끝나는지가 흐릿해졌다.
          겹쳐 보이는 것보다 경계가 없는 쪽이 더 불편하다.

          '자산' 탭에만 둔다. 이 화면을 여는 가장 흔한 이유라 기본 탭이다. */}
      {속탭 === "자산" && (
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border flex-wrap">
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-sm font-semibold text-text-primary whitespace-nowrap">보유 종목</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-bg-secondary text-text-muted font-semibold whitespace-nowrap">
              {isLoggedIn ? items.length : "예시"}
            </span>
            {isLoggedIn && isLoading && <div className="w-3.5 h-3.5 border-2 border-accent-blue border-t-transparent rounded-full animate-spin flex-shrink-0" />}
            {isLoggedIn && priceSymbols.length > 0 && (
              <LiveBadge status={live.status} updatedAt={live.updatedAt}
                         session={live.session} sessionLabel={live.sessionLabel} />
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 원화/외화 표시 모드 토글 (해외 보유종목이 있을 때만) — 둘 중 하나만 표시 */}
            {hasForexHoldings && (
              <div className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary flex-shrink-0" title="해외 보유종목의 가격 표시 기준 통화" aria-label="해외 보유종목의 가격 표시 기준 통화">
                <button
                  onClick={() => setCurrencyMode("krw")}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-2xs font-semibold transition-all whitespace-nowrap ${
                    currencyMode === "krw" ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  <DollarSign size={11} className="flex-shrink-0" />원화
                </button>
                <button
                  onClick={() => setCurrencyMode("native")}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-2xs font-semibold transition-all whitespace-nowrap ${
                    currencyMode === "native" ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  <DollarSign size={11} className="flex-shrink-0" />외화
                </button>
              </div>
            )}
            {/* 표/카드 보기 토글 */}
            <div className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary flex-shrink-0">
              <button
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded-lg transition-all ${viewMode === "table" ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"}`}
                title="표로 보기"
              >
                <Table2 size={13} />
              </button>
              <button
                onClick={() => setViewMode("card")}
                className={`p-1.5 rounded-lg transition-all ${viewMode === "card" ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"}`}
                title="카드로 보기"
              >
                <LayoutGrid size={13} />
              </button>
            </div>
            {isLoggedIn ? (
              !isAllView && (
                <>
                  {/* 버튼이 '현금' 과 '추가' 둘이었다. 담는 사람에게는
                      같은 일이라 하나로 합쳤다 — 창 안에서 종류를 고른다 */}
                  <button
                    onClick={() => { setEditItem(undefined); setModalOpen(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue transition-colors whitespace-nowrap flex-shrink-0"
                  >
                    <Plus size={13} /> 추가
                  </button>
                </>
              )
            ) : (
              <span className="px-2.5 py-1 rounded-lg bg-bg-elevated border border-border text-xs text-text-muted font-semibold whitespace-nowrap flex-shrink-0">
                예시 데이터
              </span>
            )}
          </div>
        </div>

        {/* ── 자산유형 필터 탭 ── */}
        {((isLoggedIn && items.length > 0) || !isLoggedIn) && (
          <div className="px-3 pt-2.5 pb-1 overflow-x-auto scrollbar-hide">
            <Tabs
              ariaLabel="자산유형 필터"
              fill={false}
              size="xs"
              className="w-fit"
              tabs={ASSET_FILTER_TABS}
              active={assetFilterTab}
              onChange={(id) => setAssetFilterTab(id as any)}
            />
          </div>
        )}

        {/* 로그인 상태에서 보유종목 불러오는 중 — 빈 상태로 단정하지 않고 스켈레톤만 표시 */}
        {isLoggedIn && itemsLoading ? (
          <div className="p-3"><RowSkeleton rows={3} /></div>
        ) : isLoggedIn && 못받음 ? (
          /* 돈이 걸린 화면이라 특히 갈라야 한다. 손익이 0 으로 보이는 것이
             진짜 0 인지 못 받은 건지 알 수 없으면 화면을 믿을 수 없다 */
          <못불러옴 사유={실패사유} 다시={() => 다시받기()} />
        ) : isLoggedIn && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-14 h-14 rounded-2xl bg-bg-elevated border border-border flex items-center justify-center">
              <Wallet size={24} className="text-text-muted" />
            </div>
            <div className="text-center">
              <p className="text-text-primary font-semibold text-sm">보유 종목 없음</p>
              <p className="text-text-muted text-xs mt-1">
                {isAllView
                  ? "위에서 포트폴리오를 선택하면 종목을 추가할 수 있어요"
                  : "+ 추가 버튼으로 종목을 등록하세요"}
              </p>
            </div>
            {/* "전체"는 담을 포트폴리오가 정해지지 않아 추가 버튼을 두지 않는다.
               대신 위 안내로 어디로 가야 하는지 알려준다 */}
            {!isAllView && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setEditItem(undefined); setModalOpen(true); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:bg-accent-blue transition-colors"
                >
                  <Plus size={14} /> 첫 자산 담기
                </button>
              </div>
            )}
          </div>
        ) : viewMode === "card" ? (
          <>
            {/* 카드 정렬 */}
            {isLoggedIn && (
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border overflow-x-auto scrollbar-hide">
                <span className="text-xs text-text-dim flex-shrink-0">정렬</span>
                {([
                  { field: "name",    label: "이름" },
                  { field: "shares",  label: "수량" },
                  { field: "value",   label: "평가금액" },
                  { field: "pnl",     label: "손익" },
                  { field: "pnlRate", label: "수익률" },
                  { field: "weight",  label: "비중" },
                ] as { field: SortField; label: string }[]).map(({ field, label }) => {
                  const active = sortField === field;
                  return (
                    <button
                      key={field}
                      onClick={() => toggleSort(field)}
                      className={`flex items-center gap-0.5 px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-colors ${
                        active ? "bg-accent-blue/15 text-accent-blue" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"
                      }`}
                    >
                      {label}
                      {active
                        ? (sortDir === "desc" ? <ChevronDown size={11} /> : <ChevronUp size={11} />)
                        : <ChevronsUpDown size={11} className="opacity-30" />}
                    </button>
                  );
                })}
              </div>
            )}
            {/* 카드형 리스트 */}
            <div className="flex flex-col gap-2.5 p-3">
              {displayEnriched.map((item) => (
                <HoldingCard
                  key={item.id}
                  item={item}
                  hasPrice={item.assetClass === "현금" ? true : (isLoggedIn ? priceMap[item.id] != null : previewLoaded)}
                  pnlClass={pnlColor(item.pnlKRW)}
                  showAsNative={item.isForexItem && currencyMode === "native"}
                  exchangeRate={exchangeRate}
                  isAllView={isAllView}
                  isLoggedIn={isLoggedIn}
                  배당={배당정보[배당키(item.market, item.symbol)]}
                  onNavigate={handleRowNavigate}
                  onEdit={handleRowEdit}
                  onDelete={handleRowDelete}
                  onPrefetch={prefetchStock}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="relative overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs min-w-[820px]">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <SortHead field="name"    label="종목명"      sortField={sortField} sortDir={sortDir} onClick={toggleSort} align="left" />
                  {isAllView && <th className="px-3 py-2.5 font-medium text-text-muted whitespace-nowrap text-left text-xs">포트폴리오</th>}
                  <th className="px-3 py-2.5 font-medium text-text-muted whitespace-nowrap text-right text-xs">시장</th>
                  <SortHead field="shares"  label="보유수량"    sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                  <th className="px-3 py-2.5 font-semibold text-text-muted whitespace-nowrap text-right">평단가</th>
                  <th className="px-3 py-2.5 font-semibold text-text-muted whitespace-nowrap text-right">현재가</th>
                  <SortHead field="value"   label="평가금액(₩)" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                  <SortHead field="pnl"     label="평가손익(₩)" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                  <SortHead field="pnlRate" label="수익률"      sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                  <SortHead field="weight"  label="비중"        sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                  <th className="px-3 py-2.5 font-semibold text-text-muted whitespace-nowrap text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {displayEnriched.map((item) => (
                  <HoldingTableRow
                    key={item.id}
                    item={item}
                    hasPrice={item.assetClass === "현금" ? true : (isLoggedIn ? priceMap[item.id] != null : previewLoaded)}
                    pnlClass={pnlColor(item.pnlKRW)}
                    showAsNative={item.isForexItem && currencyMode === "native"}
                    exchangeRate={exchangeRate}
                    isAllView={isAllView}
                    isLoggedIn={isLoggedIn}
                    배당={배당정보[배당키(item.market, item.symbol)]}
                    onNavigate={handleRowNavigate}
                    onEdit={handleRowEdit}
                    onDelete={handleRowDelete}
                    onPrefetch={prefetchStock}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td className="px-3 py-2.5 font-semibold text-text-muted text-xs" colSpan={isAllView ? 5 : 4}>합계</td>
                  <td />
                  {(isLoggedIn ? pricesLoading : !previewLoaded) ? (
                    <>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-text-muted whitespace-nowrap">—</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-text-muted whitespace-nowrap">—</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-text-muted whitespace-nowrap">—</td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-text-primary whitespace-nowrap">{돈.원(displaySummary.totalValue)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono font-bold whitespace-nowrap ${pnlColor(displaySummary.totalPnl)}`}>{돈.원부호(displaySummary.totalPnl)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono font-bold whitespace-nowrap ${pnlColor(displaySummary.totalRate)}`}>
                        {displaySummary.totalRate >= 0 ? "+" : ""}{displaySummary.totalRate.toFixed(2)}%
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2.5 text-right font-mono text-text-muted whitespace-nowrap">100%</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      )}

      {/* ── 종목 추가/수정 모달 ── */}
      {isLoggedIn && (modalOpen || editItem) && (
        <PortfolioModal
          item={editItem}
          defaultFx={exchangeRate}
          onClose={() => { setModalOpen(false); setEditItem(undefined); setModalError(null); }}
          onSave={editItem ? handleEdit : handleAdd}
          isSaving={addMutation.isPending || editMutation.isPending}
          saveError={modalError}
        />
      )}

      {/* ── 종목 삭제 확인 모달 ── */}
      {deleteTarget && (
        <ConfirmDeleteModal
          title="종목을 삭제할까요?" aria-label="종목을 삭제할까요?"
          description={
            <>
              <span className="font-semibold text-text-primary">{deleteTarget.name || deleteTarget.symbol}</span>
              <span className="font-mono text-text-dim"> ({deleteTarget.symbol})</span> 보유 내역을 삭제합니다. 이 작업은 되돌릴 수 없어요.
            </>
          }
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
          isDeleting={deleteMutation.isPending}
        />
      )}

      {/* ── 포트폴리오 삭제 확인 모달 ── */}
      {deletePortfolioTarget && (
        <ConfirmDeleteModal
          title="포트폴리오를 삭제할까요?" aria-label="포트폴리오를 삭제할까요?"
          description={
            <>
              <span className="font-semibold text-text-primary">{deletePortfolioTarget.name}</span>
              <span className="text-text-dim"> ({deletePortfolioTarget.count}개 종목)</span> 포트폴리오를 삭제합니다. 포함된 보유 종목도 함께 삭제되며, 이 작업은 되돌릴 수 없어요.
            </>
          }
          onClose={() => setDeletePortfolioTarget(null)}
          onConfirm={handleConfirmDeletePortfolio}
          isDeleting={deletePortfolioMutation.isPending}
        />
      )}

      {/* ── 포트폴리오 관리 모달 ── */}
      {showPortfolioManager && (
        <PortfolioManagerModal
          portfolios={portfolios}
          onClose={() => setShowPortfolioManager(false)}
          onRename={(id, name) => renamePortfolioMutation.mutate({ id, name })}
          onDelete={(pf) => { setDeletePortfolioTarget(pf); setShowPortfolioManager(false); }}
          onReorder={(order) => reorderPortfoliosMutation.mutate(order)}
          onAdd={(name) => createPortfolioMutation.mutate(name)}
        />
      )}

    </div>
  );
}
