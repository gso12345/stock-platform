import { useEffect, useState } from "react";

function isStandaloneMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

const VISIBLE_MS = 1100;
const FADE_MS = 350;

/** 설치된 앱(PWA standalone)으로 실행했을 때만 보여주는 시작 인트로 화면 */
export default function SplashScreen() {
  const [stage, setStage] = useState<"hidden" | "visible" | "fading">(() =>
    isStandaloneMode() ? "visible" : "hidden"
  );

  useEffect(() => {
    if (stage !== "visible") return;
    const fadeTimer = setTimeout(() => setStage("fading"), VISIBLE_MS);
    const hideTimer = setTimeout(() => setStage("hidden"), VISIBLE_MS + FADE_MS);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, [stage]);

  if (stage === "hidden") return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-bg-base"
      style={{
        opacity: stage === "fading" ? 0 : 1,
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
