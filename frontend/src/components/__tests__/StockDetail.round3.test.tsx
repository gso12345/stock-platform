/**
 * 요청 여섯 가지 —
 *   1) 재무제표는 알약 버튼으로 남기기
 *   2) 외국인비중 빼기
 *   3) 휴대폰에서 담기·공유 버튼 때문에 헤더가 불편한 것
 *   4) 모든 종목에서 재무제표·컨센서스가 나오게
 *   6) 한국 ETF 도 ETF 로 보고 보유비중 보여 주기
 *
 * (5번 '정보를 제대로 불러오는지' 는 화면 검사가 아니라 질의 배선 점검이라
 *  아래 '질의 배선' 묶음에서 본다)
 */
import { describe, it, expect } from "vitest";
import 원본 from "../../pages/StockDetail.tsx?raw";
import { isETFStock } from "../../utils/etf";

const 코드 = 원본.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("1. 재무제표 서브탭은 알약 모양으로 둔다", () => {
  it("알약 모양이 유지된다", () => {
    /* 공용 Tabs 로 옮겼더니 칸을 나눠 가지면서 글자가 눌렸다.
       항목이 일곱 개라 가로로 길고, 성격도 '탭' 보다 '필터' 에 가깝다 */
    const i = 코드.indexOf('aria-label="재무제표 항목"');
    expect(i, "재무제표 서브탭을 못 찾음").toBeGreaterThan(-1);
    expect(코드.slice(i, i + 900)).toMatch(/rounded-full/);
  });

  it("모양을 되돌려도 접근성은 남긴다", () => {
    /* 공용 Tabs 가 주던 것(역할·선택 상태)까지 잃으면 안 된다 */
    const i = 코드.indexOf('aria-label="재무제표 항목"');
    const 구역 = 코드.slice(i - 100, i + 900);
    expect(구역).toMatch(/role="tablist"/);
    expect(구역).toMatch(/role="tab"/);
    expect(구역).toMatch(/aria-selected=\{finSubTab===value\}/);
  });
});

describe("2. 외국인비중은 빼 둔다", () => {
  it("화면에도 의존성에도 남아 있지 않다", () => {
    expect(코드).not.toMatch(/foreign_rate/);
    expect(코드).not.toMatch(/외국인비중/);
  });
});

describe("3. 휴대폰에서 헤더가 넓어지지 않는다", () => {
  it("버튼 세 개를 한 줄에 눕힌다", () => {
    /* 예전에는 세로로 3층이 쌓여서, 그 세로줄이 종목명 옆을 차지해
       이름이 접히고 화면 위쪽이 통째로 버튼 자리가 됐다 */
    const i담기 = 코드.indexOf('aria-label="보유종목에 담기"');
    const i공유 = 코드.indexOf('aria-label={복사됨');
    const i관심 = 코드.indexOf('aria-pressed={inWatchlist}');
    expect(i관심, "관심종목 버튼을 못 찾음").toBeGreaterThan(-1);
    expect(i담기, "담기 버튼을 못 찾음").toBeGreaterThan(i관심);
    expect(i공유, "공유 버튼을 못 찾음").toBeGreaterThan(i담기);
    /* 셋을 감싸는 가로 묶음이 관심종목 버튼 바로 앞에 있어야 한다.
       세로(flex-col)로 두면 휴대폰에서 3층이 쌓인다 */
    const 앞 = 코드.slice(Math.max(0, i관심 - 700), i관심);
    expect(앞, "버튼을 감싸는 가로 묶음이 없다").toMatch(/<div className="flex items-center gap-1\.5">/);
  });

  it("좁은 화면에서는 관심종목 글자를 숨긴다", () => {
    /* 아이콘 세 개만 나란히 두면 한 줄에 들어간다 */
    expect(코드).toMatch(/hidden sm:inline/);
  });

  it("글자를 숨겨도 버튼 이름은 남는다", () => {
    /* 글자를 숨기면 화면 읽어주는 기능이 '버튼' 이라고만 읽는다 */
    expect(코드).toMatch(/aria-label=\{inWatchlist \? "관심종목에서 빼기" : "관심종목에 넣기"\}/);
    expect(코드).toMatch(/aria-pressed=\{inWatchlist\}/);
  });

  it("좁은 화면에서도 손가락 크기를 지킨다", () => {
    // 글자를 숨기는 대신 44×44 정사각이 된다
    expect(코드).toMatch(/w-11 h-11 sm:w-auto sm:h-auto/);
  });
});

describe("4. 야후가 비어도 재무제표가 채워진다", () => {
  it("financials 를 두 번째 출처로 쓴다", () => {
    /* 예전에는 표가 metrics-history(야후) 만 봤다. 국내 종목은 야후에
       재무가 비는 일이 흔해서, 바로 위 막대 차트는 DART 값으로 그려지는데
       아래 표는 통째로 '연결 중...' 이었다 — 같은 카드 안에서 */
    expect(코드).toMatch(/const finRaw: any\[\] = \(financials as any\)\?\.\[finPeriod\]/);
    expect(코드).toMatch(/finByPeriod/);
  });

  it("야후에 없는 칸을 financials 로 메운다", () => {
    expect(코드).toMatch(/return finByPeriod\.get\(year\)\?\.\[key\] \?\? null;/);
  });

  it("야후에 없는 연도도 열로 세운다", () => {
    // 국내는 DART 쪽이 더 길게 있는 경우가 많다
    expect(코드).toMatch(/\.\.\.fin\.map\(\(r: any\) => String\(r\.period\)\)/);
  });

  it("분기는 라벨이 어긋나므로 섞지 않는다", () => {
    /* 야후 "2024-12" vs DART "2024Q1"/"2024H1" — DART 는 분기 개념 자체가
       달라서 섞으면 열이 어긋난다. 야후가 아예 빈 경우에만 쓴다 */
    expect(코드).toMatch(/const fin: any\[\] = \(연간인가 \|\| mh\.length === 0\) \? finRaw : \[\]/);
  });

  it("새 요청을 만들지 않는다", () => {
    /* financials 는 재무 탭에서 이미 받고 있던 것이다.
       나오는 자리는 미리받기 1 + 실제 질의 1, 딱 둘이어야 한다 */
    expect((코드.match(/queryKey: \["stock-financials"/g) ?? []).length).toBe(2);
    expect((코드.match(/financialsApi\.get\(/g) ?? []).length).toBe(2);
  });

  it("컨센서스 연도도 함께 붙는다", () => {
    expect(코드).toMatch(/const allYears = \[\.\.\.mhYears, \.\.\.fcstYears\]/);
  });
});

describe("6. 한국 ETF 를 ETF 로 알아본다", () => {
  it.each([
    ["KODEX 200"],
    ["TIGER 미국나스닥100"],
    ["RISE 200"],
    ["KBSTAR 200"],
    ["PLUS 고배당주"],
    ["ARIRANG 고배당주"],
    ["ACE 국고채10년"],
    ["KINDEX 중국본토CSI300"],
    ["HANARO 200"],
    ["KOSEF 국고채10년"],
    ["SOL 미국배당다우존스"],
    ["TIMEFOLIO K이노베이션액티브"],
  ])("%s → ETF", (이름) => {
    expect(isETFStock("KR", 이름)).toBe(true);
  });

  it.each([
    ["삼성전자"],
    ["SK하이닉스"],
    ["NAVER"],
    ["카카오"],
    ["현대차"],
    ["삼성바이오로직스"],
    ["삼성물산"],
    ["미래에셋증권"],
    ["한국투자금융지주"],
  ])("%s → 일반 종목", (이름) => {
    expect(isETFStock("KR", 이름)).toBe(false);
  });

  it("이름이 아직 안 왔으면 ETF 로 단정하지 않는다", () => {
    /* 로딩 중에 ETF 로 봤다가 아니면 탭이 깜빡인다 */
    expect(isETFStock("KR", "")).toBe(false);
    expect(isETFStock("KR", null)).toBe(false);
    expect(isETFStock("KR", undefined)).toBe(false);
  });

  it("브랜드로 시작만 하고 띄어쓰기가 없으면 일반 종목이다", () => {
    /* SOLUS첨단소재는 실제 상장사인데 'SOL' 로 시작한다. 브랜드 뒤 공백을
       요구하지 않으면 이런 회사가 전부 ETF 로 잡힌다.
       (뮤테이션 테스트에서 실제로 이 구멍이 드러났다) */
    expect(isETFStock("KR", "SOLUS첨단소재")).toBe(false);
    expect(isETFStock("KR", "SOLUM")).toBe(false);
    // 반대로 공백이 있으면 ETF 다
    expect(isETFStock("KR", "SOL 미국배당다우존스")).toBe(true);
  });

  it("일반 종목으로 헷갈리기 쉬운 브랜드는 낱말까지 본다", () => {
    /* '삼성'·'미래에셋'·'한국투자' 는 운용사 브랜드이면서 대기업 이름이다.
       띄어쓰기만으로 가르면 띄어 쓴 일반 종목이 ETF 가 된다.
       그래서 이 브랜드들만 ETF 임을 알리는 낱말을 함께 요구한다 */
    expect(isETFStock("KR", "삼성 우선주")).toBe(false);
    expect(isETFStock("KR", "한국투자 지주")).toBe(false);
    // 낱말이 있으면 ETF 로 본다
    expect(isETFStock("KR", "삼성 레버리지 WTI원유 선물 ETN")).toBe(true);
    expect(isETFStock("KR", "미래에셋 인버스 2배")).toBe(true);
  });

  it("시장이 ETF 면 이름과 무관하게 ETF 다", () => {
    expect(isETFStock("ETF", "")).toBe(true);
    expect(isETFStock("etf", "아무거나")).toBe(true);
  });

  it("해외 ETF 는 이름에 적혀 있으므로 그대로 인정한다", () => {
    expect(isETFStock("US", "SPDR S&P 500 ETF Trust")).toBe(true);
    expect(isETFStock("US", "Apple Inc.")).toBe(false);
  });

  it("화면이 이 판정을 쓴다 — 이름에 ETF 글자가 있는지만 보지 않는다", () => {
    expect(코드).toMatch(/const isETF = isETFStock\(m, d\?\.name\)/);
    expect(코드, "옛 판정이 남아 있다").not.toMatch(/\/\\bETF\\b\/i\.test/);
  });

  it("한국 ETF 배지도 ETF 로 뜬다", () => {
    /* KOSPI 로 뜨면 일반 종목과 구분이 안 된다 */
    expect(코드).toMatch(/isETF \? "ETF" :/);
  });

  it("한국 ETF 에는 수급 탭 대신 보유비중 탭이 뜬다", () => {
    expect(코드).toMatch(/isKR && !isKRETF \? \[\{ id:"supply"/);
    expect(코드).toMatch(/isETF \? \[\{ id:"holdings"/);
  });
});

describe("5. 질의 배선 — 안 부르거나 헛부르는 곳이 없다", () => {
  it("모든 질의에 종목이 있어야 부른다", () => {
    /* enabled 에 sym 검사가 없으면 주소가 아직 안 잡힌 첫 순간에
       빈 심볼로 요청이 나간다 */
    const 질의들 = 코드.match(/queryKey: \[[^\]]*\][\s\S]{0,400}?enabled: [^,\n]+/g) ?? [];
    expect(질의들.length).toBeGreaterThan(8);
    for (const q of 질의들) {
      const 키 = q.match(/queryKey: \[([^,\]]*)/)?.[1] ?? "?";
      // 종목과 무관한 것들은 제외 (환율·관심종목 목록·보유목록)
      if (/exchange-rate|watchlist-|portfolio-items-all/.test(키)) continue;
      expect(q, `${키}: enabled 에 sym 검사가 없다`).toMatch(/!!sym|!!symbol/);
    }
  });

  it("탭 전용 질의는 그 탭에서만 켜진다", () => {
    /* 안 그러면 차트만 보는 사람도 재무·퀀트·투자의견을 다 받는다 */
    for (const [키, 탭] of [
      ["stock-financials", "financial"],
      ["analyst", "analyst"],
      ["quant-score", "quant"],
    ] as const) {
      /* 같은 키가 미리받기에도 나온다(그쪽엔 enabled 가 없다).
         enabled 를 가진 쪽, 즉 useQuery 자리를 찾아야 한다 */
      const 자리 = [...코드.matchAll(new RegExp(`queryKey: \\["${키}"[\\s\\S]{0,400}?enabled: [^,\\n]+`, "g"))];
      expect(자리.length, `${키} 의 useQuery 를 못 찾음`).toBeGreaterThan(0);
      expect(자리[0][0], `${키} 가 탭과 무관하게 켜진다`)
        .toMatch(new RegExp(`mainTab === "${탭}"`));
    }
  });

  it("prefetch 키가 실제 질의 키와 어긋나지 않는다", () => {
    /* 어긋나면 미리 받아 둔 것을 아무도 안 읽고 그대로 버린다 */
    // 정렬용 공백이 자리마다 달라서 그대로 비교하면 다 어긋난다
    const 다듬기 = (s: string) => s.replace(/\s+/g, " ").trim();
    const pre = [...코드.matchAll(/prefetchQuery\(\{ queryKey: \[([^\]]+)\]/g)].map((m) => 다듬기(m[1]));
    const 질의 = [...코드.matchAll(/\n\s*queryKey: \[([^\]]+)\]/g)].map((m) => 다듬기(m[1]));
    /* 키 자리에 변수가 들어가는 곳은 글자로 대조할 수 없다.
       그런 곳만 이유를 적어 예외로 둔다 — 목록을 늘리려면 왜 어긋나도
       괜찮은지 여기에 쓰게 만드는 것이 목적이다. */
    const 예외: [RegExp, string][] = [
      [/quant-score/, "가중치 자리를 null 로 채워 미리 받는다 (사용자 설정 전 기본 점수)"],
      [/stock-ohlcv.*"1d", "1mo"/, 'dailyPeriodStr 의 기본값이 "1mo" 다 — 종목이 바뀌면 dailyMonths 가 1 로 리셋되므로 첫 진입에는 항상 일치한다'],
    ];
    for (const p of pre) {
      if (예외.some(([무늬]) => 무늬.test(p))) continue;
      expect(질의, `prefetch 키가 실제 질의에 없다: [${p}]`).toContain(p);
    }
  });

  it("일별 미리받기가 실제로 그 기간을 쓴다", () => {
    /* 위에서 예외로 둔 자리를 그냥 넘기지 않고 근거를 못 박는다.
       기본값이 "1mo" 가 아니게 되면 미리 받은 것이 통째로 버려진다 */
    expect(코드).toMatch(/useState\(1\)/);
    expect(코드).toMatch(/dailyMonths <= 1 \? "1mo"/);
    expect(코드, "종목이 바뀔 때 리셋돼야 첫 진입에 1mo 가 된다")
      .toMatch(/setDailyMonths\(1\); \}, \[sym, m\]/);
  });

  it("같은 데이터를 두 번 받지 않는다", () => {
    /* 키가 같으면 react-query 가 하나로 합친다. 키가 다른데 내용이
       같으면 두 번 받는다 — 일별 탭이 차트와 같은 ohlcv 를 쓰는 것이
       그 예라, 키 앞부분을 맞춰 캐시를 나눠 쓰게 돼 있다 */
    /* 미리받기 1(일별) + 차트 1 + 일별 1 = 셋. 앞부분을 맞춰 뒀기에
       같은 기간·봉이면 react-query 가 하나로 합친다 */
    expect((코드.match(/queryKey: \["stock-ohlcv", m, sym/g) ?? []).length).toBe(3);
  });
});
