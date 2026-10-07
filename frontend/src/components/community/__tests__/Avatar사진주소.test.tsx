/**
 * 목록은 프로필 사진을 주소(API 기준 상대 경로)로 보낸다 — 앞에 API 주소를 붙인다.
 * 내 프로필처럼 사진을 그대로(data:) 주는 곳은 그대로 쓴다.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Avatar, { 사진주소 } from "../Avatar";
import { API_BASE } from "@/api/client";

describe("프로필 사진 주소", () => {
  it("상대 경로면 API 주소를 붙인다", () => {
    expect(사진주소("/community/users/3/avatar?v=9")).toBe(`${API_BASE}/community/users/3/avatar?v=9`);
  });
  it("data: 는 그대로", () => {
    expect(사진주소("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
  });
  it("없으면 없다", () => {
    expect(사진주소(null)).toBeNull();
    expect(사진주소("")).toBeNull();
  });
  it("그림은 화면에 들어올 때 받는다", () => {
    const { container } = render(
      <MemoryRouter><Avatar username="가" colorIndex={0} avatarUrl="/community/users/3/avatar?v=9" /></MemoryRouter>,
    );
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(`${API_BASE}/community/users/3/avatar?v=9`);
    expect(img.getAttribute("loading")).toBe("lazy");
  });
});
