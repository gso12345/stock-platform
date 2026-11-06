/**
 * 계산이 도는 동안의 진행 막대 — 자산배분·단일 종목·유니버스가 같이 쓴다.
 *
 * 사용자: "단일종목 유니버스도 %로 진행률 확인할 수 있게 해줘". 자산배분에만 있던 막대(서버가 알려 주는 실제 값 +
 * 못 받을 때의 어림)를 여기로 떼어 내 세 탭이 같은 모양·같은 규칙으로 쓴다.
 *
 * ── 이 퍼센트가 무엇인지 ────────────────────────────────────
 *
 * **서버가 알려 주는 실제 값**이다. 요청에 열쇠를 하나 실어 보내면 서버가 일하면서 그 열쇠에 '시세 4/8',
 * '종목 37/311' 같은 것을 적어 두고, 화면이 따로 물어본다. 어림이 아니다.
 *
 * 못 물어볼 때만 어림으로 돌아간다(서버가 옛 버전이거나 중간에 무언가가 막거나). 그때도 **막대는 멈추지 않는다** —
 * 어림을 넘긴 뒤로는 99% 에 점점 가까워지며 계속 움직인다. 100% 는 응답이 실제로 왔을 때만이다.
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { backtestApi, type 서버진행 } from "@/api/stocks";

/** 이번 계산에 붙일 진행 열쇠.
 *
 *  서버가 진행 상황을 이 열쇠 아래에 적어 둔다. 남이 맞혀 봐야 나오는 것은 '시세 3/8' 뿐이라(무엇을 담았는지도,
 *  결과도 없다) 비밀일 필요는 없지만, 남의 것과 겹치면 서로의 진행바가 뒤섞이므로 충분히 길게 만든다.
 *
 *  crypto.randomUUID 가 없는 환경(옛 브라우저·jsdom 일부)도 있어 없으면 손으로 만든다 — 열쇠가 없다고 계산이
 *  막히면 안 된다. */
export function 새열쇠(): string {
  try {
    const c = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  } catch { /* 아래로 */ }
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** 서버가 안 알려 줄 때 쓰는 비율 — **절대 멈추지 않는다.**
 *
 *  예전에는 `min(지난초/예상, 0.92)` 였다. 어림을 넘기는 순간 92% 에 박혀서, 30초를 더 기다리는 동안 막대가 한
 *  픽셀도 안 움직였다. 멈춘 막대는 아무것도 없는 것보다 나쁘다 — 사용자는 화면이 죽은 줄 알고 새로고침하고,
 *  그러면 처음부터 다시 시작한다.
 *
 *  어림까지는 그대로 가고, 그 뒤로는 **남은 거리의 일부씩** 줄여 간다. 99% 에 점점 가까워지되 절대 닿지 않는다. */
export function 어림비율(지난초: number, 예상: number): number {
  if (예상 <= 0) return 0;
  /* 어림까지 가도 **70% 까지만** 간다. 어림은 어차피 어림이라 90% 를 찍어 놓으면, 조금만 더 걸려도 곧장 끝에
     붙어 또 멈춘 것처럼 보인다. 못 미더운 수일수록 겸손해야 한다. */
  if (지난초 <= 예상) return (지난초 / 예상) * 0.7;
  /* 넘긴 뒤로는 **30초마다 남은 거리의 절반**씩 간다. 실제 시간으로 잡아야 사람이 보는 속도가 설정과 무관하게
     일정하다. 몇 분을 기다려도 눈에 띄게 움직이고, 99% 를 넘지는 않는다. */
  const 반감기 = 30;
  return 0.7 + 0.29 * (1 - Math.pow(0.5, (지난초 - 예상) / 반감기));
}

/** 걸린 시간을 사람이 읽는 말로 — '95초' 보다 '1분 35초' 가 읽힌다 */
export function 지난말(초: number): string {
  const s = Math.floor(초);
  if (s < 60) return `${s}초`;
  return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, "0")}초`;
}

/** 무료 서버가 자고 있다가 깨는 데 드는 초 — 실측 20~50초의 가운데쯤(첫 요청에만 어림에 얹는다) */
export const 깨우는초 = 25;

export function 진행막대({ 열쇠, 예상, 어림글, 아래글, 물어보기 = backtestApi.getProgress }: {
  /** 서버에 보낸 진행 열쇠. 없으면 어림으로만 그린다 */
  열쇠?: string;
  /** 어림 — 몇 초쯤 걸릴까(서버가 못 알려 줄 때만 쓴다) */
  예상: number;
  /** 서버 말이 없을 때 지금 무엇을 하는지 — 비율(0~1)을 받는다 */
  어림글: (비율: number) => string;
  /** 막대 아래 왼쪽 — 서버 말이 있으면 그걸로 '종목 37/311' 처럼 */
  아래글: (서버: 서버진행 | null) => string;
  /** 서버에 묻는 함수(자산배분은 옛 주소를 쓴다) */
  물어보기?: (열쇠: string) => Promise<서버진행 | null>;
}) {
  const [지난초, set지난초] = useState(0);
  const [서버, set서버] = useState<서버진행 | null>(null);

  useEffect(() => {
    const 시작 = Date.now();
    const t = setInterval(() => set지난초((Date.now() - 시작) / 1000), 100);
    return () => clearInterval(t);
  }, []);

  /* 0.8초마다 묻는다 — 더 자주 물으면 0.15 CPU 서버에 부담이고, 더 뜸하면 막대가 뚝뚝 끊겨 보인다 */
  useEffect(() => {
    if (!열쇠) return;
    let 살아있나 = true;
    const 묻기 = async () => {
      /* 진행 표시는 덤이다 — 묻다가 터져도(옛 서버·끊김) 막대는 어림으로 계속 간다 */
      try {
        const x = await 물어보기?.(열쇠);
        if (살아있나 && x) set서버(x);
      } catch { /* 어림으로 */ }
    };
    묻기();
    const t = setInterval(묻기, 800);
    return () => { 살아있나 = false; clearInterval(t); };
  }, [열쇠, 물어보기]);

  /* 서버 값이 있으면 그것을 쓴다. 다만 **뒤로는 안 간다** — 어림이 앞서 있었는데 서버 값이 낮게 오면 막대가
     되돌아가고, 되돌아가는 막대는 고장으로 읽힌다. */
  const 어림 = 어림비율(지난초, 예상);
  const 비율 = 서버 ? Math.max(서버.percent / 100, 어림 * 0.5) : 어림;
  const 퍼센트 = Math.min(Math.round(비율 * 100), 99);
  const 오래걸림 = 지난초 > 예상 * 2 + 5;

  return (
    <Card className="flex flex-col gap-3 py-10">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-text-muted">{서버?.글 ? `${서버.글}…` : 어림글(비율)}</span>
        <span className="text-sm font-mono font-bold tabular-nums text-accent-blue">{퍼센트}%</span>
      </div>
      <div className="h-2 rounded-full bg-bg-elevated overflow-hidden">
        <div role="progressbar" aria-label="계산 진행률" aria-valuenow={퍼센트} aria-valuemin={0} aria-valuemax={100}
          className="h-full bg-accent-blue rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${퍼센트}%` }} />
      </div>
      {/* 걸린 시간은 **어림이 아니라 진짜 수**다. 퍼센트가 못 미더울 때도 이건 '살아 있다' 는 증거가 된다 */}
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-2xs text-text-dim break-keep">{아래글(서버)}</span>
        <span className="text-2xs text-text-dim font-mono tabular-nums">{지난말(지난초)} 지남</span>
      </div>
      {오래걸림 && (
        <span className="text-2xs text-accent-yellow/90 break-keep">
          서버가 쉬고 있었나 봐요. 첫 요청은 30초 넘게 걸릴 수 있어요 — 창을 닫지 마시고 조금만 더 기다려 주세요.
        </span>
      )}
    </Card>
  );
}

/** 서버 말로 막대 아래 줄 — 여러 개를 세는 단계면 '종목 37/311', 한 번이면 '시세 하는 중' */
export function 서버아래말(서버: 서버진행): string {
  return 서버.total > 1 ? `${서버.단계} ${서버.done}/${서버.total}` : `${서버.단계} 하는 중`;
}
