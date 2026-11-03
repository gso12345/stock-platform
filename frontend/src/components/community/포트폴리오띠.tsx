/**
 * 피드 목록에서 보이는 포트폴리오 — 비중 색 띠 한 줄과 상위 3종목(사용자가 고른 8번).
 *
 * 예전에는 목록에서도 원 그래프를 통째로 그려, 포트폴리오 글 하나가 휴대폰 화면의 40% 넘게(약 340px)를
 * 차지했다. 목록은 훑어보는 곳이라 '무엇을 얼마나' 만 보이면 된다. 글을 열면 원 그래프가 그대로 나온다.
 *
 * 차트 묶음(recharts)을 끌어오지 않는다 — 피드가 그 110KB 를 기다리지 않게 하려고 원 그래프를 따로
 * 받도록 해 둔 까닭이 그대로 남는다. 색은 원 그래프와 같은 순서(PIE_COLORS)라 글을 열어도 같은 색이다.
 */
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/api/stocks";
import { 하루수명 } from "@/constants/portfolioQuery";
import { PIE_COLORS } from "@/constants/pieColors";
import { 종목별비중, type 공유종목 } from "@/utils/포트폴리오비중";

/** 이름까지 보여 주는 종목 수 — 나머지는 '외 n종목' */
export const 보일종목수 = 3;

const 퍼센트 = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function 포트폴리오띠({ items }: { items: 공유종목[] }) {
  // 원 그래프(PortfolioSnapshot)와 같은 환율 조회 — 같은 이름표라 한 번만 받는다
  const { data: fxData } = useQuery({
    queryKey: ["exchange-rate"],
    queryFn: () => dashboardApi.getExchangeRate(),
    staleTime: 하루수명,
  });
  const 환율: number = (fxData as any)?.value ?? 0;
  const 비중들 = 종목별비중(items, 환율);
  if (비중들.length === 0) return null;
  const 남은수 = 비중들.length - 보일종목수;

  return (
    <div className="rounded-xl bg-bg-elevated/60 border border-border/60 px-3 py-2.5 flex flex-col gap-2">
      <div className="flex h-2 rounded-full overflow-hidden bg-bg-elevated" role="img"
        aria-label={`종목 비중 — ${비중들.map((b) => `${b.name} ${퍼센트(b.비중)}`).join(", ")}`}>
        {비중들.map((b, i) => (
          <span key={b.symbol} style={{ width: `${b.비중 * 100}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
        ))}
      </div>
      <ul className="flex flex-col gap-1">
        {비중들.slice(0, 보일종목수).map((b, i) => (
          <li key={b.symbol} className="flex items-center gap-2 text-xs min-w-0">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
            <span className="text-text-secondary truncate flex-1">{b.name}</span>
            <span className="num font-semibold text-text-primary">{퍼센트(b.비중)}</span>
          </li>
        ))}
      </ul>
      {남은수 > 0 && <p className="text-2xs text-text-dim">외 {남은수}종목</p>}
    </div>
  );
}
