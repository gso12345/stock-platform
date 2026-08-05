/**
 * 화면 모양 고르기 — "원래 있던것, 사진참고전, 사진참고후 3개 만들고
 * 설정을 통해 선택할 수 있게"
 *
 * 무엇이 나은지는 사람마다 갈린다. 정보를 한 번에 다 보고 싶은 사람도
 * 있고, 접혀 있는 쪽이 편한 사람도 있다. 그래서 하나로 정하지 않고
 * 셋을 남겨 고르게 했다.
 *
 * 여기서 못 박는 것 —
 *   1) 셋이 실제로 다르게 그려진다 (이름만 다르고 같으면 고를 이유가 없다)
 *   2) 고른 것이 새로고침해도 남는다
 *   3) 저장된 값이 깨져 있어도 화면이 뜬다
 */
import { describe, it, expect, beforeEach } from "vitest";

import { useSettingsStore, 화면모양_목록, 정상화면모양 } from "@/store/settingsStore";
import StockDetail원문 from "../../pages/StockDetail.tsx?raw";
import Portfolio원문 from "../../pages/Portfolio.tsx?raw";
import Layout원문 from "../Layout.tsx?raw";

const KEY = "portfolio_settings";

beforeEach(() => { try { localStorage.clear(); } catch { /* 무시 */ } });

describe("설정에 담긴다", () => {
  it("고를 수 있는 것이 셋이다", () => {
    expect(화면모양_목록.map((o) => o.value)).toEqual(["classic", "compact", "app"]);
  });

  it("무엇이 다른지 한 줄로 알려준다", () => {
    /* 이름만 있으면 눌러보기 전에는 뭐가 바뀌는지 모른다 */
    for (const o of 화면모양_목록) {
      expect(o.label.length, `${o.value} 이름`).toBeGreaterThan(0);
      expect(o.desc.length, `${o.value} 설명`).toBeGreaterThan(5);
    }
  });

  it("고르면 저장된다", () => {
    useSettingsStore.getState().set화면모양("classic");
    expect(JSON.parse(localStorage.getItem(KEY)!).화면모양).toBe("classic");
    expect(useSettingsStore.getState().화면모양).toBe("classic");
  });

  it("다른 설정을 바꿔도 화면 모양이 날아가지 않는다", () => {
    /* 저장을 통째로 덮어쓰면 방금 고른 것이 사라진다 */
    useSettingsStore.getState().set화면모양("compact");
    useSettingsStore.getState().setFontSize("large");
    expect(JSON.parse(localStorage.getItem(KEY)!).화면모양).toBe("compact");
  });

  it("저장된 값이 이상하면 기본값으로 돌아간다", () => {
    /* 예전 버전이 남긴 값, 손으로 고친 값, 오타 — 그대로 쓰면 화면이
       셋 중 아무 가지에도 안 걸려 텅 빈 채로 뜬다 */
    for (const 이상한것 of ["이상한값", "", null, undefined, 3, {}, "CLASSIC"]) {
      expect(["classic", "compact", "app"], String(이상한것))
        .toContain(정상화면모양(이상한것));
    }
    // 멀쩡한 값은 그대로 둔다 — 전부 기본값으로 만들어도 위 검사는 통과한다
    expect(정상화면모양("classic")).toBe("classic");
    expect(정상화면모양("compact")).toBe("compact");
  });
});

describe("셋이 실제로 다르게 그려진다", () => {
  it("종목상세 — 지표를 두는 자리가 갈린다", () => {
    // classic: 원래 격자 / compact: 넷 + 더보기 / app: 차트 아래 통계
    expect(StockDetail원문).toMatch(/화면모양 === "classic" && \(\(\) => \{/);
    expect(StockDetail원문).toMatch(/화면모양 === "compact" && \(/);
    expect(StockDetail원문).toMatch(/화면모양 === "app" && mainTab === "chart"/);
  });

  it("종목상세 — 가격 카드 테두리가 app 에서만 없다", () => {
    expect(StockDetail원문).toMatch(/화면모양 === "app" \? "overflow-hidden"/);
  });

  it("종목상세 — 차트 설정은 classic 에서 늘 펼쳐진다", () => {
    /* 정보를 다 보고 싶어서 classic 을 고른 사람에게 톱니를 누르게 하면
       고른 뜻과 어긋난다 */
    expect(StockDetail원문).toMatch(/화면모양 === "classic" \|\| 차트설정열림/);
  });

  it("내 자산 — 요약 카드 수가 갈린다", () => {
    expect(Portfolio원문).toMatch(/화면모양 === "classic" \? \(/);
    // classic 쪽에만 카드 넷짜리 격자가 남아 있다
    expect(Portfolio원문).toMatch(/grid grid-cols-2 sm:grid-cols-4 gap-3/);
  });

  it("내 자산 — 구성 차트는 classic 에서 늘 펼쳐진다", () => {
    expect(Portfolio원문).toMatch(/화면모양 !== "classic" && !구성펼침/);
  });
});

describe("설정 화면", () => {
  it("고르는 자리가 있다", () => {
    expect(Layout원문).toMatch(/화면 모양/);
    expect(Layout원문).toMatch(/화면모양_목록\.map/);
  });

  it("지금 고른 것이 무엇인지 읽어줄 수 있다", () => {
    /* 색으로만 표시하면 화면을 읽어주는 프로그램은 어느 것이 선택됐는지
       모른다 */
    expect(Layout원문).toMatch(/aria-pressed=\{화면모양 === opt\.value\}/);
  });

  it("어디에 적용되는지 밝힌다", () => {
    /* 설정을 바꿨는데 눈앞 화면이 그대로면 안 먹은 줄 안다 */
    expect(Layout원문).toMatch(/내 자산과 종목상세에 적용됩니다/);
  });
});
