/**
 * 앱 그림 만들기 — 아이폰 시작 화면(public/splash)과 안드로이드 아이콘 바로가기 그림(public/shortcuts).
 *
 * 그림은 저장소에 넣어 두었다. 로고나 앱 속 시작 화면의 모양을 바꾸면 이걸로 다시 만든다:
 *
 *     cd frontend && node scripts/make-app-images.mjs
 *
 * Playwright(크로미움)가 있어야 한다. 글꼴(Pretendard)은 FONT_DIR 에 풀어 두거나(npm pack pretendard 를 푼 곳),
 * 없으면 npm 에서 받는다. index.html 의 시작 화면 <link> 묶음(표시 사이)도 여기서 다시 쓴다 — 기기 목록은 이
 * 파일 하나에만 있다.
 *
 * 시작 화면은 앱 속 시작 화면(src/components/layout/SplashScreen.tsx)이 다 움직인 뒤의 모습과 같게 그린다.
 * 아이폰은 앱을 누르면 이 그림을 먼저 띄우고, 앱이 뜨면 같은 모습의 앱 속 시작 화면이 움직임 없이 이어받아
 * 걷힌다(SplashScreen 의 splash-still). 예전에는 이 그림이 없어 하얀(또는 빈) 화면이 먼저 떴다.
 * 글자는 Pretendard 로 그린다 — 이어받는 그 순간에는 앱의 웹 글꼴이 아직 안 와 아이폰 시스템 글꼴로 그려지는데,
 * Pretendard 가 그 글꼴(SF Pro·애플 산돌고딕 Neo)과 가장 닮았다.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Bell, Rocket, Star, Wallet } from "lucide-react";

const 뿌리 = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const 공개 = join(뿌리, "public");

/** [CSS 폭, CSS 높이, 배율, 기기] — 세로. 가로로 켜는 일은 드물어 세로만 둔다 */
export const 아이폰 = [
  [440, 956, 3, "16 Pro Max · 17 Pro Max"],
  [420, 912, 3, "Air"],
  [402, 874, 3, "16 Pro · 17 · 17 Pro"],
  [430, 932, 3, "14 Pro Max · 15 Plus · 15 Pro Max · 16 Plus"],
  [393, 852, 3, "14 Pro · 15 · 15 Pro · 16"],
  [428, 926, 3, "12 Pro Max · 13 Pro Max · 14 Plus"],
  [390, 844, 3, "12 · 12 Pro · 13 · 13 Pro · 14 · 16e"],
  [375, 812, 3, "X · XS · 11 Pro · 12 mini · 13 mini"],
  [414, 896, 3, "XS Max · 11 Pro Max"],
  [414, 896, 2, "XR · 11"],
  [414, 736, 3, "6s Plus · 7 Plus · 8 Plus"],
  [375, 667, 2, "6s · 7 · 8 · SE(2·3세대)"],
];

/** 아이콘 바로가기 — manifest.json 의 shortcuts 와 같은 순서·이름 */
const 바로가기 = [
  ["portfolio", Wallet],
  ["watchlist", Star],
  ["ipo", Rocket],
  ["notifications", Bell],
];

const 그림이름 = ([w, h, r]) => `iphone-${w * r}x${h * r}.png`;

function 글꼴준비() {
  const 있는곳 = process.env.FONT_DIR;
  if (있는곳) return 있는곳;
  const 곳 = mkdtempSync(join(tmpdir(), "app-fonts-"));
  execFileSync("npm", ["pack", "pretendard@1.3.9"], { cwd: 곳, stdio: "ignore" });
  execFileSync("tar", ["-xzf", "pretendard-1.3.9.tgz"], { cwd: 곳 });
  return join(곳, "package");
}

/** 글꼴은 글 안에 담는다 — 빈 쪽(about:blank)에서는 file:// 글꼴을 막아 몰래 다른 글꼴로 그려졌다 */
function 글꼴규칙(곳) {
  const 담기 = (굵기, 이름) => {
    const 몸 = readFileSync(join(곳, "dist/web/static/woff2", `Pretendard-${이름}.woff2`)).toString("base64");
    return `@font-face { font-family: "Pretendard"; font-weight: ${굵기}; src: url(data:font/woff2;base64,${몸}) format("woff2"); }`;
  };
  return 담기(400, "Regular") + 담기(700, "Bold");
}

/** 앱 속 시작 화면의 끝 모습 — 값은 그 화면의 Tailwind 클래스를 뿌리 글자 14px(휴대폰)로 푼 것 */
function 시작화면(글꼴) {
  const 막대 = [[7, 40, 14, "rgba(255,255,255,0.30)"], [19, 32, 22, "rgba(255,255,255,0.55)"],
    [31, 24, 30, "rgba(255,255,255,0.80)"], [43, 16, 38, "url(#a)"]]
    .map(([x, y, h, f]) => `<rect x="${x}" y="${y}" width="8" height="${h}" rx="2.5" fill="${f}"/>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${글꼴}
    html { font-family: "Pretendard"; font-size: 14px; -webkit-font-smoothing: antialiased; }
    body { margin: 0; background: #0b0e17; }
    .판 { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; }
    .빛 { position: absolute; left: 50%; top: 50%; width: 16rem; height: 16rem; transform: translate(-50%, -50%);
          border-radius: 9999px; background: rgb(59 130 246 / 0.2); filter: blur(64px); opacity: 0.45; }
    .로고 { position: relative; filter: drop-shadow(0 0 24px rgba(59,130,246,0.35)); }
    .글 { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0.375rem; text-align: center; }
    .이름 { margin: 0; font-size: 1rem; line-height: 1.5rem; font-weight: 700; letter-spacing: -0.025em; color: #e2e8f0; }
    .설명 { margin: 0; font-size: 0.6875rem; line-height: 0.9375rem; color: #64748b; }
    .점들 { display: flex; gap: 0.375rem; margin-top: 0.375rem; }
    .점 { width: 0.375rem; height: 0.375rem; border-radius: 9999px; background: #3b82f6; opacity: 0.25; transform: scale(0.8); }
  </style></head><body><div class="판">
    <div class="빛"></div>
    <svg class="로고" width="84" height="84" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="b" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#2563eb"/><stop offset="100%" stop-color="#7c3aed"/></linearGradient>
        <linearGradient id="a" x1="0" y1="54" x2="0" y2="16" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#34d399"/></linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#b)"/>${막대}
      <circle cx="47" cy="11" r="3.5" fill="#22d3ee"/>
    </svg>
    <div class="글">
      <p class="이름">StockPlatform</p>
      <p class="설명">한국 · 미국 주식 분석 플랫폼</p>
      <div class="점들"><span class="점"></span><span class="점"></span><span class="점"></span></div>
    </div>
  </div></body></html>`;
}

/** 바로가기 그림 192px — any 는 둥근 네모(모서리 투명), maskable 은 꽉 채워 런처가 자기 모양으로 자르게 */
function 바로가기그림(아이콘, 꽉) {
  const 크기 = 꽉 ? 76 : 96;           // maskable 은 가운데 지름 80% 안전 구역에 들게 더 작게
  const svg = renderToStaticMarkup(createElement(아이콘, { size: 크기, color: "#ffffff", strokeWidth: 2 }));
  return `<!doctype html><html><head><style>
    body { margin: 0; background: transparent; }
    .판 { width: 192px; height: 192px; display: flex; align-items: center; justify-content: center;
          border-radius: ${꽉 ? "0" : "22%"}; background: linear-gradient(135deg, #2563eb, #7c3aed); }
  </style></head><body><div class="판">${svg}</div></body></html>`;
}

function index고치기() {
  const 길 = join(뿌리, "index.html");
  const html = readFileSync(길, "utf-8");
  const 시작 = "<!-- 시작화면:시작 -->";
  const 끝 = "<!-- 시작화면:끝 -->";
  const 줄 = 아이폰.map((기기) => {
    const [w, h, r, 이름] = 기기;
    const 조건 = `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`;
    return `    <!-- ${이름} -->\n    <link rel="apple-touch-startup-image" media="${조건}" href="/splash/${그림이름(기기)}" />`;
  });
  const 묶음 = `${시작}\n${줄.join("\n")}\n    ${끝}`;
  const 앞 = html.indexOf(시작);
  const 뒤 = html.indexOf(끝);
  if (앞 < 0 || 뒤 < 0) throw new Error("index.html 에 시작 화면 표시(시작화면:시작·끝)가 없어요");
  writeFileSync(길, html.slice(0, 앞) + 묶음 + html.slice(뒤 + 끝.length));
}

async function main() {
  let playwright;
  try {
    playwright = createRequire(import.meta.url)("playwright");
  } catch {
    console.error("Playwright 가 없어요 — npm i -D playwright && npx playwright install chromium 뒤에 다시 해 주세요");
    process.exit(1);
  }
  const 글꼴 = 글꼴규칙(글꼴준비());
  const 브라우저 = await playwright.chromium.launch();
  try {
    mkdirSync(join(공개, "splash"), { recursive: true });
    for (const 기기 of 아이폰) {
      const [w, h, r] = 기기;
      const 쪽 = await 브라우저.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: r });
      await 쪽.setContent(시작화면(글꼴));
      const 글꼴됨 = await 쪽.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].every((f) => f.status === "loaded");
      });
      if (!글꼴됨) throw new Error("Pretendard 를 못 불러왔어요 — 다른 글꼴로 그려지지 않게 멈춰요");
      await 쪽.screenshot({ path: join(공개, "splash", 그림이름(기기)) });
      await 쪽.close();
    }
    mkdirSync(join(공개, "shortcuts"), { recursive: true });
    for (const [이름, 아이콘] of 바로가기) {
      for (const 꽉 of [false, true]) {
        const 쪽 = await 브라우저.newPage({ viewport: { width: 192, height: 192 }, deviceScaleFactor: 1 });
        await 쪽.setContent(바로가기그림(아이콘, 꽉));
        await 쪽.screenshot({ path: join(공개, "shortcuts", `${이름}${꽉 ? "-maskable" : ""}.png`), omitBackground: !꽉 });
        await 쪽.close();
      }
    }
  } finally {
    await 브라우저.close();
  }
  index고치기();
  console.log(`시작 화면 ${아이폰.length}장, 바로가기 ${바로가기.length * 2}장을 만들었어요`);
}

if (existsSync(공개)) await main();
