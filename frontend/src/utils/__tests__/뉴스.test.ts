/**
 * 같은 기사는 한 번만, 이름표(key)는 겹치지 않게 — 국내·미국을 오가면 뉴스가 섞이던 오류(News.섞임.test)의 바탕.
 */
import { describe, it, expect } from "vitest";
import { 같은기사빼기, 기사열쇠 } from "@/utils/뉴스";

const 기사 = (title: string, link: string | null, source = "이투데이") => ({ title, link, source });

describe("같은기사빼기", () => {
  it("주소가 같으면 처음 것만 남긴다 — 순서는 그대로", () => {
    const r = 같은기사빼기([기사("셋", "https://x/3"), 기사("하나", "https://x/1"), 기사("하나 고침", "https://x/1"),
                           기사("둘", "https://x/2")]);
    expect(r.map((a) => a.title)).toEqual(["셋", "하나", "둘"]);
  });

  it("같은 언론사의 같은 제목은 주소 꼬리가 달라도 하나", () => {
    expect(같은기사빼기([기사("홍콩 ELS 제재", "https://x/1?ref=rss"), 기사("홍콩 ELS 제재", "https://x/1")]))
      .toHaveLength(1);
  });

  it("언론사가 다르면 제목이 같아도 남긴다 — 통신사 기사를 받아 쓴 곳마다 출처가 다르다", () => {
    expect(같은기사빼기([기사("금리 동결", "https://a/1", "연합뉴스"), 기사("금리 동결", "https://b/1", "뉴시스")]))
      .toHaveLength(2);
  });

  it("빈 것·없는 것도 안전하다", () => {
    expect(같은기사빼기(undefined)).toEqual([]);
    expect(같은기사빼기(null)).toEqual([]);
    expect(같은기사빼기([null as never, 기사("가", "https://x/1")])).toHaveLength(1);
  });

  it("거른 목록의 이름표는 겹치지 않는다", () => {
    const r = 같은기사빼기([기사("가", "https://x/1"), 기사("가", "https://x/1"), 기사("나", null), 기사("나", ""),
                           기사("다", "  https://x/1  ")]);
    const 열쇠들 = r.map(기사열쇠);
    expect(new Set(열쇠들).size).toBe(열쇠들.length);
  });
});

describe("기사열쇠", () => {
  it("주소, 없으면 제목", () => {
    expect(기사열쇠(기사("가", "https://x/1"))).toBe("주소:https://x/1");
    expect(기사열쇠(기사("가", null))).toBe("제목:가");
    expect(기사열쇠(기사("가", "   "))).toBe("제목:가");
  });

  it("주소와 제목이 같은 글자여도 겹치지 않는다", () => {
    expect(기사열쇠({ title: "x", link: "x" })).not.toBe(기사열쇠({ title: "x", link: null }));
  });
});
