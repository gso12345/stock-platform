import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { backtestApi, type 저장된실험 } from "@/api/stocks";
import {
  Card, ChangeBadge, formatNumber, UnderlineTabs, Button, NameDialog, LoadingSpinner, 고른칩,
  빈화면, 못불러옴, INPUT_CLASS, cn,
} from "@/components/ui";
import { ConditionBuilder } from "@/components/backtest/ConditionBuilder";
import 차트틀 from "@/components/chart/ChartFrame";
import { 가로축, 그래프높이, 기준점선, 끝값, 달눈금, 툴팁 } from "@/utils/chartTheme";
import type { ConditionGroup } from "@/types";
import { Globe, BarChart2, Award, FolderOpen, Share2 } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { usePnlColors } from "@/hooks/usePnlColors";
import { use넓은화면 } from "@/hooks/useWideScreen";
import { use알림 } from "@/hooks/useDialogs";
import { 읽을수있는오류, 요청실패말 } from "@/utils/errors";
import { 글공유, 공유알림 } from "@/utils/공유";
import 자산배분탭, { 설정판배치 } from "@/components/backtest/AllocationTab";
import type { 설정 } from "@/components/backtest/AllocationForm";
import { 기간에서날짜, 읽는금액 } from "@/components/backtest/설정값";
import { 칸제목, 기간칸, 금액칸, 고급설정, 실행줄, 설정요약, use결과로, 기간말, 부드럽게가기 } from "@/components/backtest/설정부품";
import 불러오기창 from "@/components/backtest/불러오기창";
import 종목고르기, { 기본종목, type 고른종목 } from "@/components/backtest/종목고르기";
import { 눈금글, 그래프범례 } from "@/components/backtest/AllocationResult";
import { 공유열쇠, 공유읽기, 공유주소, type 단일설정, type 유니버스설정 } from "@/components/backtest/결과공유";
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

/* '자산배분' 을 맨 앞에 둔다 — 보통 사람이 실제로 하는 투자가 이쪽이다(여러 자산을 비중대로 담고 매달 넣고 가끔
   비중을 맞추는 것). 뒤의 둘은 매매 신호를 시험하는 것이라 훨씬 좁은 쓰임이다.
   예전엔 넷째로 '전략 저장소' 탭이 있었다 — 메뉴의 전략 저장소와 같은 것이 두 군데였고, 탭 줄이 넷이라 폰에서
   꽉 찼다. 저장한 것은 탭 줄 오른쪽 '불러오기' 로 연다(사용자가 고른 1·2번). */
const PAGE_TABS = [
  { id: "alloc",    label: "자산배분" },
  { id: "single",   label: "단일 종목" },
  { id: "universe", label: "유니버스" },
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

/* 백테스트 결과가 뜰 자리 — 큰 숫자 셋과 그래프(결과와 같은 모양) */
function BacktestSkeleton() {
  return (
    <>
      <div className="bg-bg-card border border-border rounded-xl p-4 animate-pulse flex flex-col gap-3">
        <div className="h-3.5 w-16 rounded bg-bg-elevated" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="h-2.5 w-14 rounded bg-bg-elevated" />
              <div className="h-6 w-20 rounded bg-bg-elevated" />
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

/** 결과의 큰 숫자 — 사람이 제일 먼저 묻는 셋(얼마 벌었나·얼마나 아팠나·몇 번 이겼나). 사용자가 고른 11번:
 *  예전엔 같은 크기의 칸 여덟 개라 무엇부터 봐야 할지 몰랐다. */
function 큰지표({ 이름, 값, 색, 밑 }: { 이름: string; 값: React.ReactNode; 색?: string; 밑?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-xs text-text-muted">{이름}</span>
      <span className={cn("text-xl font-bold font-mono tabular-nums truncate", 색 ?? "text-text-primary")}>{값}</span>
      {밑 && <span className="text-2xs text-text-dim break-keep">{밑}</span>}
    </div>
  );
}

/** 나머지 숫자 — 작게, 한 줄에 둘·셋 */
function 작은지표({ 이름, 값, 색, 밑 }: { 이름: string; 값: React.ReactNode; 색?: string; 밑?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-2xs text-text-muted">{이름}</span>
      <span className={cn("text-sm font-semibold font-mono tabular-nums", 색 ?? "text-text-primary")}>{값}</span>
      {밑 && <span className="text-2xs text-text-dim break-keep">{밑}</span>}
    </div>
  );
}

/** '2020-03-02' → '20.03.02' — 거래 카드 한 줄에 날짜 둘이 들어가게 */
function 짧은날(d: string | null | undefined): string {
  return d && d.length >= 10 ? `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}` : (d ?? "");
}

/** 결과 머리의 공유 단추 — 설정을 주소에 실어 보낸다(받은 사람이 같은 백테스트를 연다) */
function 공유단추({ 누르기 }: { 누르기: () => void }) {
  return (
    <button type="button" aria-label="결과 공유" onClick={누르기}
      className="p-1.5 -m-0.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
      <Share2 size={16} />
    </button>
  );
}

export default function Backtest() {
  const { isLoggedIn } = useAuthStore();
  const [pageTab, setPageTab] = useState("alloc");
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor, gain, loss } = usePnlColors(배색);
  const 넓음 = use넓은화면();
  /* 설정과 결과가 나란히 놓이는 폭(xl, 설정판배치). 그보다 좁으면 둘이 위아래라, 결과가 나오면 설정을 한 줄로
     접는다(사용자가 고른 3번) */
  const 나란히 = use넓은화면(1280);
  /* 거래 내역 — 이 폭부터 표, 그보다 좁으면 한 줄 카드(사용자가 고른 12번). 일곱 칸 표는 폰에서 옆으로 밀렸다 */
  const 표로 = use넓은화면(768);
  const { 보이기, 화면: 알림창 } = use알림();

  /* 전략 저장소 **메뉴**(/strategies)에서 자산배분·전략을 누르면 여기로 온다. 주소에 번호를 실어 보내므로
     그걸 읽어 바로 열어 준다. 안 읽으면 백테스트 첫 화면만 뜨고 무엇을 누른 것인지 사라진다. */
  const [주소파라미터, set주소파라미터] = useSearchParams();

  // 단일종목
  const [종목, set종목] = useState<고른종목>(기본종목.US);
  /* 기간은 오늘에서 거슬러 잰다 — 예전엔 2020-01-01~2024-12-31 에 못 박혀, 몇 해 지나면 '최근' 이 아니었다 */
  const [startDate, setStartDate] = useState(() => 기간에서날짜(5).start_date);
  const [endDate, setEndDate] = useState(() => 기간에서날짜(5).end_date);
  /** 지금 고른 기간 칩 — 날짜를 손으로 고치면 풀린다 */
  const [고른기간, set고른기간] = useState<number | null>(5);
  const [capital, setCapital] = useState<number | "">(10_000_000);
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
  const [불러오기열림, set불러오기열림] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /** 결과가 나와 설정을 접은 탭 — 탭마다 따로 기억한다 */
  const [접힌탭, set접힌탭] = useState<string | null>(null);
  const 접힘 = 접힌탭 === pageTab && !나란히;
  const [결과자리, 결과로] = use결과로();
  const 판 = useRef<HTMLDivElement>(null);
  /** 돌린 그 설정 — 공유는 '지금 칸에 적힌 것' 이 아니라 '이 결과를 낸 것' 을 보낸다 */
  const 돌린설정 = useRef<{ 단일?: 단일설정; 유니버스?: 유니버스설정 }>({});

  const { data: strategies } = useQuery({ queryKey: ["strategies"], queryFn: backtestApi.getStrategies });

  /* 메뉴의 전략 저장소에서 고른 자산배분 실험·매매 전략 — 자산배분 실험은 그 탭에 넘긴다 */
  const [불러올실험, set불러올실험] = useState<number | null>(null);
  const [고른실험, set고른실험] = useState<저장된실험 | null>(null);
  const [공유받은배분, set공유받은배분] = useState<설정 | null>(null);
  const [자동실행, set자동실행] = useState(false);

  const 단일지금 = (): 단일설정 => ({
    symbol: 종목.symbol, market: 종목.market, name: 종목.name,
    start_date: startDate, end_date: endDate, capital: Number(capital) || 0,
    stop_loss: stopLoss, take_profit: takeProfit, position_size: positionSize, cost_rate: costRate,
    entry: entryConditions, exit: exitConditions,
  });
  const 유니버스지금 = (): 유니버스설정 => ({
    universe, rank_by: rankBy, top_n: topN,
    start_date: startDate, end_date: endDate, capital: Number(capital) || 0,
    stop_loss: stopLoss, take_profit: takeProfit, position_size: positionSize, cost_rate: costRate,
    entry: entryConditions, exit: exitConditions,
  });
  const 매매칸넣기 = (s: 단일설정 | 유니버스설정) => {
    setStartDate(s.start_date); setEndDate(s.end_date); set고른기간(null);
    setCapital(s.capital); setStopLoss(s.stop_loss); setTakeProfit(s.take_profit);
    setPositionSize(s.position_size); setCostRate(s.cost_rate);
    setEntryConditions(s.entry); setExitConditions(s.exit);
  };

  /* 주소로 들어온 것을 한 번 읽고 지운다. 안 지우면 뒤로 갔다 오거나 새로고침할 때마다 같은 것이 다시 열려,
     고치던 설정이 통째로 되돌아간다. */
  useEffect(() => {
    const 실험번호 = Number(주소파라미터.get("experiment"));
    if (Number.isFinite(실험번호) && 실험번호 > 0) {
      set불러올실험(실험번호);
      setPageTab("alloc");
    }
    /* 공유받은 백테스트 — 같은 설정으로 바로 돌려 보여 준다(유니버스는 몇 분이 걸려 설정만 넣는다) */
    const 공유값 = 주소파라미터.get(공유열쇠);
    if (공유값) {
      const 것 = 공유읽기(공유값);
      if (!것) {
        보이기("공유 주소를 읽지 못했어요. 주소가 잘리지 않았는지 확인해 주세요", "error");
      } else if (것.탭 === "alloc") {
        setPageTab("alloc"); set공유받은배분(것.설정);
      } else if (것.탭 === "single") {
        setPageTab("single");
        set종목({ symbol: 것.설정.symbol, market: 것.설정.market, name: 것.설정.name });
        매매칸넣기(것.설정);
        set자동실행(true);
      } else {
        setPageTab("universe");
        setUniverse(것.설정.universe); setRankBy(것.설정.rank_by); setTopN(것.설정.top_n);
        매매칸넣기(것.설정);
        보이기("공유받은 설정을 넣었어요. ‘유니버스 백테스트’ 를 누르면 돌아가요", "info");
      }
    }
    for (const k of ["experiment", 공유열쇠]) 주소파라미터.delete(k);
    set주소파라미터(주소파라미터, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 메뉴의 전략 저장소에서 '백테스트 실행' 을 누르면 전략 번호가 실려 온다 — 전략 목록이 온 뒤에 연다 */
  useEffect(() => {
    const 번호 = Number(주소파라미터.get("strategy"));
    if (!번호 || !strategies) return;
    const s = (strategies as any[]).find((x) => x.id === 번호);
    if (s) loadStrategy(s);
    주소파라미터.delete("strategy");
    set주소파라미터(주소파라미터, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategies]);

  const universeMarket = UNIVERSE_OPTIONS.find((o) => o.value === universe)?.market ?? "US";

  const runMutation = useMutation({
    mutationFn: () => {
      돌린설정.current.단일 = 단일지금();
      return backtestApi.run({
        symbol: 종목.symbol, market: 종목.market, start_date: startDate, end_date: endDate,
        initial_capital: Number(capital), entry_conditions: entryConditions,
        exit_conditions: exitConditions,
        stop_loss: stopLoss || undefined, take_profit: takeProfit || undefined,
        /* 화면은 퍼센트(95)로 들고, 서버는 비율(0.95)로 받는다 */
        position_size: positionSize / 100,
        cost_rate: costRate,
      });
    },
    onSuccess: (data) => { setResult(data); setErrorMsg(null); set접힌탭("single"); },
    /* detail 을 그대로 넣으면 안 된다. FastAPI 422 는 detail 이 **객체
       배열**이라, React 자식으로 들어가는 순간 화면이 통째로 죽는다.
       **끊긴 것과 실패한 것을 가른다.** '실패했어요' 만 띄우면 서버가
       고장 난 줄 알고 떠난다 — 대개는 자던 서버가 깨는 중이라 오래
       걸렸을 뿐이고, 다시 누르면 훨씬 빠르다(utils/errors 의 요청실패말). */
    onError: (err: any) => setErrorMsg(
      요청실패말(err, "백테스트 실행에 실패했어요. 잠시 후 다시 시도해주세요")),
  });

  const universeMutation = useMutation({
    mutationFn: () => {
      돌린설정.current.유니버스 = 유니버스지금();
      return backtestApi.runUniverse({
        universe, market: universeMarket,
        start_date: startDate, end_date: endDate,
        initial_capital: Number(capital), entry_conditions: entryConditions,
        exit_conditions: exitConditions, stop_loss: stopLoss || null,
        take_profit: takeProfit || null, position_size: positionSize / 100,
        cost_rate: costRate,
        rank_by: rankBy, top_n: topN,
      });
    },
    onSuccess: (data) => { setUniverseResult(data); setErrorMsg(null); set접힌탭("universe"); },
    onError: (err: any) => setErrorMsg(
      요청실패말(err, "유니버스 백테스트 실행에 실패했어요. 잠시 후 다시 시도해주세요")),
  });

  /* 공유받은 단일 종목 — 칸이 다 들어간 다음 그림에서 돌린다(같은 그림에서 돌리면 앞 설정으로 돈다) */
  useEffect(() => {
    if (!자동실행) return;
    set자동실행(false);
    runMutation.mutate();
    결과로();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [자동실행]);

  /* 결과가 나와 설정을 접으면 그 자리(요약 + 결과)로 — 위에서 화면 두세 장이 빠지므로 보던 자리가 어긋난다 */
  useEffect(() => {
    if (접힘) 부드럽게가기(판.current);
  }, [접힘]);

  const saveStrategyMutation = useMutation({
    mutationFn: (이름: string) => backtestApi.saveStrategy({
      name: 이름, market: 종목.market, entry_conditions: entryConditions,
      exit_conditions: exitConditions, stop_loss: stopLoss || undefined,
      take_profit: takeProfit || undefined,
    }),
    onSuccess: () => {
      set이름창(false);
      보이기("전략을 저장했어요. ‘불러오기’ 에서 다시 열 수 있어요", "success");
    },
    onError: (err: any) => setErrorMsg(
      읽을수있는오류(err?.response?.data?.detail, "전략을 저장하지 못했어요")),
  });

  /* 저장한 매매 전략을 불러오면 **단일 종목 탭에서** 연다(유니버스 탭에서 불렀으면 그대로). 시장도 같이
     되살린다 — 국내 전략을 미국 종목으로 돌리면 안 맞는다. 지금 종목의 시장이 다르면 그 시장의 대표 종목으로
     바꿔 넣는다(전략에는 종목이 저장되지 않는다) */
  const loadStrategy = (s: any) => {
    setEntryConditions(s.entry_conditions);
    setExitConditions(s.exit_conditions);
    setStopLoss(s.stop_loss || "");
    setTakeProfit(s.take_profit || "");
    const 국내 = s.market === "KR";
    if (국내 !== (종목.market === "KR")) set종목(국내 ? 기본종목.KR : 기본종목.US);
    setPageTab((지금) => (지금 === "universe" ? "universe" : "single"));
  };

  /* 불러오기 창에서 고른 자산배분 실험 — 자산배분 탭이 받아 설정에 넣는다 */
  const 실험열기 = (x: 저장된실험) => { set고른실험(x); setPageTab("alloc"); };

  const 신호탭 = pageTab === "single" || pageTab === "universe";
  const 도는중 = pageTab === "single" ? runMutation.isPending : universeMutation.isPending;

  /** 돌릴 수 없는 이유 — 단추 바로 위에 적는다 */
  const 못하는이유 = !Number(capital) || Number(capital) < 100_000
    ? "초기 자본을 10만원 이상 넣어 주세요"
    : startDate >= endDate ? "종료일이 시작일보다 뒤여야 해요" : null;

  /** 손절·익절·투자비중·거래비용 중 기본값에서 바꾼 수 — 접혀 있어도 보인다 */
  const 바꾼수 = [stopLoss !== "", takeProfit !== "", positionSize !== 95, costRate !== 0].filter(Boolean).length;

  const 돌리기 = () => {
    if (pageTab === "single") runMutation.mutate(); else universeMutation.mutate();
    결과로();
  };

  const 유니버스이름 = UNIVERSE_OPTIONS.find((u) => u.value === universe)?.label ?? universe;
  const 요약줄 = (s: 단일설정 | 유니버스설정, 머리: string): [string, string] => [
    머리,
    [기간말(s.start_date, s.end_date), 읽는금액(s.capital, "KRW"),
     `진입 ${s.entry.conditions.length}조건 · 청산 ${s.exit.conditions.length}조건`].join(" · "),
  ];
  const 지금요약 = pageTab === "single"
    ? 요약줄(단일지금(), `${종목.name} · ${종목.symbol}`)
    : 요약줄(유니버스지금(), `${유니버스이름} · 상위 ${topN}개`);

  const 공유하기 = async (s: 단일설정 | 유니버스설정 | undefined, 탭: "single" | "universe") => {
    if (!s) return;
    const 주소 = 공유주소(탭 === "single"
      ? { 탭: "single", 설정: s as 단일설정 }
      : { 탭: "universe", 설정: s as 유니버스설정 });
    const 머리 = 탭 === "single"
      ? `${(s as 단일설정).name} 백테스트`
      : `${UNIVERSE_OPTIONS.find((u) => u.value === (s as 유니버스설정).universe)?.label ?? ""} 백테스트`;
    const 알림 = 공유알림(await 글공유(주소, 머리));
    if (알림) 보이기(알림.글, 알림.종류);
  };

  /* 수익 곡선 — 다른 메뉴 그래프와 같은 모양(축·툴팁·최고·최저 점선). 시작 금액에 점선 하나를 더 긋는다 */
  const 곡선끝 = 끝값((result?.equity_curve ?? []).map((x: any) => x.value));
  const 돌린자본 = 돌린설정.current.단일?.capital ?? (Number(capital) || 0);
  const 거래들: any[] = useMemo(() => result?.trades ?? [], [result]);

  return (
    <div className="flex flex-col gap-4">
      {/* 큰 제목·설명 줄을 뺐다 — 화면 이름은 아래 메뉴·사이드바가 이미 말한다(피드와 같은 위쪽). 읽어 주는
          사람에게는 제목이 있어야 해서 남긴다 */}
      <h1 className="sr-only">백테스트</h1>

      <UnderlineTabs
        ariaLabel="백테스트 종류"
        idPrefix="bt"
        tabs={PAGE_TABS}
        active={pageTab}
        onChange={setPageTab}
        끝={(
          <button type="button" onClick={() => set불러오기열림(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors">
            <FolderOpen size={16} />
            불러오기
          </button>
        )}
      />

      {/* 탭과 **내용**을 이어 준다. 칸을 탭마다 따로 두지 않고 하나로 둔다 — 탭에 따라 같은 자리의 내용이
          통째로 바뀌는 구조라, 지금 켜진 탭을 가리키게만 해 두면 바뀔 때마다 제대로 읽힌다. */}
      <div role="tabpanel" id="bt-panel" aria-labelledby={`bt-tab-${pageTab}`}
           className="flex flex-col gap-5">

      {/* ── 자산배분 ── 아래 신호 백테스트와 **다른 화면**이다. 한 화면에 섞으면 '진입 조건' 과 '리밸런싱 주기'
          가 나란히 놓여 둘 중 무엇을 하는 중인지 알 수 없다. 갈라 둔다. */}
      {pageTab === "alloc" && (
        <자산배분탭 불러올실험={불러올실험} 고른실험={고른실험}
          불러옴={() => { set불러올실험(null); set고른실험(null); }}
          공유받은설정={공유받은배분} 공유받음={() => set공유받은배분(null)} />
      )}

      {신호탭 && (
      <div ref={판} className={cn(설정판배치, "scroll-mt-3")}>
        {접힘 ? (
          <설정요약 줄={지금요약} 펼치기={() => set접힌탭(null)} />
        ) : (
        /* ── 설정 ── 자산배분 탭과 같은 모양: 한 장의 카드, 칸마다 제목, 아래에 붙는 저장·실행 */
        <Card className="flex flex-col gap-5 min-w-0">
          {pageTab === "single" ? (
            <div className="flex flex-col gap-3">
              <칸제목>테스트 종목</칸제목>
              <종목고르기 고른것={종목} 고르기={set종목} />
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

          <기간칸 시작={startDate} 끝={endDate} 고른년={고른기간}
            바꾸기={({ 시작, 끝, 년 }) => { setStartDate(시작); setEndDate(끝); set고른기간(년); }} />

          <금액칸 제목="초기 자본" 이름="초기 자본" 값={capital} 바꾸기={setCapital} />

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

          <div className="flex flex-col gap-4">
            <칸제목>진입 · 청산 조건</칸제목>
            <ConditionBuilder label="진입 조건" color="blue" group={entryConditions} onChange={setEntryConditions} />
            <div className="border-t border-border" />
            <ConditionBuilder label="청산 조건" color="red" group={exitConditions} onChange={setExitConditions} />
          </div>

          {/* 자주 안 바꾸는 넷 — 손절·익절은 비워 두면 안 쓰는 것, 투자비중·거래비용은 기본값으로 충분하다 */}
          <고급설정 바꾼수={바꾼수}>
            <div className="grid grid-cols-2 gap-2">
              <입력칸 id="bt-stop" 이름="손절 (%)" type="number" placeholder="없음" value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value ? Number(e.target.value) : "")} />
              <입력칸 id="bt-take" 이름="익절 (%)" type="number" placeholder="없음" value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value ? Number(e.target.value) : "")} />
              <입력칸 id="bt-size" 이름="투자비중 (%)" type="number" min={10} max={100} value={positionSize}
                onChange={(e) => setPositionSize(Number(e.target.value))} />
              {/* 거래비용 — 자산배분 탭에는 있었는데 여기만 없었다. **같은 화면의 두 탭이 다른 기준으로
                  계산**하고 있었던 셈이라, 나란히 놓고 보면 신호 쪽이 무조건 좋아 보였다. */}
              <입력칸 id="bt-cost-single" 이름="거래비용 (%)" type="number" min={0} max={5} step={0.01}
                inputMode="decimal" placeholder="0" value={costRate === 0 ? "" : costRate}
                onChange={(e) => setCostRate(e.target.value === "" ? 0 : Number(e.target.value))} />
            </div>
          </고급설정>

          {errorMsg && (
            <p className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/30 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}
          {이름창 && (
            <NameDialog
              title="이 전략을 저장할까요?"
              설명="진입·청산 조건과 손절·익절을 저장해요. ‘불러오기’ 에서 다시 열 수 있어요."
              첫값={`${pageTab === "single" ? 종목.name : 유니버스이름} 전략`}
              진행중={saveStrategyMutation.isPending}
              onConfirm={(이름) => saveStrategyMutation.mutate(이름)}
              onClose={() => set이름창(false)}
            />
          )}

          <실행줄 이유={못하는이유} 알림={로그인안내 && !isLoggedIn ? (
            <p className="text-xs text-accent-yellow/90 break-keep">
              전략을 저장하려면 로그인이 필요해요. 백테스트는 로그인 없이도 돼요.
            </p>
          ) : null}>
            <Button variant="secondary" className="flex-1 py-3"
                    onClick={isLoggedIn ? () => set이름창(true) : () => set로그인안내(true)}
                    disabled={saveStrategyMutation.isPending}>
              {saveStrategyMutation.isPending ? "저장 중…" : "저장"}
            </Button>
            <Button className="flex-1 py-3" disabled={도는중 || !!못하는이유} onClick={돌리기}>
              {pageTab === "single"
                ? (runMutation.isPending ? "실행 중…" : "백테스트 실행")
                : (universeMutation.isPending ? "분석 중… (수분 소요)" : "유니버스 백테스트")}
            </Button>
          </실행줄>
        </Card>
        )}

        {/* ── 결과 ── */}
        <div ref={결과자리} className="flex flex-col gap-4 min-w-0 scroll-mt-3">
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
                {/* ── 성과 ── 큰 숫자 셋 + 나머지 작게. 서버가 **못 잰 값은 null** 로 준다. 0 이 아니다.
                    · 거래가 한 건도 없으면 승률·평균수익은 잴 수가 없다
                    · 손실이 하나도 없으면 손익비는 무한대다
                    · 1년이 안 되는 기간은 연으로 늘리지 않는다
                    색은 설정의 오름·내림 색만 쓴다 — 예전엔 승률·샤프에 초록·빨강을 손으로 박아,
                    '빨강-파랑' 으로 둔 사람에게 이 화면만 거꾸로 보였다 */}
                <Card className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-semibold text-text-primary">성과</span>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-2xs text-text-dim truncate num">
                        {result.start_date && result.end_date ? `${result.start_date} ~ ${result.end_date}` : null}
                      </span>
                      <공유단추 누르기={() => 공유하기(돌린설정.current.단일, "single")} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <큰지표 이름="총 수익률"
                      값={숫자(result.total_return, 1, (result.total_return ?? 0) > 0 ? "+" : "", "%")}
                      색={result.total_return == null ? undefined : pnlColor(result.total_return)}
                      밑={많이늦게시작(돌린설정.current.단일?.start_date ?? startDate, result.start_date)
                        ? `${result.start_date}부터 (시세가 그 전에는 없음)` : undefined} />
                    <큰지표 이름="최대 낙폭" 값={숫자(result.mdd, 1, "-", "%")} 색={loss} />
                    {/* 승률은 **수수료까지 뺀** 손익으로 센다. 가격만 보면 수수료를 내고 나면 손해인 거래가
                        '이긴 거래' 가 된다. */}
                    <큰지표 이름="승률" 값={숫자(result.win_rate, 1, "", "%")}
                      밑={result.cost_rate ? "수수료 반영" : undefined} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 pt-3 border-t border-border">
                    <작은지표 이름="연환산"
                      값={result.annual_return == null
                        ? <span className="text-text-dim">—</span>
                        : <ChangeBadge value={result.annual_return} />}
                      밑={result.annual_return == null && result.years != null
                        ? `${result.years}년치라 연환산 안 함` : undefined} />
                    {/* 샤프는 '무위험으로 그냥 둬도 얻었을 것' 을 뺀 수다. 무엇을 뺐는지 안 적으면 사람이
                        자기 기준으로 읽는다 */}
                    <작은지표 이름="샤프 비율" 값={숫자(result.sharpe_ratio, 2)}
                      밑={`무위험 ${result.risk_free_rate ?? 0}% 기준`} />
                    <작은지표 이름="총 거래수" 값={String(result.total_trades ?? 0)} />
                    <작은지표 이름="평균 수익" 값={숫자(result.avg_profit, 1, "+", "%")}
                      색={result.avg_profit == null ? "text-text-dim" : pnlColor(result.avg_profit)} />
                    <작은지표 이름="수익비율 (PF)" 값={숫자(result.profit_factor, 2)}
                      밑={result.profit_factor == null && (result.total_trades ?? 0) > 0
                        ? "손실 거래 없음" : "PF > 1.5 우수"} />
                  </div>
                </Card>

                {/* ── 그냥 들고 있었으면 ──
                    '연 12%' 만 보면 잘한 것인지 알 수 없다. 같은 기간 그
                    종목을 그냥 사서 들고만 있어도 15% 였다면, 그 전략은
                    사고파느라 3%를 버린 것이다.
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
                    <span className="text-2xs text-text-dim">초기자본 {formatNumber(돌린자본)}원</span>
                  </div>
                  <차트틀 height={그래프높이.큰[넓음 ? 1 : 0]}>
                    {/* 색을 **테마 변수**로 쓴다 — 직접 적은 색은 밝은 테마를 안 따라간다 */}
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
                        <R.ReferenceLine y={돌린자본} stroke="var(--text-muted)" strokeDasharray="4 4" ifOverflow="extendDomain" />
                        <R.Area type="monotone" dataKey="value" stroke="var(--accent-blue)" fill="url(#grad)"
                                strokeWidth={2} dot={false} isAnimationActive={false} />
                      </R.AreaChart>
                    )}
                  </차트틀>
                  <그래프범례 끝={곡선끝 && `최고 ${눈금글(곡선끝.최고, "KRW")} · 최저 ${눈금글(곡선끝.최저, "KRW")}`}
                    선들={[{ 이름: "내 전략", 색: "var(--accent-blue)" },
                          { 이름: "초기자본", 색: "var(--text-muted)", 점선: true }]} />
                </Card>

                {/* 거래 내역 — 넓으면 스크리닝 표와 같은 머리·줄·칸, 좁으면 한 줄 카드 */}
                <Card className="p-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-base font-semibold text-text-primary">거래 내역</span>
                    <div className="flex items-center gap-2">
                      {/* 두 칸이 왜 다른지 안 적으면 '숫자가 안 맞는다' 로 읽힌다.
                          왼쪽은 값이 움직인 폭, 오른쪽은 실제로 남은 것이다. */}
                      {!!result.cost_rate && (
                        <span className="text-2xs text-text-dim break-keep">
                          수익률은 값이 움직인 폭 · {표로 ? "오른쪽은" : "아래 줄은"} 수수료 {result.cost_rate * 100}%를 뺀 것
                        </span>
                      )}
                      <span className="text-text-muted text-xs">{거래들.length}건</span>
                    </div>
                  </div>
                  {표로 ? (
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
                          {거래들.map((t: any, i: number) => (
                            <tr key={i} className={표줄}>
                              {/* whitespace-nowrap 이 없으면 '만기청산' 이 한 글자씩 쪼개진다 */}
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
                  ) : (
                    /* 폰 — 거래 하나가 한 줄. 일곱 칸 표는 옆으로 밀어야 수익률이 보였다 */
                    <ul className="max-h-96 overflow-y-auto divide-y divide-border/60">
                      {거래들.map((t: any, i: number) => (
                        <li key={i} className="px-4 py-2.5 flex items-center gap-3">
                          <span className={cn("px-1.5 py-0.5 rounded text-2xs font-semibold whitespace-nowrap bg-bg-elevated flex-shrink-0",
                            t.type === "손절" ? loss : t.type === "익절" ? gain : "text-text-secondary")}>{t.type}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-text-secondary num truncate">
                              {짧은날(t.entry_date)} → {짧은날(t.exit_date)}
                            </p>
                            <p className="text-2xs text-text-dim num truncate">
                              {t.entry_price.toLocaleString()} → {t.exit_price.toLocaleString()} · {t.shares.toLocaleString()}주
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                            <ChangeBadge value={t.pnl_rate} />
                            {!!result.cost_rate && (
                              <span className="flex items-center gap-1 text-2xs text-text-dim">
                                <span>수수료 뺀 것</span>
                                <ChangeBadge value={t.net_pnl_rate ?? t.pnl_rate} />
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </>
            ) : (
              <Card>
                <빈화면 icon={BarChart2} title="종목과 조건을 정하고 ‘백테스트 실행’ 을 눌러 보세요"
                  hint="이동평균·RSI·MACD 등 15개 넘는 기술적 지표를 조건으로 쓸 수 있어요" />
              </Card>
            )
          )}

          {/* 유니버스 결과 — 기다리는 동안은 공용 LoadingSpinner */}
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
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted text-xs">
                      {universeResult.tested}/{universeResult.total_symbols}종목 분석 완료
                    </span>
                    <공유단추 누르기={() => 공유하기(돌린설정.current.유니버스, "universe")} />
                  </div>
                </div>
                {/* 생존 편향을 **결과 바로 위에** 적는다 — 종목 목록이 '오늘 살아남아 시총 상위에 있는 것들'
                    로 고정돼 있어서 어떤 전략을 넣어도 실제보다 좋게 나온다 */}
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
                <빈화면 icon={Globe} title="고른 목록의 모든 종목에 같은 조건을 돌려요"
                  hint="종목마다 성과를 재서 순위를 매겨요. 몇 분 걸릴 수 있어요" />
              </Card>
            )
          )}
        </div>
      </div>
      )}

      </div>

      {불러오기열림 && (
        <불러오기창 처음칸={pageTab === "alloc" ? "실험" : "전략"} 닫기={() => set불러오기열림(false)}
          실험열기={실험열기} 전략열기={loadStrategy} />
      )}
      {알림창}
    </div>
  );
}
