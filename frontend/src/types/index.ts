export type Market = "KR" | "US" | "ETF";

export interface StockPrice {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  change_rate: number;
  volume: number;
  market_cap: number;
  currency?: string;
  high?: number;
  low?: number;
  open?: number;
}

export interface StockFundamentals {
  per?: number | null;
  forward_per?: number | null;
  pbr?: number | null;
  roe?: number | null;
  eps?: number | null;
  debt_ratio?: number | null;
  week52_high?: number;
  week52_low?: number;
  dividend_yield?: number | null;
  sector?: string;
  industry?: string;
}

export interface StockDetail extends StockPrice, StockFundamentals {}

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketIndex {
  index: string;
  name?: string;
  value: number;
  change: number;
  change_rate: number;
}

/** 관심종목 한 줄. 서버 watchlist.py 의 _item_to_dict 와 같은 모양이다.
 *
 *  화면이 이걸 `as any` 로 다루고 있었다. 서버가 주는 칸을 적어 두면
 *  이름을 잘못 써도 빌드가 짚어 준다 — any 로 두면 화면이 조용히 빈칸을
 *  그리고 아무도 모른다(지난번 실적 응답에서 그렇게 겪었다). */
export interface WatchlistItem {
  id: number;
  symbol: string;
  market: Market;
  name: string;
  memo?: string;
  folder_id?: number | null;
  folder_name?: string | null;
  added_at?: string;
  position?: number;
  /* 시세는 /items/prices 로 받을 때만 붙는다. 못 받은 종목은 null 이 온다 */
  price?: number | null;
  change?: number | null;
  change_rate?: number | null;
  volume?: number | null;
  currency?: string;
}

/** 여러 종목의 시세를 한 번에 받을 때 오는 한 줄.
 *  못 받은 종목도 자리는 오고 값만 null 이다 — 목록에서 그 줄이
 *  통째로 빠지면 '내가 넣은 종목이 사라졌다' 로 보인다. */
export interface 시세행 {
  symbol: string;
  market?: Market;
  name?: string;
  price: number | null;
  change?: number | null;
  change_rate?: number | null;
  volume?: number | null;
  currency?: string;
}

/** 관심종목 폴더. 서버 watchlist.py 의 GET /folders 응답 */
export interface 관심폴더 {
  id: number;
  name: string;
  position: number;
  /** 그 폴더에 든 종목 수 — 서버가 세어서 준다 */
  count: number;
}

export interface Watchlist {
  id: number;
  name: string;
  items: WatchlistItem[];
}

export interface ScreeningFilter {
  per?: { min?: number; max?: number };
  pbr?: { min?: number; max?: number };
  roe?: { min?: number; max?: number };
  eps?: { min?: number; max?: number };
  debt_ratio?: { min?: number; max?: number };
  market_cap?: { min?: number; max?: number };
  change_rate?: { min?: number; max?: number };
}

export interface ScreeningPreset {
  id: number;
  name: string;
  market: Market;
  filters: ScreeningFilter;
  sort_by: string;
  sort_order: string;
}

export type IndicatorType = "MA" | "RSI" | "MACD" | "BB" | "PRICE" | "VOLUME";
export type OperatorType = ">" | "<" | ">=" | "<=" | "==" | "crosses_above" | "crosses_below";

export interface Condition {
  indicator: IndicatorType;
  operator: OperatorType;
  value: number | string;
  period?: number;
}

export interface ConditionGroup {
  logic: "AND" | "OR";
  conditions: Condition[];
}

export interface Strategy {
  id: number;
  name: string;
  description?: string;
  version: number;
  market: Market;
  entry_conditions: ConditionGroup;
  exit_conditions: ConditionGroup;
  stop_loss?: number;
  take_profit?: number;
  created_at: string;
}

export interface BacktestResult {
  id: number;
  symbol: string;
  market: Market;
  start_date: string;
  end_date: string;
  initial_capital: number;
  total_return: number;
  annual_return: number;
  mdd: number;
  sharpe_ratio: number;
  win_rate: number;
  total_trades: number;
  equity_curve: { date: string; value: number }[];
  trades: Trade[];
  created_at: string;
}

export interface Trade {
  type: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  pnl_rate: number;
  shares: number;
}


/* ── 화면이 실제로 읽는 응답들 ────────────────────────────
 *
 * api/stocks.ts 가 이 자리들을 any 로 두고 있었다. 그 결과 이걸 쓰는
 * 화면에서도 any 가 퍼져 나갔다(전체 318곳). 응답 모양을 한 번 적어 두면
 * 화면 쪽 any 가 연쇄로 줄고, 서버가 필드 이름을 바꿨을 때 화면이
 * 조용히 빈칸을 그리는 대신 빌드에서 걸린다.
 *
 * 서버가 주는 것을 그대로 적는다 — 없을 수 있는 값은 ? 로 둔다.
 * 여기서 낙관하면(필수로 적으면) 실제로 안 올 때 화면이 터진다. */

/** 뉴스 한 건. 종목 뉴스와 대시보드 뉴스가 같은 모양이다 */
export interface 뉴스항목 {
  title: string;
  link: string;
  source: string;
  /** "08/21 14:30" 처럼 이미 사람이 읽는 모양으로 온다 */
  published?: string;
  published_ts?: number;
  summary?: string;
  /** 썸네일. RSS 에 없는 곳이 많아 자주 비어 있다 */
  image?: string | null;
}

/** 환율·금리·변동성 카드 한 장 */
export interface 지표카드 {
  name: string;
  value: number;
  change?: number;
  change_rate?: number;
  /** "원", "%", "pt" */
  unit?: string;
  is_rate?: boolean;
  /** 지어낸 값이라는 표시. 화면에 DEMO 배지가 붙는다 */
  _demo?: boolean;
  _static?: boolean;
}

/** 선물. 값 이름이 price 인 것에 주의 — 지표카드와 다르다 */
export interface 선물항목 {
  name: string;
  symbol?: string;
  price: number;
  change?: number;
  change_rate?: number;
  unit?: string;
}

/** 순위표 한 줄 */
export interface 순위행 extends StockPrice {
  rank?: number;
  amount?: number;
  per?: number | null;
  roe?: number | null;
}

/** 대시보드 한 탭 전체 */
export interface 대시보드응답 {
  indices: MarketIndex[];
  rankings: 순위행[];
  rates: 지표카드[];
  futures?: 선물항목[];
  exchange?: 지표카드 & { usdkrw?: number };
  news: 뉴스항목[];
  category: string;
  _has_kis?: boolean;
}

/** 실적 발표. 지난 것과 다가올 것이 함께 온다.
 *
 *  처음엔 필드 이름을 짐작해서 적었는데(next_date, eps_actual) 서버가
 *  주는 것과 달랐다. 타입을 붙이자마자 빌드가 그 자리를 전부 짚어 줬다 —
 *  any 로 두면 화면이 조용히 빈칸을 그리고 아무도 모른다.
 *  아래는 backend/app/api/routes/stocks.py 의 earnings 응답 그대로다. */
export interface 실적응답 {
  /** 지난 실적. 연 단위이고 매출·순이익이 함께 온다 */
  history: { period: string; revenue: number; earnings: number }[];
  /** 다가올 발표일. "2026-08-21" 모양의 문자열 */
  upcoming: string[];
  eps_estimate?: number | null;
  revenue_estimate?: number | null;
}

/** 애널리스트 전망 한 줄.
 *
 *  여기 적힌 이름이 서버와 달랐다 — revenue·eps 로 적어 뒀는데 서버는
 *  revenue_est·eps_est 를 준다. 화면은 `as any` 로 우회하고 있어서
 *  아무도 몰랐다. 실제로 선행PER 을 보완하는 자리가 이 이름으로 값을
 *  꺼내는데, 타입만 보면 늘 빈 값처럼 보인다.
 *
 *  backend stocks.py 의 get_forecasts 안 _upsert 가 넣는 이름 그대로
 *  적는다. period 와 type 은 _upsert 가 늘 넣으므로 필수다. */
export interface 전망행 {
  period: string;
  /** 서버는 항상 "forecast" 를 넣는다 */
  type: string;
  /* EPS 추정 */
  eps_est?: number | null;
  eps_low?: number | null;
  eps_high?: number | null;
  eps_analysts?: number | null;
  /* 추정치가 어떻게 움직였는지 */
  eps_current?: number | null;
  eps_7d_ago?: number | null;
  eps_30d_ago?: number | null;
  eps_90d_ago?: number | null;
  /* 매출 추정 */
  revenue_est?: number | null;
  revenue_low?: number | null;
  revenue_high?: number | null;
  /* 성장률 추정 */
  growth_est?: number | null;
}

/** 컨센서스 응답. 서버는 연간·분기를 함께 준다.
 *
 *  api 쪽 타입이 전망행[] 로 적혀 있었다 — 서버는
 *  {annual, quarterly} 를 주는데 배열이라고 선언해 놓은 것이라,
 *  화면이 `as any` 로 우회하고 있었다. 그러면 여기 이름이 하나
 *  바뀌어도 빌드가 아무 말을 안 한다(투자의견 탭이 조용히 빈다).
 *  backend stocks.py 의 get_forecasts 응답 그대로 적는다. */
export interface 전망응답 {
  annual: 전망행[];
  quarterly: 전망행[];
}

/** 분기·연간 지표 흐름 */
export interface 지표흐름 {
  annual: Record<string, unknown>[];
  quarterly: Record<string, unknown>[];
}
