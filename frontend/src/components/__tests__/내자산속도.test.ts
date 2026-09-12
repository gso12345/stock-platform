/**
 * 내 자산이 빨라진 이유 두 가지가 정말 지켜지는가.
 *
 * ── 왜 이 검사가 필요한가 ───────────────────────────────────
 *
 * 여기서 고친 두 가지는 **망가져도 화면에 아무 표시가 안 난다.** 숫자는
 * 그대로 나오고 오류도 안 뜬다. 그냥 예전만큼 느려질 뿐이다. 그런
 * 고장은 눈으로는 절대 못 찾는다 — 그래서 검사로 못 박는다.
 *
 *   ① 시세를 보유 목록과 같이 받는다
 *      예전에는 왕복이 두 번이었다. 무엇의 시세를 물어볼지는 종목을
 *      받아야 알 수 있어서, 뒤엣것이 앞엣것을 기다렸다. 지금은 서버가
 *      받아 둔 시세를 같이 실어 보내고, 화면이 그것을 시세 조회의
 *      서랍에 미리 꽂아 둔다.
 *
 *      **그 서랍 이름이 한 글자만 달라도** 꽂은 것이 엉뚱한 데 들어가
 *      아무 효과가 없다. 그래서 이름표를 만드는 곳은 한 군데여야 하고,
 *      이 검사가 그것을 지킨다.
 *
 *   ② 탭 데이터를 미리 받아 둔다
 *      추이·배당·뉴스는 눌러야 요청이 나갔다. 미리 받는 쪽과 그리는
 *      쪽이 서로 다른 이름표를 쓰면, 미리 받아 둔 것을 그리는 쪽이
 *      못 찾아서 또 받는다 — 서버만 두 배로 두드리고 화면은 그대로 느리다.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { 시세열쇠, 시세대상, 시세수명 } from "@/constants/portfolioQuery";
import { 시세꽂기, 보유목록설정, 보유목록열쇠 } from "@/hooks/usePortfolioItems";
import { portfolioApi } from "@/api/stocks";
import { 흐름열쇠, 첫기간, 기간들, 올해일수 } from "@/components/portfolio/AssetHistory";
import { 배당열쇠 } from "@/hooks/useDividendCalendar";
import { 뉴스열쇠 } from "@/components/portfolio/HoldingNews";

const 보유 = [
  { market: "KR", symbol: "005930", assetClass: "국내주식" },
  { market: "US", symbol: "AAPL", assetClass: "해외주식" },
  { market: "KR", symbol: "현금", assetClass: "현금" },
];

describe("① 시세 서랍 이름표", () => {
  it("현금은 시세 대상이 아니다", () => {
    /* 현금·금은 심볼이 한글이라 물어볼 시세가 없다. 대상에 끼면
       화면이 '아직 시세를 못 받은 종목' 으로 세어 영원히 다시 묻는다 */
    expect(시세대상(보유).map((x) => x.symbol)).toEqual(["005930", "AAPL"]);
  });

  it("같은 보유 목록이면 늘 같은 이름표가 나온다", () => {
    expect(시세열쇠(보유)).toEqual(시세열쇠([...보유]));
  });

  it("이름표는 시세 대상만으로 만든다 — 현금이 끼면 안 된다", () => {
    /* 여기가 이 검사의 핵심이다.
       꽂아 두는 쪽(보유목록 응답)과 물어보는 쪽(시세 조회)이 같은
       함수를 쓰기 때문에 서랍이 맞는다. 한쪽이 현금을 세고 다른 쪽이
       안 세면 두 이름표가 갈려서, 미리 꽂은 시세가 통째로 버려진다. */
    const [, 붙인것] = 시세열쇠(보유);
    expect(붙인것).toBe("KR:005930,US:AAPL");
    expect(붙인것).not.toContain("현금");
  });

  it("종목이 바뀌면 이름표도 바뀐다", () => {
    /* 안 바뀌면 종목을 담았는데 앞서 받은 시세가 그대로 남는다 */
    const 하나더 = [...보유, { market: "US", symbol: "MSFT", assetClass: "해외주식" }];
    expect(시세열쇠(하나더)).not.toEqual(시세열쇠(보유));
  });

  it("빈 목록도 터지지 않는다", () => {
    expect(시세열쇠([])).toEqual(["portfolio-prices", ""]);
  });
});

describe("① 딸려 온 시세를 정말 꽂는가", () => {
  const 응답 = {
    items: [
      { market: "KR", symbol: "005930", assetClass: "국내주식" },
      { market: "US", symbol: "AAPL", assetClass: "해외주식" },
    ],
    prices: [{ symbol: "005930", market: "KR", price: 71000, change_rate: 1.2 }],
  };

  it("시세 조회가 물어볼 바로 그 서랍에 들어간다", () => {
    /* 이게 이 고침의 전부다. 서랍이 어긋나면 왕복이 그대로 두 번이고,
       화면에는 아무 표시도 안 난다 — 그냥 예전만큼 느리다. */
    const qc = new QueryClient();
    const 목록 = 시세꽂기(qc, 응답);
    expect(qc.getQueryData(시세열쇠(목록))).toEqual(응답.prices);
  });

  it("낡은 것으로 표시해 꽂는다 — 진짜 시세를 곧 받아 와야 한다", () => {
    /* 지금 시각으로 넣으면 react-query 가 신선하다고 보고 2분간
       새로 안 받는다. 서버 캐시에 있던 옛 시세가 그동안 화면에
       눌러앉는다 — 빠른 대신 틀린 값은 느린 것보다 나쁘다. */
    const qc = new QueryClient();
    const 목록 = 시세꽂기(qc, 응답);
    const 상태 = qc.getQueryState(시세열쇠(목록))!;
    expect(Date.now() - 상태.dataUpdatedAt).toBeGreaterThan(시세수명);
  });

  it("이미 값이 있으면 밀어내지 않는다", () => {
    /* 머물던 사람이 종목을 고치면 목록을 다시 받는다. 그때 화면에는
       이미 실시간으로 받은 시세가 있고, 서버 캐시 쪽이 더 낡았을 수
       있다. 이 꽂기는 처음 열 때를 위한 것이다. */
    const qc = new QueryClient();
    const 열쇠 = 시세열쇠(응답.items);
    const 실시간 = [{ symbol: "005930", market: "KR", price: 99999, change_rate: 5 }];
    qc.setQueryData(열쇠, 실시간);
    시세꽂기(qc, 응답);
    expect(qc.getQueryData(열쇠)).toEqual(실시간);
  });

  it("예전 서버가 배열을 그대로 줘도 목록을 잃지 않는다", () => {
    /* with_prices 를 모르는 서버는 예전처럼 배열을 준다. 배포가 반쯤
       걸쳐 있을 때 실제로 그렇게 온다. 꾸러미만 알아보면 목록이 빈
       것으로 읽혀 **가진 종목이 하나도 없는 화면**이 뜬다 —
       속도를 얻으려다 자산이 사라져 보이는 것은 못 갚는 거래다. */
    const qc = new QueryClient();
    expect(시세꽂기(qc, 응답.items)).toEqual(응답.items);
  });

  it("시세가 없어도 목록은 그대로 돌려준다", () => {
    /* 서버가 막 깨어나면 시세 캐시가 텅 비어 있다. 덤이 없다고
       본체까지 잃으면 안 된다. */
    const qc = new QueryClient();
    expect(시세꽂기(qc, { items: 응답.items, prices: [] })).toHaveLength(2);
    expect(시세꽂기(qc, null)).toEqual([]);
    expect(시세꽂기(qc, { items: "이상한것" as unknown })).toEqual([]);
  });
});

describe("② 미리 받는 것과 그리는 것이 같은 서랍을 본다", () => {
  it("추이 — 미리 받는 기간이 기간표에 실제로 있는 것이다", () => {
    expect(기간들.some((g) => g.id === 첫기간)).toBe(true);
    const 기간 = 기간들.find((g) => g.id === 첫기간)!;
    expect(흐름열쇠(첫기간, 3)).toEqual([
      "portfolio-history", 첫기간, 기간.일수 ?? 올해일수(), 3,
    ]);
  });

  it("추이 — 탭이 열리는 기간과 미리 받는 기간이 **한 곳에서** 나온다", () => {
    /* 이 검사가 지키는 것은 값이 아니라 **출처가 하나라는 사실**이다.
     *
     * 화면의 useState 에 "3개월" 을 직접 적고 미리받기도 "3개월" 을
     * 쓰면 지금은 맞는다. 그런데 나중에 누가 기본 기간을 1년으로
     * 바꾸면서 한쪽만 고치면, 미리 받아 둔 것은 안 쓰이고 사람은 그대로
     * 기다린다. 서버는 두 번 맞는다 — 고쳤다고 믿는 채로 오히려
     * 느려지는, 제일 나쁜 종류의 고장이다.
     *
     * 그리고 그 어긋남은 **화면에 아무 표시가 안 난다.** 값 비교로는
     * 못 잡는다(둘 다 같은 상수를 보면 무엇으로 바꾸든 같이 따라간다).
     * 그래서 글자 자체를 본다. */
    const 소스 = fs.readFileSync(
      path.resolve(__dirname, "../portfolio/AssetHistory.tsx"), "utf-8");
    expect(소스).toContain("useState<기간id>(첫기간)");
    /* 되돌아가는 길을 막는다 — 리터럴을 다시 적으면 여기서 걸린다 */
    expect(소스).not.toMatch(/useState<기간id>\("/);
  });

  it("추이 — 포트폴리오를 안 고르면 0(전체) 칸을 본다", () => {
    expect(흐름열쇠(첫기간, undefined)).toEqual(흐름열쇠(첫기간, null));
    expect(흐름열쇠(첫기간, undefined)[3]).toBe(0);
  });

  it("추이 — 포트폴리오가 다르면 서랍도 다르다", () => {
    /* 안 갈리면 포트폴리오를 바꿔도 앞서 받은 전체 그래프가 남아,
       5분 동안 바뀐 것이 하나도 없어 보인다 */
    expect(흐름열쇠(첫기간, 1)).not.toEqual(흐름열쇠(첫기간, 2));
  });

  it("배당·뉴스 — undefined 와 null 을 한 모양으로 모은다", () => {
    /* 부르는 쪽이 제각각 넘긴다. 갈리면 같은 화면을 두 번 받는다 */
    expect(배당열쇠(undefined)).toEqual(배당열쇠(null));
    expect(뉴스열쇠(undefined)).toEqual(뉴스열쇠(null));
    expect(배당열쇠(undefined)[1]).toBe("all");
    expect(뉴스열쇠(undefined)[1]).toBe("all");
  });

  it("배당·뉴스 — 포트폴리오를 고르면 그 칸을 본다", () => {
    expect(배당열쇠(7)[1]).toBe(7);
    expect(뉴스열쇠(7)[1]).toBe(7);
  });
});

describe("③ 보유 목록은 정의가 한 벌이어야 한다", () => {
  /**
   * 여기가 이 파일에서 제일 중요한 검사다. **실제로 한 번 당했다.**
   *
   * `["portfolio-items-all"]` 을 일곱 곳이 각자 정의하고 있었다.
   * react-query 는 이름표로 묶으므로 요청은 한 번만 나갔고, 겉보기에
   * 아무 문제가 없었다. 그런데 **먼저 붙은 쪽의 fetcher 가 이긴다.**
   *
   * 그래서 내 자산이 시세를 목록과 같이 받도록 고쳤을 때, 그 고침이
   * 실제 앱에서는 한 번도 동작하지 않았다 — 불러오기 위젯이 Layout 에
   * 있어 모든 화면에서 늘 먼저 붙고, 옛 방식으로 목록만 받아 갔다.
   * 검사는 통과했다(검사에서는 Layout 을 안 그린다). 화면도 멀쩡했다.
   * 그냥 예전만큼 느렸을 뿐이다. 재현해서 확인했다 —
   *
   *     겉옷이 먼저 붙으면:  옛것 1회 · 새것 0회
   *
   * 값 비교로는 절대 못 잡는다. 정의가 몇 벌인지를 본다.
   */
  const 화면들 = [
    "../../pages/Portfolio.tsx", "../../pages/Watchlist.tsx",
    "../../pages/StockDetail.tsx", "../../pages/FeedWrite.tsx",
    "../../pages/MyPage.tsx", "../../pages/Quant.tsx",
    "../LoadingProgressOverlay.tsx",
  ];

  it("이 이름표에 fetcher 를 직접 적는 곳이 하나도 없다", () => {
    /* invalidateQueries 는 fetcher 를 안 들고 다니므로 상관없다 —
       거기서는 이름표만 쓴다. 문제는 **이름표 바로 옆에 queryFn 이
       붙어 있는** 경우뿐이다. 그래서 이름표 뒤 200자 안만 본다.
       (파일 전체를 훑었더니 멀리 떨어진 다른 조회의 queryFn 이 걸려서
        멀쩡한 화면을 어겼다고 했다.) */
    const 어긴곳: string[] = [];
    for (const f of 화면들) {
      const 소스 = fs.readFileSync(path.resolve(__dirname, f), "utf-8");
      let i = 소스.indexOf('queryKey: ["portfolio-items-all"]');
      while (i !== -1) {
        if (소스.slice(i, i + 200).includes("queryFn")) { 어긴곳.push(f); break; }
        i = 소스.indexOf('queryKey: ["portfolio-items-all"]', i + 1);
      }
    }
    expect(어긴곳, `use보유목록() 을 안 쓰고 직접 적은 곳: ${어긴곳}`).toEqual([]);
  });

  it("일곱 곳이 모두 공용 훅을 쓴다", () => {
    for (const f of 화면들) {
      const 소스 = fs.readFileSync(path.resolve(__dirname, f), "utf-8");
      expect(소스, `${f} 가 use보유목록 을 안 쓴다`).toContain("use보유목록");
    }
  });
});

describe("③ 공용 훅이 정말 시세를 같이 받아 오는가", () => {
  /* 정의를 한 벌로 모아도, 그 한 벌이 옛 방식이면 아무 소용이 없다.
     일곱 곳이 사이좋게 다 같이 느려질 뿐이다 — 그리고 그 어긋남은
     화면에 아무 표시가 안 난다. 그래서 fetcher 가 실제로 무엇을
     부르고 무엇을 꽂는지 직접 본다. (이 검사가 없을 때 뮤테이션
     FC 가 살아남았다.) */
  it("시세까지 받는 경로를 부르고, 받은 시세를 꽂는다", async () => {
    const 응답 = {
      items: [{ market: "KR", symbol: "005930", assetClass: "국내주식" }],
      prices: [{ symbol: "005930", market: "KR", price: 71000 }],
    };
    const 부름 = vi.spyOn(portfolioApi, "getItemsWithPrices")
      .mockResolvedValue(응답 as never);
    try {
      const qc = new QueryClient();
      const 설정 = 보유목록설정(qc, true);
      expect(설정.queryKey).toEqual(보유목록열쇠);
      const 목록 = await 설정.queryFn();
      expect(부름).toHaveBeenCalled();
      expect(목록).toEqual(응답.items);
      // 받은 시세가 시세 조회 자리에 꽂혔다 — 이게 왕복 하나를 없앤다
      expect(qc.getQueryData(시세열쇠(목록))).toEqual(응답.prices);
    } finally {
      부름.mockRestore();
    }
  });
});

describe("③ 시세 이름표도 손으로 적는 곳이 없다", () => {
  /* 같은 고장이 시세 쪽에도 있었다. 세 화면이 "portfolio-prices" 와
     현금 거르기를 각자 손으로 적고 있었다. 지금은 우연히 같아서
     맞는데, 한 곳만 바뀌면 보유 목록에 딸려 온 시세가 다른 서랍으로
     들어가 그냥 버려진다 — 화면에는 아무 표시가 안 나고 왕복만 는다. */
  it("시세 조회 이름표는 시세열쇠() 로만 만든다", () => {
    const 화면들 = ["../../pages/Portfolio.tsx", "../../pages/MyPage.tsx",
                    "../../pages/FeedWrite.tsx"];
    const 어긴곳 = 화면들.filter((f) => {
      const 소스 = fs.readFileSync(path.resolve(__dirname, f), "utf-8");
      /* 쉼표가 붙은 것만 본다 — ["portfolio-prices", …] 는 종목 목록으로
         이름표를 **짓는** 것이고, ["portfolio-prices"] 하나짜리는
         invalidateQueries 가 앞부분만 대는 것이라 fetcher 를 안 든다. */
      return /queryKey:\s*\["portfolio-prices",/.test(소스);
    });
    expect(어긴곳, `시세열쇠() 를 안 쓰고 직접 적은 곳: ${어긴곳}`).toEqual([]);
  });
});
