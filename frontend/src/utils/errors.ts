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
