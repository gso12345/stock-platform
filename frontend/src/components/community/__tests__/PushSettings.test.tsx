/**
 * 알림 화면의 '휴대폰 알림' 칸 — 못 받으면 왜 못 받는지와 어떻게 풀지를 말한다.
 * 단추만 회색으로 두면 고장 난 줄 안다.
 *
 * 공모주 청약 알림을 받을 증권사도 여기서 바로 고른다(사용자: "알림설정에서 그냥 어떤 증권사만 알림이
 * 오게할지 설정할 수 있도록 해줘"). 공모주 메뉴의 증권사 칩(목록 거르기)과는 따로다 — "공모주메뉴에서 …
 * 선택하는 건 그냥 선택한 공모주일정을 보고 싶을 뿐 … 내 증권사라는 것이 아니"
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSettingsStore } from "@/store/settingsStore";
import { 자주주관하는증권사 } from "@/components/ipo/ipoBrokers";

const 훅 = {
  상태: "꺼짐" as string, 처리중: false, 오류: null as string | null, 공모주: true,
  켜기: vi.fn(), 끄기: vi.fn(), 공모주바꾸기: vi.fn(), 시험: vi.fn(),
};
vi.mock("@/hooks/useWebPush", () => ({ useWebPush: () => 훅 }));
const 증권사목록 = vi.hoisted(() => vi.fn());
vi.mock("@/api/stocks", async (원본) => ({ ...(await 원본<any>()), ipoApi: { brokers: 증권사목록 } }));

import PushSettings, { 처음보일증권사 } from "../PushSettings";

/** 서버가 주는 순서(많이 맡은 순) — 열두 곳 */
const 열두곳 = ["한국투자증권", "NH투자증권", "미래에셋증권", "KB증권", "삼성증권", "신한투자증권", "대신증권",
  "하나증권", "키움증권", "유안타증권", "교보증권", "신영증권"];

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PushSettings /></QueryClientProvider>);
}
const 칩칸 = () => screen.getByRole("group", { name: "알림 받을 증권사" });
const 칩이름들 = () => within(칩칸()).queryAllByRole("button").map((b) => b.textContent).filter((t) => !/더 보기/.test(t ?? ""));

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(훅, { 상태: "꺼짐", 처리중: false, 오류: null, 공모주: true });
  useSettingsStore.getState().set알림증권사([]);
  useSettingsStore.getState().set공모주증권사([]);
  증권사목록.mockResolvedValue(열두곳.map((name, i) => ({ name, count: 30 - i })));
});

describe("휴대폰 알림 칸", () => {
  it("꺼져 있으면 켜기 단추와 무엇을 받는지 — 켜면 증권사도 고를 수 있다고", async () => {
    그리기();
    expect(screen.getByRole("heading", { name: "휴대폰 알림" })).toBeInTheDocument();
    expect(screen.getByText(/앱을 닫아도 가격 알림·내 글의 댓글·공모주 청약일/))
      .toHaveTextContent("켜면 공모주 청약 알림을 받을 증권사도 고를 수 있어요.");
    expect(screen.queryByRole("group", { name: "알림 받을 증권사" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "켜기" }));
    expect(훅.켜기).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "끄기" })).toBeNull();
  });

  it("켜는 동안에는 두 번 못 누른다", () => {
    훅.처리중 = true;
    그리기();
    expect(screen.getByRole("button", { name: "켜는 중…" })).toBeDisabled();
  });

  it.each([
    ["설치필요", /아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요/],
    ["막힘", /알림을 막아 두셨어요/],
    ["안됨", /이 브라우저는 휴대폰 알림을 받을 수 없어요/],
  ])("%s — 왜 못 받는지와 어떻게 풀지", (상태, 글) => {
    훅.상태 = 상태;
    그리기();
    expect(screen.getByText(글)).not.toHaveTextContent("켜면 공모주");
    expect(screen.queryByRole("button", { name: "켜기" })).toBeNull();
  });

  it("켜져 있으면 끄기·시험 알림·공모주 아침 알림", async () => {
    훅.상태 = "켜짐";
    훅.시험.mockResolvedValue(true);
    useSettingsStore.getState().set알림증권사(["키움증권", "KB증권"]);
    그리기();
    expect(screen.getByText("이 기기에서 받는 중")).toBeInTheDocument();
    expect(screen.getByText("고른 증권사 2곳이 주관하는 공모주만")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /공모주 청약 첫날·마지막 날 아침 8:30~9:00 에 알림/ }));
    expect(훅.공모주바꾸기).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: "시험 알림 보내기" }));
    expect(await screen.findByRole("status")).toHaveTextContent("보냈어요");
    await userEvent.click(screen.getByRole("button", { name: "끄기" }));
    expect(훅.끄기).toHaveBeenCalled();
  });

  it("증권사를 안 골랐으면 모든 공모주라고 말한다", () => {
    훅.상태 = "켜짐";
    그리기();
    expect(screen.getByText(/모든 공모주 — 아래에서 증권사를 고르면 그 증권사 것만/)).toBeInTheDocument();
  });

  it("실패하면 이유를 보인다", () => {
    훅.오류 = "알림을 켜지 못했어요. 잠시 뒤 다시 눌러 주세요.";
    그리기();
    expect(screen.getByRole("alert")).toHaveTextContent("켜지 못했어요");
  });
});

describe("알림 받을 증권사 — 알림 설정에서 바로 고른다", () => {
  beforeEach(() => { 훅.상태 = "켜짐"; });

  it("많이 맡은 순으로 열 곳, 나머지는 '더 보기' — 누르면 고르고 다시 누르면 뺀다(공모주 메뉴 거르기는 안 바뀐다)", async () => {
    useSettingsStore.getState().set공모주증권사(["삼성증권"]);
    그리기();
    await waitFor(() => expect(칩이름들()).toEqual(열두곳.slice(0, 처음보일증권사)));
    expect(처음보일증권사).toBe(10);
    expect(within(칩칸()).getByRole("button", { name: "+2곳 더 보기" })).toBeInTheDocument();
    await userEvent.click(within(칩칸()).getByRole("button", { name: "KB증권" }));
    expect(useSettingsStore.getState().알림증권사).toEqual(["KB증권"]);
    expect(within(칩칸()).getByRole("button", { name: "KB증권" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("고른 증권사 1곳이 주관하는 공모주만")).toBeInTheDocument();
    await userEvent.click(within(칩칸()).getByRole("button", { name: "KB증권" }));
    expect(useSettingsStore.getState().알림증권사).toEqual([]);
    expect(useSettingsStore.getState().공모주증권사).toEqual(["삼성증권"]);   // 목록 거르기는 따로
  });

  it("'더 보기' 를 누르면 모두, 골라 둔 것은 접혀 있어도 보이고 목록에 없는 것도 붙어 뺄 수 있다", async () => {
    useSettingsStore.getState().set알림증권사(["신영증권", "상상인증권"]);
    그리기();
    await waitFor(() => expect(칩이름들()).toEqual([...열두곳.slice(0, 처음보일증권사), "신영증권", "상상인증권"]));
    expect(within(칩칸()).getByRole("button", { name: "+1곳 더 보기" })).toBeInTheDocument();   // 교보증권만 남았다
    await userEvent.click(within(칩칸()).getByRole("button", { name: "+1곳 더 보기" }));
    expect(칩이름들()).toEqual([...열두곳, "상상인증권"]);
    expect(within(칩칸()).queryByRole("button", { name: /더 보기/ })).toBeNull();
    await userEvent.click(within(칩칸()).getByRole("button", { name: "상상인증권" }));
    expect(useSettingsStore.getState().알림증권사).toEqual(["신영증권"]);
  });

  it("'모두 풀기' 는 골랐을 때만 — 누르면 모든 공모주", async () => {
    그리기();
    await waitFor(() => expect(칩이름들().length).toBe(처음보일증권사));
    expect(screen.queryByRole("button", { name: "모두 풀기" })).toBeNull();
    useSettingsStore.getState().set알림증권사(["KB증권", "삼성증권"]);
    await userEvent.click(await screen.findByRole("button", { name: "모두 풀기" }));
    expect(useSettingsStore.getState().알림증권사).toEqual([]);
    expect(screen.getByText(/안 고르면 모든 공모주를 알려 드려요. 공모주 메뉴에서 목록을 거르는 증권사와는 따로예요./))
      .toBeInTheDocument();
  });

  it("받는 동안에는 골라 둔 것만 — 자주 주관하는 곳을 깔았다가 칩이 자리를 옮기지 않게", async () => {
    let 끝내기: (v: unknown) => void = () => {};
    증권사목록.mockReturnValue(new Promise((r) => { 끝내기 = r; }));
    useSettingsStore.getState().set알림증권사(["KB증권"]);
    그리기();
    expect(칩이름들()).toEqual(["KB증권"]);
    expect(within(칩칸()).queryByRole("button", { name: /더 보기/ })).toBeNull();
    끝내기(열두곳.map((name) => ({ name, count: 1 })));
    await waitFor(() => expect(칩이름들().length).toBe(처음보일증권사));
  });

  it("목록을 못 받으면 자주 주관하는 곳으로 고를 수 있고, 그렇다고 말한다", async () => {
    증권사목록.mockRejectedValue(new Error("서버가 자는 중"));
    그리기();
    // 한 번은 다시 묻는다(1초 뒤) — 서버가 막 깨는 중이면 두 번째에 받는다
    expect(await screen.findByText(/증권사 목록을 받지 못해 자주 주관하는 곳만 보여요/, {}, { timeout: 4000 }))
      .toBeInTheDocument();
    expect(증권사목록).toHaveBeenCalledTimes(2);
    expect(칩이름들()).toEqual(자주주관하는증권사.slice(0, 처음보일증권사));
  });

  it("빈 목록이 와도(공모주 기록이 아직 없을 때) 자주 주관하는 곳으로", async () => {
    증권사목록.mockResolvedValue([]);
    그리기();
    await waitFor(() => expect(칩이름들()).toEqual(자주주관하는증권사.slice(0, 처음보일증권사)));
  });

  it("공모주 알림을 끄면 증권사 칸도 없다", () => {
    훅.공모주 = false;
    그리기();
    expect(screen.queryByRole("group", { name: "알림 받을 증권사" })).toBeNull();
  });
});
