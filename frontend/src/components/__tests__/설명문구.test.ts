/**
 * 제목 밑 설명서 같은 문구를 두지 않는다(디자인 5번).
 *
 * "지수 클릭 → 상세 차트 · 종목 클릭 → 종목 상세", "칸 제목을 누르면 그 칸으로 세워요" 처럼 쓰는 법을 적은
 * 문구나, 제목을 다시 말하는 문구("국내·미국 증시 주요 뉴스")는 앱에서는 잘 쓰지 않는다 — 웹페이지 설명서처럼
 * 보였다. 기능을 알려 주는 짧은 설명(공모주·백테스트·퀀트)만 남긴다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const 화면 = (f: string) => readFileSync(resolve(__dirname, "../../pages", f), "utf-8");

describe("제목 밑 문구", () => {
  it.each([
    ["Dashboard.tsx", "지수 클릭 →"],
    ["Screening.tsx", "칸 제목을 누르면 그 칸으로 세워요"],
    ["Strategies.tsx", "백테스트에 로드합니다"],
    ["News.tsx", "국내·미국 증시 주요 뉴스"],
    ["Feed.tsx", "전체 종목의 최신 의견을 한 곳에서"],
  ])("%s — '%s' 를 두지 않는다", (f, 문구) => {
    expect(화면(f)).not.toContain(문구);
  });

  it("퀀트는 짧게 — 무엇을 하는 화면인지만", () => {
    const 글 = 화면("Quant.tsx");
    expect(글).toContain("관심종목을 같은 기준으로 비교해요");
    expect(글).not.toContain("가중치·사용 지표)으로 퀀트 점수 비교");
  });

  it("기능을 알려 주는 설명은 남긴다 — 공모주", () => {
    expect(화면("Ipo.tsx")).toContain("상장 첫날 시초가를 비슷했던 과거 공모주로 예측해요");
  });
});
