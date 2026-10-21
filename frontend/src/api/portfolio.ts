/** 내 자산 — 보유 종목·평가액 흐름·배당·보유 뉴스. 화면은 '@/api/stocks' 에서 가져간다(거기서 다시 내보낸다). */
import api from "./client";

/** 자산 흐름 그래프의 한 점. 서버가 하루 한 줄씩 남긴 것 */
export interface 자산흐름점 {
  /** "2026-08-26" — 한국 날짜 */
  day: string;
  /** 원화 환산 평가금액·매입금액 */
  value: number;
  cost: number;
  /** 그날 시세를 실제로 구한 종목 수 / 시세가 있어야 하는 종목 수 */
  filled: number;
  priced: number;
}

/** 배당 달력 한 줄 — 종목 하나의 다음 배당 */
/** 한 달치 배당 일정 — 종목 배당과 배당 달력이 같은 모양을 쓴다 */
export interface 배당월칸 {
  month: number;
  /** 그 달에 마지막으로 준 날. 주배당은 days 를 봐야 정확하다 */
  day: number;
  /** 그 달 **합계**. 주배당이면 네다섯 회차를 더한 값이다 */
  amount: number;
  year: number | null;
  /** 이 칸이 **올해** 실제 지급에서 나왔나.
   *
   *  한 종목의 열두 칸은 서로 다른 해에서 나온다 — 오늘이 8월이면
   *  1~8월은 올해, 9~12월은 작년이다. 화면이 그걸 밝혀야 한다.
   *  예전에는 연도를 안 보고 모든 칸에 '작년 기준' 을 붙여서, 올해
   *  3월에 받은 값 위에도 그 말이 찍혔다. */
  올해확정?: boolean;
  /** 작년 금액에 곱한 **올해 흐름**. 1 이면 안 건드린 것이다.
   *
   *  아직 안 온 달은 근거가 작년 같은 달뿐이다. 그런데 배당은 대개
   *  해마다 달라진다 — 작년 값을 그대로 쓰면 그만큼 어긋난다.
   *  올해 이미 받은 달들이 작년 같은 달보다 10% 늘었으면 안 온 달에도
   *  10% 를 얹는다. 화면이 그 사실을 밝힐 수 있게 비율을 같이 싣는다. */
  조정?: number;
  /** 그 달에 **날짜별로** 얼마씩 받았나.
   *
   *  주배당(연 52회)은 한 달에 네다섯 번 준다. 한 칸으로 접으면
   *  날짜는 마지막 회차인데 금액은 그 달 합계라 둘의 기준이 어긋난다. */
  days?: { date: string; amount: number }[];
  /** 이 칸이 **실제 지급 내역**에서 나온 것인가.
   *
   *  주·월배당은 아직 한 해가 안 찬 종목에서 빈 달이 생기는데, 서버가
   *  있는 달들의 평균으로 메운다. 그건 실제로 받은 값이 아니다 —
   *  화면이 '평균' 이라고 밝힐 수 있게 표시가 온다. */
  actual?: boolean;
}

export interface 배당줄 {
  symbol: string;
  market: string;
  name: string;
  /** 다음 배당기준일. confirmed 가 false 면 지난 주기로 미뤄 본 추정치다 */
  date: string;
  confirmed: boolean;
  /** 회사가 공시한 날짜(있을 때만) */
  ex_date: string | null;
  pay_date: string | null;
  /** "주" | "월" | "분기" | "반기" | "연" */
  cycle: string | null;
  /** 몇 월에 주나 — [2, 5, 8, 11]. 주·월배당은 1~12 전부.
   *  분기배당이라도 회사마다 달이 달라서(2·5·8·11 vs 3·6·9·12)
   *  이게 없으면 한 해 그림이 통째로 틀린다 */
  months: number[];
  /** 한 달에 몇 번 받나. 주배당만 1보다 크다(≈4.35) */
  per_month: number;
  /** "KRW" | "USD" — 원화로 환산할 때 쓴다 */
  currency: string;
  last_date: string;
  last_amount: number;
  /** 지난 1년에 **실제로** 준 주당 합계 */
  per_year: number;
  /** 앞으로 한 해 줄 것으로 보이는 주당 합계.
   *
   *  per_year 와 다를 수 있다 — 반년 전에 배당을 시작한 종목은 지난 1년
   *  합이 반년치뿐이다. 화면이 '한 해 예상' 으로 쓰는 것은 이쪽이다. */
  plan_year?: number;
  /** 달마다 며칠에 주당 얼마.
   *
   *  이게 없던 때는 마지막 회차 금액을 열두 달에 다 썼다. 분기배당은
   *  회차마다 금액이 다르므로(결산배당이 붙는 분기가 특히 크다) 그
   *  방식은 한 해 예상을 통째로 틀리게 만든다. */
  schedule?: 배당월칸[];
  /** 앞으로 받을 날들 — 주·월배당만. **전부 추정이다.**
   *  지난 지급(schedule[].days)과 다른 배열로 온다 — 섞으면 안 된다 */
  upcoming?: { date: string; amount: number }[];
  /** 공시된 날짜 원본. 지난 것도 담긴다.
   *  '기준일은 지났고 지급일만 남았다' 를 화면이 말할 수 있게 */
  ex_date_공시?: string | null;
  pay_date_공시?: string | null;
  shares: number;
  /** 이번 회차의 **주당** 금액.
   *
   *  last_amount(마지막 회차)와 다르다. 분기배당은 회차마다 금액이
   *  달라서(결산배당이 붙는 분기가 크다) 마지막 회차는 다음 회차와
   *  아무 상관이 없다. 서버가 그 달에 실제로 준 금액을 골라 준다. */
  next_amount?: number;
  /** 해·달마다 실제로 받은 합계 — 지난 내역을 압축한 것.
   *
   *  달력 응답은 recent(원본, 주배당이면 104건)를 안 싣는다. 화면이
   *  쓰는 것은 '그 달에 해마다 얼마였나' 두 줄뿐인데, 원본은 열두
   *  종목 응답의 절반을 차지했다. */
  월별지난?: { year: number; month: number; amount: number }[];
  /** 이번 회차·한 해에 받을 것으로 보이는 돈. 안 갖고 있으면 null */
  expected: number | null;
  expected_year: number | null;
  /** 지난 지급 원본. **달력 응답에는 안 온다** — 월별지난을 쓴다 */
  recent?: { date: string; amount: number }[];
}

/** 보유 종목 뉴스 한 건 — 어느 종목으로 걸렸는지가 같이 온다 */
export interface 보유뉴스항목 {
  title: string;
  link: string;
  source: string;
  /** "2026/08/26 14:30" 처럼 이미 사람이 읽는 모양으로 온다 */
  published: string;
  published_ts: number;
  summary: string;
  image?: string | null;
  /** 이 기사가 걸린 내 종목들. 한 기사가 두 종목에 걸리기도 한다 */
  symbols: string[];
  /** 어느 통에서 나온 기사인가 — "ko" 한국 매체, "en" 해외 매체.
   *
   *  '종목의 시장' 이 아니다. 엔비디아 얘기를 한국 매체가 쓰면 그건
   *  한국 기사다. 옛 캐시에는 이 칸이 없어서 화면이 제목으로 되짚는다. */
  lang?: "ko" | "en";
}

export interface 보유뉴스응답 {
  items: 보유뉴스항목[];
  /** 기사를 찾은 종목 */
  covered: string[];
  /** 지금 서버가 배경에서 받아 오는 중인 종목 수.
   *  0 보다 크면 몇 초 뒤에 한 번 더 물어보면 더 채워져 있다 */
  pending: number;
  /** 아직 못 찾은 종목 — 서버가 새로 받아 오지 않으므로 숨기지 않고 알려 준다.
   *  종목 상세 주소가 /stocks/{market}/{symbol} 이라 시장이 같이 와야 한다 */
  missing: { symbol: string; market: string; name: string }[];
}

export const portfolioApi = {
  getPortfolios: () =>
    api.get("/portfolio/portfolios").then((r) => r.data),

  createPortfolio: (name: string) =>
    api.post("/portfolio/portfolios", { name }).then((r) => r.data),

  renamePortfolio: (id: number, name: string) =>
    api.put(`/portfolio/portfolios/${id}`, { name }).then((r) => r.data),

  deletePortfolio: (id: number) =>
    api.delete(`/portfolio/portfolios/${id}`).then((r) => r.data),

  reorderPortfolios: (order: number[]) =>
    api.put("/portfolio/portfolios/reorder", { order }).then((r) => r.data),

  /** 내 자산이 하루하루 얼마였는지 — 자산 흐름 그래프의 재료.
   *  portfolioId 를 주면 그 포트폴리오 것만, 안 주면 전체 합계. */
  getHistory: (days = 90, portfolioId?: number) =>
    api.get<{ points: 자산흐름점[]; days: number; portfolio_id?: number | null }>(
      "/portfolio/history",
      { params: portfolioId ? { days, portfolio_id: portfolioId } : { days } },
    ).then((r) => r.data),

  /** 내가 가진 종목이 언제 얼마를 주는가.
   *  portfolioId 를 주면 그 포트폴리오 것만, 안 주면 전체. */
  getDividends: (portfolioId?: number) =>
    api.get<{ items: 배당줄[]; pending: number }>("/portfolio/dividends",
      { params: portfolioId ? { portfolio_id: portfolioId } : {} }).then((r) => r.data),

  /** 내 종목 얘기를 한 자리에.
   *
   *  서버는 요청을 붙잡지 않는다 — 캐시에 없는 종목은 배경에서 받아
   *  오고 pending 으로 몇 개가 오는 중인지 알려 준다. */
  getHoldingNews: (portfolioId?: number) =>
    api.get<보유뉴스응답>("/portfolio/news",
      { params: portfolioId ? { portfolio_id: portfolioId } : {} }).then((r) => r.data),

  getItems: (portfolioId?: number, viewAll?: boolean) =>
    api.get("/portfolio/items", {
      params: viewAll ? { view_all: true } : (portfolioId ? { portfolio_id: portfolioId } : {}),
    }).then((r) => r.data),

  /**
   * 보유 목록 + **이미 받아 둔 시세**를 한 번에.
   *
   * 시세를 따로 물어보면 왕복이 두 번이다 — 종목을 받아야 무엇의
   * 시세를 물어볼지 알기 때문에, 뒤엣것은 앞엣것이 올 때까지 시작도
   * 못 한다. 그동안 총자산·손익·비중이 전부 빈칸이다.
   *
   * 서버는 캐시에 있는 것만 얹는다(바깥 호출 0). 없는 종목은 빠지고,
   * 화면은 늘 하던 시세 조회로 마저 채운다 — 덤이지 대체가 아니다.
   */
  getItemsWithPrices: (portfolioId?: number, viewAll?: boolean) =>
    api.get<{ items: unknown[]; prices: unknown[] }>("/portfolio/items", {
      params: {
        ...(viewAll ? { view_all: true } : (portfolioId ? { portfolio_id: portfolioId } : {})),
        with_prices: true,
      },
    }).then((r) => r.data),

  addItem: (payload: {
    portfolio_id?: number | null;
    symbol: string; market: string; name: string;
    shares: number; avg_price: number; currency: string;
    input_exchange_rate?: number | null;
    purchase_date?: string | null;
    note?: string | null;
    asset_class?: string | null;
  }) =>
    api.post("/portfolio/items", payload).then((r) => r.data),

  updateItem: (id: number, payload: {
    portfolio_id?: number | null;
    symbol: string; market: string; name: string;
    shares: number; avg_price: number; currency: string;
    input_exchange_rate?: number | null;
    purchase_date?: string | null;
    note?: string | null;
    asset_class?: string | null;
  }) =>
    api.put(`/portfolio/items/${id}`, payload).then((r) => r.data),

  deleteItem: (id: number) =>
    api.delete(`/portfolio/items/${id}`).then((r) => r.data),

  /* 자산배분 백테스트는 아래 backtestApi 쪽에 있다 */
  getPublicPortfolios: (userId: number) =>
    api.get(`/portfolio/public/${userId}`).then((r) => r.data),

  /** 남의 공개 포트폴리오 + **이미 받아 둔 시세**를 한 번에.
   *  내 자산과 같은 이유다 — 따로 물으면 왕복이 두 번이고, 그 사이
   *  평가금액·비중이 통째로 빈칸이다. */
  getPublicPortfoliosWithPrices: (userId: number) =>
    api.get<{ portfolios: unknown[]; prices: unknown[] }>(
      `/portfolio/public/${userId}`, { params: { with_prices: true } },
    ).then((r) => r.data),
};
