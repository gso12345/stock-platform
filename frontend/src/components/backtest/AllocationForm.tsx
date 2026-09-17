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
import { useMemo, useState } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import { Card, Button } from "@/components/ui";
import { useStockSearch } from "@/hooks/useStockSearch";
import type { 배분자산, 주기, 데이터기준, 벤치마크키 } from "@/api/stocks";

/** 기간 슬라이더가 고를 수 있는 햇수.
 *
 *  확장 ETF 가격을 켜면 지수가 1927년까지 있어 훨씬 멀리 볼 수 있다.
 *  45년으로 두면 1981년까지밖에 못 가는데, S&P500 을 1980년부터 보는
 *  것은 흔한 요청이라 거기서 막히면 기능을 켜 놓고도 못 쓴다.
 *  50년이면 1976년까지 닿는다. */
export const 최소년 = 1;
export const 최대년 = 50;

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

/** 흔히 쓰는 수수료. 직접 칠 수도 있게 열어 둔다. */
export const 비용표 = [0, 0.015, 0.05, 0.1, 0.25, 0.5];

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

/** 금액을 한 번에 더하는 버튼 값. 통화마다 자릿수가 다르다 —
 *  원화에 +500 은 아무 쓸모가 없고, 달러에 +5,000,000 도 마찬가지다. */
export function 더하기값들(통화: "KRW" | "USD"): number[] {
  return 통화 === "USD"
    ? [500, 1_000, 5_000, 10_000, 50_000]
    : [500_000, 1_000_000, 5_000_000, 10_000_000, 50_000_000];
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
  직접입력: boolean;
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
}

export function 첫설정(오늘 = new Date()): 설정 {
  const { start_date, end_date } = 기간에서날짜(8, 오늘);
  return {
    years: 8, 직접입력: false, start_date, end_date,
    currency: "KRW", initial_amount: "",
    assets: [],
    contribution_period: "monthly", contribution_amount: "",
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
      <button onClick={onRemove} aria-label={`${자산.name || 자산.symbol} 빼기`}
              className="p-1.5 text-text-dim hover:text-accent-red flex-shrink-0">
        <X size={14} />
      </button>
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
  값, 바꾸기, 돌리기, 도는중, 목록열기, 저장하기,
}: {
  값: 설정;
  바꾸기: (다음: 설정) => void;
  돌리기: () => void;
  도는중: boolean;
  목록열기: () => void;
  저장하기?: () => void;
}) {
  const [검색열림, set검색열림] = useState(false);
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

      {/* ── 테스트 기간 ── */}
      <div className="flex flex-col gap-3">
        <칸제목
          오른쪽={
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox" className="accent-accent-blue w-4 h-4"
                checked={값.직접입력}
                onChange={(e) => 바꾸기({ ...값, 직접입력: e.target.checked })}
              />
              직접 입력
            </label>
          }
        >테스트 기간</칸제목>

        {값.직접입력 ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="bt-start" className="text-xs text-text-muted">시작일</label>
              <input id="bt-start" type="date"
                className="bg-bg-primary border border-border rounded-lg px-2 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
                value={값.start_date}
                onChange={(e) => 바꾸기({ ...값, start_date: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="bt-end" className="text-xs text-text-muted">종료일</label>
              <input id="bt-end" type="date"
                className="bg-bg-primary border border-border rounded-lg px-2 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
                value={값.end_date}
                onChange={(e) => 바꾸기({ ...값, end_date: e.target.value })} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <input
              type="range" min={최소년} max={최대년} step={1}
              aria-label="테스트 기간 (년)"
              className="w-full accent-accent-yellow"
              value={값.years}
              onChange={(e) => 기간바꾸기(Number(e.target.value))}
            />
            <span className="text-sm font-semibold text-text-primary">{값.years}년</span>
          </div>
        )}
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
        <div className="flex gap-2 flex-wrap">
          {더하기값들(값.currency).map((v) => (
            <button
              key={v}
              aria-label={`${v.toLocaleString("ko-KR")} 더하기`}
              className="flex-1 min-w-[4.5rem] py-2 rounded-lg bg-bg-elevated border border-border text-xs font-medium text-text-secondary hover:text-text-primary hover:border-accent-blue/50"
              onClick={() => 바꾸기({
                ...값, initial_amount: (Number(값.initial_amount) || 0) + v,
              })}
            >+{v.toLocaleString("ko-KR")}</button>
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
          >비중을 똑같이 나누기</button>
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
          <고르기 이름="거래비용" 값={String(값.cost_rate)}
                  바꾸기={(v) => 바꾸기({ ...값, cost_rate: Number(v) })}
                  것들={비용표.map((c) => ({
                    value: String(c), label: c === 0 ? "반영 안 함" : `${c} %`,
                  }))} />
          <고르기 이름="배분 기준" 값={값.equal_weight ? "equal" : "custom"}
                  바꾸기={(v) => 바꾸기({ ...값, equal_weight: v === "equal" })}
                  것들={[{ value: "custom", label: "직접 지정" },
                          { value: "equal", label: "동일 비중" }]} />
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
        <Button variant="secondary" className="flex-1 py-3" onClick={목록열기}>
          내 실험 목록
        </Button>
        {저장하기 && (
          <Button variant="secondary" className="py-3 px-4" onClick={저장하기}
                  disabled={!!못하는이유}>저장</Button>
        )}
        <Button className="flex-1 py-3" onClick={돌리기} disabled={!!못하는이유 || 도는중}>
          {도는중 ? "계산 중…" : "결과 확인"}
        </Button>
      </div>
    </Card>
  );
}

/** 저장해 둔 실험 목록 */
export function 실험목록({ 것들, 불러오기, 지우기, 닫기 }: {
  것들: { id: number; name: string; assets: 배분자산[]; created_at: string }[];
  불러오기: (id: number) => void;
  지우기: (id: number) => void;
  닫기: () => void;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-text-primary">내 실험 목록</span>
        <button onClick={닫기} aria-label="목록 닫기" className="p-1 text-text-dim hover:text-text-primary">
          <X size={16} />
        </button>
      </div>
      {것들.length === 0 ? (
        <p className="text-sm text-text-dim py-6 text-center">
          저장한 실험이 아직 없어요. 설정을 맞춘 뒤 ‘저장’ 을 눌러 보세요.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {것들.map((x) => (
            <li key={x.id} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-bg-elevated">
              <button className="flex flex-col min-w-0 flex-1 text-left" onClick={() => 불러오기(x.id)}>
                <span className="text-sm font-medium text-text-primary truncate">{x.name}</span>
                <span className="text-2xs text-text-dim truncate">
                  {x.assets.map((a) => a.name || a.symbol).join(" · ")}
                </span>
              </button>
              <button onClick={() => 지우기(x.id)} aria-label={`${x.name} 지우기`}
                      className="p-1.5 text-text-dim hover:text-accent-red flex-shrink-0">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
