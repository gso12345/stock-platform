import { useEffect, useRef, useState, useMemo } from "react";
import { useWSStore } from "@/store/wsStore";

type WSStatus = "connecting" | "connected" | "disconnected";

export function useWebSocket<T>(
  url: string,
  onMessage: (data: T) => void,
  options?: { enabled?: boolean; reconnectDelay?: number }
) {
  const { enabled = true, reconnectDelay = 3000 } = options ?? {};
  const [status, setStatus] = useState<WSStatus>("disconnected");

  // onMessage를 ref로 저장 — deps 변경 없이 항상 최신 콜백 사용
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  useEffect(() => {
    if (!enabled) {
      setStatus("disconnected");
      return;
    }

    // disposed는 이 effect 실행분에만 속한 플래그다.
    // url이 바뀌어 정리(cleanup)된 뒤에는 예전 소켓의 onclose가 재연결을 예약하지
    // 못하게 막아, 새 소켓과 옛 소켓이 동시에 열리는 중복 연결을 방지한다.
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sock: WebSocket | null = null;

    const open = () => {
      if (disposed) return;
      const ws = new WebSocket(url);
      sock = ws;
      setStatus("connecting");

      ws.onopen = () => {
        if (!disposed) setStatus("connected");
      };

      ws.onmessage = (e) => {
        if (disposed) return;
        try {
          onMessageRef.current(JSON.parse(e.data) as T);
        } catch {}
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus("disconnected");
        timer = setTimeout(open, reconnectDelay);
      };

      ws.onerror = () => ws.close();
    };

    open();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (sock) {
        // 핸들러를 먼저 떼어내야 close()로 발생하는 onclose가 재연결을 예약하지 않는다
        sock.onopen = null;
        sock.onmessage = null;
        sock.onclose = null;
        sock.onerror = null;
        sock.close();
      }
    };
  }, [url, enabled, reconnectDelay]);

  return { status };
}


function getWsBase(): string {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    return apiUrl.replace(/^https/, "wss").replace(/^http/, "ws");
  }
  return "ws://localhost:8000";
}

export function useIndicesStream(
  onUpdate: (data: { kr: any[]; us: any[] }) => void,
  interval = 10
) {
  const setIndicesStatus = useWSStore((s) => s.setIndicesStatus);
  const wsUrl = `${getWsBase()}/ws/indices?interval=${interval}`;
  const result = useWebSocket<{ type: string; data: any }>(wsUrl, (msg) => {
    if (msg.type === "indices") onUpdate(msg.data);
  });
  useEffect(() => {
    setIndicesStatus(result.status);
  }, [result.status, setIndicesStatus]);
  return result;
}


export function usePricesStream(
  symbols: string[],
  markets: string[],
  onUpdate: (prices: any[]) => void,
  // 서버가 허용하는 범위는 5~60초. 15초는 '숫자가 움직인다'고 느끼는 하한이면서
  // 외부 시세 API를 차단당하지 않는 선이다(서버도 같은 주기로 값을 갱신한다).
  interval = 15
) {
  const rawSymbols = symbols.join(",");
  const rawMarkets = markets.join(",");

  const wsUrl = useMemo(() => {
    // 심볼과 마켓을 쌍으로 묶어 심볼 기준 정렬 — 서버가 같은 종목 집합을 다른
    // 순서로 내려줘도 URL이 동일하게 유지되므로 불필요한 재연결이 생기지 않는다.
    // 서버는 zip(symbols, markets)로 짝을 맞추므로 쌍을 유지한 채 정렬해야 한다.
    //
    // 중복도 여기서 제거한다. 같은 종목을 여러 포트폴리오에 담으면 그만큼
    // 구독 슬롯과 주소 길이를 낭비해, 실제 보유 종목이 적은데도 상한에 걸렸다.
    const syms = rawSymbols ? rawSymbols.split(",") : [];
    const mkts = rawMarkets ? rawMarkets.split(",") : [];
    const seen = new Set<string>();
    const pairs: [string, string][] = [];
    syms.forEach((sym, i) => {
      if (!sym || seen.has(sym)) return;
      seen.add(sym);
      pairs.push([sym, mkts[i] ?? "US"]);
    });
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const symbolsKey = pairs.map((p) => p[0]).join(",");
    const marketsKey = pairs.map((p) => p[1]).join(",");
    return `${getWsBase()}/ws/prices?symbols=${symbolsKey}&markets=${marketsKey}&interval=${interval}`;
  }, [rawSymbols, rawMarkets, interval]);

  const enabled = symbols.length > 0;

  return useWebSocket<{ type: string; data: any[]; sent_at?: number }>(
    wsUrl,
    (msg) => {
      if (msg.type === "prices") onUpdate(msg.data);
    },
    { enabled }
  );
}
