/**
 * 가치 위치 — 사용자: "바로 할 수 있는 것 해줘"(기본적 분석으로 6개월·1년 뒤를 맞힐 수 있느냐는 물음에, 예측 대신 바로
 * 할 수 있는 참고로 내놓은 것). 지금 PER·PBR 이 이 종목의 지난날(최대 5년) 가운데 어디쯤인지 보여 준다.
 * 서버는 backend/app/services/predict/valuation.py.
 *
 *   · 숫자(PER·PBR)는 종목 정보와 같은 공식 값. 위치는 날마다 '주가 ÷ 그날 알려진 최근 1년 순이익(순자산)' 으로 센 것
 *   · 막대는 지난날의 차례 — 왼쪽 끝이 가장 쌌던 날, 오른쪽 끝이 가장 비쌌던 날, 가운데 금이 가운데 값, 삼각이 지금.
 *     채운 만큼이 '지금보다 쌌던 날'
 *   · 초록·빨강을 쓰지 않는다 — 싸다고 좋은 것도, 비싸다고 나쁜 것도 아니다(사라·팔라는 말로 읽히지 않게)
 *   · '예측이 아니에요' 를 늘 같이 — 싸 보이는 종목이 오른다는 것은 여러 종목을 모아야 겨우 보이는 약한 경향이다
 * 예측(주가예측 질의)이 온 뒤에 묻는다 — 일봉을 서버가 이미 받아 둔 다음이라 두 번 받지 않는다. ETF 는 묻지 않는다.
 */
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { predictApi, type 가치자리, type 주가예측 } from "@/api/predict";
import { Card, 못불러옴 } from "@/components/ui";
import {
  가운데견줌글, 가치기준글, 가치까닭글, 기간길이글, 끝날견줌글, 배수글, 뺀동안글, 쌌던날글,
} from "@/utils/주가예측";

export const 가치예측아님글 = "예측이 아니에요 — 싸 보인다고 오르고, 비싸 보인다고 내리는 것은 아니에요";

export default function 가치위치({ 예측 }: { 예측: 주가예측 }) {
  const 제목id = useId();
  const ETF = 예측.market === "ETF";
  const 질의 = useQuery({
    queryKey: ["predict-valuation", 예측.market, 예측.symbol],
    queryFn: () => predictApi.valuation(예측.market, 예측.symbol),
    staleTime: 30 * 60_000,
    enabled: !ETF,
  });
  if (ETF) return null;
  const 자료 = 질의.data;
  return (
    <section aria-labelledby={제목id}>
      <Card className="flex flex-col gap-3">
        <div>
          <h2 id={제목id} className="text-sm font-semibold text-text-primary">가치 위치</h2>
          <p className="text-2xs text-text-dim break-keep">이 종목의 지난날 PER·PBR 가운데 지금이 어디쯤인지예요</p>
        </div>
        {질의.isLoading ? (
          <div aria-busy="true" aria-label="가치 위치를 셈하는 중" className="flex flex-col gap-2">
            <div className="h-14 rounded-xl bg-bg-elevated animate-pulse" />
            <div className="h-14 rounded-xl bg-bg-elevated animate-pulse" />
          </div>
        ) : 질의.isError || !자료 ? (
          <못불러옴 사유={질의.error} 다시={() => 질의.refetch()} compact />
        ) : (
          <div className="flex flex-col divide-y divide-border-subtle">
            <가치줄 칸="per" 자리={자료.per} 오늘={자료.as_of ?? 예측.as_of} />
            <가치줄 칸="pbr" 자리={자료.pbr} 오늘={자료.as_of ?? 예측.as_of} />
          </div>
        )}
        <p className="text-2xs font-semibold text-accent-yellow break-keep">{가치예측아님글}</p>
      </Card>
    </section>
  );
}

function 가치줄({ 칸, 자리, 오늘 }: { 칸: "per" | "pbr"; 자리: 가치자리; 오늘: string }) {
  const 이름 = 칸 === "per" ? "PER" : "PBR";
  const 풀이 = 칸 === "per" ? "주가 ÷ 순이익" : "주가 ÷ 순자산";
  return (
    <div className="py-2.5 first:pt-0 last:pb-0" data-testid={`가치-${칸}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-text-muted shrink-0">{이름} <span className="text-text-dim">({풀이})</span></span>
        <span className="ml-auto text-sm font-semibold text-text-primary num">{배수글(칸, 자리.now)}</span>
      </div>
      {자리.why !== null ? (
        <p className="mt-1 text-xs text-text-muted break-keep">{가치까닭글(자리.why)}</p>
      ) : (
        <위치 칸={칸} 이름={이름} 자리={자리} 오늘={오늘} />
      )}
    </div>
  );
}

function 위치({ 칸, 이름, 자리, 오늘 }: {
  칸: "per" | "pbr";
  이름: string;
  자리: Extract<가치자리, { why: null }>;
  오늘: string;
}) {
  const 기간 = 기간길이글(자리.from, 오늘);
  const 차례 = 쌌던날글(자리.below);
  // 끝에 붙은 삼각도 막대 안에 보이게 조금 들인다
  const 점 = Math.min(Math.max(자리.below * 100, 1.5), 98.5);
  const 뺀 = 뺀동안글(칸, 자리.excluded);
  return (
    <>
      <p className="mt-1 text-xs font-semibold text-text-primary break-keep">
        지난 {기간} 동안 {차례}
      </p>
      <div className="mt-3">
        <div className="relative h-2.5 rounded-full bg-bg-elevated" role="img"
          aria-label={`${이름} 위치 — 왼쪽 끝이 지난 ${기간} 가운데 가장 쌌던 날, 오른쪽 끝이 가장 비쌌던 날. ${차례}`}>
          <span className="absolute inset-y-0 left-0 rounded-full bg-accent-blue/30" style={{ width: `${자리.below * 100}%` }} />
          <span className="absolute -inset-y-0.5 left-1/2 w-px bg-text-dim" />
          <span className="absolute -top-2.5 -translate-x-1/2 text-text-primary text-2xs leading-none" style={{ left: `${점}%` }}>▼</span>
        </div>
        <div className="mt-1 flex justify-between text-2xs text-text-dim">
          <span>가장 쌀 때</span>
          <span>가운데</span>
          <span>가장 비쌀 때</span>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-text-secondary break-keep">{가운데견줌글(자리.vs_median)}</p>
      <p className="mt-0.5 text-2xs text-text-dim break-keep">가장 쌌던 날 {끝날견줌글(자리.cheapest)}</p>
      <p className="text-2xs text-text-dim break-keep">가장 비쌌던 날 {끝날견줌글(자리.priciest)}</p>
      <p className="mt-0.5 text-2xs text-text-dim break-keep">
        지금은 {가치기준글(칸, 자리.basis)}으로 셈했어요{뺀 ? ` · ${뺀}` : ""}
      </p>
    </>
  );
}
