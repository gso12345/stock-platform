/**
 * 환율이 **진짜 받아 온 값인지 어림값인지** 구분하는가.
 *
 * ── 왜 구분해야 하나 ──────────────────────────────────────
 *
 * 못 받으면 1350 을 쓴다. 화면에는 '오늘 환율' 처럼 보이지만 아니다.
 *
 * 평가금액을 눈으로 보는 자리에서는 몇십 원 차이라 넘어갈 만하다.
 * 그런데 그 수로 **비중을 매겨 백테스트에 넣는** 자리에서는 다르다 —
 * 달러 종목의 비중이 어긋난 채로 지난 20년을 재게 되고, 화면에는
 * 아무 표시도 안 난다. 결과는 멀쩡해 보이는데 답이 틀린, 제일 나쁜
 * 모양이다.
 *
 * 그래서 값과 **출처**를 같이 돌려준다. 쓰는 쪽이 '어림값이면 적어
 * 둔다' 를 고를 수 있어야 한다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const 상태 = vi.hoisted(() => ({
  환율응답: null as any,
  금리응답: [] as any[],
}));

vi.mock("@/api/stocks", () => ({
  dashboardApi: {
    getExchangeRate: vi.fn(() => Promise.resolve(상태.환율응답)),
    getUSRates: vi.fn(() => Promise.resolve(상태.금리응답)),
  },
}));

import { useExchangeRateLive, useExchangeRate, DEFAULT_FX } from "../useExchangeRate";

function 감싸기({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  상태.환율응답 = null;
  상태.금리응답 = [];
});


describe("받아 온 값이면 진짜라고 한다", () => {
  it("전용 경로가 값을 주면 그 값을 쓴다", async () => {
    상태.환율응답 = { value: 1389, change_rate: 0.4 };
    const { result } = renderHook(() => useExchangeRateLive(), { wrapper: 감싸기 });
    await waitFor(() => expect(result.current.환율).toBe(1389));
    expect(result.current.진짜인가).toBe(true);
  });

  it("전용 경로가 실패해도 금리 목록에서 찾아 쓴다", async () => {
    /* 서버가 표시 이름을 바꾸면 조용히 어림값으로 떨어지던 자리다.
       그래서 느슨하게 찾는 2순위를 둔다 — 이것도 **받아 온 값**이다. */
    상태.환율응답 = { value: 0 };
    상태.금리응답 = [{ name: "원/달러", value: 1402 }];
    const { result } = renderHook(() => useExchangeRateLive(), { wrapper: 감싸기 });
    await waitFor(() => expect(result.current.환율).toBe(1402));
    expect(result.current.진짜인가, "받아 온 값인데 어림값이라고 한다").toBe(true);
  });
});


describe("못 받으면 **어림값이라고 말한다**", () => {
  it("둘 다 실패하면 진짜인가가 false 다", async () => {
    상태.환율응답 = { value: 0 };
    상태.금리응답 = [];
    const { result } = renderHook(() => useExchangeRateLive(), { wrapper: 감싸기 });
    await waitFor(() => expect(result.current.환율).toBe(DEFAULT_FX));
    expect(result.current.진짜인가,
      "1350 을 쓰면서 진짜 환율인 척한다 — 달러 종목 비중이 조용히 어긋난다")
      .toBe(false);
  });

  it("응답이 아예 없어도 어림값이라고 한다", async () => {
    상태.환율응답 = null;
    const { result } = renderHook(() => useExchangeRateLive(), { wrapper: 감싸기 });
    await waitFor(() => expect(result.current.환율).toBe(DEFAULT_FX));
    expect(result.current.진짜인가).toBe(false);
  });

  it("값이 음수처럼 말이 안 되면 안 쓴다", async () => {
    상태.환율응답 = { value: -5 };
    const { result } = renderHook(() => useExchangeRateLive(), { wrapper: 감싸기 });
    await waitFor(() => expect(result.current.환율).toBe(DEFAULT_FX));
    expect(result.current.진짜인가).toBe(false);
  });
});


describe("예전 훅은 그대로 쓸 수 있다", () => {
  it("useExchangeRate 는 값만 돌려준다", async () => {
    /* 여러 화면이 이 이름으로 쓰고 있다. 새 훅을 더하면서 이쪽이
       달라지면 그 화면들이 조용히 틀어진다. */
    상태.환율응답 = { value: 1389 };
    const { result } = renderHook(() => useExchangeRate(), { wrapper: 감싸기 });
    await waitFor(() => expect(result.current).toBe(1389));
  });
});
