/**
 * 주가예측 서버 주소 — 화면 시험은 predictApi 를 통째로 흉내 내서, 주소가 틀려도 지나간다(가치 위치 주소를 바꾼 변이가
 * 살아남았다). 여기서는 axios 만 가짜로 두고 실제로 부른 주소를 본다(backend/app/api/routes/predict.py).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const 부른것: string[] = [];

vi.mock("../client", async () => {
  const 실제 = await vi.importActual<typeof import("../client")>("../client");
  return {
    ...실제,
    default: {
      get: (url: string) => {
        부른것.push(url);
        return Promise.resolve({ data: { 받음: url } });
      },
    },
  };
});

import { predictApi } from "../predict";

beforeEach(() => { 부른것.length = 0; });

describe("주가예측 주소", () => {
  it("예측 — /predict/{시장}/{종목}", async () => {
    expect(await predictApi.get("KR", "005930")).toEqual({ 받음: "/predict/KR/005930" });
  });

  it("가치 위치 — /predict/{시장}/{종목}/valuation, 종목 코드는 주소에 맞게 감싼다", async () => {
    expect(await predictApi.valuation("US", "BRK.B")).toEqual({ 받음: "/predict/US/BRK.B/valuation" });
    await predictApi.valuation("US", "A/B");
    expect(부른것).toEqual(["/predict/US/BRK.B/valuation", "/predict/US/A%2FB/valuation"]);
  });
});
