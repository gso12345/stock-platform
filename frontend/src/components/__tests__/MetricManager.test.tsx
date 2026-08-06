/**
 * 재무제표 사용자설정 지표 관리 —
 * "재무제표탭 사용자설정 지표순서 관심종목의 폴더순서처럼 바꿔줘"
 *
 * 예전에는 화면에 두 덩어리가 늘 펼쳐져 있었다. 접이식 "지표 선택"(그룹별
 * 칩 토글)과 "순서 조정"(◀ ▶ 버튼). 둘 다 자리를 먹어서 정작 보려던 차트가
 * 저 아래로 밀렸다.
 *
 * 순서 바꾸는 방식도 앱 안에서 혼자 달랐다. 관심종목 탭과 내 자산 계좌는
 * 손잡이를 끌어서 옮기는데(ReorderableList), 여기만 화살표였다. 20개를
 * 골라 놓고 맨 뒤 것을 앞으로 보내려면 열아홉 번 눌러야 했다.
 *
 * 여기서 못 박는 것 —
 *   1) 순서를 끌어서 바꾼다 (다른 화면과 같은 부품)
 *   2) 고르기와 순서를 한 창에서 한다
 *   3) 20개가 차도 이미 고른 것은 뺄 수 있다 (안 그러면 갇힌다)
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StockDetail원문_전체 from "../../pages/StockDetail.tsx?raw";

/* 주석에는 "예전에는 ◀▶ 버튼이었다" 같은 설명을 남겨 둔다. 글자로만
   훑으면 그 설명이 검사에 걸린다 — 실제 코드만 본다 */
const StockDetail원문 = StockDetail원문_전체
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
import 모달원문 from "../stock/MetricManagerModal.tsx?raw";

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (sel?: any) => {
    const s = { colorScheme: "green-red" };
    return sel ? sel(s) : s;
  },
}));

import MetricManagerModal from "../stock/MetricManagerModal";

const 옵션 = [
  { key: "revenue",    label: "매출",       group: "손익계산서", color: "#3b82f6" },
  { key: "op_income",  label: "영업이익",   group: "손익계산서", color: "#10b981" },
  { key: "net_income", label: "당기순이익", group: "손익계산서", color: "#8b5cf6" },
  { key: "roe",        label: "ROE",        group: "수익성",     color: "#06b6d4" },
  { key: "per",        label: "PER",        group: "밸류에이션", color: "#f59e0b" },
];

function 그리기(선택된: string[], onChange = vi.fn(), 최대 = 20) {
  const r = render(
    <MetricManagerModal
      전체={옵션} 선택된={선택된} 최대={최대}
      onChange={onChange} onClose={() => {}}
    />,
  );
  return { ...r, onChange };
}

describe("관심종목 폴더순서와 같은 방식", () => {
  it("끌 수 있는 손잡이가 지표마다 붙는다", () => {
    /* 다른 화면과 같은 부품(ReorderableList)을 쓴다는 증거다 */
    그리기(["revenue", "op_income"]);
    expect(screen.getAllByRole("button", { name: /순서 바꾸기/ })).toHaveLength(2);
  });

  it("방향키로도 옮길 수 있다", async () => {
    /* 손가락 드래그는 jsdom 에서 재현이 안 되지만 커밋 경로는 같다.
       마우스를 쓰기 어려운 사람에게는 이쪽이 유일한 길이기도 하다 */
    const u = userEvent.setup();
    const { onChange } = 그리기(["revenue", "op_income", "net_income"]);
    const 손잡이 = screen.getAllByRole("button", { name: /순서 바꾸기/ })[0];
    손잡이.focus();
    await u.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenCalledWith(["op_income", "revenue", "net_income"]);
  });

  it("화살표 버튼 방식은 사라졌다", () => {
    /* 20개를 골라 놓고 맨 뒤를 앞으로 보내려면 열아홉 번 눌러야 했다 */
    expect(StockDetail원문).not.toMatch(/moveMetric/);
    expect(StockDetail원문).not.toMatch(/◀|▶/);
  });

  it("차트에서 쓰는 색을 목록에서도 보여준다", () => {
    /* 창을 닫고 나서 어느 선이 어느 지표인지 헤매지 않게 */
    const { container } = 그리기(["revenue"]);
    const 점 = container.querySelector('[style*="rgb(59, 130, 246)"], [style*="#3b82f6"]');
    expect(점).not.toBeNull();
  });
});

describe("한 창에서 고르고 순서까지", () => {
  it("지표를 더할 수 있다", async () => {
    const u = userEvent.setup();
    const { onChange } = 그리기(["revenue"]);
    await u.click(screen.getByRole("button", { name: /지표 추가/ }));
    await u.click(screen.getByRole("button", { name: "ROE" }));
    expect(onChange).toHaveBeenCalledWith(["revenue", "roe"]);
  });

  it("목록에서 바로 뺄 수 있다", async () => {
    const u = userEvent.setup();
    const { onChange } = 그리기(["revenue", "op_income"]);
    await u.click(screen.getByRole("button", { name: "매출 빼기" }));
    expect(onChange).toHaveBeenCalledWith(["op_income"]);
  });

  it("고른 것은 추가 목록에서도 표시된다", async () => {
    /* 이미 고른 것을 또 누르면 빠진다. 지금 상태를 안 보여주면
       뺀 건지 더한 건지 알 수 없다 */
    const u = userEvent.setup();
    그리기(["revenue"]);
    await u.click(screen.getByRole("button", { name: /지표 추가/ }));
    expect(screen.getByRole("button", { name: "매출" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "ROE" })).toHaveAttribute("aria-pressed", "false");
  });

  it("아무것도 안 골랐으면 추가 목록이 먼저 열려 있다", () => {
    /* 빈 창을 보여 주고 한 번 더 누르게 하면 막다른 길처럼 보인다 */
    그리기([]);
    expect(screen.getByRole("button", { name: "매출" })).toBeInTheDocument();
  });
});

describe("가득 찼을 때", () => {
  it("더는 못 고른다", async () => {
    const u = userEvent.setup();
    그리기(["revenue", "op_income"], vi.fn(), 2);
    await u.click(screen.getByRole("button", { name: /지표 추가/ }));
    expect(screen.getByRole("button", { name: "ROE" })).toBeDisabled();
  });

  it("이미 고른 것은 여전히 뺄 수 있다", async () => {
    /* 여기서 같이 막으면 20개를 채운 뒤 바꿀 방법이 없어진다 */
    const u = userEvent.setup();
    const { onChange } = 그리기(["revenue", "op_income"], vi.fn(), 2);
    await u.click(screen.getByRole("button", { name: /지표 추가/ }));
    const 매출 = screen.getByRole("button", { name: "매출" });
    expect(매출).not.toBeDisabled();
    await u.click(매출);
    expect(onChange).toHaveBeenCalledWith(["op_income"]);
  });

  it("몇 개까지인지 알려준다", () => {
    그리기(["revenue"], vi.fn(), 20);
    expect(screen.getByText(/1\/20/)).toBeInTheDocument();
  });
});

describe("화면이 차트를 밀어내지 않는다", () => {
  it("설정 덩어리가 화면에 늘 펼쳐져 있지 않다", () => {
    /* 예전에는 "지표 선택" 패널과 "순서 조정" 패널이 본문에 박혀 있었다 */
    expect(StockDetail원문).not.toMatch(/지표 선택<\/span>/);
    expect(StockDetail원문).not.toMatch(/순서 조정/);
  });

  it("대신 관리 버튼 하나로 연다", () => {
    expect(StockDetail원문).toMatch(/지표 관리/);
    expect(StockDetail원문).toMatch(/<MetricManagerModal/);
  });

  it("고른 것은 버튼 옆에 남는다", () => {
    /* 창을 열지 않고도 지금 무엇을 보고 있는지 알아야 한다 */
    const i = StockDetail원문.indexOf("지표 관리");
    const 구역 = StockDetail원문.slice(i, i + 1200);
    expect(구역).toMatch(/selectedOpts\.map/);
  });
});

describe("다른 화면과 같은 부품을 쓴다", () => {
  it("관심종목·내 자산과 같은 목록 부품", () => {
    expect(모달원문).toMatch(/from "@\/components\/common\/ReorderableList"/);
  });

  it("관심종목·내 자산과 같은 창 부품", () => {
    expect(모달원문).toMatch(/Modal.*from "@\/components\/ui"/);
  });

  it("창 머리에 무엇을 하는 곳인지 한 줄 적는다", () => {
    /* 탭 관리·계좌 관리도 같은 자리에 같은 안내가 있다 */
    그리기(["revenue"]);
    const 제목 = screen.getByText("지표 관리");
    expect(제목.parentElement!.textContent).toMatch(/끌어서/);
  });
});
