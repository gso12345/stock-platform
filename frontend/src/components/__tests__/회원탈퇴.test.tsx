/**
 * 회원 탈퇴 — 두 번 막고(확인 문구·비밀번호), 되면 로그아웃하고 나간다.
 * 소셜 계정은 비밀번호를 정한 적이 없으므로 묻지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

let 나: any = { id: 1, username: "me", oauth_provider: null };
const 지운요청: any[] = [];
let 지우기결과: () => Promise<any> = () => Promise.resolve({ data: {} });
vi.mock("@/api/client", async (원본) => ({
  ...(await 원본<any>()),
  default: {
    get: () => Promise.resolve({ data: 나 }),
    delete: (url: string, cfg: any) => { 지운요청.push({ url, body: cfg?.data }); return 지우기결과(); },
  },
}));
const logout = vi.fn();
vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => { const s = { logout, isLoggedIn: true }; return sel ? sel(s) : s; },
}));
const navigate = vi.fn();
vi.mock("react-router-dom", async (원본) => ({ ...(await 원본<any>()), useNavigate: () => navigate }));

import 회원탈퇴 from "../AccountWithdraw";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><회원탈퇴 /></MemoryRouter></QueryClientProvider>);
}
const 단추 = () => { const 다 = screen.getAllByRole("button", { name: "탈퇴하기" }); return 다[다.length - 1] as HTMLButtonElement; };

beforeEach(() => {
  sessionStorage.clear();
  지운요청.length = 0; logout.mockReset(); navigate.mockReset();
  나 = { id: 1, username: "me", oauth_provider: null };
  지우기결과 = () => Promise.resolve({ data: {} });
});

describe("회원 탈퇴", () => {
  it("열기 전에는 단추 하나뿐, 열면 무엇이 막히고 무엇이 남는지 먼저 알려 준다", async () => {
    그리기();
    expect(screen.queryByText(/다시 로그인할 수 없어요/)).toBeNull();
    fireEvent.click(단추());
    expect(await screen.findByText(/다시 로그인할 수 없어요/)).toBeTruthy();
    expect(screen.getByText(/기록은 지워지지 않고 남아요/)).toBeTruthy();
    expect(screen.getByText(/비공개로 바뀌어요/)).toBeTruthy();
    //: 지운다는 말이 남아 있으면 안 된다
    expect(document.body.textContent).not.toMatch(/지워져요/);
  });

  it("확인 문구와 비밀번호가 다 있어야 단추가 켜진다", async () => {
    그리기();
    fireEvent.click(단추());
    const 비번 = await screen.findByLabelText("비밀번호");
    const 문구 = screen.getByPlaceholderText("탈퇴합니다");
    expect(단추().disabled).toBe(true);
    fireEvent.change(문구, { target: { value: "탈퇴" } });
    fireEvent.change(비번, { target: { value: "pw" } });
    expect(단추().disabled).toBe(true);           // 문구가 다르다
    fireEvent.change(문구, { target: { value: "탈퇴합니다" } });
    fireEvent.change(비번, { target: { value: "" } });
    expect(단추().disabled).toBe(true);           // 비밀번호가 없다
    fireEvent.change(비번, { target: { value: "pw" } });
    expect(단추().disabled).toBe(false);
  });

  it("탈퇴하면 서버에 보내고, 로그아웃한 뒤 로그인 화면에 '완료' 를 남긴다", async () => {
    그리기();
    fireEvent.click(단추());
    fireEvent.change(await screen.findByLabelText("비밀번호"), { target: { value: "pw" } });
    fireEvent.change(screen.getByPlaceholderText("탈퇴합니다"), { target: { value: "탈퇴합니다" } });
    fireEvent.click(단추());
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(지운요청).toEqual([{ url: "/auth/me", body: { confirm: "탈퇴합니다", password: "pw" } }]);
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(sessionStorage.getItem("stkplt_withdrawn")).toBe("1");
  });

  it("소셜 계정은 비밀번호를 묻지 않고 보내지도 않는다", async () => {
    나 = { id: 2, username: "k", oauth_provider: "kakao" };
    그리기();
    fireEvent.click(단추());
    await screen.findByText(/다시 로그인할 수 없어요/);
    await waitFor(() => expect(screen.queryByLabelText("비밀번호")).toBeNull());
    fireEvent.change(screen.getByPlaceholderText("탈퇴합니다"), { target: { value: "탈퇴합니다" } });
    await waitFor(() => expect(단추().disabled).toBe(false));
    fireEvent.click(단추());
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(지운요청[0].body).toEqual({ confirm: "탈퇴합니다" });
  });

  it("서버가 거절하면 이유를 보여 주고 로그아웃하지 않는다", async () => {
    지우기결과 = () => Promise.reject({ response: { status: 400, data: { detail: "비밀번호가 맞지 않습니다" } } });
    그리기();
    fireEvent.click(단추());
    fireEvent.change(await screen.findByLabelText("비밀번호"), { target: { value: "x" } });
    fireEvent.change(screen.getByPlaceholderText("탈퇴합니다"), { target: { value: "탈퇴합니다" } });
    fireEvent.click(단추());
    expect(await screen.findByRole("alert")).toHaveTextContent("비밀번호가 맞지 않습니다");
    expect(logout).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("stkplt_withdrawn")).toBeNull();
  });
});
