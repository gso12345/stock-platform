/**
 * 마이페이지·남의 프로필 — 활동 글을 화면을 열자마자 전부 미리 받지 않는다.
 *
 * 글 하나를 받을 때마다 서버가 조회수를 올리고 DB 를 열 번 넘게 오간다.
 * 예전에는 프로필을 열 때마다 최대 15개를 한꺼번에 받아, 서버에 무거운
 * 요청이 몰리고 열어 보지도 않은 글의 조회수가 올라갔다.
 * 두 화면 모두 무겁게 그려지므로 다른 화면 검사처럼 소스를 본다.
 */
import { describe, it, expect } from "vitest";
import 마이 from "../MyPage.tsx?raw";
import 프로필 from "../UserProfile.tsx?raw";

describe.each([["마이페이지", 마이], ["프로필", 프로필]])("%s", (_, 원문) => {
  it("활동 목록을 돌며 미리 받지 않는다", () => {
    expect(원문).not.toMatch(/activity\.items\.forEach\([\s\S]{0,200}prefetchQuery/);
  });
  it("누를 낌새가 보일 때 그 글만 받는다", () => {
    expect(원문).toMatch(/onPointerEnter=\{\(\) => 글미리받기\(postId\)\}/);
    expect(원문).toMatch(/onPointerDown=\{\(\) => 글미리받기\(postId\)\}/);
    expect(원문).toMatch(/onFocus=\{\(\) => 글미리받기\(postId\)\}/);
  });
  it("이미 받아 둔 글은 다시 받지 않는다", () => {
    expect(원문).toMatch(/if \(qc\.getQueryData\(\["post", postId\]\)\) return;/);
  });
});
