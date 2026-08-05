/**
 * 종목상세 지표 칸에 설명이 붙었는가.
 *
 * StatCell 이라는 한 자리가 PER·PBR·ROE 등 스물다섯 가지 이름을 다 그린다.
 * 그래서 여기 한 번만 붙이면 전부 설명되지만, 반대로 여기가 잘못되면
 * 재무 탭이 통째로 안 뜬다. 그 두 가지를 같이 본다.
 *
 * StockDetail 은 2,600줄짜리에 시세·차트·뉴스까지 물려 있어 통째로 띄우기
 * 어렵다. 검사하려는 것은 '이름 자리에 용어힌트가 놓였는가' 하나뿐이므로,
 * 그 부분만 똑같이 만들어 확인한다. 그리고 실제 파일이 정말 그렇게 쓰고
 * 있는지는 아래에서 원문으로 확인한다.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { 용어힌트 } from "../ui";
/* 원문을 글자 그대로 읽는다. node 의 파일 읽기를 쓰면 이 프로젝트에
   없는 타입이 필요해지므로, 빌드 도구가 주는 ?raw 를 쓴다 */
import StockDetail원문 from "../../pages/StockDetail.tsx?raw";

/** StockDetail 의 StatCell 과 같은 모양 */
function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs uppercase"><용어힌트 이름={label} /></span>
      <span>{value ?? "—"}</span>
    </div>
  );
}

describe("지표 칸", () => {
  it("아는 지표에는 설명이 붙는다", async () => {
    const u = userEvent.setup();
    render(<StatCell label="PER(현재)" value="12.3배" />);
    await u.click(screen.getByRole("button", { name: "PER(현재) 설명" }));
    expect(screen.getByRole("tooltip").textContent).toMatch(/이미 벌어들인 돈/);
  });

  it("모르는 지표가 와도 칸은 멀쩡히 그려진다", () => {
    /* 스물다섯 자리가 같은 부품을 쓰므로, 하나라도 터지면 재무 탭 전체가
       안 뜬다 — 설명 하나 없는 것보다 훨씬 나쁘다 */
    render(<StatCell label="처음보는지표" value="99" />);
    expect(screen.getByText("처음보는지표")).toBeInTheDocument();
    expect(screen.getByText("99")).toBeInTheDocument();
  });

  it("값이 없어도 그려진다", () => {
    render(<StatCell label="PER(현재)" value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("실제 화면에 붙어 있는가", () => {
  it("StockDetail 의 StatCell 이 용어힌트를 쓴다", () => {
    /* 위 검사는 '이렇게 쓰면 된다'까지만 보여준다. 실제 파일이 그렇게
       쓰고 있는지는 따로 확인해야, 누가 되돌려 놓아도 알아챈다 */
    const 원문 = StockDetail원문;
    const 시작 = 원문.indexOf("function StatCell");
    expect(시작).toBeGreaterThan(-1);
    const 본문 = 원문.slice(시작, 시작 + 700);
    expect(본문).toMatch(/<용어힌트\s+이름=\{label\}/);
  });
});
