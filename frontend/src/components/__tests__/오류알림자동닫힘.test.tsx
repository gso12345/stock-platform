/**
 * 서버가 안 될 때 뜨는 빨간 띠가 스스로 사라진다.
 *
 * ── 왜 고쳤나 ───────────────────────────────────────────────
 *
 * 오류 알림만 **아예 안 닫혔다.** 사용자가 읽고 직접 닫으라는 뜻이었는데,
 * 서버가 자다 깨는 동안(무료 플랜은 20~45초가 걸린다) 그 빨간 띠가
 * 화면 맨 위에 계속 붙어 있었다. 이미 다시 붙어서 값이 정상으로 들어온
 * 뒤에도 그대로다 — 고장은 끝났는데 고장 표시만 남으니, 없느니만 못한
 * 틀린 정보가 된다.
 *
 * ── 두 가지를 같이 지켜야 한다 ──────────────────────────────
 *
 * 사라지게만 하면 반대쪽 고장이 생긴다. **아직 고장 중인데 사라지는**
 * 경우다 — 같은 오류가 계속 나는 동안에는 띠가 남아 있어야 한다.
 * 그런데 같은 문자열로 상태를 바꾸면 React 가 '안 바뀌었다' 고 보고
 * 다시 그리지 않아서, 타이머가 처음 뜬 시각 기준으로 그냥 끝나 버린다.
 * 그래서 회차를 같이 들고 key 에 넣는다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Toast } from "@/components/ui";
import QueryErrorToast from "@/components/common/QueryErrorToast";
import { 조회실패알림 } from "@/api/queryError";

/* 같은 말을 몰아서 띄우지 않으려고 queryError 가 마지막 알림을 4초
   기억한다(모듈에 남는 값이다). 검사마다 시계를 멀리 밀어 두지 않으면
   앞 검사가 남긴 기억 때문에 알림이 아예 안 뜬다 — 실제로 그래서
   '띠가 없다' 로 두 개가 거짓 실패했다. */
let 회차 = 0;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 1).getTime() + ++회차 * 600_000);
});
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

const 서버오류 = { response: { status: 500 } };

describe("빨간 띠가 스스로 사라진다", () => {
  it("오류도 시간이 지나면 닫힌다", () => {
    const 닫힘 = vi.fn();
    render(<Toast message="서버에 문제가 있어요" kind="error" onClose={닫힘} />);
    expect(닫힘).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(7000); });
    expect(닫힘).toHaveBeenCalledTimes(1);
  });

  it("오류가 성공보다 오래 머문다", () => {
    /* 오류는 읽고 뜻을 알아채는 데 시간이 걸리고, 대개 무엇을 해야
       하는지까지 적혀 있다. 성공은 '잘 됐다' 한마디라 짧아도 된다.
       둘이 같아지면 오류를 놓친다. */
    const 오류닫힘 = vi.fn(), 성공닫힘 = vi.fn();
    render(<Toast message="실패" kind="error" onClose={오류닫힘} />);
    render(<Toast message="성공" kind="success" onClose={성공닫힘} />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(성공닫힘).toHaveBeenCalled();
    expect(오류닫힘, "오류가 성공과 같이 사라졌다").not.toHaveBeenCalled();
  });

  it("0 을 주면 안 닫힌다 — 반드시 봐야 하는 자리를 위해 남긴다", () => {
    const 닫힘 = vi.fn();
    render(<Toast message="이건 남아야 한다" kind="error" 자동닫힘={0} onClose={닫힘} />);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(닫힘).not.toHaveBeenCalled();
  });
});

describe("아직 고장 중이면 안 사라진다", () => {
  it("같은 오류가 다시 나면 머무는 시간이 다시 시작된다", () => {
    /* 여기가 이 고침에서 제일 놓치기 쉬운 자리다.
       같은 문자열로 set 하면 React 가 다시 안 그리고, 그러면 타이머도
       처음 뜬 시각 그대로다 — 아직 서버가 안 되는데 띠만 사라진다. */
    render(<QueryErrorToast />);

    act(() => { 조회실패알림(서버오류); });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // 5초 뒤(아직 안 닫혔다) 같은 오류가 또 난다
    act(() => { vi.advanceTimersByTime(5000); 조회실패알림(서버오류); });
    // 처음 뜬 지 7초가 지났지만, 다시 났으므로 남아 있어야 한다
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByRole("alert"), "다시 났는데 사라졌다").toBeInTheDocument();

    // 더 이상 안 나면 그때부터 7초 뒤 사라진다
    act(() => { vi.advanceTimersByTime(7000); });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("한 번만 나면 그 뒤로 사라진다", () => {
    render(<QueryErrorToast />);
    act(() => { 조회실패알림(서버오류); });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(7000); });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("닫기 단추는 그대로 있다", () => {
    /* 스스로 사라진다고 손으로 닫는 길을 없애지 않는다 —
       읽고 바로 치우고 싶은 사람이 있다 */
    render(<QueryErrorToast />);
    act(() => { 조회실패알림(서버오류); });
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();
  });
});
