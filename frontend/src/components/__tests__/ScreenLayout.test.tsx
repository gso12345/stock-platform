/**
 * 화면 모양 — 늘 '앱처럼'(큰 가격 → 곧바로 차트 → 그 아래 통계)
 *
 * 처음에는 셋이었다(기본·간단히·앱처럼). 둘로 줄였다가, 사용자: "설정에서 앱처럼을 기본으로 해주고
 * 기본설정은 완전히 없애줘" — 고르는 칸과 '기본' 모양을 통째로 없앴다.
 *
 * 여기서 못 박는 것 —
 *   1) 설정 창에 화면 모양 고르기가 없다
 *   2) 예전에 '기본' 을 골라 둔 저장값이 남아 있어도 화면이 뜨고, 다음 저장 때 빠진다
 *   3) 내 자산·종목상세가 '기본' 갈래 없이 '앱처럼' 으로만 그려진다
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import StockDetail원문 from "../../pages/StockDetail.tsx?raw";
import Portfolio원문 from "../../pages/Portfolio.tsx?raw";
import 설정저장소원문 from "../../store/settingsStore.ts?raw";
/* 설정 창은 Layout 에서 SettingsModal 로 빠졌다 — 더보기가 화면으로
   나오면서 설정을 여는 자리가 두 곳이 됐기 때문이다 */
import 설정창원문 from "../account/SettingsModal.tsx?raw";

const KEY = "portfolio_settings";

beforeEach(() => { try { localStorage.clear(); } catch { /* 무시 */ } });

async function 새로불러오기() {
  vi.resetModules();
  return (await import("@/store/settingsStore")).useSettingsStore.getState();
}

describe("설정 창 — 화면 모양 고르기가 없다", () => {
  it("'화면 모양' 칸도, '기본'·'앱처럼' 단추도 없다", async () => {
    const SettingsModal = (await import("../account/SettingsModal")).default;
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <SettingsModal onClose={() => {}} />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "설정" })).toBeInTheDocument();
    expect(screen.queryByText("화면 모양")).toBeNull();
    expect(screen.queryByRole("button", { name: /^기본/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /앱처럼/ })).toBeNull();
    expect(screen.queryByText(/내 자산과 종목상세에 적용됩니다/)).toBeNull();
    // 다른 설정은 그대로
    expect(screen.getByText("테마")).toBeInTheDocument();
    expect(screen.getByText("화면 방향")).toBeInTheDocument();
  });

  it("코드에도 고르는 자리가 남지 않았다(왜 없앴는지 적은 주석만 남는다)", () => {
    const 코드만 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(코드만(설정창원문)).not.toMatch(/화면모양/);
    expect(코드만(설정저장소원문)).not.toMatch(/화면모양|"classic"/);
  });
});

describe("예전 저장값", () => {
  it("'기본' 을 골라 둔 저장값이 있어도 뜨고, 다른 설정은 그대로 — 다음 저장 때 화면모양은 빠진다", async () => {
    localStorage.setItem(KEY, JSON.stringify({ 화면모양: "classic", fontSize: "large", theme: "dark" }));
    const s = await 새로불러오기();
    expect([s.fontSize, s.theme]).toEqual(["large", "dark"]);
    expect("화면모양" in s).toBe(false);
    s.setColorScheme("green-red");
    const 저장된것 = JSON.parse(localStorage.getItem(KEY)!);
    expect(저장된것).not.toHaveProperty("화면모양");
    expect([저장된것.fontSize, 저장된것.theme, 저장된것.colorScheme]).toEqual(["large", "dark", "green-red"]);
  });
});

describe("'앱처럼' 으로만 그린다", () => {
  it("종목상세 — 가격 카드 테두리 없이, 지표는 차트 아래 '통계' 로만", () => {
    expect(StockDetail원문).not.toMatch(/화면모양/);
    expect(StockDetail원문).toMatch(/\{mainTab === "chart" && d && \(/);
    expect(StockDetail원문).toMatch(/\{mainTab === "chart" && !d && loadingDetail && \(/);
    // 예전 '기본' 모양의 가격 카드(테두리)와 가격 아래 네 칸 지표가 없다
    expect(StockDetail원문).not.toMatch(/rounded-xl border border-border bg-bg-card overflow-hidden"/);
    expect(StockDetail원문).not.toMatch(/px-3 py-2\.5 grid grid-cols-4/);
  });

  it("종목상세 — 지표를 접지 않는다", () => {
    /* 볼 때마다 더보기를 눌러야 하면 번거롭다 — 한 번에 편다 */
    expect(StockDetail원문).not.toMatch(/시세더보기/);
    expect(StockDetail원문).not.toMatch(/priceItems\.slice\(0,/);
  });

  it("기본정보에 PER·EPS 가 있다", () => {
    /* 시세를 보는 김에 같이 확인하는 사람이 많다.
       파일 전체에서 찾으면 재무제표 탭의 같은 글자에 걸려, 여기서
       빼도 통과한다 — 기본정보 목록(priceItems) 안에서만 본다 */
    /* 목록 앞머리에 빈 배열 조기 반환이 있고 거기에도 같은 닫는 표시가
       붙어 있다. 첫 항목('시가') 뒤부터 찾아야 진짜 끝이 잡힌다 */
    const 시작 = StockDetail원문.indexOf('{ label:"시가"');
    expect(시작).toBeGreaterThan(-1);
    const 끝 = StockDetail원문.indexOf("] as 지표칸[];", 시작);
    expect(끝).toBeGreaterThan(시작);
    const 목록 = StockDetail원문.slice(시작, 끝);
    expect(목록).toMatch(/label:"PER"/);
    expect(목록).toMatch(/label:"EPS"/);
  });

  it("내 자산 — 요약은 카드 하나(예전 '기본' 의 카드 넷 격자가 없다)", () => {
    expect(Portfolio원문).not.toMatch(/화면모양/);
    expect(Portfolio원문).not.toMatch(/grid grid-cols-2 sm:grid-cols-4 gap-3/);
    expect(Portfolio원문).not.toMatch(/"총 평가금액", "총 매입금액", "평가손익", "수익률"/);
  });

  it("내 자산 — 구성은 늘 보인다", () => {
    /* 접었다 폈다 하게 뒀더니 볼 때마다 한 번 더 눌러야 했다.
       자산 구성은 내 자산 화면에서 늘 궁금한 것이라 숨길 이유가 없다 */
    expect(Portfolio원문).not.toMatch(/구성펼침/);
    expect(Portfolio원문).not.toMatch(/구성 펼치기/);
  });
});
