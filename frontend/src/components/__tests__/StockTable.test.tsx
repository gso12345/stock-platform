/**
 * 스크리닝·퀀트가 함께 쓰는 표 부품 — 한쪽만 고쳐도 다른 쪽이 같이 바뀌니, 부품 자체를 여기서 본다.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { 등락표시, 종목칸, 받는중띠, 도구단추 } from "@/components/common/StockTable";

describe("등락표시", () => {
  it("오르면 ▲, 금액을 주면 '▲ 900 (1.28%)' — 원화는 정수, 달러는 소수 둘째 자리", () => {
    const { container, rerender } = render(<등락표시 값={1.28} 금액={900.4} 통화="KRW" />);
    expect(container.textContent).toBe("▲ 오름 900 (1.28%)");
    rerender(<등락표시 값={-1.13} 금액={-2.1} 통화="USD" />);
    expect(container.textContent).toBe("▼ 내림 2.10 (1.13%)");
    rerender(<등락표시 값={2.49} />);
    expect(container.textContent).toBe("▲ 오름 2.49%");
    rerender(<등락표시 값={0} />);
    expect(container.textContent).toBe("0.00%");
  });

  it("오름은 빨강·내림은 파랑(기본 색 설정) — 금액이 이상하면 퍼센트만", () => {
    const { container, rerender } = render(<등락표시 값={1} 금액={NaN} 통화="KRW" />);
    expect(container.firstElementChild!.className).toContain("text-accent-red");
    expect(container.textContent).toBe("▲ 오름 1.00%");
    rerender(<등락표시 값={-1} />);
    expect(container.firstElementChild!.className).toContain("text-accent-blue");
  });
});

describe("종목칸", () => {
  it("순위·이름·코드 — 이름을 누르면 상세로, 국내 코드는 접미사 없이 보인다", () => {
    render(
      <MemoryRouter>
        <종목칸 순위={3} symbol="005930.KS" name="삼성전자" market="KR" domain={null} 덧붙임={<b>KR</b>} />
      </MemoryRouter>,
    );
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("삼성전자").closest("a")!.getAttribute("href")).toBe("/stocks/KR/005930.KS");
    expect(screen.getByText("005930")).toBeTruthy();
    expect(screen.queryByText("005930.KS")).toBeNull();
    expect(screen.getByText("KR")).toBeTruthy();
  });
});

describe("받는중띠", () => {
  it("얼마나 받았는지 막대로 — 전체를 모르면 막대 없이 글만", () => {
    const { container, rerender } = render(<받는중띠 이름="받는 중" done={1} total={4}>받는 중</받는중띠>);
    expect(screen.getByRole("status", { name: "받는 중" })).toBeTruthy();
    expect((container.querySelector('[style*="width"]') as HTMLElement).style.width).toBe("25%");
    rerender(<받는중띠 이름="받는 중">받는 중</받는중띠>);
    expect(container.querySelector('[style*="width"]')).toBeNull();
  });

  it("도는 동그라미(<div>)를 <p> 안에 넣지 않는다 — 넣으면 React 가 콘솔에 경고를 띄운다", () => {
    const { container } = render(<받는중띠 이름="받는 중">받는 중</받는중띠>);
    expect(container.querySelector("p div")).toBeNull();
  });
});

describe("도구단추", () => {
  it("판을 여닫는 단추만 열림을 알린다", () => {
    const { rerender } = render(<도구단추 onClick={() => {}} 열림={false} controls="판">조건</도구단추>);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button").getAttribute("aria-controls")).toBe("판");
    rerender(<도구단추 onClick={() => {}}>CSV</도구단추>);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-controls")).toBeNull();
  });

  it("켜고 끄는 단추는 눌림을 알리고, 켜지면 열린 판 단추처럼 파랗다", () => {
    const 단추 = () => screen.getByRole("button");
    const { rerender } = render(<도구단추 onClick={() => {}} 눌림={false}>₩ 원화</도구단추>);
    expect(단추().getAttribute("aria-pressed")).toBe("false");
    expect(단추().className).not.toContain("bg-accent-blue/15");
    rerender(<도구단추 onClick={() => {}} 눌림>₩ 원화</도구단추>);
    expect(단추().getAttribute("aria-pressed")).toBe("true");
    expect(단추().className).toContain("bg-accent-blue/15");
    rerender(<도구단추 onClick={() => {}}>CSV</도구단추>);
    expect(단추().getAttribute("aria-pressed")).toBeNull();
  });
});
