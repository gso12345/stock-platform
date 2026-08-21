/**
 * 그래프 라이브러리를 필요할 때만 받는다.
 *
 * 종목 상세를 열면 recharts(gzip 132KB)가 늘 딸려 왔다. 그런데 그걸 쓰는
 * 곳은 재무제표·투자의견·수급 탭뿐이고, 기본으로 열리는 차트 탭은 전혀
 * 다른 라이브러리(lightweight-charts)를 쓴다. 즉 가격 차트만 보고 나가는
 * 사람도 132KB 를 받고 있었다 — 그 화면이 326KB 인데 40%가 안 쓰는 것이었다.
 *
 * 같은 교훈이 이미 코드에 있었다. Feed 가 PortfolioSnapshot 을 lazy 로
 * 받으며 남긴 주석 — "이걸 정적으로 걸어 두면 recharts 가 피드 청크에
 * 딸려 온다". 정작 가장 자주 열리는 종목 상세에는 그 처리를 안 했다.
 *
 * 여기서 못 박는 것 —
 *   · 정적 import 가 다시 생기지 않는가 (하나만 생겨도 청크가 도로 붙는다)
 *   · 받아 오는 동안 자리를 지키는가 (안 그러면 아래가 밀려 내려간다)
 */
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";

import 차트틀 from "../chart/ChartFrame";

afterEach(cleanup);

const 뿌리 = path.resolve(__dirname, "../..");

function 소스파일들(): string[] {
  const 결과: string[] = [];
  const 훑기 = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "__tests__") 훑기(p);
      } else if (/\.tsx?$/.test(e.name)) {
        결과.push(path.relative(뿌리, p));
      }
    }
  };
  훑기(뿌리);
  return 결과;
}

/* 일부러 정적으로 두는 곳.
   내 자산은 원그래프가 화면의 알맹이다 — 목록보다 먼저 눈에 들어오는
   자리라, 여기서까지 미루면 그림이 늦게 뜬다. 앞선 세션이 그렇게
   판단하고 bundle 검사에 못 박아 뒀고, 그 판단을 그대로 따른다.
   (같은 차트를 쓰는 피드 쪽은 PortfolioSnapshot 이 이미 lazy 로 받는다) */
const 정적허용 = ["pages/Portfolio.tsx"];

describe("recharts 를 정적으로 끌어오지 않는다", () => {
  it("차트틀 말고는 recharts 를 import 하지 않는다", () => {
    /* 한 곳만 정적으로 남아도 청크가 도로 붙어 132KB 를 다시 받는다 */
    const 걸린것 = 소스파일들()
      .filter((f) => f !== "components/chart/ChartFrame.tsx" && !정적허용.includes(f))
      .filter((f) => /from ["']recharts["']/.test(fs.readFileSync(path.join(뿌리, f), "utf-8")));
    expect(걸린것).toEqual([]);
  });

  it("종목 상세는 반드시 미룬다", () => {
    /* 여기가 이번 고침의 핵심이다. 기본으로 열리는 차트 탭은 전혀 다른
       라이브러리를 쓰므로, 가격 차트만 보는 사람은 recharts 가 필요 없다 */
    const s = fs.readFileSync(path.join(뿌리, "pages/StockDetail.tsx"), "utf-8");
    expect(s).not.toMatch(/from ["']recharts["']/);
    expect(s).toContain("차트틀");
  });

  it("차트틀은 동적으로 받는다", () => {
    const s = fs.readFileSync(path.join(뿌리, "components/chart/ChartFrame.tsx"), "utf-8");
    /* typeof import("recharts") 는 타입 표기일 뿐 실행되지 않는다.
       그것까지 세면 진짜 동적 import 를 require 로 바꿔도 통과한다
       (뮤테이션에서 실제로 그렇게 빠져나갔다) — 실행되는 쪽만 본다 */
    expect(s).toMatch(/(?<!typeof )import\(["']recharts["']\)/);
    /* 위에 정적 import 가 같이 있으면 동적으로 쓴 의미가 없다 */
    expect(s).not.toMatch(/^import .* from ["']recharts["']/m);
    /* require 로 바꾸면 번들러가 갈라 주지 않는다 */
    expect(s).not.toMatch(/require\(["']recharts["']\)/);
  });

  it("그래프를 쓰던 화면들이 차트틀로 옮겨졌다", () => {
    for (const f of ["pages/StockDetail.tsx", "pages/Backtest.tsx",
                     "components/stock/SupplyDemandTab.tsx"]) {
      const s = fs.readFileSync(path.join(뿌리, f), "utf-8");
      /* 쓰기만 하고 import 를 안 하면 빌드가 깨진다. 둘 다 본다 —
         한쪽만 보면 import 를 지워도 통과했다(뮤테이션에서 겪음) */
      expect(s, `${f}: 차트틀 import 없음`).toMatch(/import 차트틀 from/);
      expect(s, `${f}: 차트틀 안 씀`).toMatch(/<차트틀[\s>]/);
    }
  });
});

describe("받아 오는 동안", () => {
  it("같은 높이의 자리를 지킨다", () => {
    /* 자리를 안 잡아 두면 그래프가 뜰 때 아래 내용이 밀려 내려가면서
       읽던 자리를 잃는다 */
    const { container } = render(
      <차트틀 height={240}>{() => <div>그래프</div>}</차트틀>,
    );
    const 자리 = container.firstElementChild as HTMLElement;
    expect(자리).toBeTruthy();
    expect(자리.style.height).toBe("240px");
  });

  it("무엇을 기다리는지 알려 준다", () => {
    render(<차트틀 height={100}>{() => <div>그래프</div>}</차트틀>);
    expect(screen.getByLabelText("그래프 불러오는 중")).toBeTruthy();
  });

  it("다 받으면 그래프를 그린다", async () => {
    render(
      <차트틀 height={100}>
        {(R) => (
          <R.BarChart data={[{ x: 1, y: 2 }]}>
            <R.Bar dataKey="y" />
          </R.BarChart>
        )}
      </차트틀>,
    );
    /* jsdom 에는 크기가 없어 recharts 가 경고를 내지만, 여기서 보려는 것은
       '기다리는 자리가 사라지고 라이브러리가 붙었는가' 다 */
    await waitFor(() => {
      expect(screen.queryByLabelText("그래프 불러오는 중")).toBeNull();
    }, { timeout: 5000 });
  });
});
