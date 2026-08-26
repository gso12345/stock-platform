/**
 * 자산 흐름 — 내 자산이 지난 한 달·석 달 동안 어떻게 움직였나.
 *
 * 화면은 지금까지 '오늘 얼마인가' 만 말했다. 자산 앱에서 정작 보고
 * 싶은 것은 '지난달보다 늘었나' 인데, 그걸 받쳐 줄 기록이 아무 데도
 * 없었다 — 매일 화면을 열어 숫자를 적어 두지 않는 한 알 수 없었다.
 *
 * 서버가 하루 한 줄씩 남긴다(portfolio_snapshots). 그래서
 *
 *   · 처음 쓰는 사람에게는 점이 하나뿐이다. 그때는 그래프 대신
 *     "내일부터 쌓입니다" 라고 말한다. 점 하나짜리 선은 고장으로 보인다.
 *   · 앱을 안 연 날은 비어 있다. 서버가 지어내지 않고 비워서 보내므로,
 *     여기서도 없는 날을 만들어 채우지 않는다 — 그냥 앞뒤 점을 잇는다.
 *
 * ── 벤치마크 비교 ──
 *
 * '내 자산이 5% 올랐다' 만으로는 잘한 것인지 알 수 없다. 그 달에 코스피가
 * 10% 올랐으면 시장을 밑돈 것이다. 그래서 지수를 함께 그린다.
 *
 * 원화 금액과 지수 포인트는 단위가 달라 한 축에 못 올린다. 벤치마크를
 * 켜면 **둘 다 첫날 대비 %로 바꿔서** 같은 축에 그린다 — 비교의 뜻이
 * 거기에 있다. 끄면 원래대로 금액으로 돌아간다.
 *
 * recharts 는 gzip 110KB 라 여기서 직접 import 하지 않는다. 차트틀이
 * 필요할 때만 받아 온다(그 파일 주석에 왜 그런지 적혀 있다).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { portfolioApi, dashboardApi, type 자산흐름점 } from "@/api/stocks";
import 차트틀 from "@/components/chart/ChartFrame";
import { Card, ChangeBadge, 못불러옴 } from "@/components/ui";
import { fmtKRWFull } from "@/utils/formatters";
import type { OHLCV } from "@/types";

const 기간들 = [
  { id: 30,  label: "1개월" },
  { id: 90,  label: "3개월" },
  { id: 365, label: "1년" },
] as const;

/** 견줄 지수. 서버 KR_INDICES·US_INDICES 에 있는 이름만 쓴다 */
export const 벤치마크들 = [
  { id: "",       label: "없음" },
  { id: "KOSPI",  label: "코스피" },
  { id: "KOSDAQ", label: "코스닥" },
  { id: "SP500",  label: "S&P 500" },
  { id: "NASDAQ", label: "나스닥" },
] as const;

/** "2026-08-26" → "8/26" — 축에는 연도를 안 쓴다. 좁은 화면에서 자리를 다 먹는다 */
function 짧은날(day: string): string {
  const [, m, d] = day.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : day;
}

/** 일수 → 서버가 받는 기간 문자열 */
function 기간글(일수: number): string {
  return 일수 <= 30 ? "1mo" : 일수 <= 90 ? "3mo" : "1y";
}

export interface 그릴점 {
  day: string;
  value: number;
  cost: number;
  /** 벤치마크를 켰을 때만. 첫날 대비 % */
  내수익?: number | null;
  지수수익?: number | null;
}

/**
 * 내 자산과 지수를 같은 축(첫날 대비 %)에 올린다.
 *
 * 지수는 장이 열린 날만 값이 있고, 내 기록은 앱을 연 날만 있다. 두
 * 목록의 날짜가 안 맞으므로 **내 기록의 날짜를 기준**으로 삼고, 그날
 * 이전의 가장 가까운 지수 종가를 쓴다(주말·휴장일 대응).
 *
 * 첫날 값이 없는 지수는 아예 안 그린다 — 기준이 없으면 %가 거짓말이 된다.
 */
export function 견주기(점들: 자산흐름점[], 지수: OHLCV[] | undefined): 그릴점[] {
  if (!지수?.length) return 점들.map((p) => ({ ...p }));

  const 오름차순 = [...지수]
    .filter((b) => b?.date && Number.isFinite(b.close))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!오름차순.length) return 점들.map((p) => ({ ...p }));

  /** 그날 이전(포함)의 마지막 종가 — 주말·휴장일은 직전 값을 쓴다 */
  const 그날종가 = (day: string): number | null => {
    let 값: number | null = null;
    for (const b of 오름차순) {
      if (b.date.slice(0, 10) > day) break;
      값 = b.close;
    }
    return 값;
  };

  /* 기준일은 '둘 다 값이 있는 첫날' 이다.
     내 기록의 첫날로 잡으면, 기록이 지수 범위보다 앞설 때 기준이 없어
     비교가 통째로 사라진다 — 사용자에게는 '눌렀는데 아무 일도 안
     일어남' 으로 보인다. 겹치는 구간이 있으면 거기서부터 견준다. */
  let 기준자산 = 0;
  let 기준지수 = 0;
  for (const p of 점들) {
    const 종가 = 그날종가(p.day);
    if (종가 && p.value) { 기준자산 = p.value; 기준지수 = 종가; break; }
  }
  if (!기준자산 || !기준지수) return 점들.map((p) => ({ ...p }));

  return 점들.map((p) => {
    const 종가 = 그날종가(p.day);
    return {
      ...p,
      내수익: ((p.value - 기준자산) / 기준자산) * 100,
      /* 기준일보다 앞선 날은 지수에 값이 없다. 0으로 채우면
         '그날 안 움직였다' 는 거짓말이 된다 — 비워 둔다 */
      지수수익: 종가 == null ? null : ((종가 - 기준지수) / 기준지수) * 100,
    };
  });
}

export default function AssetHistory({ 켜짐 = true }: { 켜짐?: boolean }) {
  const [일수, set일수] = useState<number>(90);
  const [벤치, set벤치] = useState<string>("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["portfolio-history", 일수],
    queryFn: () => portfolioApi.getHistory(일수),
    enabled: 켜짐,
    staleTime: 300_000,
  });

  /* 지수는 벤치마크를 골랐을 때만 받는다. 안 고른 사람에게 왕복
     하나를 더 태울 이유가 없다 — 0.15 CPU 서버다 */
  const { data: 지수 } = useQuery<OHLCV[]>({
    queryKey: ["index-ohlcv", 벤치, 기간글(일수)],
    queryFn: () => dashboardApi.getIndexOHLCV(벤치, 기간글(일수), "1d"),
    enabled: 켜짐 && !!벤치,
    staleTime: 600_000,
  });

  const 점들 = useMemo<자산흐름점[]>(() => data?.points ?? [], [data]);
  const 비교중 = !!벤치 && !!지수?.length;
  const 그릴것 = useMemo(() => 견주기(점들, 벤치 ? 지수 : undefined), [점들, 지수, 벤치]);
  const 벤치이름 = 벤치마크들.find((b) => b.id === 벤치)?.label ?? "";

  /* 기간 수익 — 첫 점 대비 마지막 점.
     '평가손익'(매입가 대비)과는 다른 숫자다. 3년 전에 산 사람에게
     이번 달의 움직임과 전체 수익률은 전혀 다른 이야기다. */
  const 변화 = useMemo(() => {
    if (점들.length < 2) return null;
    const 처음 = 점들[0].value;
    const 끝 = 점들[점들.length - 1].value;
    if (!처음) return null;
    return { 금액: 끝 - 처음, 비율: ((끝 - 처음) / 처음) * 100 };
  }, [점들]);

  /** 같은 기간 지수는 얼마나 움직였나 — 마지막으로 값이 있는 날 기준 */
  const 지수변화 = useMemo(() => {
    if (!비교중) return null;
    for (let i = 그릴것.length - 1; i >= 0; i--) {
      const v = 그릴것[i].지수수익;
      if (v != null) return v;
    }
    return null;
  }, [비교중, 그릴것]);

  const 틀 = (속: React.ReactNode) => (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-primary">자산 흐름</span>
        <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
          {기간들.map((g) => (
            <button
              key={g.id}
              onClick={() => set일수(g.id)}
              aria-pressed={일수 === g.id}
              className={`px-2.5 py-1 text-2xs font-medium transition-colors ${
                일수 === g.id ? "bg-accent-blue/15 text-accent-blue" : "text-text-muted hover:bg-bg-elevated"
              }`}
            >{g.label}</button>
          ))}
        </div>
      </div>
      {속}
    </Card>
  );

  if (isError) return 틀(<못불러옴 사유={error} 다시={() => refetch()} compact />);
  if (isLoading) return 틀(<div className="h-[160px] rounded-lg bg-bg-elevated animate-pulse" />);

  if (점들.length < 2) {
    /* 점 하나짜리 선은 그리면 고장으로 보인다. 무엇을 기다리는지 말한다 */
    return 틀(
      <div className="h-[160px] flex flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm text-text-secondary">아직 그릴 기록이 없어요</p>
        <p className="text-2xs text-text-dim break-keep">
          하루에 한 번씩 자동으로 쌓입니다. 내일 다시 오면 선이 보여요.
        </p>
      </div>,
    );
  }

  return 틀(
    <>
      {변화 && (
        <div className="flex items-baseline justify-between gap-3 -mt-1">
          <span className="text-2xs text-text-muted shrink-0">
            {기간들.find((g) => g.id === 일수)?.label} 변화
          </span>
          <ChangeBadge value={변화.비율} 금액={비교중 ? undefined : 변화.금액} 통화="KRW" className="text-sm" />
        </div>
      )}

      {/* 견줄 지수. '내가 5% 올랐다' 만으로는 잘한 것인지 알 수 없다 */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mt-0.5">
        <span className="text-2xs text-text-dim shrink-0">비교</span>
        {벤치마크들.map((b) => (
          <button
            key={b.id || "none"}
            onClick={() => set벤치(b.id)}
            aria-pressed={벤치 === b.id}
            className={`px-2 py-0.5 rounded-full text-2xs font-medium shrink-0 border transition-colors ${
              벤치 === b.id
                ? "border-accent-purple/50 bg-accent-purple/10 text-accent-purple"
                : "border-border text-text-muted hover:text-text-primary"
            }`}
          >{b.label}</button>
        ))}
      </div>

      {비교중 && 지수변화 != null && 변화 && (
        /* 숫자로도 한 줄 적는다. 선 두 개가 붙어 있으면 눈으로는
           어느 쪽이 이겼는지 잘 안 보인다 */
        <p className="text-2xs text-text-secondary break-keep -mt-1">
          {벤치이름} {지수변화 >= 0 ? "+" : ""}{지수변화.toFixed(2)}% 대비{" "}
          <span className={변화.비율 >= 지수변화 ? "text-accent-green font-semibold" : "text-accent-red font-semibold"}>
            {변화.비율 >= 지수변화 ? "앞섬" : "뒤짐"} {Math.abs(변화.비율 - 지수변화).toFixed(2)}%p
          </span>
        </p>
      )}

      <차트틀 height={160}>
        {(R) => (
          <R.AreaChart data={그릴것} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="자산흐름칠" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="var(--accent-focus)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--accent-focus)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <R.XAxis
              dataKey="day" tickFormatter={짧은날}
              tick={{ fill: "var(--text-dim)", fontSize: 10 }}
              axisLine={false} tickLine={false} minTickGap={24}
            />
            {/* 세로축은 안 그린다. 좁은 화면에서 '1,234,567원' 눈금이
                가로폭의 3분의 1을 먹는다. 금액은 위 카드가 이미 말한다 */}
            <R.YAxis hide domain={["dataMin", "dataMax"]} />
            <R.Tooltip
              contentStyle={{
                background: "var(--bg-card)", border: "1px solid var(--border-default)",
                borderRadius: 10, fontSize: 12, color: "var(--text-primary)",
              }}
              labelStyle={{ color: "var(--text-muted)" }}
              formatter={(v: number, name: string) => [
                비교중 ? `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%` : fmtKRWFull(Number(v)),
                name,
              ]}
            />

            {비교중 ? (
              <>
                {/* 견줄 때는 둘 다 첫날 대비 %다. 원화 금액과 지수
                    포인트를 한 축에 올리면 아무 뜻이 없다 */}
                <R.Area type="monotone" dataKey="지수수익" name={벤치이름}
                        stroke="var(--accent-purple, #8b5cf6)" strokeWidth={1.5}
                        strokeDasharray="4 3" fill="none" dot={false}
                        connectNulls isAnimationActive={false} />
                <R.Area type="monotone" dataKey="내수익" name="내 자산"
                        stroke="var(--accent-focus)" strokeWidth={2}
                        fill="url(#자산흐름칠)" dot={false} isAnimationActive={false} />
              </>
            ) : (
              <>
                {/* 원금을 같이 그린다. 선 하나만 있으면 '올랐다' 는 보여도
                    '벌었다' 는 안 보인다 — 그 둘은 다른 이야기다 */}
                <R.Area type="monotone" dataKey="cost" name="원금"
                        stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="4 3"
                        fill="none" dot={false} isAnimationActive={false} />
                <R.Area type="monotone" dataKey="value" name="평가금액"
                        stroke="var(--accent-focus)" strokeWidth={2}
                        fill="url(#자산흐름칠)" dot={false} isAnimationActive={false} />
              </>
            )}
          </R.AreaChart>
        )}
      </차트틀>
    </>,
  );
}
