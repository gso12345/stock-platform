/**
 * 스크리닝 표의 칸 그림 — 연도별 막대, 칸 하나. 로고·▲▼ 등락은 퀀트와 함께 쓴다(common/StockTable).
 */
import { cn } from "@/components/ui";
import { 등락표시 } from "@/components/common/StockTable";
import { 칸글, type 칸정의 } from "./screeningDefs";

export { 회사로고, 등락표시 } from "@/components/common/StockTable";

/** 연도별 매출·EPS 막대(참고한 스크리너의 10Y REV·EPS 칸). 야후가 연간 실적을 4년치쯤만 줘서
 *  막대도 그만큼이다. 높이는 그 종목 안에서의 크기 — 종목끼리 견주는 그림이 아니다.
 *  적자(0 밑) 해는 빨간 막대가 아래로 내려간다. 값은 설명(마우스를 올리면 뜨는 글)에 다 적는다. */
export function 흐름막대({ 값들, 설명 }: { 값들: (number | null)[]; 설명: string }) {
  const 있는 = 값들.filter((v): v is number => v != null && Number.isFinite(v));
  if (!있는.length) return <span className="text-text-dim">—</span>;
  const 위 = Math.max(0, ...있는);
  const 아래 = Math.min(0, ...있는);
  const 폭 = 위 - 아래 || 1;
  const W = 52, H = 20;
  const 칸 = W / 값들.length;
  const 굵기 = Math.max(3, Math.min(9, 칸 - 3));
  const 영점 = (위 / 폭) * H;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={설명}
      className="inline-block align-middle overflow-visible">
      <title>{설명}</title>
      {값들.map((v, i) => {
        if (v == null || !Number.isFinite(v)) return null;
        const 높이 = Math.max(1.5, (Math.abs(v) / 폭) * H);
        return (
          <rect key={i} x={i * 칸 + (칸 - 굵기) / 2} y={v >= 0 ? 영점 - 높이 : 영점}
            width={굵기} height={높이} rx={1}
            className={v < 0 ? "fill-accent-red" : i === 값들.length - 1 ? "fill-accent-blue" : "fill-accent-blue/40"} />
        );
      })}
    </svg>
  );
}

/** 표의 칸 하나 */
export function 칸값({ 칸, 줄, 이름 }: { 칸: 칸정의; 줄: Record<string, any>; 이름: string }) {
  const v = 줄[칸.key];
  if (칸.모양 === "흐름") {
    return <흐름막대 값들={Array.isArray(v) ? v : []} 설명={`${이름}: ${칸글(칸, 줄)}`} />;
  }
  if (칸.모양 === "등락" && typeof v === "number" && Number.isFinite(v)) return <등락표시 값={v} />;
  const 글 = 칸글(칸, 줄);
  if (글 === "—") return <span className="text-text-dim">—</span>;
  if (칸.모양 === "글") {
    return <span className="block max-w-[10rem] truncate text-text-secondary" title={글}>{글}</span>;
  }
  const 굵게 = 칸.모양 === "가격" || 칸.key === "market_cap";
  return <span className={cn("font-mono num", 굵게 ? "text-text-primary" : "text-text-secondary")}>{글}</span>;
}
