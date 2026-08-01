/**
 * 토큰이 만료돼 로그인 화면으로 밀려왔을 때 이유를 알려준다.
 *
 * 이유를 안 적으면 '왜 갑자기 로그인 화면이지?' 가 되고, 관심종목이
 * 비어 보이는 것과 겹치면 '데이터가 사라졌다'로 읽힌다. 실제로 그렇게
 * 오해한 적이 있어서, 안내 문구가 있다는 것을 못 박아 둔다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel: any) => sel({ login: vi.fn(), isLoggedIn: false }),
}));

import Login from "../Login";

const 열기 = (query: string) =>
  render(<MemoryRouter initialEntries={[`/login${query}`]}><Login /></MemoryRouter>);

describe("로그인 화면 — 만료 안내", () => {
  it("만료로 밀려오면 이유와 함께 데이터가 남아 있다고 알려준다", () => {
    열기("?reason=expired");
    const 문구 = screen.getByText(/만료/);
    expect(문구).toBeInTheDocument();
    // '데이터가 사라진 게 아니다'가 이 문구의 핵심이다
    expect(문구.textContent).toMatch(/그대로/);
  });

  it("그냥 로그인하러 온 사람에게는 경고를 띄우지 않는다", () => {
    열기("");
    expect(screen.queryByText(/만료/)).not.toBeInTheDocument();
  });

  it("소셜 로그인 실패 메시지는 그대로 나온다", () => {
    열기("?oauth_error=denied");
    expect(screen.getByText(/취소되었습니다/)).toBeInTheDocument();
  });
});
