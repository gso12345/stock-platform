/**
 * 앱 그림 — "실제 앱같이 느껴졌으면" 12·13번.
 *
 *   12) 아이폰 시작 화면 — 홈 화면 앱을 누르면 앱이 뜨기 전까지 띄울 그림. 기기 화면 크기와 정확히 같은 그림만
 *       쓰이므로, 적어 둔 크기와 그림의 실제 크기가 하나라도 어긋나면 그 기종은 다시 빈 화면이 된다.
 *   13) 안드로이드 아이콘 바로가기 — 앱 아이콘을 길게 누르면 뜨는 내 자산·관심종목·공모주·알림.
 *
 * 그림과 index.html 의 묶음은 scripts/make-app-images.mjs 가 만든다. 여기서는 셋(적은 것·그림·화면 주소)이
 * 서로 맞는지 본다.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { inflateSync } from "zlib";
import { resolve } from "path";

const 앞단 = resolve(__dirname, "../..");
const 공개 = resolve(앞단, "public");
const html = readFileSync(resolve(앞단, "index.html"), "utf-8");
const 매니페스트 = JSON.parse(readFileSync(resolve(공개, "manifest.json"), "utf-8"));
const 화면주소 = readFileSync(resolve(앞단, "src/main.tsx"), "utf-8");

/** PNG 의 폭·높이와 맨 왼쪽 위 점의 색 — 첫 줄 첫 점은 어떤 거르기(filter)를 써도 날값 그대로다 */
function png(길: string) {
  const b = readFileSync(길);
  expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const 폭 = b.readUInt32BE(16);
  const 높이 = b.readUInt32BE(20);
  const 색종류 = b[25];                       // 2 = RGB, 6 = RGBA
  const 덩이: Buffer[] = [];
  for (let i = 8; i < b.length;) {
    const 길이 = b.readUInt32BE(i);
    if (b.toString("ascii", i + 4, i + 8) === "IDAT") 덩이.push(b.subarray(i + 8, i + 8 + 길이));
    i += 12 + 길이;
  }
  const 날 = inflateSync(Buffer.concat(덩이));
  const 점 = [...날.subarray(1, 색종류 === 6 ? 5 : 4)];
  return { 폭, 높이, 색종류, 첫점: { r: 점[0], g: 점[1], b: 점[2], a: 색종류 === 6 ? 점[3] : 255 }, 바이트: b.length };
}

const 시작그림 = [...html.matchAll(/<link rel="apple-touch-startup-image" media="([^"]+)" href="([^"]+)" \/>/g)]
  .map(([, media, href]) => ({ media, href }));

describe("12번 — 아이폰 시작 화면", () => {
  it("기종별로 있다 — 요즘 기기(16·17 Pro Max, Air, 16 Pro)부터 SE 까지", () => {
    expect(시작그림.length).toBe(12);
    const 크기들 = 시작그림.map((g) => g.href);
    for (const 꼭 of ["1320x2868", "1260x2736", "1206x2622", "1290x2796", "1179x2556", "1170x2532", "750x1334"]) {
      expect(크기들).toContain(`/splash/iphone-${꼭}.png`);
    }
  });

  it("묶음은 만드는 스크립트의 표시 사이에만 있다(손으로 덧붙인 게 없다)", () => {
    const 앞 = html.indexOf("<!-- 시작화면:시작 -->");
    const 뒤 = html.indexOf("<!-- 시작화면:끝 -->");
    expect(앞).toBeGreaterThan(-1);
    expect(뒤).toBeGreaterThan(앞);
    expect(html.slice(앞, 뒤).match(/apple-touch-startup-image/g)?.length).toBe(시작그림.length);
  });

  it("조건은 기기의 CSS 크기·배율·세로이고, 그림은 정확히 그 곱의 크기다", () => {
    const 본것 = new Set<string>();
    for (const { media, href } of 시작그림) {
      const m = media.match(
        /^\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\) and \(orientation: portrait\)$/,
      );
      expect(m, media).not.toBeNull();
      const [w, h, r] = [Number(m![1]), Number(m![2]), Number(m![3])];
      expect(본것.has(media), `${media} 가 두 번`).toBe(false);
      본것.add(media);
      expect(href).toBe(`/splash/iphone-${w * r}x${h * r}.png`);
      const 길 = resolve(공개, href.slice(1));
      expect(existsSync(길), href).toBe(true);
      const 그림 = png(길);
      expect([그림.폭, 그림.높이], href).toEqual([w * r, h * r]);
    }
  });

  it("바탕은 앱·안드로이드 시작 화면과 같은 색이고, 그림은 가볍다", () => {
    expect(매니페스트.background_color).toBe("#0b0e17");
    for (const { href } of 시작그림) {
      const 그림 = png(resolve(공개, href.slice(1)));
      expect(그림.첫점, href).toEqual({ r: 0x0b, g: 0x0e, b: 0x17, a: 255 });
      expect(그림.바이트, href).toBeLessThan(300_000);
    }
  });
});

describe("13번 — 안드로이드 아이콘 바로가기", () => {
  const 바로가기: Array<{ name: string; short_name: string; url: string; icons: Array<{ src: string; sizes: string; purpose: string }> }> =
    매니페스트.shortcuts;

  it("내 자산·관심종목·공모주·알림 — 안드로이드가 보여 주는 넷", () => {
    expect(바로가기.map((s) => [s.short_name, s.url])).toEqual([
      ["내 자산", "/portfolio"], ["관심종목", "/watchlist"], ["공모주", "/ipo"], ["알림", "/notifications"],
    ]);
    for (const s of 바로가기) expect(s.name.length).toBeGreaterThan(0);
  });

  it("주소는 앱에 실제로 있는 화면이고, 앱 범위 안이다", () => {
    for (const { url } of 바로가기) {
      expect(url.startsWith(매니페스트.scope)).toBe(true);
      expect(화면주소, url).toContain(`<Route path="${url.slice(1)}"`);
    }
  });

  it("아이콘은 둘 — 둥근 네모(any)와 런처가 자기 모양으로 자르는 꽉 찬 것(maskable). 적은 크기와 실제가 같다", () => {
    for (const { url, icons } of 바로가기) {
      expect(icons.map((i) => i.purpose).sort(), url).toEqual(["any", "maskable"]);
      for (const 아이콘 of icons) {
        const 길 = resolve(공개, 아이콘.src.slice(1));
        expect(existsSync(길), 아이콘.src).toBe(true);
        const 그림 = png(길);
        expect(`${그림.폭}x${그림.높이}`).toBe(아이콘.sizes);
        expect(그림.폭).toBeGreaterThanOrEqual(96);           // 크롬이 받는 가장 작은 크기
        // 둥근 네모는 모서리가 비어 있고, maskable 은 모서리까지 칠해져 있다(잘릴 자리)
        expect(그림.첫점.a, 아이콘.src).toBe(아이콘.purpose === "any" ? 0 : 255);
      }
    }
  });
});
