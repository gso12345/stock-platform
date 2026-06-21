import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { screeningApi, watchlistApi, stocksApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import {
  Card, ChangeBadge, LoadingSpinner, formatNumber, RangeFilter, Tabs, Button, Badge,
} from "@/components/ui";
import ComingSoon from "@/components/ComingSoon";
import type { Market } from "@/types";
import {
  Filter, Save, Trash2, ChevronUp, ChevronDown, ExternalLink,
  Star, Download, Settings2, Check,
} from "lucide-react";

const MARKET_TABS = [
  { id: "US", label: "미국" },
  { id: "KR", label: "한국" },
  { id: "ETF", label: "ETF" },
];

const FILTER_TABS = [
  { id: "basic", label: "기본" },
  { id: "valuation", label: "밸류에이션" },
  { id: "technical", label: "기술적" },
  { id: "growth", label: "성장성" },
];

const SORT_OPTIONS = [
  { value: "market_cap", label: "시가총액" },
  { value: "change_rate", label: "등락률" },
  { value: "per", label: "PER" },
  { value: "pbr", label: "PBR" },
  { value: "roe", label: "ROE" },
  { value: "eps", label: "EPS" },
  { value: "debt_ratio", label: "부채비율" },
  { value: "price", label: "주가" },
  { value: "volume", label: "거래량" },
];

const SECTORS = [
  "전체", "Technology", "Healthcare", "Financials", "Consumer Cyclical",
  "Industrials", "Communication Services", "Consumer Defensive", "Energy",
  "Basic Materials", "Real Estate", "Utilities",
];

type ColumnKey = "price" | "change_rate" | "per" | "pbr" | "roe" | "eps" | "debt_ratio" | "market_cap";

const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "price",       label: "현재가" },
  { key: "change_rate", label: "등락률" },
  { key: "per",         label: "PER" },
  { key: "pbr",         label: "PBR" },
  { key: "roe",         label: "ROE" },
  { key: "eps",         label: "EPS" },
  { key: "debt_ratio",  label: "부채비율" },
  { key: "market_cap",  label: "시가총액" },
];

/* ── CSV export helper ─────────────────────────────────────── */
function downloadCSV(rows: any[], visibleCols: Set<ColumnKey>) {
  const headers = ["순위", "종목코드", "종목명", "시장", ...ALL_COLUMNS.filter((c) => visibleCols.has(c.key)).map((c) => c.label)];
  const lines = rows.map((s, i) => {
    const base = [i + 1, s.symbol, s.name ?? "", s.market ?? ""];
    const extra = ALL_COLUMNS.filter((c) => visibleCols.has(c.key)).map((c) => {
      const v = s[c.key];
      return v == null ? "" : v;
    });
    return [...base, ...extra].join(",");
  });
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `screening_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Toast component ───────────────────────────────────────── */
function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed bottom-[calc(4.5rem_+_env(safe-area-inset-bottom))] right-4 lg:bottom-6 lg:right-6 z-50 flex items-center gap-2 px-4 py-2.5 bg-accent-green/20 border border-accent-green/40 text-accent-green text-sm font-medium rounded-xl shadow-lg animate-fade-in">
      <Check size={14} />
      {message}
    </div>
  );
}

export default function Screening() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return <ComingSoon title="스크리닝" />;

  // 행에 마우스를 올리면 상세 페이지 데이터 선제 prefetch (클릭 시 즉시 표시)
  const prefetchStock = (stock: any) => {
    const mkt = stock.market as Market;
    const sym = stock.symbol;
    if (qc.getQueryData(["stock-detail", mkt, sym])) return;
    qc.prefetchQuery({ queryKey: ["stock-detail", mkt, sym], queryFn: () => stocksApi.getDetail(mkt, sym), staleTime: 60_000 });
  };
  const { isLoggedIn } = useAuthStore();
  const [market, setMarket] = useState<string>("US");
  const [filterTab, setFilterTab] = useState("basic");
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [sortBy, setSortBy] = useState("market_cap");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [sector, setSector] = useState("전체");
  const [results, setResults] = useState<any[]>([]);
  const [visibleCount, setVisibleCount] = useState(30);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [presetName, setPresetName] = useState("");
  const [showPresets, setShowPresets] = useState(false);

  // column visibility
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(
    new Set(ALL_COLUMNS.map((c) => c.key))
  );
  const [showColMenu, setShowColMenu] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);

  // watchlist star states
  const [starredSymbols, setStarredSymbols] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  // close column menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) {
        setShowColMenu(false);
      }
    }
    if (showColMenu) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showColMenu]);

  const { data: presets } = useQuery({ queryKey: ["screening-presets"], queryFn: screeningApi.getPresets });

  const runMutation = useMutation({
    mutationFn: () => screeningApi.run({ market, filters, sort_by: sortBy, sort_order: sortOrder, limit: 100 }),
    onSuccess: (data) => { setResults(data.results ?? []); setVisibleCount(30); },
    onError: (err: any) => setToast(err?.response?.data?.detail ?? "스크리닝 실행에 실패했어요. 잠시 후 다시 시도해주세요"),
  });

  const savePresetMutation = useMutation({
    mutationFn: () => screeningApi.savePreset({ name: presetName, market, filters, sort_by: sortBy, sort_order: sortOrder }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["screening-presets"] }); setPresetName(""); },
  });

  const deletePresetMutation = useMutation({
    mutationFn: (id: number) => screeningApi.deletePreset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["screening-presets"] }),
  });

  const addToWatchlistMutation = useMutation({
    mutationFn: (stock: any) =>
      watchlistApi.addItem({ symbol: stock.symbol, market: stock.market, name: stock.name ?? stock.symbol, watchlist_id: 1 }),
    onSuccess: (_data, stock: any) => {
      setStarredSymbols((prev) => new Set([...prev, stock.symbol]));
      setToast(`${stock.symbol} 관심종목에 추가됨`);
    },
    onError: (err: any) => {
      if (err?.response?.status === 401) {
        setToast("로그인이 필요해요");
        navigate("/login");
        return;
      }
      setToast(err?.response?.data?.detail ?? "추가 실패");
    },
  });

  const setFilter = (key: string, val: { min?: number; max?: number }) => {
    if (val.min == null && val.max == null) {
      const next = { ...filters };
      delete next[key];
      setFilters(next);
    } else {
      setFilters((p) => ({ ...p, [key]: val }));
    }
  };

  const resetFilters = () => { setFilters({}); setSector("전체"); };

  const loadPreset = (p: any) => {
    setMarket(p.market);
    setFilters(p.filters);
    setSortBy(p.sort_by);
    setSortOrder(p.sort_order);
  };

  const toggleSelect = (sym: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(sym) ? next.delete(sym) : next.add(sym);
      return next;
    });
  };

  const toggleColumn = (key: ColumnKey) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const sortedResults = [...results].filter((s) => sector === "전체" || s.sector === sector);
  const activeFilterCount = Object.keys(filters).length;

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* ── 페이지 헤더 ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">종목 스크리닝</h1>
          <p className="text-text-muted text-xs mt-0.5">다중 조건으로 유망 종목을 발굴합니다</p>
        </div>
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <span className="text-xs px-2 py-1 bg-accent-blue/20 text-accent-blue rounded-full border border-accent-blue/30">
              {activeFilterCount}개 필터 적용
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={resetFilters}>초기화</Button>
          <Button variant="secondary" size="sm" onClick={() => setShowPresets(!showPresets)}>
            <Save size={13} className="mr-1.5 inline" />프리셋
          </Button>
          <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending} size="md">
            {runMutation.isPending ? "분석 중..." : "스크리닝 실행"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 flex-1 min-h-0">
        {/* ── 필터 패널 ─────────────────────────────────────── */}
        <div className="xl:col-span-1 flex flex-col gap-3 overflow-y-auto pr-1">
          {/* 시장 선택 */}
          <Card className="p-3">
            <p className="text-[11px] font-semibold text-text-secondary mb-2 uppercase tracking-wider">시장</p>
            <div className="flex gap-1">
              {MARKET_TABS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMarket(m.id)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    market === m.id
                      ? "bg-accent-blue text-white"
                      : "bg-bg-primary text-text-muted border border-border hover:text-text-primary"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Card>

          {/* 필터 탭 */}
          <Card className="p-3">
            <div className="flex gap-0.5 mb-3 bg-bg-primary border border-border rounded-lg p-0.5">
              {FILTER_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setFilterTab(t.id)}
                  className={`flex-1 py-1 text-[11px] font-semibold rounded-md transition-all ${
                    filterTab === t.id ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-3">
              {filterTab === "basic" && (
                <>
                  <RangeFilter label="시가총액 (억)" filterKey="market_cap" filters={filters} onChange={setFilter} />
                  <RangeFilter label="주가" filterKey="price" filters={filters} onChange={setFilter} />
                  <RangeFilter label="거래량" filterKey="volume" filters={filters} onChange={setFilter} />
                  <RangeFilter label="등락률 (%)" filterKey="change_rate" filters={filters} onChange={setFilter} />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-text-secondary">섹터</label>
                    <select
                      value={sector}
                      onChange={(e) => setSector(e.target.value)}
                      className="bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                    >
                      {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </>
              )}
              {filterTab === "valuation" && (
                <>
                  <RangeFilter label="PER" filterKey="per" filters={filters} onChange={setFilter} />
                  <RangeFilter label="Forward PER" filterKey="forward_per" filters={filters} onChange={setFilter} />
                  <RangeFilter label="PBR" filterKey="pbr" filters={filters} onChange={setFilter} />
                  <RangeFilter label="PEG 비율" filterKey="peg_ratio" filters={filters} onChange={setFilter} />
                  <RangeFilter label="EV/EBITDA" filterKey="ev_ebitda" filters={filters} onChange={setFilter} />
                  <RangeFilter label="P/S (주가매출비)" filterKey="ps_ratio" filters={filters} onChange={setFilter} />
                  <RangeFilter label="배당수익률 (%)" filterKey="dividend_yield" filters={filters} onChange={setFilter} />
                </>
              )}
              {filterTab === "technical" && (
                <>
                  <RangeFilter label="RSI (14)" filterKey="rsi" filters={filters} onChange={setFilter} />
                  <RangeFilter label="52주 고점 대비 (%)" filterKey="pct_from_52w_high" filters={filters} onChange={setFilter} />
                  <RangeFilter label="52주 저점 대비 (%)" filterKey="pct_from_52w_low" filters={filters} onChange={setFilter} />
                  <RangeFilter label="베타" filterKey="beta" filters={filters} onChange={setFilter} />
                  <RangeFilter label="1개월 수익률 (%)" filterKey="return_1m" filters={filters} onChange={setFilter} />
                  <RangeFilter label="3개월 수익률 (%)" filterKey="return_3m" filters={filters} onChange={setFilter} />
                  <RangeFilter label="1년 수익률 (%)" filterKey="return_1y" filters={filters} onChange={setFilter} />
                </>
              )}
              {filterTab === "growth" && (
                <>
                  <RangeFilter label="ROE (%)" filterKey="roe" filters={filters} onChange={setFilter} />
                  <RangeFilter label="ROA (%)" filterKey="roa" filters={filters} onChange={setFilter} />
                  <RangeFilter label="영업이익률 (%)" filterKey="operating_margin" filters={filters} onChange={setFilter} />
                  <RangeFilter label="순이익률 (%)" filterKey="profit_margin" filters={filters} onChange={setFilter} />
                  <RangeFilter label="EPS" filterKey="eps" filters={filters} onChange={setFilter} />
                  <RangeFilter label="부채비율 (%)" filterKey="debt_ratio" filters={filters} onChange={setFilter} />
                  <RangeFilter label="유동비율" filterKey="current_ratio" filters={filters} onChange={setFilter} />
                </>
              )}
            </div>
          </Card>

          {/* 정렬 */}
          <Card className="p-3">
            <p className="text-[11px] font-semibold text-text-secondary mb-2 uppercase tracking-wider">정렬</p>
            <div className="flex flex-col gap-2">
              <select
                className="bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="flex gap-1">
                {(["desc", "asc"] as const).map((o) => (
                  <button
                    key={o}
                    onClick={() => setSortOrder(o)}
                    className={`flex-1 py-1 text-xs rounded-lg flex items-center justify-center gap-1 transition-all ${
                      sortOrder === o
                        ? "bg-accent-blue text-white"
                        : "bg-bg-primary border border-border text-text-muted"
                    }`}
                  >
                    {o === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                    {o === "desc" ? "내림차순" : "오름차순"}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* 프리셋 */}
          {showPresets && (
            <Card className="p-3">
              <p className="text-[11px] font-semibold text-text-secondary mb-2 uppercase tracking-wider">프리셋 저장/불러오기</p>
              <div className="flex gap-1 mb-2">
                <input
                  className="flex-1 bg-bg-primary border border-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  placeholder="프리셋 이름"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
                <button
                  onClick={() => presetName && savePresetMutation.mutate()}
                  className="px-2 py-1 bg-accent-blue text-white text-xs rounded-lg font-medium"
                >저장</button>
              </div>
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {presets?.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-1 group">
                    <button
                      onClick={() => loadPreset(p)}
                      className="flex-1 text-left text-xs px-2 py-1.5 bg-bg-primary rounded-lg border border-border hover:border-accent-blue text-text-secondary hover:text-text-primary transition-colors"
                    >
                      {p.name}
                      <span className="text-text-muted ml-1">· {p.market}</span>
                    </button>
                    <button
                      onClick={() => deletePresetMutation.mutate(p.id)}
                      className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-red p-1"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ── 결과 패널 ─────────────────────────────────────── */}
        <div className="xl:col-span-3 flex flex-col gap-3">
          {/* 결과 헤더 */}
          {results.length > 0 && (
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-3">
                <span className="text-sm text-text-secondary">
                  <span className="text-text-primary font-semibold">{sortedResults.length}</span>개 발굴
                  {results.length !== sortedResults.length && (
                    <span className="text-text-muted ml-1">/ 전체 {results.length}개</span>
                  )}
                </span>
                {selected.size > 0 && (
                  <span className="text-xs px-2 py-0.5 bg-accent-blue/20 text-accent-blue rounded-full border border-accent-blue/30">
                    {selected.size}개 선택됨
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selected.size > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>선택 해제</Button>
                )}
                {/* Export CSV */}
                <button
                  onClick={() => downloadCSV(sortedResults, visibleCols)}
                  title="CSV 다운로드"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary bg-bg-elevated border border-border rounded-lg hover:border-accent-blue/50 transition-colors"
                >
                  <Download size={12} />
                  CSV
                </button>
                {/* Column visibility toggle */}
                <div className="relative" ref={colMenuRef}>
                  <button
                    onClick={() => setShowColMenu((v) => !v)}
                    title="컬럼 표시 설정"
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg transition-colors ${
                      showColMenu
                        ? "bg-accent-blue/10 border-accent-blue/50 text-accent-blue"
                        : "text-text-secondary hover:text-text-primary bg-bg-elevated border-border hover:border-accent-blue/50"
                    }`}
                  >
                    <Settings2 size={12} />
                    컬럼
                  </button>
                  {showColMenu && (
                    <div className="absolute right-0 top-full mt-1.5 z-30 bg-bg-card border border-border rounded-xl shadow-xl p-2 min-w-[140px]">
                      <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider px-2 pb-1.5">표시 컬럼</p>
                      {ALL_COLUMNS.map((col) => (
                        <button
                          key={col.key}
                          onClick={() => toggleColumn(col.key)}
                          className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-bg-hover text-xs text-text-secondary hover:text-text-primary transition-colors"
                        >
                          {col.label}
                          <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                            visibleCols.has(col.key)
                              ? "bg-accent-blue border-accent-blue text-white"
                              : "border-border"
                          }`}>
                            {visibleCols.has(col.key) && <Check size={10} />}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <Card className="p-0 overflow-hidden flex-1">
            {runMutation.isPending ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3">
                <div className="w-10 h-10 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
                <p className="text-text-muted text-sm">종목 분석 중...</p>
              </div>
            ) : sortedResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
                <Filter size={32} className="text-text-muted/40" />
                <div>
                  <p className="text-text-secondary font-medium">조건을 설정하고 스크리닝을 실행하세요</p>
                  <p className="text-text-muted text-xs mt-1">좌측 필터로 다양한 조건을 추가할 수 있습니다</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-bg-secondary border-b border-border z-10">
                    <tr className="text-text-muted text-[11px]">
                      <th className="w-8 px-3 py-3"></th>
                      <th className="text-left px-3 py-3">종목</th>
                      {visibleCols.has("price")       && <th className="text-right px-3 py-3">현재가</th>}
                      {visibleCols.has("change_rate") && <th className="text-right px-3 py-3">등락률</th>}
                      {visibleCols.has("per")         && <th className="text-right px-3 py-3">PER</th>}
                      {visibleCols.has("pbr")         && <th className="text-right px-3 py-3">PBR</th>}
                      {visibleCols.has("roe")         && <th className="text-right px-3 py-3">ROE</th>}
                      {visibleCols.has("eps")         && <th className="text-right px-3 py-3">EPS</th>}
                      {visibleCols.has("debt_ratio")  && <th className="text-right px-3 py-3">부채비율</th>}
                      {visibleCols.has("market_cap")  && <th className="text-right px-3 py-3">시가총액</th>}
                      <th className="px-3 py-3 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedResults.slice(0, visibleCount).map((stock: any, i: number) => {
                      const isSelected = selected.has(stock.symbol);
                      const isStarred = starredSymbols.has(stock.symbol);
                      return (
                        <tr
                          key={stock.symbol}
                          onMouseEnter={() => prefetchStock(stock)}
                          className={`border-b border-border/30 hover:bg-bg-hover/50 transition-colors ${isSelected ? "bg-accent-blue/5" : ""}`}
                        >
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(stock.symbol)}
                              className="accent-accent-blue"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="text-text-muted text-xs w-5 text-right">{i + 1}</span>
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-bold text-text-primary">{stock.symbol}</span>
                                  <Badge variant={stock.market === "KR" ? "blue" : stock.market === "ETF" ? "purple" : "green"}>
                                    {stock.market}
                                  </Badge>
                                </div>
                                <div className="text-text-muted text-[11px] truncate max-w-[140px]">{stock.name}</div>
                              </div>
                            </div>
                          </td>
                          {visibleCols.has("price") && (
                            <td className="px-3 py-2.5 text-right font-mono text-text-primary">
                              {stock.market === "KR"
                                ? `₩${stock.price?.toLocaleString("ko-KR")}`
                                : `$${stock.price?.toFixed(2)}`}
                            </td>
                          )}
                          {visibleCols.has("change_rate") && (
                            <td className="px-3 py-2.5 text-right">
                              <ChangeBadge value={stock.change_rate ?? 0} />
                            </td>
                          )}
                          {visibleCols.has("per") && (
                            <td className="px-3 py-2.5 text-right font-mono text-text-secondary text-xs">
                              {stock.per?.toFixed(1) ?? "-"}
                            </td>
                          )}
                          {visibleCols.has("pbr") && (
                            <td className="px-3 py-2.5 text-right font-mono text-text-secondary text-xs">
                              {stock.pbr?.toFixed(2) ?? "-"}
                            </td>
                          )}
                          {visibleCols.has("roe") && (
                            <td className="px-3 py-2.5 text-right font-mono text-xs">
                              {stock.roe != null ? (
                                <span className={stock.roe >= 15 ? "text-accent-green" : stock.roe >= 0 ? "text-text-secondary" : "text-accent-red"}>
                                  {stock.roe.toFixed(1)}%
                                </span>
                              ) : "-"}
                            </td>
                          )}
                          {visibleCols.has("eps") && (
                            <td className="px-3 py-2.5 text-right font-mono text-text-secondary text-xs">
                              {stock.eps?.toFixed(2) ?? "-"}
                            </td>
                          )}
                          {visibleCols.has("debt_ratio") && (
                            <td className="px-3 py-2.5 text-right font-mono text-xs">
                              {stock.debt_ratio != null ? (
                                <span className={stock.debt_ratio > 200 ? "text-accent-red" : stock.debt_ratio > 100 ? "text-accent-yellow" : "text-accent-green"}>
                                  {stock.debt_ratio.toFixed(0)}%
                                </span>
                              ) : "-"}
                            </td>
                          )}
                          {visibleCols.has("market_cap") && (
                            <td className="px-3 py-2.5 text-right font-mono text-text-secondary text-xs">
                              {formatNumber(stock.market_cap)}
                            </td>
                          )}
                          {/* Actions */}
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => {
                                  if (!isLoggedIn) { navigate("/login"); return; }
                                  if (!isStarred) addToWatchlistMutation.mutate(stock);
                                }}
                                disabled={isStarred || addToWatchlistMutation.isPending}
                                title="관심종목 추가"
                                className={`transition-colors ${
                                  isStarred
                                    ? "text-accent-yellow cursor-default"
                                    : "text-text-muted hover:text-accent-yellow"
                                }`}
                              >
                                <Star size={13} fill={isStarred ? "currentColor" : "none"} />
                              </button>
                              <button
                                onClick={() => navigate(`/stocks/${stock.market}/${stock.symbol}`)}
                                className="text-text-muted hover:text-accent-blue transition-colors"
                                title="상세 보기"
                              >
                                <ExternalLink size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {sortedResults.length > visibleCount && (
                  <div className="flex justify-center py-3 border-t border-border/30">
                    <button
                      onClick={() => setVisibleCount((c) => c + 30)}
                      className="text-xs text-accent-blue hover:underline"
                    >
                      더 보기 ({sortedResults.length - visibleCount}개 더 있음)
                    </button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Toast notification */}
      {toast && <Toast message={toast ?? ""} onDone={() => setToast(null)} />}
    </div>
  );
}
