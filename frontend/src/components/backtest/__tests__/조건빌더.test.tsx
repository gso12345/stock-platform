/**
 * 진입·청산 조건 줄이 **폰 화면에 들어가는가**.
 *
 * ── 무엇이 문제였나 ────────────────────────────────────────
 *
 * 조건 한 줄이 칸 다섯짜리 **고정 그리드**였다. 지표·기간·연산자·값·
 * 삭제를 한 줄에 억지로 밀어 넣는데, 390px 짜리 폰에서는 다섯이 절대
 * 안 들어간다. 그리드는 줄이지도 접지도 않으므로 값과 삭제 단추가
 * 화면 밖으로 **149px** 밀려 나갔다(실측). 가로 스크롤 막대도 없으니
 * 거기 뭔가 더 있다는 것조차 모른다 — 값을 못 보고 지울 수도 없으니
 * 조건을 만들다 만 채로 끝난다.
 *
 * 게다가 기간이 없는 지표(RSI 등)에도 빈 칸을 두고 있어서, 줄의 1/3 이
 * 아무것도 아닌 것으로 채워졌다.
 *
 * ── jsdom 의 한계 ──────────────────────────────────────────
 *
 * jsdom 은 배치를 계산하지 않는다. 그래서 '넘쳤는가' 는 여기서 절대
 * 못 잰다 — 그건 브라우저로 찍어서 확인했다(모든 폭에서 넘침 0px).
 * 여기서는 **다시 그렇게 되지 않도록 규칙을 못 박는다.**
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import path from "path";

import { ConditionBuilder } from "../ConditionBuilder";
import type { ConditionGroup } from "@/types";

const 소스 = fs.readFileSync(
  path.resolve(__dirname, "../ConditionBuilder.tsx"), "utf-8");

const 하나: ConditionGroup = {
  logic: "AND",
  conditions: [{ indicator: "MA", operator: "crosses_above", value: "EMA", period: 20 }],
};
const 둘: ConditionGroup = {
  logic: "AND",
  conditions: [
    { indicator: "MA", operator: "crosses_above", value: "EMA", period: 20 },
    { indicator: "RSI", operator: "<", value: 30 },
  ],
};

function 그리기(group: ConditionGroup = 하나) {
  const onChange = vi.fn();
  const r = render(
    <ConditionBuilder label="진입 조건" group={group} onChange={onChange} />);
  return { ...r, onChange };
}


describe("한 줄이 화면을 넘지 않는다", () => {
  it("고정 그리드가 아니라 접히는 줄이다", () => {
    /* grid-cols-[...] 다섯 칸은 안 들어가도 줄지 않는다 —
       flex-wrap 이어야 들어가면 한 줄, 안 들어가면 접힌다. */
    expect(소스, "칸 다섯짜리 고정 그리드로 되돌아갔다")
      .not.toMatch(/grid-cols-\[auto_1fr_auto_1fr_auto\]/);
    expect(소스, "조건 줄이 접히지 않는다 — 폰에서 잘려 나간다")
      .toMatch(/flex flex-wrap items-center/);
  });

  it("지표 칸이 줄어들 수 있다", () => {
    /* flex 안의 요소는 기본이 min-width:auto 라 **절대 안 줄어든다.**
       min-w-0 이 없으면 글자 길이만큼 버티면서 옆을 밀어내므로,
       flex-wrap 을 써도 여전히 넘친다. */
    expect(소스, "지표 칸이 안 줄어든다 — 옆 칸을 밀어낸다")
      .toMatch(/flex-1 min-w-0 basis-\[[\d.]+rem\] bg-bg-secondary/);
  });

  it("값 칸도 줄어들 수 있다", () => {
    expect(소스, "값 칸이 안 줄어든다")
      .toMatch(/flex gap-1 flex-1 min-w-0 basis-\[[\d.]+rem\]/);
  });

  it("기간·연산자 칸은 너비가 고정이다", () => {
    /* 늘었다 줄었다 하면 줄마다 칸 자리가 달라 읽기 어렵다.
       flex-shrink-0 이 없으면 좁은 화면에서 글자가 뭉개진다. */
    expect(소스, "기간 칸이 고정 너비가 아니다")
      .toMatch(/w-\[[\d.]+rem\] flex-shrink-0[^"]*"\s*\n?\s*value=\{cond\.period/);
    const 고정 = 소스.match(/w-\[[\d.]+rem\] flex-shrink-0/g) ?? [];
    expect(고정.length, "고정 너비 칸이 둘(기간·연산자)이어야 한다")
      .toBeGreaterThanOrEqual(2);
  });

  /** 한글은 글자 하나가 영문 둘만큼 넓다. 글자 **수**로 재면
   *  '단순이동평균 (MA)'(11자)가 'MA 이동평균'(7자)보다 짧다고 나온다 —
   *  실제로는 17 대 11 로 훨씬 넓은데도. */
  function 폭(s: string): number {
    let n = 0;
    for (const c of s) n += /[\u1100-\u11FF\u3000-\u303F\u3130-\u318F\uAC00-\uD7AF\uFF00-\uFFEF]/.test(c) ? 2 : 1;
    return n;
  }

  it("지표 이름이 칸에 들어갈 만큼 짧다", () => {
    /* 고르기 칸은 고른 항목의 글자 그대로 넓어진다. '단순이동평균
       (MA)'(폭 17)처럼 길면 그 칸 하나가 150px 을 먹고, 뒤의 값과
       삭제 단추가 화면 밖으로 밀린다. */
    const 이름들 = [...소스.matchAll(/label: "([^"]+)", hasPeriod/g)].map((m) => m[1]);
    expect(이름들.length, "지표 목록을 못 찾았다").toBeGreaterThan(20);
    const 긴것 = 이름들.filter((x) => 폭(x) > 14);
    expect(긴것, `이 이름들이 너무 넓다(폭 15 이상): ${긴것.join(", ")}`).toEqual([]);
  });

  it("연산자 이름은 더 짧다 — 칸 너비가 고정이다", () => {
    /* 연산자 칸은 4.6rem(74px) 으로 고정이라, 길면 글자가 잘린다.
       '골든크로스 ↑'(폭 12)은 안 들어간다. */
    const 이름들 = [...소스.matchAll(/\{ value: "(?:crosses_\w+|[<>=]+)", label: "([^"]+)" \}/g)]
      .map((m) => m[1]);
    expect(이름들.length, "연산자 목록을 못 찾았다").toBeGreaterThanOrEqual(7);
    const 긴것 = 이름들.filter((x) => 폭(x) > 8);
    expect(긴것, `연산자 이름이 칸을 넘는다: ${긴것.join(", ")}`).toEqual([]);
  });
});


describe("빈 칸을 만들지 않는다", () => {
  it("기간이 있는 지표에만 기간 칸을 그린다", () => {
    그리기();
    //: MA 는 기간이 있다 — 지표·기간·연산자 셋
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  it("기간이 없는 지표에는 기간 칸이 아예 없다", () => {
    /* 예전에는 빈 <div/> 를 뒀다. 눈에는 안 보이지만 줄의 1/3 을
       차지해서, 정작 값 칸이 좁아졌다. */
    그리기({ logic: "AND", conditions: [{ indicator: "RSI", operator: "<", value: 30 }] });
    expect(screen.getAllByRole("combobox"), "기간 칸이 아직 자리를 차지한다")
      .toHaveLength(2);
  });

  it("지표를 바꾸면 기간 칸이 따라 나타나고 사라진다", async () => {
    const { onChange, rerender } = 그리기(
      { logic: "AND", conditions: [{ indicator: "RSI", operator: "<", value: 30 }] });
    expect(screen.getAllByRole("combobox")).toHaveLength(2);

    await userEvent.selectOptions(screen.getAllByRole("combobox")[0], "MA");
    expect(onChange).toHaveBeenCalled();
    const 다음 = onChange.mock.calls[0][0];
    rerender(<ConditionBuilder label="진입 조건" group={다음} onChange={onChange} />);
    expect(screen.getAllByRole("combobox"), "MA 로 바꿨는데 기간 칸이 없다")
      .toHaveLength(3);
  });
});


describe("AND/OR 는 뜻이 있을 때만 보인다", () => {
  it("조건이 하나면 숨긴다", () => {
    /* 무엇과 무엇을 잇는지가 없는데 조작칸만 있으면, 눌러 보고 아무
       일도 안 일어나는 것을 확인하게 된다. */
    그리기(하나);
    expect(screen.getByRole("tab", { name: "AND" }).closest("div.hidden"),
      "조건이 하나인데 AND/OR 가 보인다").not.toBeNull();
  });

  it("조건이 둘이면 보여 준다", () => {
    그리기(둘);
    expect(screen.getByRole("tab", { name: "AND" }).closest("div.hidden"),
      "조건이 둘인데 AND/OR 를 숨겼다").toBeNull();
  });

  it("숨겨도 값은 그대로다", () => {
    /* 안 보인다고 지우면, 조건을 하나 지웠다 다시 더했을 때 OR 로
       해 뒀던 것이 AND 로 돌아간다. */
    그리기({ ...하나, logic: "OR" });
    expect(screen.getByRole("tab", { name: "OR" }).getAttribute("aria-selected"))
      .toBe("true");
  });
});


describe("삭제 단추가 몇 번째인지 말한다", () => {
  it("조건이 여럿이면 번호를 붙인다", () => {
    /* 이름을 '삭제' 만 두면 소리로 듣는 사람은 어느 것을 지우는지
       알 수 없다. */
    그리기(둘);
    expect(screen.getByLabelText("1번째 조건 삭제")).toBeInTheDocument();
    expect(screen.getByLabelText("2번째 조건 삭제")).toBeInTheDocument();
  });
});
