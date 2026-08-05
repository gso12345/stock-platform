/**
 * 용어 힌트 — "기능이 많아지고 복잡해지면서 처음 들어오는 사용자들이 어려울 것 같다"
 *
 * 종목상세 재무 탭에는 PER·PBR·ROE 같은 이름이 스물다섯 자리에 나온다. 값은
 * 보이는데 그게 좋은 건지 나쁜 건지는 아무 데도 안 적혀 있어서, 처음 온
 * 사람에게는 그냥 숫자다.
 *
 * 여기서 못 박는 것 —
 *   1) 사전에 없는 이름이 와도 그냥 지나간다. StatCell 한 자리가 스물다섯
 *      가지 이름을 받으므로, 하나라도 터지면 재무 탭 전체가 안 뜬다.
 *   2) 손가락으로 눌러서 열린다. 이 앱은 절반 이상이 휴대폰이고, 손가락에는
 *      '마우스 올려두기'가 없다.
 *   3) 설명 안에 또 다른 전문용어를 쓰지 않는다.
 */
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { 용어힌트 } from "../ui";
import { 용어사전 } from "@/constants/terms";

describe("용어 힌트", () => {
  it("모르는 이름이 와도 글자는 그대로 나온다", () => {
    /* 여기서 터지면 재무 탭이 통째로 안 뜬다 — 지표 하나 설명 못 한 것보다
       훨씬 나쁜 결과다 */
    render(<용어힌트 이름="한번도들어본적없는지표" />);
    expect(screen.getByText("한번도들어본적없는지표")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("아는 이름이면 물음표가 붙는다", () => {
    render(<용어힌트 이름="PER" />);
    expect(screen.getByRole("button", { name: "PER 설명" })).toBeInTheDocument();
  });

  it("눌러야 열린다 — 마우스를 올리는 것만으로는 안 뜬다", async () => {
    const u = userEvent.setup();
    render(<용어힌트 이름="PER" />);
    const 버튼 = screen.getByRole("button", { name: "PER 설명" });

    await u.hover(버튼);
    expect(screen.queryByRole("tooltip")).toBeNull();

    await u.click(버튼);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByRole("tooltip").textContent).toMatch(/몇 배/);
  });

  it("한 번 더 누르면 닫힌다", async () => {
    const u = userEvent.setup();
    render(<용어힌트 이름="ROE" />);
    const 버튼 = screen.getByRole("button", { name: "ROE 설명" });
    await u.click(버튼);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await u.click(버튼);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("Esc 로 닫힌다", async () => {
    const u = userEvent.setup();
    render(<용어힌트 이름="ROE" />);
    await u.click(screen.getByRole("button", { name: "ROE 설명" }));
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("바깥을 눌러도 닫힌다", async () => {
    const u = userEvent.setup();
    render(<div><용어힌트 이름="ROE" /><span data-testid="딴곳">딴 곳</span></div>);
    await u.click(screen.getByRole("button", { name: "ROE 설명" }));
    // 덮개가 화면을 가리므로 실제 사용자는 덮개를 누르게 된다
    await u.click(document.querySelector(".fixed.inset-0") as Element);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("화면이 조금 밀려도 닫히지 않는다", async () => {
    /* 실제 휴대폰 폭에서 눌러 보니, 누르는 순간 화면이 살짝 스크롤되면서
       설명이 곧바로 닫혀 '눌러도 안 뜨는 버튼'이 됐다. 처음에는 '스크롤하면
       자리가 어긋나니 닫자'로 만들었던 것이 원인이었다 */
    const u = userEvent.setup();
    render(<용어힌트 이름="PER" />);
    await u.click(screen.getByRole("button", { name: "PER 설명" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("버튼이 화면 밖으로 나가면 닫힌다", async () => {
    /* 따라다니게만 하면, 버튼이 스크롤로 사라진 뒤에도 설명이 허공에 남는다 */
    const u = userEvent.setup();
    render(<용어힌트 이름="PER" />);
    const 버튼 = screen.getByRole("button", { name: "PER 설명" });
    await u.click(버튼);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    // 버튼이 화면 위로 완전히 사라진 상태를 흉내 낸다
    버튼.getBoundingClientRect = () =>
      ({ top: -500, bottom: -480, left: 0, right: 20, width: 20, height: 20,
         x: 0, y: -500, toJSON: () => ({}) }) as DOMRect;
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("글자숨김이면 물음표만 나온다", () => {
    /* 퀀트 표의 머리글은 이미 정렬 버튼이다. 버튼 안에 버튼을 넣으면
       설명을 보려다 정렬이 바뀐다 */
    render(<용어힌트 이름="가치" 글자숨김 />);
    expect(screen.getByRole("button", { name: "가치 설명" })).toBeInTheDocument();
    expect(screen.queryByText("가치")).toBeNull();
  });

  it("글자숨김인데 모르는 이름이면 아무것도 안 그린다", () => {
    const { container } = render(<용어힌트 이름="모르는것" 글자숨김 />);
    expect(container.textContent).toBe("");
  });

  it("누르는 것이 바깥으로 새지 않는다", async () => {
    /* 지표는 눌러서 화면이 넘어가는 카드 안에도 들어간다. 설명을 보려다
       엉뚱한 페이지로 가면 안 된다 */
    const u = userEvent.setup();
    let 바깥클릭 = 0;
    render(
      <div onClick={() => { 바깥클릭 += 1; }}>
        <용어힌트 이름="PER" />
      </div>,
    );
    await u.click(screen.getByRole("button", { name: "PER 설명" }));
    expect(바깥클릭).toBe(0);
  });
});

describe("용어 사전 내용", () => {
  it("설명에 또 다른 전문용어를 쓰지 않는다", () => {
    /* 'ROE 란 자기자본이익률입니다' 는 설명이 아니다. 모르는 말을 모르는
       말로 바꿔 놓았을 뿐이다. 정식 이름은 따로 '이름' 칸에 둔다 */
    const 금지 = ["자기자본이익률", "주가수익비율", "주가순자산비율",
                 "총자산이익률", "주당순이익", "유동성", "레버리지"];
    const 걸린것: string[] = [];
    for (const [키, 값] of Object.entries(용어사전)) {
      const 본문 = `${값.뜻} ${값.기준 ?? ""}`;
      for (const 말 of 금지) if (본문.includes(말)) 걸린것.push(`${키}: ${말}`);
    }
    expect(걸린것).toEqual([]);
  });

  it("자기 자신으로 설명하지 않는다", () => {
    /* 'PER(현재) — 이미 벌어들인 돈으로 잰 PER' 은 설명이 아니다. PER 을
       모르는 사람에게는 제자리걸음이다. 실제로 이렇게 써 놨다가 테스트에
       걸렸다 */
    const 걸린것: string[] = [];
    for (const [키, 값] of Object.entries(용어사전)) {
      // 이름에서 괄호·공백을 떼어낸 알맹이 (PER(현재) → PER)
      const 알맹이 = 키.replace(/\(.*?\)/g, "").trim();
      if (알맹이.length < 2 || 알맹이 === 키) continue;
      if (값.뜻.includes(알맹이)) 걸린것.push(`${키}: 뜻 안에 '${알맹이}'`);
    }
    expect(걸린것).toEqual([]);
  });

  it("설명이 한 줄로 읽을 만큼 짧다", () => {
    /* 길면 아무도 안 읽는다. 읽히지 않는 설명은 없는 것과 같다 */
    const 긴것 = Object.entries(용어사전)
      .filter(([, v]) => v.뜻.length > 60)
      .map(([k, v]) => `${k}(${v.뜻.length}자)`);
    expect(긴것).toEqual([]);
  });

  it("어떻게 판단하는지를 같이 준다", () => {
    /* 숫자만 보여주면 1.24 가 좋은 건지 나쁜 건지 알 수 없다.
       다만 '몇 부터 좋다'가 아니라 '어떻게 견주는가'를 줘야 한다 */
    for (const 이름 of ["PER", "PBR", "ROE", "부채비율", "샤프 비율", "베타", "배당수익률"]) {
      expect(용어사전[이름]?.기준, `${이름} 에 판단하는 법이 없다`).toBeTruthy();
    }
  });

  it("'몇 부터 좋다'고 단정하지 않는다", () => {
    /* 처음에는 'PER 10배 아래면 싼 편', '부채비율 200% 위면 빚이 많은 편'
       처럼 써 놨다. 업종마다 보통 수준이 달라서 그대로 대면 틀린다 —
       경기민감 업종은 실적이 정점일 때 PER 이 가장 낮게 나오고, 은행은
       부채비율이 1,000%를 넘는 것이 정상이다.

       이 앱의 퀀트 점수 자체가 그런 지표를 업종 안에서 백분위로 매기는데,
       화면 설명만 절대 숫자를 말하고 있었다. */
    const 단정 = /[0-9]+\s*(배|%)\s*(아래|위|이상|이하)면\s*(싸|싼|비싸|비싼|좋|안정|넉넉|많)/;
    const 걸린것 = Object.entries(용어사전)
      .filter(([, v]) => v.기준 && 단정.test(v.기준))
      .map(([k, v]) => `${k}: ${v.기준}`);
    expect(걸린것).toEqual([]);
  });

  it("업종을 타는 지표는 '견주라'고 말해 준다", () => {
    /* 단정만 지우면 '그래서 어떻게 보라는 거지' 가 된다.
       업종마다 다른 지표는 무엇과 견줘야 하는지까지 있어야 안내다. */
    const 업종을_타는것 = [
      "PER", "PER(현재)", "PBR", "PSR", "EV/EBITDA",
      "ROE", "ROA", "영업이익률", "매출총이익률", "부채비율",
    ];
    const 부실한것 = 업종을_타는것.filter((n) => {
      const g = 용어사전[n]?.기준 ?? "";
      return !(/업종/.test(g) && /견줄|견줘|견주|비교|다르다/.test(g));
    });
    expect(부실한것).toEqual([]);
  });

  it("종목상세가 그리는 이름을 대부분 덮는다", () => {
    /* 재무 탭에 실제로 나오는 이름들. 여기 빠지면 그 지표만 설명이 없다 */
    const 실제로_나오는_이름 = [
      "PER(현재)", "PER(선행)", "PBR", "PSR", "PEG", "EV/EBITDA", "ROE",
      "부채비율", "유동비율", "당좌비율", "영업이익률", "순이익률",
      "매출총이익률", "배당수익률", "배당성향", "베타", "시가총액",
      "기업가치(EV)", "EPS", "EPS(선행)", "선행EPS",
      "컨센서스 EPS", "컨센서스 PER", "투자의견", "애널리스트 수",
    ];
    const 빠진것 = 실제로_나오는_이름.filter((n) => !(n in 용어사전));
    expect(빠진것).toEqual([]);
  });
});
