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
import { backtestApi, type 자산배분요청, type 자산배분결과, type 저장된실험,
         type 서버진행 } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { Card, 못불러옴 } from "@/components/ui";
import { 읽을수있는오류, 요청실패말 } from "@/utils/errors";
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
    //: 퍼센트 그대로 보낸다 — 비율로 바꾸는 것은 서버 한 곳에서만 한다
    cash_rate: Number(s.cash_rate) || 0,
    risk_free_rate: Number(s.risk_free_rate) || 0,
  };
}

/** 이번 계산에 붙일 진행 열쇠.
 *
 *  서버가 진행 상황을 이 열쇠 아래에 적어 둔다. 남이 맞혀 봐야 나오는
 *  것은 '시세 3/8' 뿐이라(무엇을 담았는지도, 결과도 없다) 비밀일 필요는
 *  없지만, 남의 것과 겹치면 서로의 진행바가 뒤섞이므로 충분히 길게
 *  만든다.
 *
 *  crypto.randomUUID 가 없는 환경(옛 브라우저·jsdom 일부)도 있어
 *  없으면 손으로 만든다 — 열쇠가 없다고 계산이 막히면 안 된다. */
export function 새열쇠(): string {
  try {
    const c = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  } catch { /* 아래로 */ }
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** 이 설정이면 얼마나 걸릴까 — **초** 단위 어림.
 *
 *  서버가 진행 상황을 못 줄 때만 쓰는 **대비책**이다. 서버가 주면
 *  그쪽이 이긴다 — 어림은 어차피 어림이다.
 *
 *  ── 왜 어림이 그렇게 빗나갔나 ─────────────────────────────
 *
 *  예전 어림은 자산 둘이면 4.2초였는데 실제로는 30초가 넘었다.
 *  **무료 서버가 자고 있다가 깨는 시간**을 안 세었기 때문이다. Render
 *  무료 요금제는 한동안 요청이 없으면 서버를 내리고, 다음 첫 요청이
 *  깨우는 데만 20~50초가 든다. 계산이 느린 것이 아니라 서버가 자고
 *  있었던 것이다.
 *
 *  그래서 **첫 요청인지**를 보고 깨우는 시간을 얹는다. 한 번 돌고 나면
 *  서버는 한동안 깨어 있으므로 그 뒤로는 안 얹는다. */
export function 예상초(s: 설정, 깨우기 = false): number {
  const n = Math.max(s.assets.filter((a) => a.symbol !== "현금").length, 1);
  const 묶음 = Math.ceil(n / 4);
  let 초 = 묶음 * 1.2;                                   // 시세
  if (s.total_return) 초 += 묶음 * 1.0;                  // 배당
  if (s.currency === "KRW" ? s.assets.some((a) => a.market !== "KR")
                           : s.assets.some((a) => a.market === "KR")) 초 += 0.8;  // 환율
  if (s.benchmark !== "none") 초 += 2.0;                 // 한 번 더 돌린다
  /* 자던 서버를 깨우는 몫. 실측으로 20~50초라 가운데쯤을 잡는다 —
     적게 잡으면 또 막대가 일찍 끝에 붙고, 많이 잡으면 빠른 경우에
     막대가 기어간다. */
  if (깨우기) 초 += 25;
  return Math.max(초, 1.5);
}

/** 서버가 안 알려 줄 때 쓰는 비율 — **절대 멈추지 않는다.**
 *
 *  예전에는 `min(지난초/예상, 0.92)` 였다. 어림을 넘기는 순간 92% 에
 *  박혀서, 30초를 더 기다리는 동안 막대가 한 픽셀도 안 움직였다.
 *  멈춘 막대는 아무것도 없는 것보다 나쁘다 — 사용자는 화면이 죽은 줄
 *  알고 새로고침하고, 그러면 처음부터 다시 시작한다.
 *
 *  어림까지는 그대로 가고, 그 뒤로는 **남은 거리의 일부씩** 줄여 간다.
 *  99% 에 점점 가까워지되 절대 닿지 않는다 — 늘 움직이고, 끝났다고
 *  거짓말하지도 않는다. */
export function 어림비율(지난초: number, 예상: number): number {
  if (예상 <= 0) return 0;
  /* 어림까지 가도 **70% 까지만** 간다.
     어림은 어차피 어림이라 90% 를 찍어 놓으면, 조금만 더 걸려도 곧장
     끝에 붙어 또 멈춘 것처럼 보인다. 못 미더운 수일수록 겸손해야 한다. */
  if (지난초 <= 예상) return (지난초 / 예상) * 0.7;
  /* 넘긴 뒤로는 **30초마다 남은 거리의 절반**씩 간다.
     예상에 비례해 줄이면 어림이 짧을 때(자산 하나에 4초) 30초 만에
     99% 에 붙어 다시 멈춘 것처럼 보인다 — 실제 시간으로 잡아야
     사람이 보는 속도가 설정과 무관하게 일정하다.
     몇 분을 기다려도 눈에 띄게 움직이고, 99% 를 넘지는 않는다. */
  const 반감기 = 30;
  return 0.7 + 0.29 * (1 - Math.pow(0.5, (지난초 - 예상) / 반감기));
}

/** 어디쯤인지 말로. 퍼센트만 있으면 무엇을 기다리는지 모른다. */
export function 단계글(비율: number, s: 설정): string {
  if (비율 < 0.45) return "자산마다 시세를 받는 중…";
  if (비율 < 0.7) return s.total_return ? "배당 기록을 받는 중…" : "시세를 정리하는 중…";
  if (비율 < 0.88) return "굴려 보는 중…";
  return s.benchmark !== "none" ? "견줄 상대를 돌리는 중…" : "마무리하는 중…";
}

/** 걸린 시간을 사람이 읽는 말로 — '95초' 보다 '1분 35초' 가 읽힌다 */
export function 지난말(초: number): string {
  const s = Math.floor(초);
  if (s < 60) return `${s}초`;
  return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, "0")}초`;
}

/**
 * 계산이 도는 동안 진행률을 보여 준다.
 *
 * ── 이 퍼센트가 무엇인지 ────────────────────────────────────
 *
 * **서버가 알려 주는 실제 값**이다. 요청에 열쇠를 하나 실어 보내면
 * 서버가 일하면서 그 열쇠에 '시세 4/8' 같은 것을 적어 두고, 화면이
 * 따로 물어본다. 어림이 아니다.
 *
 * 못 물어볼 때만 어림으로 돌아간다(서버가 옛 버전이거나, 중간에 있는
 * 무언가가 막거나). 그때도 **막대는 멈추지 않는다** — 어림을 넘긴
 * 뒤로는 99% 에 점점 가까워지며 계속 움직인다.
 *
 * 100% 는 응답이 실제로 왔을 때만이다. 다 됐다고 해 놓고 계속 도는
 * 것은 아무것도 안 보여 주는 것보다 나쁘다.
 */
export function 진행바({ 설정: s, 열쇠, 깨우기 }: {
  설정: 설정;
  /** 서버에 보낸 진행 열쇠. 없으면 어림으로만 그린다 */
  열쇠?: string;
  /** 첫 요청인가 — 자던 서버를 깨우는 시간을 어림에 얹는다 */
  깨우기?: boolean;
}) {
  const [지난초, set지난초] = useState(0);
  const [서버, set서버] = useState<서버진행 | null>(null);
  const 예상 = 예상초(s, 깨우기);

  useEffect(() => {
    const 시작 = Date.now();
    const t = setInterval(() => set지난초((Date.now() - 시작) / 1000), 100);
    return () => clearInterval(t);
  }, []);

  /* 서버에 물어본다. 0.8초마다 — 더 자주 물으면 0.15 CPU 서버에
     부담이고, 더 뜸하면 막대가 뚝뚝 끊겨 보인다. */
  useEffect(() => {
    if (!열쇠) return;
    let 살아있나 = true;
    const 물어보기 = async () => {
      const x = await backtestApi.getPortfolioProgress(열쇠);
      if (살아있나 && x) set서버(x);
    };
    물어보기();
    const t = setInterval(물어보기, 800);
    return () => { 살아있나 = false; clearInterval(t); };
  }, [열쇠]);

  /* 서버 값이 있으면 그것을 쓴다. 다만 **뒤로는 안 간다** — 어림이
     앞서 있었는데 서버 값이 낮게 오면 막대가 되돌아가고, 되돌아가는
     막대는 고장으로 읽힌다. */
  const 어림 = 어림비율(지난초, 예상);
  const 비율 = 서버 ? Math.max(서버.percent / 100, 어림 * 0.5) : 어림;
  const 퍼센트 = Math.min(Math.round(비율 * 100), 99);
  const 오래걸림 = 지난초 > 예상 * 2 + 5;

  return (
    <Card className="flex flex-col gap-3 py-10">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-text-muted">
          {서버?.글 ? `${서버.글}…` : 단계글(비율, s)}
        </span>
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
          className="h-full bg-accent-blue rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${퍼센트}%` }}
        />
      </div>
      {/* 걸린 시간은 **어림이 아니라 진짜 수**다. 퍼센트가 못 미더울
          때도 이건 '살아 있다' 는 증거가 된다. */}
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-2xs text-text-dim break-keep">
          {서버
            ? (서버.total > 1
                ? `${서버.단계} ${서버.done}/${서버.total}`
                : `${서버.단계} 하는 중`)
            : `자산 ${s.assets.length}개${s.benchmark !== "none" ? " · 벤치마크까지" : ""} 계산하고 있어요.`}
        </span>
        <span className="text-2xs text-text-dim font-mono tabular-nums">
          {지난말(지난초)} 지남
        </span>
      </div>
      {오래걸림 && (
        <span className="text-2xs text-accent-yellow/90 break-keep">
          서버가 쉬고 있었나 봐요. 첫 요청은 30초 넘게 걸릴 수 있어요 —
          창을 닫지 마시고 조금만 더 기다려 주세요.
        </span>
      )}
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
    cash_rate: x.cash_rate ?? 지금.cash_rate,
    risk_free_rate: x.risk_free_rate ?? 지금.risk_free_rate,
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

  /* 돌릴 때마다 새 열쇠를 만든다. 같은 열쇠를 다시 쓰면 앞 요청의
     진행 상황이 남아 있어, 새로 누른 순간 막대가 80% 에서 시작한다. */
  const [진행열쇠, set진행열쇠] = useState<string | undefined>();
  /* 처음 한 번은 자던 서버를 깨우는 시간이 든다. 한 번 돌고 나면
     서버가 한동안 깨어 있으므로 그 뒤로는 안 얹는다. */
  const [처음인가, set처음인가] = useState(true);

  const 돌리기 = useMutation({
    mutationFn: () => {
      const 열쇠 = 새열쇠();
      set진행열쇠(열쇠);
      return backtestApi.runPortfolio({ ...보낼것(설정값), progress_key: 열쇠 });
    },
    onSuccess: (d) => { set결과(d); set오류(null); set처음인가(false); },
    /* **끊긴 것과 실패한 것을 가른다.**
       '계산에 실패했어요' 만 띄우면 서버가 고장 난 줄 알고 떠난다.
       대개는 자던 서버가 깨느라 오래 걸렸을 뿐이고(무료 서버는 20~50초),
       다시 누르면 훨씬 빠르다. detail 을 그대로 넣지 않는 것도 그대로다 —
       FastAPI 422 는 객체 배열이라 React 자식으로 들어가면 화면이 죽는다
       (utils/errors 의 요청실패말이 둘 다 맡는다). */
    onError: (e: any) => set오류(
      요청실패말(e, "계산에 실패했어요. 잠시 후 다시 시도해 주세요")),
  });

  const 저장 = useMutation({
    mutationFn: (이름: string) => backtestApi.saveExperiment({
      ...보낼것(설정값), name: 이름,
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
          저장하기={isLoggedIn ? (이름: string) => 저장.mutate(이름) : undefined}
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
        {돌리기.isPending && (
          <진행바 설정={설정값} 열쇠={진행열쇠} 깨우기={처음인가} />
        )}
        {결과 && !돌리기.isPending && <자산배분결과화면 r={결과} />}
      </div>
    </div>
  );
}
