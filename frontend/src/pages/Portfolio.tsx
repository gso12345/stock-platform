import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { stocksApi, dashboardApi, portfolioApi, watchlistApi } from "@/api/stocks";
import { usePricesStream } from "@/hooks/useWebSocket";
import api from "@/api/client";
import { Card, RowSkeleton, Modal } from "@/components/ui";
import { Plus, Pencil, Trash2, Star, Wallet, X, Search, ArrowLeft, ChevronUp, ChevronDown, ChevronsUpDown, LogIn, Check, AlertTriangle, LayoutGrid, Table2, DollarSign, Landmark, Receipt, TrendingUp, TrendingDown, Percent, Settings2, RefreshCw } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useSettingsStore } from "@/store/settingsStore";
import type { ColorScheme } from "@/store/settingsStore";
import { fmtKRWCompact, fmtKRWFull, fmtKRWFullSign, fmtUSDFull, fmtNative } from "@/utils/formatters";

/* ── Types ─────────────────────────────────────────────── */
type Market = "KR" | "US" | "ETF";
type Currency = "KRW" | "USD";
type ChartMode = "stock" | "market" | "portfolio";

interface PortfolioItem {
  id: number;
  portfolioId?: number;
  portfolioName?: string;
  symbol: string;
  market: Market;
  name: string;
  shares: number;
  avgPrice: number;
  currency: Currency;
  inputExchangeRate?: number;
  purchaseDate?: string;
  note?: string;
  assetClass?: AssetClass | null;
}

type SelectedPortfolio = number | "all";

interface PortfolioMeta {
  id: number;
  name: string;
  position: number;
  count: number;
}

interface EnrichedItem extends PortfolioItem {
  currentPriceNative: number;
  currentValueKRW: number;
  costKRW: number;
  pnlKRW: number;
  pnlRate: number;
  weight: number;
  dailyChangeKRW?: number;
}

/* ── Constants ─────────────────────────────────────────── */
const PIE_COLORS  = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4","#f97316","#84cc16","#ec4899","#14b8a6","#6366f1"];
const DEFAULT_FX  = 1350;

/* ── 미리보기 예시 데이터 (비로그인 시 표시) ────────────────── */
const PREVIEW_ENRICHED: EnrichedItem[] = [
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
/* ── 자산유형 분류 (국내주식/해외주식/채권/금/현금/커버드콜) ──────────────────── */
type AssetClass = "국내주식" | "해외주식" | "채권" | "금" | "현금" | "커버드콜";

const BOND_KEYWORDS = [
  "채권", "국고채", "회사채", "단기채", "장기채", "본드",
  "TLT", "BND", "AGG", "SHY", "IEF", "TIP", "LQD", "HYG", "BNDX", "TIGER 미국채", "KODEX 국고채",
];
const GOLD_KEYWORDS = ["금현물", "골드", "GLD", "IAU", "GLDM", "SGOL", "KRX금"];
const COVERED_CALL_KEYWORDS = ["커버드콜", "COVERED CALL", "COVEREDCALL", "BUYWRITE", "BUY WRITE", "JEPI", "JEPQ", "QYLD", "XYLD", "RYLD", "DIVO"];
const OVERSEAS_KEYWORDS = [
  "미국", "나스닥", "S&P", "SP500", "차이나", "중국", "일본", "글로벌", "선진국",
  "유로", "베트남", "인도", "신흥국", "해외",
];

function classifyAsset(item: { market: Market; name?: string; symbol: string }): AssetClass {
  const haystack = `${item.name ?? ""} ${item.symbol}`.toUpperCase();
  if (COVERED_CALL_KEYWORDS.some((k) => haystack.includes(k.toUpperCase()))) return "커버드콜";
  if (BOND_KEYWORDS.some((k) => haystack.includes(k.toUpperCase()))) return "채권";
  if (GOLD_KEYWORDS.some((k) => haystack.includes(k.toUpperCase()))) return "금";

  if (item.market === "KR") return "국내주식";
  if (item.market === "US") return "해외주식";

  // ETF: 종목코드가 6자리 숫자면 국내 상장 ETF, 그 외엔 해외 상장 ETF
  const isKRListed = /^\d{6}/.test(item.symbol);
  if (!isKRListed) return "해외주식";
  if (OVERSEAS_KEYWORDS.some((k) => (item.name ?? "").includes(k))) return "해외주식";
  return "국내주식";
}

const ASSET_CLASS_OPTIONS: AssetClass[] = ["국내주식", "해외주식", "채권", "금", "커버드콜"];
const ASSET_FILTER_TABS: { id: AssetClass | "전체"; label: string }[] = [
  { id: "전체",     label: "전체" },
  { id: "국내주식", label: "국내주식" },
  { id: "해외주식", label: "해외주식" },
  { id: "채권",     label: "채권" },
  { id: "금",       label: "금" },
  { id: "커버드콜", label: "커버드콜" },
  { id: "현금",     label: "현금" },
];

// 사용자가 직접 지정한 자산유형이 있으면 그걸 쓰고, 없으면 자동 분류
function resolveAssetClass(item: { market: Market; name?: string; symbol: string; assetClass?: AssetClass | null }): AssetClass {
  return item.assetClass ?? classifyAsset(item);
}

/* ── Market badge ───────────────────────────────────────── */
function MarketBadge({ market }: { market: Market }) {
  const cls =
    market === "KR"  ? "border-blue-700/50 text-blue-400 bg-blue-900/20" :
    market === "ETF" ? "border-purple-700/50 text-purple-400 bg-purple-900/20" :
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

/* ── Sort ──────────────────────────────────────────────── */
type SortField = "name" | "shares" | "value" | "pnl" | "pnlRate" | "weight";

function SortHead({ field, label, sortField, sortDir, onClick, align = "right" }: {
  field: SortField; label: string; sortField: SortField | null; sortDir: "asc" | "desc";
  onClick: (f: SortField) => void; align?: "left" | "right";
}) {
  const active = sortField === field;
  return (
    <th
      onClick={() => onClick(field)}
      className={`px-3 py-2.5 font-semibold text-text-muted whitespace-nowrap cursor-pointer select-none hover:text-text-primary transition-colors ${
        align === "left" ? "text-left" : "text-right"
      }`}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {label}
        {active
          ? sortDir === "desc"
            ? <ChevronDown size={10} className="text-accent-blue" />
            : <ChevronUp size={10} className="text-accent-blue" />
          : <ChevronsUpDown size={10} className="opacity-25" />
        }
      </span>
    </th>
  );
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

/* ── Add/Edit Modal (Step 1: 검색 → Step 2: 매수 정보) ─── */
function PortfolioModal({
  item,
  defaultFx,
  onClose,
  onSave,
  isSaving,
  saveError,
}: {
  item?: PortfolioItem;
  defaultFx: number;
  onClose: () => void;
  onSave: (data: Omit<PortfolioItem, "id">) => void;
  isSaving?: boolean;
  saveError?: string | null;
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
  const [assetClass,   setAssetClass]   = useState<AssetClass | "">(item?.assetClass ?? "");
  const [priceLoading, setPriceLoading] = useState(false);

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

  // 현재가 자동 입력: 신규 추가 시에만 (수정 모드 아님) 현재가 조회하여 평균매수가 초기값 설정
  useEffect(() => {
    if (!selected || item) return;
    setPriceLoading(true);
    stocksApi.getPrice(selected.market as Market, selected.symbol)
      .then((data) => {
        if (data?.price != null) {
          setAvgPrice((prev) => (prev === "" ? String(data.price) : prev));
        }
      })
      .catch(() => { /* 조회 실패 시 빈칸 유지 */ })
      .finally(() => setPriceLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.symbol, selected?.market]);

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
      assetClass: assetClass || null,
    });
  };

  const inp = "w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors";

  return (
    <Modal align="start" padTop="pt-16" backdropOpacity={70} maxWidth="max-w-md" onClose={onClose}>

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
                    placeholder={priceLoading ? "로딩 중..." : "0"}
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
                  <label className="text-2xs font-semibold text-text-muted">매수일 (선택)</label>
                  <input className={inp} type="date" value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)} />
                </div>
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-2xs font-semibold text-text-muted">자산유형</label>
                  <select className={inp} value={assetClass}
                    onChange={(e) => setAssetClass(e.target.value as AssetClass | "")}>
                    <option value="">자동 분류</option>
                    {ASSET_CLASS_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
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

            {saveError && (
              <p className="mx-5 mb-2 text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">
                오류: {saveError}
              </p>
            )}
            <div className="flex gap-2 px-5 py-4 border-t border-border">
              <button onClick={onClose} disabled={isSaving}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                취소
              </button>
              <button onClick={handleSave} disabled={!canSave || isSaving}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg bg-accent-blue text-white hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {isSaving ? "저장 중..." : "저장"}
              </button>
            </div>
          </>
        )}
    </Modal>
  );
}

/* ── 현금 추가/수정 모달 ──────────────────────────────────── */
function CashModal({
  item,
  onClose,
  onSave,
  isSaving,
  saveError,
}: {
  item?: PortfolioItem;
  onClose: () => void;
  onSave: (data: Omit<PortfolioItem, "id">) => void;
  isSaving?: boolean;
  saveError?: string | null;
}) {
  const [currency, setCurrency] = useState<Currency>(item?.currency ?? "KRW");
  const [amount,   setAmount]   = useState(item ? String(item.avgPrice) : "");
  const [note,     setNote]     = useState(item?.note ?? "");
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => amountRef.current?.focus(), 50); }, []);

  const canSave = Number(amount) > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      symbol: "현금",
      market: currency === "USD" ? "US" : "KR",
      name: currency === "USD" ? "달러 현금" : "원화 현금",
      shares: 1,
      avgPrice: Number(amount),
      currency,
      note: note || undefined,
      assetClass: "현금",
    });
  };

  const inp = "w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors";

  return (
    <Modal align="start" padTop="pt-16" backdropOpacity={70} maxWidth="max-w-md" onClose={onClose}>
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-border">
          <h3 className="flex-1 text-sm font-bold text-text-primary">{item ? "현금 수정" : "현금 추가"}</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <label className="text-2xs font-semibold text-text-muted">통화 *</label>
            <div className="flex gap-2">
              {(["KRW", "USD"] as Currency[]).map((c) => (
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

          <div className="flex flex-col gap-1.5">
            <label className="text-2xs font-semibold text-text-muted">금액 * {currency === "USD" ? "($)" : "(₩)"}</label>
            <input
              ref={amountRef}
              className={inp}
              type="number"
              min="0"
              step="any"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
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

        {saveError && (
          <p className="mx-5 mb-2 text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">
            오류: {saveError}
          </p>
        )}
        <div className="flex gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} disabled={isSaving}
            className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            취소
          </button>
          <button onClick={handleSave} disabled={!canSave || isSaving}
            className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg bg-accent-blue text-white hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {isSaving ? "저장 중..." : "저장"}
          </button>
        </div>
    </Modal>
  );
}

/* ── 삭제 확인 모달 (종목/포트폴리오 공용 — 디자인 통일) ──────────── */
function ConfirmDeleteModal({
  title, description, onClose, onConfirm, isDeleting,
}: {
  title: string; description: React.ReactNode; onClose: () => void; onConfirm: () => void; isDeleting?: boolean;
}) {
  return (
    <Modal maxWidth="max-w-sm">
      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-accent-red/10 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-accent-red" />
          </div>
          <h3 className="text-sm font-bold text-text-primary">{title}</h3>
        </div>
        <p className="text-xs text-text-muted leading-relaxed">{description}</p>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1 py-2 rounded-xl border border-border text-text-muted text-sm hover:border-accent-blue hover:text-text-primary transition-all disabled:opacity-40"
          >취소</button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 py-2 rounded-xl bg-accent-red text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-40"
          >{isDeleting ? "삭제 중..." : "삭제"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ── 포트폴리오 선택 탭 ──────────────────────────────────── */
function PortfolioPill({
  portfolio, active, onSelect,
  draggable, isDragging, isDropTarget,
  onDragStart, onDragOver, onDrop, onTouchStart, onTouchMove, onTouchEnd,
}: {
  portfolio: PortfolioMeta; active: boolean;
  onSelect: () => void;
  draggable?: boolean; isDragging?: boolean; isDropTarget?: boolean;
  onDragStart?: () => void; onDragOver?: (e: React.DragEvent) => void; onDrop?: () => void;
  onTouchStart?: (e: React.TouchEvent) => void; onTouchMove?: (e: React.TouchEvent) => void; onTouchEnd?: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      data-portfolio-id={portfolio.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      title={draggable ? "길게 눌러서 드래그하면 포트폴리오 순서를 바꿀 수 있어요" : undefined}
      style={{ touchAction: isDragging ? "none" : "auto" }}
      className={`group flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 -mb-px cursor-pointer transition-all flex-shrink-0 whitespace-nowrap ${
        active
          ? "border-accent-blue text-accent-blue bg-accent-blue/5"
          : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated"
      } ${isDragging ? "opacity-40" : ""} ${isDropTarget ? "ring-1 ring-accent-blue ring-inset" : ""}`}
    >
      <span>{portfolio.name}</span>
      <span className="text-xs opacity-60">({portfolio.count})</span>
    </div>
  );
}

/* ── 전체 보기에서 포함/제외할 포트폴리오 선택 (포트폴리오 모아보기) ── */
function PortfolioFilterDropdown({ portfolios, excludedIds, onToggle }: {
  portfolios: PortfolioMeta[]; excludedIds: Set<number>; onToggle: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const includedCount = portfolios.length - excludedIds.size;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-text-muted hover:text-accent-blue hover:border-accent-blue/40 text-xs font-semibold transition-colors whitespace-nowrap"
        title="전체 보기에 포함할 포트폴리오 선택"
      >
        <Check size={12} /> 포트폴리오 선택 ({includedCount}/{portfolios.length})
      </button>
      {open && (
        <div className="absolute z-30 top-full mt-1 left-0 w-56 max-h-64 overflow-y-auto bg-bg-card border border-border rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5">
          {portfolios.map((pf) => {
            const checked = !excludedIds.has(pf.id);
            return (
              <label key={pf.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-elevated cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(pf.id)}
                  className="accent-accent-blue"
                />
                <span className="flex-1 truncate text-text-primary">{pf.name}</span>
                <span className="text-text-dim">({pf.count})</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddPortfolioButton({ onAdd }: { onAdd: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (adding) setTimeout(() => inputRef.current?.focus(), 30); }, [adding]);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed) onAdd(trimmed);
    setName("");
    setAdding(false);
  };

  if (adding) {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-accent-blue bg-bg-elevated flex-shrink-0">
        <input
          ref={inputRef}
          className="bg-transparent text-xs font-semibold text-text-primary focus:outline-none w-28"
          placeholder="포트폴리오 이름"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setName(""); setAdding(false); }
          }}
        />
        <button onClick={commit} className="p-0.5 text-accent-blue hover:text-blue-400"><Check size={12} /></button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setAdding(true)}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-border text-text-muted hover:text-accent-blue hover:border-accent-blue/40 text-xs font-semibold transition-colors flex-shrink-0"
    >
      <Plus size={12} /> 포트폴리오
    </button>
  );
}

/* ── 포트폴리오 관리 팝업 ── */
function PortfolioManagerModal({
  portfolios, onClose, onRename, onDelete, onReorder, onAdd,
}: {
  portfolios: PortfolioMeta[];
  onClose: () => void;
  onRename: (id: number, name: string) => void;
  onDelete: (pf: PortfolioMeta) => void;
  onReorder: (order: number[]) => void;
  onAdd: (name: string) => void;
}) {
  const [local, setLocal] = useState(portfolios);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragIdx = useRef(-1);

  // 터치 드래그 상태
  const touchDragIdxRef = useRef(-1);
  const touchOverIdxRef = useRef(-1);
  const [touchOver, setTouchOver] = useState<number | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLPTimer = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; } };

  const handleRowTouchStart = (i: number, e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartPos.current = { x: t.clientX, y: t.clientY };
    clearLPTimer();
    lpTimer.current = setTimeout(() => { touchDragIdxRef.current = i; }, 350);
  };

  const handleRowTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (touchDragIdxRef.current < 0) {
      const s = touchStartPos.current;
      if (s && (Math.abs(t.clientX - s.x) > 8 || Math.abs(t.clientY - s.y) > 8)) clearLPTimer();
      return;
    }
    const el = (document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null)?.closest('[data-drag-idx]') as HTMLElement | null;
    if (el) {
      const toIdx = parseInt(el.dataset.dragIdx ?? '-1', 10);
      if (toIdx >= 0) { touchOverIdxRef.current = toIdx; setTouchOver(toIdx); }
    }
  };

  const handleRowTouchEnd = () => {
    clearLPTimer();
    if (touchDragIdxRef.current >= 0 && touchOverIdxRef.current >= 0 && touchOverIdxRef.current !== touchDragIdxRef.current) {
      handleDrop(touchOverIdxRef.current);
    }
    touchDragIdxRef.current = -1;
    touchOverIdxRef.current = -1;
    setTouchOver(null);
  };

  useEffect(() => { setLocal(portfolios); }, [portfolios]);

  const commitRename = (id: number) => {
    const trimmed = editName.trim();
    if (trimmed) onRename(id, trimmed);
    setEditingId(null);
  };

  const commitAdd = () => {
    const trimmed = newName.trim();
    if (trimmed) { onAdd(trimmed); setNewName(""); setAddingNew(false); }
  };

  const handleDrop = (toIdx: number) => {
    const from = dragIdx.current >= 0 ? dragIdx.current : touchDragIdxRef.current;
    if (from < 0 || from === toIdx) return;
    const next = [...local];
    const [moved] = next.splice(from, 1);
    next.splice(toIdx, 0, moved);
    setLocal(next);
    onReorder(next.map((p) => p.id));
  };

  return (
    <Modal maxWidth="max-w-sm" onClose={onClose}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
        <h3 className="text-sm font-bold text-text-primary">포트폴리오 관리</h3>
        <button onClick={onClose}><X size={15} className="text-text-muted hover:text-text-primary" /></button>
      </div>
      <div className="flex flex-col max-h-96 overflow-y-auto">
        {local.map((pf, i) => (
          <div
            key={pf.id}
            data-drag-idx={i}
            draggable
            onDragStart={() => { dragIdx.current = i; }}
            onDragEnd={() => { dragIdx.current = -1; setDragOver(null); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
            onDrop={() => { handleDrop(i); setDragOver(null); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
            onTouchStart={(e) => handleRowTouchStart(i, e)}
            onTouchMove={handleRowTouchMove}
            onTouchEnd={handleRowTouchEnd}
            className={`flex items-center gap-3 px-4 py-4 border-b border-border/40 transition-colors cursor-grab active:cursor-grabbing select-none ${dragOver === i || touchOver === i ? "bg-accent-blue/10 ring-2 ring-accent-blue/30 ring-inset" : ""}`}
          >
            {/* 드래그 핸들 */}
            <div className="text-text-muted flex-shrink-0 px-2 pointer-events-none">
              <svg width="18" height="28" viewBox="0 0 10 16" fill="currentColor">
                <circle cx="3" cy="2" r="1.8"/><circle cx="7" cy="2" r="1.8"/>
                <circle cx="3" cy="8" r="1.8"/><circle cx="7" cy="8" r="1.8"/>
                <circle cx="3" cy="14" r="1.8"/><circle cx="7" cy="14" r="1.8"/>
              </svg>
            </div>
            {editingId === pf.id ? (
              <input
                draggable={false}
                className="flex-1 bg-bg-primary border border-accent-blue rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none cursor-text select-text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(pf.id); if (e.key === "Escape") setEditingId(null); }}
                autoFocus
              />
            ) : (
              <span className="flex-1 text-sm font-medium text-text-primary truncate">{pf.name}</span>
            )}
            <span className="text-xs text-text-muted flex-shrink-0">{pf.count}개</span>
            {editingId === pf.id ? (
              <button draggable={false} onClick={(e) => { e.stopPropagation(); commitRename(pf.id); }} className="p-2 text-accent-blue hover:bg-accent-blue/10 rounded-lg"><Check size={15} /></button>
            ) : (
              <button draggable={false} onClick={(e) => { e.stopPropagation(); setEditingId(pf.id); setEditName(pf.name); }}
                className="p-2 text-text-muted hover:text-accent-blue hover:bg-accent-blue/10 rounded-lg transition-colors"><Pencil size={15} /></button>
            )}
            <button draggable={false} onClick={(e) => { e.stopPropagation(); onDelete(pf); }}
              className="p-2 text-text-muted hover:text-accent-red hover:bg-accent-red/10 rounded-lg transition-colors"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      <div className="p-4 border-t border-border">
        {addingNew ? (
          <div className="flex items-center gap-2">
            <input
              className="flex-1 bg-bg-primary border border-accent-blue rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none"
              placeholder="포트폴리오 이름"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); if (e.key === "Escape") { setAddingNew(false); setNewName(""); } }}
              autoFocus
            />
            <button onClick={commitAdd} className="p-1.5 text-accent-blue hover:bg-accent-blue/10 rounded-lg"><Check size={14} /></button>
            <button onClick={() => { setAddingNew(false); setNewName(""); }} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg"><X size={14} /></button>
          </div>
        ) : (
          <button onClick={() => setAddingNew(true)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-border text-text-muted hover:text-accent-blue hover:border-accent-blue transition-colors text-sm">
            <Plus size={13} />새 포트폴리오 만들기
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ── Main Page ──────────────────────────────────────────── */
export default function Portfolio() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab,       setActiveTab]       = useState<"portfolio" | "watchlist">("portfolio");
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
  const prefetchStock = (item: any) => {
    const mkt = item.market as Market;
    const sym = item.symbol;
    if (queryClient.getQueryData(["stock-detail", mkt, sym])) return;
    queryClient.prefetchQuery({ queryKey: ["stock-detail", mkt, sym], queryFn: () => stocksApi.getDetail(mkt, sym), staleTime: 60_000 });
  };
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

  const _extractErrMsg = (err: unknown): string => {
    const e = err as any;
    if (e?.response?.data?.detail) {
      const d = e.response.data.detail;
      if (typeof d === "string") return d;
      if (Array.isArray(d)) return d.map((x: any) => x?.msg ?? JSON.stringify(x)).join(", ");
    }
    if (e?.message) return e.message;
    return "알 수 없는 오류가 발생했습니다";
  };

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
    onError: (err) => setModalError(_extractErrMsg(err)),
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
    onError: (err) => setModalError(_extractErrMsg(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => portfolioApi.deleteItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-items-all"] });
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      setDeleteTarget(null);
    },
  });

  /* ── 환율 조회 (해외 대시보드 기준 — yfinance USDKRW=X) ── */
  const { data: usRatesData } = useQuery({
    queryKey: ["dashboard-us-rates"],
    queryFn:  () => dashboardApi.getUSRates(),
    staleTime: 300_000,
  });
  const exchangeRate: number = useMemo(() => {
    if (Array.isArray(usRatesData)) {
      const row = (usRatesData as any[]).find((r: any) => r.name === "원/달러");
      if (row?.value) return row.value;
    }
    return DEFAULT_FX;
  }, [usRatesData]);

  const handleTabChange = (tab: "portfolio" | "watchlist") => {
    if (tab === "watchlist") { navigate("/watchlist"); return; }
    setActiveTab(tab);
  };

  /* ── 현재가 조회 (배치 1회 요청 — 종목별 개별 요청 대신, 전체 종목 기준으로
     한 번만 캐시해서 탭을 바꿔도 다시 불러오지 않도록 함) ──
     현금 항목은 시세가 없으므로 가격 조회 대상에서 제외 (인덱스 정합성 유지) ── */
  const priceableItems = useMemo(() => allItems.filter((i) => i.assetClass !== "현금"), [allItems]);

  /* ── 실시간 WebSocket 가격 (기존 120초 폴링 대체) ── */
  const [wsPrices, setWsPrices] = useState<any[] | null>(null);
  const priceSymbols = useMemo(() => priceableItems.map((i) => i.symbol), [priceableItems]);
  const priceMarkets = useMemo(() => priceableItems.map((i) => i.market), [priceableItems]);
  usePricesStream(priceSymbols, priceMarkets, useCallback((prices: any[]) => {
    setWsPrices(prices);
  }, []));

  const { data: batchPrices, isLoading: pricesLoading } = useQuery({
    queryKey:       ["portfolio-prices", priceableItems.map((i) => `${i.market}:${i.symbol}`).join(",")],
    queryFn:        () => watchlistApi.getPrices(priceableItems.map((i) => i.symbol), priceableItems.map((i) => i.market)),
    enabled:        priceableItems.length > 0,
    staleTime:      120_000,
    refetchInterval: false,
  });

  /* WebSocket 우선, 없으면 HTTP 조회값 사용 */
  const effectivePrices = wsPrices ?? batchPrices;

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
      return { ...base, currentPriceNative, currentValueKRW, costKRW, pnlKRW, pnlRate, weight: 0 };
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

  const priceMap = useMemo(() => {
    const map: Record<number, number> = {};
    priceableItems.forEach((item, i) => {
      const d = effectivePrices?.[i] as any;
      if (d?.price != null && d.price > 0) map[item.id] = d.price;
    });
    return map;
  }, [priceableItems, effectivePrices]);

  /* ── 일일 등락률 맵 (현재가 조회 결과의 change_rate, % 단위) ── */
  const changeRateMap = useMemo(() => {
    const map: Record<number, number> = {};
    priceableItems.forEach((item, i) => {
      const d = effectivePrices?.[i] as any;
      if (d?.change_rate != null) map[item.id] = d.change_rate;
    });
    return map;
  }, [priceableItems, effectivePrices]);

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

      return { ...item, currentPriceNative, currentValueKRW, costKRW, pnlKRW, pnlRate, weight: 0, dailyChangeKRW };
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

  /* ── 요약 ── */
  const summary = useMemo(() => {
    const totalValue = enriched.reduce((s, e) => s + e.currentValueKRW, 0);
    const totalCost  = enriched.reduce((s, e) => s + e.costKRW, 0);
    const totalPnl   = totalValue - totalCost;
    const totalRate  = totalCost !== 0 ? (totalPnl / totalCost) * 100 : 0;
    const totalDailyChangeKRW = enriched.reduce((s, e) => s + (e.dailyChangeKRW ?? 0), 0);
    const prevTotalValue = totalValue - totalDailyChangeKRW;
    const totalDailyChangeRate = prevTotalValue !== 0 ? (totalDailyChangeKRW / prevTotalValue) * 100 : 0;
    return { totalValue, totalCost, totalPnl, totalRate, totalDailyChangeKRW, totalDailyChangeRate };
  }, [enriched]);

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

  const activePieData = isLoggedIn
    ? (chartMode === "portfolio" ? portfolioPieData : chartMode === "stock" ? stockPieData : marketPieData)
    : (chartMode === "stock" ? previewStockPie : previewMarketPie);

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
  const openEditModal = (item: PortfolioItem) => {
    if (item.assetClass === "현금") setCashEditItem(item);
    else setEditItem(item);
  };
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
  const displaySummary  = isLoggedIn ? summary : previewSummaryLive;
  // 로그인/비로그인 모두 현재가를 다 불러오기 전까지 추정치를 보여주지 않음
  // 구성 차트는 자산유형 필터와 무관하게 전체 보유종목 기준으로 항상 표시
  const hasDisplay      = allDisplayEnriched.length > 0 && (isLoggedIn ? !isLoading : previewLoaded);

  return (
    <div className="flex flex-col gap-4 fade-in pb-20">

      {/* ── 상단 탭 ── */}
      <div className="flex border-b border-border bg-bg-card rounded-t-xl overflow-hidden">
        {[
          { id: "portfolio", label: "내 자산" },
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
          <AddPortfolioButton onAdd={(name) => createPortfolioMutation.mutate(name)} />
          {portfolios.length > 0 && (
            <button
              onClick={() => setShowPortfolioManager(true)}
              className="p-2 flex-shrink-0 text-text-muted hover:text-accent-blue hover:bg-accent-blue/10 transition-colors rounded-lg mx-1"
              title="포트폴리오 관리"
            >
              <Settings2 size={14} />
            </button>
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
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-text-primary">내 자산</h1>
          <p className="text-text-muted text-xs mt-0.5">
            {isLoggedIn && itemsLoading ? "보유 종목 불러오는 중..." : `${displayEnriched.length}개 종목 · 클릭하면 상세로 이동`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
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
            { label: "총 평가금액", value: fmtKRWFull(displaySummary.totalValue),    color: "text-text-primary", icon: Landmark,  tint: "" },
            { label: "총 매입금액", value: fmtKRWFull(displaySummary.totalCost),     color: "text-text-primary", icon: Receipt,   tint: "" },
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
              {c.label === "총 평가금액" && (
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
                {(() => {
                  const total = activePieData.reduce((s, e) => s + e.value, 0);
                  return activePieData.map((entry, i) => {
                    const pct = total > 0 ? (entry.value / total) * 100 : 0;
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
                  });
                })()}
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
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 원화/외화 표시 모드 토글 (해외 보유종목이 있을 때만) — 둘 중 하나만 표시 */}
            {hasForexHoldings && (
              <div className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary flex-shrink-0" title="해외 보유종목의 가격 표시 기준 통화">
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
            <div className="flex gap-1 bg-bg-secondary border border-border rounded-xl p-1 w-fit">
              {ASSET_FILTER_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setAssetFilterTab(t.id)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all whitespace-nowrap ${
                    assetFilterTab === t.id ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
                  }`}
                >{t.label}</button>
              ))}
            </div>
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
              {!isAllView && <p className="text-text-muted text-xs mt-1">+ 추가 버튼으로 종목을 등록하세요</p>}
            </div>
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
              {displayEnriched.map((item) => {
                const pc = pnlColor(item.pnlKRW);
                const hasPrice = item.assetClass === "현금" ? true : (isLoggedIn ? priceMap[item.id] != null : previewLoaded);
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-border bg-bg-card hover:border-accent-blue/30 hover:bg-bg-hover transition-all p-4 flex flex-col gap-3 cursor-pointer"
                    onClick={() => navigate(`/stocks/${item.market}/${encodeURIComponent(item.symbol)}`)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <MarketBadge market={item.market} />
                        <div className="min-w-0">
                          <div className="font-semibold text-text-primary text-sm truncate">{item.name || item.symbol}</div>
                          <div className="text-text-dim font-mono text-xs truncate">
                            {item.symbol}{isAllView && item.portfolioName ? ` · ${item.portfolioName}` : ""}
                          </div>
                        </div>
                      </div>
                      {isLoggedIn && (
                        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => openEditModal(item)}
                            className="p-1.5 rounded-lg text-accent-blue bg-accent-blue/15 hover:bg-accent-blue/25 transition-colors" title="수정">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => setDeleteTarget(item)}
                            className="p-1.5 rounded-lg text-accent-red bg-accent-red/15 hover:bg-accent-red/25 transition-colors" title="삭제">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>

                    {(() => {
                      const isForexItem = item.market === "US" || item.market === "ETF";
                      const showAsNative = isForexItem && currencyMode === "native";
                      const nativeAvgPrice = !isForexItem ? item.avgPrice
                        : item.currency === "USD" ? item.avgPrice : (item.costKRW / item.shares) / exchangeRate;
                      const nativeValue = isForexItem ? item.currentPriceNative * item.shares : item.currentValueKRW;
                      const nativePnl = isForexItem ? nativeValue - nativeAvgPrice * item.shares : item.pnlKRW;
                      return (
                        <>
                          <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-text-dim">평가금액</span>
                              <span className="font-mono font-bold text-text-primary text-base">
                                {hasPrice ? (showAsNative ? fmtUSDFull(nativeValue) : fmtKRWFull(item.currentValueKRW)) : "—"}
                              </span>
                            </div>
                            <div className="flex flex-col gap-0.5 items-end">
                              <span className="text-xs text-text-dim">평가손익</span>
                              <span className={`font-mono font-bold text-base whitespace-nowrap ${hasPrice ? pc : "text-text-muted"}`}>
                                {hasPrice
                                  ? `${showAsNative ? `${nativePnl >= 0 ? "+" : ""}${fmtUSDFull(nativePnl)}` : fmtKRWFullSign(item.pnlKRW)} (${item.pnlRate >= 0 ? "+" : ""}${item.pnlRate.toFixed(2)}%)`
                                  : "—"}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-text-dim">보유수량</span>
                              <span className="font-mono text-text-secondary">{item.shares % 1 === 0 ? item.shares.toLocaleString() : item.shares.toFixed(4)}</span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-text-dim">평단가</span>
                              <span className="font-mono text-text-secondary">
                                {!isForexItem ? fmtNative(item.market, item.currency, item.avgPrice)
                                  : showAsNative ? fmtUSDFull(nativeAvgPrice) : fmtKRWFull(nativeAvgPrice * exchangeRate)}
                              </span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-text-dim">현재가</span>
                              <span className="font-mono text-text-secondary">
                                {!hasPrice ? "—"
                                  : !isForexItem ? fmtNative(item.market, item.currency, item.currentPriceNative)
                                  : showAsNative ? fmtUSDFull(item.currentPriceNative) : fmtKRWFull(item.currentPriceNative * exchangeRate)}
                              </span>
                            </div>
                          </div>
                        </>
                      );
                    })()}

                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-bg-elevated rounded-full overflow-hidden">
                        <div className="h-full bg-accent-blue/60 rounded-full" style={{ width: `${Math.min(100, item.weight)}%` }} />
                      </div>
                      <span className="text-xs font-mono text-text-muted flex-shrink-0">비중 {item.weight.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
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
                {displayEnriched.map((item) => {
                  const pc    = pnlColor(item.pnlKRW);
                  const hasPrice = item.assetClass === "현금" ? true : (isLoggedIn ? priceMap[item.id] != null : previewLoaded);
                  return (
                    <tr key={item.id}
                      className="border-b border-border/40 transition-colors hover:bg-bg-hover cursor-pointer"
                      onClick={() => navigate(`/stocks/${item.market}/${encodeURIComponent(item.symbol)}`)}
                      onMouseEnter={() => prefetchStock(item)}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-text-primary">{item.name || item.symbol}</span>
                          <span className="text-text-dim font-mono">{item.symbol}</span>
                        </div>
                      </td>
                      {isAllView && (
                        <td className="px-3 py-2.5 text-text-muted whitespace-nowrap">{item.portfolioName || "-"}</td>
                      )}
                      <td className="px-3 py-2.5 text-right whitespace-nowrap"><MarketBadge market={item.market} /></td>
                      <td className="px-3 py-2.5 text-right font-mono text-text-primary whitespace-nowrap">
                        {item.shares % 1 === 0 ? item.shares.toLocaleString() : item.shares.toFixed(4)}
                      </td>
                      {(() => {
                        const isForexItem = item.market === "US" || item.market === "ETF";
                        const showAsNative = isForexItem && currencyMode === "native";
                        const nativeAvgPrice = !isForexItem ? item.avgPrice
                          : item.currency === "USD" ? item.avgPrice : (item.costKRW / item.shares) / exchangeRate;
                        const nativeValue = isForexItem ? item.currentPriceNative * item.shares : item.currentValueKRW;
                        const nativePnl = isForexItem ? nativeValue - nativeAvgPrice * item.shares : item.pnlKRW;
                        return (
                          <>
                            <td className="px-3 py-2.5 text-right font-mono text-text-secondary whitespace-nowrap">
                              <div>
                                {!isForexItem ? fmtNative(item.market, item.currency, item.avgPrice)
                                  : showAsNative ? fmtUSDFull(nativeAvgPrice) : fmtKRWFull(nativeAvgPrice * exchangeRate)}
                              </div>
                              {item.currency === "USD" && item.inputExchangeRate && (
                                <div className="text-[10px] text-text-dim">@{Math.round(item.inputExchangeRate).toLocaleString()}원</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-text-primary whitespace-nowrap">
                              {!hasPrice ? <span className="text-text-muted">—</span>
                                : !isForexItem ? fmtNative(item.market, item.currency, item.currentPriceNative)
                                : showAsNative ? fmtUSDFull(item.currentPriceNative) : fmtKRWFull(item.currentPriceNative * exchangeRate)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-text-primary whitespace-nowrap">
                              {hasPrice
                                ? (showAsNative ? fmtUSDFull(nativeValue) : fmtKRWFull(item.currentValueKRW))
                                : <span className="text-text-muted">—</span>}
                            </td>
                            <td className={`px-3 py-2.5 text-right font-mono font-semibold whitespace-nowrap ${hasPrice ? pc : "text-text-muted"}`}>
                              {hasPrice
                                ? (showAsNative ? `${nativePnl >= 0 ? "+" : ""}${fmtUSDFull(nativePnl)}` : fmtKRWFullSign(item.pnlKRW))
                                : "—"}
                            </td>
                          </>
                        );
                      })()}
                      <td className={`px-3 py-2.5 text-right font-mono font-semibold whitespace-nowrap ${hasPrice ? pc : "text-text-muted"}`}>
                        {hasPrice ? `${item.pnlRate >= 0 ? "+" : ""}${item.pnlRate.toFixed(2)}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-text-muted whitespace-nowrap">
                        <div>{item.weight.toFixed(1)}%</div>
                        <div className="w-12 h-1 bg-bg-elevated rounded-full overflow-hidden ml-auto mt-0.5">
                          <div className="h-full bg-accent-blue/60 rounded-full" style={{ width: `${Math.min(100, item.weight)}%` }} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {isLoggedIn && (
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => openEditModal(item)}
                              className="p-1.5 rounded-lg text-accent-blue bg-accent-blue/15 hover:bg-accent-blue/25 transition-colors" title="수정">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => setDeleteTarget(item)}
                              className="p-1.5 rounded-lg text-accent-red bg-accent-red/15 hover:bg-accent-red/25 transition-colors" title="삭제">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
          title="종목을 삭제할까요?"
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
          title="포트폴리오를 삭제할까요?"
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
