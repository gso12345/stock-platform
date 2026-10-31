/**
 * 알림 화면의 '휴대폰 알림' 칸 — 못 받으면 왜 못 받는지와 어떻게 풀지를 말한다.
 * 단추만 회색으로 두면 고장 난 줄 안다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSettingsStore } from "@/store/settingsStore";

const 훅 = {
  상태: "꺼짐" as string, 처리중: false, 오류: null as string | null, 공모주: true,
  켜기: vi.fn(), 끄기: vi.fn(), 공모주바꾸기: vi.fn(), 시험: vi.fn(),
};
vi.mock("@/hooks/useWebPush", () => ({ useWebPush: () => 훅 }));

import PushSettings from "../PushSettings";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(훅, { 상태: "꺼짐", 처리중: false, 오류: null, 공모주: true });
  useSettingsStore.getState().set내증권사([]);
});

describe("휴대폰 알림 칸", () => {
  it("꺼져 있으면 켜기 단추와 무엇을 받는지", async () => {
    render(<PushSettings />);
    expect(screen.getByRole("heading", { name: "휴대폰 알림" })).toBeInTheDocument();
    expect(screen.getByText(/앱을 닫아도 가격 알림·내 글의 댓글·공모주 청약일/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "켜기" }));
    expect(훅.켜기).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "끄기" })).toBeNull();
  });

  it("켜는 동안에는 두 번 못 누른다", () => {
    훅.처리중 = true;
    render(<PushSettings />);
    expect(screen.getByRole("button", { name: "켜는 중…" })).toBeDisabled();
  });

  it.each([
    ["설치필요", /아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요/],
    ["막힘", /알림을 막아 두셨어요/],
    ["안됨", /이 브라우저는 휴대폰 알림을 받을 수 없어요/],
  ])("%s — 왜 못 받는지와 어떻게 풀지", (상태, 글) => {
    훅.상태 = 상태;
    render(<PushSettings />);
    expect(screen.getByText(글)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "켜기" })).toBeNull();
  });

  it("켜져 있으면 끄기·시험 알림·공모주 아침 알림", async () => {
    훅.상태 = "켜짐";
    훅.시험.mockResolvedValue(true);
    useSettingsStore.getState().set내증권사(["키움증권", "KB증권"]);
    render(<PushSettings />);
    expect(screen.getByText("이 기기에서 받는 중")).toBeInTheDocument();
    expect(screen.getByText("고른 증권사(키움증권 · KB증권)가 주관하는 공모주만")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /공모주 청약 첫날·마지막 날 아침에 알림/ }));
    expect(훅.공모주바꾸기).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: "시험 알림 보내기" }));
    expect(await screen.findByRole("status")).toHaveTextContent("보냈어요");
    await userEvent.click(screen.getByRole("button", { name: "끄기" }));
    expect(훅.끄기).toHaveBeenCalled();
  });

  it("증권사를 안 골랐으면 모든 공모주라고 말한다", () => {
    훅.상태 = "켜짐";
    render(<PushSettings />);
    expect(screen.getByText(/모든 공모주 — 공모주 메뉴에서 증권사를 고르면/)).toBeInTheDocument();
  });

  it("실패하면 이유를 보인다", () => {
    훅.오류 = "알림을 켜지 못했어요. 잠시 뒤 다시 눌러 주세요.";
    render(<PushSettings />);
    expect(screen.getByRole("alert")).toHaveTextContent("켜지 못했어요");
  });
});
