/**
 * 서버 오류 메시지 추출 — 화면마다 조금씩 다르게 반복되던 처리를 하나로 모았다.
 *
 * FastAPI는 detail을 문자열로 줄 때도 있고, 유효성 검사 실패 시에는
 * [{loc, msg, type}, ...] 배열로 준다. 배열을 그대로 화면에 뿌리면
 * "[object Object]"가 노출되므로 msg만 골라 합친다.
 */
export function extractErrorMessage(err: unknown, fallback = "알 수 없는 오류가 발생했습니다"): string {
  const e = err as any;
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const joined = detail.map((x: any) => x?.msg ?? JSON.stringify(x)).join(", ");
    if (joined.trim()) return joined;
  }
  if (typeof e?.message === "string" && e.message.trim()) return e.message;
  return fallback;
}

/**
 * 서버 오류 본문을 **사람이 읽을 한 줄**로.
 *
 * 여기가 화면을 죽일 수 있는 자리였다. FastAPI 의 422(검증 실패)는
 * detail 을 객체 배열로 준다 — 그걸 그대로 상태에 넣고 그리면
 * "Objects are not valid as a React child" 로 종목상세가 통째로 하얘진다.
 * 프록시가 HTML 을 돌려주는 경우도 있는데, 그때는 안 죽지만 화면에
 * HTML 한 덩어리가 찍힌다.
 *
 * 무엇이 오든 짧은 문장 하나로 만든다. 못 읽겠으면 기본 문구를 쓴다 —
 * 사용자에게 서버 내부 사정을 보여 줄 이유도 없다.
 */
export function 읽을수있는오류(detail: unknown, 기본 = "추가 실패"): string {
  if (typeof detail === "string" && detail.trim()) {
    /* HTML 이 통째로 오면 화면을 밀어낸다. 앞부분만 남긴다 */
    const 한줄 = detail.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return 한줄 ? 한줄.slice(0, 120) : 기본;
  }
  if (Array.isArray(detail)) {
    /* FastAPI 검증 오류: [{loc, msg, type}, ...] */
    const 말들 = detail
      .map((x) => (x && typeof x === "object" && typeof (x as { msg?: unknown }).msg === "string"
        ? (x as { msg: string }).msg : null))
      .filter(Boolean);
    return 말들.length ? 말들.join(", ").slice(0, 120) : 기본;
  }
  if (detail && typeof detail === "object") {
    const m = (detail as { msg?: unknown; message?: unknown });
    if (typeof m.msg === "string" && m.msg.trim()) return m.msg.slice(0, 120);
    if (typeof m.message === "string" && m.message.trim()) return m.message.slice(0, 120);
  }
  return 기본;
}

/**
 * **오래 걸린 것**과 **닿지 못한 것**을 갈라 말한다.
 *
 * ── 무엇이 문제였나 ────────────────────────────────────────
 *
 * 백테스트가 끊기면 화면에 '서버에 연결하지 못했습니다' 나 '실행에
 * 실패했어요' 가 떴다. 둘 다 **서버가 죽었다**는 뜻으로 읽힌다.
 * 그런데 그때 서버는 멀쩡히 계산 중인 경우가 대부분이었다 — 무료
 * 서버는 한동안 요청이 없으면 잠들고, 깨우는 데만 20~50초가 든다.
 *
 * 틀린 안내는 안내가 없는 것보다 나쁘다. '연결 실패' 로 읽은 사람은
 * 서버가 고장 난 줄 알고 떠나거나, 인터넷을 확인하러 간다. 실제로
 * 해야 할 일은 **조금 기다렸다 다시 누르는 것**이다.
 *
 * ── 어떻게 가르나 ──────────────────────────────────────────
 *
 *   ① 서버가 뭔가 말했으면 그 말을 쓴다(잘못된 설정 등)
 *   ② 시간이 넘어 끊겼으면 — 오래 걸린 것이다
 *   ③ 응답이 아예 없으면 — 닿지 못한 것이다(인터넷/서버)
 *   ④ 그 밖에는 부르는 쪽이 준 기본 문구
 *
 * 두 번째와 세 번째는 **사용자가 할 일이 다르다.** 오래 걸린 것은
 * 다시 누르면 되고(두 번째부터는 서버가 깨어 있어 훨씬 빠르다),
 * 닿지 못한 것은 연결을 봐야 한다.
 */
export function 요청실패말(err: unknown, 기본: string): string {
  const e = err as any;

  //: ① 서버가 이유를 말했으면 그것이 제일 정확하다
  const detail = e?.response?.data?.detail;
  if (detail != null && !(typeof detail === "object" && !Array.isArray(detail)
                          && !("msg" in detail) && !("message" in detail))) {
    const 말 = 읽을수있는오류(detail, "");
    if (말) return 말;
  }
  if (e?.response?.status) return 기본;      // 응답은 왔는데 읽을 말이 없다

  //: ② 시간이 넘어 **우리가** 끊은 것 — 서버는 아직 돌고 있을 수 있다
  if (e?.code === "ECONNABORTED" || e?.code === "ETIMEDOUT"
      || /timeout/i.test(String(e?.message ?? ""))) {
    return "시간이 오래 걸려 기다리다 멈췄어요. 서버가 자고 있었을 수 있어요 — "
         + "잠시 후 다시 누르면 대개 훨씬 빨라요";
  }

  //: ③ 응답이 아예 없다
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "인터넷이 끊겨 있어요. 연결을 확인해 주세요";
  }
  if (!e?.response) {
    return "서버에 닿지 못했어요. 잠시 후 다시 시도해 주세요";
  }
  return 기본;
}
