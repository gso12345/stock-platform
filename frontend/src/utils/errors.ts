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
