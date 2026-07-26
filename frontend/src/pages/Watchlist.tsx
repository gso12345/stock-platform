import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { watchlistApi, watchlistFolderApi, stocksApi, portfolioApi } from "@/api/stocks";
import { Card, ChangeBadge, RowSkeleton, InlineSpinner, MarketBadge, ErrorToast } from "@/components/ui";
import { usePricesStream } from "@/hooks/useWebSocket";
import { normalizeSymbol, lookupPrice } from "@/utils/prices";
import { PREVIEW_FOLDERS, PREVIEW_WATCHLIST, PreviewItemRow, type PreviewItem } from "@/components/watchlist/Preview";
import { ItemRow } from "@/components/watchlist/ItemRow";
import {
  AddModal, EditItemModal, DeleteFolderModal, AddToPortfolioModal, FolderManagerModal, FolderNameEdit,
} from "@/components/watchlist/WatchlistModals";
import { extractErrorMessage } from "@/utils/errors";
import { useDragReorder } from "@/hooks/useDragReorder";
import { fmtKRWFull, fmtUSDFull } from "@/utils/formatters";
import { Plus, Pencil, Trash2, Star, Wallet, ChevronDown, ChevronRight, Settings2, LogIn, Clock, RefreshCw } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { getRecentlyViewed, type RecentStock } from "@/utils/recentlyViewed";
const MARKET_TABS = [
  { id: "전체", label: "전체" },
  { id: "KR",   label: "국내" },
  { id: "US",   label: "해외" },
  { id: "ETF",  label: "ETF"  },
];


/* ── 메인 ────────────────────────────────────────────────── */
export default function Watchlist() {
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();
  const isPreview = !isLoggedIn;
  const [marketTab, setMarketTab]   = useState("전체");
  const [folderTab, setFolderTab]   = useState<number | "all" | "recent">("all"); // 관심종목 폴더 탭
  const [portfolioTab, setPortfolioTab] = useState<number | null>(null); // 포트폴리오 탭 (폴더 탭과 상호배타)
  const [showFolderManager, setShowFolderManager] = useState(false);
  const [recentStocks, setRecentStocks] = useState<RecentStock[]>([]);
  useEffect(() => {
    if (folderTab === "recent") setRecentStocks(getRecentlyViewed());
  }, [folderTab]);
  const recentSymbols = useMemo(() => recentStocks.map((r) => r.symbol), [recentStocks]);
  const recentMarkets = useMemo(() => recentStocks.map((r) => r.market === "KR" ? "KR" : "US"), [recentStocks]);
  const { data: recentPrices } = useQuery({
    queryKey: ["recent-viewed-prices", recentSymbols.join(",")],
    queryFn: ({ signal }) => watchlistApi.getPrices(recentSymbols, recentMarkets, signal),
    enabled: folderTab === "recent" && recentSymbols.length > 0,
    staleTime: 30_000,
  });
  const recentPriceMap = useMemo(() => {
    const map: Record<string, any> = {};
    (recentPrices as any[] ?? []).forEach((p: any, i: number) => { map[recentSymbols[i]] = p; });
    return map;
  }, [recentPrices, recentSymbols]);

  // 포트폴리오 목록 (탭 표시용)
  const { data: pfList = [] } = useQuery<any[]>({
    queryKey: ["portfolios"],
    queryFn: portfolioApi.getPortfolios,
    enabled: isLoggedIn,
    staleTime: 300_000,
  });

  // 선택된 포트폴리오 탭의 보유종목
  const { data: pfTabItems = [], isLoading: pfTabLoading } = useQuery({
    queryKey: ["portfolio-tab-items", portfolioTab],
    queryFn: () => portfolioApi.getItems(portfolioTab ?? undefined),
    enabled: isLoggedIn && portfolioTab !== null && portfolioTab > 0,
    staleTime: 60_000,
  });
  const pfTabDeduped = pfTabItems as any[];
  const pfTabSymbols = useMemo(() => pfTabDeduped.map((i: any) => i.symbol), [pfTabDeduped]);
  const pfTabMarkets = useMemo(() => pfTabDeduped.map((i: any) => i.market === "KR" ? "KR" : "US"), [pfTabDeduped]);
  const { data: pfTabPrices } = useQuery({
    queryKey: ["pf-tab-prices", pfTabSymbols.join(",")],
    queryFn: ({ signal }) => watchlistApi.getPrices(pfTabSymbols, pfTabMarkets, signal),
    enabled: portfolioTab !== null && portfolioTab > 0 && pfTabSymbols.length > 0,
    staleTime: 60_000,
  });
  const pfTabPriceMap = useMemo(() => {
    const map: Record<string, any> = {};
    (pfTabPrices as any[] ?? []).forEach((p: any, i: number) => { if (pfTabSymbols[i]) map[pfTabSymbols[i]] = p; });
    return map;
  }, [pfTabPrices, pfTabSymbols]);
  // 중복 종목도 각각 표시하므로 symbol 기준 가격 공유는 그대로 사용

  const [showAdd, setShowAdd]           = useState(false);
  const [addFolderId, setAddFolderId]   = useState<number | null>(null); // 추가 모달에서 기본 선택될 폴더
  const [editingFolder, setEditingFolder] = useState<number | null>(null);
  const [editingItem, setEditingItem]   = useState<any>(null);
  const [deletingFolder, setDeletingFolder] = useState<any>(null);
  const [addToPortfolioItem, setAddToPortfolioItem] = useState<any | null>(null);
  const [collapsed, setCollapsed]   = useState<Set<string>>(new Set());
  const [livePrices, setLivePrices] = useState<Record<string, any>>({});
  const [addError, setAddError]     = useState("");

  const { data: folders = [] } = useQuery({
    queryKey: ["watchlist-folders"],
    queryFn: watchlistFolderApi.getFolders,
    // 폴더 구조는 자주 바뀌지 않으므로 5분 캐시 — mutation onSuccess에서 invalidate함
    staleTime: 300_000,
  });

  const { data: allItems = [], isLoading } = useQuery({
    queryKey: ["watchlist-items"],
    queryFn: () => watchlistApi.getItems(),
    staleTime: 120_000,
    // 목록 구성은 사용자가 추가·삭제할 때만 바뀐다. 각 mutation의 onSuccess에서
    // invalidate하므로 주기 폴링은 불필요한 요청일 뿐이다 (가격은 별도 쿼리가 갱신)
    refetchInterval: false,
  });

  // 탭 전환 시 API 재호출 없이 클라이언트 필터링
  const items = useMemo(() => {
    if (marketTab === "전체") return allItems as any[];
    return (allItems as any[]).filter((i: any) => i.market === marketTab);
  }, [allItems, marketTab]);

  // 가격 조회는 전체 항목 기준 — 탭 전환해도 캐시 유지
  const symbols = useMemo(() => (allItems as any[]).map((i: any) => i.symbol), [allItems]);
  const markets  = useMemo(() => (allItems as any[]).map((i: any) => i.market === "KR" ? "KR" : "US"), [allItems]);

  /* REST 배치 가격 조회 — signal을 받아 컴포넌트 언마운트/취소 시 HTTP 요청도 중단 */
  const priceKey = useMemo(() => [...symbols].sort().join(","), [symbols]);
  const { data: restPrices } = useQuery({
    queryKey: ["watchlist-prices", priceKey],
    queryFn: ({ signal }) => watchlistApi.getPrices(symbols, markets, signal),
    enabled: symbols.length > 0,
    staleTime: 55_000,
    refetchInterval: 60_000,
  });

  /* 비로그인 미리보기용 실시간 현재가 (예시 관심종목도 실제 시세로 표시) */
  const { data: previewPrices } = useQuery({
    queryKey: ["watchlist-preview-prices"],
    queryFn: () => watchlistApi.getPrices(PREVIEW_WATCHLIST.map((i) => i.symbol), PREVIEW_WATCHLIST.map((i) => i.market)),
    enabled: isPreview,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const previewWatchlistLive: PreviewItem[] = useMemo(() => {
    // 실시간 현재가를 아직 못 불러왔으면 정적 예시가를 보여주지 않고 로딩 상태로 표시
    if (!previewPrices) return PREVIEW_WATCHLIST.map((base) => ({ ...base, hasPrice: false }));
    return PREVIEW_WATCHLIST.map((base, i) => {
      const d = previewPrices[i] as any;
      const hasPrice = d?.price != null;
      return {
        ...base,
        price: hasPrice ? d.price : base.price,
        change_rate: hasPrice ? (d.change_rate ?? base.change_rate) : base.change_rate,
        hasPrice,
      };
    });
  }, [previewPrices]);

  /* 값이 실제로 바뀐 종목만 교체 — 바뀐 게 없으면 이전 객체를 그대로 돌려주어
     불필요한 리렌더(ItemRow 전체 재렌더)를 막는다 */
  const mergePrices = useCallback((incoming: any[], skipSymbols?: Set<string>) => {
    setLivePrices((prev) => {
      let next: Record<string, any> | null = null;
      for (const p of incoming) {
        if (!p?.symbol || p.error || p.price == null) continue;
        const norm = normalizeSymbol(p.symbol);
        if (skipSymbols?.has(norm)) continue;
        const cur = prev[p.symbol];
        if (cur && cur.price === p.price && cur.change_rate === p.change_rate) continue;
        if (!next) next = { ...prev };
        // 서버 응답의 접미사(.KS/.KQ) 유무가 보유 심볼과 다를 수 있어 두 키로 모두 담는다
        next[p.symbol] = p;
        next[norm] = p;
      }
      return next ?? prev;
    });
  }, []);

  /* WebSocket이 담당 중인 종목은 REST 결과로 덮어쓰지 않는다 (이중 갱신 방지).
     단 서버는 최대 50종목만 스트리밍하므로, WS가 실제로 보내준 종목만 건너뛰고
     WS가 한동안 조용하면(연결 끊김 등) 다시 REST 값을 받아들인다. */
  const wsSymbolsRef   = useRef<Set<string>>(new Set());
  const wsLastMsgAtRef = useRef(0);
  const WS_FRESH_MS = 90_000;

  useEffect(() => {
    if (!restPrices?.length) return;
    const wsFresh = Date.now() - wsLastMsgAtRef.current < WS_FRESH_MS;
    mergePrices(restPrices as any[], wsFresh ? wsSymbolsRef.current : undefined);
  }, [restPrices, mergePrices]);

  /* WebSocket — 캐시에 있는 종목 실시간 업데이트 (주 경로) */
  usePricesStream(symbols, markets, useCallback((prices: any[]) => {
    const delivered = new Set<string>();
    for (const p of prices) {
      if (p?.symbol && !p.error && p.price != null) delivered.add(normalizeSymbol(p.symbol));
    }
    wsSymbolsRef.current   = delivered;
    wsLastMsgAtRef.current = Date.now();
    mergePrices(prices);
  }, [mergePrices]), 30);

  const addMutation = useMutation({
    mutationFn: (req: any) => watchlistApi.addItem({ ...req, watchlist_id: 1 }),
    onSuccess: () => {
      setAddError("");
      qc.invalidateQueries({ queryKey: ["watchlist-items"] });
    },
    onError: (err) => setAddError(extractErrorMessage(err, "종목 추가에 실패했습니다")),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => watchlistApi.removeItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist-items"] }),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: any }) => watchlistApi.updateItem(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist-items"] }),
  });


  /* 순서 저장 — 서버 응답을 기다리지 않고 캐시를 먼저 갱신한다.
     예전에는 드롭하는 순간 낙관적 순서를 버려 항목이 원래 자리로 튀었다가,
     저장 후 목록 전체를 다시 받아 60개를 통째로 다시 그렸다. 그 재조회가
     드롭 직후 100ms짜리 멈춤을 만들었고 순서도 두 번 움직여 보였다. */
  const reorderMutation = useMutation({
    mutationFn: (order: number[]) => watchlistApi.reorderItems(order),
    onMutate: async (order: number[]) => {
      await qc.cancelQueries({ queryKey: ["watchlist-items"] });
      const prev = qc.getQueryData(["watchlist-items"]);
      qc.setQueryData(["watchlist-items"], (old: any) => {
        if (!Array.isArray(old)) return old;
        const byId = new Map(old.map((i: any) => [i.id, i]));
        const moved = order.map((id) => byId.get(id)).filter(Boolean);
        const movedIds = new Set(order);
        return [...moved, ...old.filter((i: any) => !movedIds.has(i.id))];
      });
      return { prev };
    },
    // 실패하면 되돌린다. 성공 시에는 캐시가 이미 최신이라 재조회하지 않는다
    onError: (_err, _order, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["watchlist-items"], ctx.prev);
    },
  });


  // 폴더 드래그 상태
  const [dragFolderId, setDragFolderId] = useState<number | null>(null);
  const [dropFolderId, setDropFolderId] = useState<number | null>(null);
  const [localFolderOrder, setLocalFolderOrder] = useState<any[] | null>(null);
  const dragFolderIdRef      = useRef<number | null>(null); // onDragOver 즉시 접근용
  const localFolderOrderRef  = useRef<any[] | null>(null);
  const folderLongPressTimer = useRef<number | null>(null);
  const folderTouchStartPos = useRef<{ x: number; y: number } | null>(null);
  const folderJustDragged = useRef(false);

  const reorderFoldersMutation = useMutation({
    mutationFn: (order: number[]) => watchlistFolderApi.reorderFolders(order),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist-folders"] }),
    onError: () => {
      qc.invalidateQueries({ queryKey: ["watchlist-folders"] });
      setLocalFolderOrder(null);
    },
  });

  const handleFolderDragStart = (folder: any) => {
    dragFolderIdRef.current = folder.id;
    localFolderOrderRef.current = folders as any[];
    setDragFolderId(folder.id);
    setLocalFolderOrder(folders as any[]);
  };

  // 길게 누르기(롱프레스) 후에만 드래그가 시작되도록 — 일반 탭/스크롤과 구분
  const LONG_PRESS_MS = 350;
  const LONG_PRESS_MOVE_TOLERANCE = 8;

  const clearFolderLongPressTimer = () => {
    if (folderLongPressTimer.current !== null) {
      window.clearTimeout(folderLongPressTimer.current);
      folderLongPressTimer.current = null;
    }
  };

  const handleFolderTouchStart = (folder: any, e: React.TouchEvent) => {
    const t = e.touches[0];
    folderTouchStartPos.current = { x: t.clientX, y: t.clientY };
    clearFolderLongPressTimer();
    folderLongPressTimer.current = window.setTimeout(() => {
      handleFolderDragStart(folder);
    }, LONG_PRESS_MS);
  };

  const handleFolderTouchMoveGated = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (dragFolderIdRef.current !== null) {
      // 드래그 활성화된 상태 — 기본 스크롤 동작 막고 순서 변경 처리
      e.preventDefault();
      handleFolderTouchMove(t.clientX, t.clientY);
      return;
    }
    // 롱프레스가 발동하기 전, 손가락이 일정 거리 이상 움직이면 스크롤로 간주하고 취소
    const start = folderTouchStartPos.current;
    if (start) {
      const dx = Math.abs(t.clientX - start.x);
      const dy = Math.abs(t.clientY - start.y);
      if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
        clearFolderLongPressTimer();
      }
    }
  };

  const handleFolderTouchEnd = () => {
    clearFolderLongPressTimer();
    if (dragFolderIdRef.current !== null) {
      folderJustDragged.current = true;
      handleFolderDrop();
    }
    folderTouchStartPos.current = null;
  };

  const handleFolderTabClick = (folderId: number) => {
    if (folderJustDragged.current) {
      folderJustDragged.current = false;
      return;
    }
    setFolderTab(folderTab === folderId ? "all" : folderId);
  };

  const moveFolderTo = (targetId: number) => {
    const fromId = dragFolderIdRef.current;
    if (fromId === null || fromId === targetId) return;
    setDropFolderId(targetId);
    const base = localFolderOrderRef.current ?? (folders as any[]);
    const from = base.findIndex((f: any) => f.id === fromId);
    const to   = base.findIndex((f: any) => f.id === targetId);
    if (from === -1 || to === -1) return;
    const next = [...base];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    localFolderOrderRef.current = next;
    setLocalFolderOrder(next);
  };

  const handleFolderDragOver = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    moveFolderTo(targetId);
  };

  // 모바일 터치 드래그 (폴더 순서 변경)
  const handleFolderTouchMove = (clientX: number, clientY: number) => {
    if (dragFolderIdRef.current === null) return;
    const el = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest("[data-folder-id]") as HTMLElement | null;
    if (!el) return;
    const targetId = Number(el.dataset.folderId);
    if (targetId) moveFolderTo(targetId);
  };

  const handleFolderDrop = () => {
    const order = localFolderOrderRef.current;
    if (dragFolderIdRef.current !== null && order) {
      reorderFoldersMutation.mutate(order.map((f: any) => f.id));
    }
    dragFolderIdRef.current = null;
    localFolderOrderRef.current = null;
    setDragFolderId(null); setDropFolderId(null); setLocalFolderOrder(null);
  };

  const createFolderMutation = useMutation({
    mutationFn: () => watchlistFolderApi.createFolder("새 폴더"),
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ["watchlist-folders"] }); setEditingFolder(data.id); },
  });

  const updateFolderMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => watchlistFolderApi.updateFolder(id, name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["watchlist-folders"] }); setEditingFolder(null); },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id: number) => watchlistFolderApi.deleteFolder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist-folders"] }),
  });

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const itemsList = items as any[];

  /* 종목 드래그 재정렬 — 공용 훅 (ref 기준으로 순서를 계산해 연속 이벤트에서도 밀리지 않는다) */
  const itemDrag = useDragReorder<any>({
    items: itemsList,
    onCommit: (order) => reorderMutation.mutate(order),
  });
  const { dragId, dropId, localOrder } = itemDrag;
  const handleDragStart      = itemDrag.start;
  const handleDragOver       = itemDrag.onDragOver;
  const handleDrop           = itemDrag.drop;
  const handleItemTouchMove  = (clientX: number, clientY: number) =>
    itemDrag.moveToPoint(clientX, clientY, "data-item-id");

  // 드래그 중에는 낙관적으로 정렬된 순서 사용 (탭 필터 적용된 items 기준)
  const baseList = localOrder ?? itemsList;

  // 폴더 탭 필터 적용 — 실시간 시세 갱신마다 재계산되지 않도록 메모이제이션
  const displayList = useMemo(
    () => (folderTab === "all" || folderTab === "recent")
      ? baseList
      : baseList.filter((i: any) => i.folder_id === folderTab),
    [baseList, folderTab]
  );

  // 폴더별로 한 번에 그룹화 — byFolder를 폴더 개수만큼 반복 필터링하던 것을 단일 패스로 변경
  const itemsByFolder = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const item of displayList) {
      const arr = map.get(item.folder_id);
      if (arr) arr.push(item); else map.set(item.folder_id, [item]);
    }
    return map;
  }, [displayList]);
  const byFolder = (fid: number) => itemsByFolder.get(fid) ?? [];

  /* 폴더 탭에 붙는 개수 — 폴더마다 전체 목록을 훑으면 폴더수×종목수가 되므로 한 번만 센다.
     (itemsByFolder는 폴더탭 필터가 적용된 목록 기준이라 탭 개수용으로는 쓸 수 없다) */
  const folderCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const i of itemsList) map.set(i.folder_id, (map.get(i.folder_id) ?? 0) + 1);
    return map;
  }, [itemsList]);

  const createDefaultFolderMutation = useMutation({
    mutationFn: () => watchlistFolderApi.createFolder("기본 관심목록"),
  });

  // 종목은 항상 폴더에 담아야 하므로, 대상 폴더가 없으면 폴더를 먼저 만들고 그 폴더로 추가 모달을 연다
  const openAddModal = async (folderId: number | null) => {
    let fid = folderId;
    if (fid == null) {
      const list = folders as any[];
      if (list.length > 0) fid = list[0].id;
      else {
        const created = await createDefaultFolderMutation.mutateAsync();
        qc.invalidateQueries({ queryKey: ["watchlist-folders"] });
        fid = created.id;
      }
    }
    setAddFolderId(fid);
    setShowAdd(true);
  };

  const goToStock = (item: any) => {
    // 가격 조회 중이라면 취소하고 종목 상세로 이동 (상세 페이지 로딩 우선)
    qc.cancelQueries({ queryKey: ["watchlist-prices"] });
    navigate(`/stocks/${item.market}/${encodeURIComponent(item.symbol)}`);
  };

  // 화면에 보이는 종목 자동 prefetch
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prefetchStock = useCallback((item: any) => {
    const mkt = item.market as any;
    const sym = item.symbol;
    if (qc.getQueryData(["stock-detail", mkt, sym])) return;
    qc.prefetchQuery({ queryKey: ["stock-detail", mkt, sym], queryFn: () => stocksApi.getDetail(mkt, sym), staleTime: 60_000 });
  }, [qc]);

  /* 화면에 들어온 종목을 미리 불러오는 감지기.
     관찰 대상은 "어떤 종목이 목록에 있는가"만 중요하고 순서는 상관없다.
     displayList를 그대로 의존성에 두면 드래그로 순서가 바뀔 때마다 감지기를 통째로
     다시 만들고 행 수만큼 다시 등록해서, 종목이 많을수록 드래그가 크게 느려졌다.
     그래서 종목 구성이 실제로 바뀔 때만 다시 만들고, 최신 목록은 ref로 읽는다. */
  const displayListRef = useRef(displayList);
  displayListRef.current = displayList;

  const observedSymbolsKey = useMemo(
    () => displayList.map((i: any) => i.symbol).sort().join(","),
    [displayList],
  );

  useEffect(() => {
    let queue: any[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      queue.splice(0, 3).forEach(prefetchStock);
      if (queue.length > 0) timer = setTimeout(flush, 600);
    };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const sym = (e.target as HTMLElement).dataset.sym;
          const item = displayListRef.current.find((i: any) => i.symbol === sym);
          if (item && !queue.find((q: any) => q.symbol === sym)) queue.push(item);
        }
      });
      if (queue.length > 0 && !timer) timer = setTimeout(flush, 200);
    }, { threshold: 0.5 });
    rowRefs.current.forEach(row => observer.observe(row));
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
  }, [observedSymbolsKey, prefetchStock]);

  const renderItems = (list: any[]) =>
    list.map((item: any) => (
      <div key={item.id} className="list-item-in list-row-lite" ref={el => { if (el) rowRefs.current.set(item.symbol, el); else rowRefs.current.delete(item.symbol); }} data-sym={item.symbol} data-item-id={item.id}>
        <ItemRow
          item={item}
          livePrice={lookupPrice(livePrices, item.symbol)}
          onRemove={() => removeMutation.mutate(item.id)}
          onNavigate={() => goToStock(item)}
          onEdit={() => setEditingItem(item)}
          onPrefetch={() => prefetchStock(item)}
          onAddToPortfolio={() => setAddToPortfolioItem(item)}
          isDragging={dragId === item.id}
          isDragOver={dropId === item.id}
          onDragStart={() => handleDragStart(item)}
          onDragOver={(e) => handleDragOver(e, item.id)}
          onDrop={handleDrop}
          onTouchDragStart={() => handleDragStart(item)}
          onTouchDragMove={handleItemTouchMove}
          onTouchDragEnd={handleDrop}
        />
      </div>
    ));

  return (
    <div className="flex flex-col gap-5 pb-20">
      {/* 추가 오류 토스트 */}
      <ErrorToast message={addError} onClose={() => setAddError("")} />

      {/* 페이지 탭 */}
      <div className="flex border-b border-border bg-bg-card rounded-t-xl overflow-hidden">
        {[
          { id: "portfolio", label: "내 자산",   icon: Wallet },
          { id: "watchlist", label: "관심종목", icon: Star   },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id}
            onClick={() => id === "portfolio" ? navigate("/portfolio") : undefined}
            className={`flex items-center gap-1.5 px-5 py-3 text-xs font-semibold transition-all border-b-2 -mb-px whitespace-nowrap ${
              id === "watchlist"
                ? "border-accent-blue text-accent-blue bg-accent-blue/5"
                : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated"
            }`}
          >
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      {/* 로그인 배너 */}
      {!isLoggedIn && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-accent-blue/10 border border-accent-blue/20">
          <LogIn size={14} className="text-accent-blue flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-text-primary">미리보기 모드</p>
            <p className="text-xs text-text-muted mt-0.5">아래는 예시 데이터입니다. 로그인하면 내 관심종목을 추가·관리할 수 있어요.</p>
          </div>
          <Link to="/login" className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-blue-600 transition-colors">
            <LogIn size={12} /> 로그인
          </Link>
        </div>
      )}

      {/* 헤더 */}
      {/* 좁은 화면에서는 제목과 버튼을 세로로 쌓는다 (내 자산과 동일) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-text-primary whitespace-nowrap">관심종목</h1>
          <p className="text-text-muted text-xs mt-0.5 truncate">
            {isPreview ? `${PREVIEW_WATCHLIST.length}개 예시 종목` : `${itemsList.length}개 종목`}
            <span className="hidden sm:inline"> · 클릭하면 상세로 이동</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:justify-end">
          <button
            onClick={() => { qc.invalidateQueries({ queryKey: ["watchlist-items"] }); qc.invalidateQueries({ queryKey: ["watchlist-prices"] }); qc.invalidateQueries({ queryKey: ["watchlist-folders"] }); }}
            className="p-2 rounded-lg border border-border text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all"
            title="관심종목 업데이트"
          >
            <RefreshCw size={13} />
          </button>
          {isLoggedIn && (
            <>
              <button
                onClick={() => setShowFolderManager(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all"
                title="폴더 추가/편집"
              >
                <Settings2 size={13} />폴더 관리
              </button>
              <button
                onClick={() => openAddModal(typeof folderTab === "number" ? folderTab : null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 transition-all"
              >
                <Plus size={13} />종목 추가
              </button>
            </>
          )}
        </div>
      </div>

      {/* 시장 탭 — 미리보기·로그인 모두 동작 */}
      <div className="flex gap-1 bg-bg-secondary border border-border rounded-xl p-1 w-fit">
        {MARKET_TABS.map((t) => (
          <button key={t.id} onClick={() => { setMarketTab(t.id); setFolderTab("all"); }}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              marketTab === t.id ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* 폴더 탭 */}
      {isPreview ? (() => {
        const mktFiltered = marketTab === "전체" ? PREVIEW_WATCHLIST : PREVIEW_WATCHLIST.filter(i => i.market === marketTab);
        const tabBtnCls = (active: boolean) =>
          `flex-shrink-0 whitespace-nowrap px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all ${
            active ? "border-accent-blue text-accent-blue bg-accent-blue/5" : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated"
          }`;
        return (
          <div className="flex border-b border-border bg-bg-card rounded-t-xl overflow-x-auto scrollbar-hide">
            <button onClick={() => { setFolderTab("all"); setPortfolioTab(null); }} className={tabBtnCls(folderTab === "all" && portfolioTab === null)}>
              전체 <span className="text-[10px] opacity-70">{mktFiltered.length}</span>
            </button>
            <button onClick={() => { setFolderTab("recent"); setPortfolioTab(null); }} className={`${tabBtnCls(folderTab === "recent" && portfolioTab === null)} flex items-center gap-1`}>
              <Clock size={13} /> 최근조회
            </button>
            {PREVIEW_FOLDERS.map(f => {
              const cnt = mktFiltered.filter(i => i.folderId === f.id).length;
              if (cnt === 0) return null;
              return (
                <button key={f.id} onClick={() => { setFolderTab(f.id); setPortfolioTab(null); }} className={tabBtnCls(folderTab === f.id && portfolioTab === null)}>
                  {f.name} <span className="text-[10px] opacity-70">{cnt}</span>
                </button>
              );
            })}
          </div>
        );
      })() : (() => {
        const tabBtnCls = (active: boolean) =>
          `flex-shrink-0 whitespace-nowrap px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all ${
            active ? "border-accent-blue text-accent-blue bg-accent-blue/5" : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated"
          }`;
        return (
          <div className="flex border-b border-border bg-bg-card rounded-t-xl overflow-x-auto scrollbar-hide">
            <button onClick={() => { setFolderTab("all"); setPortfolioTab(null); }} className={tabBtnCls(folderTab === "all" && portfolioTab === null)}>
              전체 <span className="text-[10px] opacity-70">{itemsList.length}</span>
            </button>
            <button onClick={() => { setFolderTab("recent"); setPortfolioTab(null); }} className={`${tabBtnCls(folderTab === "recent" && portfolioTab === null)} flex items-center gap-1`}>
              <Clock size={13} /> 최근조회
            </button>
            {(localFolderOrder ?? (folders as any[])).map((f: any) => {
              const cnt = folderCounts.get(f.id) ?? 0;
              return (
                <button
                  key={f.id}
                  data-folder-id={f.id}
                  draggable={(folders as any[]).length > 1}
                  onDragStart={() => handleFolderDragStart(f)}
                  onDragOver={(e) => handleFolderDragOver(e, f.id)}
                  onDrop={handleFolderDrop}
                  onTouchStart={(e) => handleFolderTouchStart(f, e)}
                  onTouchMove={handleFolderTouchMoveGated}
                  onTouchEnd={handleFolderTouchEnd}
                  onClick={() => { setPortfolioTab(null); handleFolderTabClick(f.id); }}
                  title="길게 눌러서 드래그하면 폴더 순서를 바꿀 수 있어요"
                  style={{ touchAction: dragFolderId === f.id ? "none" : "auto" }}
                  className={`cursor-grab active:cursor-grabbing ${tabBtnCls(folderTab === f.id && portfolioTab === null)} ${
                    dragFolderId === f.id ? "opacity-40" : ""
                  } ${dropFolderId === f.id ? "ring-1 ring-accent-blue ring-inset" : ""}`}
                >
                  {f.name} <span className="text-[10px] opacity-70">{cnt}</span>
                </button>
              );
            })}
            {/* 포트폴리오 탭 — 관심종목 폴더처럼 나란히 표시 */}
            {pfList.map((pf: any) => (
              <button
                key={`pf-${pf.id}`}
                onClick={() => { setPortfolioTab(pf.id); setFolderTab("all"); }}
                className={`${tabBtnCls(portfolioTab === pf.id)} flex items-center gap-1`}
              >
                <Wallet size={11} />
                {pf.name}
              </button>
            ))}
          </div>
        );
      })()}

      {/* 본문 */}
      {folderTab === "recent" && portfolioTab === null ? (
        <Card className="p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-bg-card">
            <Clock size={13} className="text-accent-blue" />
            <span className="flex-1 text-sm font-semibold text-text-primary">최근 조회한 종목</span>
            <span className="text-xs text-text-muted bg-bg-secondary px-2 py-0.5 rounded-full">{recentStocks.length}</span>
          </div>
          {recentStocks.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-6">
              <p className="text-text-muted text-xs">최근 조회한 종목이 없습니다</p>
            </div>
          ) : (
            recentStocks.map((r) => {
              const p = recentPriceMap[r.symbol];
              const isKRItem = r.market === "KR";
              const hasPrice = p?.price != null;
              return (
                <div
                  key={`${r.market}-${r.symbol}`}
                  role="button"
                  tabIndex={0}
                  className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30 bg-bg-card hover:bg-bg-hover cursor-pointer transition-colors"
                  onClick={() => navigate(`/stocks/${r.market}/${encodeURIComponent(r.symbol)}`)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/stocks/${r.market}/${encodeURIComponent(r.symbol)}`); } }}
                >
                  <MarketBadge market={r.market} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-bold text-sm text-text-primary">{normalizeSymbol(r.symbol)}</div>
                    <div className="text-[11px] text-text-muted truncate">{r.name}</div>
                  </div>
                  <div className="text-right flex-shrink-0 min-w-[80px]">
                    <div className="text-sm font-mono font-semibold text-text-primary">
                      {hasPrice
                        ? isKRItem ? fmtKRWFull(Number(p.price)) : fmtUSDFull(Number(p.price))
                        : <span className="text-text-muted text-xs">조회 중</span>}
                    </div>
                    {hasPrice && p.change_rate != null && <ChangeBadge value={Number(p.change_rate)} className="text-xs" />}
                  </div>
                </div>
              );
            })
          )}
        </Card>
      ) : portfolioTab !== null ? (
        <Card className="p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-bg-card">
            <Wallet size={13} className="text-accent-blue" />
            <span className="flex-1 text-sm font-semibold text-text-primary">
              {pfList.find((p: any) => p.id === portfolioTab)?.name ?? "포트폴리오"}
            </span>
            <span className="text-xs text-text-muted bg-bg-secondary px-2 py-0.5 rounded-full">{pfTabDeduped.length}</span>
          </div>
          {pfTabLoading ? (
            <div className="flex justify-center py-8">
              <InlineSpinner className="w-5 h-5" />
            </div>
          ) : pfTabDeduped.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-8">
              <Wallet size={24} className="text-text-muted/40" />
              <p className="text-text-muted text-xs">이 포트폴리오에 보유종목이 없습니다</p>
            </div>
          ) : (
            pfTabDeduped
              .filter((i: any) => marketTab === "전체" || i.market === marketTab)
              .map((item: any) => {
                const p = pfTabPriceMap[item.symbol];
                const isKRItem = item.market === "KR";
                const hasPrice = p?.price != null;
                return (
                  <div
                    key={item.symbol}
                    role="button"
                    tabIndex={0}
                    className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30 bg-bg-card hover:bg-bg-hover cursor-pointer transition-colors"
                    onClick={() => navigate(`/stocks/${item.market}/${encodeURIComponent(item.symbol)}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/stocks/${item.market}/${encodeURIComponent(item.symbol)}`); } }}
                  >
                    <MarketBadge market={item.market} />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono font-bold text-sm text-text-primary">{normalizeSymbol(item.symbol)}</div>
                      <div className="text-[11px] text-text-muted truncate">{item.name}</div>
                    </div>
                    <div className="text-right flex-shrink-0 min-w-[80px]">
                      <div className="text-sm font-mono font-semibold text-text-primary">
                        {hasPrice
                          ? isKRItem ? fmtKRWFull(Number(p.price)) : fmtUSDFull(Number(p.price))
                          : <span className="text-text-muted text-xs">조회 중</span>}
                      </div>
                      {hasPrice && p.change_rate != null && <ChangeBadge value={Number(p.change_rate)} className="text-xs" />}
                    </div>
                  </div>
                );
              })
          )}
        </Card>
      ) : isPreview ? (() => {
        const mktFiltered = marketTab === "전체" ? previewWatchlistLive : previewWatchlistLive.filter(i => i.market === marketTab);
        const shown = folderTab === "all" ? mktFiltered : mktFiltered.filter(i => i.folderId === folderTab);
        const visibleFolders = PREVIEW_FOLDERS.filter(f => shown.some(i => i.folderId === f.id));
        return (
          <div className="flex flex-col gap-3">
            {visibleFolders.map(folder => (
              <Card key={folder.id} className="p-0 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-bg-card">
                  <ChevronDown size={14} className="text-text-muted" />
                  <span className="flex-1 text-sm font-semibold text-text-primary">{folder.name}</span>
                  <span className="text-xs text-text-muted bg-bg-secondary px-2 py-0.5 rounded-full">{shown.filter(i => i.folderId === folder.id).length}</span>
                </div>
                {shown.filter(i => i.folderId === folder.id).map(item => (
                  <PreviewItemRow key={item.id} item={item} onNavigate={() => navigate(`/stocks/${item.market}/${encodeURIComponent(item.symbol)}`)} />
                ))}
              </Card>
            ))}
            {shown.length === 0 && (
              <Card>
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <Star size={28} className="text-text-muted/40" />
                  <p className="text-text-muted text-sm">해당 시장의 예시 종목이 없습니다</p>
                </div>
              </Card>
            )}
          </div>
        );
      })() : isLoading ? <RowSkeleton rows={5} /> : (
        <div key={`${marketTab}-${folderTab}`} className="flex flex-col gap-3 tab-fade">
          {/* 폴더 그룹 — 폴더 탭이 "전체"이거나 해당 폴더가 선택된 경우에만 표시 */}
          {(localFolderOrder ?? (folders as any[]))
            .filter((folder: any) => folderTab === "all" || folderTab === folder.id)
            .map((folder: any) => {
            const folderItems = byFolder(folder.id);
            const isCollapsed = collapsed.has(`f-${folder.id}`);
            return (
              <Card key={folder.id} className="p-0 overflow-hidden">
                <div
                  className={`flex items-center gap-2 px-4 py-3 border-b border-border group ${dropFolderId === folder.id ? "bg-accent-blue/5" : "bg-bg-card"} ${dragFolderId === folder.id ? "opacity-40" : ""}`}
                  data-folder-id={folder.id}
                  onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                  onDrop={handleFolderDrop}
                >
                  {(folders as any[]).length > 1 && (
                    <div
                      draggable
                      onDragStart={() => handleFolderDragStart(folder)}
                      onTouchStart={() => handleFolderDragStart(folder)}
                      onTouchMove={(e) => handleFolderTouchMove(e.touches[0].clientX, e.touches[0].clientY)}
                      onTouchEnd={handleFolderDrop}
                      className="cursor-grab active:cursor-grabbing text-text-dim hover:text-text-muted touch-none flex-shrink-0 px-1 py-1"
                      title="드래그하여 폴더 순서 변경"
                    >
                      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                        <circle cx="3" cy="2.5" r="1.3"/><circle cx="7" cy="2.5" r="1.3"/>
                        <circle cx="3" cy="7"   r="1.3"/><circle cx="7" cy="7"   r="1.3"/>
                        <circle cx="3" cy="11.5" r="1.3"/><circle cx="7" cy="11.5" r="1.3"/>
                      </svg>
                    </div>
                  )}
                  <button onClick={() => toggleCollapse(`f-${folder.id}`)} className="text-text-muted">
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {editingFolder === folder.id ? (
                    <FolderNameEdit
                      folder={folder}
                      onSave={(name) => updateFolderMutation.mutate({ id: folder.id, name })}
                      onCancel={() => setEditingFolder(null)}
                    />
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-semibold text-text-primary">{folder.name}</span>
                      <span className="text-xs text-text-muted bg-bg-secondary px-2 py-0.5 rounded-full">{folderItems.length}</span>
                      <button onClick={() => openAddModal(folder.id)} className="text-text-muted hover:text-accent-blue p-1.5 rounded-lg hover:bg-accent-blue/10 transition-colors" title="이 폴더에 종목 추가">
                        <Plus size={13} />
                      </button>
                      <div className="flex gap-1">
                        <button onClick={() => setEditingFolder(folder.id)} className="text-text-muted hover:text-accent-blue p-1"><Pencil size={12} /></button>
                        <button onClick={() => setDeletingFolder({ ...folder, _itemCount: folderItems.length })} className="text-text-muted hover:text-accent-red p-1"><Trash2 size={12} /></button>
                      </div>
                    </>
                  )}
                </div>
                {!isCollapsed && (
                  folderItems.length === 0
                    ? (
                      <div className="flex flex-col items-center justify-center gap-2 px-4 py-6">
                        <p className="text-text-muted text-xs">이 폴더에 종목이 없습니다</p>
                        <button
                          onClick={() => openAddModal(folder.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-text-muted text-xs hover:border-accent-blue hover:text-accent-blue transition-colors"
                        >
                          <Plus size={12} /> 종목 추가
                        </button>
                      </div>
                    )
                    : renderItems(folderItems)
                )}
              </Card>
            );
          })}

          {/* 비어있음 */}
          {itemsList.length === 0 && (
            <Card>
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Star size={32} className="text-text-muted/40" />
                <p className="text-text-secondary font-medium">관심종목이 없습니다</p>
                <p className="text-text-muted text-xs">종목명이나 티커를 검색해서 추가하세요</p>
                <button
                  onClick={() => openAddModal(null)}
                  className="mt-2 flex items-center gap-1.5 px-4 py-2 bg-accent-blue text-white text-sm font-semibold rounded-xl"
                >
                  <Plus size={14} />종목 추가
                </button>
              </div>
            </Card>
          )}
        </div>
      )}

      {isLoggedIn && showAdd && addFolderId != null && (
        <AddModal
          folders={folders}
          defaultFolderId={addFolderId}
          onClose={() => setShowAdd(false)}
          onAdd={(req) => addMutation.mutate(req)}
        />
      )}

      {editingItem && (
        <EditItemModal
          item={editingItem}
          folders={folders}
          onClose={() => setEditingItem(null)}
          onSave={(patch) => updateItemMutation.mutate({ id: editingItem.id, patch })}
        />
      )}

      {deletingFolder && (
        <DeleteFolderModal
          folder={deletingFolder}
          itemCount={deletingFolder._itemCount ?? 0}
          onClose={() => setDeletingFolder(null)}
          onConfirm={() => deleteFolderMutation.mutate(deletingFolder.id)}
        />
      )}

      {addToPortfolioItem && (
        <AddToPortfolioModal
          item={addToPortfolioItem}
          currentPrice={lookupPrice(livePrices, addToPortfolioItem.symbol)?.price ?? null}
          onClose={() => setAddToPortfolioItem(null)}
        />
      )}

      {showFolderManager && (
        <FolderManagerModal
          folders={localFolderOrder ?? (folders as any[])}
          onClose={() => setShowFolderManager(false)}
          onCreate={() => { createFolderMutation.mutate(); setShowFolderManager(false); }}
          onRename={(id, name) => updateFolderMutation.mutate({ id, name })}
          onDelete={(folder) => {
            const count = (items as any[]).filter((i: any) => i.folder_id === folder.id).length;
            setDeletingFolder({ ...folder, _itemCount: count });
            setShowFolderManager(false);
          }}
          onReorder={(order) => reorderFoldersMutation.mutate(order)}
        />
      )}
    </div>
  );
}
