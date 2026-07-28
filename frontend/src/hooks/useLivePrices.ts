/**
 * 실시간 시세 상태 — 내 자산과 관심종목이 같은 규칙을 쓰도록 한곳에 모았다.
 *
 * 값만 흘려보내는 것으로는 부족하다. 사용자가 "지금 이 숫자가 살아 있는지"를
 * 알 수 없으면 실시간이 아니라고 느낀다. 그래서 세 가지를 함께 관리한다.
 *   - 연결 상태: 소켓이 끊겼는데 화면이 멀쩡해 보이면 안 된다
 *   - 마지막 갱신 시각: 5분 전 값인지 방금 값인지 구분할 수 있어야 한다
 *   - 장 세션: 휴장 중이면 값이 안 움직이는 게 정상이라고 알려줘야 한다
 *
 * 연결이 끊기면 받아둔 스냅샷을 비운다. 예전에는 이 초기화가 없어서, 끊긴 뒤에도
 * 마지막 값이 HTTP로 새로 받은 시세를 계속 덮어써 평가금액이 통째로 틀렸다.
 */
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { usePricesStream } from "@/hooks/useWebSocket";

export type MarketSession = "regular" | "pre" | "after" | "closed";

/** 서버(market_hours.py)와 같은 기준. 표시용이므로 근사로 충분하다 */
export function marketSession(market: string, now = new Date()): MarketSession {
  const isKR = (market || "").toUpperCase() === "KR";
  // 한국 시간 / 미국 동부 시간으로 환산 (분 단위)
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const offset = isKR ? 9 * 60 : -4 * 60;      // 미국은 서머타임 기준 근사
  let m = (utcMin + offset + 1440) % 1440;
  let day = now.getUTCDay();
  if (utcMin + offset >= 1440) day = (day + 1) % 7;
  if (utcMin + offset < 0) day = (day + 6) % 7;
  if (day === 0 || day === 6) return "closed";

  if (isKR) {
    if (m >= 9 * 60 && m < 15 * 60 + 30) return "regular";
    if (m >= 15 * 60 + 30 && m < 18 * 60) return "after";
    return "closed";
  }
  if (m >= 9 * 60 + 30 && m < 16 * 60) return "regular";
  if (m >= 4 * 60 && m < 9 * 60 + 30) return "pre";
  if (m >= 16 * 60 && m < 20 * 60) return "after";
  return "closed";
}

export const SESSION_LABEL: Record<MarketSession, string> = {
  regular: "장중",
  pre:     "장전",
  after:   "장마감",
  closed:  "휴장",
};

/** 여러 종목이 섞여 있을 때 대표 세션 — 하나라도 열려 있으면 열린 것으로 본다 */
export function overallSession(markets: string[], now = new Date()): MarketSession {
  const order: MarketSession[] = ["regular", "pre", "after", "closed"];
  const found = new Set(markets.map((m) => marketSession(m, now)));
  return order.find((s) => found.has(s)) ?? "closed";
}

export function useLivePrices(
  symbols: string[],
  markets: string[],
  onPrices: (prices: any[]) => void,
  onReset?: () => void,
) {
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const onPricesRef = useRef(onPrices);
  const onResetRef  = useRef(onReset);
  useEffect(() => { onPricesRef.current = onPrices; }, [onPrices]);
  useEffect(() => { onResetRef.current = onReset; }, [onReset]);

  const handle = useCallback((prices: any[]) => {
    onPricesRef.current(prices);
    setUpdatedAt(Date.now());
  }, []);

  const { status } = usePricesStream(symbols, markets, handle);

  // 끊긴 상태가 이어지면 받아둔 값을 버린다. 곧바로 버리지 않는 이유는
  // 재연결이 몇 초 안에 끝나는 경우가 대부분이라, 그때마다 화면이 비면
  // 오히려 더 불안해 보이기 때문이다.
  const DROP_AFTER_MS = 45_000;
  useEffect(() => {
    if (status === "connected") return;
    const t = setTimeout(() => {
      onResetRef.current?.();
      setUpdatedAt(null);
    }, DROP_AFTER_MS);
    return () => clearTimeout(t);
  }, [status]);

  const session = useMemo(() => overallSession(markets), [markets.join(",")]);

  return {
    status,
    updatedAt,
    session,
    sessionLabel: SESSION_LABEL[session],
    isLive: status === "connected" && session !== "closed",
  };
}
