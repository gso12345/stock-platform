/**
 * 브라우저에서 터진 것을 서버로 보낸다.
 *
 * 왜 필요한가 — 오늘까지 화면 고장을 전부 사용자 제보로 알았다.
 * 엔비디아가 순위에서 사라진 것도, 콜금리가 안 뜨는 것도, 글자가 너무
 * 커진 것도. 서버 오류는 이제 남지만(app/core/errors.py), 사용자가 겪는
 * 고장의 절반은 브라우저에서 난다 — 흰 화면, 눌러도 반응 없음.
 * 그건 서버 로그 어디에도 안 남는다.
 *
 * 지켜야 할 것 — 오류를 보내다가 화면이 또 터지면 고치려던 것보다 나쁘다.
 * 그래서 모든 실패를 삼키고, 답도 안 기다린다.
 */

/** 같은 오류를 몇 번까지 보낼지. 무한 루프에 빠진 화면이 초당 수십 건을
 *  쏘면 그것 자체가 0.15 CPU 서버를 멈춰 세운다. */
const 한_오류당_최대 = 3;

/** 한 번 열어 둔 동안 보낼 총 건수 상한 */
const 전체_최대 = 20;

const 보낸것 = new Map<string, number>();
let 총건수 = 0;

function 열쇠(무엇: string, 자세히: string): string {
  return `${무엇}|${자세히.slice(0, 120)}`;
}

export function 오류보내기(무엇: unknown, 자세히: unknown, 어디서?: string): void {
  try {
    const m = String(무엇 ?? "Error").slice(0, 200);
    const d = String(자세히 ?? "").slice(0, 4000);
    const k = 열쇠(m, d);

    const 이미 = 보낸것.get(k) ?? 0;
    if (이미 >= 한_오류당_최대 || 총건수 >= 전체_최대) return;
    보낸것.set(k, 이미 + 1);
    총건수 += 1;

    const 본문 = JSON.stringify({
      무엇: m,
      자세히: d,
      어디서: (어디서 ?? window.location.pathname).slice(0, 500),
    });

    /* sendBeacon 을 먼저 쓴다 — 화면을 떠나는 순간에도 나간다.
       fetch 는 그때 취소되는 일이 있어서, 정작 제일 알고 싶은
       '화면이 죽어서 나간 경우' 를 놓친다. */
    const 주소 = "/api/v1/client-errors";
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(주소, new Blob([본문], { type: "application/json" }));
      if (ok) return;
    }
    /* 답은 안 기다린다. 실패해도 할 수 있는 게 없다. */
    void fetch(주소, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: 본문,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 여기서 터지면 정말로 할 수 있는 게 없다 */
  }
}

/** 아무 데서도 안 잡힌 오류를 줍는다.
 *
 *  ErrorBoundary 는 '화면 그리다 터진 것' 만 잡는다. 이벤트 처리기나
 *  약속(Promise) 안에서 터진 것은 거기까지 안 올라오고 콘솔에만 남는다 —
 *  사용자에게는 '눌러도 아무 일이 안 일어남' 으로 보인다. */
export function 오류받기_시작(): void {
  window.addEventListener("error", (e) => {
    오류보내기(
      e.error?.name || "Error",
      `${e.message}\n${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack ?? ""}`,
    );
  });

  window.addEventListener("unhandledrejection", (e) => {
    const r: any = e.reason;
    오류보내기(
      r?.name || "UnhandledRejection",
      `${r?.message ?? String(r)}\n${r?.stack ?? ""}`,
    );
  });
}
