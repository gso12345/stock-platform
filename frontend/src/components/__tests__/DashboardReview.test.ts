/**
 * 대시보드 점검에서 나온 것들.
 *
 * 화면이 처음 열리는 자리라 여기서 실패하면 사이트가 통째로 고장 나
 * 보인다. 그런데 조회 열하나 중 실패를 화면에 알리는 곳이 하나뿐이었다.
 *
 * 함께 고친 것 —
 *   · 지수 조회가 실패하면 스켈레톤이 영원히 돌았다
 *   · 그 상태에서 5초마다 무한 재시도했다 (서버가 죽어 있을 때 가장 세게
 *     때리는 셈이다)
 *   · 지수 상세 경로가 이름·기간·간격을 검증 없이 캐시 키에 썼다
 *   · 코스닥150 을 걷어냈다 (네 원천 전부 실패)
 *   · 해외 뉴스만 이미지 필터가 꺼져 있었다
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const 뿌리 = path.resolve(__dirname, "../..");
const 백엔드 = path.resolve(__dirname, "../../../../backend");
const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
   .replace(/"""[\s\S]*?"""/g, "").replace(/^\s*#.*$/gm, "");

const 화면 = 코드만(fs.readFileSync(path.join(뿌리, "pages/Dashboard.tsx"), "utf-8"));
const 서버 = 코드만(fs.readFileSync(path.join(백엔드, "app/api/routes/dashboard.py"), "utf-8"));

describe("코스닥150 을 걷어냈다", () => {
  it("화면·서버 어디에도 남아 있지 않다", () => {
    /* 네 원천(네이버·야후·pykrx·KIS)이 전부 실패했다. 네이버는 코드
       후보 다섯을 다 걸어도 HTTP 409 를 줬고, 화면에는 몇 달 동안
       0 이나 빈 카드로 떠 있었다.

       안 되는 것을 남겨 두는 건 그냥 낭비가 아니다 — 지수 갱신은
       gather 로 묶여 있어서, 안 되는 하나가 매 회차 네 원천을 두드리는
       동안 나머지도 함께 기다린다. */
    for (const s of [화면, 서버]) {
      expect(s).not.toContain("KOSDAQ150");
      expect(s).not.toContain("KQ150");
    }
  });

  it("서버 지수 목록에 없다", () => {
    for (const f of ["app/services/scheduler.py", "app/services/price_fetcher.py",
                     "app/services/yf_service.py", "app/api/websocket/price_stream.py"]) {
      const s = fs.readFileSync(path.join(백엔드, f), "utf-8");
      expect(s, `${f} 에 남아 있다`).not.toContain("KOSDAQ150");
    }
  });
});

describe("안 되는 지수는 스스로 물러난다", () => {
  const pf = fs.readFileSync(path.join(백엔드, "app/services/price_fetcher.py"), "utf-8");

  it("연속 실패를 세고 쉬게 한다", () => {
    /* 이게 없으면 후보 지수를 넣어 보는 것 자체가 위험한 일이 된다 —
       확인할 방법이 없으면 넣어 볼 수도 없다 */
    expect(pf).toContain("def 지수_쉬는가");
    expect(pf).toContain("def 지수_실패기록");
    expect(pf).toContain("def 이번회차_지수");
  });

  it("전부 쉬어도 하나는 본다", () => {
    /* 아무것도 안 물으면 되살아날 길까지 막힌다 */
    const i = pf.indexOf("def 이번회차_지수");
    expect(pf.slice(i, i + 700)).toContain("고른것 or 전체[:1]");
  });

  it("가끔은 다시 찔러본다", () => {
    const i = pf.indexOf("def 이번회차_지수");
    expect(pf.slice(i, i + 700)).toContain("_지수_되살림_주기");
  });
});

describe("지수 상세 경로를 검증한다", () => {
  it("아는 이름만 받는다", () => {
    /* 이름이 그대로 캐시 키가 된다. 인증 없이 부를 수 있으므로,
       검증이 없으면 아무 값이나 새 키가 되어 캐시를 밀어낼 수 있다.
       순위 카테고리에서 똑같은 일을 이미 겪었다 — 40번 부르면 캐시가
       4.3MB → 10.2MB 로 불었다 */
    expect(서버).toContain("_INDEX_PATTERN");
    expect(서버).toMatch(/name: str = Path\(\.\.\., pattern=_INDEX_PATTERN\)/);
  });

  it("기간·간격도 검증한다", () => {
    expect(서버).toContain("_PERIOD_PATTERN");
    expect(서버).toContain("_INTERVAL_PATTERN");
    const i = 서버.indexOf("async def get_index_ohlcv");
    const 몸통 = 서버.slice(i, i + 400);
    expect(몸통).toContain("pattern=_PERIOD_PATTERN");
    expect(몸통).toContain("pattern=_INTERVAL_PATTERN");
  });

  it("패턴이 지수 목록에서 만들어진다", () => {
    /* 손으로 적으면 지수를 넣고 빼는 순간 어긋난다 */
    expect(서버).toMatch(/_INDEX_PATTERN = "\^\(" \+ "\|"\.join\(KR_INDICES \+ US_INDICES\)/);
  });
});

describe("실패를 화면에 알린다", () => {
  it("지수·뉴스 자리에 실패 표시가 있다", () => {
    expect((화면.match(/<못불러옴/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("실패하면 스켈레톤을 영원히 돌리지 않는다", () => {
    /* 사용자에게는 '아직 불러오는 중' 으로 보이는데 영영 안 온다 */
    expect((화면.match(/못받음 && !data/g) ?? []).length).toBe(2);
  });

  it("실패하는 동안 5초마다 두드리지 않는다", () => {
    /* 서버가 자고 있거나 죽어 있을 때가 정확히 그 상황인데,
       0.15 CPU 서버를 그때 가장 세게 때리는 셈이었다 */
    expect((화면.match(/query\.state\.status === "error"\) return 60_000/g) ?? []).length).toBe(2);
  });
});

describe("뉴스는 이미지 있는 기사만", () => {
  it("국내·해외 둘 다 켜져 있다", () => {
    /* 국내는 진작 True 였는데 해외만 False 였다. 같은 화면의 두 탭이
       서로 다르게 보였다 */
    const 국내 = 서버.slice(서버.indexOf("async def kr_news"), 서버.indexOf("async def kr_news") + 300);
    const 해외 = 서버.slice(서버.indexOf("async def us_news"), 서버.indexOf("async def us_news") + 300);
    expect(국내).toContain("images_only: bool = Query(default=True)");
    expect(해외).toContain("images_only: bool = Query(default=True)");
  });

  it("그것 때문에 화면이 비면 되돌린다", () => {
    /* 언론사가 썸네일을 빼면 목록이 통째로 빈다. 빈 화면은 고장으로
       보이지만 사진 없는 카드는 조금 심심할 뿐이다 */
    const i = 서버.indexOf("if images_only:");
    const 몸통 = 서버.slice(i, i + 600);
    expect(몸통).toContain("NEWS_TAB_LIMIT");
    expect(몸통).toContain("len(articles) // 2");
  });
});

describe("해외 순위 대상", () => {
  const rs = fs.readFileSync(path.join(백엔드, "app/services/ranking_service.py"), "utf-8");
  const ul = fs.readFileSync(path.join(백엔드, "app/services/us_listing.py"), "utf-8");

  it("목록을 못 받으면 거울을 본다", () => {
    /* NASDAQ Trader 가 막히면 순위 대상이 코드에 적어 둔 372개로
       떨어졌다. 그러면 '미국 전종목 순위' 가 아니라
       'S&P500 안에서의 순위' 다 — 화면에는 아무 표시도 없이 */
    expect(ul).toContain("def _거울에서_받기");
    expect(ul).toContain("raw.githubusercontent.com/rreichel3/US-Stock-Symbols");
  });

  it("대표 ETF 를 앞줄에 박아 둔다", () => {
    /* 거울에는 NYSE Arca 가 없다. SPY·QQQ 가 거기 있어서, 거울로만
       돌면 6,813 종목을 받아 놓고 정작 거래대금 1위를 잃는다.

       목록을 만들어 두기만 하고 앞줄에 안 넣으면 아무 소용이 없다 —
       뮤테이션에서 실제로 그렇게 빠져나갔다. 쓰는 자리까지 본다. */
    const i = rs.indexOf("def us_universe");
    const 몸통 = rs.slice(i, i + 1600);
    expect(몸통).toContain("대표ETF");
    for (const t of ["SPY", "QQQ", "IWM", "GLD"]) {
      expect(몸통, `${t} 가 없다`).toContain(`"${t}"`);
    }
    expect(몸통, "만들어만 두고 앞줄에 안 넣었다")
      .toMatch(/앞줄 = list\(dict\.fromkeys\([^)]*대표ETF/);
  });
});
