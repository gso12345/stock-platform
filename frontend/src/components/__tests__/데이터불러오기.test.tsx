/**
 * '데이터 불러오는 중' 위젯 — 어느 화면에서든 처음 불러오는 것을 항목별로.
 *
 * 예전에는 대시보드·뉴스 넷의 퍼센트 하나뿐이었고, 실패도 '끝난 것' 으로
 * 세어 조용히 사라졌다. 내 자산·퀀트·피드에서 기다릴 때는 아무것도 안 떴다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

type 약속 = { 풀기: (v: any) => void; 깨기: (e: any) => void; p: Promise<any> };
const 만들기 = (): 약속 => { let 풀기: any, 깨기: any; const p = new Promise((a, b) => { 풀기 = a; 깨기 = b; }); return { 풀기, 깨기, p }; };
let 대기: Record<string, 약속> = {};
const 부른수: Record<string, number> = {};
const 부르기 = (k: string) => { 부른수[k] = (부른수[k] ?? 0) + 1; 대기[k] = 만들기(); return 대기[k].p; };

vi.mock("@/api/stocks", () => ({
  dashboardApi: {
    getKR: () => 부르기("kr"), getUS: () => 부르기("us"),
    getNews: (m: string) => 부르기(`news-${m}`),
  },
  watchlistApi: { getItems: () => 부르기("watch"), getItemsWithCachedPrices: () => 부르기("watch") },
}));
vi.mock("@/hooks/usePortfolioItems", async () => {
  const { useQuery } = await vi.importActual<any>("@tanstack/react-query");
  return { use보유목록: (켜짐: boolean) => useQuery({ queryKey: ["portfolio-items-all"], queryFn: () => 부르기("hold"), enabled: 켜짐 }) };
});
let 로그인 = false;
vi.mock("@/store/authStore", () => ({ useAuthStore: () => ({ isLoggedIn: 로그인 }) }));
vi.mock("../Logo", () => ({ default: () => null }));
let 표시설정 = "보이기";
vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (sel: any) => sel({ 불러오기표시: 표시설정 }),
}));

/* 미리 불러오기는 한가해진 뒤에 한다. 검사에서는 그 '한가해짐' 을 손으로 —
   기본은 곧바로, 미루기 검사에서만 붙잡아 둔다 */
let 한가함붙잡기 = false;
let 한가할때_할일: (() => void) | null = null;
vi.mock("@/utils/한가할때", () => ({
  한가할때: (f: () => void) => {
    if (한가함붙잡기) 한가할때_할일 = f; else f();
    return () => {};
  },
  아껴쓰는중: () => false,
}));

import 위젯, { 라벨, 묶기, 느림기준초, 띄울때까지ms } from "../LoadingProgressOverlay";

/** 다른 화면이 데이터를 부르는 것처럼 */
function 다른화면({ 열쇠 }: { 열쇠: unknown[] }) {
  useQuery({ queryKey: 열쇠, queryFn: () => 부르기(String(열쇠[0])), retry: false });
  return null;
}

let qc: QueryClient;
function 그리기(화면열쇠: unknown[][] = []) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <위젯 />
      {화면열쇠.map((k) => <다른화면 key={JSON.stringify(k)} 열쇠={k} />)}
    </QueryClientProvider>,
  );
}
const 줄 = (이름: string) => screen.getByText(이름, { exact: true }).closest("li")!;
const 뜰때까지 = { timeout: 띄울때까지ms + 1500 };
const 기본들 = ["kr", "us", "news-kr", "news-us"];

beforeEach(() => {
  표시설정 = "보이기"; 대기 = {}; for (const k in 부른수) delete 부른수[k]; 로그인 = false;
  한가함붙잡기 = false; 한가할때_할일 = null;
});

describe("데이터 불러오기 위젯", () => {
  it("대시보드·뉴스를 항목별로 보여 준다", async () => {
    그리기();
    expect(await screen.findByText(/데이터 불러오는 중… 0\/4/, {}, 뜰때까지)).toBeTruthy();
    for (const 이름 of ["국내 시장", "미국 시장", "국내 뉴스", "해외 뉴스"]) {
      expect(줄(이름).getAttribute("data-state")).toBe("대기");
    }
    await act(async () => { 대기.kr.풀기({}); });
    await waitFor(() => expect(줄("국내 시장").getAttribute("data-state")).toBe("완료"));
    expect(screen.getByText(/1\/4/)).toBeTruthy();
  });

  it("내 자산·관심종목·퀀트·피드 등 다른 화면이 부르는 것도 뜬다", async () => {
    로그인 = true;
    그리기([["quant-compare", "a"], ["feed", "latest", 1], ["portfolios"]]);
    await screen.findByText(/데이터 불러오는 중/, {}, 뜰때까지);
    for (const 이름 of ["내 보유종목", "관심종목", "퀀트 점수 비교", "피드 글", "내 포트폴리오 목록"]) {
      expect(줄(이름).getAttribute("data-state"), 이름).toBe("대기");
    }
  });

  it("같은 종류 여러 개는 한 줄로 묶어 개수를 적는다", async () => {
    그리기([["stock-ohlcv", "A"], ["stock-ohlcv", "B"], ["stock-ohlcv", "C"]]);
    await screen.findByText(/데이터 불러오는 중/, {}, 뜰때까지);
    expect(줄("차트").textContent).toMatch(/\(3\)/);
  });

  it("금방 끝나면 아예 안 띄운다 — 번쩍이지 않게", async () => {
    const { container } = 그리기();
    await waitFor(() => expect(대기["news-us"]).toBeDefined());
    await act(async () => { for (const k of 기본들) 대기[k].풀기({}); });
    await new Promise((r) => setTimeout(r, 띄울때까지ms + 300));
    expect(container.textContent).toBe("");
  });

  it("다 되면 잠깐 뒤 사라진다", async () => {
    const { container } = 그리기();
    await screen.findByText(/데이터 불러오는 중/, {}, 뜰때까지);
    await act(async () => { for (const k of 기본들) 대기[k].풀기({}); });
    expect(await screen.findByText(/다 불러왔어요/)).toBeTruthy();
    await waitFor(() => expect(container.textContent).toBe(""), { timeout: 3000 });
  });

  it("이미 있는 데이터를 뒤에서 다시 받는 것은 띄우지 않는다", async () => {
    const { container } = 그리기();
    await waitFor(() => expect(대기["news-us"]).toBeDefined());
    await act(async () => { for (const k of 기본들) 대기[k].풀기({}); });
    await waitFor(() => expect(container.textContent).toBe(""), { timeout: 3000 });
    act(() => { qc.refetchQueries({ queryKey: ["dashboard-kr"] }); });
    await new Promise((r) => setTimeout(r, 띄울때까지ms + 400));
    expect(container.textContent).toBe("");
  });

  it("실패가 있으면 사라지지 않고, 그 항목만 다시 부를 수 있다", async () => {
    그리기();
    await waitFor(() => expect(대기["news-us"]).toBeDefined());
    await act(async () => {
      대기.kr.풀기({}); 대기.us.풀기({}); 대기["news-us"].풀기({});
      대기["news-kr"].깨기(new Error("x"));
    });
    expect(await screen.findByText(/1개를 못 불러왔어요/, {}, 뜰때까지)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1500));
    expect(screen.getByText(/1개를 못 불러왔어요/)).toBeTruthy();   // 저절로 안 닫힌다
    const 전 = { ...부른수 };
    fireEvent.click(screen.getByRole("button", { name: "국내 뉴스 다시 시도" }));
    await waitFor(() => expect(부른수["news-kr"]).toBe(전["news-kr"] + 1));
    expect(부른수.kr).toBe(전.kr);          // 성공한 것은 다시 안 부른다
  });

  it(`${느림기준초}초를 넘기면 서버가 깨는 중일 수 있다고 알려 준다`, async () => {
    const 진짜 = Date.now.bind(Date);
    const 처음 = 진짜();
    let 더할 = 0;
    const 시계 = vi.spyOn(Date, "now").mockImplementation(() => 처음 + 더할);
    try {
      그리기();
      await waitFor(() => expect(대기.kr).toBeDefined());
      더할 = 1000;
      await screen.findByText(/데이터 불러오는 중/, {}, 뜰때까지);
      //: 자리는 늘 잡혀 있고(팝업이 커지지 않게) 보이지만 않는다
      expect(screen.getByText(/깨어나는 중/).className).toMatch(/invisible/);
      더할 = (느림기준초 + 1) * 1000;
      await waitFor(() => expect(screen.getByText(/깨어나는 중/).className).not.toMatch(/invisible/),
                    { timeout: 2500 });
    } finally {
      시계.mockRestore();
    }
  });
});

describe("흔들리지 않게", () => {
  it("목록 칸과 안내 줄의 높이가 고정돼 있어 항목이 늘어도 팝업 크기가 안 바뀐다", async () => {
    그리기([["quant-compare", "a"], ["feed", 1]]);
    await screen.findByText(/데이터 불러오는 중/, {}, 뜰때까지);
    expect(screen.getByTestId("불러오기-목록").className).toMatch(/\bh-\[/);
    expect(screen.getByText(/깨어나는 중/).className).toMatch(/\bh-\[/);
  });

  it("두 번째로 뜰 때는 등장 효과 없이 제자리에 나타난다", async () => {
    const { container } = 그리기();
    await screen.findByText(/데이터 불러오는 중/, {}, 뜰때까지);
    expect(screen.getByRole("status").className).toMatch(/fade-in/);
    await act(async () => { for (const k of 기본들) 대기[k].풀기({}); });
    await waitFor(() => expect(container.textContent).toBe(""), { timeout: 3000 });
    //: 다른 화면으로 옮겨 새로 불러오기 시작
    act(() => { qc.fetchQuery({ queryKey: ["feed", 2], queryFn: () => 부르기("feed2") }).catch(() => {}); });
    await screen.findByText(/데이터 불러오는 중/, {}, 뜰때까지);
    expect(screen.getByRole("status").className).not.toMatch(/fade-in/);
  });
});

describe("설정 → 불러오기 표시", () => {
  it("끄기면 불러오는 중에도, 실패해도 안 뜬다", async () => {
    표시설정 = "끄기";
    const { container } = 그리기();
    await waitFor(() => expect(대기["news-us"]).toBeDefined());
    await new Promise((r) => setTimeout(r, 띄울때까지ms + 300));
    expect(container.textContent).toBe("");
    await act(async () => { 대기["news-kr"].깨기(new Error("x")); });
    await new Promise((r) => setTimeout(r, 300));
    expect(container.textContent).toBe("");
  });

  it("실패만이면 불러오는 중엔 안 뜨고, 실패하면 떠서 다시 시도할 수 있다", async () => {
    표시설정 = "실패만";
    const { container } = 그리기();
    await waitFor(() => expect(대기["news-us"]).toBeDefined());
    await new Promise((r) => setTimeout(r, 띄울때까지ms + 300));
    expect(container.textContent).toBe("");
    await act(async () => {
      대기.kr.풀기({}); 대기.us.풀기({}); 대기["news-us"].풀기({});
      대기["news-kr"].깨기(new Error("x"));
    });
    expect(await screen.findByText(/1개를 못 불러왔어요/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "국내 뉴스 다시 시도" })).toBeTruthy();
  });

  it("미리 불러오기는 한가해진 뒤에 한다 — 지금 화면의 요청이 먼저", async () => {
    한가함붙잡기 = true;
    로그인 = true;
    그리기([["stock-detail", "KR", "005930"]]);
    await new Promise((r) => setTimeout(r, 30));
    expect(Object.keys(부른수)).toEqual(["stock-detail"]);
    act(() => 한가할때_할일!());
    await waitFor(() => expect(Object.keys(부른수).sort()).toEqual(
      ["hold", "kr", "news-kr", "news-us", "stock-detail", "us", "watch"]));
  });

  it("꺼 두어도 앱 진입 때 미리 불러오기는 그대로 한다", async () => {
    표시설정 = "끄기";
    그리기();
    await waitFor(() => expect(대기["news-us"]).toBeDefined());
    expect(Object.keys(부른수).sort()).toEqual(["kr", "news-kr", "news-us", "us"]);
  });
});

describe("라벨", () => {
  it("이름표를 사람 말로, 뉴스는 국내·해외를 가른다", () => {
    expect(라벨(["quant-compare", 1])).toBe("퀀트 점수 비교");
    expect(라벨(["news", "us", "latest"])).toBe("해외 뉴스");
    expect(라벨(["news", "kr", "latest"])).toBe("국내 뉴스");
    expect(라벨(["처음보는것"])).toBe("기타 데이터");
  });
  it("작고 자주 도는 것과 관리자 데이터는 안 띄운다", () => {
    expect(라벨(["notiUnread"])).toBeNull();
    expect(라벨(["admin-runtime"])).toBeNull();
  });
});

describe("묶기", () => {
  const r = (x: any) => ({ 이름: "a", 시작: 1_000, 상태: "대기", 다시부르기: () => {}, ...x });
  it("하나라도 실패면 실패, 하나라도 기다리면 기다림", () => {
    expect(묶기([r({ 상태: "완료", 끝: 2_000 }), r({ 상태: "실패", 끝: 2_000 })], 5_000)[0].상태).toBe("실패");
    expect(묶기([r({ 상태: "완료", 끝: 2_000 }), r({})], 5_000)[0].상태).toBe("대기");
  });
  it("걸린 시간은 가장 오래 걸린 것, 음수는 안 나온다", () => {
    expect(묶기([r({ 상태: "완료", 끝: 3_000 }), r({})], 9_000)[0].초).toBe(8);
    expect(묶기([r({ 시작: 5_000 })], 4_000)[0].초).toBe(0);
  });
});
