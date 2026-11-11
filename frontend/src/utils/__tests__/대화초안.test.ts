/**
 * 쓰던 메시지(utils/대화초안) — 방마다·사람마다 이 기기에 남긴다. 로그인·로그아웃 때 사람 칸과 함께 지워진다.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { 초안읽기, 초안쓰기 } from "@/utils/대화초안";
import { 사람칸_모두지우기 } from "@/api/queryPersist";
import { useAuthStore } from "@/store/authStore";

const 로그인 = (userId: number | null) => useAuthStore.setState(
  userId == null
    ? { token: null, userId: null, username: null, isLoggedIn: false, isAdmin: false }
    : { token: "t", userId, username: `u${userId}`, isLoggedIn: true, isAdmin: false });

beforeEach(() => {
  localStorage.clear();
  로그인(1);
});

describe("쓰던 글", () => {
  it("남기고 읽는다 — 로그인한 사람의 칸 아래, 방마다 따로", () => {
    초안쓰기(7, "안녕\n하세요 ");
    expect(초안읽기(7)).toBe("안녕\n하세요 ");      // 쓴 그대로(앞뒤 빈칸·줄바꿈도)
    expect(초안읽기(8)).toBe("");
    expect(localStorage.getItem("qcache_v1:u1:dm-draft:7")).toBe("안녕\n하세요 ");
  });

  it("빈칸뿐이거나 비우면 지운다", () => {
    초안쓰기(7, "보낼 글");
    초안쓰기(7, "  \n ");
    expect(localStorage.getItem("qcache_v1:u1:dm-draft:7")).toBeNull();
    초안쓰기(7, "다시");
    초안쓰기(7, "");
    expect(초안읽기(7)).toBe("");
    expect(localStorage.length).toBe(1);          // 남은 것은 로그인 정보뿐
  });

  it("사람마다 따로 — 다른 사람은 못 읽고, 로그인 전에는 남기지 않는다", () => {
    초안쓰기(7, "1번의 글");
    로그인(2);
    expect(초안읽기(7)).toBe("");
    로그인(null);
    expect(초안읽기(7)).toBe("");
    초안쓰기(7, "로그인 전");
    expect([...Array(localStorage.length).keys()].map((i) => localStorage.key(i))
      .filter((k) => k?.includes("dm-draft"))).toEqual(["qcache_v1:u1:dm-draft:7"]);
  });

  it("로그인·로그아웃 때 사람 칸을 지우면 쓰던 글도 함께 — 같은 기기를 다음에 쓰는 사람에게 안 보인다", () => {
    초안쓰기(7, "남기면 안 되는 글");
    사람칸_모두지우기();
    expect(초안읽기(7)).toBe("");
  });

  it("저장소가 꽉 찼거나 막혀도 조용히 넘어간다 — 쓰던 글 때문에 대화방이 안 열리면 안 된다", () => {
    const 원래읽기 = Storage.prototype.getItem;
    const 쓰기 = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    // 로그인 정보는 읽히고 쓰던 글만 못 읽는 경우까지 — 통째로 막히면 사람칸() 이 먼저 걸러 준다
    const 읽기 = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k: string) {
      if (k.includes("dm-draft")) throw new Error("SecurityError");
      return 원래읽기.call(this, k);
    });
    try {
      expect(() => 초안쓰기(7, "글")).not.toThrow();
      expect(초안읽기(7)).toBe("");
      읽기.mockImplementation(() => { throw new Error("SecurityError"); });
      expect(초안읽기(7)).toBe("");
    } finally {
      쓰기.mockRestore();
      읽기.mockRestore();
    }
  });
});
