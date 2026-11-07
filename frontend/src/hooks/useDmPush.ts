/**
 * 메시지 푸시가 왔을 때 — 열려 있는 화면도 바로 알게.
 *
 * 앱이 열려 있으면 화면은 몇 초~1분마다 묻는다. 그 사이 휴대폰 알림이 먼저 울리면 알림에는 새 메시지가 있는데
 * 화면의 배지·대화방은 아직 그대로다. 서비스워커(public/sw.js)가 메시지 푸시를 받으면 열린 창들에 알려 준다 —
 * 그 자리에서 다시 묻는다.
 *
 * 알림 자체는 그대로 띄운다. 띄우지 않으면 브라우저(특히 아이폰)가 구독을 끊는다. 대신 그 대화방을 보고 있으면
 * 읽음을 보낼 때 그 방의 알림을 걷는다(대화알림닫기).
 */
import { useEffect, useRef } from "react";

/** 메시지 푸시를 들으면 부른다 — 어느 방인지(알림 tag 'dm-12') 같이 */
export function use메시지푸시(받으면: (방번호: number | null) => void): void {
  const 최신 = useRef(받으면);
  최신.current = 받으면;
  useEffect(() => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!sw?.addEventListener) return;
    const 들음 = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.type !== "dm") return;
      const m = /^dm-(\d+)$/.exec(String(d.tag ?? ""));
      최신.current(m ? Number(m[1]) : null);
    };
    sw.addEventListener("message", 들음);
    return () => sw.removeEventListener("message", 들음);
  }, []);
}

/** 그 대화방의 휴대폰 알림을 걷는다 — 읽었으니 알림판에 남아 있을 이유가 없다 */
export async function 대화알림닫기(방번호: number): Promise<void> {
  try {
    const 등록 = await navigator.serviceWorker?.getRegistration?.();
    const 알림들 = await 등록?.getNotifications?.({ tag: `dm-${방번호}` });
    알림들?.forEach((n) => n.close());
  } catch {
    /* 알림을 못 걷어도 대화는 그대로 — 조용히 */
  }
}
