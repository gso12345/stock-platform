/** 백테스트 — 전략·전종목·자산배분과 저장한 실험. 화면은 '@/api/stocks' 에서 가져간다(거기서 다시 내보낸다). */
import api, { 무거운상한 } from "./client";
import type { ConditionGroup } from "@/types";

/** 백테스트 한 번의 조건 — 서버 BacktestRequest 와 같은 모양 */
export interface 백테스트요청 {
  symbol: string;
  market: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  /** 사기·팔기 조건 — 화면(Backtest.tsx)이 만드는 것과 같은 모양 */
  entry_conditions: ConditionGroup;
  exit_conditions: ConditionGroup;
  stop_loss?: number | null;
  take_profit?: number | null;
  /** 한 번에 자본의 몇 %를 넣을까 (0~1). 화면의 '투자비중' 슬라이더.
   *
   *  이 칸이 **없어서** 슬라이더가 아무 일도 안 했다 — 사람이 50% 로
   *  내려도 서버는 늘 95% 로 계산했고, 결과가 안 바뀌니 '설정이 안 먹는다'
   *  로 읽혔다. */
  position_size?: number;
  /** 거래비용 **퍼센트**. 0.1 이면 0.1% — 서버가 100 으로 나눈다.
   *  자산배분(자산배분요청)과 같은 단위로 맞춘다. */
  cost_rate?: number;
  strategy_id?: number | null;
}

/** 여러 종목을 한꺼번에 돌릴 때 — 서버 UniverseBacktestRequest */
export interface 전종목백테스트요청 extends Omit<백테스트요청, "symbol" | "strategy_id"> {
  universe: string;
  custom_symbols?: string[];
  rank_by?: string;
  top_n?: number;
}

/** 자산배분에 담는 자산 한 칸. weight 는 60 으로 줘도 0.6 으로 줘도 된다 —
 *  서버가 합으로 나눠 맞춘다. */
export interface 배분자산 {
  symbol: string;
  market: string;
  name?: string | null;
  weight: number;
}

export type 주기 = "none" | "monthly" | "quarterly" | "yearly";
export type 벤치마크키 =
  | "none" | "spy" | "qqq"
  /** 코스피 **지수**(^KS11) — ETF 가 아니라 배당이 없다 */
  | "kospi_index"
  /** KODEX 200(069500) — 지수를 따르는 ETF, 배당이 있다 */
  | "kospi"
  | "6040" | "allweather";

/** 자산배분 백테스트 요청 — 서버 자산배분요청 */
export interface 자산배분요청 {
  assets: 배분자산[];
  currency: "KRW" | "USD";
  initial_amount: number;
  start_date: string;
  end_date: string;
  contribution_period: 주기;
  contribution_amount: number;
  rebalance_period: 주기;
  /** 배당을 재투자해 '토탈 리턴' 으로 잴까 */
  total_return: boolean;
  /** 달의 며칠에 리밸런싱·적립을 할까 (1~28) */
  rebalance_day: number;
  /** 거래비용 **퍼센트**. 0.1 이면 0.1% — 서버가 100 으로 나눈다 */
  cost_rate: number;
  benchmark: 벤치마크키;
  /** 적은 비중을 무시하고 똑같이 나눌까 */
  equal_weight: boolean;
  /** ETF 가 생기기 전 구간을 지수로 이을까 */
  extended: boolean;
  /** 현금에 붙는 연 이율 **퍼센트**. 0 이면 '현금은 안 불어난다' 는 가정 */
  cash_rate: number;
  /** 진행 상황을 적어 둘 열쇠. 화면이 만들어 보내고 따로 물어본다 */
  progress_key?: string;
  /** 샤프를 잴 때 뺄 무위험수익률 **퍼센트** */
  risk_free_rate: number;
}

/** 벤치마크 결과 — 견주는 데 필요한 것만 온다(곡선까지 다 담으면 응답이 두 배다) */
/** 서버가 알려 주는 진행 상황. 어림이 아니라 실제로 한 일이다 —
 *  시세를 여덟 중 셋 받았으면 done 3 · total 8 이다. */
export interface 서버진행 {
  단계: string;
  done: number;
  total: number;
  글: string;
  /** 0~99. 100 은 응답이 실제로 왔을 때만이다 */
  percent: number;
}

export interface 벤치마크결과 {
  key: string;
  name: string;
  contributed: number;
  final_value: number;
  total_return: number | null;
  twr_annual: number | null;
  irr_annual: number | null;
  mdd: number | null;
  volatility: number | null;
  sharpe: number | null;
  sortino?: number | null;
  best_month?: number | null;
  worst_month?: number | null;
  positive_months?: number;
  total_months?: number;
  this_month?: number | null;
  ytd?: number | null;
  return_1y?: number | null;
  return_3y?: number | null;
  return_5y?: number | null;
  std_1y?: number | null;
  std_3y?: number | null;
  std_5y?: number | null;
  mdd_date?: string | null;
  crises?: { key: string; name: string; mdd: number }[];
  /** 해마다의 수익률 — 내 것과 **해별로** 견준다.
   *
   *  전체 수익률 하나로는 '언제 이겼나' 를 알 수 없다. 8년 중 6년을
   *  지고도 한 해에 몰아쳐서 총합만 이긴 조합과, 해마다 조금씩 이긴
   *  조합은 전혀 다른 것인데 합계는 비슷하게 나온다. */
  yearly?: { year: number; return: number }[];
  curve: { date: string; value: number }[];
  /** 내 것과 나란히 그리려고 같이 받는다 */
  drawdown?: { date: string; dd: number }[];
  /** 지수 자체를 견주는 경우 — ETF 가 아니라 **배당이 없다**.
   *  토탈 리턴으로 잰 내 조합과는 그만큼 기준이 다르다. */
  index_only?: boolean;
}

/** 자산배분 백테스트 결과.
 *
 *  **연환산이 두 가지인 이유** — 적립식에서는 둘이 다른 질문에 답한다.
 *  twr_annual 은 넣고 뺀 시점의 영향을 지운 값이라 전략끼리 비교할 때
 *  쓰고, irr_annual 은 내가 실제로 번 연 수익률이다. 둘 중 하나만
 *  보여 주면 그 차이가 통째로 사라진다. */
export interface 자산배분결과 {
  start_date: string;
  end_date: string;
  years: number;
  /** 실제로 넣은 돈의 합 (초기 + 적립 전부) */
  contributed: number;
  final_value: number;
  profit: number;
  /** 내 돈 대비 얼마나 불었나 — 적립식에서 유일하게 정직한 수 */
  total_return: number | null;
  twr_annual: number | null;
  irr_annual: number | null;
  mdd: number | null;
  volatility: number | null;
  sharpe: number | null;
  dividends: number | null;
  yearly: { year: number; return: number }[];
  curve: { date: string; value: number }[];
  currency: "KRW" | "USD";
  assets: 배분자산[];
  /** 시세를 못 받아 뺀 자산 — 조용히 빼면 사용자가 다 담은 줄 안다 */
  skipped: string[];
  /** 환율을 못 맞춰 뺀 자산 */
  fx_skipped: string[];
  mixed_currency: boolean;
  /** 거래비용이 반영됐나 */
  costs_included: boolean;
  /** 낸 수수료 합. 0%로 돌렸으면 null — '안 넣었다' 와 '0원' 은 다른 말이다 */
  costs: number | null;
  cost_rate: number | null;
  /** 날마다의 낙폭(%). 0 이 고점, 음수가 내려온 정도.
   *  **mdd 와 같은 곡선에서 잰 값**이다 — 화면이 curve 로 다시 재면
   *  적립식에서 둘이 어긋난다(넣은 돈이 하락을 가린다). */
  drawdown: { date: string; dd: number }[];
  /** 깊은 낙폭 몇 개. end 가 null 이면 아직 고점을 못 되찾은 것이다 */
  drawdowns: {
    start: string; trough: string; end: string | null;
    depth: number; to_trough_days: number;
    recovery_days: number | null; underwater_days: number;
  }[];
  /** 내려간 흔들림만 위험으로 센 값. 크게 오르기만 해도 '위험' 으로
   *  잡히는 샤프의 약점을 메운다. */
  sortino: number | null;
  /** 달마다의 수익률 — 한 해 안의 출렁임은 연 수익률에 안 남는다 */
  monthly: { month: string; return: number }[];
  best_month: number | null;
  worst_month: number | null;
  /** 오른 달 / 전체 달 */
  positive_months: number;
  total_months: number;
  this_month: number | null;
  ytd: number | null;
  /** 최근 1·3·5년. 자료가 거기까지 없으면 null — 3개월치를
   *  '1년 수익률' 이라 적으면 안 된다. */
  return_1y: number | null;
  return_3y: number | null;
  return_5y: number | null;
  std_1y: number | null;
  std_3y: number | null;
  std_5y: number | null;
  /** 낙폭이 **언제** 바닥이었나 */
  mdd_date: string | null;
  /** 이름 붙은 폭락 때 얼마나 빠졌나. 겹치는 자료가 없으면 그 줄이 없다 */
  crises: {
    key: string; name: string; start: string; end: string;
    measured_start: string; measured_end: string;
    /** **그 구간을 지나는 동안** 제일 나빴을 때(음수 %).
     *
     *  구간을 통째로 지나고 난 수익률은 받지 않는다 — 시작과 끝 두
     *  점으로만 말한 수라, -12% 로 끝난 구간이 중간에 -30% 까지 갔어도
     *  -12% 로 적힌다. 그 시절을 견딘 사람이 본 것은 낙폭 쪽이다.
     *
     *  넣은 돈을 지운 곡선에서 잰다 — 화면의 최대 낙폭과 같은 기준이다. */
    mdd: number;
    /** 요청한 구간의 일부만 겹쳤나 */
    partial: boolean;
  }[];
  /** 무엇을 가정하고 잰 수인가 — 0 도 가정이라 감추지 않는다 */
  risk_free_rate: number;
  cash_rate: number;
  benchmark: 벤치마크결과 | null;
  /** 요청한 기간 — 실제로 잰 start_date/end_date 와 견줘 '짧아졌나' 를 안다.
   *  저장한 실험을 다시 열면 설정이 화면에 없으므로 응답에 실려 와야 한다. */
  requested_start?: string;
  requested_end?: string;
  /** 자산마다 자료가 **언제부터 언제까지** 있나.
   *
   *  모든 자산에 값이 있는 날만 재므로, 늦게 상장한 자산 하나가 앞을
   *  통째로 잘라낸다. 누가 잘랐는지 알아야 그 자산을 빼거나 '확장' 을
   *  켜는 식으로 손을 쓸 수 있다. */
  asset_range?: Record<string, { first: string; last: string }>;
  /** {심볼: 지수로 이은 시작일}. 조용히 이으면 사용자는 그게 실제
   *  ETF 자료인 줄 안다 — 지수에는 배당도 운용보수도 없다 */
  extended_from: Record<string, string>;
}

export interface 저장된실험 {
  id: number;
  name: string;
  currency: "KRW" | "USD";
  initial_amount: number;
  start_date: string;
  end_date: string;
  assets: 배분자산[];
  contribution_period: 주기;
  contribution_amount: number;
  rebalance_period: 주기;
  /** 뒤늦게 붙은 칸들 — 이 기능이 생기기 전에 저장한 실험에는 없다.
   *  없으면 화면이 지금 값을 그대로 쓴다(undefined 를 넣으면 고르기
   *  칸이 통제 불능이 된다) */
  rebalance_day?: number | null;
  cost_rate?: number | null;
  benchmark?: 벤치마크키 | null;
  equal_weight?: boolean | null;
  cash_rate?: number | null;
  risk_free_rate?: number | null;
  extended?: boolean | null;
  total_return: boolean;
  created_at: string;
}

/** 저장해 두는 전략 — 서버 StrategySaveRequest */
export interface 전략저장 {
  name: string;
  description?: string | null;
  market: string;
  entry_conditions: ConditionGroup;
  exit_conditions: ConditionGroup;
  stop_loss?: number | null;
  take_profit?: number | null;
}

export const backtestApi = {
  /* ── 백테스트는 **무거운상한**을 쓴다 ──
   *
   *  보통 상한(30초)을 그대로 두면 정상 동작 중에도 끊긴다. 무료
   *  서버를 깨우는 데만 20~50초가 들고, 거기에 계산이 더해지기
   *  때문이다. 끊기면 화면에는 '서버에 연결하지 못했습니다' 로 뜨는데,
   *  그때 서버는 멀쩡히 계산 중이다(client.ts 의 무거운상한 참고). */
  run: (payload: 백테스트요청) =>
    api.post("/backtest/run", payload, { timeout: 무거운상한 }).then((r) => r.data),

  runUniverse: (payload: 전종목백테스트요청) =>
    api.post("/backtest/universe", payload, { timeout: 무거운상한 })
      .then((r) => r.data),

  /** 자산배분 백테스트 — 여러 자산을 비중대로 담아 적립·리밸런싱하며 굴린다.
   *
   *  위의 run/runUniverse 와는 **다른 종류**다. 그쪽은 한 종목에 매매
   *  신호를 걸어 보는 것이고, 이쪽은 '이렇게 굴렸으면 어떻게 됐을까' 다. */
  runPortfolio: (payload: 자산배분요청) =>
    api.post<자산배분결과>("/backtest/portfolio", payload, { timeout: 무거운상한 })
      .then((r) => r.data),

  /** 서버가 지금 어디까지 했나 — **어림이 아니라 실제**.
   *
   *  진행 표시는 덤이다. 못 받아도 계산은 그대로 도므로 오류를 위로
   *  올리지 않고 null 을 준다 — 여기서 throw 하면 진행바 하나 때문에
   *  화면이 '실패' 로 바뀐다. */
  getPortfolioProgress: (key: string): Promise<서버진행 | null> =>
    api.get<서버진행 | Record<string, never>>(
      `/backtest/portfolio/progress/${encodeURIComponent(key)}`)
      .then((r) => ("percent" in r.data ? (r.data as 서버진행) : null))
      .catch(() => null),

  getExperiments: () =>
    api.get<저장된실험[]>("/backtest/experiments").then((r) => r.data),

  saveExperiment: (payload: 자산배분요청 & { name: string }) =>
    api.post<저장된실험>("/backtest/experiments", payload).then((r) => r.data),

  deleteExperiment: (id: number) =>
    api.delete(`/backtest/experiments/${id}`).then((r) => r.data),

  getResults: (limit = 20) =>
    api.get("/backtest/results", { params: { limit } }).then((r) => r.data),

  getResult: (id: number) =>
    api.get(`/backtest/results/${id}`).then((r) => r.data),

  getStrategies: () =>
    api.get("/backtest/strategies").then((r) => r.data),

  saveStrategy: (payload: 전략저장) =>
    api.post("/backtest/strategies", payload).then((r) => r.data),

  updateStrategy: (id: number, payload: 전략저장) =>
    api.put(`/backtest/strategies/${id}`, payload).then((r) => r.data),

  deleteStrategy: (id: number) =>
    api.delete(`/backtest/strategies/${id}`).then((r) => r.data),
};
