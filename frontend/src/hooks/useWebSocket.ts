import { useEffect, useRef, useState, useCallback } from "react";
import { useWSStore } from "@/store/wsStore";

type WSStatus = "connecting" | "connected" | "disconnected";

export function useWebSocket<T>(
  url: string,
  onMessage: (data: T) => void,
  options?: { enabled?: boolean; reconnectDelay?: number }
) {
  const { enabled = true, reconnectDelay = 3000 } = options ?? {};
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<WSStatus>("disconnected");
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  // onMessage를 ref로 저장 — deps 변경 없이 항상 최신 콜백 사용
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  const connect = useCallback(() => {
    if (!enabled || !isMounted.current) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      if (isMounted.current) setStatus("connected");
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as T;
        if (isMounted.current) onMessageRef.current(data);
      } catch {}
    };

    ws.onclose = () => {
      if (!isMounted.current) return;
      setStatus("disconnected");
      reconnectTimer.current = setTimeout(connect, reconnectDelay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url, enabled, reconnectDelay]); // onMessage 제거 — ref로 처리

  useEffect(() => {
    isMounted.current = true;
    connect();
    return () => {
      isMounted.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

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
  interval = 5
) {
  const enabled = symbols.length > 0;
  const wsUrl =
    `${getWsBase()}/ws/prices` +
    `?symbols=${symbols.join(",")}&markets=${markets.join(",")}&interval=${interval}`;

  return useWebSocket<{ type: string; data: any[] }>(
    wsUrl,
    (msg) => {
      if (msg.type === "prices") onUpdate(msg.data);
    },
    { enabled }
  );
}
