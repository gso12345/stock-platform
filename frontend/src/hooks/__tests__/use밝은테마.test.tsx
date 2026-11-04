/**
 * 캔버스 차트가 테마 바뀜을 아는 길 — html 의 light 클래스를 지켜본다(Layout 이 설정·기기 설정을 합쳐 붙이는 최종 결과).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { use밝은테마 } from "@/hooks/use밝은테마";

function 보기() {
  return <span>{use밝은테마() ? "라이트" : "다크"}</span>;
}

beforeEach(() => { document.documentElement.className = "dark"; });

describe("use밝은테마", () => {
  it("처음 클래스를 읽는다", () => {
    document.documentElement.className = "light";
    render(<보기 />);
    expect(screen.getByText("라이트")).toBeInTheDocument();
  });

  it("클래스가 바뀌면 따라 바뀐다 — 오가도", async () => {
    render(<보기 />);
    expect(screen.getByText("다크")).toBeInTheDocument();
    await act(async () => { document.documentElement.classList.add("light"); });
    expect(screen.getByText("라이트")).toBeInTheDocument();
    await act(async () => { document.documentElement.classList.remove("light"); });
    expect(screen.getByText("다크")).toBeInTheDocument();
  });

  it("다른 클래스(글씨 크기)가 바뀌어도 밝기는 그대로", async () => {
    render(<보기 />);
    await act(async () => { document.documentElement.classList.add("font-large"); });
    expect(screen.getByText("다크")).toBeInTheDocument();
  });
});
