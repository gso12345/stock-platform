/**
 * 자산배분 백테스트 탭 — 설정과 결과를 잇는 자리.
 *
 * 저장한 실험 목록은 여기 없다. '전략 저장소' 탭이 그 일을 다 한다 —
 * 저장한 것이 두 군데로 갈라져 있으면 어디에 뒀는지 기억해야 한다.
 *
 * 계산은 서버가 하고, 여기는 설정을 모아 보내고 받은 것을 그리는 일만
 * 한다. 수익률을 화면에서 다시 계산하지 않는다 — 두 군데서 계산하면
 * 반드시 어긋나고, 그 어긋남은 '어느 쪽이 맞나' 를 아무도 모르는
 * 상태로 이어진다.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backtestApi, type 자산배분요청, type 자산배분결과, type 저장된실험 } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { Card, 못불러옴 } from "@/components/ui";
import { 읽을수있는오류 } from "@/utils/errors";
import 자산배분설정, { 첫설정, type 설정 } from "./AllocationForm";
import 자산배분결과화면 from "./AllocationResult";

/** 화면의 설정을 서버가 받는 모양으로. */
export function 보낼것(s: 설정): 자산배분요청 {
  return {
    assets: s.assets,
    currency: s.currency,
    initial_amount: Number(s.initial_amount) || 0,
    start_date: s.start_date,
    end_date: s.end_date,
    /* 주기가 '없음' 이면 금액도 0 으로 보낸다. 금액만 남겨 두면
       서버가 '적립 있음' 으로 읽어 총납입이 부풀려진다 */
    contribution_period: s.contribution_period,
    contribution_amount: s.contribution_period === "none"
      ? 0 : (Number(s.contribution_amount) || 0),
    rebalance_period: s.rebalance_period,
    total_return: s.total_return,
    rebalance_day: s.rebalance_day,
    /* 퍼센트 그대로 보낸다 — 비율로 바꾸는 것은 서버 한 곳에서만 한다.
       양쪽에서 나누면 수수료가 100분의 1 이 되고, 아무도 못 알아챈다 */
    cost_rate: Number(s.cost_rate) || 0,
    data_interval: s.data_interval,
    benchmark: s.benchmark,
    equal_weight: s.equal_weight,
    extended: s.extended,
  };
}

/** 이 설정이면 얼마나 걸릴까 — **초** 단위 어림.
 *
 *  서버가 하는 일이 설정에 따라 크게 달라진다. 자산 열둘에 배당까지
 *  켜면 시세를 스물넷 받아야 하고, 벤치마크를 고르면 한 번 더 돌린다.
 *  그걸 무시하고 고정된 시간으로 그리면, 짧은 경우엔 막대가 멈춰 있고
 *  긴 경우엔 100%에서 한참 기다리게 된다.
 *
 *  서버가 동시에 넷씩 받으므로 자산 수를 4로 나눠 센다. */
export function 예상초(s: 설정): number {
  const n = Math.max(s.assets.filter((a) => a.symbol !== "현금").length, 1);
  const 묶음 = Math.ceil(n / 4);
  let 초 = 묶음 * 1.2;                                   // 시세
  if (s.total_return) 초 += 묶음 * 1.0;                  // 배당
  if (s.currency === "KRW" ? s.assets.some((a) => a.market !== "KR")
                           : s.assets.some((a) => a.market === "KR")) 초 += 0.8;  // 환율
  if (s.benchmark !== "none") 초 += 2.0;                 // 한 번 더 돌린다
  return Math.max(초, 1.5);
}

/** 어디쯤인지 말로. 퍼센트만 있으면 무엇을 기다리는지 모른다. */
export function 단계글(비율: number, s: 설정): string {
  if (비율 < 0.45) return "자산마다 시세를 받는 중…";
  if (비율 < 0.7) return s.total_return ? "배당 기록을 받는 중…" : "시세를 정리하는 중…";
  if (비율 < 0.88) return "굴려 보는 중…";
  return s.benchmark !== "none" ? "견줄 상대를 돌리는 중…" : "마무리하는 중…";
}

/**
 * 계산이 도는 동안 진행률을 보여 준다.
 *
 * ── 이 퍼센트가 무엇인지 ────────────────────────────────────
 *
 * **서버가 알려 주는 값이 아니다.** 지금 구조에서는 서버가 중간
 * 상태를 보내 줄 길이 없다(한 번의 POST 로 끝난다). 이 수는 '설정을
 * 보고 어림한 시간' 대비 '지난 시간' 이다.
 *
 * 그래서 **100%를 먼저 찍지 않게** 92%에서 멈춘다. 다 됐다고 해 놓고
 * 계속 도는 것은 아무것도 안 보여 주는 것보다 나쁘다 — 사용자는
 * 화면이 멈춘 줄 안다. 진짜 100%는 응답이 실제로 왔을 때만이다.
 *
 * 오래 걸리면 그 사실도 적어 준다. 무료 서버가 자고 있었으면 첫
 * 요청이 30초 넘게 걸리는데, 아무 말이 없으면 고장으로 읽힌다.
 */
export function 진행바({ 설정: s }: { 설정: 설정 }) {
  const [지난초, set지난초] = useState(0);
  const 예상 = 예상초(s);

  useEffect(() => {
    const 시작 = Date.now();
    const t = setInterval(() => set지난초((Date.now() - 시작) / 1000), 100);
    return () => clearInterval(t);
  }, []);

  /* 92%에서 멈춘다. 끝은 응답이 정한다. */
  const 비율 = Math.min(지난초 / 예상, 0.92);
  const 퍼센트 = Math.round(비율 * 100);
  const 오래걸림 = 지난초 > 예상 * 2 + 5;

  return (
    <Card className="flex flex-col gap-3 py-10">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-text-muted">{단계글(비율, s)}</span>
        <span className="text-sm font-mono font-bold tabular-nums text-accent-blue">
          {퍼센트}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-bg-elevated overflow-hidden">
        <div
          role="progressbar"
          aria-label="계산 진행률"
          aria-valuenow={퍼센트}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-full bg-accent-blue rounded-full transition-[width] duration-200 ease-out"
          style={{ width: `${퍼센트}%` }}
        />
      </div>
      <span className="text-2xs text-text-dim break-keep">
        {오래걸림
          ? "서버가 쉬고 있었나 봐요. 첫 요청은 30초 넘게 걸릴 수 있어요 — 조금만 더 기다려 주세요."
          : `자산 ${s.assets.length}개${s.benchmark !== "none" ? " · 벤치마크까지" : ""} 계산하고 있어요.`}
      </span>
    </Card>
  );
}

/** 저장해 둔 실험을 화면 설정으로 되돌린다.
 *
 *  ?? 를 쓴다(|| 가 아니라). cost_rate 0 과 equal_weight false 는
 *  **고른 값**인데, || 로 두면 falsy 라서 지금 화면 값으로 덮인다 —
 *  수수료를 0 으로 저장해 두고 불러오면 0.25% 가 되어 있는 식이다.
 *
 *  옛날에 저장한 실험에는 뒤에 붙은 칸들이 아예 없다. 그때는 지금
 *  화면 값을 그대로 둔다 — undefined 를 넣으면 고르기 칸이 통제
 *  불능이 된다. */
export function 실험을설정으로(x: 저장된실험, 지금: 설정): 설정 {
  return {
    ...지금,
    직접입력: true,
    start_date: x.start_date, end_date: x.end_date,
    currency: x.currency, initial_amount: x.initial_amount,
    assets: x.assets,
    contribution_period: x.contribution_period,
    contribution_amount: x.contribution_amount,
    rebalance_period: x.rebalance_period,
    total_return: x.total_return,
    rebalance_day: x.rebalance_day ?? 지금.rebalance_day,
    cost_rate: x.cost_rate ?? 지금.cost_rate,
    data_interval: x.data_interval ?? 지금.data_interval,
    benchmark: x.benchmark ?? 지금.benchmark,
    equal_weight: x.equal_weight ?? 지금.equal_weight,
    extended: x.extended ?? 지금.extended,
  };
}

export default function 자산배분탭({ 불러올실험, 불러옴 }: {
  /** 전략 저장소 탭에서 고른 실험. 이 탭 밖에서 고를 수 있어야 해서
   *  위에서 내려 준다 — 같은 목록이 두 곳에 있으니 어느 쪽에서
   *  눌러도 같은 자리로 와야 한다. */
  불러올실험?: number | null;
  불러옴?: () => void;
} = {}) {
  const qc = useQueryClient();
  const { isLoggedIn } = useAuthStore();
  const [설정값, set설정값] = useState<설정>(() => 첫설정());
  const [결과, set결과] = useState<자산배분결과 | null>(null);
  const [오류, set오류] = useState<string | null>(null);
  /* 저장 직후 잠깐 띄우는 초록 줄. 목록을 이 화면에서 없앴으므로
     이게 없으면 저장이 됐는지 알 방법이 아예 없다. */
  const [저장됨, set저장됨] = useState(false);

  const { data: 실험들 = [] } = useQuery({
    queryKey: ["backtest-experiments"],
    queryFn: backtestApi.getExperiments,
    /* 서버가 비로그인에 빈 배열을 주므로 401 이 안 난다.
       그래도 로그인 전에는 부를 이유가 없다 */
    enabled: isLoggedIn,
    staleTime: 300_000,
  });

  const 돌리기 = useMutation({
    mutationFn: () => backtestApi.runPortfolio(보낼것(설정값)),
    onSuccess: (d) => { set결과(d); set오류(null); },
    /* detail 을 그대로 넣으면 안 된다 — FastAPI 422 는 객체 배열이라
       React 자식으로 들어가는 순간 화면이 죽는다 */
    onError: (e: any) => set오류(읽을수있는오류(
      e?.response?.data?.detail, "계산에 실패했어요. 잠시 후 다시 시도해 주세요")),
  });

  const 저장 = useMutation({
    mutationFn: () => backtestApi.saveExperiment({
      ...보낼것(설정값),
      name: 설정값.assets.map((a) => a.name || a.symbol).slice(0, 3).join(" · ")
            + (설정값.assets.length > 3 ? ` 외 ${설정값.assets.length - 3}` : ""),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backtest-experiments"] });
      set저장됨(true);
      set오류(null);
    },
    onError: (e: any) => set오류(읽을수있는오류(
      e?.response?.data?.detail, "저장에 실패했어요")),
  });

  /* 설정을 고치면 초록 줄을 내린다. 안 내리면 '저장했어요' 가 그대로
     붙어 있어서, 고친 내용까지 저장된 줄 알게 된다. */
  useEffect(() => { set저장됨(false); }, [설정값]);

  /* 전략 저장소 탭에서 고른 실험을 받아 온다.
     목록이 아직 안 왔을 수 있으니 실험들이 채워진 뒤에 맞춰 본다.
     한 번 불러오면 위에 알려서 같은 것을 되풀이해 안 열게 한다. */
  useEffect(() => {
    if (불러올실험 == null) return;
    const x = 실험들.find((e) => e.id === 불러올실험);
    if (!x) return;
    set설정값((앞) => 실험을설정으로(x, 앞));
    set결과(null);
    불러옴?.();
  }, [불러올실험, 실험들, 불러옴]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      <div className="flex flex-col gap-4">
        <자산배분설정
          값={설정값}
          바꾸기={set설정값}
          돌리기={() => 돌리기.mutate()}
          도는중={돌리기.isPending}
          저장하기={isLoggedIn ? () => 저장.mutate() : undefined}
          저장중={저장.isPending}
          저장됨={저장됨}
        />
      </div>

      <div className="flex flex-col gap-4">
        {오류 && (
          <Card className="border-accent-red/40">
            <못불러옴 사유={오류} 다시={() => 돌리기.mutate()} compact />
          </Card>
        )}
        {!오류 && !결과 && !돌리기.isPending && (
          <Card className="flex flex-col gap-2 py-12 text-center">
            <span className="text-sm text-text-muted">
              자산을 고르고 ‘결과 확인’ 을 눌러 보세요
            </span>
            <span className="text-2xs text-text-dim break-keep px-4">
              예: S&P500 ETF 60% · 금 20% · 현금 20% 로 8년, 매달 50만원씩 더 넣고
              해마다 비중 맞추기
            </span>
          </Card>
        )}
        {돌리기.isPending && <진행바 설정={설정값} />}
        {결과 && !돌리기.isPending && <자산배분결과화면 r={결과} />}
      </div>
    </div>
  );
}
