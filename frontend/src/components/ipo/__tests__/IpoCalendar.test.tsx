/**
 * 공모주 일정을 내 캘린더로 — "청약 일정을 놓치지 않게".
 *
 *   · 구독: 고른 증권사가 있으면 그 증권사 공모주만 담는 주소를 준다
 *   · 카드: 청약·상장을 구글 캘린더로(끝 날짜 포함), 캘린더 파일은 그 공모주만
 *   · 날짜가 하나도 없는 공모주(수요예측 전)에는 단추를 안 붙인다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { 다가오는공모주 } from "@/api/stocks";
import { 공모주구독단추, 공모주일정단추 } from "../IpoCalendar";
import IpoCard from "../IpoCard";

const 공모주 = (덮: Partial<다가오는공모주> = {}): 다가오는공모주 => ({
  name: "에이비씨바이오", code: null, market: null, kind: "normal", forecast_date: "2026-10-01",
  band_low: 11000, band_high: 13000, offer_price: 12000, offer_amount: 18000, inst_ratio: 1234.5,
  lockup_pct: 45.6, sub_start: "2026-11-03", sub_end: "2026-11-04", sub_ratio: null,
  list_date: "2026-11-12", underwriter: "미래에셋대우(대표),키움증권", stage: "청약 예정",
  prediction: { ok: false, reason: "청약경쟁률이 나오면 예측해요" },
  ...덮,
} as 다가오는공모주);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T03:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("공모주 일정 구독", () => {
  it("아이폰은 webcal, 구글은 cid — 고른 증권사가 주소에 실린다", async () => {
    render(<공모주구독단추 증권사={["키움증권", "미래에셋증권"]} />);
    await userEvent.click(screen.getByRole("button", { name: /내 캘린더로/ }));
    const 시트 = screen.getByRole("dialog");
    expect(within(시트).getByText(/키움증권 · 미래에셋증권/)).toBeInTheDocument();
    const 아이폰 = within(시트).getByRole("link", { name: /아이폰·맥 캘린더로 구독/ });
    const 주소 = 아이폰.getAttribute("href")!;
    expect(주소.startsWith("webcal://")).toBe(true);
    expect(new URL(주소.replace("webcal://", "https://")).searchParams.get("brokers")).toBe("키움증권,미래에셋증권");
    const 구글 = within(시트).getByRole("link", { name: /구글 캘린더로 구독/ });
    const cid = new URL(구글.getAttribute("href")!).searchParams.get("cid")!;
    expect(cid).toBe(주소);
    expect(구글).toHaveAttribute("target", "_blank");
  });

  it("증권사를 안 골랐으면 전부 — 거르는 칸이 없다", async () => {
    render(<공모주구독단추 증권사={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /내 캘린더로/ }));
    const 주소 = screen.getByRole("link", { name: /아이폰·맥/ }).getAttribute("href")!;
    expect(주소).toMatch(/\/api\/v1\/ipo\/calendar\.ics$/);
    expect(screen.getByText(/증권사를 고르면 그 증권사 공모주만/)).toBeInTheDocument();
  });

  it("주소 복사 — 복사했다고 알려 준다", async () => {
    const 쓰기 = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: 쓰기 }, configurable: true });
    render(<공모주구독단추 증권사={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /내 캘린더로/ }));
    await userEvent.click(screen.getByRole("button", { name: /주소 복사/ }));
    expect(쓰기).toHaveBeenCalledWith(expect.stringMatching(/^https?:\/\/.+\/api\/v1\/ipo\/calendar\.ics$/));
    expect(await screen.findByText("복사했어요")).toBeInTheDocument();
  });
});

describe("이 공모주를 캘린더에", () => {
  it("청약은 마지막 날까지, 상장은 하루 — 구글 캘린더 주소", async () => {
    render(<공모주일정단추 공모주={공모주()} />);
    await userEvent.click(screen.getByRole("button", { name: "에이비씨바이오 일정을 캘린더에 넣기" }));
    const 청약 = new URL(screen.getByRole("link", { name: /청약 11\.3~11\.4/ }).getAttribute("href")!);
    expect(청약.searchParams.get("dates")).toBe("20261103/20261105");
    expect(청약.searchParams.get("text")).toBe("[청약] 에이비씨바이오");
    expect(청약.searchParams.get("details")).toContain("주관사 미래에셋증권 · 키움증권");
    expect(청약.searchParams.get("details")).toContain("확정 공모가 12,000원");
    const 상장 = new URL(screen.getByRole("link", { name: /상장 11\.12/ }).getAttribute("href")!);
    expect(상장.searchParams.get("dates")).toBe("20261112/20261113");
    expect(상장.searchParams.get("details")).not.toContain("주관사");
  });

  it("캘린더 파일은 그 공모주만 담은 서버 주소", async () => {
    render(<공모주일정단추 공모주={공모주()} />);
    await userEvent.click(screen.getByRole("button", { name: /일정을 캘린더에 넣기/ }));
    const 파일 = screen.getByRole("link", { name: /캘린더 파일 받기/ }).getAttribute("href")!;
    expect(new URL(파일).searchParams.get("name")).toBe("에이비씨바이오");
  });

  it("청약 마감일을 모르면 첫날 하루로", async () => {
    render(<공모주일정단추 공모주={공모주({ sub_end: null, list_date: null })} />);
    await userEvent.click(screen.getByRole("button", { name: /일정을 캘린더에 넣기/ }));
    const 청약 = new URL(screen.getByRole("link", { name: /청약 11\.3~11\.3/ }).getAttribute("href")!);
    expect(청약.searchParams.get("dates")).toBe("20261103/20261104");
    expect(screen.queryByRole("link", { name: /상장/ })).toBeNull();
  });

  it("날짜가 하나도 없으면(수요예측 전) 단추가 없다", () => {
    const { container } = render(<공모주일정단추 공모주={공모주({ sub_start: null, sub_end: null, list_date: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("카드의 일정 줄 옆에 붙는다", () => {
    render(<MemoryRouter><IpoCard 공모주={공모주()} /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "에이비씨바이오 일정을 캘린더에 넣기" })).toBeInTheDocument();
  });
});
