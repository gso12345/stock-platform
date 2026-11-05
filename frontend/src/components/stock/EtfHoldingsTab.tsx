/** ETF 보유비중·공시 — 종목 상세의 꼬리에 붙어 있던 두 조각.
 *
 * 원래 StockDetail.tsx(2,082줄) 맨 아래에 있었다. 둘 다 자기 데이터를
 * 직접 받아 오는 독립 부품인데, 화면 본체와 한 파일에 있어서 종목
 * 상세를 열 때마다 같이 딸려 왔다.
 */
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart2, FileText } from "lucide-react";
import api from "@/api/client";
import { stocksApi, type ETF구성종목 } from "@/api/stocks";
import { safeExternalUrl } from "@/utils/url";
import { fmtDate } from "@/utils/formatters";
import type { Market } from "@/types";

/** 국내 종목 코드 — 6자리이고 숫자로 시작한다. 새로 상장하는 종목은 영문이 섞인다(0193W0·00680K).
 *  예전에는 숫자만 국내로 봐서, 이런 국내 ETF 가 비면 '구성종목이 공개되지 않습니다' 라고 잘못 말했다 */
export const 국내코드꼴 = /^\d[0-9A-Z]{5}(\.(KS|KQ))?$/i;

/** '2026-10-31' → '10.31' (올해가 아니면 '25.10.31'). 꼴이 다르면 그대로 */
export function 기준일(날: string, 오늘 = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(날);
  if (!m) return 날;
  return Number(m[1]) === 오늘.getFullYear() ? `${m[2]}.${m[3]}` : `${m[1].slice(2)}.${m[2]}.${m[3]}`;
}

/* ── ETF 보유비중 탭 ──────────────────────────────────────── */
const SECTOR_KO: Record<string, string> = {
  technology: "기술",
  financial_services: "금융",
  healthcare: "헬스케어",
  consumer_cyclical: "소비재(경기)",
  communication_services: "통신서비스",
  industrials: "산업재",
  consumer_defensive: "소비재(필수)",
  energy: "에너지",
  basic_materials: "소재",
  real_estate: "부동산",
  utilities: "유틸리티",
};

export function EtfHoldingsTab({ symbol, market }: { symbol: string; market: Market }) {
  const navigate = useNavigate();
  /* 구성종목이 어느 시장인지는 서버가 알려 준다(market). 예전에는 ETF 의 시장으로 짐작했는데, 국내 ETF 도
     미국 주식을 담아서(TIGER 미국S&P500) /stocks/KR/NVDA 같은 없는 화면이 열렸다. market 이 없는 예전
     응답(캐시)만 예전처럼 짐작한다 */
  const 종목으로 = (h: ETF구성종목) =>
    navigate(`/stocks/${h.market ?? (market === "KR" ? "KR" : "US")}/${encodeURIComponent(h.symbol)}`);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["etf_holdings", symbol],
    queryFn: () => stocksApi.getEtfHoldings(symbol),
    staleTime: 3_600_000,
    retry: 1,
  });

  if (isLoading) return (
    <div className="rounded-xl border border-border bg-bg-card p-8 text-center text-text-muted text-base">
      보유비중 불러오는 중
    </div>
  );

  if (isError) return (
    <div className="rounded-xl border border-border bg-bg-card flex flex-col items-center justify-center py-20 gap-4">
      <BarChart2 size={40} className="text-text-muted/30" />
      <p className="text-text-muted text-base">보유비중 데이터를 불러올 수 없습니다</p>
    </div>
  );

  const holdings = data?.holdings ?? [];
  const sectors = data?.sector_weights ?? [];

  const isKrEtf = 국내코드꼴.test(symbol);
  if (!holdings.length && !sectors.length) return (
    <div className="rounded-xl border border-border bg-bg-card flex flex-col items-center justify-center py-20 gap-4">
      <BarChart2 size={40} className="text-text-muted/30" />
      <div className="text-center px-6">
        <p className="text-text-muted text-base">보유비중 데이터가 없습니다</p>
        <p className="text-2xs text-text-dim mt-2">
          {isKrEtf
            ? "국내 ETF 구성종목은 네이버 증권에서 가져옵니다"
            : "구성종목을 공개하지 않는 ETF 이거나 아직 받지 못했습니다"}
        </p>
        {/* 왜 비었는지 서버가 알려 주면 보여 준다.
            단 서버가 주는 것은 사람이 읽는 한 문장이다 — 예외 이름이나
            스택 같은 내부 사정은 로그에만 남긴다. 화면에 그대로 뿌리면
            쓰는 사람에게는 뜻이 없고, 서버 안쪽 구조만 드러난다. */}
        {data?.reason && (
          <p className="text-2xs text-text-dim/70 mt-1">{data.reason}</p>
        )}
      </div>
    </div>
  );

  const maxPct = holdings.length ? Math.max(...holdings.map(h => h.pct ?? 0)) || 1 : 1;

  return (
    <div className="flex flex-col gap-4">
      {/* 상위 보유종목 */}
      {holdings.length > 0 && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-base font-semibold text-text-primary">상위 보유종목</span>
            {/* 출처·기준일도 같이. 전체가 더 많으면(S&P500 은 504개) 비중 큰 것만 보인다고 알린다 —
                '25종목' 만 적으면 ETF 가 25종목만 담은 줄 안다 */}
            <span className="text-xs text-text-muted text-right">
              {data?.total && data.total > holdings.length
                ? `전체 ${data.total.toLocaleString("ko-KR")}개 중 ${holdings.length}개`
                : `${holdings.length}종목`}
              {data?.source && ` · ${data.source}`}
              {data?.as_of && ` · ${기준일(data.as_of)} 기준`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-muted border-b border-border bg-bg-secondary">
                  <th className="text-left px-4 py-2.5 font-medium w-8">#</th>
                  <th className="text-left px-2 py-2.5 font-medium">종목</th>
                  <th className="text-right px-4 py-2.5 font-medium w-24">비중</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h, i) => (
                  /* 심볼을 갖고 있으면서 글자로만 찍고 있었다. 앱의 다른
                     목록(관심종목·퀀트·대시보드 랭킹)은 전부 행을 눌러
                     그 종목으로 넘어간다 — 여기만 막다른 길이었다.
                     심볼이 없는 항목(현금·기타)은 그대로 둔다 */
                  <tr key={i}
                      onClick={h.symbol ? () => 종목으로(h) : undefined}
                      className={`border-b border-border/30 transition-colors ${
                        h.symbol ? "cursor-pointer hover:bg-bg-hover" : ""}`}>
                    <td className="px-4 py-2.5 text-text-muted font-mono text-xs">{i + 1}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-text-primary font-medium truncate max-w-[180px] sm:max-w-none">{h.name || h.symbol}</span>
                        {h.symbol && h.name && (
                          <span className="text-xs text-text-muted font-mono">{h.symbol}</span>
                        )}
                        <div className="mt-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden w-full max-w-[200px]">
                          <div
                            className="h-full bg-accent-blue rounded-full transition-all"
                            style={{ width: `${Math.min(((h.pct ?? 0) / maxPct) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-accent-blue whitespace-nowrap">
                      {(h.pct ?? 0).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 섹터 비중 */}
      {sectors.length > 0 && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-base font-semibold text-text-primary">섹터 비중</span>
          </div>
          <div className="p-4 flex flex-col gap-2.5">
            {sectors.map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm text-text-muted w-28 flex-shrink-0 truncate">
                  {SECTOR_KO[s.sector] ?? s.sector}
                </span>
                <div className="flex-1 h-2 bg-bg-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-purple rounded-full transition-all"
                    style={{ width: `${Math.min(s.pct, 100)}%` }}
                  />
                </div>
                <span className="text-sm font-mono font-semibold text-accent-purple w-14 text-right flex-shrink-0">
                  {s.pct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DisclosurePanel({ symbol }: { symbol: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["disclosures", symbol],
    queryFn: () => api.get(`/stocks/KR/${encodeURIComponent(symbol)}/disclosures`).then(r=>r.data),
    staleTime: 1_800_000,
  });
  if (isLoading) return <div className="rounded-xl border border-border bg-bg-card p-8 text-center text-text-muted text-base">공시 불러오는 중</div>;
  const items = Array.isArray(data) ? data : [];
  return (
    <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-base font-semibold text-text-primary">최근 공시</span>
        <FileText size={14} className="text-text-muted"/>
      </div>
      {!items.length ? (
        <p className="py-8 text-center text-text-muted text-base">공시 데이터가 없습니다 (OpenDART API 키 필요)</p>
      ) : (
        <ul>{items.map((item: any, i: number) => (
          <li key={i} className="border-b border-border/30 last:border-0">
            {/* 같은 파일의 뉴스 링크는 safeExternalUrl 을 거치는데 여기만
                안 거치고 있었다. 지금은 서버가 dart.fss.or.kr 로 스킴을
                하드코딩해 만들므로 악용할 수 없지만, 한 화면에서 규칙이
                갈리면 다음에 고치는 사람이 어느 쪽을 따라야 할지 모른다. */}
            <a href={safeExternalUrl(item.url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors group">
              <div className="flex-1 min-w-0">
                <p className="text-base text-text-primary group-hover:text-accent-blue transition-colors">{item.title}</p>
                <p className="text-xs text-text-muted mt-0.5">{item.reporter} · {fmtDate(item.date?.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"))}</p>
              </div>
              <FileText size={13} className="text-text-muted flex-shrink-0"/>
            </a>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
