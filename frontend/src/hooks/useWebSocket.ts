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
  // 서버(/ws/prices)가 허용하는 범위는 10~60초 — 이보다 작은 값을 보내면
  // 요청 검증에서 거부되어 연결이 곧바로 끊기고 재연결만 반복된다
  interval = 30
) {
  const enabled = symbols.length > 0;
  const rawSymbols = symbols.join(",");
  const rawMarkets = markets.join(",");

  const wsUrl = useMemo(() => {
    // 심볼과 마켓을 쌍으로 묶어 심볼 기준 정렬 — 서버가 같은 종목 집합을 다른
    // 순서로 내려줘도 URL이 동일하게 유지되므로 불필요한 재연결이 생기지 않는다.
    // 서버는 zip(symbols, markets)로 짝을 맞추므로 쌍을 유지한 채 정렬해야 한다.
    const syms = rawSymbols ? rawSymbols.split(",") : [];
    const mkts = rawMarkets ? rawMarkets.split(",") : [];
    const pairs: [string, string][] = syms.map((s, i) => [s, mkts[i] ?? "US"]);
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const symbolsKey = pairs.map((p) => p[0]).join(",");
    const marketsKey = pairs.map((p) => p[1]).join(",");
    return `${getWsBase()}/ws/prices?symbols=${symbolsKey}&markets=${marketsKey}&interval=${interval}`;
  }, [rawSymbols, rawMarkets, interval]);

  return useWebSocket<{ type: string; data: any[] }>(
    wsUrl,
    (msg) => {
      if (msg.type === "prices") onUpdate(msg.data);
    },
    { enabled }
  );
}
