/**
 * 쓰던 글이 날아가지 않는가, 그리고 안 변하는 값을 헛되이 다시 묻지 않는가.
 *
 * 글쓰기 화면은 저장이 실패해도 내용을 지키고 있었고(화면을 안 떠난다),
 * 뒤로 갈 때도 한 번 물어본다. 그 둘 사이에 구멍이 있었다 — 새로고침,
 * 탭 닫기, 휴대폰이 배경에서 앱을 정리하는 경우다.
 *
 * 휴대폰에서 긴 글을 쓰다가 전화가 오거나 다른 앱을 잠깐 보고 오면
 * 브라우저가 화면을 버리는 일이 흔하다. 돌아오면 빈 칸이다.
 */
import { renderHook, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

import { use임시저장, use임시본알림, 임시저장읽기, 임시저장지우기 } from "../useDraft";

const 열쇠 = "검사-임시본";

beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });
afterEach(cleanup);

const 소스 = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf-8");
const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("담고 꺼내기", () => {
  it("담은 것을 그대로 꺼낸다", () => {
    localStorage.setItem(열쇠, JSON.stringify({ 값: { body: "쓰던 글" }, 때: Date.now() }));
    expect(임시저장읽기<{ body: string }>(열쇠)?.body).toBe("쓰던 글");
  });

  it("오래된 것은 없는 셈 친다", () => {
    /* 몇 주 전에 쓰다 만 글이 되살아나면 복구가 아니라 방해다 */
    const 이틀전 = Date.now() - 1000 * 60 * 60 * 48;
    localStorage.setItem(열쇠, JSON.stringify({ 값: { body: "옛날 글" }, 때: 이틀전 }));
    expect(임시저장읽기(열쇠)).toBeNull();
    expect(localStorage.getItem(열쇠)).toBeNull();   // 자리도 비운다
  });

  it("손상된 것에 터지지 않는다", () => {
    localStorage.setItem(열쇠, "{망가진");
    expect(임시저장읽기(열쇠)).toBeNull();
  });

  it("시각이 없으면 믿지 않는다", () => {
    localStorage.setItem(열쇠, JSON.stringify({ 값: { body: "x" } }));
    expect(임시저장읽기(열쇠)).toBeNull();
  });

  it("지우면 없어진다", () => {
    localStorage.setItem(열쇠, JSON.stringify({ 값: 1, 때: Date.now() }));
    임시저장지우기(열쇠);
    expect(localStorage.getItem(열쇠)).toBeNull();
  });
});

describe("자동으로 담는다", () => {
  it("글자를 멈추면 담는다", async () => {
    vi.useFakeTimers();
    renderHook(() => use임시저장(열쇠, { body: "안녕" }, true));
    expect(localStorage.getItem(열쇠)).toBeNull();     // 아직 안 담는다
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(임시저장읽기<{ body: string }>(열쇠)?.body).toBe("안녕");
    vi.useRealTimers();
  });

  it("빈 글은 담지 않는다", async () => {
    /* 빈 임시본이 생기면 다음에 열 때 '이어서 쓰시겠어요' 가 헛되이 뜬다 */
    vi.useFakeTimers();
    renderHook(() => use임시저장(열쇠, { body: "" }, false));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(localStorage.getItem(열쇠)).toBeNull();
    vi.useRealTimers();
  });

  it("다 지우면 담아 뒀던 것도 치운다", async () => {
    vi.useFakeTimers();
    localStorage.setItem(열쇠, JSON.stringify({ 값: { body: "예전" }, 때: Date.now() }));
    renderHook(() => use임시저장(열쇠, { body: "" }, false));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(localStorage.getItem(열쇠)).toBeNull();
    vi.useRealTimers();
  });

  it("화면이 숨겨지면 기다리지 않고 바로 담는다", () => {
    /* 휴대폰이 앱을 배경으로 보낼 때가 화면이 버려지는 순간이다.
       0.8초 시계를 기다릴 여유가 없다 */
    renderHook(() => use임시저장(열쇠, { body: "급한 글" }, true));
    Object.defineProperty(document, "visibilityState",
      { value: "hidden", configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(임시저장읽기<{ body: string }>(열쇠)?.body).toBe("급한 글");
    Object.defineProperty(document, "visibilityState",
      { value: "visible", configurable: true });
  });

  it("탭을 닫을 때도 담는다", () => {
    renderHook(() => use임시저장(열쇠, { body: "닫기 직전" }, true));
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(임시저장읽기<{ body: string }>(열쇠)?.body).toBe("닫기 직전");
  });

  it("담을 것이 없으면 숨겨져도 안 담는다", () => {
    renderHook(() => use임시저장(열쇠, { body: "" }, false));
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(localStorage.getItem(열쇠)).toBeNull();
  });

  it("브라우저가 저장을 막아도 화면이 안 터진다", () => {
    const 원래 = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("막힘"); };
    expect(() => {
      renderHook(() => use임시저장(열쇠, { body: "x" }, true));
      act(() => { window.dispatchEvent(new Event("pagehide")); });
    }).not.toThrow();
    Storage.prototype.setItem = 원래;
  });
});

describe("열 때 물어본다", () => {
  it("담아 둔 것이 있으면 알려 준다", () => {
    localStorage.setItem(열쇠, JSON.stringify({ 값: { body: "이어 쓸 글" }, 때: Date.now() }));
    const { result } = renderHook(() => use임시본알림<{ body: string }>(열쇠));
    expect(result.current.임시본?.body).toBe("이어 쓸 글");
  });

  it("없으면 조용하다", () => {
    const { result } = renderHook(() => use임시본알림(열쇠));
    expect(result.current.임시본).toBeNull();
  });

  it("버리면 자리까지 비운다", () => {
    localStorage.setItem(열쇠, JSON.stringify({ 값: { body: "x" }, 때: Date.now() }));
    const { result } = renderHook(() => use임시본알림(열쇠));
    act(() => { result.current.버리기(); });
    expect(result.current.임시본).toBeNull();
    expect(localStorage.getItem(열쇠)).toBeNull();
  });

  it("닫기는 알림만 접고 담아 둔 것은 남긴다", () => {
    /* 이어 쓰기를 눌러 되살린 뒤에도, 저장 전에 또 날아갈 수 있다 */
    localStorage.setItem(열쇠, JSON.stringify({ 값: { body: "x" }, 때: Date.now() }));
    const { result } = renderHook(() => use임시본알림(열쇠));
    act(() => { result.current.닫기(); });
    expect(result.current.임시본).toBeNull();
    expect(localStorage.getItem(열쇠)).not.toBeNull();
  });
});

describe("글쓰기 화면에 실제로 붙어 있다", () => {
  const s = 코드만(소스("pages/FeedWrite.tsx"));

  it("담고 알리고 되살린다", () => {
    expect(s).toContain("use임시저장(");
    expect(s).toContain("use임시본알림<");
    expect(s).toContain("임시본이어쓰기");
  });

  it("올린 뒤에는 담아 둔 것을 치운다", () => {
    const i = s.indexOf('navigate("/feed", { replace: true })');
    expect(i).toBeGreaterThan(-1);
    expect(s.slice(Math.max(0, i - 300), i)).toContain("임시저장지우기");
  });

  it("버리고 나갈 때도 치운다", () => {
    expect(s).toContain("임시저장지우기(임시본열쇠); navigate(\"/feed\")");
  });

  it("사진은 담지 않는다", () => {
    /* 압축해도 수백 KB 라 localStorage 한도를 금방 먹고,
       그러면 정작 글자가 안 담긴다 */
    const i = s.indexOf("const 쓴것 = useMemo");
    const 묶음 = s.slice(i, s.indexOf("}), [", i));
    expect(묶음).not.toContain("image");
  });
});

describe("안 변하는 값을 헛되이 다시 묻지 않는다", () => {
  it("환율은 서버 캐시 수명에 맞춘다", () => {
    /* 서버가 300초 담아 두는데 화면은 60초마다 물었다 —
       다섯 번 중 네 번은 같은 답을 받으려고 왕복한 셈이다.

       내 자산 화면 쪽은 숫자를 직접 안 적고 공통 상수를 쓴다
       (constants/portfolioQuery 의 하루수명). 그래서 여기서는 '60초가
       아니다' 와 '300초짜리 값을 쓴다' 를 따로 본다 — 리터럴만 찾으면
       상수로 옮긴 파일이 애먼 실패로 걸린다. */
    for (const rel of ["pages/MyPage.tsx", "pages/UserProfile.tsx",
                       "pages/FeedWrite.tsx", "components/portfolio/PortfolioSnapshot.tsx"]) {
      const t = 코드만(소스(rel));
      const i = t.indexOf('queryKey: ["exchange-rate"]');
      expect(i, `${rel} 에 환율 조회가 없다`).toBeGreaterThan(-1);
      const 묶음 = t.slice(i, i + 400);
      expect(묶음, rel).not.toContain("refetchInterval: 60_000");
      expect(묶음, rel).toMatch(/refetchInterval:\s*(300_000|하루수명)/);
    }
  });

  it("공통 상수가 정말 300초다", async () => {
    /* 위 검사가 이름으로 통과할 수 있으니, 그 이름이 가리키는 값을
       여기서 못 박는다 */
    const { 하루수명 } = await import("@/constants/portfolioQuery");
    expect(하루수명).toBe(300_000);
  });

  it("시세는 장이 닫히면 안 묻는다", async () => {
    const { 시세갱신주기 } = await import("@/hooks/useLivePrices");
    /* 토요일 — 어느 시장도 안 열린다 */
    const 토요일 = new Date(Date.UTC(2026, 7, 22, 3, 0));
    expect(시세갱신주기(["KR"], 토요일)).toBe(false);
    expect(시세갱신주기(["US"], 토요일)).toBe(false);
  });

  it("장중에는 1분마다 본다", async () => {
    const { 시세갱신주기 } = await import("@/hooks/useLivePrices");
    /* 목요일 한국 오전 10시 = UTC 01:00 */
    const 장중 = new Date(Date.UTC(2026, 7, 20, 1, 0));
    expect(시세갱신주기(["KR"], 장중)).toBe(60_000);
  });

  it("시간외에는 덜 자주 본다", async () => {
    const { 시세갱신주기 } = await import("@/hooks/useLivePrices");
    /* 목요일 한국 오후 4시 = UTC 07:00 (장마감 시간외) */
    const 시간외 = new Date(Date.UTC(2026, 7, 20, 7, 0));
    expect(시세갱신주기(["KR"], 시간외)).toBe(180_000);
  });

  it("목록 화면들이 실제로 이 규칙을 쓴다", () => {
    for (const rel of ["pages/Watchlist.tsx", "pages/Quant.tsx", "pages/UserProfile.tsx"]) {
      expect(코드만(소스(rel)), rel).toContain("시세갱신주기(");
    }
  });
});
