import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { stocksApi } from "@/api/stocks";
import api from "@/api/client";
import { Card } from "@/components/ui";
import { Plus, Pencil, Trash2, Star, Wallet, X, Search, ArrowLeft } from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

/* ── Types ─────────────────────────────────────────────── */
type Market = "KR" | "US" | "ETF";

interface PortfolioItem {
  id: string;
  symbol: string;
  market: Market;
  name: string;
  shares: number;
  avgPrice: number;
  purchaseDate?: string;
  note?: string;
}

interface EnrichedItem extends PortfolioItem {
  currentPrice: number;
  currentValue: number;
  cost: number;
  pnl: number;
  pnlRate: number;
}

/* ── Constants ─────────────────────────────────────────── */
const STORAGE_KEY = "portfolio_items";
const PIE_COLORS = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4","#f97316","#84cc16"];

/* ── useLocalStorage ────────────────────────────────────── */
function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);

  return [state, setState];
}

/* ── Format utils ───────────────────────────────────────── */
function fmtPrice(market: Market, price: number): string {
  if (market === "KR") return `₩${Math.round(price).toLocaleString("ko-KR")}`;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtValue(market: Market, value: number): string {
  if (market === "KR") {
    const abs = Math.abs(value);
    if (abs >= 1e8) return `₩${(value / 1e8).toFixed(2)}억`;
    if (abs >= 1e4) return `₩${(value / 1e4).toFixed(1)}만`;
    return `₩${Math.round(value).toLocaleString("ko-KR")}`;
  }
  const abs = Math.abs(value);
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function fmtPnl(market: Market, value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${fmtValue(market, value)}`;
}

/* ── Market badge ───────────────────────────────────────── */
function MarketBadge({ market }: { market: Market }) {
  const cls =
    market === "KR"  ? "border-blue-700/50 text-blue-400 bg-blue-900/20" :
    market === "ETF" ? "border-yellow-700/50 text-yellow-400 bg-yellow-900/20" :
                       "border-green-700/50 text-green-400 bg-green-900/20";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${cls}`}>{market}</span>
  );
}

interface SearchResult {
  symbol: string; name: string; market: string; type: string; exchange: string;
}

const MKTCOLOR: Record<string, string> = {
  KR:  "border-blue-700/50 text-blue-400 bg-blue-900/20",
  US:  "border-green-700/50 text-green-400 bg-green-900/20",
  ETF: "border-purple-700/50 text-purple-400 bg-purple-900/20",
};

/* ── Add/Edit Modal (Step 1: 검색 → Step 2: 매수 정보) ─── */
function PortfolioModal({
  item,
  onClose,
  onSave,
}: {
  item?: PortfolioItem;
  onClose: () => void;
  onSave: (data: Omit<PortfolioItem, "id">) => void;
}) {
  const [step, setStep] = useState<1 | 2>(item ? 2 : 1);
  const [selected, setSelected] = useState<{ symbol: string; market: Market; name: string } | null>(
    item ? { symbol: item.symbol, market: item.market, name: item.name } : null
  );

  const [query,     setQuery]     = useState("");
  const [results,   setResults]   = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const sharesRef   = useRef<HTMLInputElement>(null);

  const [shares,       setShares]       = useState(item ? String(item.shares)   : "");
  const [avgPrice,     setAvgPrice]     = useState(item ? String(item.avgPrice) : "");
  const [purchaseDate, setPurchaseDate] = useState(item?.purchaseDate ?? "");
  const [note,         setNote]         = useState(item?.note ?? "");

  useEffect(() => {
    if (step === 1) setTimeout(() => inputRef.current?.focus(), 50);
    if (step === 2) setTimeout(() => sharesRef.current?.focus(), 50);
  }, [step]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get<{ results: SearchResult[] }>("/search", { params: { q: query } });
        setResults(data.results ?? []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
  }, [query]);

  const handleSelect = (r: SearchResult) => {
    setSelected({ symbol: r.symbol, market: r.market as Market, name: r.name });
    setStep(2);
  };

  const canSave = Number(shares) > 0 && Number(avgPrice) >= 0 && selected != null;

  const handleSave = () => {
    if (!canSave || !selected) return;
    onSave({
      symbol: selected.symbol,
      market: selected.market,
      name: selected.name,
      shares: Number(shares),
      avgPrice: Number(avgPrice),
      purchaseDate: purchaseDate || undefined,
      note: note || undefined,
    });
  };

  const inp = "w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">

        {/* 헤더 */}
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-border">
          {step === 2 && !item && (
            <button onClick={() => setStep(1)} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
              <ArrowLeft size={15} />
            </button>
          )}
          <h3 className="flex-1 text-sm font-bold text-text-primary">
            {item ? "포지션 수정" : step === 1 ? "종목 검색" : "매수 정보 입력"}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Step 1: 검색 */}
        {step === 1 && (
          <>
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
              {searching && <div className="w-4 h-4 border border-accent-blue border-t-transparent rounded-full animate-spin flex-shrink-0" />}
            </div>
            <div className="max-h-72 overflow-y-auto">
              {!query && (
                <div className="px-4 py-8 text-center text-text-muted text-xs">종목명·코드·한글로 검색하세요</div>
              )}
              {query && !searching && results.length === 0 && (
                <div className="px-4 py-8 text-center text-text-muted text-sm">검색 결과 없음</div>
              )}
              {results.map((r) => (
                <button
                  key={r.symbol + r.market}
                  className="w-full flex items-center gap-3 px-4 py-3 border-b border-border/30 hover:bg-bg-hover text-left transition-colors"
                  onClick={() => handleSelect(r)}
                >
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold flex-shrink-0 ${MKTCOLOR[r.market] ?? ""}`}>
                    {r.market}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-bold text-sm text-text-primary">{r.symbol}</div>
                    <div className="text-xs text-text-muted truncate">{r.name}</div>
                  </div>
                  <span className="text-xs text-text-muted flex-shrink-0">{r.exchange}</span>
                  <Plus size={13} className="text-accent-blue flex-shrink-0" />
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 2: 매수 정보 */}
        {step === 2 && selected && (
          <>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-bg-elevated/50">
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold flex-shrink-0 ${MKTCOLOR[selected.market] ?? ""}`}>
                {selected.market}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-mono font-bold text-sm text-text-primary">{selected.symbol}</div>
                <div className="text-xs text-text-muted truncate">{selected.name}</div>
              </div>
            </div>

            <div className="px-5 py-4 flex flex-col gap-3.5">
              <div className="flex gap-3">
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-2xs font-semibold text-text-muted">보유수량 *</label>
                  <input
                    ref={sharesRef}
                    className={inp}
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    placeholder="0"
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                  />
                </div>
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-2xs font-semibold text-text-muted">평균매수가 *</label>
                  <input
                    className={inp}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={avgPrice}
                    onChange={(e) => setAvgPrice(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-2xs font-semibold text-text-muted">매수일</label>
                <input
                  className={inp}
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-2xs font-semibold text-text-muted">
                  메모<span className="ml-1 text-text-dim font-normal">({note.length}/100)</span>
                </label>
                <textarea
                  className={`${inp} resize-none`}
                  rows={2}
                  maxLength={100}
                  placeholder="선택 사항"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-border">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg bg-accent-blue text-white hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                저장
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────── */
export default function Portfolio() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"portfolio" | "watchlist">("portfolio");
  const [items, setItems] = useLocalStorage<PortfolioItem[]>(STORAGE_KEY, []);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<PortfolioItem | undefined>(undefined);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleTabChange = (tab: "portfolio" | "watchlist") => {
    if (tab === "watchlist") {
      navigate("/watchlist");
      return;
    }
    setActiveTab(tab);
  };

  const priceQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ["price", item.market, item.symbol],
      queryFn: () => stocksApi.getPrice(item.market, item.symbol),
      staleTime: 60_000,
      refetchInterval: 60_000,
    })),
  });

  const priceMap = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((item, i) => {
      const data = priceQueries[i]?.data as any;
      if (data?.price != null) {
        map[item.id] = data.price;
      }
    });
    return map;
  }, [items, priceQueries]);

  const enriched = useMemo<EnrichedItem[]>(() => {
    return items.map((item) => {
      const currentPrice = priceMap[item.id] ?? item.avgPrice;
      const currentValue = currentPrice * item.shares;
      const cost = item.avgPrice * item.shares;
      const pnl = currentValue - cost;
      const pnlRate = cost !== 0 ? (pnl / cost) * 100 : 0;
      return { ...item, currentPrice, currentValue, cost, pnl, pnlRate };
    });
  }, [items, priceMap]);

  const summary = useMemo(() => {
    const totalValue = enriched.reduce((s, e) => s + e.currentValue, 0);
    const totalCost  = enriched.reduce((s, e) => s + e.cost, 0);
    const totalPnl   = totalValue - totalCost;
    const totalRate  = totalCost !== 0 ? (totalPnl / totalCost) * 100 : 0;
    return { totalValue, totalCost, totalPnl, totalRate };
  }, [enriched]);

  const marketPieData = useMemo(() => {
    const map: Record<string, number> = {};
    enriched.forEach((e) => {
      map[e.market] = (map[e.market] ?? 0) + e.currentValue;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [enriched]);

  const stockPieData = useMemo(() => {
    const sorted = [...enriched].sort((a, b) => b.currentValue - a.currentValue);
    const top = sorted.slice(0, 8);
    const rest = sorted.slice(8);
    const data = top.map((e) => ({ name: e.name || e.symbol, value: e.currentValue }));
    if (rest.length > 0) {
      const restValue = rest.reduce((s, e) => s + e.currentValue, 0);
      data.push({ name: "기타", value: restValue });
    }
    return data;
  }, [enriched]);

  const handleAdd = (data: Omit<PortfolioItem, "id">) => {
    const newItem: PortfolioItem = { id: Date.now().toString(), ...data };
    setItems((prev) => [...prev, newItem]);
    setModalOpen(false);
  };

  const handleEdit = (data: Omit<PortfolioItem, "id">) => {
    if (!editItem) return;
    setItems((prev) => prev.map((p) => (p.id === editItem.id ? { ...p, ...data } : p)));
    setEditItem(undefined);
  };

  const handleDelete = (id: string) => {
    if (confirmDeleteId === id) {
      setItems((prev) => prev.filter((p) => p.id !== id));
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId((cur) => (cur === id ? null : cur)), 2500);
    }
  };

  const openEdit = (item: PortfolioItem) => {
    setEditItem(item);
  };

  const isLoading = priceQueries.some((q) => q.isLoading);

  const fmtSummaryValue = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}억`;
    if (abs >= 1e4) return `${(v / 1e4).toFixed(1)}만`;
    return v.toLocaleString("ko-KR");
  };

  return (
    <div className="flex flex-col gap-4 fade-in pb-20">
      {/* ── Top Tab Bar ── */}
      <div className="flex border-b border-border bg-bg-card rounded-t-xl overflow-hidden">
        {[
          { id: "portfolio", label: "포트폴리오" },
          { id: "watchlist", label: "관심종목" },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => handleTabChange(id as "portfolio" | "watchlist")}
            className={`flex items-center gap-1.5 px-5 py-3 text-xs font-semibold transition-all border-b-2 -mb-px whitespace-nowrap flex-shrink-0 ${
              activeTab === id && id !== "watchlist"
                ? "border-accent-blue text-accent-blue bg-accent-blue/5"
                : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated"
            }`}
          >
            {id === "portfolio" ? <Wallet size={13} /> : <Star size={13} />}
            {label}
          </button>
        ))}
      </div>

      {/* ── Summary Cards ── */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="flex flex-col gap-1">
            <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide">총 평가금액</span>
            <span className="text-base font-mono font-bold text-text-primary">
              {fmtSummaryValue(summary.totalValue)}
            </span>
          </Card>
          <Card className="flex flex-col gap-1">
            <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide">총 매입금액</span>
            <span className="text-base font-mono font-bold text-text-primary">
              {fmtSummaryValue(summary.totalCost)}
            </span>
          </Card>
          <Card className="flex flex-col gap-1">
            <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide">평가손익</span>
            <span className={`text-base font-mono font-bold ${summary.totalPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
              {summary.totalPnl >= 0 ? "+" : ""}{fmtSummaryValue(summary.totalPnl)}
            </span>
          </Card>
          <Card className="flex flex-col gap-1">
            <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide">수익률</span>
            <span className={`text-base font-mono font-bold ${summary.totalRate >= 0 ? "text-accent-green" : "text-accent-red"}`}>
              {summary.totalRate >= 0 ? "+" : ""}{summary.totalRate.toFixed(2)}%
            </span>
          </Card>
        </div>
      )}

      {/* ── Pie Charts ── */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-primary">자산유형별 구성</span>
            {marketPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={marketPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    outerRadius={65}
                    innerRadius={30}
                  >
                    {marketPieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#141824", border: "1px solid #232840", borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any) => [fmtSummaryValue(Number(v)), ""]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-text-muted text-sm">데이터 없음</div>
            )}
          </Card>

          <Card className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-text-primary">종목별 구성</span>
            {stockPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={stockPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    outerRadius={65}
                    innerRadius={30}
                  >
                    {stockPieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#141824", border: "1px solid #232840", borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any) => [fmtSummaryValue(Number(v)), ""]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-text-muted text-sm">데이터 없음</div>
            )}
          </Card>
        </div>
      )}

      {/* ── Holdings Table ── */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">보유 종목</span>
            {items.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-bg-elevated text-text-muted font-semibold">
                {items.length}
              </span>
            )}
            {isLoading && (
              <div className="w-3.5 h-3.5 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
            )}
          </div>
          <button
            onClick={() => { setEditItem(undefined); setModalOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-blue-600 transition-colors"
          >
            <Plus size={13} /> 추가
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-14 h-14 rounded-2xl bg-bg-elevated border border-border flex items-center justify-center">
              <Wallet size={24} className="text-text-muted" />
            </div>
            <div className="text-center">
              <p className="text-text-primary font-semibold text-sm">보유 종목 없음</p>
              <p className="text-text-muted text-xs mt-1">+ 추가 버튼으로 종목을 등록하세요</p>
            </div>
            <button
              onClick={() => { setEditItem(undefined); setModalOpen(true); }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-semibold hover:bg-blue-600 transition-colors"
            >
              <Plus size={14} /> 첫 종목 추가
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-border bg-bg-primary/50">
                  {["종목명", "시장", "보유수량", "평단가", "현재가", "평가금액", "평가손익", "수익률", "액션"].map((h) => (
                    <th
                      key={h}
                      className={`px-3 py-2.5 font-semibold text-text-muted whitespace-nowrap ${
                        h === "액션" ? "text-right" : h === "종목명" ? "text-left" : "text-right"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enriched.map((item) => {
                  const isPos = item.pnl >= 0;
                  const pnlColor = isPos ? "text-accent-green" : "text-accent-red";
                  const isDeleting = confirmDeleteId === item.id;

                  return (
                    <tr
                      key={item.id}
                      className="border-b border-border/40 hover:bg-bg-hover transition-colors"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-text-primary">{item.name || item.symbol}</span>
                          <span className="text-text-dim font-mono">{item.symbol}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <MarketBadge market={item.market} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-text-primary">
                        {item.shares % 1 === 0
                          ? item.shares.toLocaleString()
                          : item.shares.toFixed(4)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-text-secondary">
                        {fmtPrice(item.market, item.avgPrice)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-text-primary">
                        {priceMap[item.id] != null ? (
                          fmtPrice(item.market, item.currentPrice)
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-text-primary">
                        {fmtValue(item.market, item.currentValue)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono font-semibold ${pnlColor}`}>
                        {fmtPnl(item.market, item.pnl)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono font-semibold ${pnlColor}`}>
                        {isPos ? "+" : ""}{item.pnlRate.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(item)}
                            className="p-1.5 rounded-lg text-text-muted hover:text-accent-blue hover:bg-accent-blue/10 transition-colors"
                            title="수정"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className={`p-1.5 rounded-lg transition-colors text-xs font-semibold ${
                              isDeleting
                                ? "bg-accent-red/20 text-accent-red border border-accent-red/40 px-2"
                                : "text-text-muted hover:text-accent-red hover:bg-accent-red/10"
                            }`}
                            title={isDeleting ? "한 번 더 클릭하면 삭제됩니다" : "삭제"}
                          >
                            {isDeleting ? "확인" : <Trash2 size={13} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-bg-primary/50">
                  <td className="px-3 py-2.5 font-semibold text-text-muted" colSpan={4}>합계</td>
                  <td />
                  <td className="px-3 py-2.5 text-right font-mono font-bold text-text-primary">
                    {fmtSummaryValue(summary.totalValue)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono font-bold ${summary.totalPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                    {summary.totalPnl >= 0 ? "+" : ""}{fmtSummaryValue(summary.totalPnl)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono font-bold ${summary.totalRate >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                    {summary.totalRate >= 0 ? "+" : ""}{summary.totalRate.toFixed(2)}%
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── FAB ── */}
      <button
        onClick={() => { setEditItem(undefined); setModalOpen(true); }}
        className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-accent-blue text-white shadow-lg shadow-accent-blue/30 hover:bg-blue-600 flex items-center justify-center transition-all hover:scale-105 active:scale-95"
        title="종목 추가"
      >
        <Plus size={20} />
      </button>

      {/* ── Modal ── */}
      {(modalOpen || editItem) && (
        <PortfolioModal
          item={editItem}
          onClose={() => { setModalOpen(false); setEditItem(undefined); }}
          onSave={editItem ? handleEdit : handleAdd}
        />
      )}
    </div>
  );
}
