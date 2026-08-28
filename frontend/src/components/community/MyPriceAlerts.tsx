/**
 * 내가 건 시세 알림 — 한 자리에 모아서 본다.
 *
 * 지금까지 이걸 볼 수 있는 곳은 **종목 상세의 종 단추 안**뿐이었다.
 * 그래서 "내가 어느 종목에 알림을 걸어 뒀지?" 를 알려면 종목을 하나씩
 * 열어 보는 수밖에 없었다 — 애초에 기억이 안 나서 묻는 질문인데,
 * 답을 보려면 그 종목을 이미 알고 있어야 하는 셈이다.
 *
 * 알림 설정 옆이 그걸 놓을 자리다. '어떤 알림을 받을까' 바로 다음에
 * 오는 질문이 '지금 무엇을 기다리고 있나' 다.
 *
 * ── 고치는 것은 여기서 안 한다 ──
 *
 * 목표가를 바꾸는 자리는 종목 상세다(거기엔 지금 시세가 있어서
 * '79,000 이 지금보다 얼마나 위인가' 를 보면서 고칠 수 있다). 여기서는
 * 켜고 끄기와 지우기만 한다 — 시세 없이 목표가만 고치는 것은 눈 감고
 * 숫자를 치는 일이다.
 *
 * 켜고 끄기·지우기는 **누른 즉시** 화면을 고친다. 커뮤니티 댓글과 같은
 * 방식이다. 서버를 기다리면 왕복 둘(고치기 + 목록 다시 받기) 동안
 * 아무 일도 안 일어난 것처럼 보여서 한 번 더 누르게 된다.
 */
import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BellRing, ChevronDown, ChevronRight, X } from "lucide-react";
import { alertsApi, type 가격알림 } from "@/api/stocks";

/** 전체 알림 목록의 열쇠. 종목 상세의 종(그 종목 것만)과 다른 자리다 */
export const 내알림열쇠 = ["alerts", "전체"] as const;

interface 알림응답 { items: 가격알림[]; limit: number }

/** 종목별로 묶는다 — 한 종목에 여러 알림(위·아래)을 걸 수 있다 */
export function 종목별로(items: 가격알림[]): {
  symbol: string; market: string; name: string; 알림들: 가격알림[]; 켜진수: number;
}[] {
  const 통 = new Map<string, { symbol: string; market: string; name: string; 알림들: 가격알림[] }>();
  for (const a of items) {
    const 키 = `${a.market}:${a.symbol}`;
    const 것 = 통.get(키) ?? { symbol: a.symbol, market: a.market, name: a.name || a.symbol, 알림들: [] };
    것.알림들.push(a);
    통.set(키, 것);
  }
  return [...통.values()]
    .map((g) => ({
      ...g,
      /* 한 종목 안은 목표가 순 — 위로 걸린 것과 아래로 걸린 것이
         뒤섞여 있으면 무엇을 기다리는지 한 번에 안 읽힌다 */
      알림들: [...g.알림들].sort((a, b) => b.target - a.target),
      켜진수: g.알림들.filter((a) => a.is_active).length,
    }))
    /* 켜진 것이 있는 종목을 위로. 꺼 둔 알림은 지금 기다리는 것이
       아니라 '나중에 다시 켤 것' 이다 */
    .sort((a, b) => (b.켜진수 - a.켜진수) || a.name.localeCompare(b.name, "ko"));
}

/** "80,000원 위로" — 무엇을 기다리는지 한 줄로 */
export function 조건글(a: 가격알림): string {
  const 원화 = a.market === "KR";
  const 값 = 원화
    ? `${Math.round(a.target).toLocaleString("ko-KR")}원`
    : `$${a.target.toFixed(2)}`;
  return `${값} ${a.direction === "above" ? "위로" : "아래로"}`;
}

export default function MyPriceAlerts({ open, onToggle }: {
  open: boolean;
  onToggle: () => void;
}) {
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<알림응답>({
    queryKey: 내알림열쇠,
    queryFn: () => alertsApi.getAlerts(),
    /* 접혀 있어도 개수는 머리글에 적는다 — '3개 걸어 둠' 이 보여야
       펼쳐 볼 이유가 생긴다. 자주 바뀌는 값이 아니라 5분 담아 둔다 */
    staleTime: 300_000,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const 묶음 = useMemo(() => 종목별로(items), [items]);
  const 켜진수 = items.filter((a) => a.is_active).length;

  /** 캐시를 지금 자리에서 고친다. 되돌릴 수 있게 이전 값을 돌려준다 */
  const 미리고치기 = async (바꾸기: (items: 가격알림[]) => 가격알림[]) => {
    await qc.cancelQueries({ queryKey: 내알림열쇠 });
    const 이전 = qc.getQueryData<알림응답>(내알림열쇠);
    if (이전) qc.setQueryData(내알림열쇠, { ...이전, items: 바꾸기(이전.items) });
    return { 이전 };
  };
  const 되돌리기 = (ctx?: { 이전?: 알림응답 }) => {
    if (ctx?.이전) qc.setQueryData(내알림열쇠, ctx.이전);
  };
  /* 종목 상세의 종도 같은 알림을 그린다. 여기서 지운 것이 거기서는
     그대로 남아 있으면 두 화면이 서로 다른 말을 한다 */
  const 종도갱신 = (symbol: string) =>
    qc.invalidateQueries({ queryKey: ["alerts", symbol] });

  const 켜고끄기 = useMutation({
    mutationFn: (a: 가격알림) => alertsApi.toggleAlert(a.id),
    onMutate: (a) => 미리고치기((items) => items.map(
      (x) => x.id === a.id ? { ...x, is_active: !x.is_active } : x)),
    onError: (_e, _v, ctx) => 되돌리기(ctx),
    onSuccess: (_d, a) => 종도갱신(a.symbol),
  });

  const 지우기 = useMutation({
    mutationFn: (a: 가격알림) => alertsApi.deleteAlert(a.id),
    onMutate: (a) => 미리고치기((items) => items.filter((x) => x.id !== a.id)),
    onError: (_e, _v, ctx) => 되돌리기(ctx),
    onSuccess: (_d, a) => 종도갱신(a.symbol),
  });

  return (
    <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-bg-elevated transition-colors"
      >
        <BellRing size={14} className="text-accent-yellow" />
        <span className="text-xs font-semibold text-text-primary">내가 건 시세 알림</span>
        <span className="text-2xs text-text-dim">
          {isLoading ? ""
            : isError ? "불러오지 못함"
            : items.length === 0 ? "아직 없음"
            /* 꺼 둔 것을 따로 세는 이유 — '3개 걸어 뒀는데 왜 안 와요'
               의 답이 대개 '꺼 두셨어요' 다 */
            : 켜진수 === items.length ? `${묶음.length}개 종목 · ${items.length}개`
            : `${묶음.length}개 종목 · ${켜진수}개 켬 / ${items.length - 켜진수}개 끔`}
        </span>
        <div className="flex-1" />
        <ChevronDown size={14}
          className={`text-text-dim transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border">
          {isError ? (
            <div className="px-4 py-4 flex items-center gap-3">
              <p className="flex-1 text-2xs text-text-dim break-keep">알림 목록을 불러오지 못했습니다</p>
              <button
                onClick={() => refetch()}
                className="px-2.5 py-1.5 rounded-lg border border-border text-2xs text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all"
              >다시 시도</button>
            </div>
          ) : isLoading ? (
            <div className="flex flex-col gap-2 px-4 py-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-9 rounded-lg bg-bg-elevated animate-pulse" />
              ))}
            </div>
          ) : 묶음.length === 0 ? (
            <p className="px-4 py-4 text-center text-2xs text-text-dim break-keep">
              아직 건 알림이 없어요. 종목 화면의 종 단추로 "80,000원 넘으면 알려 줘" 를 걸 수 있어요.
            </p>
          ) : (
            <ul>
              {묶음.map((g) => (
                <li key={`${g.market}:${g.symbol}`} className="border-b border-border/50 last:border-b-0">
                  {/* 종목 이름을 누르면 그 종목으로 간다 — 목표가를
                      고치는 자리가 거기다(지금 시세가 옆에 있다) */}
                  <Link
                    to={`/stocks/${g.market}/${encodeURIComponent(g.symbol)}`}
                    className="flex items-center gap-2 px-4 pt-2.5 pb-1 hover:bg-bg-elevated transition-colors group"
                  >
                    <span className="text-xs font-medium text-text-primary truncate group-hover:text-accent-blue transition-colors">
                      {g.name}
                    </span>
                    <span className="text-2xs font-mono text-text-dim shrink-0">{g.symbol}</span>
                    <div className="flex-1" />
                    <ChevronRight size={13} className="text-text-dim shrink-0" />
                  </Link>

                  <ul className="px-4 pb-2 flex flex-col gap-1">
                    {g.알림들.map((a) => (
                      <li key={a.id} className="flex items-center gap-2">
                        {/* 켜고 끄기. 지우지 않고 잠깐 멈추는 자리가 없으면
                            '이번 분기만 안 볼래' 가 곧 삭제가 된다 */}
                        <button
                          role="switch"
                          aria-checked={a.is_active}
                          aria-label={`${g.name} ${조건글(a)} 알림`}
                          onClick={() => 켜고끄기.mutate(a)}
                          className={`relative w-8 h-[1.15rem] shrink-0 rounded-full transition-colors ${
                            a.is_active ? "bg-accent-yellow" : "bg-bg-elevated border border-border"
                          }`}
                        >
                          <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${
                            a.is_active ? "left-[1.05rem]" : "left-0.5"
                          }`} />
                        </button>
                        <span className={`text-2xs tabular-nums ${
                          a.is_active ? "text-text-secondary" : "text-text-dim line-through"
                        }`}>{조건글(a)}</span>
                        {/* 이미 울린 알림은 그렇다고 적는다. 안 적으면
                            '켜 뒀는데 왜 또 안 와요' 가 된다 */}
                        {a.fired_at && (
                          <span className="text-2xs px-1 py-px rounded bg-accent-green/15 text-accent-green shrink-0">
                            울림
                          </span>
                        )}
                        <div className="flex-1" />
                        <button
                          onClick={() => 지우기.mutate(a)}
                          aria-label={`${g.name} ${조건글(a)} 알림 지우기`}
                          className="p-1 rounded text-text-dim hover:text-accent-red hover:bg-accent-red/10 transition-colors shrink-0"
                        >
                          <X size={11} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
