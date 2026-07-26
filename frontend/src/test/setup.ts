import "@testing-library/jest-dom/vitest";

/* jsdom에는 없는 브라우저 API 보충 — 컴포넌트가 이걸 쓰면 테스트가 죽는다 */
if (!("IntersectionObserver" in globalThis)) {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  (globalThis as any).IntersectionObserver = MockIntersectionObserver;
}

if (!("ResizeObserver" in globalThis)) {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = MockResizeObserver;
}

if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as any;
}

/* 실시간 시세용 WebSocket — 테스트에서는 연결하지 않는다 */
class MockWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 0;
  onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null;
  close() { this.readyState = 3; }
  send() {}
}
(globalThis as any).WebSocket = MockWebSocket;
