import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backtestApi } from "@/api/stocks";
import { Card, ChangeBadge, LoadingSpinner, formatNumber, Tabs, Button, Badge } from "@/components/ui";
import { ConditionBuilder } from "@/components/backtest/ConditionBuilder";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { ConditionGroup, Market } from "@/types";
import { Save, Play, Globe, TrendingUp, BarChart2, Award, LogIn } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

const DEFAULT_ENTRY: ConditionGroup = {
  logic: "AND",
  conditions: [{ indicator: "MA", operator: "crosses_above", value: "EMA", period: 20 }],
};
const DEFAULT_EXIT: ConditionGroup = {
  logic: "OR",
  conditions: [{ indicator: "RSI", operator: ">", value: 70, period: 14 }],
};

const UNIVERSE_OPTIONS = [
  { value: "SP500",  label: "S&P 500 (미국 대형주)", market: "US" },
  { value: "KOSPI",  label: "KOSPI (국내 대형주)",   market: "KR" },
  { value: "KOSDAQ", label: "KOSDAQ (국내 중소형)",  market: "KR" },
  { value: "ETF",    label: "글로벌 ETF",            market: "US" },
];

const RANK_OPTIONS = [
  { value: "total_return",  label: "총수익률" },
  { value: "annual_return", label: "연환산 수익률" },
  { value: "sharpe_ratio",  label: "샤프 비율" },
  { value: "win_rate",      label: "승률" },
  { value: "profit_factor", label: "수익비율" },
  { value: "mdd",           label: "MDD (낮은순)" },
];

// Date presets relative to today 2026-06-06
const TODAY = "2026-06-06";
const DATE_PRESETS = [
  { label: "YTD",  start: "2026-01-01", end: TODAY },
  { label: "1Y",   start: "2025-06-06", end: TODAY },
  { label: "3Y",   start: "2023-06-06", end: TODAY },
  { label: "5Y",   start: "2021-06-06", end: TODAY },
  { label: "10Y",  start: "2016-06-06", end: TODAY },
];

function MetricCard({ label, value, sub, color }: {
  label: string; value: React.ReactNode; sub?: string; color?: string;
}) {
  return (
    <Card className="flex flex-col gap-1 py-3 text-center">
      <div className="text-[11px] text-text-muted font-medium uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-mono font-bold ${color ?? "text-text-primary"}`}>{value}</div>
      {sub && <div className="text-[11px] text-text-muted">{sub}</div>}
    </Card>
  );
}

export default function Backtest() {
  const qc = useQueryClient();
  const { isLoggedIn } = useAuthStore();
  const [pageTab, setPageTab] = useState("single");

  // 단일종목
  const [symbol, setSymbol] = useState("AAPL");
  const [market, setMarket] = useState<Market>("US");
  const [startDate, setStartDate] = useState("2020-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [capital, setCapital] = useState(10_000_000);
  const [stopLoss, setStopLoss] = useState<number | "">("");
  const [takeProfit, setTakeProfit] = useState<number | "">("");
  const [positionSize, setPositionSize] = useState(95);
  const [entryConditions, setEntryConditions] = useState<ConditionGroup>(DEFAULT_ENTRY);
  const [exitConditions, setExitConditions] = useState<ConditionGroup>(DEFAULT_EXIT);
  const [result, setResult] = useState<any>(null);

  // 유니버스
  const [universe, setUniverse] = useState("SP500");
  const [rankBy, setRankBy] = useState("total_return");
  const [topN, setTopN] = useState(20);
  const [universeResult, setUniverseResult] = useState<any>(null);

  // 전략 저장
  const [strategyName, setStrategyName] = useState("");
  const [showSave, setShowSave] = useState(false);

  // active date preset label for highlight
  const [activeDatePreset, setActiveDatePreset] = useState<string | null>(null);

  const { data: strategies } = useQuery({ queryKey: ["strategies"], queryFn: backtestApi.getStrategies });

  const universeMarket = UNIVERSE_OPTIONS.find((o) => o.value === universe)?.market ?? "US";

  const runMutation = useMutation({
    mutationFn: () => backtestApi.run({
      symbol, market, start_date: startDate, end_date: endDate,
      initial_capital: capital, entry_conditions: entryConditions,
      exit_conditions: exitConditions,
      stop_loss: stopLoss || undefined, take_profit: takeProfit || undefined,
    }),
    onSuccess: (data) => setResult(data),
  });

  const universeMutation = useMutation({
    mutationFn: () => backtestApi.runUniverse({
      universe, market: universeMarket,
      start_date: startDate, end_date: endDate,
      initial_capital: capital, entry_conditions: entryConditions,
      exit_conditions: exitConditions, stop_loss: stopLoss || null,
      take_profit: takeProfit || null, rank_by: rankBy, top_n: topN,
    }),
    onSuccess: (data) => setUniverseResult(data),
  });

  const saveStrategyMutation = useMutation({
    mutationFn: () => backtestApi.saveStrategy({
      name: strategyName, market, entry_conditions: entryConditions,
      exit_conditions: exitConditions, stop_loss: stopLoss || undefined,
      take_profit: takeProfit || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      setStrategyName("");
      setShowSave(false);
    },
  });

  const loadStrategy = (s: any) => {
    setEntryConditions(s.entry_conditions);
    setExitConditions(s.exit_conditions);
    if (s.stop_loss) setStopLoss(s.stop_loss);
    if (s.take_profit) setTakeProfit(s.take_profit);
  };

  const applyDatePreset = (preset: typeof DATE_PRESETS[number]) => {
    setStartDate(preset.start);
    setEndDate(preset.end);
    setActiveDatePreset(preset.label);
  };

  const PAGE_TABS = [
    { id: "single",     label: "단일 종목" },
    { id: "universe",   label: "유니버스 전체" },
    { id: "strategies", label: "전략 저장소" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">백테스트</h1>
          <p className="text-text-muted text-xs mt-0.5">진입·청산 조건을 설정하고 과거 데이터로 전략을 검증합니다</p>
        </div>
        <Tabs tabs={PAGE_TABS} active={pageTab} onChange={setPageTab} />
      </div>

      {/* ── 공통 설정 패널 ──────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-1 flex flex-col gap-3">
          {/* 기본 설정 */}
          <Card className="flex flex-col gap-4">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">기본 설정</p>

            {pageTab === "single" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-text-secondary">시장</label>
                  <div className="flex gap-1">
                    {(["US", "KR"] as Market[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMarket(m)}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                          market === m
                            ? "bg-accent-blue text-white"
                            : "bg-bg-primary border border-border text-text-muted"
                        }`}
                      >{m}</button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-text-secondary">종목코드</label>
                  <input
                    className="bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue uppercase"
                    placeholder={market === "KR" ? "005930.KS" : "AAPL"}
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  />
                </div>
              </div>
            )}

            {pageTab === "universe" && (
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-medium text-text-secondary">유니버스 선택</label>
                <div className="grid grid-cols-1 gap-1.5">
                  {UNIVERSE_OPTIONS.map((u) => (
                    <button
                      key={u.value}
                      onClick={() => setUniverse(u.value)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all ${
                        universe === u.value
                          ? "border-accent-blue bg-accent-blue/10 text-text-primary"
                          : "border-border text-text-secondary hover:border-accent-blue/50"
                      }`}
                    >
                      <Globe size={13} className={universe === u.value ? "text-accent-blue" : "text-text-muted"} />
                      <span className="text-xs font-medium">{u.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 날짜 프리셋 */}
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-medium text-text-secondary">기간 프리셋</label>
              <div className="flex gap-1">
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => applyDatePreset(p)}
                    className={`flex-1 py-1 text-[11px] font-semibold rounded-lg border transition-all ${
                      activeDatePreset === p.label
                        ? "bg-accent-blue text-white border-accent-blue"
                        : "bg-bg-primary border-border text-text-muted hover:border-accent-blue/50 hover:text-text-primary"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">시작일</label>
                <input
                  type="date"
                  className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setActiveDatePreset(null); }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">종료일</label>
                <input
                  type="date"
                  className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); setActiveDatePreset(null); }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-text-secondary">초기 자본 (원)</label>
              <input
                type="number"
                className="bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
                value={capital}
                onChange={(e) => setCapital(Number(e.target.value))}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">손절 (%)</label>
                <input
                  type="number"
                  placeholder="없음"
                  className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value ? Number(e.target.value) : "")}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">익절 (%)</label>
                <input
                  type="number"
                  placeholder="없음"
                  className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value ? Number(e.target.value) : "")}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">투자비중 (%)</label>
                <input
                  type="number"
                  min={10}
                  max={100}
                  className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  value={positionSize}
                  onChange={(e) => setPositionSize(Number(e.target.value))}
                />
              </div>
            </div>

            {pageTab === "universe" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-text-secondary">순위 기준</label>
                  <select
                    className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none"
                    value={rankBy}
                    onChange={(e) => setRankBy(e.target.value)}
                  >
                    {RANK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-text-secondary">상위 N개</label>
                  <input
                    type="number"
                    min={5}
                    max={50}
                    className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none"
                    value={topN}
                    onChange={(e) => setTopN(Number(e.target.value))}
                  />
                </div>
              </div>
            )}
          </Card>

          {/* 조건 빌더 */}
          <Card className="flex flex-col gap-5">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">진입 / 청산 조건</p>
            <ConditionBuilder label="진입 조건" color="blue" group={entryConditions} onChange={setEntryConditions} />
            <div className="border-t border-border" />
            <ConditionBuilder label="청산 조건" color="red" group={exitConditions} onChange={setExitConditions} />
          </Card>

          {/* 실행 버튼 */}
          <div className="flex gap-2">
            {pageTab === "single" ? (
              <Button className="flex-1 py-3" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
                <Play size={14} className="inline mr-1.5" />
                {runMutation.isPending ? "실행 중..." : "백테스트 실행"}
              </Button>
            ) : (
              <Button className="flex-1 py-3" onClick={() => universeMutation.mutate()} disabled={universeMutation.isPending}>
                <Globe size={14} className="inline mr-1.5" />
                {universeMutation.isPending ? "분석 중... (수분 소요)" : "유니버스 백테스트"}
              </Button>
            )}
            {isLoggedIn && (
              <Button variant="secondary" onClick={() => setShowSave(!showSave)}>
                <Save size={14} />
              </Button>
            )}
          </div>

          {/* 전략 저장 */}
          {isLoggedIn && showSave && (
            <Card className="flex flex-col gap-2 p-3">
              <p className="text-[11px] font-semibold text-text-secondary">전략 저장</p>
              <div className="flex gap-1.5">
                <input
                  className="flex-1 bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  placeholder="전략 이름"
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                />
                <Button size="sm" onClick={() => strategyName && saveStrategyMutation.mutate()}>저장</Button>
              </div>
            </Card>
          )}
        </div>

        {/* ── 결과 패널 ────────────────────────────────────── */}
        <div className="xl:col-span-2 flex flex-col gap-4">
          {/* 단일 종목 결과 */}
          {pageTab === "single" && (
            runMutation.isPending ? (
              <Card><LoadingSpinner /></Card>
            ) : result ? (
              <>
                {/* KPI 카드 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <MetricCard label="총 수익률" value={<ChangeBadge value={result.total_return} className="text-xl" />} />
                  <MetricCard label="연환산" value={<ChangeBadge value={result.annual_return} className="text-xl" />} />
                  <MetricCard label="MDD" value={`-${result.mdd?.toFixed(1)}%`} color="text-accent-red" />
                  <MetricCard
                    label="샤프 비율"
                    value={result.sharpe_ratio?.toFixed(2)}
                    color={result.sharpe_ratio > 1 ? "text-accent-green" : "text-text-primary"}
                  />
                  <MetricCard
                    label="승률"
                    value={`${result.win_rate?.toFixed(1)}%`}
                    color={result.win_rate >= 50 ? "text-accent-green" : "text-accent-red"}
                  />
                  <MetricCard label="총 거래수" value={result.total_trades} />
                  <MetricCard label="평균 수익" value={`+${result.avg_profit?.toFixed(1)}%`} color="text-accent-green" />
                  <MetricCard
                    label="수익비율 (PF)"
                    value={result.profit_factor?.toFixed(2)}
                    color={result.profit_factor > 1.5 ? "text-accent-green" : "text-text-primary"}
                    sub="PF > 1.5 우수"
                  />
                </div>

                {/* 수익 곡선 */}
                <Card className="p-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <span className="text-sm font-semibold text-text-primary">수익 곡선</span>
                    <span className="text-text-muted text-xs ml-2">초기자본 {formatNumber(capital)}원</span>
                  </div>
                  <div className="p-4">
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={result.equity_curve}>
                        <defs>
                          <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2d3352" />
                        <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} tickFormatter={(v) => formatNumber(v)} width={70} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e2235", border: "1px solid #2d3352", borderRadius: "10px", fontSize: 12 }}
                          formatter={(v: number) => [formatNumber(v) + "원", "포트폴리오"]}
                        />
                        <ReferenceLine y={capital} stroke="#64748b" strokeDasharray="4 4" />
                        <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="url(#grad)" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* 거래 내역 */}
                <Card className="p-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <span className="text-sm font-semibold text-text-primary">거래 내역</span>
                    <span className="text-text-muted text-xs">{result.trades?.length}건</span>
                  </div>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-bg-secondary border-b border-border">
                        <tr className="text-text-muted">
                          <th className="text-left px-4 py-2">유형</th>
                          <th className="text-right px-4 py-2">진입일</th>
                          <th className="text-right px-4 py-2">청산일</th>
                          <th className="text-right px-4 py-2">진입가</th>
                          <th className="text-right px-4 py-2">청산가</th>
                          <th className="text-right px-4 py-2">수익률</th>
                          <th className="text-right px-4 py-2">수량</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.trades?.map((t: any, i: number) => (
                          <tr key={i} className="border-b border-border/30 hover:bg-bg-hover">
                            <td className="px-4 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                t.type === "손절" ? "bg-red-900/40 text-accent-red" :
                                t.type === "익절" ? "bg-green-900/40 text-accent-green" :
                                "bg-bg-hover text-text-secondary"
                              }`}>{t.type}</span>
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-text-secondary">{t.entry_date}</td>
                            <td className="px-4 py-2 text-right font-mono text-text-secondary">{t.exit_date}</td>
                            <td className="px-4 py-2 text-right font-mono">{t.entry_price.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right font-mono">{t.exit_price.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right"><ChangeBadge value={t.pnl_rate} /></td>
                            <td className="px-4 py-2 text-right font-mono text-text-secondary">{t.shares.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            ) : (
              <Card>
                <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
                  <BarChart2 size={36} className="text-text-muted/40" />
                  <div>
                    <p className="text-text-secondary font-medium">진입·청산 조건을 설정하고 백테스트를 실행하세요</p>
                    <p className="text-text-muted text-xs mt-1">15개 이상의 기술적 지표를 지원합니다</p>
                  </div>
                </div>
              </Card>
            )
          )}

          {/* 유니버스 결과 */}
          {pageTab === "universe" && (
            universeMutation.isPending ? (
              <Card>
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <div className="w-10 h-10 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
                  <p className="text-text-secondary text-sm">전체 종목 분석 중... 수분 소요될 수 있습니다</p>
                </div>
              </Card>
            ) : universeResult ? (
              <Card className="p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award size={15} className="text-accent-yellow" />
                    <span className="text-sm font-semibold text-text-primary">유니버스 백테스트 결과</span>
                  </div>
                  <span className="text-text-muted text-xs">
                    {universeResult.tested}/{universeResult.total_symbols}종목 분석 완료
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-bg-secondary border-b border-border">
                      <tr className="text-text-muted">
                        <th className="text-left px-4 py-2.5">순위</th>
                        <th className="text-left px-4 py-2.5">종목</th>
                        <th className="text-right px-4 py-2.5">총수익률</th>
                        <th className="text-right px-4 py-2.5">연환산</th>
                        <th className="text-right px-4 py-2.5">MDD</th>
                        <th className="text-right px-4 py-2.5">샤프</th>
                        <th className="text-right px-4 py-2.5">승률</th>
                        <th className="text-right px-4 py-2.5">거래수</th>
                        <th className="text-right px-4 py-2.5">PF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {universeResult.results?.map((r: any, i: number) => (
                        <tr key={r.symbol} className="border-b border-border/30 hover:bg-bg-hover">
                          <td className="px-4 py-2.5">
                            <span className={`font-bold ${i === 0 ? "text-accent-yellow" : i < 3 ? "text-accent-blue" : "text-text-muted"}`}>
                              #{i + 1}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="font-mono font-semibold text-text-primary">{r.symbol}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right"><ChangeBadge value={r.total_return ?? 0} /></td>
                          <td className="px-4 py-2.5 text-right"><ChangeBadge value={r.annual_return ?? 0} /></td>
                          <td className="px-4 py-2.5 text-right font-mono text-accent-red">-{r.mdd?.toFixed(1)}%</td>
                          <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{r.sharpe_ratio?.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{r.win_rate?.toFixed(1)}%</td>
                          <td className="px-4 py-2.5 text-right font-mono text-text-muted">{r.total_trades}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{r.profit_factor?.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : (
              <Card>
                <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
                  <Globe size={36} className="text-text-muted/40" />
                  <div>
                    <p className="text-text-secondary font-medium">유니버스 전체에 전략을 적용합니다</p>
                    <p className="text-text-muted text-xs mt-1">S&P 500 전체 종목에 조건을 실행하고 성과 순위를 확인합니다</p>
                  </div>
                </div>
              </Card>
            )
          )}

          {/* 전략 저장소 탭 */}
          {pageTab === "strategies" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {!isLoggedIn ? (
                <Card className="col-span-2 flex flex-col items-center gap-3 py-10">
                  <LogIn size={28} className="text-text-muted" />
                  <p className="text-text-muted text-sm">전략을 저장하려면 로그인이 필요합니다</p>
                  <a href="/login" className="text-xs text-accent-blue hover:underline">로그인하기</a>
                </Card>
              ) : !strategies?.length ? (
                <Card className="col-span-2">
                  <p className="text-center text-text-muted text-sm py-8">저장된 전략이 없습니다</p>
                </Card>
              ) : strategies.map((s: any) => (
                <Card key={s.id} className="flex flex-col gap-3 cursor-pointer" onClick={() => loadStrategy(s)}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-text-primary text-sm">{s.name}</p>
                      <p className="text-[11px] text-text-muted mt-0.5">v{s.version} · {s.market} · {s.created_at?.slice(0, 10)}</p>
                    </div>
                    <TrendingUp size={15} className="text-text-muted" />
                  </div>
                  {s.description && <p className="text-xs text-text-secondary">{s.description}</p>}
                  <div className="flex gap-1.5 flex-wrap">
                    {s.stop_loss   && <Badge variant="red">손절 {s.stop_loss}%</Badge>}
                    {s.take_profit && <Badge variant="green">익절 {s.take_profit}%</Badge>}
                    <Badge>진입 {s.entry_conditions?.conditions?.length ?? 0}조건</Badge>
                    <Badge>청산 {s.exit_conditions?.conditions?.length ?? 0}조건</Badge>
                  </div>
                  <div className="text-[11px] text-accent-blue">클릭하여 로드</div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
