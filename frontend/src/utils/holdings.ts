import type { Market, Currency } from "@/types/portfolio";

/** 매입금액(원화).
 *
 *  평단가는 **담을 때 고른 통화** 기준이다. 달러로 적었으면 그때 환율을
 *  곱해야 하고, 원화로 적었으면 이미 원화라 다시 곱하면 안 된다 —
 *  곱하면 그 종목만 1,400배가 된다. */
export function 매입금액원화(
  item: { currency?: Currency | null; avgPrice: number; shares: number;
          inputExchangeRate?: number | null },
  환율: number,
): number {
  const fx = item.currency === "USD" ? (item.inputExchangeRate ?? 환율) : 1;
  return item.avgPrice * fx * item.shares;
}

/** 보유 한 줄의 **평가금액(원화)**.
 *
 *  ── 왜 한 군데에 두나 ─────────────────────────────────────
 *
 *  이 셈은 내 자산 화면과 백테스트의 '포트폴리오 그대로 담기' 두 곳에서
 *  쓴다. 두 벌로 두면 같은 포트폴리오인데 화면은 30%, 백테스트는 28%
 *  라고 말하는 일이 생긴다 — 어느 쪽이 맞는지 코드만 봐서는 알 수 없고,
 *  틀린 쪽이 조용히 틀린다. 이 저장소는 이미 같은 이유로 한 번 데였다
 *  (담기 중복 검사가 두 벌이었고 기준이 서로 달랐다).
 *
 *  ── 시세를 못 받았을 때 ───────────────────────────────────
 *
 *  **매입금액으로 대신한다.** 0 으로 두면 그 종목만 비중 0% 가 되고,
 *  나머지 종목의 비중이 그만큼 부풀려진다. 손익은 0 으로 잡히지만
 *  비중은 얼추 맞는다 — 비중을 통째로 어긋내는 쪽이 훨씬 나쁘다.
 *
 *  달러 종목의 현재가는 **항상 달러로** 온다(저장한 통화와 무관하다).
 *  그래서 오늘 환율을 곱한다. */
export function 평가금액원화(
  item: { market: Market; currency?: Currency | null; avgPrice: number;
          shares: number; inputExchangeRate?: number | null },
  현재가: number | null | undefined,
  환율: number,
): number {
  const 매입 = 매입금액원화(item, 환율);
  if (현재가 == null || !Number.isFinite(현재가) || 현재가 <= 0) return 매입;
  const 달러종목 = item.market === "US" || item.market === "ETF";
  return 달러종목 ? 현재가 * 환율 * item.shares : 현재가 * item.shares;
}

/** 평가금액 기준 비중(%). 합이 100 이 되게 나눈다.
 *
 *  합이 0 이면(모두 0원) 전부 0% 로 둔다 — 0 으로 나누면 NaN 이 되고,
 *  NaN 은 화면에서 '-' 도 아니고 '0%' 도 아닌 빈칸으로 새어 나간다. */
export function 비중매기기<T>(줄들: T[], 평가: (x: T) => number): (T & { weight: number })[] {
  const 합 = 줄들.reduce((s, x) => s + 평가(x), 0);
  return 줄들.map((x) => ({ ...x, weight: 합 > 0 ? (평가(x) / 합) * 100 : 0 }));
}

/**
 * 외화 종목의 현지통화(달러) 기준 값 계산.
 *
 * 목록을 만들 때 한 번만 계산해 두고, 행을 그릴 때는 결과만 읽는다.
 * (예전에는 행마다 매 렌더 다시 계산했다)
 *
 * 주의: 해외 종목을 원화로 입력한 경우 avgPrice가 이미 원화 금액이라
 * 그대로 달러로 취급하면 안 되고, 매입금액을 수량·환율로 되돌려야 한다.
 */
export function withNativeValues<T extends {
  market: Market; currency: Currency; avgPrice: number; shares: number;
  costKRW: number; currentPriceNative: number; currentValueKRW: number; pnlKRW: number;
}>(e: T, fx: number) {
  const isForexItem = e.market === "US" || e.market === "ETF";
  const nativeAvgPrice = !isForexItem
    ? e.avgPrice
    : e.currency === "USD"
      ? e.avgPrice
      : e.shares ? (e.costKRW / e.shares) / fx : 0;
  const nativeValue = isForexItem ? e.currentPriceNative * e.shares : e.currentValueKRW;
  const nativePnl   = isForexItem ? nativeValue - nativeAvgPrice * e.shares : e.pnlKRW;
  return { ...e, isForexItem, nativeAvgPrice, nativeValue, nativePnl };
}

/**
 * 오늘 하루 원화 평가금액이 얼마나 움직였나.
 *
 * ── 왜 따로 뺐나 ──
 *
 * 예전에는 이렇게 셌다.
 *
 *     오늘변화 = 평가원화 - 평가원화 / (1 + 종목등락률/100)
 *
 * 종목 등락률만 본다. 그런데 해외 종목의 원화 평가금액은 **주가와 환율
 * 둘이 같이** 정한다. 미국장이 쉬는 날에 원화가 1% 약해지면 내 자산은
 * 실제로 1% 늘어나는데, 화면은 '오늘 0원' 이라고 말했다.
 *
 * 총 평가금액은 오늘 환율로 계산하므로 그 1%가 이미 들어 있다. 즉 위
 * 숫자와 아래 숫자가 서로 다른 말을 하고 있었던 셈이다 — 자산 흐름
 * 그래프의 하루 변화와도 어긋난다.
 *
 * ── 셈 ──
 *
 *     어제원화 = 오늘원화 / (1 + 주가등락) / (1 + 환율등락)
 *
 * 환율은 해외 종목에만 곱한다. 국내 종목은 처음부터 원화라 환율이
 * 움직여도 평가금액이 안 바뀐다.
 *
 * 둘 다 모르면 null 이다 — 0 이 아니다. 0 은 '안 움직였다' 는 뜻이라
 * 시세를 못 받은 종목에 쓰면 거짓말이 된다.
 */
export function 오늘변화원화(
  평가원화: number,
  종목등락률: number | null | undefined,
  환율등락률: number | null | undefined,
  환율영향받나: boolean,
): number | null {
  /* -100% 면 (1 + r/100) 이 0 이라 0 으로 나눈다. 정상적인 시세는
     아니지만, 값이 깨진 채로 들어오면 화면에 Infinity 가 찍힌다 */
  const 배수 = (r: number | null | undefined): number | null => {
    if (r == null || !Number.isFinite(r)) return null;
    const m = 1 + r / 100;
    return m > 0 ? m : null;
  };
  const 주가 = 배수(종목등락률);
  const 환 = 환율영향받나 ? 배수(환율등락률) : 1;
  // 아는 것이 하나도 없을 때만 모른다고 한다
  if (주가 == null && (환 == null || 환 === 1)) return null;
  /* 한쪽만 깨졌으면 그쪽만 버리고 아는 쪽으로 센다.
     환율 응답 하나가 이상하게 왔다고 스무 종목의 오늘 손익이 통째로
     '모름' 이 되면, 정작 멀쩡한 주가 등락까지 화면에서 사라진다. */
  const 곱 = (주가 ?? 1) * (환 ?? 1);
  if (!Number.isFinite(곱) || 곱 <= 0) return null;
  return 평가원화 - 평가원화 / 곱;
}

/**
 * 한 주가 오늘 얼마나 움직였나 — 현지 통화로.
 *
 * '전일대비' 로 화면에 나가는 값이다. 수익률(매입가 대비)과는 다른
 * 숫자다 — 어제 산 사람과 3년 전에 산 사람에게 오늘의 움직임은 같지만
 * 수익률은 전혀 다르다.
 *
 * 여기도 (1 + r/100) 으로 나눈다. r 이 -100 이면 0 으로 나눠서 화면에
 * Infinity 가 찍힌다. 정상적인 시세는 아니지만 값이 깨진 채로 들어오는
 * 일은 실제로 있고, 돈이 걸린 화면이라 특히 나쁘다.
 */
export function 전일대비주당(
  현재가: number,
  등락률: number | null | undefined,
): number | null {
  if (등락률 == null || !Number.isFinite(등락률) || !Number.isFinite(현재가)) return null;
  const 배수 = 1 + 등락률 / 100;
  if (배수 <= 0) return null;
  return 현재가 - 현재가 / 배수;
}
