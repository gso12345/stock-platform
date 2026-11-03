/**
 * 피드를 앱처럼 다시 짜며 새로 만든 부품들 — ⋯ 메뉴(6번)·신고 창·사진 크게 보기(9번)·종목칩(4번)·
 * 포트폴리오 색 띠(8번).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Trash2 } from "lucide-react";

vi.mock("@/api/stocks", async (원본) => ({
  ...(await 원본<any>()),
  dashboardApi: { getExchangeRate: vi.fn(() => Promise.resolve({ value: 1000 })) },
}));

import 글메뉴 from "../글메뉴";
import 신고창, { 신고보내기, 신고사유들 } from "../신고창";
import 사진보기, { 배율맞추기, 최대배율 } from "../사진보기";
import 종목칩, { 종목이름 } from "../종목칩";
import 포트폴리오띠 from "../포트폴리오띠";

const 감싸기 = (아이: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{아이}</MemoryRouter></QueryClientProvider>);
};

describe("⋯ 메뉴", () => {
  it("누르면 열리고, 고른 일을 하고 닫힌다", async () => {
    const u = userEvent.setup();
    const 지우기 = vi.fn();
    render(<글메뉴 이름="글 메뉴" 항목들={[{ 이름: "삭제", 아이콘: Trash2, 위험: true, 누르면: 지우기 }]} />);
    expect(screen.queryByRole("menu")).toBeNull();
    await u.click(screen.getByRole("button", { name: "글 메뉴" }));
    expect(screen.getByRole("button", { name: "글 메뉴" })).toHaveAttribute("aria-expanded", "true");
    await u.click(screen.getByRole("menuitem", { name: "삭제" }));
    expect(지우기).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("되돌릴 수 없는 일은 빨갛게", async () => {
    const u = userEvent.setup();
    render(<글메뉴 항목들={[{ 이름: "링크 복사", 누르면: () => {} }, { 이름: "신고", 위험: true, 누르면: () => {} }]} />);
    await u.click(screen.getByRole("button", { name: "메뉴" }));
    expect(screen.getByRole("menuitem", { name: "신고" }).className).toContain("text-accent-red");
    expect(screen.getByRole("menuitem", { name: "링크 복사" }).className).not.toContain("text-accent-red");
  });

  it("카드 안에 있어도 카드를 누른 것으로 치지 않는다 — 글로 넘어가지 않는다", async () => {
    const u = userEvent.setup();
    const 카드 = vi.fn();
    render(<div onClick={카드}><글메뉴 항목들={[{ 이름: "링크 복사", 누르면: () => {} }]} /></div>);
    await u.click(screen.getByRole("button", { name: "메뉴" }));
    await u.click(screen.getByRole("menuitem", { name: "링크 복사" }));
    expect(카드).not.toHaveBeenCalled();
  });

  it("바깥을 누르거나, Esc 거나, 화면이 움직이면 닫힌다", async () => {
    const u = userEvent.setup();
    render(<><p>바깥</p><글메뉴 항목들={[{ 이름: "링크 복사", 누르면: () => {} }]} /></>);
    const 단추 = screen.getByRole("button", { name: "메뉴" });

    await u.click(단추);
    fireEvent.pointerDown(screen.getByText("바깥"));
    expect(screen.queryByRole("menu")).toBeNull();

    await u.click(단추);
    screen.getByRole("menuitem", { name: "링크 복사" }).focus();     // 초점이 메뉴 안에 있다
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(단추).toHaveFocus();                                      // 사라진 메뉴 대신 단추로

    await u.click(단추);
    fireEvent.scroll(document);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Esc 는 메뉴만 닫는다 — 뒤의 창(댓글 창)까지 닫지 않는다", async () => {
    const u = userEvent.setup();
    const 창닫기 = vi.fn();
    const 듣기 = (e: KeyboardEvent) => { if (e.key === "Escape") 창닫기(); };
    window.addEventListener("keydown", 듣기);       // 댓글 창은 window 에서 Esc 를 듣는다
    try {
      render(<글메뉴 항목들={[{ 이름: "링크 복사", 누르면: () => {} }]} />);
      await u.click(screen.getByRole("button", { name: "메뉴" }));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(창닫기).not.toHaveBeenCalled();
      // 메뉴가 닫힌 뒤의 Esc 는 창이 받는다
      fireEvent.keyDown(document, { key: "Escape" });
      expect(창닫기).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", 듣기);
    }
  });

  it("고를 것이 없으면 단추도 없다(로그인 전 남의 글)", () => {
    render(<글메뉴 이름="글 메뉴" 항목들={[]} />);
    expect(screen.queryByRole("button", { name: "글 메뉴" })).toBeNull();
  });
});

describe("신고 창", () => {
  it("사유를 고르기 전에는 보낼 수 없고, 고르면 그 사유로 보낸다", async () => {
    const u = userEvent.setup();
    const 보내기 = vi.fn(() => Promise.resolve(true));
    const 닫기 = vi.fn();
    render(<신고창 무엇="글" 대상="삼성전자 3분기 실적 리뷰" 보내기={보내기} 닫기={닫기} />);
    expect(screen.getByText("이 글을 신고할까요?")).toBeInTheDocument();
    expect(screen.getByText("삼성전자 3분기 실적 리뷰")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(신고사유들.length);
    expect(screen.getByRole("button", { name: "신고" })).toBeDisabled();

    await u.click(screen.getByRole("radio", { name: "허위 정보" }));
    expect(screen.getByRole("radio", { name: "허위 정보" })).toHaveAttribute("aria-checked", "true");
    await u.click(screen.getByRole("button", { name: "신고" }));
    expect(보내기).toHaveBeenCalledWith("허위 정보");
    await waitFor(() => expect(닫기).toHaveBeenCalled());
  });

  it("'기타' 는 직접 쓴 사유가 있어야 보낸다", async () => {
    const u = userEvent.setup();
    const 보내기 = vi.fn(() => Promise.resolve(true));
    render(<신고창 무엇="댓글" 보내기={보내기} 닫기={() => {}} />);
    expect(screen.getByText("이 댓글을 신고할까요?")).toBeInTheDocument();
    await u.click(screen.getByRole("radio", { name: "기타" }));
    expect(screen.getByRole("button", { name: "신고" })).toBeDisabled();
    await u.type(screen.getByLabelText("신고 사유 직접 쓰기"), "  도배  ");
    await u.click(screen.getByRole("button", { name: "신고" }));
    expect(보내기).toHaveBeenCalledWith("도배");
  });

  it("보내지 못하면 창을 닫지 않는다 — 다시 누를 수 있게", async () => {
    const u = userEvent.setup();
    const 닫기 = vi.fn();
    render(<신고창 무엇="글" 보내기={() => Promise.resolve(false)} 닫기={닫기} />);
    await u.click(screen.getByRole("radio", { name: "스팸·광고" }));
    await u.click(screen.getByRole("button", { name: "신고" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "신고" })).toBeEnabled());
    expect(닫기).not.toHaveBeenCalled();
  });

  it("서버 답을 알림으로 — 이미 신고했으면(409) 그것도 끝난 일이다", async () => {
    const 알리기 = vi.fn();
    expect(await 신고보내기(() => Promise.resolve(), "글", 알리기)).toBe(true);
    expect(알리기).toHaveBeenLastCalledWith("신고가 접수되었습니다", "success");

    expect(await 신고보내기(() => Promise.reject({ response: { status: 409 } }), "글", 알리기)).toBe(true);
    expect(알리기).toHaveBeenLastCalledWith("이미 신고한 게시글입니다", "error");
    expect(await 신고보내기(() => Promise.reject({ response: { status: 409 } }), "댓글", 알리기)).toBe(true);
    expect(알리기).toHaveBeenLastCalledWith("이미 신고한 댓글입니다", "error");

    expect(await 신고보내기(() => Promise.reject(new Error("500")), "댓글", 알리기)).toBe(false);
    expect(알리기).toHaveBeenLastCalledWith("신고하지 못했습니다", "error");
  });
});

describe("사진 크게 보기", () => {
  const 사진 = () => screen.getByRole("img", { name: "첨부 사진" }) as HTMLImageElement;

  it("X·Esc·검은 바깥을 누르면 닫힌다 — 사진 자체를 누르면 안 닫힌다", () => {
    const 닫기 = vi.fn();
    render(<사진보기 주소="/a.png" 닫기={닫기} />);
    fireEvent.click(사진());
    expect(닫기).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog", { name: "사진 크게 보기" }));
    expect(닫기).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(닫기).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(닫기).toHaveBeenCalledTimes(3);
  });

  it("뒤 화면이 같이 스크롤되지 않게 막고, 닫으면 풀어 준다", () => {
    const { unmount } = render(<사진보기 주소="/a.png" 닫기={() => {}} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("두 번 누르면 키우고, 또 두 번 누르면 원래대로", () => {
    render(<사진보기 주소="/a.png" 닫기={() => {}} />);
    fireEvent.doubleClick(사진());
    expect(사진().style.transform).toContain("scale(2.5)");
    fireEvent.doubleClick(사진());
    expect(사진().style.transform).toContain("scale(1)");
  });

  it("두 손가락을 벌리면 그만큼 키운다 — 4배까지", () => {
    render(<사진보기 주소="/a.png" 닫기={() => {}} />);
    fireEvent.pointerDown(사진(), { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(사진(), { pointerId: 2, clientX: 200, clientY: 100 });   // 100px 떨어짐
    fireEvent.pointerMove(사진(), { pointerId: 2, clientX: 300, clientY: 100 });   // 200px → 2배
    expect(사진().style.transform).toContain("scale(2)");
    fireEvent.pointerMove(사진(), { pointerId: 2, clientX: 1100, clientY: 100 });  // 10배 → 4배에서 멈춘다
    expect(사진().style.transform).toContain(`scale(${최대배율})`);
  });

  it("원래 크기에서 아래로 밀면 닫히고, 조금만 끌면 제자리로", () => {
    const 닫기 = vi.fn();
    render(<사진보기 주소="/a.png" 닫기={닫기} />);
    fireEvent.pointerDown(사진(), { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(사진(), { pointerId: 1, clientX: 100, clientY: 110 });
    fireEvent.pointerUp(사진(), { pointerId: 1, clientX: 100, clientY: 110 });
    expect(닫기).not.toHaveBeenCalled();
    expect(사진().style.transform).toContain("translate(0px, 0px)");

    fireEvent.pointerDown(사진(), { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(사진(), { pointerId: 1, clientX: 100, clientY: 300 });
    fireEvent.pointerUp(사진(), { pointerId: 1, clientX: 100, clientY: 300 });
    expect(닫기).toHaveBeenCalledTimes(1);
  });

  it("키운 채 끌면 옮긴다(닫지 않는다)", () => {
    const 닫기 = vi.fn();
    render(<사진보기 주소="/a.png" 닫기={닫기} />);
    fireEvent.doubleClick(사진());
    fireEvent.pointerDown(사진(), { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(사진(), { pointerId: 1, clientX: 130, clientY: 300 });
    fireEvent.pointerUp(사진(), { pointerId: 1, clientX: 130, clientY: 300 });
    expect(닫기).not.toHaveBeenCalled();
    expect(사진().style.transform).toContain("translate(30px, 200px)");
  });

  it("배율은 1~4 사이로", () => {
    expect(배율맞추기(0.3)).toBe(1);
    expect(배율맞추기(2.2)).toBe(2.2);
    expect(배율맞추기(9)).toBe(4);
  });
});

describe("종목칩", () => {
  it("이름을 보여 주고, 시장과 코드는 마우스를 올리면 — 누르면 종목 화면", () => {
    감싸기(<종목칩 symbol="005930" market="KR" name="삼성전자" />);
    const 칩 = screen.getByRole("link", { name: "삼성전자" });
    expect(칩).toHaveAttribute("href", "/stocks/KR/005930");
    expect(칩).toHaveAttribute("title", "KR 005930");
    expect(screen.queryByText("005930")).toBeNull();
  });

  it("이름을 모르면 코드를 쓴다", () => {
    감싸기(<종목칩 symbol="SCHD" market="US" name={null} />);
    expect(screen.getByRole("link", { name: "SCHD" })).toHaveAttribute("href", "/stocks/US/SCHD");
    expect(종목이름("  ", "AAPL")).toBe("AAPL");
    expect(종목이름(" 애플 ", "AAPL")).toBe("애플");
  });

  it("시장은 색으로 — 국내 파랑·해외 초록·ETF 보라", () => {
    감싸기(<><종목칩 symbol="1" market="KR" name="국" /><종목칩 symbol="2" market="US" name="해" /><종목칩 symbol="3" market="ETF" name="이" /></>);
    expect(screen.getByRole("link", { name: "국" }).className).toContain("text-accent-blue");
    expect(screen.getByRole("link", { name: "해" }).className).toContain("text-accent-green");
    expect(screen.getByRole("link", { name: "이" }).className).toContain("text-accent-purple");
  });
});

describe("포트폴리오 색 띠", () => {
  const 넷 = [
    { symbol: "005930", market: "KR", name: "삼성전자", shares: 50, avg_price: 68000, current_price: 70000 },   // 3,500,000
    { symbol: "000660", market: "KR", name: "SK하이닉스", shares: 10, avg_price: 180000, current_price: 200000 }, // 2,000,000
    { symbol: "NVDA", market: "US", name: "엔비디아", shares: 10, avg_price: 90, current_price: 100 },              // 1,000,000 (환율 1000)
    { symbol: "035720", market: "KR", name: "카카오", shares: 10, avg_price: 50000, current_price: 50000 },        //   500,000
  ];

  it("큰 것부터 셋까지 이름과 비중, 나머지는 '외 n종목'", async () => {
    감싸기(<포트폴리오띠 items={넷} />);
    // 환율을 받은 뒤의 비중 — 원 그래프와 같은 셈
    expect(await screen.findByText("14.3%")).toBeInTheDocument();       // 엔비디아 1,000,000 / 7,000,000
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("28.6%")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "삼성전자50.0%", "SK하이닉스28.6%", "엔비디아14.3%",
    ]);
    expect(screen.getByText("외 1종목")).toBeInTheDocument();
  });

  it("띠는 모든 종목의 비중을 이름과 함께 읽어 준다(화면 읽기)", async () => {
    감싸기(<포트폴리오띠 items={넷} />);
    await screen.findByText("14.3%");
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "종목 비중 — 삼성전자 50.0%, SK하이닉스 28.6%, 엔비디아 14.3%, 카카오 7.1%");
  });

  it("셋 이하면 '외' 줄이 없고(딱 셋이어도 '외 0종목' 없이), 값이 없으면 아무것도 안 그린다", async () => {
    const { container, unmount } = 감싸기(<포트폴리오띠 items={넷.slice(0, 3)} />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(screen.queryByText(/외 \d+종목/)).toBeNull();
    unmount();
    const 빈것 = 감싸기(<포트폴리오띠 items={[{ ...넷[0], shares: 0 }]} />);
    expect(빈것.container.innerHTML).toBe("");
    expect(container).toBeTruthy();
  });
});
