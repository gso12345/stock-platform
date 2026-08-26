/**
 * 쪽 넘기기·모달 바닥 — 흩어져 있던 것을 하나로 모은 자리.
 *
 * 다섯 화면(피드·커뮤니티·관리자 셋)이 거의 같은 스무 줄을 각자 갖고
 * 있었다. 이런 것이 갈라져 있으면 한쪽만 고쳐진다 — 실제로
 * disabled:cursor-not-allowed 가 두 곳에만 붙어 있었다.
 *
 * 그래서 이 검사는 두 가지를 본다.
 *   1) 부품 자체가 맞게 도는가 (경계에서 안 넘어가는가)
 *   2) 화면들이 정말 이 부품을 쓰는가 — 옛 코드가 남아 있으면
 *      모으는 뜻이 없다
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import path from "path";
import Pagination, { 보일쪽들 } from "@/components/ui/Pagination";
import ModalFooter from "@/components/ui/ModalFooter";

const 뿌리 = path.resolve(__dirname, "../..");
const 읽기 = (rel: string) => fs.readFileSync(path.join(뿌리, rel), "utf-8");

/** 이 다섯 화면이 쪽 넘기기를 갖고 있었다 */
const 넘기는화면 = [
  "pages/Feed.tsx",
  "components/community/CommunityTab.tsx",
  "components/admin/ReportsTab.tsx",
  "components/admin/UsersTab.tsx",
  "components/admin/CommunityAdminTab.tsx",
];


describe("보일 쪽 고르기", () => {
  it("앞쪽에서는 1부터", () => {
    expect(보일쪽들(1, 12)).toEqual([1, 2, 3, 4, 5]);
    expect(보일쪽들(3, 12)).toEqual([1, 2, 3, 4, 5]);
  });

  it("가운데서는 지금 쪽이 가운데", () => {
    expect(보일쪽들(6, 12)).toEqual([4, 5, 6, 7, 8]);
  });

  it("끝쪽에서는 마지막이 끝에 붙는다", () => {
    /* 여기서 12를 넘어가면 없는 쪽 단추가 생긴다 */
    expect(보일쪽들(12, 12)).toEqual([8, 9, 10, 11, 12]);
    expect(보일쪽들(11, 12)).toEqual([8, 9, 10, 11, 12]);
  });

  it("쪽이 다섯보다 적으면 있는 만큼만", () => {
    expect(보일쪽들(1, 3)).toEqual([1, 2, 3]);
    expect(보일쪽들(2, 2)).toEqual([1, 2]);
  });

  it("쪽이 넷인데 마지막 쪽에 있어도 1부터 넷이 다 보인다", () => {
    /* '끝쪽' 갈래가 쪽 수를 다섯으로 못 박고 있으면 여기서 0쪽이 생긴다.
       앞의 검사들은 12쪽으로만 봐서 이 갈래를 안 지나갔다 —
       page<=3 갈래가 먼저 먹거나, 12-4 와 12-(5-1) 이 같은 값이었다. */
    expect(보일쪽들(4, 4)).toEqual([1, 2, 3, 4]);
    expect(보일쪽들(3, 4)).toEqual([1, 2, 3, 4]);
  });
});


describe("쪽 넘기기", () => {
  const 그리기 = (p: number, n: number, extra = {}) => {
    const onChange = vi.fn();
    render(<Pagination page={p} totalPages={n} onChange={onChange} {...extra} />);
    return onChange;
  };

  it("쪽이 하나뿐이면 아무것도 안 그린다", () => {
    그리기(1, 1);
    expect(screen.queryByRole("button", { name: "이전 쪽" })).not.toBeInTheDocument();
  });

  it("첫 쪽에서는 '이전' 이 잠긴다", () => {
    그리기(1, 5);
    expect(screen.getByRole("button", { name: "이전 쪽" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다음 쪽" })).toBeEnabled();
  });

  it("마지막 쪽에서는 '다음' 이 잠긴다", () => {
    그리기(5, 5);
    expect(screen.getByRole("button", { name: "다음 쪽" })).toBeDisabled();
  });

  it("누르면 앞뒤로 옮긴다", async () => {
    const onChange = 그리기(3, 5);
    await userEvent.click(screen.getByRole("button", { name: "다음 쪽" }));
    expect(onChange).toHaveBeenCalledWith(4);
    await userEvent.click(screen.getByRole("button", { name: "이전 쪽" }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("기본은 '3 / 12' 글자", () => {
    그리기(3, 12);
    expect(screen.getByText("3 / 12")).toBeInTheDocument();
  });

  it("numbered 면 쪽 번호 단추를 그린다", async () => {
    const onChange = 그리기(1, 12, { numbered: true });
    expect(screen.queryByText("1 / 12")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "4" }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("지금 쪽을 읽어주는 기능에도 알린다", () => {
    그리기(3, 12, { numbered: true });
    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "2" })).not.toHaveAttribute("aria-current");
  });
});


describe("모달 바닥", () => {
  it("저장 중에는 둘 다 잠근다", () => {
    /* 두 번 눌러 두 벌이 들어가는 것을 막는다 */
    render(<ModalFooter onCancel={() => {}} onConfirm={() => {}} 확인글="저장" 진행중 />);
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("조건이 안 되면 확인만 잠근다 — 취소는 늘 열려 있어야 한다", () => {
    render(<ModalFooter onCancel={() => {}} onConfirm={() => {}} 확인글="저장" 확인가능={false} />);
    expect(screen.getByRole("button", { name: "취소" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("누르면 각자 제 일을 한다", async () => {
    const 취소 = vi.fn(); const 확인 = vi.fn();
    render(<ModalFooter onCancel={취소} onConfirm={확인} 확인글="추가" />);
    await userEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(확인).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(취소).toHaveBeenCalled();
  });
});


describe("화면들이 정말 쓴다", () => {
  it("다섯 화면 모두 공용 쪽 넘기기를 쓴다", () => {
    for (const f of 넘기는화면) {
      expect(읽기(f), `${f} 가 공용 부품을 안 쓴다`).toContain("<Pagination");
    }
  });

  it("옛 쪽 넘기기 코드가 남아 있지 않다", () => {
    /* 남아 있으면 한쪽만 고쳐지는 문제가 그대로다 */
    const 옛클래스 = "px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border";
    for (const f of 넘기는화면) {
      expect(읽기(f), `${f} 에 옛 코드가 남았다`).not.toContain(옛클래스);
    }
  });

  it("모달 셋이 공용 바닥을 쓴다", () => {
    const 옛 = "flex-1 px-4 py-2 text-sm font-semibold rounded-lg";
    for (const f of ["components/portfolio/PortfolioModals.tsx",
                     "components/watchlist/WatchlistModals.tsx"]) {
      expect(읽기(f)).toContain("<ModalFooter");
      expect(읽기(f), `${f} 에 옛 코드가 남았다`).not.toContain(옛);
    }
  });
});
