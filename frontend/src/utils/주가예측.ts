/**
 * 주가예측 화면의 글귀·그래프 자료 — 셈은 서버가 하고(services/predict/forecast), 여기는 보여 줄 모양만 만든다.
 *
 * 확률을 '0%'·'100%' 로 적지 않는다 — 셈으로 나온 1% 미만은 '절대 아니다' 가 아니다. 검증 결과는 범위가 실제와
 * 맞았는지, 좁았는지(실제로 더 크게 움직였는지), 넉넉했는지를 한 줄로 말하고, 겹치지 않는 기간이 적으면 참고만 하라고
 * 덧붙인다(1년 뒤 예측은 3년을 매주 셈해도 서로 겹쳐 실제로는 세 번쯤 본 셈이다).
 */
import type { 가치까닭, 가치날, 근거비율, 기술검증, 예측검증, 예측근거, 예측분위, 주가예측 } from "@/api/predict";
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
  /** 기술적 분석의 예상 주가 — 그 기간의 마지막 날에만 점 하나 */
  기술?: number;
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
  const 기술 = p.technical?.horizons.find((h) => h.days === 일수);
  if (기술 && 줄들.length) 줄들[줄들.length - 1].기술 = 기술.predicted;
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

/** "2024-03-14" → "2024년 3월 14일" */
export function 년월일글(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${y}년 ${Number(m)}월 ${Number(d)}일` : iso;
}

/** 기술적 지표의 지금 값을 사람이 읽는 글로 — 이격도·수익은 %, 비율은 배, RSI 는 그대로 */
export function 지표값글(key: string, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (key) {
    case "rsi": return v.toFixed(0);
    case "bb": return v.toFixed(2);
    case "vol":
    case "volume": return `${Math.exp(v).toFixed(2)}배`;
    case "macd": {
      const 수 = Math.abs(v * 100).toFixed(2);
      return Number(수) === 0 ? "0%" : `${v > 0 ? "+" : "−"}${수}%`;
    }
    default: return 변화글(Math.exp(v), 1);
  }
}

/** 기술적 신호를 얼마나 반영했나 — 지난 3년 '지금 가격 그대로' 와 견준 성적으로 고른 비율을 한 줄로.
 *  '확실히 낫다' 는 말은 하지 않는다 — 79종목 10년 시세로 견주니 지난 3년에 확실히 나았던 때도 그 뒤로는 더 틀렸다 */
export function 기술반영글(검: 기술검증 | null | undefined): string {
  if (!검) return "지난 성적을 셀 만큼 시세가 없어 지금 가격을 예상으로 써요";
  if (검.weight === 0) return "지난 3년 이 종목에서 기술적 신호가 '그대로'보다 못 맞혀, 지금 가격을 예상으로 써요";
  const 반영 = `기술적 신호를 ${Math.round(검.weight * 100)}% 반영했어요`;
  const 퍼 = Math.round(검.gain * 100);
  return 퍼 >= 1 ? `${반영} — 지난 3년 '그대로'보다 ${퍼}% 덜 틀렸어요` : `${반영} — 지난 3년 '그대로'와 거의 같았어요`;
}

/** 여러 종목으로 시험한 결과 — 카드마다 같이 보인다(backend/app/services/predict/technical.py 머리글) */
export const 기술시험글 = "여러 종목을 10년 동안 시험해 보면 기술적 예상은 '그대로'를 이기지 못했어요 — 참고만 하세요";

/** 기술적 예측 막대의 자리(0~100) — 50% 범위 · 예상 · 지금. 양 끝에 조금 여백 */
export function 기술막대자리(범위: [number, number], 예상: number, 지금: number) {
  const 낮 = Math.min(범위[0], 예상, 지금);
  const 높 = Math.max(범위[1], 예상, 지금);
  const 여백 = (높 - 낮) * 0.12 || 1;
  const a = 낮 - 여백;
  const b = 높 + 여백;
  const 자리 = (x: number) => ((x - a) / (b - a)) * 100;
  return { 절반: [자리(범위[0]), 자리(범위[1])], 예상: 자리(예상), 지금: 자리(지금) };
}

/* ── 가치 위치(지금 PER·PBR 이 지난날 가운데 어디쯤인지 — components/predict/가치위치) ── */

/** 본 기간의 길이 — "2023-03-31" ~ "2026-11-11" → "3년 7개월" */
export function 기간길이글(시작: string, 끝: string): string {
  const [y1, m1, d1] = 시작.split("-").map(Number);
  const [y2, m2, d2] = 끝.split("-").map(Number);
  if (![y1, m1, d1, y2, m2, d2].every(Number.isFinite)) return "";
  const 달 = Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
  const 해 = Math.floor(달 / 12);
  const 남 = 달 % 12;
  if (해 && 남) return `${해}년 ${남}개월`;
  return 해 ? `${해}년` : `${Math.max(남, 1)}개월`;
}

/** 공식 PER·PBR — 종목 상세 재무 탭처럼 PER 은 소수 한 자리, PBR 은 두 자리 */
export function 배수글(칸: "per" | "pbr", v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(칸 === "per" ? 1 : 2)}배`;
}

/** 지금이 지난날 가운데 어디쯤인지 — 지금보다 쌌던 날의 비율. 끝이면 그렇게 말한다 */
export function 쌌던날글(below: number): string {
  if (below <= 0) return "지금이 가장 싸요";
  if (below >= 1) return "지금이 가장 비싸요";
  return `지금보다 쌌던 날 ${확률글(below)}`;
}

/** 지금 ÷ 지난날의 가운데 값 — "가운데 값보다 15% 낮아요". 두 배가 넘으면 배로 */
export function 가운데견줌글(vs: number): string {
  if (!Number.isFinite(vs)) return "";
  if (vs >= 2) return `지난날의 가운데 값의 ${vs.toFixed(1)}배예요`;
  const 퍼 = Math.round((vs - 1) * 100);
  if (퍼 === 0) return "지난날의 가운데 값과 거의 같아요";
  return `지난날의 가운데 값보다 ${Math.abs(퍼)}% ${퍼 > 0 ? "높아요" : "낮아요"}`;
}

/** 가장 쌌던·비쌌던 날과 그때의 비율 — "2024년 11월 14일 · 지금보다 30% 낮았어요" */
export function 끝날견줌글(x: 가치날): string {
  const 퍼 = Math.round((x.vs_now - 1) * 100);
  const 견줌 = x.vs_now >= 2 ? `지금의 ${x.vs_now.toFixed(1)}배였어요`
    : 퍼 === 0 ? "지금과 거의 같았어요"
    : `지금보다 ${Math.abs(퍼)}% ${퍼 > 0 ? "높았어요" : "낮았어요"}`;
  return `${년월일글(x.date)} · ${견줌}`;
}

/** 지금 쓴 실적 — "2026년 6월까지 4분기 순이익" · "2025년 12월 결산 연간 순이익" · "2026년 6월 말 순자산" */
export function 가치기준글(칸: "per" | "pbr", 기준: { kind: "ttm" | "annual" | "quarter"; end: string }): string {
  const 때 = 년월글(기준.end);
  if (칸 === "pbr") return `${때} 말 순자산`;
  return 기준.kind === "ttm" ? `${때}까지 4분기 순이익` : `${때} 결산 연간 순이익`;
}

/** 위치를 셀 수 없는 까닭 */
export function 가치까닭글(why: 가치까닭): string {
  switch (why) {
    case "loss": return "최근 1년 순이익이 적자라 위치를 셀 수 없어요";
    case "deficit": return "순자산이 0 이하(자본잠식)라 위치를 셀 수 없어요";
    case "short": return "실적을 안 날이 1년이 안 돼 위치를 셀 수 없어요";
    default: return "실적 자료를 받지 못해 위치를 셀 수 없어요";
  }
}

/** 적자·자본잠식이라 뺀 동안 — "적자였던 2024년 4월 ~ 2025년 3월은 뺐어요". 없으면 null */
export function 뺀동안글(칸: "per" | "pbr", 동안들: { from: string; to: string }[]): string | null {
  if (!동안들.length) return null;
  const 글 = 동안들
    .map((x) => (년월글(x.from) === 년월글(x.to) ? 년월글(x.from) : `${년월글(x.from)} ~ ${년월글(x.to)}`))
    .join(", ");
  return `${칸 === "per" ? "적자였던" : "자본잠식이었던"} ${글}은 뺐어요`;
}
