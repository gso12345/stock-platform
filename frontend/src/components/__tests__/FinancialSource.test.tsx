/**
 * 재무제표 탭 — 스크리닝과 같은 공시 일괄 자료로 채운 표는 어디 것인지 밝힌다.
 *
 * 사용자: "스크리닝이랑 재무제표가 같이 연동되야하는 거 아니야?" — 종목 상세는 종목별 원천(야후·FMP·DART 단일)만
 * 봐서, 운영에서 야후가 막히면 스크리닝에 매출·순이익이 있는 종목도 재무제표가 비었다. 서버가 그때 스크리닝과 같은
 * 일괄 원천(미국 SEC·국내 DART)으로 연간 표를 채우고 source 를 붙인다 — 분기는 없다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import 재무제표탭 from "../stock/FinancialTab";

/* 지표 이력(야후 — mh)은 비었고 재무제표 응답만 있는 상태. 화면(StockDetail)은 두 쪽의 해를 합쳐 mhYears 로,
   표의 값은 getVal 로 준다(지표 이력 → 재무제표 응답) */
function 그리기(financials: any, isKR = false, finSubTab = "income") {
  const 연간: any[] = financials?.annual ?? [];
  const 해들 = 연간.map((r) => r.period);
  return render(
    <재무제표탭 customMetricKeys={[]} d={{}} exchangeRate={1400} finPeriod="annual" finSubTab={finSubTab}
      finTabData={{
        mh: [], dEnhanced: {}, mhYears: 해들, allYears: 해들,
        getVal: (k: string, y: string) => 연간.find((r) => r.period === y)?.[k] ?? null,
      }}
      financials={financials} isKR={isKR} isMobile={false} loadingFin={false} selectedMetric="revenue"
      setFinPeriod={vi.fn()} setSelectedMetric={vi.fn()} setShowCustomSelector={vi.fn()} setShowKRW={vi.fn()}
      showCustomSelector={false} showKRW={false} updateCustomMetricKeys={vi.fn()} />,
  );
}

describe("재무제표 — 스크리닝과 같은 공시 일괄 자료", () => {
  it("서버가 일괄 자료로 채운 표면 어디 것인지 밝힌다(미국 SEC · 연간만)", () => {
    그리기({ annual: [{ period: "2024", revenue: 96e9 }, { period: "2025", revenue: 120e9 }], quarterly: [], source: "SEC" });
    expect(screen.getByText("스크리닝과 같은 미국 SEC 공시 일괄 자료 · 연간만")).toBeTruthy();
    expect(screen.getAllByText("2025").length).toBeGreaterThan(0);
  });

  it("국내는 DART — 종목별 원천(야후·FMP·DART 단일)의 표에는 붙이지 않는다", () => {
    const { unmount } = 그리기({ annual: [{ period: "2025", revenue: 1e12 }], quarterly: [], source: "DART" }, true);
    expect(screen.getByText("스크리닝과 같은 DART 공시 일괄 자료 · 연간만")).toBeTruthy();
    unmount();
    그리기({ annual: [{ period: "2025", revenue: 1e12 }], quarterly: [] }, true);
    expect(screen.queryByText(/공시 일괄 자료/)).toBeNull();
  });

  it("DART 키가 없을 때 채운 네이버 연간 실적은 네이버라고 — 공시 일괄 자료라고 하지 않는다", () => {
    그리기({ annual: [{ period: "2024", revenue: 66e12 }], quarterly: [], source: "네이버" }, true);
    expect(screen.getByText("스크리닝과 같은 네이버 증권 연간 실적 · 연간만")).toBeTruthy();
    expect(screen.queryByText(/공시 일괄 자료/)).toBeNull();
  });

  it("차트도 아래 표와 같은 값 — 지표 이력(야후)이 비어도 '연결 중...' 에 머물지 않는다", () => {
    const 연간 = [{ period: "2024", revenue: 96e9 }, { period: "2025", revenue: 120e9, operating_cf: 25e9, free_cf: 20e9 }];
    const { unmount } = 그리기({ annual: 연간, quarterly: [], source: "SEC" }, false, "basic");
    expect(screen.queryByText("연결 중...")).toBeNull();
    unmount();
    그리기({ annual: 연간, quarterly: [], source: "SEC" }, false, "cashflow");
    expect(screen.getByText("영업 / 투자 / 재무 현금흐름")).toBeTruthy();
    expect(screen.getByText("잉여현금흐름 (FCF)")).toBeTruthy();
  });

  it("값이 하나도 없으면 차트 자리는 기다리는 글, 현금흐름 차트는 세우지 않는다", () => {
    const { unmount } = 그리기({ annual: [], quarterly: [] }, false, "basic");
    expect(screen.getAllByText("연결 중...").length).toBeGreaterThan(0);
    unmount();
    그리기({ annual: [{ period: "2025", revenue: 1 }], quarterly: [] }, false, "cashflow");
    expect(screen.queryByText("영업 / 투자 / 재무 현금흐름")).toBeNull();
  });
});
