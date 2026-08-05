/**
 * 등락을 % 만 보여주던 것 — "얼마가 오르고 떨어졌는지도 표시해줘"
 *
 * '3% 올랐다' 는 알아도 그게 300원인지 3만원인지 알 수 없었다. 관심종목·
 * 퀀트·내 자산이 모두 같은 배지를 쓰므로, 배지에 금액을 붙이면 세 화면이
 * 함께 좋아진다.
 *
 * 여기서 못 박는 것 —
 *   1) 금액을 안 줘도 예전처럼 % 만 나온다 (지수·백테스트 등 금액이 없는 곳)
 *   2) 통화에 맞는 기호와 자릿수
 *   3) 오르내림 부호가 금액과 % 양쪽에 맞게 붙는다
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ChangeBadge } from "../ui";
import Watchlist원문 from "../../pages/Watchlist.tsx?raw";
import Quant원문 from "../../pages/Quant.tsx?raw";
import HoldingRow원문 from "../portfolio/HoldingRow.tsx?raw";

describe("등락 배지", () => {
  it("금액을 안 주면 예전처럼 % 만 나온다", () => {
    /* 지수·백테스트처럼 '얼마'가 없는 곳도 이 배지를 쓴다.
       그쪽까지 바뀌면 안 된다 */
    render(<ChangeBadge value={1.23} />);
    expect(screen.getByText("+1.23%")).toBeInTheDocument();
  });

  it("금액을 주면 '+900 (+1.22%)' 모양으로 적는다", () => {
    /* 통화 기호는 안 쓴다. 바로 옆에 현재가가 통화와 함께 있고,
       '+₩900 +1.22%' 는 기호가 둘이라 눈이 걸린다 */
    render(<ChangeBadge value={1.22} 금액={900} 통화="KRW" />);
    expect(document.body.textContent).toBe("+900 (+1.22%)");
  });

  it("내릴 때는 금액에도 빼기를 붙인다", () => {
    render(<ChangeBadge value={-2.5} 금액={-1850} 통화="KRW" />);
    expect(document.body.textContent).toBe("-1,850 (-2.50%)");
  });

  it("달러는 소수 둘째 자리까지 쓴다", () => {
    /* 원화에서 12.34원은 의미가 없지만 달러에서 1.37 은 흔하다 */
    render(<ChangeBadge value={0.8} 금액={1.37} 통화="USD" />);
    expect(document.body.textContent).toBe("+1.37 (+0.80%)");
  });

  it("원화는 소수점을 버린다", () => {
    render(<ChangeBadge value={0.8} 금액={1234.7} 통화="KRW" />);
    expect(document.body.textContent).toBe("+1,235 (+0.80%)");
  });

  it("값이 없거나 숫자가 아니면 금액을 안 그린다", () => {
    /* 현금·시세 미수신 종목은 등락이 없다. NaN 이 그대로 나가면
       '₩NaN' 이 보인다 */
    for (const 이상한것 of [null, undefined, NaN, Infinity]) {
      const { unmount } = render(<ChangeBadge value={0} 금액={이상한것 as any} 통화="KRW" />);
      expect(document.body.textContent, String(이상한것)).toBe("+0.00%");
      unmount();
    }
  });
});

describe("세 화면이 금액을 넘긴다", () => {
  it("관심종목", () => {
    expect(Watchlist원문).toMatch(/금액=\{p\.change != null \? Number\(p\.change\) : null\}/);
  });

  it("퀀트", () => {
    expect(Quant원문).toMatch(/금액=\{pr\.change != null \? Number\(pr\.change\) : null\}/);
  });

  it("내 자산 — 카드와 표 양쪽", () => {
    /* 카드 보기와 표 보기가 따로 그려진다. 한쪽만 고치면 보기를 바꿨을 때
       숫자가 사라진다 */
    const 횟수 = (HoldingRow원문.match(/전일대비율/g) ?? []).length;
    expect(횟수).toBeGreaterThanOrEqual(4);   // 조건 2 + 값 2
  });

  it("내 자산 — 전일대비는 수익률과 다른 숫자다", () => {
    /* 매입가 대비 수익률을 전일대비로 잘못 쓰면, 3년 전에 산 종목이
       오늘 30% 오른 것처럼 보인다 */
    expect(HoldingRow원문).not.toMatch(/전일대비율=\{item\.pnlRate\}/);
    expect(HoldingRow원문).toMatch(/value=\{item\.전일대비율\}/);
  });
});
