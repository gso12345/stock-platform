/**
 * 서비스워커 — 하는 일 없이 요청을 붙잡지 않는다.
 *
 * 예전에는 모든 요청(API 서버로 가는 것까지)을 respondWith(fetch(req)) 로
 * 감쌌다. 하는 일은 없는데, 그 요청마다 서비스워커가 깨어나길 기다려야
 * 했다. 그리고 화면(HTML) 요청은 서비스워커가 깨어난 **다음에야** 나갔다.
 *
 * sw.js 를 가짜 서비스워커 전역에서 실제로 돌려 본다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const 원문 = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");

type 처리기 = (e: any) => void;

function 띄우기() {
  const 처리기들: Record<string, 처리기> = {};
  const 담긴것 = new Map<string, Response>();
  const 미리켜기 = vi.fn(() => Promise.resolve());
  const 가짜self = {
    location: { origin: "https://app.example" },
    registration: { navigationPreload: { enable: 미리켜기 } },
    clients: { claim: vi.fn(() => Promise.resolve()) },
    skipWaiting: vi.fn(),
    addEventListener: (이름: string, f: 처리기) => { 처리기들[이름] = f; },
  };
  const 열쇠 = (r: Request | string) => (typeof r === "string" ? r : r.url);
  const 가짜caches = {
    keys: vi.fn(() => Promise.resolve(["static-v1", "shell-v1", "옛것"])),
    delete: vi.fn((_이름: string) => Promise.resolve(true)),
    open: vi.fn(() => Promise.resolve({
      match: (r: Request | string) => Promise.resolve(담긴것.get(열쇠(r))),
      put: (r: Request | string, res: Response) => { 담긴것.set(열쇠(r), res); return Promise.resolve(); },
    })),
  };
  const 가짜fetch = vi.fn((r: Request) => Promise.resolve(new Response("네트워크", {
    headers: { "content-type": r.url.endsWith(".js") ? "text/javascript" : "text/html" },
  })));
  const 기다림들: Promise<unknown>[] = [];
  new Function("self", "caches", "fetch", 원문)(가짜self, 가짜caches, 가짜fetch);

  function 요청(url: string, 덧: { method?: string; mode?: string; preload?: Response | null } = {}) {
    const request = { url, method: 덧.method ?? "GET", mode: 덧.mode ?? "cors" } as unknown as Request;
    let 응답: Promise<Response> | null = null;
    처리기들.fetch({
      request,
      preloadResponse: Promise.resolve(덧.preload ?? undefined),
      respondWith: (p: Promise<Response>) => { 응답 = p; },
      waitUntil: (p: Promise<unknown>) => { 기다림들.push(p); },
    });
    return 응답 as Promise<Response> | null;
  }
  const 다끝남 = () => Promise.all(기다림들);
  return { 처리기들, 요청, 가짜fetch, 담긴것, 미리켜기, 가짜caches, 다끝남 };
}

let sw: ReturnType<typeof 띄우기>;
beforeEach(() => { sw = 띄우기(); });

describe("손대지 않는 요청", () => {
  it("API 서버(다른 출처)로 가는 요청은 붙잡지 않는다", () => {
    expect(sw.요청("https://api.example/api/v1/dashboard/kr")).toBeNull();
  });
  it("다른 출처의 /assets 도 우리 빌드 파일이 아니다 — 담지 않는다", () => {
    expect(sw.요청("https://cdn.example/assets/x.js")).toBeNull();
  });
  it("GET 이 아닌 요청은 붙잡지 않는다", () => {
    expect(sw.요청("https://app.example/assets/a.js", { method: "POST" })).toBeNull();
  });
  it("같은 출처라도 아이콘·manifest 는 붙잡지 않는다", () => {
    expect(sw.요청("https://app.example/manifest.json")).toBeNull();
  });
});

describe("화면(HTML)", () => {
  it("켜질 때 미리 보내기(navigationPreload)를 켠다", async () => {
    const 기다림: Promise<unknown>[] = [];
    sw.처리기들.activate({ waitUntil: (p: Promise<unknown>) => 기다림.push(p) });
    await Promise.all(기다림);
    expect(sw.미리켜기).toHaveBeenCalled();
  });
  it("미리 보낸 응답이 있으면 그것을 쓴다 — 다시 받지 않는다", async () => {
    const 미리 = new Response("미리 받은 화면");
    const 응답 = await sw.요청("https://app.example/portfolio", { mode: "navigate", preload: 미리 });
    expect(await 응답!.text()).toBe("미리 받은 화면");
    expect(sw.가짜fetch).not.toHaveBeenCalled();
  });
  it("없으면 네트워크에서", async () => {
    const 응답 = await sw.요청("https://app.example/portfolio", { mode: "navigate", preload: null });
    expect(await 응답!.text()).toBe("네트워크");
  });
});

// "실제 앱같이 느껴졌으면" — 6번: 인터넷이 끊겨도 앱이 열린다
describe("인터넷이 끊겼을 때", () => {
  it("받은 화면 틀은 한 벌 들고 있다가, 끊기면(네트워크 실패) 그것으로 연다 — 주소가 달라도", async () => {
    await sw.요청("https://app.example/portfolio", { mode: "navigate", preload: null });
    await sw.다끝남();
    expect(sw.담긴것.has("/__shell")).toBe(true);
    sw.가짜fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const 응답 = await sw.요청("https://app.example/ipo", { mode: "navigate", preload: null });
    expect(await 응답!.text()).toBe("네트워크");
  });

  it("들고 있는 화면 틀이 없으면 원래 오류 그대로", async () => {
    sw.가짜fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(sw.요청("https://app.example/", { mode: "navigate", preload: null })).rejects.toThrow("Failed to fetch");
  });

  it("실패 응답·HTML 이 아닌 응답은 화면 틀로 들고 있지 않는다", async () => {
    sw.가짜fetch.mockResolvedValueOnce(new Response("없음", { status: 404, headers: { "content-type": "text/html" } }));
    await sw.요청("https://app.example/x", { mode: "navigate", preload: null });
    sw.가짜fetch.mockResolvedValueOnce(new Response("{}", { headers: { "content-type": "application/json" } }));
    await sw.요청("https://app.example/y", { mode: "navigate", preload: null });
    await sw.다끝남();
    expect(sw.담긴것.has("/__shell")).toBe(false);
  });

  it("미리 보낸 응답도 화면 틀로 들고 있는다", async () => {
    await sw.요청("https://app.example/", { mode: "navigate", preload: new Response("미리", { headers: { "content-type": "text/html" } }) });
    await sw.다끝남();
    expect(await sw.담긴것.get("/__shell")!.text()).toBe("미리");
  });

  it("켜질 때 옛 캐시만 지우고 화면 틀·빌드 파일은 남긴다", async () => {
    const 기다림: Promise<unknown>[] = [];
    sw.처리기들.activate({ waitUntil: (p: Promise<unknown>) => 기다림.push(p) });
    await Promise.all(기다림);
    expect(sw.가짜caches.delete.mock.calls.map((c) => c[0])).toEqual(["옛것"]);
  });
});

describe("빌드 파일(/assets)", () => {
  it("받아서 담고, 다음에는 담긴 것을 쓴다", async () => {
    await sw.요청("https://app.example/assets/a-1.js");
    expect(sw.담긴것.has("https://app.example/assets/a-1.js")).toBe(true);
    sw.가짜fetch.mockClear();
    await sw.요청("https://app.example/assets/a-1.js");
    expect(sw.가짜fetch).not.toHaveBeenCalled();
  });
  it("HTML 이 돌아오면 담지 않는다 — JS 이름으로 HTML 이 영영 남는다", async () => {
    await sw.요청("https://app.example/assets/없는-파일.css");
    expect(sw.담긴것.has("https://app.example/assets/없는-파일.css")).toBe(false);
  });
});

describe("호스팅 설정", () => {
  for (const 경로 of ["../../../vercel.json", "../../vercel.json"]) {
    const 설정 = JSON.parse(readFileSync(resolve(__dirname, 경로), "utf8"));
    it(`${경로}: 해시 파일은 오래 캐시한다`, () => {
      const 칸 = 설정.headers.find((h: any) => h.source === "/assets/(.*)");
      expect(칸.headers[0]).toEqual({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
    });
    it(`${경로}: 없는 빌드 파일에 index.html 을 주지 않는다`, () => {
      expect(설정.rewrites).toEqual([{ source: "/((?!assets/).*)", destination: "/index.html" }]);
    });
  }
});
