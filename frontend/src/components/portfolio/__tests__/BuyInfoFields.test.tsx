import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { BuyInfoFields, type BuyInfoValue } from "../BuyInfoFields";

/**
 * 매수 정보 입력 폼 — 내 자산과 관심종목이 함께 쓰는 화면이다.
 * 여기서 값이 잘못 전달되면 보유 수량·평단가가 틀어져 자산 평가가 통째로 어긋난다.
 */

const EMPTY: BuyInfoValue = {
  currency: "USD", shares: "", avgPrice: "",
  inputFx: "", purchaseDate: "", note: "", assetClass: "",
};

/** 실제 사용처처럼 부모가 상태를 들고 있는 형태로 감싼다 */
function Harness({ isForex = true, onChange }: { isForex?: boolean; onChange?: (v: BuyInfoValue) => void }) {
  const [value, setValue] = useState<BuyInfoValue>(EMPTY);
  return (
    <BuyInfoFields
      value={value}
      onChange={(patch) => setValue((prev) => { const next = { ...prev, ...patch }; onChange?.(next); return next; })}
      isForex={isForex}
      defaultFx={1400}
    />
  );
}

describe("매수 정보 입력 폼", () => {
  it("입력한 수량과 평단가가 그대로 상위로 전달된다", async () => {
    const user = userEvent.setup();
    const seen: BuyInfoValue[] = [];
    render(<Harness onChange={(v) => seen.push(v)} />);

    const nums = screen.getAllByRole("spinbutton");
    await user.type(nums[0], "7");
    await user.type(nums[1], "70000");

    const last = seen[seen.length - 1];
    expect(last.shares).toBe("7");
    expect(last.avgPrice).toBe("70000");
  });

  it("해외 종목은 통화를 고를 수 있다", () => {
    render(<Harness isForex />);
    expect(screen.getByRole("button", { name: /달러/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /원화/ })).toBeInTheDocument();
  });

  it("국내 종목에는 통화 선택이 없다", () => {
    render(<Harness isForex={false} />);
    expect(screen.queryByRole("button", { name: /달러/ })).not.toBeInTheDocument();
  });

  it("달러로 입력할 때만 매수 당시 환율을 묻는다", async () => {
    const user = userEvent.setup();
    render(<Harness isForex />);

    // 기본값이 USD이므로 환율 입력이 있다
    expect(screen.getByText(/매수 당시 환율/)).toBeInTheDocument();

    // 원화로 바꾸면 사라진다 (원화 금액에는 환율을 다시 곱하면 안 되므로)
    await user.click(screen.getByRole("button", { name: /원화/ }));
    expect(screen.queryByText(/매수 당시 환율/)).not.toBeInTheDocument();
  });

  it("국내 종목에는 환율 입력이 아예 없다", () => {
    render(<Harness isForex={false} />);
    expect(screen.queryByText(/매수 당시 환율/)).not.toBeInTheDocument();
  });

  it("자산유형은 '자동 분류'가 기본이고 직접 고를 수도 있다", async () => {
    const user = userEvent.setup();
    const seen: BuyInfoValue[] = [];
    render(<Harness onChange={(v) => seen.push(v)} />);

    const select = screen.getByRole("combobox");
    expect((select as HTMLSelectElement).value).toBe("");

    await user.selectOptions(select, "채권");
    expect(seen[seen.length - 1].assetClass).toBe("채권");
  });

  it("메모는 100자까지만 받는다", () => {
    render(<Harness />);
    expect(screen.getByRole("textbox")).toHaveAttribute("maxLength", "100");
  });

  it("평단가 단위 표시가 선택한 통화를 따라간다", async () => {
    const user = userEvent.setup();
    render(<Harness isForex />);

    expect(screen.getByText(/평균매수가 \* \(\$\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /원화/ }));
    expect(screen.getByText(/평균매수가 \* \(₩\)/)).toBeInTheDocument();
  });
});
