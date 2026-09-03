/**
 * 화면 모양 고르기 — 기본 / 앱처럼
 *
 * 처음에는 셋이었다(기본·간단히·앱처럼). 가운데 것은 종목상세만 달랐고,
 * 접었다 폈다 하는 수고에 견줘 얻는 게 적어 둘로 줄였다.
 *
 * 무엇이 나은지는 사람마다 갈린다. 하나로 정하지 않고 고르게 뒀다.
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
/* 설정 창은 Layout 에서 SettingsModal 로 빠졌다 — 더보기가 화면으로
   나오면서 설정을 여는 자리가 두 곳이 됐기 때문이다 */
import 설정창원문 from "../SettingsModal.tsx?raw";

const KEY = "portfolio_settings";

beforeEach(() => { try { localStorage.clear(); } catch { /* 무시 */ } });

describe("설정에 담긴다", () => {
  it("고를 수 있는 것이 둘이다", () => {
    expect(화면모양_목록.map((o) => o.value)).toEqual(["classic", "app"]);
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
    useSettingsStore.getState().set화면모양("classic");
    useSettingsStore.getState().setFontSize("large");
    expect(JSON.parse(localStorage.getItem(KEY)!).화면모양).toBe("classic");
  });

  it("저장된 값이 이상하면 기본값으로 돌아간다", () => {
    /* 예전 버전이 남긴 값, 손으로 고친 값, 오타 — 그대로 쓰면 화면이
       셋 중 아무 가지에도 안 걸려 텅 빈 채로 뜬다 */
    // 'compact' 는 예전 버전이 쓰던 값이다. 남아 있어도 화면은 떠야 한다
    for (const 이상한것 of ["이상한값", "", null, undefined, 3, {}, "CLASSIC", "compact"]) {
      expect(["classic", "app"], String(이상한것)).toContain(정상화면모양(이상한것));
    }
    // 멀쩡한 값은 그대로 둔다 — 전부 기본값으로 만들어도 위 검사는 통과한다
    expect(정상화면모양("classic")).toBe("classic");
    expect(정상화면모양("app")).toBe("app");
  });
});

describe("셋이 실제로 다르게 그려진다", () => {
  it("종목상세 — 지표를 두는 자리가 갈린다", () => {
    // 기본: 가격 아래 / 앱처럼: 차트 아래 '통계'
    expect(StockDetail원문).toMatch(/화면모양 === "classic" && \(/);
    expect(StockDetail원문).toMatch(/화면모양 === "app" && mainTab === "chart"/);
  });

  it("종목상세 — 지표를 접지 않는다", () => {
    /* 볼 때마다 더보기를 눌러야 하면, 숫자를 한눈에 보려고 고른 뜻과
       어긋난다. 두 모양 다 한 번에 편다 */
    expect(StockDetail원문).not.toMatch(/시세더보기/);
    expect(StockDetail원문).not.toMatch(/priceItems\.slice\(0,/);
  });

  it("종목상세 — 가격 카드 테두리가 app 에서만 없다", () => {
    expect(StockDetail원문).toMatch(/화면모양 === "app" \? "overflow-hidden"/);
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

  it("내 자산 — 요약 카드 수가 갈린다", () => {
    expect(Portfolio원문).toMatch(/화면모양 === "classic" \? \(/);
    // classic 쪽에만 카드 넷짜리 격자가 남아 있다
    expect(Portfolio원문).toMatch(/grid grid-cols-2 sm:grid-cols-4 gap-3/);
  });

  it("내 자산 — 구성은 늘 보인다", () => {
    /* 접었다 폈다 하게 뒀더니 볼 때마다 한 번 더 눌러야 했다.
       자산 구성은 내 자산 화면에서 늘 궁금한 것이라 숨길 이유가 없다 */
    expect(Portfolio원문).not.toMatch(/구성펼침/);
    expect(Portfolio원문).not.toMatch(/구성 펼치기/);
  });
});

describe("설정 화면", () => {
  it("고르는 자리가 있다", () => {
    expect(설정창원문).toMatch(/화면 모양/);
    expect(설정창원문).toMatch(/화면모양_목록\.map/);
  });

  it("지금 고른 것이 무엇인지 읽어줄 수 있다", () => {
    /* 색으로만 표시하면 화면을 읽어주는 프로그램은 어느 것이 선택됐는지
       모른다 */
    expect(설정창원문).toMatch(/aria-pressed=\{화면모양 === opt\.value\}/);
  });

  it("어디에 적용되는지 밝힌다", () => {
    /* 설정을 바꿨는데 눈앞 화면이 그대로면 안 먹은 줄 안다 */
    expect(설정창원문).toMatch(/내 자산과 종목상세에 적용됩니다/);
  });
});
