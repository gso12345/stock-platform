/**
 * 배당 달력 — 내 종목이 언제 얼마를 주는가.
 *
 * 지금까지 배당은 '배당수익률 2.1%' 라는 숫자 하나로만 있었다. 배당을
 * 보고 사는 사람이 정작 알고 싶은 것은 **언제** 들어오느냐다.
 *
 * ── 왜 월별 막대인가 ──
 *
 * 처음에는 '다음 배당일' 을 날짜순으로 늘어놓기만 했다. 그런데 배당을
 * 보고 사는 사람이 실제로 하는 일은 '한 해 얼마 받고, 어느 달이 비는가'
 * 를 보는 것이다. 목록만으로는 그게 안 보인다 — 2·5·8·11월에만 주는
 * 종목을 잔뜩 갖고 있어도 모른다.
 *
 * 그래서 열두 달을 막대로 세우고, 막대를 누르면 그 달 내역이 아래에
 * 펼쳐지게 했다. 배당 앱들이 다 이 모양인 데는 이유가 있다.
 *
 * ── 정직하게 보여야 하는 것 ──
 *
 *   1) 확정과 예상을 섞지 않는다. 회사가 공시한 날짜와 '지난 주기로
 *      미뤄 본 날짜' 는 다른 말이다. 예상 날짜는 '10월 초' 로 뭉갠다.
 *   2) 안 갖고 있는 종목에는 금액을 안 쓴다. 수량이 0인데 '0원' 이라고
 *      적으면 '배당을 안 준다' 로 읽힌다.
 *   3) 달러 종목은 원화로 환산해 합치되 **원래 금액도 같이 적는다** —
 *      환산값만 있으면 맞는지 확인할 길이 없다.
 *   4) 이번 회차 날짜를 아는 달에만 D-day 를 적는다. 다른 달은 아직
 *      날짜를 모른다 — 지어내지 않는다.
 */
import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { type 배당줄 } from "@/api/stocks";
import { use배당달력 } from "@/hooks/useDividendCalendar";
import { Card, 못불러옴 } from "@/components/ui";
import { useExchangeRate } from "@/hooks/useExchangeRate";
import { use돈 } from "@/hooks/useMoney";

/** "2026-09-30" → "9월 30일" */
export function 날짜글(day: string): string {
  const [, m, d] = day.split("-");
  return m && d ? `${Number(m)}월 ${Number(d)}일` : day;
}

/** 예상 날짜는 하루까지 맞다고 말하면 안 된다 — 순으로 뭉갠다 */
export function 어림날짜글(day: string): string {
  const [, m, d] = day.split("-");
  if (!m || !d) return day;
  const n = Number(d);
  const 순 = n <= 10 ? "초" : n <= 20 ? "중순" : "말";
  return `${Number(m)}월 ${순}`;
}

/** 오늘로부터 며칠 남았나 */
export function 남은날(day: string, 오늘 = new Date()): number {
  const 그날 = new Date(`${day}T00:00:00`);
  const 기준 = new Date(오늘.getFullYear(), 오늘.getMonth(), 오늘.getDate());
  return Math.round((그날.getTime() - 기준.getTime()) / 86_400_000);
}

/**
 * 배당에 붙는 원천징수 세율.
 *
 *   국내 15.4%  소득세 14% + 지방소득세 1.4%. 받을 때 이미 떼고 들어온다.
 *   해외 15%    미국에서 떼는 몫. 한·미 조세조약상 15% 이고, 국내 세율
 *               14% 보다 높아 국내에서 더 떼지 않는다.
 *
 * ── 이 숫자로 다 되는 건 아니다 ──
 *
 * 한 해 금융소득이 2,000만원을 넘으면 종합과세로 넘어가 사람마다 세율이
 * 달라진다. 그래서 화면에 '어림' 이라고 적고 계산 근거를 같이 쓴다.
 * 정확한 척하는 게 제일 나쁘다 — 그 숫자로 세금 계획을 세울 사람이 있다.
 */
export const 원천징수 = { 국내: 0.154, 해외: 0.15 } as const;

/** 통화로 국내/해외를 가른다.
 *
 *  market 이 아니라 통화로 보는 이유 — 배당을 어느 나라에서 주느냐가
 *  세금을 정하는데, 시장 구분(KR/US/ETF)에는 국내 상장 해외 ETF 처럼
 *  애매한 것이 섞인다. 원화로 주면 국내에서 떼고 들어온 돈이다. */
export function 세율(currency?: string): number {
  return currency === "KRW" ? 원천징수.국내 : 원천징수.해외;
}

/** 주당 금액 하나를 내 몫 원화로 */
function _원화로(r: 배당줄, 주당: number, 환율: number, 세후로: boolean): number {
  const 수량 = r.shares || 0;
  if (!수량 || !주당) return 0;
  const 배수 = r.currency === "KRW" ? 1 : 환율;
  const 세전 = 주당 * 수량 * 배수;
  return 세후로 ? 세전 * (1 - 세율(r.currency)) : 세전;
}

/**
 * 한 종목이 **이번 회차**에 주는 돈 — 원화로.
 *
 * last_amount(마지막으로 준 회차)를 쓰고 있었다. 분기배당은 회차마다
 * 금액이 다르므로(결산배당이 붙는 분기가 특히 크다) 마지막 회차는
 * 다음 회차와 아무 상관이 없다. 0.20/0.25/0.30/0.35 를 주는 종목이
 * 다음에 0.20 을 줄 차례인데 마지막이 0.35 였으면 75% 를 더 받는다고
 * 말하게 된다 — 그 값으로 생활비 계획을 세우는 사람이 있다.
 *
 * 서버가 그 달에 실제로 준 금액을 골라 next_amount 로 준다.
 */
export function 회차금액(r: 배당줄, 환율: number, 세후로 = false): number {
  return _원화로(r, r.next_amount ?? r.last_amount ?? 0, 환율, 세후로);
}

/**
 * 그 달에 실제로 받았던 내역 — 최근 것부터.
 *
 * 아래 목록이 '지난 배당' 으로 마지막 세 회차를 그냥 보여 주고 있었다.
 * 3월을 보고 있는데 12·9·6월 금액이 나오는 셈이라, 옆에 적힌 '3월 예상'
 * 을 검산하는 데 아무 도움이 안 된다.
 *
 * 같은 달만 골라 해마다 얼마였는지 보여 준다 — 그게 그 예상값의 근거다.
 */
export function 그달지난배당(r: 배당줄, 달: number, 몇개 = 2): { year: number; amount: number }[] {
  /* 서버가 해·달별 합계를 미리 묶어 준다.
     예전에는 지난 지급 원본(recent)을 통째로 받아 여기서 합쳤다.
     주배당이면 한 종목에 104건이라 열두 종목 응답의 절반이 그 배열
     이었는데, 화면이 쓰는 것은 두 줄뿐이다.

     해마다 한 줄로 묶는 것이 요점이다. 주배당은 같은 달에 네다섯 건이
     있어서 그냥 자르면 '2026 · 2026' 처럼 같은 해가 두 번 찍힌다 —
     해마다 얼마였나를 보려고 만든 자리인데 아무것도 못 비교하게 된다. */
  if (r.월별지난) {
    return r.월별지난
      .filter((x) => x.month === 달)
      .sort((a, b) => b.year - a.year)
      .map(({ year, amount }) => ({ year, amount }))
      .slice(0, 몇개);
  }

  /* 옛 응답(월별지난이 없는 것) — 원본에서 직접 묶는다 */
  const 해별 = new Map<number, number>();
  for (const x of (r.recent ?? [])) {
    if (Number(x.date.split("-")[1]) !== 달) continue;
    const y = Number(x.date.split("-")[0]);
    해별.set(y, (해별.get(y) ?? 0) + x.amount);
  }
  return [...해별.entries()]
    .map(([year, amount]) => ({ year, amount: Math.round(amount * 1e6) / 1e6 }))
    .sort((a, b) => b.year - a.year)
    .slice(0, 몇개);
}

/** 그 달 금액이 실제 지급에서 나온 것인가. 아니면 평균으로 메운 칸이다 */
export function 실제값인가(r: 배당줄, 달: number): boolean {
  const 칸 = r.schedule?.find((x) => x.month === 달);
  if (!칸) return false;
  /* actual 이 없는 옛 응답은 실제로 친다 — 그때는 메우는 칸이
     schedule 에 안 들어 있었다 */
  return 칸.actual !== false;
}

/**
 * 그 달에 받는 돈 — 원화로.
 *
 * ── 왜 달마다 따로 보나 ──
 *
 * 예전에는 마지막 회차 금액(last_amount)을 모든 달에 똑같이 썼다.
 * 그런데 분기배당은 회차마다 금액이 다르다 — 결산배당이 붙는 분기가
 * 특히 크다. 마지막 회차가 그 큰 회차면 한 해 예상이 통째로 부풀고,
 * 작은 회차면 반대로 깎인다.
 *
 * 예: 0.20 / 0.25 / 0.30 / 0.35 를 주는 종목이면 한 해 1.10 인데,
 * 마지막(0.35)을 네 번 곱하면 1.40 — 27% 를 더 받는 것으로 나온다.
 *
 * 이제 서버가 달마다 **실제로 준 금액**(schedule)을 준다. 그게 없는
 * 옛 응답에만 예전 방식으로 떨어진다.
 */
export function 달금액(r: 배당줄, 달: number, 환율: number, 세후로 = false): number {
  const 칸 = r.schedule?.find((x) => x.month === 달);
  if (칸) return _원화로(r, 칸.amount, 환율, 세후로);
  if (!r.months?.includes(달)) return 0;
  // 옛 응답 — 마지막 회차 금액으로 어림한다
  const 회차 = r.per_month && r.per_month > 1 ? r.per_month : 1;
  return 회차금액(r, 환율, 세후로) * 회차;
}

/** 한 달치 — 주배당은 한 달에 네 번쯤 들어온다.
 *
 *  달을 안 정하고 부르면 '한 달 평균' 이다(목록 정렬용). */
export function 한달금액(r: 배당줄, 환율: number, 세후로 = false): number {
  const 회차 = r.per_month && r.per_month > 1 ? r.per_month : 1;
  return 회차금액(r, 환율, 세후로) * 회차;
}

/**
 * 달마다 얼마 들어오나 — 열두 칸.
 *
 * 종목이 '몇 월에 주는지'(months)를 서버가 알려 준다. 분기배당이라도
 * 회사마다 달이 달라서(2·5·8·11 vs 3·6·9·12) 그걸 안 쓰면 한 해 그림이
 * 통째로 틀린다.
 */
export function 달마다(줄들: 배당줄[], 환율: number, 세후로 = false): number[] {
  const 칸: number[] = Array(12).fill(0);
  for (const r of 줄들) {
    /* 서버가 준 달만 돈다. schedule 이 있으면 그 달들, 없으면 months.
       달마다 금액이 다르므로 한 값을 열두 번 더하면 안 된다 */
    const 달들 = r.schedule?.length ? r.schedule.map((x) => x.month) : (r.months ?? []);
    for (const m of 달들) {
      if (m >= 1 && m <= 12) 칸[m - 1] += 달금액(r, m, 환율, 세후로);
    }
  }
  return 칸;
}

/** 그 달에 주는 날 — 서버가 실제로 준 날에서 뽑은 값 */
export function 그달날(r: 배당줄, 달: number): number | null {
  return r.schedule?.find((x) => x.month === 달)?.day ?? null;
}

/**
 * 그 달 칸이 **몇 년 것인지** 한 줄로 적는다.
 *
 * 여기가 거짓말을 하고 있었다. 이번 회차가 아닌 달에는 조건 없이
 * '작년 기준' 이 붙었다 — 연도를 한 번도 안 봤다.
 *
 * 그런데 한 종목의 열두 칸은 **서로 다른 해에서 나온다.** 오늘이
 * 8월이면 1~8월 칸은 올해 실제로 받은 값이고 9~12월 칸만 작년 것이다.
 * 즉 열두 달 중 여덟 달의 라벨이 틀렸다. "작년 기준이 아니라 올해
 * 확정된 데이터로 계산해 달라" 는 말이 나온 이유가 이것이다 —
 * 계산은 이미 올해 것을 쓰고 있었고, 라벨만 아니라고 우겼다.
 */
export function 기준글(r: 배당줄, 달: number, 오늘 = new Date()): string | null {
  const 칸 = r.schedule?.find((x) => x.month === 달);
  if (!칸) return null;
  /* 평균으로 메운 칸에는 연도가 없다. '평균' 은 주당 금액 옆에 이미
     적으므로 여기서 또 적지 않는다 */
  if (칸.year == null) return null;
  if (칸.올해확정 ?? (칸.year === 오늘.getFullYear())) return "올해 확정";
  return `${칸.year}년 기준`;
}

/**
 * 그 달에 실제로 받은 날들 — 주배당은 네다섯 번이다.
 *
 * 서버가 접기 전의 (날짜, 금액) 쌍을 그대로 실어 준다. 접힌 칸 하나는
 * 날짜가 '그 달 마지막 회차' 인데 금액은 '그 달 합계' 라 둘의 기준이
 * 어긋난다 — 나란히 찍으면 그냥 틀린 줄이다.
 */
export function 그달날들(r: 배당줄, 달: number): { date: string; amount: number }[] {
  return r.schedule?.find((x) => x.month === 달)?.days ?? [];
}

/** 앞으로 받을 날 중 그 달 것 — 주·월배당만 온다. **전부 추정이다** */
export function 앞으로그달(r: 배당줄, 달: number): { date: string; amount: number }[] {
  return (r.upcoming ?? []).filter((x) => Number(x.date.split("-")[1]) === 달);
}

/** "2026-09-03" → "3일 (목)" — 날짜별 목록에서 요일까지 보여 준다 */
export function 날과요일(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return `${d.getDate()}일 (${"일월화수목금토"[d.getDay()]})`;
}

/** 내 보유 몫 — 배당률의 분모가 되는 값들.
 *
 *  배당금(분자)은 서버가 주는데, '얼마를 넣어서 그만큼 받나'(분모)는
 *  내 자산 화면만 안다. 그래서 위에서 내려받는다 — 새 요청을 하나 더
 *  보내지 않으려는 것이기도 하다(무료 서버는 0.15 CPU 다). */
export interface 보유몫 { 수량: number; 원가: number; 평가: number }

/**
 * 서버가 센 수량을 화면이 보고 있는 몫으로 줄인다.
 *
 * 전체 보기에서 포트폴리오 하나를 빼 두면, 화면의 합계는 줄어드는데
 * 배당은 여전히 전량 기준으로 나온다. 그러면 '내 자산의 8% 가 배당' 같은
 * 말도 안 되는 배당률이 찍힌다. 화면이 보고 있는 수량으로 맞춘다.
 */
/**
 * 보유 몫을 찾는 열쇠 — **시장까지** 넣는다.
 *
 * 심볼만 쓰면 같은 심볼을 두 시장에 담아 둔 사람(예: 미국 상장 SCHD 와
 * 국내 상장 같은 이름)의 배당이 두 배로 세어진다. 서버는 (심볼, 시장)
 * 으로 나눠 보내는데 화면이 심볼로만 합쳤기 때문이다.
 */
export function 배당키(market: string, symbol: string): string {
  return `${market}:${symbol}`;
}

export function 내몫으로(줄들: 배당줄[], 보유?: Record<string, 보유몫>): 배당줄[] {
  if (!보유) return 줄들;
  const 결과: 배당줄[] = [];
  for (const r of 줄들) {
    const 몫 = 보유[배당키(r.market, r.symbol)];
    if (!몫 || 몫.수량 <= 0) continue;      // 화면에서 빠진 종목
    결과.push(몫.수량 === r.shares ? r : { ...r, shares: 몫.수량 });
  }
  return 결과;
}

/**
 * 막대 위 라벨 — 자리가 열두 칸뿐이다.
 *
 * 휴대폰 폭(390px)에서 한 칸이 28px 남짓인데, '8,140' 은 다섯 글자라
 * 그대로 두면 '8,1…' 로 잘린다. 잘린 숫자는 안 쓰느니만 못하다 —
 * 8,140 인지 81,400 인지 알 수가 없다.
 *
 * 그래서 만 아래도 천 단위로 줄인다. 이 라벨의 쓸모는 '어느 달이 큰가'
 * 를 눈으로 재는 것이지 원 단위까지 읽는 것이 아니다(정확한 금액은
 * 막대를 누르면 아래 줄에 그대로 나온다).
 */
export function 짧은돈(v: number): string {
  if (!v) return "";
  /* 경계값이 어중간한 이유 —
     단위를 바꾸는 지점을 딱 1억·1만으로 잡으면, 그 **바로 아래** 값이
     반올림되면서 자릿수가 하나 늘어난다. 99,999,999원은 1억이 안 되니
     만 단위인데 반올림하면 '10000만'(여섯 글자)이다. 그래서 '반올림해도
     자릿수가 안 넘치는 마지막 값' 을 경계로 쓴다. */
  if (v >= 999_950_000_000) return `${(v / 1_000_000_000_000).toFixed(1)}조`;
  /* 100억을 넘으면 소수 첫째 자리를 뗀다 — '123.5억' 은 여섯 글자다.
     이 자리에서 1억 미만의 차이는 어차피 눈으로 못 잰다 */
  if (v >= 9_995_000_000) return `${Math.round(v / 100_000_000)}억`;
  if (v >= 99_950_000) return `${(v / 100_000_000).toFixed(1)}억`;
  /* 만 단위에는 쉼표를 안 넣는다. '1,235만' 은 여섯 글자라 다시 잘린다 —
     쉼표 하나에 칸 하나를 쓰는 셈인데, 여기서 얻는 것이 없다 */
  if (v >= 9_995) return `${Math.round(v / 10_000)}만`;
  if (v >= 995) return `${Math.round(v / 1_000)}천`;
  return `${Math.round(v)}`;
}



/**
 * 원화 종목이면 원, 아니면 달러.
 *
 * 자릿수를 값에 맞춰 늘린다. 주배당 ETF 는 한 주에 $0.063 처럼 아주
 * 작은 금액을 주는데, 두 자리로 자르면 $0.06 이 되어 5% 를 깎아
 * 보여 준다. '주당 얼마' 는 사람이 눈으로 검산하는 값이라 틀리면 안 된다.
 */
export function 원본돈(v: number, currency?: string): string {
  if (currency === "KRW") {
    // 원화도 소수가 나올 수 있다(환산이 아닌 원본이라 드물지만)
    return v >= 1 || v === 0
      ? `${Math.round(v).toLocaleString("ko-KR")}원`
      : `${v.toFixed(2)}원`;
  }
  const 자리 = Math.abs(v) > 0 && Math.abs(v) < 0.1 ? 4 : 2;
  return `$${v.toFixed(자리)}`;
}

export default function DividendCalendar({ portfolioId, 이름, 보유, 미리보기 }: {
  /** 지금 보고 있는 포트폴리오. 없으면(전체 보기) 가진 것 전부 */
  portfolioId?: number;
  /** 포트폴리오 이름 — 무엇의 배당인지 제목에 밝힌다 */
  이름?: string;
  /** 심볼 → 내 몫. 배당률의 분모이자, 화면이 보고 있는 수량의 기준 */
  보유?: Record<string, 보유몫>;
  /** 로그인 전 미리보기. 주면 /portfolio/dividends(로그인 필요)를 안 부른다.
   *
   *  값은 지어낸 것이 아니다 — 공개 경로(/stocks/{market}/{symbol}/dividends)로
   *  받은 **실제 배당**에 예시 수량을 곱한 것이다. 두 경로가 같은 캐시를
   *  본다(hooks/usePortfolioPreview). */
  미리보기?: { items: 배당줄[]; pending: number };
}) {
  const 환율 = useExchangeRate();
  const 돈 = use돈();
  const 이번달 = new Date().getMonth() + 1;
  const [고른달, set고른달] = useState<number>(이번달);
  /* 세전으로 시작한다. 세후가 기본이면 '내가 아는 배당금과 다른데?' 가
     먼저 오고, 왜 다른지는 한참 뒤에야 눈에 띈다 */
  const [세후로, set세후로] = useState(false);

  const { data, isLoading, isError, error, refetch } =
    use배당달력(portfolioId, !미리보기);      // 미리보기는 공개 경로로 따로 받는다

  const 받은것 = 미리보기 ?? data;
  const 줄들 = useMemo<배당줄[]>(
    // 예시에는 '내 몫' 이 따로 없다 — 예시 수량이 곧 내 몫이다
    () => (미리보기 ? 미리보기.items : 내몫으로(data?.items ?? [], 보유)),
    [data, 보유, 미리보기],
  );
  const 아직 = 받은것?.pending ?? 0;

  const 월별 = useMemo(() => 달마다(줄들, 환율, 세후로), [줄들, 환율, 세후로]);
  const 한해 = useMemo(() => 월별.reduce((s, v) => s + v, 0), [월별]);
  const 최대 = useMemo(() => Math.max(...월별, 1), [월별]);

  /* ── 배당률 두 가지 ──
     투자배당률  한 해 배당 ÷ 내가 넣은 돈. 내가 산 가격이 기준이라
                 오래 가진 사람일수록 높아진다 — '내 배당률' 이다.
     시가배당률  한 해 배당 ÷ 지금 평가금액. 지금 사는 사람이 받게 될
                 배당률에 가깝다.
     둘은 다른 이야기이고, 배당 앱들이 나란히 놓는 이유가 그것이다. */
  const 분모 = useMemo(() => {
    if (!보유) return null;
    let 원가 = 0, 평가 = 0;
    for (const v of Object.values(보유)) { 원가 += v.원가; 평가 += v.평가; }
    return { 원가, 평가 };
  }, [보유]);
  const 투자배당률 = 분모 && 분모.원가 > 0 ? (한해 / 분모.원가) * 100 : null;
  const 시가배당률 = 분모 && 분모.평가 > 0 ? (한해 / 분모.평가) * 100 : null;

  /** 고른 달에 주는 종목들 — 금액 큰 순 */
  const 그달것 = useMemo(() => 줄들
    .filter((r) => (r.schedule?.length
      ? r.schedule.some((x) => x.month === 고른달)
      : r.months?.includes(고른달)))
    /* 그 달의 **실제** 금액을 쓴다. 예전에는 마지막 회차 금액을 모든
       달에 똑같이 써서, 결산배당이 붙는 달과 아닌 달이 같아 보였다 */
    .map((r) => ({ r, 금액: 달금액(r, 고른달, 환율, 세후로) }))
    .sort((a, b) => b.금액 - a.금액), [줄들, 고른달, 환율, 세후로]);

  const 틀 = (속: React.ReactNode) => (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <CalendarDays size={14} className="text-accent-green" />
        <span className="text-sm font-semibold text-text-primary">배당 달력</span>
        {미리보기 && <span className="text-2xs font-medium text-text-dim">예시 수량 · 실제 배당</span>}
        {/* 탭을 바꾸면 목록도 바뀐다. 무엇의 배당인지 안 적으면
            '왜 아까랑 다르지' 가 된다 */}
        {이름 && <span className="text-2xs text-text-dim truncate">{이름}</span>}
        {아직 > 0 && (
          <span className="text-2xs text-text-dim ml-auto shrink-0">{아직}개 확인 중</span>
        )}
      </div>
      {속}
    </Card>
  );

  if (!미리보기 && isError) return 틀(<못불러옴 사유={error} 다시={() => refetch()} compact />);
  if (!미리보기 && isLoading) return 틀(<div className="h-24 rounded-lg bg-bg-elevated animate-pulse" />);

  if (줄들.length === 0) {
    return 틀(
      <p className="py-4 text-center text-xs text-text-dim break-keep">
        {아직 > 0
          ? "배당 일정을 확인하는 중이에요. 잠시 뒤 다시 열어 보세요."
          : portfolioId
            ? "이 포트폴리오에는 배당을 주는 종목이 없어요."
            : "배당을 주는 종목이 아직 없어요."}
      </p>,
    );
  }

  return 틀(
    <>
      {/* ── 세전 / 세후 ──
          배당 앱들이 '세금 0% 적용' 같은 칩으로 켜고 끈다. 실제로 통장에
          꽂히는 돈은 세후인데, 어느 쪽을 보고 있는지 안 적으면 두 화면이
          말이 안 맞는다 */}
      <div className="flex items-center justify-between gap-2 -mt-0.5">
        <span className="text-2xs text-text-muted">한 해 {세후로 ? "실수령" : "예상"}</span>
        <div className="flex rounded-lg border border-border overflow-hidden shrink-0" role="group" aria-label="세금 적용">
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              onClick={() => set세후로(v)}
              aria-pressed={세후로 === v}
              className={`px-2.5 py-1 text-2xs font-semibold transition-colors ${
                세후로 === v ? "bg-accent-green text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"
              }`}
            >{v ? "세후" : "세전"}</button>
          ))}
        </div>
      </div>

      {/* 한 해에 얼마 — 이 화면에서 제일 먼저 보고 싶은 숫자.
          그 옆에 배당률 둘. 금액만 있으면 '많이 받는 건가' 를 알 수 없다 */}
      {/* 좁은 화면에서는 금액이 한 줄을 다 쓴다.
          세 칸을 나란히 두면 휴대폰 폭에서 '1,234,567원' 이 잘려
          '1,234,5…' 가 된다 — 제일 먼저 보고 싶은 숫자가 못 읽히는 셈이다.
          넓은 화면에서는 셋을 나란히 둔다(자리가 남는다) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 -mt-1">
        <div className="flex flex-col gap-0.5 col-span-2 sm:col-span-1 min-w-0">
          <span className="text-2xs text-text-dim whitespace-nowrap flex items-center gap-1">
            연간 배당금
            {/* 아직 못 받은 종목이 있으면 이 숫자는 **부분합**이다.
                그걸 안 밝히면 사람은 이 값을 전체로 믿는다 — 실제로
                '전체가 포트폴리오 하나보다 작다' 는 제보가 그래서 나왔다.
                곧 채워지므로 오류가 아니라 '아직' 이라고 적는다. */}
            {아직 > 0 && (
              <span className="text-accent-yellow font-medium">· {아직}개 빠짐</span>
            )}
          </span>
          <span className={`text-xl sm:text-lg leading-tight font-mono font-bold num truncate ${
            아직 > 0 ? "text-text-secondary" : "text-text-primary"
          }`}>
            {돈.원(한해)}
            {아직 > 0 && <span className="text-sm text-text-dim">＋</span>}
          </span>
        </div>
        {([
          { 이름: "투자 배당률", 값: 투자배당률, 설명: "내가 넣은 돈 대비" },
          { 이름: "시가 배당률", 값: 시가배당률, 설명: "지금 평가금액 대비" },
        ] as const).map((c) => (
          <div key={c.이름} className="flex flex-col gap-0.5 min-w-0">
            <span className="text-2xs text-text-dim whitespace-nowrap" title={c.설명}>{c.이름}</span>
            <span className="text-lg leading-tight font-mono font-bold text-accent-green num">
              {/* 분모를 모르면 안 쓴다. 0% 로 적으면 '배당이 없다' 가 된다 */}
              {c.값 == null ? "—" : `${c.값.toFixed(2)}%`}
            </span>
          </div>
        ))}
      </div>

      {세후로 && (
        <p className="text-2xs text-text-dim break-keep -mt-1.5">
          국내 {(원천징수.국내 * 100).toFixed(1)}%(소득세+지방소득세), 해외 {(원천징수.해외 * 100).toFixed(0)}%(미국 원천징수)를
          뗀 어림값이에요. 한 해 금융소득이 2,000만원을 넘으면 종합과세로 달라져요.
        </p>
      )}

      {/* ── 월별 막대 ──
          목록만으로는 '어느 달이 비는가' 가 안 보인다 */}
      <div className="flex items-end gap-1 -mx-0.5">
        {월별.map((v, i) => {
          const m = i + 1;
          const 고름 = m === 고른달;
          const 높이 = v > 0 ? Math.max(6, Math.round((v / 최대) * 44)) : 3;
          return (
            <button
              key={m}
              onClick={() => set고른달(m)}
              aria-pressed={고름}
              aria-label={`${m}월 ${v > 0 ? 돈.원(v) : "배당 없음"}`}
              className="flex-1 flex flex-col items-center justify-end gap-0.5 group min-w-0"
            >
              <span className={`text-2xs leading-none tabular-nums truncate w-full text-center transition-colors ${
                고름 ? "text-accent-green font-bold" : "text-text-dim"
              }`}>{짧은돈(v)}</span>
              <span
                /* 높이를 변수로 넘겨 화면 폭에 따라 늘린다. 인라인
                   style 로는 반응형을 못 쓴다 — PC 에서 44px 짜리 막대는
                   너무 납작해서 달끼리 비교가 안 된다 */
                style={{ ["--막대" as string]: `${높이}px` } as React.CSSProperties}
                className={`w-full rounded-t-[3px] transition-colors h-[var(--막대)] sm:h-[calc(var(--막대)*1.6)] ${
                  고름 ? "bg-accent-green"
                       : v > 0 ? "bg-accent-green/25 group-hover:bg-accent-green/40"
                               : "bg-bg-elevated"
                }`}
              />
              <span className={`text-2xs leading-none transition-colors ${
                고름 ? "text-accent-green font-bold" : "text-text-dim"
              }`}>{m}</span>
            </button>
          );
        })}
      </div>

      {/* ── 고른 달 내역 ── */}
      <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-border/50">
        <span className="text-sm font-semibold text-text-primary">
          {고른달}월
          {고른달 === 이번달 && (
            <span className="ml-1 text-2xs text-accent-green font-medium">이번 달</span>
          )}
        </span>
        <span className="text-sm font-mono font-semibold text-accent-green num">
          {월별[고른달 - 1] > 0 ? 돈.원(월별[고른달 - 1]) : "—"}
        </span>
      </div>

      {그달것.length === 0 ? (
        <p className="py-3 text-center text-2xs text-text-dim">이 달에는 들어오는 배당이 없어요</p>
      ) : (
        <ul className="flex flex-col">
          {그달것.map(({ r, 금액 }) => {
            /* 이번 회차(r.date)가 이 달이면 확정/추정 날짜와 D-day 를 적는다.
               다른 달도 이제는 날짜를 안다 — 서버가 그 달에 **실제로 준 날**
               (schedule.day)을 보내 준다. 예전에는 '3월' 이라고만 적었다. */
            const 예정 = 고른달 === Number(r.date.split("-")[1]);
            const 남음 = 예정 ? 남은날(r.date) : null;
            const 그날 = 그달날(r, 고른달);
            const 주당 = r.schedule?.find((x) => x.month === 고른달)?.amount
              ?? (예정 ? (r.next_amount ?? r.last_amount) : r.last_amount);
            const 실제 = 실제값인가(r, 고른달);
            const 지난것 = 그달지난배당(r, 고른달);
            const 기준 = 기준글(r, 고른달);
            /* 그 달에 실제로 받은 날들 / 앞으로 받을 날들.
               주배당은 한 달에 네다섯 번이라 한 줄로는 못 적는다 */
            const 받은날들 = 그달날들(r, 고른달);
            const 받을날들 = 앞으로그달(r, 고른달);
            const 여러번 = 받은날들.length > 1 || 받을날들.length > 1;

            /* 그 달에 정말 얼마였나 — 같은 달만 골라 해마다.
               예전에는 마지막 세 회차를 그냥 보여 줬다. 3월을 보고 있는데
               12·9·6월 금액이 나오니, 옆의 '3월 예상' 을 검산하는 데
               아무 도움이 안 됐다.

               좁은 화면에서는 이름 아래에, 넓은 화면에서는 따로 칸에
               둔다 — 한 줄에 넷을 나란히 두면 휴대폰에서 다 뭉개진다. */
            const 지난배당글 = 지난것.length > 0
              ? `${고른달}월 ${지난것.map((x) => `${x.year} ${원본돈(x.amount, r.currency)}`).join(" · ")}`
              : null;

            return (
              /* 칸을 격자로 잡는다.
                 flex 로 두면 넓은 화면에서 가운데 칸(flex-1)이 남는
                 자리를 통째로 먹어, 종목 이름과 금액이 1,000px 떨어져
                 앉는다 — 눈이 그 사이를 건너다녀야 해서 한 줄로 안 읽힌다.
                 격자로 잡으면 남는 자리가 칸끼리 나뉜다. */
              <li key={`${r.market}:${r.symbol}`}
                  className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:grid-cols-[4rem_minmax(0,1fr)_11rem_auto] items-start gap-x-3 gap-y-1 py-2.5 border-b border-border/50 last:border-b-0">
                <div className="flex flex-col items-center pt-0.5">
                  {예정 ? (
                    <>
                      <span className={`text-2xs font-semibold ${r.confirmed ? "text-accent-green" : "text-text-dim"}`}>
                        {남음 != null && 남음 <= 0 ? "오늘" : `D-${남음}`}
                      </span>
                      <span className="text-2xs text-text-dim whitespace-nowrap">
                        {r.confirmed ? 날짜글(r.date) : 어림날짜글(r.date)}
                      </span>
                      {/* 이 화면이 답해야 할 질문은 '언제 들어오나' 다.
                          위 날짜는 **기준일**(그날까지 갖고 있어야 받는 날)
                          이지 입금일이 아니다. 둘은 보통 몇 주 차이가 난다.
                          공시된 지급일이 있으면 같이 적는다 — 어느 날짜를
                          세고 있는지 화면이 안 밝히는 게 제일 나쁘다. */}
                      {r.pay_date && r.pay_date !== r.date && (
                        <span className="text-2xs text-accent-green whitespace-nowrap">
                          입금 {날짜글(r.pay_date).replace("월 ", "/").replace("일", "")}
                        </span>
                      )}
                    </>
                  ) : 그날 != null ? (
                    <>
                      <span className="text-2xs text-text-secondary whitespace-nowrap">
                        {고른달}월 {그날}일
                      </span>
                      {/* 몇 년 것인지 그대로 적는다.
                          예전에는 조건 없이 '작년 기준' 이었다 — 올해 이미
                          받은 달에도 그 말이 찍혔다. 한 종목의 열두 칸은
                          서로 다른 해에서 나온다. */}
                      {기준 && (
                        <span className={`text-2xs ${
                          기준 === "올해 확정" ? "text-accent-green" : "text-text-dim"
                        }`}>{기준}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-2xs text-text-dim">{고른달}월</span>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-text-primary truncate">{r.name}</p>
                    {/* 확정과 예상을 섞지 않는다 */}
                    {예정 && (
                      <span className={`text-2xs px-1 py-px rounded shrink-0 ${
                        r.confirmed
                          ? "bg-accent-green/15 text-accent-green"
                          : "bg-bg-elevated text-text-dim"
                      }`}>{r.confirmed ? "확정" : "예상"}</span>
                    )}
                  </div>
                  <p className="text-2xs text-text-dim truncate">
                    {r.shares ? `${r.shares.toLocaleString("ko-KR")}주 · ` : ""}
                    {/* 그 달의 주당 금액이다. 예전에는 마지막 회차 금액을
                        모든 달에 똑같이 적어서, 결산배당이 붙는 달과 아닌
                        달이 화면에서 같아 보였다 */}
                    {/* 한 달에 여러 번 주는 종목이면 그 달 **합계**다.
                        회차 수를 안 적으면 한 번에 그만큼 준다고 읽힌다 */}
                    {여러번 ? "그 달 합계 " : "주당 "}{원본돈(주당 ?? 0, r.currency)}
                    {여러번 && <span className="text-text-muted"> ({받은날들.length || 받을날들.length}회)</span>}
                    {/* 실제로 받은 값이 아니면 그렇다고 적는다.
                        주·월배당은 아직 한 해가 안 찬 종목의 빈 달을
                        평균으로 메운다 — 그걸 실제인 척 두면, 그 숫자로
                        한 해 계획을 세우는 사람이 생긴다 */}
                    {!실제 && <span className="text-text-muted"> (평균)</span>}
                    {r.cycle ? ` · ${r.cycle}배당` : ""}
                  </p>

                  {/* ── 날짜별로 전부 ──
                      주배당(연 52회)은 한 달에 네다섯 번 준다. 한 줄로 접으면
                      '8월 20일 · 주당 $0.189' 가 되는데, 날짜는 그 달 마지막
                      회차이고 금액은 그 달 합계라 둘의 기준이 어긋난다.

                      **받은 날과 받을 날을 섞지 않는다.** 지난 것은 실제로
                      들어온 돈이고 앞으로의 것은 추정이다. 색과 말로 가른다. */}
                  {여러번 && (
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                      {받은날들.map((x) => (
                        <span key={x.date} className="text-2xs text-text-secondary whitespace-nowrap">
                          {날과요일(x.date)} <span className="text-text-dim">{원본돈(x.amount, r.currency)}</span>
                        </span>
                      ))}
                      {받을날들.map((x) => (
                        <span key={x.date} className="text-2xs text-text-dim whitespace-nowrap">
                          {날과요일(x.date)} <span className="opacity-70">{원본돈(x.amount, r.currency)}</span>
                          <span className="text-text-muted">·예상</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* 몇 월에 주는지. 분기배당이라도 회사마다 달이 다르다 */}
                  {r.months && r.months.length > 0 && r.months.length < 12 && (
                    <p className="text-2xs text-text-dim truncate">배당월 {r.months.join("·")}</p>
                  )}
                  {지난배당글 && (
                    <p className="sm:hidden text-2xs text-text-muted truncate">지난 {지난배당글}</p>
                  )}
                </div>

                {/* 넓은 화면에서는 근거를 따로 세운다 — 자리가 남는다 */}
                {지난배당글 && (
                  <p className="hidden sm:block text-2xs text-text-muted leading-snug break-keep">
                    지난 {지난배당글}
                  </p>
                )}

                {/* 수량이 0이면 금액을 안 쓴다 — '0원' 은 '배당을 안 준다'
                    로 읽힌다 */}
                {금액 > 0 && (
                  <div className="flex flex-col items-end">
                    <span className="text-xs sm:text-sm font-mono font-semibold text-accent-green num whitespace-nowrap">
                      {돈.원(금액)}
                    </span>
                    {/* 환산값만 있으면 맞는지 확인할 길이 없다 */}
                    {r.currency !== "KRW" && (
                      <span className="text-2xs text-text-dim whitespace-nowrap">
                        {돈.글(원본돈(금액 / (환율 || 1), r.currency))}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>,
  );
}
