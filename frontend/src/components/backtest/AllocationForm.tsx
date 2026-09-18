/**
 * 자산배분 백테스트 — 설정 화면.
 *
 * 사진의 항목을 그대로 만든다: 테스트 기간(슬라이더 + 직접 입력),
 * 테스트 금액(통화 + 금액), 테스트 자산(여러 개 + 비중), 추가 납입
 * (주기 + 금액), 리밸런싱 주기, 토탈 리턴(배당 포함).
 *
 * ── 화면이 지켜야 할 것 ────────────────────────────────────
 *
 * 이 화면이 내는 수를 보고 사람이 실제 돈을 넣는다. 그래서 '못 잰 것' 과
 * '0' 을 반드시 갈라서 보여 줘야 하고, 서버가 자산을 빼고 계산했으면
 * 그 사실을 감추면 안 된다. 조용히 두 개짜리 결과를 세 개짜리인 척
 * 보여 주는 것이 이 기능에서 가장 나쁜 실패다.
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, X, Check } from "lucide-react";
import { Card, Button, 고른칩, 지움단추 } from "@/components/ui";
import { useQuery } from "@tanstack/react-query";
import { useStockSearch } from "@/hooks/useStockSearch";
import { useAuthStore } from "@/store/authStore";
import { watchlistApi, portfolioApi } from "@/api/stocks";
import type { 배분자산, 주기, 데이터기준, 벤치마크키 } from "@/api/stocks";

/* 기간 슬라이더를 없애면서 최소년·최대년도 같이 지웠다.
   날짜를 직접 치므로 햇수 상한이라는 것이 아예 없다 — 1980년이든
   1927년이든 그냥 적으면 된다. 상수만 남겨 두면 '무언가를 막고 있는
   것처럼' 보이는데 실제로는 아무것도 안 막는다. */

export const 주기표: { value: 주기; label: string }[] = [
  { value: "none", label: "없음" },
  { value: "monthly", label: "매월" },
  { value: "quarterly", label: "매분기" },
  { value: "yearly", label: "매년" },
];

export const 벤치마크표: { value: 벤치마크키; label: string }[] = [
  { value: "none", label: "없음" },
  { value: "6040", label: "주식 60 · 채권 40" },
  { value: "spy", label: "S&P500" },
  { value: "qqq", label: "나스닥100" },
  { value: "kospi", label: "코스피200" },
  { value: "allweather", label: "올웨더" },
];

export const 데이터기준표: { value: 데이터기준; label: string }[] = [
  { value: "daily", label: "일 데이터" },
  { value: "monthly", label: "월 데이터" },
];

/** 흔히 쓰는 수수료. 이 값들은 **빠른 선택**일 뿐이고, 옆 칸에 직접
 *  친다. 증권사마다 수수료가 제각각이라 목록으로는 절대 다 못 담는다 —
 *  목록에만 두면 자기 수수료가 없는 사람은 비슷한 값을 고르게 되고,
 *  그건 틀린 값으로 계산하는 것이다. */
export const 비용표 = [0, 0.015, 0.05, 0.1, 0.25];

/** 기간 빠른 선택. 버튼 하나로 날짜 두 개가 채워진다. */
export const 빠른기간 = [1, 3, 5, 10, 20, 30];

/** 리밸런싱 날짜. 29~31 은 없는 달이 있어 28 까지만 준다 —
 *  '31일' 을 고르면 2월이 통째로 빠지는데 그게 화면에는 안 보인다. */
export const 날짜들 = Array.from({ length: 28 }, (_, i) => i + 1);

/** 금액을 사람이 읽는 말로. 사진의 '1만 달러' 자리.
 *
 *  0 이 몇 개인지 세게 하면 안 된다. 10000000 과 100000000 은 눈으로
 *  가르기 어렵고, 한 자리 틀리면 결과가 열 배로 달라진다. */
export function 읽는금액(v: number, 통화: "KRW" | "USD"): string {
  if (!v || !Number.isFinite(v)) return "";
  if (통화 === "USD") {
    if (v >= 1e8) return `${+(v / 1e8).toFixed(1)}억 달러`;
    if (v >= 1e4) return `${+(v / 1e4).toFixed(v % 1e4 ? 1 : 0)}만 달러`;
    if (v >= 1e3) return `${+(v / 1e3).toFixed(v % 1e3 ? 1 : 0)}천 달러`;
    return `${v.toLocaleString("ko-KR")} 달러`;
  }
  if (v >= 1e12) return `${+(v / 1e12).toFixed(1)}조원`;
  if (v >= 1e8) return `${+(v / 1e8).toFixed(v % 1e8 ? 1 : 0)}억원`;
  if (v >= 1e4) return `${+(v / 1e4).toFixed(v % 1e4 ? 1 : 0)}만원`;
  return `${v.toLocaleString("ko-KR")}원`;
}

/** 금액 빠른 선택. 누르면 그 금액으로 **바로 정해진다**(더하지 않는다).
 *
 *  더하기로 두면 1,000만원을 넣으려고 여러 번 눌러야 하고, 한 번 더
 *  누르면 2,000만원이 되어 되돌리려면 지우고 다시 시작해야 한다.
 *  시험해 볼 금액은 보통 몇 개로 정해져 있으니 한 번에 정하는 편이 낫다.
 *
 *  통화마다 자릿수가 다르다 — 원화에 500달러는 아무 쓸모가 없다. */
export function 금액값들(통화: "KRW" | "USD"): number[] {
  return 통화 === "USD"
    ? [1_000, 5_000, 10_000, 100_000]
    : [1_000_000, 5_000_000, 10_000_000, 100_000_000];
}

/**
 * 햇수를 날짜 두 개로 바꾼다.
 *
 * '오늘' 을 인자로 받는다. 안에서 new Date() 를 부르면 검사가 오늘이
 * 며칠이냐에 따라 흔들린다 — 이 저장소에서 이미 그렇게 깨진 검사를
 * 한 번 고쳤다.
 */
export function 기간에서날짜(년: number, 오늘 = new Date()) {
  const 끝 = new Date(오늘);
  const 시작 = new Date(오늘);
  시작.setFullYear(시작.getFullYear() - 년);
  const 적기 = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start_date: 적기(시작), end_date: 적기(끝) };
}

export interface 설정 {
  years: number;
  start_date: string;
  end_date: string;
  currency: "KRW" | "USD";
  initial_amount: number | "";
  assets: 배분자산[];
  contribution_period: 주기;
  contribution_amount: number | "";
  rebalance_period: 주기;
  total_return: boolean;
  rebalance_day: number;
  cost_rate: number;
  data_interval: 데이터기준;
  benchmark: 벤치마크키;
  equal_weight: boolean;
  extended: boolean;
  /** 현금에 붙는 연 이율(%) */
  cash_rate: number;
  /** 샤프를 잴 때 뺄 무위험수익률(연 %) */
  risk_free_rate: number;
}

export function 첫설정(오늘 = new Date()): 설정 {
  const { start_date, end_date } = 기간에서날짜(10, 오늘);
  return {
    years: 10, start_date, end_date,
    currency: "KRW", initial_amount: "",
    assets: [],
    /* 적립은 **꺼 놓고** 시작한다.

       예전에는 '매월' 이 기본인데 금액이 비어 있어서, 자산과 금액을
       다 넣어도 '결과 확인' 이 잠긴 채였다. 잠긴 이유는 작은 글씨로만
       적혀 있었고, 풀려면 쓰지도 않을 적립 주기를 '없음' 으로 바꿔야
       했다 — 기능이 통째로 안 되는 것처럼 보였다.

       기본값은 **아무것도 안 고쳐도 돌아가는 값**이어야 한다. */
    contribution_period: "none", contribution_amount: "",
    rebalance_period: "none", total_return: true,
    rebalance_day: 1,
    /* 기본을 0 으로 둔다. 수수료는 증권사마다 다르고, 지어낸 값으로
       계산해 두면 사용자는 그게 자기 수수료인 줄 안다. 고르게 해 두고
       안 고르면 안 넣은 것으로 적는다. */
    cost_rate: 0,
    data_interval: "daily",
    benchmark: "none",
    equal_weight: false,
    extended: false,
    /* 둘 다 0 으로 시작한다. 지어낸 값을 넣어 두면 사용자는 그게
       자기 기준인 줄 안다. 대신 결과에 '무엇을 가정하고 잰 수인가' 를
       적어 보여 준다 — 가정을 감추는 것이 0 자체보다 나쁘다. */
    cash_rate: 0,
    risk_free_rate: 0,
  };
}

/** 돌릴 수 있는 설정인가 — 못 돌릴 이유를 **말로** 돌려준다.
 *
 *  버튼만 회색으로 만들고 이유를 안 적으면, 사용자는 무엇이 모자란지
 *  모른 채 화면을 뒤진다. 이 앱에서 제일 흔한 첫 사용이 '자산을 아직
 *  안 골랐다' 라서 특히 그렇다. */
export function 못돌리는이유(s: 설정): string | null {
  if (!s.assets.length) return "테스트할 자산을 하나 이상 골라 주세요";
  if (!s.initial_amount || Number(s.initial_amount) <= 0) return "테스트 금액을 넣어 주세요";
  if (s.contribution_period !== "none" && !s.contribution_amount) {
    return "추가 납입 금액을 넣거나 주기를 '없음' 으로 바꿔 주세요";
  }
  if (s.start_date >= s.end_date) return "종료일이 시작일보다 뒤여야 해요";
  return null;
}

const 통화기호 = { KRW: "₩", USD: "$" } as const;

function 칸제목({ children, 오른쪽 }: { children: React.ReactNode; 오른쪽?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-base font-semibold text-text-primary">{children}</span>
      {오른쪽}
    </div>
  );
}

/** 이름표가 붙은 고르기 칸.
 *
 *  여덟 개가 같은 모양이라 하나로 묶었다. 그냥 <select> 만 늘어놓으면
 *  화면이 좁아질 때 무엇을 고르는 칸인지 알 수 없어진다 — 이름표를
 *  **위에** 붙여야 폰에서도 짝이 안 어긋난다.
 *
 *  htmlFor 로 잇는다. aria-label 만 붙이면 눈으로 보는 이름표와
 *  읽어 주는 이름이 따로 놀 수 있다. */
function 고르기({ 이름, 값, 바꾸기, 것들 }: {
  이름: string; 값: string;
  바꾸기: (v: string) => void;
  것들: { value: string; label: string }[];
}) {
  const id = `bt-${이름.replace(/\s/g, "")}`;
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={id} className="text-xs text-text-muted">{이름}</label>
      <select
        id={id}
        className="w-full bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
        value={값}
        onChange={(e) => 바꾸기(e.target.value)}
      >
        {것들.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** 퍼센트를 직접 치는 칸 — 거래비용·현금이자·무위험수익률이 같이 쓴다.
 *
 *  ── 왜 글자를 따로 들고 있나 ────────────────────────────────
 *
 *  숫자만 들고 있으면 **'0.05' 를 칠 수가 없다.**
 *
 *  '0' 을 치는 순간 Number('0') === 0 이고, 0 을 빈칸으로 그리면
 *  방금 친 글자가 사라진다. '0' 을 남겨 둬도 다음 '.' 이 숫자로는
 *  0 이라 화면이 '0' 으로 되돌아가고, 소수점을 영영 못 찍는다.
 *  (그렇게 짰다가 '0.037' 을 쳤더니 '37' 이 됐다.)
 *
 *  그래서 **치는 동안에는 글자 그대로** 들고, 숫자는 그때그때 올려
 *  보낸다. 밖에서 값이 바뀌면(빠른 버튼, 저장한 실험 불러오기)
 *  그때만 글자를 맞춰 준다.
 *
 *  세 칸이 똑같은 고장을 안고 있으므로 한 부품으로 만든다 — 베껴
 *  두면 한 곳만 고치고 나머지는 그대로 남는다. */
export function 퍼센트칸({ id, 이름, 값, 바꾸기, 최대 = 5, 설명 }: {
  id: string; 이름: string; 값: number; 바꾸기: (v: number) => void;
  최대?: number; 설명?: string;
}) {
  const [글, set글] = useState(값 ? String(값) : "");

  /* 밖에서 바뀐 것만 따라간다. 내가 친 글자까지 덮으면 도로 같은
     고장이 난다 — 숫자로 같으면 손대지 않는다. */
  useEffect(() => {
    if ((Number(글) || 0) !== 값) set글(값 ? String(값) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [값]);

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={id} className="text-xs text-text-muted">{이름}</label>
      <div className="flex items-center gap-1 bg-bg-elevated border border-border rounded-xl px-3 min-w-0">
        <input
          id={id} type="text" inputMode="decimal" placeholder="0"
          className="flex-1 min-w-0 bg-transparent py-2.5 text-sm text-text-primary focus:outline-none"
          value={글}
          onChange={(e) => {
            /* 숫자와 소수점만 받는다. type="number" 를 쓰면 브라우저마다
               중간 상태('0.')를 빈 문자열로 주는 곳이 있어 같은 고장이 난다 */
            const 다음 = e.target.value.replace(/[^\d.]/g, "").slice(0, 6);
            set글(다음);
            const n = Number(다음);
            바꾸기(Number.isFinite(n) ? Math.min(n, 최대) : 0);
          }}
        />
        <span className="text-sm text-text-muted flex-shrink-0">%</span>
      </div>
      {설명 && <span className="text-2xs text-text-dim break-keep">{설명}</span>}
    </div>
  );
}

/** 자산 한 줄 — 이름·비중·지우기 */
function 자산줄({ 자산, 비중, onWeight, onRemove }: {
  자산: 배분자산; 비중: number;
  onWeight: (v: number) => void; onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-bg-elevated">
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-medium text-text-primary truncate">
          {자산.name || 자산.symbol}
        </span>
        <span className="text-2xs text-text-dim">{자산.symbol} · {자산.market}</span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <input
          type="number" min={0} max={100} inputMode="decimal"
          aria-label={`${자산.name || 자산.symbol} 비중 (%)`}
          className="w-16 bg-bg-primary border border-border rounded-lg px-2 py-1 text-sm text-right text-text-primary focus:outline-none focus:border-accent-blue"
          value={비중}
          onChange={(e) => onWeight(Number(e.target.value))}
        />
        <span className="text-xs text-text-muted">%</span>
      </div>
      <지움단추 ariaLabel={`${자산.name || 자산.symbol} 빼기`} onClick={onRemove} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   자산 고르기
   ═══════════════════════════════════════════════════════════ */

/** 종류별 대표 ETF.
 *
 *  ── 왜 목록을 따로 두나 ─────────────────────────────────────
 *
 *  검색만 두면 **무엇을 쳐야 할지 아는 사람만** 자산배분을 만들 수 있다.
 *  '주식 60 · 채권 40' 을 해 보고 싶어도 채권 ETF 이름을 모르면 거기서
 *  막힌다. 자산배분은 종목을 고르는 것이 아니라 **종류를 나누는 것**이라,
 *  종류부터 보여 주는 것이 이 화면의 뜻에 맞는다.
 *
 *  ── 고른 기준 ──
 *
 *  종류마다 **가장 크고 오래된 것**을 넣었다. 오래된 것이 중요한 이유는
 *  백테스트라서다 — 2020년에 생긴 ETF 로는 2008년을 재 볼 수가 없다.
 *  각 줄의 '부터' 가 그 자산으로 거슬러 갈 수 있는 한계다.
 *
 *  국내 것도 같이 둔다. 원화로 재는 사람에게 미국 ETF 만 주면 환율까지
 *  같이 재게 되어 '이 조합이 좋았나' 를 알 수 없다. */
export type 자산종류 = "주식" | "채권" | "대체";

export const 대표자산: {
  종류: 자산종류; symbol: string; market: "US" | "KR" | "ETF";
  name: string; 설명: string; 부터: string;
}[] = [
  // ── 주식 ──
  { 종류: "주식", symbol: "SPY",      market: "US", name: "S&P 500",        설명: "미국 대형주", 부터: "1993" },
  { 종류: "주식", symbol: "QQQ",      market: "US", name: "나스닥 100",     설명: "미국 기술주", 부터: "1999" },
  { 종류: "주식", symbol: "VTI",      market: "US", name: "미국 전체",      설명: "대형+중소형", 부터: "2001" },
  { 종류: "주식", symbol: "VEA",      market: "US", name: "선진국(미국 밖)", 설명: "유럽·일본 등", 부터: "2007" },
  { 종류: "주식", symbol: "VWO",      market: "US", name: "신흥국",         설명: "중국·인도 등", 부터: "2005" },
  { 종류: "주식", symbol: "069500.KS", market: "KR", name: "KODEX 200",     설명: "국내 대형주", 부터: "2002" },
  // ── 채권 ──
  { 종류: "채권", symbol: "TLT", market: "US", name: "미국 장기국채", 설명: "20년 이상",   부터: "2002" },
  { 종류: "채권", symbol: "IEF", market: "US", name: "미국 중기국채", 설명: "7~10년",      부터: "2002" },
  { 종류: "채권", symbol: "SHY", market: "US", name: "미국 단기국채", 설명: "1~3년",       부터: "2002" },
  { 종류: "채권", symbol: "AGG", market: "US", name: "미국 종합채권", 설명: "국채+회사채", 부터: "2003" },
  { 종류: "채권", symbol: "TIP", market: "US", name: "물가연동국채", 설명: "인플레 방어", 부터: "2003" },
  { 종류: "채권", symbol: "148070.KS", market: "KR", name: "KOSEF 국고채10년", 설명: "국내 장기국채", 부터: "2011" },
  // ── 대체 ──
  { 종류: "대체", symbol: "GLD", market: "US", name: "금",         설명: "실물 금",      부터: "2004" },
  { 종류: "대체", symbol: "SLV", market: "US", name: "은",         설명: "실물 은",      부터: "2006" },
  { 종류: "대체", symbol: "DBC", market: "US", name: "원자재",     설명: "에너지·곡물",  부터: "2006" },
  { 종류: "대체", symbol: "VNQ", market: "US", name: "미국 리츠",  설명: "부동산",       부터: "2004" },
  { 종류: "대체", symbol: "IAU", market: "US", name: "금(저보수)", 설명: "GLD 보다 싼",  부터: "2005" },
];

export const 종류들: 자산종류[] = ["주식", "채권", "대체"];

/** 이미 담은 것인가 — 같은 것을 두 번 담으면 비중만 헷갈린다 */
export function 담았나(assets: 배분자산[], symbol: string): boolean {
  return assets.some((a) => a.symbol === symbol);
}

/** 관심목록·내 자산 줄을 배분자산 모양으로. 서버 응답 모양이 조금씩
 *  달라서 한 자리에서 맞춘다 — 여기저기서 맞추면 한 곳만 고쳐진다. */
export function 줄을자산으로(x: any): 배분자산 | null {
  const symbol = x?.symbol;
  if (!symbol) return null;
  const market = x?.market === "KR" || x?.market === "ETF" ? x.market : "US";
  return { symbol, market, name: x?.name || symbol, weight: 0 };
}

/** 자산 하나를 목록에 붙인다 — 담는 규칙이 여기 한 곳에만 있다.
 *
 *  ── 왜 함수로 뺐나 ────────────────────────────────────────
 *
 *  예전에는 같은 것을 두 번 막는 방어가 **두 벌**이었다. 고르기 창이
 *  이미 담은 것을 disabled 로 막고, 받는 쪽에서도 한 번 더 걸렀다.
 *  둘 다 있으면 어느 쪽을 지워도 검사가 안 죽는다 — 뮤테이션에
 *  살아남는 것이 그 증거다. 실제로 한쪽을 지워 봤더니 아무 검사도
 *  안 깨졌다.
 *
 *  더 나쁜 것은 **두 벌의 기준이 달랐다**는 점이다. 창은 심볼만 봤고
 *  받는 쪽은 심볼+시장을 봤다. 같은 심볼이 시장만 다르면 창은 막는데
 *  받는 쪽은 허용해서, 어느 쪽이 맞는지 코드만 봐서는 알 수 없었다.
 *
 *  **심볼만 본다.** 같은 심볼이 두 줄 있으면 비중 칸의 이름이 겹쳐
 *  어느 쪽을 고치는지 알 수 없다. 시장이 달라도 사람에게는 같은
 *  종목이다. */
export function 자산더하기(있던것: 배분자산[], 새것: 배분자산): 배분자산[] {
  if (담았나(있던것, 새것.symbol)) return 있던것;
  const 다음 = [...있던것, 새것];
  /* 새로 담을 때마다 비중을 똑같이 나눠 준다. 0% 로 들어가면
     '담았는데 결과에 아무 영향이 없는' 상태가 되고, 그건 고장으로 읽힌다 */
  const 고른비중 = Math.round(1000 / 다음.length) / 10;
  return 다음.map((x) => ({ ...x, weight: 고른비중 }));
}

/** 자산 고르기 — 종류별 대표 · 내 목록 · 검색 */
function 자산고르기({ 담은것, onPick, onClose }: {
  담은것: 배분자산[];
  onPick: (a: 배분자산) => void; onClose: () => void;
}) {
  const { query, setQuery, results, searching } = useStockSearch();
  const { isLoggedIn } = useAuthStore();
  const [칸, set칸] = useState<"대표" | "내것" | "검색">("대표");
  const [종류, set종류] = useState<자산종류>("주식");

  /* 로그인 안 했으면 부르지 않는다. 서버가 빈 배열을 주더라도 안 쓸
     요청을 보낼 이유가 없다 — 0.15 CPU 짜리 서버다. */
  const { data: 관심 = [], isLoading: 관심로딩 } = useQuery({
    queryKey: ["bt-watchlist"],
    queryFn: () => watchlistApi.getItems(),
    enabled: isLoggedIn && 칸 === "내것",
    staleTime: 300_000,
  });
  const { data: 보유 = [], isLoading: 보유로딩 } = useQuery({
    queryKey: ["bt-holdings"],
    queryFn: () => portfolioApi.getItems(undefined, true),
    enabled: isLoggedIn && 칸 === "내것",
    staleTime: 300_000,
  });

  const 내것들 = useMemo(() => {
    const 나온것: { 어디: string; 자산: 배분자산 }[] = [];
    const 본것 = new Set<string>();
    for (const [어디, 줄들] of [["내 자산", 보유], ["관심목록", 관심]] as const) {
      for (const x of (줄들 as any[]) ?? []) {
        const a = 줄을자산으로(x);
        /* 같은 종목이 내 자산에도 관심목록에도 있으면 한 번만 보인다.
           두 번 보이면 어느 쪽을 눌러야 하는지 고민하게 된다. */
        if (!a || 본것.has(a.symbol)) continue;
        본것.add(a.symbol);
        나온것.push({ 어디, 자산: a });
      }
    }
    return 나온것;
  }, [보유, 관심]);

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl border border-accent-blue/40 bg-bg-elevated">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {(["대표", "내것", "검색"] as const).map((k) => (
            <고른칩 key={k} 작게 고름={칸 === k} onClick={() => set칸(k)}
                    ariaLabel={k === "내것" ? "내 목록에서" : k === "대표" ? "종류별 대표" : "검색해서"}>
              {k === "내것" ? "내 목록" : k === "대표" ? "종류별" : "검색"}
            </고른칩>
          ))}
        </div>
        <button onClick={onClose} aria-label="자산 고르기 닫기" className="p-1.5 text-text-dim hover:text-text-primary">
          <X size={16} />
        </button>
      </div>

      {/* ── 종류별 대표 ── */}
      {칸 === "대표" && (
        <>
          <div className="flex gap-1.5">
            {종류들.map((g) => (
              <고른칩 key={g} 작게 고름={종류 === g} className="flex-1"
                      onClick={() => set종류(g)} ariaLabel={`${g} 자산`}>{g}</고른칩>
            ))}
          </div>
          <ul className="flex flex-col max-h-56 overflow-y-auto">
            {대표자산.filter((x) => x.종류 === 종류).map((x) => {
              const 이미 = 담았나(담은것, x.symbol);
              return (
                <li key={x.symbol}>
                  <button
                    disabled={이미}
                    aria-label={`${x.name} 담기`}
                    className="w-full text-left px-2 py-2 rounded-lg hover:bg-bg-card flex items-center gap-2 disabled:opacity-40"
                    onClick={() => onPick({ symbol: x.symbol, market: x.market, name: x.name, weight: 0 })}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-text-primary truncate">{x.name}</p>
                      <p className="text-2xs text-text-dim truncate">{x.설명} · {x.symbol}</p>
                    </div>
                    {/* 언제부터 있는 자산인지 적는다. 2020년에 생긴 것으로는
                        2008년을 재 볼 수 없는데, 그걸 모르면 '기간이 짧아졌다'
                        는 말만 보고 왜인지 알 수 없다. */}
                    <span className="text-2xs text-text-dim flex-shrink-0">{x.부터}~</span>
                    {이미 && <Check size={14} className="text-accent-green flex-shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ── 내 목록 ── */}
      {칸 === "내것" && (
        !isLoggedIn ? (
          <p className="text-xs text-text-dim px-1 py-3 break-keep">
            로그인하면 관심목록과 내 자산에서 바로 담을 수 있어요.
          </p>
        ) : (관심로딩 || 보유로딩) ? (
          <p className="text-xs text-text-dim px-1 py-3">가져오는 중…</p>
        ) : 내것들.length === 0 ? (
          <p className="text-xs text-text-dim px-1 py-3 break-keep">
            관심목록에도 내 자산에도 종목이 없어요. '검색' 으로 찾아 보세요.
          </p>
        ) : (
          <ul className="flex flex-col max-h-56 overflow-y-auto">
            {내것들.map(({ 어디, 자산 }) => {
              const 이미 = 담았나(담은것, 자산.symbol);
              return (
                <li key={자산.symbol}>
                  <button
                    disabled={이미}
                    aria-label={`${자산.name} 담기`}
                    className="w-full text-left px-2 py-2 rounded-lg hover:bg-bg-card flex items-center gap-2 disabled:opacity-40"
                    onClick={() => onPick(자산)}
                  >
                    <span className="text-sm text-text-primary truncate flex-1">{자산.name}</span>
                    <span className="text-2xs text-text-dim flex-shrink-0">{어디}</span>
                    {이미 && <Check size={14} className="text-accent-green flex-shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )
      )}

      {/* ── 검색 ── */}
      {칸 === "검색" && (
        <>
          <input
            autoFocus
            className="bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
            placeholder="종목명 또는 코드 (예: AAPL, 005930, 삼성)"
            aria-label="자산 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && <p className="text-xs text-text-dim px-1">찾는 중…</p>}
          {!searching && query.trim() && results.length === 0 && (
            <p className="text-xs text-text-dim px-1">찾는 종목이 없어요</p>
          )}
          {results.length > 0 && (
            <ul className="flex flex-col max-h-56 overflow-y-auto">
              {results.slice(0, 20).map((x: any) => {
                const 이미 = 담았나(담은것, x.symbol);
                return (
                  <li key={`${x.market}:${x.symbol}`}>
                    <button
                      disabled={이미}
                      aria-label={`${x.name} 담기`}
                      className="w-full text-left px-2 py-2 rounded-lg hover:bg-bg-card flex items-center gap-2 disabled:opacity-40"
                      onClick={() => onPick({ symbol: x.symbol, market: x.market, name: x.name, weight: 0 })}
                    >
                      <span className="text-sm text-text-primary truncate flex-1">{x.name}</span>
                      <span className="text-2xs text-text-dim flex-shrink-0">{x.symbol} · {x.market}</span>
                      {이미 && <Check size={14} className="text-accent-green flex-shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* 현금은 어느 칸에서도 검색으로 안 나온다. 자산배분에서 '현금 20%'
          는 아주 흔한 구성이라 늘 보이는 자리에 둔다 — 없으면 그 조합을
          아예 못 만든다. */}
      <button
        onClick={() => onPick({ symbol: "현금", market: "KR", name: "현금", weight: 0 })}
        disabled={담았나(담은것, "현금")}
        className="self-start px-2.5 py-1 rounded-full text-2xs font-medium border border-border text-text-muted hover:text-text-primary disabled:opacity-40"
      >
        + 현금
      </button>
    </div>
  );
}

export default function 자산배분설정({
  값, 바꾸기, 돌리기, 도는중, 저장하기, 저장중 = false, 저장됨 = false,
}: {
  값: 설정;
  바꾸기: (다음: 설정) => void;
  돌리기: () => void;
  도는중: boolean;
  저장하기?: () => void;
  저장중?: boolean;
  /** 방금 저장했나 — 잠깐 초록 줄을 띄운다 */
  저장됨?: boolean;
}) {
  const [검색열림, set검색열림] = useState(false);
  const [로그인안내, set로그인안내] = useState(false);
  const 못하는이유 = 못돌리는이유(값);

  /** 비중 합. 100 이 아니어도 서버가 맞춰 주지만, 화면에 적어 주면
   *  사용자가 의도한 대로인지 바로 확인할 수 있다. */
  const 비중합 = useMemo(
    () => 값.assets.reduce((a, x) => a + (Number(x.weight) || 0), 0),
    [값.assets],
  );

  const 기간바꾸기 = (년: number) =>
    바꾸기({ ...값, years: 년, ...기간에서날짜(년) });

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-text-primary">신규 테스트</h2>
      <div className="h-px bg-border -mx-4" />

      {/* ── 테스트 기간 ──
          날짜는 **늘 직접 입력**이다. 예전에는 슬라이더가 기본이고
          체크박스를 켜야 날짜가 나왔는데, 슬라이더로는 '2020년 3월부터'
          같은 것을 아예 못 고른다. 흔한 기간은 아래 버튼으로 한 번에
          채우면 되니, 굳이 둘 중 하나를 고르게 할 이유가 없다. */}
      <div className="flex flex-col gap-3">
        <칸제목>테스트 기간</칸제목>

        {/* 좁은 화면에서는 **세로로 쌓는다.**

            날짜 칸 두 개를 폰에서 나란히 두면 하나가 150px 도 안 된다.
            거기에 브라우저가 붙이는 달력 단추까지 들어가는데, 그 단추
            크기도 날짜 글자 모양도 기기·언어마다 다르다 — 한국어는
            '2026. 09. 18.' 이라 영어보다 훨씬 넓다. 크롬으로 재면
            멀쩡한데 실제 폰에서는 잘린다.

            픽셀을 맞춰 가며 아슬아슬하게 두느니 칸을 통째로 넓힌다.
            세로로 쌓으면 기기가 무엇이든 잘릴 일이 없다. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <label htmlFor="bt-start" className="text-xs text-text-muted">시작일</label>
            <input id="bt-start" type="date"
              className="w-full min-w-0 bg-bg-primary border border-border rounded-lg px-2 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
              value={값.start_date}
              onChange={(e) => 바꾸기({ ...값, start_date: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <label htmlFor="bt-end" className="text-xs text-text-muted">종료일</label>
            <input id="bt-end" type="date"
              className="w-full min-w-0 bg-bg-primary border border-border rounded-lg px-2 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
              value={값.end_date}
              onChange={(e) => 바꾸기({ ...값, end_date: e.target.value })} />
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {빠른기간.map((년) => (
            <고른칩 key={년} 고름={값.years === 년} ariaLabel={`${년}년`}
                    최소너비="3.5rem" className="flex-1"
                    onClick={() => 기간바꾸기(년)}>{년}년</고른칩>
          ))}
        </div>
      </div>

      {/* ── 테스트 금액 ── */}
      <div className="flex flex-col gap-3">
        <칸제목>테스트 금액</칸제목>
        <div className="flex gap-3">
          <select
            aria-label="통화"
            className="bg-bg-elevated border border-border rounded-full px-4 py-2 text-sm text-text-primary focus:outline-none"
            value={값.currency}
            onChange={(e) => 바꾸기({ ...값, currency: e.target.value as "KRW" | "USD" })}
          >
            <option value="KRW">KRW</option>
            <option value="USD">USD</option>
          </select>
          <div className="flex-1 flex items-center gap-2 bg-bg-elevated border border-border rounded-xl px-3 min-w-0">
            <span className="text-sm text-text-muted flex-shrink-0">{통화기호[값.currency]}</span>
            <input
              type="number" min={0} inputMode="numeric"
              aria-label="테스트 금액"
              placeholder="금액 입력"
              className="flex-1 min-w-0 bg-transparent py-2 text-sm text-text-primary focus:outline-none"
              value={값.initial_amount}
              onChange={(e) => 바꾸기({ ...값, initial_amount: e.target.value === "" ? "" : Number(e.target.value) })}
            />
            {/* 0 이 몇 개인지 세게 하면 안 된다. 1000만과 1억은 눈으로
                가르기 어렵고, 한 자리 틀리면 결과가 열 배로 달라진다 */}
            {!!Number(값.initial_amount) && (
              <span className="text-sm font-semibold text-accent-blue flex-shrink-0">
                {읽는금액(Number(값.initial_amount), 값.currency)}
              </span>
            )}
          </div>
        </div>
        {/* 누르면 그 금액으로 **바로 정해진다**. 더하기로 두면
            1,000만원을 넣으려고 여러 번 눌러야 하고, 한 번 더 누르면
            2,000만원이 되어 지우고 다시 시작해야 한다. */}
        <div className="flex gap-2 flex-wrap">
          {금액값들(값.currency).map((v) => (
            <고른칩 key={v} 고름={Number(값.initial_amount) === v}
                    ariaLabel={읽는금액(v, 값.currency)}
                    최소너비="4.5rem" className="flex-1"
                    onClick={() => 바꾸기({ ...값, initial_amount: v })}
            >{읽는금액(v, 값.currency)}</고른칩>
          ))}
          {!!Number(값.initial_amount) && (
            <button
              aria-label="금액 지우기"
              className="px-3 py-2 rounded-lg text-xs text-text-dim hover:text-accent-red"
              onClick={() => 바꾸기({ ...값, initial_amount: "" })}
            >지우기</button>
          )}
        </div>
      </div>

      {/* ── 테스트 자산 ── */}
      <div className="flex flex-col gap-3">
        <칸제목
          오른쪽={값.assets.length > 0 ? (
            <span className={`text-xs font-mono ${Math.round(비중합) === 100 ? "text-text-muted" : "text-accent-yellow"}`}>
              합 {비중합.toFixed(0)}%
            </span>
          ) : undefined}
        >테스트 자산</칸제목>

        {값.assets.length > 0 && (
          <div className="flex flex-col gap-2">
            {값.assets.map((a, i) => (
              <자산줄
                key={`${a.market}:${a.symbol}`}
                자산={a} 비중={a.weight}
                onWeight={(v) => {
                  const 다음 = [...값.assets];
                  다음[i] = { ...다음[i], weight: v };
                  바꾸기({ ...값, assets: 다음 });
                }}
                onRemove={() => 바꾸기({ ...값, assets: 값.assets.filter((_, j) => j !== i) })}
              />
            ))}
          </div>
        )}

        {/* 비중을 아직 안 나눴으면 한 번에 맞춰 주는 길을 둔다.
            세 자산에 33.3/33.3/33.4 를 손으로 적게 하는 것은 일이다 */}
        {값.assets.length > 1 && Math.round(비중합) !== 100 && (
          <button
            className="self-start text-xs text-accent-blue hover:underline"
            onClick={() => 바꾸기({
              ...값,
              assets: 값.assets.map((a) => ({ ...a, weight: Math.round(1000 / 값.assets.length) / 10 })),
            })}
          >동일비중</button>
        )}

        {검색열림 ? (
          <자산고르기
            담은것={값.assets}
            onClose={() => set검색열림(false)}
            onPick={(a) => {
              바꾸기({ ...값, assets: 자산더하기(값.assets, a) });
              set검색열림(false);
            }}
          />
        ) : (
          <button
            onClick={() => set검색열림(true)}
            aria-label="자산 추가"
            className="w-full py-6 rounded-xl border border-dashed border-border text-text-muted hover:text-text-primary hover:border-accent-blue/50 flex items-center justify-center"
          >
            <Plus size={22} />
          </button>
        )}
      </div>

      {/* ── 추가 납입 금액 ── */}
      <div className="flex flex-col gap-3">
        <칸제목>추가 납입 금액</칸제목>
        <div className="flex gap-3">
          <select
            aria-label="추가 납입 주기"
            className="bg-bg-elevated border border-border rounded-full px-4 py-2 text-sm text-text-primary focus:outline-none"
            value={값.contribution_period}
            onChange={(e) => 바꾸기({ ...값, contribution_period: e.target.value as 주기 })}
          >
            {주기표.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex-1 flex items-center gap-2 bg-bg-elevated border border-border rounded-xl px-3">
            <span className="text-sm text-text-muted">{통화기호[값.currency]}</span>
            <input
              type="number" min={0} inputMode="numeric"
              aria-label="추가 납입 금액"
              placeholder="금액 입력"
              disabled={값.contribution_period === "none"}
              className="flex-1 bg-transparent py-2 text-sm text-text-primary focus:outline-none disabled:text-text-dim"
              value={값.contribution_amount}
              onChange={(e) => 바꾸기({ ...값, contribution_amount: e.target.value === "" ? "" : Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      {/* ── 리밸런싱 ── 주기와 날짜를 나란히 ── */}
      <div className="flex flex-col gap-3">
        <칸제목>리밸런싱</칸제목>
        <div className="grid grid-cols-2 gap-3">
          <고르기 이름="리밸런싱 주기" 값={값.rebalance_period}
                  바꾸기={(v) => 바꾸기({ ...값, rebalance_period: v as 주기 })}
                  것들={주기표} />
          {/* 달의 며칠에 할까. 월급날에 맞춰 넣는 사람이 많다.
              주기가 '없음' 이면 적립에만 쓰이므로 그때도 열어 둔다 */}
          <고르기 이름="리밸런싱 날짜" 값={String(값.rebalance_day)}
                  바꾸기={(v) => 바꾸기({ ...값, rebalance_day: Number(v) })}
                  것들={날짜들.map((d) => ({ value: String(d), label: `${d}일` }))} />
        </div>
        <p className="text-2xs text-text-dim break-keep">
          고른 날이 휴장이면 그 뒤 첫 거래일에 해요. 날짜를 딱 맞춰 찾으면
          그 달이 통째로 빠져요.
        </p>
      </div>

      {/* ── 데이터 기준 · 벤치마크 ── */}
      <div className="flex flex-col gap-3">
        <칸제목>재는 방법</칸제목>
        <div className="grid grid-cols-2 gap-3">
          <고르기 이름="데이터 기준" 값={값.data_interval}
                  바꾸기={(v) => 바꾸기({ ...값, data_interval: v as 데이터기준 })}
                  것들={데이터기준표} />
          <고르기 이름="벤치 마크" 값={값.benchmark}
                  바꾸기={(v) => 바꾸기({ ...값, benchmark: v as 벤치마크키 })}
                  것들={벤치마크표} />
        </div>
        {값.data_interval === "monthly" && (
          <p className="text-2xs text-text-dim break-keep">
            월 데이터는 가볍지만 <b>최대 낙폭이 실제보다 작게</b> 나와요 —
            달 안에서 떨어졌다 돌아온 것은 안 보여요.
          </p>
        )}
      </div>

      {/* ── 거래비용 · 배분 기준 ── */}
      <div className="flex flex-col gap-3">
        <칸제목>거래비용 · 배분</칸제목>
        <div className="grid grid-cols-2 gap-3">
          {/* 증권사마다 수수료가 제각각이라 목록으로는 다 못 담는다.
              목록에만 두면 자기 수수료가 없는 사람은 비슷한 값을 고르게
              되고, 그건 틀린 값으로 계산하는 것이다 — 직접 친다. */}
          <퍼센트칸 id="bt-cost" 이름="거래비용" 값={값.cost_rate}
                    바꾸기={(v) => 바꾸기({ ...값, cost_rate: v })} />
          <고르기 이름="배분 기준" 값={값.equal_weight ? "equal" : "custom"}
                  바꾸기={(v) => 바꾸기({ ...값, equal_weight: v === "equal" })}
                  것들={[{ value: "custom", label: "직접 지정" },
                          { value: "equal", label: "동일 비중" }]} />
        </div>

        <div className="flex gap-2 flex-wrap">
          {비용표.map((c) => (
            <고른칩 key={c} 고름={값.cost_rate === c}
                    ariaLabel={c === 0 ? "거래비용 반영 안 함" : `거래비용 ${c}%`}
                    최소너비="4rem" className="flex-1"
                    onClick={() => 바꾸기({ ...값, cost_rate: c })}
            >{c === 0 ? "반영 안 함" : `${c}%`}</고른칩>
          ))}
        </div>

        {/* ── 현금 이자 · 무위험수익률 ──
            둘 다 **말없이 0 으로 가정하던 것**이다.
            · 현금 이자 0 은 현금 몫이 30년 내내 안 불어난다는 뜻이라,
              현금을 담을수록 실제보다 나쁘게 나왔다.
            · 무위험 0 은 금리 5% 인 해에 연 5% 를 번 전략의 초과수익이
              0 인데도 샤프가 0.5 로 나온다는 뜻이다.
            기본값은 그대로 0 이지만, 고를 수 있게 하고 결과에 무엇을
            가정했는지 적는다. */}
        <div className="grid grid-cols-2 gap-3">
          <퍼센트칸 id="bt-cash" 이름="현금 이자" 값={값.cash_rate} 최대={20}
                    설명="예금·MMF 에 두면 받는 연 이율"
                    바꾸기={(v) => 바꾸기({ ...값, cash_rate: v })} />
          <퍼센트칸 id="bt-rf" 이름="무위험수익률" 값={값.risk_free_rate} 최대={20}
                    설명="샤프를 잴 때 빼는 연 이율"
                    바꾸기={(v) => 바꾸기({ ...값, risk_free_rate: v })} />
        </div>
        {값.equal_weight && 값.assets.length > 1 && (
          <p className="text-2xs text-text-dim break-keep">
            위에 적은 비중을 무시하고 {값.assets.length}개로 똑같이 나눠요.
          </p>
        )}
      </div>

      {/* ── 확장 ETF 가격 ── */}
      <label className="flex items-start gap-2 text-sm text-text-secondary cursor-pointer">
        {/* 설명이 label 안에 같이 있어서 읽어 주는 이름이 통째로
            길어진다. 고르는 것이 무엇인지만 남기도록 따로 붙인다 */}
        <input
          type="checkbox" className="accent-accent-blue w-4 h-4 mt-0.5 flex-shrink-0"
          aria-label="확장된 ETF 가격 사용"
          checked={값.extended}
          onChange={(e) => 바꾸기({ ...값, extended: e.target.checked })}
        />
        <span className="flex flex-col gap-0.5">
          확장된 ETF 가격 사용
          {/* 공짜가 아니다 — 지수에는 배당도 운용보수도 없다.
              켜기 전에 알고 켜야 한다 */}
          <span className="text-2xs text-text-dim break-keep">
            ETF가 생기기 전 구간을 그 ETF가 따라가는 지수로 이어요.
            SPY를 1980년까지 볼 수 있지만, 이은 구간은 <b>배당과 운용보수가
            빠진 지수</b>예요.
          </span>
        </span>
      </label>

      {/* ── 토탈 리턴 ── */}
      <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
        <input
          type="checkbox" className="accent-accent-yellow w-4 h-4"
          checked={값.total_return}
          onChange={(e) => 바꾸기({ ...값, total_return: e.target.checked })}
        />
        토탈 리턴(배당 포함) 반영
      </label>

      {/* 못 돌리는 이유를 **말로** 적는다. 버튼만 회색이면 무엇이
          모자란지 모른 채 화면을 뒤지게 된다 */}
      {못하는이유 && (
        <p className="text-xs text-text-dim -mt-2">{못하는이유}</p>
      )}

      <div className="flex gap-3">
        {/* 로그인 전에도 **버튼은 보여 준다.**
            아예 안 그리면 '저장이 어디 있지' 가 되고, 사용자는 기능이
            고장 난 것으로 읽는다. 눌러 보면 왜 안 되는지 알 수 있어야
            한다(아래 안내가 뜬다). */}
        <Button variant="secondary" className="flex-1 py-3"
                onClick={저장하기 ?? (() => set로그인안내(true))}
                disabled={!!못하는이유 || 저장중}>
          {저장중 ? "저장 중…" : "저장"}
        </Button>
        <Button className="flex-1 py-3" onClick={돌리기} disabled={!!못하는이유 || 도는중}>
          {도는중 ? "계산 중…" : "결과 확인"}
        </Button>
      </div>

      {로그인안내 && !저장하기 && (
        <p className="text-xs text-accent-yellow/90 -mt-2 break-keep">
          실험을 저장하려면 로그인이 필요해요. 결과 확인은 로그인 없이도 돼요.
        </p>
      )}

      {/* 저장했다는 말을 **반드시** 한다.
          목록을 이 화면에서 없앴으므로, 이 한 줄이 없으면 저장이 됐는지
          알 방법이 아예 없다 — 버튼만 눌리고 화면은 그대로다.
          어디로 갔는지도 같이 적어야 찾으러 갈 수 있다. */}
      {저장됨 && (
        <p className="text-xs text-accent-green -mt-2 break-keep flex items-center gap-1.5">
          <Check size={14} className="flex-shrink-0" />
          저장했어요. ‘전략 저장소’ 탭에서 다시 열 수 있어요.
        </p>
      )}
    </Card>
  );
}
