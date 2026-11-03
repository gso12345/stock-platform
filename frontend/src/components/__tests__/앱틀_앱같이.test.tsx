/**
 * 앱 틀(Layout)이 "실제 앱같이" 를 잇는가 — 1·4·5·6·7번이 앱 틀에서 실제로 붙어 있는지.
 *
 * 하나하나의 동작은 hooks/__tests__ 가 본다(당겨서 새로고침·화면 넘김). 여기서는 앱 틀이
 *   · 아이폰 시계·노치만큼 머리를 띄우는지(1번)
 *   · 본문을 당기면 떠 있는 자료를 다시 받는지(4번)
 *   · 보고 있는 하단 탭을 다시 누르면 맨 위로 가고 주소는 그대로인지(5번)
 *   · 인터넷이 끊기면 띠를 보이는지(6번)
 *   · 화면을 옮기면 내용을 감싼 틀이 움직이는지(7번)
 * 를 본다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("@/components/layout/SearchBar", () => ({ default: () => null }));
vi.mock("@/components/layout/LoadingProgressOverlay", () => ({ default: () => null }));
vi.mock("@/components/community/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/layout/InstallAppButton", () => ({ default: () => null }));
vi.mock("@/components/account/SettingsModal", () => ({ default: () => null }));
vi.mock("@/api/client", async (원본) => ({
  ...(await 원본<any>()),
  default: { get: vi.fn((주소: string) => Promise.resolve({ data: 주소.includes("popups") ? [] : null })) },
}));
vi.mock("@/routes/pages", () => ({ 화면미리받기: () => {} }));
vi.mock("@/utils/한가할때", () => ({ 한가할때: () => () => {}, 아껴쓰는중: () => true }));

import Layout from "../layout/Layout";
import { 지금화면자료 } from "@/utils/지금화면자료";

let 손가락 = false;
const animate = vi.fn();
const 원래animate = (HTMLElement.prototype as any).animate;

function 내용({ 이름 }: { 이름: string }) {
  const location = useLocation();
  return <p data-testid="내용" data-key={location.key}>{이름} 내용</p>;
}

function 그리기(주소 = "/feed") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const 결과 = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[주소]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<내용 이름="대시보드" />} />
            <Route path="feed" element={<내용 이름="피드" />} />
            <Route path="feed/write" element={<내용 이름="글쓰기" />} />
            <Route path="news" element={<내용 이름="뉴스" />} />
            <Route path="more" element={<내용 이름="더보기" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const 본문 = document.querySelector("main") as HTMLElement;
  return { ...결과, qc, 본문 };
}

const 하단탭 = () => within(document.querySelector("nav.fixed") as HTMLElement);

function 터치(대상: Element, 종류: string, 점: Array<[number, number]> = []) {
  const e = new Event(종류, { bubbles: true });
  Object.defineProperty(e, "touches", { value: 점.map(([x, y]) => ({ clientX: x, clientY: y })) });
  act(() => { 대상.dispatchEvent(e); });
}

beforeEach(() => {
  손가락 = false;
  animate.mockClear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === "(pointer: coarse)" ? 손가락 : false,
    media: q, addEventListener() {}, removeEventListener() {},
  }));
});
afterEach(() => {
  (HTMLElement.prototype as any).animate = 원래animate;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("1번 — 아이폰 시계·노치", () => {
  it("머리는 기본 높이에 상태바만큼 더해 그 아래로 내용을 내린다", () => {
    그리기();
    const 머리 = document.querySelector("header") as HTMLElement;
    expect(머리.style.height).toBe("calc(52px + env(safe-area-inset-top))");
  });
});

describe("5번 — 보고 있는 하단 탭을 다시 누르면", () => {
  it("맨 위로 부드럽게 가고, 주소는 그대로(새 기록을 만들지 않는다)", () => {
    const { 본문 } = 그리기("/feed");
    const 위로 = vi.fn();
    본문.scrollTo = 위로 as unknown as HTMLElement["scrollTo"];
    const 처음키 = screen.getByTestId("내용").dataset.key;
    fireEvent.click(하단탭().getByRole("link", { name: "피드" }));
    expect(위로).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(screen.getByTestId("내용").dataset.key).toBe(처음키);
  });

  it("다른 탭을 누르면 그냥 옮겨 간다(맨 위로 굴리지 않는다)", () => {
    const { 본문 } = 그리기("/feed");
    const 위로 = vi.fn();
    본문.scrollTo = 위로 as unknown as HTMLElement["scrollTo"];
    fireEvent.click(하단탭().getByRole("link", { name: "뉴스" }));
    expect(screen.getByText("뉴스 내용")).toBeInTheDocument();
    expect(위로).not.toHaveBeenCalled();
  });

  it("더보기도 같다", () => {
    const { 본문 } = 그리기("/more");
    const 위로 = vi.fn();
    본문.scrollTo = 위로 as unknown as HTMLElement["scrollTo"];
    const 처음키 = screen.getByTestId("내용").dataset.key;
    fireEvent.click(하단탭().getByRole("link", { name: "더보기" }));
    expect(위로).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(screen.getByTestId("내용").dataset.key).toBe(처음키);
  });

  it("더보기에 있지 않으면 더보기로 옮겨 간다", () => {
    const { 본문 } = 그리기("/feed");
    const 위로 = vi.fn();
    본문.scrollTo = 위로 as unknown as HTMLElement["scrollTo"];
    fireEvent.click(하단탭().getByRole("link", { name: "더보기" }));
    expect(screen.getByText("더보기 내용")).toBeInTheDocument();
    expect(위로).not.toHaveBeenCalled();
  });
});

describe("2번은 되돌렸다 — 화면을 옮겨도 본문 스크롤은 건드리지 않는다", () => {
  it("다른 탭으로 옮겨도 본문 자리를 바꾸지 않는다(사용자가 원래대로 돌려 달라고 했다)", () => {
    const { 본문 } = 그리기("/feed");
    let 자리 = 0;
    let 쓴횟수 = 0;
    Object.defineProperty(본문, "scrollTop", {
      configurable: true, get: () => 자리, set: (v: number) => { 자리 = v; 쓴횟수 += 1; },
    });
    자리 = 800;
    fireEvent.click(하단탭().getByRole("link", { name: "뉴스" }));
    expect(screen.getByText("뉴스 내용")).toBeInTheDocument();
    expect(쓴횟수).toBe(0);
    expect(자리).toBe(800);
  });
});

describe("4번 — 당겨서 새로고침", () => {
  it("휴대폰에서 본문 맨 위를 당겼다 놓으면 떠 있는 자료를 다시 받고, 받는 중이라고 알린다", async () => {
    손가락 = true;
    const { 본문, qc } = 그리기("/feed");
    const 다시받기 = vi.spyOn(qc, "refetchQueries").mockResolvedValue(undefined);
    터치(본문, "touchstart", [[100, 100]]);
    터치(본문, "touchmove", [[100, 300]]);
    // 위에 숨어 있던 표시가 손가락을 따라 내려온다
    const 표시 = 본문.querySelector("[aria-hidden]") as HTMLElement;
    expect(표시.style.transform).toMatch(/^translate\(-50%, \d+px\) rotate\(\d+deg\)$/);
    expect(표시.style.opacity).toBe("1");
    터치(본문, "touchend");
    await act(async () => { await Promise.resolve(); });
    // 지금 화면이 쓰는 자료만 — 다음 화면을 위해 미리 받아 두기만 하는 것은 빼고(utils/지금화면자료)
    expect(다시받기).toHaveBeenCalledWith({ type: "active", predicate: 지금화면자료 });
    expect(screen.getByText("새로 받는 중")).toBeInTheDocument();
  });

  it("본문은 끝에서 튕기지 않는다 — 튕김과 당김 표시가 겹치지 않게", () => {
    const { 본문 } = 그리기("/feed");
    expect(본문.className.split(/\s+/)).toContain("overscroll-y-none");
  });

  it("PC 에서는 당겨도 아무 일 없다", async () => {
    const { 본문, qc } = 그리기("/feed");
    const 다시받기 = vi.spyOn(qc, "refetchQueries").mockResolvedValue(undefined);
    터치(본문, "touchstart", [[100, 100]]);
    터치(본문, "touchmove", [[100, 300]]);
    터치(본문, "touchend");
    await act(async () => { await Promise.resolve(); });
    expect(다시받기).not.toHaveBeenCalled();
    expect(screen.queryByText("새로 받는 중")).toBeNull();
  });
});

describe("6번 — 인터넷이 끊기면", () => {
  const 띠 = () => screen.queryByText(/인터넷이 끊겼어요/);

  it("띠를 보이고, 다시 이어지면 걷는다", () => {
    그리기();
    expect(띠()).toBeNull();
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(띠()).toBeInTheDocument();
    expect(띠()!.getAttribute("role")).toBe("status");
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(띠()).toBeNull();
  });

  it("끊긴 채로 열어도 바로 보인다", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    그리기();
    expect(띠()).toBeInTheDocument();
  });
});

describe("7번 — 화면 넘김", () => {
  it("하단 탭을 옮기면 내용을 감싼 틀이 살짝 나타난다", () => {
    (HTMLElement.prototype as any).animate = animate;
    그리기("/feed");
    expect(animate).not.toHaveBeenCalled();
    fireEvent.click(하단탭().getByRole("link", { name: "뉴스" }));
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.contexts[0]).toBe(screen.getByTestId("내용").parentElement);
    expect(animate.mock.calls[0][1]).toMatchObject({ duration: 180 });
  });
});


describe("글을 쓰는 동안은 아래 탭을 숨긴다(피드 12번)", () => {
  /* 앱의 글쓰기 화면처럼 화면을 다 쓰고, 그 자리에 사진·투표·태그 도구줄이 붙는다(FeedWrite) */
  it("글쓰기 화면에는 아래 탭이 없고, 탭 자리만큼 비워 두지도 않는다", () => {
    const { 본문 } = 그리기("/feed/write");
    expect(screen.getByTestId("내용").textContent).toBe("글쓰기 내용");
    expect(document.querySelector("nav.fixed")).toBeNull();
    expect(본문.style.paddingBottom).toBe("0px");
  });

  it("다른 화면(피드 목록)에는 그대로 있다 — 탭 자리도 비워 둔다", () => {
    const { 본문 } = 그리기("/feed");
    expect(document.querySelector("nav.fixed")).not.toBeNull();
    expect(본문.className).toContain("pb-[calc(3.5rem_+_env(safe-area-inset-bottom))]");
    expect(본문.style.paddingBottom).toBe("");
  });
});
