import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { watchlistApi, watchlistFolderApi, stocksApi } from "@/api/stocks";
import api from "@/api/client";
import { Card, ChangeBadge, LoadingSpinner, Badge } from "@/components/ui";
import { usePricesStream } from "@/hooks/useWebSocket";
import { Plus, FolderPlus, Pencil, Trash2, Star, Wallet, ChevronDown, ChevronRight, X, Check, Search, Settings2, LogIn } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

const MARKET_TABS = [
  { id: "전체", label: "전체" },
  { id: "KR",   label: "국내" },
  { id: "US",   label: "해외" },
  { id: "ETF",  label: "ETF"  },
];

/* ── 미리보기 예시 데이터 (비로그인 시 표시) ── */
interface PreviewItem {
  id: number; symbol: string; market: string; name: string;
  folderId: number; price: number; change_rate: number;
}
interface PreviewFolder { id: number; name: string; }

const PREVIEW_FOLDERS: PreviewFolder[] = [
  { id: -1, name: "국내 우량주" },
  { id: -2, name: "해외 성장주" },
  { id: -3, name: "ETF" },
];
const PREVIEW_WATCHLIST: PreviewItem[] = [
  { id: -1, symbol: "005930", market: "KR",  name: "삼성전자",          folderId: -1, price: 72400,  change_rate:  0.58 },
  { id: -2, symbol: "000660", market: "KR",  name: "SK하이닉스",        folderId: -1, price: 198500, change_rate:  1.33 },
  { id: -3, symbol: "035720", market: "KR",  name: "카카오",             folderId: -1, price: 42150,  change_rate: -1.17 },
  { id: -4, symbol: "NVDA",   market: "US",  name: "엔비디아",           folderId: -2, price: 875.43, change_rate:  2.14 },
  { id: -5, symbol: "AAPL",   market: "US",  name: "애플",               folderId: -2, price: 221.85, change_rate:  0.73 },
  { id: -6, symbol: "TSLA",   market: "US",  name: "테슬라",             folderId: -2, price: 247.15, change_rate: -0.94 },
  { id: -7, symbol: "SPY",    market: "ETF", name: "SPDR S&P 500 ETF",  folderId: -3, price: 534.21, change_rate:  0.41 },
  { id: -8, symbol: "QQQ",    market: "ETF", name: "Invesco QQQ Trust", folderId: -3, price: 461.83, change_rate:  0.89 },
];

const MKTCOLOR: Record<string, string> = {
  KR:  "border-blue-700/50 text-blue-400 bg-blue-900/20",
  US:  "border-green-700/50 text-green-400 bg-green-900/20",
  ETF: "border-purple-700/50 text-purple-400 bg-purple-900/20",
};

function PreviewItemRow({ item, onNavigate }: { item: PreviewItem; onNavigate: () => void }) {
  const isKR = item.market === "KR";
  const up   = item.change_rate >= 0;
  return (
    <div
      className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30 bg-bg-card hover:bg-bg-hover cursor-pointer transition-colors"
      onClick={onNavigate}
    >
      {/* 마켓 배지 */}
      <div className={`text-[10px] px-1.5 py-0.5 rounded border font-bold flex-shrink-0 ${MKTCOLOR[item.market] ?? ""}`}>
        {item.market}
      </div>
      {/* 종목 정보 */}
      <div className="flex-1 min-w-0">
        <div className="font-mono font-bold text-sm text-text-primary">
          {item.symbol.replace(".KS","").replace(".KQ","")}
        </div>
        <div className="text-[11px] text-text-muted truncate">{item.name}</div>
      </div>
      {/* 가격 */}
      <div className="text-right flex-shrink-0 min-w-[80px]">
        <div className="text-sm font-mono font-semibold text-text-primary">
          {isKR ? `₩${item.price.toLocaleString("ko-KR")}` : `$${item.price.toFixed(2)}`}
        </div>
        <div className={`text-xs font-semibold ${up ? "text-green-400" : "text-red-400"}`}>
          {up ? "+" : ""}{item.change_rate.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

/* ── 검색 기반 종목 추가 모달 ─────────────────────────────── */
interface SearchResult {
  symbol: string; name: string; market: string; type: string; exchange: string;
}

function AddModal({ folders, defaultFolderId = null, onClose, onAdd }: {
  folders: any[];
  defaultFolderId?: number | null;
  onClose: () => void;
  onAdd: (req: any) => void;
}) {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<SearchResult[]>([]);
  const [loading, setLoading]   = useState(false);
  const [folderId, setFolderId] = useState<number | null>(defaultFolderId);
  const [memo, setMemo]         = useState("");
  const debounce  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const { data } = await api.get<{ results: SearchResult[] }>("/search", { params: { q: query } });
        setResults(data.results ?? []);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300); // 한국어 조합 완료 후 검색되도록 디바운스 약간 늘림
  }, [query]);

  const handleSelect = (item: SearchResult) => {
    onAdd({ symbol: item.symbol, market: item.market, name: item.name, folder_id: folderId, memo });
    onClose();
  };

  const MKTCOLOR: Record<string, string> = {
    KR: "border-blue-700/50 text-blue-400 bg-blue-900/20",
    US: "border-green-700/50 text-green-400 bg-green-900/20",
    ETF: "border-purple-700/50 text-purple-400 bg-purple-900/20",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary">관심종목 추가</h3>
          <button onClick={onClose}><X size={15} className="text-text-muted hover:text-text-primary" /></button>
        </div>

        {/* 검색 입력 */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
          <Search size={14} className="text-text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            placeholder="종목명 또는 코드 검색 (예: AAPL, 005930, 삼성)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {loading && <div className="w-4 h-4 border border-accent-blue border-t-transparent rounded-full animate-spin flex-shrink-0" />}
        </div>

        {/* 검색 결과 */}
        <div className="max-h-64 overflow-y-auto">
          {!query && (
            <div className="px-4 py-6 text-center text-text-muted text-xs">
              종목명·코드·한글로 검색하세요
            </div>
          )}
          {query && !loading && results.length === 0 && (
            <div className="px-4 py-6 text-center text-text-muted text-sm">검색 결과 없음</div>
          )}
          {results.map((item) => (
            <button
              key={item.symbol}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-border/30 hover:bg-bg-hover text-left transition-colors"
              onClick={() => handleSelect(item)}
            >
              <div className={`text-[10px] px-1.5 py-0.5 rounded border font-bold flex-shrink-0 ${MKTCOLOR[item.market] ?? ""}`}>
                {item.market}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-mono font-bold text-sm text-text-primary">{item.symbol}</div>
                <div className="text-xs text-text-muted truncate">{item.name}</div>
              </div>
              <div className="text-xs text-text-muted flex-shrink-0">{item.exchange}</div>
              <Plus size={13} className="text-accent-blue flex-shrink-0" />
            </button>
          ))}
        </div>

        {/* 옵션 */}
        <div className="px-4 py-3 border-t border-border flex flex-col gap-2">
          {folders.length > 0 && (
            <select
              className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none"
              value={folderId ?? ""}
              onChange={(e) => setFolderId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">폴더 없음</option>
              {folders.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          <input
            className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none placeholder:text-text-muted"
            placeholder="메모 (선택)"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

/* ── 종목 편집 모달 ──────────────────────────────────────── */
function EditItemModal({ item, folders, onClose, onSave }: {
  item: any;
  folders: any[];
  onClose: () => void;
  onSave: (patch: { name?: string; memo?: string; folder_id?: number | null }) => void;
}) {
  const [name, setName]     = useState(item.name || "");
  const [memo, setMemo]     = useState(item.memo || "");
  const [folderId, setFolderId] = useState<number | null>(item.folder_id ?? null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
          <div>
            <h3 className="text-sm font-bold text-text-primary">종목 편집</h3>
            <p className="text-2xs text-text-muted mt-0.5">{item.symbol}</p>
          </div>
          <button onClick={onClose}><X size={15} className="text-text-muted hover:text-text-primary" /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-2xs font-semibold text-text-muted">표시 이름</label>
            <input
              className="bg-bg-primary border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
              placeholder={item.symbol}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-2xs font-semibold text-text-muted">메모</label>
            <textarea
              rows={3}
              className="bg-bg-primary border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue resize-none"
              placeholder="메모 입력..."
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
          {folders.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-2xs font-semibold text-text-muted">폴더</label>
              <select
                className="bg-bg-primary border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none"
                value={folderId ?? ""}
                onChange={(e) => setFolderId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">폴더 없음</option>
                {folders.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-border text-text-muted text-sm hover:border-accent-blue hover:text-text-primary transition-all"
            >취소</button>
            <button
              onClick={() => { onSave({ name, memo, folder_id: folderId }); onClose(); }}
              className="flex-1 py-2 rounded-xl bg-accent-blue text-white text-sm font-semibold hover:bg-blue-600 transition-colors"
            >저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 폴더 이름 편집 ──────────────────────────────────────── */
function FolderNameEdit({ folder, onSave, onCancel }: { folder: any; onSave: (n: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState(folder.name);
  return (
    <div className="flex items-center gap-1 flex-1">
      <input
        className="flex-1 bg-bg-primary border border-accent-blue rounded-lg px-2 py-0.5 text-xs text-text-primary focus:outline-none"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(val); if (e.key === "Escape") onCancel(); }}
        autoFocus
      />
      <button onClick={() => onSave(val)} className="text-accent-green p-1"><Check size={13} /></button>
      <button onClick={onCancel} className="text-text-muted p-1"><X size={13} /></button>
    </div>
  );
}

/* ── 종목 행 (클릭 → 상세) ──────────────────────────────── */
const SWIPE_REVEAL = 140; // 수정(70) + 삭제(70)
const SWIPE_THRESHOLD = 50;

/* ── 종목 행: 드래그 재정렬 + 왼쪽으로 스와이프 → 수정/삭제 ─── */
function ItemRow({ item, livePrice, onRemove, onNavigate, onEdit, onPrefetch,
  isDragging, isDragOver, onDragStart, onDragOver, onDrop }: {
  item: any; livePrice: any;
  onRemove: () => void; onNavigate: () => void; onEdit: () => void;
  onPrefetch?: () => void;
  isDragging?: boolean; isDragOver?: boolean;
  onDragStart?: React.DragEventHandler;
  onDragOver?: React.DragEventHandler;
  onDrop?: React.DragEventHandler;
}) {
  const p        = livePrice ?? item;
  const isKR     = item.market === "KR";
  const hasPrice = p.price != null && p.price > 0;

  const [swipeX, setSwipeX] = useState(0); // 음수 = 왼쪽으로 밀림
  const [isOpen, setIsOpen] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isScrolling = useRef<boolean | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isScrolling.current = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (isScrolling.current === null) isScrolling.current = Math.abs(dy) > Math.abs(dx);
    if (isScrolling.current) return;
    const base = isOpen ? -SWIPE_REVEAL : 0;
    // 왼쪽(음수)으로만 허용
    setSwipeX(Math.min(0, Math.max(-SWIPE_REVEAL - 16, base + dx)));
  };
  const onTouchEnd = () => {
    if (isScrolling.current) return;
    if (swipeX < -SWIPE_THRESHOLD) { setSwipeX(-SWIPE_REVEAL); setIsOpen(true); }
    else { setSwipeX(0); setIsOpen(false); }
  };
  const closeSwipe = () => { setSwipeX(0); setIsOpen(false); };

  return (
    <div
      className={`relative overflow-hidden border-b border-border/30 group ${isDragOver ? "bg-accent-blue/5" : ""} ${isDragging ? "opacity-40" : ""}`}
      onDragOver={onDragOver} onDrop={onDrop}
      onMouseEnter={onPrefetch}
    >
      {/* 스와이프 액션 버튼 (오른쪽 고정, 왼쪽으로 밀면 등장) */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: SWIPE_REVEAL }}>
        <button onClick={() => { closeSwipe(); onEdit(); }}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-accent-blue text-white text-[10px] font-semibold">
          <Settings2 size={14}/><span>수정</span>
        </button>
        <button onClick={() => { closeSwipe(); onRemove(); }}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-accent-red text-white text-[10px] font-semibold">
          <Trash2 size={14}/><span>삭제</span>
        </button>
      </div>

      {/* 슬라이드 콘텐츠 */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 bg-bg-card hover:bg-bg-hover"
        style={{ transform: `translateX(${swipeX}px)`, transition: swipeX === 0 || swipeX === -SWIPE_REVEAL ? "transform 0.2s ease" : "none" }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onClick={swipeX !== 0 ? closeSwipe : undefined}
      >
        {/* 드래그 핸들 */}
        <div
          draggable
          onDragStart={onDragStart}
          className="cursor-grab active:cursor-grabbing text-text-dim hover:text-text-muted touch-none flex-shrink-0 px-1 py-1"
          title="드래그하여 순서 변경"
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="3" cy="2.5" r="1.3"/><circle cx="7" cy="2.5" r="1.3"/>
            <circle cx="3" cy="7"   r="1.3"/><circle cx="7" cy="7"   r="1.3"/>
            <circle cx="3" cy="11.5" r="1.3"/><circle cx="7" cy="11.5" r="1.3"/>
          </svg>
        </div>

        {/* 종목 정보 */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onNavigate}>
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-sm text-text-primary">
              {item.symbol?.replace(".KS","").replace(".KQ","")}
            </span>
            {livePrice && <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse flex-shrink-0"/>}
            <Badge variant={item.market==="KR"?"blue":item.market==="ETF"?"purple":"green"}>
              {item.market}
            </Badge>
          </div>
          <div className="text-[11px] text-text-muted truncate">{item.name || p.name}</div>
          {item.memo && <div className="text-[10px] text-text-muted/60 italic mt-0.5">{item.memo}</div>}
        </div>

        {/* 가격 */}
        <div className="text-right flex-shrink-0 cursor-pointer min-w-[80px]" onClick={onNavigate}>
          <div className="text-sm font-mono font-semibold text-text-primary">
            {hasPrice
              ? isKR ? `₩${Number(p.price).toLocaleString("ko-KR")}` : `$${Number(p.price).toFixed(2)}`
              : <span className="text-text-muted text-xs">조회 중</span>}
          </div>
          {hasPrice && p.change_rate != null && <ChangeBadge value={Number(p.change_rate)} className="text-xs"/>}
        </div>

        {/* 데스크탑 hover 버튼 */}
        <div className="hidden md:flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit}   className="text-text-muted hover:text-accent-blue p-1"><Settings2 size={13}/></button>
          <button onClick={onRemove} className="text-text-muted hover:text-accent-red  p-1"><Trash2 size={13}/></button>
        </div>
      </div>
    </div>
  );
}

/* ── 메인 ────────────────────────────────────────────────── */
export default function Watchlist() {
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();
  const isPreview = !isLoggedIn;
  const [marketTab, setMarketTab]   = useState("전체");
  const [folderTab, setFolderTab]   = useState<number | "all" | "none">("all"); // 폴더 탭 필터
  const [showAdd, setShowAdd]           = useState(false);
  const [addFolderId, setAddFolderId]   = useState<number | null>(null); // 추가 모달에서 기본 선택될 폴더
  const [editingFolder, setEditingFolder] = useState<number | null>(null);
  const [editingItem, setEditingItem]   = useState<any>(null);
  const [collapsed, setCollapsed]   = useState<Set<string>>(new Set());
  const [livePrices, setLivePrices] = useState<Record<string, any>>({});
  const [addError, setAddError]     = useState("");

  const { data: folders = [] } = useQuery({
    queryKey: ["watchlist-folders"],
    queryFn: watchlistFolderApi.getFolders,
  });

  const mkt = marketTab === "전체" ? undefined : marketTab;

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["watchlist-items", marketTab],
    queryFn: () => watchlistApi.getItems(mkt),
    refetchInterval: 120_000,
  });

  const symbols = useMemo(() => (items as any[]).map((i: any) => i.symbol), [items]);
  const markets  = useMemo(() => (items as any[]).map((i: any) => i.market === "KR" ? "KR" : "US"), [items]);

  /* REST 배치 가격 조회 — signal을 받아 컴포넌트 언마운트/취소 시 HTTP 요청도 중단 */
  const { data: restPrices } = useQuery({
    queryKey: ["watchlist-prices", symbols.join(",")],
    queryFn: ({ signal }) => watchlistApi.getPrices(symbols, markets, signal),
    enabled: symbols.length > 0,
    staleTime: 55_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!restPrices?.length) return;
    const map: Record<string, any> = {};
    (restPrices as any[]).forEach((p: any) => {
      if (p?.symbol && p.price != null) map[p.symbol] = p;
    });
    if (Object.keys(map).length) setLivePrices(prev => ({ ...prev, ...map }));
  }, [restPrices]);

  /* WebSocket — 캐시에 있는 종목 실시간 업데이트 (보조) */
  usePricesStream(symbols, markets, useCallback((prices: any[]) => {
    const map: Record<string, any> = {};
    prices.forEach((p) => { if (!p.error && p.price != null) map[p.symbol] = p; });
    if (Object.keys(map).length) setLivePrices((prev) => ({ ...prev, ...map }));
  }, []), 30);

  const addMutation = useMutation({
    mutationFn: (req: any) => watchlistApi.addItem({ ...req, watchlist_id: 1 }),
    onSuccess: () => {
      setAddError("");
      qc.invalidateQueries({ queryKey: ["watchlist-items"] });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || "종목 추가에 실패했습니다";
      setAddError(String(msg));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => watchlistApi.removeItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist-items"] }),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: any }) => watchlistApi.updateItem(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist-items"] }),
  });

  // 드래그 상태
  const [dragId, setDragId]   = useState<number | null>(null);
  const [dropId, setDropId]   = useState<number | null>(null);
  const [localOrder, setLocalOrder] = useState<any[] | null>(null); // 드래그 중 낙관적 순서

  const reorderMutation = useMutation({
    mutationFn: (order: number[]) => watchlistApi.reorderItems(order),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist-items"] }),
  });

  const handleDragStart = (item: any) => {
    setDragId(item.id);
    setLocalOrder(itemsList);
  };

  const handleDragOver = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (dragId === null || dragId === targetId) return;
    setDropId(targetId);
    // 낙관적 순서 재배치
    const base = localOrder ?? itemsList;
    const from = base.findIndex((i: any) => i.id === dragId);
    const to   = base.findIndex((i: any) => i.id === targetId);
    if (from === -1 || to === -1) return;
    const next = [...base];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setLocalOrder(next);
  };

  const handleDrop = () => {
    if (dragId !== null && localOrder) {
      reorderMutation.mutate(localOrder.map((i: any) => i.id));
    }
    setDragId(null); setDropId(null); setLocalOrder(null);
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

  // 드래그 중에는 낙관적으로 정렬된 순서 사용
  const baseList  = localOrder ?? (items as any[]);
  const itemsList = items as any[];

  // 폴더 탭 필터 적용
  const displayList = folderTab === "all"
    ? baseList
    : folderTab === "none"
      ? baseList.filter((i: any) => !i.folder_id)
      : baseList.filter((i: any) => i.folder_id === folderTab);

  const noFolder  = displayList.filter((i: any) => !i.folder_id);
  const byFolder  = (fid: number) => displayList.filter((i: any) => i.folder_id === fid);

  const openAddModal = (folderId: number | null) => {
    setAddFolderId(folderId);
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
          const item = displayList.find((i: any) => i.symbol === sym);
          if (item && !queue.find((q: any) => q.symbol === sym)) queue.push(item);
        }
      });
      if (queue.length > 0 && !timer) timer = setTimeout(flush, 200);
    }, { threshold: 0.5 });
    rowRefs.current.forEach(row => observer.observe(row));
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
  }, [displayList, prefetchStock]);

  const renderItems = (list: any[]) =>
    list.map((item: any) => (
      <div key={item.id} ref={el => { if (el) rowRefs.current.set(item.symbol, el); else rowRefs.current.delete(item.symbol); }} data-sym={item.symbol}>
        <ItemRow
          item={item}
          livePrice={livePrices[item.symbol]}
          onRemove={() => removeMutation.mutate(item.id)}
          onNavigate={() => goToStock(item)}
          onEdit={() => setEditingItem(item)}
          onPrefetch={() => prefetchStock(item)}
          isDragging={dragId === item.id}
          isDragOver={dropId === item.id}
          onDragStart={() => handleDragStart(item)}
          onDragOver={(e) => handleDragOver(e, item.id)}
          onDrop={handleDrop}
        />
      </div>
    ));

  return (
    <div className="flex flex-col gap-5">
      {/* 추가 오류 토스트 */}
      {addError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-4 py-2.5 bg-accent-red text-white text-xs font-semibold rounded-xl shadow-lg animate-fade-in">
          <span>{addError}</span>
          <button onClick={() => setAddError("")} className="ml-1 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">관심종목</h1>
          <p className="text-text-muted text-xs mt-0.5">
            {isPreview ? `${PREVIEW_WATCHLIST.length}개 예시 종목 · 클릭하면 상세로 이동` : `${itemsList.length}개 종목 · 클릭하면 상세로 이동`}
          </p>
        </div>
        {isLoggedIn && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => createFolderMutation.mutate()}
              className="flex items-center gap-1.5 px-3 py-2 bg-bg-card border border-border rounded-xl text-xs text-text-secondary hover:border-accent-blue hover:text-accent-blue transition-all"
            >
              <FolderPlus size={13} />폴더
            </button>
            <button
              onClick={() => openAddModal(typeof folderTab === "number" ? folderTab : null)}
              className="flex items-center gap-1.5 px-3 py-2 bg-accent-blue hover:bg-blue-600 rounded-xl text-xs text-white font-semibold transition-all"
            >
              <Plus size={13} />종목 추가
            </button>
          </div>
        )}
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
          `flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-semibold border-r border-border last:border-r-0 transition-all ${
            active ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-hover bg-bg-card"
          }`;
        return (
          <div className="flex overflow-x-auto scrollbar-hide rounded-lg border border-border w-fit max-w-full">
            <button onClick={() => setFolderTab("all")} className={tabBtnCls(folderTab === "all")}>
              전체 <span className="text-[10px] opacity-70">{mktFiltered.length}</span>
            </button>
            {PREVIEW_FOLDERS.map(f => {
              const cnt = mktFiltered.filter(i => i.folderId === f.id).length;
              if (cnt === 0) return null;
              return (
                <button key={f.id} onClick={() => setFolderTab(f.id)} className={tabBtnCls(folderTab === f.id)}>
                  {f.name} <span className="text-[10px] opacity-70">{cnt}</span>
                </button>
              );
            })}
          </div>
        );
      })() : (() => {
        const tabBtnCls = (active: boolean) =>
          `flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-semibold border-r border-border last:border-r-0 transition-all ${
            active ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-hover bg-bg-card"
          }`;
        return (
          <div className="flex overflow-x-auto scrollbar-hide rounded-lg border border-border w-fit max-w-full">
            <button onClick={() => setFolderTab("all")} className={tabBtnCls(folderTab === "all")}>
              전체 <span className="text-[10px] opacity-70">{itemsList.length}</span>
            </button>
            <button onClick={() => setFolderTab("none")} className={tabBtnCls(folderTab === "none")}>
              기본 <span className="text-[10px] opacity-70">{itemsList.filter((i: any) => !i.folder_id).length}</span>
            </button>
            {(folders as any[]).map((f: any) => {
              const cnt = itemsList.filter((i: any) => i.folder_id === f.id).length;
              return (
                <button key={f.id} onClick={() => setFolderTab(folderTab === f.id ? "all" : f.id)} className={tabBtnCls(folderTab === f.id)}>
                  {f.name} <span className="text-[10px] opacity-70">{cnt}</span>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* 본문 */}
      {isPreview ? (() => {
        const mktFiltered = marketTab === "전체" ? PREVIEW_WATCHLIST : PREVIEW_WATCHLIST.filter(i => i.market === marketTab);
        const shown = folderTab === "all" ? mktFiltered : mktFiltered.filter(i => i.folderId === folderTab);
        const visibleFolders = PREVIEW_FOLDERS.filter(f => shown.some(i => i.folderId === f.id));
        return (
          <div className="flex flex-col gap-3">
            {visibleFolders.map(folder => (
              <Card key={folder.id} className="p-0 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-bg-secondary border-b border-border">
                  <ChevronDown size={14} className="text-text-muted" />
                  <span className="flex-1 text-sm font-semibold text-text-primary">{folder.name}</span>
                  <span className="text-xs text-text-muted">{shown.filter(i => i.folderId === folder.id).length}개</span>
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
      })() : isLoading ? <LoadingSpinner /> : (
        <div className="flex flex-col gap-3">
          {/* 폴더 그룹 — 폴더 탭이 "전체"이거나 해당 폴더가 선택된 경우에만 표시 */}
          {(folders as any[])
            .filter((folder: any) => folderTab === "all" || folderTab === folder.id)
            .map((folder: any) => {
            const folderItems = byFolder(folder.id);
            const isCollapsed = collapsed.has(`f-${folder.id}`);
            return (
              <Card key={folder.id} className="p-0 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-bg-secondary border-b border-border group">
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
                      <span className="text-xs text-text-muted">{folderItems.length}개</span>
                      <button onClick={() => openAddModal(folder.id)} className="text-text-muted hover:text-accent-blue p-1" title="이 폴더에 종목 추가">
                        <Plus size={13} />
                      </button>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditingFolder(folder.id)} className="text-text-muted hover:text-accent-blue p-1"><Pencil size={12} /></button>
                        <button onClick={() => deleteFolderMutation.mutate(folder.id)} className="text-text-muted hover:text-accent-red p-1"><Trash2 size={12} /></button>
                      </div>
                    </>
                  )}
                </div>
                {!isCollapsed && (
                  folderItems.length === 0
                    ? <div className="px-4 py-4 text-text-muted text-xs text-center">종목이 없습니다</div>
                    : renderItems(folderItems)
                )}
              </Card>
            );
          })}

          {/* 폴더 없는 종목 — 폴더 탭이 "전체"이거나 "기본"이 선택된 경우에만 표시 */}
          {(folderTab === "none" || (folderTab === "all" && noFolder.length > 0)) && (
            <Card className="p-0 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-bg-secondary border-b border-border">
                <button onClick={() => toggleCollapse("no-folder")} className="text-text-muted">
                  {collapsed.has("no-folder") ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <Star size={13} className="text-accent-yellow" />
                <span className="flex-1 text-sm font-semibold text-text-primary">기본 관심목록</span>
                <span className="text-xs text-text-muted">{noFolder.length}개</span>
                <button onClick={() => openAddModal(null)} className="text-text-muted hover:text-accent-blue p-1" title="기본 관심목록에 종목 추가">
                  <Plus size={13} />
                </button>
              </div>
              {!collapsed.has("no-folder") && (
                noFolder.length === 0
                  ? <div className="px-4 py-4 text-text-muted text-xs text-center">종목이 없습니다</div>
                  : renderItems(noFolder)
              )}
            </Card>
          )}

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

      {isLoggedIn && showAdd && (
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
    </div>
  );
}
