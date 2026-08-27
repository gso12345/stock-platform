/**
 * 가격 알림 버튼 — "8만원 되면 알려줘".
 *
 * 종목 상세 헤더의 종 아이콘. 누르면 이 종목에 걸어 둔 알림이 펼쳐지고,
 * 그 자리에서 하나 더 걸거나 이미 건 것을 고칠 수 있다.
 *
 * 알림 자체는 서버가 30초마다 확인해 기존 알림함(종)에 넣는다. 그래서
 * 이 화면은 '거는 곳'일 뿐이고, 받는 곳은 이미 있던 종을 그대로 쓴다.
 *
 * ── 왜 종목별로 안 받고 통째로 받나 ──
 *
 * 예전에는 `?symbol=005930` 으로 그 종목 것만, 그것도 **패널을 열었을
 * 때만** 받았다. 두 가지가 어긋난다 —
 *
 *   1) 종에 붙는 개수 배지가 영영 안 뜬다. 패널을 열기 전에는 목록이
 *      비어 있으니 0 이고, 그래서 '이 종목에 알림을 걸어 뒀나' 를
 *      알려면 반드시 눌러 봐야 했다. 배지가 있는 뜻이 사라진다.
 *   2) 종목을 옮길 때마다 요청이 새로 하나씩 붙는다.
 *
 * 한 사람이 걸 수 있는 알림은 30개까지다(서버 상한). 통째로 받아서
 * 화면에서 고르면 응답 하나로 끝나고, 종목을 옮겨도 다시 안 받는다 —
 * 요청 수가 줄면서 배지도 제대로 뜬다.
 *
 * ── 왜 낙관적으로 고치나 ──
 *
 * 무엇을 하든 왕복이 두 번이었다 — 서버에 바꿔 달라고 한 뒤 목록을
 * 통째로 다시 받았다(invalidateQueries). 스위치 한 번 누르고 두 번을
 * 기다리는 셈이다. 알림 스위치는 '눌렀는데 반응이 없다' 가 제일 나쁜
 * 종류의 지연이다 — 사람은 안 눌렸다고 생각하고 한 번 더 누른다.
 *
 * 그래서 누른 즉시 화면을 고치고(onMutate), 실패하면 되돌린다. 서버가
 * 준 결과는 캐시에 직접 넣는다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, Check, Pencil, Trash2, X } from "lucide-react";
import { alertsApi, type 가격알림 } from "@/api/stocks";
import { 사람말로 } from "@/api/queryError";

/** 알림 목록은 종목마다 따로 안 받는다 — 이 열쇠 하나를 온 화면이 같이 쓴다 */
export const 알림열쇠 = ["price-alerts", "all"] as const;

interface 알림응답 { items: 가격알림[]; limit: number }

/**
 * 지금 시세에서 몇 % 떨어진 목표가.
 *
 * 목표가를 손으로 다 쳐야 했다. 79,300원짜리 종목에 '5% 오르면' 을
 * 걸려면 83,265 를 암산해서 다섯 자리를 치는 셈이다. 실제로는 그냥
 * 8만원 같은 어림수를 치게 되는데, 그건 원래 걸고 싶던 조건이 아니다.
 *
 * 원화는 정수로 자른다 — 83,265.15원 짜리 목표가는 뜻이 없다.
 */
export function 목표가(시세: number, 퍼센트: number, 원화: boolean): number {
  const v = 시세 * (1 + 퍼센트 / 100);
  return 원화 ? Math.round(v) : Math.round(v * 100) / 100;
}

/** 빠른 목표 — 지금 시세 대비. 위로 셋, 아래로 셋 */
export const 빠른퍼센트 = [-10, -5, -3, 3, 5, 10] as const;

export default function AlertButton({
  market, symbol, name, price, isLoggedIn,
}: {
  market: string;
  symbol: string;
  name?: string | null;
  /** 지금 시세. 목표가 입력칸의 첫 값이자 빠른 목표의 기준 */
  price?: number | null;
  isLoggedIn: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [열림, set열림] = useState(false);
  const [방향, set방향] = useState<"above" | "below">("above");
  const [목표, set목표] = useState("");
  const [말, set말] = useState("");
  /** 지금 고치고 있는 알림 id. null 이면 아무것도 안 고치는 중 */
  const [고치는것, set고치는것] = useState<number | null>(null);
  const [고친값, set고친값] = useState("");
  const 칸 = useRef<HTMLDivElement>(null);

  const 원화 = market === "KR";
  const 돈 = (v: number) =>
    원화 ? `${Math.round(v).toLocaleString("ko-KR")}원` : `$${v.toFixed(2)}`;

  /* 로그인 안 한 사람에게는 아예 조회하지 않는다. 401 이 계속 나가면
     화면 오류 기록만 쌓이고 얻는 것이 없다.

     로그인했으면 패널을 안 열어도 받는다 — 종에 붙는 배지가 그래야
     뜬다. 온 화면이 같은 열쇠를 쓰므로 종목을 옮겨도 다시 안 받는다. */
  const { data, isError, error } = useQuery<알림응답>({
    queryKey: 알림열쇠,
    queryFn: () => alertsApi.getAlerts(),
    enabled: isLoggedIn,
    staleTime: 60_000,
  });

  /** 이 종목 것만 — 목록은 통째로 받고 고르는 것은 화면에서 한다 */
  const 목록 = useMemo<가격알림[]>(
    () => (data?.items ?? []).filter((a) => a.symbol === symbol),
    [data, symbol],
  );
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
    if (!열림) { set말(""); set고치는것(null); return; }
    if (price != null) set목표(원화 ? String(Math.round(price)) : price.toFixed(2));
  }, [열림, price, 원화]);

  const 지금목록 = () => qc.getQueryData<알림응답>(알림열쇠);

  /** 캐시를 지금 자리에서 고친다. 되돌릴 수 있게 이전 값을 돌려준다 */
  const 미리고치기 = async (바꾸기: (items: 가격알림[]) => 가격알림[]) => {
    await qc.cancelQueries({ queryKey: 알림열쇠 });
    const 이전 = 지금목록();
    if (이전) qc.setQueryData(알림열쇠, { ...이전, items: 바꾸기(이전.items) });
    return { 이전 };
  };
  const 되돌리기 = (ctx?: { 이전?: 알림응답 }) => {
    if (ctx?.이전) qc.setQueryData(알림열쇠, ctx.이전);
  };
  /** 서버가 준 진짜 줄로 갈아 끼운다 */
  const 갈아끼우기 = (새것?: 가격알림) => {
    const 이전 = 지금목록();
    if (!이전 || !새것?.id) return;
    const 남길것 = 이전.items.filter((a) => a.id > 0 && a.id !== 새것.id);
    qc.setQueryData(알림열쇠, { ...이전, items: [새것, ...남길것] });
  };

  const 걸기 = useMutation({
    mutationFn: (조건: { direction: "above" | "below"; target: number }) =>
      alertsApi.createAlert({ symbol, market, name: name || symbol, ...조건 }),
    onMutate: async (조건) => {
      /* 서버가 줄 id 를 아직 모른다. 임시 번호로 먼저 그려 두고,
         응답이 오면 진짜 것으로 바꿔 넣는다. */
      const 임시 = { id: -Date.now(), symbol, market, name: name || symbol,
                     direction: 조건.direction, target: 조건.target, made_at_price: price ?? null,
                     is_active: true, fired_at: null, fired_price: null } as 가격알림;
      set말("알림을 걸었어요");
      return 미리고치기((items) => [임시, ...items.filter(
        (a) => !(a.symbol === symbol && a.direction === 조건.direction && a.target === 조건.target))]);
    },
    onSuccess: 갈아끼우기,
    onError: (e, _v, ctx) => { 되돌리기(ctx); set말(사람말로(e)); },
  });

  const 켜고끄기 = useMutation({
    mutationFn: (id: number) => alertsApi.toggleAlert(id),
    onMutate: (id) => 미리고치기((items) => items.map(
      (a) => a.id === id ? { ...a, is_active: !a.is_active } : a)),
    onSuccess: 갈아끼우기,
    onError: (e, _v, ctx) => { 되돌리기(ctx); set말(사람말로(e)); },
  });

  /* 목표가 고치기 —
     예전에는 이 자리가 없어서 79,000 을 78,000 으로 낮추려면 지우고
     다시 걸어야 했다. 왕복이 두 번인 데다, 지우기만 하고 다시 거는 걸
     잊으면 알림이 통째로 사라진다. */
  const 고치기 = useMutation({
    mutationFn: (v: { id: number; direction: "above" | "below"; target: number }) =>
      alertsApi.editAlert(v.id, { direction: v.direction, target: v.target }),
    onMutate: (v) => {
      set말("목표가를 바꿨어요");
      set고치는것(null);
      return 미리고치기((items) => items.map((a) => a.id === v.id
        ? { ...a, direction: v.direction, target: v.target, is_active: true, fired_at: null }
        : a));
    },
    onSuccess: 갈아끼우기,
    onError: (e, _v, ctx) => { 되돌리기(ctx); set말(사람말로(e)); },
  });

  const 지우기 = useMutation({
    mutationFn: (id: number) => alertsApi.deleteAlert(id),
    onMutate: (id) => { set말("지웠어요"); return 미리고치기((items) => items.filter((a) => a.id !== id)); },
    onError: (e, _v, ctx) => { 되돌리기(ctx); set말(사람말로(e)); },
  });

  const 숫자목표 = Number(목표);
  const 걸수있나 = Number.isFinite(숫자목표) && 숫자목표 > 0 && !걸기.isPending;

  /** 빠른 목표를 눌렀다 — 방향까지 같이 정해서 곧바로 건다 */
  const 빠르게걸기 = (퍼센트: number) => {
    if (price == null) return;
    const 값 = 목표가(price, 퍼센트, 원화);
    const 방 = 퍼센트 >= 0 ? "above" : "below";
    set방향(방);
    set목표(원화 ? String(값) : 값.toFixed(2));
    걸기.mutate({ direction: 방, target: 값 });
  };

  const 고친숫자 = Number(고친값);
  const 고칠수있나 = Number.isFinite(고친숫자) && 고친숫자 > 0;

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
        <div className="absolute top-full mt-1 right-0 z-20 w-[19rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-bg-card shadow-float overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-sm font-semibold text-text-primary">가격 알림</span>
            <button aria-label="닫기" onClick={() => set열림(false)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:bg-bg-elevated">
              <X size={14}/>
            </button>
          </div>

          {/* ── 빠른 목표 ──
              지금 시세 대비 몇 % 로 한 번에 건다. 손으로 다섯 자리를
              치는 대신 한 번 누르면 끝난다 */}
          {price != null && (
            <div className="px-3 pt-2.5 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-2xs text-text-dim">지금 {돈(price)} 대비</span>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {빠른퍼센트.map((p) => (
                  <button
                    key={p}
                    onClick={() => 빠르게걸기(p)}
                    disabled={걸기.isPending}
                    title={`${돈(목표가(price, p, 원화))} ${p >= 0 ? "이상" : "이하"}`}
                    className={`py-1.5 rounded-lg text-2xs font-semibold border transition-colors disabled:opacity-40 ${
                      p >= 0
                        ? "border-border text-text-secondary hover:border-accent-orange/60 hover:text-accent-orange"
                        : "border-border text-text-secondary hover:border-accent-blue/60 hover:text-accent-blue"
                    }`}
                  >{p > 0 ? `+${p}%` : `${p}%`}</button>
                ))}
              </div>
            </div>
          )}

          {/* 값을 직접 넣기 */}
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
                onKeyDown={(e) => { if (e.key === "Enter" && 걸수있나) 걸기.mutate({ direction: 방향, target: 숫자목표 }); }}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary focus:outline-none focus:border-accent-orange/60"
              />
              <span className="text-xs text-text-muted shrink-0">{원화 ? "원" : "달러"}</span>
              <button
                onClick={() => 걸기.mutate({ direction: 방향, target: 숫자목표 })}
                disabled={!걸수있나}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-accent-orange/15 border border-accent-orange/40 text-accent-orange text-xs font-semibold disabled:opacity-40 hover:bg-accent-orange/25 transition-colors"
              >
                {걸기.isPending ? "거는 중" : "걸기"}
              </button>
            </div>
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

                {고치는것 === a.id ? (
                  /* 그 자리에서 고친다. 지우고 다시 거는 것보다 빠르고,
                     실수로 지우기만 하고 끝나는 일이 없다 */
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <input
                      type="number"
                      inputMode="decimal"
                      autoFocus
                      aria-label="목표 가격 고치기"
                      value={고친값}
                      onChange={(e) => set고친값(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && 고칠수있나) 고치기.mutate({ id: a.id, direction: a.direction, target: 고친숫자 });
                        if (e.key === "Escape") set고치는것(null);
                      }}
                      className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-bg-elevated border border-accent-orange/50 text-xs text-text-primary focus:outline-none"
                    />
                    <button
                      onClick={() => 고치기.mutate({ id: a.id, direction: a.direction, target: 고친숫자 })}
                      disabled={!고칠수있나}
                      aria-label="목표가 저장"
                      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-accent-orange hover:bg-accent-orange/15 disabled:opacity-40"
                    ><Check size={14}/></button>
                    <button
                      onClick={() => set고치는것(null)}
                      aria-label="고치기 취소"
                      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-text-dim hover:bg-bg-elevated"
                    ><X size={13}/></button>
                  </div>
                ) : (
                  <>
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
                      onClick={() => { set고치는것(a.id); set고친값(원화 ? String(Math.round(a.target)) : String(a.target)); }}
                      aria-label="목표가 고치기"
                      className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-dim hover:text-accent-orange hover:bg-bg-elevated transition-colors"
                    ><Pencil size={13}/></button>
                    <button
                      onClick={() => 지우기.mutate(a.id)}
                      aria-label="알림 지우기"
                      className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-dim hover:text-accent-red hover:bg-bg-elevated transition-colors"
                    ><Trash2 size={13}/></button>
                  </>
                )}
              </div>
            ))}
          </div>

          {말 && <p className="px-3 py-2 text-2xs text-text-muted border-t border-border">{말}</p>}
        </div>
      )}
    </div>
  );
}
