import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { screeningApi } from "@/api/stocks";
import {
  Card, ChangeBadge, LoadingSpinner, formatNumber, RangeFilter, Tabs, Button, Badge, Section
} from "@/components/ui";
import type { Market } from "@/types";
import { Filter, Save, Trash2, ChevronUp, ChevronDown, ExternalLink } from "lucide-react";

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

export default function Screening() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [market, setMarket] = useState<string>("US");
  const [filterTab, setFilterTab] = useState("basic");
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [sortBy, setSortBy] = useState("market_cap");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [sector, setSector] = useState("전체");
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [presetName, setPresetName] = useState("");
  const [showPresets, setShowPresets] = useState(false);

  const { data: presets } = useQuery({ queryKey: ["screening-presets"], queryFn: screeningApi.getPresets });

  const runMutation = useMutation({
    mutationFn: () => screeningApi.run({ market, filters, sort_by: sortBy, sort_order: sortOrder, limit: 100 }),
    onSuccess: (data) => setResults(data.results ?? []),
  });

  const savePresetMutation = useMutation({
    mutationFn: () => screeningApi.savePreset({ name: presetName, market, filters, sort_by: sortBy, sort_order: sortOrder }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["screening-presets"] }); setPresetName(""); },
  });

  const deletePresetMutation = useMutation({
    mutationFn: (id: number) => screeningApi.deletePreset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["screening-presets"] }),
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

  const sortedResults = [...results].filter((s) => sector === "전체" || s.sector === sector);

  const activeFilterCount = Object.keys(filters).length;

  return (
    <div className="flex flex-col gap-5 h-full">
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
        {/* 필터 패널 */}
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
                    market === m.id ? "bg-accent-blue text-white" : "bg-bg-primary text-text-muted border border-border hover:text-text-primary"
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
                      sortOrder === o ? "bg-accent-blue text-white" : "bg-bg-primary border border-border text-text-muted"
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
                    <button onClick={() => deletePresetMutation.mutate(p.id)} className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-red p-1">
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* 결과 패널 */}
        <div className="xl:col-span-3 flex flex-col gap-3">
          {/* 결과 헤더 */}
          {results.length > 0 && (
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-3">
                <span className="text-sm text-text-secondary">
                  <span className="text-text-primary font-semibold">{sortedResults.length}</span>개 발굴
                  {results.length !== sortedResults.length && <span className="text-text-muted ml-1">/ 전체 {results.length}개</span>}
                </span>
                {selected.size > 0 && (
                  <span className="text-xs px-2 py-0.5 bg-accent-blue/20 text-accent-blue rounded-full border border-accent-blue/30">
                    {selected.size}개 선택됨
                  </span>
                )}
              </div>
              {selected.size > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>선택 해제</Button>
              )}
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
                      <th className="text-right px-3 py-3">현재가</th>
                      <th className="text-right px-3 py-3">등락률</th>
                      <th className="text-right px-3 py-3">PER</th>
                      <th className="text-right px-3 py-3">PBR</th>
                      <th className="text-right px-3 py-3">ROE</th>
                      <th className="text-right px-3 py-3">EPS</th>
                      <th className="text-right px-3 py-3">부채비율</th>
                      <th className="text-right px-3 py-3">시가총액</th>
                      <th className="px-3 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedResults.map((stock: any, i: number) => {
                      const isSelected = selected.has(stock.symbol);
                      return (
                        <tr
                          key={stock.symbol}
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
                          <td className="px-3 py-2.5 text-right font-mono text-text-primary">
                            {stock.market === "KR" ? `₩${stock.price?.toLocaleString("ko-KR")}` : `$${stock.price?.toFixed(2)}`}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <ChangeBadge value={stock.change_rate ?? 0} />
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-text-secondary text-xs">
                            {stock.per?.toFixed(1) ?? "-"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-text-secondary text-xs">
                            {stock.pbr?.toFixed(2) ?? "-"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs">
                            {stock.roe != null ? (
                              <span className={stock.roe >= 15 ? "text-accent-green" : stock.roe >= 0 ? "text-text-secondary" : "text-accent-red"}>
                                {stock.roe.toFixed(1)}%
                              </span>
                            ) : "-"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-text-secondary text-xs">
                            {stock.eps?.toFixed(2) ?? "-"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs">
                            {stock.debt_ratio != null ? (
                              <span className={stock.debt_ratio > 200 ? "text-accent-red" : stock.debt_ratio > 100 ? "text-accent-yellow" : "text-accent-green"}>
                                {stock.debt_ratio.toFixed(0)}%
                              </span>
                            ) : "-"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-text-secondary text-xs">
                            {formatNumber(stock.market_cap)}
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              onClick={() => navigate(`/stocks/${stock.market}/${stock.symbol}`)}
                              className="text-text-muted hover:text-accent-blue transition-colors"
                            >
                              <ExternalLink size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
