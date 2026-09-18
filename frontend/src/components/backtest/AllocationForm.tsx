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
import { useStockSearch } from "@/hooks/useStockSearch";
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

/** 자산 고르기 — 검색해서 더한다 */
function 자산고르기({ onPick, onClose }: {
  onPick: (a: 배분자산) => void; onClose: () => void;
}) {
  const { query, setQuery, results, searching } = useStockSearch();
  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl border border-accent-blue/40 bg-bg-elevated">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
          placeholder="종목명 또는 코드 (예: AAPL, 005930, 삼성)"
          aria-label="자산 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={onClose} aria-label="검색 닫기" className="p-2 text-text-dim hover:text-text-primary">
          <X size={16} />
        </button>
      </div>
      {/* 현금은 검색으로 안 나온다. 자산배분에서 '현금 20%' 는 아주 흔한
          구성이라 버튼으로 따로 둔다 — 없으면 그 조합을 아예 못 만든다 */}
      <button
        onClick={() => onPick({ symbol: "현금", market: "KR", name: "현금", weight: 0 })}
        className="self-start px-2.5 py-1 rounded-full text-2xs font-medium border border-border text-text-muted hover:text-text-primary"
      >
        + 현금
      </button>
      {searching && <p className="text-xs text-text-dim px-1">찾는 중…</p>}
      {!searching && query.trim() && results.length === 0 && (
        <p className="text-xs text-text-dim px-1">찾는 종목이 없어요</p>
      )}
      {results.length > 0 && (
        <ul className="flex flex-col max-h-56 overflow-y-auto">
          {results.slice(0, 20).map((r: any) => (
            <li key={`${r.market}:${r.symbol}`}>
              <button
                className="w-full text-left px-2 py-2 rounded-lg hover:bg-bg-card flex items-center gap-2"
                onClick={() => onPick({ symbol: r.symbol, market: r.market, name: r.name, weight: 0 })}
              >
                <span className="text-sm text-text-primary truncate flex-1">{r.name}</span>
                <span className="text-2xs text-text-dim flex-shrink-0">{r.symbol} · {r.market}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
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
            onClose={() => set검색열림(false)}
            onPick={(a) => {
              if (값.assets.some((x) => x.symbol === a.symbol && x.market === a.market)) {
                set검색열림(false);
                return;                       // 같은 자산을 두 번 담지 않는다
              }
              const 다음 = [...값.assets, a];
              /* 새로 담을 때마다 비중을 똑같이 나눠 준다. 0% 로 들어가면
                 '담았는데 결과에 아무 영향이 없는' 상태가 되고, 그건
                 고장으로 읽힌다 */
              const 고른비중 = Math.round(1000 / 다음.length) / 10;
              바꾸기({ ...값, assets: 다음.map((x) => ({ ...x, weight: 고른비중 })) });
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
