/**
 * 종목 흐름 — 이 종목이 얼마나 움직였나.
 *
 * ── 왜 만들었나 ──
 *
 * 종목 상세를 열면 캔들 차트가 먼저 나왔다. 캔들은 잘 쓰면 많은 것을
 * 말하지만, 대부분은 그 화면에서 **'얼마나 올랐나'** 하나를 보러 온다.
 * 그걸 알려면 캔들에서 첫 봉과 마지막 봉을 눈으로 찾아 암산해야 했다.
 * 봉 종류·캔들/라인/영역·LOG 같은 컨트롤이 차트보다 먼저 나오는 것도
 * 같은 문제다 — 고를 것이 많다는 건 아직 아무것도 안 보여 줬다는 뜻이다.
 *
 * 내 자산의 자산 흐름은 그 답을 먼저 크게 말한다. 여기도 같게 만든다.
 * 앱 안에서 같은 모양의 그래프가 같은 방식으로 읽히는 편이, 화면마다
 * 다른 규칙을 익히게 하는 것보다 낫다.
 *
 * 캔들이 필요 없어진 것은 아니다. '자세히' 를 누르면 그대로 나온다.
 *
 * ── 자산 흐름과 무엇을 나눠 쓰나 ──
 *
 * 기간 칩·퍼센트 표기·최고최저 계산은 AssetHistory 에서 그대로 들여온다.
 * 두 벌로 두면 언젠가 한쪽만 고쳐져서, 같아 보이는 두 그래프가 다른
 * 규칙으로 그려진다.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { stocksApi } from "@/api/stocks";
import 차트틀 from "@/components/chart/ChartFrame";
import { 못불러옴 } from "@/components/ui";
import { useSettingsStore } from "@/store/settingsStore";
import { usePnlColors, 오름색, 내림색 } from "@/hooks/usePnlColors";
import { 기간들, 올해일수, 퍼센트글, 최고최저, type 기간id } from "@/components/portfolio/AssetHistory";
import type { OHLCV } from "@/types";

/**
 * 기간 칩 → 서버에 물을 기간.
 *
 * '올해' 는 서버가 모르는 값이다(yfinance PERIOD_MAP 에 ytd 가 없어서
 * 조용히 1년으로 떨어진다). 1년치를 받아 놓고 화면에서 자른다 —
 * 눌렀는데 1년치가 그대로 나오면 그 칩이 뭔지 알 수가 없다.
 */
export const 받을기간: Record<기간id, string> = {
  "1개월": "1mo", "3개월": "3mo", "1년": "1y", "올해": "1y", "전체": "max",
};

/** "2026-08-26" → "8/26" — 축에는 연도를 안 쓴다. 좁은 화면에서 자리를 다 먹는다 */
function 짧은날(day: string): string {
  const [, m, d] = day.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : day;
}

export interface 흐름점 { day: string; close: number; 수익: number }

/**
 * 봉을 '첫날 대비 %' 로 바꾼다.
 *
 * 값(원·달러)이 아니라 %로 그리는 이유는 자산 흐름과 같다 — 세로축을
 * 숨겼기 때문에 값 자체는 어차피 안 보이고, 보이는 것은 모양뿐이다.
 * 그 모양을 읽을 자를 하나로 맞춘다.
 *
 * 기간 안에 값이 하나뿐이면 선이 안 그려진다. 그때는 빈 배열을 준다 —
 * 점 하나짜리 선은 그리면 고장으로 보인다.
 */
export function 흐름만들기(봉들: OHLCV[] | undefined, 일수: number): 흐름점[] {
  const 자를날 = new Date();
  자를날.setDate(자를날.getDate() - 일수);
  const 기준 = 자를날.toISOString().slice(0, 10);

  const 쓸것 = (봉들 ?? [])
    .filter((b) => b?.date && Number.isFinite(b.close) && b.close > 0)
    .map((b) => ({ day: String(b.date).slice(0, 10), close: b.close }))
    .sort((a, b) => a.day.localeCompare(b.day));

  /* 받아 온 것이 고른 기간보다 짧으면 있는 대로 다 보여 준다. 잘라서
     둘 이하가 되면 '기간을 늘렸는데 선이 사라졌다' 가 된다 */
  const 자른것 = 쓸것.filter((b) => b.day >= 기준);
  const 최종 = 자른것.length >= 2 ? 자른것 : 쓸것;
  if (최종.length < 2) return [];

  const 처음 = 최종[0].close;
  return 최종.map((b) => ({ ...b, 수익: ((b.close - 처음) / 처음) * 100 }));
}

export default function PriceTrend({
  market, symbol, 통화 = "KRW", 자세히,
}: {
  market: string;
  symbol: string;
  /** 값을 어떻게 적을까 — 툴팁과 최고·최저 줄에 쓴다 */
  통화?: "KRW" | "USD";
  /** '자세히' 를 눌렀을 때. 안 주면 그 버튼을 안 그린다 */
  자세히?: () => void;
}) {
  const [고른기간, set고른기간] = useState<기간id>("3개월");
  /* 오름·내림 색은 설정을 따른다(초록/빨강 · 빨강/파랑). 이 그래프만
     안 따르면 같은 화면 안에서 빨강의 뜻이 둘이 된다 */
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor } = usePnlColors(배색);
  const 오름 = 오름색(배색);
  const 내림 = 내림색(배색);

  const 기간 = 기간들.find((g) => g.id === 고른기간) ?? 기간들[1];
  const 일수 = 기간.일수 ?? 올해일수();

  const { data, isLoading, isError, error, refetch } = useQuery<OHLCV[]>({
    queryKey: ["stock-ohlcv", market, symbol, 받을기간[고른기간], "1d"],
    queryFn: () => stocksApi.getOHLCV(market, symbol, 받을기간[고른기간], "1d"),
    enabled: !!symbol,
    /* 일봉이라 자주 안 바뀐다. 종목 상세의 캔들 차트와 같은 규칙을 쓴다 */
    staleTime: 21_600_000,
    placeholderData: (prev) => prev,
  });

  const 점들 = useMemo(() => 흐름만들기(data, 일수), [data, 일수]);
  const 변화 = 점들.length ? 점들[점들.length - 1].수익 : null;
  const 선색 = (변화 ?? 0) >= 0 ? 오름 : 내림;
  /* 칠 무늬 id 에 색을 섞는다. 고정 id 로 두면 색이 다른 그래프가 한
     화면에 둘 이상 있을 때 먼저 그려진 쪽 색으로 둘 다 칠해진다 —
     SVG 는 문서 전체에서 id 하나를 찾는다 */
  const 칠id = `종목흐름칠-${선색.replace("#", "")}`;

  const 끝점 = useMemo(() => 최고최저(
    점들.map((p) => ({ day: p.day, value: p.close, cost: 0, 내수익: p.수익 })),
    "내수익",
  ), [점들]);

  /** 값 적기 — 국내는 원, 해외는 달러 */
  const 값글 = (v: number) =>
    통화 === "USD"
      ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : `${Math.round(v).toLocaleString()}원`;

  const 머리 = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold text-text-primary shrink-0">흐름</span>
      {/* 칩이 다섯 개라 좁은 화면에서 넘친다. 넘치면 잘리는 대신 옆으로
          밀리게 둔다 — 잘린 칩은 있는 줄도 모른다 */}
      <div className="flex rounded-lg border border-border overflow-x-auto scrollbar-hide">
        {기간들.map((g) => (
          <button
            key={g.id}
            onClick={() => set고른기간(g.id)}
            aria-pressed={고른기간 === g.id}
            className={`px-2.5 py-1 text-2xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              고른기간 === g.id ? "bg-accent-blue/15 text-accent-blue" : "text-text-muted hover:bg-bg-elevated"
            }`}
          >{g.label}</button>
        ))}
      </div>
      {/* ── '간단히' 와 같은 자리에 둔다 ──
          캔들 쪽 '간단히' 는 머리줄 오른쪽 끝에 있는데 이 버튼은 카드
          맨 아래 가운데에 있었다. 그래서 오갈 때마다 버튼이 화면
          반대편으로 뛰었다 — 되돌아오려고 눈으로 다시 찾아야 한다.
          같은 일을 하는 버튼은 같은 자리에 있어야 한다. */}
      {자세히 && (
        <button
          onClick={자세히}
          className="shrink-0 px-2.5 py-1 rounded-lg border border-border text-2xs font-semibold
                     text-text-muted hover:text-accent-blue hover:border-accent-blue/40
                     transition-colors whitespace-nowrap"
        >자세히</button>
      )}
    </div>
  );

  const 틀 = (속: React.ReactNode) => (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-bg-card p-4">
      {머리}{속}
    </div>
  );

  if (isError) return 틀(<못불러옴 사유={error} 다시={() => refetch()} compact />);
  if (isLoading && !data) {
    return 틀(<div className="h-[160px] rounded-lg bg-bg-elevated animate-pulse" />);
  }
  if (점들.length < 2) {
    return 틀(
      <div className="h-[160px] flex items-center justify-center">
        <p className="text-sm text-text-secondary">이 기간에 그릴 값이 없어요</p>
      </div>,
    );
  }

  return 틀(
    <>
      {/* 이 화면에 온 이유를 제일 크게 적는다 — '얼마나 올랐나' */}
      <div className="flex flex-col gap-0.5 -mt-1">
        <span className="text-2xs text-text-muted">
          {기간.label} 수익
          <span className="text-text-dim"> · {점들[0].day.replace(/-/g, ".")}부터</span>
        </span>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span data-testid="기간수익"
                className={`text-2xl leading-none font-mono font-bold num ${pnlColor(변화 ?? 0)}`}>
            {퍼센트글(변화 ?? 0)}
          </span>
          <span className="text-sm font-mono font-semibold num text-text-secondary">
            {값글(점들[점들.length - 1].close)}
          </span>
        </div>
      </div>

      <차트틀 height={160}>
        {(R) => (
          <R.AreaChart data={점들} margin={{ top: 10, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id={칠id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={선색} stopOpacity={0.35} />
                <stop offset="100%" stopColor={선색} stopOpacity={0} />
              </linearGradient>
            </defs>
            <R.XAxis
              dataKey="day" tickFormatter={짧은날}
              tick={{ fill: "var(--text-dim)", fontSize: 10 }}
              axisLine={false} tickLine={false} minTickGap={24}
            />
            {/* 세로축은 안 그린다. 좁은 화면에서 '1,234,567원' 눈금이
                가로폭의 3분의 1을 먹는다. 값은 위 숫자가 이미 말한다 */}
            <R.YAxis hide domain={["dataMin", "dataMax"]} />
            <R.Tooltip
              contentStyle={{
                background: "var(--bg-card)", border: "1px solid var(--border-default)",
                borderRadius: 10, fontSize: 12, color: "var(--text-primary)",
              }}
              labelStyle={{ color: "var(--text-muted)" }}
              /* %만 적으면 그날 얼마였는지가 사라진다. 둘 다 적는다 */
              formatter={(v: number, _n: string, 항: { payload?: 흐름점 }) => [
                `${퍼센트글(Number(v))} · ${값글(항?.payload?.close ?? 0)}`, "종가",
              ]}
            />
            {/* ── 최고·최저 ──
                눈금이 하나도 없어서, 선이 오르내리는 모양은 보여도
                **얼마나** 오르내렸는지는 안 보였다. 두 줄만 그으면
                그 사이가 곧 눈금이 된다 */}
            {끝점 && (
              <>
                <R.ReferenceLine y={끝점.최고} stroke="var(--text-dim)"
                                 strokeDasharray="2 4" strokeWidth={1} />
                <R.ReferenceLine y={끝점.최저} stroke="var(--text-dim)"
                                 strokeDasharray="2 4" strokeWidth={1} />
              </>
            )}
            <R.Area type="monotone" dataKey="수익" name="종가"
                    stroke={선색} strokeWidth={2}
                    fill={`url(#${칠id})`} dot={false} isAnimationActive={false} />
          </R.AreaChart>
        )}
      </차트틀>

      {끝점 && (
        <p className="text-center text-2xs text-text-dim tabular-nums -mt-1">
          최고 {퍼센트글(끝점.최고)} · 최저 {퍼센트글(끝점.최저)}
        </p>
      )}
    </>,
  );
}
