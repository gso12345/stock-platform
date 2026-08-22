import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { watchlistApi, watchlistFolderApi, stocksApi, portfolioApi } from "@/api/stocks";
import {
  Card, ChangeBadge, RowSkeleton, InlineSpinner, MarketBadge, ErrorToast,
  Tabs, UnderlineTabs, type TabItem, 빈화면, 못불러옴} from "@/components/ui";
import { ASSET_PAGE_TABS } from "@/constants/tabs";
import { useLivePrices, 시세갱신주기} from "@/hooks/useLivePrices";
import LiveBadge from "@/components/ui/LiveBadge";
import { normalizeSymbol, lookupPrice, indexPricesBySymbol } from "@/utils/prices";
import { PREVIEW_FOLDERS, PREVIEW_WATCHLIST, PreviewItemRow, type PreviewItem } from "@/components/watchlist/Preview";
import { ItemRow } from "@/components/watchlist/ItemRow";
import {
  AddModal, EditItemModal, DeleteFolderModal, AddToPortfolioModal, FolderManagerModal, FolderNameEdit,
} from "@/components/watchlist/WatchlistModals";
import { extractErrorMessage } from "@/utils/errors";
import { useDragReorder } from "@/hooks/useDragReorder";
import { 최근조회키, 폴더키, 계좌키, 탭순서읽기, 탭순서쓰기, 탭순서적용, 폴더순서반영 } from "@/utils/tabOrder";
import { fmtKRWFull, fmtUSDFull } from "@/utils/formatters";
import { Plus, Pencil, Trash2, Star, Wallet, ChevronDown, ChevronRight, Settings2, LogIn, Clock, RefreshCw } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { getRecentlyViewed, type RecentStock } from "@/utils/recentlyViewed";
/* 시세를 조회할 수 있는 심볼 형식 — 서버의 검사와 같은 기준.
   '현금'·'금' 같은 자산은 시세가 없으므로 조회 대상이 아니다. */
const PRICEABLE_SYMBOL = /^[A-Za-z0-9.\-]{1,20}$/;

const MARKET_TABS: TabItem[] = [
  { id: "전체", label: "전체" },
  { id: "KR",   label: "국내" },
  { id: "US",   label: "해외" },
  { id: "ETF",  label: "ETF"  },
];


/* ── 메인 ────────────────────────────────────────────────── */
export default function Watchlist() {
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const { isLoggedIn, userId } = useAuthStore();
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
  /* 응답 배열의 순서에 의존하지 않도록 종목코드로 색인한다.
     예전에는 "i번째 종목 = i번째 가격"으로 짝지었는데, 서버가 순서를 바꿔 주면
     가격이 통째로 다른 종목에 붙는다 (다른 화면들은 이미 이 방식으로 바꿨다) */
  const recentPriceMap = useMemo(
    () => indexPricesBySymbol(recentPrices),
    [recentPrices],
  );

  // 포트폴리오 목록 (탭 표시용)
  const { data: pfList = [] } = useQuery<any[]>({
    queryKey: ["portfolios"],
    queryFn: portfolioApi.getPortfolios,
    enabled: isLoggedIn,
    staleTime: 300_000,
  });

  /* 보유종목 전체를 미리 받아둔다.

     예전에는 포트폴리오 탭을 누른 뒤에야 목록과 시세를 받아왔다. 그래서
     탭을 누를 때마다 '조회 중'을 봐야 했고, 받아온 시세는 갱신되지 않아
     (refetchInterval 없음, WebSocket 없음) 그 화면만 과거에 멈춰 있었다.

     지금은 관심종목과 같은 시세 경로에 합친다 — 탭을 누르는 순간 이미
     값이 있고, 실시간으로 함께 갱신된다. 같은 종목을 두 번 조회하지도
     않는다. 목록 요청은 로그인 시 한 번뿐이다. */
  const { data: pfAllItems = [], isLoading: pfAllLoading } = useQuery<any[]>({
    queryKey: ["portfolio-items-all"],
    queryFn: () => portfolioApi.getItems(undefined, true),
    enabled: isLoggedIn,
    staleTime: 300_000,
  });
  const pfTabDeduped = useMemo(
    () => pfAllItems.filter(
      // 서버는 portfolioId(카멜케이스)로 준다 — portfolio_id 로 보면 전부 걸러진다
      (i: any) => portfolioTab == null || (i.portfolioId ?? null) === portfolioTab,
    ),
    [pfAllItems, portfolioTab],
  );
  const pfTabLoading = pfAllLoading;

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

  const { data: allItems = [], isLoading, isError: 못받음, error: 실패사유, refetch: 다시받기 } = useQuery({
    queryKey: ["watchlist-items"],
    queryFn: () => watchlistApi.getItems(),
    staleTime: 120_000,
    // 목록 구성은 사용자가 추가·삭제할 때만 바뀐다. 각 mutation의 onSuccess에서
    // invalidate하므로 주기 폴링은 불필요한 요청일 뿐이다 (가격은 별도 쿼리가 갱신)
    refetchInterval: false,
  });

  // 탭 전환 시 API 재호출 없이 클라이언트 필터링
  const items = useMemo(() => {
    if (marketTab === "전체") return allItems;
    return allItems.filter((i) => i.market === marketTab);
  }, [allItems, marketTab]);

  /* 가격 조회는 관심종목 + 보유종목을 합친 기준 — 탭 전환해도 캐시 유지.
     한 종목이 양쪽에 있으면 한 번만 조회한다.

     시세가 없는 자산은 빼야 한다. 포트폴리오는 '현금'·'금'·'채권' 처럼 한글
     심볼을 담을 수 있는데, 이걸 시세 조회에 넣자 관심종목 20개의 시세가
     통째로 사라졌다 — 서버가 형식에 안 맞는 심볼 하나를 보고 REST 는 400,
     WebSocket 은 연결을 닫아버렸기 때문이다. 서버도 고쳤지만, 애초에 시세가
     있을 수 없는 것을 보내지 않는 게 맞다. */
  const { symbols, markets } = useMemo(() => {
    const syms: string[] = [];
    const mkts: string[] = [];
    const seen = new Set<string>();
    for (const i of [...allItems, ...pfAllItems]) {
      if (!i?.symbol || !PRICEABLE_SYMBOL.test(i.symbol)) continue;
      const key = normalizeSymbol(i.symbol);
      if (seen.has(key)) continue;
      seen.add(key);
      syms.push(i.symbol);
      mkts.push(i.market === "KR" ? "KR" : "US");
    }
    return { symbols: syms, markets: mkts };
  }, [allItems, pfAllItems]);

  /* REST 배치 가격 조회 — signal을 받아 컴포넌트 언마운트/취소 시 HTTP 요청도 중단 */
  const priceKey = useMemo(() => [...symbols].sort().join(","), [symbols]);
  const { data: restPrices } = useQuery({
    queryKey: ["watchlist-prices", priceKey],
    queryFn: ({ signal }) => watchlistApi.getPrices(symbols, markets, signal),
    enabled: symbols.length > 0,
    staleTime: 55_000,
    /* 장이 닫혀 있으면 종가라 값이 안 변한다. 예전에는 장 상태를 안 보고
       늘 60초마다 물었다 — 주말 내내, 밤새도록 같은 값을 받으려고
       1분에 한 번씩 왕복했다 */
    refetchInterval: 시세갱신주기(markets),
  });

  /* 비로그인 미리보기용 실시간 현재가 (예시 관심종목도 실제 시세로 표시) */
  const { data: previewPrices } = useQuery({
    queryKey: ["watchlist-preview-prices"],
    queryFn: () => watchlistApi.getPrices(PREVIEW_WATCHLIST.map((i) => i.symbol), PREVIEW_WATCHLIST.map((i) => i.market)),
    enabled: isPreview,
    staleTime: 60_000,
    refetchInterval: 시세갱신주기(PREVIEW_WATCHLIST.map((i) => i.market)),
  });
  const previewWatchlistLive: PreviewItem[] = useMemo(() => {
    // 실시간 현재가를 아직 못 불러왔으면 정적 예시가를 보여주지 않고 로딩 상태로 표시
    if (!previewPrices) return PREVIEW_WATCHLIST.map((base) => ({ ...base, hasPrice: false }));
    /* 배열 순서가 아니라 종목코드로 짝짓는다. 서버가 한 종목을 건너뛰면
       그 뒤가 통째로 한 칸씩 밀려 엉뚱한 가격이 붙는다 — 내 자산 쪽에서
       이미 겪고 고친 일인데 여기만 인덱스로 남아 있었다 */
    const bySymbol = indexPricesBySymbol(previewPrices);
    return PREVIEW_WATCHLIST.map((base) => {
      const d = lookupPrice(bySymbol, base.symbol) as any;
      const hasPrice = d?.price != null;
      return {
        ...base,
        price: hasPrice ? d.price : base.price,
        change_rate: hasPrice ? (d.change_rate ?? base.change_rate) : base.change_rate,
        /* 얼마가 올랐는지. 이걸 안 넘겨서 미리보기만 퍼센트만 나왔다 —
           "+500 (1.23%)" 의 앞부분이 통째로 비어 있었다 */
        change: hasPrice ? d.change ?? null : null,
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
    mergePrices(restPrices, wsFresh ? wsSymbolsRef.current : undefined);
  }, [restPrices, mergePrices]);

  /* WebSocket — 실시간 시세 (주 경로).
     연결이 오래 끊기면 받아둔 값을 버린다 — 안 그러면 끊긴 시점의 가격이
     새로 받은 HTTP 시세를 계속 덮어써 화면이 과거에 멈춘다 */
  const live = useLivePrices(
    symbols, markets,
    useCallback((prices: any[]) => {
      const delivered = new Set<string>();
      for (const p of prices) {
        if (p?.symbol && !p.error && p.price != null) delivered.add(normalizeSymbol(p.symbol));
      }
      wsSymbolsRef.current   = delivered;
      wsLastMsgAtRef.current = Date.now();
      mergePrices(prices);
    }, [mergePrices]),
    useCallback(() => {
      wsSymbolsRef.current = new Set();
      wsLastMsgAtRef.current = 0;
      setLivePrices({});
    }, []),
  );

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
    localFolderOrderRef.current = folders;
    setDragFolderId(folder.id);
    setLocalFolderOrder(folders);
  };

  // 길게 누르기(롱프레스) 후에만 드래그가 시작되도록 — 일반 탭/스크롤과 구분
  const LONG_PRESS_MS = 350;
  const LONG_PRESS_MOVE_TOLERANCE = 8;


  const moveFolderTo = (targetId: number) => {
    const fromId = dragFolderIdRef.current;
    if (fromId === null || fromId === targetId) return;
    setDropFolderId(targetId);
    const base = localFolderOrderRef.current ?? folders;
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
      폴더순서바꾸기(order.map((f: any) => f.id));
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

  const itemsList = items;

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
    const 셀것: { folder_id?: number | null }[] = isPreview
      ? PREVIEW_WATCHLIST.map((i) => ({ folder_id: i.folderId }))
      : itemsList;
    for (const i of 셀것) {
      /* 폴더에 안 넣은 종목은 세지 않는다. 타입을 붙이고 나서야 보였는데,
         예전에는 folder_id 가 null 인 것들이 null 이라는 열쇠 하나에
         뭉쳐 담기고 있었다. 쓰이지는 않았지만 폴더 번호가 아닌 것이
         폴더 개수표에 앉아 있었던 셈이다 */
      if (typeof i.folder_id !== "number") continue;
      map.set(i.folder_id, (map.get(i.folder_id) ?? 0) + 1);
    }
    return map;
  }, [itemsList, isPreview]);

  /* ── 탭 줄 한 벌 ────────────────────────────────────────────
     최근조회·폴더·내계좌는 성격이 달라 예전에는 따로 그렸고, 순서를 바꿀
     수 있는 것도 폴더끼리뿐이었다. 내계좌를 주로 보는 사람은 폴더를 전부
     지나쳐야 자기 계좌에 닿았다. 셋을 한 목록으로 놓고 통째로 옮긴다.
     ("전체"는 목록 그 자체라 맨 앞에 고정한다) */
  const 탭들 = useMemo(() => {
    /* 로그인 전에도 같은 목록을 만든다. 예전에는 미리보기용 탭 줄을 따로
       그렸는데, 그러면 탭 줄을 고칠 때마다 로그인한 화면만 좋아지고
       처음 들어온 사람이 보는 화면은 옛 모습으로 남는다 — 실제로 탭 순서
       변경을 넣었을 때 미리보기에는 반영되지 않았다. */
    const 폴더목록 = isPreview ? PREVIEW_FOLDERS : (localFolderOrder ?? folders);
    const 계좌목록 = isPreview ? [] : pfList;
    return [
      { key: 최근조회키, 종류: "recent" as const, id: null as number | null, 이름: "최근조회" },
      ...폴더목록.map((f: any) => ({ key: 폴더키(f.id), 종류: "folder" as const, id: f.id, 이름: f.name })),
      ...계좌목록.map((pf: any) => ({ key: 계좌키(pf.id), 종류: "portfolio" as const, id: pf.id, 이름: pf.name })),
    ];
  }, [isPreview, localFolderOrder, folders, pfList]);

  const [탭순서, set탭순서] = useState<string[]>(() => 탭순서읽기(userId));
  const 정렬된탭 = useMemo(() => 탭순서적용(탭순서, 탭들), [탭순서, 탭들]);

  /* 순서를 바꾸면 두 곳에 남긴다 — 섞인 순서는 이 기기에, 폴더끼리의
     순서는 서버에. 서버 쪽까지 안 보내면 다른 기기에서 폴더가 뒤섞인다 */
  const 탭순서바꾸기 = useCallback((키들: string[]) => {
    set탭순서(키들);
    탭순서쓰기(userId, 키들);
    /* 로그인 전에는 서버에 보낼 폴더가 없다. 그대로 보내면 401 이 나고
       인터셉터가 로그인 화면으로 튕긴다 — 예시를 만지다 쫓겨나는 셈이다 */
    if (isPreview) return;
    const 폴더순 = 키들
      .filter((k) => k.startsWith("folder:"))
      .map((k) => Number(k.slice("folder:".length)));
    if (폴더순.length > 1) reorderFoldersMutation.mutate(폴더순);
  }, [userId, isPreview, reorderFoldersMutation]);

  /* 폴더끼리만 옮긴 경우(본문 폴더 목록·폴더 관리 창). 서버에 보내고,
     저장된 탭 순서의 폴더 자리에도 새 순서를 입힌다 — 안 하면 서버는
     새 순서인데 탭 줄만 옛 순서로 남는다 */
  const 폴더순서바꾸기 = useCallback((폴더순: number[]) => {
    if (!isPreview) reorderFoldersMutation.mutate(폴더순);
    set탭순서((이전) => {
      const 다음 = 폴더순서반영(이전, 폴더순);
      탭순서쓰기(userId, 다음);
      return 다음;
    });
  }, [userId, isPreview, reorderFoldersMutation]);

  /* 탭 줄 드래그 — 종목 목록과 같은 훅을 쓴다. 예전에는 폴더 탭만 따로
     짜인 로직이 있었고 내계좌는 아예 못 옮겼다 */
  const 탭드래그 = useDragReorder<{ key: string; id: string }>({
    // 훅은 id 로 항목을 찾는다. 탭에서 그 역할은 key 다
    items: useMemo(() => 정렬된탭.map((t) => ({ ...t, id: t.key })), [정렬된탭]) as any,
    onCommit: (keys) => 탭순서바꾸기(keys as string[]),
  });

  /* 탭은 눌러서 고르는 것이 본업이라, 잡자마자 끌기 시작하면 고를 수가 없다.
     0.35초 눌러야 시작하고, 그 전에 손가락이 움직이면 가로 스크롤로 본다 */
  const 탭꾹타이머 = useRef<number | null>(null);
  const 탭누른자리 = useRef<{ x: number; y: number } | null>(null);
  const 방금끌었다 = useRef(false);
  const 탭꾹취소 = () => {
    if (탭꾹타이머.current !== null) { window.clearTimeout(탭꾹타이머.current); 탭꾹타이머.current = null; }
  };

  const 탭터치시작 = (탭: any, e: React.TouchEvent) => {
    const t = e.touches[0];
    탭누른자리.current = { x: t.clientX, y: t.clientY };
    탭꾹취소();
    탭꾹타이머.current = window.setTimeout(() => 탭드래그.start({ ...탭, id: 탭.key } as any), LONG_PRESS_MS);
  };

  const 탭터치이동 = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (탭드래그.isDragging) {
      e.preventDefault();
      탭드래그.moveToPoint(t.clientX, t.clientY, "data-tab-key");
      return;
    }
    const 시작 = 탭누른자리.current;
    if (시작 && (Math.abs(t.clientX - 시작.x) > LONG_PRESS_MOVE_TOLERANCE ||
                 Math.abs(t.clientY - 시작.y) > LONG_PRESS_MOVE_TOLERANCE)) 탭꾹취소();
  };

  const 탭터치끝 = () => {
    탭꾹취소();
    if (탭드래그.isDragging) { 방금끌었다.current = true; 탭드래그.drop(); }
    탭누른자리.current = null;
  };

  /* 끌어서 놓은 직후의 click 은 무시한다 — 안 그러면 옮기자마자 그 탭이
     열려, 보고 있던 폴더가 바뀐다 */
  const 탭누름 = (탭: any) => {
    if (방금끌었다.current) { 방금끌었다.current = false; return; }
    if (탭.종류 === "recent") { setFolderTab("recent"); setPortfolioTab(null); }
    else if (탭.종류 === "folder") { setPortfolioTab(null); setFolderTab(folderTab === 탭.id ? "all" : 탭.id); }
    else { setPortfolioTab(탭.id); setFolderTab("all"); }
  };

  const createDefaultFolderMutation = useMutation({
    mutationFn: () => watchlistFolderApi.createFolder("기본 관심목록"),
  });

  // 종목은 항상 폴더에 담아야 하므로, 대상 폴더가 없으면 폴더를 먼저 만들고 그 폴더로 추가 모달을 연다
  const openAddModal = async (folderId: number | null) => {
    let fid = folderId;
    if (fid == null) {
      const list = folders;
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
      <UnderlineTabs
        ariaLabel="자산 화면"
        tabs={ASSET_PAGE_TABS}
        active="watchlist"
        onChange={(id) => { if (id === "portfolio") navigate("/portfolio"); }}
      />

      {/* 로그인 배너 */}
      {!isLoggedIn && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-accent-blue/10 border border-accent-blue/20">
          <LogIn size={14} className="text-accent-blue flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-text-primary">미리보기 모드</p>
            <p className="text-xs text-text-muted mt-0.5">아래는 예시 데이터입니다. 로그인하면 내 관심종목을 추가·관리할 수 있어요.</p>
          </div>
          <Link to="/login" className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue transition-colors">
            <LogIn size={13} /> 로그인
          </Link>
        </div>
      )}

      {/* 헤더 */}
      {/* 좁은 화면에서는 제목과 버튼을 세로로 쌓는다 (내 자산과 동일) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-text-primary whitespace-nowrap">관심종목</h1>
          <p className="text-text-muted text-xs mt-0.5 truncate flex items-center gap-2">
            <span className="truncate">
              {isPreview ? `${PREVIEW_WATCHLIST.length}개 예시 종목` : `${itemsList.length}개 종목`}
            </span>
            {isLoggedIn && symbols.length > 0 && (
              <LiveBadge status={live.status} updatedAt={live.updatedAt}
                         session={live.session} sessionLabel={live.sessionLabel} />
            )}
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
          {/* 로그인 전에도 버튼을 숨기지 않는다 — 버튼이 아예 없으면 이
              화면으로 무엇을 할 수 있는지 알 수가 없다. 누르면 로그인으로
              보내서, 왜 로그인이 필요한지가 그 자리에서 드러나게 한다. */}
          {(
            <>
              <button
                onClick={() => isLoggedIn ? setShowFolderManager(true) : navigate("/login")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all"
                title={isLoggedIn ? "폴더 추가/편집, 탭 순서 바꾸기" : "로그인하면 폴더를 만들 수 있어요"}
              >
                <Settings2 size={13} />탭 관리
              </button>
              <button
                onClick={() => isLoggedIn
                  ? openAddModal(typeof folderTab === "number" ? folderTab : null)
                  : navigate("/login")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 transition-all"
                title={isLoggedIn ? undefined : "로그인하면 관심종목을 담을 수 있어요"}
              >
                <Plus size={13} />종목 추가
              </button>
            </>
          )}
        </div>
      </div>

      {/* 시장 탭 — 미리보기·로그인 모두 동작 */}
      <Tabs
        ariaLabel="시장"
        fill={false}
        className="w-fit"
        tabs={MARKET_TABS}
        active={marketTab}
        onChange={(id) => { setMarketTab(id); setFolderTab("all"); }}
      />

      {/* 폴더 탭 — 로그인 여부와 상관없이 한 벌로 그린다 */}
      {(() => {
        const tabBtnCls = (active: boolean) =>
          `flex-shrink-0 whitespace-nowrap px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all ${
            active ? "border-accent-blue text-accent-blue bg-accent-blue/5" : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated"
          }`;
        return (
          <div className="flex border-b border-border bg-bg-card rounded-t-xl overflow-x-auto scrollbar-hide">
            {/* "전체"는 목록 그 자체라 맨 앞에 고정한다 */}
            <button onClick={() => { setFolderTab("all"); setPortfolioTab(null); }} className={tabBtnCls(folderTab === "all" && portfolioTab === null)}>
              전체 <span className="text-2xs opacity-70">{isPreview ? PREVIEW_WATCHLIST.length : itemsList.length}</span>
            </button>
            {정렬된탭.map((탭) => {
              const 켜짐 =
                탭.종류 === "recent"    ? folderTab === "recent" && portfolioTab === null :
                탭.종류 === "folder"    ? folderTab === 탭.id && portfolioTab === null :
                                          portfolioTab === 탭.id;
              const 끌리는중 = 탭드래그.dragId === 탭.key;
              return (
                <button
                  key={탭.key}
                  data-tab-key={탭.key}
                  draggable={정렬된탭.length > 1}
                  onDragStart={() => 탭드래그.start({ ...탭, id: 탭.key } as any)}
                  onDragEnd={탭드래그.cancel}
                  onDragOver={(e) => 탭드래그.onDragOver(e, 탭.key)}
                  onDrop={탭드래그.drop}
                  onTouchStart={(e) => 탭터치시작(탭, e)}
                  onTouchMove={탭터치이동}
                  onTouchEnd={탭터치끝}
                  onClick={() => 탭누름(탭)}
                  title="길게 눌러서 드래그하면 탭 순서를 바꿀 수 있어요"
                  style={{ touchAction: 끌리는중 ? "none" : "auto" }}
                  className={`cursor-grab active:cursor-grabbing ${tabBtnCls(켜짐)} flex items-center gap-1 ${
                    끌리는중 ? "opacity-40" : ""
                  } ${탭드래그.dropId === 탭.key ? "ring-1 ring-accent-blue ring-inset" : ""}`}
                >
                  {탭.종류 === "recent"    && <Clock size={13} />}
                  {탭.종류 === "portfolio" && <Wallet size={11} />}
                  {탭.이름}
                  {탭.종류 === "folder" && (
                    <span className="text-2xs opacity-70">{folderCounts.get(탭.id!) ?? 0}</span>
                  )}
                </button>
              );
            })}
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
            <빈화면
              compact
              icon={Clock}
              title="최근 조회한 종목이 없어요"
              hint="종목을 한 번 들여다보면 여기에 쌓여요"
              action={{ label: "종목 둘러보기", onClick: () => navigate("/") }}
            />
          ) : (
            recentStocks.map((r) => {
              const p = lookupPrice(recentPriceMap, r.symbol);
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
                    <div className="text-xs text-text-muted truncate">{r.name}</div>
                  </div>
                  <div className="text-right flex-shrink-0 min-w-[80px]">
                    <div className="text-sm font-mono font-semibold text-text-primary">
                      {hasPrice
                        ? isKRItem ? fmtKRWFull(Number(p.price)) : fmtUSDFull(Number(p.price))
                        : <span className="text-text-muted text-xs">조회 중</span>}
                    </div>
                    {hasPrice && p.change_rate != null && (
                      <ChangeBadge value={Number(p.change_rate)} className="text-xs"
                        금액={p.change != null ? Number(p.change) : null}
                        통화={isKRItem ? "KRW" : "USD"} />
                    )}
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
            <LiveBadge status={live.status} updatedAt={live.updatedAt}
                       session={live.session} sessionLabel={live.sessionLabel} />
            <span className="text-xs text-text-muted bg-bg-secondary px-2 py-0.5 rounded-full">{pfTabDeduped.length}</span>
          </div>
          {pfTabLoading ? (
            <div className="flex justify-center py-8">
              <InlineSpinner className="w-5 h-5" />
            </div>
          ) : pfTabDeduped.length === 0 ? (
            <빈화면
              compact
              icon={Wallet}
              title="이 포트폴리오에 보유종목이 없어요"
              hint="산 종목을 넣어두면 여기서 시세와 함께 볼 수 있어요"
              action={{ label: "내 자산에서 추가", onClick: () => navigate("/portfolio") }}
            />
          ) : (
            pfTabDeduped
              .filter((i: any) => marketTab === "전체" || i.market === marketTab)
              .map((item: any) => {
                // 관심종목과 같은 실시간 시세 맵을 본다 — 탭을 누른 순간
                // 이미 값이 있고, WebSocket 으로 함께 갱신된다
                const p = lookupPrice(livePrices, item.symbol);
                const isKRItem = item.market === "KR";
                const hasPrice = p?.price != null;
                // 현금·금 처럼 시세가 없는 자산은 영원히 '조회 중'으로 남는다.
                // 기다리면 나올 것처럼 보이면 안 되므로 구분해서 표시한다
                const 시세없는자산 = !PRICEABLE_SYMBOL.test(item.symbol);
                return (
                  <div
                    // 같은 종목을 두 번 담을 수 있으므로 id 로 구분한다.
                    // symbol 을 키로 쓰면 중복 시 React 가 한 행만 그린다
                    key={item.id ?? item.symbol}
                    role="button"
                    tabIndex={0}
                    className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30 bg-bg-card hover:bg-bg-hover cursor-pointer transition-colors"
                    onClick={() => navigate(`/stocks/${item.market}/${encodeURIComponent(item.symbol)}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/stocks/${item.market}/${encodeURIComponent(item.symbol)}`); } }}
                  >
                    <MarketBadge market={item.market} />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono font-bold text-sm text-text-primary">{normalizeSymbol(item.symbol)}</div>
                      <div className="text-xs text-text-muted truncate">{item.name}</div>
                    </div>
                    <div className="text-right flex-shrink-0 min-w-[80px]">
                      <div className="text-sm font-mono font-semibold text-text-primary">
                        {hasPrice
                          ? isKRItem ? fmtKRWFull(Number(p.price)) : fmtUSDFull(Number(p.price))
                          : 시세없는자산
                            ? <span className="text-text-dim text-xs">시세 없음</span>
                            : <span className="text-text-muted text-xs">조회 중</span>}
                      </div>
                      {hasPrice && p.change_rate != null && (
                      <ChangeBadge value={Number(p.change_rate)} className="text-xs"
                        금액={p.change != null ? Number(p.change) : null}
                        통화={isKRItem ? "KRW" : "USD"} />
                    )}
                    </div>
                  </div>
                );
              })
          )}
        </Card>
      ) : isPreview ? (() => {
        const mktFiltered = marketTab === "전체" ? previewWatchlistLive : previewWatchlistLive.filter(i => i.market === marketTab);
        const shown = folderTab === "all" ? mktFiltered : mktFiltered.filter(i => i.folderId === folderTab);
        /* 본문 폴더 순서도 탭 줄과 같아야 한다. 탭에서 순서를 바꿔 놓고
           아래 목록은 그대로면, 바꾼 것이 안 먹은 줄 안다 */
        const 탭순 = 정렬된탭.filter(t => t.종류 === "folder").map(t => t.id);
        const visibleFolders = 탭순
          .map(id => PREVIEW_FOLDERS.find(f => f.id === id))
          .filter((f): f is typeof PREVIEW_FOLDERS[number] => !!f && shown.some(i => i.folderId === f.id));
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
      })() : isLoading ? <RowSkeleton rows={5} />
        /* 시세가 안 뜨는 이유를 알 수 없던 자리. 빈 목록과 갈라야 한다 */
        : 못받음 ? <못불러옴 사유={실패사유} 다시={() => 다시받기()} /> : (
        <div key={`${marketTab}-${folderTab}`} className="flex flex-col gap-3 tab-fade">
          {/* 폴더 그룹 — 폴더 탭이 "전체"이거나 해당 폴더가 선택된 경우에만 표시 */}
          {(localFolderOrder ?? folders)
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
                  {folders.length > 1 && (
                    <div
                      draggable
                      onDragStart={() => handleFolderDragStart(folder)}
                      onTouchStart={() => handleFolderDragStart(folder)}
                      onTouchMove={(e) => handleFolderTouchMove(e.touches[0].clientX, e.touches[0].clientY)}
                      onTouchEnd={handleFolderDrop}
                      className="cursor-grab active:cursor-grabbing text-text-dim hover:text-text-muted touch-none flex-shrink-0 px-1 py-1"
                      title="드래그하여 폴더 순서 변경" aria-label="드래그하여 폴더 순서 변경"
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
                        <button aria-label="수정" onClick={() => setEditingFolder(folder.id)} className="text-text-muted hover:text-accent-blue p-1"><Pencil size={13} /></button>
                        <button aria-label="삭제" onClick={() => setDeletingFolder({ ...folder, _itemCount: folderItems.length })} className="text-text-muted hover:text-accent-red p-1"><Trash2 size={13} /></button>
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
                          <Plus size={13} /> 종목 추가
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
          탭들={정렬된탭}
          onClose={() => setShowFolderManager(false)}
          onCreate={() => { createFolderMutation.mutate(); setShowFolderManager(false); }}
          onRename={(id, name) => updateFolderMutation.mutate({ id, name })}
          onDelete={(folder) => {
            const count = items.filter((i) => i.folder_id === folder.id).length;
            setDeletingFolder({ ...folder, _itemCount: count });
            setShowFolderManager(false);
          }}
          onReorder={탭순서바꾸기}
        />
      )}
    </div>
  );
}
