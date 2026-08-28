/**
 * 보유 종목 뉴스 — 한국 기사만 / 해외 기사만.
 *
 * 열 종목을 가진 사람의 목록은 두 언어가 섞여 있다. 영어를 안 읽는
 * 사람에게는 절반이 그냥 지나가는 줄이었고, 반대로 원문을 보려는
 * 사람은 한국 기사 사이에서 영어 기사를 찾아야 했다.
 *
 * 가르는 기준이 요점이다 — **종목의 시장이 아니라 기사가 나온 통**이다.
 * 엔비디아 얘기를 한국 매체가 쓰면 그건 한국 기사다. 시장으로 가르면
 * 그 기사가 '해외' 칸으로 가서, 한국 기사만 보려는 사람 눈에서 사라진다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import 보유뉴스, { 한국기사인가, 걸러내기 } from "@/components/portfolio/HoldingNews";
import type { 보유뉴스항목, 보유뉴스응답 } from "@/api/stocks";
import { portfolioApi } from "@/api/stocks";

vi.mock("@/api/stocks", () => ({ portfolioApi: { getHoldingNews: vi.fn() } }));

const 기사 = (o: Partial<보유뉴스항목> = {}): 보유뉴스항목 => ({
  title: "삼성전자, 3분기 실적 발표", link: "https://n.example/1",
  source: "연합뉴스", published: "2026/08/26 14:30", published_ts: 1,
  summary: "", image: null, symbols: ["005930"], lang: "ko", ...o,
});

const 답 = (items: 보유뉴스항목[]): 보유뉴스응답 =>
  ({ items, covered: [], pending: 0, missing: [] });

function 그리기(items: 보유뉴스항목[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><보유뉴스 미리보기={답(items)} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("한국기사인가 — 서버가 적어 준 통을 믿는다", () => {
  it("lang 이 있으면 그대로", () => {
    expect(한국기사인가({ lang: "ko", title: "Samsung beats estimates" })).toBe(true);
    expect(한국기사인가({ lang: "en", title: "삼성전자 실적" })).toBe(false);
  });

  it("해외 종목이라도 한국 매체 기사면 한국 기사다", () => {
    /* 여기가 '시장으로 가르기' 와 갈리는 자리다. 엔비디아 얘기를
       한국 매체가 쓰면 한국 기사인데, 종목 시장으로 가르면 해외로
       빠져서 한국 기사만 보려는 사람 눈에서 사라진다 */
    expect(한국기사인가({ lang: "ko", title: "엔비디아 주가 급등" })).toBe(true);
  });

  it("lang 이 없으면 제목의 한글로 되짚는다", () => {
    /* 이 칸이 생기기 전에 담긴 캐시가 서버에 남아 있다. 그동안 전부
       '해외' 로 몰면 한국 기사가 통째로 사라진다 */
    expect(한국기사인가({ title: "삼성전자 3분기 실적" })).toBe(true);
    expect(한국기사인가({ title: "Nvidia tops estimates" })).toBe(false);
    expect(한국기사인가({ title: "" })).toBe(false);
  });
});

describe("걸러내기", () => {
  const 섞임 = [기사({ lang: "ko" }), 기사({ lang: "en", link: "https://n/2" })];

  it("전체는 그대로 둔다", () => {
    expect(걸러내기(섞임, "전체")).toHaveLength(2);
  });

  it("국내 · 해외", () => {
    expect(걸러내기(섞임, "국내").map((a) => a.lang)).toEqual(["ko"]);
    expect(걸러내기(섞임, "해외").map((a) => a.lang)).toEqual(["en"]);
  });

  it("둘을 합치면 전체다 — 어느 쪽에도 안 드는 기사가 없어야 한다", () => {
    const 여럿 = [기사({ lang: "ko" }), 기사({ lang: "en", link: "https://n/2" }),
                  기사({ lang: undefined, title: "제목만 한글", link: "https://n/3" }),
                  기사({ lang: undefined, title: "English only", link: "https://n/4" })];
    expect(걸러내기(여럿, "국내").length + 걸러내기(여럿, "해외").length).toBe(여럿.length);
  });
});

describe("화면", () => {
  it("칩을 누르면 그쪽 기사만 남는다", async () => {
    그리기([기사({ lang: "ko", title: "삼성전자 실적 발표" }),
            기사({ lang: "en", title: "Nvidia tops estimates", link: "https://n/2" })]);
    expect(screen.getByText("삼성전자 실적 발표")).toBeInTheDocument();
    expect(screen.getByText("Nvidia tops estimates")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /한국 기사/ }));
    expect(screen.getByText("삼성전자 실적 발표")).toBeInTheDocument();
    expect(screen.queryByText("Nvidia tops estimates")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /해외 기사/ }));
    expect(screen.queryByText("삼성전자 실적 발표")).not.toBeInTheDocument();
    expect(screen.getByText("Nvidia tops estimates")).toBeInTheDocument();
  });

  it("건수도 고른 칸을 따라간다", async () => {
    그리기([기사({ lang: "ko" }), 기사({ lang: "ko", title: "둘째", link: "https://n/2" }),
            기사({ lang: "en", title: "Third", link: "https://n/3" })]);
    expect(screen.getByText("3건")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /해외 기사/ }));
    expect(screen.getByText("1건")).toBeInTheDocument();
  });

  it("한쪽뿐이면 칩을 아예 안 그린다", () => {
    /* 눌러 봐야 '없어요' 만 나오는 칩은 고장으로 읽힌다 */
    그리기([기사({ lang: "ko" }), 기사({ lang: "ko", title: "둘째", link: "https://n/2" })]);
    expect(screen.queryByRole("button", { name: /해외 기사/ })).not.toBeInTheDocument();
  });

  it("걸러서 빈 것과 처음부터 없는 것을 다르게 말한다", async () => {
    /* 칩으로 걸러 비었는데 '못 찾았어요' 라고 하면 칩이 한 일을 지운다 */
    그리기([기사({ lang: "ko" }), 기사({ lang: "en", title: "Only one", link: "https://n/2" })]);
    await userEvent.click(screen.getByRole("button", { name: /해외 기사/ }));
    expect(screen.queryByText(/아직 못 찾았어요/)).not.toBeInTheDocument();
  });

  it("서버를 부르는 쪽에서도 칸이 서버 요청을 새로 만들지 않는다", () => {
    /* 거르는 일은 화면에서 한다. 칩마다 왕복을 하나씩 태우면
       0.15 CPU 서버에서 그 자체가 부담이다 */
    그리기([기사({ lang: "ko" }), 기사({ lang: "en", link: "https://n/2" })]);
    expect(portfolioApi.getHoldingNews).not.toHaveBeenCalled();
  });
});
