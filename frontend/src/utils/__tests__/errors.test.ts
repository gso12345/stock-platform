import { describe, it, expect } from "vitest";
import { extractErrorMessage } from "../errors";

describe("extractErrorMessage", () => {
  it("문자열 detail을 그대로 쓴다", () => {
    const err = { response: { data: { detail: "이미 추가된 종목입니다" } } };
    expect(extractErrorMessage(err)).toBe("이미 추가된 종목입니다");
  });

  it("유효성 검사 배열에서 msg만 뽑아 합친다", () => {
    // 배열을 그대로 뿌리면 화면에 [object Object]가 노출된다
    const err = {
      response: { data: { detail: [
        { loc: ["body", "shares"], msg: "0보다 커야 합니다", type: "value_error" },
        { loc: ["body", "avg_price"], msg: "숫자여야 합니다", type: "type_error" },
      ] } },
    };
    const msg = extractErrorMessage(err);
    expect(msg).toBe("0보다 커야 합니다, 숫자여야 합니다");
    expect(msg).not.toContain("[object Object]");
  });

  it("detail이 없으면 예외 메시지로 넘어간다", () => {
    expect(extractErrorMessage(new Error("Network Error"))).toBe("Network Error");
  });

  it("아무것도 없으면 기본 문구를 쓴다", () => {
    expect(extractErrorMessage({})).toBe("알 수 없는 오류가 발생했습니다");
    expect(extractErrorMessage(null, "추가 실패")).toBe("추가 실패");
  });

  it("빈 문자열 detail은 무시하고 다음 후보로 넘어간다", () => {
    const err = { response: { data: { detail: "   " } }, message: "Request failed" };
    expect(extractErrorMessage(err)).toBe("Request failed");
  });
});
