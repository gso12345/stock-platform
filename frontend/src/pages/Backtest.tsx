import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backtestApi } from "@/api/stocks";
import { Card, ChangeBadge, formatNumber, Tabs, Button, Badge, ConfirmDialog, LoadingSpinner, 고른칩, 지움단추, 빈화면, 못불러옴} from "@/components/ui";
import { ConditionBuilder } from "@/components/backtest/ConditionBuilder";
import 차트틀 from "@/components/chart/ChartFrame";
import type { ConditionGroup, Market } from "@/types";
import { Save, Play, Globe, TrendingUp, BarChart2, Award, LogIn, FlaskConical } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { 읽을수있는오류 } from "@/utils/errors";
import 자산배분탭 from "@/components/backtest/AllocationTab";
import { 주기표 } from "@/components/backtest/AllocationForm";

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

/**
 * 못 잰 값을 '—' 로 적는다.
 *
 * 서버는 **잴 수 없는 것**을 null 로 준다 — 거래가 없으면 승률,
 * 손실이 없으면 손익비, 1년이 안 되면 연환산. 예전에는 이것들을 전부
 * 0 으로 냈고 화면은 '승률 0%' 를 그렸는데, 그건 '다 졌다' 로 읽힌다.
 * 못 잰 것과 나쁜 것은 완전히 다른 말이다.
 *
 * 물음표 접근자(`v?.toFixed()`)만 쓰면 undefined 가 문자열에 섞여
 * '승률 undefined%' 가 찍힌다 — 그래서 한 자리에서 다룬다.
 */
function 숫자(v: number | null | undefined, 자리 = 1, 앞 = "", 뒤 = ""): React.ReactNode {
  if (v == null || !Number.isFinite(v)) return <span className="text-text-dim">—</span>;
  return `${앞}${v.toFixed(자리)}${뒤}`;
}

function MetricCard({ label, value, sub, color }: {
  label: string; value: React.ReactNode; sub?: string; color?: string;
}) {
  return (
    <Card className="flex flex-col gap-1 py-3 text-center">
      <div className="text-xs text-text-muted font-medium uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-mono font-bold ${color ?? "text-text-primary"}`}>{value}</div>
      {sub && <div className="text-xs text-text-muted">{sub}</div>}
    </Card>
  );
}

/* 백테스트 결과가 뜰 자리 — 지표 카드 8개와 그래프 */
function BacktestSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-bg-card border border-border rounded-xl p-3 animate-pulse flex flex-col gap-2">
            <div className="h-2.5 w-16 rounded bg-bg-elevated" />
            <div className="h-5 w-20 rounded bg-bg-elevated" />
          </div>
        ))}
      </div>
      <div className="bg-bg-card border border-border rounded-xl p-4 animate-pulse">
        <div className="h-3 w-24 rounded bg-bg-elevated mb-3" />
        <div className="h-48 rounded bg-bg-elevated" />
      </div>
      <p className="text-center text-xs text-text-muted">
        과거 데이터로 돌려보는 중입니다. 기간이 길면 몇 초 걸립니다.
      </p>
    </>
  );
}

export default function Backtest() {
  const qc = useQueryClient();
  const { isLoggedIn } = useAuthStore();
  const [pageTab, setPageTab] = useState("alloc");

  // 단일종목
  const [symbol, setSymbol] = useState("AAPL");
  const [market, setMarket] = useState<Market>("US");
  const [startDate, setStartDate] = useState("2020-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [capital, setCapital] = useState(10_000_000);
  const [stopLoss, setStopLoss] = useState<number | "">("");
  const [takeProfit, setTakeProfit] = useState<number | "">("");
  const [positionSize, setPositionSize] = useState(95);
  /* 퍼센트로 들고 있다가 그대로 보낸다 — 비율로 바꾸는 것은 서버 한 곳에서만 */
  const [costRate, setCostRate] = useState(0);
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

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: strategies } = useQuery({ queryKey: ["strategies"], queryFn: backtestApi.getStrategies });

  /* 저장해 둔 자산배분 실험도 전략 저장소에 같이 놓는다.
     저장한 것이 두 군데로 갈라져 있으면 어디에 뒀는지 기억해야 한다 —
     사용자에게는 '내가 저장한 것' 하나일 뿐이다. */
  const { data: 실험들 = [] } = useQuery({
    queryKey: ["backtest-experiments"],
    queryFn: backtestApi.getExperiments,
    enabled: isLoggedIn,
    staleTime: 300_000,
  });
  /* 전략 저장소에서 고른 실험을 자산배분 탭으로 넘긴다 */
  const [불러올실험, set불러올실험] = useState<number | null>(null);
  const [지울실험, set지울실험] = useState<{ id: number; name: string } | null>(null);

  const 실험지우기 = useMutation({
    mutationFn: (id: number) => backtestApi.deleteExperiment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backtest-experiments"] });
      set지울실험(null);
    },
    /* 실패해도 창은 닫는다. 열어 둔 채로 두면 사용자는 계속 누르게 되고,
       그때마다 같은 요청이 나간다 */
    onError: (err: any) => {
      set지울실험(null);
      setErrorMsg(읽을수있는오류(err?.response?.data?.detail, "실험을 지우지 못했어요"));
    },
  });

  const universeMarket = UNIVERSE_OPTIONS.find((o) => o.value === universe)?.market ?? "US";

  const runMutation = useMutation({
    mutationFn: () => backtestApi.run({
      symbol, market, start_date: startDate, end_date: endDate,
      initial_capital: capital, entry_conditions: entryConditions,
      exit_conditions: exitConditions,
      stop_loss: stopLoss || undefined, take_profit: takeProfit || undefined,
      /* 화면은 퍼센트(95)로 들고, 서버는 비율(0.95)로 받는다 */
      position_size: positionSize / 100,
      cost_rate: costRate,
    }),
    onSuccess: (data) => { setResult(data); setErrorMsg(null); },
    /* detail 을 그대로 넣으면 안 된다. FastAPI 422 는 detail 이 **객체
       배열**이라, React 자식으로 들어가는 순간 화면이 통째로 죽는다.
       값을 잘못 넣어서 나는 오류인데 그 안내를 띄우려다 페이지가
       사라지는 셈이다 — 종목상세에서 이미 같은 것을 고쳤다. */
    onError: (err: any) => setErrorMsg(읽을수있는오류(err?.response?.data?.detail,
      "백테스트 실행에 실패했어요. 잠시 후 다시 시도해주세요")),
  });

  const universeMutation = useMutation({
    mutationFn: () => backtestApi.runUniverse({
      universe, market: universeMarket,
      start_date: startDate, end_date: endDate,
      initial_capital: capital, entry_conditions: entryConditions,
      exit_conditions: exitConditions, stop_loss: stopLoss || null,
      take_profit: takeProfit || null, position_size: positionSize / 100,
      cost_rate: costRate,
      rank_by: rankBy, top_n: topN,
    }),
    onSuccess: (data) => { setUniverseResult(data); setErrorMsg(null); },
    onError: (err: any) => setErrorMsg(읽을수있는오류(err?.response?.data?.detail,
      "유니버스 백테스트 실행에 실패했어요. 잠시 후 다시 시도해주세요")),
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

  /* '자산배분' 을 맨 앞에 둔다.
     보통 사람이 실제로 하는 투자가 이쪽이다 — 여러 자산을 비중대로 담고
     매달 넣고 가끔 비중을 맞추는 것. 뒤의 셋은 매매 신호를 시험하는
     것이라 훨씬 좁은 쓰임이다. */
  const PAGE_TABS = [
    { id: "alloc",      label: "자산배분" },
    { id: "single",     label: "단일 종목" },
    { id: "universe",   label: "유니버스 전체" },
    { id: "strategies", label: "전략 저장소" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* flex-wrap 이 없으면 폰에서 제목이 한 글자씩 세로로 쪼개진다.
          탭 줄은 안 줄어드는데 제목 칸만 줄어들어서, 390px 에서
          '백/테/스/트' 가 된다(실제로 그렇게 찍혔다). 대시보드가
          같은 이유로 이미 flex-wrap gap-3 을 쓰고 있어 그대로 맞춘다. */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">백테스트</h1>
          <p className="text-text-muted text-xs mt-0.5">진입·청산 조건을 설정하고 과거 데이터로 전략을 검증합니다</p>
        </div>
        <Tabs tabs={PAGE_TABS} active={pageTab} onChange={setPageTab}
              ariaLabel="백테스트 종류" idPrefix="bt" />
      </div>

      {/* 탭과 **내용**을 이어 준다.

          role="tab" 만 있고 내용 쪽에 아무 표시가 없으면, 화면을 소리로
          듣는 사람은 탭을 눌렀을 때 무엇이 바뀌었는지 알 수 없다.

          칸을 탭마다 따로 두지 않고 **하나로** 둔다. 이 화면은 탭에 따라
          같은 자리의 내용이 통째로 바뀌는 구조라, 칸을 넷으로 쪼개면
          안 보이는 칸 셋이 늘 문서에 남는다. 지금 켜진 탭을 가리키게만
          해 두면 바뀔 때마다 제대로 읽힌다. */}
      <div role="tabpanel" id="bt-panel" aria-labelledby={`bt-tab-${pageTab}`}
           className="flex flex-col gap-5">

      {/* ── 자산배분 ──
          아래 신호 백테스트와 **다른 화면**이다. 한 화면에 섞으면
          '진입 조건' 과 '리밸런싱 주기' 가 나란히 놓여서, 둘 중 무엇을
          하는 중인지 알 수 없게 된다. 갈라 둔다. */}
      {pageTab === "alloc" && (
        <자산배분탭 불러올실험={불러올실험} 불러옴={() => set불러올실험(null)} />
      )}

      {pageTab !== "alloc" && (
      <>
      {/* ── 공통 설정 패널 ──────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-1 flex flex-col gap-3">
          {/* 기본 설정 */}
          <Card className="flex flex-col gap-4">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">기본 설정</p>

            {pageTab === "single" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-text-secondary">시장</label>
                  <div className="flex gap-1">
                    {(["US", "KR"] as Market[]).map((m) => (
                      <고른칩 key={m} 고름={market === m} className="flex-1"
                              onClick={() => setMarket(m)}>{m}</고른칩>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-text-secondary">종목코드</label>
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
                <label className="text-xs font-medium text-text-secondary">유니버스 선택</label>
                <div className="grid grid-cols-1 gap-1.5">
                  {UNIVERSE_OPTIONS.map((u) => (
                    <고른칩 key={u.value} 고름={universe === u.value}
                            className="flex items-center gap-2 text-left"
                            onClick={() => setUniverse(u.value)}>
                      <Globe size={13} className={universe === u.value ? "text-accent-blue" : "text-text-muted"} />
                      {u.label}
                    </고른칩>
                  ))}
                </div>
              </div>
            )}

            {/* 날짜 프리셋 */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-text-secondary">기간 프리셋</label>
              <div className="flex gap-1">
                {DATE_PRESETS.map((p) => (
                  <고른칩 key={p.label} 고름={activeDatePreset === p.label}
                          className="flex-1" onClick={() => applyDatePreset(p)}>
                    {p.label}
                  </고른칩>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-secondary">시작일</label>
                <input
                  type="date"
                  className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setActiveDatePreset(null); }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-secondary">종료일</label>
                <input
                  type="date"
                  className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); setActiveDatePreset(null); }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary">초기 자본 (원)</label>
              <input
                type="number"
                className="bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
                value={capital}
                onChange={(e) => setCapital(Number(e.target.value))}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-secondary">손절 (%)</label>
                <input
                  type="number"
                  placeholder="없음"
                  className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value ? Number(e.target.value) : "")}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-secondary">익절 (%)</label>
                <input
                  type="number"
                  placeholder="없음"
                  className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value ? Number(e.target.value) : "")}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-secondary">투자비중 (%)</label>
                <input
                  type="number"
                  min={10}
                  max={100}
                  className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  value={positionSize}
                  onChange={(e) => setPositionSize(Number(e.target.value))}
                />
              </div>
              {/* 거래비용 — 자산배분 탭에는 있었는데 여기만 없었다.
                  **같은 화면의 두 탭이 다른 기준으로 계산**하고 있었던
                  셈이라, 나란히 놓고 보면 신호 쪽이 무조건 좋아 보였다.
                  신호 매매는 사고파는 횟수가 훨씬 많아 영향도 더 크다. */}
              <div className="flex flex-col gap-1">
                <label htmlFor="bt-cost-single" className="text-xs font-medium text-text-secondary">
                  거래비용 (%)
                </label>
                <input
                  id="bt-cost-single"
                  type="number" min={0} max={5} step={0.01} inputMode="decimal"
                  placeholder="0"
                  className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  value={costRate === 0 ? "" : costRate}
                  onChange={(e) => setCostRate(e.target.value === "" ? 0 : Number(e.target.value))}
                />
              </div>
            </div>

            {pageTab === "universe" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-text-secondary">순위 기준</label>
                  <select
                    className="bg-bg-primary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none"
                    value={rankBy}
                    onChange={(e) => setRankBy(e.target.value)}
                  >
                    {RANK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-text-secondary">상위 N개</label>
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
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">진입 / 청산 조건</p>
            <ConditionBuilder label="진입 조건" color="blue" group={entryConditions} onChange={setEntryConditions} />
            <div className="border-t border-border" />
            <ConditionBuilder label="청산 조건" color="red" group={exitConditions} onChange={setExitConditions} />
          </Card>

          {/* 실행 버튼 */}
          <div className="flex gap-2">
            {pageTab === "single" ? (
              <Button className="flex-1 py-3" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
                <Play size={14} className="inline mr-1.5" />
                {runMutation.isPending ? "실행 중…" : "백테스트 실행"}
              </Button>
            ) : (
              <Button className="flex-1 py-3" onClick={() => universeMutation.mutate()} disabled={universeMutation.isPending}>
                <Globe size={14} className="inline mr-1.5" />
                {universeMutation.isPending ? "분석 중… (수분 소요)" : "유니버스 백테스트"}
              </Button>
            )}
            {isLoggedIn && (
              <Button variant="secondary" onClick={() => setShowSave(!showSave)}>
                <Save size={14} />
              </Button>
            )}
          </div>

          {errorMsg && (
            <p className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/30 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}

          {/* 전략 저장 */}
          {isLoggedIn && showSave && (
            <Card className="flex flex-col gap-2 p-3">
              <p className="text-xs font-semibold text-text-secondary">전략 저장</p>
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
              /* 백테스트는 몇 초씩 걸린다. 동그라미만 돌면 얼마나 걸릴지
                 가늠이 안 돼서, 사람이 멈춘 줄 알고 다시 누른다 */
              <BacktestSkeleton />
            ) : runMutation.isError ? (
              <Card><못불러옴 사유={runMutation.error} 다시={() => runMutation.mutate()} /></Card>
            ) : result ? (
              <>
                {/* KPI 카드 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {/* 서버가 **못 잰 값은 null** 로 준다. 0 이 아니다.
                      · 거래가 한 건도 없으면 승률·평균수익은 잴 수가 없다
                      · 손실이 하나도 없으면 손익비는 무한대다
                      · 1년이 안 되는 기간은 연으로 늘리지 않는다
                      예전에는 이것들을 전부 0 으로 냈고, 화면은 '승률 0%' 를
                      그렸다 — '다 졌다' 로 읽힌다. 못 잰 것은 '—' 로 적는다.
                      (물음표 접근자만 쓰면 'undefined%' 가 찍힌다) */}
                  <MetricCard label="총 수익률" value={<ChangeBadge value={result.total_return ?? 0} className="text-xl" />} />
                  <MetricCard label="연환산"
                    value={result.annual_return == null
                      ? <span className="text-text-dim">—</span>
                      : <ChangeBadge value={result.annual_return} className="text-xl" />}
                    sub={result.annual_return == null && result.years != null
                      ? `${result.years}년치라 연환산 안 함` : undefined} />
                  <MetricCard label="MDD" value={숫자(result.mdd, 1, "-", "%")} color="text-accent-red" />
                  <MetricCard
                    label="샤프 비율"
                    value={숫자(result.sharpe_ratio, 2)}
                    color={(result.sharpe_ratio ?? 0) > 1 ? "text-accent-green" : "text-text-primary"}
                  />
                  <MetricCard
                    label="승률"
                    value={숫자(result.win_rate, 1, "", "%")}
                    color={result.win_rate == null ? "text-text-dim"
                      : result.win_rate >= 50 ? "text-accent-green" : "text-accent-red"}
                  />
                  <MetricCard label="총 거래수" value={result.total_trades ?? 0} />
                  <MetricCard label="평균 수익" value={숫자(result.avg_profit, 1, "+", "%")}
                    color={result.avg_profit == null ? "text-text-dim" : "text-accent-green"} />
                  <MetricCard
                    label="수익비율 (PF)"
                    value={숫자(result.profit_factor, 2)}
                    color={(result.profit_factor ?? 0) > 1.5 ? "text-accent-green" : "text-text-primary"}
                    sub={result.profit_factor == null && (result.total_trades ?? 0) > 0
                      ? "손실 거래 없음" : "PF > 1.5 우수"}
                  />
                </div>

                {/* ── 그냥 들고 있었으면 ──
                    '연 12%' 만 보면 잘한 것인지 알 수 없다. 같은 기간 그
                    종목을 그냥 사서 들고만 있어도 15% 였다면, 그 전략은
                    사고파느라 3%를 버린 것이다. 신호 백테스트에서 제일
                    먼저 물어야 할 질문인데 답이 없었다.

                    색은 **내 값**에 칠한다 — '내 숫자가 초록이면 내가
                    나음' 이 설명 없이도 읽힌다. */}
                {result.buy_and_hold && (
                  <Card className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <span className="text-base font-semibold text-text-primary">
                        그냥 사서 들고 있었으면
                      </span>
                      <span className="text-2xs text-text-dim">같은 기간 · 같은 수수료</span>
                    </div>
                    <div className="grid grid-cols-[1fr_1fr_1fr] gap-x-2 gap-y-1.5 items-baseline">
                      <span className="text-2xs text-text-dim" />
                      <span className="text-2xs text-text-muted font-medium text-right">내 전략</span>
                      <span className="text-2xs text-text-dim text-right">들고 있기</span>
                      {([
                        ["총 수익률", 숫자(result.total_return, 1, "", "%"),
                         숫자(result.buy_and_hold.total_return, 1, "", "%"),
                         (result.total_return ?? 0) - (result.buy_and_hold.total_return ?? 0)],
                        ["연환산", 숫자(result.annual_return, 1, "", "%"),
                         숫자(result.buy_and_hold.annual_return, 1, "", "%"),
                         (result.annual_return ?? 0) - (result.buy_and_hold.annual_return ?? 0)],
                        /* 낙폭만 작을수록 좋다 — 부호를 뒤집어야 '내가 나음'
                           이 맞는다. 안 뒤집으면 더 크게 물린 쪽이 초록이 된다 */
                        ["최대 낙폭", 숫자(result.mdd, 1, "-", "%"),
                         숫자(result.buy_and_hold.mdd, 1, "-", "%"),
                         (result.buy_and_hold.mdd ?? 0) - (result.mdd ?? 0)],
                      ] as [string, React.ReactNode, React.ReactNode, number][]).map(([이름, 내것, 저것, 차]) => (
                        <Fragment key={이름}>
                          <span className="text-xs text-text-muted">{이름}</span>
                          <span className={`text-xs font-mono tabular-nums text-right font-semibold ${차 >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                            {내것}
                          </span>
                          <span className="text-xs font-mono tabular-nums text-right text-text-dim">{저것}</span>
                        </Fragment>
                      ))}
                    </div>
                    <p className="text-2xs text-text-dim break-keep">
                      내 숫자가 초록이면 그 항목은 사고파는 쪽이 나아요.
                      빨강이면 그냥 들고 있는 편이 나았다는 뜻이에요.
                    </p>
                  </Card>
                )}

                {/* 수익 곡선 */}
                <Card className="p-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <span className="text-sm font-semibold text-text-primary">수익 곡선</span>
                    <span className="text-text-muted text-xs ml-2">초기자본 {formatNumber(capital)}원</span>
                  </div>
                  <div className="p-4">
                    <차트틀 height={280}>
                      {/* 색을 **테마 변수**로 쓴다.

                          예전에는 #3b82f6 · #1e2235 처럼 직접 적어 뒀다.
                          이 앱에는 밝은 테마(html.light)가 있는데, 직접
                          적은 색은 테마를 안 따라간다 — 하얀 배경에
                          **어두운 말풍선**이 뜨고 격자선이 시커멓게 남는다.

                          그리고 var(--accent-blue) 는 지금까지 **빈 값**
                          이었다. 그 변수가 아예 정의돼 있지 않았다(브라우저
                          에서 확인했다). 정의 안 된 변수를 쓰면 오류도
                          경고도 없이 색만 사라진다 — index.css 에 넣었다. */}
                      {(R) => (
                        <R.AreaChart data={result.equity_curve}>
                          <defs>
                            <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="var(--accent-blue)" stopOpacity={0.25} />
                              <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <R.CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                          <R.XAxis dataKey="date" tick={{ fill: "var(--text-muted)", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                          <R.YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} tickLine={false} tickFormatter={(v) => formatNumber(v)} width={70} />
                          <R.Tooltip
                            contentStyle={{
                              backgroundColor: "var(--bg-elevated)",
                              border: "1px solid var(--border-light)",
                              borderRadius: "10px", fontSize: 12,
                              /* 배경만 바꾸면 밝은 테마에서 흰 바탕에 흰 글씨가 된다 */
                              color: "var(--text-primary)",
                            }}
                            labelStyle={{ color: "var(--text-muted)" }}
                            formatter={(v: number) => [formatNumber(v) + "원", "포트폴리오"]}
                          />
                          <R.ReferenceLine y={capital} stroke="var(--text-muted)" strokeDasharray="4 4" />
                          <R.Area type="monotone" dataKey="value" stroke="var(--accent-blue)" fill="url(#grad)" strokeWidth={2} dot={false} />
                        </R.AreaChart>
                      )}
                    </차트틀>
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
                              <span className={`px-1.5 py-0.5 rounded text-2xs font-semibold ${
                                t.type === "손절" ? "bg-accent-red/15 text-accent-red" :
                                t.type === "익절" ? "bg-accent-green/15 text-accent-green" :
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

          {/* 유니버스 결과 —
              기다리는 동안은 손으로 만든 뱅글뱅글 대신 공용 부품을 쓴다.
              같은 '기다리는 중' 인데 이 화면에만 네 가지가 있었다 —
              골격(단일 종목) · 이 원 · 진행률 막대(자산배분) ·
              그리고 만들어 놓고 안 쓰던 공용 LoadingSpinner. */}
          {pageTab === "universe" && (
            universeMutation.isPending ? (
              <Card>
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <LoadingSpinner size="lg" />
                  <p className="text-text-secondary text-sm">전체 종목 분석 중… 수분 소요될 수 있습니다</p>
                </div>
              </Card>
            ) : universeResult ? (
              <Card className="p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award size={14} className="text-accent-yellow" />
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
                          <td className="px-4 py-2.5 text-right">
                            {r.annual_return == null
                              ? <span className="text-text-dim">—</span>
                              : <ChangeBadge value={r.annual_return} />}
                          </td>
                          {/* 이 두 칸만 물음표 접근자를 쓰고 있었다.
                              낙폭은 못 잰 값일 때 '-%' 라는 빈 껍데기가,
                              샤프는 아예 빈 칸이 찍혔다 — 옆 칸들은 같은
                              상황에서 '—' 를 그린다. 한 표 안에서 세 가지
                              방식이 섞여 있었다. */}
                          <td className="px-4 py-2.5 text-right font-mono text-accent-red">{숫자(r.mdd, 1, "-", "%")}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{숫자(r.sharpe_ratio, 2)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{숫자(r.win_rate, 1, "", "%")}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-text-muted">{r.total_trades}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-text-secondary">{숫자(r.profit_factor, 2)}</td>
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
              ) : !strategies?.length && !실험들.length ? (
                <Card className="col-span-2">
                  <빈화면
                    compact
                    icon={FlaskConical}
                    title="저장된 전략이 없어요"
                    hint="조건을 만들고 '전략 저장'을, 자산배분은 '저장'을 누르면 여기에 쌓입니다."
                  />
                </Card>
              ) : null}

              {/* ── 자산배분 실험 ──
                  매매 신호 전략과 **다른 종류**라 배지로 갈라 둔다.
                  섞어 놓고 이름만 보면 어느 탭에서 열리는 것인지
                  알 수 없어서, 눌러 보고 나서야 알게 된다. */}
              {isLoggedIn && 실험들.map((x) => (
                <Card key={`exp-${x.id}`} className="flex flex-col gap-3 cursor-pointer"
                      ariaLabel={`${x.name} 자산배분 실험 열기`}
                      onClick={() => { set불러올실험(x.id); setPageTab("alloc"); }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-text-primary text-sm truncate">{x.name}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {x.start_date} ~ {x.end_date} · {x.currency}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Badge variant="blue">자산배분</Badge>
                      {/* 지우기는 여기에만 있다 — 자산배분 탭의 목록을
                          없앴으므로 이 자리가 유일하다.
                          카드 전체가 '열기' 버튼이라 안쪽 버튼은 클릭이
                          위로 안 번지게 막아야 한다. 안 막으면 지우려다
                          탭이 열린다. */}
                      <지움단추
                        ariaLabel={`${x.name} 지우기`}
                        onClick={(e) => { e.stopPropagation(); set지울실험({ id: x.id, name: x.name }); }}
                      />
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <Badge>자산 {x.assets.length}개</Badge>
                    {x.rebalance_period !== "none" && (
                      <Badge>리밸런싱 {주기표.find((p) => p.value === x.rebalance_period)?.label}</Badge>
                    )}
                    {x.contribution_period !== "none" && <Badge variant="green">적립식</Badge>}
                    {!!x.cost_rate && <Badge variant="red">수수료 {x.cost_rate}%</Badge>}
                  </div>
                  <div className="text-xs text-accent-blue">클릭하여 자산배분 탭에서 열기</div>
                </Card>
              ))}

              {지울실험 && (
                <ConfirmDialog
                  title="실험을 지울까요?"
                  message="지우면 되돌릴 수 없어요. 자산과 비중, 기간을 처음부터 다시 맞춰야 해요."
                  대상={지울실험.name}
                  확인글="지우기"
                  진행중={실험지우기.isPending}
                  onConfirm={() => 실험지우기.mutate(지울실험.id)}
                  onClose={() => set지울실험(null)}
                />
              )}

              {(strategies ?? []).map((s: any) => (
                <Card key={s.id} className="flex flex-col gap-3 cursor-pointer" onClick={() => loadStrategy(s)}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-text-primary text-sm">{s.name}</p>
                      <p className="text-xs text-text-muted mt-0.5">v{s.version} · {s.market} · {s.created_at?.slice(0, 10)}</p>
                    </div>
                    <TrendingUp size={14} className="text-text-muted" />
                  </div>
                  {s.description && <p className="text-xs text-text-secondary">{s.description}</p>}
                  <div className="flex gap-1.5 flex-wrap">
                    {s.stop_loss   && <Badge variant="red">손절 {s.stop_loss}%</Badge>}
                    {s.take_profit && <Badge variant="green">익절 {s.take_profit}%</Badge>}
                    <Badge>진입 {s.entry_conditions?.conditions?.length ?? 0}조건</Badge>
                    <Badge>청산 {s.exit_conditions?.conditions?.length ?? 0}조건</Badge>
                  </div>
                  <div className="text-xs text-accent-blue">클릭하여 로드</div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
      </>
      )}

      </div>
    </div>
  );
}
