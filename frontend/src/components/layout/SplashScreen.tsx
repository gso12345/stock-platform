import { useEffect, useState } from "react";

function isStandaloneMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

/** 앱 틀이 그려졌다는 신호를 아무도 안 보내도 이만큼 지나면 걷는다 */
const 최대_MS = 1_500;
const FADE_MS = 200;
const 준비_이벤트 = "stkplt:app-ready";
let 준비됨 = false;

/** 앱 틀(머리·탭)이 화면에 그려졌다 — Layout 이 부른다 */
export function 앱준비됨() {
  준비됨 = true;
  window.dispatchEvent(new Event(준비_이벤트));
}

/** 설치된 앱(PWA standalone)으로 실행했을 때만 보여주는 시작 인트로 화면.
 *
 *  예전에는 무조건 0.5초를 보여 주고 0.2초 동안 걷었다. 그동안 그 아래의
 *  앱은 이미 다 그려져 있었다 — 지난 대시보드 값은 저장해 둔 것으로 곧바로
 *  뜬다. 그러니 0.7초는 그냥 기다리게 하는 시간이었다. 이제 앱 틀이
 *  그려지는 순간 걷는다(늦어도 최대_MS). 운영체제가 띄우는 시작 화면이
 *  앞을 이미 덮어 주므로 따로 붙잡아 둘 이유가 없다. */
export default function SplashScreen() {
  const [stage, setStage] = useState<"hidden" | "visible" | "fading">(() =>
    isStandaloneMode() ? "visible" : "hidden"
  );

  useEffect(() => {
    if (stage !== "visible") return;
    let 숨김: ReturnType<typeof setTimeout> | undefined;
    const 걷기 = () => {
      setStage("fading");
      숨김 = setTimeout(() => setStage("hidden"), FADE_MS);
    };
    if (준비됨) { 걷기(); return () => clearTimeout(숨김); }
    const 늦음 = setTimeout(걷기, 최대_MS);
    const 들음 = () => { clearTimeout(늦음); 걷기(); };
    window.addEventListener(준비_이벤트, 들음, { once: true });
    return () => {
      clearTimeout(늦음); clearTimeout(숨김);
      window.removeEventListener(준비_이벤트, 들음);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (stage === "hidden") return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-bg-base"
      style={{
        opacity: stage === "fading" ? 0 : 1,
        pointerEvents: stage === "fading" ? "none" : "auto",
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {/* 배경 글로우 */}
      <div className="splash-glow absolute left-1/2 top-1/2 w-64 h-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-blue/20 blur-3xl" />

      {/* 로고 */}
      <svg
        width="84"
        height="84"
        viewBox="0 0 64 64"
        className="splash-logo drop-shadow-[0_0_24px_rgba(59,130,246,0.35)]"
      >
        <defs>
          <linearGradient id="splashBg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <linearGradient id="splashAccent" x1="0" y1="54" x2="0" y2="16" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="14" fill="url(#splashBg)" />
        <rect className="splash-bar" style={{ animationDelay: "150ms" }} x="7" y="40" width="8" height="14" rx="2.5" fill="rgba(255,255,255,0.30)" />
        <rect className="splash-bar" style={{ animationDelay: "250ms" }} x="19" y="32" width="8" height="22" rx="2.5" fill="rgba(255,255,255,0.55)" />
        <rect className="splash-bar" style={{ animationDelay: "350ms" }} x="31" y="24" width="8" height="30" rx="2.5" fill="rgba(255,255,255,0.80)" />
        <rect className="splash-bar" style={{ animationDelay: "450ms" }} x="43" y="16" width="8" height="38" rx="2.5" fill="url(#splashAccent)" />
        <circle className="splash-dot" cx="47" cy="11" r="3.5" fill="#22d3ee" />
      </svg>

      {/* 텍스트 */}
      <div className="splash-text flex flex-col items-center gap-1.5 text-center">
        <p className="text-lg font-bold tracking-tight text-text-primary">StockPlatform</p>
        <p className="text-2xs text-text-muted">한국 · 미국 주식 분석 플랫폼</p>
        <div className="flex gap-1.5 mt-1.5">
          <span className="splash-loading-dot w-1.5 h-1.5 rounded-full bg-accent-blue" style={{ animationDelay: "0ms" }} />
          <span className="splash-loading-dot w-1.5 h-1.5 rounded-full bg-accent-blue" style={{ animationDelay: "150ms" }} />
          <span className="splash-loading-dot w-1.5 h-1.5 rounded-full bg-accent-blue" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}
