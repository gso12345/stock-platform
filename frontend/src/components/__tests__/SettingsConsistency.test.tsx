/**
 * 사용자설정 화면들이 한 언어를 쓴다 —
 * "그외에도 사용자설정 앱통일성에 맞춰서 통일해주고 앱느낌 나도록 해줘"
 *
 * 같은 일을 하는 화면이 저마다 다른 모양이면, 한 번 익힌 것이 다음 화면에서
 * 통하지 않는다. 실제로 앱 안에 네 가지 '설정' 이 있었는데 —
 *
 *   관심종목 탭 관리   모달 + 끌어서 순서 + 칩
 *   내 자산 계좌 관리  모달 + 끌어서 순서
 *   재무제표 지표      본문에 박힌 패널 + ◀▶ 버튼 + 칩
 *   퀀트 기준          본문에 박힌 패널 + 기본 체크박스
 *
 * 앞의 둘만 같았다. 지금은 넷이 같은 부품(Modal · ReorderableList · 칩)을
 * 쓴다.
 *
 * 차트 지표 설정은 일부러 그대로 둔다 — 차트를 보면서 켜고 끄는 것이라
 * 차트 바로 아래가 제자리다. 창을 띄우면 정작 결과가 가린다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const 읽기 = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** 주석은 뺀다 — "예전에는 체크박스였다" 같은 설명이 검사에 걸린다 */
const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const 관리창들 = [
  ["관심종목 탭 관리", "src/components/watchlist/WatchlistModals.tsx"],
  ["내 자산 계좌 관리", "src/components/portfolio/PortfolioModals.tsx"],
  ["재무제표 지표 관리", "src/components/stock/MetricManagerModal.tsx"],
  ["퀀트 기준", "src/components/quant/QuantSettingsPanel.tsx"],
] as const;

describe("설정은 창으로 연다", () => {
  it("네 곳 모두 같은 창 부품을 쓴다", () => {
    /* 본문에 박아 두면 설정을 열 때마다 아래 내용이 밀린다 —
       퀀트는 표가, 재무제표는 차트가 화면 밖으로 나갔다 */
    for (const [이름, 경로] of 관리창들) {
      expect(코드만(읽기(경로)), 이름).toMatch(/<Modal/);
    }
  });

  it("창 머리에 제목과 한 줄 설명이 있다", () => {
    /* 무엇을 하는 곳인지 모르면 열어 놓고 되돌아 나간다 */
    for (const [이름, 경로] of 관리창들) {
      const s = 코드만(읽기(경로));
      expect(s, `${이름}: 제목`).toMatch(/<h3 className="text-sm font-bold text-text-primary">/);
      expect(s, `${이름}: 닫기`).toMatch(/aria-label="닫기"/);
    }
  });
});

describe("순서는 끌어서 바꾼다", () => {
  it("순서를 다루는 곳은 같은 목록 부품을 쓴다", () => {
    /* 화살표 버튼은 스무 개 중 맨 뒤를 앞으로 보낼 때 열아홉 번을 누른다 */
    for (const 경로 of [
      "src/components/watchlist/WatchlistModals.tsx",
      "src/components/portfolio/PortfolioModals.tsx",
      "src/components/stock/MetricManagerModal.tsx",
    ]) {
      expect(코드만(읽기(경로)), 경로).toMatch(/<ReorderableList/);
    }
  });

  it("화살표로 한 칸씩 미는 방식은 남아 있지 않다", () => {
    for (const [, 경로] of 관리창들) {
      expect(코드만(읽기(경로)), 경로).not.toMatch(/◀|▶/);
    }
    expect(코드만(읽기("src/pages/StockDetail.tsx"))).not.toMatch(/◀|▶/);
  });
});

describe("고르기는 칩으로", () => {
  it("퀀트도 기본 체크박스를 안 쓴다", () => {
    /* 같은 '고르기' 인데 여기만 네모 체크박스였다. 손가락으로 누르기에도
       칩이 낫다 — 네모는 표적이 작다 */
    const s = 코드만(읽기("src/components/quant/QuantSettingsPanel.tsx"));
    expect(s).not.toMatch(/type="checkbox"/);
    expect(s).toMatch(/aria-pressed=/);
  });

  it("고른 것과 안 고른 것을 스크린리더도 안다", () => {
    /* 색만으로 구별하면 눈으로 못 보는 사람에게는 전부 같은 버튼이다 */
    for (const 경로 of [
      "src/components/stock/MetricManagerModal.tsx",
      "src/components/quant/QuantSettingsPanel.tsx",
    ]) {
      expect(코드만(읽기(경로)), 경로).toMatch(/aria-pressed=\{/);
    }
  });
});

describe("일부러 다르게 둔 것", () => {
  it("차트 지표 설정은 차트 옆에 그대로 둔다", () => {
    /* 차트를 보면서 켜고 끄는 것이라 여기가 제자리다. 창으로 띄우면
       정작 확인하려던 차트를 가린다 */
    const s = 코드만(읽기("src/components/chart/StockChart.tsx"));
    expect(s).toMatch(/function SettingsPanel/);
    expect(s).not.toMatch(/<Modal/);
  });

  it("그래도 고르기는 같은 칩 모양이다", () => {
    const s = 코드만(읽기("src/components/chart/StockChart.tsx"));
    expect(s).not.toMatch(/type="checkbox"/);
  });
});
