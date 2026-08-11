/**
 * 2차 점검에서 나온 것들 — 잘못된 정보, 받아 놓고 안 쓰던 데이터,
 * 끊겨 있던 흐름, 통일 안 된 모양.
 *
 * 화면은 눈으로 못 봤다(이 환경에 브라우저가 없다). 그래서 값이 예쁘게
 * 보이는지가 아니라, 고친 구조가 유지되는지를 지킨다.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import 원본 from "../../pages/StockDetail.tsx?raw";
import 수급원본 from "../stock/SupplyDemandTab.tsx?raw";
import 최근조회원본 from "../../utils/recentlyViewed.ts?raw";
import 캐시원본 from "../../api/queryClient.ts?raw";
import RangeBar from "../stock/RangeBar";

const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const 코드 = 코드만(원본);
const 수급 = 코드만(수급원본);
const 최근 = 코드만(최근조회원본);
const 캐시 = 코드만(캐시원본);
/* 백엔드는 vite 의 루트 밖이라 ?raw 로 못 읽는다 — 파일로 직접 읽는다 */
const 설정원본 = readFileSync(join(process.cwd(), "../backend/app/core/config.py"), "utf8");
const 설정 = 설정원본.replace(/"""[\s\S]*?"""/g, "").replace(/^\s*#.*$/gm, "");

describe("잘못된 정보를 보여 주지 않는다", () => {
  it("백엔드가 안 만드는 지표는 고를 수 없다", () => {
    /* ROCE 는 백엔드(_process)가 계산하지 않는다. 목록에 두면 20칸 중
       하나를 써 놓고 영원히 '—' 만 본다 */
    expect(코드).not.toMatch(/key:\s*"roce"/);
  });

  it("거래대금은 서버가 준 실제 값을 먼저 쓴다", () => {
    /* 종가 × 거래량은 근사치다. 장중에는 하루 종일 오르내린 가격으로
       체결된 것을 마지막 가격 하나로 곱하는 셈이라 실제와 다르다 */
    expect(코드).toMatch(/d\.amount \?\?/);
  });

  it("표시등이 장 세션을 따라간다", () => {
    /* 예전에는 조건 없이 초록 점이 뛰었다 — 휴장에도, 값이 멈춰도 */
    /* 점 자체가 세션에 묶여 있어야 한다. 창을 넓게 잡으면 바로 아래의
       라벨 표현에 걸려 통과해 버린다(뮤테이션에서 실제로 빠져나갔다) */
    expect(코드, "세션과 무관하게 늘 초록으로 뛴다")
      .toMatch(/장세션 === "regular" \? "bg-accent-green animate-pulse"/);
    expect(코드, "휴장이면 회색이어야 한다").toMatch(/장세션 === "closed" \? "bg-text-dim"/);
    expect(코드, "휴장 표시가 없다").toMatch(/SESSION_LABEL\[장세션\]/);
  });
});

describe("받아 놓고 안 쓰던 것을 보여 준다", () => {
  it.each([
    ["외국인 지분율", /d\.foreign_rate != null/],
    ["상장주식수",    /d\.shares_outstanding/],
    ["이동평균",      /d\.ma50/],
    ["EPS 성장률",    /key:"eps_growth"/],
    ["매출 예상",     /revenue_estimate/],
  ])("%s 를 쓴다", (_이름, 무늬) => {
    expect(코드).toMatch(무늬);
  });

  it("컨센서스 연도를 표에 붙인다", () => {
    /* 그리는 배관(헤더 색·getVal 의 E 분기)은 원래 다 있었는데
       allYears 에서 예측 연도를 빼 놓아 아무 데도 안 쓰였다 */
    expect(코드).toMatch(/const allYears = \[\.\.\.mhYears, \.\.\.fcstYears\]/);
    expect(코드, "표 키와 예측 키가 다른데 매핑이 없다").toMatch(/revenue: "revenue_est"/);
  });

  it("예측 연도는 연간에만 붙인다", () => {
    // 컨센서스는 연간으로만 온다 — 분기 표에 붙이면 빈 열만 는다
    expect(코드).toMatch(/finPeriod === "annual"/);
  });

  it("실적발표 D-day 를 헤더에서 보여 준다", () => {
    /* 뉴스 탭 안쪽에 묻혀 있어 탭을 옮기고 스크롤해야 보였다 */
    expect(코드).toMatch(/const 실적Dday = useMemo/);
    expect(코드, "지난 발표일을 걸러야 한다").toMatch(/x\.t >= 오늘\.getTime\(\)/);
  });
});

describe("52주 위치 바", () => {
  const 원 = (v: number) => `₩${v.toLocaleString("ko-KR")}`;

  it("밴드 안에서의 위치를 숫자로도 알려 준다", () => {
    /* 색과 점만으로 알리면 그걸 못 보는 사람에게는 정보가 아니다 */
    render(<RangeBar low={100} high={200} current={150} fmt={원} />);
    expect(screen.getByText("50% 지점")).toBeInTheDocument();
  });

  it("밴드를 벗어난 값도 막대 안에 가둔다", () => {
    /* 52주 신고가를 막 뚫으면 현재가가 고가보다 크다 */
    render(<RangeBar low={100} high={200} current={260} fmt={원} />);
    expect(screen.getByText("100% 지점")).toBeInTheDocument();
  });

  it("폭이 0이면 아무것도 그리지 않는다", () => {
    // 신규 상장 등으로 고가=저가면 나눗셈이 무한대가 된다
    const { container } = render(<RangeBar low={100} high={100} current={100} fmt={원} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("끊겨 있던 길을 잇는다", () => {
  it("보유종목에 담을 수 있다", () => {
    /* 관심종목(보고 싶다)과 보유(샀다)는 다른 일인데, 종목상세에서
       내 자산으로 가는 길이 아예 없었다 */
    expect(코드, "관심종목 화면이 쓰는 모달을 재사용해야 한다")
      .toMatch(/from "@\/components\/watchlist\/WatchlistModals"/);
    // import 만 보면 렌더를 지워도 통과한다 — 실제로 그리는지 본다
    expect(코드, "모달을 그리지 않는다").toMatch(/<AddToPortfolioModal/);
    expect(코드).toMatch(/set담기열림\(true\)/);
  });

  it("내가 가진 수량·평단을 보여 준다", () => {
    expect(코드).toMatch(/const 내보유 = useMemo/);
    // 여러 계좌에 나눠 담았을 수 있다
    expect(코드, "수량 가중 평단이 아니다").toMatch(/총액 \/ 수량/);
  });

  it("보유 조회가 새 요청을 만들지 않는다", () => {
    /* 내 자산·퀀트·글쓰기가 이미 같은 키로 받아 둔 것을 읽는다 */
    expect(코드).toMatch(/queryKey: \["portfolio-items-all"\]/);
  });

  it("주소를 복사할 수 있고 보던 탭이 담긴다", () => {
    expect(코드).toMatch(/clipboard\.writeText/);
    expect(코드, "탭이 주소에 안 담긴다").toMatch(/\?tab=\$\{mainTab\}/);
  });

  it("공유받은 주소로 들어오면 그 탭이 열린다", () => {
    expect(코드).toMatch(/get\("tab"\)/);
    // 그 종목에 없는 탭이면 무시해야 한다 (되돌리기와 싸우지 않게)
    expect(코드).toMatch(/탭목록\.some\(\(t\) => t\.id === 원하는탭\)/);
  });

  it("한 번 적용한 뒤에는 주소가 탭을 붙잡지 않는다", () => {
    /* 계속 적용하면 사용자가 탭을 옮겨도 주소 때문에 되돌아간다 */
    expect(코드, "한 번만 적용하는 가드가 없다")
      .toMatch(/if \(주소탭적용됨\.current \|\| !탭목록\.length\) return;/);
    expect(코드).toMatch(/주소탭적용됨\.current = true;/);
  });

  it("ETF 구성종목에서 그 종목으로 넘어갈 수 있다", () => {
    expect(코드).toMatch(/onClick=\{h\.symbol \? \(\) => 종목으로\(h\.symbol\)/);
    // 심볼 없는 항목(현금 등)까지 눌리게 하면 안 된다
    expect(코드).toMatch(/h\.symbol \? "cursor-pointer/);
  });
});

describe("모양을 앱에 맞춘다", () => {
  it("재무제표 서브탭도 공용 Tabs 를 쓴다", () => {
    /* 여기만 알약 모양이라 한 화면에 서브탭이 두 가지로 보였다 */
    expect(코드).not.toMatch(/rounded-full[^"]*"[^)]*finSubTab/);
    expect(코드).toMatch(/ariaLabel="재무제표 항목"/);
  });

  it("글자 크기를 px 로 못 박지 않는다", () => {
    /* 설정(html font-size)이 rem 만 키운다. px 로 박으면 정작 가장 중요한
       현재가가 안 커진다 */
    expect(코드).not.toMatch(/text-\[\d+px\]/);
  });

  it("차트 틀 색을 테마에서 읽는다", () => {
    /* 다크 값을 손으로 적어 두면 라이트 모드에서 차트만 어둡게 남는다 */
    expect(코드).not.toMatch(/#232840|#141824/);
    expect(코드).toMatch(/from "@\/utils\/chartTheme"/);
    expect(수급, "수급 탭도 같은 토큰을 써야 한다").toMatch(/from "@\/utils\/chartTheme"/);
    /* import 만 보면 그 옆에 하드코딩을 되살려도 통과한다.
       틀 색으로 쓰이는 어두운 헥스가 남아 있지 않은지 본다
       (지표 선 색 #3b82f6 등은 정보라서 그대로 둔다) */
    expect(수급, "다크 전용 틀 색이 남아 있다").not.toMatch(/#232840|#141824|#4b5563/);
  });

  it("시장 배지가 토큰 색을 쓰고 KOSPI/KOSDAQ 을 구분한다", () => {
    expect(코드).not.toMatch(/text-blue-400|bg-green-900|border-purple-700/);
    expect(코드).toMatch(/isKR \? \(d\?\.market \?\? "KR"\)/);
  });

  it("주요 버튼이 손가락에 맞는 크기다", () => {
    /* 뒤로가기가 28×28px 이었다 (권장 44×44).
       [^>]* 로는 못 잡는다 — 사이의 onClick={()=>navigate(-1)} 에 > 가 있다 */
    const i = 코드.indexOf('aria-label="뒤로 가기"');
    expect(i, "뒤로가기 버튼을 못 찾음").toBeGreaterThan(-1);
    expect(코드.slice(i, i + 200)).toMatch(/w-11 h-11/);
  });

  it("토글이 눌린 상태를 알려 준다", () => {
    /* 원화환산 토글은 화면모양별로 세 군데 있다. 하나만 보면 나머지를
       지워도 통과한다 — 개수로 못 박는다 */
    expect((코드.match(/aria-pressed=\{showKRW\}/g) ?? []).length).toBe(3);
    expect(코드).toMatch(/aria-pressed=\{logScale\}/);
    expect((코드.match(/aria-pressed=\{chartType===value\}/g) ?? []).length).toBe(2);
  });

  it("아이콘만 있는 버튼에 이름이 있다", () => {
    expect(코드).toMatch(/aria-label="차트 새로고침"/);
    expect(코드).toMatch(/aria-label="차트 전체보기"/);
  });
});

describe("보안", () => {
  it("공시 링크도 뉴스 링크와 같은 검사를 거친다", () => {
    expect(코드).not.toMatch(/href=\{item\.url\}/);
    expect(코드).toMatch(/href=\{safeExternalUrl\(item\.url\)\}/);
  });

  it("최근 본 종목을 사람별로 나눠 담는다", () => {
    /* 공용 기기에서 앞사람이 본 종목이 다음 사람에게 그대로 넘어갔다 */
    expect(최근).toMatch(/function 내칸\(\)/);
    expect(최근).toMatch(/\$\{BASE\}:u\$\{id\}/);
    expect(최근, "비로그인도 자기 칸이 있어야 한다").toMatch(/guest/);
  });

  it("사람이 바뀌면 예전 공용 기록을 지운다", () => {
    /* 칸을 나눈 것만으로는 이미 쌓인 것이 안 없어진다 */
    expect(캐시).toMatch(/최근조회정리\(\)/);
    expect(최근).toMatch(/localStorage\.removeItem\(BASE\)/);
  });

  it("최근 조회를 읽을 때 모양을 확인한다", () => {
    expect(최근).toMatch(/Array\.isArray\(읽은것\)/);
  });

  it("프로덕션에서 서명 키가 없으면 아예 안 뜬다", () => {
    /* DATABASE_URL 에서 파생하면, 그 주소를 아는 사람이 아무 계정의
       토큰이든 위조할 수 있다. 조용히 약한 키로 도느니 배포가 실패하는
       편이 낫다 */
    /* 같은 조건이 파일에 두 번 나온다(키 생성부 + 기동 로그).
       막는 쪽은 키를 만드는 함수 안이어야 한다 */
    const i = 설정.indexOf("def stable_secret_key");
    const 끝 = 설정.indexOf("FRONTEND_URL");
    const 함수 = 설정.slice(i, 끝 > i ? 끝 : i + 1500);
    expect(함수, "키 생성부에 프로덕션 검사가 없다")
      .toMatch(/APP_ENV in \("production", "staging"\)/);
    expect(함수, "막지 않고 그냥 넘어간다").toMatch(/raise RuntimeError/);
    // 개발 환경의 편의는 그대로 둔다
    expect(설정).toMatch(/hashlib\.sha256\(seed\.encode\(\)\)/);
  });
});
