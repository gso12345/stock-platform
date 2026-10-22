/**
 * 비중 — 다른 기준으로 한눈에(아주 넓은 화면).
 *
 * 비중 탭은 종목별·자산유형별·포트폴리오별 중 하나만 그린다. PC 에서는 원그래프 옆이 비어 있었고, 다른 기준을
 * 보려면 칩을 눌러 갈아 끼워야 했다(사용자: "내자산 … PC버전에서도 최적화된 화면(… 비중 …)"). 고른 기준 옆에
 * 나머지 기준을 막대 한 줄과 비율로 놓는다 — '크게 보기' 를 누르면 그 기준으로 바꾼다.
 * 색은 큰 것부터 같은 차례(요약 카드의 구성 칸과 같다). 비율이라 금액 가리기와 상관없다.
 */
export interface 비중덩이 { name: string; value: number }

/** 이만큼까지만 이름을 적는다 — 나머지는 막대에만 */
const 적을수 = 5;

export default function 다른기준비중({ 제목, 덩이들, 색들, onSelect }: {
  제목: string;
  덩이들: 비중덩이[];
  색들: string[];
  onSelect: () => void;
}) {
  const 큰순 = 덩이들.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const 합 = 큰순.reduce((s, d) => s + d.value, 0);
  if (!(합 > 0)) return null;
  const 비율 = (v: number) => (v / 합) * 100;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border/60 p-3" aria-label={제목}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold text-text-muted">{제목}</span>
        <button type="button" onClick={onSelect}
          className="text-2xs text-text-muted hover:text-accent-blue transition-colors">크게 보기 ›</button>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-bg-elevated" role="img"
        aria-label={`${제목} ${큰순.map((d) => `${d.name} ${비율(d.value).toFixed(0)}%`).join(", ")}`}>
        {큰순.map((d, i) => (
          <span key={d.name} style={{ width: `${비율(d.value)}%`, background: 색들[i % 색들.length] }} />
        ))}
      </div>
      <ul className="flex flex-col gap-0.5">
        {큰순.slice(0, 적을수).map((d, i) => (
          <li key={d.name} className="flex items-center gap-1.5 text-2xs min-w-0">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 색들[i % 색들.length] }} />
            <span className="truncate text-text-secondary">{d.name}</span>
            <span className="ml-auto font-mono num text-text-primary">{비율(d.value).toFixed(1)}%</span>
          </li>
        ))}
        {큰순.length > 적을수 && (
          <li className="text-2xs text-text-dim">그 밖 {큰순.length - 적을수}개 {비율(큰순.slice(적을수).reduce((s, d) => s + d.value, 0)).toFixed(1)}%</li>
        )}
      </ul>
    </section>
  );
}
