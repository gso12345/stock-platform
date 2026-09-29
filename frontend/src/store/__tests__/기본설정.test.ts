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
    expect([s.fontSize, s.orientation, s.화면모양, s.금액가리기]).toEqual(["normal", "system", "app", false]);
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
