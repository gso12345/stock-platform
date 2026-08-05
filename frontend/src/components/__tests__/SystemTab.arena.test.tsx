/**
 * 힙 나눔 상한이 화면에 보이는가.
 *
 * MALLOC_ARENA_MAX 는 환경변수라 코드에 흔적이 없다. 화면에서 확인할 수
 * 없으면 배포한 뒤 '설정이 걸리긴 한 건가'를 알 방법이 없고, 그러면
 * '비었지만 붙들고 있음' 이 줄었는지도 그 설정 덕인지 판단할 수 없다.
 *
 * 실제로 그 상태를 한 번 겪었다 — 485MB 중 245.6MB 가 붙들고만 있던 몫.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
vi.mock("@/api/client", () => ({ default: { get: (...a: any[]) => get(...a) } }));

import SystemTab from "../admin/SystemTab";
import 실제응답 from "./runtime.fixture.json";

let 응답: any = {};
function 그리기(런타임값: any) {
  응답 = 런타임값;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={qc}><SystemTab /></QueryClientProvider>,
  );
}
function 글자(정규식: RegExp) {
  return 정규식.test(document.body.textContent ?? "");
}

beforeEach(() => {
  get.mockImplementation((url: string) =>
    Promise.resolve({ data: String(url).includes("db-stats") ? { tables: [] } : 응답 }));
});

describe("힙 나눔 상한", () => {
  it("설정이 없으면 '제한 없음' 이라고 알려준다", async () => {
    그리기({ ...실제응답 });
    await screen.findByText(/힙 나눔 상한/);
    expect(글자(/제한 없음/)).toBe(true);
    // 왜 문제인지도 적혀 있어야 한다
    expect(글자(/빈 자리가 흩어져/)).toBe(true);
  });

  it("설정이 걸려 있으면 그 값을 보여준다", async () => {
    그리기({ ...실제응답, native: { ...(실제응답 as any).native, arena_max: "2" } });
    await screen.findByText(/힙 나눔 상한/);
    expect(글자(/2개/)).toBe(true);
    expect(글자(/제한 없음/)).toBe(false);
  });

  it("붙들고 있는 몫을 그대로 보여준다", async () => {
    /* 이 숫자가 이번 조사의 출발점이었다 — 485 중 245.6 */
    그리기({ ...실제응답 });
    await screen.findByText(/힙 나눔 상한/);
    expect(글자(/245\.6MB/)).toBe(true);
  });

  it("서버가 아직 이 값을 안 보내도 화면이 깨지지 않는다", async () => {
    /* 백엔드 배포가 프런트보다 늦으면 arena_max 가 없다 */
    const { arena_max: _버림, ...나머지 } = (실제응답 as any).native;
    그리기({ ...실제응답, native: 나머지 });
    await screen.findByText(/힙 나눔 상한/);
    expect(글자(/제한 없음/)).toBe(true);
  });
});
