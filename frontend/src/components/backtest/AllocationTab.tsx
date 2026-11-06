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
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backtestApi, type 자산배분요청, type 자산배분결과, type 저장된실험 } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { Card, NameDialog, 못불러옴, 빈화면, cn } from "@/components/ui";
import { PieChart } from "lucide-react";
import { 읽을수있는오류, 요청실패말 } from "@/utils/errors";
import { use넓은화면 } from "@/hooks/useWideScreen";
import { use알림 } from "@/hooks/useDialogs";
import { 글공유, 공유알림 } from "@/utils/공유";
import 자산배분설정, { 첫설정, 못돌리는이유, 주기표, 벤치마크표, type 설정 } from "./AllocationForm";
import 자산배분결과화면 from "./AllocationResult";
import { 설정요약, 설정접기줄, use결과로, 기간말, 부드럽게가기, type 설정항목 } from "./설정부품";
import { 읽는금액 } from "./설정값";
import { 공유주소 } from "./결과공유";
import { 진행막대, 서버아래말, 새열쇠, 깨우는초 } from "./진행막대";

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
    benchmark: s.benchmark,
    equal_weight: s.equal_weight,
    extended: s.extended,
    //: 퍼센트 그대로 보낸다 — 비율로 바꾸는 것은 서버 한 곳에서만 한다
    cash_rate: Number(s.cash_rate) || 0,
    risk_free_rate: Number(s.risk_free_rate) || 0,
  };
}

/* 진행 열쇠·어림 비율·걸린 시간 말은 세 탭(자산배분·단일 종목·유니버스)이 같이 쓴다 — 진행막대.tsx 로 옮겼다 */
export { 새열쇠, 어림비율, 지난말 } from "./진행막대";

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
  if (깨우기) 초 += 깨우는초;
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
  return (
    <진행막대 열쇠={열쇠} 예상={예상초(s, 깨우기)} 물어보기={backtestApi.getPortfolioProgress}
      어림글={(비율) => 단계글(비율, s)}
      아래글={(서버) => 서버 ? 서버아래말(서버)
        : `자산 ${s.assets.length}개${s.benchmark !== "none" ? " · 벤치마크까지" : ""} 계산하고 있어요.`} />
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
    /* 기간 칩은 풀어 둔다 — 지금 칩(예: 10년)이 남으면 저장한 날짜와 다른 기간을 고른 것처럼 보인다 */
    years: 0,
    start_date: x.start_date, end_date: x.end_date,
    currency: x.currency, initial_amount: x.initial_amount,
    assets: x.assets,
    contribution_period: x.contribution_period,
    contribution_amount: x.contribution_amount,
    rebalance_period: x.rebalance_period,
    total_return: x.total_return,
    rebalance_day: x.rebalance_day ?? 지금.rebalance_day,
    cost_rate: x.cost_rate ?? 지금.cost_rate,
    benchmark: x.benchmark ?? 지금.benchmark,
    equal_weight: x.equal_weight ?? 지금.equal_weight,
    extended: x.extended ?? 지금.extended,
    cash_rate: x.cash_rate ?? 지금.cash_rate,
    risk_free_rate: x.risk_free_rate ?? 지금.risk_free_rate,
  };
}

/** 접힌 설정의 두 줄 — 무엇을 담았나 / 기간·금액·리밸런싱(사용자가 고른 3번 'S&P 500 100% · 10년 · 1,000만원').
 *  자산이 많으면 앞의 셋과 '외 n개' */
export function 배분요약(s: 설정): [string, string] {
  const 담은것 = s.assets.slice(0, 3)
    .map((a) => `${a.name || a.symbol} ${s.equal_weight ? "" : `${+Number(a.weight).toFixed(1)}%`}`.trim());
  const 첫줄 = 담은것.join(" · ") + (s.assets.length > 3 ? ` 외 ${s.assets.length - 3}개` : "");
  const 리밸 = s.rebalance_period === "none" ? null
    : `리밸런싱 ${주기표.find((p) => p.value === s.rebalance_period)?.label}`;
  const 둘째 = [기간말(s.start_date, s.end_date), 읽는금액(Number(s.initial_amount), s.currency), 리밸]
    .filter(Boolean).join(" · ");
  return [첫줄 || "자산 없음", 둘째];
}

/** 펼친 요약의 목록 — 결과를 낸 설정을 한눈에(사용자: "결과와 설정을 같이 볼 수도 있게") */
export function 배분항목(s: 설정): 설정항목[] {
  const 주기말 = (v: string) => 주기표.find((p) => p.value === v)?.label ?? v;
  return [
    { 이름: "자산", 값: s.assets.map((a) => `${a.name || a.symbol}${s.equal_weight ? "" : ` ${+Number(a.weight).toFixed(1)}%`}`).join(" · ")
      + (s.equal_weight ? " (똑같이 나눔)" : "") },
    { 이름: "기간", 값: `${s.start_date.replace(/-/g, ".")} ~ ${s.end_date.replace(/-/g, ".")}` },
    { 이름: "처음 넣은 돈", 값: 읽는금액(Number(s.initial_amount), s.currency) },
    { 이름: "적립", 값: s.contribution_period === "none" ? "안 함"
      : `${주기말(s.contribution_period)} ${읽는금액(Number(s.contribution_amount), s.currency)}` },
    { 이름: "리밸런싱", 값: s.rebalance_period === "none" ? "안 함" : 주기말(s.rebalance_period) },
    { 이름: "배당", 값: s.total_return ? "재투자(토탈 리턴)" : "안 받음" },
    { 이름: "거래비용", 값: s.cost_rate ? `${s.cost_rate}%` : "없음" },
    { 이름: "견줄 상대", 값: 벤치마크표.find((b) => b.value === s.benchmark)?.label ?? "없음" },
  ];
}

/** 백테스트 탭들의 배치 — 넓은 화면에서 왼쪽 설정(폭 고정)·오른쪽 결과. 예전엔 자산배분은 반반, 단일 종목은
 *  3분의 1 이라 탭마다 그래프 폭이 달랐고, 자산배분 결과 그래프가 600px 에 눌렸다. 28rem 은 넓은 화면의 뿌리
 *  글자(15px)에서 420px — 기간·비용 단추 다섯·여섯 개가 한 줄에 들어가는 폭이다 */
export const 설정판배치 = "grid grid-cols-1 xl:grid-cols-[28rem_minmax(0,1fr)] gap-4 items-start";

export default function 자산배분탭({ 불러올실험, 고른실험, 불러옴, 공유받은설정, 공유받음 }: {
  /** 메뉴의 전략 저장소에서 고른 실험의 번호(주소로 온다) — 목록이 오면 찾아 연다 */
  불러올실험?: number | null;
  /** '불러오기' 창에서 고른 실험 — 이미 손에 있으니 바로 연다 */
  고른실험?: 저장된실험 | null;
  불러옴?: () => void;
  /** 공유받은 주소의 설정 — 넣고 바로 돌린다 */
  공유받은설정?: 설정 | null;
  공유받음?: () => void;
} = {}) {
  const qc = useQueryClient();
  const { isLoggedIn } = useAuthStore();
  const [설정값, set설정값] = useState<설정>(() => 첫설정());
  const [결과, set결과] = useState<자산배분결과 | null>(null);
  const [오류, set오류] = useState<string | null>(null);
  /* 저장 직후 잠깐 띄우는 초록 줄. 목록을 이 화면에서 없앴으므로
     이게 없으면 저장이 됐는지 알 방법이 아예 없다. */
  const [저장됨, set저장됨] = useState(false);
  const { 보이기, 화면: 알림창 } = use알림();

  /* 설정과 결과가 나란히 놓이는 폭(설정판배치의 xl). 그보다 좁으면 둘이 위아래라, 결과가 나오면 설정을 한 줄로
     접는다 — 예전엔 결과가 화면 세 장짜리 설정 밑에 붙어 있었다(사용자가 고른 3번) */
  const 나란히 = use넓은화면(1280);
  const [접음, set접음] = useState(false);
  const 접힘 = 접음 && !!결과 && !나란히;
  const [결과자리, 결과로] = use결과로();
  const 판 = useRef<HTMLDivElement>(null);
  /** 이 결과를 낸 설정 — 공유는 '지금 칸에 적힌 것' 이 아니라 결과를 낸 것을 보낸다 */
  const 돌린설정 = useRef<설정 | null>(null);
  const [자동, set자동] = useState(false);

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
      돌린설정.current = 설정값;
      return backtestApi.runPortfolio({ ...보낼것(설정값), progress_key: 열쇠 });
    },
    onSuccess: (d) => { set결과(d); set오류(null); set처음인가(false); set접음(true); },
    /* **끊긴 것과 실패한 것을 가른다.**
       '계산에 실패했어요' 만 띄우면 서버가 고장 난 줄 알고 떠난다.
       대개는 자던 서버가 깨느라 오래 걸렸을 뿐이고(무료 서버는 20~50초),
       다시 누르면 훨씬 빠르다. detail 을 그대로 넣지 않는 것도 그대로다 —
       FastAPI 422 는 객체 배열이라 React 자식으로 들어가면 화면이 죽는다
       (utils/errors 의 요청실패말이 둘 다 맡는다). */
    onError: (e: any) => set오류(
      요청실패말(e, "계산에 실패했어요. 잠시 후 다시 시도해 주세요")),
  });

  /** '결과 확인' — 돌리고, 진행 막대가 있는 곳으로 데려간다(폰에서는 설정 세 장 밑이었다) */
  const 확인누름 = () => { 돌리기.mutate(); 결과로(); };

  /** 결과 머리의 '결과 저장' 으로 연 이름 창 */
  const [결과저장창, set결과저장창] = useState(false);
  const 저장 = useMutation({
    mutationFn: ({ 이름, s }: { 이름: string; s: 설정; 결과에서?: boolean }) => backtestApi.saveExperiment({
      ...보낼것(s), name: 이름,
    }),
    onSuccess: (_d, { 결과에서 }) => {
      qc.invalidateQueries({ queryKey: ["backtest-experiments"] });
      set오류(null);
      set결과저장창(false);
      /* 결과 머리에서 저장한 것은 **결과를 낸 설정**이다 — 설정 칸의 초록 줄('저장했어요')을 켜면 지금 고치는
         칸이 저장된 것처럼 읽힌다. 그 칸은 접혀 있기도 해서 알림으로 말한다 */
      if (결과에서) 보이기("저장했어요. ‘불러오기’ 에서 열면 같은 설정이 들어와요", "success");
      else set저장됨(true);
    },
    onError: (e: any) => {
      set결과저장창(false);
      set오류(읽을수있는오류(e?.response?.data?.detail, "저장에 실패했어요"));
    },
  });

  /* 설정을 고치면 초록 줄을 내린다. 안 내리면 '저장했어요' 가 그대로
     붙어 있어서, 고친 내용까지 저장된 줄 알게 된다. */
  useEffect(() => { set저장됨(false); }, [설정값]);

  /* 고른 실험을 받아 온다 — 불러오기 창에서 고른 것은 손에 있고, 메뉴에서 온 번호는 목록이 온 뒤에 찾는다.
     한 번 불러오면 위에 알려서 같은 것을 되풀이해 안 열게 한다. */
  useEffect(() => {
    const x = 고른실험 ?? (불러올실험 == null ? undefined : 실험들.find((e) => e.id === 불러올실험));
    if (!x) return;
    set설정값((앞) => 실험을설정으로(x, 앞));
    set결과(null);
    불러옴?.();
  }, [고른실험, 불러올실험, 실험들, 불러옴]);

  /* 공유받은 설정 — 넣고, 넣은 다음 그림에서 돌린다(같은 그림에서 돌리면 앞 설정으로 돈다) */
  useEffect(() => {
    if (!공유받은설정) return;
    set설정값(공유받은설정);
    set결과(null);
    if (!못돌리는이유(공유받은설정)) set자동(true);
    공유받음?.();
  }, [공유받은설정, 공유받음]);
  useEffect(() => {
    if (!자동) return;
    set자동(false);
    확인누름();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [자동]);

  /* 결과가 나와 설정을 접으면 그 자리(요약 + 결과)로 — 위에서 화면 두세 장이 빠지므로 보던 자리가 어긋난다 */
  useEffect(() => {
    if (접힘) 부드럽게가기(판.current);
  }, [접힘]);

  const 공유하기 = async () => {
    const s = 돌린설정.current;
    if (!s) return;
    const 알림 = 공유알림(await 글공유(공유주소({ 탭: "alloc", 설정: s }), `${배분요약(s)[0]} 백테스트`));
    if (알림) 보이기(알림.글, 알림.종류);
  };

  return (
    <div ref={판} className={cn(설정판배치, "scroll-mt-3")}>
      <div className="flex flex-col gap-4 min-w-0">
        {접힘 ? (
          <설정요약 줄={배분요약(돌린설정.current ?? 설정값)} 펼치기={() => set접음(false)}
            항목들={배분항목(돌린설정.current ?? 설정값)} />
        ) : (<>
          {/* 결과가 있는데 편집 칸을 연 채면 다시 한 줄로 접는 길 */}
          {!!결과 && !나란히 && !돌리기.isPending && <설정접기줄 접기={() => set접음(true)} />}
          <자산배분설정
            값={설정값}
            바꾸기={set설정값}
            돌리기={확인누름}
            도는중={돌리기.isPending}
            저장하기={isLoggedIn ? (이름: string) => 저장.mutate({ 이름, s: 설정값 }) : undefined}
            저장중={저장.isPending}
            저장됨={저장됨}
          />
        </>)}
      </div>

      <div ref={결과자리} className="flex flex-col gap-4 min-w-0 scroll-mt-3">
        {오류 && (
          <Card className="border-accent-red/40">
            <못불러옴 사유={오류} 다시={() => 돌리기.mutate()} compact />
          </Card>
        )}
        {!오류 && !결과 && !돌리기.isPending && (
          /* 다른 메뉴와 같은 빈 화면 — 무엇을 하면 채워지는지 */
          <Card>
            <빈화면 icon={PieChart} title="자산을 고르고 ‘결과 확인’ 을 눌러 보세요"
              hint="예: S&P500 ETF 60% · 금 20% · 현금 20% 로 8년, 매달 50만원씩 더 넣고 해마다 비중 맞추기" />
          </Card>
        )}
        {돌리기.isPending && (
          <진행바 설정={설정값} 열쇠={진행열쇠} 깨우기={처음인가} />
        )}
        {결과 && !돌리기.isPending && (
          <자산배분결과화면 r={결과} 공유하기={공유하기}
            저장하기={() => isLoggedIn ? set결과저장창(true)
              : 보이기("결과를 저장하려면 로그인이 필요해요. 백테스트는 로그인 없이도 돼요", "info")} />
        )}
      </div>
      {결과저장창 && 돌린설정.current && (
        <NameDialog title="이 결과를 저장할까요?"
          설명="이 결과를 낸 자산·비중·기간·적립·리밸런싱을 저장해요. ‘불러오기’ 에서 열면 같은 설정이 들어와요."
          첫값={배분요약(돌린설정.current)[0]}
          진행중={저장.isPending}
          onConfirm={(이름) => 저장.mutate({ 이름, s: 돌린설정.current!, 결과에서: true })}
          onClose={() => set결과저장창(false)} />
      )}
      {알림창}
    </div>
  );
}
