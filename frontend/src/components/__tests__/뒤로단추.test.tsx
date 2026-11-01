/**
 * 뒤로 단추 — 글자 없이 화살표만(사용자: "로그인할 때 뒤로가기 글자 써져 있는 거 디자인적으로 안 좋은 것 같아").
 * 로그인·이용약관·개인정보처리방침이 같은 공용 단추(ui/BackButton)를 쓴다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { BackButton } from "../ui/BackButton";

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel: any) => sel({ login: vi.fn(), isLoggedIn: false }),
}));

import Login from "@/pages/Login";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";

function 지금() {
  return <p data-testid="지금">{useLocation().pathname}</p>;
}

function 그리기(기록: string[], 화면 = <BackButton />) {
  return render(
    <MemoryRouter initialEntries={기록} initialIndex={기록.length - 1}>
      <지금 />
      <Routes>
        <Route path="*" element={화면} />
      </Routes>
    </MemoryRouter>,
  );
}
const 단추 = () => screen.getByRole("button", { name: "뒤로 가기" });

describe("공용 뒤로 단추", () => {
  it("글자 없이 화살표만 — 이름은 화면 읽기용으로만, 손가락 크기(44px)", () => {
    그리기(["/login"]);
    expect(단추().textContent).toBe("");
    expect(단추().querySelector("svg")).not.toBeNull();
    // 이름은 aria-label 로 — 풍선말(title)은 손가락 기기의 화면 읽기에서 안 읽히기도 한다
    expect(단추().getAttribute("aria-label")).toBe("뒤로 가기");
    expect(단추().getAttribute("title")).toBe("뒤로 가기");
    expect(단추().className.split(/\s+/)).toEqual(expect.arrayContaining(["w-11", "h-11"]));
  });

  it("앱 안에서 들어왔으면 그 화면으로 돌아간다", () => {
    그리기(["/portfolio", "/login"]);
    fireEvent.click(단추());
    expect(screen.getByTestId("지금").textContent).toBe("/portfolio");
  });

  it("주소로 바로 열었거나 새 탭으로 열었으면(돌아갈 곳이 앱 밖) 첫 화면으로", () => {
    그리기(["/terms"]);
    fireEvent.click(단추());
    expect(screen.getByTestId("지금").textContent).toBe("/");
  });

  it("자리 잡는 클래스·style 을 덧붙일 수 있다(겹치는 여백은 덧붙인 쪽이 이긴다)", () => {
    그리기(["/login"], <BackButton className="fixed ml-0" style={{ top: "12px" }} />);
    const 반 = 단추().className.split(/\s+/);
    expect(반).toContain("fixed");
    expect(반).toContain("ml-0");
    expect(반).not.toContain("-ml-2");
    expect(단추().style.top).toBe("12px");
  });
});

describe("쓰는 화면들 — '뒤로가기' 글자가 없다", () => {
  it("로그인 — 화면 왼쪽 위 구석, 아이폰 시계 밑으로", () => {
    그리기(["/", "/login"], <Login />);
    expect(screen.queryByText(/뒤로가기/)).toBeNull();
    expect(단추().className.split(/\s+/)).toContain("fixed");
    expect(단추().style.top).toBe("calc(0.5rem + env(safe-area-inset-top))");
    expect(단추().style.left).toBe("calc(0.5rem + env(safe-area-inset-left))");
    fireEvent.click(단추());
    expect(screen.getByTestId("지금").textContent).toBe("/");
  });

  it("이용약관·개인정보처리방침 — 글 위 왼쪽", () => {
    for (const [화면, 제목] of [[<Terms key="t" />, "이용약관"], [<Privacy key="p" />, "개인정보처리방침"]] as const) {
      const { unmount } = 그리기(["/register", "/terms"], 화면);
      expect(screen.getByRole("heading", { name: 제목 })).toBeInTheDocument();
      expect(screen.queryByText(/뒤로가기/)).toBeNull();
      fireEvent.click(단추());
      expect(screen.getByTestId("지금").textContent).toBe("/register");
      unmount();
    }
  });
});
