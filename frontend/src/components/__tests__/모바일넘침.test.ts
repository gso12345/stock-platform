/**
 * 휴대폰에서 종목 스크리닝을 열면 아래 메뉴가 사라지던 것 — "종목스크리닝을 누르면 모바일 기준 아래메뉴가 안보여".
 *
 * 등락 칸마다 화면 읽기용 글자(sr-only — position:absolute)가 있다. absolute 는 가장 가까운 '자리 잡은'(relative 따위)
 * 조상 안에만 갇히는데, 표를 감싼 가로 스크롤 상자가 static 이라 그 글자들이 상자를 빠져나가 문서를 2,500px 로
 * 넓혔다. 휴대폰은 문서가 넓어지면 판(layout viewport)을 4배로 키우고, 아래 탭(fixed)이 그 큰 판의 바닥에 붙어
 * 화면 밖으로 밀렸다. 실제 크롬(휴대폰 흉내)에서 재 보면 고친 뒤 판이 412×915 로 돌아온다 — 여기서는 그 두 자리를
 * 못 박는다(jsdom 은 배치를 계산하지 않는다).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { 표상자 } from "../common/StockTable";

describe("화면 밖으로 새는 absolute 를 가둔다", () => {
  it("표 스크롤 상자는 relative — 등락 칸의 화면 읽기용 글자가 상자 안에 갇힌다", () => {
    const 클래스 = 표상자.split(/\s+/);
    expect(클래스).toContain("relative");
    expect(클래스).toContain("overflow-x-auto");
  });

  it("본문(main)도 relative·overflow-x-hidden — 다른 화면에서 새어도 아래 탭이 밀리지 않게", () => {
    const 원문 = readFileSync(resolve(__dirname, "../layout/Layout.tsx"), "utf-8");
    const 본문 = 원문.match(/<main className="([^"]+)"/)?.[1].split(/\s+/) ?? [];
    expect(본문).toContain("relative");
    expect(본문).toContain("overflow-x-hidden");
    expect(본문).toContain("overflow-y-auto");
  });
});
