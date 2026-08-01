import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { stocksApi, portfolioApi, watchlistApi } from "@/api/stocks";
import { useLivePrices } from "@/hooks/useLivePrices";
import LiveBadge from "@/components/ui/LiveBadge";
import { Card, RowSkeleton, Tabs, UnderlineTabs } from "@/components/ui";
import { ASSET_PAGE_TABS } from "@/constants/tabs";
import { Plus, Wallet, LogIn, ChevronUp, ChevronDown, ChevronsUpDown, LayoutGrid, Table2, DollarSign, Landmark, Receipt, TrendingUp, TrendingDown, Percent, Settings2, RefreshCw } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useSettingsStore } from "@/store/settingsStore";
import { usePnlColors } from "@/hooks/usePnlColors";
import { fmtKRWCompact, fmtKRWFull, fmtKRWFullSign } from "@/utils/formatters";
import { mergeEffectivePrices, indexPricesBySymbol, lookupPrice } from "@/utils/prices";
import { extractErrorMessage } from "@/utils/errors";
import { withNativeValues } from "@/utils/holdings";
import { useExchangeRate } from "@/hooks/useExchangeRate";
import { type AssetClass, resolveAssetClass } from "@/utils/assetClass";
import type { Market, ChartMode, PortfolioItem, SelectedPortfolio, PortfolioMeta, EnrichedItem } from "@/types/portfolio";
import {
  PortfolioModal, CashModal, ConfirmDeleteModal, PortfolioPill,
  PortfolioFilterDropdown, AddPortfolioButton, PortfolioManagerModal,
} from "@/components/portfolio/PortfolioModals";
import { SortHead, HoldingCard, HoldingTableRow, type SortField } from "@/components/portfolio/HoldingRow";


/* ── Constants ─────────────────────────────────────────── */
const PIE_COLORS  = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4","#f97316","#84cc16","#ec4899","#14b8a6","#6366f1"];

/* ── 미리보기 예시 데이터 (비로그인 시 표시) ────────────────── */
type PreviewEnrichedBase = Omit<EnrichedItem, "isForexItem" | "nativeAvgPrice" | "nativeValue" | "nativePnl">;

const PREVIEW_ENRICHED: PreviewEnrichedBase[] = [
  { id: -1, symbol: "005930", market: "KR", name: "삼성전자",   shares: 50,  avgPrice: 100000, currency: "KRW",
    currentPriceNative: 72400,  currentValueKRW: 3_620_000,  costKRW: 5_000_000,  pnlKRW: -1_380_000, pnlRate: -27.60, weight:  4.7 },
  { id: -2, symbol: "NVDA",   market: "US", name: "엔비디아",   shares: 50,  avgPrice: 110,   currency: "USD", inputExchangeRate: 1320,
    currentPriceNative: 875,    currentValueKRW: 57_750_000, costKRW: 7_260_000,  pnlKRW: 50_490_000, pnlRate: 695.45, weight: 74.2 },
  { id: -3, symbol: "AAPL",   market: "US", name: "애플",       shares: 30,  avgPrice: 172,   currency: "USD", inputExchangeRate: 1310,
    currentPriceNative: 195,    currentValueKRW: 7_663_500,  costKRW: 6_759_600,  pnlKRW:  903_900, pnlRate: 13.37, weight:  9.8 },
  { id: -4, symbol: "000660", market: "KR", name: "SK하이닉스", shares: 10,  avgPrice: 300000, currency: "KRW",
    currentPriceNative: 185000, currentValueKRW: 1_850_000,  costKRW: 3_000_000,  pnlKRW: -1_150_000, pnlRate: -38.33, weight:  2.4 },
  { id: -5, symbol: "SPY",    market: "ETF", name: "SPDR S&P500 ETF", shares: 10, avgPrice: 420, currency: "USD", inputExchangeRate: 1300,
    currentPriceNative: 535,    currentValueKRW: 6_955_000,  costKRW: 5_460_000,  pnlKRW: 1_495_000, pnlRate: 27.38, weight:  8.9 },
];
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


/* ── Main Page ──────────────────────────────────────────── */
export default function Portfolio() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modalOpen,       setModalOpen]       = useState(false);
  const [editItem,        setEditItem]        = useState<PortfolioItem | undefined>(undefined);
  const [cashModalOpen,   setCashModalOpen]   = useState(false);
  const [cashEditItem,    setCashEditItem]    = useState<PortfolioItem | undefined>(undefined);
  const [deleteTarget,    setDeleteTarget]    = useState<PortfolioItem | null>(null);
  const [chartMode,       setChartMode]       = useState<ChartMode>("stock");
  const [modalError,      setModalError]      = useState<string | null>(null);
  const [viewMode,        setViewMode]        = useState<"table" | "card">(
    () => (typeof window !== "undefined" && window.innerWidth < 640) ? "card" : "table"
  );
  const [currencyMode,    setCurrencyMode]    = useState<"krw" | "native">("krw"); // 해외종목 원화/외화 표시 모드
  const [assetFilterTab,  setAssetFilterTab]  = useState<AssetClass | "전체">("전체");

  const { isLoggedIn } = useAuthStore();
  const { colorScheme } = useSettingsStore();

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
  const totalItemCount = portfolios.reduce((s, p) => s + p.count, 0);

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
  const { data: allItems = [], isLoading: itemsLoading } = useQuery<PortfolioItem[]>({
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

  const { data: batchPrices, isLoading: pricesLoading } = useQuery({
    queryKey:       ["portfolio-prices", priceableItems.map((i) => `${i.market}:${i.symbol}`).join(",")],
    queryFn:        () => watchlistApi.getPrices(priceableItems.map((i) => i.symbol), priceableItems.map((i) => i.market)),
    enabled:        priceableItems.length > 0,
    staleTime:      120_000,
    // WebSocket은 서버 상한 때문에 최대 50종목만 흘려준다. 이 조회가 한 번만 돌면
    // 51번째부터는 첫 값에 고정되므로, 실시간이 닿지 않는 종목을 위해 주기 갱신을 켠다
    refetchInterval: 120_000,
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
    queryFn:        () => watchlistApi.getPrices(PREVIEW_ENRICHED.map((i) => i.symbol), PREVIEW_ENRICHED.map((i) => i.market)),
    enabled:        !isLoggedIn,
    staleTime:      120_000,
    refetchInterval:120_000,
  });
  // 실시간 현재가를 아직 못 불러왔으면(=null) 정적 예시가를 절대 보여주지 않음 — 실데이터 도착 후에만 표시
  const previewLoaded = previewBatchPrices != null;

  const previewEnrichedLive = useMemo<EnrichedItem[]>(() => {
    const list = PREVIEW_ENRICHED.map((base, i) => {
      const d = previewBatchPrices?.[i] as any;
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
      return withNativeValues(
        { ...base, currentPriceNative, currentValueKRW, costKRW, pnlKRW, pnlRate, weight: 0 },
        exchangeRate,
      );
    });
    const totalKRW = list.reduce((s, e) => s + e.currentValueKRW, 0);
    return list.map((e) => ({ ...e, weight: totalKRW > 0 ? (e.currentValueKRW / totalKRW) * 100 : 0 }));
  }, [previewBatchPrices, exchangeRate]);

  const previewSummaryLive = useMemo(() => {
    const totalValue = previewEnrichedLive.reduce((s, e) => s + e.currentValueKRW, 0);
    const totalCost  = previewEnrichedLive.reduce((s, e) => s + e.costKRW, 0);
    const totalPnl   = totalValue - totalCost;
    const totalRate  = totalCost !== 0 ? (totalPnl / totalCost) * 100 : 0;
    return { totalValue, totalCost, totalPnl, totalRate, totalDailyChangeKRW: 0, totalDailyChangeRate: 0 };
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

      // 일일 등락(원화 기준) — change_rate(%)로 전일 평가금액을 역산
      const changeRate = changeRateMap[item.id];
      const dailyChangeKRW = changeRate != null
        ? currentValueKRW - currentValueKRW / (1 + changeRate / 100)
        : 0;

      return withNativeValues(
        { ...item, currentPriceNative, currentValueKRW, costKRW, pnlKRW, pnlRate, weight: 0, dailyChangeKRW },
        exchangeRate,
      );
    });

    const totalKRW = list.reduce((s, e) => s + e.currentValueKRW, 0);
    return list.map((e) => ({
      ...e,
      weight: totalKRW > 0 ? (e.currentValueKRW / totalKRW) * 100 : 0,
    }));
  }, [filteredItems, priceMap, changeRateMap, exchangeRate]);

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

  /* ── 정렬된 enriched ── */
  const sortedEnriched = useMemo(() => {
    if (!sortField) return enriched;
    return [...enriched].sort((a, b) => {
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
  }, [enriched, sortField, sortDir]);

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
  const handleCashAdd = (data: Omit<PortfolioItem, "id">) => {
    setModalError(null);
    addMutation.mutate(data, { onSuccess: () => { setCashModalOpen(false); setModalError(null); } });
  };
  const handleCashEdit = (data: Omit<PortfolioItem, "id">) => {
    if (!cashEditItem) return;
    setModalError(null);
    editMutation.mutate({ id: cashEditItem.id, data }, { onSuccess: () => { setCashEditItem(undefined); setModalError(null); } });
  };
  const openEditModal = useCallback((item: PortfolioItem) => {
    if (item.assetClass === "현금") setCashEditItem(item);
    else setEditItem(item);
  }, []);

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

  /* ── 미리보기 vs 실데이터 ── */
  const allDisplayEnriched = isLoggedIn ? sortedEnriched : previewEnrichedLive;
  const displayEnriched = useMemo(
    () => assetFilterTab === "전체"
      ? allDisplayEnriched
      : allDisplayEnriched.filter((e) => resolveAssetClass(e) === assetFilterTab),
    [allDisplayEnriched, assetFilterTab],
  );
  const hasForexHoldings = useMemo(
    () => displayEnriched.some((e) => e.market === "US" || e.market === "ETF"),
    [displayEnriched],
  );
  /* 자산유형 탭을 고르면 합계도 그 유형만 센다 — '국내주식'을 누르면
     국내주식 합계, '채권'을 누르면 채권 합계. '전체'일 때만 통째로 센다.
     (미리보기는 오늘 등락을 계산하지 않으므로 그 값만 0으로 둔다) */
  const displaySummary = useMemo(() => {
    if (assetFilterTab === "전체") return isLoggedIn ? summary : previewSummaryLive;
    const s = 합계내기(displayEnriched);
    return isLoggedIn ? s : { ...s, totalDailyChangeKRW: 0, totalDailyChangeRate: 0 };
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
            <LogIn size={15} className="text-accent-blue" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-text-primary">미리보기 모드</p>
            <p className="text-xs text-text-muted mt-0.5">아래는 예시 데이터입니다. 로그인하면 내 종목을 직접 추가·관리할 수 있어요.</p>
          </div>
          <Link to="/login"
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-blue-600 transition-colors"
          >
            <LogIn size={12} /> 로그인
          </Link>
        </div>
      )}

      {/* ── 헤더 ── */}
      {/* 좁은 화면에서는 제목과 버튼을 세로로 쌓는다.
          한 줄에 나란히 두면 버튼 개수(포트폴리오 수에 따라 늘어남)에 밀려 제목이
          찌그러지고, 한글은 글자 사이에서도 줄바꿈돼 세로로 쪼개진다. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-text-primary whitespace-nowrap">내 자산</h1>
          <p className="text-text-muted text-xs mt-0.5 truncate">
            {isLoggedIn && itemsLoading ? "보유 종목 불러오는 중..." : (
              <>
                {displayEnriched.length}개 종목
                <span className="hidden sm:inline"> · 클릭하면 상세로 이동</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:justify-end">
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
          {/* 관심종목의 "폴더 관리 / 종목 추가"와 같은 위치·형태로 맞춘다 */}
          {isLoggedIn && (
            <>
              {portfolios.length > 0 && (
                <button
                  onClick={() => setShowPortfolioManager(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all whitespace-nowrap"
                  title="포트폴리오 추가/편집"
                >
                  <Settings2 size={13} />포트폴리오 관리
                </button>
              )}
              {/* "전체"는 여러 포트폴리오를 모아 보는 화면이라 어디에 담을지가 모호하다.
                  종목 추가는 특정 포트폴리오를 고른 상태에서만 노출한다 */}
              {!isAllView && (
                <button
                  onClick={() => { setEditItem(undefined); setModalOpen(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 transition-all whitespace-nowrap"
                >
                  <Plus size={13} />종목 추가
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── 요약 카드 ── */}
      {/* 보유종목이 실제로 연동(로그인 + 종목 추가)되기 전에는 미리보기 수치를 보여주지 않음 */}
      {/* 로그인 상태에서는 현재가를 다 불러오기 전까지 매입가 기반 추정치를 보여주지 않고 로딩 표시만 함 */}
      {((isLoggedIn && items.length > 0 && pricesLoading) || (!isLoggedIn && !previewLoaded)) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {["총 평가금액", "총 매입금액", "평가손익", "수익률"].map((label) => (
            <Card key={label} className="flex flex-col gap-1">
              <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide">{label}</span>
              <div className="h-4 w-20 rounded bg-bg-elevated animate-pulse mt-0.5" />
            </Card>
          ))}
        </div>
      )}
      {((isLoggedIn && items.length > 0 && !pricesLoading) || (!isLoggedIn && previewLoaded)) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: `${요약범위} 평가금액`, value: fmtKRWFull(displaySummary.totalValue), color: "text-text-primary", icon: Landmark, tint: "" },
            { label: `${요약범위} 매입금액`, value: fmtKRWFull(displaySummary.totalCost),  color: "text-text-primary", icon: Receipt,  tint: "" },
            { label: "평가손익",   value: fmtKRWFullSign(displaySummary.totalPnl),  color: pnlColor(displaySummary.totalPnl),
              icon: displaySummary.totalPnl >= 0 ? TrendingUp : TrendingDown,
              tint: displaySummary.totalPnl >= 0 ? "bg-accent-red/5 border-accent-red/20" : "bg-accent-blue/5 border-accent-blue/20" },
            { label: "수익률",     value: `${displaySummary.totalRate >= 0 ? "+" : ""}${displaySummary.totalRate.toFixed(2)}%`, color: pnlColor(displaySummary.totalRate),
              icon: Percent,
              tint: displaySummary.totalRate >= 0 ? "bg-accent-red/5 border-accent-red/20" : "bg-accent-blue/5 border-accent-blue/20" },
          ].map((c) => (
            <Card key={c.label} className={`flex flex-col gap-1 ${c.tint} ${!isLoggedIn ? "opacity-80" : ""}`}>
              <div className="flex items-center gap-1.5">
                <c.icon size={12} className={c.color === "text-text-primary" ? "text-text-dim" : c.color} />
                <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide">{c.label}</span>
              </div>
              <span className={`text-lg font-mono font-bold ${c.color}`}>{c.value}</span>
              {c.label.endsWith("평가금액") && (
                <span className="text-[10px] text-text-dim">환율 {Math.round(exchangeRate).toLocaleString("ko-KR")}원</span>
              )}
              {c.label === "평가손익" && (
                <span className={`text-[10px] font-mono ${pnlColor(displaySummary.totalDailyChangeKRW)}`}>
                  오늘 {fmtKRWFullSign(displaySummary.totalDailyChangeKRW)}
                </span>
              )}
              {c.label === "수익률" && (
                <span className={`text-[10px] font-mono ${pnlColor(displaySummary.totalDailyChangeRate)}`}>
                  오늘 {displaySummary.totalDailyChangeRate >= 0 ? "+" : ""}{displaySummary.totalDailyChangeRate.toFixed(2)}%
                </span>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ── 구성 차트 ── */}
      {((isLoggedIn && items.length > 0 && isLoading) || (!isLoggedIn && !previewLoaded)) && (
        <Card className="flex items-center justify-center h-[180px] text-text-muted text-sm">
          가격 불러오는 중...
        </Card>
      )}
      {hasDisplay && (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-border -mx-4 px-4 pb-0">
            <div className="flex">
              {([
                { id: "stock",  label: "종목별" },
                { id: "market", label: "자산유형별" },
                ...(isAllView && portfolios.length > 1 ? [{ id: "portfolio", label: "포트폴리오별" }] : []),
              ] as { id: ChartMode; label: string }[]).map(({ id, label }) => (
                <button key={id} onClick={() => setChartMode(id)}
                  className={`px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-all ${
                    chartMode === id ? "border-accent-blue text-accent-blue" : "border-transparent text-text-muted hover:text-text-primary"
                  }`}
                >{label}</button>
              ))}
            </div>
          </div>
          {activePieData.length > 0 ? (
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 items-center sm:items-start">
              {/* 파이 차트 */}
              <div className="flex-shrink-0 w-full sm:w-44">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart key={chartMode}>
                    <Pie
                      data={activePieData} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" outerRadius={72} innerRadius={30}
                      isAnimationActive animationBegin={0} animationDuration={700} animationEasing="ease-out"
                    >
                      {activePieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "#1e2435", border: "1px solid #2d3655", borderRadius: 8, fontSize: 11, color: "#e2e8f0" }}
                      itemStyle={{ color: "#e2e8f0" }}
                      labelStyle={{ color: "#94a3b8", display: "none" }}
                      formatter={(v: any) => [fmtKRWCompact(Number(v)), ""]}
                    />
                  </PieChart>
                </ResponsiveContainer>
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
                          {fmtKRWCompact(entry.value)}
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

      {/* ── 보유 종목 ── */}
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
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-2xs font-semibold transition-all whitespace-nowrap ${
                    currencyMode === "krw" ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  <DollarSign size={11} className="flex-shrink-0" />원화
                </button>
                <button
                  onClick={() => setCurrencyMode("native")}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-2xs font-semibold transition-all whitespace-nowrap ${
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
                className={`p-1.5 rounded-md transition-all ${viewMode === "table" ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"}`}
                title="표로 보기"
              >
                <Table2 size={13} />
              </button>
              <button
                onClick={() => setViewMode("card")}
                className={`p-1.5 rounded-md transition-all ${viewMode === "card" ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"}`}
                title="카드로 보기"
              >
                <LayoutGrid size={13} />
              </button>
            </div>
            {isLoggedIn ? (
              !isAllView && (
                <>
                  <button
                    onClick={() => { setCashEditItem(undefined); setCashModalOpen(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-text-secondary text-xs font-semibold hover:border-accent-blue/40 hover:text-accent-blue transition-colors whitespace-nowrap flex-shrink-0"
                  >
                    <DollarSign size={13} /> 현금
                  </button>
                  <button
                    onClick={() => { setEditItem(undefined); setModalOpen(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-blue-600 transition-colors whitespace-nowrap flex-shrink-0"
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
                  onClick={() => { setCashEditItem(undefined); setCashModalOpen(true); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-text-secondary text-sm font-semibold hover:border-accent-blue/40 hover:text-accent-blue transition-colors"
                >
                  <DollarSign size={14} /> 현금 추가
                </button>
                <button
                  onClick={() => { setEditItem(undefined); setModalOpen(true); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:bg-blue-600 transition-colors"
                >
                  <Plus size={14} /> 첫 종목 추가
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
                      className={`flex items-center gap-0.5 px-2 py-1 rounded-md text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-colors ${
                        active ? "bg-accent-blue/15 text-accent-blue" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"
                      }`}
                    >
                      {label}
                      {active
                        ? (sortDir === "desc" ? <ChevronDown size={10} /> : <ChevronUp size={10} />)
                        : <ChevronsUpDown size={10} className="opacity-30" />}
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
                  <SortHead field="name"    label="종목명"      sortField={isLoggedIn ? sortField : null} sortDir={sortDir} onClick={isLoggedIn ? toggleSort : () => {}} align="left" />
                  {isAllView && <th className="px-3 py-2.5 font-medium text-text-muted whitespace-nowrap text-left text-xs">포트폴리오</th>}
                  <th className="px-3 py-2.5 font-medium text-text-muted whitespace-nowrap text-right text-xs">시장</th>
                  <SortHead field="shares"  label="보유수량"    sortField={isLoggedIn ? sortField : null} sortDir={sortDir} onClick={isLoggedIn ? toggleSort : () => {}} />
                  <th className="px-3 py-2.5 font-semibold text-text-muted whitespace-nowrap text-right">평단가</th>
                  <th className="px-3 py-2.5 font-semibold text-text-muted whitespace-nowrap text-right">현재가</th>
                  <SortHead field="value"   label="평가금액(₩)" sortField={isLoggedIn ? sortField : null} sortDir={sortDir} onClick={isLoggedIn ? toggleSort : () => {}} />
                  <SortHead field="pnl"     label="평가손익(₩)" sortField={isLoggedIn ? sortField : null} sortDir={sortDir} onClick={isLoggedIn ? toggleSort : () => {}} />
                  <SortHead field="pnlRate" label="수익률"      sortField={isLoggedIn ? sortField : null} sortDir={sortDir} onClick={isLoggedIn ? toggleSort : () => {}} />
                  <SortHead field="weight"  label="비중"        sortField={isLoggedIn ? sortField : null} sortDir={sortDir} onClick={isLoggedIn ? toggleSort : () => {}} />
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
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-text-primary whitespace-nowrap">{fmtKRWFull(displaySummary.totalValue)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono font-bold whitespace-nowrap ${pnlColor(displaySummary.totalPnl)}`}>{fmtKRWFullSign(displaySummary.totalPnl)}</td>
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

      {/* ── 현금 추가/수정 모달 ── */}
      {isLoggedIn && (cashModalOpen || cashEditItem) && (
        <CashModal
          item={cashEditItem}
          onClose={() => { setCashModalOpen(false); setCashEditItem(undefined); setModalError(null); }}
          onSave={cashEditItem ? handleCashEdit : handleCashAdd}
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
