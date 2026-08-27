/**
 * 금액 가리기(눈 버튼) — 안 켠 사람은 아무것도 안 바뀌고, 켠 사람은 한 자리도 안 샌다.
 *
 * 이 기능은 실패하는 방향이 둘인데, 둘 다 조용히 실패한다.
 *
 *   1) 가리기를 안 켠 사람의 화면이 바뀐다.
 *      포맷터를 감싸면서 반올림·부호·통화 기호가 한 글자라도 달라지면,
 *      이 기능을 쓰지도 않는 전원의 숫자가 어제와 달라 보인다. 아무도
 *      "가리기 때문" 이라고 생각하지 못한다. 그래서 돈한벌(false) 는
 *      원래 포맷터와 '글자 하나 다르지 않아야' 한다 — 눈으로 비슷한 게
 *      아니라, 원래 함수를 직접 불러 같은지 본다.
 *
 *   2) 켠 사람의 화면에서 한 자리만 안 가려진다.
 *      금액이 그려지는 자리가 내 자산 화면에만 마흔 곳쯤 된다. 포맷터
 *      여섯 중 하나를 감싸는 걸 빠뜨리면 그 자리만 금액이 새는데,
 *      대개 그 자리가 제일 큰 숫자다(총 평가금액부터 고치기 때문에
 *      나중에 추가된 포맷터가 남는다). 그래서 '전부' 를 표로 돌린다.
 *
 * 그리고 이 설계의 요점 하나 — 가리는 것은 '금액' 뿐이다. 수익률(%)·
 * 비중(%)·현재가·수량은 그대로 둔다. 퍼센트는 내가 얼마를 가졌는지
 * 말해 주지 않고, 현재가는 남들도 아는 값이다. 그것까지 가리면 화면이
 * 읽을 수 없게 되기만 하고 지켜지는 건 없다. ChangeBadge 렌더 검사가
 * 이 선을 지킨다.
 *
 * 저장 쪽은 예전 사고를 하나 더 못 박는다 — 설정을 자리 인자로 저장하던
 * 시절, 설정을 하나 늘릴 때마다 다른 설정이 조용히 초기화됐다. 금액가리기를
 * 켤 때 색상 테마·글자 크기·테마·방향·화면모양이 같이 살아남는지 본다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, renderHook, act, cleanup, within } from "@testing-library/react";

import { 돈한벌, 가린글, use돈 } from "../useMoney";
import {
  fmtKRWFull, fmtKRWFullSign, fmtKRWCompact, fmtUSDFull, fmtNative, fmtKRW,
} from "../../utils/formatters";
import { useSettingsStore, type 저장값 } from "../../store/settingsStore";
import { ChangeBadge } from "../../components/ui";

const 열쇠 = "portfolio_settings";

/** 기본값과 하나도 겹치지 않는 설정 한 벌.
 *  기본값을 그대로 쓰면 '초기화됐다' 와 '지켜졌다' 가 구분되지 않는다. */
const 기본값과_전부_다른_설정: 저장값 = {
  colorScheme: "red-blue",     // 기본 green-red
  fontSize: "xl",              // 기본 normal
  theme: "light",              // 기본 dark
  orientation: "landscape",    // 기본 system
  화면모양: "classic",          // 기본 app
  금액가리기: true,             // 기본 false
};

const 저장된것 = (): any => JSON.parse(localStorage.getItem(열쇠) ?? "null");

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.resetModules(); });

/* ── 1. 안 켠 사람의 화면은 한 글자도 안 바뀐다 ────────────── */

describe("돈한벌(false) — 원래 포맷터와 글자 하나 다르지 않다", () => {
  /* 값마다 부호·자릿수·단위 경계가 다르게 걸리도록 골랐다.
     1234567 은 만 단위 축약에, 1234567890123 은 조 단위에 걸린다. */
  const 값들 = [0, 1, -1, 9999, 12345, -12345, 1234567, -1234567, 98765432, 1234567890123];

  it("원 — fmtKRWFull 과 같다", () => {
    const 돈 = 돈한벌(false);
    for (const v of 값들) expect(돈.원(v), String(v)).toBe(fmtKRWFull(v));
    expect(돈.원(1234567)).toBe("₩1,234,567");     // 감싼 쪽·감싸인 쪽이 같이 망가지는 경우까지
    expect(돈.원(-1234567)).toBe("-₩1,234,567");
  });

  it("원부호 — fmtKRWFullSign 과 같다(양수 + 가 살아 있다)", () => {
    const 돈 = 돈한벌(false);
    for (const v of 값들) expect(돈.원부호(v), String(v)).toBe(fmtKRWFullSign(v));
    /* 원 과 원부호 를 서로 바꿔 꽂아도 통과하면 안 된다 */
    expect(돈.원부호(1234567)).toBe("+₩1,234,567");
    expect(돈.원부호(1234567)).not.toBe(돈.원(1234567));
    expect(돈.원부호(-1234567)).toBe("-₩1,234,567");
  });

  it("원줄임 — fmtKRWCompact 와 같다", () => {
    const 돈 = 돈한벌(false);
    for (const v of 값들) expect(돈.원줄임(v), String(v)).toBe(fmtKRWCompact(v));
    expect(돈.원줄임(1234567)).toBe("₩123.5만");
    expect(돈.원줄임(1234567890123)).toBe("₩1.23조");
  });

  it("원짧게 — fmtKRW 와 같다(값 없음도 그대로 넘긴다)", () => {
    const 돈 = 돈한벌(false);
    for (const v of 값들) expect(돈.원짧게(v), String(v)).toBe(fmtKRW(v));
    expect(돈.원짧게(1234567)).toBe("123만");
    expect(돈.원짧게(1234567)).not.toBe(돈.원줄임(1234567));   // 둘을 바꿔 꽂으면 걸린다
    /* null·undefined 를 삼켜 버리면 '값 없음' 자리가 "₩NaN" 이 된다 */
    expect(돈.원짧게(null)).toBe(fmtKRW(null));
    expect(돈.원짧게(null)).toBe("—");
    expect(돈.원짧게(undefined)).toBe("—");
  });

  it("달러 — fmtUSDFull 과 같다(소수 둘째 자리)", () => {
    const 돈 = 돈한벌(false);
    for (const v of [0, 1, -1, 1234.5, 1234.567, 98765432]) {
      expect(돈.달러(v), String(v)).toBe(fmtUSDFull(v));
    }
    expect(돈.달러(1234.5)).toBe("$1,234.50");
  });

  it("현지 — fmtNative 와 같다(인자 셋이 순서대로 넘어간다)", () => {
    const 돈 = 돈한벌(false);
    /* 인자를 흘리거나 순서를 바꾸면 원화 종목에 $ 가 붙는다 */
    expect(돈.현지("KR", "KRW", 1000)).toBe(fmtNative("KR", "KRW", 1000));
    expect(돈.현지("KR", "KRW", 1000)).toBe("₩1,000");
    expect(돈.현지("US", "USD", 1000)).toBe(fmtNative("US", "USD", 1000));
    expect(돈.현지("US", "USD", 1000)).toBe("$1,000.00");
    expect(돈.현지("US", "USD", 1000)).not.toBe(돈.현지("KR", "KRW", 1000));
  });

  it("글 — 이미 만들어 둔 문자열을 그대로 돌려준다", () => {
    expect(돈한벌(false).글("₩1,234,567 (3주)")).toBe("₩1,234,567 (3주)");
  });

  it("가림 은 false 다 — 아이콘·aria-label 이 이 값으로 갈린다", () => {
    expect(돈한벌(false).가림).toBe(false);
  });
});

/* ── 2. 켠 사람의 화면에서는 한 자리도 안 샌다 ─────────────── */

describe("돈한벌(true) — 여섯 포맷터 전부 가린다", () => {
  const 돈 = 돈한벌(true);
  /* 이름을 같이 들고 다니는 이유: 하나가 빠졌을 때 '어느 자리가 새는지'
     가 실패 메시지에 바로 찍혀야 한다 */
  const 한벌: [string, () => string][] = [
    ["원",     () => 돈.원(1234567)],
    ["원부호", () => 돈.원부호(1234567)],
    ["원줄임", () => 돈.원줄임(1234567)],
    ["원짧게", () => 돈.원짧게(1234567)],
    ["달러",   () => 돈.달러(1234.56)],
    ["현지",   () => 돈.현지("KR", "KRW", 1234567)],
    ["글",     () => 돈.글("₩1,234,567")],
  ];

  it.each(한벌)("%s 는 가린글을 돌려준다", (_이름, 부르기) => {
    expect(부르기()).toBe(가린글);
  });

  it("가린 결과에 원래 숫자가 조각으로도 안 남는다", () => {
    /* "•••••₩1,234,567" 처럼 앞에만 붙이는 실수를 잡는다 */
    for (const [이름, 부르기] of 한벌) {
      const 나온글 = 부르기();
      expect(나온글, 이름).not.toMatch(/\d/);
      expect(나온글, 이름).not.toContain("1,234");
    }
  });

  it("가림 은 true 다", () => {
    expect(돈.가림).toBe(true);
  });

  it("현지는 통화가 무엇이든 가린다 — 달러 자산만 새는 일이 없다", () => {
    expect(돈.현지("US", "USD", 1234.56)).toBe(가린글);
  });
});

/* ── 3. 가린글은 '값 없음' 과 다른 글자여야 한다 ───────────── */

describe("가린글", () => {
  it("'—'(값 없음)과 다른 글자다", () => {
    /* 둘이 같으면 '내가 가렸다' 와 '값이 아예 없다(현금·시세 미수신)' 를
       구분할 수 없다. 눈 버튼을 껐을 때 숫자가 돌아올지 아닐지를
       화면만 보고 알 수 없게 된다 */
    expect(가린글).not.toBe("—");
    expect(가린글).not.toBe(fmtKRW(null));
    expect(돈한벌(true).원짧게(1234567)).not.toBe(돈한벌(false).원짧게(null));
  });

  it("빈 글자도, 한 글자도 아니다 — 칸이 줄면 옆 칸이 밀린다", () => {
    expect(가린글.length).toBeGreaterThanOrEqual(3);
    expect(가린글.trim()).not.toBe("");
    expect(가린글).not.toMatch(/\d/);
  });
});

/* ── 4. 가릴까 — 내 돈이 아니면 가리지 않는다 ──────────────── */

describe("가릴까(내돈)", () => {
  it("가리기를 켜도 내돈 이 아니면 안 가린다", () => {
    const 돈 = 돈한벌(true);
    /* 같은 배지가 종목 상세에서는 '한 주가 오늘 얼마 움직였나' 를 그린다.
       그건 남들도 다 아는 값이라 가리면 화면만 못 읽게 된다 */
    expect(돈.가릴까(undefined)).toBe(false);
    expect(돈.가릴까(false)).toBe(false);
    expect(돈.가릴까(true)).toBe(true);
  });

  it("가리기를 껐으면 내돈 이어도 안 가린다", () => {
    const 돈 = 돈한벌(false);
    expect(돈.가릴까(undefined)).toBe(false);
    expect(돈.가릴까(false)).toBe(false);
    expect(돈.가릴까(true)).toBe(false);
  });
});

/* ── 5. 훅이 스토어를 실제로 따라간다 ──────────────────────── */

describe("use돈", () => {
  it("설정을 바꾸면 훅이 만든 포맷터도 같이 바뀐다", () => {
    /* useMemo 의 의존값을 빠뜨리면 눈 버튼을 눌러도 화면이 그대로다 —
       사람은 '눌렀는데 안 가려졌다' 만 보고, 다시 누르면 켜졌다 꺼진다 */
    useSettingsStore.getState().set금액가리기(true);
    const { result } = renderHook(() => use돈());
    expect(result.current.가림).toBe(true);
    expect(result.current.원(1234567)).toBe(가린글);

    act(() => { useSettingsStore.getState().set금액가리기(false); });
    expect(result.current.가림).toBe(false);
    expect(result.current.원(1234567)).toBe(fmtKRWFull(1234567));
  });
});

/* ── 6. 저장 — 껐다 켜도, 다른 설정을 건드려도 살아남는다 ──── */

describe("settingsStore 금액가리기", () => {
  it("켜면 localStorage 에 남는다 — 다른 설정을 하나도 안 지우고", () => {
    /* 예전에 저장을 자리 인자로 받던 시절, 설정을 하나 늘릴 때마다
       한 곳을 빠뜨려 다른 설정이 조용히 초기화됐다. 통째로 비교한다 */
    const s = useSettingsStore.getState();
    s.setColorScheme("red-blue");
    s.setFontSize("xl");
    s.setTheme("light");
    s.setOrientation("landscape");
    s.set화면모양("classic");
    useSettingsStore.getState().set금액가리기(true);

    expect(저장된것()).toEqual(기본값과_전부_다른_설정);
  });

  it("토글도 다른 설정을 지우지 않는다", () => {
    const s = useSettingsStore.getState();
    s.setColorScheme("red-blue");
    s.setFontSize("xl");
    s.setTheme("light");
    s.setOrientation("landscape");
    s.set화면모양("classic");
    useSettingsStore.getState().set금액가리기(false);

    act(() => { useSettingsStore.getState().토글금액가리기(); });
    expect(저장된것()).toEqual(기본값과_전부_다른_설정);
  });

  it("토글금액가리기 가 실제로 뒤집는다 — 두 번 누르면 제자리다", () => {
    /* 늘 true 를 넣는 실수는 한 번만 눌러 보면 안 걸린다 */
    useSettingsStore.getState().set금액가리기(false);

    act(() => { useSettingsStore.getState().토글금액가리기(); });
    expect(useSettingsStore.getState().금액가리기).toBe(true);
    expect(저장된것().금액가리기).toBe(true);       // 새로고침해도 켜져 있어야 한다

    act(() => { useSettingsStore.getState().토글금액가리기(); });
    expect(useSettingsStore.getState().금액가리기).toBe(false);
    expect(저장된것().금액가리기).toBe(false);
  });

  /* 스토어는 모듈이 처음 읽힐 때 localStorage 를 읽는다. '다시 켜니
     살아 있더라' 를 보려면 저장해 두고 모듈을 새로 읽히는 수밖에 없다 */
  const 다시읽기 = async () => {
    vi.resetModules();
    const m = await import("../../store/settingsStore");
    return m.useSettingsStore.getState();
  };

  it("다시 열면 금액가리기가 켜진 채로 돌아온다 — 다른 설정과 함께", () => {
    localStorage.setItem(열쇠, JSON.stringify(기본값과_전부_다른_설정));
    return 다시읽기().then((s) => {
      expect(s.금액가리기).toBe(true);
      expect(s.colorScheme).toBe("red-blue");
      expect(s.fontSize).toBe("xl");
      expect(s.theme).toBe("light");
      expect(s.orientation).toBe("landscape");
      expect(s.화면모양).toBe("classic");
    });
  });

  it("저장된 게 없으면 꺼진 채로 시작한다 — 아무도 안 켠 기능이 켜져 있으면 안 된다", async () => {
    const s = await 다시읽기();
    expect(s.금액가리기).toBe(false);
  });

  it.each([
    ["문자열 \"false\"", "false"],
    ["숫자 0", 0],
    ["null", null],
    ["없는 키", undefined],
  ])("%s 는 켜진 것으로 읽지 않는다", async (_이름, 값) => {
    /* "false" 는 문자열이라 truthy 다. !!p.금액가리기 로 읽으면
       한 번 껐던 사람이 다음에 열 때 화면이 통째로 •••• 가 된다 */
    localStorage.setItem(열쇠, JSON.stringify({ ...기본값과_전부_다른_설정, 금액가리기: 값 }));
    const s = await 다시읽기();
    expect(s.금액가리기).toBe(false);
    expect(s.화면모양).toBe("classic");   // 나머지는 그대로 살아 있다
  });

  it("망가진 저장값에도 터지지 않고 꺼진 채로 시작한다", async () => {
    localStorage.setItem(열쇠, "{망가진");
    const s = await 다시읽기();
    expect(s.금액가리기).toBe(false);
  });
});

/* ── 7. ChangeBadge — 금액은 가리고 비율은 남긴다 ──────────── */

describe("ChangeBadge 와 금액 가리기", () => {
  /** 배지 하나만 좁혀서 본다 — 화면 전체에서 문자열을 찾으면
   *  다른 배지의 숫자가 걸려 통과해 버린다 */
  const 배지그리기 = (props: React.ComponentProps<typeof ChangeBadge>) => {
    const { container } = render(<ChangeBadge {...props} />);
    return container.firstElementChild as HTMLElement;
  };

  it("내돈 이 아니면 가리기가 켜져 있어도 금액이 그대로 나온다", () => {
    /* 종목 상세의 '오늘 한 주가 얼마 움직였나' 는 남들도 아는 값이다 */
    useSettingsStore.getState().set금액가리기(true);
    const 배지 = 배지그리기({ value: 1.22, 금액: 900, 통화: "KRW" });
    expect(배지.textContent).toBe("+900 (+1.22%)");
    expect(배지.textContent).not.toContain(가린글);
  });

  it("내돈 을 명시적으로 false 로 줘도 안 가린다", () => {
    useSettingsStore.getState().set금액가리기(true);
    const 배지 = 배지그리기({ value: 1.22, 금액: 900, 통화: "KRW", 내돈: false });
    expect(배지.textContent).toBe("+900 (+1.22%)");
  });

  it("내돈 + 가리기 켬 — 금액은 가려지고 비율(%)은 그대로 남는다", () => {
    /* 비율까지 사라지면 화면이 읽히지 않는다. 퍼센트는 내가 얼마를
       가졌는지 말해 주지 않으므로 가릴 이유가 없다 — 이게 설계의 요점 */
    useSettingsStore.getState().set금액가리기(true);
    const 배지 = 배지그리기({ value: 1.22, 금액: 123456, 통화: "KRW", 내돈: true });
    expect(배지.textContent).toBe(`${가린글} (+1.22%)`);
    expect(within(배지).getByText(`${가린글} (+1.22%)`)).toBeInTheDocument();
    expect(배지.textContent).toContain("+1.22%");     // 비율은 남는다
    expect(배지.textContent).not.toContain("123,456"); // 금액은 안 샌다
    expect(배지.textContent).not.toContain("123456");
  });

  it("내돈 + 가리기 끔 — 금액이 그대로 나온다", () => {
    useSettingsStore.getState().set금액가리기(false);
    const 배지 = 배지그리기({ value: -2.5, 금액: -1850, 통화: "KRW", 내돈: true });
    expect(배지.textContent).toBe("-1,850 (-2.50%)");
  });

  it("가리기를 켜도 금액이 없는 배지에 가린글이 생기지 않는다", () => {
    /* 현금·시세 미수신 종목은 등락 금액이 없다. 여기에 ••••• 가 뜨면
       '숨긴 금액이 있다' 로 읽힌다 — 없는 것을 있는 것처럼 만든다 */
    useSettingsStore.getState().set금액가리기(true);
    const 배지 = 배지그리기({ value: 0, 금액: null, 통화: "KRW", 내돈: true });
    expect(배지.textContent).toBe("+0.00%");
  });
});
