/**
 * 퀀트 점수 화면.
 *
 * ── 무엇이 문제였나 ──
 *
 * 숫자가 글자로만 놓여 있었다. "78 / 100  B" — 값은 다 있는데 그게
 * 좋은 건지 나쁜 건지 한눈에 안 들어온다. 78이 100 중에 어디쯤인지
 * 알려면 머릿속에서 자를 대야 한다.
 *
 * 팩터 막대는 **늘 파랑**이었다. 20점짜리와 90점짜리가 같은 색으로
 * 그려졌다는 뜻이다 — 바로 옆 숫자는 색이 갈리는데 막대만 안 갈려서,
 * 같은 값을 두 규칙으로 칠하고 있었다.
 *
 * 그리고 '어디가 좋고 어디가 나쁜가' 를 다섯 칸을 눈으로 훑어 비교해야
 * 했다. 그건 화면이 할 일이다.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import QuantScoreView, { 강점약점, 게이지길이, 점수색값 } from "@/components/stock/QuantScoreView";
import type { QuantFactor, QuantScoreResult } from "@/api/stocks";

const 지표 = (key: string, value: number | null, score: number | null) =>
  ({ key, label: key, value, score, unit: "%", direction: "high" as const });

const 팩터 = (key: string, label: string, score: number | null, weight = 20): QuantFactor =>
  ({ key: key as QuantFactor["key"], label, weight, score,
     metrics: [지표(`${key}1`, 12, score), 지표(`${key}2`, null, null)] });

const 점수 = (덮: Partial<QuantScoreResult> = {}): QuantScoreResult => ({
  total_score: 78, grade: "B",
  factors: [
    팩터("value", "가치", 55), 팩터("growth", "성장", 31),
    팩터("profit", "수익성", 92), 팩터("safety", "안정성", 70),
    팩터("momentum", "모멘텀", 44),
  ],
  weights: {} as never, enabled_metrics: {} as never,
  ...덮,
});

const 그리기 = (덮: Partial<React.ComponentProps<typeof QuantScoreView>> = {}) =>
  render(<QuantScoreView quantScore={점수()} 받는중={false} 모으는중={false}
                         설정버튼={<button>기준 수정</button>} 설정패널={null} {...덮} />);

describe("점수색값", () => {
  it("scoreColor 와 같은 경계를 쓴다", () => {
    /* 경계가 어긋나면 같은 점수가 글자와 막대에서 다른 색이 된다 */
    expect(점수색값(60)).toBe("#10b981");
    expect(점수색값(59)).toBe("#f59e0b");
    expect(점수색값(40)).toBe("#f59e0b");
    expect(점수색값(39)).toBe("#ef4444");
  });

  it("값이 없으면 흐린 색", () => {
    expect(점수색값(null)).toBe("var(--text-dim)");
  });
});

describe("게이지길이", () => {
  const R = 56;
  it("0점이면 0, 100점이면 반원 전체", () => {
    expect(게이지길이(0, R)).toBe(0);
    expect(게이지길이(100, R)).toBeCloseTo(Math.PI * R);
  });

  it("절반이면 절반", () => {
    expect(게이지길이(50, R)).toBeCloseTo(Math.PI * R / 2);
  });

  it("범위를 벗어난 값은 가둔다", () => {
    /* 서버가 101 을 주면 호가 반원을 넘어 반대쪽으로 그려진다 */
    expect(게이지길이(150, R)).toBeCloseTo(Math.PI * R);
    expect(게이지길이(-10, R)).toBe(0);
  });

  it("점수가 없으면 안 그린다", () => {
    /* 0 으로 그리면 '0점' 과 구분이 안 된다 */
    expect(게이지길이(null, R)).toBeNull();
  });
});

describe("강점약점", () => {
  it("제일 높은 것과 낮은 것을 뽑는다", () => {
    const { 강점, 약점 } = 강점약점(점수().factors);
    expect(강점?.label).toBe("수익성");
    expect(약점?.label).toBe("성장");
  });

  it("점수가 없는 팩터는 안 센다", () => {
    /* '데이터가 없어서 0' 을 약점이라고 하면 거짓말이다 */
    const { 약점 } = 강점약점([팩터("a", "가치", 55), 팩터("b", "성장", null), 팩터("c", "수익성", 92)]);
    expect(약점?.label).toBe("가치");
  });

  it("다 똑같으면 강점도 약점도 아니다", () => {
    /* '수익성이 강점(50점)' 인데 나머지도 전부 50점이면 뜻이 없다 */
    const { 강점, 약점 } = 강점약점([팩터("a", "가치", 50), 팩터("b", "성장", 50)]);
    expect(강점).toBeNull();
    expect(약점).toBeNull();
  });

  it("잰 것이 하나뿐이면 비교할 것이 없다", () => {
    const { 강점 } = 강점약점([팩터("a", "가치", 50), 팩터("b", "성장", null)]);
    expect(강점).toBeNull();
  });

  it("빈 목록에도 안 터진다", () => {
    expect(강점약점([]).강점).toBeNull();
    expect(강점약점(undefined).강점).toBeNull();
  });
});

describe("화면", () => {
  it("점수와 등급을 크게 보여 준다", () => {
    그리기();
    expect(screen.getByText("78")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("강점·약점을 글로 적는다", () => {
    그리기();
    const 줄 = screen.getByTestId("강점약점");
    expect(줄).toHaveTextContent("강점");
    expect(줄).toHaveTextContent("수익성");
    expect(줄).toHaveTextContent("약점");
    expect(줄).toHaveTextContent("성장");
  });

  it("팩터 막대를 점수 색으로 칠한다", () => {
    /* 여기가 원래 늘 파랑이었다. 20점과 90점이 같은 색이면 색이
       아무 말도 안 한다 */
    const { container } = 그리기();
    const 색들 = [...container.querySelectorAll<HTMLElement>("[style*='background']")]
      .map((e) => e.style.background);
    expect(색들).toContain("rgb(16, 185, 129)");   // 92점 — 초록
    expect(색들).toContain("rgb(239, 68, 68)");    // 31점 — 빨강
    expect(색들).not.toContain("rgb(59, 130, 246)"); // 늘 파랑이던 것
  });

  it("불러오는 중에는 자리를 잡아 둔다", () => {
    /* 예전에는 '···' 이었다. 점 세 개는 '값이 없다' 와 구분이 안 된다 */
    그리기({ quantScore: undefined, 받는중: true });
    expect(screen.getAllByRole("status", { name: "불러오는 중" }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("강점약점")).toBeNull();
  });

  it("아직 모으는 중이면 그렇게 말한다", () => {
    그리기({ 모으는중: true });
    expect(screen.getByText(/점수가 바뀔 수 있어요/)).toBeInTheDocument();
  });

  it("값이 없는 지표는 흐리게 둔다", () => {
    /* 있는 것과 같은 무게로 그리면 눈이 없는 값에도 똑같이 머문다 */
    const { container } = 그리기();
    expect(container.querySelectorAll(".opacity-50").length).toBeGreaterThan(0);
  });

  it("설정 버튼과 패널을 그대로 얹는다", () => {
    그리기({ 설정패널: <div>가중치 패널</div> });
    expect(screen.getByRole("button", { name: "기준 수정" })).toBeInTheDocument();
    expect(screen.getByText("가중치 패널")).toBeInTheDocument();
  });

  it("점수가 없어도 안 터진다", () => {
    그리기({ quantScore: 점수({ total_score: null, grade: null }) });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("종목상세에 실제로 붙어 있는가", () => {
  it("퀀트 탭이 이 화면을 쓴다", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const 소스 = fs.readFileSync(
      path.resolve(__dirname, "../../../pages/StockDetail.tsx"), "utf-8");
    expect(소스).toContain('mainTab==="quant" && (');
    expect(소스).toContain("<QuantScoreView");
    // 옛 그리기가 남아 있으면 두 벌이 된다
    expect(소스).not.toContain("text-4xl font-mono font-bold text-text-primary");
    expect(소스).not.toContain("bg-accent-blue rounded-full");
  });
});
