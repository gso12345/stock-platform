/**
 * 첫 화면이 오래 걸릴 때 무슨 말을 하는가.
 *
 * "처음 볼 때 너무 느리다" 의 실체는 캐시가 아니라 Render 무료 플랜이
 * 서버를 재우는 것이다(15분 무접속 → 다음 사람이 20~45초 대기). 그 시간
 * 자체는 코드로 줄일 수 없다. 줄일 수 있는 건 "고장난 줄 아는 마음" 뿐이고,
 * 그래서 이 화면이 하는 일은 단 하나 — 때에 맞는 말을 하는 것이다.
 *
 * 검사하는 것도 그 하나다. 몇 초에 무슨 말이 나오는가, 그리고 아직 이르면
 * 아무 말도 안 하는가.
 */
import { render, screen, act, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import BootScreen from "../BootScreen";

/** 가짜 시계를 n 초 감는다. setInterval 이 0.5초마다 돌므로 넉넉히 흘린다 */
function 초흘리기(초: number) {
  act(() => {
    vi.advanceTimersByTime(초 * 1000);
  });
}

describe("BootScreen — 기다리는 동안 하는 말", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("처음 2초는 아무 말도 하지 않는다", () => {
    // 대개 여기서 끝난다. 스쳐 지나갈 글자로 괜히 겁줄 필요가 없다
    render(<BootScreen />);
    초흘리기(1);
    expect(screen.queryByText(/불러오는 중/)).toBeNull();
    expect(screen.queryByText(/서버를 깨우는 중/)).toBeNull();
    expect(screen.queryByText(/거의 다/)).toBeNull();
  });

  it("돌아가는 표시는 처음부터 보인다", () => {
    // 글자는 없어도 '멈춘 게 아니다' 는 보여야 한다
    const { container } = render(<BootScreen />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("2초가 지나면 불러오는 중이라고 한다", () => {
    render(<BootScreen />);
    초흘리기(3);
    expect(screen.getByText("불러오는 중")).toBeTruthy();
    // 아직 서버 이야기를 꺼낼 때가 아니다 — 2초 지연은 흔한 일이다
    expect(screen.queryByText(/서버를 깨우는 중/)).toBeNull();
  });

  it("6초가 지나면 서버가 자고 있었다고 설명한다", () => {
    render(<BootScreen />);
    초흘리기(7);
    expect(screen.getByText("서버를 깨우는 중")).toBeTruthy();
    // 이유가 있어야 기다릴 마음이 생긴다. '한 번만' 이 핵심이다
    expect(screen.getByText(/무료 서버/)).toBeTruthy();
    expect(screen.getByText(/처음 한 번만/)).toBeTruthy();
    // 앞 단계 문구가 같이 남아 있으면 안 된다
    expect(screen.queryByText("불러오는 중")).toBeNull();
  });

  it("25초가 지나면 거의 다 됐다고 한다", () => {
    render(<BootScreen />);
    초흘리기(26);
    expect(screen.getByText("거의 다 됐어요")).toBeTruthy();
    expect(screen.queryByText("서버를 깨우는 중")).toBeNull();
  });

  it("단계는 뒤로 돌아가지 않는다", () => {
    // 시간이 흐를수록 말이 앞으로만 가야 한다. 뒤섞이면 더 불안하다
    render(<BootScreen />);
    초흘리기(7);
    expect(screen.getByText("서버를 깨우는 중")).toBeTruthy();
    초흘리기(30);
    expect(screen.getByText("거의 다 됐어요")).toBeTruthy();
    초흘리기(60);
    expect(screen.getByText("거의 다 됐어요")).toBeTruthy();
  });

  it("경계 바로 앞에서는 아직 넘어가지 않는다", () => {
    // 5초에 '서버' 이야기가 나오면 너무 성급하다
    render(<BootScreen />);
    초흘리기(5);
    expect(screen.getByText("불러오는 중")).toBeTruthy();
    expect(screen.queryByText("서버를 깨우는 중")).toBeNull();
  });

  it("화면을 떠나면 시계를 멈춘다", () => {
    // 첫 화면이 열리고 나서도 0.5초마다 계속 도는 건 낭비다
    const { unmount } = render(<BootScreen />);
    const 남은수 = vi.getTimerCount();
    expect(남은수).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("BootScreen 연결", () => {
  const 본문 = fs.readFileSync(
    path.resolve(__dirname, "../../main.tsx"),
    "utf-8",
  );

  it("첫 화면 대기 자리에 실제로 걸려 있다", () => {
    // 파일만 만들어 두고 안 쓰면 아무것도 달라지지 않는다
    expect(본문).toMatch(/<Suspense\s+fallback=\{<BootScreen\s*\/>\}/);
  });

  it('예전 "로딩 중..." 다섯 글자는 남아 있지 않다', () => {
    const 코드 = 본문.replace(/\{\/\*[\s\S]*?\*\/\}/g, ""); // 주석에 남은 인용은 뺀다
    expect(코드).not.toMatch(/fallback=\{?["<]?로딩 중/);
  });

  it("서버를 깨우는 요청을 이제 안 보낸다", () => {
    /* 예전에는 앱이 뜰 때 /health 를 한 번 두드렸다. Render 무료 플랜이
       자고 있을 때(20~45초) 첫 요청을 도달시키려는 것이었다.

       그 잠듦이 없어졌다. 남겨 두면 얻는 것 없이 손해만 남는다 —
       바로 위 prefetch 세 건과 같은 순간에 요청이 하나 더 나가서,
       정작 화면에 필요한 값들이 그만큼 뒤로 밀린다.

       주석(//)은 지운 뒤에 본다. 왜 뺐는지는 남겨 뒀기 때문이다. */
    const 코드 = 본문.replace(/\/\/.*$/gm, "");
    expect(코드).not.toMatch(/fetch\(/);
  });

  it("깨우는 요청이 무거운 곳을 두드리지 않는다", () => {
    /* 예전에는 /dashboard/indices 를 불렀다 — 지수 9개를 다 모아 오는데
       응답은 쓰지도 않고 버렸다. CPU 0.15개짜리 서버에서 바로 아래
       prefetch 들과 같은 자원을 놓고 다투니, 깨우려던 요청이 정작
       사용자가 기다리는 화면을 늦추고 있었다.

       지금은 깨우는 요청 자체가 없지만, 다시 재우는 요금제로 돌아가
       이 자리를 되살릴 때 같은 실수를 반복하지 않도록 남겨 둔다. */
    const 코드 = 본문.replace(/\/\/.*$/gm, "");
    expect(코드).not.toMatch(/fetch\([^)]*dashboard\/indices/);
  });
});
