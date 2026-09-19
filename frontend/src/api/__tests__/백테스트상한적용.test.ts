/**
 * 상한을 **실제로 그 호출에 걸었는가.**
 *
 * 상수만 맞게 두고 호출에 안 넘기면 아무 일도 안 일어난다 — 그런데
 * 상수를 보는 검사는 통과한다(실제로 그 뮤테이션이 살아남았다).
 * 그래서 여기서는 axios 를 가짜로 두고 **넘어간 설정**을 본다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const 부른것: any[] = [];

vi.mock("../client", async () => {
  const 실제 = await vi.importActual<typeof import("../client")>("../client");
  return {
    ...실제,
    default: {
      post: (url: string, _body: unknown, config?: any) => {
        부른것.push({ url, config });
        return Promise.resolve({ data: {} });
      },
      get: () => Promise.resolve({ data: {} }),
      put: () => Promise.resolve({ data: {} }),
      delete: () => Promise.resolve({ data: {} }),
    },
  };
});

import { backtestApi } from "../stocks";
import { 무거운상한 } from "../client";

beforeEach(() => { 부른것.length = 0; });

const 무거운것: [string, () => Promise<unknown>][] = [
  ["자산배분", () => backtestApi.runPortfolio({} as never)],
  ["단일 종목", () => backtestApi.run({} as never)],
  ["유니버스", () => backtestApi.runUniverse({} as never)],
];

describe("무거운 백테스트는 긴 상한으로 부른다", () => {
  for (const [이름, 부르기] of 무거운것) {
    it(`${이름} 백테스트`, async () => {
      await 부르기();
      expect(부른것, `${이름} 을 안 불렀다`).toHaveLength(1);
      expect(부른것[0].config?.timeout,
        `${이름} 백테스트가 기본 30초로 나간다 — 자던 서버를 깨우는 동안 끊긴다`)
        .toBe(무거운상한);
    });
  }
});

describe("가벼운 것까지 늘리지는 않는다", () => {
  it("실험 저장은 기본 상한을 쓴다", async () => {
    /* 설정 한 줄을 넣는 것뿐이다. 3분을 기다릴 일이 없다. */
    await backtestApi.saveExperiment({ name: "ㄱ" } as never);
    expect(부른것[0].config?.timeout).toBeUndefined();
  });
});
