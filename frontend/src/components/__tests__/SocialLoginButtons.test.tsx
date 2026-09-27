/**
 * 소셜 로그인 버튼 — 서버가 켜졌다고 한 것만 진짜 링크로 만든다.
 * 나머지는 누르면 '준비중' 이라고 말한다(오류 화면으로 보내지 않는다).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/* vi.fn 으로 거절을 흉내 내면 vitest 가 결과를 기록하느라 붙인 사슬에서
   거절이 새어 나와 실패로 잡힌다 — 그래서 평범한 함수로 바꿔 끼운다 */
let 응답: () => Promise<any> = () => Promise.resolve({ data: { providers: [] } });
const get = { mockResolvedValue: (v: any) => { 응답 = () => Promise.resolve(v); } };
vi.mock("@/api/client", async (원본) => ({
  ...(await 원본<any>()),
  default: { get: () => 응답() },
}));

import SocialLoginButtons from "../SocialLoginButtons";
import { API_BASE } from "@/api/client";

beforeEach(() => { 응답 = () => Promise.resolve({ data: { providers: [] } }); });

describe("소셜 로그인 버튼", () => {
  it("켜진 공급자는 서버의 로그인 시작 주소로 가는 링크다", async () => {
    get.mockResolvedValue({ data: { providers: ["kakao"] } });
    render(<SocialLoginButtons />);
    const 링크 = await screen.findByRole("link", { name: /카카오/ });
    expect(링크.getAttribute("href")).toBe(`${API_BASE}/auth/oauth/kakao/login`);
    // 안 켜진 것은 링크가 아니다
    expect(screen.queryByRole("link", { name: /Google/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Google/ })).toBeTruthy();
  });

  it("안 켜진 것을 누르면 준비중이라고 말한다", async () => {
    get.mockResolvedValue({ data: { providers: [] } });
    render(<SocialLoginButtons />);
    fireEvent.click(screen.getByRole("button", { name: /네이버/ }));
    expect(screen.getByText(/준비중/)).toBeTruthy();
  });

  it("서버에 못 물으면 전부 준비중으로 둔다", async () => {
    응답 = () => Promise.reject(new Error("x"));
    render(<SocialLoginButtons />);
    await Promise.resolve();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
