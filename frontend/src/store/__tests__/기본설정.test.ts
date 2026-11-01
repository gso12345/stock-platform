/** 처음 쓰는 사람(저장된 설정 없음)의 기본값, 그리고 이미 고른 사람은 그대로인지 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function 새로불러오기() {
  vi.resetModules();
  return (await import("@/store/settingsStore")).useSettingsStore.getState();
}

beforeEach(() => localStorage.clear());

describe("기본 설정", () => {
  it("테마 시스템 · 등락 빨강/파랑 · 불러오기 표시 실패만", async () => {
    const s = await 새로불러오기();
    expect(s.theme).toBe("system");
    expect(s.colorScheme).toBe("red-blue");
    expect(s.불러오기표시).toBe("실패만");
    //: 나머지는 그대로
    expect([s.fontSize, s.orientation, s.금액가리기, s.공모주증권사, s.알림증권사]).toEqual(["normal", "system", false, [], []]);
  });

  it("이미 고른 사람의 값은 바꾸지 않는다", async () => {
    localStorage.setItem("portfolio_settings", JSON.stringify({
      theme: "dark", colorScheme: "green-red", 불러오기표시: "보이기",
    }));
    const s = await 새로불러오기();
    expect([s.theme, s.colorScheme, s.불러오기표시]).toEqual(["dark", "green-red", "보이기"]);
  });

  it("예전 버전의 'theme' 키로 골라 둔 테마도 지킨다", async () => {
    localStorage.setItem("theme", "light");
    expect((await 새로불러오기()).theme).toBe("light");
  });

  // "공모주 일정 증권사별로 설정해서 볼수 있게" — 고른 증권사는 다음에 열어도 그대로
  it("공모주 목록 증권사·알림 증권사 — 둘 다 남고, 이상한 값은 버린다", async () => {
    let s = await 새로불러오기();
    expect([s.공모주증권사, s.알림증권사]).toEqual([[], []]);
    s.토글공모주증권사("KB증권");
    s.토글공모주증권사("삼성증권");
    s.토글알림증권사("키움증권");
    s = await 새로불러오기();
    expect(s.공모주증권사).toEqual(["KB증권", "삼성증권"]);
    expect(s.알림증권사).toEqual(["키움증권"]);
    s.토글공모주증권사("KB증권");
    s.토글알림증권사("키움증권");
    s = await 새로불러오기();
    expect([s.공모주증권사, s.알림증권사]).toEqual([["삼성증권"], []]);
    const 이상한것 = ["KB증권", 3, "", "KB증권", "가".repeat(31), null, " 대신증권 "];
    localStorage.setItem("portfolio_settings", JSON.stringify({ 공모주증권사: 이상한것, 알림증권사: 이상한것 }));
    s = await 새로불러오기();
    expect([s.공모주증권사, s.알림증권사]).toEqual([["KB증권", "대신증권"], ["KB증권", "대신증권"]]);
    localStorage.setItem("portfolio_settings", JSON.stringify({ 공모주증권사: "KB증권", 알림증권사: "KB증권" }));
    s = await 새로불러오기();
    expect([s.공모주증권사, s.알림증권사]).toEqual([[], []]);
  });

  // "공모주메뉴에서 … 선택하는 건 그냥 선택한 공모주일정을 보고 싶을 뿐 … 내 증권사라는 것이 아니" — 따로 둔다
  it("하나를 바꿔도 다른 하나는 그대로", async () => {
    const s = await 새로불러오기();
    s.set공모주증권사(["KB증권"]);
    s.set알림증권사(["삼성증권"]);
    s.토글공모주증권사("키움증권");
    expect((await 새로불러오기()).알림증권사).toEqual(["삼성증권"]);
    s.토글알림증권사("대신증권");
    expect((await 새로불러오기()).공모주증권사).toEqual(["KB증권", "키움증권"]);
  });

  it("예전의 '내증권사' 하나는 둘 다로 옮긴다 — 보던 목록도 받던 알림도 그대로, 다음 저장 때 옛 칸은 빠진다", async () => {
    localStorage.setItem("portfolio_settings", JSON.stringify({ 내증권사: ["KB증권", "키움증권"], 공모주내것만: true, theme: "dark" }));
    let s = await 새로불러오기();
    expect(s.공모주증권사).toEqual(["KB증권", "키움증권"]);
    expect(s.알림증권사).toEqual(["KB증권", "키움증권"]);
    expect("내증권사" in s || "공모주내것만" in s).toBe(false);
    s.set공모주증권사([]);                                  // 목록만 풀었다
    const 저장된것 = JSON.parse(localStorage.getItem("portfolio_settings")!);
    expect(저장된것).not.toHaveProperty("내증권사");
    expect(저장된것).not.toHaveProperty("공모주내것만");
    s = await 새로불러오기();
    expect([s.공모주증권사, s.알림증권사, s.theme]).toEqual([[], ["KB증권", "키움증권"], "dark"]);
  });

  it("통째로 넣을 때도 다듬는다 — 앞뒤 빈칸·같은 이름·빈 이름(다시 열기 전, 지금 화면에서도)", async () => {
    vi.resetModules();
    const { useSettingsStore } = await import("@/store/settingsStore");
    useSettingsStore.getState().set공모주증권사([" KB증권 ", "KB증권", ""]);
    useSettingsStore.getState().set알림증권사(["삼성증권", " 삼성증권", "가".repeat(31)]);
    expect(useSettingsStore.getState().공모주증권사).toEqual(["KB증권"]);
    expect(useSettingsStore.getState().알림증권사).toEqual(["삼성증권"]);
    const 다시 = await 새로불러오기();
    expect([다시.공모주증권사, 다시.알림증권사]).toEqual([["KB증권"], ["삼성증권"]]);
  });

  it("새 칸이 있으면 옛 '내증권사' 는 안 본다", async () => {
    localStorage.setItem("portfolio_settings", JSON.stringify({ 내증권사: ["KB증권"], 공모주증권사: [], 알림증권사: ["삼성증권"] }));
    const s = await 새로불러오기();
    expect([s.공모주증권사, s.알림증권사]).toEqual([[], ["삼성증권"]]);
  });

  it("저장값에 칸이 빠져 있으면 새 기본값으로 채운다", async () => {
    localStorage.setItem("portfolio_settings", JSON.stringify({ fontSize: "large" }));
    const s = await 새로불러오기();
    expect([s.fontSize, s.colorScheme, s.불러오기표시, s.theme])
      .toEqual(["large", "red-blue", "실패만", "system"]);
  });
});

describe("화면을 그리기 전 테마 (index.html)", () => {
  /* 기본이 '시스템' 이라, 라이트 모드 기기에서 앱이 뜨는 순간 다크로
     번쩍하지 않게 index.html 이 먼저 칠한다. 그 스크립트를 실제로 돌려 본다 */
  const html = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");
  const 스크립트 = html.match(/<script>\s*([\s\S]*?)<\/script>/)![1];

  function 돌리기(기기가라이트: boolean) {
    document.documentElement.classList.remove("light");
    window.matchMedia = ((q: string) => ({ matches: 기기가라이트 && q.includes("light") })) as any;
    new Function(스크립트)();
    return document.documentElement.classList.contains("light");
  }

  it("저장된 테마가 없으면 기기 설정을 따른다", () => {
    expect(돌리기(true)).toBe(true);
    expect(돌리기(false)).toBe(false);
  });

  it("다크로 골라 두었으면 기기가 라이트여도 다크", () => {
    localStorage.setItem("portfolio_settings", JSON.stringify({ theme: "dark" }));
    expect(돌리기(true)).toBe(false);
  });

  it("라이트로 골라 두었으면 기기가 다크여도 라이트, 옛 키도 본다", () => {
    localStorage.setItem("portfolio_settings", JSON.stringify({ theme: "light" }));
    expect(돌리기(false)).toBe(true);
    localStorage.clear();
    localStorage.setItem("theme", "light");
    expect(돌리기(false)).toBe(true);
  });
});
