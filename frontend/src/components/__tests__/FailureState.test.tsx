/**
 * 실패와 빈 상태를 갈라 보여 주는가.
 *
 * 조회가 102곳인데 화면 안에서 실패를 알려 주는 곳이 4곳뿐이었다.
 * 나머지 14개 화면은 실패해도 목록이 비어 보이기만 했고, 사용자는
 * "아직 아무것도 없구나" 로 읽고 그냥 나간다 — 실제로는 한 번만 다시
 * 누르면 됐을 일이다.
 *
 * 전역 오류 토스트가 '아무 말도 없는 것' 은 막지만 그건 바닥이다.
 * 토스트는 몇 초 뒤 사라지고, 그 뒤로 화면에 남는 것은 여전히 빈 목록이다.
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";

import { 못불러옴 } from "@/components/ui";

afterEach(cleanup);

const 뿌리 = path.resolve(__dirname, "../..");
const 소스 = (rel: string) => fs.readFileSync(path.join(뿌리, rel), "utf-8");
/** 주석에 적힌 옛 코드가 검사에 걸리지 않게 걷어낸다 */
const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("못불러옴 부품", () => {
  it("무엇이 잘못됐는지 사람 말로 적는다", () => {
    render(<못불러옴 사유={{ response: { status: 500 } }} />);
    expect(screen.getByText(/서버에 문제가 있어/)).toBeTruthy();
  });

  it("이유를 모르면 연결을 못 했다고 본다", () => {
    /* 상태 코드가 없다는 것은 응답 자체가 안 온 것이다 */
    render(<못불러옴 />);
    expect(screen.getByText(/서버에 연결하지 못했습니다/)).toBeTruthy();
  });

  it("서버가 자다 깨는 데 걸리는 시간을 알려 준다", () => {
    /* 이 서버는 20~45초가 걸린다. 그걸 모르면 사용자는 고장이라고 본다 */
    render(<못불러옴 />);
    expect(screen.getByText(/20~45초/)).toBeTruthy();
  });

  it("다시 시도할 수 있다 — 실패의 상당수가 한 번이면 되는 일이다", () => {
    const 다시 = vi.fn();
    render(<못불러옴 다시={다시} />);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(다시).toHaveBeenCalledTimes(1);
  });

  it("다시 시도할 방법이 없으면 버튼을 안 만든다", () => {
    render(<못불러옴 />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("읽어주는 기능이 상태로 읽는다", () => {
    render(<못불러옴 />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("예외 이름이나 상태 코드를 내보내지 않는다", () => {
    /* 사용자에게 뜻이 없는 글자이고 서버 안쪽 사정만 드러난다 */
    render(<못불러옴 사유={{ response: { status: 503 }, name: "AxiosError" }} />);
    const 글 = document.body.textContent ?? "";
    expect(글).not.toContain("503");
    expect(글).not.toContain("AxiosError");
  });
});

describe("화면마다 실패를 알린다", () => {
  const 화면들 = [
    "pages/News.tsx",
    "pages/Screening.tsx",
    "pages/Portfolio.tsx",
    "pages/Watchlist.tsx",
    "pages/MyPage.tsx",
    "pages/PostDetail.tsx",
    "pages/Notifications.tsx",
    "pages/Strategies.tsx",
    "pages/IndexDetail.tsx",
    "pages/Backtest.tsx",
    "pages/Dashboard.tsx",
  ];

  it.each(화면들)("%s 이 실패를 화면에 그린다", (rel) => {
    expect(코드만(소스(rel))).toContain("<못불러옴");
  });

  it("다시 시도할 길을 함께 준다", () => {
    /* 알리기만 하고 다시 누를 수 없으면 사용자는 새로고침밖에 못 한다 */
    const 없는곳 = 화면들.filter((rel) => {
      const s = 코드만(소스(rel));
      const i = s.indexOf("<못불러옴");
      return !/다시=\{/.test(s.slice(i, i + 200));
    });
    expect(없는곳).toEqual([]);
  });
});

describe("실패와 빈 상태를 섞지 않는다", () => {
  it("스크리닝 — '안 돌림' 과 '돌렸는데 0건' 이 다른 말이다", () => {
    /* 예전에는 둘 다 "조건을 설정하고 스크리닝을 실행하세요" 였다.
       실행했는데 실행하라고 하니 눌린 건지조차 알 수 없었다 */
    const s = 코드만(소스("pages/Screening.tsx"));
    expect(s).toContain("runMutation.isSuccess");
    expect(s).toContain("조건에 맞는 종목이 없어요");
  });

  it("대시보드 순위 — 빈 목록에 '불러오지 못했어요' 라고 하지 않는다", () => {
    const s = 코드만(소스("pages/Dashboard.tsx"));
    expect(s).not.toContain("순위를 불러오지 못했어요");
    expect(s).toContain("아직 순위가 만들어지지 않았어요");
  });

  it("지수 상세 — 실패했는데 '불러오는 중' 이라고 하지 않는다", () => {
    /* 영영 안 오는데 계속 기다리라고 하는 셈이었다 */
    const s = 코드만(소스("pages/IndexDetail.tsx"));
    const i = s.indexOf("차트 데이터를 불러오는 중입니다");
    expect(i).toBeGreaterThan(-1);
    expect(s.slice(Math.max(0, i - 400), i)).toContain("<못불러옴");
  });

  it("전략저장소 — 실패했는데 '전략이 없다' 를 같이 띄우지 않는다", () => {
    const s = 코드만(소스("pages/Strategies.tsx"));
    expect(s).toContain("!isLoading && !못받음 && totalCount === 0");
  });
});

describe("기다리는 자리를 미리 잡는다", () => {
  const 스켈레톤들: [string, string][] = [
    ["pages/News.tsx", "NewsSkeleton"],
    ["pages/Screening.tsx", "ScreeningSkeleton"],
    ["pages/Backtest.tsx", "BacktestSkeleton"],
    ["pages/PostDetail.tsx", "PostSkeleton"],
  ];

  it.each(스켈레톤들)("%s 에 %s 이 있다", (rel, 이름) => {
    const s = 코드만(소스(rel));
    expect(s).toContain(`function ${이름}`);
    expect(s).toContain(`<${이름}`);
  });

  it("동그라미만 돌리던 자리를 걷어냈다", () => {
    /* 백테스트는 몇 초씩 걸린다. 동그라미만 돌면 얼마나 걸릴지 가늠이
       안 돼서, 사람이 멈춘 줄 알고 다시 누른다 */
    const s = 코드만(소스("pages/Backtest.tsx"));
    expect(s).not.toContain("<Card><LoadingSpinner /></Card>");
  });
});
