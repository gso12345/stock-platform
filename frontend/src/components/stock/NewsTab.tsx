/** 뉴스·공시 탭 — 종목 상세의 '뉴스/공시'.
 *
 * 원래 StockDetail.tsx 본문 안에 있었다. 화면 본체가 2,082줄이라
 * 값 하나를 고치려고 열면 어디를 봐야 하는지부터 찾아야 했다.
 */
import { Newspaper, FileText, ExternalLink, DollarSign } from "lucide-react";
import { Tabs } from "@/components/ui";
import { DisclosurePanel } from "@/components/stock/EtfHoldingsTab";
import { SectionTitle } from "@/components/stock/DetailBits";
import { safeExternalUrl } from "@/utils/url";
import { fmtNewsDateTime, fmtKRW, fmtUSD } from "@/utils/formatters";
import type { 뉴스항목, 실적응답 } from "@/types";

export default function NewsTab({
  symbol, isKR, 뉴스, 불러오는중, 정렬, set정렬, 서브탭, set서브탭, 실적, fmt,
}: {
  symbol: string;
  isKR: boolean;
  뉴스: 뉴스항목[] | undefined;
  불러오는중: boolean;
  정렬: "latest" | "popular";
  set정렬: (v: "latest" | "popular") => void;
  서브탭: string;
  set서브탭: (v: string) => void;
  실적: 실적응답 | undefined;
  /** 통화 환산까지 마친 금액 표기 — 화면 본체가 쓰는 것과 같은 것을 받는다.
   *  여기서 다시 만들면 '원화로 보기' 설정이 이 탭에만 안 먹는다 */
  fmt: (v: number | null | undefined) => string;
}) {
  const sym = symbol;
  const stockNews = 뉴스;
  const loadingNews = 불러오는중;
  const newsSort = 정렬;
  const setNewsSort = set정렬;
  const newsSubTab = 서브탭;
  const setNewsSubTab = set서브탭;
  const earningsData = 실적;

  return (
    <div className="flex flex-col gap-4">
      {/* 서브탭 선택 */}
      <Tabs
        fill={false} size="md" className="w-fit"
        ariaLabel="뉴스·공시 선택"
        tabs={[
          { id: "news", label: "뉴스", icon: Newspaper },
          { id: "disclosure", label: "공시", icon: FileText },
        ]}
        active={newsSubTab}
        onChange={(id) => setNewsSubTab(id as any)}
      />

      {/* ── 뉴스 서브탭 ── */}
      {newsSubTab==="news" && (
        <>
      {/* 종목 뉴스 */}
      <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-base font-semibold text-text-primary">관련 뉴스</span>
          <div className="flex gap-1">
            {(["latest","popular"] as const).map(s=>(
              <button key={s}
                onClick={()=>setNewsSort(s)}
                className={`px-2 py-0.5 text-xs rounded font-semibold transition-all ${newsSort===s?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}>
                {s==="latest"?"최신순":"인기순"}
              </button>
            ))}
          </div>
        </div>
        {loadingNews ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/></div>
        ) : (stockNews?.length ?? 0) > 0 ? (() => {
          // 정렬은 서버가 처리한다 (인기도 산식을 노출하지 않기 위해)
          const sorted = stockNews ?? [];
          return (
            <>
              <ul>
                {sorted.map((item: any, i: number) => (
                  <li key={i} className="border-b border-border/30 last:border-0">
                    <a href={safeExternalUrl(item.link)} target="_blank" rel="noopener noreferrer nofollow"
                      className="flex items-start gap-3 px-4 py-3 hover:bg-bg-hover transition-colors group">
                      {safeExternalUrl(item.image) ? (
                        <img
                          src={safeExternalUrl(item.image)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          width={80}
                          height={80}
                          referrerPolicy="no-referrer"
                          className="w-20 h-20 rounded-lg object-cover flex-shrink-0 bg-bg-elevated"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="w-20 h-20 rounded-lg flex-shrink-0 bg-bg-elevated flex items-center justify-center">
                          <Newspaper size={20} className="text-text-muted" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-base text-text-primary group-hover:text-accent-blue transition-colors line-clamp-2">{item.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {item.source && <span className="text-xs text-accent-blue/70 font-medium">{item.source}</span>}
                          {item.published && (
                            <span className="text-xs text-text-muted">
                              {typeof item.published === "number"
                                ? new Date(item.published*1000).toLocaleDateString("ko-KR")
                                : fmtNewsDateTime(item.published)}
                            </span>
                          )}
                        </div>
                        {item.summary && <p className="text-sm text-text-muted mt-1 line-clamp-2">{item.summary}</p>}
                      </div>
                      <ExternalLink size={13} className="text-text-muted flex-shrink-0 mt-1"/>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          );
        })() : (
          <p className="py-8 text-center text-text-muted text-base">뉴스 데이터가 없습니다</p>
        )}
      </div>
      {/* 실적발표 */}
      {earningsData && (earningsData.upcoming?.length > 0 || earningsData.history?.length > 0) && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-base font-semibold text-text-primary">실적발표</span>
            <DollarSign size={14} className="text-text-muted"/>
          </div>
          <div className="p-4 flex flex-col gap-4">
            {/* 예정 실적 */}
            {earningsData.upcoming?.length > 0 && (
              <div>
                <SectionTitle>예정 발표일</SectionTitle>
                <div className="flex flex-wrap gap-2">
                  {earningsData.upcoming.filter(Boolean).map((dt: string, i: number) => (
                    <span key={i} className="px-3 py-1.5 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-accent-blue text-sm font-mono font-semibold">
                      {dt}
                    </span>
                  ))}
                  {earningsData.eps_estimate != null && (
                    <span className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-text-muted text-sm">
                      EPS 예상: {isKR ? earningsData.eps_estimate?.toLocaleString("ko-KR") : `$${earningsData.eps_estimate?.toFixed(2)}`}
                    </span>
                  )}
                  {/* 매출 예상도 같이 온다. EPS 만 쓰고 버리고 있었다 */}
                  {earningsData.revenue_estimate != null && (
                    <span className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-text-muted text-sm">
                      매출 예상: {fmt(earningsData.revenue_estimate)}
                    </span>
                  )}
                </div>
              </div>
            )}
            {/* 과거 실적 */}
            {earningsData.history?.length > 0 && (
              <div>
                <SectionTitle>과거 실적</SectionTitle>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-text-muted border-b border-border">
                        <th className="text-left pb-2 font-medium">연도</th>
                        <th className="text-right pb-2 font-medium text-accent-blue">매출</th>
                        <th className="text-right pb-2 font-medium text-accent-green">순이익</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...earningsData.history].reverse().map((row: any) => (
                        <tr key={row.period} className="border-b border-border/30 hover:bg-bg-hover">
                          <td className="py-1.5 font-mono text-text-muted">{row.period}</td>
                          <td className="py-1.5 text-right font-mono text-accent-blue num">{isKR?fmtKRW(row.revenue):fmtUSD(row.revenue)}</td>
                          <td className={`py-1.5 text-right font-mono num ${(row.earnings??0)>=0?"text-accent-green":"text-accent-red"}`}>{isKR?fmtKRW(row.earnings):fmtUSD(row.earnings)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

        </>
      )}

      {/* ── 공시 서브탭 ── */}
      {newsSubTab==="disclosure" && (
        isKR
          ? <DisclosurePanel symbol={sym} />
          : (
            <div className="rounded-xl border border-border bg-bg-card flex items-center justify-center py-16">
              <p className="text-text-muted text-base">공시 데이터는 국내 주식(KR)만 지원합니다</p>
            </div>
          )
      )}
    </div>
  );
}
