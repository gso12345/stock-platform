/**
 * 시세가 살아 있는지 알려주는 표시.
 *
 * 지금까지 자산 화면에는 이런 장치가 전혀 없었다. 사이드바의 '실시간 연결됨'은
 * 대시보드 지수 소켓의 상태라, 내 자산·관심종목에서는 소켓이 끊겨 있어도
 * 계속 초록불이었다 — 유일한 단서가 상시 거짓이었던 셈이다.
 *
 * 여기서는 그 화면의 시세 소켓 상태만 본다. 휴장 중에는 값이 안 움직이는 게
 * 정상이므로 '끊김'이 아니라 '장마감'으로 보여준다.
 */
import type { MarketSession } from "@/hooks/useLivePrices";

function ago(ts: number | null): string {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "방금";
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  return `${Math.floor(m / 60)}시간 전`;
}

export default function LiveBadge({
  status,
  updatedAt,
  session,
  sessionLabel,
  className = "",
}: {
  status: "connecting" | "connected" | "disconnected";
  updatedAt: number | null;
  session: MarketSession;
  sessionLabel: string;
  className?: string;
}) {
  const closed = session === "closed";
  const live = status === "connected" && !closed;

  const dot = live
    ? "bg-accent-green animate-pulse"
    : status === "connected"
      ? "bg-text-dim"
      : status === "connecting"
        ? "bg-accent-amber animate-pulse"
        : "bg-accent-red";

  const label = closed
    ? sessionLabel
    : status === "connected"
      ? (session === "regular" ? "실시간" : sessionLabel)
      : status === "connecting"
        ? "연결 중"
        : "연결 끊김";

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-2xs text-text-dim whitespace-nowrap ${className}`}
      title={
        status === "connected"
          ? `${sessionLabel} · 마지막 갱신 ${ago(updatedAt) || "대기 중"}`
          : "시세 연결이 끊겼습니다. 자동으로 다시 연결합니다"
      }
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} aria-hidden />
      <span>{label}</span>
      {updatedAt && status === "connected" && (
        <span className="hidden sm:inline text-text-dim/70">· {ago(updatedAt)}</span>
      )}
    </span>
  );
}
