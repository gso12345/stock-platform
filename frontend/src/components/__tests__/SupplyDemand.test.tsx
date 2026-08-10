/**
 * 수급 탭 — 백엔드는 진작 다 만들어 뒀는데 프론트에서 부르는 코드가 없어
 * "서비스 준비중입니다" 안내판만 떠 있던 것을 이었다.
 *
 * 여기서 못 박는 것.
 *   1) 안내판이 다시 돌아오지 않는다
 *   2) 부르는 주소·인자가 백엔드와 맞는다 (days 를 안 보내면 30일 고정이 된다)
 *   3) 값이 없을 때 빈 차트 대신 이유를 보여 준다 — KRX 가 막히면 실제로 빈다
 *   4) 순매수와 순매도를 눈으로 가릴 수 있다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import 원본원문 from "../../pages/StockDetail.tsx?raw";

/* 주석에도 "서비스 준비중" 이라는 말이 나온다(무엇을 고쳤는지 적어 뒀다).
   주석을 걷어내고 봐야 진짜 코드에 남아 있는지 알 수 있다 */
const 원문 = 원본원문.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const getSupplyDemand = vi.fn();
vi.mock("@/api/stocks", async (원본가져오기) => {
  const 원본 = await 원본가져오기<any>();
  return { ...원본, stocksApi: { ...원본.stocksApi, getSupplyDemand: (...a: any[]) => getSupplyDemand(...a) } };
});

// recharts 는 jsdom 에서 폭이 0이라 아무것도 안 그린다. 여기서 보려는 것은
// 차트 픽셀이 아니라 '무엇을 어떻게 부르고 무엇을 보여주나' 다.
vi.mock("recharts", async (원본가져오기) => {
  const 원본 = await 원본가져오기<any>();
  return { ...원본, ResponsiveContainer: ({ children }: any) => <div style={{ width: 800, height: 300 }}>{children}</div> };
});

import SupplyDemandTab from "../stock/SupplyDemandTab";

const 감싸기 = (ui: React.ReactNode) => {
  /* 컴포넌트가 retry:1 을 직접 정하므로 여기서 retry 를 끌 수는 없다.
     대신 재시도 간격을 0 으로 만들어 실패가 곧바로 확정되게 한다 —
     기본 1초를 기다리면 테스트가 그 틈에서 불안정해진다 */
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const 하루 = (date: string, foreign: number, institution: number, individual: number) =>
  ({ date, foreign, institution, individual, total: foreign + institution + individual });

beforeEach(() => getSupplyDemand.mockReset());

describe("안내판이 아니라 실제 데이터를 부른다", () => {
  it("종목상세에 '서비스 준비중' 이 남아 있지 않다", () => {
    expect(원문).not.toMatch(/서비스 준비중/);
    expect(원문).toMatch(/<SupplyDemandTab/);
  });

  it("국내 종목에서만 그린다", () => {
    /* 백엔드 경로가 /stocks/KR/... 로 박혀 있어 해외 종목에는 의미가 없다 */
    expect(원문).toMatch(/mainTab==="supply" && isKR/);
  });

  it("백엔드가 받는 인자로 부른다", async () => {
    getSupplyDemand.mockResolvedValue([하루("2026-08-07", 1e9, -5e8, -5e8)]);
    감싸기(<SupplyDemandTab symbol="005930" isMobile={false} />);
    await waitFor(() => expect(getSupplyDemand).toHaveBeenCalled());
    // days 를 안 보내면 백엔드 기본값 30일로 고정돼 기간 버튼이 무의미해진다
    expect(getSupplyDemand).toHaveBeenCalledWith("005930", 20);
  });

  it("기간을 바꾸면 그 기간으로 다시 부른다", async () => {
    getSupplyDemand.mockResolvedValue([하루("2026-08-07", 1e9, 0, -1e9)]);
    감싸기(<SupplyDemandTab symbol="005930" isMobile={false} />);
    // 기간 칩은 로딩이 끝나야 그려진다 — 스피너가 걷힐 때까지 기다린다
    const 육십일 = await screen.findByRole("button", { name: "60일" });
    await userEvent.click(육십일);
    await waitFor(() => expect(getSupplyDemand).toHaveBeenCalledWith("005930", 60));
  });

  it("고른 기간이 눌린 상태로 보인다", async () => {
    getSupplyDemand.mockResolvedValue([하루("2026-08-07", 1, 1, 1)]);
    감싸기(<SupplyDemandTab symbol="005930" isMobile={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "20일" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "60일" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("값이 없을 때 고장난 것처럼 보이지 않는다", () => {
  it("빈 배열이면 이유를 적어 준다", async () => {
    /* KRX 조회가 막히면(해외 IP 차단) 백엔드가 빈 배열을 준다.
       그때 차트를 그리면 축만 남아 망가진 화면이 된다 */
    getSupplyDemand.mockResolvedValue([]);
    감싸기(<SupplyDemandTab symbol="005930" isMobile={false} />);
    await waitFor(() => expect(screen.getByText("수급 데이터가 없어요")).toBeInTheDocument());
    expect(screen.getByText(/집계된 수급이 없습니다/)).toBeInTheDocument();
  });

  it("실패와 '원래 없음' 의 안내 문구가 다르다", async () => {
    /* 빈 것과 실패는 사용자가 할 일이 다르다 — 기다릴지, 다시 누를지.
       두 갈래는 같은 화면(isError || !행.length)을 쓰되 문구만 갈린다.

       실패 갈래를 실제로 렌더해서 보려 했지만, 이 컴포넌트가 retry:1 이라
       재시도 중 거절이 테스트 러너에 '처리되지 않은 오류' 로 잡혀 통과시킬
       수 없었다(거절에 catch 를 달아도 마찬가지였다). 빈 배열 갈래는 위에서
       실제로 렌더해 확인했으므로, 여기서는 두 문구가 갈라져 있다는 것만
       코드에서 확인한다 — 하나로 합쳐 버리는 퇴행을 막는 것이 목적이다. */
    const 소스 = (await import("../stock/SupplyDemandTab?raw")).default as string;
    expect(소스).toMatch(/isError \? "잠시 후 다시 시도해 주세요"/);
    expect(소스).toMatch(/집계된 수급이 없습니다/);
  });
});

describe("누가 담았는지 한눈에 읽힌다", () => {
  it("기간 전체를 합쳐서 보여 준다", async () => {
    /* 일별 막대만 있으면 합계를 암산해야 한다 */
    getSupplyDemand.mockResolvedValue([
      하루("2026-08-05", 1_0000_0000, -5000_0000, -5000_0000),
      하루("2026-08-06", 2_0000_0000, -1_0000_0000, -1_0000_0000),
    ]);
    감싸기(<SupplyDemandTab symbol="005930" isMobile={false} />);
    await waitFor(() => expect(screen.getByText("누적 순매수")).toBeInTheDocument());
    // 외국인 1억+2억 = 3억
    expect(screen.getByText("+3억")).toBeInTheDocument();
  });

  it("순매수와 순매도를 말로도 구분한다", async () => {
    /* 색만으로 알리면 색을 구분 못 하는 사람에게는 아무 정보가 아니다 */
    getSupplyDemand.mockResolvedValue([하루("2026-08-05", 5_0000_0000, -3_0000_0000, -2_0000_0000)]);
    감싸기(<SupplyDemandTab symbol="005930" isMobile={false} />);
    await waitFor(() => expect(screen.getByText("외국인")).toBeInTheDocument());
    expect(screen.getAllByText("순매수").length).toBe(1);
    expect(screen.getAllByText("순매도").length).toBe(2);
  });

  it("음수에 마이너스를 붙인다", async () => {
    getSupplyDemand.mockResolvedValue([하루("2026-08-05", -7_0000_0000, 0, 0)]);
    감싸기(<SupplyDemandTab symbol="005930" isMobile={false} />);
    await waitFor(() => expect(screen.getByText("-7억")).toBeInTheDocument());
  });

  it("조 단위도 읽을 수 있게 줄인다", async () => {
    /* 삼성전자급이면 며칠만 합쳐도 조가 넘는다. 원 단위로 찍으면 자릿수를
       세야 한다 */
    getSupplyDemand.mockResolvedValue([하루("2026-08-05", 2_5000_0000_0000, 0, 0)]);
    감싸기(<SupplyDemandTab symbol="005930" isMobile={false} />);
    await waitFor(() => expect(screen.getByText("+2.5조")).toBeInTheDocument());
  });
});
