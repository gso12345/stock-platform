/**
 * 실패한 언론사 목록이 읽히는가.
 *
 * 실패 이유를 화면에 띄우고 나서 실제 프로덕션 화면을 봤더니 두 가지가
 * 어긋나 있었다.
 *
 *   1) 이유가 어느 언론사 것인지 헷갈린다
 *      한 줄에 여러 언론사가 flex-wrap 으로 흐르다 보니 이유가 다음
 *      줄로 넘어갔고, 넘어간 이유가 아래 언론사 것처럼 보였다.
 *      실제 화면에서 이렇게 읽혔다 —
 *
 *          한국경제TV (38회 연속)
 *          피드에 기사가 없음        ← 서울경제 것인지 한국경제TV 것인지
 *          서울경제 (38회 연속) HTTP 404
 *
 *      이유를 보여 주는 게 이 목록의 존재 이유인데, 그게 어느 곳
 *      이야기인지 모르면 없는 것만 못하다.
 *
 *   2) 36곳이 실패 중인데 20곳만 보였다
 *      slice(0, 20) 이 있었다. 안 보이는 16곳은 고칠 수도 없다.
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

/** 실패한 언론사 n곳을 만든다 */
function 실패목록(n: number, 쉬는수 = 0) {
  return Array.from({ length: n }, (_, i) => ({
    name: `뉴스:매체${i}`,
    ok: 0, fail: 38, streak: 38,
    last_error: `HTTP 404 — 없는 주소 ${i}`,
    last_at: new Date().toISOString(),
  })).map((h, i) => (i < 쉬는수 ? h : h));
}

/* 오류표가 따로 부르는 자리. 시험마다 갈아 끼운다 */
let 오류응답: any = { 요약: { 종류: 0, 전체횟수: 0, 한시간_종류: 0, 한시간_횟수: 0, 가장_잦은: null }, 목록: [] };

beforeEach(() => {
  오류응답 = { 요약: { 종류: 0, 전체횟수: 0, 한시간_종류: 0, 한시간_횟수: 0, 가장_잦은: null }, 목록: [] };
  get.mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes("db-stats")) return Promise.resolve({ data: { tables: [] } });
    if (u.includes("/errors")) return Promise.resolve({ data: 오류응답 });
    return Promise.resolve({ data: 응답 });
  });
});

describe("실패한 언론사 목록", () => {
  it("36곳이면 36곳을 다 보여준다 — 안 보이면 고칠 수도 없다", async () => {
    그리기({ ...실제응답, health: 실패목록(36) });
    await screen.findByText(/지금 실패 중인 언론사/);
    /* 글자를 통째로 이어 붙여 놓고 정규식으로 찾으면 안 된다 —
       "매체0" 바로 뒤에 "38회 연속" 이 붙어서 숫자 경계가 안 잡힌다.
       이름은 제 칸에 따로 들어 있으므로 그 칸을 직접 찾는다. */
    for (const i of [0, 19, 20, 35]) {
      expect(screen.getByText(`매체${i}`)).toBeTruthy();
    }
    expect(screen.getAllByText(/^매체\d+$/)).toHaveLength(36);
  });

  it("이유가 그 언론사 상자 안에 들어 있다", async () => {
    그리기({ ...실제응답, health: 실패목록(3) });
    await screen.findByText(/지금 실패 중인 언론사/);

    const 줄 = screen.getByText("매체1").closest("[class*='border-l']");
    expect(줄?.textContent).toContain("매체1");
    expect(줄?.textContent).toContain("없는 주소 1");
    expect(줄?.textContent).not.toContain("매체0");
    expect(줄?.textContent).not.toContain("매체2");
  });

  it("언론사 사이가 이름·이유 사이보다 넓다", async () => {
    /* 이게 화면에서 헷갈렸던 진짜 이유다. DOM 은 예전에도 맞았다 —
       언론사마다 제 상자가 있었다. 그런데 상자 사이가 2px(gap-0.5)이고
       상자 안에서 이유가 다음 줄로 넘어가니, 넘어간 이유가 아래 상자의
       이름과 거의 붙어 보였다.

           한국경제TV (38회 연속)
           피드에 기사가 없음        ← 아래 것처럼 읽힌다
           서울경제 (38회 연속) HTTP 404

       바깥 간격이 안쪽 간격보다 넓어야 묶음이 눈에 보인다. */
    그리기({ ...실제응답, health: 실패목록(3) });
    await screen.findByText(/지금 실패 중인 언론사/);

    const 줄 = screen.getByText("매체1").closest("[class*='border-l']") as HTMLElement;
    const 목록 = 줄.parentElement as HTMLElement;
    const 칸 = (el: HTMLElement) =>
      Number(/gap-(\d+(?:\.\d+)?)/.exec(el.className)?.[1] ?? 0);

    expect(칸(목록)).toBeGreaterThan(칸(줄));
  });

  it("언론사마다 눈에 보이는 묶음 표시가 있다", async () => {
    그리기({ ...실제응답, health: 실패목록(3) });
    await screen.findByText(/지금 실패 중인 언론사/);
    for (const i of [0, 1, 2]) {
      const 줄 = screen.getByText(`매체${i}`).closest("[class*='border-l']");
      expect(줄, `매체${i} 에 묶음 표시가 없다`).toBeTruthy();
    }
  });

  it("연속 실패 횟수를 적는다", async () => {
    그리기({ ...실제응답, health: 실패목록(2) });
    await screen.findByText(/지금 실패 중인 언론사/);
    expect(글자(/38회 연속/)).toBe(true);
  });

  it("실패가 없으면 목록 자체가 없다", async () => {
    그리기({ ...실제응답, health: [] });
    await screen.findByText(/뉴스 수집/);
    expect(글자(/지금 실패 중인 언론사/)).toBe(false);
  });
});

describe("쉬는 중 표시", () => {
  const 뉴스 = (실제응답 as any).news;

  it("쉬는 곳에는 표를 붙인다", async () => {
    그리기({
      ...실제응답,
      health: 실패목록(3),
      news: { ...뉴스, resting: ["매체0", "매체2"], probe: 2 },
    });
    await screen.findByText(/지금 실패 중인 언론사/);
    expect(screen.getAllByText("쉬는 중")).toHaveLength(2);
  });

  it("몇 곳이 쉬는지, 회차당 몇 칸만 다시 보는지 적는다", async () => {
    /* 이게 없으면 '실패 36곳' 만 보고 서버가 매 회차 거기에 시간을
       쓰고 있다고 읽는다 — 실제로는 거의 안 쓴다 */
    그리기({
      ...실제응답,
      health: 실패목록(36),
      news: { ...뉴스, resting: 실패목록(36).map((h) => h.name.replace("뉴스:", "")), probe: 2 },
    });
    await screen.findByText(/뉴스 수집/);
    expect(글자(/계속 실패한 36곳은 쉬는 중/)).toBe(true);
    expect(글자(/회차당 2칸만 다시 시도/)).toBe(true);
  });

  it("쉬는 곳이 없으면 그 문구는 안 나온다", async () => {
    그리기({ ...실제응답, health: 실패목록(2), news: { ...뉴스, resting: [] } });
    await screen.findByText(/뉴스 수집/);
    expect(글자(/쉬는 중/)).toBe(false);
  });

  it("옛 서버(resting 을 안 주는)에서도 안 터진다", async () => {
    const { resting, probe, ...옛것 } = { ...뉴스, resting: [], probe: 2 } as any;
    그리기({ ...실제응답, health: 실패목록(2), news: 옛것 });
    await screen.findByText(/지금 실패 중인 언론사/);
    expect(글자(/매체0/)).toBe(true);
    expect(resting).toBeDefined();
    expect(probe).toBeDefined();
  });
});

/* ── 오류표가 스스로 터지지 않는가 ─────────────────────────
 *
 * 오류를 보여 주려고 만든 자리가 스스로 오류를 내면 앞뒤가 안 맞는다.
 * 실제로 그랬다 — 서버 응답에 '요약' 이 없으면 관리자 화면 전체가
 * 흰 화면이 됐다. 배포 직후 몇 분간(백엔드가 아직 옛 버전) 정확히
 * 그 상태가 된다. */
describe("오류표", () => {
  it("서버가 아직 이 기능을 몰라도 화면이 안 깨진다", async () => {
    /* 배포 직후 몇 분간 백엔드가 옛 버전이라 404 가 온다 */
    get.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("db-stats")) return Promise.resolve({ data: { tables: [] } });
      if (u.includes("/errors")) return Promise.reject({ response: { status: 404 } });
      return Promise.resolve({ data: 응답 });
    });
    그리기(실제응답);
    await screen.findByText(/지금 실패 중인 언론사|주기 갱신/);
    expect(글자(/최근 오류/)).toBe(false);
  });

  it("응답이 반쪽이어도 안 깨진다", async () => {
    /* 목록만 오고 요약이 없는 경우 — 화면 전체가 흰 화면이 됐었다 */
    오류응답 = { 목록: [] };
    그리기(실제응답);
    await screen.findByText(/주기 갱신|지금 실패 중인 언론사/);
    expect(글자(/최근 오류/)).toBe(false);
  });

  it("터진 것이 있으면 무엇이 몇 번인지 보여준다", async () => {
    오류응답 = {
      요약: { 종류: 2, 전체횟수: 7, 한시간_종류: 1, 한시간_횟수: 5, 가장_잦은: "TypeError" },
      목록: [{ 어디: "화면", 무엇: "TypeError", 자세히: "터짐", 어디서: "/",
               횟수: 5, 처음: "08/25 09:00:00", 마지막: "08/25 09:30:00", 지난초: 60 }],
    };
    그리기(실제응답);
    expect(await screen.findByText("TypeError")).toBeTruthy();
    expect(screen.getByText("×5")).toBeTruthy();
  });

  it("조용하면 조용하다고 적는다", async () => {
    오류응답 = {
      요약: { 종류: 3, 전체횟수: 9, 한시간_종류: 0, 한시간_횟수: 0, 가장_잦은: "ValueError" },
      목록: [{ 어디: "GET /x", 무엇: "ValueError", 자세히: "예전 것", 어디서: "",
               횟수: 9, 처음: "08/24 10:00:00", 마지막: "08/24 11:00:00", 지난초: 80000 }],
    };
    그리기(실제응답);
    await screen.findByText("ValueError");
    expect(글자(/최근 1시간에는 조용합니다/)).toBe(true);
  });
});
