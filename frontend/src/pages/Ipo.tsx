/**
 * 공모주 — 상장일 시초가 예측.
 *
 * 사용자 요청: "공모주 상장 시가 예측할 수 있는 메뉴를 만들어줘"
 *
 * 한 화면에 셋을 둔다.
 *   · 다가오는 공모주 — 수요예측·청약·상장 단계와 나온 숫자, 시초가 예측
 *   · 직접 넣어 보기 — 목록에 없는 공모주나 '청약경쟁률이 이렇다면?' 을 넣어 본다
 *   · 최근 상장 — 같은 방법으로 맞혀 본 값과 실제. 예측을 얼마나 믿을지 여기서 본다
 *
 * 넓은 화면에서는 계산기를 오른쪽에 붙여 두고(따라 내려온다), 좁은 화면에서는
 * 목록 아래로 내린다. 카드의 '이 숫자로 직접 바꿔 보기' 를 누르면 그리로 간다.
 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Rocket, RefreshCw } from "lucide-react";
import { Card, RowSkeleton, 못불러옴, 빈화면 } from "@/components/ui";
import { ipoApi, type 공모주직접입력, type 공모주한눈에 } from "@/api/stocks";
import IpoCard from "@/components/ipo/IpoCard";
import IpoCalculator from "@/components/ipo/IpoCalculator";
import IpoRecent from "@/components/ipo/IpoRecent";

/** '2026-10-09T14:30:12+09:00' → '10.9 14:30' (서버가 한국 시각으로 준다) */
function 기준시각(iso: string | null): string | null {
  if (!iso || iso.length < 16) return null;
  return `${+iso.slice(5, 7)}.${+iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

function 자료없음({ data, 다시 }: { data: 공모주한눈에; 다시: () => void }) {
  if (data.refreshing) {
    return <빈화면 icon={RefreshCw} title="공모주 자료를 처음 받는 중이에요"
      hint="지난 공모주까지 거슬러 받느라 몇 분 걸려요. 받는 대로 여기 채워져요." />;
  }
  const 이유 = Object.entries(data.source.lists)
    .filter(([, v]) => !v.rows && v.reason).map(([k, v]) => `${k}: ${v.reason}`).join(" · ");
  return <빈화면 icon={Rocket} title="공모주 자료를 아직 못 받았어요"
    hint={이유 ? `자료 원천(${data.source.name})에서 받지 못했어요 — ${이유}` : "잠시 뒤 다시 열어 주세요."}
    action={{ label: "다시 보기", onClick: 다시 }} />;
}

function 어떻게예측하나() {
  return (
    <Card className="flex flex-col gap-2">
      <details className="group">
        <summary className="cursor-pointer text-sm font-bold text-text-primary list-none flex items-center justify-between">
          어떻게 예측하나요?
          <span className="text-2xs font-semibold text-accent-blue group-open:hidden">펼치기</span>
          <span className="text-2xs font-semibold text-accent-blue hidden group-open:inline">접기</span>
        </summary>
        <ul className="mt-2 flex flex-col gap-1.5 text-xs text-text-secondary break-keep list-disc pl-4">
          <li>2023년 6월 26일 이후 상장한 공모주만 써요. 이날부터 상장 첫날 가격이 공모가의 60%~400% 안에서 움직여요(그 전에는 시초가가 2배에서 막혀 있었어요).</li>
          <li>기관경쟁률·의무보유확약·청약경쟁률, 공모가가 희망밴드 어디쯤에서 정해졌는지, 공모금액, 최근 공모주 분위기가 가까운 과거 공모주 8곳을 찾아요.</li>
          <li>그 공모주들이 실제로 시작한 가격과, 같은 항목으로 세운 통계 모델의 값을 가운데로 맞춰 예상 시초가를 내요. 범위는 그 공모주들 가운데 절반이 시작한 구간이에요.</li>
          <li>스팩·리츠는 성격이 달라 저희끼리만 견줘요.</li>
          <li>상장일 장 분위기, 상장 첫날 팔 수 있는 물량, 장 시작 전 주문은 넣지 못했어요.</li>
        </ul>
      </details>
      <p className="text-2xs text-text-dim break-keep">
        지난 공모주 결과로 만든 추정치예요. 실제 시초가와 크게 다를 수 있고, 투자 판단과 책임은 본인에게 있어요.
      </p>
    </Card>
  );
}

export default function Ipo() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["ipo"],
    queryFn: ipoApi.overview,
    staleTime: 5 * 60_000,
    // 서버가 뒤에서 자료를 받는 중이면 끝날 때까지 가끔 다시 본다
    refetchInterval: (q) => (q.state.data?.refreshing ? 15_000 : false),
  });
  const [계산기값, set계산기값] = useState<공모주직접입력 | null>(null);
  const 계산기자리 = useRef<HTMLDivElement>(null);
  const 바꿔보기 = (v: 공모주직접입력) => {
    set계산기값({ ...v });
    계산기자리.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  const 시각 = 기준시각(data?.as_of ?? null);

  return (
    <div className="flex flex-col gap-5 max-w-6xl mx-auto pb-20">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">공모주</h1>
        <p className="text-text-muted text-xs mt-0.5">상장 첫날 시초가를 비슷했던 과거 공모주로 예측해요</p>
      </div>

      {isLoading ? (
        <RowSkeleton rows={4} />
      ) : !data ? (
        <못불러옴 사유={error} 다시={() => refetch()} />
      ) : !data.n_records ? (
        <자료없음 data={data} 다시={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <section className="lg:col-span-2 flex flex-col gap-3" aria-labelledby="ipo-다가오는">
              <div className="flex items-baseline justify-between gap-2">
                <h2 id="ipo-다가오는" className="text-sm font-bold text-text-primary">
                  다가오는 공모주 <span className="text-text-muted font-semibold">{data.upcoming.length}</span>
                </h2>
                {시각 && (
                  <span className="text-2xs text-text-dim">
                    {시각} 기준{data.refreshing ? " · 새로 받는 중" : ""}
                  </span>
                )}
              </div>
              {data.upcoming.length ? (
                data.upcoming.map((g) => <IpoCard key={`${g.name}-${g.forecast_date ?? g.sub_start ?? ""}`} 공모주={g} 바꿔보기={바꿔보기} />)
              ) : (
                <Card>
                  <빈화면 compact icon={Rocket} title="지금 진행 중인 공모주가 없어요"
                    hint="수요예측·청약 일정이 잡히면 여기에 나와요. 그 사이에는 직접 넣어 볼 수 있어요." />
                </Card>
              )}
            </section>
            <aside ref={계산기자리} className="flex flex-col gap-3 lg:sticky lg:top-4 scroll-mt-4">
              <IpoCalculator 처음값={계산기값} />
            </aside>
          </div>

          <IpoRecent 줄들={data.recent} 정확도={data.accuracy} />
          <어떻게예측하나 />
          <p className="text-2xs text-text-dim text-center">
            자료: {data.source.name} (수요예측결과·청약일정·신규상장){시각 ? ` · ${시각} 기준` : ""}
          </p>
        </>
      )}
    </div>
  );
}
