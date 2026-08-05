/**
 * 피드 요청에 무엇이 실려 나가는가.
 *
 * 화면 쪽 테스트는 communityApi.getFeed 를 통째로 가짜로 바꾼다. 그래서
 * "화면이 검색어를 넘겼다" 까지는 잡지만, 그 다음 한 칸 — 실제로 HTTP
 * 파라미터에 실리는지 — 은 아무도 안 본다. 거기가 비면 검색창은 잘 동작하는
 * 척하면서 서버에는 아무것도 안 간다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const get = vi.fn(() => Promise.resolve({ data: {} }));
vi.mock("../client", () => ({
  default: { get: (...a: any[]) => get(...(a as [])) },
  API_BASE: "",
}));

import { communityApi } from "../stocks";

/* .at(-1) 은 이 프로젝트의 TS lib 목표(es2021)에 아직 없다 */
const 마지막호출 = () => get.mock.calls[get.mock.calls.length - 1] as any[];
const 파라미터 = () => 마지막호출()[1].params;

beforeEach(() => get.mockClear());

describe("피드 요청 파라미터", () => {
  it("검색어를 q 로 실어 보낸다", async () => {
    await communityApi.getFeed(1, "latest", undefined, false, "삼성");
    expect(파라미터().q).toBe("삼성");
  });

  it("검색 안 할 때는 q 를 아예 안 붙인다", async () => {
    /* q= 빈 값으로 보내면 서버 캐시 키가 갈려, 검색 안 한 피드의
       캐시를 못 쓴다 */
    await communityApi.getFeed(1, "latest");
    expect("q" in 파라미터()).toBe(false);
  });

  it("빈 문자열도 안 붙인다", async () => {
    await communityApi.getFeed(1, "latest", undefined, false, "");
    expect("q" in 파라미터()).toBe(false);
  });

  it("검색어와 다른 조건이 같이 간다", async () => {
    /* 하나가 다른 하나를 밀어내면, 시장 필터를 켠 채로는 검색이 안 된다 */
    await communityApi.getFeed(3, "likes", "KR", true, "반도체");
    expect(파라미터()).toMatchObject({
      page: 3, sort: "likes", market: "KR", following: true, q: "반도체",
    });
  });

  it("주소는 그대로다", async () => {
    await communityApi.getFeed(1, "latest", undefined, false, "삼성");
    expect(마지막호출()[0]).toBe("/community/feed");
  });
});
