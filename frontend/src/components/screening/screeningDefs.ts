/**
 * 스크리닝 화면의 칸·조건·조건 묶음·숫자 글자.
 *
 * 사용자: "스크리닝 사이트 참고해줘" → "일단 할수있는건 다해줘". 참고한 스크리너처럼 시가총액 순으로
 * 열고, 칸 제목으로 세우고, 칸과 조건을 골라 좁힌다.
 *
 * 칸·조건 열쇠는 서버의 스크리닝_숫자키·스크리닝_글자키와 같아야 한다. 모르는 열쇠로 거르면 모든
 * 종목이 '값 없음' 으로 떨어져 결과가 조용히 0개가 된다 — 서버 시험(test_스크리닝.py)이 이 파일을
 * 읽어 맞춰 본다. 그래서 열쇠는 늘 `key: "..."` 모양으로 적는다.
 */
import type { CSV칸 } from "@/utils/csv";

/** 칸 값을 그리는 모양 */
export type 칸모양 =
  | "돈"        // 시가총액·매출처럼 큰 돈 — $5.57T · 3,021억
  | "가격"      // 주가 — $230.68 · ₩71,000
  | "등락"      // ▲ +2.49% — 오르면 설정의 오름 색
  | "부호"      // +2.54% — 색 없이 부호만(52주 고점 대비 등)
  | "배수"      // 29.02
  | "퍼센트"    // 0.23%
  | "성장"      // +16.7%
  | "흐름"      // 연도별 막대
  | "글"        // 섹터·산업·국가
  | "수"        // EPS — 소수 둘째 자리
  | "정수"      // RSI
  | "거래량";   // 5,123.5만

export interface 칸정의 {
  key: string;
  이름: string;
  모양: 칸모양;
  처음보임: boolean;
  /** 칸 제목을 눌러 세울 수 있나 — 서버가 숫자로 세우는 칸만(흐름·글 칸은 못 세운다) */
  세움?: false;
  /** 회사 장부의 돈 단위(fin_currency)로 적힌 칸인가 — 4년 흐름 막대. 서버가 환율을 알면 장부 돈(TSMC 대만 달러)을
   *  시세 돈(달러)으로 바꿔 보내고 원래 돈을 fin_fx 에 적는다. 최근 1년 실적(매출·순이익…)도 시세 돈이다 */
  장부?: true;
  /** ETF 에서 부르는 이름 — 시가총액 자리에 서버가 순자산을 넣는다 */
  ETF이름?: string;
}

/** 표의 칸 — 앞의 열다섯이 처음 보이는 칸(참고한 스크리너의 기본 칸) */
export const 칸들: 칸정의[] = [
  { key: "market_cap",         이름: "시가총액",          모양: "돈",     처음보임: true, ETF이름: "순자산" },
  { key: "price",              이름: "현재가",            모양: "가격",   처음보임: true },
  { key: "change_rate",        이름: "오늘",              모양: "등락",   처음보임: true },
  { key: "rev_hist",           이름: "매출 흐름",         모양: "흐름",   처음보임: true, 세움: false, 장부: true },
  { key: "eps_hist",           이름: "EPS 흐름",          모양: "흐름",   처음보임: true, 세움: false, 장부: true },
  { key: "pct_from_52w_high",  이름: "52주 고점 대비",    모양: "부호",   처음보임: true },
  { key: "per",                이름: "PER",               모양: "배수",   처음보임: true },
  { key: "forward_per",        이름: "예상 PER",          모양: "배수",   처음보임: true },
  { key: "earnings",           이름: "순이익(1년)",       모양: "돈",     처음보임: true },
  { key: "revenue",            이름: "매출(1년)",         모양: "돈",     처음보임: true },
  { key: "forward_eps_growth", 이름: "예상 EPS 성장률",   모양: "성장",   처음보임: true },
  { key: "dividend_yield",     이름: "배당수익률",        모양: "퍼센트", 처음보임: true },
  { key: "operating_margin",   이름: "영업이익률",        모양: "퍼센트", 처음보임: true },
  { key: "rev_cagr_3y",        이름: "매출 성장률(3년)",  모양: "성장",   처음보임: true },
  { key: "eps_cagr_3y",        이름: "EPS 성장률(3년)",   모양: "성장",   처음보임: true },
  { key: "pbr",                이름: "PBR",               모양: "배수",   처음보임: false },
  { key: "roe",                이름: "ROE",               모양: "퍼센트", 처음보임: false },
  { key: "roa",                이름: "ROA",               모양: "퍼센트", 처음보임: false },
  { key: "profit_margin",      이름: "순이익률",          모양: "퍼센트", 처음보임: false },
  { key: "eps",                이름: "EPS",               모양: "수",     처음보임: false },
  { key: "peg_ratio",          이름: "PEG",               모양: "배수",   처음보임: false },
  { key: "ev_ebitda",          이름: "EV/EBITDA",         모양: "배수",   처음보임: false },
  { key: "ps_ratio",           이름: "PSR",               모양: "배수",   처음보임: false },
  { key: "fcf",                이름: "FCF(1년)",          모양: "돈",     처음보임: false },
  { key: "net_debt",           이름: "순부채",            모양: "돈",     처음보임: false },
  { key: "debt_ratio",         이름: "부채비율",          모양: "퍼센트", 처음보임: false },
  { key: "current_ratio",      이름: "유동비율",          모양: "배수",   처음보임: false },
  { key: "volume",             이름: "거래량",            모양: "거래량", 처음보임: false },
  { key: "rsi",                이름: "RSI",               모양: "정수",   처음보임: false },
  { key: "beta",               이름: "베타",              모양: "배수",   처음보임: false },
  { key: "return_1m",          이름: "1개월 수익률",      모양: "등락",   처음보임: false },
  { key: "return_3m",          이름: "3개월 수익률",      모양: "등락",   처음보임: false },
  { key: "return_1y",          이름: "1년 수익률",        모양: "등락",   처음보임: false },
  { key: "pct_from_52w_low",   이름: "52주 저점 대비",    모양: "부호",   처음보임: false },
  { key: "sector",             이름: "섹터",              모양: "글",     처음보임: false, 세움: false },
  { key: "industry",           이름: "산업",              모양: "글",     처음보임: false, 세움: false },
  { key: "country",            이름: "국가",              모양: "글",     처음보임: false, 세움: false },
];

export const 처음칸 = 칸들.filter((c) => c.처음보임).map((c) => c.key);

/** ETF 에도 값이 있는 칸·조건 — ETF 는 회사가 아니라 매출·이익·장부가 없다. 그런 칸을 보이면
 *  줄마다 '—' 만 늘어서고, 그런 조건을 걸면 결과가 0개가 된다 */
export const ETF칸 = new Set([
  "market_cap", "price", "change_rate", "volume", "per", "dividend_yield", "beta", "rsi",
  "pct_from_52w_high", "pct_from_52w_low", "return_1m", "return_3m", "return_1y",
]);

export function 칸이름(칸: 칸정의, 시장?: string): string {
  return 시장 === "ETF" && 칸.ETF이름 ? 칸.ETF이름 : 칸.이름;
}

export interface 조건정의 {
  key: string;
  이름: string;
  /** 억(억원·억달러) 단위로 적게 하고 보낼 때 원래 단위로 바꾸는 돈 조건 */
  억?: true;
}

/** 조건 칸 — 무리마다 */
export const 조건묶음: { 이름: string; 조건: 조건정의[] }[] = [
  { 이름: "규모·가격", 조건: [
    { key: "market_cap", 이름: "시가총액", 억: true },
    { key: "price", 이름: "주가" },
    { key: "volume", 이름: "거래량" },
    { key: "change_rate", 이름: "오늘 등락률 (%)" },
  ] },
  { 이름: "가치", 조건: [
    { key: "per", 이름: "PER" },
    { key: "forward_per", 이름: "예상 PER" },
    { key: "pbr", 이름: "PBR" },
    { key: "peg_ratio", 이름: "PEG" },
    { key: "ev_ebitda", 이름: "EV/EBITDA" },
    { key: "ps_ratio", 이름: "PSR (주가매출비)" },
    { key: "dividend_yield", 이름: "배당수익률 (%)" },
  ] },
  { 이름: "실적 (최근 1년)", 조건: [
    { key: "revenue", 이름: "매출", 억: true },
    { key: "earnings", 이름: "순이익", 억: true },
    { key: "fcf", 이름: "FCF", 억: true },
    { key: "net_debt", 이름: "순부채", 억: true },
    { key: "operating_margin", 이름: "영업이익률 (%)" },
    { key: "profit_margin", 이름: "순이익률 (%)" },
    { key: "roe", 이름: "ROE (%)" },
    { key: "roa", 이름: "ROA (%)" },
    { key: "eps", 이름: "EPS" },
  ] },
  { 이름: "성장", 조건: [
    { key: "forward_eps_growth", 이름: "예상 EPS 성장률 (%)" },
    { key: "rev_cagr_3y", 이름: "매출 성장률 3년 (%)" },
    { key: "eps_cagr_3y", 이름: "EPS 성장률 3년 (%)" },
  ] },
  { 이름: "주가 흐름", 조건: [
    { key: "pct_from_52w_high", 이름: "52주 고점 대비 (%)" },
    { key: "pct_from_52w_low", 이름: "52주 저점 대비 (%)" },
    { key: "rsi", 이름: "RSI (14)" },
    { key: "beta", 이름: "베타" },
    { key: "return_1m", 이름: "1개월 수익률 (%)" },
    { key: "return_3m", 이름: "3개월 수익률 (%)" },
    { key: "return_1y", 이름: "1년 수익률 (%)" },
  ] },
  { 이름: "재무 건전성", 조건: [
    { key: "debt_ratio", 이름: "부채비율 (%)" },
    { key: "current_ratio", 이름: "유동비율" },
  ] },
];

/** 그 시장에서 걸 수 있는 조건 무리 — ETF 는 ETF칸 만 */
export function 시장조건묶음(시장: string) {
  if (시장 !== "ETF") return 조건묶음;
  return 조건묶음
    .map((g) => ({ ...g, 조건: g.조건.filter((c) => ETF칸.has(c.key)) }))
    .filter((g) => g.조건.length > 0);
}

/** 글자 하나로 고르는 조건(서버의 스크리닝_글자키) — 고를 값은 서버가 그 시장에서 모아 준다 */
export const 글조건: { key: "exchange" | "country" | "sector" | "industry"; 이름: string }[] = [
  /* 상장된 모든 종목을 담으면서 생긴 조건 — 코스피·코스닥·코넥스, 나스닥·NYSE … */
  { key: "exchange", 이름: "거래소" },
  { key: "country", 이름: "국가" },
  { key: "sector", 이름: "섹터" },
  { key: "industry", 이름: "산업" },
];

const 억단위 = new Set(조건묶음.flatMap((g) => g.조건.filter((c) => c.억).map((c) => c.key)));

/** 시가총액·매출 같은 돈 조건은 '억' 으로 적게 하고 보낼 때 원래 단위로 바꾼다.
 *  예전엔 칸 이름만 '(억)' 이고 숫자를 그대로 보내서, 1000 을 적으면 '시총 1000원(달러)
 *  이상' — 사실상 아무것도 안 거르는 조건이었다. */
export function 보낼조건(filters: Record<string, any>): Record<string, any> {
  const 다음: Record<string, any> = { ...filters };
  for (const [k, v] of Object.entries(filters)) {
    if (!억단위.has(k) || !v) continue;
    const 바꿈: Record<string, number> = {};
    if (v.min != null) 바꿈.min = v.min * 1e8;
    if (v.max != null) 바꿈.max = v.max * 1e8;
    다음[k] = 바꿈;
  }
  return 다음;
}

const 조건찾기 = new Map(조건묶음.flatMap((g) => g.조건.map((c) => [c.key, c] as const)));

/** 걸린 조건 한 줄 — 'PER ≤ 15' · '배당수익률 ≥ 4%' · '시가총액 ≥ 1,000억달러' · '섹터: 기술' */
export function 조건글(key: string, 값: any, 시장: string): string {
  const 글칸 = 글조건.find((g) => g.key === key);
  if (글칸) return `${글칸.이름}: ${글값(key, 값?.eq)}`;
  const c = 조건찾기.get(key);
  // 'PSR (주가매출비)' · 'RSI (14)' 의 괄호는 칸에서만 — 칩에서는 짧게. '(%)' 는 숫자 뒤로 보낸다
  const 이름 = (c?.이름 ?? key).replace(/\s*\([^)]*\)$/, "");
  const 뒤 = c?.억 ? (시장 === "KR" ? "억원" : "억달러") : /\(%\)$/.test(c?.이름 ?? "") ? "%" : "";
  const 수 = (v: number) => `${v.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}${뒤}`;
  const { min, max } = 값 ?? {};
  if (min != null && max != null) return `${이름} ${수(min)} ~ ${수(max)}`;
  if (min != null) return `${이름} ≥ ${수(min)}`;
  return `${이름} ≤ ${수(max)}`;
}

/** 두 조건 모음이 같은가(열쇠 순서는 가리지 않는다) — 고른 조건 묶음을 칠할 때 */
export function 같은조건(가: Record<string, any>, 나: Record<string, any>): boolean {
  const 펴기 = (o: Record<string, any>) =>
    JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]?.min ?? null, o[k]?.max ?? null, o[k]?.eq ?? null]));
  return 펴기(가) === 펴기(나);
}

/** 조건 묶음 — 자주 쓰는 조건 몇 가지를 한 번에(참고한 스크리너의 Preset Filters) */
export const 기본묶음: { 이름: string; 설명: string; 조건: Record<string, { min?: number; max?: number }>;
  정렬: [string, "asc" | "desc"] }[] = [
  { 이름: "저PER 우량주", 설명: "PER 15 이하 · ROE 15% 이상",
    조건: { per: { max: 15 }, roe: { min: 15 } }, 정렬: ["roe", "desc"] },
  { 이름: "고배당", 설명: "배당수익률 4% 이상",
    조건: { dividend_yield: { min: 4 } }, 정렬: ["dividend_yield", "desc"] },
  { 이름: "고성장", 설명: "매출·EPS 3년 성장률 20% 이상",
    조건: { rev_cagr_3y: { min: 20 }, eps_cagr_3y: { min: 20 } }, 정렬: ["rev_cagr_3y", "desc"] },
  { 이름: "높은 이익률", 설명: "영업이익률 25% 이상",
    조건: { operating_margin: { min: 25 } }, 정렬: ["operating_margin", "desc"] },
  { 이름: "이익 성장 기대", 설명: "예상 EPS 성장률 15% 이상 · 예상 PER 25 이하",
    조건: { forward_eps_growth: { min: 15 }, forward_per: { max: 25 } }, 정렬: ["forward_eps_growth", "desc"] },
  { 이름: "52주 고점 근처", 설명: "고점에서 5% 안쪽",
    조건: { pct_from_52w_high: { min: -5 } }, 정렬: ["pct_from_52w_high", "desc"] },
  { 이름: "과매도", 설명: "RSI 30 이하",
    조건: { rsi: { max: 30 } }, 정렬: ["rsi", "asc"] },
  { 이름: "빚보다 현금이 많은", 설명: "순부채 0 이하",
    조건: { net_debt: { max: 0 } }, 정렬: ["net_debt", "asc"] },
];

/* 섹터 값은 야후가 주는 이름 그대로다 — 서버가 그 글자와 똑같은지로 거른다.
   예전 목록의 "Financials" 는 야후가 쓰지 않는 이름("Financial Services")
   이라 금융을 고르면 늘 0개였다. */
export const SECTORS: { value: string; label: string }[] = [
  { value: "",                       label: "전체" },
  { value: "Technology",             label: "기술" },
  { value: "Healthcare",             label: "헬스케어" },
  { value: "Financial Services",     label: "금융" },
  { value: "Consumer Cyclical",      label: "경기소비재" },
  { value: "Industrials",            label: "산업재" },
  { value: "Communication Services", label: "통신서비스" },
  { value: "Consumer Defensive",     label: "필수소비재" },
  { value: "Energy",                 label: "에너지" },
  { value: "Basic Materials",        label: "소재" },
  { value: "Real Estate",            label: "부동산" },
  { value: "Utilities",              label: "유틸리티" },
];

/** 야후의 나라 이름 → 우리말(모르는 나라는 그대로) */
const 나라말: Record<string, string> = {
  "United States": "미국", "South Korea": "한국", Taiwan: "대만", China: "중국", Japan: "일본",
  Netherlands: "네덜란드", "United Kingdom": "영국", Canada: "캐나다", Switzerland: "스위스",
  Ireland: "아일랜드", Germany: "독일", France: "프랑스", Israel: "이스라엘", Singapore: "싱가포르",
  "Hong Kong": "홍콩", Brazil: "브라질", India: "인도", Luxembourg: "룩셈부르크", Denmark: "덴마크",
  Bermuda: "버뮤다", Uruguay: "우루과이", Argentina: "아르헨티나", Australia: "호주",
};

/** 섹터·국가는 우리말로, 산업은 그대로(백 가지가 넘는다) */
export function 글값(key: string, v: string | null | undefined): string {
  if (!v) return "—";
  if (key === "sector") return SECTORS.find((s) => s.value === v)?.label ?? v;
  if (key === "country") return 나라말[v] ?? v;
  return v;
}

// ── 숫자 글자 ─────────────────────────────────────────────

/** 큰 돈 — 원화는 조·억, 달러는 T·B·M. 다른 돈(대만 달러 등)은 단위 이름을 붙인다 */
export function 돈글(v: number | null | undefined, 통화?: string | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const 음 = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (통화 === "KRW") {
    if (a >= 1e12) return `${음}${(a / 1e12).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}조`;
    if (a >= 1e8) return `${음}${Math.round(a / 1e8).toLocaleString("ko-KR")}억`;
    return `${음}${Math.round(a / 1e4).toLocaleString("ko-KR")}만`;
  }
  const 앞 = !통화 || 통화 === "USD" ? "$" : `${통화} `;
  if (a >= 1e12) return `${음}${앞}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${음}${앞}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${음}${앞}${(a / 1e6).toFixed(2)}M`;
  return `${음}${앞}${Math.round(a).toLocaleString("en-US")}`;
}

export function 가격글(v: number | null | undefined, 통화?: string | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return 통화 === "KRW" ? `₩${Math.round(v).toLocaleString("ko-KR")}` : `$${v.toFixed(2)}`;
}

export function 부호글(v: number, 자리 = 2): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(자리)}%`;
}

/** 거래량 같은 큰 수 — 만·억 */
export function 수글(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(1)}만`;
  return v.toLocaleString("ko-KR");
}

/** 칸 하나의 글자(등락·흐름처럼 따로 그리는 칸은 이 글자를 설명·CSV 에 쓴다) */
export function 칸글(칸: 칸정의, 줄: Record<string, any>): string {
  const v = 줄[칸.key];
  const 통화 = 칸.장부 ? (줄.fin_currency ?? 줄.currency) : 줄.currency;
  if (칸.모양 === "흐름") {
    const 값들: (number | null)[] = Array.isArray(v) ? v : [];
    const 해들: number[] = Array.isArray(줄.fin_years) ? 줄.fin_years : [];
    if (!값들.some((x) => x != null)) return "—";
    const 글 = (x: number | null) => (x == null ? "—" : 칸.key === "eps_hist" ? x.toFixed(2) : 돈글(x, 통화));
    /* 서버가 장부 돈(TSMC 대만 달러)을 지금 환율로 바꿨으면 그렇다고. EPS 를 시세 1주(ADR 1주)로 못 맞췄으면
       원주 1주의 값이라고(eps_basis) — 맞췄으면 시세와 같은 단위라 따로 적지 않는다 */
    const 덧말: string[] = [];
    if (typeof 줄.fin_fx === "string" && 줄.fin_fx) 덧말.push(`${줄.fin_fx}→달러, 지금 환율`);
    if (칸.key === "eps_hist" && 줄.eps_basis === "ordinary") 덧말.push("원주 1주 기준");
    const 바꿈 = 덧말.length ? ` (${덧말.join(" · ")})` : "";
    return 값들.map((x, i) => `${해들[i] ?? ""} ${글(x)}`.trim()).join(" · ") + 바꿈;
  }
  if (칸.모양 === "글") return 글값(칸.key, v);
  if (v == null || typeof v !== "number" || !Number.isFinite(v)) return "—";
  switch (칸.모양) {
    case "돈": return 돈글(v, 통화);
    case "가격": return 가격글(v, 통화);
    case "등락": case "부호": return 부호글(v);
    case "배수": return v.toFixed(2);
    case "퍼센트": return 칸.key === "debt_ratio" ? `${v.toFixed(0)}%` : `${v.toFixed(2)}%`;
    case "성장": return 부호글(v, 1);
    case "수": return v.toFixed(2);
    case "정수": return v.toFixed(0);
    case "거래량": return 수글(v);
  }
  return String(v);
}

/* ── 원화 환산 ─────────────────────────────────────────────
   사용자: "스크리닝에 원화환산기능 넣어줘". 화면에 보이는 돈만 바꾼다 — 세우기·거르기는 서버가 원래 돈(달러)으로
   한다(같은 돈끼리는 순서가 같다). 환율을 아는 달러만 바꾸고, 다른 돈(대만 달러로 적는 TSMC 의 흐름 따위)은 그대로 둔다. */
const 원화칸 = new Set<string>([
  "price", "market_cap", "revenue", "earnings", "fcf", "net_debt", "eps", "forward_eps", "dividend_rate",
]);

export function 원화로(줄: Record<string, any>, 환율: number): Record<string, any> {
  if (!(환율 > 0)) return 줄;
  const 다음: Record<string, any> = { ...줄 };
  if (줄.currency === "USD") {
    for (const k of 원화칸) if (typeof 줄[k] === "number") 다음[k] = 줄[k] * 환율;
    다음.currency = "KRW";
  }
  if ((줄.fin_currency ?? 줄.currency) === "USD") {
    for (const k of ["rev_hist", "eps_hist"]) {
      if (Array.isArray(줄[k])) 다음[k] = 줄[k].map((x: number | null) => (x == null ? x : x * 환율));
    }
    다음.fin_currency = "KRW";
  }
  return 다음;
}

/* ── CSV ──────────────────────────────────────────────────
   칸 감싸기는 utils/csv 가 맡는다. 예전엔 join(",") 만 해서 'Apple Inc., …'
   같은 이름이 두 칸으로 갈라져 뒤의 숫자가 전부 한 칸씩 밀렸다.
   숫자는 글자로 꾸미지 않고 받은 값 그대로 — 표 계산기에서 다시 쓴다(흐름은 '/' 로 이어). */
export function 스크리닝CSV(rows: any[], visibleCols: Set<string>): CSV칸[][] {
  const 열 = 칸들.filter((c) => visibleCols.has(c.key));
  const 값 = (s: any, c: 칸정의): CSV칸 => {
    const v = s[c.key];
    if (Array.isArray(v)) return v.map((x) => (x == null ? "" : x)).join("/");
    return v as CSV칸;
  };
  return [
    ["순위", "종목코드", "종목명", "시장", ...열.map((c) => c.이름)],
    ...rows.map((s, i) => [i + 1, s.symbol, s.name ?? "", s.market ?? "", ...열.map((c) => 값(s, c))]),
  ];
}
