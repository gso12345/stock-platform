/**
 * 낮은 값 ~ 높은 값 사이에서 지금이 어디쯤인지 보여 주는 막대.
 *
 * 52주 고가·저가는 숫자 두 개로만 놓여 있었다. "지금 52주 밴드의 어디냐" 는
 * 투자 판단에서 자주 보는 것인데, 그걸 알려면 세 숫자를 암산해야 했다.
 *
 * 투자의견 탭에 이미 같은 모양(저-고 밴드 + 현재가 마커)이 있었지만 그 자리에
 * 인라인으로 박혀 있어 다른 데서 쓸 수 없었다. 여기로 빼서 둘이 같은 모양을
 * 쓰게 한다 — 같은 뜻의 그림이 화면마다 다르면 매번 다시 읽어야 한다.
 */
export default function RangeBar({
  low, high, current, marker, lowLabel, highLabel, markerLabel, fmt,
}: {
  low: number;
  high: number;
  current: number;
  /** 현재가 말고 하나 더 찍을 것 (예: 평균 목표주가) */
  marker?: number | null;
  lowLabel?: string;
  highLabel?: string;
  markerLabel?: string;
  fmt: (v: number) => string;
}) {
  const 폭 = high - low;
  if (!(폭 > 0)) return null;

  /* 값이 밴드를 벗어날 수 있다 — 52주 신고가를 막 뚫었거나, 목표주가가
     최근 고가보다 높은 경우다. 그대로 두면 막대 밖에 점이 찍히므로 가둔다 */
  const 위치 = (v: number) => Math.min(100, Math.max(0, ((v - low) / 폭) * 100));
  const 현재 = 위치(current);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-1.5 rounded-full bg-bg-elevated">
        {/* 저점부터 지금까지 차오른 부분 */}
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent-blue/30"
             style={{ width: `${현재}%` }} />
        {marker != null && (
          <span
            aria-hidden
            title={markerLabel}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-3 bg-accent-yellow rounded"
            style={{ left: `${위치(marker)}%` }}
          />
        )}
        <span
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-accent-blue ring-2 ring-bg-card"
          style={{ left: `${현재}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-2xs text-text-muted">
        <span>{lowLabel ?? fmt(low)}</span>
        {/* 위치를 숫자로도 준다 — 색·점을 못 보는 사람에게는 이것이 정보다 */}
        <span className="text-text-dim">{Math.round(현재)}% 지점</span>
        <span>{highLabel ?? fmt(high)}</span>
      </div>
    </div>
  );
}
