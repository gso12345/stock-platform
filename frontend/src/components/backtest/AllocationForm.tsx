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
import type { 배분자산, 주기 } from "@/api/stocks";

/** 기간 슬라이더가 고를 수 있는 햇수. 30년이면 어지간한 자산은 다 덮는다 */
export const 최소년 = 1;
export const 최대년 = 30;

export const 주기표: { value: 주기; label: string }[] = [
  { value: "none", label: "없음" },
  { value: "monthly", label: "매월" },
  { value: "quarterly", label: "매분기" },
  { value: "yearly", label: "매년" },
];

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
}

export function 첫설정(오늘 = new Date()): 설정 {
  const { start_date, end_date } = 기간에서날짜(8, 오늘);
  return {
    years: 8, 직접입력: false, start_date, end_date,
    currency: "KRW", initial_amount: "",
    assets: [],
    contribution_period: "monthly", contribution_amount: "",
    rebalance_period: "none", total_return: true,
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
          <div className="flex-1 flex items-center gap-2 bg-bg-elevated border border-border rounded-xl px-3">
            <span className="text-sm text-text-muted">{통화기호[값.currency]}</span>
            <input
              type="number" min={0} inputMode="numeric"
              aria-label="테스트 금액"
              placeholder="금액 입력"
              className="flex-1 bg-transparent py-2 text-sm text-text-primary focus:outline-none"
              value={값.initial_amount}
              onChange={(e) => 바꾸기({ ...값, initial_amount: e.target.value === "" ? "" : Number(e.target.value) })}
            />
          </div>
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

      {/* ── 리밸런싱 주기 ── */}
      <div className="flex flex-col gap-3">
        <칸제목>리밸런싱 주기</칸제목>
        <select
          aria-label="리밸런싱 주기"
          className="w-full bg-bg-elevated border border-border rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none"
          value={값.rebalance_period}
          onChange={(e) => 바꾸기({ ...값, rebalance_period: e.target.value as 주기 })}
        >
          {주기표.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

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
