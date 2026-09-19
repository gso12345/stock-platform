/**
 * 내 포트폴리오를 **비중 그대로** 백테스트로 가져오는가.
 *
 * ── 왜 비중이 본론인가 ─────────────────────────────────────
 *
 * 종목만 가져오고 비중을 똑같이 나눠 버리면, 내가 실제로 굴리는 것과
 * 다른 포트폴리오를 재게 된다. 삼성전자에 60%를 넣은 사람에게 '다섯
 * 종목 20%씩' 의 지난 10년은 **남의 성적**이다. 이 기능을 쓰는 이유가
 * '내 배분이 지난 10년에 어땠나' 이므로 비중이 곧 본론이다.
 *
 * 그리고 이 셈이 내 자산 화면과 **한 글자라도 다르면** 같은 포트폴리오인데
 * 화면은 30%, 백테스트는 28% 라고 말하게 된다. 어느 쪽이 맞는지 코드만
 * 봐서는 알 수 없고, 틀린 쪽이 조용히 틀린다.
 */
import { describe, it, expect } from "vitest";

import { 포트폴리오를자산으로, 최대자산수 } from "../AllocationForm";
import { 평가금액원화, 매입금액원화, 비중매기기 } from "@/utils/holdings";

/** 시세를 아는 종목만 값을 주는 함수 */
const 시세 = (표: Record<string, number>) =>
  (심볼: string) => 표[심볼] ?? null;

const 환율 = 1300;

function 줄(심볼: string, 더: any = {}) {
  return {
    symbol: 심볼, market: "KR", name: 심볼,
    shares: 10, avgPrice: 1000, currency: "KRW", ...더,
  };
}


describe("비중을 그대로 가져온다", () => {
  it("평가금액 기준으로 비중을 매긴다 — 매입금액이 아니다", () => {
    /* 지금 내 돈이 **어떻게 놓여 있는지**를 재는 것이므로, 오른 종목은
       그만큼 크게 잡혀야 맞다. 매입금액으로 매기면 10년 전에 산 것이
       지금 가치와 상관없이 작게 들어간다. */
    const r = 포트폴리오를자산으로(
      [줄("A"), 줄("B")],
      시세({ A: 3000, B: 1000 }),   // A 는 3배 올랐고 B 는 그대로
      환율);

    const 몫 = Object.fromEntries(r.자산들.map((a) => [a.symbol, a.weight]));
    expect(몫.A, "평가금액이 아니라 매입금액으로 쟀다").toBeCloseTo(75, 1);
    expect(몫.B).toBeCloseTo(25, 1);
  });

  it("내 자산 화면과 **같은 함수**로 센다", () => {
    /* 두 벌로 두면 같은 포트폴리오인데 화면은 30%, 백테스트는 28% 가
       된다. 여기서는 화면이 쓰는 것과 같은 셈을 직접 돌려 견준다. */
    const 줄들 = [
      줄("A", { shares: 10, avgPrice: 1000 }),
      줄("B", { market: "US", shares: 5, avgPrice: 100, currency: "USD" }),
    ];
    const 표 = { A: 2000, B: 200 };

    const 화면식 = 비중매기기(
      줄들, (x) => 평가금액원화(x as any, 표[x.symbol as "A" | "B"], 환율));
    const 백테스트 = 포트폴리오를자산으로(줄들, 시세(표), 환율);

    for (const x of 화면식) {
      const 저쪽 = 백테스트.자산들.find((a) => a.symbol === x.symbol)!;
      expect(저쪽.weight, `${x.symbol} 의 비중이 화면과 다르다`)
        .toBeCloseTo(x.weight, 1);
    }
  });

  it("달러 종목은 환율을 곱해 견준다", () => {
    /* 안 곱하면 '71,000원 + 225달러' 를 그냥 더하는 셈이라, 달러
       종목이 1/1300 크기로 들어가 사실상 없는 것이 된다. */
    const r = 포트폴리오를자산으로(
      [줄("KR종목", { shares: 100, avgPrice: 1000 }),
       줄("US종목", { market: "US", shares: 1, avgPrice: 100, currency: "USD" })],
      시세({ KR종목: 1000, US종목: 100 }),   // 10만원 vs 100달러(=13만원)
      환율);

    const 몫 = Object.fromEntries(r.자산들.map((a) => [a.symbol, a.weight]));
    expect(몫.US종목, "달러에 환율을 안 곱했다").toBeGreaterThan(몫.KR종목);
    expect(몫.US종목).toBeCloseTo(56.5, 0);
  });

  it("비중의 합이 100 이다", () => {
    const r = 포트폴리오를자산으로(
      [줄("A"), 줄("B"), 줄("C")],
      시세({ A: 1000, B: 2000, C: 3000 }), 환율);
    const 합 = r.자산들.reduce((s, a) => s + a.weight, 0);
    expect(합).toBeCloseTo(100, 1);
  });
});


describe("시세를 못 받았을 때", () => {
  it("매입금액으로 대신 센다 — 0 으로 두지 않는다", () => {
    /* 0 으로 두면 그 종목만 비중 0% 가 되고 나머지가 그만큼 부풀려진다.
       손익은 0 으로 잡히지만 비중은 얼추 맞는다 — 비중을 통째로
       어긋내는 쪽이 훨씬 나쁘다. */
    const r = 포트폴리오를자산으로(
      [줄("A", { shares: 10, avgPrice: 1000 }),
       줄("못받은것", { shares: 10, avgPrice: 1000 })],
      시세({ A: 1000 }),            // 못받은것 은 null
      환율);

    const 몫 = Object.fromEntries(r.자산들.map((a) => [a.symbol, a.weight]));
    expect(몫.못받은것, "시세를 못 받았다고 비중 0 으로 뒀다").toBeCloseTo(50, 1);
  });

  it("전부 못 받아도 매입금액 비율로 나온다", () => {
    const r = 포트폴리오를자산으로(
      [줄("A", { shares: 30, avgPrice: 1000 }),
       줄("B", { shares: 10, avgPrice: 1000 })],
      시세({}), 환율);
    const 몫 = Object.fromEntries(r.자산들.map((a) => [a.symbol, a.weight]));
    expect(몫.A).toBeCloseTo(75, 1);
  });
});


describe("같은 종목이 여러 줄이면 합친다", () => {
  it("나눠 산 두 줄이 한 자산이 된다", () => {
    /* 안 합치면 한 종목이 두 줄로 들어가 비중 칸의 이름이 겹치고,
       열둘 상한도 헛되이 먹는다. */
    const r = 포트폴리오를자산으로(
      [줄("A", { shares: 10, avgPrice: 1000 }),
       줄("A", { shares: 30, avgPrice: 1000 }),
       줄("B", { shares: 10, avgPrice: 1000 })],
      시세({ A: 1000, B: 1000 }), 환율);

    expect(r.자산들.map((a) => a.symbol)).toEqual(["A", "B"]);
    const 몫 = Object.fromEntries(r.자산들.map((a) => [a.symbol, a.weight]));
    expect(몫.A, "두 줄을 합치지 않았다").toBeCloseTo(80, 1);
  });
});


describe("상한을 넘으면 자르고 **반드시 말한다**", () => {
  /* 상한보다 **다섯 개 많게** 만든다. 개수를 박아 두면 상한을 올릴
     때 이 검사가 조용히 뜻을 잃는다 — 실제로 12 에서 20 으로 올렸을
     때 '스무 개' 가 더 이상 넘치는 수가 아니게 돼서 깨졌다. */
  const 넘치게 = Array.from({ length: 최대자산수 + 5 }, (_, i) =>
    줄(`S${String(i).padStart(2, "0")}`, { shares: i + 1, avgPrice: 1000 }));

  it("비중이 큰 것부터 상한까지만 담는다", () => {
    const r = 포트폴리오를자산으로(넘치게, 시세({}), 환율);
    expect(r.자산들).toHaveLength(최대자산수);
    //: 큰 것부터 — 주수가 제일 많은 마지막 것이 1등이다
    expect(r.자산들[0].symbol).toBe(넘치게[넘치게.length - 1].symbol);
  });

  it("서버 상한과 같은 수다", () => {
    /* 화면이 더 많이 담게 두면 상한을 넘긴 사람은 422 만 보고 왜인지
       모르고, 적게 담으면 담을 수 있는 것을 못 담는다.

       서버 쪽(portfolio_backtest.최대자산 = 자산배분요청.assets 의
       max_length)은 파이썬이라 여기서 못 읽는다. 그래서 수를 적어
       두고 **고칠 때 양쪽을 같이 고치게** 만든다 — 이 줄이 깨지는
       것이 곧 '서버도 고쳤나?' 라는 물음이다.
       (서버 안에서 둘이 같은지는 test_자산배분_설정이_실제로_먹나.py
        의 test_요청_상한과_엔진_상한이_같다 가 본다.) */
    expect(최대자산수).toBe(20);
  });

  it("몇 개 중 몇 개를 담았는지, 원래 비중이 얼마였는지 돌려준다", () => {
    /* 조용히 자르면 스물다섯 종목을 담은 줄 알고 스무 종목짜리 결과를
       본다. 이 기능에서 제일 나쁜 실패다. */
    const r = 포트폴리오를자산으로(넘치게, 시세({}), 환율);
    expect(r.전체수).toBe(최대자산수 + 5);
    expect(r.담은비율).toBeGreaterThan(0);
    expect(r.담은비율, "다 담았다고 말한다").toBeLessThan(100);
  });

  it("자른 뒤 남은 것끼리 100% 가 된다", () => {
    /* 합이 87% 인 채로 두면 엔진이 어차피 합으로 나누므로 결과는 같고
       화면의 수만 헷갈린다. */
    const r = 포트폴리오를자산으로(넘치게, 시세({}), 환율);
    const 합 = r.자산들.reduce((s, a) => s + a.weight, 0);
    expect(합).toBeCloseTo(100, 0);
  });

  it("상한 안쪽이면 자르지 않고 담은비율이 100 이다", () => {
    const r = 포트폴리오를자산으로(
      [줄("A"), 줄("B")], 시세({ A: 1000, B: 1000 }), 환율);
    expect(r.전체수).toBe(2);
    expect(r.담은비율).toBeCloseTo(100, 1);
  });
});


describe("현금도 그대로 담는다", () => {
  it("현금은 자산배분 엔진이 아는 이름 그대로 간다", () => {
    /* 백테스트 엔진의 현금류 = {현금, CASH, 예금}. 내 자산의 현금 줄은
       symbol 이 '현금' 이라 그대로 맞는다 — 빼 버리면 현금 비중이
       통째로 사라져, 주식만 100% 인 다른 포트폴리오를 재게 된다. */
    const r = 포트폴리오를자산으로(
      [줄("A", { shares: 10, avgPrice: 1000 }),
       줄("현금", { shares: 1, avgPrice: 10000, assetClass: "현금" })],
      시세({ A: 1000 }), 환율);

    expect(r.자산들.map((a) => a.symbol)).toContain("현금");
    const 몫 = Object.fromEntries(r.자산들.map((a) => [a.symbol, a.weight]));
    expect(몫.현금).toBeCloseTo(50, 1);
  });
});


describe("빈 것과 이상한 것", () => {
  it("빈 목록이면 빈 결과", () => {
    const r = 포트폴리오를자산으로([], 시세({}), 환율);
    expect(r.자산들).toEqual([]);
    expect(r.전체수).toBe(0);
  });

  it("종목 코드가 없는 줄은 건너뛴다", () => {
    const r = 포트폴리오를자산으로(
      [줄("A"), { name: "코드없음", shares: 1, avgPrice: 100 }],
      시세({ A: 1000 }), 환율);
    expect(r.자산들.map((a) => a.symbol)).toEqual(["A"]);
  });

  it("평가금액이 전부 0 이어도 NaN 이 안 새어 나간다", () => {
    /* 0 으로 나누면 NaN 이 되고, NaN 은 화면에서 '-' 도 아니고 '0%' 도
       아닌 빈칸으로 나간다. */
    const r = 포트폴리오를자산으로(
      [줄("A", { shares: 0, avgPrice: 0 }), 줄("B", { shares: 0, avgPrice: 0 })],
      시세({}), 환율);
    for (const a of r.자산들) expect(Number.isNaN(a.weight)).toBe(false);
  });
});


describe("셈은 utils/holdings 한 군데에만 있다", () => {
  it("평단가를 원화로 적은 달러 종목에 환율을 두 번 곱하지 않는다", () => {
    /* 해외 종목을 원화로 입력하면 avgPrice 가 이미 원화 금액이다.
       여기에 환율을 또 곱하면 그 종목만 1,300배가 된다. */
    const 원화로적음 = { market: "US" as const, currency: "KRW" as const,
                        avgPrice: 130_000, shares: 1 };
    expect(매입금액원화(원화로적음, 환율)).toBe(130_000);
  });

  it("달러로 적었으면 담을 때의 환율을 쓴다", () => {
    /* 지금 환율이 아니라 **살 때** 환율이다. 지금 것으로 세면
       환율이 움직인 만큼 매입금액이 저절로 바뀐다. */
    const 달러로적음 = { market: "US" as const, currency: "USD" as const,
                        avgPrice: 100, shares: 1, inputExchangeRate: 1000 };
    expect(매입금액원화(달러로적음, 환율)).toBe(100_000);
  });
});
