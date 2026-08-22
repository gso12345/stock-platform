/**
 * 종목상세 점검에서 나온 것들을 고친 뒤, 되돌아가지 않게 못 박는다.
 *
 * 여기 있는 것은 전부 "코드를 읽어서 확인했다" 가 근거다. 화면을 띄워 눈으로
 * 본 것이 아니다(이 환경에는 브라우저가 없었다). 그래서 구조가 무너지는 것을
 * 막는 데 초점을 둔다 — 값이 맞는지가 아니라, 고친 모양이 유지되는지.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import 원문 from "../../pages/StockDetail.tsx?raw";
import main원문 from "../../main.tsx?raw";
import ErrorBoundary from "../common/ErrorBoundary";

/** 주석·설명글이 검사에 걸리지 않게 걷어낸다 — 예전에 주석 때문에
 *  통과해 버린 테스트가 있었다 */
const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const 코드 = 코드만(원문);
const main코드 = 코드만(main원문);

describe("탭 목록은 한 곳에서만 만든다", () => {
  it("숫자키 단축키가 자기 배열을 따로 들고 있지 않다", () => {
    /* 예전에는 여기에 7개 고정 배열이 박혀 있어서, 실제로 그려지는 탭이
       6~8개로 변하는 것과 어긋났다. ETF 에서 3 을 누르면 화면에 없는
       '재무제표' 가 열렸다.

       이름(TABS)만 막으면 다른 이름으로 되살아난다 — 실제로 뮤테이션
       테스트에서 그렇게 빠져나갔다. 그래서 '탭 id 를 평평하게 나열한
       배열' 이라는 모양 자체를 막는다. 탭 목록은 { id, Icon, label } 로만
       적히므로 정상 코드는 이 모양이 될 수 없다. */
    expect(코드).not.toMatch(/\[\s*"chart"\s*,\s*"daily"/);
    expect(코드).not.toMatch(/const TABS\s*[:=]/);
    expect(코드).toMatch(/const 탭목록 = useMemo\(/);

    // 탭 목록을 만드는 자리는 딱 하나여야 한다
    expect((코드.match(/id:\s*"chart"/g) ?? []).length).toBe(1);
  });

  it("그리는 곳도 같은 배열을 쓴다", () => {
    // 렌더에 인라인 배열이 다시 생기면 또 갈라진다
    expect(코드).toMatch(/탭목록\.map\(/);
    const 탭줄 = 코드.slice(코드.indexOf('role="tablist"'), 코드.indexOf('role="tablist"') + 400);
    expect(탭줄).not.toMatch(/\{\s*id:"chart"/);
  });

  it("단축키는 탭목록에서 꺼내 쓴다", () => {
    expect(코드).toMatch(/탭목록\[idx\]/);
  });

  it("없어진 탭에 서 있으면 되돌린다", () => {
    /* 종목을 바꿔도 이 화면은 리마운트되지 않는다. KR 종목의 '수급' 탭에서
       미국 종목으로 넘어가면 그 탭이 사라지는데, 예전에는 mainTab 이 그대로
       남아 아무 탭도 안 눌린 채 아래가 통째로 비었다 */
    expect(코드).toMatch(/탭목록\.some\(\(t\) => t\.id === mainTab\)/);
    expect(코드).toMatch(/setMainTab\("chart"\)/);
  });

  it("탭에 role 과 선택 상태가 있다", () => {
    expect(코드).toMatch(/role="tablist"/);
    expect(코드).toMatch(/role="tab"/);
    expect(코드).toMatch(/aria-selected=\{mainTab === id\}/);
  });
});

describe("차트 여백이 실제로 적용된다", () => {
  it("margin 을 펼쳐서 넘기지 않는다", () => {
    /* {...chartProps.margin} 은 margin 이 아니라 top/right/left/bottom 을
       각각 prop 으로 넘긴다. recharts 는 그걸 모르므로 여백이 한 번도
       안 먹었다 — 차트 11개 전부 */
    expect(코드).not.toMatch(/\{\.\.\.chartProps\.margin\}/);
  });

  it("모든 차트가 margin prop 으로 받는다", () => {
    const 쓴횟수 = (코드.match(/margin=\{chartProps\.margin\}/g) ?? []).length;
    expect(쓴횟수).toBeGreaterThanOrEqual(11);
  });

  it("margin 에 as any 를 다시 붙이지 않는다", () => {
    /* as any 가 붙어 있어서 타입 검사가 위 오타를 못 잡았다 */
    expect(코드).toMatch(/margin: \{top:8,right:12,left:4,bottom:4\},/);
  });
});

describe("미리 받아 둔 것을 버리지 않는다", () => {
  it("뉴스 prefetch 키가 실제 질의와 같다", () => {
    /* 예전엔 prefetch 가 ["stock-news", m, sym] 3칸, 실제 질의는
       newsSort 까지 4칸이라 미리 받은 것을 아무도 안 읽었다.
       뉴스는 RSS 를 여러 개 도는 비싼 요청이라 그대로 낭비였다 */
    const pre = 코드.match(/prefetchQuery\(\{ queryKey: \["stock-news"[^}]*/)?.[0] ?? "";
    const 질의 = 코드.match(/queryKey: \["stock-news", m, sym, newsSort\]/)?.[0] ?? "";
    expect(pre, "prefetch 에 newsSort 가 없다").toContain("newsSort");
    expect(질의, "실제 질의 키를 못 찾음").toBeTruthy();
  });

  it("prefetch 가 newsSort 를 의존성에 넣는다", () => {
    // 안 넣으면 정렬을 바꿔도 옛 정렬로 미리 받는다
    expect(코드).toMatch(/\}, \[m, sym, qc, newsSort\]\);/);
  });
});

describe("폴링이 장 세션을 본다", () => {
  it("관심종목·내 자산과 같은 marketSession 을 쓴다", () => {
    /* 코드베이스에 이미 있는 함수다. 종목상세만 안 쓰고 조건 없이 15초였다 */
    expect(코드).toMatch(/import \{ marketSession(, SESSION_LABEL)? \} from "@\/hooks\/useLivePrices"/);
    expect(코드).toMatch(/marketSession\(m\)/);
  });

  it("휴장이면 아예 안 묻는다", () => {
    expect(코드).toMatch(/장세션 === "closed" \? false/);
  });

  it("휴장 중에도 장 열림을 알아챌 방법이 있다", () => {
    /* 폴링이 멈추면 다시 그릴 일이 없어 장이 열려도 모른다 */
    expect(코드).toMatch(/set세션틱/);
    expect(코드).toMatch(/장세션 !== "closed"\) return;/);
  });

  it("NXT 는 취급하지 않는 종목이면 그만 묻는다", () => {
    /* available 이 false 면 화면에 안 그리는데도 15초마다 계속 물었다 */
    const nxt = 코드.slice(코드.indexOf('"stock-nxt"'), 코드.indexOf('"stock-nxt"') + 600);
    expect(nxt).toMatch(/available === false \? false/);
    expect(nxt, "NXT 만 장 세션을 무시하면 안 된다").toMatch(/시세주기/);
  });
});

describe("빈 차트를 영원히 두드리지 않는다", () => {
  it("재조회 횟수에 상한이 있다", () => {
    /* 상장폐지·심볼 오타 종목에서 4초마다 끝없이 나갔다.
       바로 아래 퀀트 폴링은 4회 상한을 두고 있었다 */
    expect(코드).toMatch(/ohlcvPollCount/);
    expect(코드).toMatch(/ohlcvPollCount\.current >= 5/);
  });

  it("종목·봉 종류가 바뀌면 상한을 다시 센다", () => {
    expect(코드).toMatch(/ohlcvPollCount\.current = 0; \}, \[m, sym, candleType\]/);
  });

  it("에러로 끝난 것은 폴링하지 않는다", () => {
    /* data 가 undefined 라 '비었다' 와 구분이 안 돼 실패하는 곳을 계속 때렸다 */
    expect(코드).toMatch(/query\.state\.status === "error"\) return false/);
  });
});

describe("0 을 값으로 착각하지 않는다", () => {
  it("유효() 를 두고 밸류에이션 폴백에 쓴다", () => {
    /* 백엔드가 eps=0.0 을 주면 `??` 가 0 을 넘기지 않아 폴백이 첫 칸에서
       멈췄다. 기본정보엔 'EPS 0원', 아래 표엔 '5,240원' 이 동시에 떴다 */
    expect(코드).toMatch(/const 유효 = /);
    for (const k of ["per", "pbr", "eps", "bps", "roe"]) {
      expect(코드, `${k} 가 유효() 를 안 거친다`).toMatch(
        new RegExp(`${k}:\\s*유효\\(d\\?\\.${k}\\)`),
      );
    }
  });

  it("폴백을 여는 판정도 같은 기준이다", () => {
    /* 판정이 0을 '있음'으로 보면 폴백 질의가 열리지도 않는다.
       예전에는 `유효((detail as any).eps)` 라는 글자를 그대로 기대했다.
       as any 를 걷어내자 깨졌는데, 지키려던 것은 '유효() 를 거치는가'
       이지 캐스트가 붙어 있는가가 아니다 — 형태가 아니라 뜻을 본다. */
    for (const 값 of ["detail", "fundamentalsData"]) {
      expect(코드, `${값} 의 eps 판정이 유효() 를 안 거친다`).toMatch(
        new RegExp(`유효\\(${값}[.?]*\\.?eps\\)\\s*==\\s*null`),
      );
      expect(코드, `${값} 의 per 판정이 유효() 를 안 거친다`).toMatch(
        new RegExp(`유효\\(${값}[.?]*\\.?per\\)\\s*==\\s*null`),
      );
    }
  });

  it("0 이 정당한 항목은 건드리지 않는다", () => {
    /* 마진·부채비율은 0 일 수 있다. 거기까지 유효() 를 씌우면
       진짜 0 을 '없음' 으로 지워 버린다 */
    expect(코드).toMatch(/op_margin:\s*d\?\.op_margin\s*\?\?/);
    expect(코드).toMatch(/debt_ratio:\s*d\?\.debt_ratio\s*\?\?/);
  });
});

describe("드롭다운이 두 곳에 있어도 각자 닫힌다", () => {
  it("ref 를 두 DOM 에 같이 달지 않는다", () => {
    /* 하나를 둘에 달면, 전체보기를 열었다 닫는 순간 React 가 ref 를 null 로
       되돌린다. 일반 차트 쪽 div 는 언마운트된 적이 없어 다시 안 채워지므로
       그 뒤로 바깥을 눌러도 드롭다운이 안 닫혔다 */
    expect((코드.match(/ref=\{candleDropdownRef\}/g) ?? []).length).toBe(1);
    expect((코드.match(/ref=\{candleDropdownFsRef\}/g) ?? []).length).toBe(1);
  });

  it("바깥 클릭 판정이 둘 다 본다", () => {
    expect(코드).toMatch(/\[candleDropdownRef\.current, candleDropdownFsRef\.current\]/);
  });
});

describe("그리다 터져도 흰 화면이 되지 않는다", () => {
  it("라우트 전체를 감싼다", () => {
    expect(main코드).toMatch(/ErrorBoundary/);
    const i감쌈 = main코드.indexOf("<화면오류그물>");
    const i라우트 = main코드.indexOf("<Routes>");
    expect(i감쌈, "화면오류그물을 못 찾음").toBeGreaterThan(-1);
    expect(i감쌈, "Routes 바깥을 감싸야 한다").toBeLessThan(i라우트);
  });

  it("주소가 바뀌면 지난 오류를 놓아 준다", () => {
    /* 한 화면이 망가졌다고 다른 화면까지 못 열면 안 된다 */
    expect(main코드).toMatch(/resetKey=\{pathname\}/);
  });

  it("터진 자식 대신 되돌아갈 길을 보여 준다", async () => {
    const 폭탄 = () => { throw new Error("일부러 터뜨림"); };
    // React 가 콘솔에 찍는 오류로 출력이 지저분해지는 것만 막는다
    const 원래 = console.error;
    console.error = () => {};
    try {
      render(<ErrorBoundary><폭탄 /></ErrorBoundary>);
      expect(screen.getByText("화면을 그리지 못했어요")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "홈으로" })).toBeInTheDocument();
    } finally {
      console.error = 원래;
    }
  });

  it("'다시 시도' 를 누르면 다시 그려 본다", async () => {
    let 터질까 = true;
    const 가끔폭탄 = () => {
      if (터질까) throw new Error("한 번만 터짐");
      return <p>정상 화면</p>;
    };
    const 원래 = console.error;
    console.error = () => {};
    try {
      render(<ErrorBoundary><가끔폭탄 /></ErrorBoundary>);
      expect(screen.getByText("화면을 그리지 못했어요")).toBeInTheDocument();
      터질까 = false;
      await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(screen.getByText("정상 화면")).toBeInTheDocument();
    } finally {
      console.error = 원래;
    }
  });
});

describe("잘못된 입력 하나로 앱이 죽지 않는다", () => {
  it("주소의 종목 코드를 풀다 터져도 넘어간다", () => {
    /* /stocks/KR/% 는 decodeURIComponent 에서 URIError 를 던진다.
       그리는 중이라 앱 전체가 흰 화면이 됐다 */
    expect(코드).toMatch(/try \{ return decodeURIComponent/);
    expect(코드).toMatch(/catch \{ return \(rawSymbol \?\? ""\)\.toUpperCase\(\); \}/);
  });

  it("저장된 사용자설정이 배열인지 확인하고 받는다", () => {
    /* JSON.parse 는 숫자도 객체도 돌려준다. 그대로 쓰면 .map 이 터진다 */
    expect(코드).toMatch(/Array\.isArray\(읽은것\)/);
    expect(코드).toMatch(/typeof k === "string"/);
  });
});
