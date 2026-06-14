import { useId } from "react";

interface LogoProps {
  size?: number;
  className?: string;
}

/** 그라디언트 배경 + 바 차트 모티프 로고 (favicon/PWA 아이콘과 동일 디자인) */
export default function Logo({ size = 28, className = "" }: LogoProps) {
  const uid = useId().replace(/:/g, "");
  const bgId = `logo-bg-${uid}`;
  const accentId = `logo-accent-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="StockPlatform 로고"
      className={`flex-shrink-0 rounded-[22%] ${className}`}
    >
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id={accentId} x1="0" y1="54" x2="0" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${bgId})`} />
      <rect x="7" y="40" width="8" height="14" rx="2.5" fill="rgba(255,255,255,0.30)" />
      <rect x="19" y="32" width="8" height="22" rx="2.5" fill="rgba(255,255,255,0.55)" />
      <rect x="31" y="24" width="8" height="30" rx="2.5" fill="rgba(255,255,255,0.80)" />
      <rect x="43" y="16" width="8" height="38" rx="2.5" fill={`url(#${accentId})`} />
      <circle cx="47" cy="11" r="3.5" fill="#22d3ee" />
    </svg>
  );
}
