/**
 * **오래 걸린 것**과 **닿지 못한 것**을 갈라 말하는가.
 *
 * ── 무엇이 문제였나 ────────────────────────────────────────
 *
 * 백테스트가 끊기면 '서버에 연결하지 못했습니다' 나 '실행에 실패했어요'
 * 가 떴다. 둘 다 **서버가 죽었다**는 뜻으로 읽힌다. 그런데 그때 서버는
 * 멀쩡히 계산 중인 경우가 대부분이었다 — 무료 서버는 한동안 요청이
 * 없으면 잠들고, 깨우는 데만 20~50초가 든다.
 *
 * 화면이 스스로 어림하는 시간과 예전 상한(30초)을 견줘 보면 바로
 * 드러난다 —
 *
 *     자산  5개  깨어있는 서버  7.2초 · 자던 서버 32.2초  ← 끊김
 *     자산 12개               9.4초 ·          34.4초  ← 끊김
 *     자산 20개              13.8초 ·          38.8초  ← 끊김
 *
 * **틀린 안내는 안내가 없는 것보다 나쁘다.** '연결 실패' 로 읽은 사람은
 * 서버가 고장 난 줄 알고 떠나거나 인터넷을 확인하러 간다. 실제로 해야
 * 할 일은 조금 기다렸다 다시 누르는 것이다.
 */
import { describe, it, expect, afterEach } from "vitest";

import { 요청실패말 } from "../errors";

const 기본 = "계산에 실패했어요";

/** navigator.onLine 을 잠깐 바꾼다 */
function 오프라인으로(값: boolean) {
  Object.defineProperty(navigator, "onLine", {
    value: 값, configurable: true, writable: true,
  });
}
afterEach(() => 오프라인으로(true));


describe("시간이 넘어 끊긴 것은 '실패' 가 아니다", () => {
  const 시간초과 = {
    code: "ECONNABORTED",
    message: "timeout of 180000ms exceeded",
  };

  it("오래 걸렸다고 말한다", () => {
    const 말 = 요청실패말(시간초과, 기본);
    expect(말, "오래 걸렸다는 말이 없다").toMatch(/오래 걸려/);
  });

  it("'연결 실패' 라고 하지 않는다", () => {
    /* 서버는 멀쩡히 돌고 있다. 연결 실패라고 하면 사용자는 서버가
       고장 난 줄 알고 인터넷을 확인하러 간다. */
    const 말 = 요청실패말(시간초과, 기본);
    expect(말, "멀쩡한 서버를 연결 실패로 말한다").not.toMatch(/연결/);
    expect(말, "실패라고 단정한다").not.toMatch(/실패/);
  });

  it("무엇을 하면 되는지 알려 준다", () => {
    /* '오래 걸렸다' 만으로는 사용자가 할 일이 없다. 두 번째부터는
       서버가 깨어 있어 훨씬 빠르다는 것이 실제로 쓸모 있는 정보다. */
    const 말 = 요청실패말(시간초과, 기본);
    expect(말).toMatch(/다시/);
  });

  it("code 가 없고 message 만 timeout 이어도 알아본다", () => {
    /* axios 판이 올라가며 code 가 바뀐 적이 있다. 한쪽만 보면 조용히
       ③(닿지 못함)으로 떨어져 또 '연결 실패' 가 된다. */
    const 말 = 요청실패말({ message: "timeout exceeded" }, 기본);
    expect(말).toMatch(/오래 걸려/);
  });

  it("ETIMEDOUT 도 같은 것으로 본다", () => {
    expect(요청실패말({ code: "ETIMEDOUT" }, 기본)).toMatch(/오래 걸려/);
  });
});


describe("정말 닿지 못한 것은 그렇게 말한다", () => {
  it("응답이 아예 없으면 닿지 못했다고 한다", () => {
    const 말 = 요청실패말({ message: "Network Error" }, 기본);
    expect(말).toMatch(/닿지 못했어요/);
    //: 이건 '오래 걸린 것' 과 달라야 한다 — 할 일이 다르다
    expect(말).not.toMatch(/오래 걸려/);
  });

  it("인터넷이 끊겼으면 그것부터 말한다", () => {
    /* 서버 탓으로 돌리면 사용자는 엉뚱한 곳을 본다. */
    오프라인으로(false);
    expect(요청실패말({ message: "Network Error" }, 기본))
      .toMatch(/인터넷이 끊겨/);
  });
});


describe("서버가 이유를 말했으면 그 말을 쓴다", () => {
  it("detail 문자열을 그대로 보여 준다", () => {
    /* '시세를 받을 수 있는 자산이 없습니다' 같은 말은 사용자가 바로
       고칠 수 있는 것이다. 기본 문구로 덮으면 고칠 길이 사라진다. */
    const e = { response: { status: 400, data: { detail: "종목 코드를 확인해 주세요" } } };
    expect(요청실패말(e, 기본)).toBe("종목 코드를 확인해 주세요");
  });

  it("422 의 객체 배열도 한 줄로 만든다", () => {
    /* 그대로 상태에 넣고 그리면 'Objects are not valid as a React
       child' 로 화면이 통째로 하얘진다. */
    const e = { response: { status: 422, data: { detail: [
      { loc: ["body", "assets"], msg: "at least 1 item", type: "too_short" },
    ] } } };
    const 말 = 요청실패말(e, 기본);
    expect(typeof 말).toBe("string");
    expect(말).toMatch(/at least 1 item/);
  });

  it("응답은 왔는데 읽을 말이 없으면 기본 문구", () => {
    expect(요청실패말({ response: { status: 500, data: {} } }, 기본)).toBe(기본);
  });

  it("500 을 '오래 걸렸다' 로 말하지 않는다", () => {
    /* 서버가 답을 했는데 그게 오류다. 다시 눌러 봐야 같은 결과다 —
       '잠시 후 다시' 로 안내하면 계속 누르게 만든다. */
    const 말 = 요청실패말({ response: { status: 500, data: {} } }, 기본);
    expect(말).not.toMatch(/오래 걸려/);
    expect(말).not.toMatch(/닿지 못했어요/);
  });
});


describe("아무것도 모를 때", () => {
  it("빈 오류면 기본 문구를 준다", () => {
    //: 응답이 없으므로 ③ 으로 간다
    expect(요청실패말({}, 기본)).toMatch(/닿지 못했어요/);
  });

  it("null 이어도 안 터진다", () => {
    expect(() => 요청실패말(null, 기본)).not.toThrow();
  });
});
