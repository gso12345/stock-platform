import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { stocksApi, dashboardApi } from "@/api/stocks";
import api from "@/api/client";
import { Card } from "@/components/ui";
import { Plus, Pencil, Trash2, Star, Wallet, X, Search, ArrowLeft, Settings } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

/* ── Types ─────────────────────────────────────────────── */
type Market = "KR" | "US" | "ETF";
type Currency = "KRW" | "USD";
type ColorScheme = "green-red" | "red-blue";
type ChartMode = "stock" | "market";

interface PortfolioItem {
  id: string;
  symbol: string;
  market: Market;
  name: string;
  shares: number;
  avgPrice: number;
  currency: Currency;
  inputExchangeRate?: number;
  purchaseDate?: string;
  note?: string;
}

interface PortfolioSettings {
  colorScheme: ColorScheme;
}

interface EnrichedItem extends PortfolioItem {
  currentPriceNative: number;
  currentValueKRW: number;
  costKRW: number;
  pnlKRW: number;
  pnlRate: number;
  weight: number;
}

/* ── Constants ─────────────────────────────────────────── */
const STORAGE_KEY   = "portfolio_items";
const SETTINGS_KEY  = "portfolio_settings";
const PIE_COLORS    = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4","#f97316","#84cc16"];
const DEFAULT_FX    = 1350;

/* ── useLocalStorage ────────────────────────────────────── */
function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  return [state, setState];
}

/* ── Format utils ───────────────────────────────────────── */
function fmtKRW(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}₩${(abs / 1e12).toFixed(2)}조`;
  if (abs >= 1e8)  return `${sign}₩${(abs / 1e8).toFixed(2)}억`;
  if (abs >= 1e4)  return `${sign}₩${(abs / 1e4).toFixed(1)}만`;
  return `${sign}₩${Math.round(abs).toLocaleString("ko-KR")}`;
}
function fmtKRWSign(v: number): string {
  return `${v >= 0 ? "+" : ""}${fmtKRW(v)}`;
}
function fmtUSD(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtNative(market: Market, currency: Currency, price: number): string {
  if (market === "KR" || currency === "KRW") return fmtKRW(price);
  return fmtUSD(price);
}

/* ── Market badge ───────────────────────────────────────── */
function MarketBadge({ market }: { market: Market }) {
  const cls =
    market === "KR"  ? "border-blue-700/50 text-blue-400 bg-blue-900/20" :
    market === "ETF" ? "border-yellow-700/50 text-yellow-400 bg-yellow-900/20" :
                       "border-green-700/50 text-green-400 bg-green-900/20";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${cls}`}>{market}</span>;
}

/* ── Color scheme helper ────────────────────────────────── */
function usePnlColors(scheme: ColorScheme) {
  return {
    gain: scheme === "red-blue" ? "text-accent-red"  : "text-accent-green",
    loss: scheme === "red-blue" ? "text-accent-blue" : "text-accent-red",
    pnlColor: (v: number) => v >= 0
      ? (scheme === "red-blue" ? "text-accent-red"  : "text-accent-green")
      : (scheme === "red-blue" ? "text-accent-blue" : "text-accent-red"),
  };
}

/* ── Search types ───────────────────────────────────────── */
interface SearchResult {
  symbol: string; name: string; market: string; type: string; exchange: string;
}
const MKTCOLOR: Record<string, string> = {
  KR:  "border-blue-700/50 text-blue-400 bg-blue-900/20",
  US:  "border-green-700/50 text-green-400 bg-green-900/20",
  ETF: "border-purple-700/50 text-purple-400 bg-purple-900/20",
};

/* ── Settings Modal ─────────────────────────────────────── */
function SettingsModal({ settings, onClose, onChange }: {
  settings: PortfolioSettings;
  onClose: () => void;
  onChange: (s: PortfolioSettings) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary">포트폴리오 설정</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated">
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">등락 색상</p>
            <div className="flex gap-2">
              {([
                { value: "green-red", label: "초록 / 빨강", desc: "상승=초록, 하락=빨강 (글로벌 기준)" },
                { value: "red-blue",  label: "빨강 / 파랑",  desc: "상승=빨강, 하락=파랑 (한국 기준)" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onChange({ ...settings, colorScheme: opt.value })}
                  className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                    settings.colorScheme === opt.value
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                  }`}
                >
                  <div className="flex gap-1.5">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${opt.value === "green-red" ? "text-accent-green bg-accent-green/10" : "text-accent-red bg-accent-red/10"}`}>▲</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${opt.value === "green-red" ? "text-accent-red bg-accent-red/10" : "text-accent-blue bg-accent-blue/10"}`}>▼</span>
                  </div>
                  <span className="text-xs font-semibold text-text-primary">{opt.label}</span>
                  <span className="text-[10px] text-text-muted text-center leading-tight">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm font-semibold rounded-lg bg-accent-blue text-white hover:bg-blue-600 transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Add/Edit Modal (Step 1: 검색 → Step 2: 매수 정보) ─── */
function PortfolioModal({
  item,
  defaultFx,
  onClose,
  onSave,
}: {
  item?: PortfolioItem;
  defaultFx: number;
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

  const isForex = (m: Market) => m === "US" || m === "ETF";

  const [shares,       setShares]       = useState(item ? String(item.shares)   : "");
  const [avgPrice,     setAvgPrice]     = useState(item ? String(item.avgPrice) : "");
  const [currency,     setCurrency]     = useState<Currency>(item?.currency ?? "USD");
  const [inputFx,      setInputFx]      = useState(item?.inputExchangeRate ? String(item.inputExchangeRate) : "");
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
    const mkt = r.market as Market;
    setSelected({ symbol: r.symbol, market: mkt, name: r.name });
    setCurrency(mkt === "KR" ? "KRW" : "USD");
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
      currency,
      inputExchangeRate: currency === "USD" && inputFx ? Number(inputFx) : undefined,
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
            {/* 선택된 종목 */}
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
              {/* 해외 종목: 통화 선택 */}
              {isForex(selected.market) && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-2xs font-semibold text-text-muted">입력 통화 *</label>
                  <div className="flex gap-2">
                    {(["USD", "KRW"] as Currency[]).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCurrency(c)}
                        className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${
                          currency === c
                            ? c === "USD"
                              ? "bg-green-900/40 border-green-700/60 text-green-400"
                              : "bg-blue-900/40 border-blue-700/60 text-blue-400"
                            : "border-border text-text-muted hover:text-text-primary"
                        }`}
                      >
                        {c === "USD" ? "달러 ($)" : "원화 (₩)"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
                  <label className="text-2xs font-semibold text-text-muted">
                    평균매수가 * {isForex(selected.market) ? (currency === "USD" ? "($)" : "(₩)") : "(₩)"}
                  </label>
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

              {/* 달러 입력 시 환율 입력 (선택) */}
              {isForex(selected.market) && currency === "USD" && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-2xs font-semibold text-text-muted">
                    매수 당시 환율 (₩/$ · 선택)
                    <span className="ml-1 text-text-dim font-normal">공란 시 현재 환율 사용</span>
                  </label>
                  <input
                    className={inp}
                    type="number"
                    min="0"
                    step="1"
                    placeholder={`예: ${Math.round(defaultFx)}`}
                    value={inputFx}
                    onChange={(e) => setInputFx(e.target.value)}
                  />
                </div>
              )}

              <div className="flex gap-3">
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-2xs font-semibold text-text-muted">매수일</label>
                  <input className={inp} type="date" value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)} />
                </div>
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
              <button onClick={onClose}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40 transition-colors">
                취소
              </button>
              <button onClick={handleSave} disabled={!canSave}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg bg-accent-blue text-white hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
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
  const [activeTab,       setActiveTab]       = useState<"portfolio" | "watchlist">("portfolio");
  const [items,           setItems]           = useLocalStorage<PortfolioItem[]>(STORAGE_KEY, []);
  const [settings,        setSettings]        = useLocalStorage<PortfolioSettings>(SETTINGS_KEY, { colorScheme: "green-red" });
  const [modalOpen,       setModalOpen]       = useState(false);
  const [settingsOpen,    setSettingsOpen]    = useState(false);
  const [editItem,        setEditItem]        = useState<PortfolioItem | undefined>(undefined);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [chartMode,       setChartMode]       = useState<ChartMode>("stock");

  const { pnlColor } = usePnlColors(settings.colorScheme);

  /* ── 환율 조회 ── */
  const { data: krData } = useQuery({
    queryKey: ["dashboard-kr", "시가총액"],
    queryFn:  () => dashboardApi.getKR("시가총액"),
    staleTime: 300_000,
  });
  const exchangeRate: number = useMemo(() => {
    const raw = (krData as any)?.exchange;
    return raw?.value ?? raw?.usdkrw ?? DEFAULT_FX;
  }, [krData]);

  const handleTabChange = (tab: "portfolio" | "watchlist") => {
    if (tab === "watchlist") { navigate("/watchlist"); return; }
    setActiveTab(tab);
  };

  /* ── 현재가 조회 ── */
  const priceQueries = useQueries({
    queries: items.map((item) => ({
      queryKey:       ["price", item.market, item.symbol],
      queryFn:        () => stocksApi.getPrice(item.market, item.symbol),
      staleTime:      60_000,
      refetchInterval:60_000,
    })),
  });

  const priceMap = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((item, i) => {
      const d = priceQueries[i]?.data as any;
      if (d?.price != null) map[item.id] = d.price;
    });
    return map;
  }, [items, priceQueries]);

  /* ── KRW 환산 enriched items ── */
  const enriched = useMemo<EnrichedItem[]>(() => {
    const list = items.map((raw) => {
      const item: PortfolioItem = {
        ...raw,
        currency: raw.currency ?? (raw.market === "KR" ? "KRW" : "USD"),
      };
      const isForex = item.market === "US" || item.market === "ETF";
      const currentPriceNative = priceMap[item.id] ?? item.avgPrice;

      // current value in KRW
      const currentValueKRW = isForex && item.currency === "USD"
        ? currentPriceNative * exchangeRate * item.shares
        : currentPriceNative * item.shares;

      // cost in KRW
      const fxForCost = item.currency === "USD"
        ? (item.inputExchangeRate ?? exchangeRate)
        : 1;
      const costKRW = item.avgPrice * fxForCost * item.shares;

      const pnlKRW = currentValueKRW - costKRW;
      const pnlRate = costKRW !== 0 ? (pnlKRW / costKRW) * 100 : 0;

      return { ...item, currentPriceNative, currentValueKRW, costKRW, pnlKRW, pnlRate, weight: 0 };
    });

    const totalKRW = list.reduce((s, e) => s + e.currentValueKRW, 0);
    return list.map((e) => ({
      ...e,
      weight: totalKRW > 0 ? (e.currentValueKRW / totalKRW) * 100 : 0,
    }));
  }, [items, priceMap, exchangeRate]);

  /* ── 요약 ── */
  const summary = useMemo(() => {
    const totalValue = enriched.reduce((s, e) => s + e.currentValueKRW, 0);
    const totalCost  = enriched.reduce((s, e) => s + e.costKRW, 0);
    const totalPnl   = totalValue - totalCost;
    const totalRate  = totalCost !== 0 ? (totalPnl / totalCost) * 100 : 0;
    return { totalValue, totalCost, totalPnl, totalRate };
  }, [enriched]);

  /* ── 차트 데이터 ── */
  const stockPieData = useMemo(() => {
    const sorted = [...enriched].sort((a, b) => b.currentValueKRW - a.currentValueKRW);
    const top  = sorted.slice(0, 8);
    const rest = sorted.slice(8);
    const data = top.map((e) => ({ name: e.name || e.symbol, value: Math.round(e.currentValueKRW) }));
    if (rest.length > 0) {
      data.push({ name: "기타", value: Math.round(rest.reduce((s, e) => s + e.currentValueKRW, 0)) });
    }
    return data;
  }, [enriched]);

  const marketPieData = useMemo(() => {
    const map: Record<string, number> = {};
    enriched.forEach((e) => { map[e.market] = (map[e.market] ?? 0) + e.currentValueKRW; });
    return Object.entries(map).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [enriched]);

  const activePieData = chartMode === "stock" ? stockPieData : marketPieData;

  /* ── CRUD ── */
  const handleAdd = (data: Omit<PortfolioItem, "id">) => {
    setItems((prev) => [...prev, { id: Date.now().toString(), ...data }]);
    setModalOpen(false);
  };
  const handleEdit = (data: Omit<PortfolioItem, "id">) => {
    if (!editItem) return;
    setItems((prev) => prev.map((p) => p.id === editItem.id ? { ...p, ...data } : p));
    setEditItem(undefined);
  };
  const handleDelete = (id: string) => {
    if (confirmDeleteId === id) {
      setItems((prev) => prev.filter((p) => p.id !== id));
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId((c) => c === id ? null : c), 2500);
    }
  };

  const isLoading = priceQueries.some((q) => q.isLoading);

  return (
    <div className="flex flex-col gap-4 fade-in pb-20">

      {/* ── 상단 탭 ── */}
      <div className="flex border-b border-border bg-bg-card rounded-t-xl overflow-hidden">
        {[
          { id: "portfolio", label: "포트폴리오" },
          { id: "watchlist", label: "관심종목" },
        ].map(({ id, label }) => (
          <button key={id}
            onClick={() => handleTabChange(id as any)}
            className={`flex items-center gap-1.5 px-5 py-3 text-xs font-semibold transition-all border-b-2 -mb-px whitespace-nowrap ${
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

      {/* ── 요약 카드 ── */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "총 평가금액", value: fmtKRW(summary.totalValue),    color: "text-text-primary" },
            { label: "총 매입금액", value: fmtKRW(summary.totalCost),     color: "text-text-primary" },
            { label: "평가손익",   value: fmtKRWSign(summary.totalPnl),  color: pnlColor(summary.totalPnl) },
            { label: "수익률",     value: `${summary.totalRate >= 0 ? "+" : ""}${summary.totalRate.toFixed(2)}%`, color: pnlColor(summary.totalRate) },
          ].map((c) => (
            <Card key={c.label} className="flex flex-col gap-1">
              <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide">{c.label}</span>
              <span className={`text-base font-mono font-bold ${c.color}`}>{c.value}</span>
              {c.label === "총 평가금액" && (
                <span className="text-[10px] text-text-dim">환율 {Math.round(exchangeRate).toLocaleString("ko-KR")}원</span>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ── 구성 차트 ── */}
      {items.length > 0 && (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-1 p-0.5 rounded-lg border border-border bg-bg-primary">
              {([
                { id: "stock",  label: "종목별 구성" },
                { id: "market", label: "자산유형별 구성" },
              ] as const).map(({ id, label }) => (
                <button key={id} onClick={() => setChartMode(id)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    chartMode === id ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
                  }`}
                >{label}</button>
              ))}
            </div>
          </div>
          {activePieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={activePieData} dataKey="value" nameKey="name"
                  cx="50%" cy="46%" outerRadius={75} innerRadius={35}>
                  {activePieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#141824", border: "1px solid #232840", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any) => [fmtKRW(Number(v)), ""]}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-text-muted text-sm">데이터 없음</div>
          )}
        </Card>
      )}

      {/* ── 보유 종목 테이블 ── */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">보유 종목</span>
            {items.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-bg-elevated text-text-muted font-semibold">{items.length}</span>
            )}
            {isLoading && <div className="w-3.5 h-3.5 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
              title="설정"
            >
              <Settings size={14} />
            </button>
            <button
              onClick={() => { setEditItem(undefined); setModalOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-blue-600 transition-colors"
            >
              <Plus size={13} /> 추가
            </button>
          </div>
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
            <table className="w-full text-xs min-w-[820px]">
              <thead>
                <tr className="border-b border-border bg-bg-primary/50">
                  {["종목명","시장","보유수량","평단가","현재가","평가금액(₩)","평가손익(₩)","수익률","비중","액션"].map((h) => (
                    <th key={h} className={`px-3 py-2.5 font-semibold text-text-muted whitespace-nowrap ${
                      h === "액션" || h === "비중" ? "text-right" : h === "종목명" ? "text-left" : "text-right"
                    }`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enriched.map((item) => {
                  const pc    = pnlColor(item.pnlKRW);
                  const isDel = confirmDeleteId === item.id;
                  const hasPrice = priceMap[item.id] != null;
                  return (
                    <tr key={item.id} className="border-b border-border/40 hover:bg-bg-hover transition-colors">
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-text-primary">{item.name || item.symbol}</span>
                          <span className="text-text-dim font-mono">{item.symbol}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right"><MarketBadge market={item.market} /></td>
                      <td className="px-3 py-2.5 text-right font-mono text-text-primary">
                        {item.shares % 1 === 0 ? item.shares.toLocaleString() : item.shares.toFixed(4)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-text-secondary">
                        <div>{fmtNative(item.market, item.currency, item.avgPrice)}</div>
                        {item.currency === "USD" && item.inputExchangeRate && (
                          <div className="text-[10px] text-text-dim">@{Math.round(item.inputExchangeRate).toLocaleString()}원</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-text-primary">
                        {hasPrice
                          ? fmtNative(item.market, item.currency, item.currentPriceNative)
                          : <span className="text-text-muted">—</span>
                        }
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-text-primary">
                        {fmtKRW(item.currentValueKRW)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono font-semibold ${pc}`}>
                        {fmtKRWSign(item.pnlKRW)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono font-semibold ${pc}`}>
                        {item.pnlRate >= 0 ? "+" : ""}{item.pnlRate.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-text-muted">
                        <div>{item.weight.toFixed(1)}%</div>
                        <div className="w-12 h-1 bg-bg-elevated rounded-full overflow-hidden ml-auto mt-0.5">
                          <div className="h-full bg-accent-blue/60 rounded-full" style={{ width: `${Math.min(100, item.weight)}%` }} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setEditItem(item)}
                            className="p-1.5 rounded-lg text-text-muted hover:text-accent-blue hover:bg-accent-blue/10 transition-colors" title="수정">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => handleDelete(item.id)}
                            className={`p-1.5 rounded-lg transition-colors text-xs font-semibold ${
                              isDel
                                ? "bg-accent-red/20 text-accent-red border border-accent-red/40 px-2"
                                : "text-text-muted hover:text-accent-red hover:bg-accent-red/10"
                            }`}
                            title={isDel ? "한 번 더 클릭하면 삭제됩니다" : "삭제"}>
                            {isDel ? "확인" : <Trash2 size={13} />}
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
                  <td className="px-3 py-2.5 text-right font-mono font-bold text-text-primary">{fmtKRW(summary.totalValue)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono font-bold ${pnlColor(summary.totalPnl)}`}>{fmtKRWSign(summary.totalPnl)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono font-bold ${pnlColor(summary.totalRate)}`}>
                    {summary.totalRate >= 0 ? "+" : ""}{summary.totalRate.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-text-muted">100%</td>
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

      {/* ── 종목 추가/수정 모달 ── */}
      {(modalOpen || editItem) && (
        <PortfolioModal
          item={editItem}
          defaultFx={exchangeRate}
          onClose={() => { setModalOpen(false); setEditItem(undefined); }}
          onSave={editItem ? handleEdit : handleAdd}
        />
      )}

      {/* ── 설정 모달 ── */}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onChange={setSettings}
        />
      )}
    </div>
  );
}
