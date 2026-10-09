/**
 * 공모주 메뉴 — "공모주 상장 시가 예측할 수 있는 메뉴를 만들어줘"
 *
 * 여기서 못 박는 것 —
 *   1) 다가오는 공모주마다 예상 시초가·범위·확률이 보이고, 예측이 안 되면 왜인지 보인다
 *   2) 비슷했던 공모주를 펼쳐 볼 수 있다(무엇과 견줬는지)
 *   3) 직접 넣어 보기 — 꼭 넣을 것을 안 넣으면 그 자리에서 알려 주고, 쉼표를 넣어도 읽는다
 *   4) 카드의 숫자로 계산기를 채울 수 있다
 *   5) 자료가 없을 때 '받는 중' 과 '못 받음(이유)' 을 가른다
 *   6) 메뉴(PC·더보기)에 있다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Layout원문 from "../../components/Layout.tsx?raw";
import { 더보기_메뉴, 더보기_경로 } from "@/constants/moreNav";
import { useSettingsStore } from "@/store/settingsStore";

const 예측결과 = {
  ok: true as const, group: "normal" as const, ratio: 1.54, price: 18_480, return_pct: 54,
  range: { low_ratio: 1.3, high_ratio: 1.9, low_price: 15_600, high_price: 22_800 },
  p_double: 0.23, p_below: 0.08,
  neighbors: [
    { name: "비슷한바이오", code: "123450", list_date: "2025-03-04", ratio: 1.8, inst_ratio: 1200,
      lockup_pct: 30, sub_ratio: 1500, offer_price: 10000, open_price: 18000 },
    { name: "닮은테크", code: null, list_date: "2025-02-11", ratio: 1.2, inst_ratio: 900,
      lockup_pct: 12, sub_ratio: null, offer_price: 20000, open_price: 24000 },
  ],
  used: ["기관경쟁률", "의무보유확약", "청약경쟁률"], missing: [], n_train: 210,
  parts: { neighbors_ratio: 1.5, regression_ratio: 1.58 },
};

const 한눈에 = {
  as_of: "2026-10-09T14:30:12+09:00",
  upcoming: [
    { name: "에이비씨바이오", code: null, market: null, kind: "normal", forecast_date: "2026-10-01",
      band_low: 11000, band_high: 13000, offer_price: 12000, offer_amount: 18000, inst_ratio: 1234.5,
      lockup_pct: 45.6, sub_start: "2026-10-13", sub_end: "2026-10-14", sub_ratio: 1500.2,
      list_date: null, underwriter: "미래에셋증권", stage: "청약 완료", prediction: 예측결과 },
    { name: "예측전테크", code: null, market: null, kind: "normal", forecast_date: "2026-10-20",
      band_low: 9000, band_high: 11000, offer_price: null, offer_amount: null, inst_ratio: null,
      lockup_pct: null, sub_start: null, sub_end: null, sub_ratio: null, list_date: null,
      underwriter: null, stage: "수요예측 전",
      prediction: { ok: false as const, reason: "확정 공모가가 나오면 예측해요" } },
    { name: "청약전로보틱스", code: null, market: null, kind: "normal", forecast_date: "2026-10-05",
      band_low: 9000, band_high: 11000, offer_price: 11000, offer_amount: 9000, inst_ratio: 800,
      lockup_pct: 20, sub_start: "2026-10-15", sub_end: "2026-10-16", sub_ratio: null, list_date: null,
      underwriter: null, stage: "청약 예정",
      prediction: { ...예측결과, price: 15_000, missing: ["청약경쟁률"],
                    used: ["기관경쟁률", "의무보유확약"] } },
  ],
  recent: Array.from({ length: 10 }, (_, i) => ({
    name: `지난종목${i}`, code: i === 0 ? "999990" : null, list_date: "2026-09-2" + (i % 9),
    offer_price: 10000, open_price: 15000 + i * 100, actual_ratio: 1.5 + i / 100,
    pred_ratio: 1.4, low_ratio: 1.2, high_ratio: 1.8, in_range: i % 3 !== 0,
  })),
  accuracy: { n: 60, median_abs_err_pp: 31.2, direction_hit: 0.82, range_hit: 0.47 },
  train_since: "2023-06-26", n_records: 420, n_results: 280,
  source: { name: "38커뮤니케이션", lists: { 수요예측: { rows: 40, reason: "" } } },
  refreshing: false,
};

const overview = vi.fn();
const predict = vi.fn();
vi.mock("@/api/stocks", async (원본가져오기) => ({
  ...(await 원본가져오기<any>()),
  ipoApi: { overview: (...a: any[]) => overview(...a), predict: (...a: any[]) => predict(...a) },
}));

import Ipo from "../Ipo";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Ipo /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSettingsStore.getState().setColorScheme("red-blue");
  overview.mockReset();
  predict.mockReset();
  overview.mockResolvedValue(한눈에);
  predict.mockResolvedValue(예측결과);
  Element.prototype.scrollIntoView = vi.fn();
});

describe("공모주 — 다가오는 공모주", () => {
  it("예상 시초가·범위·확률을 보여 준다", async () => {
    그리기();
    const 카드 = (await screen.findByText("에이비씨바이오")).closest("div.bg-bg-card") as HTMLElement;
    expect(within(카드).getByTestId("예상시초가")).toHaveTextContent("18,480원");
    expect(within(카드).getByText("+54%")).toBeInTheDocument();
    expect(카드).toHaveTextContent("비슷했던 공모주 가운데 절반이 15,600원~22,800원");
    expect(카드).toHaveTextContent("23%");
    expect(카드).toHaveTextContent("8%");
    expect(카드).toHaveTextContent("1,235:1");
    expect(카드).toHaveTextContent("45.6%");
    expect(within(카드).getByText("청약 완료")).toBeInTheDocument();
    // 표준 용어 — 원천(38)은 옛 용어 '주간사' 를 쓴다
    expect(within(카드).getByText("주관사 미래에셋증권")).toBeInTheDocument();
    expect(within(카드).getByRole("img", { name: /1\.54배/ })).toBeInTheDocument();
  });

  it("청약 전이면 청약경쟁률 없이 계산했다고 알린다 — 그 카드에만", async () => {
    그리기();
    const 청약전 = (await screen.findByText("청약전로보틱스")).closest("div.bg-bg-card") as HTMLElement;
    const 청약끝 = screen.getByText("에이비씨바이오").closest("div.bg-bg-card") as HTMLElement;
    expect(청약전).toHaveTextContent("청약경쟁률 없이 계산했어요");
    expect(청약끝).not.toHaveTextContent("청약경쟁률 없이 계산했어요");
  });

  it("오르내림 색은 설정을 따른다", async () => {
    useSettingsStore.getState().setColorScheme("green-red");
    그리기();
    const 카드 = (await screen.findByText("에이비씨바이오")).closest("div.bg-bg-card") as HTMLElement;
    expect(within(카드).getByText("+54%")).toHaveClass("text-accent-green");
    useSettingsStore.getState().setColorScheme("red-blue");
  });

  it("예측이 안 되면 무엇이 나와야 하는지 적는다", async () => {
    그리기();
    const 카드 = (await screen.findByText("예측전테크")).closest("div.bg-bg-card") as HTMLElement;
    expect(카드).toHaveTextContent("확정 공모가가 나오면 예측해요");
    expect(within(카드).queryByText("이 숫자로 직접 바꿔 보기")).toBeNull();
  });

  it("비슷했던 공모주를 펼쳐 본다 — 상장한 종목은 종목 화면으로 이어진다", async () => {
    const 사용자 = userEvent.setup();
    그리기();
    const 카드 = (await screen.findByText("에이비씨바이오")).closest("div.bg-bg-card") as HTMLElement;
    await 사용자.click(within(카드).getByRole("button", { name: /비슷했던 공모주 2곳/ }));
    expect(screen.getByRole("link", { name: "비슷한바이오" })).toHaveAttribute("href", "/stocks/KR/123450");
    expect(screen.getByText("닮은테크")).toBeInTheDocument();
    expect(screen.getByText("+80%")).toBeInTheDocument();
  });

  it("언제 자료인지와 원천을 적는다", async () => {
    그리기();
    expect(await screen.findByText("10.9 14:30 기준")).toBeInTheDocument();
    expect(screen.getByText(/자료: 38커뮤니케이션.*10\.9 14:30 기준/)).toBeInTheDocument();
  });
});

describe("공모주 — 최근 상장", () => {
  it("V·X 의 기준을 적고, 줄마다 그때의 예상 범위를 보여 준다", async () => {
    그리기();
    const 범례 = await screen.findByText(/실제 시초가가 예상 범위 안/, { selector: "p" });
    expect(범례).toHaveTextContent(/범위 밖/);
    expect(범례).toHaveTextContent(/잘 맞아도 절반쯤은 밖에 나와요/);
    const 줄 = screen.getByRole("link", { name: "지난종목0" }).closest("li") as HTMLElement;
    expect(줄).toHaveTextContent("범위 +20%~+80%");
    expect(within(줄).getByLabelText("실제가 예상 범위 밖")).toBeInTheDocument();
    const 둘째 = screen.getByText("지난종목1").closest("li") as HTMLElement;
    expect(within(둘째).getByLabelText("실제가 예상 범위 안")).toBeInTheDocument();
  });

  it("예측과 실제, 정확도를 보여 주고 더 보기로 펼친다", async () => {
    const 사용자 = userEvent.setup();
    그리기();
    expect(await screen.findByText("±31.2%p")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("47%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "지난종목0" })).toHaveAttribute("href", "/stocks/KR/999990");
    expect(screen.queryByText("지난종목9")).toBeNull();
    await 사용자.click(screen.getByRole("button", { name: "2곳 더 보기" }));
    expect(screen.getByText("지난종목9")).toBeInTheDocument();
  });
});

describe("공모주 — 직접 넣어 보기", () => {
  it("꼭 넣을 것을 비우면 그 자리에서 알려 주고 보내지 않는다", async () => {
    const 사용자 = userEvent.setup();
    그리기();
    await 사용자.click(await screen.findByRole("button", { name: "예측하기" }));
    expect(screen.getByText("확정 공모가를 넣어 주세요")).toBeInTheDocument();
    expect(screen.getByText("기관경쟁률을 넣어 주세요")).toBeInTheDocument();
    expect(predict).not.toHaveBeenCalled();
  });

  it("쉼표를 넣어도 읽고, 고른 종류와 함께 보낸다", async () => {
    const 사용자 = userEvent.setup();
    그리기();
    await 사용자.type(await screen.findByLabelText(/확정 공모가/), "15,000");
    await 사용자.type(screen.getByLabelText(/기관경쟁률/, { selector: "input" }), "1,234.5");
    await 사용자.type(screen.getByLabelText(/의무보유확약/, { selector: "input" }), "40");
    await 사용자.type(screen.getByLabelText(/공모금액/), "250");
    await 사용자.click(screen.getByRole("button", { name: "스팩" }));
    await 사용자.click(screen.getByRole("button", { name: "예측하기" }));
    expect(predict).toHaveBeenCalledWith(expect.objectContaining({
      offer_price: 15000, inst_ratio: 1234.5, lockup_pct: 40, offer_amount_eok: 250,
      sub_ratio: null, kind: "spac",
    }));
    const 계산기 = screen.getByRole("heading", { name: "직접 넣어 보기" }).closest("div.bg-bg-card") as HTMLElement;
    expect(await within(계산기).findByTestId("예상시초가")).toHaveTextContent("18,480원");
  });

  it("확약은 0~100% 사이여야 한다", async () => {
    const 사용자 = userEvent.setup();
    그리기();
    await 사용자.type(await screen.findByLabelText(/확정 공모가/), "10000");
    await 사용자.type(screen.getByLabelText(/기관경쟁률/, { selector: "input" }), "100");
    await 사용자.type(screen.getByLabelText(/의무보유확약/, { selector: "input" }), "120");
    await 사용자.click(screen.getByRole("button", { name: "예측하기" }));
    expect(screen.getByText("0~100% 사이로 넣어 주세요")).toBeInTheDocument();
    expect(predict).not.toHaveBeenCalled();
  });

  it("희망공모가는 상단만 받는다 — 예측에 하단은 안 쓰인다", async () => {
    const 사용자 = userEvent.setup();
    그리기();
    expect(await screen.findByLabelText(/희망공모가 상단/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/희망공모가 하단/)).toBeNull();
    const 카드 = screen.getByText("에이비씨바이오").closest("div.bg-bg-card") as HTMLElement;
    await 사용자.click(within(카드).getByRole("button", { name: "이 숫자로 직접 바꿔 보기" }));
    await 사용자.click(screen.getByRole("button", { name: "예측하기" }));
    expect(predict.mock.calls[0][0]).toMatchObject({ band_high: 13000 });
    expect(predict.mock.calls[0][0]).not.toHaveProperty("band_low");
  });

  it("카드의 숫자로 계산기를 채운다", async () => {
    const 사용자 = userEvent.setup();
    그리기();
    const 카드 = (await screen.findByText("에이비씨바이오")).closest("div.bg-bg-card") as HTMLElement;
    await 사용자.click(within(카드).getByRole("button", { name: "이 숫자로 직접 바꿔 보기" }));
    expect(screen.getByLabelText(/확정 공모가/)).toHaveValue("12000");
    expect(screen.getByLabelText(/기관경쟁률/, { selector: "input" })).toHaveValue("1234.5");
    expect(screen.getByLabelText(/공모금액/)).toHaveValue("180");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

describe("공모주 — 자료가 없을 때", () => {
  it("처음 받는 중이면 그렇다고 말한다", async () => {
    overview.mockResolvedValue({ ...한눈에, n_records: 0, upcoming: [], recent: [], refreshing: true });
    그리기();
    expect(await screen.findByText("공모주 자료를 처음 받는 중이에요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "예측하기" })).toBeNull();
  });

  it("못 받았으면 어디서 왜 못 받았는지 적는다", async () => {
    overview.mockResolvedValue({
      ...한눈에, n_records: 0, upcoming: [], recent: [], refreshing: false,
      source: { name: "38커뮤니케이션", lists: { 수요예측: { rows: 0, reason: "HTTP 403" } } },
    });
    그리기();
    expect(await screen.findByText("공모주 자료를 아직 못 받았어요")).toBeInTheDocument();
    expect(screen.getByText(/수요예측: HTTP 403/)).toBeInTheDocument();
  });

  it("진행 중인 공모주가 없어도 계산기와 지난 결과는 보인다", async () => {
    overview.mockResolvedValue({ ...한눈에, upcoming: [] });
    그리기();
    expect(await screen.findByText("지금 진행 중인 공모주가 없어요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "예측하기" })).toBeInTheDocument();
    expect(screen.getByText("±31.2%p")).toBeInTheDocument();
  });
});

describe("공모주 — 메뉴", () => {
  it("더보기와 PC 메뉴에 있다", () => {
    expect(더보기_메뉴.some((m) => m.to === "/ipo" && m.label === "공모주")).toBe(true);
    expect(더보기_경로).toContain("/ipo");
    expect(Layout원문).toMatch(/to: "\/ipo",\s+icon: Rocket,\s+label: "공모주"/);
  });
});
