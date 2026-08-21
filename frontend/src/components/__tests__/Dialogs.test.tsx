/**
 * 확인창과 알림을 앱 안에서 처리한다.
 *
 * 관리자 화면은 ConfirmDialog 로 통일했는데 정작 사용자 화면은
 * window.confirm 과 alert 을 그대로 쓰고 있었다 — 글·댓글 삭제처럼
 * 되돌릴 수 없는 일이 오히려 사용자 쪽에 더 많은데도.
 *
 * 브라우저 기본 창의 문제 —
 *   · 앱 모양과 따로 논다
 *   · 무엇을 지우는지(대상 이름)를 보여 줄 수 없다. 목록에서 옆줄을
 *     잘못 누르는 것이 가장 흔한 실수인데 그걸 막아 주지 못한다
 *   · 휴대폰에서 화면 한가운데를 덮고, 반드시 눌러야 사라진다
 */
import { render, screen, waitFor, cleanup, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";

import { use확인, use알림 } from "@/hooks/useDialogs";

afterEach(cleanup);

const 소스 = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf-8");

/** 주석에 적힌 옛 코드가 검사에 걸리지 않게 걷어낸다 */
const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("use확인", () => {
  function 시험판({ onConfirm }: { onConfirm: () => void }) {
    const { 묻기, 화면 } = use확인();
    return (
      <>
        <button onClick={() => 묻기({
          title: "글을 삭제할까요?",
          message: "지운 글은 되돌릴 수 없습니다.",
          대상: "삼성전자 · 오늘 많이 올랐네요",
          onConfirm,
        })}>지우기</button>
        {화면}
      </>
    );
  }

  it("누르기 전에는 아무것도 안 뜬다", () => {
    render(<시험판 onConfirm={() => {}} />);
    expect(screen.queryByText("글을 삭제할까요?")).toBeNull();
  });

  it("무엇을 지우는지 보여 준다", async () => {
    /* 브라우저 confirm 으로는 못 하던 일이다.
       목록에서 옆줄을 잘못 누르는 것이 가장 흔한 실수다. */
    render(<시험판 onConfirm={() => {}} />);
    await userEvent.click(screen.getByText("지우기"));
    expect(screen.getByText("글을 삭제할까요?")).toBeTruthy();
    expect(screen.getByText(/삼성전자/)).toBeTruthy();
    expect(screen.getByText(/되돌릴 수 없습니다/)).toBeTruthy();
  });

  it("확인을 눌러야 실행된다", async () => {
    const 실행 = vi.fn();
    render(<시험판 onConfirm={실행} />);
    await userEvent.click(screen.getByText("지우기"));
    expect(실행).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(실행).toHaveBeenCalledTimes(1);
  });

  it("취소하면 실행되지 않고 창이 닫힌다", async () => {
    const 실행 = vi.fn();
    render(<시험판 onConfirm={실행} />);
    await userEvent.click(screen.getByText("지우기"));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(실행).not.toHaveBeenCalled();
    expect(screen.queryByText("글을 삭제할까요?")).toBeNull();
  });

  it("실행이 끝나면 창이 닫힌다", async () => {
    render(<시험판 onConfirm={() => {}} />);
    await userEvent.click(screen.getByText("지우기"));
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByText("글을 삭제할까요?")).toBeNull());
  });

  it("실행이 실패해도 창이 닫힌다", async () => {
    /* 열린 채로 두면 다시 누를 수 있어 같은 일을 두 번 하게 된다 */
    const 터짐 = vi.fn(() => Promise.reject(new Error("실패")));
    render(<시험판 onConfirm={터짐 as any} />);
    await userEvent.click(screen.getByText("지우기"));
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByText("글을 삭제할까요?")).toBeNull());
  });
});

describe("use알림", () => {
  function 시험판({ 종류 = "success" as any }) {
    const { 보이기, 화면 } = use알림();
    return (
      <>
        <button onClick={() => 보이기("신고가 접수되었습니다", 종류)}>알리기</button>
        {화면}
      </>
    );
  }

  it("부르기 전에는 안 뜬다", () => {
    render(<시험판 />);
    expect(screen.queryByText("신고가 접수되었습니다")).toBeNull();
  });

  it("성공 알림이 뜬다", async () => {
    render(<시험판 />);
    await userEvent.click(screen.getByText("알리기"));
    expect(screen.getByText("신고가 접수되었습니다")).toBeTruthy();
  });

  it("성공은 status, 오류는 alert 으로 읽힌다", async () => {
    /* 화면 읽어주는 기능이 오류만 하던 일을 끊고 알린다.
       잘 됐다는 말까지 끼어들면 성가시다 */
    const { unmount } = render(<시험판 종류="success" />);
    await userEvent.click(screen.getByText("알리기"));
    expect(screen.getByRole("status")).toBeTruthy();
    unmount();

    render(<시험판 종류="error" />);
    await userEvent.click(screen.getByText("알리기"));
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  /* 가짜 시계에서는 userEvent 가 자체 대기를 걸어 멈춘다.
     여기서 보려는 것은 '시간이 지나면 사라지는가' 뿐이라
     클릭은 fireEvent 로 곧바로 보낸다. */
  it("성공 알림은 알아서 사라진다", () => {
    vi.useFakeTimers();
    try {
      render(<시험판 종류="success" />);
      fireEvent.click(screen.getByText("알리기"));
      expect(screen.getByText("신고가 접수되었습니다")).toBeTruthy();
      act(() => { vi.advanceTimersByTime(3500); });
      expect(screen.queryByText("신고가 접수되었습니다")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("오류는 저절로 사라지지 않는다", () => {
    /* 실패는 사용자가 읽고 닫아야 한다. 스쳐 지나가면
       무엇이 잘못됐는지 모른 채 넘어간다 */
    vi.useFakeTimers();
    try {
      render(<시험판 종류="error" />);
      fireEvent.click(screen.getByText("알리기"));
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(screen.getByText("신고가 접수되었습니다")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("브라우저 기본 창이 남아 있지 않은가", () => {
  const 고친파일 = [
    "pages/Feed.tsx",
    "pages/FeedWrite.tsx",
    "pages/PostDetail.tsx",
    "components/community/CommunityTab.tsx",
    "components/community/PostDetailModal.tsx",
  ];

  it.each(고친파일)("%s 에 confirm/alert 이 없다", (f) => {
    const 코드 = 코드만(소스(f));
    expect(코드).not.toMatch(/(^|[^.\w])confirm\s*\(/);
    expect(코드).not.toMatch(/(^|[^.\w])alert\s*\(/);
  });

  it.each(고친파일)("%s 가 공용 도구를 쓴다", (f) => {
    expect(소스(f)).toMatch(/use확인|ConfirmDialog/);
  });

  it("확인창이 공용 자리에 있다", () => {
    /* 관리자 폴더에 있으면 사용자 화면에서 쓰기 어색하다 —
       실제로 그래서 사용자 쪽만 브라우저 기본 창으로 남아 있었다 */
    expect(fs.existsSync(path.resolve(__dirname, "../ui/ConfirmDialog.tsx"))).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, "../admin/ConfirmDialog.tsx"))).toBe(false);
  });
});
