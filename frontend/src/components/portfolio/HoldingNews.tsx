/**
 * 보유 종목 뉴스 — 내 종목 얘기를 한 자리에.
 *
 * 종목 상세마다 뉴스 탭이 있지만, 열 종목을 가진 사람은 '내 종목에
 * 무슨 일이 있었나' 를 보려고 화면을 열 번 드나들어야 했다.
 *
 * ── 정직하게 보여야 하는 것 ──
 *
 * 서버는 새 기사를 받아 오지 않는다. 이미 받아 둔 캐시(종합 뉴스 +
 * 누가 열어 본 종목 뉴스)에서만 고른다 — 종목마다 외부에 물어보면
 * 스무 종목이 외부 호출 스무 번이고, 0.15 CPU 서버에서 그건 화면이
 * 30초를 기다린다는 뜻이다.
 *
 * 그 대가로 '기사를 아직 못 찾은 종목' 이 생긴다. 그걸 숨기면 사용자는
 * "내 종목엔 뉴스가 없구나" 로 읽는다. 사실이 아니다 — 아직 안 받아
 * 왔을 뿐이고, 그 종목을 한 번 열어 보면 다음부터 나온다. 그래서
 * 못 찾은 종목을 아래에 그대로 적고, 눌러서 갈 수 있게 둔다.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Newspaper, ExternalLink } from "lucide-react";
import { portfolioApi, type 보유뉴스응답 } from "@/api/stocks";
import { Card, 못불러옴 } from "@/components/ui";
import { safeExternalUrl } from "@/utils/url";
import { fmtNewsDateTime } from "@/utils/formatters";

export default function 보유뉴스({ portfolioId, 미리보기 }: {
  portfolioId?: number;
  /** 로그인 전 미리보기. 주면 /portfolio/news(로그인 필요)를 안 부른다.
   *
   *  기사는 **진짜다** — 대시보드가 이미 받아 둔 종합 뉴스에서 예시
   *  종목을 언급한 것을 골라낸다(hooks/usePortfolioPreview). 서버에
   *  요청이 하나도 안 늘어나고, 눌러도 실제 기사로 간다. */
  미리보기?: 보유뉴스응답;
}) {
  const { data: 받은것, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["portfolio-news", portfolioId ?? "all"],
    queryFn: () => portfolioApi.getHoldingNews(portfolioId),
    enabled: !미리보기,
    /* 서버 캐시가 5분이라 그보다 자주 물어볼 이유가 없다 */
    staleTime: 300_000,
    /* 아직 오는 중인 종목이 있으면 몇 초 뒤 한 번 더 물어본다.
       서버가 요청을 안 붙잡는 대신 배경에서 받아 오기 때문에, 이게
       없으면 처음 연 사람은 절반만 보고 나가게 된다.
       다 채워지면(pending 0) 알아서 멈춘다 — 계속 두드리면 0.15 CPU
       서버에서 그 자체가 부담이다. */
    refetchInterval: (q) => ((q.state.data?.pending ?? 0) > 0 ? 5_000 : false),
    refetchIntervalInBackground: false,
  });

  /* 예시가 있으면 그걸, 없으면 서버가 준 것.
     틀() 이 이 값을 읽으므로 반드시 그 위에서 정해야 한다 —
     아래에 두었다가 '선언 전에 썼다' 로 뉴스 탭이 통째로 죽었다. */
  const data = 미리보기 ?? 받은것;

  const 틀 = (속: React.ReactNode) => (
    <Card className="flex flex-col gap-3 p-0 overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 pt-4">
        <Newspaper size={14} className="text-accent-blue" />
        <span className="text-sm font-semibold text-text-primary">내 종목 뉴스</span>
        {미리보기 && <span className="text-2xs font-medium text-text-dim">예시 종목</span>}
        {data && data.items.length > 0 && (
          <span className="text-2xs text-text-dim ml-auto">{data.items.length}건</span>
        )}
      </div>
      {속}
    </Card>
  );

  if (!미리보기 && isError) return 틀(<div className="px-4 pb-4"><못불러옴 사유={error} 다시={() => refetch()} compact /></div>);
  if (!미리보기 && isLoading) {
    return 틀(
      <div className="flex flex-col gap-2 px-4 pb-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="w-20 h-20 rounded-lg bg-bg-elevated animate-pulse shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5 py-1">
              <div className="h-3.5 w-full rounded bg-bg-elevated animate-pulse" />
              <div className="h-3.5 w-3/5 rounded bg-bg-elevated animate-pulse" />
              <div className="h-3 w-24 rounded bg-bg-elevated animate-pulse mt-1" />
            </div>
          </div>
        ))}
      </div>,
    );
  }

  const 기사들 = data?.items ?? [];
  const 못찾음 = data?.missing ?? [];
  const 오는중 = data?.pending ?? 0;

  return 틀(
    <>
      {기사들.length === 0 ? (
        <p className="px-4 pb-6 pt-2 text-center text-xs text-text-dim break-keep">
          {오는중 > 0
            ? "기사를 모으는 중이에요. 잠시만 기다려 주세요."
            : "내 종목 기사를 아직 못 찾았어요."}
        </p>
      ) : (
        <ul>
          {기사들.map((item) => (
            <li key={item.link || item.title} className="border-t border-border/40">
              {/* 주소가 없는 줄(예시)은 링크로 안 만든다 — 눌러도 아무
                  데도 안 가는 링크는 고장으로 보인다 */}
              {(() => {
              const 갈수있나 = !!safeExternalUrl(item.link);
              const 속 = (
                <>
                {safeExternalUrl(item.image) ? (
                  <img
                    src={safeExternalUrl(item.image)!}
                    alt="" loading="lazy" decoding="async"
                    width={72} height={72} referrerPolicy="no-referrer"
                    className="w-[4.5rem] h-[4.5rem] rounded-lg object-cover flex-shrink-0 bg-bg-elevated"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-[4.5rem] h-[4.5rem] rounded-lg flex-shrink-0 bg-bg-elevated flex items-center justify-center">
                    <Newspaper size={20} className="text-text-muted" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {/* 어느 종목 얘기인지 —
                      한 자리에 모아 놓으면 이게 없을 때 '왜 이 기사가
                      여기 있지' 가 된다. 한 기사가 두 종목에 걸리기도 한다 */}
                  <div className="flex flex-wrap items-center gap-1 mb-1">
                    {item.symbols.slice(0, 3).map((s) => (
                      <span key={s} className="text-2xs font-mono font-semibold px-1.5 py-px rounded bg-accent-blue/12 text-accent-blue">
                        {s}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-text-primary group-hover:text-accent-blue transition-colors line-clamp-2 break-keep">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {item.source && <span className="text-2xs text-accent-blue/70 font-medium truncate">{item.source}</span>}
                    {item.published && (
                      <span className="text-2xs text-text-muted whitespace-nowrap">{fmtNewsDateTime(item.published)}</span>
                    )}
                  </div>
                </div>
                {갈수있나 && <ExternalLink size={13} className="text-text-muted flex-shrink-0 mt-1" />}
                </>
              );
              const 결 = "flex items-start gap-3 px-4 py-3 transition-colors group";
              return 갈수있나 ? (
                <a href={safeExternalUrl(item.link)!} target="_blank"
                   rel="noopener noreferrer nofollow" className={`${결} hover:bg-bg-hover`}>
                  {속}
                </a>
              ) : (
                <div className={결}>{속}</div>
              );
              })()}
            </li>
          ))}
        </ul>
      )}

      {/* 못 찾은 종목 — 숨기면 '뉴스가 없다' 로 읽힌다 */}
      {못찾음.length > 0 && (
        <div className="px-4 py-3 border-t border-border/40 bg-bg-elevated/40">
          <p className="text-2xs text-text-dim break-keep mb-1.5 flex items-center gap-1.5">
            {오는중 > 0 ? (
              <>
                <span className="w-3 h-3 border-2 border-accent-blue border-t-transparent rounded-full animate-spin shrink-0" />
                {오는중}개 종목의 기사를 받아 오는 중이에요. 잠시 뒤 자동으로 나와요.
              </>
            ) : (
              "이 종목들은 최근 기사를 못 찾았어요. 눌러서 직접 열어 볼 수 있어요."
            )}
          </p>
          <div className="flex flex-wrap gap-1">
            {못찾음.map((m) => (
              <Link
                key={`${m.market}:${m.symbol}`}
                to={`/stocks/${m.market}/${encodeURIComponent(m.symbol)}`}
                className="text-2xs px-2 py-1 rounded-lg border border-border text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-colors"
              >{m.name}</Link>
            ))}
          </div>
        </div>
      )}
    </>,
  );
}
