import { Fragment, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backtestApi } from "@/api/stocks";
import {
  Card, ChangeBadge, formatNumber, Tabs, Button, Badge, ConfirmDialog, NameDialog, LoadingSpinner, 고른칩, 지움단추,
  빈화면, 못불러옴, INPUT_CLASS, cn,
} from "@/components/ui";
import { ConditionBuilder } from "@/components/backtest/ConditionBuilder";
import 차트틀 from "@/components/chart/ChartFrame";
import { 가로축, 그래프높이, 기준점선, 끝값, 달눈금, 툴팁 } from "@/utils/chartTheme";
import type { ConditionGroup, Market } from "@/types";
import { Globe, TrendingUp, BarChart2, Award, LogIn, FlaskConical } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { usePnlColors } from "@/hooks/usePnlColors";
import { use넓은화면 } from "@/hooks/useWideScreen";
import { 읽을수있는오류, 요청실패말 } from "@/utils/errors";
import 자산배분탭, { 설정판배치 } from "@/components/backtest/AllocationTab";
import 실험비교 from "@/components/backtest/ExperimentCompare";
import { 주기표, 칸제목, 기간에서날짜 } from "@/components/backtest/AllocationForm";
import { 칸 as 지표칸, 눈금글, 그래프범례 } from "@/components/backtest/AllocationResult";
import { 표머리, 표머리줄, 표머리칸, 표줄, 표칸, 표글자 } from "@/components/common/StockTable";

const DEFAULT_ENTRY: ConditionGroup = {
  logic: "AND",
  conditions: [{ indicator: "MA", operator: "crosses_above", value: "EMA", period: 20 }],
};
const DEFAULT_EXIT: ConditionGroup = {
  logic: "OR",
  conditions: [{ indicator: "RSI", operator: ">", value: 70, period: 14 }],
};

/* 이름을 **정확히** 적는다.
   'S&P 500' 이라고 쓰면 사람은 그 지수 전부를 잰 줄 아는데, 실제로는
   오늘 시총 상위로 손으로 고른 316개다. 개수와 '오늘 기준' 을 이름에
   넣어 두면 결과를 읽을 때 그 사실이 같이 보인다. */
const UNIVERSE_OPTIONS = [
  { value: "SP500",  label: "미국 대형주 (오늘 기준)", market: "US" },
  { value: "KOSPI",  label: "KOSPI 대형주 (오늘 기준)", market: "KR" },
  { value: "KOSDAQ", label: "KOSDAQ (오늘 기준)",      market: "KR" },
  { value: "ETF",    label: "글로벌 ETF",              market: "US" },
];

const RANK_OPTIONS = [
  { value: "total_return",  label: "총수익률" },
  { value: "annual_return", label: "연환산 수익률" },
  { value: "sharpe_ratio",  label: "샤프 비율" },
  { value: "win_rate",      label: "승률" },
  { value: "profit_factor", label: "수익비율" },
  { value: "mdd",           label: "MDD (낮은순)" },
];

/* 기간 단추 — 자산배분 탭과 같은 '몇 년' 단추. 예전엔 'YTD·1Y…' 를 2026-06-06 에 못 박아 두어,
   몇 달 지나니 '1Y' 가 오늘이 아니라 6월에서 끝났다. 오늘에서 거슬러 잰다 */
const 기간들 = [1, 3, 5, 10, 20];

/* 탭마다 무엇을 하는 화면인지 — 예전엔 어느 탭에서나 '진입·청산 조건을 설정하고…' 였는데,
   처음 열리는 자산배분 탭에는 진입·청산 조건이 없다 */
const 탭설명: Record<string, string> = {
  alloc: "여러 자산을 비중대로 담아 과거로 돌려 봐요 — 적립·리밸런싱까지",
  single: "진입·청산 조건을 정하고 한 종목의 과거 시세로 검증해요",
  universe: "같은 조건을 목록의 모든 종목에 돌려 성과 순위를 봐요",
  strategies: "저장한 매매 전략과 자산배분 실험을 한곳에서",
};

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

/** 요청한 날보다 **의미 있게 늦게** 시작했나.
 *
 *  그냥 `result.start_date > startDate` 로 두면 거의 매번 뜬다 —
 *  1월 1일을 요청하면 첫 거래일은 1월 2일이고, 주말·휴장이면 더
 *  밀린다. 매번 뜨는 경고는 아무도 안 읽고, 정작 종목이 2년 늦게
 *  상장해서 앞이 통째로 잘린 경우까지 같이 묻힌다.
 *
 *  달력으로 일주일을 넘게 밀렸을 때만 말한다. 연휴가 제일 긴 나라를
 *  기준으로 잡아도 일주일이면 첫 거래일이 나온다. */
export function 많이늦게시작(요청: string, 실제?: string | null): boolean {
  if (!실제) return false;
  const 밀린날 = (new Date(실제).getTime() - new Date(요청).getTime()) / 86_400_000;
  return Number.isFinite(밀린날) && 밀린날 > 7;
}

/* 백테스트 결과가 뜰 자리 — 지표 타일 8개와 그래프(자산배분 결과와 같은 모양) */
function BacktestSkeleton() {
  return (
    <>
      <div className="bg-bg-card border border-border rounded-xl p-4 animate-pulse flex flex-col gap-3">
        <div className="h-3.5 w-16 rounded bg-bg-elevated" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-bg-elevated/60 p-3 flex flex-col gap-2">
              <div className="h-2.5 w-14 rounded bg-bg-elevated" />
              <div className="h-5 w-20 rounded bg-bg-elevated" />
            </div>
          ))}
        </div>
      </div>
      <div className="bg-bg-card border border-border rounded-xl p-4 animate-pulse">
        <div className="h-3.5 w-24 rounded bg-bg-elevated mb-3" />
        <div className="h-56 rounded bg-bg-elevated" />
      </div>
      <p className="text-center text-xs text-text-muted">
        과거 데이터로 돌려보는 중입니다. 기간이 길면 몇 초 걸립니다.
      </p>
    </>
  );
}

/** 이름표가 위에 붙은 입력칸 — 자산배분 설정과 같은 모양(이름표 위, 칸 아래) */
function 입력칸({ id, 이름, className, ...칸 }: { id: string; 이름: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={id} className="text-xs text-text-muted whitespace-nowrap">{이름}</label>
      <input id={id} className={cn(INPUT_CLASS, "min-w-0", className)} {...칸} />
    </div>
  );
}

export default function Backtest() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();
  const [pageTab, setPageTab] = useState("alloc");
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor, gain, loss } = usePnlColors(배색);
  const 넓음 = use넓은화면();

  /* 전략 저장소 **메뉴**(/strategies)에서 자산배분을 누르면 여기로 온다.
     주소에 실험 번호를 실어 보내므로, 그걸 읽어 바로 열어 준다.
     안 읽으면 백테스트 첫 화면만 뜨고 무엇을 누른 것인지 사라진다. */
  const [주소파라미터, set주소파라미터] = useSearchParams();

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

  /* 전략 저장 — 자산배분 탭처럼 '저장' 을 누르면 이름을 묻는다. 로그인 전에는 단추를 그대로 두고,
     누르면 왜 안 되는지 말한다(아예 안 그리면 '저장이 어디 있지' 가 된다) */
  const [이름창, set이름창] = useState(false);
  const [로그인안내, set로그인안내] = useState(false);

  /** 지금 고른 기간 단추 — 날짜를 손으로 고치면 풀린다 */
  const [고른기간, set고른기간] = useState<number | null>(null);

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

  useEffect(() => {
    const 번호 = Number(주소파라미터.get("experiment"));
    if (!Number.isFinite(번호) || 번호 <= 0) return;
    set불러올실험(번호);
    setPageTab("alloc");
    /* 주소에서 지운다. 안 지우면 뒤로 갔다 오거나 새로고침할 때마다
       같은 실험이 다시 열려, 고치던 설정이 통째로 되돌아간다. */
    주소파라미터.delete("experiment");
    set주소파라미터(주소파라미터, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [지울실험, set지울실험] = useState<{ id: number; name: string } | null>(null);
  /* 매매 전략도 지울 수 있어야 한다 — 서버에는 지우는 길이 있는데 화면에 단추가 없어서, 한 번 저장한 전략이
     저장소에 계속 쌓였다 */
  const [지울전략, set지울전략] = useState<{ id: number; name: string } | null>(null);

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

  const 전략지우기 = useMutation({
    mutationFn: (id: number) => backtestApi.deleteStrategy(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      set지울전략(null);
    },
    onError: (err: any) => {
      set지울전략(null);
      setErrorMsg(읽을수있는오류(err?.response?.data?.detail, "전략을 지우지 못했어요"));
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
    /* **끊긴 것과 실패한 것을 가른다.** '실패했어요' 만 띄우면 서버가
       고장 난 줄 알고 떠난다 — 대개는 자던 서버가 깨는 중이라 오래
       걸렸을 뿐이고, 다시 누르면 훨씬 빠르다(utils/errors 의 요청실패말). */
    onError: (err: any) => setErrorMsg(
      요청실패말(err, "백테스트 실행에 실패했어요. 잠시 후 다시 시도해주세요")),
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
    onError: (err: any) => setErrorMsg(
      요청실패말(err, "유니버스 백테스트 실행에 실패했어요. 잠시 후 다시 시도해주세요")),
  });

  const saveStrategyMutation = useMutation({
    mutationFn: (이름: string) => backtestApi.saveStrategy({
      name: 이름, market, entry_conditions: entryConditions,
      exit_conditions: exitConditions, stop_loss: stopLoss || undefined,
      take_profit: takeProfit || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      set이름창(false);
    },
    onError: (err: any) => setErrorMsg(
      읽을수있는오류(err?.response?.data?.detail, "전략을 저장하지 못했어요")),
  });

  /* 저장한 매매 전략을 불러오면 **단일 종목 탭에서** 연다 — 저장소 탭에는 설정 칸이 없다. 시장도 같이
     되살린다(미국 전략을 국내 시장으로 돌리면 종목이 안 맞는다) */
  const loadStrategy = (s: any) => {
    setEntryConditions(s.entry_conditions);
    setExitConditions(s.exit_conditions);
    if (s.stop_loss) setStopLoss(s.stop_loss);
    if (s.take_profit) setTakeProfit(s.take_profit);
    if (s.market === "US" || s.market === "KR") setMarket(s.market);
    setPageTab("single");
  };

  const 기간고르기 = (년: number) => {
    const { start_date, end_date } = 기간에서날짜(년);
    setStartDate(start_date);
    setEndDate(end_date);
    set고른기간(년);
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
  const 신호탭 = pageTab === "single" || pageTab === "universe";
  const 도는중 = pageTab === "single" ? runMutation.isPending : universeMutation.isPending;

  /* 수익 곡선 — 다른 메뉴 그래프와 같은 모양(축·툴팁·최고·최저 점선). 시작 금액에 점선 하나를 더 긋는다 */
  const 곡선끝 = 끝값((result?.equity_curve ?? []).map((x: any) => x.value));

  return (
    <div className="flex flex-col gap-5">
      {/* flex-wrap 이 없으면 폰에서 제목이 한 글자씩 세로로 쪼개진다.
          탭 줄은 안 줄어드는데 제목 칸만 줄어들어서, 390px 에서
          '백/테/스/트' 가 된다(실제로 그렇게 찍혔다). 대시보드가
          같은 이유로 이미 flex-wrap gap-3 을 쓰고 있어 그대로 맞춘다. */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">백테스트</h1>
          <p className="text-text-muted text-xs mt-0.5">{탭설명[pageTab]}</p>
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

      {신호탭 && (
      <div className={설정판배치}>
        {/* ── 설정 ── 자산배분 탭의 '신규 테스트' 와 같은 모양: 한 장의 카드, 칸마다 제목, 맨 아래 저장·실행 */}
        <Card className="flex flex-col gap-5 min-w-0">
          <h2 className="text-xl font-bold text-text-primary">신규 테스트</h2>
          <div className="h-px bg-border -mx-4" />

          {pageTab === "single" ? (
            <div className="flex flex-col gap-3">
              <칸제목>테스트 종목</칸제목>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-xs text-text-muted">시장</span>
                  <div className="flex gap-1">
                    {(["US", "KR"] as Market[]).map((m) => (
                      <고른칩 key={m} 고름={market === m} className="flex-1"
                              onClick={() => setMarket(m)}>{m}</고른칩>
                    ))}
                  </div>
                </div>
                <입력칸 id="bt-symbol" 이름="종목코드" className="uppercase"
                  placeholder={market === "KR" ? "005930.KS" : "AAPL"}
                  value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <칸제목>종목 목록</칸제목>
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

          <div className="flex flex-col gap-3">
            <칸제목>테스트 기간</칸제목>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <입력칸 id="bt-single-start" 이름="시작일" type="date" value={startDate}
                onChange={(e) => { setStartDate(e.target.value); set고른기간(null); }} />
              <입력칸 id="bt-single-end" 이름="종료일" type="date" value={endDate}
                onChange={(e) => { setEndDate(e.target.value); set고른기간(null); }} />
            </div>
            <div className="flex gap-1">
              {기간들.map((년) => (
                <고른칩 key={년} 고름={고른기간 === 년} className="flex-1" onClick={() => 기간고르기(년)}>
                  {년}년
                </고른칩>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <칸제목>자금 · 매매</칸제목>
            <입력칸 id="bt-capital" 이름="초기 자본 (원)" type="number" inputMode="numeric"
              value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <입력칸 id="bt-stop" 이름="손절 (%)" type="number" placeholder="없음" value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value ? Number(e.target.value) : "")} />
              <입력칸 id="bt-take" 이름="익절 (%)" type="number" placeholder="없음" value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value ? Number(e.target.value) : "")} />
              <입력칸 id="bt-size" 이름="투자비중 (%)" type="number" min={10} max={100} value={positionSize}
                onChange={(e) => setPositionSize(Number(e.target.value))} />
              {/* 거래비용 — 자산배분 탭에는 있었는데 여기만 없었다.
                  **같은 화면의 두 탭이 다른 기준으로 계산**하고 있었던
                  셈이라, 나란히 놓고 보면 신호 쪽이 무조건 좋아 보였다.
                  신호 매매는 사고파는 횟수가 훨씬 많아 영향도 더 크다. */}
              <입력칸 id="bt-cost-single" 이름="거래비용 (%)" type="number" min={0} max={5} step={0.01}
                inputMode="decimal" placeholder="0" value={costRate === 0 ? "" : costRate}
                onChange={(e) => setCostRate(e.target.value === "" ? 0 : Number(e.target.value))} />
            </div>
            {pageTab === "universe" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1 min-w-0">
                  <label htmlFor="bt-rank" className="text-xs text-text-muted">순위 기준</label>
                  <select id="bt-rank" className={INPUT_CLASS} value={rankBy} onChange={(e) => setRankBy(e.target.value)}>
                    {RANK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <입력칸 id="bt-topn" 이름="상위 N개" type="number" min={5} max={50} value={topN}
                  onChange={(e) => setTopN(Number(e.target.value))} />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <칸제목>진입 · 청산 조건</칸제목>
            <ConditionBuilder label="진입 조건" color="blue" group={entryConditions} onChange={setEntryConditions} />
            <div className="border-t border-border" />
            <ConditionBuilder label="청산 조건" color="red" group={exitConditions} onChange={setExitConditions} />
          </div>

          {errorMsg && (
            <p className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/30 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}

          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1 py-3"
                    onClick={isLoggedIn ? () => set이름창(true) : () => set로그인안내(true)}
                    disabled={saveStrategyMutation.isPending}>
              {saveStrategyMutation.isPending ? "저장 중…" : "저장"}
            </Button>
            <Button className="flex-1 py-3" disabled={도는중}
                    onClick={() => (pageTab === "single" ? runMutation.mutate() : universeMutation.mutate())}>
              {pageTab === "single"
                ? (runMutation.isPending ? "실행 중…" : "백테스트 실행")
                : (universeMutation.isPending ? "분석 중… (수분 소요)" : "유니버스 백테스트")}
            </Button>
          </div>
          {로그인안내 && !isLoggedIn && (
            <p className="text-xs text-accent-yellow/90 -mt-2 break-keep">
              전략을 저장하려면 로그인이 필요해요. 백테스트는 로그인 없이도 돼요.
            </p>
          )}
          {이름창 && (
            <NameDialog
              title="이 전략을 저장할까요?"
              설명="진입·청산 조건과 손절·익절을 저장해요. 전략 저장소에서 다시 열 수 있어요."
              첫값={`${pageTab === "single" ? symbol : universe} 전략`}
              진행중={saveStrategyMutation.isPending}
              onConfirm={(이름) => saveStrategyMutation.mutate(이름)}
              onClose={() => set이름창(false)}
            />
          )}
        </Card>

        {/* ── 결과 ── */}
        <div className="flex flex-col gap-4 min-w-0">
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
                {/* ── 성과 ── 자산배분 결과의 '위험' 카드와 같은 타일. 서버가 **못 잰 값은 null** 로 준다. 0 이 아니다.
                    · 거래가 한 건도 없으면 승률·평균수익은 잴 수가 없다
                    · 손실이 하나도 없으면 손익비는 무한대다
                    · 1년이 안 되는 기간은 연으로 늘리지 않는다
                    예전에는 이것들을 전부 0 으로 냈고, 화면은 '승률 0%' 를
                    그렸다 — '다 졌다' 로 읽힌다. 못 잰 것은 '—' 로 적는다.
                    (물음표 접근자만 쓰면 'undefined%' 가 찍힌다)

                    색은 설정의 오름·내림 색만 쓴다 — 예전엔 승률·샤프에 초록·빨강을 손으로 박아,
                    '빨강-파랑' 으로 둔 사람에게 이 화면만 거꾸로 보였다 */}
                <Card className="flex flex-col gap-3">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-base font-semibold text-text-primary">성과</span>
                    <span className="text-2xs text-text-dim">
                      {result.start_date && result.end_date ? `${result.start_date} ~ ${result.end_date}` : null}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <지표칸 이름="총 수익률" 값={<ChangeBadge value={result.total_return ?? 0} />}
                      밑={많이늦게시작(startDate, result.start_date)
                        ? `${result.start_date}부터 (시세가 그 전에는 없음)` : undefined} />
                    <지표칸 이름="연환산"
                      값={result.annual_return == null
                        ? <span className="text-text-dim">—</span>
                        : <ChangeBadge value={result.annual_return} />}
                      밑={result.annual_return == null && result.years != null
                        ? `${result.years}년치라 연환산 안 함` : undefined} />
                    <지표칸 이름="MDD" 값={숫자(result.mdd, 1, "-", "%")} 색={loss} />
                    {/* 샤프는 '무위험으로 그냥 둬도 얻었을 것' 을 뺀 수다.
                        무엇을 뺐는지 안 적으면 사람이 자기 기준으로 읽는다 —
                        금리 5% 인 해에 연 5% 를 번 전략의 샤프 0.5 는
                        실제로는 초과수익 0 이라는 뜻이다. */}
                    <지표칸 이름="샤프 비율" 값={숫자(result.sharpe_ratio, 2)}
                      밑={`무위험 ${result.risk_free_rate ?? 0}% 기준`} />
                    {/* 승률은 **수수료까지 뺀** 손익으로 센다. 가격만 보면
                        수수료를 내고 나면 손해인 거래가 '이긴 거래' 가 된다. */}
                    <지표칸 이름="승률" 값={숫자(result.win_rate, 1, "", "%")}
                      밑={result.cost_rate ? "수수료 반영" : undefined} />
                    <지표칸 이름="총 거래수" 값={String(result.total_trades ?? 0)} />
                    <지표칸 이름="평균 수익" 값={숫자(result.avg_profit, 1, "+", "%")}
                      색={result.avg_profit == null ? "text-text-dim" : pnlColor(result.avg_profit)} />
                    <지표칸 이름="수익비율 (PF)" 값={숫자(result.profit_factor, 2)}
                      밑={result.profit_factor == null && (result.total_trades ?? 0) > 0
                        ? "손실 거래 없음" : "PF > 1.5 우수"} />
                  </div>
                </Card>

                {/* ── 그냥 들고 있었으면 ──
                    '연 12%' 만 보면 잘한 것인지 알 수 없다. 같은 기간 그
                    종목을 그냥 사서 들고만 있어도 15% 였다면, 그 전략은
                    사고파느라 3%를 버린 것이다. 신호 백테스트에서 제일
                    먼저 물어야 할 질문인데 답이 없었다.

                    색은 **내 값**에 칠한다 — 오름 색이면 내 쪽이 나은 것이다(자산배분의 '견주기' 와 같다). */}
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
                           이 맞는다. 안 뒤집으면 더 크게 물린 쪽이 오름 색이 된다 */
                        ["최대 낙폭", 숫자(result.mdd, 1, "-", "%"),
                         숫자(result.buy_and_hold.mdd, 1, "-", "%"),
                         (result.buy_and_hold.mdd ?? 0) - (result.mdd ?? 0)],
                      ] as [string, React.ReactNode, React.ReactNode, number][]).map(([이름, 내것, 저것, 차]) => (
                        <Fragment key={이름}>
                          <span className="text-xs text-text-muted">{이름}</span>
                          <span className={`text-xs font-mono tabular-nums text-right font-semibold ${pnlColor(차)}`}>
                            {내것}
                          </span>
                          <span className="text-xs font-mono tabular-nums text-right text-text-dim">{저것}</span>
                        </Fragment>
                      ))}
                    </div>
                    <p className="text-2xs text-text-dim break-keep">
                      내 숫자가 오름 색이면 그 항목은 사고파는 쪽이 나아요.
                      내림 색이면 그냥 들고 있는 편이 나았다는 뜻이에요. 낙폭은 작은 쪽이 나은 거예요.
                    </p>
                  </Card>
                )}

                {/* ── 수익 곡선 ── 다른 메뉴 그래프와 같은 모양, 넓은 화면에서는 높게 */}
                <Card className="flex flex-col gap-3">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-base font-semibold text-text-primary">수익 곡선</span>
                    <span className="text-2xs text-text-dim">초기자본 {formatNumber(capital)}원</span>
                  </div>
                  <차트틀 height={그래프높이.큰[넓음 ? 1 : 0]}>
                    {/* 색을 **테마 변수**로 쓴다.

                        예전에는 #3b82f6 · #1e2235 처럼 직접 적어 뒀다.
                        이 앱에는 밝은 테마(html.light)가 있는데, 직접
                        적은 색은 테마를 안 따라간다 — 하얀 배경에
                        **어두운 말풍선**이 뜨고 격자선이 시커멓게 남는다. */}
                    {(R) => (
                      <R.AreaChart data={result.equity_curve} margin={{ top: 10, right: 4, bottom: 0, left: 4 }}>
                        <defs>
                          <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <R.XAxis dataKey="date" tickFormatter={달눈금} {...가로축} />
                        <R.YAxis hide domain={["dataMin", "dataMax"]} />
                        <R.Tooltip {...툴팁} formatter={(v: number) => [formatNumber(v) + "원", "포트폴리오"]} />
                        {곡선끝 && (
                          <>
                            <R.ReferenceLine y={곡선끝.최고} {...기준점선} />
                            <R.ReferenceLine y={곡선끝.최저} {...기준점선} />
                          </>
                        )}
                        {/* 시작 금액 — 이 선보다 위면 번 것이다. 범위 밖이어도 보이게 축을 늘린다 */}
                        <R.ReferenceLine y={capital} stroke="var(--text-muted)" strokeDasharray="4 4" ifOverflow="extendDomain" />
                        <R.Area type="monotone" dataKey="value" stroke="var(--accent-blue)" fill="url(#grad)"
                                strokeWidth={2} dot={false} isAnimationActive={false} />
                      </R.AreaChart>
                    )}
                  </차트틀>
                  <그래프범례 끝={곡선끝 && `최고 ${눈금글(곡선끝.최고, "KRW")} · 최저 ${눈금글(곡선끝.최저, "KRW")}`}
                    선들={[{ 이름: "내 전략", 색: "var(--accent-blue)" },
                          { 이름: "초기자본", 색: "var(--text-muted)", 점선: true }]} />
                </Card>

                {/* 거래 내역 — 스크리닝 표와 같은 머리·줄·칸 */}
                <Card className="p-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-base font-semibold text-text-primary">거래 내역</span>
                    <div className="flex items-center gap-2">
                      {/* 두 칸이 왜 다른지 안 적으면 '숫자가 안 맞는다' 로 읽힌다.
                          왼쪽은 값이 움직인 폭, 오른쪽은 실제로 남은 것이다. */}
                      {!!result.cost_rate && (
                        <span className="text-2xs text-text-dim break-keep">
                          수익률은 값이 움직인 폭 · 오른쪽은 수수료 {result.cost_rate * 100}%를 뺀 것
                        </span>
                      )}
                      <span className="text-text-muted text-xs">{result.trades?.length}건</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className={cn("w-full", 표글자)}>
                      <thead className={표머리}>
                        <tr className={표머리줄}>
                          <th className={cn(표머리칸, "text-left")}>유형</th>
                          <th className={표머리칸}>진입일</th>
                          <th className={표머리칸}>청산일</th>
                          <th className={표머리칸}>진입가</th>
                          <th className={표머리칸}>청산가</th>
                          <th className={표머리칸}>수익률</th>
                          {!!result.cost_rate && <th className={표머리칸}>수수료 뺀 것</th>}
                          <th className={표머리칸}>수량</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.trades?.map((t: any, i: number) => (
                          <tr key={i} className={표줄}>
                            {/* whitespace-nowrap 이 없으면 폰 너비에서 '만기청산'
                                이 한 글자씩 쪼개져 네 줄이 된다. 표는 좁아지면
                                **옆으로 밀려야지** 글자가 부서지면 안 된다 —
                                가로 스크롤은 이미 있다(overflow-x-auto). */}
                            <td className={cn(표칸, "text-left")}>
                              <span className={cn("px-1.5 py-0.5 rounded text-2xs font-semibold whitespace-nowrap bg-bg-elevated",
                                t.type === "손절" ? loss : t.type === "익절" ? gain : "text-text-secondary")}>{t.type}</span>
                            </td>
                            <td className={cn(표칸, "font-mono text-text-secondary")}>{t.entry_date}</td>
                            <td className={cn(표칸, "font-mono text-text-secondary")}>{t.exit_date}</td>
                            <td className={cn(표칸, "font-mono")}>{t.entry_price.toLocaleString()}</td>
                            <td className={cn(표칸, "font-mono")}>{t.exit_price.toLocaleString()}</td>
                            <td className={표칸}><ChangeBadge value={t.pnl_rate} /></td>
                            {!!result.cost_rate && (
                              <td className={표칸}><ChangeBadge value={t.net_pnl_rate ?? t.pnl_rate} /></td>
                            )}
                            <td className={cn(표칸, "font-mono text-text-secondary")}>{t.shares.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            ) : (
              <Card>
                <빈화면 icon={BarChart2} title="진입·청산 조건을 정하고 '백테스트 실행' 을 눌러 보세요"
                  hint="이동평균·RSI·MACD 등 15개 넘는 기술적 지표를 조건으로 쓸 수 있어요" />
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
                <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Award size={14} className="text-accent-yellow" />
                    <span className="text-base font-semibold text-text-primary">유니버스 백테스트 결과</span>
                  </div>
                  <span className="text-text-muted text-xs">
                    {universeResult.tested}/{universeResult.total_symbols}종목 분석 완료
                  </span>
                </div>
                {/* 생존 편향을 **결과 바로 위에** 적는다.
                    종목 목록이 '오늘 살아남아 시총 상위에 있는 것들' 로
                    고정돼 있어서, 망했거나 밀려난 회사는 처음부터 없다.
                    어떤 전략을 넣어도 실제보다 좋게 나온다 — 조용히 두면
                    사용자는 이 표를 실제 성적으로 읽는다. */}
                {universeResult.생존편향 && (
                  <p className="px-4 py-2.5 text-2xs text-accent-yellow bg-accent-yellow/10
                                border-b border-border break-keep">
                    ⚠ {universeResult.생존편향}
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className={cn("w-full", 표글자)}>
                    <thead className={표머리}>
                      <tr className={표머리줄}>
                        <th className={cn(표머리칸, "text-left")}>순위</th>
                        <th className={cn(표머리칸, "text-left")}>종목</th>
                        <th className={표머리칸}>총수익률</th>
                        <th className={표머리칸}>연환산</th>
                        <th className={표머리칸}>MDD</th>
                        <th className={표머리칸}>샤프</th>
                        <th className={표머리칸}>승률</th>
                        <th className={표머리칸}>거래수</th>
                        <th className={표머리칸}>PF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {universeResult.results?.map((r: any, i: number) => (
                        <tr key={r.symbol} className={표줄}>
                          <td className={cn(표칸, "text-left")}>
                            <span className={`font-bold ${i === 0 ? "text-accent-yellow" : i < 3 ? "text-accent-blue" : "text-text-muted"}`}>
                              #{i + 1}
                            </span>
                          </td>
                          <td className={cn(표칸, "text-left")}>
                            <span className="font-mono font-semibold text-text-primary">{r.symbol}</span>
                          </td>
                          <td className={표칸}><ChangeBadge value={r.total_return ?? 0} /></td>
                          <td className={표칸}>
                            {r.annual_return == null
                              ? <span className="text-text-dim">—</span>
                              : <ChangeBadge value={r.annual_return} />}
                          </td>
                          {/* 이 두 칸만 물음표 접근자를 쓰고 있었다.
                              낙폭은 못 잰 값일 때 '-%' 라는 빈 껍데기가,
                              샤프는 아예 빈 칸이 찍혔다 — 옆 칸들은 같은
                              상황에서 '—' 를 그린다. 한 표 안에서 세 가지
                              방식이 섞여 있었다. */}
                          <td className={cn(표칸, "font-mono", loss)}>{숫자(r.mdd, 1, "-", "%")}</td>
                          <td className={cn(표칸, "font-mono text-text-secondary")}>{숫자(r.sharpe_ratio, 2)}</td>
                          <td className={cn(표칸, "font-mono text-text-secondary")}>{숫자(r.win_rate, 1, "", "%")}</td>
                          <td className={cn(표칸, "font-mono text-text-muted")}>{r.total_trades}</td>
                          <td className={cn(표칸, "font-mono text-text-secondary")}>{숫자(r.profit_factor, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : (
              <Card>
                <빈화면 icon={Globe} title="유니버스 전체에 전략을 적용합니다"
                  hint="고른 목록의 종목마다 조건을 돌려 성과 순위를 봅니다" />
              </Card>
            )
          )}
        </div>
      </div>
      )}

      {/* ── 전략 저장소 ── 설정 칸 없이 넓게. 예전엔 여기서도 왼쪽에 설정 칸과 '유니버스 백테스트' 단추가
          떠 있어서, 저장한 것을 보러 왔는데 무엇을 돌리는 화면인지 헷갈렸다 */}
      {pageTab === "strategies" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {errorMsg && (
            <p className="md:col-span-2 xl:col-span-3 text-xs text-accent-red bg-accent-red/10 border border-accent-red/30 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}
          {!isLoggedIn ? (
            <Card className="md:col-span-2 xl:col-span-3">
              <빈화면 compact icon={LogIn} title="전략을 저장하려면 로그인이 필요합니다"
                action={{ label: "로그인하기", onClick: () => navigate("/login") }} />
            </Card>
          ) : !strategies?.length && !실험들.length ? (
            <Card className="md:col-span-2 xl:col-span-3">
              <빈화면
                compact
                icon={FlaskConical}
                title="저장된 전략이 없어요"
                hint="조건을 만들고 '저장'을, 자산배분은 '저장'을 누르면 여기에 쌓입니다."
              />
            </Card>
          ) : null}

          {isLoggedIn && 실험들.length >= 2 && (
            <div className="md:col-span-2 xl:col-span-3"><실험비교 실험들={실험들} /></div>
          )}
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
                  <p className="text-base font-semibold text-text-primary truncate">{x.name}</p>
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
              <div className="text-xs text-accent-blue">누르면 자산배분 탭에서 열어요</div>
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
            <Card key={s.id} className="flex flex-col gap-3 cursor-pointer" ariaLabel={`${s.name} 전략 열기`}
                  onClick={() => loadStrategy(s)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-text-primary truncate">{s.name}</p>
                  <p className="text-xs text-text-muted mt-0.5">v{s.version} · {s.market} · {s.created_at?.slice(0, 10)}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Badge>매매 전략</Badge>
                  <TrendingUp size={14} className="text-text-muted" />
                  {/* 카드 전체가 '열기' 라 지우기 누름이 위로 번지지 않게 막는다(실험 카드와 같다) */}
                  <지움단추
                    ariaLabel={`${s.name} 지우기`}
                    onClick={(e) => { e.stopPropagation(); set지울전략({ id: s.id, name: s.name }); }}
                  />
                </div>
              </div>
              {s.description && <p className="text-xs text-text-secondary">{s.description}</p>}
              <div className="flex gap-1.5 flex-wrap">
                {s.stop_loss   && <Badge variant="red">손절 {s.stop_loss}%</Badge>}
                {s.take_profit && <Badge variant="green">익절 {s.take_profit}%</Badge>}
                <Badge>진입 {s.entry_conditions?.conditions?.length ?? 0}조건</Badge>
                <Badge>청산 {s.exit_conditions?.conditions?.length ?? 0}조건</Badge>
              </div>
              <div className="text-xs text-accent-blue">누르면 단일 종목 탭에서 열어요</div>
            </Card>
          ))}

          {지울전략 && (
            <ConfirmDialog
              title="전략을 지울까요?"
              message="지우면 되돌릴 수 없어요. 진입·청산 조건을 처음부터 다시 만들어야 해요."
              대상={지울전략.name}
              확인글="지우기"
              진행중={전략지우기.isPending}
              onConfirm={() => 전략지우기.mutate(지울전략.id)}
              onClose={() => set지울전략(null)}
            />
          )}
        </div>
      )}

      </div>
    </div>
  );
}
