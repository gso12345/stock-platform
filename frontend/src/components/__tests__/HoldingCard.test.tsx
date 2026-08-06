/**
 * 내 자산 보유종목 카드 —
 * "현재가 +500(1.23%) 이거 줄바꿈 없이 표현", "앱느낌 나도록 깔끔하게"
 *
 * 예전 카드는 아래에 3칸 격자가 있었고, 그 한 칸 안에 현재가와 전일대비가
 * 세로로 쌓여 있었다. 휴대폰 폭 390px 에서 한 칸은 약 110px 이라
 * "₩185,000" 과 "+1,500 (+0.82%)" 가 같이 못 들어가 줄이 갈라졌다.
 *
 * 현재가는 종목명 옆이 제자리다 — 다른 증권 앱들도 종목 오른쪽에 시세를
 * 붙인다. 그 자리는 카드 폭의 절반을 쓸 수 있어 한 줄에 들어간다.
 *
 * 여기서 못 박는 것 —
 *   1) 현재가와 전일대비가 같은 묶음에 있고, 줄바꿈을 막아 뒀다
 *   2) 평가금액이 카드에서 제일 크다 (이 카드를 보는 이유)
 *   3) 참고값(수량·평단·비중)은 한 줄로 낮춘다
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HoldingRow원문 from "../portfolio/HoldingRow.tsx?raw";

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (sel?: any) => {
    const s = { colorScheme: "green-red" };
    return sel ? sel(s) : s;
  },
}));

import { HoldingCard } from "../portfolio/HoldingRow";

const 종목: any = {
  id: 1, symbol: "005930", market: "KR", name: "삼성전자",
  shares: 50, avgPrice: 100000, currency: "KRW",
  currentPriceNative: 185000, currentValueKRW: 9_250_000,
  costKRW: 5_000_000, pnlKRW: 4_250_000, pnlRate: 85, weight: 42.5,
  전일대비율: 0.82, 전일대비액: 1500,
  isForexItem: false, nativeAvgPrice: 100000, nativeValue: 9_250_000, nativePnl: 4_250_000,
};

function 그리기(덧 = {}) {
  return render(
    <MemoryRouter>
      <HoldingCard
        item={{ ...종목, ...덧 }} hasPrice pnlClass="text-accent-green"
        showAsNative={false} exchangeRate={1385} isAllView={false} isLoggedIn
        onNavigate={() => {}} onEdit={() => {}} onDelete={() => {}} onPrefetch={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("현재가와 전일대비", () => {
  it("한 묶음 안에 나란히 있다", () => {
    /* 서로 다른 칸에 있으면 그 사이에서 줄이 갈라진다 */
    그리기();
    const 등락 = screen.getByText(/\+1,500 \(\+0\.82%\)/);
    const 묶음 = 등락.parentElement!;
    expect(within(묶음).getByText(/185,000/)).toBeInTheDocument();
  });

  it("등락 표기가 줄바꿈되지 않는다", () => {
    /* 좁은 칸에서 "+1,500" 과 "(+0.82%)" 가 갈라지면 읽기 어렵다 */
    const { container } = 그리기();
    const 등락 = screen.getByText(/\+1,500 \(\+0\.82%\)/);
    expect(등락.className).toMatch(/whitespace-nowrap/);
    expect(container).toBeTruthy();
  });

  it("현재가가 3칸 격자 안에 갇혀 있지 않다", () => {
    /* 예전 구조로 되돌아가면 다시 갈라진다. 격자 칸 하나는 휴대폰에서
       110px 남짓이라 금액 두 개가 못 들어간다 */
    expect(HoldingRow원문).not.toMatch(/grid-cols-3[\s\S]{0,600}현재가/);
  });

  it("원화로 볼 때 해외 종목도 원화 형식으로 찍는다", () => {
    /* 금액은 원화로 환산해 놓고 통화만 USD 로 두면 소수점이 붙는다.
       실제 화면에서 엔비디아가 "+25390.76 (+2.14%)" 로 나왔다 —
       원화에 소수점 두 자리는 없다 */
    그리기({
      market: "US", symbol: "NVDA", name: "엔비디아",
      isForexItem: true, 전일대비액: 18.73, 전일대비율: 2.14,
      currentPriceNative: 875,
    });
    // 18.73 × 1385 ≒ 25,941 — 소수점 없이
    expect(screen.getByText(/^\+[\d,]+ \(\+2\.14%\)$/)).toBeInTheDocument();
    expect(screen.queryByText(/\+\d+\.\d\d \(/)).toBeNull();
  });

  it("외화로 볼 때는 달러 형식 그대로", () => {
    const { container } = render(
      <MemoryRouter>
        <HoldingCard
          item={{ ...종목, market: "US", symbol: "NVDA", isForexItem: true,
                  전일대비액: 18.73, 전일대비율: 2.14, currentPriceNative: 875 }}
          hasPrice pnlClass="text-accent-green"
          showAsNative exchangeRate={1385} isAllView={false} isLoggedIn
          onNavigate={() => {}} onEdit={() => {}} onDelete={() => {}} onPrefetch={() => {}}
        />
      </MemoryRouter>,
    );
    expect(container.textContent).toMatch(/\+18\.73 \(\+2\.14%\)/);
  });

  it("금액이 없을 때도 안 깨진다", () => {
    /* 현금이나 시세 미수신 종목은 전일대비가 없다 */
    그리기({ 전일대비율: null, 전일대비액: null });
    expect(screen.getByText(/185,000/)).toBeInTheDocument();
  });
});

describe("무엇이 제일 크게 보이나", () => {
  it("평가금액이 카드에서 가장 크다", () => {
    /* 이 카드를 보는 이유다. 예전에는 평가손익과 같은 크기(text-base)라
       무엇을 먼저 볼지 눈이 헤맸다 */
    그리기();
    const 평가금액 = screen.getByText("평가금액").parentElement!
      .querySelector("span:last-child")!;
    expect(평가금액.className).toMatch(/text-lg/);
  });

  it("평가손익은 금액과 비율을 한 줄로 적는다", () => {
    그리기();
    expect(screen.getByText(/\+₩4,250,000 \(\+85\.00%\)/)).toBeInTheDocument();
  });
});

describe("참고값은 낮춘다", () => {
  it("수량·평단이 한 줄로 붙는다", () => {
    /* 예전에는 라벨과 값이 각각 두 줄씩 세 칸을 차지해 카드 높이의
       3분의 1을 먹었다 */
    그리기();
    expect(screen.getByText(/50주 · 평단/)).toBeInTheDocument();
  });

  it("비중도 같은 줄에 남는다", () => {
    그리기();
    expect(screen.getByText("42.5%")).toBeInTheDocument();
  });

  it("수정·삭제 버튼은 종목명 옆자리를 뺏지 않는다", () => {
    /* 거기는 시세 자리다. 버튼이 위에 있으면 시세가 밀려 좁아지고,
       좁아지면 다시 줄이 갈라진다 */
    const i = HoldingRow원문.indexOf("export const HoldingCard");
    const j = HoldingRow원문.indexOf("export const HoldingTableRow");
    const 카드 = HoldingRow원문.slice(i, j);
    const 시세자리 = 카드.indexOf("전일대비율 != null");
    const 수정버튼 = 카드.indexOf("onEdit(item)");
    expect(시세자리).toBeGreaterThan(-1);
    expect(수정버튼).toBeGreaterThan(시세자리);
  });
});
