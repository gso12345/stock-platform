/**
 * 차트의 '틀' 색 — 축·격자·툴팁.
 *
 * 예전에는 화면마다 #232840, #64748b, #141824 를 손으로 적어 넣었다. 전부
 * 다크 테마의 값이라 라이트 모드에서는 차트만 어두운 채 남아 화면과 따로
 * 놀았다. 앱에는 theme: light | dark | system 설정이 실제로 있다.
 *
 * CSS 변수로 넘긴다. recharts 는 이 값을 SVG 속성과 인라인 스타일에 그대로
 * 흘려보내고, 브라우저가 그릴 때 그때의 테마 값으로 푼다 — 테마가 바뀌어도
 * 차트를 다시 만들 필요가 없다.
 *
 * 지표 선 색(파랑·초록·보라…)은 여기 없다. 그건 '어느 선이 무엇인가' 를
 * 가리키는 정보라 테마와 무관하게 같아야 한다.
 */
export const 격자 = { strokeDasharray: "3 3", stroke: "var(--border-default)" };

export const 축 = {
  tick: { fill: "var(--text-muted)", fontSize: 10 },
  tickLine: false,
} as const;

export const 툴팁 = {
  contentStyle: {
    background: "var(--bg-card)",
    border: "1px solid var(--border-default)",
    borderRadius: 8,
    fontSize: 11,
    /* 배경만 바꾸면 라이트 모드에서 글자가 흰 바탕에 흐리게 남는다.
       recharts 는 label 색을 따로 정하므로 둘 다 지정한다 */
    color: "var(--text-primary)",
  },
  labelStyle: { color: "var(--text-primary)" },
} as const;

/** 0 을 기준으로 위아래가 갈리는 차트에서 그 선 */
export const 영점 = { stroke: "var(--text-muted)" };
