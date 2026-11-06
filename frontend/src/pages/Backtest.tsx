import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backtestApi, type 저장된실험, type 저장한전략, type 단일결과, type 유니버스결과, type 유니버스줄,
         type 돌린설정저장 } from "@/api/stocks";
import {
  Card, UnderlineTabs, Button, NameDialog, 고른칩,
  빈화면, 못불러옴, INPUT_CLASS, cn,
} from "@/components/ui";
import { ConditionBuilder, 조건묶음글 } from "@/components/backtest/ConditionBuilder";
import type { ConditionGroup } from "@/types";
import { Globe, BarChart2, FolderOpen } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { use넓은화면 } from "@/hooks/useWideScreen";
import { use알림 } from "@/hooks/useDialogs";
import { 읽을수있는오류, 요청실패말 } from "@/utils/errors";
import { 글공유, 공유알림 } from "@/utils/공유";
import { csv내려받기 } from "@/utils/csv";
import 자산배분탭, { 설정판배치 } from "@/components/backtest/AllocationTab";
import type { 설정 } from "@/components/backtest/AllocationForm";
import { 기간에서날짜, 읽는금액 } from "@/components/backtest/설정값";
import { 칸제목, 기간칸, 금액칸, 고급설정, 실행줄, 설정요약, 설정접기줄, use결과로, 기간말, 부드럽게가기,
         type 설정항목 } from "@/components/backtest/설정부품";
import 불러오기창 from "@/components/backtest/불러오기창";
import 종목고르기, { 기본종목, type 고른종목 } from "@/components/backtest/종목고르기";
import { 공유열쇠, 공유읽기, 공유주소, type 단일설정, type 유니버스설정 } from "@/components/backtest/결과공유";
import { 진행막대, 서버아래말, 새열쇠, 깨우는초 } from "@/components/backtest/진행막대";
import 단일결과화면 from "@/components/backtest/단일결과화면";
import 유니버스결과화면 from "@/components/backtest/유니버스결과화면";
import { 단일결과CSV } from "@/components/backtest/결과내보내기";
import { 돌린설정읽기 } from "@/components/backtest/분석";

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
   오늘 시총 상위로 손으로 고른 목록이다. '오늘 기준' 을 이름에 넣어 두면 결과를 읽을 때 그 사실이 같이 보인다.
   개수는 진행 막대의 어림에만 쓴다(서버가 겹친 종목을 빼고 센 수 — 진짜 개수는 서버가 진행으로 알려 준다). */
const UNIVERSE_OPTIONS = [
  { value: "SP500",  label: "미국 대형주 (오늘 기준)", market: "US", 개수: 311 },
  { value: "KOSPI",  label: "KOSPI 대형주 (오늘 기준)", market: "KR", 개수: 30 },
  { value: "KOSDAQ", label: "KOSDAQ (오늘 기준)",      market: "KR", 개수: 15 },
  { value: "ETF",    label: "글로벌 ETF",              market: "US", 개수: 23 },
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

/** 이름표가 위에 붙은 입력칸 — 자산배분 설정과 같은 모양(이름표 위, 칸 아래) */
function 입력칸({ id, 이름, className, ...칸 }: { id: string; 이름: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={id} className="text-xs text-text-muted whitespace-nowrap">{이름}</label>
      <input id={id} className={cn(INPUT_CLASS, "min-w-0", className)} {...칸} />
    </div>
  );
}

/** 국내 코드는 단일 종목 탭이 쓰는 꼴(접미사 없는 6자리)로 — 유니버스 목록은 '005930.KS' 로 온다 */
function 단일꼴(symbol: string, market: string): string {
  return market === "KR" ? symbol.replace(/\.(KS|KQ)$/i, "") : symbol;
}

/** 저장할 '돌린 설정' — 불러오면 그 백테스트가 그대로 열린다(서버 strategies.run_settings) */
function 돌린설정저장으로(s: 단일설정 | 유니버스설정, 종류: "single" | "universe"): 돌린설정저장 {
  const 공통 = { start_date: s.start_date, end_date: s.end_date, capital: s.capital,
                 position_size: s.position_size, cost_rate: s.cost_rate };
  if (종류 === "single") {
    const x = s as 단일설정;
    return { kind: "single", ...공통, symbol: x.symbol, market: x.market, name: x.name };
  }
  const x = s as 유니버스설정;
  return { kind: "universe", ...공통, universe: x.universe, rank_by: x.rank_by, top_n: x.top_n };
}

export default function Backtest() {
  const { isLoggedIn } = useAuthStore();
  const qc = useQueryClient();
  const [pageTab, setPageTab] = useState("alloc");
  /* 설정과 결과가 나란히 놓이는 폭(xl, 설정판배치). 그보다 좁으면 둘이 위아래라, 결과가 나오면 설정을 한 줄로
     접는다(사용자가 고른 3번) */
  const 나란히 = use넓은화면(1280);
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
  const [result, setResult] = useState<단일결과 | null>(null);

  // 유니버스
  const [universe, setUniverse] = useState("SP500");
  const [rankBy, setRankBy] = useState("total_return");
  const [topN, setTopN] = useState(20);
  const [universeResult, setUniverseResult] = useState<유니버스결과 | null>(null);

  /* 전략 저장 — 자산배분 탭처럼 '저장' 을 누르면 이름을 묻는다. 로그인 전에는 단추를 그대로 두고,
     누르면 왜 안 되는지 말한다(아예 안 그리면 '저장이 어디 있지' 가 된다) */
  const [이름창, set이름창] = useState(false);
  /** 결과 머리의 '결과 저장' 으로 연 이름 창 — 어느 탭의 결과인가 */
  const [결과저장창, set결과저장창] = useState<"single" | "universe" | null>(null);
  const [로그인안내, set로그인안내] = useState(false);
  const [불러오기열림, set불러오기열림] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /** 결과가 나와 설정을 접은 탭 — 탭마다 따로 기억한다 */
  const [접힌탭, set접힌탭] = useState<string | null>(null);
  const 접힘 = 접힌탭 === pageTab && !나란히;
  const [결과자리, 결과로] = use결과로();
  const 판 = useRef<HTMLDivElement>(null);
  /** 돌린 그 설정 — 공유·저장·펼친 요약은 '지금 칸에 적힌 것' 이 아니라 '이 결과를 낸 것' 을 쓴다 */
  const 돌린설정 = useRef<{ 단일?: 단일설정; 유니버스?: 유니버스설정 }>({});

  /* 진행 열쇠 — 돌릴 때마다 새로(같은 열쇠를 다시 쓰면 앞 요청의 진행이 남아 막대가 80% 에서 시작한다).
     처음 한 번은 자던 서버를 깨우는 시간을 어림에 얹는다 */
  const [단일열쇠, set단일열쇠] = useState<string | undefined>();
  const [유니버스열쇠, set유니버스열쇠] = useState<string | undefined>();
  const [처음인가, set처음인가] = useState(true);

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
    const s = strategies.find((x) => x.id === 번호);
    if (s) loadStrategy(s);
    주소파라미터.delete("strategy");
    set주소파라미터(주소파라미터, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategies]);

  const universeMarket = UNIVERSE_OPTIONS.find((o) => o.value === universe)?.market ?? "US";

  const runMutation = useMutation({
    mutationFn: () => {
      돌린설정.current.단일 = 단일지금();
      const 열쇠 = 새열쇠();
      set단일열쇠(열쇠);
      return backtestApi.run({
        symbol: 종목.symbol, market: 종목.market, start_date: startDate, end_date: endDate,
        initial_capital: Number(capital), entry_conditions: entryConditions,
        exit_conditions: exitConditions,
        stop_loss: stopLoss || undefined, take_profit: takeProfit || undefined,
        /* 화면은 퍼센트(95)로 들고, 서버는 비율(0.95)로 받는다 */
        position_size: positionSize / 100,
        cost_rate: costRate,
        progress_key: 열쇠,
      });
    },
    onSuccess: (data) => { setResult(data); setErrorMsg(null); set접힌탭("single"); set처음인가(false); },
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
      const 열쇠 = 새열쇠();
      set유니버스열쇠(열쇠);
      return backtestApi.runUniverse({
        universe, market: universeMarket,
        start_date: startDate, end_date: endDate,
        initial_capital: Number(capital), entry_conditions: entryConditions,
        exit_conditions: exitConditions, stop_loss: stopLoss || null,
        take_profit: takeProfit || null, position_size: positionSize / 100,
        cost_rate: costRate,
        rank_by: rankBy, top_n: topN,
        progress_key: 열쇠,
      });
    },
    onSuccess: (data) => { setUniverseResult(data); setErrorMsg(null); set접힌탭("universe"); set처음인가(false); },
    onError: (err: any) => setErrorMsg(
      요청실패말(err, "유니버스 백테스트 실행에 실패했어요. 잠시 후 다시 시도해주세요")),
  });

  /* 공유받은 단일 종목·불러온 전략·유니버스에서 고른 종목 — 칸이 다 들어간 다음 그림에서 돌린다
     (같은 그림에서 돌리면 앞 설정으로 돈다) */
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

  /** 전략 저장 — 설정 칸의 '저장' 은 지금 칸에 적힌 것을, 결과 머리의 '결과 저장' 은 그 결과를 낸 것을 담는다.
   *  어느 쪽이든 종목·기간·자본까지(run_settings) 담아 불러오면 같은 백테스트가 열린다 */
  const saveStrategyMutation = useMutation({
    mutationFn: ({ 이름, s, 종류 }: { 이름: string; s: 단일설정 | 유니버스설정; 종류: "single" | "universe" }) =>
      backtestApi.saveStrategy({
        name: 이름,
        market: 종류 === "single" ? (s as 단일설정).market
          : (UNIVERSE_OPTIONS.find((o) => o.value === (s as 유니버스설정).universe)?.market ?? "US"),
        entry_conditions: s.entry, exit_conditions: s.exit,
        stop_loss: s.stop_loss || undefined, take_profit: s.take_profit || undefined,
        run_settings: 돌린설정저장으로(s, 종류),
      }),
    onSuccess: () => {
      set이름창(false);
      set결과저장창(null);
      qc.invalidateQueries({ queryKey: ["strategies"] });
      보이기("저장했어요. ‘불러오기’ 에서 열면 같은 백테스트가 다시 열려요", "success");
    },
    onError: (err: any) => {
      set결과저장창(null);
      setErrorMsg(읽을수있는오류(err?.response?.data?.detail, "전략을 저장하지 못했어요"));
      보이기(읽을수있는오류(err?.response?.data?.detail, "전략을 저장하지 못했어요"), "error");
    },
  });

  /** 결과 머리의 '결과 저장' — 로그인 전이면 창 대신 왜 안 되는지 말한다 */
  const 결과저장누름 = (종류: "single" | "universe") => {
    if (!isLoggedIn) {
      보이기("결과를 저장하려면 로그인이 필요해요. 백테스트는 로그인 없이도 돼요", "info");
      return;
    }
    set결과저장창(종류);
  };

  /* 저장한 매매 전략을 불러온다.
     · 결과 화면에서 저장한 것(돌린 설정이 있다) — 종목·기간·자본까지 되살린다. 단일 종목은 바로 돌려 결과까지
       보여 준다(사용자: "결과나오면 저장을 어떻게해" — 저장한 결과를 다시 보는 길). 유니버스는 몇 분 걸려 설정만
     · 예전에 저장한 것(조건만) — 단일 종목 탭에서 연다(유니버스 탭에서 불렀으면 그대로). 지금 종목의 시장이
       다르면 그 시장의 대표 종목으로 바꿔 넣는다(국내 전략을 미국 종목으로 돌리면 안 맞는다) */
  const loadStrategy = (s: 저장한전략) => {
    setEntryConditions(s.entry_conditions);
    setExitConditions(s.exit_conditions);
    setStopLoss(s.stop_loss || "");
    setTakeProfit(s.take_profit || "");
    const 돌린것 = 돌린설정읽기(s.run_settings);
    if (돌린것) {
      setStartDate(돌린것.start_date); setEndDate(돌린것.end_date); set고른기간(null);
      setCapital(돌린것.capital); setPositionSize(돌린것.position_size); setCostRate(돌린것.cost_rate);
      if (돌린것.kind === "single") {
        set종목({ symbol: 돌린것.symbol!, market: 돌린것.market as 고른종목["market"], name: 돌린것.name ?? 돌린것.symbol! });
        setPageTab("single");
        set자동실행(true);
      } else {
        setUniverse(돌린것.universe!); setRankBy(돌린것.rank_by ?? "total_return"); setTopN(돌린것.top_n ?? 20);
        setPageTab("universe");
        보이기("저장한 설정을 넣었어요. ‘유니버스 백테스트’ 를 누르면 돌아가요", "info");
      }
      return;
    }
    const 국내 = s.market === "KR";
    if (국내 !== (종목.market === "KR")) set종목(국내 ? 기본종목.KR : 기본종목.US);
    setPageTab((지금) => (지금 === "universe" ? "universe" : "single"));
  };

  /* 불러오기 창에서 고른 자산배분 실험 — 자산배분 탭이 받아 설정에 넣는다 */
  const 실험열기 = (x: 저장된실험) => { set고른실험(x); setPageTab("alloc"); };

  /** 유니버스에서 종목을 누르면 — 그 결과를 낸 조건 그대로 그 종목 하나를 단일 종목 탭에서 돌린다 */
  const 자세히 = (줄: 유니버스줄) => {
    const 돌린것 = 돌린설정.current.유니버스;
    if (돌린것) 매매칸넣기(돌린것);
    const 시장 = 줄.market === "KR" ? "KR" : 줄.market === "ETF" ? "ETF" : "US";
    set종목({ symbol: 단일꼴(줄.symbol, 시장), market: 시장, name: 줄.name ?? 줄.symbol });
    setPageTab("single");
    set자동실행(true);
  };

  const 신호탭 = pageTab === "single" || pageTab === "universe";
  const 도는중 = pageTab === "single" ? runMutation.isPending : universeMutation.isPending;
  const 결과있음 = pageTab === "single" ? !!result : !!universeResult;

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
  const 유니버스이름of = (u: string) => UNIVERSE_OPTIONS.find((x) => x.value === u)?.label ?? u;
  const 요약줄 = (s: 단일설정 | 유니버스설정, 머리: string): [string, string] => [
    머리,
    [기간말(s.start_date, s.end_date), 읽는금액(s.capital, "KRW"),
     `진입 ${s.entry.conditions.length}조건 · 청산 ${s.exit.conditions.length}조건`].join(" · "),
  ];
  const 지금요약 = pageTab === "single"
    ? 요약줄(단일지금(), `${종목.name} · ${종목.symbol}`)
    : 요약줄(유니버스지금(), `${유니버스이름} · 상위 ${topN}개`);

  /** 펼친 요약의 목록 — **결과를 낸 설정**(돌린설정)으로. 조건은 글로 풀어 쓴다 */
  const 펼칠것 = (s: 단일설정 | 유니버스설정 | undefined, 종류: "single" | "universe"): 설정항목[] => {
    if (!s) return [];
    const 머리: 설정항목[] = 종류 === "single"
      ? [{ 이름: "종목", 값: `${(s as 단일설정).name} · ${(s as 단일설정).symbol}` }]
      : [{ 이름: "종목 목록", 값: 유니버스이름of((s as 유니버스설정).universe) },
         { 이름: "순위", 값: `${RANK_OPTIONS.find((o) => o.value === (s as 유니버스설정).rank_by)?.label ?? ""} 상위 ${(s as 유니버스설정).top_n}개` }];
    return [
      ...머리,
      { 이름: "기간", 값: `${s.start_date.replace(/-/g, ".")} ~ ${s.end_date.replace(/-/g, ".")}` },
      { 이름: "초기 자본", 값: 읽는금액(s.capital, "KRW") },
      { 이름: "진입", 값: 조건묶음글(s.entry) },
      { 이름: "청산", 값: 조건묶음글(s.exit) },
      { 이름: "손절·익절", 값: `${s.stop_loss === "" ? "없음" : `-${s.stop_loss}%`} · ${s.take_profit === "" ? "없음" : `+${s.take_profit}%`}` },
      { 이름: "투자비중", 값: `${s.position_size}%` },
      { 이름: "거래비용", 값: s.cost_rate ? `${s.cost_rate}%` : "없음" },
    ];
  };

  const 공유하기 = async (s: 단일설정 | 유니버스설정 | undefined, 탭: "single" | "universe") => {
    if (!s) return;
    const 주소 = 공유주소(탭 === "single"
      ? { 탭: "single", 설정: s as 단일설정 }
      : { 탭: "universe", 설정: s as 유니버스설정 });
    const 머리 = 탭 === "single"
      ? `${(s as 단일설정).name} 백테스트`
      : `${유니버스이름of((s as 유니버스설정).universe)} 백테스트`;
    const 알림 = 공유알림(await 글공유(주소, 머리));
    if (알림) 보이기(알림.글, 알림.종류);
  };

  const 돌린단일 = 돌린설정.current.단일;
  const 돌린유니버스 = 돌린설정.current.유니버스;
  const 유니버스개수 = UNIVERSE_OPTIONS.find((u) => u.value === (돌린유니버스?.universe ?? universe))?.개수 ?? 100;

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
          /* 한 줄 요약 — 누르면 이 결과를 낸 설정이 펼쳐진다(사용자: "펼칠수도 있도록 해줘(결과와 설정을 같이
             볼 수도 있게)"). '설정 바꾸기' 는 편집 칸을 연다 */
          <설정요약 줄={지금요약} 펼치기={() => set접힌탭(null)}
            항목들={pageTab === "single" ? 펼칠것(돌린단일, "single") : 펼칠것(돌린유니버스, "universe")} />
        ) : (
        /* ── 설정 ── 자산배분 탭과 같은 모양: 한 장의 카드, 칸마다 제목, 아래에 붙는 저장·실행 */
        <div className="flex flex-col gap-2 min-w-0">
        {/* 결과가 있는데 편집 칸을 열어 둔 채면 다시 한 줄로 접는 길 — 예전엔 다시 돌리기 전까지 못 접었다 */}
        {결과있음 && !나란히 && !도는중 && <설정접기줄 접기={() => set접힌탭(pageTab)} />}
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
        </div>
        )}

        {/* ── 결과 ── */}
        <div ref={결과자리} className="flex flex-col gap-4 min-w-0 scroll-mt-3">
          {/* 단일 종목 결과 */}
          {pageTab === "single" && (
            runMutation.isPending ? (
              /* 몇 초씩 걸린다(자던 서버를 깨우면 30초 넘게). 동그라미만 돌면 얼마나 걸릴지 몰라 사람이 멈춘 줄
                 알고 다시 누른다 — 서버가 적어 주는 실제 진행(시세 → 계산 → 견주기)을 %로 */
              <진행막대 열쇠={단일열쇠} 예상={3 + (처음인가 ? 깨우는초 : 0)}
                어림글={(비율) => 비율 < 0.7 ? "과거 데이터로 돌려보는 중" : "전략을 계산하는 중"}
                아래글={(서버) => 서버 ? 서버아래말(서버) : `${돌린단일?.name ?? 종목.name} 한 종목을 돌려요`} />
            ) : runMutation.isError ? (
              <Card><못불러옴 사유={runMutation.error} 다시={() => runMutation.mutate()} /></Card>
            ) : result ? (
              <단일결과화면 r={result}
                돌린자본={돌린단일?.capital ?? (Number(capital) || 0)}
                요청시작={돌린단일?.start_date ?? startDate}
                공유하기={() => 공유하기(돌린단일, "single")}
                저장하기={() => 결과저장누름("single")}
                내보내기={() => csv내려받기(
                  `백테스트_${돌린단일?.symbol ?? 종목.symbol}_${result.start_date ?? startDate}_${result.end_date ?? endDate}.csv`,
                  단일결과CSV(result, `${돌린단일?.name ?? 종목.name} 내 전략`))} />
            ) : (
              <Card>
                <빈화면 icon={BarChart2} title="종목과 조건을 정하고 ‘백테스트 실행’ 을 눌러 보세요"
                  hint="이동평균·RSI·MACD 등 15개 넘는 기술적 지표를 조건으로 쓸 수 있어요" />
              </Card>
            )
          )}

          {/* 유니버스 결과 — 기다리는 동안은 종목 몇 개 중 몇 개를 돌렸는지 %로 */}
          {pageTab === "universe" && (
            universeMutation.isPending ? (
              <진행막대 열쇠={유니버스열쇠} 예상={유니버스개수 * 0.3 + 2 + (처음인가 ? 깨우는초 : 0)}
                어림글={() => "종목마다 시세를 받아 돌리는 중"}
                아래글={(서버) => 서버 ? 서버아래말(서버) : `${유니버스개수}종목쯤을 차례로 돌려요 — 몇 분 걸릴 수 있어요`} />
            ) : universeResult ? (
              <유니버스결과화면 r={universeResult} 처음기준={돌린유니버스?.rank_by ?? rankBy}
                공유하기={() => 공유하기(돌린유니버스, "universe")}
                저장하기={() => 결과저장누름("universe")}
                자세히={자세히} />
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

      {이름창 && (
        <NameDialog
          title="이 전략을 저장할까요?"
          설명="진입·청산 조건과 손절·익절, 종목·기간·자본까지 저장해요. ‘불러오기’ 에서 다시 열 수 있어요."
          첫값={`${pageTab === "single" ? 종목.name : 유니버스이름} 전략`}
          진행중={saveStrategyMutation.isPending}
          onConfirm={(이름) => saveStrategyMutation.mutate({
            이름, 종류: pageTab === "single" ? "single" : "universe",
            s: pageTab === "single" ? 단일지금() : 유니버스지금() })}
          onClose={() => set이름창(false)}
        />
      )}
      {결과저장창 && (결과저장창 === "single" ? 돌린단일 : 돌린유니버스) && (
        <NameDialog
          title="이 결과를 저장할까요?"
          설명={결과저장창 === "single"
            ? "이 결과를 낸 종목·기간·자본과 진입·청산 조건을 저장해요. ‘불러오기’ 에서 열면 같은 백테스트가 바로 다시 돌아요."
            : "이 결과를 낸 종목 목록·기간·자본과 조건을 저장해요. ‘불러오기’ 에서 열면 같은 설정이 들어와요(몇 분 걸려 바로 돌리지는 않아요)."}
          첫값={`${결과저장창 === "single" ? 돌린단일!.name : 유니버스이름of(돌린유니버스!.universe)} 전략`}
          진행중={saveStrategyMutation.isPending}
          onConfirm={(이름) => saveStrategyMutation.mutate({
            이름, 종류: 결과저장창, s: (결과저장창 === "single" ? 돌린단일 : 돌린유니버스)! })}
          onClose={() => set결과저장창(null)}
        />
      )}

      {불러오기열림 && (
        <불러오기창 처음칸={pageTab === "alloc" ? "실험" : "전략"} 닫기={() => set불러오기열림(false)}
          실험열기={실험열기} 전략열기={loadStrategy} />
      )}
      {알림창}
    </div>
  );
}
