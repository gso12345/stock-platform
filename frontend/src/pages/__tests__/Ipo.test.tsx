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
  parts: { neighbors_ratio: 1.5, regression_ratio: 1.58, correction_pct: 12 },
  method: { key: "fast_fix", name: "빠른 분위기 + 최근 오차 보정" },
};

const 한눈에 = {
  as_of: "2026-10-09T14:30:12+09:00",
  upcoming: [
    { name: "에이비씨바이오", code: null, market: null, kind: "normal", forecast_date: "2026-10-01",
      band_low: 11000, band_high: 13000, offer_price: 12000, offer_amount: 18000, inst_ratio: 1234.5,
      lockup_pct: 45.6, sub_start: "2026-10-13", sub_end: "2026-10-14", sub_ratio: 1500.2,
      list_date: null, underwriter: "미래에셋증권", stage: "청약 완료", prediction: 예측결과,
      float_pct: 35.2, equal_shares: 1.534, sub_accounts: 152_345, prop_ratio: 2469.12, old_pct: 20 },
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
                    used: ["기관경쟁률", "의무보유확약"],
                    parts: { ...예측결과.parts, correction_pct: -8 } } },
  ],
  // 첫 줄은 크게 빗나갔다(15,000원 ÷ 11,000원 = +36%). 나머지는 14,000원으로 봤는데
  // 뒤로 갈수록 실제가 올라 ±10% 를 넘는다
  recent: Array.from({ length: 10 }, (_, i) => {
    const 예측가 = i === 0 ? 11_000 : 14_000;
    const 차이 = Math.round(((15000 + i * 100) / 예측가 - 1) * 100);
    return {
      name: `지난종목${i}`, code: i === 0 ? "999990" : null, list_date: "2026-09-2" + (i % 9),
      offer_price: 10000, open_price: 15000 + i * 100, actual_ratio: 1.5 + i / 100,
      pred_ratio: 예측가 / 10000, pred_price: 예측가, diff_pct: 차이, hit: Math.abs(차이) <= 10,
    };
  }),
  accuracy: {
    n: 60, hit_band_pct: 10, median_abs_diff_pct: 18, direction_hit: 0.82, hit_rate: 0.43,
    method: { key: "fast_fix", name: "빠른 분위기 + 최근 오차 보정", pick_window: 40 },
    methods: [
      { key: "base", name: "기본", hit_rate: 0.33, median_abs_diff_pct: 18 },
      { key: "fast", name: "빠른 분위기", hit_rate: 0.37, median_abs_diff_pct: 16 },
      { key: "base_fix", name: "기본 + 최근 오차 보정", hit_rate: 0.4, median_abs_diff_pct: 15 },
      { key: "fast_fix", name: "빠른 분위기 + 최근 오차 보정", hit_rate: 0.45, median_abs_diff_pct: 13 },
    ],
  },
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

  // "균등수량, 경쟁률, 비례경쟁률, 상장일 유통물량 등을 넣으면 어때?" — 상세 페이지에서 읽은 값은
  // 카드에도 보인다. 못 읽은 카드에는 빈 칸('—')을 늘어놓지 않는다
  it("상세 페이지에서 읽은 유통물량·균등 배정·비례 경쟁률을 보여 준다 — 읽은 카드에만", async () => {
    그리기();
    const 카드 = (await screen.findByText("에이비씨바이오")).closest("div.bg-bg-card") as HTMLElement;
    expect(카드).toHaveTextContent("유통물량?35.2%");
    expect(카드).toHaveTextContent("균등배정?1.53주");
    expect(카드).toHaveTextContent("비례경쟁률?2,469:1");
    for (const 이름 of ["유통물량", "균등배정", "비례경쟁률"]) {
      expect(within(카드).getByRole("button", { name: `${이름} 설명` })).toBeInTheDocument();
    }
    const 없음 = screen.getByText("청약전로보틱스").closest("div.bg-bg-card") as HTMLElement;
    expect(없음).not.toHaveTextContent(/유통물량|균등배정|비례경쟁률/);
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

  // "너무 낮은데 예측률이" — 요즘 분위기를 따라가려고 예상값을 옮겼으면 점이 범위(비슷했던
  // 공모주가 실제로 시작한 값) 밖에 찍힐 수 있다. 왜 그런지 그 자리에 적는다
  it("요즘 오차를 보정했으면 어느 쪽으로 얼마나 옮겼는지와 방식을 적는다", async () => {
    그리기();
    const 올림 = (await screen.findByText("에이비씨바이오")).closest("div.bg-bg-card") as HTMLElement;
    expect(올림).toHaveTextContent("요즘 공모주가 예측보다 높게 시작하고 있어서 예상을 12% 올려 잡았어요.");
    expect(올림).toHaveTextContent("방식 빠른 분위기 + 최근 오차 보정");
    const 내림 = screen.getByText("청약전로보틱스").closest("div.bg-bg-card") as HTMLElement;
    expect(내림).toHaveTextContent("요즘 공모주가 예측보다 낮게 시작하고 있어서 예상을 8% 내려 잡았어요.");
  });

  it("보정하지 않았거나 예전 서버면 보정 글을 쓰지 않는다", async () => {
    const 기본부분 = { neighbors_ratio: 1.5, regression_ratio: 1.58 };
    overview.mockResolvedValue({
      ...한눈에,
      upcoming: [
        { ...한눈에.upcoming[0], prediction: { ...예측결과, parts: { ...기본부분, correction_pct: 0 } } },
        { ...한눈에.upcoming[2], prediction: { ...예측결과, parts: 기본부분, method: undefined } },
      ],
    });
    그리기();
    expect(await screen.findByText("에이비씨바이오")).toBeInTheDocument();
    expect(screen.queryByText(/잡았어요/)).toBeNull();
    const 예전 = screen.getByText("청약전로보틱스").closest("div.bg-bg-card") as HTMLElement;
    expect(예전).not.toHaveTextContent("· 방식");
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });

  it("언제 자료인지와 원천을 적는다", async () => {
    그리기();
    expect(await screen.findByText("10.9 14:30 기준")).toBeInTheDocument();
    expect(screen.getByText(/자료: 38커뮤니케이션.*10\.9 14:30 기준/)).toBeInTheDocument();
  });
});

describe("공모주 — 최근 상장", () => {
  // "270% 300%는 30%p차이가 나는데도 거의 비슷하게 맞췄다고 할 수 있어" — %p 가 아니라
  // 시초가 값으로 견주고, 줄마다 예측가와 몇 % 차이였는지 적는다
  it("V·X 의 기준(예측가 ±10%)을 적고, 줄마다 예측가와의 차이를 보여 준다", async () => {
    그리기();
    const 범례 = await screen.findByText(/실제 시초가가 예측가의 ±10% 안/, { selector: "p" });
    expect(범례).toHaveTextContent(/값으로 견줘요/);
    const 줄 = screen.getByRole("link", { name: "지난종목0" }).closest("li") as HTMLElement;
    expect(줄).toHaveTextContent("실제 15,000원");
    expect(줄).toHaveTextContent("예측 11,000원");
    expect(줄).toHaveTextContent("예측 대비 +36%");
    expect(within(줄).getByLabelText("실제가 예측가의 ±10% 밖").querySelector(".lucide-x")).not.toBeNull();
    const 둘째 = screen.getByText("지난종목1").closest("li") as HTMLElement;
    expect(둘째).toHaveTextContent("예측 대비 +8%");
    expect(within(둘째).getByLabelText("실제가 예측가의 ±10% 안").querySelector(".lucide-check")).not.toBeNull();
  });

  it("예측과 실제, 정확도를 보여 주고 더 보기로 펼친다", async () => {
    const 사용자 = userEvent.setup();
    그리기();
    expect(await screen.findByText("±18%")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("±10% 안 맞힘")).toBeInTheDocument();
    expect(screen.getByText("43%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "지난종목0" })).toHaveAttribute("href", "/stocks/KR/999990");
    expect(screen.queryByText("지난종목9")).toBeNull();
    await 사용자.click(screen.getByRole("button", { name: "2곳 더 보기" }));
    expect(screen.getByText("지난종목9")).toBeInTheDocument();
  });

  it("예전 서버(범위 기준)가 답해도 'undefined' 를 찍지 않는다 — 프런트가 먼저 올라간 배포 사이", async () => {
    overview.mockResolvedValue({
      ...한눈에,
      recent: 한눈에.recent.map((r) => ({
        name: r.name, code: r.code, list_date: r.list_date, offer_price: r.offer_price,
        open_price: r.open_price, actual_ratio: r.actual_ratio, pred_ratio: r.pred_ratio,
        low_ratio: 1.2, high_ratio: 1.8, in_range: true,
      })),
      accuracy: { n: 60, median_abs_err_pp: 31.2, direction_hit: 0.82, range_hit: 0.47 },
    });
    그리기();
    expect(await screen.findByText("에이비씨바이오")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /최근 상장/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });

  it("지금 쓰는 방식을 적고, 방식별 성적을 펼쳐 볼 수 있다", async () => {
    const 사용자 = userEvent.setup();
    그리기();
    const 줄 = await screen.findByText(/지금은.*방식으로 예측해요/);
    expect(줄).toHaveTextContent("지금은 빠른 분위기 + 최근 오차 보정 방식으로 예측해요 — 직전 40곳에서 가장 잘 맞았어요.");
    expect(screen.queryByRole("table")).toBeNull();
    await 사용자.click(screen.getByRole("button", { name: "방식별로 보기" }));
    const 줄들 = within(screen.getByRole("table")).getAllByRole("row");
    expect(줄들.map((r) => r.textContent)).toEqual([
      "방식±10% 안 맞힘보통 차이",
      "기본33%±18%",
      "빠른 분위기37%±16%",
      "기본 + 최근 오차 보정40%±15%",
      "빠른 분위기 + 최근 오차 보정45%±13%",
    ]);
    expect(줄들[4]).toHaveClass("font-semibold");       // 지금 쓰는 방식
    expect(줄들[1]).not.toHaveClass("font-semibold");
    expect(screen.getByText(/답을 보고 고르지 않으려고/)).toBeInTheDocument();
    await 사용자.click(screen.getByRole("button", { name: "접기" }));
    expect(screen.queryByRole("table")).toBeNull();
    // '어떻게 예측하나요?' 에도 같은 이야기를 적는다
    expect(screen.getByText(/여덟 방식을 모두 지난 공모주에 맞혀 봐요/)).toHaveTextContent("직전 40곳에서 가장 잘 맞아 온 방식");
  });

  it("바로 전 서버(방식 정보 없음)면 방식 줄 없이 그린다", async () => {
    overview.mockResolvedValue({
      ...한눈에,
      accuracy: { n: 60, hit_band_pct: 10, median_abs_diff_pct: 18, direction_hit: 0.82, hit_rate: 0.43 },
    });
    그리기();
    expect(await screen.findByRole("heading", { name: /최근 상장/ })).toBeInTheDocument();
    expect(screen.queryByText(/지금은.*방식으로 예측해요/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });

  it("맞혀 본 공모주가 아직 없으면 빈 칸을 그리지 않는다", async () => {
    overview.mockResolvedValue({
      ...한눈에, recent: [],
      accuracy: { n: 0, hit_band_pct: 10, median_abs_diff_pct: null, direction_hit: null, hit_rate: null },
    });
    그리기();
    expect(await screen.findByText("에이비씨바이오")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /최근 상장/ })).toBeNull();
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

  // 카드가 상세 항목(유통물량 등)까지 견줬으면 계산기도 같은 값으로 맞혀야 같은 답이 나온다
  it("카드의 유통물량·균등 배정·구주매출도 채워 같이 보낸다", async () => {
    const 사용자 = userEvent.setup();
    그리기();
    const 카드 = (await screen.findByText("에이비씨바이오")).closest("div.bg-bg-card") as HTMLElement;
    await 사용자.click(within(카드).getByRole("button", { name: "이 숫자로 직접 바꿔 보기" }));
    expect(screen.getByLabelText(/유통물량/, { selector: "input" })).toHaveValue("35.2");
    expect(screen.getByLabelText(/균등배정/, { selector: "input" })).toHaveValue("1.53");
    expect(screen.getByLabelText(/구주매출/)).toHaveValue("20");
    await 사용자.click(screen.getByRole("button", { name: "예측하기" }));
    expect(predict.mock.calls[0][0]).toMatchObject({ float_pct: 35.2, equal_shares: 1.53, old_pct: 20 });
  });

  it("상세 항목은 비워 두면 없이 보내고, 틀리게 넣으면 그 자리에서 알려 준다", async () => {
    const 사용자 = userEvent.setup();
    그리기();
    await 사용자.type(await screen.findByLabelText(/확정 공모가/), "10000");
    await 사용자.type(screen.getByLabelText(/기관경쟁률/, { selector: "input" }), "100");
    await 사용자.type(screen.getByLabelText(/의무보유확약/, { selector: "input" }), "10");
    await 사용자.click(screen.getByRole("button", { name: "예측하기" }));
    expect(predict.mock.calls[0][0]).toMatchObject({ float_pct: null, equal_shares: null, old_pct: null });
    predict.mockClear();
    await 사용자.type(screen.getByLabelText(/유통물량/, { selector: "input" }), "0");
    await 사용자.type(screen.getByLabelText(/균등배정/, { selector: "input" }), "-1");
    await 사용자.type(screen.getByLabelText(/구주매출/), "120");
    await 사용자.click(screen.getByRole("button", { name: "예측하기" }));
    expect(screen.getAllByText("0~100% 사이로 넣어 주세요")).toHaveLength(2);
    expect(screen.getByText("0보다 작을 수 없어요")).toBeInTheDocument();
    expect(predict).not.toHaveBeenCalled();
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
    expect(screen.getByText("±18%")).toBeInTheDocument();
  });
});

describe("공모주 — 메뉴", () => {
  it("더보기와 PC 메뉴에 있다", () => {
    expect(더보기_메뉴.some((m) => m.to === "/ipo" && m.label === "공모주")).toBe(true);
    expect(더보기_경로).toContain("/ipo");
    expect(Layout원문).toMatch(/to: "\/ipo",\s+icon: Rocket,\s+label: "공모주"/);
  });
});
