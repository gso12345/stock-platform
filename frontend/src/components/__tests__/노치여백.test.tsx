/**
 * 아이폰 시계·노치·홈 막대 — "실제 앱같이 느껴졌으면" 1번.
 *
 * 홈 화면 앱은 상태바를 투명하게 두어(index.html 의 black-translucent + viewport-fit=cover) 화면이 시계·노치
 * 밑까지 올라온다. 그만큼(safe-area-inset-*) 띄우지 않으면 머리의 검색창·알림 띠·전체 화면 차트의 닫기 단추가
 * 시계와 겹친다. 다른 기기는 그 값이 0 이라 달라지는 게 없다.
 *
 * jsdom 은 env() 하나만 쓴 값(padding-top: env(...))을 버린다 — 그런 자리는 원문에서 본다. calc() 로 감싼 값은
 * 그려서 본다.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Toast } from "../ui/Toast";

const 원문 = (길: string) => readFileSync(resolve(__dirname, "..", "..", 길), "utf-8");
const 위 = 'paddingTop: "env(safe-area-inset-top)"';
const 아래 = 'paddingBottom: "env(safe-area-inset-bottom)"';

describe("화면이 시계·노치 밑까지 올라온다(전제)", () => {
  it("상태바를 투명하게 두고 노치 영역까지 그린다", () => {
    const html = readFileSync(resolve(__dirname, "../../../index.html"), "utf-8");
    expect(html).toMatch(/apple-mobile-web-app-status-bar-style" content="black-translucent"/);
    expect(html).toMatch(/viewport-fit=cover/);
  });
});

describe("그만큼 띄운다", () => {
  const 틀 = 원문("components/layout/Layout.tsx");

  it("머리 — 높이에 상태바를 더하고, 내용은 그 아래부터", () => {
    const 머리 = 틀.slice(틀.indexOf("<header"), 틀.indexOf("</header>"));
    expect(머리).toContain('height: "calc(52px + env(safe-area-inset-top))"');
    expect(머리).toContain(위);
  });

  it("휴대폰 대화방은 머리를 숨기니 노치 자리를 빈 띠가 대신 띄운다", () => {
    const 띠 = 틀.slice(틀.indexOf("data-notch-space"), 틀.indexOf("<header"));
    expect(띠).toContain('style={{ height: "env(safe-area-inset-top)" }}');
    expect(띠).toContain("lg:hidden");
  });

  it("가로로 눕히면 노치가 옆으로 — 앱 틀과 하단 탭이 옆도 띄운다", () => {
    const 바깥 = 틀.slice(틀.indexOf("return ("), 틀.indexOf("<LoadingProgressOverlay"));
    expect(바깥).toContain('paddingLeft: "env(safe-area-inset-left)"');
    expect(바깥).toContain('paddingRight: "env(safe-area-inset-right)"');
    const 탭 = 틀.slice(틀.indexOf("모바일 하단 탭바 ───"), 틀.indexOf("{BOTTOM_NAV.map"));
    for (const 값 of [아래, 'paddingLeft: "env(safe-area-inset-left)"', 'paddingRight: "env(safe-area-inset-right)"']) {
      expect(탭).toContain(값);
    }
  });

  it("알림(토스트)은 시계 아래에 뜬다", () => {
    render(<Toast message="저장했어요" kind="success" onClose={() => {}} />);
    expect(screen.getByRole("status").style.top).toBe("calc(1rem + env(safe-area-inset-top))");
  });

  it("휴대폰 아래 시트는 홈 막대만큼 띄운다 — 자판이 올라오면 그 위로 올라가니 그땐 필요 없다", () => {
    const 창 = 원문("components/ui/index.tsx");
    const 시트 = 창.slice(창.indexOf("data-sheet"), 창.indexOf("손잡이 — 아래에서 올라온 시트"));
    expect(시트).toContain('paddingBottom: 자판 ? undefined : "env(safe-area-inset-bottom)"');
    expect(시트).toContain("env(safe-area-inset-top)");     // 위로 너무 올라와 시계를 덮지 않게
  });

  it("종목·지수의 전체 화면 차트도 위아래를 띄운다 — 닫기 단추가 시계에 가리지 않게", () => {
    for (const 길 of ["pages/StockDetail.tsx", "pages/IndexDetail.tsx"]) {
      const 글 = 원문(길);
      const 자리 = 글.indexOf("{/* 전체보기 모달 */}");
      expect(자리, 길).toBeGreaterThan(-1);
      const 덩이 = 글.slice(자리, 자리 + 400);
      expect(덩이, 길).toContain(위);
      expect(덩이, 길).toContain(아래);
    }
  });
});
