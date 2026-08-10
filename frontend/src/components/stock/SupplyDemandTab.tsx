/**
 * 투자자별 수급 — 외국인·기관·개인이 얼마나 사고 팔았나.
 *
 * 이 탭은 "서비스 준비중입니다" 안내판이었다. 그런데 백엔드는 진작 다 만들어
 * 두었다 — stocks.py 의 /KR/{symbol}/supply-demand 가 pykrx 로 일별 순매수
 * 거래대금을 돌려주고, 10분 캐시와 분당 10회 제한까지 걸려 있다. 프론트에서
 * 이 주소를 부르는 코드가 한 줄도 없었을 뿐이다.
 *
 * 값은 순매수 '거래대금'(원)이다. 주식 수가 아니라 금액이므로 억/조로 줄여
 * 읽는다. 음수면 순매도다.
 *
 * 두 가지를 같이 보여 준다.
 *   - 누적: 이 기간 동안 결국 누가 담았나 (막대 하나로 한눈에)
 *   - 일별: 언제 사고 언제 팔았나 (날짜별 묶음 막대)
 * 누적만 보면 방향은 알아도 시점을 모르고, 일별만 보면 합계를 암산해야 한다.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import { Users } from "lucide-react";
import { stocksApi } from "@/api/stocks";

/* 재무제표 탭과 같은 색 규칙을 쓴다 — 화면마다 외국인 색이 달라지면 안 된다 */
const 색 = { foreign: "#3b82f6", institution: "#10b981", individual: "#f59e0b" } as const;
const 이름 = { foreign: "외국인", institution: "기관", individual: "개인" } as const;
const 투자자 = ["foreign", "institution", "individual"] as const;

const 기간들 = [
  { days: 20,  label: "20일" },
  { days: 60,  label: "60일" },
  { days: 120, label: "120일" },
] as const;

/** 거래대금을 사람이 읽는 단위로. 조·억까지만 내려간다 — 그 아래는 이 화면에서 의미가 없다 */
function 금액(v: number): string {
  const a = Math.abs(v);
  const 부호 = v < 0 ? "-" : "";
  if (a >= 1e12) return `${부호}${(a / 1e12).toFixed(1)}조`;
  if (a >= 1e8)  return `${부호}${Math.round(a / 1e8).toLocaleString("ko-KR")}억`;
  if (a >= 1e4)  return `${부호}${Math.round(a / 1e4).toLocaleString("ko-KR")}만`;
  return `${부호}${Math.round(a).toLocaleString("ko-KR")}`;
}

export default function SupplyDemandTab({ symbol, isMobile }: { symbol: string; isMobile: boolean }) {
  const [days, setDays] = useState<number>(20);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["supply-demand", symbol, days],
    queryFn: () => stocksApi.getSupplyDemand(symbol, days),
    enabled: !!symbol,
    retry: 1,
    // 백엔드 캐시가 10분이라 그보다 자주 물어봐야 새 값이 안 나온다
    staleTime: 600_000,
  });

  const 행 = data ?? [];

  const 누적 = useMemo(() => {
    const 합 = { foreign: 0, institution: 0, individual: 0 };
    for (const r of 행) {
      합.foreign     += r.foreign     || 0;
      합.institution += r.institution || 0;
      합.individual  += r.individual  || 0;
    }
    return 합;
  }, [행]);

  /* 날짜는 "2026-08-07" 로 온다. 가로축에 그대로 넣으면 스무 개가 겹치므로
     월/일만 남긴다 */
  const 차트데이터 = useMemo(
    () => 행.map((r) => ({ ...r, 날짜: r.date.slice(5).replace("-", "/") })),
    [행],
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-bg-card flex items-center justify-center py-20">
        <div className="w-5 h-5 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  /* 데이터가 없는 경우가 실제로 있다 — KRX 조회가 막히거나(해외 IP 차단),
     신규 상장이라 기간이 안 채워졌거나. 그때 빈 차트를 그리면 축만 남아
     고장난 것처럼 보이므로 이유를 적어 준다. */
  if (isError || !행.length) {
    return (
      <div className="rounded-xl border border-border bg-bg-card flex flex-col items-center justify-center py-20 gap-3">
        <Users size={36} className="text-text-muted/30" />
        <div className="text-center">
          <p className="text-text-primary font-semibold text-base">수급 데이터가 없어요</p>
          <p className="text-text-muted text-sm mt-1">
            {isError ? "잠시 후 다시 시도해 주세요" : "이 종목은 아직 집계된 수급이 없습니다"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 기간 — 앱의 다른 필터 칩과 같은 모양 */}
      <div className="flex gap-1.5">
        {기간들.map(({ days: d, label }) => (
          <button
            key={d}
            aria-pressed={days === d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-all ${
              days === d
                ? "bg-accent-blue text-white"
                : "bg-bg-card border border-border text-text-muted hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 누적 순매수 — 결국 누가 담았나 */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="px-4 pt-3.5 pb-2">
          <span className="text-base font-semibold text-text-primary">누적 순매수</span>
          <span className="text-2xs text-text-dim ml-2">최근 {days}일 · 거래대금</span>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
          {투자자.map((k) => {
            const v = 누적[k];
            const 샀나 = v >= 0;
            return (
              <div key={k} className="px-3 py-3.5 flex flex-col gap-1 items-center">
                <span className="text-2xs text-text-muted">{이름[k]}</span>
                <span className="text-base font-mono font-bold num" style={{ color: 색[k] }}>
                  {샀나 ? "+" : ""}{금액(v)}
                </span>
                <span className="text-2xs text-text-dim">{샀나 ? "순매수" : "순매도"}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 일별 — 언제 사고 언제 팔았나 */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="px-4 pt-3.5 pb-1">
          <span className="text-base font-semibold text-text-primary">일별 순매수</span>
        </div>
        <div className="px-2 pb-3">
          <ResponsiveContainer width="100%" height={isMobile ? 240 : 320}>
            <BarChart data={차트데이터} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232840" />
              <XAxis dataKey="날짜" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false}
                     interval={Math.max(0, Math.floor(차트데이터.length / (isMobile ? 5 : 10)) - 1)} />
              <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false}
                     width={isMobile ? 46 : 58} tickFormatter={금액} />
              {/* 0선이 없으면 순매수와 순매도가 눈으로 안 갈린다 */}
              <ReferenceLine y={0} stroke="#4b5563" />
              <Tooltip
                contentStyle={{ background: "#141824", border: "1px solid #232840", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number, n: string) => [금액(v), 이름[n as keyof typeof 이름] ?? n]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }}
                      formatter={(n: string) => 이름[n as keyof typeof 이름] ?? n} />
              {투자자.map((k) => <Bar key={k} dataKey={k} fill={색[k]} radius={[2, 2, 0, 0]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
