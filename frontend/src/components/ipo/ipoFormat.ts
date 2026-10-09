/**
 * 공모주 화면이 함께 쓰는 숫자·날짜 글자.
 *
 * 예측값은 소수점 둘째 자리까지 쓰지 않는다. '+54.37%' 로 적으면 그만큼
 * 정확하다는 뜻으로 읽힌다 — 실제 오차는 수십 %p 다.
 */

export function 원(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${Math.round(v).toLocaleString("ko-KR")}원`;
}

/** 시초가 ÷ 공모가 → 공모가 대비 몇 % (반올림한 정수) */
export function 배율퍼센트(배율: number): number {
  return Math.round((배율 - 1) * 100);
}

export function 퍼센트글(v: number): string {
  return `${v > 0 ? "+" : ""}${v}%`;
}

/** 1234.5 → '1,235:1', 3.25 → '3.3:1' */
export function 경쟁률글(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 100 ? Math.round(v).toLocaleString("ko-KR") : v.toFixed(1)}:1`;
}

export function 확약글(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(1)}%`;
}

/** 공모금액(백만원) → '180억' */
export function 억원글(백만원: number | null | undefined): string {
  if (백만원 == null || !Number.isFinite(백만원)) return "—";
  const 억 = 백만원 / 100;
  return 억 >= 1 ? `${Math.round(억).toLocaleString("ko-KR")}억` : `${Math.round(백만원)}백만`;
}

/** '2026-10-13' → '10.13'. 올해가 아니면 해를 붙인다('25.10.16').
 *
 *  월·일만 적으면 지난해 10월 16일 상장한 공모주가 오늘(10월 9일) 보기에
 *  '아직 상장 안 한 것' 처럼 읽혔다 — 비슷했던 공모주 목록은 3년 치다. */
export function 날짜글(iso: string | null | undefined, 지금: Date = new Date()): string {
  if (!iso || iso.length < 10) return "—";
  const 올해 = new Date(지금.getTime() + 9 * 3600_000).getUTCFullYear();
  const 월일 = `${+iso.slice(5, 7)}.${+iso.slice(8, 10)}`;
  return +iso.slice(0, 4) === 올해 ? 월일 : `${iso.slice(2, 4)}.${월일}`;
}

/** 오늘(한국 날짜)에서 그날까지 며칠. 지난 날이면 음수 */
export function 남은날(iso: string | null | undefined, 지금: Date = new Date()): number | null {
  if (!iso) return null;
  const 그날 = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const 한국 = new Date(지금.getTime() + 9 * 3600_000);
  const 오늘 = Date.UTC(한국.getUTCFullYear(), 한국.getUTCMonth(), 한국.getUTCDate());
  return Math.round((그날 - 오늘) / 86_400_000);
}

export function 확률글(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** '1,234' 처럼 쉼표를 넣어 적어도 읽는다. 빈칸이면 null */
export function 숫자로(s: string): number | null {
  const 깨끗 = s.replace(/[,\s원%]/g, "").replace(/:1$/, "");
  if (!깨끗) return null;
  const v = Number(깨끗);
  return Number.isFinite(v) ? v : NaN;
}
