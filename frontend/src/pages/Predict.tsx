/**
 * 주가예측 — 사용자: "주가예측 메뉴도 만들어줘". 서버는 backend/app/services/predict/forecast.py.
 *
 * 숫자 하나로 '얼마가 된다' 고 말하지 않는다. 공모주 예측(components/ipo/IpoPrediction)에서 배운 것과 같다 — 한
 * 숫자를 크게 두면 그게 답처럼 읽힌다. 대신
 *   · 앞으로 이 범위에 있을 가능성(80% · 50%)을 크게, 가운데 값은 그 아래 작게
 *   · 오를 확률 · 10% 넘게 오르내릴 확률
 *   · 이 방식이 이 종목에서 지난 3년 동안 얼마나 맞았나 — 같은 셈을 매주 해 본 적중률
 *   · 근거 셋 — 지금과 같은 상태였던 날들 뒤에 이 종목이 오른 비율(지난 자료 그대로 센 것)
 *   · 가치 위치 — 지금 PER·PBR 이 이 종목의 지난날 가운데 어디쯤인지(예측 아님 — components/predict/가치위치)
 *   · 증권사 목표가 — 이 셈과는 따로인 사람들의 의견
 * 종목·기간은 주소에 남는다(?m=KR&s=005930&n=삼성전자&h=21) — 종목 상세에서 바로 오고, 뒤로 가도 그대로다.
 *
 * 맨 위 카드는 기술적 분석 예측(components/predict/기술예측) — 사용자: "기술적분석을 바탕으로 주가를 공모가처럼
 * 예측해줘". 공모주처럼 예상 주가 하나를 내되, 기술적 신호는 지난 3년 '지금 가격 그대로' 와 견준 성적만큼만 반영한다.
 * 그 아래 범위 카드는 '출렁임으로 본 범위' — 두 셈은 따로다(기술적 예상은 그래프에 주황 점으로).
 */
import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
/* 아이콘은 앱의 다른 곳이 이미 쓰는 것만 — 아이콘 묶음(vendor-lucide)은 모든 화면이 처음에 받아서, 새 아이콘 하나가
   모든 화면의 첫 진입을 키운다(src/__tests__/bundle.test.ts 의 한도) */
import { ChevronDown, CircleAlert, Info, TrendingUp } from "lucide-react";
import { predictApi, type 예측기간, type 주가예측 } from "@/api/predict";
import { stocksApi } from "@/api/stocks";
import 종목고르기, { 기본종목, 시장으로, type 고른종목 } from "@/components/backtest/종목고르기";
import 차트틀, { 그래프미리받기 } from "@/components/chart/ChartFrame";
import 기술예측 from "@/components/predict/기술예측";
import 가치위치 from "@/components/predict/가치위치";
import { Card, ChipTabs, MarketBadge, 못불러옴, cn } from "@/components/ui";
import { use넓은화면 } from "@/hooks/useWideScreen";
import { usePnlColors } from "@/hooks/usePnlColors";
import { useSettingsStore } from "@/store/settingsStore";
import { fmtNative } from "@/utils/formatters";
import { getRecentlyViewed } from "@/utils/recentlyViewed";
import type { Market } from "@/types";
import { 가로축, 그래프높이, 축, 툴팁 } from "@/utils/chartTheme";
import {
  예측기간들, 기본기간, 기간인가, 확률글, 변화글, 날짜글, 년월글, 검증평, 근거이름, 근거상태, 근거값, 근거비율글,
  그래프자료, 막대자리, 자주보는종목, 눈금글, type 예측일수,
} from "@/utils/주가예측";

/** 마지막에 본 종목 — 메뉴로 다시 들어오면 그 종목부터 */
const 마지막열쇠 = "predict:last";

function 마지막종목(): 고른종목 {
  try {
    const x = JSON.parse(localStorage.getItem(마지막열쇠) || "null");
    if (x && typeof x.symbol === "string" && typeof x.name === "string") {
      return { symbol: x.symbol, market: 시장으로(x.market), name: x.name };
    }
  } catch {
    /* 못 읽으면 기본 종목 */
  }
  return 기본종목.KR;
}

/** 애널리스트 응답 가운데 여기서 쓰는 것 — 목표가(종목 상세 투자의견 탭과 같은 질의를 나눠 쓴다) */
interface 목표가자료 { price_targets?: { mean?: number | null; high?: number | null; low?: number | null } | null }

function 상태코드(e: unknown): number | undefined {
  return (e as { response?: { status?: number } } | null)?.response?.status;
}

/** 예측 — 또는 예측할 수 없는 까닭(없는 종목 404 · 시세가 모자란 종목 422).
 *  까닭은 오류로 던지지 않는다 — 던지면 앱 전체의 '불러오지 못했습니다' 알림이 함께 떠서, 고칠 수 없는 고장처럼
 *  읽힌다(다시 물어도 같은 답이다). 서버가 준 까닭을 그대로 보여 준다 */
type 예측결과 = { 예측: 주가예측; 막힘?: undefined } | { 예측?: undefined; 막힘: string };

async function 예측받기(market: Market, symbol: string): Promise<예측결과> {
  try {
    return { 예측: await predictApi.get(market, symbol) };
  } catch (e) {
    const 코드 = 상태코드(e);
    if (코드 !== 404 && 코드 !== 422) throw e;
    const 까닭 = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    return { 막힘: typeof 까닭 === "string" && 까닭 ? 까닭 : "이 종목은 예측할 시세가 없어요" };
  }
}

export default function Predict() {
  const [주소, set주소] = useSearchParams();
  const 넓음 = use넓은화면();

  const 종목: 고른종목 = useMemo(() => {
    const s = 주소.get("s");
    if (s) return { symbol: s, market: 시장으로(주소.get("m") ?? undefined), name: 주소.get("n") || s };
    return 마지막종목();
  }, [주소]);
  const h = Number(주소.get("h"));
  const 일수: 예측일수 = 기간인가(h) ? h : 기본기간;

  const 바꾸기 = (다음: Partial<{ 종목: 고른종목; 일수: 예측일수 }>) => {
    const 종 = 다음.종목 ?? 종목;
    set주소({ m: 종.market, s: 종.symbol, n: 종.name, h: String(다음.일수 ?? 일수) }, { replace: true });
  };

  useEffect(() => {
    try { localStorage.setItem(마지막열쇠, JSON.stringify(종목)); } catch { /* 못 남겨도 그만 */ }
  }, [종목]);

  const 질의 = useQuery({
    queryKey: ["predict", 종목.market, 종목.symbol],
    queryFn: () => 예측받기(종목.market, 종목.symbol),
    staleTime: 30 * 60_000,
  });
  // 그래프 코드를 시세와 함께 받기 시작한다(데이터가 온 뒤에야 받으면 왕복이 하나 더 붙는다)
  useEffect(() => { 그래프미리받기(); }, []);

  const 애널 = useQuery<목표가자료>({
    queryKey: ["analyst", 종목.market, 종목.symbol],
    queryFn: () => stocksApi.getAnalyst(종목.market, 종목.symbol),
    staleTime: 900_000,
    retry: false,
  });

  const 예측 = 질의.data?.예측;
  const 고른 = 예측?.horizons.find((x) => x.days === 일수);
  const 빠른 = useMemo(() => {
    const 최근 = getRecentlyViewed().slice(0, 5).map((x) => ({ symbol: x.symbol, market: 시장으로(x.market), name: x.name }));
    return 최근.length ? 최근 : 자주보는종목;
  }, []);

  return (
    <div className="flex flex-col gap-4 max-w-6xl mx-auto pb-16">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <TrendingUp size={22} className="text-accent-blue" />
          주가예측
        </h1>
        <p className="text-text-muted text-xs mt-0.5 break-keep">
          기술적 지표로 예상 주가를, 지난 주가의 출렁임으로 있을 만한 범위와 확률을 셈해요. 투자 권유가 아니에요
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <종목고르기 고른것={종목} 고르기={(x) => 바꾸기({ 종목: x })} 이름표="예측할 종목" />
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide" aria-label="빠르게 고르기">
          {빠른.map((x) => (
            <button key={`${x.market}:${x.symbol}`} type="button" onClick={() => 바꾸기({ 종목: x })}
              aria-pressed={x.symbol === 종목.symbol && x.market === 종목.market}
              className={cn("shrink-0 px-2.5 py-1 rounded-full border text-xs transition-colors",
                x.symbol === 종목.symbol && x.market === 종목.market
                  ? "border-accent-blue/50 bg-accent-blue/10 text-accent-blue font-semibold"
                  : "border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40")}>
              {x.name}
            </button>
          ))}
        </div>
      </Card>

      <ChipTabs ariaLabel="예측 기간" tabs={예측기간들.map((x) => ({ id: String(x.days), label: `${x.label} 뒤` }))}
        active={String(일수)} onChange={(id) => 바꾸기({ 일수: Number(id) as 예측일수 })} />

      {질의.isLoading ? (
        <div aria-busy="true" aria-label="예측을 셈하는 중" className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="h-80 rounded-2xl bg-bg-card border border-border animate-pulse" />
          <div className="h-80 rounded-2xl bg-bg-card border border-border animate-pulse" />
        </div>
      ) : 질의.data?.막힘 ? (
        <Card>
          <div role="status" className="flex flex-col items-center gap-2 py-10 text-center">
            <CircleAlert size={28} className="text-text-dim" />
            <p className="text-sm font-semibold text-text-primary">이 종목은 예측할 수 없어요</p>
            <p className="text-xs text-text-muted break-keep max-w-sm">{질의.data.막힘}</p>
          </div>
        </Card>
      ) : 질의.isError || !예측 || !고른 ? (
        <Card><못불러옴 사유={질의.error} 다시={() => 질의.refetch()} compact /></Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          <종목줄 예측={예측} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-start">
            <div className="flex flex-col gap-4 min-w-0">
              <기술예측 예측={예측} 일수={일수} 기간바꾸기={(d) => 바꾸기({ 일수: d })} />
              <요약 예측={예측} 기간={고른} />
              <Card className="flex flex-col gap-2">
                <예측그래프 예측={예측} 일수={일수} 높이={넓음 ? 그래프높이.큰[1] : 그래프높이.큰[0]} />
                <p className="text-2xs text-text-dim break-keep">
                  진한 띠는 50%, 옅은 띠는 80% 범위예요. 점선은 가운데 값
                  {예측.technical?.horizons.some((x) => x.days === 일수) && ", 주황 점은 기술적 분석의 예상 주가"}.
                  날짜는 주말만 뺀 어림이에요
                </p>
              </Card>
            </div>
            {/* 설명은 오른쪽 칸 끝 하나 — 휴대폰은 맨 아래(본론을 가리지 않게), PC 는 짧은 오른쪽 칸을 채운다 */}
            <div className="flex flex-col gap-4 min-w-0">
              <확률들 예측={예측} 기간={고른} />
              <검증 기간={고른} />
              <근거들 예측={예측} 기간={고른} />
              <가치위치 예측={예측} />
              <목표가 예측={예측} 자료={애널.data} />
              <설명 예측={예측} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 고른 종목과 마지막 종가 — 아래 카드가 모두 이 종가에서 셈한 것 */
function 종목줄({ 예측 }: { 예측: 주가예측 }) {
  return (
    <div className="flex items-center gap-2 min-w-0 px-1">
      <MarketBadge market={예측.market} />
      <Link to={`/stocks/${예측.market}/${encodeURIComponent(예측.symbol)}`}
        className="text-base font-semibold text-text-primary truncate hover:text-accent-blue">{예측.name}</Link>
      <span className="ml-auto shrink-0 text-xs text-text-muted num">
        {날짜글(예측.as_of)} 종가 {fmtNative(예측.market, 예측.currency, 예측.price)}
      </span>
    </div>
  );
}

/** 출렁임으로 본 범위 — 80% 범위를 크게, 가운데 값과 오를 확률은 그 아래 */
function 요약({ 예측, 기간 }: { 예측: 주가예측; 기간: 예측기간 }) {
  const 돈 = (v: number) => fmtNative(예측.market, 예측.currency, v);
  const 자리 = 막대자리(기간, 예측.price);
  const 색 = usePnlColors(useSettingsStore((s) => s.colorScheme));
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-text-primary">출렁임으로 본 범위</h2>
      <div>
        <p className="text-xs text-text-muted">{기간.label} 뒤 · {날짜글(기간.date)} 무렵 · 80% 확률로</p>
        <p className="mt-0.5 text-2xl font-bold text-text-primary num break-keep" data-testid="예측범위">
          {돈(기간.q10)} ~ {돈(기간.q90)}
        </p>
        <p className="mt-1 text-xs text-text-secondary">
          가운데 값 <b className="num">{돈(기간.q50)}</b>
          <span className={cn("ml-1 num", 색.pnlColor(기간.q50 - 예측.price))}>({변화글(기간.q50, 예측.price)})</span>
          <span className="mx-1.5 text-text-dim">·</span>
          오를 확률 <b className="num">{확률글(기간.up)}</b>
        </p>
      </div>
      {/* 범위 막대 — 옅은 80%, 진한 50%, 세로 줄이 가운데, 삼각이 지금 가격 */}
      <div className="pt-1">
        <div className="relative h-3 rounded-full bg-bg-elevated" role="img"
          aria-label={`80% 범위 ${돈(기간.q10)}부터 ${돈(기간.q90)}, 50% 범위 ${돈(기간.q25)}부터 ${돈(기간.q75)}, 지금 ${돈(예측.price)}`}>
          <span className="absolute inset-y-0 rounded-full bg-accent-blue/20"
            style={{ left: `${자리.넓은[0]}%`, width: `${자리.넓은[1] - 자리.넓은[0]}%` }} />
          <span className="absolute inset-y-0 rounded-full bg-accent-blue/45"
            style={{ left: `${자리.좁은[0]}%`, width: `${자리.좁은[1] - 자리.좁은[0]}%` }} />
          <span className="absolute -inset-y-0.5 w-0.5 bg-accent-blue" style={{ left: `${자리.가운데}%` }} />
          <span className="absolute -top-2.5 -translate-x-1/2 text-text-primary text-2xs leading-none" style={{ left: `${자리.지금}%` }}>▼</span>
        </div>
        <div className="mt-1.5 flex justify-between text-2xs text-text-dim num">
          <span>{돈(기간.q10)}</span>
          <span>지금 {돈(예측.price)}</span>
          <span>{돈(기간.q90)}</span>
        </div>
      </div>
    </Card>
  );
}

/** 지난 종가 + 앞날 범위(부채꼴) */
function 예측그래프({ 예측, 일수, 높이 }: { 예측: 주가예측; 일수: 예측일수; 높이: number }) {
  const 자료 = useMemo(() => 그래프자료(예측, 일수), [예측, 일수]);
  const 돈 = (v: number) => fmtNative(예측.market, 예측.currency, v);
  return (
    <div aria-label={`${예측.name} 지난 주가와 앞으로의 범위 그래프`} role="img">
      <차트틀 height={높이}>
        {(R) => (
          <R.ComposedChart data={자료} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <R.XAxis dataKey="date" {...가로축} tickFormatter={(d: string) => 눈금글(d, 일수)} />
            <R.YAxis orientation="right" width={56} domain={["auto", "auto"]} {...축} axisLine={false}
              tickFormatter={(v: number) => (예측.currency === "KRW" ? Math.round(v).toLocaleString("ko-KR") : v.toFixed(0))} />
            <R.Tooltip {...툴팁}
              labelFormatter={(d: string) => 날짜글(String(d))}
              formatter={(v: number | [number, number], 이름: string) => {
                const 글 = Array.isArray(v) ? `${돈(v[0])} ~ ${돈(v[1])}` : 돈(v);
                const 이름표: Record<string, string> = {
                  종가: "종가", 가운데: "가운데 값", 범위80: "80% 범위", 범위50: "50% 범위", 기술: "기술적 분석 예상",
                };
                return [글, 이름표[이름] ?? 이름];
              }} />
            <R.Area dataKey="범위80" stroke="none" fill="var(--accent-blue)" fillOpacity={0.14} isAnimationActive={false} connectNulls />
            <R.Area dataKey="범위50" stroke="none" fill="var(--accent-blue)" fillOpacity={0.26} isAnimationActive={false} connectNulls />
            <R.Line dataKey="종가" stroke="var(--text-secondary)" strokeWidth={1.6} dot={false} isAnimationActive={false} />
            <R.Line dataKey="가운데" stroke="var(--accent-blue)" strokeWidth={1.6} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            {/* 기술적 분석의 예상 주가 — 그 기간의 마지막 날에만 값이 있어 점 하나 */}
            <R.Line dataKey="기술" stroke="none" isAnimationActive={false}
              dot={{ r: 4.5, fill: "var(--chart-bench)", stroke: "var(--bg-card)", strokeWidth: 1.5 }}
              activeDot={{ r: 5.5, fill: "var(--chart-bench)", stroke: "var(--bg-card)", strokeWidth: 1.5 }} />
            <R.ReferenceLine x={예측.as_of} stroke="var(--text-dim)" strokeDasharray="2 4"
              label={{ value: "오늘", position: "insideTopRight", fill: "var(--text-dim)", fontSize: "0.72rem" }} />
          </R.ComposedChart>
        )}
      </차트틀>
    </div>
  );
}

/** 오를 확률 · 10% 넘게 오를 · 내릴 확률 */
function 확률들({ 예측, 기간 }: { 예측: 주가예측; 기간: 예측기간 }) {
  const 색 = usePnlColors(useSettingsStore((s) => s.colorScheme));
  const 칸 = [
    { 이름: "오를 확률", 값: 기간.up, 색: "" },
    { 이름: "+10% 넘게 오를 확률", 값: 기간.up10, 색: 색.gain },
    { 이름: "−10% 넘게 내릴 확률", 값: 기간.down10, 색: 색.loss },
  ];
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-text-primary">{기간.label} 뒤 확률</h2>
      <div className="grid grid-cols-3 gap-2">
        {칸.map((x) => (
          <div key={x.이름} className="rounded-xl bg-bg-elevated px-2.5 py-2">
            <p className="text-2xs text-text-muted break-keep leading-snug">{x.이름}</p>
            <p className={cn("mt-1 text-lg font-bold num", x.색 || "text-text-primary")}>{확률글(x.값)}</p>
          </div>
        ))}
      </div>
      <p className="text-2xs text-text-dim break-keep">
        가운데는 연 {(예측.expected_return * 100).toFixed(1)}% 흐름을 가정했어요 — 오를 확률이 반 언저리인 게 보통이에요
      </p>
    </Card>
  );
}

/** 출렁임으로 본 범위가 이 종목에서 지난 3년 동안 얼마나 맞았나 */
function 검증({ 기간 }: { 기간: 예측기간 }) {
  const 검 = 기간.check;
  if (!검) {
    return (
      <Card className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold text-text-primary">지난 검증</h2>
        <p className="text-xs text-text-muted break-keep">{기간.label} 뒤를 검증할 만큼 지난 시세가 없어요</p>
      </Card>
    );
  }
  const 평 = 검증평(검);
  const 맞힌 = Math.round(검.in80 * 검.n);
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-text-primary">출렁임 범위는 얼마나 맞았나</h2>
      <p className="text-xs text-text-muted break-keep">
        {년월글(검.from)}부터 매주, 그날까지의 시세만으로 {기간.label} 뒤를 예측해 봤어요
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-bg-elevated px-2.5 py-2">
          <p className="text-2xs text-text-muted">80% 범위 안에 든 비율</p>
          <p className="mt-1 text-lg font-bold num text-text-primary">{Math.round(검.in80 * 100)}%</p>
          <p className="text-2xs text-text-dim num">{검.n}번 중 {맞힌}번</p>
        </div>
        <div className="rounded-xl bg-bg-elevated px-2.5 py-2">
          <p className="text-2xs text-text-muted">50% 범위 안에 든 비율</p>
          <p className="mt-1 text-lg font-bold num text-text-primary">{Math.round(검.in50 * 100)}%</p>
          <p className="text-2xs text-text-dim">맞다면 50% 언저리</p>
        </div>
      </div>
      <p className={cn("text-xs font-semibold break-keep", 평.맞음 ? "text-accent-green" : "text-accent-yellow")}>{평.말}</p>
      {평.참고만 && (
        <p className="text-2xs text-text-dim break-keep">
          {기간.label} 뒤 예측은 매주 셈해도 서로 겹쳐, 겹치지 않는 기간으로는 {검.periods}번뿐이에요 — 참고만 하세요
        </p>
      )}
    </Card>
  );
}

/** 근거 셋 — 지금 상태와, 그 상태였던 날들 뒤에 이 종목이 오른 비율 */
function 근거들({ 예측, 기간 }: { 예측: 주가예측; 기간: 예측기간 }) {
  const 돈 = (v: number) => fmtNative(예측.market, 예측.currency, v);
  if (!예측.signals.length) return null;
  return (
    <Card className="flex flex-col gap-2.5">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">근거</h2>
        <p className="text-2xs text-text-dim break-keep">이 종목의 지난 시세에서 그대로 센 것이에요 — 앞으로도 그러리란 법은 없어요</p>
      </div>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {예측.signals.map((g) => (
          <li key={g.key} className="py-2 first:pt-0 last:pb-0">
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-text-muted shrink-0">{근거이름(g)}</span>
              <span className="ml-auto text-xs font-semibold text-text-primary text-right">{근거상태(g)}</span>
            </div>
            <p className="mt-0.5 text-2xs text-text-dim num">{근거값(g, 돈)}</p>
            <p className="mt-1 text-xs text-text-secondary break-keep">{근거비율글(g.rates[String(기간.days)], 기간.label)}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** 증권사 목표가 — 이 셈과는 따로인 사람들의 의견 */
function 목표가({ 예측, 자료 }: { 예측: 주가예측; 자료?: 목표가자료 }) {
  const 목 = 자료?.price_targets;
  if (!목?.mean) return null;
  const 돈 = (v: number) => fmtNative(예측.market, 예측.currency, v);
  return (
    <Card className="flex flex-col gap-1.5">
      <h2 className="text-sm font-semibold text-text-primary">증권사 목표가</h2>
      <p className="text-xs text-text-secondary">
        평균 <b className="num">{돈(목.mean)}</b> <span className="num">({변화글(목.mean, 예측.price)})</span>
        {목.low && 목.high ? <span className="text-text-dim num"> · {돈(목.low)} ~ {돈(목.high)}</span> : null}
      </p>
      <p className="text-2xs text-text-dim break-keep">보통 12개월 뒤를 본 값이에요. 위의 셈과는 따로인 의견이에요</p>
    </Card>
  );
}

/** 어떻게 셈했나 — 접어 둔다 */
function 설명({ 예측 }: { 예측: 주가예측 }) {
  const m = 예측.method;
  const 기 = 예측.technical;
  const 묶음제목 = "mt-2.5 text-xs font-semibold text-text-primary";
  const 목록 = "mt-1 flex flex-col gap-1.5 text-xs text-text-secondary break-keep list-disc pl-4";
  return (
    <details className="group rounded-2xl border border-border bg-bg-card px-4 py-3">
      <summary className="flex items-center gap-2 cursor-pointer list-none text-sm font-semibold text-text-primary">
        <Info size={14} className="text-text-muted" />
        어떻게 셈했나요
        <ChevronDown size={14} className="ml-auto text-text-dim transition-transform group-open:rotate-180" />
      </summary>
      {기 && (
        <>
          <p className={묶음제목}>기술적 분석 예측</p>
          <ul className={목록}>
            <li>지표 — 이동평균선 이격도·RSI·MACD·볼린저밴드·거래량·1년 흐름·52주 고점·변동성
              {기.market ? `, 그리고 ${기.market}의 흐름` : ""}으로 지금을 그려요. 모두 그날까지의 시세로만 셈해요</li>
            <li>신호 — 이 종목의 지난날 가운데 지표가 가장 비슷했던 {기.neighbors_k}번(서로 {기.min_gap_days}영업일 이상 떨어진
              날)이 그 뒤 움직인 가운데 값, 같은 지표로 세운 회귀식, 그 둘의 가운데 — 셋 가운데 지난 3년 가장 덜 틀린 것이
              기술적 신호예요. 지난 3년은 매주, 그날 결과가 이미 나와 있던 날들로만 배워 맞혀 봤어요</li>
            <li>예상 — 신호를 0 · ¼ · ½ · ¾ · 1 가운데 지난 3년 가장 덜 틀린 만큼만 반영해요. 0이면 지금 가격이 예상이에요</li>
            <li>50% 범위 — 지난 3년 예상 오차의 가운데 부분을 예상에 더해요. 실제로 50%가 들도록 22~78% 자리(3개월은
              20.5~79.5%)를 써요</li>
            <li>시험 — 국내 40 · 해외 39종목의 2016~2026년 시세로 과거 4,586번을 지금처럼 예측해 봤어요. 신호를 그대로 쓰면
              '그대로'보다 1주 1.5% · 1개월 5% · 3개월 11% 더 틀렸고, 반영을 고르니 0.3% · 1% · 4%로 줄었어요. 50% 범위에는
              실제로 50~52%가 들었어요</li>
            <li>짧은 앞날을 보는 도구라 3개월 뒤까지만 셈해요</li>
          </ul>
        </>
      )}
      {예측.market !== "ETF" && (
        <>
          <p className={묶음제목}>가치 위치</p>
          <ul className={목록}>
            <li>날마다 '주가 ÷ 그날 알려진 최근 1년 순이익'(PBR은 '÷ 순자산')을 세어, 지금이 지난날(최대 5년) 가운데
              어디쯤인지 봐요. 주식 수는 쓰지 않아서 자사주 소각·증자로 주식 수가 바뀐 만큼은 어긋나요</li>
            <li>최근 1년 순이익은 분기 실적이 넷 이어 있으면 그 합, 아니면 연간 실적이에요. 실적은 분기가 끝나고 45일(연간은
              90일) 뒤부터 알았다고 봐요 — 그날 몰랐던 실적으로 셈하지 않으려고요</li>
            <li>적자·자본잠식이던 날은 PER·PBR의 뜻이 없어 뺐어요</li>
            <li>카드의 PER·PBR 숫자는 종목 정보와 같은 공식 값이에요. 위치 셈과 쓴 실적이 조금 다를 수 있어요</li>
          </ul>
        </>
      )}
      <p className={묶음제목}>출렁임으로 본 범위</p>
      <ul className={목록}>
        <li>출렁임 — 최근 하루하루의 움직임에 무게를 더 둬서 재요(지금 연 {(예측.volatility.now * 100).toFixed(0)}%).
          먼 앞날일수록 지난 3년 평균(연 {(예측.volatility.long * 100).toFixed(0)}%)으로 돌아간다고 봐요 — 반감기 {m.half_life_days}영업일</li>
        <li>가운데 — 주식의 장기 평균(연 {(m.prior_return * 100).toFixed(0)}%)에서 시작해 이 종목의 지난 3년 수익률을 믿을 만한
          만큼만 섞었어요(연 {(예측.expected_return * 100).toFixed(1)}%). 과거 수익률은 잡음이 커서 그대로 쓰지 않아요</li>
        <li>꼬리 — 하루 움직임의 치우침과 두꺼운 꼬리를 범위에 반영했어요</li>
        <li>검증 — 지난 3년 동안 {m.check_step_days}영업일마다 그날까지의 시세만으로 같은 셈을 해, 실제 주가가 범위 안에 든
          비율을 셌어요</li>
      </ul>
      <p className="mt-2.5 text-xs text-text-muted break-keep">
        회사 소식·실적·처음 겪는 큰 사건은 두 셈 모두에 들어가지 않아요. 투자 판단은 스스로 해 주세요
      </p>
    </details>
  );
}
