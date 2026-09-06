/**
 * 퀀트 점수 — 앱처럼 보이게.
 *
 * ── 무엇이 문제였나 ──
 *
 * 숫자가 글자로만 놓여 있었다. "78 / 100  B" — 값은 다 있는데, 그게
 * 좋은 건지 나쁜 건지 한눈에 안 들어온다. 78이 100 중에 어디쯤인지
 * 알려면 머릿속에서 자를 대야 한다.
 *
 * 팩터 막대는 **늘 파랑**이었다. 20점짜리 팩터와 90점짜리 팩터가 같은
 * 색으로 그려졌다는 뜻이다 — 막대 길이만 다르고 색은 같으니, 색이
 * 아무 말도 안 하고 있었다. 바로 아래 점수 숫자는 색이 갈리는데
 * 막대만 안 갈려서, 같은 값을 두 규칙으로 칠하고 있었다.
 *
 * 그리고 '어디가 좋고 어디가 나쁜가' 를 다섯 칸을 눈으로 훑어
 * 비교해야 했다. 그건 화면이 할 일이다.
 *
 * ── 그래서 ──
 *
 *   · 반원 게이지로 점수의 위치를 그린다. 색은 점수를 따른다.
 *   · 강점·약점을 한 줄로 뽑는다.
 *   · 팩터 막대도 점수 색으로 칠한다.
 *   · 세부 지표에도 막대를 둔다 — 숫자만 있으면 어느 것이 발목을
 *     잡는지 안 보인다.
 *   · 기다리는 동안 '···' 대신 자리를 잡아 둔다.
 */
import type { QuantFactor, QuantScoreResult } from "@/api/stocks";
import { Card } from "@/components/ui";
import { SectionTitle } from "@/components/stock/DetailBits";
import { gradeColor, scoreColor } from "@/utils/quant";

/** 점수에 맞는 색값.
 *
 *  SVG 는 클래스로 못 칠한다(stroke 는 CSS 변수로 받아야 한다). 그래서
 *  scoreColor 와 **같은 경계**를 쓰는 색값을 따로 둔다. 경계가 어긋나면
 *  같은 점수가 글자와 막대에서 다른 색이 된다. */
export function 점수색값(s: number | null): string {
  if (s == null) return "var(--text-dim)";
  if (s >= 60) return "#10b981";      // accent-green
  if (s >= 40) return "#f59e0b";      // accent-yellow
  return "#ef4444";                   // accent-red
}

/**
 * 강점과 약점 한 줄.
 *
 * 다섯 칸을 눈으로 훑어 제일 높은 것과 제일 낮은 것을 찾는 일은
 * 화면이 해야 한다. 사람이 매번 하면 그게 곧 안 보는 이유가 된다.
 *
 * 점수가 없는 팩터는 뺀다 — '데이터가 없어서 0' 을 약점이라고 하면
 * 거짓말이다.
 */
export function 강점약점(factors: QuantFactor[] | undefined): {
  강점: QuantFactor | null; 약점: QuantFactor | null;
} {
  const 잰것 = (factors ?? []).filter((f) => f.score != null);
  if (잰것.length < 2) return { 강점: null, 약점: null };
  const 정렬 = [...잰것].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const 강점 = 정렬[0];
  const 약점 = 정렬[정렬.length - 1];
  /* 다 똑같으면 강점도 약점도 아니다. '수익성이 강점(50점)' 인데
     나머지도 전부 50점이면 그 말은 아무 뜻이 없다 */
  if ((강점.score ?? 0) === (약점.score ?? 0)) return { 강점: null, 약점: null };
  return { 강점, 약점 };
}

/**
 * 반원 게이지의 호 길이.
 *
 * 0점이면 0, 100점이면 반원 전체. 반지름 r 인 반원의 길이는 πr 이다.
 * 점수가 없으면 null — 0으로 그리면 '0점' 과 구분이 안 된다.
 */
export function 게이지길이(score: number | null, 반지름: number): number | null {
  if (score == null) return null;
  const 갇힌점수 = Math.max(0, Math.min(100, score));
  return (갇힌점수 / 100) * Math.PI * 반지름;
}

/** 점수 반원 게이지 — 숫자 하나를 '어디쯤인가' 로 바꾼다 */
function 게이지({ score, grade, 받는중 }: {
  score: number | null; grade: string | null; 받는중?: boolean;
}) {
  const R = 56;
  const 둘레 = Math.PI * R;
  const 채움 = 게이지길이(score, R);
  return (
    <div className="relative flex-shrink-0" style={{ width: 140, height: 82 }}>
      <svg width="140" height="82" viewBox="0 0 140 82" aria-hidden>
        {/* 바탕 반원 */}
        <path d={`M 14 70 A ${R} ${R} 0 0 1 126 70`}
              fill="none" stroke="var(--bg-elevated)" strokeWidth="12" strokeLinecap="round" />
        {/* 점수만큼 */}
        {채움 != null && (
          <path d={`M 14 70 A ${R} ${R} 0 0 1 126 70`}
                fill="none" stroke={점수색값(score)} strokeWidth="12" strokeLinecap="round"
                strokeDasharray={`${채움} ${둘레}`}
                style={{ transition: "stroke-dasharray .5s ease" }} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
        {받는중 ? (
          <span className="h-9 w-16 rounded bg-bg-elevated animate-pulse"
                role="status" aria-label="불러오는 중" />
        ) : (
          /* 토큰에 없는 크기를 쓰면 안 된다. text-4xl 은 Tailwind 기본값
             (2.25rem = 31.5px)으로 새어 들어와, 이 앱에서 제일 큰 토큰
             (hero 26.2px)보다도 커진다 — 화면 하나에 그것보다 큰 글자가
             있을 이유가 없다. 게이지 안에 들어가는 숫자라 더 그렇다. */
          <span className="text-hero leading-none font-mono font-bold text-text-primary tabular-nums">
            {score ?? "—"}
          </span>
        )}
        {grade && !받는중 && (
          <span className={`text-lg leading-tight font-bold ${gradeColor(grade)}`}>{grade}</span>
        )}
      </div>
    </div>
  );
}

/** 점수 막대 — 길이와 **색** 둘 다 점수를 따른다 */
function 막대({ score, 두껍게 }: { score: number | null; 두껍게?: boolean }) {
  return (
    <div className={`${두껍게 ? "h-2" : "h-1"} rounded-full bg-bg-primary overflow-hidden`}>
      <div className="h-full rounded-full transition-all"
           style={{
             width: `${Math.max(0, Math.min(100, score ?? 0))}%`,
             background: 점수색값(score),
           }} />
    </div>
  );
}

export default function QuantScoreView({
  quantScore, 받는중, 모으는중, 설정버튼, 설정패널,
}: {
  quantScore: QuantScoreResult | undefined;
  받는중: boolean;
  /** 일부 지표를 아직 모으는 중 — 점수가 바뀔 수 있다 */
  모으는중: boolean;
  설정버튼: React.ReactNode;
  설정패널: React.ReactNode;
}) {
  const 기다림 = 받는중 || 모으는중;
  const factors = quantScore?.factors ?? [];
  const { 강점, 약점 } = 강점약점(factors);

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-4 flex-wrap">
          <게이지 score={기다림 ? null : quantScore?.total_score ?? null}
                 grade={quantScore?.grade ?? null} 받는중={기다림} />

          <div className="flex flex-col gap-2 flex-1 min-w-[180px]">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold text-text-secondary">퀀트 점수</span>
              {설정버튼}
            </div>

            {/* ── 강점·약점 ──
                다섯 칸을 눈으로 훑어 제일 높은 것과 낮은 것을 찾는 일은
                화면이 해야 한다. 사람이 매번 하면 그게 곧 안 보는 이유다 */}
            {!기다림 && 강점 && 약점 && (
              <div className="flex flex-col gap-1" data-testid="강점약점">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-accent-green/15 text-accent-green font-semibold">강점</span>
                  <span className="text-text-secondary">{강점.label}</span>
                  <span className={`font-mono font-bold ${scoreColor(강점.score)}`}>{강점.score}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-accent-red/15 text-accent-red font-semibold">약점</span>
                  <span className="text-text-secondary">{약점.label}</span>
                  <span className={`font-mono font-bold ${scoreColor(약점.score)}`}>{약점.score}</span>
                </div>
              </div>
            )}
            {기다림 && (
              <div className="flex flex-col gap-1.5">
                <span className="h-3 w-32 rounded bg-bg-elevated animate-pulse" />
                <span className="h-3 w-28 rounded bg-bg-elevated animate-pulse" />
              </div>
            )}
            {모으는중 && (
              <span className="text-2xs text-text-muted">일부 지표를 모으는 중이라 점수가 바뀔 수 있어요</span>
            )}
          </div>
        </div>

        {설정패널}

        {/* ── 팩터 ──
            막대가 늘 파랑이었다. 20점과 90점이 같은 색이면 색이 아무
            말도 안 한다 — 바로 옆 숫자는 색이 갈리는데 막대만 안 갈려서
            같은 값을 두 규칙으로 칠하고 있었다 */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {기다림 && factors.length === 0
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2 p-3 rounded-xl border border-border bg-bg-elevated">
                  <span className="h-3 w-12 rounded bg-bg-primary animate-pulse" />
                  <span className="h-5 w-8 rounded bg-bg-primary animate-pulse" />
                  <span className="h-2 rounded bg-bg-primary animate-pulse" />
                </div>
              ))
            : factors.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5 p-3 rounded-xl border border-border bg-bg-elevated">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold text-text-secondary truncate">{f.label}</span>
                    <span className="text-2xs text-text-dim shrink-0">{f.weight}%</span>
                  </div>
                  <span className={`text-xl leading-none font-mono font-bold tabular-nums ${scoreColor(f.score)}`}>
                    {기다림 ? "—" : f.score ?? "—"}
                  </span>
                  <막대 score={기다림 ? null : f.score} 두껍게 />
                </div>
              ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <SectionTitle>세부 지표</SectionTitle>
        {factors.map((f) => (
          <div key={f.key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-text-secondary">{f.label}</span>
              <span className={`text-xs font-mono font-bold ${scoreColor(f.score)}`}>{f.score ?? "—"}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {f.metrics.map((mt) => (
                /* 값이 없는 칸은 흐리게. 있는 것과 같은 무게로 그리면
                   눈이 없는 값에도 똑같이 머문다 */
                <div key={mt.key}
                     className={`flex flex-col gap-1 p-2.5 rounded-lg border bg-bg-primary ${
                       mt.value == null ? "border-border/40 opacity-50" : "border-border/60"}`}>
                  <span className="text-2xs text-text-muted truncate" title={mt.label}>{mt.label}</span>
                  <span className="text-base font-mono text-text-primary tabular-nums truncate">
                    {mt.value != null ? `${mt.value}${mt.unit}` : "—"}
                  </span>
                  {/* 숫자만 있으면 어느 지표가 발목을 잡는지 안 보인다 */}
                  <막대 score={mt.score} />
                  <span className={`text-2xs font-mono ${scoreColor(mt.score)}`}>
                    {mt.score != null ? `${mt.score}점` : "데이터 없음"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="text-2xs text-text-muted leading-relaxed pt-1">
          업종 구분 없는 일반적인 기준 구간을 0~100점으로 환산한 참고용 점수이며 투자 조언이 아닙니다.
          일부 지표는 데이터가 없으면 제외되고, 해당 팩터·종합 점수의 가중치가 나머지 항목으로 재분배됩니다.
        </p>
      </Card>
    </div>
  );
}
