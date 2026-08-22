/**
 * 종목 상세를 탭별로 쪼갠 것이 유지되는가.
 *
 * 한 파일이 3,173줄이었다. 재무제표 표의 칸 하나를 고치려 해도 여덟 탭이
 * 든 파일 전체를 건드려야 했고, 차트만 보고 나가는 사람도 그 코드를 전부
 * 받았다.
 *
 * 재무제표(617줄)와 투자의견(413줄)은 훅이 하나도 없는 순수 렌더라
 * 그대로 떼어 낼 수 있었다. 필요한 값을 전부 인자로 받게 해서, 하나라도
 * 빠지면 빌드가 짚어 주게 했다 — 화면을 눈으로 볼 수 없는 상태에서
 * 옮기는 것이라 '컴파일이 곧 검증' 이어야 했다.
 *
 *     3,173줄 → 2,049줄 · 종목상세 묶음 32.5KB → 24.8KB (gzip)
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const 뿌리 = path.resolve(__dirname, "../..");
const 소스 = (rel: string) => fs.readFileSync(path.join(뿌리, rel), "utf-8");
const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const 본문 = 소스("pages/StockDetail.tsx");
const 본문코드 = 코드만(본문);
const 재무 = 소스("components/stock/FinancialTab.tsx");
const 투자 = 소스("components/stock/AnalystTab.tsx");

describe("파일이 다시 부풀지 않게", () => {
  it("종목상세가 2,400줄을 넘지 않는다", () => {
    /* 3,173줄이었다. 다시 여기에 탭을 밀어 넣으면 원래대로 돌아간다 */
    expect(본문.split("\n").length).toBeLessThan(2400);
  });

  it("떼어 낸 탭이 제 파일에 있다", () => {
    expect(재무.split("\n").length).toBeGreaterThan(400);
    expect(투자.split("\n").length).toBeGreaterThan(300);
  });

  it("본문에 그 탭들의 몸통이 남아 있지 않다", () => {
    expect(본문코드).not.toMatch(/mainTab==="financial" && \(\(\) =>/);
    expect(본문코드).not.toMatch(/mainTab==="analyst" && \(\(\) =>/);
  });
});

describe("필요할 때만 받는다", () => {
  it("두 탭을 lazy 로 건다", () => {
    /* 정적으로 걸면 같은 묶음에 들어가서, 줄만 옮기고 받는 양은
       그대로다 — 실제로 처음에 그렇게 됐다(32.5KB 그대로) */
    expect(본문코드).toMatch(/const 재무제표탭 = lazy\(\(\) => import\(/);
    expect(본문코드).toMatch(/const 투자의견탭 = lazy\(\(\) => import\(/);
    expect(본문코드).not.toMatch(/^import 재무제표탭 from/m);
    expect(본문코드).not.toMatch(/^import 투자의견탭 from/m);
  });

  it("받아오는 동안 자리를 잡아 둔다", () => {
    /* 안 잡으면 표가 뜰 때 아래가 밀려 읽던 자리를 잃는다 */
    expect(본문코드).toContain("function 탭기다리기");
    expect((본문코드.match(/<Suspense fallback=\{<탭기다리기 \/>\}>/g) ?? []).length).toBe(2);
  });
});

describe("떼어 낸 탭은 순수 렌더로 둔다", () => {
  it.each([["재무제표", 재무], ["투자의견", 투자]])("%s 탭에 훅이 없다", (_이름, s) => {
    /* 훅이 들어오는 순간 조건부로 그릴 수 없게 된다 —
       {mainTab==="financial" && <재무제표탭/>} 가 훅 순서를 흔든다 */
    const 몸통 = 코드만(s).replace(/^import .*$/gm, "");
    expect(몸통).not.toMatch(/\buse(State|Effect|Memo|Callback|Ref|Query)\(/);
  });

  it.each([["재무제표", 재무], ["투자의견", 투자]])("%s 탭이 값을 인자로만 받는다", (_이름, s) => {
    /* 전역이나 컨텍스트에서 몰래 꺼내 쓰면, 빠진 값을 빌드가 못 잡는다 */
    expect(s).toMatch(/export default function .+탭\(\{/);
  });
});

describe("함께 쓰는 것은 따로 뺐다", () => {
  it("작은 부품 넷이 공용 자리에 있다", () => {
    const s = 소스("components/stock/DetailBits.tsx");
    for (const n of ["StatCell", "SectionTitle", "PeriodToggle", "TransTable"]) {
      expect(s, `${n} 가 없다`).toContain(`export function ${n}(`);
    }
  });

  it("지표 목록도 공용 자리에 있다", () => {
    const s = 소스("constants/finMetrics.ts");
    expect(s).toContain("export const FIN_CUSTOM_OPTS");
    expect(s).toContain("export const FIN_CUSTOM_KEY");
  });

  it("한쪽 파일을 통째로 끌어오지 않는다", () => {
    /* 부품을 종목상세에 두면, 떼어 낸 탭이 그 2,049줄을 다시 끌어온다 */
    for (const s of [재무, 투자]) {
      expect(s).not.toContain('from "@/pages/StockDetail"');
    }
  });
});
