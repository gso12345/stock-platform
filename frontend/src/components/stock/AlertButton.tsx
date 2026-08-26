/**
 * 가격 알림 버튼 — "8만원 되면 알려줘".
 *
 * 종목 상세 헤더의 종 아이콘. 누르면 이 종목에 걸어 둔 알림이 펼쳐지고,
 * 그 자리에서 하나 더 걸 수 있다.
 *
 * 알림 자체는 서버가 30초마다 확인해 기존 알림함(종)에 넣는다. 그래서
 * 이 화면은 '거는 곳'일 뿐이고, 받는 곳은 이미 있던 종을 그대로 쓴다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, Trash2, X } from "lucide-react";
import { alertsApi, type 가격알림 } from "@/api/stocks";
import { 사람말로 } from "@/api/queryError";

export default function AlertButton({
  market, symbol, name, price, isLoggedIn,
}: {
  market: string;
  symbol: string;
  name?: string | null;
  /** 지금 시세. 목표가 입력칸의 첫 값으로 쓴다 */
  price?: number | null;
  isLoggedIn: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [열림, set열림] = useState(false);
  const [방향, set방향] = useState<"above" | "below">("above");
  const [목표, set목표] = useState("");
  const [말, set말] = useState("");
  const 칸 = useRef<HTMLDivElement>(null);

  const 원화 = market === "KR";
  const 돈 = (v: number) =>
    원화 ? `${Math.round(v).toLocaleString("ko-KR")}원` : `$${v.toFixed(2)}`;

  /* 로그인 안 한 사람에게는 아예 조회하지 않는다. 401 이 계속 나가면
     화면 오류 기록만 쌓이고 얻는 것이 없다. */
  const { data, isError, error } = useQuery({
    queryKey: ["price-alerts", symbol],
    queryFn: () => alertsApi.getAlerts(symbol),
    enabled: isLoggedIn && 열림,
    staleTime: 30_000,
  });
  const 목록 = useMemo<가격알림[]>(() => data?.items ?? [], [data]);
  const 켜진수 = 목록.filter((a) => a.is_active).length;

  /* 바깥을 누르면 닫는다 — 헤더의 폴더 메뉴와 같은 동작 */
  useEffect(() => {
    if (!열림) return;
    const 닫기 = (e: MouseEvent) => {
      if (칸.current && !칸.current.contains(e.target as Node)) set열림(false);
    };
    document.addEventListener("mousedown", 닫기);
    return () => document.removeEventListener("mousedown", 닫기);
  }, [열림]);

  /* 열 때마다 지금 시세를 입력칸에 채운다.
     빈칸에서 시작하면 사용자가 종목 가격을 외워서 쳐야 한다. */
  useEffect(() => {
    if (!열림) { set말(""); return; }
    if (price != null) set목표(원화 ? String(Math.round(price)) : price.toFixed(2));
  }, [열림, price, 원화]);

  /* ── 왜 낙관적으로 고치나 ──
   *
   * 예전에는 무엇을 하든 왕복이 두 번이었다 — 서버에 바꿔 달라고 한 뒤,
   * 목록을 통째로 다시 받았다(invalidateQueries). 무료 플랜 서버는
   * 한 번 다녀오는 데만 수백 ms 에서 몇 초가 걸리므로, 스위치 한 번
   * 누르고 두 번을 기다리는 셈이었다. 지우기도 마찬가지였다.
   *
   * 그래서 두 가지를 바꾼다.
   *   1) 누른 즉시 화면을 고친다(onMutate). 실패하면 되돌린다.
   *   2) 서버가 준 결과를 캐시에 직접 넣는다. 목록을 다시 안 받는다.
   *
   * 알림 스위치는 '눌렀는데 반응이 없다' 가 제일 나쁜 종류의 지연이다 —
   * 사람은 안 눌렸다고 생각하고 한 번 더 누른다.
   */
  const 열쇠 = ["price-alerts", symbol] as const;
  const 지금목록 = () => qc.getQueryData<{ items: 가격알림[]; limit: number }>(열쇠);

  /** 캐시를 지금 자리에서 고친다. 되돌릴 수 있게 이전 값을 돌려준다 */
  const 미리고치기 = async (바꾸기: (items: 가격알림[]) => 가격알림[]) => {
    await qc.cancelQueries({ queryKey: 열쇠 });
    const 이전 = 지금목록();
    if (이전) qc.setQueryData(열쇠, { ...이전, items: 바꾸기(이전.items) });
    return { 이전 };
  };
  const 되돌리기 = (ctx?: { 이전?: { items: 가격알림[]; limit: number } }) => {
    if (ctx?.이전) qc.setQueryData(열쇠, ctx.이전);
  };

  const 걸기 = useMutation({
    mutationFn: () => alertsApi.createAlert({
      symbol, market, name: name || symbol, direction: 방향, target: Number(목표),
    }),
    onMutate: async () => {
      /* 서버가 줄 id 를 아직 모른다. 임시 번호로 먼저 그려 두고,
         응답이 오면 진짜 것으로 바꿔 넣는다. */
      const 임시 = { id: -Date.now(), symbol, market, name: name || symbol,
                     direction: 방향, target: Number(목표), made_at_price: price ?? null,
                     is_active: true, fired_at: null, fired_price: null } as 가격알림;
      set말("알림을 걸었어요");
      return 미리고치기((items) => [임시, ...items.filter(
        (a) => !(a.direction === 방향 && a.target === Number(목표)))]);
    },
    onSuccess: (새것) => {
      const 이전 = 지금목록();
      if (이전 && 새것?.id) {
        // 임시로 그려 둔 줄(음수 id)을 서버가 준 진짜 줄로 바꾼다
        qc.setQueryData(열쇠, { ...이전, items: [새것, ...이전.items.filter((a) => a.id > 0 && a.id !== 새것.id)] });
      }
    },
    onError: (e, _v, ctx) => { 되돌리기(ctx); set말(사람말로(e)); },
  });

  const 켜고끄기 = useMutation({
    mutationFn: (id: number) => alertsApi.toggleAlert(id),
    onMutate: (id) => 미리고치기((items) => items.map(
      (a) => a.id === id ? { ...a, is_active: !a.is_active } : a)),
    onSuccess: (바뀐것) => {
      const 이전 = 지금목록();
      if (이전 && 바뀐것?.id) {
        qc.setQueryData(열쇠, { ...이전, items: 이전.items.map((a) => a.id === 바뀐것.id ? 바뀐것 : a) });
      }
    },
    onError: (e, _v, ctx) => { 되돌리기(ctx); set말(사람말로(e)); },
  });

  const 지우기 = useMutation({
    mutationFn: (id: number) => alertsApi.deleteAlert(id),
    onMutate: (id) => { set말("지웠어요"); return 미리고치기((items) => items.filter((a) => a.id !== id)); },
    onError: (e, _v, ctx) => { 되돌리기(ctx); set말(사람말로(e)); },
  });

  const 숫자목표 = Number(목표);
  const 걸수있나 = Number.isFinite(숫자목표) && 숫자목표 > 0 && !걸기.isPending;

  return (
    <div className="relative" ref={칸}>
      <button
        aria-label={켜진수 ? `가격 알림 ${켜진수}개` : "가격 알림"}
        aria-pressed={켜진수 > 0}
        title="가격 알림"
        onClick={() => { if (!isLoggedIn) { navigate("/login"); return; } set열림((v) => !v); }}
        className={`relative flex items-center justify-center w-11 h-11 rounded-xl border transition-all ${
          켜진수 > 0
            ? "border-accent-orange/50 bg-accent-orange/10 text-accent-orange"
            : "border-border text-text-muted hover:border-accent-orange/60 hover:text-accent-orange"
        }`}
      >
        {켜진수 > 0 ? <BellRing size={16}/> : <Bell size={16}/>}
        {켜진수 > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-accent-orange text-bg-base text-2xs font-bold flex items-center justify-center">
            {켜진수}
          </span>
        )}
      </button>

      {열림 && (
        <div className="absolute top-full mt-1 right-0 z-20 w-72 rounded-xl border border-border bg-bg-card shadow-float overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-sm font-semibold text-text-primary">가격 알림</span>
            <button aria-label="닫기" onClick={() => set열림(false)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:bg-bg-elevated">
              <X size={14}/>
            </button>
          </div>

          {/* 새로 걸기 */}
          <div className="px-3 py-2.5 flex flex-col gap-2 border-b border-border">
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(["above", "below"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => set방향(v)}
                  aria-pressed={방향 === v}
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                    방향 === v ? "bg-accent-orange/15 text-accent-orange" : "text-text-muted hover:bg-bg-elevated"
                  }`}
                >
                  {v === "above" ? "이 값 이상" : "이 값 이하"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                aria-label="목표 가격"
                value={목표}
                onChange={(e) => set목표(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && 걸수있나) 걸기.mutate(); }}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary focus:outline-none focus:border-accent-orange/60"
              />
              <span className="text-xs text-text-muted shrink-0">{원화 ? "원" : "달러"}</span>
              <button
                onClick={() => 걸기.mutate()}
                disabled={!걸수있나}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-accent-orange/15 border border-accent-orange/40 text-accent-orange text-xs font-semibold disabled:opacity-40 hover:bg-accent-orange/25 transition-colors"
              >
                {걸기.isPending ? "거는 중" : "걸기"}
              </button>
            </div>
            {price != null && (
              <p className="text-2xs text-text-dim">지금 {돈(price)}</p>
            )}
          </div>

          {/* 걸어 둔 것 */}
          <div className="max-h-56 overflow-y-auto">
            {isError ? (
              <p className="px-3 py-3 text-xs text-text-muted">{사람말로(error)}</p>
            ) : 목록.length === 0 ? (
              <p className="px-3 py-3 text-xs text-text-dim">걸어 둔 알림이 없어요</p>
            ) : 목록.map((a) => (
              <div key={a.id} className="flex items-center gap-2 px-3 py-2 border-b border-border/50 last:border-b-0">
                {/* 알림 설정 화면의 스위치와 같은 모양·같은 역할 이름을 쓴다.
                    같은 뜻의 것이 화면마다 다르게 생기지 않도록. */}
                <button
                  role="switch"
                  aria-checked={a.is_active}
                  onClick={() => 켜고끄기.mutate(a.id)}
                  aria-label={`${돈(a.target)} ${a.direction === "above" ? "이상" : "이하"} 알림`}
                  className={`relative w-10 h-6 shrink-0 rounded-full transition-colors ${
                    a.is_active ? "bg-accent-orange" : "bg-bg-elevated border border-border"
                  }`}
                >
                  <span className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow transition-all ${
                    a.is_active ? "left-[1.25rem]" : "left-1"
                  }`}/>
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium truncate ${a.is_active ? "text-text-primary" : "text-text-dim"}`}>
                    {돈(a.target)} {a.direction === "above" ? "이상" : "이하"}
                  </p>
                  {a.fired_at && (
                    /* 울린 알림은 스스로 꺼진다. 왜 꺼져 있는지 여기서 말해 준다 */
                    <p className="text-2xs text-accent-orange">
                      울림 · {a.fired_price != null ? 돈(a.fired_price) : "-"}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => 지우기.mutate(a.id)}
                  aria-label="알림 지우기"
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-dim hover:text-accent-red hover:bg-bg-elevated transition-colors"
                >
                  <Trash2 size={13}/>
                </button>
              </div>
            ))}
          </div>

          {말 && <p className="px-3 py-2 text-2xs text-text-muted border-t border-border">{말}</p>}
        </div>
      )}
    </div>
  );
}
