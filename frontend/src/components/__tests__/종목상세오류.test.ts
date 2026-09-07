/**
 * 감사에서 나온 것 중 **직접 확인한** 것들.
 *
 * 감사 워크플로가 계정 한도에 걸려 검증 단계가 통째로 실패했다. 그래서
 * 나온 44건을 하나씩 손으로 확인했고, 그중 진짜였던 것만 여기 못 박는다.
 * (반박된 것도 있었다 — '장 마감 뒤에도 15초 폴링' 은 이미 marketSession
 *  으로 처리돼 있었다.)
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { 읽을수있는오류, 차트높이계산 } from "@/pages/StockDetail";

const 뿌리 = path.resolve(__dirname, "../../..");
const 읽기 = (p: string) => fs.readFileSync(path.join(뿌리, p), "utf-8");

describe("서버 오류 본문이 문자열이 아닐 때", () => {
  /* 여기가 화면을 죽일 수 있는 자리였다. FastAPI 의 422 는 detail 을
     객체 배열로 준다 — 그걸 상태에 넣고 그리면 "Objects are not valid
     as a React child" 로 종목상세가 통째로 하얘진다 */

  it("문자열은 그대로", () => {
    expect(읽을수있는오류("이미 추가된 종목입니다")).toBe("이미 추가된 종목입니다");
  });

  it("FastAPI 검증 오류(객체 배열)를 한 줄로 편다", () => {
    const detail = [
      { loc: ["body", "symbol"], msg: "field required", type: "value_error.missing" },
      { loc: ["body", "market"], msg: "invalid market", type: "value_error" },
    ];
    const r = 읽을수있는오류(detail);
    expect(typeof r).toBe("string");
    expect(r).toContain("field required");
    expect(r).toContain("invalid market");
  });

  it("객체 하나여도 문자열이 된다", () => {
    expect(읽을수있는오류({ msg: "안 됩니다" })).toBe("안 됩니다");
    expect(읽을수있는오류({ message: "안 됩니다" })).toBe("안 됩니다");
  });

  it("HTML 이 오면 태그를 걷어낸다", () => {
    /* 프록시·게이트웨이가 오류 페이지를 통째로 돌려주는 경우가 있다.
       안 죽지만 화면에 HTML 한 덩어리가 찍힌다 */
    const r = 읽을수있는오류("<html><body><h1>502 Bad Gateway</h1></body></html>");
    expect(r).not.toContain("<");
    expect(r).toContain("502");
  });

  it("길면 자른다 — 한 줄이 화면을 밀어내면 안 된다", () => {
    expect(읽을수있는오류("가".repeat(500)).length).toBeLessThanOrEqual(120);
  });

  it("못 읽겠으면 기본 문구", () => {
    /* 사용자에게 서버 내부 사정을 보여 줄 이유가 없다 */
    for (const 이상한것 of [undefined, null, 0, 123, true, [], {}, [{ x: 1 }], ""]) {
      expect(읽을수있는오류(이상한것), String(이상한것)).toBe("추가 실패");
    }
  });

  it("어떤 입력에도 문자열만 돌려준다", () => {
    /* 이게 이 함수의 계약이다. 하나라도 새면 화면이 죽는다 */
    const 것들 = [undefined, null, 0, 1, "", "가", [], {}, [[]], [{ msg: 1 }],
                 { msg: {} }, new Error("x"), Symbol.iterator.toString()];
    for (const x of 것들) expect(typeof 읽을수있는오류(x)).toBe("string");
  });

  it("화면이 이 함수를 실제로 쓴다", () => {
    /* 함수만 맞고 화면이 안 쓰면 아무 소용이 없다 */
    const s = 읽기("src/pages/StockDetail.tsx");
    expect(s).toContain("읽을수있는오류(err?.response?.data?.detail)");
    expect(s).not.toContain('err?.response?.data?.detail ?? "추가 실패"');
  });
});

describe("환율이 0 으로 와도 ₩0 이 안 된다", () => {
  /* `?? 1350` 은 null·undefined 만 막는데, 서버는 환율을 못 받았을 때
     `{value: 0}` 을 돌려준다(price_fetcher._get_fx_cached 의 빈값).
     0 은 ?? 를 그냥 통과해서, '원화로 보기' 를 켠 미국 종목의 모든 값이
     ₩0 이 됐다 — 값이 안 나오는 게 아니라 틀린 값이 나온다 */

  it("0 을 걸러 기본 환율로 떨어진다", () => {
    const s = 읽기("src/pages/StockDetail.tsx");
    expect(s).toContain("Number.isFinite(받은환율) && 받은환율 > 0 ? 받은환율 : 1350");
    expect(s).not.toContain("?.value ?? 1350");
  });

  it("서버가 정말로 0 을 준다 — 그 자리가 아직 있는지 본다", () => {
    /* 이 검사가 깨지면 서버 쪽이 바뀐 것이다. 그때 프론트 가드를
       다시 판단하면 된다 — 지금은 필요하다는 근거로 남겨 둔다 */
    const py = 읽기("../backend/app/services/price_fetcher.py");
    expect(py).toMatch(/빈값 = \{[^}]*"value": 0/);
  });
});

describe("보유 배지가 담을 때 고른 통화를 따른다", () => {
  /* 시장으로 고르면 20만원짜리 평단에 '$200,000.00' 이 붙는다.
     해외 종목도 '원화로 얼마에 샀다' 로 넣을 수 있다 */

  it("통화를 들고 온다", () => {
    const s = 읽기("src/pages/StockDetail.tsx");
    expect(s).toContain("통화: [...통화들][0]");
    expect(s).toContain('x.currency ?? (x.market === "KR" ? "KRW" : "USD")');
  });

  it("시장이 아니라 통화로 기호를 고른다", () => {
    const s = 읽기("src/pages/StockDetail.tsx");
    expect(s).toContain('내보유.통화 === "KRW"');
    // 옛 방식(시장으로 고르기)이 남아 있으면 안 된다
    expect(s).not.toMatch(/isKR \? `₩\$\{Math\.round\(내보유\.평단\)/);
  });

  it("계좌마다 통화가 다르면 평단을 안 적는다", () => {
    /* 달러와 원을 더한 수는 아무 뜻이 없다. 수량은 맞으니 그것만 남긴다 */
    const s = 읽기("src/pages/StockDetail.tsx");
    expect(s).toContain("if (통화들.size > 1) return { 수량, 평단: null, 통화: null");
    expect(s).toContain("내보유.평단 != null && 내보유.통화 &&");
  });
});

describe("같은 봉을 두 번 받지 않는다", () => {
  /* PriceTrend 만 queryKey 인자 순서가 (기간, 간격) 이고 종목상세는
     (간격, 기간) 이었다. 그래서 '3개월 일봉' 을 두 화면이 서로 다른
     열쇠로 담아, 똑같은 요청이 두 번 나가고 캐시에도 두 벌이 쌓였다 */

  it("stock-ohlcv 열쇠가 어디서나 (시장, 심볼, 간격, 기간) 이다", () => {
    const 곳들 = [
      "src/components/stock/PriceTrend.tsx",
      "src/pages/StockDetail.tsx",
    ];
    const 열쇠들: string[] = [];
    for (const f of 곳들) {
      for (const m of 읽기(f).matchAll(/queryKey: \["stock-ohlcv",([^\]]*)\]/g)) {
        열쇠들.push(m[1].trim());
      }
    }
    expect(열쇠들.length).toBeGreaterThanOrEqual(4);
    /* 넷째 자리가 간격("1d"·"5m"·candleType), 다섯째가 기간이어야 한다.
       PriceTrend 는 기간.간격 / 기간.기간 이라 이름으로 확인한다 */
    const 뒤집힌것 = 열쇠들.filter((k) => /기간\.기간,\s*기간\.간격/.test(k));
    expect(뒤집힌것, `순서가 뒤집힌 열쇠: ${뒤집힌것.join(" | ")}`).toEqual([]);
  });

  it("PriceTrend 가 종목상세와 같은 순서를 쓴다", () => {
    const s = 읽기("src/components/stock/PriceTrend.tsx");
    expect(s).toContain('queryKey: ["stock-ohlcv", market, symbol, 기간.간격, 기간.기간]');
    // 부르는 쪽은 (period, interval) 그대로 — 여긴 API 서명이라 안 바꾼다
    expect(s).toContain("stocksApi.getOHLCV(market, symbol, 기간.기간, 기간.간격)");
  });
});

describe("차트 높이는 그대로 잘 돈다", () => {
  /* 위 수정들이 이 계산을 안 건드렸는지 확인한다 */
  it("창을 따라간다", () => {
    expect(차트높이계산(1600, 1200)).toBeGreaterThan(차트높이계산(1600, 800));
  });
});
