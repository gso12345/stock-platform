import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { quantScoreApi, stocksApi, type QuantRankingFactor } from "@/api/stocks";
import { Card, Badge, LoadingSpinner } from "@/components/ui";
import type { Market } from "@/types";
import { Award, AlertCircle } from "lucide-react";

const MARKET_TABS: { id: "KR" | "US" | "ETF"; label: string }[] = [
  { id: "KR", label: "한국" },
  { id: "US", label: "미국" },
  { id: "ETF", label: "ETF" },
];

const FACTOR_TABS: { id: QuantRankingFactor; label: string }[] = [
  { id: "total",    label: "종합" },
  { id: "value",    label: "가치" },
  { id: "quality",  label: "퀄리티" },
  { id: "momentum", label: "모멘텀" },
  { id: "growth",   label: "성장" },
  { id: "risk",     label: "안정성" },
];

function gradeColor(grade: string | null) {
  if (!grade) return "text-text-muted";
  if (grade.startsWith("A")) return "text-accent-green";
  if (grade.startsWith("B")) return "text-accent-blue";
  if (grade.startsWith("C")) return "text-accent-yellow";
  return "text-accent-red";
}

export default function Quant() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [market, setMarket] = useState<"KR" | "US" | "ETF">("KR");
  const [factor, setFactor] = useState<QuantRankingFactor>("total");

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["quant-ranking", market, factor],
    queryFn: () => quantScoreApi.getRanking(market, factor, 50),
    staleTime: 300_000,
  });

  const prefetchStock = (symbol: string) => {
    const mkt = market as Market;
    if (qc.getQueryData(["stock-detail", mkt, symbol])) return;
    qc.prefetchQuery({ queryKey: ["stock-detail", mkt, symbol], queryFn: () => stocksApi.getDetail(mkt, symbol), staleTime: 60_000 });
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <Award size={22} className="text-accent-blue" />
          퀀트 랭킹
        </h1>
        <p className="text-text-muted text-xs mt-0.5">
          저장된(또는 기본) 팩터 가중치를 기준으로 캐시된 종목들을 퀀트 점수로 순위화합니다
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-1 bg-bg-elevated border border-border rounded-lg p-0.5 w-fit">
          {MARKET_TABS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMarket(m.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                market === m.id ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-bg-elevated border border-border rounded-lg p-0.5 w-fit overflow-x-auto">
          {FACTOR_TABS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFactor(f.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
                factor === f.id ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <LoadingSpinner />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
            <AlertCircle size={32} className="text-accent-red/60" />
            <p className="text-text-secondary text-sm">순위 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요</p>
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
            <Award size={32} className="text-text-muted/40" />
            <p className="text-text-secondary text-sm">아직 점수가 계산된 종목이 없어요</p>
            <p className="text-text-muted text-xs">종목 상세 페이지에서 퀀트 점수를 한 번이라도 조회하면 순위에 포함됩니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg-secondary border-b border-border z-10">
                <tr className="text-text-muted text-[11px]">
                  <th className="w-12 px-3 py-3 text-left">순위</th>
                  <th className="text-left px-3 py-3">종목</th>
                  <th className="text-right px-3 py-3">점수</th>
                  {factor === "total" && <th className="text-right px-3 py-3">등급</th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr
                    key={`${item.market}-${item.symbol}`}
                    onMouseEnter={() => prefetchStock(item.symbol)}
                    onClick={() => navigate(`/stocks/${item.market}/${item.symbol}`)}
                    className="border-b border-border/30 hover:bg-bg-hover/50 transition-colors cursor-pointer"
                  >
                    <td className="px-3 py-2.5 text-text-muted font-mono">{item.rank}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-text-primary">{item.symbol}</span>
                        <Badge variant={item.market === "KR" ? "blue" : item.market === "ETF" ? "purple" : "green"}>
                          {item.market}
                        </Badge>
                      </div>
                      <div className="text-text-muted text-[11px] truncate max-w-[200px]">{item.name}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-text-primary">
                      {item.score.toFixed(1)}
                    </td>
                    {factor === "total" && (
                      <td className={`px-3 py-2.5 text-right font-mono font-bold ${gradeColor(item.grade)}`}>
                        {item.grade ?? "-"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isFetching && !isLoading && (
          <div className="px-3 py-2 text-[11px] text-text-muted border-t border-border/30">갱신 중...</div>
        )}
      </Card>
    </div>
  );
}
