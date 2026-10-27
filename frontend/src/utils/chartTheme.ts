/**
 * 차트의 '틀' — 축·격자·툴팁·높이. 막대 그래프(종목 상세 재무·수급)와 선 그래프(내 자산 추이·종목 상세
 * 수익 흐름·백테스트)가 여기 한 곳의 값을 쓴다.
 *
 * 예전에는 화면마다 #232840, #64748b, #141824 를 손으로 적어 넣었다. 전부
 * 다크 테마의 값이라 라이트 모드에서는 차트만 어두운 채 남아 화면과 따로
 * 놀았다. 앱에는 theme: light | dark | system 설정이 실제로 있다.
 *
 * CSS 변수로 넘긴다. recharts 는 이 값을 SVG 속성과 인라인 스타일에 그대로
 * 흘려보내고, 브라우저가 그릴 때 그때의 테마 값으로 푼다 — 테마가 바뀌어도
 * 차트를 다시 만들 필요가 없다.
 *
 * 선 그래프도 화면마다 손으로 적었더니 백테스트만 다른 모양이 되었다 — 눈금이 '2018-02-15' 처럼 길고,
 * 세로축 숫자가 왼쪽을 먹고, 툴팁이 다른 상자였다. 높이도 220px 에 묶여 PC 에서 선이 눌렸다
 * (사용자: "백테스트 결과 그래프를 다른메뉴 그래프를 기준으로 통일해줘(그래프도 너무 작은 거 같아)").
 *
 * 지표 선 색(파랑·초록·보라…)은 여기 없다. 그건 '어느 선이 무엇인가' 를
 * 가리키는 정보라 테마와 무관하게 같아야 한다.
 */

/** 그래프 글자 — rem 이라 넓은 화면에서 뿌리 글자가 커질 때(index.css)·설정의 글씨 크기를 키울 때 같이
 *  커진다. px 로 박아 두면 화면은 커지는데 눈금만 그대로 작았다. 보통·휴대폰(14px) 기준 10·11·12px */
export const 그래프글자 = { 눈금: "0.72rem", 범례: "0.79rem", 툴팁: "0.86rem" } as const;

export const 격자 = { strokeDasharray: "3 3", stroke: "var(--border-default)" };

export const 축 = {
  tick: { fill: "var(--text-muted)", fontSize: 그래프글자.눈금 },
  tickLine: false,
} as const;

/** 선 그래프의 가로축 — 흐린 글자, 축선·눈금선 없이 */
export const 가로축 = {
  tick: { fill: "var(--text-dim)", fontSize: 그래프글자.눈금 },
  axisLine: false,
  tickLine: false,
  minTickGap: 24,
} as const;

/** 툴팁 — 카드와 같은 바탕·테두리. 막대 그래프와 선 그래프가 같은 상자를 쓴다 */
export const 툴팁 = {
  contentStyle: {
    background: "var(--bg-card)",
    border: "1px solid var(--border-default)",
    borderRadius: 10,
    fontSize: 그래프글자.툴팁,
    /* 배경만 바꾸면 라이트 모드에서 글자가 흰 바탕에 흐리게 남는다.
       recharts 는 label 색을 따로 정하므로 둘 다 지정한다 */
    color: "var(--text-primary)",
  },
  labelStyle: { color: "var(--text-muted)" },
} as const;

/** 0 을 기준으로 위아래가 갈리는 차트에서 그 선 */
export const 영점 = { stroke: "var(--text-muted)" };

/** 최고·최저 점선 — 선 그래프는 세로축 대신 이 두 줄을 긋고, 숫자는 그래프 아래 한 줄에 적는다 */
export const 기준점선 = { stroke: "var(--text-dim)", strokeDasharray: "2 4", strokeWidth: 1 } as const;

/** 선 그래프 높이(px) — [휴대폰, 넓은 화면]. 넓은 화면에서 1,000px 넘게 늘어난 선이 낮게 눌리면 오르내림이 안 보인다 */
export const 그래프높이 = {
  /** 내 자산 추이처럼 한 화면의 한 부분 */
  보통: [160, 260],
  /** 백테스트 자산 흐름·수익 곡선 — 결과의 본론 */
  큰: [220, 360],
  /** 낙폭처럼 곁에 붙는 것 */
  낮은: [150, 220],
} as const;

/** "2018-02-15" → "2018.02" — 몇 해를 잇는 그래프의 눈금. 해를 빼면 어느 해인지 모르고, 날까지 적으면 길다 */
export function 달눈금(day: string): string {
  const [y, m] = day.split("-");
  return y && m ? `${y}.${m}` : day;
}

/** 값들의 최고·최저 — 점선 두 줄과 그 아래 한 줄. 값이 없으면 null */
export function 끝값(값들: (number | null | undefined)[]): { 최고: number; 최저: number } | null {
  const 수들 = 값들.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return 수들.length ? { 최고: Math.max(...수들), 최저: Math.min(...수들) } : null;
}
