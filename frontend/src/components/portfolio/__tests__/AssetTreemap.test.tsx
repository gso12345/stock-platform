/**
 * 자산 지도 — 칸 크기는 비중, 색은 오늘 등락.
 *
 * 이 화면에는 글자가 거의 없다. 칸 하나에 이름과 등락률이 조그맣게 들어갈
 * 뿐이고, 사람이 실제로 읽는 것은 '크기' 와 '색' 이다. 그래서 색이 어긋나면
 * 화면은 멀쩡해 보이는 채로 틀린 말을 한다 — 스크린샷을 봐도, 눈으로 훑어도
 * 티가 안 난다. 그런 종류의 잘못은 검사로만 잡힌다.
 *
 * 무엇이 어긋날 수 있나
 *
 *   · 등락 색상 설정을 안 따르면, 같은 화면 안에서 빨강이 한 번은 오름이고
 *     한 번은 내림이 된다. 빨강/파랑을 쓰는 사람에게 이 지도만 초록이면
 *     그 사람은 초록 칸을 '내렸다' 로 읽는다.
 *   · 진하기에 상한이 없으면 하루 20% 간 종목 하나가 나머지를 전부
 *     흐릿하게 만든다. 상한을 없애는 건 코드에서 Math.min 한 조각을
 *     지우는 일이라 눈에 잘 안 띈다.
 *   · 짙은 칸에 검은 글씨를 얹으면 그 칸의 이름만 안 읽힌다. 그리고 그 칸은
 *     대개 오늘 가장 많이 움직인 칸이다 — 제일 보고 싶은 칸이 안 보인다.
 *   · value 가 0 이하인 칸을 그대로 넘기면 recharts Treemap 이 넓이를
 *     음수로 잡는다. 현금을 0원으로 적어 둔 사람이 실제로 있다.
 *
 * jsdom 에서는 실제 트리맵이 안 그려진다(폭이 0이다). 그래서 '그려진 SVG 가
 * 어떻게 생겼나' 는 보지 않고, 색을 정하는 순수 함수(칸색·글씨색)와
 * 지도에 무엇을 넘겼는지, 그리고 빈 상태 문구를 본다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { 가린글 } from "@/hooks/useMoney";

/* 등락 색상 설정은 갈아 끼운다 — 이 지도가 설정을 따르는지가 검사 대상이다 */
const 설정 = vi.hoisted(() => ({ colorScheme: "green-red" as "green-red" | "red-blue" }));
vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (sel?: (s: typeof 설정) => unknown) => (sel ? sel(설정) : 설정),
}));

/* recharts 는 jsdom 에서 폭이 0이라 칸을 하나도 안 그린다. 넘겨받은 것을
   눈에 보이는 글자로 뱉는 대역을 둔다 — 보고 싶은 것은 '무엇을 넘겼나' 다.
   칸을 실제로 그리는 content 는 따로 꺼내 두었다가 손으로 그려 본다. */
const 담김 = vi.hoisted(() => ({
  treemap: null as Record<string, unknown> | null,
  tooltip: null as Record<string, unknown> | null,
}));

vi.mock("@/components/chart/ChartFrame", () => {
  /** recharts 태그 이름별로 props 를 모은다 — 그리지 않고 트리만 훑는다 */
  type 마디 = { type?: unknown; props?: Record<string, unknown> } | 마디[] | null | undefined;
  const 모으기 = (node: 마디, out: Record<string, Record<string, unknown>[]>) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach((n) => 모으기(n, out)); return; }
    if (typeof node !== "object") return;
    const t = node.type as { displayName?: string; name?: string } | string | undefined;
    const 이름 = typeof t === "string" ? t : (t?.displayName || t?.name);
    if (이름) (out[이름] ??= []).push(node.props ?? {});
    모으기(node.props?.children as 마디, out);
  };

  return {
    default: ({ children }: { children: (R: never) => unknown }) => {
      const 만들기 = (이름: string) => {
        const C = () => null;
        C.displayName = 이름;
        return C;
      };
      const R = new Proxy({}, { get: (_t, k: string) => 만들기(k) }) as never;
      const 통: Record<string, Record<string, unknown>[]> = {};
      모으기(children(R) as 마디, 통);
      담김.treemap = 통.Treemap?.[0] ?? null;
      담김.tooltip = 통.Tooltip?.[0] ?? null;
      const 데이터 = (담김.treemap?.data ?? []) as Record<string, unknown>[];
      return (
        <div data-testid="지도">
          {데이터.map((d) => (
            <span key={String(d.key)} data-testid={`칸-${String(d.key)}`}>
              {`${String(d.name)}|${String(d.value)}|${String(d.배색)}`}
            </span>
          ))}
        </div>
      );
    },
  };
});

import 자산지도, { 칸색, 글씨색, 짙어지는등락, 짙기상한, 짙기바닥, 무채색, 칸이름, type 지도칸 } from "@/components/portfolio/AssetTreemap";

const 오름초록 = "16,185,129";
const 내림빨강 = "239,68,68";
const 내림파랑 = "59,130,246";
/* 무채색은 소스에서 그대로 가져온다(위 import). 여기에 값을 베껴
   적으면 색을 바꿀 때 검사만 통과하고 화면은 안 바뀌는 일이 생긴다 —
   실제로 처음에는 var(--bg-elevated) 였는데, 그 색이 카드 배경과
   거의 같아 화면에서 그 칸만 통째로 사라졌다(찍어 보고 알았다) */

/** "rgba(16, 185, 129, 0.9)" → { 색, 진하기 }.
 *
 *  jsdom 이 인라인 style 을 다시 조립하면서 공백을 넣고 끝자리 0 을 떼기
 *  때문에("0.90" → "0.9") 문자열끼리 비교하면 안 된다. 숫자로 뜯어서 본다. */
function 뜯기(색: string): { 색: string; 진하기: number } | null {
  const m = /rgba?\(([^)]+)\)/.exec(색);
  if (!m) return null;
  const n = m[1].split(",").map((s) => Number(s.trim()));
  if (n.length < 4 || n.some(Number.isNaN)) return null;
  return { 색: n.slice(0, 3).join(","), 진하기: n[3] };
}

/** 칸색이 실제로 낸 진하기(알파). 무채색이면 여기서 걸린다 */
function 진하기(등락률: number, 배색: "green-red" | "red-blue" = "green-red"): number {
  const 조각 = 뜯기(칸색(등락률, 배색));
  /* toBeCloseTo 는 null 을 0 처럼 받아 준다. 색이 통째로 사라져도
     "진하기가 0에 가깝다" 로 통과해 버리므로 먼저 못 박는다 */
  expect(조각).not.toBeNull();
  return 조각!.진하기;
}

/** 칸색이 낸 rgb 세 값 */
function 색만(등락률: number, 배색: "green-red" | "red-blue"): string {
  const 조각 = 뜯기(칸색(등락률, 배색));
  expect(조각).not.toBeNull();
  return 조각!.색;
}

const 칸 = (덧: Partial<지도칸> = {}): 지도칸 => ({
  key: "005930", name: "삼성전자", value: 9_250_000, 등락률: 0.82, 비중: 42.5, ...덧,
});

function 그리기(칸들: 지도칸[], 덧: { 가림?: boolean } = {}) {
  return render(<자산지도 칸들={칸들} {...덧} />);
}

/** 지도가 실제로 칸을 그릴 때 쓰는 부품(content)을 손으로 한 칸 그려 본다.
 *
 *  칸색·글씨색이 맞게 계산돼도 rect 에 안 물려 있으면 지도는 그냥 회색이다 —
 *  함수가 있는지만 보면 그 상태로도 통과한다. */
function 한칸그리기(덧: Record<string, unknown>) {
  const 부품 = 담김.treemap?.content as ReactElement | undefined;
  expect(부품).toBeTruthy();
  return render(
    <svg>{cloneElement(부품!, { x: 0, y: 0, width: 120, height: 80, name: "삼성전자", ...덧 })}</svg>,
  );
}

beforeEach(() => {
  설정.colorScheme = "green-red";
  담김.treemap = null;
  담김.tooltip = null;
});


describe("칸 색 — 색이 어긋나면 화면은 멀쩡한 채로 거짓말을 한다", () => {
  it("시세를 못 받은 칸은 무채색이다 — 안 움직인 칸과 같은 회색인 게 의도다", () => {
    /* 0% 와 null 을 같은 회색으로 둔다. 헷갈릴 법하지만 일부러 그렇다 —
       '안 움직였다' 와 '모른다' 는 둘 다 "오늘 볼 게 없는 칸" 이고,
       둘을 다른 색으로 나누면 아무 뜻도 없는 색이 하나 더 늘어난다.
       무엇이 회색인지는 아래 범례가 글로 설명한다.

       지금 동작을 그대로 못 박아 둔다. 나중에 둘을 갈라야 한다면
       이 검사가 먼저 걸려서 '의도한 변경인가' 를 묻게 된다. */
    expect(칸색(null, "green-red")).toBe(무채색);
    expect(칸색(0, "green-red")).toBe(무채색);
    // 배색을 바꿔도 회색은 회색이다
    expect(칸색(null, "red-blue")).toBe(무채색);
    expect(칸색(0, "red-blue")).toBe(무채색);
  });

  it("등락 색상 설정을 따른다 — 안 따르면 같은 화면에서 빨강이 오름이자 내림이 된다", () => {
    /* 네 칸을 다 확인한다. 빨강(239,68,68)이 green-red 에서는 내림이고
       red-blue 에서는 오름이라, 한쪽만 보면 오름/내림을 맞바꾼 뮤테이션이
       그대로 통과한다. */
    expect(색만(2, "green-red")).toBe(오름초록);
    expect(색만(-2, "green-red")).toBe(내림빨강);
    expect(색만(2, "red-blue")).toBe(내림빨강);   // 같은 빨강이 여기선 오름
    expect(색만(-2, "red-blue")).toBe(내림파랑);
  });

  it("많이 움직인 칸일수록 짙다 — 진하기가 고정이면 지도는 그냥 색칠 놀이다", () => {
    /* 바닥(0.18) + 폭(상한-바닥) / 3%(꼭대기) 를 실제 값으로 못 박는다.
       세 점을 다 보는 이유: 꼭대기 한 점만 보면 바닥과 폭을 함께 옮긴
       뮤테이션이 같은 꼭대기 값을 내고 빠져나간다. */
    /* 값은 toFixed(2) 로 잘려 나오므로 반올림 경계(…5)는 피해서 고른다 */
    expect(진하기(0.5)).toBeCloseTo(0.24, 5);    // 0.18 + (0.5/3)*0.37
    expect(진하기(1)).toBeCloseTo(0.30, 5);      // 0.18 + (1/3)*0.37
    expect(진하기(2)).toBeCloseTo(0.43, 5);      // 0.18 + (2/3)*0.37
    expect(진하기(3)).toBeCloseTo(짙기상한, 5);  // 꼭대기
    // 순서 자체도 못 박는다 — 부등호가 뒤집히면 큰 등락이 흐려진다
    expect(진하기(0.5)).toBeLessThan(진하기(1.5));
    expect(진하기(1.5)).toBeLessThan(진하기(3));
  });

  it("3% 를 넘으면 더는 안 짙어진다 — 상한이 없으면 20% 간 하루가 나머지를 다 흐리게 만든다", () => {
    /* Math.min 한 조각을 지우면 6% 짜리가 알파 1.62 가 된다. 브라우저가
       알아서 1 로 자르니 그 칸만 보면 멀쩡하고, 대신 3%~6% 사이의 차이가
       전부 뭉개진다 — 화면으로는 절대 안 보이는 종류의 잘못이다. */
    expect(칸색(6, "green-red")).toBe(칸색(3, "green-red"));
    expect(칸색(20, "green-red")).toBe(칸색(3, "green-red"));
    expect(진하기(6)).toBeCloseTo(짙기상한, 5);
    // 내림 쪽도 똑같이 잘려야 한다
    expect(칸색(-6, "green-red")).toBe(칸색(-3, "green-red"));
  });

  it("진하기는 부호가 아니라 크기로 정한다 — -2% 와 +2% 는 색만 다르고 똑같이 짙다", () => {
    expect(진하기(-1.5)).toBeCloseTo(진하기(1.5), 5);
    expect(진하기(-2)).toBeCloseTo(진하기(2), 5);
    // 색은 달라야 한다(같으면 부호를 통째로 잃은 것이다)
    expect(색만(2, "green-red")).not.toBe(색만(-2, "green-red"));
  });

  it("조금 움직인 칸도 바탕과는 구분된다 — 바닥이 0이면 0.1% 짜리가 회색과 똑같아진다", () => {
    /* 바닥값 0.18 을 직접 짚는다. 0.01% 는 곱해지는 부분이 거의 0이라
       남는 것이 바닥뿐이다. */
    expect(진하기(0.01)).toBeCloseTo(0.18, 2);
    expect(진하기(0.01)).toBeGreaterThan(0);
  });
});


describe("글씨 색 — 제일 많이 움직인 칸의 이름이 제일 안 읽히면 안 된다", () => {
  it("글씨는 어느 칸에서든 테마 글자색이다 — 흰 글씨는 밝은 테마에서 안 읽혔다", () => {
    /* 예전에는 진한 칸에 흰 글씨를 얹었다. 두 테마에서 실제 대비를 재
       보니 밝은 테마에서 흰 글씨가 **어느 진하기에서도** 4.5:1 을 못
       넘었다(제일 좋은 값이 3.4:1). 칸이 알파라서 흰 바탕 위에서는
       아무리 진해도 옅은 분홍·연두에 머무는 탓이다.

       글자도 바탕색을 따라가는 테마 글자색이면 두 테마 모두에서 맞는다.
       흰색이 한 자리라도 되살아나면 그 칸이 밝은 테마에서 안 읽힌다. */
    for (const v of [null, 0, 0.3, 1.33, 1.34, 3, -3, 20]) {
      expect(글씨색(), `등락률 ${v}`).toBe("var(--text-primary)");
    }
  });

  it("짙기 상한이 대비를 지키는 선 안에 있다", () => {
    /* 상한을 도로 0.9 로 올리면 어두운 테마에서 초록 칸 글자가
       2.4:1 까지 떨어진다 — 화면으로는 '조금 흐리네' 로만 보인다.
       0.55 는 그때 잰 값 중 제일 나쁜 경우가 4.62:1 이 되는 자리다. */
    expect(짙기상한).toBeLessThanOrEqual(0.55);
    expect(짙기상한).toBeGreaterThan(짙기바닥);
  });
});


describe("빈 지도", () => {
  it("칸이 하나도 없으면 빈 상자 대신 왜 비었는지 말한다", () => {
    그리기([]);
    expect(screen.getByText("그릴 자산이 없어요")).toBeInTheDocument();
    expect(screen.queryByTestId("지도")).not.toBeInTheDocument();
  });

  it("값이 0 이하인 칸은 안 그린다 — recharts 는 넓이가 음수인 칸을 못 그린다", () => {
    /* 현금을 0원으로 적어 둔 사람이 실제로 있다. 그대로 넘기면 지도
       전체가 깨진다(한 칸이 아니라 전체다). `> 0` 을 `>= 0` 으로 바꾸는
       뮤테이션을 잡으려고 0원짜리와 음수짜리를 둘 다 넣는다. */
    그리기([
      칸({ key: "cash", name: "현금", value: 0, 등락률: null, 비중: 0 }),
      칸({ key: "bad", name: "이상한것", value: -100, 등락률: null, 비중: 0 }),
      칸({ key: "005930", name: "삼성전자", value: 9_250_000 }),
    ]);
    expect(screen.queryByTestId("칸-cash")).not.toBeInTheDocument();
    expect(screen.queryByTestId("칸-bad")).not.toBeInTheDocument();
    expect(screen.getByTestId("칸-005930")).toHaveTextContent("삼성전자|9250000");
  });

  it("남는 칸이 하나도 없으면 그릴 게 없다고 말한다 — 0원짜리만 있는 사람이 있다", () => {
    그리기([
      칸({ key: "cash", name: "현금", value: 0, 등락률: null, 비중: 0 }),
      칸({ key: "bad", name: "이상한것", value: -1, 등락률: null, 비중: 0 }),
    ]);
    expect(screen.getByText("그릴 자산이 없어요")).toBeInTheDocument();
    expect(screen.queryByTestId("지도")).not.toBeInTheDocument();
  });
});


describe("지도에 넘기는 것", () => {
  it("칸마다 지금 배색을 실어 보낸다 — 안 실으면 칸이 기본값(초록/빨강)으로 그려진다", () => {
    /* 칸을 그리는 부품은 recharts 가 부르므로 설정을 직접 못 읽는다.
       데이터에 얹어 보내는 수밖에 없고, 그 한 줄이 빠지면 빨강/파랑을
       쓰는 사람 화면에만 이 지도가 초록으로 남는다. */
    const { unmount } = 그리기([칸()]);
    expect(screen.getByTestId("칸-005930")).toHaveTextContent("|green-red");
    unmount();

    설정.colorScheme = "red-blue";
    그리기([칸()]);
    expect(screen.getByTestId("칸-005930")).toHaveTextContent("|red-blue");
  });

  it("칸 바탕과 글자에 그 색을 실제로 쓴다 — 함수만 있고 안 쓰면 지도는 온통 회색이다", () => {
    그리기([칸()]);
    const { container } = 한칸그리기({ 등락률: 3, 배색: "green-red" });
    const 네모 = container.querySelector("rect")!;
    // SVG fill 은 속성이라 문자열이 그대로 남는다
    expect(네모.getAttribute("fill")).toBe(`rgba(${오름초록},${짙기상한.toFixed(2)})`);
    const 글자들 = Array.from(container.querySelectorAll("text"));
    expect(글자들.length).toBeGreaterThan(0);
    글자들.forEach((t) => {
      expect(t.getAttribute("fill")).toBe("var(--text-primary)");
      /* stroke 를 안 끄면 Treemap 의 칸 가르는 선이 글자에까지 물려
         내려와 라벨이 뭉개진다 — 실제 화면에서 그랬다 */
      expect(t.getAttribute("stroke")).toBe("none");
    });
  });

  it("옅은 칸은 옅게 그린다 — fill 을 상수로 박으면 지도가 단색이 된다", () => {
    /* 위 검사와 짝이다. 한 값만 보면 fill 을 상수로 박아 둔 뮤테이션이
       통과한다. */
    그리기([칸()]);
    const { container } = 한칸그리기({ 등락률: 0.5, 배색: "green-red" });
    expect(container.querySelector("rect")!.getAttribute("fill"))
      .toBe(`rgba(${오름초록},${진하기(0.5).toFixed(2)})`);
    expect(container.querySelector("text")!.getAttribute("fill")).toBe("var(--text-primary)");
  });

  it("시세 없는 칸은 회색 바탕에 검은 글씨다", () => {
    그리기([칸()]);
    const { container } = 한칸그리기({ 등락률: null, 배색: "green-red" });
    expect(container.querySelector("rect")!.getAttribute("fill")).toBe(무채색);
    expect(container.querySelector("text")!.getAttribute("fill")).toBe("var(--text-primary)");
  });
});


describe("색 범례", () => {
  it("색이 무엇을 뜻하는지 적어 둔다 — 없으면 회색 칸이 왜 회색인지 알 수 없다", () => {
    그리기([칸()]);
    /* 화면 전체에서 문자열을 찾으면 칸 이름이나 툴팁이 걸린다.
       범례 안으로 좁혀서 본다 */
    const 범례 = screen.getByText("오늘 등락").parentElement!;
    expect(within(범례).getByText(`-${짙어지는등락}%`)).toBeInTheDocument();
    expect(within(범례).getByText(`+${짙어지는등락}%`)).toBeInTheDocument();
    expect(짙어지는등락).toBe(3);   // 범례 눈금과 색 계산이 같은 값을 봐야 한다
  });

  it("범례 색이 실제 칸 색과 같다 — 어긋나면 범례가 틀린 설명이 된다", () => {
    그리기([칸()]);
    const 범례 = screen.getByText("오늘 등락").parentElement!;
    const 조각들 = Array.from(범례.querySelectorAll<HTMLElement>("span[style]"));
    expect(조각들).toHaveLength(7);   // -3 -1.5 -0.5 0 0.5 1.5 3

    // 왼쪽 끝은 가장 짙은 내림, 오른쪽 끝은 가장 짙은 오름
    expect(뜯기(조각들[0].style.background)).toEqual(뜯기(칸색(-3, "green-red")));
    expect(뜯기(조각들[6].style.background)).toEqual(뜯기(칸색(3, "green-red")));
    // 가운데는 '시세 없음' 회색이다 — 0을 색으로 칠하면 회색 칸 설명이 사라진다
    expect(조각들[3].style.background).toBe(무채색);
    // 안쪽이 바깥쪽보다 옅어야 눈금이 눈금 구실을 한다
    expect(뜯기(조각들[5].style.background)!.진하기)
      .toBeLessThan(뜯기(조각들[6].style.background)!.진하기);
  });

  it("범례도 등락 색상 설정을 따른다", () => {
    설정.colorScheme = "red-blue";
    그리기([칸()]);
    const 범례 = screen.getByText("오늘 등락").parentElement!;
    const 조각들 = Array.from(범례.querySelectorAll<HTMLElement>("span[style]"));
    expect(뜯기(조각들[0].style.background)!.색).toBe(내림파랑);   // 내림이 파랑
    expect(뜯기(조각들[6].style.background)!.색).toBe(내림빨강);   // 오름이 빨강
  });
});


describe("칸을 짚었을 때 뜨는 말", () => {
  /** 툴팁이 실제로 만들어 내는 문구 */
  function 말(칸들: 지도칸[], 가림: boolean, 짚은칸: 지도칸): [string, string] {
    그리기(칸들, { 가림 });
    const f = 담김.tooltip?.formatter as
      ((v: number, n: string, c: { payload?: 지도칸 }) => [string, string]) | undefined;
    expect(f).toBeTypeOf("function");
    return f!(짚은칸.value, "value", { payload: 짚은칸 });
  }

  it("금액 가리기는 금액만 가린다 — 비중과 등락률까지 가리면 화면이 텅 빈다", () => {
    /* %는 내가 얼마를 가졌는지 말해 주지 않는다. 옆자리에서 보여도
       괜찮은 값이라 가리지 않는다 — 다른 화면들과 같은 규칙이다. */
    const 그것 = 칸();
    const [보임] = 말([그것], false, 그것);
    expect(보임).toContain("₩925.0만");
    expect(보임).not.toContain(가린글);

    const [가려짐, 이름] = 말([그것], true, 그것);
    expect(가려짐).toContain(가린글);
    expect(가려짐).not.toContain("925");
    // 가려도 남아야 하는 것들
    expect(가려짐).toContain("(42.5%)");
    expect(가려짐).toContain("오늘 +0.82%");
    expect(이름).toBe("삼성전자");
  });

  it("시세를 못 받은 칸에는 '오늘' 을 안 붙인다 — 0% 라고 적으면 안 움직였다는 말이 된다", () => {
    const 현금 = 칸({ key: "cash", name: "현금", value: 500_000, 등락률: null, 비중: 5 });
    const [본문] = 말([현금], false, 현금);
    expect(본문).toContain("(5.0%)");
    expect(본문).not.toContain("오늘");
  });

  it("내린 칸은 부호까지 적는다", () => {
    const 그것 = 칸({ 등락률: -1.5 });
    const [본문] = 말([그것], false, 그것);
    expect(본문).toContain("오늘 -1.50%");
  });
});

describe("칸 너비에 맞춘 이름", () => {
  /* 예전에는 여덟 글자로 못 박았다. 칸 너비는 비중에 따라 제각각인데
     한 값으로 자르면, 좁은 칸에서는 글자가 옆 칸으로 삐져나가고 넓은
     칸에서는 쓸 수 있는 자리를 놀린다. 실제 화면(390px)에서 제일 작은
     칸이 54px 이었다 — 거기에 여덟 글자가 들어갈 수 없다. */
  it("넓으면 이름을 그대로 쓴다", () => {
    expect(칸이름("삼성전자", 200)).toBe("삼성전자");
  });

  it("좁으면 들어갈 만큼만 쓰고 말줄임을 붙인다", () => {
    const 잘린것 = 칸이름("에스케이하이닉스", 54);
    expect(잘린것).toMatch(/…$/);
    // 자른 뒤 길이가 칸에 실제로 들어가야 한다(글자 하나 ≈ 11px)
    expect(잘린것.length * 11).toBeLessThanOrEqual(54);
    // 통째로 넣는 옛 방식이었으면 훨씬 길었다
    expect(잘린것.length).toBeLessThan("에스케이하이닉스".length);
  });

  it("두 글자도 못 넣을 만큼 좁으면 아예 안 쓴다", () => {
    /* 한 글자만 남은 이름은 읽히지도 않으면서 칸만 어지럽힌다 */
    expect(칸이름("삼성전자", 24)).toBe("");
    expect(칸이름("삼성전자", 8)).toBe("");
  });

  it("칸이 넓어질수록 더 많이 들어간다 — 너비를 안 보면 늘 같은 길이가 나온다", () => {
    const 짧은칸 = 칸이름("에스케이하이닉스", 54);
    const 넓은칸 = 칸이름("에스케이하이닉스", 120);
    expect(넓은칸.length).toBeGreaterThan(짧은칸.length);
  });
});
