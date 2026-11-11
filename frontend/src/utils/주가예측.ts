/**
 * 주가예측 화면의 글귀·그래프 자료 — 셈은 서버가 하고(services/predict/forecast), 여기는 보여 줄 모양만 만든다.
 *
 * 확률을 '0%'·'100%' 로 적지 않는다 — 셈으로 나온 1% 미만은 '절대 아니다' 가 아니다. 검증 결과는 범위가 실제와
 * 맞았는지, 좁았는지(실제로 더 크게 움직였는지), 넉넉했는지를 한 줄로 말하고, 겹치지 않는 기간이 적으면 참고만 하라고
 * 덧붙인다(1년 뒤 예측은 3년을 매주 셈해도 서로 겹쳐 실제로는 세 번쯤 본 셈이다).
 */
import type { 근거비율, 예측검증, 예측근거, 예측분위, 주가예측 } from "@/api/predict";
import type { Market } from "@/types";

export const 예측기간들 = [
  { days: 5, label: "1주" },
  { days: 21, label: "1개월" },
  { days: 63, label: "3개월" },
  { days: 126, label: "6개월" },
  { days: 252, label: "1년" },
] as const;
export type 예측일수 = (typeof 예측기간들)[number]["days"];
export const 기본기간: 예측일수 = 21;

export function 기간인가(n: number): n is 예측일수 {
  return 예측기간들.some((x) => x.days === n);
}

/** 0.534 → "53%". 1% 미만·99% 넘는 것은 그렇게 적는다 — 0%·100% 는 '절대' 로 읽힌다 */
export function 확률글(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  if (p < 0.01) return "1% 미만";
  if (p > 0.99) return "99% 넘게";
  return `${Math.round(p * 100)}%`;
}

/** 기준 대비 — "+1.2%" · "−3.4%" · "+12%"(10% 넘으면 소수 없이) */
export function 변화글(값: number, 기준: number): string {
  const r = (값 / 기준 - 1) * 100;
  if (!Number.isFinite(r)) return "—";
  const 자리 = Math.abs(r) < 10 ? 1 : 0;
  const 수 = Math.abs(r).toFixed(자리);
  if (Number(수) === 0) return "0%";
  return `${r > 0 ? "+" : "−"}${수}%`;
}

/** "2026-12-10" → "12월 10일" */
export function 날짜글(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}월 ${Number(d)}일` : iso;
}

/** "2023-08-24" → "2023년 8월" */
export function 년월글(iso: string): string {
  const [y, m] = iso.split("-");
  return y && m ? `${y}년 ${Number(m)}월` : iso;
}

/** 지난 검증을 한 줄로 — 실제 주가가 80% 범위 안에 든 비율이 80% ± 7%p 면 잘 맞았다고 본다.
 *  화면에 보이는 정수 퍼센트로 판정한다(0.87 - 0.8 은 소수로 0.0700…06 이라 87% 가 '넉넉' 으로 갈렸다) */
export function 검증평(검: 예측검증): { 말: string; 맞음: boolean; 참고만: boolean } {
  const 차 = Math.round(검.in80 * 100) - 80;
  const 맞음 = Math.abs(차) <= 7;
  const 말 = 맞음 ? "범위가 실제와 잘 맞았어요"
    : 차 > 0 ? "범위가 넉넉했어요 — 실제로는 덜 움직였어요"
    : 검.above80 >= 검.below80 ? "범위가 좁았어요 — 실제로는 위로 더 크게 움직였어요"
    : "범위가 좁았어요 — 실제로는 아래로 더 크게 움직였어요";
  return { 말, 맞음, 참고만: 검.periods < 10 };
}

/** 근거의 이름 */
export function 근거이름(g: 예측근거): string {
  return g.key === "trend" ? "추세 · 200일 평균" : g.key === "momentum" ? "1년 흐름" : "RSI(14일)";
}

/** 근거의 지금 상태 — 짧게 */
export function 근거상태(g: 예측근거): string {
  if (g.key === "trend") return g.state === "above" ? "200일 평균보다 위" : "200일 평균보다 아래";
  if (g.key === "momentum") return g.state === "up" ? "1년 동안 올랐어요" : "1년 동안 내렸어요";
  return g.state === "hot" ? "과열(70 넘음)" : g.state === "cold" ? "침체(30 아래)" : "보통(30~70)";
}

/** 근거의 숫자 — 200일 평균 값, 1년 흐름(최근 1개월 빼고), RSI 값 */
export function 근거값(g: 예측근거, 가격글: (v: number) => string): string {
  if (g.key === "trend") return `지금 ${가격글(g.price)} · 200일 평균 ${가격글(g.ma200)}`;
  if (g.key === "momentum") return `최근 1개월을 뺀 1년 ${변화글(1 + g.ret, 1)}`;
  return `RSI ${g.value.toFixed(0)}`;
}

/** 그 기간에 이 상태였던 날들 가운데 뒤에 올라 있던 비율 — 모든 날의 비율과 나란히 */
export function 근거비율글(r: 근거비율 | null | undefined, 기간: string): string {
  if (!r) return `${기간} 뒤를 셀 만큼 지난 자료가 없어요`;
  // 서버는 같은 상태였던 날이 없을 때(n 0) cond 를 비워 보낸다 — 하나만 본다
  if (r.cond == null) return `지금 같은 상태였던 날이 없었어요`;
  return `지금 같은 상태였던 ${r.n.toLocaleString("ko-KR")}일 가운데 ${기간} 뒤 오른 비율 ${확률글(r.cond)}`
    + ` · 모든 날은 ${확률글(r.base)}`;
}

/** 그래프 가로축 눈금 — 짧은 기간은 '12/10', 6개월·1년은 두 해에 걸쳐 '2/11' 이 두 번 나와 어느 해인지 몰랐다 — '2025.02' */
export function 눈금글(iso: string, 일수: 예측일수): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m) return iso;
  return 일수 >= 126 ? `${y}.${m}` : `${Number(m)}/${Number(d)}`;
}

/** 그래프에 함께 그릴 지난 날 수 — 앞날이 길면 지난 흐름도 길게 */
export const 지난날수: Record<예측일수, number> = { 5: 40, 21: 90, 63: 160, 126: 260, 252: 260 };

export interface 그래프줄 {
  date: string;
  종가?: number;
  가운데?: number;
  범위80?: [number, number];
  범위50?: [number, number];
}

/** 지난 종가 + 앞날 범위. 오늘(마지막 종가)에서 범위가 시작해 선과 부채꼴이 이어진다 */
export function 그래프자료(p: 주가예측, 일수: 예측일수): 그래프줄[] {
  const 줄들: 그래프줄[] = p.history.slice(-지난날수[일수]).map((h) => ({ date: h.date, 종가: h.close }));
  const 오늘 = 줄들[줄들.length - 1];
  if (오늘 && 오늘.종가 != null) {
    오늘.가운데 = 오늘.종가;
    오늘.범위80 = [오늘.종가, 오늘.종가];
    오늘.범위50 = [오늘.종가, 오늘.종가];
  }
  for (const q of p.path.slice(0, 일수)) {
    줄들.push({ date: q.date, 가운데: q.q50, 범위80: [q.q10, q.q90], 범위50: [q.q25, q.q75] });
  }
  return 줄들;
}

/** 범위 막대의 자리(0~100) — 80% 범위·50% 범위·가운데·지금 가격. 양 끝에 조금 여백을 둔다 */
export function 막대자리(q: 예측분위, 지금: number) {
  const 낮 = Math.min(q.q10, 지금);
  const 높 = Math.max(q.q90, 지금);
  const 여백 = (높 - 낮) * 0.08 || 1;
  const a = 낮 - 여백;
  const b = 높 + 여백;
  const 자리 = (x: number) => ((x - a) / (b - a)) * 100;
  return { 넓은: [자리(q.q10), 자리(q.q90)], 좁은: [자리(q.q25), 자리(q.q75)], 가운데: 자리(q.q50), 지금: 자리(지금) };
}

/** 빠르게 고를 종목 — 최근 본 것이 없을 때 */
export const 자주보는종목: { symbol: string; market: Market; name: string }[] = [
  { symbol: "005930", market: "KR", name: "삼성전자" },
  { symbol: "000660", market: "KR", name: "SK하이닉스" },
  { symbol: "AAPL", market: "US", name: "애플" },
  { symbol: "NVDA", market: "US", name: "엔비디아" },
  { symbol: "TSLA", market: "US", name: "테슬라" },
];
