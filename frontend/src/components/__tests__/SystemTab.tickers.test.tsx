/**
 * 종목 목록이 줄어든 것을 화면이 감추지 않는가.
 *
 * 국내 목록이 세 단계 폴백을 전부 실패하고 내장 115개로 돌던 적이 있다.
 * 그 목록에 없는 종목은 검색도 시세 조회도 안 됐는데, 화면에는 아무 표시가
 * 없어서 몇 주 동안 아무도 몰랐다. 미국도 똑같이 코드에 적어둔 128개로
 * 돌고 있었고, 사용자가 "미국 모든 종목이 조회 가능하면 좋겠어"라고 말하고
 * 나서야 알았다.
 *
 * 그래서 여기서 못 박는 건 예쁜 화면이 아니라 **줄어든 걸 크게 알리는가** 다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
vi.mock("@/api/client", () => ({ default: { get: (...a: any[]) => get(...a) } }));

import SystemTab from "../admin/SystemTab";
/* 손으로 짜맞춘 응답은 실제와 어긋나기 마련이라, /admin/runtime 을 실제로
   불러 찍어낸 것을 쓴다. 서버가 필드를 바꾸면 이 파일도 다시 찍으면 된다 */
import 실제응답 from "./runtime.fixture.json";

function 런타임(덮어쓰기: Record<string, any> = {}) {
  return { ...실제응답, ...덮어쓰기 };
}

/** 화면 글자에서 찾는다 — 경고 문구는 <b> 로 쪼개져 있어 한 노드만 보는
 *  getByText 로는 안 잡힌다.
 *
 *  범위를 나눌 수 있어야 한다. 같은 문구가 맨 위 빨간 경고창과 아래 카드
 *  양쪽에 있어서, 화면 전체로만 찾으면 '경고창이 안 뜨는 사고'를 카드가
 *  가려버린다. */
function 글자(정규식: RegExp, 범위: "전체" | "경고창" = "전체") {
  const el = 범위 === "경고창" ? screen.queryByRole("alert") : document.body;
  return 정규식.test(el?.textContent ?? "");
}

let 응답: any = {};

function 그리기(런타임값: any) {
  응답 = 런타임값;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SystemTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  /* mockReset 을 쓰면 앞 테스트에서 아직 날아다니던 요청이 구현 없는 mock 을
     만나 터진다. 구현은 한 번만 심고 응답만 갈아끼운다 */
  get.mockImplementation((url: string) =>
    Promise.resolve({ data: String(url).includes("db-stats") ? { tables: [] } : 응답 }));
});

describe("미국 종목 목록 상태", () => {
  it("내장 목록으로 떨어지면 경고를 띄운다", async () => {
    그리기(런타임({
      us_tickers: {
        source: "내장", count: 182, etf_count: 34, age_sec: null,
        builtin_count: 182, degraded: true, ttl_sec: 86400,
        db_rows: 0, db_error: null,
      },
    }));
    await screen.findByText(/미국 종목 목록 출처/);
    // 맨 위 빨간 경고창에 떠야 한다. 아래 카드에만 적히면 스크롤해야 보인다
    expect(글자(/미국 종목이 182개뿐입니다/, "경고창")).toBe(true);
    // 무엇이 안 되는지까지 적혀 있어야 한다 — 숫자만 보고는 심각한 줄 모른다
    expect(글자(/검색이 되지 않습니다/, "경고창")).toBe(true);
    // 아래 카드에도 같은 사실이 적혀 있어야 한다
    expect(글자(/외부 조회가 실패해 내장 182개로 동작 중입니다/)).toBe(true);
  });

  it("제대로 받아왔으면 경고하지 않는다", async () => {
    그리기(런타임({
      us_tickers: {
        source: "NASDAQ Trader", count: 6787, etf_count: 3421, age_sec: 3600,
        builtin_count: 182, degraded: false, ttl_sec: 86400,
        db_rows: 6787, db_error: null,
      },
    }));
    await screen.findByText(/미국 종목 목록 출처/);
    expect(글자(/NASDAQ Trader/)).toBe(true);
    expect(글자(/미국 종목이 .*개뿐입니다/)).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ETF 개수를 따로 보여준다", async () => {
    /* 건수만 보면 otherlisted 를 통째로 못 받은 걸 못 잡는다 —
       ETF 는 대부분 NYSE Arca 에 있어서 그쪽 파일에만 들어 있다 */
    그리기(런타임({
      us_tickers: {
        source: "NASDAQ Trader", count: 6787, etf_count: 3421, age_sec: 3600,
        builtin_count: 182, degraded: false, ttl_sec: 86400,
        db_rows: 6787, db_error: null,
      },
    }));
    await screen.findByText(/미국 종목 목록 출처/);
    expect(글자(/ETF 3,421개 포함/)).toBe(true);
  });

  it("DB 저장이 안 됐으면 그것도 알린다", async () => {
    /* 저장이 안 되면 재시작마다 밖으로 나가고, 그때마다 실패할 수 있다 */
    그리기(런타임({
      us_tickers: {
        source: "NASDAQ Trader", count: 6787, etf_count: 3421, age_sec: 60,
        builtin_count: 182, degraded: false, ttl_sec: 86400,
        db_rows: null, db_error: "저장 실패: ProgrammingError: relation 없음",
      },
    }));
    await screen.findByText(/미국 종목 목록 출처/);
    expect(글자(/DB 저장 안 됨/)).toBe(true);
  });

  it("서버가 아직 미국 목록을 모르면 조용히 지나간다", async () => {
    /* 백엔드 배포가 프론트보다 늦으면 us_tickers 가 아예 없다.
       그때 화면이 깨지면 다른 지표까지 못 본다 */
    const { us_tickers: _버림, ...나머지 } = 실제응답 as any;
    그리기(나머지);
    await screen.findByText(/국내 종목 목록 출처/);
    expect(글자(/미국 종목 목록 출처/)).toBe(false);
  });
});
