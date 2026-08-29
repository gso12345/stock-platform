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
 *   · 서버가 자던 날은 비어 있다. 그런 구멍은 서버가 나중에 그날의
 *     실제 종가로 메운다(portfolio_snapshot.메우기). 여기서는 없는 날을
 *     만들어 채우지 않는다 — 그냥 앞뒤 점을 잇는다.
 *
 * ── 축은 늘 % 다 ──
 *
 * 예전에는 비교를 켰을 때만 % 였고, 끄면 원화 금액 축으로 돌아갔다.
 * 그 둘은 그래프의 생김새가 아예 달라서, 켜고 끌 때마다 눈이 처음부터
 * 다시 읽어야 했다. 게다가 금액 축에서는 원금 선이 세로 범위를
 * 끌어당겨 정작 보려는 평가금액 선이 얇은 띠로 눌렸다.
 *
 * 이제 내 자산·원금·지수가 모두 기준일 0% 에서 출발한다. 금액은
 * 사라지지 않는다 — 위의 큰 숫자와 툴팁이 계속 말한다.
 *
 * ── 벤치마크 비교 ──
 *
 * '내 자산이 5% 올랐다' 만으로는 잘한 것인지 알 수 없다. 그 달에 코스피가
 * 10% 올랐으면 시장을 밑돈 것이다. 그래서 지수를 함께 그린다.
 *
 * 여러 개를 한꺼번에 켤 수 있다. 코스피와 나스닥을 같이 올려 놓고 봐야
 * '국내가 빠진 달인가, 내가 못한 건가' 가 갈린다 — 하나씩 번갈아
 * 켜서는 그 둘을 머릿속에서 겹쳐 봐야 한다.
 *
 * recharts 는 gzip 110KB 라 여기서 직접 import 하지 않는다. 차트틀이
 * 필요할 때만 받아 온다(그 파일 주석에 왜 그런지 적혀 있다).
 */
import { useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { portfolioApi, dashboardApi, type 자산흐름점 } from "@/api/stocks";
import 차트틀 from "@/components/chart/ChartFrame";
import { Card, 못불러옴 } from "@/components/ui";
import { use돈 } from "@/hooks/useMoney";
import { useSettingsStore } from "@/store/settingsStore";
import { usePnlColors, 오름색, 내림색 } from "@/hooks/usePnlColors";
import { 하루수명 } from "@/constants/portfolioQuery";
import type { OHLCV } from "@/types";

/**
 * 볼 수 있는 기간.
 *
 * 예전에는 일수(30·90·365) 그 자체가 상태였고, 지수 기간은 그 숫자에서
 * 되짚었다(30 이하면 1mo …). 그 방식으로는 '올해' 를 넣을 수가 없다 —
 * 올해가 238일이면 '1년' 과 구분이 안 돼 지수만 1년치로 그려진다.
 * 그래서 고른 것 자체를 상태로 두고, 일수와 지수 기간을 따로 적는다.
 */
export const 기간들 = [
  { id: "1개월", label: "1개월", 일수: 30,   지수: "1mo" },
  { id: "3개월", label: "3개월", 일수: 90,   지수: "3mo" },
  { id: "1년",   label: "1년",   일수: 365,  지수: "1y"  },
  { id: "올해",  label: "올해",  일수: null, 지수: "ytd" },
  { id: "전체",  label: "전체",  일수: 3650, 지수: "max" },
] as const;

export type 기간id = (typeof 기간들)[number]["id"];

/**
 * 1월 1일부터 오늘까지 며칠인가.
 *
 * 서버가 days 를 최소 7 로 받는다(그보다 짧으면 선이 안 그려진다).
 * 1월 1일~7일 사이에 '올해' 를 누르면 그 밑으로 내려가 422 가 난다.
 */
export function 올해일수(오늘 = new Date()): number {
  const 첫날 = new Date(오늘.getFullYear(), 0, 1);
  const 지난날 = Math.ceil((오늘.getTime() - 첫날.getTime()) / 86_400_000);
  return Math.max(7, 지난날);
}

/**
 * 견줄 지수. 서버 KR_INDICES·US_INDICES 에 있는 이름만 쓴다.
 *
 * 여러 개를 한꺼번에 켤 수 있다. 코스피와 나스닥을 같이 올려 놓고
 * 봐야 '국내가 빠진 달인가, 내가 못한 건가' 가 갈린다 — 하나씩
 * 번갈아 켜서는 그 둘을 머릿속에서 겹쳐 봐야 한다.
 *
 * 색은 지수마다 못 박는다. 켠 순서에 따라 색이 바뀌면, 코스피를 끄고
 * 다시 켰을 때 다른 색이 되어 방금 보던 선이 어느 것인지 놓친다.
 * '없음' 은 목록에 안 둔다 — 그건 지수가 아니라 '다 끄기' 다.
 */
export const 벤치마크들 = [
  { id: "KOSPI",  label: "코스피",   색: "#8b5cf6" },
  { id: "KOSDAQ", label: "코스닥",   색: "#06b6d4" },
  { id: "SP500",  label: "S&P 500", 색: "#f97316" },
  { id: "NASDAQ", label: "나스닥",   색: "#f59e0b" },
] as const;

/** recharts 의 dataKey 로 쓸 이름. 지수마다 한 칸씩 붙는다 */
export function 지수키(id: string): string {
  return `지수_${id}`;
}

/** "+3.21%" — 툴팁과 최고·최저 라벨이 같은 모양을 쓰게 한 자리에 둔다 */
export function 퍼센트글(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/** "2026-08-26" → "8/26" — 축에는 연도를 안 쓴다. 좁은 화면에서 자리를 다 먹는다 */
function 짧은날(day: string): string {
  const [, m, d] = day.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : day;
}

export interface 그릴점 {
  day: string;
  value: number;
  cost: number;
  /** 그날의 평가손익(평가 − 원금).
   *
   *  선 두 개(평가·원금)의 **사이 간격**이 곧 번 돈인데, 눈으로 재는
   *  일은 생각보다 어렵다. 툴팁에 숫자로 같이 적는다. */
  손익?: number;
  /** 기준일 대비 % — 비교를 안 켜도 늘 있다 */
  내수익?: number | null;
  /** 원금도 같은 자로 잰다. 돈을 더 넣으면 이 선이 같이 올라가서,
   *  '벌어서 오른 것' 과 '넣어서 오른 것' 이 눈으로 갈린다 */
  원금수익?: number | null;
  /** 지수마다 한 칸 — 열쇠는 지수키(id) */
  [지수칸: `지수_${string}`]: number | null | undefined;
}

/**
 * 기간 안의 최고·최저 — 어느 값을 보고 있느냐에 따라 다르다.
 *
 * 그래프에 눈금이 하나도 없다(세로축을 숨겼다 — 좁은 화면에서
 * '1,234,567원' 이 가로폭의 3분의 1을 먹는다). 그래서 선이 오르내리는
 * 모양은 보이는데 **얼마나** 오르내렸는지는 안 보인다. 최고·최저 두
 * 줄만 그어 주면 그 사이가 곧 눈금이 된다.
 */
export function 최고최저(점들: 그릴점[], 열쇠: "value" | "내수익"):
  { 최고: number; 최저: number } | null {
  const 값들 = 점들
    .map((p) => p[열쇠])
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (값들.length < 2) return null;
  const 최고 = Math.max(...값들);
  const 최저 = Math.min(...값들);
  /* 둘이 같으면 줄을 두 개 겹쳐 긋는 셈이라 라벨만 뭉친다 */
  return 최고 === 최저 ? null : { 최고, 최저 };
}

/** 견줄 지수 하나 — 아직 안 받아 왔으면 봉들이 비어 있다 */
export interface 견줄지수 { id: string; 봉들: OHLCV[] | undefined }

export interface 견준결과 {
  점들: 그릴점[];
  /** 기준일이 점들의 몇 번째인가. 화면이 '언제부터 잰 값인지' 를 적는다 */
  기준칸: number;
  /** 실제로 그릴 수 있었던 지수 id — 못 받았거나 기간이 안 겹치면 빠진다 */
  쓴지수: string[];
}

/**
 * 모든 선을 **같은 자**(기준일 대비 %)로 잰다.
 *
 * ── 왜 늘 % 인가 ──
 *
 * 예전에는 비교를 켰을 때만 % 였다. 끄면 원화 금액 축으로 돌아갔는데,
 * 그 둘은 그래프의 생김새가 아예 달랐다 — 켜고 끌 때마다 눈이 처음부터
 * 다시 읽어야 했다. 게다가 금액 축에서는 원금 선이 세로 범위를 끌어당겨
 * 정작 보려는 평가금액 선이 얇은 띠로 눌렸다.
 *
 * 이제 늘 % 다. 내 자산·원금·지수가 모두 기준일 0% 에서 출발한다.
 * 금액은 사라지지 않는다 — 위의 큰 숫자와 툴팁이 계속 말한다.
 *
 * 원금도 같은 자로 잰다. 돈을 더 넣으면 원금 선이 같이 올라가므로,
 * '벌어서 오른 것' 과 '넣어서 오른 것' 이 눈으로 갈린다.
 *
 * ── 기준일을 어떻게 잡나 ──
 *
 * 지수는 장이 열린 날만 값이 있고, 내 기록은 서버가 남긴 날만 있다.
 * 날짜가 안 맞으므로 **내 기록의 날짜를 기준**으로 삼고, 그날 이전의
 * 가장 가까운 지수 종가를 쓴다(주말·휴장일 대응).
 *
 * 기준일은 '내 값이 있고 **고른 지수가 전부** 값이 있는 첫날' 이다.
 * 내 기록의 첫날로 잡으면 기록이 지수 범위보다 앞설 때 기준이 없어
 * 비교가 통째로 사라진다 — 사용자에게는 '눌렀는데 아무 일도 안
 * 일어남' 으로 보인다. 겹치는 구간이 있으면 거기서부터 견준다.
 *
 * 겹치는 날이 아예 없는 지수는 **그 지수만** 뺀다. 하나 때문에 나머지
 * 비교까지 없던 일이 되면, 지수를 여럿 켤 수 있게 한 뜻이 없다.
 */
export function 견주기(점들: 자산흐름점[], 지수모음: 견줄지수[] = []): 견준결과 {
  /** 그날 이전(포함)의 마지막 종가 — 주말·휴장일은 직전 값을 쓴다 */
  const 종가함수 = (봉들: OHLCV[] | undefined) => {
    const 오름차순 = [...(봉들 ?? [])]
      .filter((b) => b?.date && Number.isFinite(b.close))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!오름차순.length) return null;
    return (day: string): number | null => {
      let 값: number | null = null;
      for (const b of 오름차순) {
        if (b.date.slice(0, 10) > day) break;
        값 = b.close;
      }
      return 값;
    };
  };

  const 후보 = 지수모음
    .map((x) => ({ id: x.id, 그날종가: 종가함수(x.봉들) }))
    .filter((x): x is { id: string; 그날종가: (day: string) => number | null } => !!x.그날종가);

  /* 겹치는 날이 하나도 없는 지수는 여기서 뺀다 */
  const 쓸것 = 후보.filter((x) => 점들.some((p) => p.value > 0 && x.그날종가(p.day)));

  const 기준칸 = 점들.findIndex(
    (p) => p.value > 0 && 쓸것.every((x) => x.그날종가(p.day)),
  );
  if (기준칸 < 0) {
    /* 값이 있는 점이 하나도 없다 — 잴 자가 없다 */
    return { 점들: 점들.map((p) => ({ ...p })), 기준칸: -1, 쓴지수: [] };
  }

  const 기준자산 = 점들[기준칸].value;
  const 기준원금 = 점들[기준칸].cost;
  const 기준지수 = new Map<string, number>();
  for (const x of 쓸것) {
    const v = x.그날종가(점들[기준칸].day);
    if (v) 기준지수.set(x.id, v);
  }

  const 그릴것: 그릴점[] = 점들.map((p) => {
    const 칸: 그릴점 = {
      ...p,
      내수익: ((p.value - 기준자산) / 기준자산) * 100,
      /* 원금이 0이면 나눌 수가 없다(현금만 있거나 아직 안 담은 상태) */
      원금수익: 기준원금 > 0 ? ((p.cost - 기준원금) / 기준원금) * 100 : null,
    };
    for (const x of 쓸것) {
      const 밑 = 기준지수.get(x.id);
      const 종가 = x.그날종가(p.day);
      /* 기준일보다 앞선 날은 지수에 값이 없다. 0으로 채우면
         '그날 안 움직였다' 는 거짓말이 된다 — 비워 둔다 */
      칸[지수키(x.id) as `지수_${string}`] =
        밑 && 종가 != null ? ((종가 - 밑) / 밑) * 100 : null;
    }
    return 칸;
  });

  return { 점들: 그릴것, 기준칸, 쓴지수: 쓸것.map((x) => x.id) };
}

export default function AssetHistory({ 켜짐 = true, 미리보기, 받는중, portfolioId,
                                      오늘평가, 오늘원금 }: {
  켜짐?: boolean;
  /** 미리보기 값을 아직 받는 중인가 — 그동안 '기록이 없다' 고 하면 안 된다 */
  받는중?: boolean;
  /** 화면 위에 떠 있는 **지금** 평가금액·매입금액.
   *
   *  이게 없으면 그래프의 오른쪽 끝이 위의 큰 숫자와 다른 말을 한다.
   *
   *  화면 총액은 **실시간 시세**(WebSocket + 일괄 조회)로 낸다. 그런데
   *  그래프의 오늘 점은 서버가 **시세 캐시**로 낸 값이다. 장중에는 그
   *  둘이 다르다 — 사용자에게는 '자산 흐름 수치가 안 맞는다' 로 보인다.
   *
   *  같은 화면 안에서 같은 것을 두 숫자로 말하지 않는다. 오늘 점은
   *  화면이 이미 들고 있는 값으로 덮어쓴다. */
  오늘평가?: number;
  오늘원금?: number;
  /** 이 포트폴리오만 볼 때 그 id. 안 주면 전체 합계다.
   *
   *  포트폴리오별 기록은 이번에 처음 쌓기 시작했다. 그래서 하나를 고르면
   *  선이 오늘부터 시작한다 — 전체를 볼 때 3년치가 나오다가 포트폴리오를
   *  고르면 점 하나가 되는 셈이라, 아래에서 그 이유를 화면에 적는다. */
  portfolioId?: number;
  /** 로그인 전 미리보기용 점들. 주면 /portfolio/history 를 안 부른다.
   *
   *  예전에는 로그인 전에 이 그래프를 아예 안 그렸다. 그런데 그러면
   *  '내 자산이 어떻게 변해 왔나' 를 볼 수 있다는 사실 자체가 가입
   *  전에는 안 보인다 — 이 앱을 쓸 이유 하나가 통째로 숨는 셈이다.
   *
   *  값 자체는 **지어낸 것이 아니다**. 예시 종목들의 실제 시세 이력으로
   *  화면 위 합계와 같은 규칙에 따라 계산한다
   *  (hooks/usePortfolioPreview 의 이력합치기). 예시인 것은 '어떤 종목을
   *  몇 주 갖고 있나' 뿐이다. */
  미리보기?: 자산흐름점[];
}) {
  const [고른기간, set고른기간] = useState<기간id>("3개월");
  /* 여러 개를 한꺼번에 켠다. 코스피와 나스닥을 같이 올려 놓고 봐야
     '국내가 빠진 달인가, 내가 못한 건가' 가 갈린다 */
  const [벤치들, set벤치들] = useState<string[]>([]);
  const 돈 = use돈();
  /* 오름·내림 색은 설정을 따른다(초록/빨강 · 빨강/파랑).
     여기만 초록·빨강으로 못 박혀 있어서, 빨강/파랑을 쓰는 사람에게는
     같은 화면 안에서 보유 목록은 빨강이 오름인데 이 그래프만 빨강이
     내림이었다 — 어느 쪽이 번 것인지 매번 다시 읽어야 한다. */
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor } = usePnlColors(배색);
  const 오름 = 오름색(배색);
  const 내림 = 내림색(배색);

  const 기간 = 기간들.find((g) => g.id === 고른기간) ?? 기간들[1];
  /* '올해' 만 오늘이 며칠이냐에 따라 달라진다. 나머지는 고정값이다 */
  const 일수 = 기간.일수 ?? 올해일수();

  const 예시인가 = !!미리보기 || !!받는중;
  const { data, isLoading, isError, error, refetch } = useQuery({
    /* 열쇠에 portfolioId 가 빠지면, 포트폴리오를 바꿔도 앞서 받아 둔
       전체 그래프가 그대로 남는다 — 5분(staleTime) 동안 바뀐 것이
       하나도 없어 보인다 */
    queryKey: ["portfolio-history", 고른기간, 일수, portfolioId ?? 0],
    queryFn: () => portfolioApi.getHistory(일수, portfolioId),
    /* 미리보기는 이 경로(로그인 필요)를 안 부른다. 대신 공개된
       종목 시세 이력으로 화면에서 계산한다 */
    enabled: 켜짐 && !예시인가,
    staleTime: 하루수명,
  });

  /* 지수는 켠 것만 받는다. 안 고른 사람에게 왕복을 더 태울 이유가
     없다 — 0.15 CPU 서버다.

     목록 길이는 늘 벤치마크 수 그대로 두고 enabled 로만 끈다. 켠 것만
     넘기면 훅 개수가 렌더마다 달라져서 React 가 터진다. */
  const 지수결과 = useQueries({
    queries: 벤치마크들.map((b) => ({
      queryKey: ["index-ohlcv", b.id, 기간.지수],
      queryFn: () => dashboardApi.getIndexOHLCV(b.id, 기간.지수, "1d"),
      enabled: 켜짐 && 벤치들.includes(b.id),
      /* 지수 종가도 하루 단위로 변한다 — 자산 흐름과 같은 규칙을 쓴다 */
      staleTime: 하루수명,
    })),
  });

  /** 오늘 날짜 — 서버와 같은 한국 날짜로 본다 */
  const 오늘날 = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  /**
   * 오늘 점을 화면이 들고 있는 값으로 맞춘다.
   *
   * 서버는 시세 캐시로, 화면은 실시간 시세로 센다. 장중에는 그 둘이
   * 달라서 그래프 오른쪽 끝이 위의 큰 숫자와 어긋난다. 같은 화면
   * 안에서 같은 것을 두 숫자로 말하지 않는다.
   *
   * 지난 점은 안 건드린다 — 그건 그날의 기록이지 지금 값이 아니다.
   */
  const 오늘맞추기 = useMemo(() => (점들: 자산흐름점[]): 자산흐름점[] => {
    if (오늘평가 == null || !(오늘평가 > 0)) return 점들;
    const 오늘것: 자산흐름점 = {
      day: 오늘날,
      value: 오늘평가,
      cost: 오늘원금 ?? 점들[점들.length - 1]?.cost ?? 0,
      filled: 1, priced: 1,
    };
    if (점들.length && 점들[점들.length - 1].day === 오늘날) {
      return [...점들.slice(0, -1), 오늘것];
    }
    return [...점들, 오늘것];
  }, [오늘평가, 오늘원금, 오늘날]);

  const 점들 = useMemo<자산흐름점[]>(() => {
    if (!미리보기) return 오늘맞추기(data?.points ?? []);
    /* 미리보기는 1년치를 받아 두고 고른 기간만큼 잘라 쓴다 — 기간 칩을
       눌러도 아무 일이 없으면 그 칩이 뭔지 알 수 없다. 1년보다 긴
       기간('전체')을 고르면 받아 둔 것을 그대로 다 보여 준다 */
    const 자를날 = new Date();
    자를날.setDate(자를날.getDate() - 일수);
    const 기준 = 자를날.toISOString().slice(0, 10);
    const 자른것 = 미리보기.filter((p) => p.day >= 기준);
    return 자른것.length >= 2 ? 자른것 : 미리보기;
  }, [data, 미리보기, 일수, 오늘맞추기]);
  /** 켠 지수 중 실제로 봉을 받아 온 것만 넘긴다 */
  const 지수모음 = useMemo<견줄지수[]>(
    () => 벤치마크들
      .map((b, i) => ({ id: b.id, 봉들: 지수결과[i]?.data as OHLCV[] | undefined }))
      .filter((x) => 벤치들.includes(x.id) && !!x.봉들?.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [벤치들, 지수결과.map((r) => r.dataUpdatedAt).join(",")],
  );

  const 견준것 = useMemo(() => 견주기(점들, 지수모음), [점들, 지수모음]);
  const 그릴것 = useMemo<그릴점[]>(
    () => 견준것.점들.map((p) => ({ ...p, 손익: p.value - p.cost })),
    [견준것],
  );
  /** 실제로 그려진 지수들 — 켰지만 기간이 안 겹치면 여기서 빠진다 */
  const 그린지수 = useMemo(
    () => 벤치마크들.filter((b) => 견준것.쓴지수.includes(b.id)),
    [견준것],
  );

  /**
   * 기준일 — 모든 % 가 여기서 출발한다.
   *
   * 견주기() 는 내 기록과 고른 지수가 **다 있는 첫날**을 기준으로
   * 삼는다(기록이 지수 범위보다 앞서면 기준이 없어 비교가 통째로
   * 사라지기 때문이다). 아래 금액도 같은 날부터 재야 한다 — 두 기준이
   * 다르면 '+12.4%' 와 그 옆의 금액이 서로 다른 자로 잰 숫자가 된다.
   */
  const 기준점 = 견준것.기준칸 >= 0 ? 점들[견준것.기준칸] : null;

  /* 기간 수익 — 기준일 대비 마지막 점.
     '평가손익'(매입가 대비)과는 다른 숫자다. 3년 전에 산 사람에게
     이번 달의 움직임과 전체 수익률은 전혀 다른 이야기다. */
  const 변화 = useMemo(() => {
    if (점들.length < 2 || !기준점?.value) return null;
    const 끝 = 점들[점들.length - 1].value;
    return { 금액: 끝 - 기준점.value, 비율: ((끝 - 기준점.value) / 기준점.value) * 100 };
  }, [점들, 기준점]);

  /** 각 지수는 같은 기간 얼마나 움직였나 — 마지막으로 값이 있는 날 기준 */
  const 지수변화 = useMemo(() => {
    const 표: { id: string; label: string; 색: string; 값: number }[] = [];
    for (const b of 그린지수) {
      for (let i = 그릴것.length - 1; i >= 0; i--) {
        const v = 그릴것[i][지수키(b.id) as `지수_${string}`];
        if (v != null) { 표.push({ id: b.id, label: b.label, 색: b.색, 값: v }); break; }
      }
    }
    return 표;
  }, [그린지수, 그릴것]);

  /** 내 수익률 — 그래프의 마지막 값과 같은 자로 잰 것 */
  const 내수익률 = useMemo(() => {
    for (let i = 그릴것.length - 1; i >= 0; i--) {
      const v = 그릴것[i].내수익;
      if (v != null) return v;
    }
    return 변화?.비율 ?? null;
  }, [그릴것, 변화]);

  /* 선 색도 설정을 따른다.
     예전에는 늘 var(--accent-focus)(파랑)였다. 빨강/파랑을 쓰는 사람에게
     파랑은 '내렸다' 는 뜻이라, 자산이 오른 달에도 선이 내림 색으로
     그려졌다. 기간 수익이 플러스면 오름 색, 마이너스면 내림 색으로
     칠한다 — 바로 위에 있는 큰 숫자와 같은 색이 된다.

     칠 무늬(gradient)의 id 에 색을 섞는다. 고정 id 로 두면 색이 다른
     그래프가 한 화면에 둘 이상 있을 때 먼저 그려진 쪽 색으로 둘 다
     칠해진다 — SVG 는 문서 전체에서 id 하나를 찾는다. */
  const 선색 = (내수익률 ?? 변화?.비율 ?? 0) >= 0 ? 오름 : 내림;
  const 칠id = `자산흐름칠-${선색.replace("#", "")}`;

  /* 기간 안의 최고·최저. 축이 늘 % 이므로 그 값으로 잡는다 */
  const 끝점 = useMemo(() => 최고최저(그릴것, "내수익"), [그릴것]);
  /** 최고·최저 라벨 — 축 하나가 없는 대신 이 두 줄이 눈금 노릇을 한다.
   *
   *  '₩27,362,872' 를 그대로 적으면 열한 글자가 그래프 위를 가로질러
   *  선을 가린다. 실제로 찍어 보고 줄임 표기로 바꿨다 — '2736만' 이면
   *  다섯 글자다.
   *
   *  금액 가리기를 켜면 여기도 가려야 한다. 그러지 않으면 이 두 줄이
   *  대략의 자산 규모를 그대로 말해 버린다. */
  const 축값 = (v: number) => 퍼센트글(v);

  /** 어느 선이 무엇인가. 없으면 점선 회색이 원금이라는 걸 알 길이 없다 */
  const 범례 = [
    { 이름: "내 자산", 색: 선색, 점선: false },
    { 이름: "원금", 색: "var(--text-dim)", 점선: true },
    ...그린지수.map((b) => ({ 이름: b.label, 색: b.색, 점선: true })),
  ];

  const 틀 = (속: React.ReactNode) => (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-primary shrink-0">
          자산 흐름
          {/* 무엇이 예시인지 정확히 적는다. 값은 실제 시세로 계산한
              것이라 '예시' 라고만 하면 숫자까지 지어낸 것으로 읽힌다 */}
          {예시인가 && (
            <span className="ml-1.5 text-2xs font-medium text-text-dim">예시 종목 · 실제 시세</span>
          )}
        </span>
        {/* 칩이 다섯 개라 좁은 화면에서 넘친다. 넘치면 잘리는 대신
            옆으로 밀리게 둔다 — 잘린 칩은 있는 줄도 모른다 */}
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
      </div>
      {속}
    </Card>
  );

  if (!예시인가 && isError) return 틀(<못불러옴 사유={error} 다시={() => refetch()} compact />);
  if ((!예시인가 && isLoading) || 받는중) {
    return 틀(<div className="h-[160px] rounded-lg bg-bg-elevated animate-pulse" />);
  }

  if (점들.length < 2) {
    /* 점 하나짜리 선은 그리면 고장으로 보인다. 무엇을 기다리는지 말한다 */
    return 틀(
      <div className="h-[160px] flex flex-col items-center justify-center gap-1 text-center px-4">
        <p className="text-sm text-text-secondary">아직 그릴 기록이 없어요</p>
        <p className="text-2xs text-text-dim break-keep">
          {portfolioId
            /* 전체는 오래전부터 쌓아 왔지만 포트폴리오별은 이번에 처음
               쌓기 시작했다. 그 사실을 안 적으면 '전체는 나오는데 이건
               왜 안 나오지' 로 읽힌다 */
            ? "포트폴리오별 기록은 이제 막 쌓기 시작했어요. 전체를 누르면 지난 기록을 볼 수 있어요."
            : "하루에 한 번씩 자동으로 쌓입니다. 내일 다시 오면 선이 보여요."}
        </p>
      </div>,
    );
  }

  return 틀(
    <>
      {/* 고른 기간에 얼마 벌었나 —
          예전에는 이 줄이 라벨과 같은 크기로 오른쪽 끝에 붙어 있어서,
          정작 기간을 바꿔 가며 보는 이유인 그 숫자가 제일 작았다.
          그래프 위에서 제일 크게 읽히도록 올린다. */}
      {변화 && 내수익률 != null && (
        <div className="flex flex-col gap-0.5 -mt-1">
          <span className="text-2xs text-text-muted">
            {기간.label} 수익
            {/* 서버는 하루 한 줄씩만 쌓는다. 그 기록이 시작된 날보다 앞은
                아예 없으므로, 고른 기간을 다 못 채웠으면 그렇게 적는다 —
                '전체' 를 눌렀는데 3개월치만 나오면 고장으로 보인다 */}
            {점들.length > 0 && (
              <span className="text-text-dim"> · {점들[0].day.replace(/-/g, ".")}부터</span>
            )}
          </span>
          <div className="flex items-baseline gap-2 flex-wrap">
            {/* 축이 % 로 통일되면서 화면에 '+20.00%' 가 여러 군데 뜬다
                (최고·최저 줄, 앞섬/뒤짐 줄). 검사가 이 큰 숫자를 정확히
                집을 수 있게 이름을 붙인다 */}
            <span data-testid="기간수익"
                  className={`text-2xl leading-none font-mono font-bold num ${pnlColor(내수익률)}`}>
              {퍼센트글(내수익률)}
            </span>
            {/* 금액은 늘 같이 적는다. 축이 % 로 바뀌었어도 '얼마' 는
                여전히 사람이 제일 먼저 보는 숫자다. 위 %와 이 금액은
                이제 같은 기준일에서 잰 것이라 서로 어긋나지 않는다 */}
            <span data-testid="기간금액"
                  className={`text-sm font-mono font-semibold num ${pnlColor(변화.금액)}`}>
              {돈.원부호(변화.금액)}
            </span>
          </div>
        </div>
      )}

      {/* 견줄 지수. '내가 5% 올랐다' 만으로는 잘한 것인지 알 수 없다 */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mt-0.5">
        <span className="text-2xs text-text-dim shrink-0">비교</span>
        {/* '없음' 은 지수가 아니라 '다 끄기' 다. 여럿을 켤 수 있게 되면서
            토글 하나로는 전부 끄는 방법이 없어졌다 */}
        <button
          onClick={() => set벤치들([])}
          aria-pressed={벤치들.length === 0}
          className={`px-2 py-0.5 rounded-full text-2xs font-medium shrink-0 border transition-colors ${
            벤치들.length === 0
              ? "border-text-muted/50 bg-bg-elevated text-text-primary"
              : "border-border text-text-muted hover:text-text-primary"
          }`}
        >없음</button>
        {벤치마크들.map((b) => {
          const 켬 = 벤치들.includes(b.id);
          return (
            <button
              key={b.id}
              onClick={() => set벤치들((앞) =>
                앞.includes(b.id) ? 앞.filter((x) => x !== b.id) : [...앞, b.id])}
              aria-pressed={켬}
              className="px-2 py-0.5 rounded-full text-2xs font-medium shrink-0 border transition-colors hover:text-text-primary"
              /* 칩 색을 그 지수의 선 색과 맞춘다. 선이 넷이면 범례를
                 한 번 더 읽는 대신 색으로 바로 잇는다 */
              style={켬
                ? { borderColor: b.색, color: b.색, background: `${b.색}1a` }
                : { borderColor: "var(--border-default)", color: "var(--text-muted)" }}
            >{b.label}</button>
          );
        })}
      </div>

      {지수변화.length > 0 && 내수익률 != null && (
        /* 숫자로도 적는다. 선이 붙어 있으면 눈으로는 어느 쪽이 이겼는지
           잘 안 보인다. 지수를 여럿 켜면 한 줄씩 늘어난다 */
        <div className="flex flex-col gap-0.5 -mt-1">
          {지수변화.map((x) => (
            <p key={x.id} className="text-2xs text-text-secondary break-keep">
              <span style={{ color: x.색 }}>{x.label}</span> {퍼센트글(x.값)} 대비{" "}
              <span className={`font-semibold ${pnlColor(내수익률 - x.값)}`}>
                {내수익률 >= x.값 ? "앞섬" : "뒤짐"} {Math.abs(내수익률 - x.값).toFixed(2)}%p
              </span>
            </p>
          ))}
        </div>
      )}

      <차트틀 height={160}>
        {(R) => (
          <R.AreaChart data={그릴것} margin={{ top: 10, right: 4, bottom: 0, left: 4 }}>
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
                가로폭의 3분의 1을 먹는다. 금액은 위 카드가 이미 말한다 */}
            <R.YAxis hide domain={["dataMin", "dataMax"]} />
            {/* 손익 전용 축.
                이걸 안 두면 손익(수천만 원)이 세로 범위에 같이 들어가서,
                정작 보려는 평가금액 선이 화면 가운데 얇은 띠로 눌린다.
                실제로 찍어 보고 알았다 — 그리지도 않는 선이 그래프를
                통째로 찌그러뜨리고 있었다. */}
            <R.YAxis yAxisId="손익축" hide domain={["dataMin", "dataMax"]} />
            <R.Tooltip
              contentStyle={{
                background: "var(--bg-card)", border: "1px solid var(--border-default)",
                borderRadius: 10, fontSize: 12, color: "var(--text-primary)",
              }}
              labelStyle={{ color: "var(--text-muted)" }}
              /* 축은 % 지만 사람이 먼저 보는 것은 '얼마' 다. 내 자산과
                 원금은 % 옆에 금액을 같이 적는다 — 금액이 그래프에서
                 통째로 사라지면 % 만 보고는 규모를 알 수 없다.
                 (금액 가리기를 켜면 돈.원 이 알아서 가린다) */
              formatter={(v: number, name: string, 항: { payload?: 그릴점 }) => {
                if (name === "평가손익") return [돈.원부호(Number(v)), name];
                if (name === "내 자산") {
                  return [`${퍼센트글(Number(v))} · ${돈.원(항?.payload?.value ?? 0)}`, name];
                }
                if (name === "원금") {
                  return [`${퍼센트글(Number(v))} · ${돈.원(항?.payload?.cost ?? 0)}`, name];
                }
                return [퍼센트글(Number(v)), name];
              }}
            />

            {/* ── 최고·최저 ──
                눈금이 하나도 없어서, 선이 오르내리는 모양은 보여도
                **얼마나** 오르내렸는지는 안 보였다. 두 줄만 그으면
                그 사이가 곧 눈금이 된다. */}
            {끝점 && (
              <>
                {/* 숫자는 여기 안 적는다. 실제로 찍어 보니 두 줄이 가까울
                    때 라벨끼리 겹쳐서 둘 다 못 읽었고, 어디에 붙여도
                    선이나 오른쪽 끝(지금 값)을 가렸다. 줄은 '어디쯤인가'
                    만 보여 주고, 숫자는 그래프 아래 한 줄에 적는다. */}
                <R.ReferenceLine y={끝점.최고} stroke="var(--text-dim)"
                                 strokeDasharray="2 4" strokeWidth={1} />
                <R.ReferenceLine y={끝점.최저} stroke="var(--text-dim)"
                                 strokeDasharray="2 4" strokeWidth={1} />
              </>
            )}

            {/* ── 선은 늘 같은 자로 그린다 ──
                내 자산·원금·지수가 모두 기준일 0% 에서 출발한다. 비교를
                켜고 끌 때 그래프의 생김새가 안 바뀌므로, 눈이 처음부터
                다시 읽을 일이 없다.

                원금을 같이 그린다. 선 하나만 있으면 '올랐다' 는 보여도
                '벌었다' 는 안 보인다 — 그 둘은 다른 이야기다. 돈을 더
                넣은 날에는 원금 선이 같이 올라가서, 오른 이유가 '벌어서'
                인지 '넣어서' 인지가 눈으로 갈린다. */}
            {그린지수.map((b) => (
              <R.Area key={b.id} type="monotone" dataKey={지수키(b.id)} name={b.label}
                      stroke={b.색} strokeWidth={1.5}
                      strokeDasharray="4 3" fill="none" dot={false}
                      connectNulls isAnimationActive={false} />
            ))}
            <R.Area type="monotone" dataKey="원금수익" name="원금"
                    stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="4 3"
                    fill="none" dot={false} connectNulls isAnimationActive={false} />
            <R.Area type="monotone" dataKey="내수익" name="내 자산"
                    stroke={선색} strokeWidth={2}
                    fill={`url(#${칠id})`} dot={false} isAnimationActive={false} />
            {/* 그리지 않는 선. 툴팁에 '그날 손익' 한 줄을 더하려고 둔다 —
                평가와 원금 사이의 간격이 곧 번 돈인데, 눈으로 재는 일은
                생각보다 어렵다 */}
            <R.Area type="monotone" dataKey="손익" name="평가손익" yAxisId="손익축"
                    stroke="none" fill="none" dot={false}
                    activeDot={false} isAnimationActive={false} />
          </R.AreaChart>
        )}
      </차트틀>

      {/* ── 범례 ──
          선이 둘 또는 셋인데 어느 것이 무엇인지 화면에 적혀 있지 않았다.
          점선 회색이 '원금' 이라는 것은 툴팁을 띄워 봐야 알 수 있었고,
          휴대폰에서는 툴팁을 띄우는 것 자체가 번거롭다. */}
      <div className="flex items-center justify-center gap-3 flex-wrap -mt-1">
        {/* 위아래 점선이 어느 값인지 — 그래프에는 세로 눈금이 없다.
            선 위에 적어 봤더니 두 줄이 가까울 때 겹쳐서 둘 다 못 읽었다 */}
        {끝점 && (
          <span className="text-2xs text-text-dim tabular-nums">
            최고 {축값(끝점.최고)} · 최저 {축값(끝점.최저)}
          </span>
        )}
        {범례.map((x) => (
          <span key={x.이름} className="flex items-center gap-1 text-2xs text-text-dim">
            <span
              aria-hidden
              className="w-3 h-0 border-t-2 rounded"
              style={{ borderColor: x.색, borderTopStyle: x.점선 ? "dashed" : "solid" }}
            />
            {x.이름}
          </span>
        ))}
      </div>
    </>,
  );
}
