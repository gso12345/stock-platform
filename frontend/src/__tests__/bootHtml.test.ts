/**
 * 첫 화면이 뜨기까지 브라우저가 하는 일 — index.html 이 정한다.
 *
 * 실제로 재 보고 고친 자리들이라, 되돌아가면 여기가 걸려야 한다.
 *
 * ── 1. API 서버 사전 연결 주소가 틀려 있었다 ──
 *
 * index.html 에 주소를 직접 적어 두었는데 그게 지금 쓰는 API 서버가
 * 아니었다. 두 배로 손해다 — 정작 필요한 곳은 미리 연결이 안 돼서 첫
 * 요청이 DNS+TCP+TLS 세 왕복을 다 물고, 쓰지도 않을 곳에 연결을 하나
 * 여느라 제일 붐비는 순간을 더 붐비게 한다.
 *
 * ── 2. 폰트 스타일시트가 첫 픽셀을 막았다 ──
 *
 * <link rel="stylesheet"> 는 브라우저가 그 CSS 를 다 받기 전까지
 * 아무것도 안 그리게 한다. 남의 서버에 새로 연결해서 받아야 하므로
 * 왕복 세 번이 먼저 든다. 실측으로 첫 픽셀이 그만큼 밀렸다.
 * 숫자에만 쓰는 글꼴 하나 때문에 화면 전체가 멈출 이유가 없다.
 *
 * ── 3. 서버를 깨우려고 /health 를 두드렸다 ──
 *
 * Render 무료 플랜이 자고 있을 때를 위한 것이었는데 그 잠듦이 없어졌다.
 * 남겨 두면 화면에 필요한 요청들과 같은 순간에 하나가 더 나갈 뿐이다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { API미리연결 } from "@/utils/apiPreconnect";

const 뿌리 = resolve(__dirname, "..", "..");
const html = readFileSync(resolve(뿌리, "index.html"), "utf-8");
const main = readFileSync(resolve(뿌리, "src", "main.tsx"), "utf-8");

describe("API 서버 사전 연결", () => {
  it("주소를 html 에 직접 안 적는다", () => {
    /* 적어 두면 배포 주소가 바뀔 때 같이 안 바뀐다. 실제로 그랬다 */
    expect(html).not.toMatch(/onrender\.com/);
  });

  it("VITE_API_URL 에서 만든다", () => {
    const 태그 = API미리연결("https://stock-platform-ksmu.onrender.com");
    expect(태그).toContain('rel="preconnect" href="https://stock-platform-ksmu.onrender.com"');
    expect(태그).toContain('rel="dns-prefetch"');
  });

  it("경로가 붙어 있어도 도메인만 쓴다", () => {
    /* preconnect 는 출처(origin)를 받는다. 경로가 붙으면 브라우저가
       그 태그를 통째로 무시한다 — 조용히 아무 일도 안 하게 된다 */
    const 태그 = API미리연결("https://api.example.com/api/v1");
    expect(태그).toContain('href="https://api.example.com"');
    expect(태그).not.toContain("/api/v1");
  });

  it("crossorigin 을 붙인다", () => {
    /* API 요청은 CORS 요청이다. crossorigin 없이 연 연결은 재사용되지
       않고 새로 하나 더 연다 — 미리 연결한 뜻이 통째로 사라진다 */
    expect(API미리연결("https://api.example.com")).toContain("crossorigin");
  });

  it("주소가 없으면 아무것도 안 넣는다", () => {
    /* 같은 도메인에서 API 도 받는 배포다. 이미 연결돼 있는 곳에
       preconnect 는 뜻이 없다 */
    expect(API미리연결(undefined)).toBe("");
    expect(API미리연결("")).toBe("");
  });

  it("주소 모양이 아니면 빌드를 깨뜨리지 않는다", () => {
    expect(API미리연결("주소아님")).toBe("");
  });
});

describe("폰트가 첫 픽셀을 안 막는다", () => {
  it("stylesheet 로 곧장 걸지 않는다", () => {
    const 곧장 = html.match(/<link[^>]*rel="stylesheet"[^>]*fonts\.googleapis/g) ?? [];
    /* <noscript> 안의 것 하나는 괜찮다 — 자바스크립트가 꺼진
       브라우저에서는 onload 가 안 돌아 글꼴이 영영 안 온다 */
    const noscript속 = html.slice(html.indexOf("<noscript>"), html.indexOf("</noscript>"));
    for (const 태그 of 곧장) {
      expect(noscript속).toContain(태그);
    }
  });

  it("preload 로 받아 두었다가 stylesheet 로 바꾼다", () => {
    expect(html).toMatch(/rel="preload"\s+as="style"/);
    expect(html).toContain("this.rel='stylesheet'");
  });

  it("글꼴 파일이 오는 곳(gstatic)에도 미리 연결한다", () => {
    /* woff2 는 googleapis 가 아니라 gstatic 에서 온다. 한 곳만
       미리 연결해 두면 나머지 왕복은 그대로 남는다 */
    expect(html).toMatch(/rel="preconnect"\s+href="https:\/\/fonts\.gstatic\.com"\s+crossorigin/);
  });
});

describe("서버 깨우기 요청을 안 보낸다", () => {
  it("/health 를 두드리지 않는다", () => {
    expect(main).not.toMatch(/fetch\(`?\$?\{?[^)]*\/health/);
  });

  it("왜 뺐는지 남겨 둔다 — 다시 재우는 요금제로 돌아갈 수 있다", () => {
    expect(main).toContain("/health");   // 주석으로는 남아 있어야 한다
  });
});

describe("대시보드 선제 요청", () => {
  it("세 건을 넘지 않는다", () => {
    /* 앱이 뜨자마자 보내는 요청이다. 늘릴수록 정작 화면에 필요한
       것들이 뒤로 밀린다 */
    const 건수 = (main.match(/queryClient\.prefetchQuery/g) ?? []).length;
    expect(건수).toBeLessThanOrEqual(3);
  });
});
